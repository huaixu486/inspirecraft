import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Calendar, Card, DatePicker, Empty, Input, List, Segmented, Space, Tag, Typography, message } from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FlagOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { CalendarDayTypeOverride, CalendarItinerary, CalendarWorkStatus } from '../../../shared/types';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';

const { Text, Title } = Typography;

type CalendarEventKind = 'task' | 'document' | 'completed' | 'project' | 'itinerary';
type DayKind = 'workday' | 'rest' | 'holiday';

interface CalendarEvent {
  id: string;
  date: string;
  kind: CalendarEventKind;
  title: string;
  projectName: string;
  priority?: 'high' | 'medium' | 'low';
  note?: string;
  reminderAt?: string;
}

interface HolidayInfo {
  kind: 'holiday' | 'workday';
  name: string;
}

const kindMeta: Record<CalendarEventKind, { label: string; color: string; icon: React.ReactNode }> = {
  task: { label: '任务截止', color: '#2563eb', icon: <FlagOutlined /> },
  document: { label: '文档截止', color: '#d97706', icon: <FileTextOutlined /> },
  completed: { label: '已完成', color: '#16a34a', icon: <CheckCircleOutlined /> },
  project: { label: '项目创建', color: '#64748b', icon: <CalendarOutlined /> },
  itinerary: { label: '个人行程', color: '#8b5cf6', icon: <CalendarOutlined /> },
};

const workStatusMeta: Record<CalendarWorkStatus, { label: string; shortLabel: string; className: string }> = {
  leave: { label: '请假', shortLabel: '请', className: 'leave' },
  business: { label: '出差', shortLabel: '出', className: 'business' },
  overtime: { label: '加班', shortLabel: '加', className: 'overtime' },
};

const toDateKey = (value?: string) => {
  if (!value) return '';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD') : '';
};

const isDateKey = (value: string) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) && dayjs(value).isValid();
const normalizeDateKey = (value: string) => dayjs(value).format('YYYY-MM-DD');

const getDefaultReminder = (date: Dayjs) => {
  const now = dayjs();
  const nineAm = date.hour(9).minute(0).second(0).millisecond(0);
  return date.isSame(now, 'day') && nineAm.isBefore(now) ? now.add(15, 'minute').second(0).millisecond(0) : nineAm;
};

/** Supports the configured Timor API shape and common equivalent holiday APIs. */
function parseHolidayPayload(payload: unknown): Map<string, HolidayInfo> {
  const result = new Map<string, HolidayInfo>();
  if (!payload || typeof payload !== 'object') return result;

  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [root.holiday, (root.data as Record<string, unknown> | undefined)?.holiday, root.data, root];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entries = Array.isArray(candidate)
      ? candidate.map(item => {
        const record = item as Record<string, unknown>;
        return [String(record.date || record.day || record.dateString || ''), record] as const;
      })
      : Object.entries(candidate as Record<string, unknown>);

    for (const [rawDate, rawValue] of entries) {
      const record = typeof rawValue === 'object' && rawValue !== null ? rawValue as Record<string, unknown> : {};
      const recordDate = String(record.date || record.day || record.dateString || '');
      const dateKey = isDateKey(rawDate) ? rawDate : recordDate;
      if (!isDateKey(dateKey)) continue;
      const holidayFlag = typeof rawValue === 'boolean' ? rawValue : record.holiday ?? record.isHoliday ?? record.rest ?? record.isRest;
      const type = String(record.type || record.status || '').toLowerCase();
      const isHoliday = holidayFlag === true || ['holiday', 'rest', 'vacation'].includes(type);
      const isWorkday = holidayFlag === false || ['workday', 'work', 'makeup'].includes(type);
      if (!isHoliday && !isWorkday) continue;
      result.set(normalizeDateKey(dateKey), {
        kind: isHoliday ? 'holiday' : 'workday',
        name: String(record.name || record.target || (isHoliday ? '法定节假日' : '调休上班')),
      });
    }
    if (result.size) return result;
  }
  return result;
}

interface Props {
  onBack?: () => void;
}

const CalendarView: React.FC<Props> = ({ onBack }) => {
  const projects = useProjectStore(s => s.projects);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const tasks = useTaskStore(s => s.tasks);
  const holidayDataSource = useSettingsStore(s => s.holidayDataSource);
  const holidayApiUrl = useSettingsStore(s => s.holidayApiUrl);
  const calendarDayRecords = useSettingsStore(s => s.calendarDayRecords);
  const calendarItineraries = useSettingsStore(s => s.calendarItineraries);
  const updateCalendarDayRecords = useSettingsStore(s => s.updateCalendarDayRecords);
  const updateCalendarItineraries = useSettingsStore(s => s.updateCalendarItineraries);
  const [selectedDate, setSelectedDate] = useState(() => dayjs());
  const [displayMonth, setDisplayMonth] = useState(() => dayjs());
  const [holidays, setHolidays] = useState<Map<string, HolidayInfo>>(() => new Map());
  const [syncing, setSyncing] = useState(false);
  const [holidayLoaded, setHolidayLoaded] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [itineraryTitle, setItineraryTitle] = useState('');
  const [itineraryNote, setItineraryNote] = useState('');
  const [reminderAt, setReminderAt] = useState<Dayjs | null>(() => getDefaultReminder(dayjs()));
  const holidayCache = useRef(new Map<number, Map<string, HolidayInfo>>());

  const syncHolidays = useCallback(async (year: number, force = false) => {
    if (holidayDataSource === 'local') {
      setHolidays(new Map());
      setHolidayLoaded(true);
      return;
    }
    if (!force && holidayCache.current.has(year)) {
      setHolidays(holidayCache.current.get(year) || new Map());
      setHolidayLoaded(true);
      return;
    }
    const url = (holidayApiUrl || 'https://timor.tech/api/holiday/year/{year}').replace('{year}', String(year));
    setSyncing(true);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = parseHolidayPayload(await response.json());
      if (!records.size) throw new Error('未识别到节假日数据');
      holidayCache.current.set(year, records);
      setHolidays(records);
      setHolidayLoaded(true);
      if (force) message.success(`${year} 年节假日已同步`);
    } catch (error) {
      console.warn('Failed to sync holidays:', error);
      setHolidays(holidayCache.current.get(year) || new Map());
      setHolidayLoaded(true);
      if (force || holidayDataSource === 'online') message.warning('节假日同步失败，已按周末休息日显示');
    } finally {
      setSyncing(false);
    }
  }, [holidayApiUrl, holidayDataSource]);

  useEffect(() => { void syncHolidays(displayMonth.year()); }, [displayMonth, syncHolidays]);

  const dayRecordsByDate = useMemo(() => new Map(calendarDayRecords.map(record => [record.date, record])), [calendarDayRecords]);
  const selectedKey = selectedDate.format('YYYY-MM-DD');
  const selectedDayRecord = dayRecordsByDate.get(selectedKey);

  useEffect(() => {
    setNoteDraft(selectedDayRecord?.note || '');
    setReminderAt(getDefaultReminder(selectedDate));
  }, [selectedDate, selectedDayRecord?.note]);

  const events = useMemo<CalendarEvent[]>(() => {
    const projectNames = new Map(projects.map(project => [project.id, project.name]));
    const result: CalendarEvent[] = [];
    projects.forEach(project => {
      const date = toDateKey(project.createdAt);
      if (date) result.push({ id: `project:${project.id}:${date}`, date, kind: 'project', title: `创建项目：${project.name}`, projectName: project.name });
    });
    projectDocs.forEach(doc => {
      const projectName = projectNames.get(doc.projectId) || '未关联项目';
      const deadline = toDateKey(doc.deadline);
      if (deadline) result.push({ id: `document:${doc.id}:deadline`, date: deadline, kind: 'document', title: doc.name, projectName });
      const completedAt = toDateKey(doc.completedAt);
      if (completedAt) result.push({ id: `document:${doc.id}:completed`, date: completedAt, kind: 'completed', title: doc.name, projectName });
    });
    tasks.forEach(task => {
      const date = toDateKey(task.dueAt);
      if (!date) return;
      result.push({ id: `task:${task.id}`, date, kind: task.status === 'completed' ? 'completed' : 'task', title: task.title, projectName: projectNames.get(task.projectId) || '未关联项目', priority: task.priority });
    });
    calendarItineraries.forEach(item => result.push({
      id: `itinerary:${item.id}`,
      date: item.date,
      kind: 'itinerary',
      title: item.title,
      projectName: '个人行程',
      note: item.note,
      reminderAt: item.reminderAt,
    }));
    return result.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, 'zh-CN'));
  }, [calendarItineraries, projectDocs, projects, tasks]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(event => map.set(event.date, [...(map.get(event.date) || []), event]));
    return map;
  }, [events]);

  const getDayInfo = useCallback((date: Dayjs): { kind: DayKind; label: string; title: string } => {
    const manualType = dayRecordsByDate.get(date.format('YYYY-MM-DD'))?.dayType;
    if (manualType === 'rest') return { kind: 'rest', label: '休', title: '手动设为休息日' };
    if (manualType === 'workday') return { kind: 'workday', label: '班', title: '手动设为工作日' };
    const synced = holidays.get(date.format('YYYY-MM-DD'));
    if (synced?.kind === 'holiday') return { kind: 'holiday', label: '假', title: synced.name };
    if (synced?.kind === 'workday') return { kind: 'workday', label: '班', title: synced.name };
    if (date.day() === 0 || date.day() === 6) return { kind: 'rest', label: '休', title: '周末休息日' };
    return { kind: 'workday', label: '班', title: '工作日' };
  }, [dayRecordsByDate, holidays]);

  const updateSelectedDay = (patch: Partial<{ dayType: CalendarDayTypeOverride; workStatus: CalendarWorkStatus; note: string }>) => {
    const current = dayRecordsByDate.get(selectedKey);
    const next = { ...current, ...patch, date: selectedKey, updatedAt: new Date().toISOString() };
    const shouldRemove = !next.dayType && !next.workStatus && !next.note?.trim();
    const records = shouldRemove
      ? calendarDayRecords.filter(record => record.date !== selectedKey)
      : [...calendarDayRecords.filter(record => record.date !== selectedKey), next];
    void updateCalendarDayRecords(records);
  };

  const saveNote = () => {
    updateSelectedDay({ note: noteDraft.trim() });
    message.success(noteDraft.trim() ? '备注已保存' : '备注已清除');
  };

  const addItinerary = () => {
    const title = itineraryTitle.trim();
    if (!title) {
      message.warning('请先填写行程名称');
      return;
    }
    const item: CalendarItinerary = {
      id: `calendar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: selectedKey,
      title,
      note: itineraryNote.trim() || undefined,
      reminderAt: reminderAt?.toISOString(),
      createdAt: new Date().toISOString(),
    };
    void updateCalendarItineraries([...calendarItineraries, item]);
    setItineraryTitle('');
    setItineraryNote('');
    setReminderAt(getDefaultReminder(selectedDate));
    message.success(item.reminderAt ? '行程已添加，到时将发送 Windows 通知' : '行程已添加');
  };

  const removeItinerary = (id: string) => {
    void updateCalendarItineraries(calendarItineraries.filter(item => item.id !== id));
    message.success('行程已删除');
  };

  const selectedEvents = eventsByDate.get(selectedKey) || [];
  const selectedDayInfo = getDayInfo(selectedDate);
  const upcomingEvents = useMemo(() => events.filter(event => event.date >= selectedKey).slice(0, 6), [events, selectedKey]);

  const dateCellRender = (date: Dayjs) => {
    const key = date.format('YYYY-MM-DD');
    const dateEvents = eventsByDate.get(key) || [];
    const dayInfo = getDayInfo(date);
    const workStatus = dayRecordsByDate.get(key)?.workStatus;
    return (
      <div className="calendar-cell-content">
        <div className="calendar-cell-statuses">
          <span className={`calendar-day-state ${dayInfo.kind}`} title={dayInfo.title}>{dayInfo.label}</span>
          {workStatus && <span className={`calendar-work-state ${workStatusMeta[workStatus].className}`} title={workStatusMeta[workStatus].label}>{workStatusMeta[workStatus].shortLabel}</span>}
        </div>
        {dateEvents.length > 0 && <div className="calendar-event-dots">
          {dateEvents.slice(0, 3).map(event => <span key={event.id} style={{ background: kindMeta[event.kind].color }} />)}
          {dateEvents.length > 3 && <em>+{dateEvents.length - 3}</em>}
        </div>}
      </div>
    );
  };

  const holidaySourceLabel = holidayDataSource === 'local' ? '本地周末规则' : holidayLoaded ? '在线节假日已同步' : '正在同步节假日';

  return (
    <div className="calendar-page">
      <div className="calendar-page-header">
        <Space size={10} align="start">
          {onBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} aria-label="返回总览" />}
          <div>
            <Title level={4}>项目日历</Title>
            <Text type="secondary">项目节点、个人行程和工作安排统一管理</Text>
          </div>
        </Space>
        <Space size={8} wrap>
          <Tag className="calendar-sync-tag" color={holidayDataSource === 'local' ? 'default' : 'green'}>{holidaySourceLabel}</Tag>
          <Button icon={<SyncOutlined spin={syncing} />} loading={syncing} onClick={() => void syncHolidays(displayMonth.year(), true)}>同步节假日</Button>
        </Space>
      </div>

      <div className="calendar-page-layout">
        <Card className="calendar-month-card" bordered={false}>
          <div className="calendar-legend" aria-label="日历图例">
            <span><i className="calendar-legend-rest" />休息日</span>
            <span><i className="calendar-legend-holiday" />法定假日</span>
            <span><i className="calendar-legend-workday" />调休上班</span>
            <span><i className="calendar-legend-itinerary" />个人行程</span>
          </div>
          <Calendar value={selectedDate} onSelect={setSelectedDate} onPanelChange={setDisplayMonth} dateCellRender={dateCellRender} />
        </Card>

        <aside className="calendar-agenda calendar-inspector">
          <Card bordered={false} className="calendar-day-editor-card">
            <div className="calendar-editor-title-row">
              <div>
                <Text className="calendar-selected-date">{selectedDate.format('M 月 D 日')}</Text>
                <div><Text type="secondary">{selectedDate.format('dddd')}</Text></div>
              </div>
              <Tag className={`calendar-day-kind-tag ${selectedDayInfo.kind}`}>{selectedDayInfo.title}</Tag>
            </div>

            <div className="calendar-editor-section">
              <Text className="calendar-editor-label">日期类型</Text>
              <Segmented
                block
                value={selectedDayRecord?.dayType || 'auto'}
                options={[
                  { label: '自动规则', value: 'auto' },
                  { label: '工作日', value: 'workday' },
                  { label: '休息日', value: 'rest' },
                ]}
                onChange={value => updateSelectedDay({ dayType: value === 'auto' ? undefined : value as CalendarDayTypeOverride })}
              />
            </div>

            <div className="calendar-editor-section">
              <Text className="calendar-editor-label">工作状态</Text>
              <div className="calendar-status-actions is-wide">
                {(Object.keys(workStatusMeta) as CalendarWorkStatus[]).map(status => (
                  <Button key={status} size="small" className={`calendar-status-button ${workStatusMeta[status].className} ${selectedDayRecord?.workStatus === status ? 'is-active' : ''}`} onClick={() => updateSelectedDay({ workStatus: status })}>{workStatusMeta[status].label}</Button>
                ))}
                {selectedDayRecord?.workStatus && <Button size="small" type="text" onClick={() => updateSelectedDay({ workStatus: undefined })}>清除</Button>}
              </div>
            </div>

            <div className="calendar-editor-section">
              <Text className="calendar-editor-label">当天备注</Text>
              <Input.TextArea value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="例如：外出开会，下午不安排任务" autoSize={{ minRows: 2, maxRows: 4 }} />
              <Button size="small" type="link" className="calendar-save-note" onClick={saveNote}>保存备注</Button>
            </div>
          </Card>

          <Card title="添加个人行程" bordered={false} className="calendar-itinerary-card">
            <div className="calendar-itinerary-form">
              <Input value={itineraryTitle} onChange={event => setItineraryTitle(event.target.value)} onPressEnter={addItinerary} placeholder="行程名称，例如：客户沟通会" maxLength={80} />
              <Input.TextArea value={itineraryNote} onChange={event => setItineraryNote(event.target.value)} placeholder="补充说明（可选）" autoSize={{ minRows: 2, maxRows: 3 }} maxLength={240} />
              <div className="calendar-reminder-row">
                <DatePicker value={reminderAt} onChange={setReminderAt} showTime format="MM-DD HH:mm" placeholder="提醒时间" allowClear />
                <Button type="primary" icon={<PlusOutlined />} onClick={addItinerary}>添加</Button>
              </div>
              <Text type="secondary" className="calendar-reminder-hint">设置提醒时间后，应用运行期间会调用 Windows 系统通知。</Text>
            </div>
          </Card>

          <Card title="当天日程" bordered={false} className="calendar-agenda-card">
            {selectedEvents.length ? <List size="small" dataSource={selectedEvents} renderItem={event => {
              const meta = kindMeta[event.kind];
              const itineraryId = event.kind === 'itinerary' ? event.id.replace('itinerary:', '') : '';
              return <List.Item actions={itineraryId ? [<Button key="delete" type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeItinerary(itineraryId)} aria-label="删除行程" />] : undefined}>
                <div className="calendar-agenda-item">
                  <span className="calendar-event-icon" style={{ color: meta.color }}>{meta.icon}</span>
                  <div>
                    <Text strong>{event.title}</Text>
                    <div><Text type="secondary">{event.projectName} · {meta.label}{event.reminderAt ? ` · 提醒 ${dayjs(event.reminderAt).format('HH:mm')}` : ''}</Text></div>
                    {event.note && <div><Text type="secondary" className="calendar-event-note">{event.note}</Text></div>}
                  </div>
                  {event.priority === 'high' && <Badge color="#ef4444" />}
                </div>
              </List.Item>;
            }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天暂无日程" />}
          </Card>

          <Card title={<span><ClockCircleOutlined /> 近期日程</span>} bordered={false} className="calendar-upcoming-card">
            {upcomingEvents.length ? upcomingEvents.map(event => {
              const meta = kindMeta[event.kind];
              return <button key={event.id} type="button" className="calendar-upcoming-item" onClick={() => setSelectedDate(dayjs(event.date))}>
                <span className="calendar-upcoming-date">{dayjs(event.date).format('MM/DD')}</span>
                <span className="calendar-upcoming-dot" style={{ background: meta.color }} />
                <span>{event.title}</span>
              </button>;
            }) : <Text type="secondary">暂无近期日程</Text>}
          </Card>
        </aside>
      </div>
    </div>
  );
};

export default CalendarView;

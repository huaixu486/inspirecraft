import React, { useState, useMemo, useEffect } from 'react';
import { Card, Typography, Empty, Button, Space, Tag, Input, Tooltip, Divider, Spin } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  RestOutlined,
  FlagOutlined,
  PlusOutlined,
  CalendarOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

type DayType = 'work' | 'rest' | 'holiday' | 'overtime' | 'leave';

interface CalendarEvent {
  id: string;
  date: string;
  type: DayType;
  title: string;
  description?: string;
}

interface HolidayInfo {
  name: string;
  date: string;
  rest: string[];   // 假期日期列表
  work: string[];   // 调休上班日期列表
}

const dayTypeConfig: Record<DayType, { color: string; label: string; icon: React.ReactNode }> = {
  work: { color: '#1890ff', label: '工作日', icon: <ClockCircleOutlined /> },
  rest: { color: '#52c41a', label: '休息日', icon: <RestOutlined /> },
  holiday: { color: '#faad14', label: '节假日', icon: <FlagOutlined /> },
  overtime: { color: '#ff4d4f', label: '加班', icon: <ClockCircleOutlined /> },
  leave: { color: '#722ed1', label: '请假', icon: <CheckCircleOutlined /> },
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

// 缓存已获取的节假日数据
const holidayCache: Record<number, { holidays: Set<string>; makeupDays: Set<string>; holidayNames: Record<string, string> }> = {};

async function fetchHolidayData(year: number): Promise<{ holidays: Set<string>; makeupDays: Set<string>; holidayNames: Record<string, string> }> {
  if (holidayCache[year]) return holidayCache[year];

  try {
    const resp = await fetch(`https://timor.tech/api/holiday/year/${year}`);
    const data = await resp.json();

    const holidays = new Set<string>();
    const makeupDays = new Set<string>();
    const holidayNames: Record<string, string> = {};

    if (data && data.holiday) {
      // 遍历每个节假日
      Object.values(data.holiday as Record<string, HolidayInfo>).forEach((info) => {
        info.rest.forEach(d => {
          const dateStr = d.replace(/\//g, '-');
          holidays.add(dateStr);
          holidayNames[dateStr] = info.name;
        });
        info.work.forEach(d => {
          const dateStr = d.replace(/\//g, '-');
          makeupDays.add(dateStr);
          holidayNames[dateStr] = '调休上班';
        });
      });
    }

    holidayCache[year] = { holidays, makeupDays, holidayNames };
    return holidayCache[year];
  } catch {
    // API 失败时返回空数据
    const empty = { holidays: new Set<string>(), makeupDays: new Set<string>(), holidayNames: {} as Record<string, string> };
    holidayCache[year] = empty;
    return empty;
  }
}

const DiffViewer: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState<DayType>('work');
  const [holidayData, setHolidayData] = useState<{ holidays: Set<string>; makeupDays: Set<string>; holidayNames: Record<string, string> }>({ holidays: new Set(), makeupDays: new Set(), holidayNames: {} });
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // 加载法定节假日数据
  useEffect(() => {
    let cancelled = false;
    setHolidayLoading(true);
    // 同时加载当年和跨年节假日（如春节可能跨年）
    Promise.all([
      fetchHolidayData(year),
      month === 0 ? fetchHolidayData(year - 1) : Promise.resolve(null),
      month === 11 ? fetchHolidayData(year + 1) : Promise.resolve(null),
    ]).then(results => {
      if (cancelled) return;
      const merged = { holidays: new Set<string>(), makeupDays: new Set<string>(), holidayNames: {} as Record<string, string> };
      results.forEach(r => {
        if (!r) return;
        r.holidays.forEach(d => merged.holidays.add(d));
        r.makeupDays.forEach(d => merged.makeupDays.add(d));
        Object.assign(merged.holidayNames, r.holidayNames);
      });
      setHolidayData(merged);
      setHolidayLoading(false);
    });
    return () => { cancelled = true; };
  }, [year, refreshKey]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    for (let i = startPadding - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
    }
    for (let i = 1; i <= totalDays; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  }, [year, month]);

  const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
  };

  const getDayType = (date: Date): DayType => {
    const dateStr = formatDate(date);
    const event = events.find(e => e.date === dateStr);
    if (event) return event.type;
    if (holidayData.holidays.has(dateStr)) return 'holiday';
    if (holidayData.makeupDays.has(dateStr)) return 'work';
    const day = date.getDay();
    if (day === 0 || day === 6) return 'rest';
    return 'work';
  };

  const getHolidayName = (dateStr: string): string | null => {
    return holidayData.holidayNames[dateStr] || null;
  };

  const getEventsForDate = (dateStr: string) => events.filter(e => e.date === dateStr);

  const addEvent = () => {
    if (!selectedDate || !newTitle.trim()) return;
    const event: CalendarEvent = {
      id: Date.now().toString(),
      date: selectedDate,
      type: newType,
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
    };
    setEvents([...events, event]);
    setNewTitle('');
    setNewDesc('');
    setNewType('work');
  };

  const deleteEvent = (id: string) => {
    setEvents(events.filter(e => e.id !== id));
  };

  const selectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    setNewTitle('');
    setNewDesc('');
    setNewType(getDayType(new Date(dateStr)));
  };

  const markDateType = (type: DayType) => {
    if (!selectedDate) return;
    setNewType(type);
    // 如果当前日期已经是该类型且无用户事件，不做操作
    const currentType = getDayType(new Date(selectedDate));
    const hasUserEvent = events.some(e => e.date === selectedDate && e.title);
    if (currentType === type && !hasUserEvent) return;
    // 移除该日期已有的自动标记事件（无标题），保留用户事件
    const filtered = events.filter(e => !(e.date === selectedDate && !e.title));
    const autoEvent: CalendarEvent = {
      id: Date.now().toString(),
      date: selectedDate,
      type,
      title: '',
    };
    setEvents([...filtered, autoEvent]);
  };

  const today = formatDate(new Date());
  const selectedDateType = selectedDate ? getDayType(new Date(selectedDate)) : 'work';
  const selectedDateConfig = dayTypeConfig[selectedDateType];
  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate).filter(e => e.title) : [];

  const monthStats = useMemo(() => {
    let workDays = 0, restDays = 0, holidaysCount = 0;
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= lastDay; i++) {
      const type = getDayType(new Date(year, month, i));
      if (type === 'work' || type === 'overtime') workDays++;
      else if (type === 'rest') restDays++;
      else if (type === 'holiday') holidaysCount++;
    }
    return { workDays, restDays, holidays: holidaysCount };
  }, [year, month, events, holidayData]);

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      {/* 左侧：日历主体 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Space>
            {onBack && <Button type="text" icon={<LeftOutlined />} onClick={onBack} />}
            <Title level={4} style={{ margin: 0 }}>工作日历</Title>
            {holidayLoading && <Spin size="small" />}
          </Space>
          <Tooltip title="刷新节假日数据">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={holidayLoading} />}
              onClick={() => {
                delete holidayCache[year];
                setRefreshKey(k => k + 1);
              }}
            />
          </Tooltip>
        </div>

        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button icon={<LeftOutlined />} onClick={() => setCurrentDate(new Date(year, month - 1, 1))} />
              <Text strong style={{ fontSize: 18, minWidth: 120, textAlign: 'center' }}>{year}年 {MONTHS[month]}</Text>
              <Button icon={<RightOutlined />} onClick={() => setCurrentDate(new Date(year, month + 1, 1))} />
              <Button onClick={() => setCurrentDate(new Date())}>今天</Button>
            </div>
          }
          extra={
            <Space size={4}>
              {Object.entries(dayTypeConfig).map(([type, config]) => (
                <Tag key={type} color={config.color} style={{ margin: 0 }}>{config.label}</Tag>
              ))}
            </Space>
          }
          styles={{ body: { padding: '8px 12px' } }}
        >
          {/* 星期头 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 6 }}>
            {WEEKDAYS.map((day, i) => (
              <div key={day} style={{ textAlign: 'center', padding: '6px 0', fontWeight: 600, color: i === 0 || i === 6 ? '#ff4d4f' : '#666', fontSize: 13 }}>
                {day}
              </div>
            ))}
          </div>

          {/* 日历网格 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {calendarDays.map(({ date, isCurrentMonth }, index) => {
              const dateStr = formatDate(date);
              const dayType = getDayType(date);
              const dayEvents = getEventsForDate(dateStr).filter(e => e.title);
              const isToday = dateStr === today;
              const isSelected = selectedDate === dateStr;
              const config = dayTypeConfig[dayType];
              const holidayName = getHolidayName(dateStr);
              // 节假日显示具体名称，调休上班显示"班"，其他显示类型标签
              const cellLabel = dayType === 'holiday' ? (holidayName || config.label)
                : holidayData.makeupDays.has(dateStr) ? '班'
                : config.label;

              return (
                <div
                  key={index}
                  onClick={() => selectDate(dateStr)}
                  style={{
                    minHeight: 72,
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: isSelected ? `2px solid ${config.color}` : isToday ? '2px solid #1890ff' : '1px solid #f0f0f0',
                    background: isCurrentMonth ? isSelected ? `${config.color}08` : isToday ? '#e6f7ff' : '#fff' : '#fafafa',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    opacity: isCurrentMonth ? 1 : 0.4,
                    position: 'relative',
                  }}
                  onMouseEnter={e => {
                    if (isCurrentMonth && !isSelected) {
                      e.currentTarget.style.borderColor = config.color;
                      e.currentTarget.style.transform = 'scale(1.02)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (isCurrentMonth && !isSelected) {
                      e.currentTarget.style.borderColor = isToday ? '#1890ff' : '#f0f0f0';
                      e.currentTarget.style.transform = 'scale(1)';
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: isToday ? '#1890ff' : isCurrentMonth ? '#333' : '#999' }}>
                      {date.getDate()}
                    </span>
                    {cellLabel !== '工作日' && (
                      <span style={{ fontSize: 8, padding: '1px 3px', borderRadius: 2, background: `${config.color}15`, color: config.color, fontWeight: 600, maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cellLabel}
                      </span>
                    )}
                  </div>
                  {dayEvents.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      {dayEvents.slice(0, 2).map(event => (
                        <div key={event.id} style={{ fontSize: 9, padding: '1px 3px', borderRadius: 2, background: `${dayTypeConfig[event.type].color}15`, color: dayTypeConfig[event.type].color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                          {event.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && <div style={{ fontSize: 9, color: '#999', textAlign: 'center' }}>+{dayEvents.length - 2}</div>}
                    </div>
                  )}
                  {isToday && <div style={{ position: 'absolute', bottom: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: '#1890ff' }} />}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 右侧：日期详情常驻面板 */}
      <div style={{
        width: 320,
        flexShrink: 0,
        background: '#fff',
        borderRadius: 8,
        border: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* 面板标题 */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {selectedDate ? (
            <>
              <Space>
                <CalendarOutlined />
                <span style={{ fontWeight: 600 }}>{formatDateDisplay(selectedDate)}</span>
                <Tag color={selectedDateConfig.color}>{selectedDateConfig.label}</Tag>
              </Space>
              <Button type="text" size="small" onClick={() => setSelectedDate(null)}>← 返回</Button>
            </>
          ) : (
            <Space>
              <CalendarOutlined />
              <span style={{ fontWeight: 600 }}>{year}年{month + 1}月 统计</span>
            </Space>
          )}
        </div>

        {/* 面板内容 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {!selectedDate ? (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#e6f7ff', borderRadius: 8 }}>
                  <ClockCircleOutlined style={{ fontSize: 20, color: '#1890ff' }} />
                  <div>
                    <Text style={{ fontSize: 20, fontWeight: 700, color: '#1890ff' }}>{monthStats.workDays}</Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>个工作日</Text>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#f6ffed', borderRadius: 8 }}>
                  <RestOutlined style={{ fontSize: 20, color: '#52c41a' }} />
                  <div>
                    <Text style={{ fontSize: 20, fontWeight: 700, color: '#52c41a' }}>{monthStats.restDays}</Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>个休息日</Text>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#fffbe6', borderRadius: 8 }}>
                  <FlagOutlined style={{ fontSize: 20, color: '#faad14' }} />
                  <div>
                    <Text style={{ fontSize: 20, fontWeight: 700, color: '#faad14' }}>{monthStats.holidays}</Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>个节假日</Text>
                  </div>
                </div>
              </div>

              <Divider style={{ margin: '16px 0' }} />

              <Text type="secondary" style={{ fontSize: 12 }}>点击日历中的日期可添加日程</Text>
            </div>
          ) : (
            <>
              {/* 添加日程表单 */}
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>添加日程</Text>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(dayTypeConfig).map(([type, config]) => (
                      <Tag
                        key={type}
                        color={newType === type ? config.color : undefined}
                        style={{
                          cursor: 'pointer',
                          margin: 0,
                          padding: '2px 10px',
                          border: newType === type ? undefined : `1px solid ${config.color}40`,
                          color: newType === type ? '#fff' : config.color,
                          background: newType === type ? config.color : `${config.color}08`,
                          borderRadius: 4,
                        }}
                        onClick={() => markDateType(type as DayType)}
                      >
                        {config.icon} {config.label}
                      </Tag>
                    ))}
                  </div>
                  <Input
                    placeholder="日程标题"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onPressEnter={addEvent}
                  />
                  <Input.TextArea
                    placeholder="备注（可选）"
                    rows={2}
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                  />
                  <Button type="primary" icon={<PlusOutlined />} block onClick={addEvent} disabled={!newTitle.trim()}>
                    添加
                  </Button>
                </Space>
              </div>

              <Divider style={{ margin: '12px 0' }} />

              {/* 已有日程列表 */}
              <div>
                <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>日程列表 ({selectedDateEvents.length})</Text>
                {selectedDateEvents.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>暂无日程</Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedDateEvents.map(event => {
                      const cfg = dayTypeConfig[event.type];
                      return (
                        <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fafafa', borderRadius: 6, border: `1px solid ${cfg.color}20` }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 13, display: 'block' }}>{event.title}</Text>
                            {event.description && <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>{event.description}</Text>}
                          </div>
                          <Tag color={cfg.color} style={{ margin: 0, fontSize: 10 }}>{cfg.label}</Tag>
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => deleteEvent(event.id)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 该日期自动类型说明 */}
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ padding: '8px 10px', background: '#f6f8fa', borderRadius: 6 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  该日期类型：<Tag color={selectedDateConfig.color} style={{ margin: 0 }}>{selectedDateConfig.label}</Tag>
                  {selectedDateType === 'holiday' && `（${getHolidayName(selectedDate!) || '法定节假日'}）`}
                  {holidayData.makeupDays.has(selectedDate!) && '（调休上班）'}
                  {selectedDateType === 'rest' && !holidayData.makeupDays.has(selectedDate!) && '（周末休息）'}
                  {selectedDateType === 'work' && !holidayData.makeupDays.has(selectedDate!) && '（正常工作日）'}
                </Text>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;

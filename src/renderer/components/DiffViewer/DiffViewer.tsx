import React, { useState, useMemo } from 'react';
import { Card, Typography, Empty, Button, Space, Tag, Input, Tooltip, Drawer, Divider, List } from 'antd';
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

const dayTypeConfig: Record<DayType, { color: string; label: string; icon: React.ReactNode }> = {
  work: { color: '#1890ff', label: '工作日', icon: <ClockCircleOutlined /> },
  rest: { color: '#52c41a', label: '休息日', icon: <RestOutlined /> },
  holiday: { color: '#faad14', label: '节假日', icon: <FlagOutlined /> },
  overtime: { color: '#ff4d4f', label: '加班', icon: <ClockCircleOutlined /> },
  leave: { color: '#722ed1', label: '请假', icon: <CheckCircleOutlined /> },
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

const DiffViewer: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState<DayType>('work');

  const holidays = useMemo(() => new Set([
    '2024-01-01', '2024-02-10', '2024-02-11', '2024-02-12', '2024-02-13', '2024-02-14', '2024-02-15', '2024-02-16', '2024-02-17',
    '2024-04-04', '2024-04-05', '2024-04-06',
    '2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05',
    '2024-06-08', '2024-06-09', '2024-06-10',
    '2024-09-15', '2024-09-16', '2024-09-17',
    '2024-10-01', '2024-10-02', '2024-10-03', '2024-10-04', '2024-10-05', '2024-10-06', '2024-10-07',
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
    '2025-04-04', '2025-04-05', '2025-04-06',
    '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
    '2025-05-31', '2025-06-01', '2025-06-02',
    '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07',
  ]), []);

  const makeupDays = useMemo(() => new Set([
    '2024-02-04', '2024-02-18', '2024-04-07', '2024-04-28', '2024-05-11', '2024-09-14', '2024-09-29', '2024-10-12',
    '2025-01-26', '2025-02-08', '2025-04-27', '2025-05-10', '2025-06-02', '2025-09-28', '2025-10-11',
  ]), []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

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
    if (holidays.has(dateStr)) return 'holiday';
    if (makeupDays.has(dateStr)) return 'work';
    const day = date.getDay();
    if (day === 0 || day === 6) return 'rest';
    return 'work';
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

  const openDateDrawer = (dateStr: string) => {
    setSelectedDate(dateStr);
    setDrawerOpen(true);
    setNewTitle('');
    setNewDesc('');
    setNewType(getDayType(new Date(dateStr)));
  };

  const today = formatDate(new Date());
  const selectedDateType = selectedDate ? getDayType(new Date(selectedDate)) : 'work';
  const selectedDateConfig = dayTypeConfig[selectedDateType];
  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];

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
  }, [year, month, events, holidays, makeupDays]);

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      {/* 左侧：日历主体 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>工作日历</Title>
          <Space>
            <Tag color="blue">工作日 {monthStats.workDays} 天</Tag>
            <Tag color="green">休息日 {monthStats.restDays} 天</Tag>
            <Tag color="gold">节假日 {monthStats.holidays} 天</Tag>
          </Space>
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
              const dayEvents = getEventsForDate(dateStr);
              const isToday = dateStr === today;
              const isSelected = selectedDate === dateStr;
              const config = dayTypeConfig[dayType];

              return (
                <div
                  key={index}
                  onClick={() => openDateDrawer(dateStr)}
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
                    {dayType !== 'work' && (
                      <span style={{ fontSize: 8, padding: '1px 3px', borderRadius: 2, background: `${config.color}15`, color: config.color, fontWeight: 600 }}>
                        {config.label}
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

      {/* 右侧：日期详情抽屉 */}
      <Drawer
        title={
          selectedDate ? (
            <Space>
              <CalendarOutlined />
              <span>{formatDateDisplay(selectedDate)}</span>
              <Tag color={selectedDateConfig.color}>{selectedDateConfig.label}</Tag>
            </Space>
          ) : '日期详情'
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={320}
        styles={{ body: { padding: '12px 16px' } }}
      >
        {selectedDate && (
          <>
            {/* 添加日程表单 */}
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>添加日程</Text>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as DayType)}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: 6,
                    border: '1px solid #d9d9d9', fontSize: 13, cursor: 'pointer',
                    background: '#fff',
                  }}
                >
                  {Object.entries(dayTypeConfig).map(([type, config]) => (
                    <option key={type} value={type}>{config.label}</option>
                  ))}
                </select>
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
                {selectedDateType === 'holiday' && '（法定节假日）'}
                {selectedDateType === 'rest' && '（周末休息）'}
                {selectedDateType === 'work' && '（正常工作日）'}
              </Text>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
};

export default DiffViewer;

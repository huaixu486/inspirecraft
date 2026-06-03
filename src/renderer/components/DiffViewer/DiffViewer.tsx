import React, { useState, useMemo } from 'react';
import { Card, Typography, Empty, Button, Space, Tag, Input, Tooltip, Select } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  RestOutlined,
  FlagOutlined,
  PlusOutlined,
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
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
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

  const getEventsForDate = (date: Date) => events.filter(e => e.date === formatDate(date));

  const addEvent = (dateStr: string) => {
    if (!newTitle.trim()) return;
    const event: CalendarEvent = {
      id: Date.now().toString(),
      date: dateStr,
      type: newType,
      title: newTitle.trim(),
    };
    setEvents([...events, event]);
    setNewTitle('');
    setNewType('work');
    setEditingDate(null);
  };

  const deleteEvent = (id: string) => {
    setEvents(events.filter(e => e.id !== id));
  };

  const today = formatDate(new Date());

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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>工作日历</Title>
        <Space>
          <Tag color="blue">工作日 {monthStats.workDays} 天</Tag>
          <Tag color="green">休息日 {monthStats.restDays} 天</Tag>
          <Tag color="gold">节假日 {monthStats.holidays} 天</Tag>
        </Space>
      </div>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
      >
        {/* 星期头 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 8 }}>
          {WEEKDAYS.map((day, i) => (
            <div key={day} style={{ textAlign: 'center', padding: '8px 0', fontWeight: 600, color: i === 0 || i === 6 ? '#ff4d4f' : '#666', fontSize: 13 }}>
              {day}
            </div>
          ))}
        </div>

        {/* 日历网格 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {calendarDays.map(({ date, isCurrentMonth }, index) => {
            const dateStr = formatDate(date);
            const dayType = getDayType(date);
            const dayEvents = getEventsForDate(date);
            const isToday = dateStr === today;
            const config = dayTypeConfig[dayType];
            const isSelected = selectedDate === dateStr;
            const isEditing = editingDate === dateStr;

            return (
              <div
                key={index}
                onClick={() => {
                  setSelectedDate(dateStr);
                  if (!isEditing) {
                    setEditingDate(dateStr);
                    setNewTitle('');
                    setNewType(dayType);
                  }
                }}
                style={{
                  minHeight: 90,
                  padding: 6,
                  borderRadius: 8,
                  border: isSelected ? `2px solid ${config.color}` : isToday ? '2px solid #1890ff' : '1px solid #f0f0f0',
                  background: isCurrentMonth ? isSelected ? `${config.color}08` : isToday ? '#e6f7ff' : '#fff' : '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  opacity: isCurrentMonth ? 1 : 0.4,
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  if (isCurrentMonth && !isSelected) {
                    e.currentTarget.style.borderColor = config.color;
                    e.currentTarget.style.boxShadow = `0 2px 8px ${config.color}20`;
                  }
                }}
                onMouseLeave={e => {
                  if (isCurrentMonth && !isSelected) {
                    e.currentTarget.style.borderColor = isToday ? '#1890ff' : '#f0f0f0';
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
              >
                {/* 日期数字 + 类型标签 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: isToday ? '#1890ff' : isCurrentMonth ? '#333' : '#999' }}>
                    {date.getDate()}
                  </span>
                  {dayType !== 'work' && (
                    <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: `${config.color}15`, color: config.color, fontWeight: 600 }}>
                      {config.label}
                    </span>
                  )}
                </div>

                {/* 已有事件列表 */}
                {dayEvents.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {dayEvents.map(event => (
                      <Tooltip key={event.id} title={event.description} placement="topLeft">
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          fontSize: 10, padding: '1px 4px', borderRadius: 3,
                          background: `${dayTypeConfig[event.type].color}15`,
                          color: dayTypeConfig[event.type].color,
                          marginBottom: 2,
                        }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{event.title}</span>
                          <DeleteOutlined
                            style={{ fontSize: 8, marginLeft: 2, cursor: 'pointer', opacity: 0.6 }}
                            onClick={(e) => { e.stopPropagation(); deleteEvent(event.id); }}
                          />
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                )}

                {/* 内联编辑区域：选中且是当前月时显示 */}
                {isSelected && isCurrentMonth && isEditing && (
                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }} onClick={e => e.stopPropagation()}>
                    <Select
                      size="small"
                      value={newType}
                      onChange={setNewType}
                      style={{ width: '100%' }}
                      popupMatchSelectWidth={false}
                      options={Object.entries(dayTypeConfig).map(([type, cfg]) => ({
                        value: type,
                        label: <span style={{ color: cfg.color }}>● {cfg.label}</span>,
                      }))}
                    />
                    <div style={{ display: 'flex', gap: 2 }}>
                      <Input
                        size="small"
                        placeholder="添加日程..."
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        onPressEnter={() => addEvent(dateStr)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="primary"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => addEvent(dateStr)}
                        disabled={!newTitle.trim()}
                      />
                    </div>
                  </div>
                )}

                {isToday && (
                  <div style={{ position: 'absolute', bottom: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#1890ff' }} />
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default DiffViewer;

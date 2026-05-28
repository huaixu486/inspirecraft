import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Tooltip, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import {
  buildProjectStageSegments,
  timelineStageMeta,
  TimelineStageSegment,
} from '../../utils/timelineStages';

const { Text } = Typography;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
const MIN_SPAN = HOUR;
const MAX_SPAN = 2 * YEAR;
const LEFT_COL = 156;

const pad = (n: number) => String(n).padStart(2, '0');
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toMs = (value?: string) => value ? new Date(value).getTime() : Number.NaN;
const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Tick {
  text: string;
  pct: number;
  major: boolean;
}

const addStep = (date: Date, unit: 'month' | 'day' | 'hour' | 'minute', step: number) => {
  if (unit === 'month') date.setMonth(date.getMonth() + step);
  if (unit === 'day') date.setDate(date.getDate() + step);
  if (unit === 'hour') date.setHours(date.getHours() + step);
  if (unit === 'minute') date.setMinutes(date.getMinutes() + step);
};

const alignStart = (ms: number, unit: 'month' | 'day' | 'hour' | 'minute', step: number) => {
  const d = new Date(ms);
  if (unit === 'month') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - (d.getMonth() % step));
  } else if (unit === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (unit === 'hour') {
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - (d.getHours() % step));
  } else {
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() - (d.getMinutes() % step));
  }
  return d;
};

const buildTicks = (start: number, span: number, width: number): Tick[] => {
  const maxTicks = Math.max(4, Math.floor(width / 76));
  let unit: 'month' | 'day' | 'hour' | 'minute' = 'month';
  let step = 1;

  if (span > 8 * MONTH) {
    unit = 'month';
    step = Math.max(1, Math.ceil((span / MONTH) / maxTicks));
  } else if (span > 45 * DAY) {
    unit = 'day';
    step = 7;
  } else if (span > 10 * DAY) {
    unit = 'day';
    step = Math.max(1, Math.ceil((span / DAY) / maxTicks));
  } else if (span > 2 * DAY) {
    unit = 'hour';
    step = span > 5 * DAY ? 12 : 6;
  } else if (span > 8 * HOUR) {
    unit = 'hour';
    step = Math.max(1, Math.ceil((span / HOUR) / maxTicks));
  } else {
    unit = 'minute';
    step = span > 3 * HOUR ? 30 : span > 90 * MINUTE ? 15 : 5;
  }

  const end = start + span;
  const d = alignStart(start, unit, step);
  const ticks: Tick[] = [];

  while (d.getTime() <= end + DAY && ticks.length < 240) {
    const ms = d.getTime();
    const pct = ((ms - start) / span) * 100;
    if (pct > -2 && pct < 102) {
      const isDayStart = d.getHours() === 0 && d.getMinutes() === 0;
      const isMonthStart = d.getDate() === 1 && isDayStart;
      let text = '';
      let major = false;

      if (unit === 'month') {
        text = `${d.getFullYear()}/${pad(d.getMonth() + 1)}`;
        major = d.getMonth() === 0 || d.getMonth() % 3 === 0;
      } else if (unit === 'day') {
        text = isMonthStart
          ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
          : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
        major = isMonthStart || d.getDay() === 1;
      } else if (unit === 'hour') {
        text = isDayStart
          ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 00:00`
          : `${pad(d.getHours())}:00`;
        major = isDayStart;
      } else {
        text = isDayStart
          ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 00:00`
          : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        major = d.getMinutes() === 0;
      }

      ticks.push({ text, pct, major });
    }
    addStep(d, unit, step);
  }

  return ticks;
};

const barStyle = (start: number, end: number, viewStart: number, span: number) => {
  const clippedStart = clamp(start, viewStart, viewStart + span);
  const clippedEnd = clamp(end, viewStart, viewStart + span);
  return {
    left: `${((clippedStart - viewStart) / span) * 100}%`,
    width: `${Math.max(0, ((clippedEnd - clippedStart) / span) * 100)}%`,
  };
};

const visible = (start: number, end: number, viewStart: number, span: number) =>
  end >= viewStart && start <= viewStart + span;

const GanttChart: React.FC = () => {
  const { projects, versions } = useProjectStore();
  const { projectDocs } = useProjectDocStore();
  const { templates } = useTemplateStore();
  const timeAreaRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ start: Date.now() - MAX_SPAN / 2, span: MAX_SPAN, initialized: false });
  const [now, setNow] = useState(Date.now());
  const [viewportWidth, setViewportWidth] = useState(900);
  const [, bump] = useState(0);

  const segmentsByProject = useMemo(() => {
    const map = new Map<string, TimelineStageSegment[]>();
    for (const project of projects) {
      map.set(
        project.id,
        buildProjectStageSegments(
          project,
          projectDocs.filter(doc => doc.projectId === project.id),
          templates,
          versions.filter(version => version.projectId === project.id),
        ),
      );
    }
    return map;
  }, [projectDocs, projects, templates, versions]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = timeAreaRef.current;
    if (!el) return;
    const update = () => setViewportWidth(Math.max(240, el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const dates = [now];
    for (const project of projects) dates.push(toMs(project.createdAt));
    for (const segments of segmentsByProject.values()) {
      for (const segment of segments) {
        dates.push(toMs(segment.startAt), toMs(segment.deadline), toMs(segment.completedAt), toMs(segment.lastActivityAt));
      }
    }
    const validDates = dates.filter(Number.isFinite);
    const min = validDates.length ? Math.min(...validDates) : now - MONTH;
    const max = validDates.length ? Math.max(...validDates) : now + MONTH;
    const contentSpan = Math.max(8 * DAY, max - min);
    const span = clamp(contentSpan * 1.2, MIN_SPAN, MAX_SPAN);

    if (!viewRef.current.initialized) {
      viewRef.current = {
        start: (min + max) / 2 - span / 2,
        span,
        initialized: true,
      };
      bump(n => n + 1);
    }
  }, [now, projects, segmentsByProject]);

  const view = viewRef.current;
  const ticks = useMemo(() => buildTicks(view.start, view.span, viewportWidth), [view.start, view.span, viewportWidth]);
  const todayPct = ((now - view.start) / view.span) * 100;

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = timeAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    e.preventDefault();
    const mousePct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const current = viewRef.current;
    const anchorTime = current.start + mousePct * current.span;
    const zoomFactor = e.deltaY > 0 ? 1.18 : 0.84;
    const newSpan = clamp(current.span * zoomFactor, MIN_SPAN, MAX_SPAN);
    const newStart = anchorTime - mousePct * newSpan;

    viewRef.current = { ...current, start: newStart, span: newSpan };
    bump(n => n + 1);
  }, []);

  return (
    <Card title="整体计划时间线" bordered={false} style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.09)' }}>
      <div onWheel={onWheel} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${LEFT_COL}px minmax(0, 1fr)`, height: 30 }}>
          <div />
          <div ref={timeAreaRef} style={{ position: 'relative', overflow: 'hidden' }}>
            {ticks.map((tick, index) => (
              <span
                key={`${tick.text}-${index}`}
                style={{
                  position: 'absolute',
                  left: `${tick.pct}%`,
                  transform: 'translateX(-50%)',
                  fontSize: tick.major ? 11 : 10,
                  color: tick.major ? '#555' : '#aaa',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              >
                {tick.text}
              </span>
            ))}
            {todayPct >= 0 && todayPct <= 100 && (
              <span
                style={{
                  position: 'absolute',
                  left: `${todayPct}%`,
                  top: 16,
                  transform: 'translateX(-50%)',
                  background: '#1677ff',
                  color: '#fff',
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                  zIndex: 4,
                  pointerEvents: 'none',
                }}
              >
                {fmtDate(now)}
              </span>
            )}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: LEFT_COL,
              right: 0,
              top: 0,
              bottom: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
            }}
          >
            {ticks.filter(tick => tick.major).map((tick, index) => (
              <div
                key={index}
                style={{
                  position: 'absolute',
                  left: `${tick.pct}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: '#f0f0f0',
                }}
              />
            ))}
            {todayPct >= 0 && todayPct <= 100 && (
              <div style={{ position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0, width: 1.5, background: '#1677ff55', zIndex: 3 }} />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map(project => {
              const segments = segmentsByProject.get(project.id) || [];
              return (
                <div
                  key={project.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `${LEFT_COL}px minmax(0, 1fr)`,
                    minHeight: 48,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0, paddingRight: 12 }}>
                    <Text ellipsis style={{ display: 'block', fontSize: 12 }}>{project.name}</Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {segments.length > 0 ? `${segments.length} 个阶段` : '暂无阶段'}
                    </Text>
                  </div>
                  <div style={{ position: 'relative', height: 40, overflow: 'hidden', minWidth: 0 }}>
                    {segments.map(segment => {
                      const color = timelineStageMeta[segment.stage].color;
                      const start = toMs(segment.startAt);
                      const planEnd = toMs(segment.deadline);
                      const completedEnd = toMs(segment.completedAt);
                      const activityEnd = toMs(segment.lastActivityAt);
                      const actualEnd = Number.isFinite(completedEnd)
                        ? completedEnd
                        : Number.isFinite(activityEnd) ? activityEnd : now;
                      const hasPlan = Number.isFinite(planEnd);
                      const isDone = Boolean(segment.completedAt);
                      const isOverdue = hasPlan && planEnd < now && !isDone;
                      const actualVisible = visible(start, actualEnd, view.start, view.span);
                      const planVisible = hasPlan && visible(start, planEnd, view.start, view.span);

                      return (
                        <React.Fragment key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}>
                          {planVisible && (
                            <Tooltip
                              title={`${segment.label}计划：${fmtDate(start)} → ${fmtDate(planEnd)}${isOverdue ? '（逾期）' : ''}`}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  ...barStyle(start, planEnd, view.start, view.span),
                                  top: 5,
                                  height: 12,
                                  borderRadius: 3,
                                  border: `1px dashed ${isOverdue ? '#ff4d4f' : color}`,
                                  background: isOverdue ? '#fff1f0' : `${color}14`,
                                  zIndex: 1,
                                }}
                              />
                            </Tooltip>
                          )}
                          {actualVisible && (
                            <Tooltip
                              title={`${segment.label}实际：${fmtDate(start)} → ${fmtDate(actualEnd)}${isDone ? '（已完成）' : '（进行中）'}`}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  ...barStyle(start, actualEnd, view.start, view.span),
                                  top: 18,
                                  height: 14,
                                  minWidth: 2,
                                  borderRadius: 3,
                                  background: isOverdue ? '#ff4d4f' : color,
                                  opacity: isDone ? 0.86 : 0.62,
                                  zIndex: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  paddingLeft: 6,
                                  overflow: 'hidden',
                                }}
                              >
                                <Text style={{ fontSize: 9, color: '#fff', whiteSpace: 'nowrap' }}>
                                  {segment.stage}
                                </Text>
                              </div>
                            </Tooltip>
                          )}
                          {isOverdue && (
                            <Tooltip title={`${segment.label}逾期：${fmtDate(planEnd)}`}>
                              <WarningOutlined
                                style={{
                                  position: 'absolute',
                                  left: `${clamp(((planEnd - view.start) / view.span) * 100, 0, 100)}%`,
                                  top: 4,
                                  transform: 'translateX(-50%)',
                                  fontSize: 11,
                                  color: '#ff4d4f',
                                  zIndex: 5,
                                }}
                              />
                            </Tooltip>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {projects.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无项目数据</div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default GanttChart;


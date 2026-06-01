import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Tooltip, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  buildProjectStageSegments,
  timelineStageMeta,
  TimelineStageSegment,
  TimelineStageName,
} from '../../utils/timelineStages';

const { Text } = Typography;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
const MIN_SPAN = HOUR;
const MAX_SPAN = 2 * YEAR;
const PROJECT_COL = 100;
const STAGE_COL = 100;

// 每个阶段使用不同条纹角度，重叠时形成交叉纹理便于区分
const STRIPE_ANGLE: Record<TimelineStageName, number> = {
  '提案': 45,
  '指南编写': -45,
  '可研': 0,
  '其他': 90,
};

const stripeBg = (color: string, angle: number, alpha: string) =>
  `repeating-linear-gradient(${angle}deg, ${color}${alpha} 0, ${color}${alpha} 3px, transparent 3px, transparent 6px)`;

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
  const { workspacePath } = useSettingsStore();
  const timeAreaRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // 隔离滚动 + 缩放：在捕获阶段统一处理，阻止冒泡到主页面
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // 始终阻止冒泡，防止主页面滚动
      e.stopPropagation();
      // 鼠标在时间线区域时触发缩放
      const rect = timeAreaRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && e.clientX >= rect.left) {
        e.preventDefault();
        const mousePct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const current = viewRef.current;
        const anchorTime = current.start + mousePct * current.span;
        const zoomFactor = e.deltaY > 0 ? 1.18 : 0.84;
        const newSpan = clamp(current.span * zoomFactor, MIN_SPAN, MAX_SPAN);
        const newStart = anchorTime - mousePct * newSpan;
        viewRef.current = { ...current, start: newStart, span: newSpan };
        bump(n => n + 1);
      }
      // 名称栏区域：不 preventDefault，允许原生垂直滚动
    };
    el.addEventListener('wheel', handler, { capture: true });
    return () => el.removeEventListener('wheel', handler, { capture: true });
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

  // 计算内容总高度和前3个项目的高度，决定是否需要滚动
  const { totalContentHeight, visibleHeight } = useMemo(() => {
    let total = 0;
    let visible = 0;
    for (let i = 0; i < projects.length; i++) {
      const segs = segmentsByProject.get(projects[i].id) || [];
      const h = segs.length > 0 ? segs.length * 28 + 2 : 32;
      total += h;
      if (i < 3) visible += h;
    }
    return { totalContentHeight: total, visibleHeight: visible };
  }, [projects, segmentsByProject]);
  const needsScroll = totalContentHeight > visibleHeight;

  return (
    <Card title="整体计划时间线" bordered={false} style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.09)' }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${PROJECT_COL + STAGE_COL}px minmax(0, 1fr)`, height: 30 }}>
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

        <div ref={scrollRef} style={{ position: 'relative', ...(needsScroll ? { maxHeight: visibleHeight, overflowY: 'auto' } : {}) }}>
          {/* 网格线随滚动内容一起滚动 */}
          <div
            style={{
              position: 'absolute',
              left: PROJECT_COL + STAGE_COL,
              right: 0,
              top: 0,
              height: totalContentHeight || '100%',
              pointerEvents: 'none',
              overflow: 'hidden',
              zIndex: 0,
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', zIndex: 1 }}>
            {[...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(project => {
              const segments = segmentsByProject.get(project.id) || [];

              if (segments.length === 0) {
                return (
                  <div
                    key={project.id}
                    style={{ display: 'flex' }}
                  >
                    <div style={{
                      width: PROJECT_COL, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'sticky', left: 0, background: '#fff', zIndex: 2,
                    }}>
                      <Text ellipsis strong style={{ fontSize: 11, textAlign: 'center' }}>{project.name}</Text>
                    </div>
                    <div style={{
                      width: STAGE_COL, flexShrink: 0,
                      position: 'sticky', left: PROJECT_COL, background: '#fff', zIndex: 2,
                    }}>
                      <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: '#d9d9d9', flexShrink: 0 }} />
                        <Text type="secondary" ellipsis style={{ fontSize: 10 }}>暂无阶段</Text>
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }} />
                  </div>
                );
              }

              return (
                <div
                  key={project.id}
                  style={{
                    display: 'flex',
                  }}
                >
                  {/* 项目名称：垂直居中跨所有阶段行 */}
                  <div style={{
                    width: PROJECT_COL, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minHeight: segments.length * 28,
                    position: 'sticky', left: 0, background: '#fff', zIndex: 2,
                  }}>
                    <Text ellipsis strong style={{ fontSize: 11, textAlign: 'center' }}>{project.name}</Text>
                  </div>

                  {/* 阶段行 */}
                  <div style={{ width: STAGE_COL, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'sticky', left: PROJECT_COL, background: '#fff', zIndex: 2 }}>
                    {segments.map(segment => {
                      const segColor = timelineStageMeta[segment.stage].color;
                      const segPlanEnd = toMs(segment.deadline);
                      const segDone = Boolean(segment.completedAt);
                      const segHasTime = Number.isFinite(segPlanEnd) && (() => { const d = new Date(segPlanEnd); return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0; })();
                      let segOverdue = false;
                      let segAboutToExpire = false;
                      if (!segDone && Number.isFinite(segPlanEnd)) {
                        if (segHasTime) {
                          segOverdue = segPlanEnd < now;
                          segAboutToExpire = !segOverdue && now >= segPlanEnd - 24 * HOUR;
                        } else {
                          const nowD = new Date();
                          const dlD = new Date(segPlanEnd);
                          const sameDay = nowD.getFullYear() === dlD.getFullYear() && nowD.getMonth() === dlD.getMonth() && nowD.getDate() === dlD.getDate();
                          const dlBeforeToday = (dlD.getFullYear() < nowD.getFullYear())
                            || (dlD.getFullYear() === nowD.getFullYear() && dlD.getMonth() < nowD.getMonth())
                            || (dlD.getFullYear() === nowD.getFullYear() && dlD.getMonth() === nowD.getMonth() && dlD.getDate() < nowD.getDate());
                          segOverdue = dlBeforeToday;
                          segAboutToExpire = !dlBeforeToday && sameDay;
                        }
                      }
                      const dotColor = segOverdue ? '#ff4d4f' : segAboutToExpire ? '#faad14' : segColor;
                      return (
                        <div
                          key={`${project.id}-${segment.stage}`}
                          style={{ height: 28, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8, minWidth: 0 }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: dotColor, flexShrink: 0 }} />
                          <Text type="secondary" ellipsis style={{ fontSize: 10 }}>{segment.label}</Text>
                        </div>
                      );
                    })}
                  </div>

                  {/* 时间线彩条 */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    {segments.map(segment => {
                      const baseColor = timelineStageMeta[segment.stage].color;
                      const start = toMs(segment.startAt);
                      const planEnd = toMs(segment.deadline);
                      const completedEnd = toMs(segment.completedAt);
                      const activityEnd = toMs(segment.lastActivityAt);
                      const actualEnd = Number.isFinite(completedEnd)
                        ? completedEnd
                        : Number.isFinite(activityEnd) ? activityEnd : now;
                      const hasPlan = Number.isFinite(planEnd);
                      const isDone = Boolean(segment.completedAt);
                      const hasTime = hasPlan && (() => { const d = new Date(planEnd); return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0; })();
                      let isOverdue = false;
                      let isAboutToExpire = false;
                      if (hasPlan && !isDone) {
                        if (hasTime) {
                          isOverdue = planEnd < now;
                          isAboutToExpire = !isOverdue && now >= planEnd - 24 * HOUR;
                        } else {
                          const nowD = new Date();
                          const dlD = new Date(planEnd);
                          const sameDay = nowD.getFullYear() === dlD.getFullYear() && nowD.getMonth() === dlD.getMonth() && nowD.getDate() === dlD.getDate();
                          const dlBeforeToday = (dlD.getFullYear() < nowD.getFullYear())
                            || (dlD.getFullYear() === nowD.getFullYear() && dlD.getMonth() < nowD.getMonth())
                            || (dlD.getFullYear() === nowD.getFullYear() && dlD.getMonth() === nowD.getMonth() && dlD.getDate() < nowD.getDate());
                          isOverdue = dlBeforeToday;
                          isAboutToExpire = !dlBeforeToday && sameDay;
                        }
                      }
                      const color = isOverdue ? '#ff4d4f' : isAboutToExpire ? '#faad14' : baseColor;
                      const barEnd = Math.max(actualEnd, hasPlan ? planEnd : actualEnd);
                      const actualVisible = visible(start, actualEnd, view.start, view.span);
                      const planVisible = hasPlan && visible(start, planEnd, view.start, view.span);
                      const stripeAngle = STRIPE_ANGLE[segment.stage];

                      return (
                        <div
                          key={`${project.id}-${segment.stage}-${segment.sourceDocIds.join('-')}`}
                          style={{ position: 'relative', height: 28, overflow: 'visible', minWidth: 0 }}
                        >
                      {/* 统一彩条：虚线边框 = 计划，实心填充 = 实际 */}
                      {(planVisible || actualVisible) && (
                        <Tooltip
                          title={`${segment.label}：${fmtDate(start)} → ${isDone ? fmtDate(actualEnd) + '（已完成）' : isOverdue ? fmtDate(now) + '（逾期）' : fmtDate(actualEnd) + '（进行中）'}${hasPlan ? ` | 计划截止 ${fmtDate(planEnd)}` : ''}`}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              ...barStyle(start, barEnd, view.start, view.span),
                              top: 4,
                              height: 16,
                              borderRadius: 3,
                              border: `1.5px dashed ${color}`,
                              overflow: 'visible',
                              zIndex: 1,
                            }}
                          >
                            {/* 实际进度填充 */}
                            <div
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${Math.max(0, ((Math.min(actualEnd, barEnd) - start) / (barEnd - start)) * 100)}%`,
                                background: stripeBg(color, stripeAngle, '80'),
                                borderRadius: 3,
                              }}
                            />
                            {/* 逾期三角在截止时间线，放在彩条内部 */}
                            {isOverdue && (
                              <WarningOutlined
                                style={{
                                  position: 'absolute',
                                  left: `${clamp(((planEnd - start) / (barEnd - start)) * 100, 0, 100)}%`,
                                  top: 0,
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  transform: 'translateX(-50%)',
                                  fontSize: 11,
                                  color: '#ff4d4f',
                                  zIndex: 3,
                                  pointerEvents: 'none',
                                }}
                              />
                            )}
                          </div>
                        </Tooltip>
                      )}
                    </div>
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


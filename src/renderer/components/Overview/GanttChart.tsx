import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card, Modal, Tooltip, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  checkDeadlineStatus,
  getAllStages,
  getStageMeta,
  TimelineStageSegment,
} from '../../utils/timelineStages';
import type { StageConfig } from '../../utils/timelineStages';
import { useSegmentsByProject } from './SegmentsContext';

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

const COMPACT_GANTT_HEIGHT = 315;
const EXPANDED_GANTT_HEIGHT = 620;

// ── 工具函数 ──────────────────────────────────────────────────

const getStripeAngle = (rowIndex: number, columnIndex: number): number =>
  (rowIndex + columnIndex) % 2 === 0 ? -45 : 45;

const stripeBg = (color: string, angle: number, alpha: string) =>
  `repeating-linear-gradient(${angle}deg, ${color}${alpha} 0, ${color}${alpha} 3px, transparent 3px, transparent 6px)`;

const pad = (n: number) => String(n).padStart(2, '0');
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toMs = (value?: string) => value ? new Date(value).getTime() : Number.NaN;
const getProjectSortMs = (project: { folderModifiedAt?: string; updatedAt?: string; createdAt?: string }) => {
  const ms = toMs(project.folderModifiedAt || project.updatedAt || project.createdAt);
  return Number.isFinite(ms) ? ms : 0;
};
const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Tick { text: string; pct: number; major: boolean }

const addStep = (date: Date, unit: 'month' | 'day' | 'hour' | 'minute', step: number) => {
  if (unit === 'month') date.setMonth(date.getMonth() + step);
  if (unit === 'day') date.setDate(date.getDate() + step);
  if (unit === 'hour') date.setHours(date.getHours() + step);
  if (unit === 'minute') date.setMinutes(date.getMinutes() + step);
};

const alignStart = (ms: number, unit: 'month' | 'day' | 'hour' | 'minute', step: number) => {
  const d = new Date(ms);
  if (unit === 'month') {
    d.setDate(1); d.setHours(0, 0, 0, 0);
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
  if (span > 8 * MONTH) { unit = 'month'; step = Math.max(1, Math.ceil((span / MONTH) / maxTicks)); }
  else if (span > 45 * DAY) { unit = 'day'; step = 7; }
  else if (span > 10 * DAY) { unit = 'day'; step = Math.max(1, Math.ceil((span / DAY) / maxTicks)); }
  else if (span > 2 * DAY) { unit = 'hour'; step = span > 5 * DAY ? 12 : 6; }
  else if (span > 8 * HOUR) { unit = 'hour'; step = Math.max(1, Math.ceil((span / HOUR) / maxTicks)); }
  else { unit = 'minute'; step = span > 3 * HOUR ? 30 : span > 90 * MINUTE ? 15 : 5; }
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
        text = `${d.getFullYear()}/${pad(d.getMonth() + 1)}`; major = d.getMonth() === 0 || d.getMonth() % 3 === 0;
      } else if (unit === 'day') {
        text = isMonthStart ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; major = isMonthStart || d.getDay() === 1;
      } else if (unit === 'hour') {
        text = isDayStart ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 00:00` : `${pad(d.getHours())}:00`; major = isDayStart;
      } else {
        text = isDayStart ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 00:00` : `${pad(d.getHours())}:${pad(d.getMinutes())}`; major = d.getMinutes() === 0;
      }
      ticks.push({ text, pct, major });
    }
    addStep(d, unit, step);
  }
  return ticks;
};

const getClippedRange = (start: number, end: number, viewStart: number, span: number) => {
  const viewEnd = viewStart + span;
  return { start: clamp(start, viewStart, viewEnd), end: clamp(end, viewStart, viewEnd) };
};

const timeToPct = (time: number, viewStart: number, span: number) => ((time - viewStart) / span) * 100;

const barStyle = (start: number, end: number, viewStart: number, span: number) => {
  const clipped = getClippedRange(start, end, viewStart, span);
  const left = timeToPct(clipped.start, viewStart, span);
  const right = timeToPct(clipped.end, viewStart, span);
  return { left: `${left}%`, width: `${Math.max(0, right - left)}%` };
};

const barTimePointStyle = (start: number, end: number, point: number) => {
  if (end <= start) return '0%';
  return `${clamp(((point - start) / (end - start)) * 100, 0, 100)}%`;
};

const capActualEnd = (start: number, rawEnd: number, now: number) => {
  if (start > now) return start;
  return clamp(Number.isFinite(rawEnd) ? rawEnd : now, start, now);
};

const visible = (start: number, end: number, viewStart: number, span: number) =>
  end >= viewStart && start <= viewStart + span;

const safeAutoFitDate = (value: number, now: number) => {
  if (!Number.isFinite(value)) return Number.NaN;
  const min = now - 2 * YEAR; const max = now + 180 * DAY;
  return value >= min && value <= max ? value : Number.NaN;
};

// ── 可复用时间线视图 ──────────────────────────────────────────

interface GanttTimelineViewProps {
  height: number;
  compact?: boolean;
  onDraggingChange?: (dragging: boolean) => void;
}

const GanttTimelineView: React.FC<GanttTimelineViewProps> = ({ height, compact = false, onDraggingChange }) => {
  const projects = useProjectStore(s => s.projects);
  const customStages = useSettingsStore(s => s.customStages);
  const allStages: StageConfig[] = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);
  const segmentsByProject = useSegmentsByProject();

  const timeAreaRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 每个实例独立的 view 状态，互不干扰
  const [view, setView] = useState<{ start: number; span: number }>({ start: Date.now() - MAX_SPAN / 2, span: MAX_SPAN });
  const viewRef = useRef(view);
  viewRef.current = view;
  const viewInitializedRef = useRef(false);
  const pendingViewRef = useRef<{ start: number; span: number } | null>(null);
  const rafRef = useRef(0);
  const flushPendingView = useCallback(() => {
    if (pendingViewRef.current) { setView(pendingViewRef.current); pendingViewRef.current = null; }
    rafRef.current = 0;
  }, []);
  const scheduleViewUpdate = useCallback((updater: (prev: { start: number; span: number }) => { start: number; span: number }) => {
    const prev = pendingViewRef.current ?? viewRef.current;
    pendingViewRef.current = updater(prev);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushPendingView);
  }, [flushPendingView]);
  const panRef = useRef({ active: false, dragging: false, pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, baseStart: 0, baseSpan: 0, plotWidth: 0 });
  const [now, setNow] = useState(Date.now());
  const [viewportWidth, setViewportWidth] = useState(900);
  const resizeRafRef = useRef(0);
  const [isPanning, setIsPanning] = useState(false);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => getProjectSortMs(b) - getProjectSortMs(a)),
    [projects],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => { window.clearInterval(timer); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const updateViewportWidth = useCallback((force = false) => {
    const apply = () => {
      const bodyWidth = scrollRef.current?.clientWidth || 0;
      const headerWidth = timeAreaRef.current?.getBoundingClientRect().width || 0;
      const measured = bodyWidth > PROJECT_COL + STAGE_COL ? bodyWidth - PROJECT_COL - STAGE_COL : headerWidth;
      const nextWidth = Math.max(240, Math.floor(measured || 900));
      setViewportWidth(prev => prev === nextWidth ? prev : nextWidth);
    };
    if (force) {
      if (resizeRafRef.current) { cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = 0; }
      apply(); return;
    }
    if (resizeRafRef.current) return;
    resizeRafRef.current = requestAnimationFrame(() => { resizeRafRef.current = 0; apply(); });
  }, []);

  useLayoutEffect(() => {
    updateViewportWidth(true);
    const observer = new ResizeObserver(() => updateViewportWidth());
    if (timeAreaRef.current) observer.observe(timeAreaRef.current);
    if (scrollRef.current) observer.observe(scrollRef.current);
    const handleWindowResize = () => updateViewportWidth(true);
    window.addEventListener('resize', handleWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeRafRef.current) { cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = 0; }
    };
  }, [updateViewportWidth]);

  // 滚轮缩放
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.stopPropagation();
      const scrollRect = el.getBoundingClientRect();
      const plotLeft = scrollRect.left + PROJECT_COL + STAGE_COL;
      const plotWidth = Math.max(240, scrollRect.width - PROJECT_COL - STAGE_COL);
      const inPlot = e.clientX >= plotLeft && e.clientX <= plotLeft + plotWidth;
      if (!inPlot) return;
      e.preventDefault();
      const mousePct = clamp((e.clientX - plotLeft) / plotWidth, 0, 1);
      scheduleViewUpdate(current => {
        const anchorTime = current.start + mousePct * current.span;
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.91;
        const newSpan = clamp(current.span * zoomFactor, MIN_SPAN, MAX_SPAN);
        const newStart = anchorTime - mousePct * newSpan;
        return { start: newStart, span: newSpan };
      });
    };
    el.addEventListener('wheel', handler, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', handler, { capture: true });
  }, [scheduleViewUpdate]);

  // 拖动平移
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stopPan = (e?: PointerEvent) => {
      const pan = panRef.current;
      if (!pan.active) return;
      if (e && pan.pointerId === e.pointerId) { try { el.releasePointerCapture(e.pointerId); } catch {} }
      if (pan.dragging) {
        const totalDx = pan.lastX - pan.startX;
        if (Math.abs(totalDx) >= 0.5 && pan.plotWidth > 0) {
          setView({ start: pan.baseStart - (totalDx / pan.plotWidth) * pan.baseSpan, span: pan.baseSpan });
        }
        el.style.removeProperty('--gantt-pan-x');
        timeAreaRef.current?.style.removeProperty('--gantt-pan-x');
        onDraggingChange?.(false);
      }
      panRef.current = { active: false, dragging: false, pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, baseStart: 0, baseSpan: 0, plotWidth: 0 };
      setIsPanning(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const scrollRect = el.getBoundingClientRect();
      const plotLeft = scrollRect.left + PROJECT_COL + STAGE_COL;
      const plotWidth = Math.max(240, scrollRect.width - PROJECT_COL - STAGE_COL);
      if (e.clientX < plotLeft || e.clientX > plotLeft + plotWidth) return;
      panRef.current = { active: true, dragging: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, baseStart: viewRef.current.start, baseSpan: viewRef.current.span, plotWidth };
      try { el.setPointerCapture(e.pointerId); } catch {}
    };

    const onPointerMove = (e: PointerEvent) => {
      const pan = panRef.current;
      if (!pan.active || pan.pointerId !== e.pointerId) return;
      const scrollRect = el.getBoundingClientRect();
      const plotWidth = Math.max(240, scrollRect.width - PROJECT_COL - STAGE_COL);
      if (plotWidth <= 0) return;
      const totalDx = e.clientX - pan.startX;
      const totalDy = e.clientY - pan.startY;
      if (!pan.dragging && Math.hypot(totalDx, totalDy) < 4) return;
      if (!pan.dragging) {
        panRef.current = { ...pan, dragging: true };
        setIsPanning(true);
        onDraggingChange?.(true);
      }
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      if (Math.abs(dx) >= 0.5) {
        el.style.setProperty('--gantt-pan-x', `${totalDx}px`);
        timeAreaRef.current?.style.setProperty('--gantt-pan-x', `${totalDx}px`);
      }
      if (Math.abs(dy) >= 0.5) el.scrollTop = Math.max(0, el.scrollTop - dy);
      panRef.current = { ...panRef.current, lastX: e.clientX, lastY: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => stopPan(e);
    const onPointerCancel = (e: PointerEvent) => stopPan(e);
    el.addEventListener('pointerdown', onPointerDown, { capture: true });
    el.addEventListener('pointermove', onPointerMove, { capture: true });
    el.addEventListener('pointerup', onPointerUp, { capture: true });
    el.addEventListener('pointercancel', onPointerCancel, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, { capture: true });
      el.removeEventListener('pointermove', onPointerMove, { capture: true });
      el.removeEventListener('pointerup', onPointerUp, { capture: true });
      el.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    };
  }, [onDraggingChange, scheduleViewUpdate]);

  // 自动适配视图
  const autoFitView = useMemo(() => {
    const dates = [now];
    for (const project of projects) dates.push(safeAutoFitDate(toMs(project.createdAt), now));
    for (const segments of segmentsByProject.values()) {
      for (const segment of segments) {
        dates.push(safeAutoFitDate(toMs(segment.startAt), now), safeAutoFitDate(toMs(segment.deadline), now));
      }
    }
    const validDates = dates.filter(Number.isFinite);
    const min = validDates.length ? Math.min(...validDates) : now - MONTH;
    const max = validDates.length ? Math.max(...validDates) : now + MONTH;
    const contentSpan = Math.max(8 * DAY, max - min);
    const span = clamp(contentSpan * 1.2, MIN_SPAN, MAX_SPAN);
    return { start: (min + max) / 2 - span / 2, span };
  }, [now, projects, segmentsByProject]);

  const [viewReady, setViewReady] = useState(false);
  useEffect(() => {
    if (!viewInitializedRef.current && projects.length > 0) {
      viewInitializedRef.current = true;
      setView(autoFitView);
      setViewReady(true);
    }
  }, [projects.length > 0, autoFitView]);

  const ticks = useMemo(() => buildTicks(view.start, view.span, viewportWidth), [view.start, view.span, viewportWidth]);
  const todayPct = timeToPct(now, view.start, view.span);
  const todayVisible = todayPct >= 0 && todayPct <= 100;

  const totalContentHeight = useMemo(() => {
    let total = 0;
    for (const project of sortedProjects) {
      const segs = segmentsByProject.get(project.id) || [];
      total += segs.length > 0 ? segs.length * 28 + 2 : 32;
    }
    return total;
  }, [sortedProjects, segmentsByProject]);

  return (
    <>
      {/* 时间头 */}
      <div style={{ display: 'grid', gridTemplateColumns: `${PROJECT_COL + STAGE_COL}px minmax(0, 1fr)`, height: 30, overflow: 'hidden' }}>
        <div />
        <div ref={timeAreaRef} className={`gantt-time-header${isPanning ? ' gantt-panning' : ''}`} style={{ position: 'relative', overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab' }}>
          <div className="gantt-time-layer" style={{ position: 'absolute', inset: 0 }}>
            {ticks.map((tick, index) => (
              <span key={`${tick.text}-${index}`} style={{ position: 'absolute', left: `${tick.pct}%`, transform: 'translateX(-50%)', fontSize: tick.major ? 11 : 10, color: tick.major ? '#555' : '#aaa', whiteSpace: 'nowrap', userSelect: 'none', pointerEvents: 'none' }}>
                {tick.text}
              </span>
            ))}
            {todayVisible && (
              <span style={{ position: 'absolute', left: `${todayPct}%`, top: 16, transform: 'translateX(-50%)', background: '#1677ff', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 2, whiteSpace: 'nowrap', zIndex: 4, pointerEvents: 'none' }}>
                {fmtDate(now)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 滚动区域 */}
      <div className={`gantt-scroll-area${isPanning ? ' gantt-panning' : ''}`} ref={scrollRef} style={{ height, position: 'relative', overflowX: 'hidden', overflowY: compact ? 'hidden' : 'auto', userSelect: isPanning ? 'none' : undefined, cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}>
        {/* 网格线 */}
        <div className="gantt-time-layer" style={{ position: 'absolute', left: PROJECT_COL + STAGE_COL, right: 0, top: 0, height: totalContentHeight || '100%', pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
          {ticks.filter(tick => tick.major).map((tick, index) => (
            <div key={index} style={{ position: 'absolute', left: `${tick.pct}%`, top: 0, bottom: 0, width: 1, background: '#edf2f7' }} />
          ))}
        </div>

        {/* 当前时间线 */}
        {todayVisible && (
          <div className="gantt-time-layer" style={{ position: 'absolute', left: PROJECT_COL + STAGE_COL, right: 0, top: 0, height: totalContentHeight || '100%', zIndex: 6, pointerEvents: 'none' }}>
            <div className="gantt-now-marker" style={{ position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0, width: 1.5, background: '#1677ff66' }} />
          </div>
        )}

        {/* 项目行 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', zIndex: 1, opacity: viewReady ? 1 : 0, transition: 'opacity 0.15s' }}>
          {sortedProjects.map((project, projectIndex) => {
            const segments = segmentsByProject.get(project.id) || [];
            if (segments.length === 0) {
              return (
                <div key={project.id} className="gantt-project-row" style={{ display: 'flex' }}>
                  <div className="gantt-project-cell" style={{ width: PROJECT_COL, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'sticky', left: 0, background: '#fff', zIndex: 2 }}>
                    <Text ellipsis strong style={{ fontSize: 11, textAlign: 'center' }}>{project.name}</Text>
                  </div>
                  <div className="gantt-stage-cell" style={{ width: STAGE_COL, flexShrink: 0, position: 'sticky', left: PROJECT_COL, background: '#fff', zIndex: 2 }}>
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
              <div key={project.id} className="gantt-project-row" style={{ display: 'flex' }}>
                <div className="gantt-project-cell" style={{ width: PROJECT_COL, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: segments.length * 28, position: 'sticky', left: 0, background: '#fff', zIndex: 2 }}>
                  <Text ellipsis strong style={{ fontSize: 11, textAlign: 'center' }}>{project.name}</Text>
                </div>
                <div className="gantt-stage-cell" style={{ width: STAGE_COL, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'sticky', left: PROJECT_COL, background: '#fff', zIndex: 2 }}>
                  {segments.map((segment) => {
                    const segColor = stageMeta[segment.stage].color;
                    const segDone = Boolean(segment.completedAt);
                    const dlStatus = segDone ? 'normal' : checkDeadlineStatus(segment.deadline, now);
                    const dotColor = dlStatus === 'overdue' ? '#ff4d4f' : dlStatus === 'aboutToExpire' ? '#faad14' : segColor;
                    return (
                      <div key={`${project.id}-${segment.stage}`} style={{ height: 28, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8, minWidth: 0 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: dotColor, flexShrink: 0 }} />
                        <Text type="secondary" ellipsis style={{ fontSize: 10 }}>{segment.label}</Text>
                      </div>
                    );
                  })}
                </div>
                <div className="gantt-time-layer" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, cursor: isPanning ? 'grabbing' : 'grab' }}>
                  {segments.map((segment, segmentIndex) => {
                    const baseColor = stageMeta[segment.stage].color;
                    const start = toMs(segment.startAt);
                    const planEnd = toMs(segment.deadline);
                    const completedEnd = toMs(segment.completedAt);
                    const activityEnd = toMs(segment.lastActivityAt);
                    const isDone = Boolean(segment.completedAt);
                    const rawActualEnd = Number.isFinite(completedEnd) ? completedEnd : Number.isFinite(activityEnd) ? activityEnd : now;
                    const actualEnd = capActualEnd(start, rawActualEnd, now);
                    const hasPlan = Number.isFinite(planEnd);
                    const dlStatus = (hasPlan && !isDone) ? checkDeadlineStatus(segment.deadline, now) : 'normal';
                    const color = dlStatus === 'overdue' ? '#ff4d4f' : dlStatus === 'aboutToExpire' ? '#faad14' : baseColor;
                    const actualBarEnd = Math.max(start, actualEnd);
                    const actualVisible = visible(start, actualBarEnd, view.start, view.span);
                    const stripeAngle = getStripeAngle(projectIndex, segmentIndex);
                    const barRect = barStyle(start, actualBarEnd, view.start, view.span);
                    return (
                      <div key={`${project.id}-${segment.stage}-${segment.sourceDocIds.join('-')}`} style={{ position: 'relative', height: 28, overflow: 'visible', minWidth: 0 }}>
                        {actualVisible && (
                          <Tooltip overlayStyle={{ pointerEvents: 'none' }} title={`${segment.label}：${fmtDate(start)} → ${fmtDate(actualEnd)}${isDone ? '（已完成）' : dlStatus === 'overdue' ? '（逾期）' : '（进行中）'}${hasPlan ? ` | 计划截止 ${fmtDate(planEnd)}` : ''}`}>
                            <div className="gantt-bar" style={{ position: 'absolute', ...barRect, top: 4, height: 16, borderRadius: 3, border: `1.5px dashed ${color}`, boxSizing: 'border-box', background: stripeBg(color, stripeAngle, '80'), overflow: 'hidden', zIndex: 3, animationDelay: `${Math.min(projectIndex * 80 + segmentIndex * 40, 400)}ms` }}>
                              {hasPlan && dlStatus === 'overdue' && planEnd <= actualBarEnd && actualBarEnd > start && (
                                <WarningOutlined style={{ position: 'absolute', left: barTimePointStyle(start, actualBarEnd, planEnd), top: 0, height: '100%', display: 'flex', alignItems: 'center', transform: 'translateX(-50%)', fontSize: 11, color: '#ff4d4f', zIndex: 4, pointerEvents: 'none' }} />
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
    </>
  );
};

// ── 主组件：紧凑卡片 + 弹窗 ──────────────────────────────────

interface GanttChartProps {
  isActive?: boolean;
  layoutTransitioning?: boolean;
}

const GanttChart: React.FC<GanttChartProps> = ({ isActive, layoutTransitioning = false }) => {
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const suppressOpenRef = useRef(false);

  const handleCompactClick = useCallback(() => {
    if (!suppressOpenRef.current) setTimelineModalOpen(true);
    suppressOpenRef.current = false;
  }, []);

  const handleDraggingChange = useCallback((dragging: boolean) => {
    if (dragging) suppressOpenRef.current = true;
  }, []);

  return (
    <>
      <Card className="dashboard-card gantt-card animate-slide-up stagger-3" title="整体计划时间线" bordered={false}>
        <div className="gantt-compact-trigger" onClick={handleCompactClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCompactClick(); } }}>
          <GanttTimelineView height={COMPACT_GANTT_HEIGHT} compact onDraggingChange={handleDraggingChange} />
        </div>
      </Card>

      <Modal
        open={timelineModalOpen}
        onCancel={() => setTimelineModalOpen(false)}
        footer={null}
        centered
        destroyOnClose={false}
        width="min(1440px, calc(100vw - 72px))"
        className="gantt-timeline-modal"
        styles={{ mask: { background: 'rgba(15, 23, 42, 0.28)', backdropFilter: 'blur(8px) saturate(0.9)' } }}
        title="全部项目时间线"
      >
        <GanttTimelineView height={EXPANDED_GANTT_HEIGHT} />
      </Modal>
    </>
  );
};

export default GanttChart;

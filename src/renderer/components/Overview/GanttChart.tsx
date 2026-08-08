import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Button, Card, Typography } from 'antd';
import { CloseOutlined, WarningOutlined } from '@ant-design/icons';
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
const OVERLAY_MOTION_MS = 300;
const OVERLAY_SETTLE_FALLBACK_MS = OVERLAY_MOTION_MS + 140;

interface TimelineOverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

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
  const panFrameRef = useRef(0);
  const longPressTimerRef = useRef(0);
  const flushPendingView = useCallback(() => {
    if (pendingViewRef.current) {
      const nextView = pendingViewRef.current;
      pendingViewRef.current = null;
      // A zoom can change many bars.  Keep it interruptible so native scroll,
      // drag and modal controls stay responsive even with a large project list.
      startTransition(() => setView(nextView));
    }
    rafRef.current = 0;
  }, []);
  const scheduleViewUpdate = useCallback((updater: (prev: { start: number; span: number }) => { start: number; span: number }) => {
    const prev = pendingViewRef.current ?? viewRef.current;
    pendingViewRef.current = updater(prev);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushPendingView);
  }, [flushPendingView]);
  const panRef = useRef({ active: false, dragging: false, pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, baseStart: 0, baseSpan: 0, plotWidth: 0, previewX: 0, pendingScrollTop: -1 });
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
    return () => {
      window.clearInterval(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current);
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const updateViewportWidth = useCallback((force = false) => {
    const apply = () => {
      const bodyWidth = scrollRef.current?.clientWidth || 0;
      const headerWidth = timeAreaRef.current?.getBoundingClientRect().width || 0;
      // The body owns a native vertical scrollbar. Chromium may repaint or
      // slightly alter that scrollbar's client box as the pointer approaches
      // it, so it must not be the primary width source for the timeline. The
      // header has no scrollbar and represents the plot width directly.
      const measured = headerWidth || (bodyWidth > PROJECT_COL + STAGE_COL ? bodyWidth - PROJECT_COL - STAGE_COL : 0);
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
    const observedWidths = new WeakMap<Element, number>();
    const observer = new ResizeObserver(entries => {
      const widthChanged = entries.some(entry => {
        const width = Math.round(entry.contentRect.width);
        const previous = observedWidths.get(entry.target);
        observedWidths.set(entry.target, width);
        return previous === undefined || previous !== width;
      });
      if (widthChanged) updateViewportWidth();
    });
    if (timeAreaRef.current) observer.observe(timeAreaRef.current);
    const handleWindowResize = () => updateViewportWidth(true);
    window.addEventListener('resize', handleWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (resizeRafRef.current) { cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = 0; }
    };
  }, [updateViewportWidth]);

  // 仅 Ctrl + 滚轮缩放。展开视图的普通滚轮必须保留给原生纵向滚动，
  // 紧凑视图也不会再因误触滚轮改变时间尺度。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const scrollRect = el.getBoundingClientRect();
      const plotLeft = scrollRect.left + PROJECT_COL + STAGE_COL;
      const plotWidth = Math.max(240, scrollRect.width - PROJECT_COL - STAGE_COL);
      const inPlot = e.clientX >= plotLeft && e.clientX <= plotLeft + plotWidth;
      if (!inPlot) return;
      if (!e.ctrlKey) return;
      e.stopPropagation();
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
  }, [compact, scheduleViewUpdate]);

  // 拖动平移
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const clearLongPress = () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = 0;
      }
    };
    const flushPanPreview = () => {
      const pan = panRef.current;
      panFrameRef.current = 0;
      if (!pan.active) return;
      el.style.setProperty('--gantt-pan-x', `${pan.previewX}px`);
      timeAreaRef.current?.style.setProperty('--gantt-pan-x', `${pan.previewX}px`);
      if (pan.pendingScrollTop >= 0) {
        el.scrollTop = pan.pendingScrollTop;
        panRef.current = { ...pan, pendingScrollTop: -1 };
      }
    };
    const schedulePanPreview = () => {
      if (!panFrameRef.current) panFrameRef.current = requestAnimationFrame(flushPanPreview);
    };
    const stopPan = (e?: PointerEvent) => {
      const pan = panRef.current;
      if (!pan.active) return;
      panRef.current = { ...pan, active: false };
      if (e && pan.pointerId === e.pointerId) { try { el.releasePointerCapture(e.pointerId); } catch {} }
      if (panFrameRef.current) {
        flushPanPreview();
        if (pan.pendingScrollTop >= 0) el.scrollTop = pan.pendingScrollTop;
      }
      if (pan.dragging) {
        const totalDx = pan.lastX - pan.startX;
        if (Math.abs(totalDx) >= 0.5 && pan.plotWidth > 0) {
          setView({ start: pan.baseStart - (totalDx / pan.plotWidth) * pan.baseSpan, span: pan.baseSpan });
        }
        el.style.removeProperty('--gantt-pan-x');
        timeAreaRef.current?.style.removeProperty('--gantt-pan-x');
        onDraggingChange?.(false);
      }
      clearLongPress();
      panRef.current = { active: false, dragging: false, pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, baseStart: 0, baseSpan: 0, plotWidth: 0, previewX: 0, pendingScrollTop: -1 };
      setIsPanning(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const scrollRect = el.getBoundingClientRect();
      const plotLeft = scrollRect.left + PROJECT_COL + STAGE_COL;
      const plotWidth = Math.max(240, scrollRect.width - PROJECT_COL - STAGE_COL);
      if (e.clientX < plotLeft || e.clientX > plotLeft + plotWidth) return;
      panRef.current = { active: true, dragging: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, baseStart: viewRef.current.start, baseSpan: viewRef.current.span, plotWidth, previewX: 0, pendingScrollTop: -1 };
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (compact) {
        longPressTimerRef.current = window.setTimeout(() => {
          const current = panRef.current;
          if (!current.active || current.pointerId !== e.pointerId || current.dragging) return;
          // A long press is a dedicated compact-card panning gesture.  Mark it
          // as a drag before the first move so pointer-up can never fall
          // through to the card's click-to-expand handler.
          current.dragging = true;
          longPressTimerRef.current = 0;
          setIsPanning(true);
          onDraggingChange?.(true);
        }, 360);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const pan = panRef.current;
      if (!pan.active || pan.pointerId !== e.pointerId) return;
      // Pointer capture can occasionally survive a window/layout transition.
      // Never pan when the primary button is no longer physically pressed.
      if ((e.buttons & 1) === 0) {
        stopPan(e);
        return;
      }
      const plotWidth = pan.plotWidth;
      if (plotWidth <= 0) return;
      const totalDx = e.clientX - pan.startX;
      const totalDy = e.clientY - pan.startY;
      if (!pan.dragging && Math.hypot(totalDx, totalDy) < 4) return;
      // The compact card only pans after a hold.  A pointer movement before
      // the threshold cancels both gestures: it must not accidentally open
      // the expanded timeline when the pointer is released.
      if (compact && !pan.dragging) {
        clearLongPress();
        pan.active = false;
        onDraggingChange?.(true);
        return;
      }
      if (!pan.dragging) {
        clearLongPress();
        pan.dragging = true;
        setIsPanning(true);
        onDraggingChange?.(true);
      }
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      if (Math.abs(dx) >= 0.5) {
        pan.previewX = totalDx;
      }
      if (Math.abs(dy) >= 0.5) {
        const baseScrollTop = pan.pendingScrollTop >= 0 ? pan.pendingScrollTop : el.scrollTop;
        pan.pendingScrollTop = Math.max(0, baseScrollTop - dy);
      }
      pan.lastX = e.clientX;
      pan.lastY = e.clientY;
      schedulePanPreview();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (panRef.current.dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
      stopPan(e);
    };
    const onPointerCancel = (e: PointerEvent) => stopPan(e);
    const onLostPointerCapture = (e: PointerEvent) => stopPan(e);
    const onWindowBlur = () => stopPan();
    el.addEventListener('pointerdown', onPointerDown, { capture: true });
    el.addEventListener('pointermove', onPointerMove, { capture: true });
    el.addEventListener('pointerup', onPointerUp, { capture: true });
    el.addEventListener('pointercancel', onPointerCancel, { capture: true });
    el.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, { capture: true });
      el.removeEventListener('pointermove', onPointerMove, { capture: true });
      el.removeEventListener('pointerup', onPointerUp, { capture: true });
      el.removeEventListener('pointercancel', onPointerCancel, { capture: true });
      el.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('blur', onWindowBlur);
      clearLongPress();
      if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current);
    };
  }, [compact, onDraggingChange, scheduleViewUpdate]);

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
      <div className={`gantt-scroll-area${isPanning ? ' gantt-panning' : ''}`} ref={scrollRef} style={{ height, position: 'relative', overflowX: 'hidden', overflowY: compact ? 'hidden' : 'scroll', userSelect: isPanning ? 'none' : undefined, cursor: isPanning ? 'grabbing' : 'grab', touchAction: isPanning ? 'none' : 'pan-y' }}>
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
                          <div
                            className="gantt-bar"
                            title={`${segment.label}：${fmtDate(start)} → ${fmtDate(actualEnd)}${isDone ? '（已完成）' : dlStatus === 'overdue' ? '（逾期）' : '（进行中）'}${hasPlan ? ` | 计划截止 ${fmtDate(planEnd)}` : ''}`}
                            style={{ position: 'absolute', ...barRect, top: 4, height: 16, borderRadius: 3, border: `1.5px dashed ${color}`, boxSizing: 'border-box', background: stripeBg(color, stripeAngle, '80'), overflow: 'hidden', zIndex: 3, animationDelay: `${Math.min(projectIndex * 80 + segmentIndex * 40, 400)}ms` }}
                          >
                            {hasPlan && dlStatus === 'overdue' && planEnd <= actualBarEnd && actualBarEnd > start && (
                              <WarningOutlined style={{ position: 'absolute', left: barTimePointStyle(start, actualBarEnd, planEnd), top: 0, height: '100%', display: 'flex', alignItems: 'center', transform: 'translateX(-50%)', fontSize: 11, color: '#ff4d4f', zIndex: 4, pointerEvents: 'none' }} />
                            )}
                          </div>
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
  const compactCardRef = useRef<HTMLDivElement>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayMotionReady, setOverlayMotionReady] = useState(false);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [overlayClosing, setOverlayClosing] = useState(false);
  const [expandedContentVisible, setExpandedContentVisible] = useState(false);
  const [targetRect, setTargetRect] = useState<TimelineOverlayRect | null>(null);
  const suppressOpenRef = useRef(false);
  const overlayFrameRef = useRef(0);
  const overlaySettleTimerRef = useRef(0);
  const overlayResizeFrameRef = useRef(0);
  const overlayResizeTimerRef = useRef(0);
  const overlayClosingRef = useRef(false);

  const getTargetRect = useCallback((origin: TimelineOverlayRect): TimelineOverlayRect => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const viewportPadding = viewportWidth <= 720 ? 12 : 24;
    // Keep equal spacing on both sides. The shell remains fixed at this size
    // during motion so the chart does not remeasure on every animation frame.
    const targetWidth = Math.max(280, viewportWidth - viewportPadding * 2);
    const targetHeight = Math.max(
      Math.min(origin.height, viewportHeight - viewportPadding * 2),
      Math.min(760, viewportHeight - viewportPadding * 2),
    );
    return {
      top: Math.max(viewportPadding, Math.round((viewportHeight - targetHeight) / 2)),
      left: Math.max(viewportPadding, Math.round((viewportWidth - targetWidth) / 2)),
      width: targetWidth,
      height: targetHeight,
    };
  }, []);

  const handleCompactClick = useCallback(() => {
    if (!layoutTransitioning && !suppressOpenRef.current && compactCardRef.current) {
      const rect = compactCardRef.current.getBoundingClientRect();
      const nextOrigin = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      overlayClosingRef.current = false;
      flushSync(() => {
        setOverlayClosing(false);
        setTargetRect(getTargetRect(nextOrigin));
        // Lay out the full chart before motion starts. The shell is clipped to
        // the compact card at this point, so this work cannot interrupt the
        // compositor-only expand animation.
        setExpandedContentVisible(true);
        setOverlayMotionReady(false);
        setOverlayExpanded(false);
        setOverlayVisible(true);
      });
      overlayFrameRef.current = requestAnimationFrame(() => {
        setOverlayMotionReady(true);
        overlayFrameRef.current = requestAnimationFrame(() => {
          overlayFrameRef.current = 0;
          setOverlayExpanded(true);
          setExpandedContentVisible(true);
        });
      });
    }
    suppressOpenRef.current = false;
  }, [getTargetRect, layoutTransitioning]);

  const handleOverlayClose = useCallback(() => {
    if (!overlayVisible || overlayClosingRef.current) return;
    if (overlaySettleTimerRef.current) window.clearTimeout(overlaySettleTimerRef.current);
    overlayClosingRef.current = true;
    setOverlayClosing(true);
    setOverlayExpanded(false);
    overlaySettleTimerRef.current = window.setTimeout(() => {
      overlaySettleTimerRef.current = 0;
      if (!overlayClosingRef.current) return;
      overlayClosingRef.current = false;
      setOverlayClosing(false);
      setOverlayVisible(false);
      setOverlayMotionReady(false);
      setExpandedContentVisible(false);
      setTargetRect(null);
    }, OVERLAY_SETTLE_FALLBACK_MS);
  }, [overlayVisible]);

  const handleOverlayTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
    if (overlayClosingRef.current) {
      if (overlaySettleTimerRef.current) window.clearTimeout(overlaySettleTimerRef.current);
      overlaySettleTimerRef.current = 0;
      overlayClosingRef.current = false;
      setOverlayClosing(false);
      setOverlayVisible(false);
      setOverlayMotionReady(false);
      setExpandedContentVisible(false);
      setTargetRect(null);
      return;
    }
    if (overlayExpanded) setExpandedContentVisible(true);
  }, [overlayExpanded]);

  const handleDraggingChange = useCallback((dragging: boolean) => {
    if (dragging) suppressOpenRef.current = true;
  }, []);

  useEffect(() => {
    if (!overlayVisible) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleOverlayClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleOverlayClose, overlayVisible]);

  useEffect(() => {
    if (!overlayVisible) return undefined;
    const synchronizeOverlayGeometry = () => {
      overlayResizeFrameRef.current = 0;
      if (!compactCardRef.current || overlayClosingRef.current) return;
      const rect = compactCardRef.current.getBoundingClientRect();
      const nextOrigin = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      setOverlayMotionReady(false);
      setTargetRect(getTargetRect(nextOrigin));
      if (overlayResizeTimerRef.current) window.clearTimeout(overlayResizeTimerRef.current);
      overlayResizeTimerRef.current = window.setTimeout(() => {
        overlayResizeTimerRef.current = 0;
        if (!overlayClosingRef.current) setOverlayMotionReady(true);
      }, 120);
    };
    const handleViewportResize = () => {
      if (overlayResizeFrameRef.current) return;
      overlayResizeFrameRef.current = requestAnimationFrame(synchronizeOverlayGeometry);
    };
    window.addEventListener('resize', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
      if (overlayResizeFrameRef.current) cancelAnimationFrame(overlayResizeFrameRef.current);
      if (overlayResizeTimerRef.current) window.clearTimeout(overlayResizeTimerRef.current);
      overlayResizeFrameRef.current = 0;
      overlayResizeTimerRef.current = 0;
    };
  }, [getTargetRect, overlayVisible]);

  useEffect(() => () => {
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    if (overlaySettleTimerRef.current) window.clearTimeout(overlaySettleTimerRef.current);
    if (overlayResizeFrameRef.current) cancelAnimationFrame(overlayResizeFrameRef.current);
    if (overlayResizeTimerRef.current) window.clearTimeout(overlayResizeTimerRef.current);
  }, []);

  useEffect(() => {
    if (isActive === false && overlayVisible) handleOverlayClose();
  }, [handleOverlayClose, isActive, overlayVisible]);

  const hiddenRect: TimelineOverlayRect = { top: -10000, left: -10000, width: 960, height: 410 };
  const shellRect = overlayVisible ? (targetRect || hiddenRect) : hiddenRect;
  const overlayTimelineHeight = Math.max(COMPACT_GANTT_HEIGHT, (targetRect?.height || 720) - 98);

  return (
    <>
      <div ref={compactCardRef} className={`gantt-shared-origin${overlayVisible ? ' is-transitioning' : ''}`}>
        <Card className="dashboard-card gantt-card animate-slide-up stagger-3" title="整体计划时间线" bordered={false}>
          <div className="gantt-compact-trigger" onClick={handleCompactClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCompactClick(); } }}>
            <GanttTimelineView height={COMPACT_GANTT_HEIGHT} compact onDraggingChange={handleDraggingChange} />
          </div>
        </Card>
      </div>

      {createPortal(
        <div className={`gantt-shared-overlay${overlayMotionReady ? ' is-motion-ready' : ''}${overlayExpanded ? ' is-expanded' : ''}${overlayClosing ? ' is-closing' : ''}${overlayVisible ? '' : ' is-hidden'}`}>
          <div className="gantt-shared-mask" onClick={handleOverlayClose} />
          <div
            className="gantt-shared-shell"
            style={{
              top: shellRect.top,
              left: shellRect.left,
              width: shellRect.width,
              height: shellRect.height,
            } as React.CSSProperties}
            onTransitionEnd={handleOverlayTransitionEnd}
          >
            <Card
              className="dashboard-card gantt-card gantt-expanded-card"
              title="整体计划时间线"
              extra={<Button type="text" icon={<CloseOutlined />} onClick={handleOverlayClose} aria-label="收起整体计划时间线" />}
              bordered={false}
            >
              <GanttTimelineView
                height={expandedContentVisible ? overlayTimelineHeight : COMPACT_GANTT_HEIGHT}
                compact={!expandedContentVisible}
              />
            </Card>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default GanttChart;

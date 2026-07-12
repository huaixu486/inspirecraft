import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Typography, Tabs, Progress, List, Button, Space, Tag, Empty, Modal, Select, Collapse, message, Popconfirm, DatePicker, Input, Checkbox } from 'antd';

const { TextArea } = Input;
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseOutlined,
  FolderOutlined, FileOutlined, ExclamationCircleOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined, ExperimentOutlined,
  RightOutlined, DownOutlined, UserOutlined,
  WarningOutlined, FileTextOutlined, CalendarOutlined,
  BookOutlined, EditOutlined, DiffOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore, WorkflowWorkbenchTarget } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { Project, ProjectDocument, ReferenceMaterial, StageMemoryEntry, WritingTemplate, TaskItem } from '../../../shared/types';
import {
  buildProjectStageSegments,
  checkDeadlineStatus,
  getStageMeta,
  getAllStages,
  TimelineStageSegment,
  detectTimelineStage,
} from '../../utils/timelineStages';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { isManualProjectDescription, maybeGenerateAutoProjectDescription, shouldGenerateAutoProjectDescription, convertToManualDescription, resetAutoDescriptionLock } from '../../utils/autoProjectDescription';
import { composePrompt } from '../../utils/promptComposer';
import { useAIJobStore } from '../../stores/aiJobStore';
import { deriveProjectNextActions, ProjectNextAction } from '../../utils/projectNextActions';
import { buildLifecyclePatch, getProjectDocumentLifecycleColor, getProjectDocumentLifecycleLabel, reopenLifecycleStatus } from '../../utils/documentLifecycle';

const { Title, Text, Paragraph } = Typography;

const ACTION_KIND_ICON: Record<string, React.ReactNode> = {
  task: <CheckCircleOutlined style={{ color: '#1677ff' }} />,
  review: <WarningOutlined style={{ color: '#ff4d4f' }} />,
  document: <FileTextOutlined style={{ color: '#722ed1' }} />,
  stage: <CalendarOutlined style={{ color: '#13c2c2' }} />,
  diff: <DiffOutlined style={{ color: '#faad14' }} />,
  memory: <BookOutlined style={{ color: '#52c41a' }} />,
  description: <EditOutlined style={{ color: '#8c8c8c' }} />,
};

const ACTION_KIND_TARGET_PAGE: Record<string, string> = {
  task: 'plan',
  review: 'review',
  document: 'report',
  stage: 'plan',
  diff: 'review',
  memory: 'report',
  description: 'files',
};

const normalizeSidePanelKnowledgeStage = (value?: string) => String(value || '').trim().replace(/\s+/g, ' ') || 'unknown';

const formatSidePanelKnowledgeItems = (items: Array<StageMemoryEntry | ReferenceMaterial>, type: 'memory' | 'reference') =>
  items
    .slice(0, type === 'memory' ? 4 : 5)
    .map((item, index) => {
      const body = type === 'memory'
        ? (item as StageMemoryEntry).summary
        : ((item as ReferenceMaterial).summary || (item as ReferenceMaterial).contentPreview || '');
      const name = type === 'memory' ? (item as StageMemoryEntry).docName : (item as ReferenceMaterial).name;
      return String(index + 1) + '. ' + (name || 'item') + '\n' + String(body || '').slice(0, type === 'memory' ? 1200 : 1600);
    })
    .filter(Boolean)
    .join('\n\n');


// 折叠展开动画组件：用 max-height 代替 height，避免每帧 reflow
const AnimatedExpand: React.FC<{
  open: boolean;
  children: React.ReactNode;
  borderColor?: string;
}> = ({ open, children, borderColor = '#f0f0f0' }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number>(open ? 9999 : 0);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      setMaxH(open ? (contentRef.current?.scrollHeight || 9999) : 0);
      return;
    }
    if (!contentRef.current) return;
    setMaxH(open ? contentRef.current.scrollHeight : 0);
  }, [open]);

  return (
    <div style={{
      maxHeight: maxH,
      overflow: 'hidden',
      transition: 'max-height 0.2s ease-in-out',
    }}>
      <div ref={contentRef}>
        {children}
      </div>
    </div>
  );
};

export type ProjectDetailPage = 'files' | 'plan' | 'team' | 'templates' | 'report' | 'review' | 'writing';

interface DetailPanelProps {
  project: Project | null;
  isOpen: boolean;
  isOpening?: boolean;
  isSwitching: boolean;
  initialTab?: string;
  onOpenDetail?: (page: ProjectDetailPage) => void;
  onClose: () => void;
}

// ---- 阶段完成度圆环：双半圆 div + transform:rotate，纯合成层动画 ----
interface StageProgressRingProps {
  percent: number;
}

const STAGE_PROGRESS_COLOR_DURATION = 420;

const parseStageProgressColor = (value: string) => {
  const normalizedValue = value.trim();
  const rgb = normalizedValue.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
    };
  }

  const hex = normalizedValue.replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
};

const mixStageProgressColor = (
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  weight: number
) => {
  const t = Math.max(0, Math.min(1, weight));
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
};

const StageProgressRing = React.memo(({ percent }: StageProgressRingProps) => {
  const mountedRef = useRef(false);
  useEffect(() => { mountedRef.current = true; }, []);

  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = safePercent >= 80 ? '#52c41a' : safePercent >= 40 ? '#1890ff' : '#faad14';
  // 从 270°(顶部隐藏) 开始顺时针旋转，每 1% = 3.6°
  const leftDeg = 270 + Math.min(safePercent, 50) * 3.6;
  const rightDeg = 270 + Math.max(0, safePercent - 50) * 3.6;

  return (
    <div className={`stage-progress-ring-v2${mountedRef.current ? ' stage-progress-ring-v2-ready' : ''}`}>
      <div className="stage-progress-ring-v2-graphic">
        <div className="stage-progress-ring-v2-track" />
        <div className="stage-progress-ring-v2-mask stage-progress-ring-v2-left">
          <div
            className="stage-progress-ring-v2-fill stage-progress-ring-v2-fill-left"
            style={{ borderColor: color, transform: `rotate(${leftDeg}deg) translateZ(0)` }}
          />
        </div>
        <div className="stage-progress-ring-v2-mask stage-progress-ring-v2-right">
          <div
            className="stage-progress-ring-v2-fill stage-progress-ring-v2-fill-right"
            style={{ borderColor: color, transform: `rotate(${rightDeg}deg) translateZ(0)` }}
          />
        </div>
        <div className="stage-progress-ring-v2-hole" />
      </div>
      <div className="stage-progress-ring-v2-value">
        <span style={{ color }}>{safePercent}%</span>
      </div>
    </div>
  );
});

const StageProgressSvgRing = React.memo(({ percent }: StageProgressRingProps) => {
  const [ready, setReady] = useState(false);
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = safePercent >= 80 ? '#52c41a' : safePercent >= 40 ? '#1890ff' : '#faad14';

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`stage-progress-svg-ring${ready ? ' stage-progress-svg-ring-ready' : ''}`}>
      <svg className="stage-progress-svg-ring-graphic" width={80} height={80} viewBox="0 0 80 80" aria-hidden="true">
        <circle className="stage-progress-svg-ring-track" cx={40} cy={40} r={34} pathLength={100} />
        <circle
          className="stage-progress-svg-ring-bar"
          cx={40}
          cy={40}
          r={34}
          pathLength={100}
          style={{ stroke: color, strokeDashoffset: 100 - safePercent }}
        />
      </svg>
      <div className="stage-progress-svg-ring-value">
        <span style={{ color }}>{safePercent}%</span>
      </div>
    </div>
  );
});

const StageProgressPieRing = React.memo(({ percent }: StageProgressRingProps) => {
  const [ready, setReady] = useState(false);
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = safePercent >= 80 ? '#52c41a' : safePercent >= 40 ? '#1890ff' : '#faad14';
  const [displayPercent, setDisplayPercent] = useState(safePercent);
  const [overHalf, setOverHalf] = useState(safePercent > 50);
  const [durationMs, setDurationMs] = useState(420);
  const [displayColor, setDisplayColor] = useState(color);
  const displayPercentRef = useRef(safePercent);
  const pendingPhaseRef = useRef<{ target: number; durationMs: number; overHalf: boolean } | null>(null);
  const displayColorRef = useRef(color);
  const colorAnimationRef = useRef(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (displayColorRef.current === color) {
      return;
    }

    if (colorAnimationRef.current) {
      cancelAnimationFrame(colorAnimationRef.current);
      colorAnimationRef.current = 0;
    }

    const from = parseStageProgressColor(displayColorRef.current);
    const to = parseStageProgressColor(color);
    if (!from || !to) {
      displayColorRef.current = color;
      setDisplayColor(color);
      return;
    }

    const start = performance.now();
    const animateColor = (now: number) => {
      const progress = Math.min(1, (now - start) / STAGE_PROGRESS_COLOR_DURATION);
      const nextColor = mixStageProgressColor(from, to, progress);
      displayColorRef.current = nextColor;
      setDisplayColor(nextColor);

      if (progress < 1) {
        colorAnimationRef.current = requestAnimationFrame(animateColor);
      } else {
        displayColorRef.current = color;
        setDisplayColor(color);
        colorAnimationRef.current = 0;
      }
    };

    colorAnimationRef.current = requestAnimationFrame(animateColor);

    return () => {
      if (colorAnimationRef.current) {
        cancelAnimationFrame(colorAnimationRef.current);
        colorAnimationRef.current = 0;
      }
    };
  }, [color]);

  useEffect(() => {
    pendingPhaseRef.current = null;

    const from = displayPercentRef.current;
    const to = safePercent;
    if (from === to) {
      setOverHalf(to > 50);
      setDisplayPercent(to);
      return;
    }

    if (!ready) {
      setOverHalf(to > 50);
      setDurationMs(420);
      setDisplayPercent(to);
      displayPercentRef.current = to;
      return;
    }

    const totalDelta = Math.max(1, Math.abs(to - from));
    const getDuration = (start: number, end: number) =>
      Math.max(80, Math.round(420 * Math.abs(end - start) / totalDelta));

    if (from < 50 && to > 50) {
      const firstDuration = getDuration(from, 50);
      const secondDuration = getDuration(50, to);
      pendingPhaseRef.current = { target: to, durationMs: secondDuration, overHalf: true };
      setOverHalf(false);
      setDurationMs(firstDuration);
      setDisplayPercent(50);
      displayPercentRef.current = 50;
      return;
    }

    if (from > 50 && to <= 50) {
      const firstDuration = getDuration(from, 50);
      const secondDuration = getDuration(50, to);
      pendingPhaseRef.current = { target: to, durationMs: secondDuration, overHalf: false };
      setOverHalf(true);
      setDurationMs(firstDuration);
      setDisplayPercent(50);
      displayPercentRef.current = 50;
      return;
    }

    setOverHalf(to > 50);
    setDurationMs(420);
    setDisplayPercent(to);
    displayPercentRef.current = to;
  }, [ready, safePercent]);

  const handleProgressTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !event.propertyName.includes('transform')) {
      return;
    }

    const pending = pendingPhaseRef.current;
    if (!pending) {
      return;
    }

    pendingPhaseRef.current = null;
    setOverHalf(pending.overHalf);
    displayPercentRef.current = pending.target;

    if (pending.target === 50) {
      setDurationMs(420);
      setDisplayPercent(50);
      return;
    }

    setDurationMs(pending.durationMs);
    setDisplayPercent(pending.target);
  }, []);

  const rotation = displayPercent * 3.6;

  return (
    <div
      className={`stage-progress-pie-ring${overHalf ? ' stage-progress-pie-ring-over-half' : ''}${ready ? ' stage-progress-pie-ring-ready' : ''}`}
      style={{
        '--stage-progress-color': displayColor,
        '--stage-progress-duration': `${durationMs}ms`,
      } as React.CSSProperties}
    >
      <div className="stage-progress-pie-ring-slice">
        <div
          className="stage-progress-pie-ring-bar"
          onTransitionEnd={handleProgressTransitionEnd}
          style={{ transform: `rotate(${rotation}deg) translateZ(0)` }}
        />
        <div className="stage-progress-pie-ring-fill" />
      </div>
      <div className="stage-progress-pie-ring-hole" />
      <div className="stage-progress-pie-ring-value">
        <span style={{ color: displayColor }}>{safePercent}%</span>
      </div>
    </div>
  );
});

const StageProgressLinearBar = React.memo(({ percent }: StageProgressRingProps) => {
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = safePercent >= 80 ? '#52c41a' : safePercent >= 40 ? '#1890ff' : '#faad14';

  return (
    <div className="stage-progress-linear">
      <div className="stage-progress-linear-header">
        <Text type="secondary" style={{ fontSize: 12 }}>完成进度</Text>
        <Text style={{ fontSize: 18, fontWeight: 700, color }}>{safePercent}%</Text>
      </div>
      <div className="stage-progress-linear-track" aria-hidden="true">
        <div
          className="stage-progress-linear-fill"
          style={{
            backgroundColor: color,
            transform: `scaleX(${safePercent / 100}) translateZ(0)`,
          }}
        />
      </div>
    </div>
  );
});

const StageProgressCanvasRing = React.memo(({ percent }: StageProgressRingProps) => {
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = safePercent >= 80 ? '#52c41a' : safePercent >= 40 ? '#1890ff' : '#faad14';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayPercentRef = useRef(safePercent);
  const animationRef = useRef(0);
  const mountedRef = useRef(false);

  const drawRing = useCallback((value: number, ringColor: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const size = 80;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.strokeStyle = '#f0f0f0';
    ctx.arc(40, 40, 34, 0, Math.PI * 2);
    ctx.stroke();

    const clamped = Math.max(0, Math.min(100, value));
    if (clamped <= 0) return;

    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * clamped / 100;
    ctx.beginPath();
    ctx.strokeStyle = ringColor;
    ctx.arc(40, 40, 34, start, end, false);
    ctx.stroke();
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      displayPercentRef.current = safePercent;
      drawRing(safePercent, color);
      return;
    }

    const from = displayPercentRef.current;
    const to = safePercent;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    if (from === to) {
      drawRing(to, color);
      return;
    }

    const startedAt = performance.now();
    const duration = 420;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const current = from + (to - from) * progress;
      displayPercentRef.current = current;
      drawRing(current, color);
      if (progress < 1) animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [safePercent, color, drawRing]);

  return (
    <div className="stage-progress-canvas-ring">
      <canvas ref={canvasRef} className="stage-progress-canvas-ring-canvas" width={80} height={80} />
      <div className="stage-progress-canvas-ring-value">
        <span style={{ color }}>{safePercent}%</span>
      </div>
    </div>
  );
});

// 侧边窗骨架屏（无项目时显示）
const DetailPanelSkeleton = () => (
  <div className="detail-panel detail-panel-polished" style={{ padding: '16px 18px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="skeleton-loading" style={{ width: 40, height: 40, borderRadius: 10 }} />
        <div>
          <div className="skeleton-loading" style={{ width: 140, height: 18, borderRadius: 4, marginBottom: 6 }} />
          <div className="skeleton-loading" style={{ width: 100, height: 14, borderRadius: 4 }} />
        </div>
      </div>
    </div>
    <div className="skeleton-loading" style={{ height: 32, borderRadius: 6, marginBottom: 12 }} />
    <div className="skeleton-loading" style={{ flex: 1, borderRadius: 8 }} />
  </div>
);

const DetailPanel: React.FC<DetailPanelProps> = ({ project, isOpen, isOpening = false, isSwitching, initialTab = 'overview', onOpenDetail, onClose }) => {
  const projects = useProjectStore(s => s.projects);
  const setCurrentProject = useProjectStore(s => s.setCurrentProject);
  const currentProject = project; // 内部使用 currentProject 保持兼容
  const versions = useProjectStore(s => s.versions);
  const setCurrentStageName = useProjectStore(s => s.setCurrentStageName);
  const setPendingReportDocId = useProjectStore(s => s.setPendingReportDocId);
  const setPendingReportDocOnly = useProjectStore(s => s.setPendingReportDocOnly);
  const setPendingWorkflowFocus = useProjectStore(s => s.setPendingWorkflowFocus);
  const updateProject = useProjectStore(s => s.updateProject);
  const templates = useTemplateStore(s => s.templates);
  const reviews = useTemplateStore(s => s.reviews);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const addProjectDoc = useProjectDocStore(s => s.addProjectDoc);
  const updateProjectDoc = useProjectDocStore(s => s.updateProjectDoc);
  const deleteProjectDoc = useProjectDocStore(s => s.deleteProjectDoc);
  const stageMemories = useKnowledgeStore(s => s.stageMemories);
  const referenceMaterials = useKnowledgeStore(s => s.referenceMaterials);
  const loadKnowledge = useKnowledgeStore(s => s.loadKnowledge);
  const learnStageFinal = useKnowledgeStore(s => s.learnStageFinal);
  const deleteStageMemoriesForDoc = useKnowledgeStore(s => s.deleteStageMemoriesForDoc);
  const tasks = useTaskStore(s => s.tasks);
  const updateTask = useTaskStore(s => s.updateTask);
  const addTask = useTaskStore(s => s.addTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const navigateWorkbench = useNavigationStore(state => state.navigate);
  const customStages = useSettingsStore(s => s.customStages);
  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [analyzingDocId, setAnalyzingDocId] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  // 延迟收起边框状态，让边框在动画结束后再渐隐
  const [stageBorderVisible, setStageBorderVisible] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState(initialTab);
  // 快捷计划内联编辑器状态
  const [quickPlanEditing, setQuickPlanEditing] = useState(false);
  const [quickPlanTitle, setQuickPlanTitle] = useState('');
  const [quickPlanDesc, setQuickPlanDesc] = useState('');
  const [quickPlanType, setQuickPlanType] = useState<'ai' | 'manual'>('manual');
  const quickPlanTitleRef = useRef<HTMLInputElement>(null);

  // 项目描述编辑状态
  const [descEditing, setDescEditing] = useState(false);
  const [descEditText, setDescEditText] = useState('');
  const descEditRef = useRef<any>(null);
  // 报告Tab：已读报告 & 展开的阶段
  const [readReportIds, setReadReportIds] = useState<Set<string>>(new Set());
  const [expandedReportStage, setExpandedReportStage] = useState<string | null>(null);
  const knowledgeLoadStartedRef = useRef(false);
  const knowledgeLoadTimerRef = useRef<number>(0);
  const knowledgeLoadIdleRef = useRef<number>(0);

  // 团队Tab：AI协同
  const [selectedWritingTemplateId, setSelectedWritingTemplateId] = useState<string>('');
  const [selectedWritingDocIds, setSelectedWritingDocIds] = useState<string[]>([]);
  const [writingContent, setWritingContent] = useState('');

  useEffect(() => {
    if (currentProject) {
      const nextTab = initialTab || 'overview';
      setActiveTab(prev => prev === nextTab ? prev : nextTab);
    }
  }, [currentProject?.id, initialTab]);

  const getDlStatus = (deadline?: string, completedAt?: string) =>
    (!deadline || completedAt) ? 'normal' as const : checkDeadlineStatus(deadline, Date.now());

  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    if (!currentProject) { setContentReady(false); return; }
    if (isSwitching) {
      setContentReady(true);
      return;
    }
    if (!isOpening) {
      setContentReady(true);
      return;
    }
    setContentReady(false);
    const timer = window.setTimeout(() => {
      setContentReady(true);
    }, 180);
    return () => { window.clearTimeout(timer); };
  }, [currentProject?.id, isOpening, isSwitching]);

  useEffect(() => {
    if (!currentProject || knowledgeLoadStartedRef.current || isOpening || !contentReady) return;

    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const runLoad = () => {
      knowledgeLoadIdleRef.current = 0;
      knowledgeLoadStartedRef.current = true;
      void loadKnowledge();
    };

    knowledgeLoadTimerRef.current = window.setTimeout(() => {
      knowledgeLoadTimerRef.current = 0;
      if (idleApi.requestIdleCallback) {
        knowledgeLoadIdleRef.current = idleApi.requestIdleCallback(runLoad, { timeout: 1200 });
      } else {
        runLoad();
      }
    }, 120);

    return () => {
      if (knowledgeLoadTimerRef.current) {
        window.clearTimeout(knowledgeLoadTimerRef.current);
        knowledgeLoadTimerRef.current = 0;
        knowledgeLoadStartedRef.current = false;
      }
      if (knowledgeLoadIdleRef.current && idleApi.cancelIdleCallback) {
        idleApi.cancelIdleCallback(knowledgeLoadIdleRef.current);
        knowledgeLoadIdleRef.current = 0;
        knowledgeLoadStartedRef.current = false;
      }
    };
  }, [currentProject?.id, contentReady, isOpening, loadKnowledge]);

  // 所有 hooks 必须在 early return 之前调用，否则 contentReady 变化时会违反 hooks 规则
  const projectVersions = useMemo(
    () => currentProject ? versions.filter(v => v.projectId === currentProject.id) : [],
    [currentProject?.id, versions]
  );
  const projectDocsList = useMemo(
    () => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [],
    [currentProject?.id, projectDocs]
  );

  // 自动项目描述：兜底触发（主要由 ProjectTable 后台调度，这里仅作补充）
  useEffect(() => {
    if (!currentProject) return;
    if (!shouldGenerateAutoProjectDescription(currentProject)) return;
    const timer = window.setTimeout(async () => {
      try {
        const statsResult = await window.electronAPI.getTreeStats(currentProject.folderPath);
        const fileCount = statsResult?.stats?.fileCount ?? 0;
        if (fileCount >= 2) {
          void maybeGenerateAutoProjectDescription(currentProject, projectDocs, allStages, updateProject, fileCount);
        }
      } catch {}
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentProject?.id, currentProject?.autoDescriptionNextUpdateAt, currentProject?.autoDescriptionPendingSince, currentProject?.autoDescriptionGeneratedAt, currentProject?.autoDescriptionGenerationAttempted, projectDocs, allStages, updateProject]);

  // 报告Tab：已分析的文档按阶段分组（非首屏，延后到 contentReady）
  const analyzedDocsByStage = useMemo(() => {
    if (!currentProject || !contentReady) return [];
    const analyzed = projectDocsList.filter(doc => doc.analyzedAt && doc.sections?.length > 0);
    const stageMap = new Map<string, ProjectDocument[]>();
    for (const doc of analyzed) {
      const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
      const arr = stageMap.get(stage) || [];
      arr.push(doc);
      stageMap.set(stage, arr);
    }
    return Array.from(stageMap.entries()).map(([stage, docs]) => ({
      stage,
      docs: docs.sort((a, b) => new Date(b.analyzedAt!).getTime() - new Date(a.analyzedAt!).getTime()),
      hasUnread: docs.some(doc => !readReportIds.has(doc.id)),
    }));
  }, [currentProject?.id, contentReady, projectDocsList, allStages, readReportIds]);

  const planSegments = useMemo(
    () => currentProject ? buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages) : [],
    [currentProject?.id, projectDocsList, templates, projectVersions, allStages]
  );

  // 圆环进度：CSS transition 驱动，React 只更新目标值，浏览器自行插值
  // 复用 planSegments（useMemo 已算好），不重复构建 segments

  // 下一步动作（非首屏，延后到 contentReady）
  const nextActions = useMemo(() => {
    if (!currentProject || !contentReady) return [];
    return deriveProjectNextActions({
      project: currentProject,
      tasks,
      projectDocs,
      versions,
      templates,
      reviews,
      stageMemories,
      allStages,
      limit: 5,
    });
  }, [currentProject?.id, contentReady, tasks, projectDocs, versions, templates, reviews, stageMemories, allStages]);

  if (!currentProject || !contentReady) return <DetailPanelSkeleton />;
  const totalAnalyzed = projectDocsList.filter(doc => doc.analyzedAt).length;
  const totalUnread = totalAnalyzed - analyzedDocsByStage.reduce((sum, g) => sum + g.docs.filter(d => readReportIds.has(d.id)).length, 0);

  const selectedDoc = projectDocsList.find(d => d.id === selectedDocId) || null;

  // 侧边窗阶段完成度统一按系统启用的全部阶段作为分母，避免圆环和右侧百分比口径不一致。
  const systemStageCount = allStages.length || 1;
  const detectedStageCount = planSegments.length;
  const completedStageCount = planSegments.filter(s => Boolean(s.completedAt)).length;
  const activeStageCount = Math.max(0, detectedStageCount - completedStageCount);
  const completedStagePercent = Math.round((completedStageCount / systemStageCount) * 100);
  const activeStagePercent = Math.round((activeStageCount / systemStageCount) * 100);

  const recentPlanTasks = tasks
    .filter(task => task.projectId === currentProject.id)
    .sort((a, b) => {
      const statusScore = (item: TaskItem) => item.status === 'completed' ? 1 : 0;
      if (statusScore(a) !== statusScore(b)) return statusScore(a) - statusScore(b);
      const aOrder = a.workflowOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.workflowOrder ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 5);
  const projectReviews = [...reviews]
    .filter(review => review.projectId === currentProject.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const latestReview = projectReviews[0];
  const latestReviewIssues = Array.isArray(latestReview?.issues) ? latestReview.issues : [];
  const reviewErrorCount = latestReviewIssues.filter(issue => issue.severity === 'error').length;
  const reviewWarningCount = latestReviewIssues.filter(issue => issue.severity === 'warning').length;
  const reviewTasks = tasks
    .filter(task => task.projectId === currentProject.id && (task.source === 'review' || Boolean(task.relatedReviewId || task.relatedIssueId)))
    .sort((a, b) => {
      const statusScore = (item: TaskItem) => item.status === 'completed' ? 1 : 0;
      if (statusScore(a) !== statusScore(b)) return statusScore(a) - statusScore(b);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  const pendingReviewTaskCount = reviewTasks.filter(task => task.status !== 'completed').length;
  const reviewTaskPreview = reviewTasks.slice(0, 4);
  const handleToggleTaskComplete = async (task: TaskItem, checked: boolean) => {
    await updateTask(task.id, {
      status: checked ? 'completed' : 'pending',
      completedAt: checked ? new Date().toISOString() : undefined,
    });
  };

  const isAiRevisionTask = (task: TaskItem) => {
    if (task.type !== 'ai') return false;
    const text = [task.title, task.description, task.workflowName, task.sectionTitle].filter(Boolean).join(' ');
    return /\u4fee\u6539|\u4fee\u8ba2|\u6539\u5199|\u6539\u7a3f|\u4f18\u5316|\u6da6\u8272|\u8865\u5199|\u6269\u5199|\u6309\u5ba1\u67e5|\u5ba1\u67e5\u610f\u89c1|\u95ee\u9898|\u5efa\u8bae|\u5b8c\u5584|\u8c03\u6574/.test(text);
  };

  const resolveWorkflowWorkbench = (task: TaskItem): ProjectDetailPage => {
    if (task.source === 'review' || task.relatedReviewId || task.relatedIssueId) return 'review';
    if (isAiRevisionTask(task)) return 'team';
    if (task.source === 'report') return task.type === 'ai' ? 'team' : 'report';
    if (task.relatedDocId && task.type === 'ai') return 'team';
    if (task.relatedDocId) return 'report';
    if (task.source === 'stage' || task.stageName) return 'plan';
    if (task.type === 'ai') return 'team';
    return 'team';
  };

  const buildWorkflowPrompt = (task: TaskItem) => {
    const doc = task.relatedDocId ? projectDocsList.find(item => item.id === task.relatedDocId) : selectedDoc;
    return [
      `请根据当前工作流任务处理文档内容。`,
      `任务：${task.title}`,
      task.sectionTitle ? `章节：${task.sectionTitle}` : '',
      doc ? `文档：${getDocDisplayName(doc)}` : '',
      task.stageName ? `阶段：${task.stageName}` : '',
      task.description ? `问题/要求：${task.description}` : '',
      `请输出可直接用于修改该部分正文的处理建议、改写方向和必要的补充材料清单。`,
    ].filter(Boolean).join('\n');
  };

  const openWorkflowTask = (task: TaskItem) => {
    const target = resolveWorkflowWorkbench(task);
    if (task.stageName) setCurrentStageName(task.stageName);
    setPendingWorkflowFocus({
      projectId: currentProject.id,
      workflowId: task.workflowId,
      taskId: task.id,
      relatedDocId: task.relatedDocId,
      stageName: task.stageName,
      source: task.source,
      prompt: buildWorkflowPrompt(task),
      target: target as WorkflowWorkbenchTarget,
    });
    if (target === 'report') {
      setPendingReportDocId(task.relatedDocId || null);
      setPendingReportDocOnly(false);
    } else {
      setPendingReportDocId(null);
      setPendingReportDocOnly(false);
    }
    openDetail(target);
  };

  const syncReportWorkflowTasks = async (doc: ProjectDocument, aiReport: any, stage: string) => {
    const workflowItems = Array.isArray(aiReport?.workflowPlan) ? aiReport.workflowPlan : [];
    const existingReportTasks = useTaskStore.getState().tasks.filter(task =>
      task.projectId === currentProject.id && task.source === 'report' && task.relatedDocId === doc.id
    );
    await Promise.all(existingReportTasks.map(task => deleteTask(task.id)));

    const normalizedItems = workflowItems
      .map((item: any) => ({
        type: item?.type === 'ai' ? 'ai' : 'manual',
        title: String(item?.title || '').trim(),
        description: String(item?.description || item?.reason || '').trim(),
        priority: item?.priority === 'high' || item?.priority === 'low' ? item.priority : 'medium',
      }))
      .filter((item: { title: string }) => item.title);

    if (normalizedItems.length === 0) return;

    const now = new Date().toISOString();
    const workflowId = 'report-' + doc.id + '-' + Date.now();
    await Promise.all(normalizedItems.map((item: any, index: number) => addTask({
      id: workflowId + '-' + (index + 1),
      projectId: currentProject.id,
      title: item.title,
      description: item.description,
      type: item.type,
      status: 'pending',
      priority: item.priority,
      source: 'report',
      relatedDocId: doc.id,
      stageName: stage,
      workflowId,
      workflowName: aiReport?.reportTitle || '\u62a5\u544a\u751f\u6210\u8ba1\u5212',
      workflowOrder: index + 1,
      createdAt: now,
    })));
  };

  const statusMap: Record<string, { color: string; label: string }> = {
    active: { color: 'blue', label: '进行中' },
    completed: { color: 'green', label: '已完成' },
    paused: { color: 'orange', label: '已暂停' },
  };
  const statusInfo = statusMap[currentProject.status] || { color: 'default', label: '未知' };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '未设置';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getReviewScoreColor = (score?: number) => {
    if (typeof score !== 'number') return '#d9d9d9';
    if (score >= 85) return '#52c41a';
    if (score >= 70) return '#1890ff';
    if (score >= 60) return '#faad14';
    return '#ff4d4f';
  };

  const getVersionForDoc = (doc: ProjectDocument) =>
    versions.find(v => v.id === doc.versionId);

  const getDocDisplayName = (doc: ProjectDocument) =>
    getVersionForDoc(doc)?.fileName || doc.name;

  const getDocActivityAt = (doc: ProjectDocument) =>
    doc.sourceFileModifiedAt || doc.analyzedAt || getVersionForDoc(doc)?.createdAt || doc.sourceFileCreatedAt || doc.createdAt;

  const getDocActivityMs = (doc: ProjectDocument) => {
    const ms = new Date(getDocActivityAt(doc)).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const sortDocsByLatestActivity = (docs: ProjectDocument[]) =>
    [...docs].sort((a, b) => getDocActivityMs(b) - getDocActivityMs(a));

  const normalizeFileVersionKey = (value?: string) => String(value || '').trim().toLowerCase().replace(/\\/g, '/');
  const getFileTypeLabel = (fileName = '', filePath = '') => {
    const ext = (fileName || filePath).split('.').pop()?.toUpperCase();
    return ext && ext.length <= 5 ? ext : 'DOC';
  };

  const fileVersionEntries = (() => {
    const usedVersionIds = new Set<string>();
    const byKey = new Map<string, {
      id: string;
      fileName: string;
      filePath: string;
      fileType: string;
      source: 'doc' | 'version';
      sourceLabel: string;
      stage: string;
      updatedAt: string;
      createdAt: string;
      progress?: number;
    }>();

    const upsert = (entry: {
      id: string;
      fileName: string;
      filePath: string;
      fileType: string;
      source: 'doc' | 'version';
      sourceLabel: string;
      stage: string;
      updatedAt: string;
      createdAt: string;
      progress?: number;
    }) => {
      const key = normalizeFileVersionKey(entry.filePath) || normalizeFileVersionKey(entry.fileName) || entry.id;
      const existing = byKey.get(key);
      const existingTime = existing ? new Date(existing.updatedAt || existing.createdAt).getTime() : 0;
      const entryTime = new Date(entry.updatedAt || entry.createdAt).getTime();
      if (!existing || (Number.isFinite(entryTime) ? entryTime : 0) >= (Number.isFinite(existingTime) ? existingTime : 0)) {
        byKey.set(key, entry);
      }
    };

    projectDocsList.forEach(doc => {
      const version = getVersionForDoc(doc);
      if (version?.id) usedVersionIds.add(version.id);
      const fileName = version?.fileName || doc.name || '未命名文档';
      const filePath = doc.sourceFilePath || version?.filePath || '';
      upsert({
        id: `doc:${doc.id}`,
        fileName,
        filePath,
        fileType: version?.fileType?.toUpperCase() || getFileTypeLabel(fileName, filePath),
        source: 'doc',
        sourceLabel: version ? '关联版本' : '项目文件',
        stage: detectTimelineStage(allStages, doc.name, doc.sourceFilePath || version?.filePath),
        updatedAt: getDocActivityAt(doc),
        createdAt: doc.sourceFileCreatedAt || version?.createdAt || doc.createdAt,
        progress: doc.overallProgress,
      });
    });

    projectVersions.forEach(version => {
      if (usedVersionIds.has(version.id)) return;
      upsert({
        id: `version:${version.id}`,
        fileName: version.fileName || '未命名版本',
        filePath: version.filePath || '',
        fileType: version.fileType?.toUpperCase() || getFileTypeLabel(version.fileName, version.filePath),
        source: 'version',
        sourceLabel: '版本库记录',
        stage: detectTimelineStage(allStages, version.fileName, version.filePath),
        updatedAt: version.createdAt,
        createdAt: version.createdAt,
      });
    });

    return Array.from(byKey.values()).sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  })();

  const getProgressColor = (progress: number) =>
    progress >= 80 ? '#52c41a' : progress >= 40 ? '#1890ff' : progress > 0 ? '#faad14' : '#8c8c8c';

  // 按模板分组（未关联模板的文件通过关键字自动匹配）
  const groupedByTemplate = () => {
    const map = new Map<string, ProjectDocument[]>();
    for (const doc of projectDocsList) {
      let templateId = doc.templateId;
      // 未关联模板时，通过关键字自动匹配
      if (!templateId) {
        const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
        const matched = templates.find(t =>
          t.name.includes(stage) || t.category?.includes(stage) || detectTimelineStage(allStages, t.name, t.category) === stage
        );
        templateId = matched?.id || '__unmatched__';
      }
      const arr = map.get(templateId) || [];
      arr.push(doc);
      map.set(templateId, arr);
    }
    const groups: { templateId: string; templateName: string; docs: ProjectDocument[] }[] = [];
    for (const [templateId, docs] of map) {
      const template = templates.find(t => t.id === templateId);
      groups.push({
        templateId,
        templateName: template?.name || (templateId === '__unmatched__' ? '未匹配模板' : '未知模板'),
        docs,
      });
    }
    return groups;
  };

  // 可选的模板列表（已有模板 + 未使用的新模板）
  const parseSidePanelAiReport = (value: string, fallbackTitle: string) => {
    const normalizeList = (input: unknown): string[] => {
      if (Array.isArray(input)) return input.map(item => String(item || '').trim()).filter(Boolean);
      if (typeof input === 'string') {
        return input.split(/\n|；|;|，/).map(item => item.replace(/^[-\d.、\s]+/, '').trim()).filter(Boolean);
      }
      return [];
    };

    let payload = value.trim();
    const codeBlock = payload.match(/\`\`\`(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*\`\`\`/);
    if (codeBlock) payload = codeBlock[1].trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      const match = payload.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
        } catch {}
      }
    }

    if (!parsed) {
      return {
        reportTitle: fallbackTitle,
        reportSummary: value.trim(),
        writingFramework: [],
        writingDirection: [],
        materialPlan: [],
        draftPlan: [],
        humanTasks: [],
        aiTasks: [],
        workflowPlan: [],
        rawText: value,
      };
    }

    return {
      reportTitle: String(parsed.reportTitle || parsed.title || fallbackTitle).trim(),
      reportSummary: String(parsed.reportSummary || parsed.summary || '').trim(),
      templateFit: normalizeList(parsed.templateFit),
      writingStyleNotes: normalizeList(parsed.writingStyleNotes),
      writingFramework: normalizeList(parsed.writingFramework),
      writingDirection: normalizeList(parsed.writingDirection),
      materialPlan: normalizeList(parsed.materialPlan),
      draftPlan: normalizeList(parsed.draftPlan),
      humanTasks: normalizeList(parsed.humanTasks),
      aiTasks: normalizeList(parsed.aiTasks),
      workflowPlan: Array.isArray(parsed.workflowPlan) ? parsed.workflowPlan : [],
      rawText: value,
    };
  };

  const flattenTemplateNodesForSidePanelPrompt = (nodes: any[] = [], depth = 0): string[] => nodes.flatMap(node => {
    const title = String(node.title || '').trim();
    const requirement = String(node.requirementText || node.description || '').trim();
    const example = String(node.exampleText || '').trim();
    const line = [
      `${'  '.repeat(depth)}- ${title || '未命名章节'}`,
      requirement ? `要求：${requirement.slice(0, 500)}` : '',
      example ? `范文写法参考：${example.slice(0, 400)}` : '',
    ].filter(Boolean).join('；');
    return [line, ...flattenTemplateNodesForSidePanelPrompt(node.children || [], depth + 1)];
  });

  const generateAiReportForDoc = async (
    doc: ProjectDocument,
    content: string,
    template: WritingTemplate,
    sections: any[] = [],
    overallProgress = 0,
  ) => {
    const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
    const version = getVersionForDoc(doc);
    const sectionStatus = sections.map(section =>
      `- ${section.title || '未命名章节'}：${section.status || 'unknown'}，字数 ${section.wordCount || 0}${section.aiComment ? `，说明：${section.aiComment}` : ''}`
    ).join('\n');
    const isExampleTemplate = template.templateType === 'example';
    const templateNodes = flattenTemplateNodesForSidePanelPrompt((template as any).nodes || []).join('\n');
    const normalizedStage = normalizeSidePanelKnowledgeStage(stage);
    const stageMemoryContext = formatSidePanelKnowledgeItems(
      stageMemories.filter(item =>
        item.projectId === currentProject.id &&
        normalizeSidePanelKnowledgeStage(item.stageName) === normalizedStage
      ),
      'memory',
    );
    const referenceContext = formatSidePanelKnowledgeItems(
      referenceMaterials.filter(item => item.projectId === currentProject.id),
      'reference',
    );
    const fallbackTitle = `${stage}阶段写作报告：${getDocDisplayName(doc)}`;
    const prompt = composePrompt('report', {
      projectName: currentProject.name,
      stage,
      docName: doc.name,
      fileName: version?.fileName || getDocDisplayName(doc),
      createdAt: dayjs(getDocActivityAt(doc)).format('YYYY-MM-DD HH:mm'),
      progress: String(overallProgress),
      templateName: template.name,
      templateCategory: template.category || '无',
      templateDescription: template.description || '无',
      templateNodesLabel: isExampleTemplate ? '范文参考方向与结构路径（标题非固定）：' : '模板章节和写作要求：',
      templateNodes: templateNodes || '无',
      stageMemory: stageMemoryContext || 'None',
      reference: referenceContext || 'None',
      sectionStatus: sectionStatus || '暂无章节分析',
      content: content.slice(0, 9000),
    });

    const response = await useAIJobStore.getState().runAIJob<string>(
      {
        scene: 'report',
        title: `生成阶段报告：${getDocDisplayName(doc)}`,
        projectId: currentProject.id,
        docId: doc.id,
        resultPreview: (value) => value,
      },
      async ({ setProgress, throwIfCancelled }) => {
        setProgress(35);
        const value = await window.electronAPI.callAI({ prompt });
        throwIfCancelled();
        setProgress(85);
        return String(value || '');
      },
    );
    const aiReport = parseSidePanelAiReport(response, fallbackTitle);
    await updateProjectDoc(doc.id, {
      aiReport: JSON.stringify(aiReport),
      analyzedAt: new Date().toISOString(),
    });
    await syncReportWorkflowTasks(doc, aiReport, stage);
    return aiReport;
  };

  const templateOptions = () => {
    const usedTemplateIds = new Set(projectDocsList.map(d => d.templateId));
    const options: { value: string; label: string; isNew: boolean }[] = [];
    // 已使用的模板（可继续添加文件）
    for (const tid of usedTemplateIds) {
      const t = templates.find(t => t.id === tid);
      if (t) options.push({ value: t.id, label: `${t.name}（添加文件）`, isNew: false });
    }
    // 未使用的新模板
    for (const t of templates) {
      if (!usedTemplateIds.has(t.id)) {
        options.push({ value: t.id, label: `${t.name} (${t.category})`, isNew: true });
      }
    }
    return options;
  };

  // 关联文件：创建 ProjectDocument
  const handleAddDoc = async () => {
    if (!selectedTemplateId || !selectedVersionId) {
      message.warning('请选择模板和可对比文件');
      return;
    }
    const template = templates.find(t => t.id === selectedTemplateId);
    const version = versions.find(v => v.id === selectedVersionId);
    if (!template || !version) return;

    // 命名：项目名称-模板名称，如果同模板有多个文件则加上文件名
    const existingDocs = projectDocsList.filter(d => d.templateId === selectedTemplateId);
    let docName = `${currentProject.name}-${template.name}`;
    if (existingDocs.length > 0) {
      const baseName = version.fileName.replace(/\.[^.]+$/, '');
      docName = `${currentProject.name}-${template.name}(${baseName})`;
    }

    const newDoc: ProjectDocument = {
      id: Date.now().toString(),
      projectId: currentProject.id,
      templateId: selectedTemplateId,
      versionId: selectedVersionId,
      name: docName,
      sections: [],
      overallProgress: 0,
      createdAt: new Date().toISOString(),
    };

    await addProjectDoc(newDoc);
    setAddModalOpen(false);
    setSelectedTemplateId('');
    setSelectedVersionId('');
    message.success('已关联项目文档，正在分析...');

    // 自动执行基础分析
    await runAnalysis(newDoc.id, version.content, template, false);
  };

  // 执行分析
  const runAnalysis = async (docId: string, content: string, template: WritingTemplate, useAI: boolean) => {
    setAnalyzingDocId(docId);
    try {
      const result = await window.electronAPI.analyzeProjectDoc({ content, template, useAI });
      if (result.success && result.sections) {
        await updateProjectDoc(docId, {
          sections: result.sections,
          overallProgress: result.overallProgress ?? 0,
          analyzedAt: new Date().toISOString(),
        });
        message.success(useAI ? 'AI分析完成，正在生成报告...' : '基础分析完成');
        return result;
      }
      return null;
    } catch (error) {
      console.error('Analysis failed:', error);
      message.error('分析失败');
      return null;
    } finally {
      setAnalyzingDocId(null);
    }
  };

  const handleAnalyze = async (doc: ProjectDocument, useAI: boolean) => {
    const version = doc.versionId ? versions.find(v => v.id === doc.versionId) : undefined;
    const template = doc.templateId ? templates.find(t => t.id === doc.templateId) : undefined;

    // 尝试从源文件实时解析内容
    let content = version?.content || '';
    if (!content && doc.sourceFilePath) {
      try {
        const parsed = await window.electronAPI.parseDocument(doc.sourceFilePath);
        if (parsed.success && parsed.content?.trim()) {
          content = parsed.content.trim();
        }
      } catch {}
    }

    if (!content) {
      message.warning('该项目文档暂无文本内容，请先导入或同步可对比文件');
      return;
    }
    if (!template) {
      message.warning('该文档未关联模板，请先在关联文件时选择模板');
      return;
    }
    const result = await runAnalysis(doc.id, content, template, useAI);
    if (useAI && result?.success) {
      setAnalyzingDocId(doc.id);
      try {
        await generateAiReportForDoc(
          doc,
          content,
          template,
          result.sections || doc.sections || [],
          result.overallProgress ?? doc.overallProgress ?? 0,
        );
        message.success('AI报告已生成，双击报告即可查看详情');
      } catch (error: any) {
        console.error('AI report generation failed:', error);
        message.error(`AI报告生成失败：${error.message || '未知错误'}`);
      } finally {
        setAnalyzingDocId(null);
      }
    }
  };

  // 快速导出 Word
  const handleQuickExport = async () => {
    const template = templates.find(t => t.id === selectedWritingTemplateId);
    if (!template || !currentProject) return;
    try {
      const result = await window.electronAPI.generateFromContent({
        template,
        sectionContents: { 'main': writingContent },
        folderPath: currentProject.folderPath,
        fileName: `${currentProject.name}-${template.name}`,
      });
      if (result.success) {
        message.success(`文档已导出`);
        if (result.filePath) await window.electronAPI.openInExplorer(result.filePath);
      } else {
        message.error(result.error || '导出失败');
      }
    } catch (error: any) {
      message.error(`导出失败：${error.message}`);
    }
  };

  // 导入单个文档内容
  const handleImportWritingDoc = async (docId: string) => {
    const doc = projectDocsList.find(d => d.id === docId);
    if (!doc) return '';
    const version = doc.versionId ? versions.find(v => v.id === doc.versionId) : undefined;
    let content = version?.content || '';
    if (!content && doc.sourceFilePath) {
      try {
        const parsed = await window.electronAPI.parseDocument(doc.sourceFilePath);
        if (parsed.success && parsed.content?.trim()) content = parsed.content.trim();
      } catch {}
    }
    return content;
  };

  // 批量导入文档内容
  const handleBatchImportDocs = async (docIds: string[]) => {
    const contents: string[] = [];
    for (const docId of docIds) {
      const content = await handleImportWritingDoc(docId);
      if (content) contents.push(content);
    }
    if (contents.length > 0) {
      setWritingContent(prev => prev ? prev + '\n\n' + contents.join('\n\n') : contents.join('\n\n'));
      message.success(`已导入 ${contents.length} 个文档内容`);
    } else {
      message.warning('所选文档暂无文本内容');
    }
  };

  // 导入项目所有文档
  const handleImportAllDocs = async () => {
    const allDocIds = projectDocsList.map(d => d.id);
    if (allDocIds.length === 0) {
      message.warning('项目暂无项目文档');
      return;
    }
    await handleBatchImportDocs(allDocIds);
  };

  const getProjectDocumentStage = (doc: ProjectDocument) =>
    planSegments.find(segment => segment.sourceDocIds.includes(doc.id))?.stage
    || detectTimelineStage(allStages, doc.name, doc.sourceFilePath);

  const learnCompletedProjectDocument = async (doc: ProjectDocument, stageName = getProjectDocumentStage(doc), showToast = true) => {
    const version = doc.versionId ? versions.find(item => item.id === doc.versionId) : undefined;
    try {
      const entry = await learnStageFinal({
        projectId: currentProject.id,
        projectName: currentProject.name,
        stageName,
        docId: doc.id,
        docName: doc.name,
        sourceFilePath: doc.sourceFilePath || version?.filePath,
        content: version?.content,
      });
      if (entry) {
        await updateProjectDoc(doc.id, { learnedAt: entry.updatedAt || new Date().toISOString(), ...buildLifecyclePatch('learned') });
        if (showToast) message.success('\u6587\u6863\u5df2\u5b66\u4e60\u5230\u9636\u6bb5\u8bb0\u5fc6\u5e93');
      }
    } catch (error: any) {
      if (showToast) message.warning('\u6587\u6863\u5df2\u6807\u8bb0\u5b8c\u6210\uff0c\u4f46\u9636\u6bb5\u8bb0\u5fc6\u5b66\u4e60\u5931\u8d25: ' + (error.message || error));
    }
  };

  const rollbackProjectDocumentMemory = async (docId: string) => {
    await deleteStageMemoriesForDoc(docId);
  };
  const handleStageDeadline = async (segment: TimelineStageSegment, deadline?: string) => {
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { deadline })));
    message.success(deadline ? '已更新计划截止时间' : '已清除计划截止时间');
  };

  const handleDocComplete = async (doc: ProjectDocument) => {
    const completedAt = new Date().toISOString();
    await updateProjectDoc(doc.id, { completedAt, ...buildLifecyclePatch('completed', completedAt) });
    await learnCompletedProjectDocument({ ...doc, completedAt });
    message.success('\u5df2\u6807\u8bb0\u6587\u6863\u5b8c\u6210');
  };

  const handleDocReopen = async (doc: ProjectDocument) => {
    await updateProjectDoc(doc.id, {
      completedAt: undefined,
      learnedAt: undefined,
      reopenedAt: new Date().toISOString(),
      ...buildLifecyclePatch(reopenLifecycleStatus({ ...doc, completedAt: undefined, learnedAt: undefined })),
    });
    await rollbackProjectDocumentMemory(doc.id);
    message.success('\u5df2\u53d6\u6d88\u6587\u6863\u5b8c\u6210\uff0c\u5e76\u56de\u6863\u9636\u6bb5\u8bb0\u5fc6');
  };

  const handleStageComplete = async (segment: TimelineStageSegment) => {
    const completedAt = new Date().toISOString();
    const docs = segment.sourceDocIds
      .map(id => projectDocsList.find(doc => doc.id === id))
      .filter((doc): doc is ProjectDocument => Boolean(doc));
    await Promise.all(docs.map(doc => updateProjectDoc(doc.id, { completedAt, ...buildLifecyclePatch('completed', completedAt) })));
    await Promise.all(docs.map(doc => learnCompletedProjectDocument({ ...doc, completedAt }, segment.stage, false)));
    message.success('\u5df2\u6807\u8bb0\u9636\u6bb5\u5b8c\u6210\uff0c\u5e76\u66f4\u65b0\u9636\u6bb5\u8bb0\u5fc6');
  };

  const handleStageReopen = async (segment: TimelineStageSegment) => {
    await Promise.all(segment.sourceDocIds.map(id => {
      const doc = projectDocsList.find(item => item.id === id);
      return updateProjectDoc(id, {
        completedAt: undefined,
        learnedAt: undefined,
        reopenedAt: new Date().toISOString(),
        ...buildLifecyclePatch(doc ? reopenLifecycleStatus({ ...doc, completedAt: undefined, learnedAt: undefined }) : 'identified'),
      });
    }));
    await Promise.all(segment.sourceDocIds.map(id => rollbackProjectDocumentMemory(id)));
    message.success('\u5df2\u53d6\u6d88\u5b8c\u6210\u72b6\u6001\uff0c\u5e76\u56de\u6863\u9636\u6bb5\u8bb0\u5fc6');
  };


  const openDetail = (page: ProjectDetailPage) => {
    // 侧边窗使用独立的预览项目；在切出总览前必须同步到全局工作台上下文。
    if (!currentProject) {
      message.warning('请先选择一个项目');
      return;
    }
    setCurrentProject(currentProject);
    onOpenDetail?.(page);
  };

  const handleOpenQuickPlanEditor = () => {
    const manualPlanCount = tasks.filter(task => task.projectId === currentProject.id && task.source === 'manual').length;
    setQuickPlanTitle(`未命名计划 ${manualPlanCount + 1}`);
    setQuickPlanDesc('');
    setQuickPlanType('manual');
    setQuickPlanEditing(true);
    // 下一帧聚焦标题输入框
    requestAnimationFrame(() => {
      quickPlanTitleRef.current?.focus();
      quickPlanTitleRef.current?.select();
    });
  };

  const handleConfirmQuickPlan = async () => {
    const title = quickPlanTitle.trim();
    if (!title) {
      message.warning('请输入计划标题');
      return;
    }
    await addTask({
      id: `quick-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      projectId: currentProject.id,
      title,
      description: quickPlanDesc.trim() || (quickPlanType === 'ai' ? 'AI 自动执行任务' : '需要人工处理的计划'),
      type: quickPlanType,
      status: 'pending',
      priority: 'medium',
      source: 'manual',
      createdAt: new Date().toISOString(),
    });
    setQuickPlanEditing(false);
    message.success(quickPlanType === 'ai' ? '已创建 AI 任务' : '已创建人工计划');
  };

  const handleCancelQuickPlan = () => {
    setQuickPlanEditing(false);
  };

  const handleToggleTaskType = async (task: TaskItem) => {
    const nextType: TaskItem['type'] = task.type === 'ai' ? 'manual' : 'ai';
    await updateTask(task.id, { type: nextType });
    message.success(nextType === 'ai' ? '已归类为 AI 任务' : '已归类为人工任务');
  };

  const summaryCardStyle: React.CSSProperties = {
    border: '1px solid rgba(226, 232, 240, 0.9)',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.92)',
    padding: '12px 14px',
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.035)',
  };

  const recentFileVersions = fileVersionEntries.slice(0, 5);

  // 状态图标
  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />;
    if (status === 'partial') return <ClockCircleOutlined style={{ color: '#faad14', fontSize: 14 }} />;
    return <CloseOutlined style={{ color: '#d9d9d9', fontSize: 14 }} />;
  };

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Title level={5} style={{ fontSize: 14, margin: 0 }}>{'项目描述'}</Title>
            {currentProject.descriptionSource === 'auto' && currentProject.description && (
              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>AI简述</Tag>
            )}
            {isManualProjectDescription(currentProject) && (
              <Tag color="green" style={{ margin: 0, fontSize: 11 }}>手动</Tag>
            )}
            {!descEditing && (
              <Button type="text" size="small" icon={<EditOutlined />}
                onClick={() => { setDescEditing(true); setDescEditText(currentProject.description || ''); setTimeout(() => descEditRef.current?.focus(), 100); }}
                style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 11 }}
                title={currentProject.description ? '编辑描述' : '添加描述'}
              />
            )}
          </div>

          {descEditing ? (
            <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input.TextArea
                ref={descEditRef}
                value={descEditText}
                onChange={e => setDescEditText(e.target.value)}
                placeholder="输入项目描述…"
                autoSize={{ minRows: 2, maxRows: 6 }}
                style={{ fontSize: 12 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="small" type="primary" onClick={async () => {
                  const text = descEditText.trim();
                  if (text) {
                    await convertToManualDescription(currentProject, updateProject, text);
                    message.success('已保存为手动描述');
                  } else {
                    await updateProject(currentProject.id, { description: '', descriptionSource: undefined });
                    message.success('已清空描述');
                  }
                  setDescEditing(false);
                }}>保存</Button>
                <Button size="small" onClick={() => setDescEditing(false)}>取消</Button>
                {currentProject.description && (
                  <Popconfirm title="确定清空描述？" onConfirm={async () => {
                    await updateProject(currentProject.id, { description: '', descriptionSource: undefined });
                    setDescEditing(false);
                    message.success('已清空描述');
                  }}>
                    <Button size="small" danger>清空</Button>
                  </Popconfirm>
                )}
              </div>
            </div>
          ) : (
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 20 }}>
              {currentProject.description
                || (currentProject.autoDescriptionGeneratedAt && !currentProject.description
                  ? 'AI 简述已生成过，如需重新生成请手动操作'
                  : currentProject.autoDescriptionGenerationAttempted && !currentProject.description
                    ? 'AI 简述生成失败或结果为空'
                    : currentProject.autoDescriptionPendingSince && !isManualProjectDescription(currentProject)
                      ? '已检测到文件更新，三天无更新后自动生成'
                      : '暂无描述')}
            </Paragraph>
          )}

          {(currentProject.autoDescriptionGeneratedAt || currentProject.autoDescriptionGenerationAttempted) && !descEditing && (
            <div style={{ marginBottom: 16 }}>
              <Button size="small" type="link" style={{ fontSize: 11, padding: 0, color: '#8c8c8c' }}
                onClick={async () => {
                  await resetAutoDescriptionLock(currentProject, updateProject);
                  message.success('已恢复自动生成资格，将在下次扫描后重新生成');
                }}
              >
                恢复自动生成资格
              </Button>
            </div>
          )}

          {/* \u4e0b\u4e00\u6b65\u884c\u52a8\u4e2d\u5fc3 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Title level={5} style={{ fontSize: 14, margin: 0 }}>下一步行动</Title>
              <Tag color="default" style={{ margin: 0, fontSize: 10 }}>{nextActions.length} 项</Tag>
            </div>
            {nextActions.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>当前项目没有待推进事项</Text>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {nextActions.map(action => (
                  <div
                    key={action.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const targetPage = (ACTION_KIND_TARGET_PAGE[action.kind] || action.target) as any;
                      navigateWorkbench({
                        projectId: currentProject.id,
                        target: targetPage,
                        stageName: action.stageName,
                        docId: action.docId,
                        taskId: action.taskId,
                        reviewId: action.reviewId,
                        source: 'overview',
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 10px', borderRadius: 8,
                      border: `1px solid ${action.severity === 'high' ? '#ffccc7' : action.severity === 'medium' ? '#ffe58f' : '#f0f0f0'}`,
                      background: action.severity === 'high' ? '#fff1f0' : action.severity === 'medium' ? '#fffbe6' : '#fafafa',
                      cursor: 'pointer', transition: 'background 150ms',
                    }}
                  >
                    <span style={{ marginTop: 2, flexShrink: 0, fontSize: 14 }}>
                      {ACTION_KIND_ICON[action.kind] || <RightOutlined style={{ color: '#8c8c8c' }} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ fontSize: 12, display: 'block' }}>{action.title}</Text>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.4 }}>{action.detail}</Text>
                    </div>
                    <RightOutlined style={{ color: '#bbb', fontSize: 10, marginTop: 4, flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{'\u72b6\u6001'}</Text>
              <Tag color={statusInfo.color} style={{ margin: 0, fontSize: 11 }}>{statusInfo.label}</Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{'\u521b\u5efa\u65f6\u95f4'}</Text>
              <Text style={{ fontSize: 12 }}>{formatDate(currentProject.createdAt)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{'\u6587\u4ef6\u7248\u672c'}</Text>
              <Text style={{ fontSize: 12 }}>{fileVersionEntries.length} {'\u4e2a'}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{'\u5173\u8054\u6587\u6863'}</Text>
              <Text style={{ fontSize: 12 }}>{projectDocsList.length} {'\u4efd'}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{'\u5173\u8054\u6587\u4ef6\u5939'}</Text>
              <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: currentProject.folderPath }}>
                {currentProject.folderPath ? currentProject.folderPath.split(/[/\\]/).pop() : '\u672a\u5173\u8054'}
              </Text>
            </div>
          </div>

          <Title level={5} style={{ fontSize: 14, marginBottom: 12 }}>{'\u9636\u6bb5\u5b8c\u6210\u5ea6'}</Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {/* 圆形进度条暂时停用：跨 50% 的双半圆接续会产生卡顿。 */}
            {/* <StageProgressPieRing percent={completedStagePercent} /> */}
            <StageProgressLinearBar percent={completedStagePercent} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#52c41a', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>{'\u5df2\u5b8c\u6210'}</Text></Space>
                <Text style={{ fontSize: 12 }}>{completedStagePercent}%</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#1890ff', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>{'\u8fdb\u884c\u4e2d'}</Text></Space>
                <Text style={{ fontSize: 12 }}>{activeStagePercent}%</Text>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Title level={5} style={{ fontSize: 14, margin: 0 }}>{'\u4e0b\u4e00\u6b65\u8ba1\u5212'}</Title>
            {!quickPlanEditing && (
              <Button
                type="text"
                size="small"
                shape="circle"
                icon={<PlusOutlined />}
                title="新增计划"
                onClick={handleOpenQuickPlanEditor}
                style={{ color: '#1677ff', background: '#edf7ff' }}
              />
            )}
          </div>

          {/* 内联编辑器 */}
          {quickPlanEditing && (
            <div style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #b7d4ff',
              background: '#f0f7ff',
              marginBottom: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <Input
                ref={quickPlanTitleRef as any}
                value={quickPlanTitle}
                onChange={e => setQuickPlanTitle(e.target.value)}
                placeholder="计划标题"
                size="small"
                style={{ fontSize: 13 }}
                onPressEnter={() => { void handleConfirmQuickPlan(); }}
              />
              <TextArea
                value={quickPlanDesc}
                onChange={e => setQuickPlanDesc(e.target.value)}
                placeholder="计划描述（可选）"
                autoSize={{ minRows: 2, maxRows: 4 }}
                size="small"
                style={{ fontSize: 12 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button
                  type="text"
                  size="small"
                  shape="circle"
                  icon={quickPlanType === 'ai' ? <ExperimentOutlined /> : <UserOutlined />}
                  onClick={() => setQuickPlanType(quickPlanType === 'ai' ? 'manual' : 'ai')}
                  title={quickPlanType === 'ai' ? '当前为 AI 任务，点击切换为人工任务' : '当前为人工任务，点击切换为 AI 任务'}
                  aria-label={quickPlanType === 'ai' ? '切换为人工任务' : '切换为 AI 任务'}
                  style={{
                    width: 28,
                    minWidth: 28,
                    height: 28,
                    color: quickPlanType === 'ai' ? '#1677ff' : '#d46b08',
                    background: quickPlanType === 'ai' ? '#e6f4ff' : '#fff7e6',
                  }}
                />
                <Space size={6}>
                  <Button size="small" onClick={handleCancelQuickPlan}>{'取消'}</Button>
                  <Button size="small" type="primary" onClick={() => { void handleConfirmQuickPlan(); }}>{'确认'}</Button>
                </Space>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {recentPlanTasks.length === 0 && !quickPlanEditing ? (
              <div style={{ padding: '18px 12px', textAlign: 'center' }}>
                <ClockCircleOutlined style={{ fontSize: 22, color: '#bfbfbf', marginBottom: 8 }} />
                <div><Text type="secondary" style={{ fontSize: 12 }}>{'\u6682\u672a\u751f\u6210\u8ba1\u5212'}</Text></div>
              </div>
            ) : (
              recentPlanTasks.map(task => {
                const checked = task.status === 'completed';
                const color = task.priority === 'high' ? '#ff4d4f' : task.priority === 'medium' ? '#faad14' : '#52c41a';
                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    title="进入对应工作台"
                    onClick={() => openWorkflowTask(task)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openWorkflowTask(task);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #eef2f7',
                      background: checked ? '#f6ffed' : '#fafafa',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      onClick={(event) => event.stopPropagation()}
                      onChange={event => { void handleToggleTaskComplete(task, event.target.checked); }}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Button
                          type="text"
                          size="small"
                          title={task.type === 'ai' ? '当前为 AI 任务，点击切换为人工任务' : '当前为人工任务，点击切换为 AI 任务'}
                          icon={task.type === 'ai' ? <ExperimentOutlined /> : <UserOutlined />}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleTaskType(task);
                          }}
                          style={{ padding: 0, width: 18, minWidth: 18, height: 18, color: task.type === 'ai' ? '#1677ff' : '#d46b08' }}
                        />
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: color, flexShrink: 0 }} />
                        <Text strong={!checked} delete={checked} style={{ fontSize: 12, minWidth: 0 }} ellipsis={{ tooltip: task.title }}>{task.title}</Text>
                      </div>
                      {(task.description || task.workflowName || task.stageName) && (
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }} ellipsis={{ tooltip: task.description }}>
                          {task.description || task.workflowName || task.stageName}
                        </Text>
                      )}
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 3 }}>
                        点击进入{resolveWorkflowWorkbench(task) === 'report' ? '报告工作台' : resolveWorkflowWorkbench(task) === 'review' ? '审查工作台' : resolveWorkflowWorkbench(task) === 'plan' ? '计划工作台' : resolveWorkflowWorkbench(task) === 'writing' ? 'AI协同' : '团队-AI协同'}
                      </Text>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'files',
      label: '文件',
      children: (
        <div style={{ height: '100%' }}>
          {/* 可对比文件概览 */}
          <div style={{ ...summaryCardStyle, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div><Text type="secondary" style={{ fontSize: 11 }}>可对比文件</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{fileVersionEntries.length}</div></div>
              <div><Text type="secondary" style={{ fontSize: 11 }}>项目文档</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{projectDocsList.length}</div></div>
              <div><Text type="secondary" style={{ fontSize: 11 }}>版本库记录</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{projectVersions.length}</div></div>
            </div>
            {recentFileVersions.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>最近更新的可对比文件</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentFileVersions.slice(0, 4).map(version => (
                    <div key={version.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <Text style={{ fontSize: 11, minWidth: 0, display: 'block' }} ellipsis={{ tooltip: version.filePath || version.fileName }}>{version.fileName}</Text>
                        <Text type="secondary" style={{ fontSize: 10 }}>{version.stage} · {formatDateTime(version.updatedAt)}</Text>
                      </div>
                      <Space size={4} style={{ flexShrink: 0 }}>
                        <Tag color={version.source === 'doc' ? 'blue' : 'purple'} style={{ margin: 0, fontSize: 9 }}>{version.sourceLabel}</Tag>
                        <Tag style={{ margin: 0, fontSize: 9 }}>{version.fileType}</Tag>
                        {typeof version.progress === 'number' && <Tag color={version.progress >= 80 ? 'green' : version.progress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9 }}>{version.progress}%</Tag>}
                      </Space>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <Text strong style={{ fontSize: 13 }}>项目文档 ({projectDocsList.length})</Text>
            <Space size={6}>
              <Button size="small" onClick={() => openDetail('files')}>详情</Button>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                新增文件
              </Button>
            </Space>
          </div>
          {projectDocsList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupedByTemplate().map(group => {
                const sortedDocs = sortDocsByLatestActivity(group.docs);
                const latestDoc = sortedDocs[0];
                const latestProgress = latestDoc?.overallProgress ?? 0;
                const isExpanded = expandedTemplate === group.templateId;
                return (
                  <div
                    key={group.templateId}
                    style={{
                      border: '1px solid #edf0f5',
                      borderLeft: `3px solid ${isExpanded ? '#1890ff' : '#edf0f5'}`,
                      borderRadius: 8,
                      background: '#fff',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s ease, background 0.2s ease',
                    }}
                  >
                    {/* 模板标题行 */}
                    <div
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedTemplate(null);
                        } else {
                          setExpandedTemplate(group.templateId);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        background: isExpanded ? '#f8fbff' : '#fff',
                        cursor: 'pointer',
                        borderBottom: isExpanded ? '1px solid #eef4ff' : '1px solid transparent',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={6}>
                          <FileOutlined style={{ color: '#1890ff', fontSize: 13 }} />
                          <Text strong style={{ fontSize: 12 }}>{group.templateName}</Text>
                          <Tag style={{ margin: 0, fontSize: 10 }}>{group.docs.length} 份</Tag>
                        </Space>
                        <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {latestDoc && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 19 }}>
                          <Text type="secondary" style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: getDocDisplayName(latestDoc) }}>
                            最新编辑：{getDocDisplayName(latestDoc)}
                          </Text>
                          <Text style={{ fontSize: 11, minWidth: 32, color: getProgressColor(latestProgress), fontWeight: 600 }}>{latestProgress}%</Text>
                        </div>
                      )}
                    </div>
                    {/* 展开的文档列表 */}
                    <AnimatedExpand open={isExpanded} borderColor="transparent">
                      <div style={{
                        padding: '8px 10px',
                        background: '#fff',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                          <Button
                            type="link" size="small" icon={<PlusOutlined />}
                            onClick={(e) => { e.stopPropagation(); setSelectedTemplateId(group.templateId); setAddModalOpen(true); }}
                            style={{ padding: 0, fontSize: 11 }}
                          >
                            添加文件
                          </Button>
                        </div>
                        {sortedDocs.map(doc => {
                          const isLatest = latestDoc?.id === doc.id;
                          return (
                            <div
                              key={doc.id}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                marginBottom: 4,
                                background: '#fafafa',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                <Text style={{ display: 'block', flex: 1, minWidth: 0, fontSize: 11, lineHeight: '20px' }} ellipsis={{ tooltip: getDocDisplayName(doc) }}>
                                  {getDocDisplayName(doc)}
                                </Text>                                <Space size={2} style={{ flexShrink: 0 }}>
                                  <Button type="text" size="small" title={'\u91cd\u65b0\u5206\u6790'} icon={<ReloadOutlined />} loading={analyzingDocId === doc.id} onClick={() => handleAnalyze(doc, false)} style={{ padding: '0 3px' }} />
                                  <Button type="text" size="small" title={'AI\u5206\u6790'} icon={<ExperimentOutlined />} loading={analyzingDocId === doc.id} onClick={() => handleAnalyze(doc, true)} style={{ padding: '0 3px' }} />
                                  <Tag color={getProjectDocumentLifecycleColor(doc)} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>{getProjectDocumentLifecycleLabel(doc)}</Tag>
                                  {doc.completedAt ? (
                                    <Popconfirm title={'\u786e\u5b9a\u53d6\u6d88\u5b8c\u6210\u5e76\u56de\u6863\u9636\u6bb5\u8bb0\u5fc6\uff1f'} onConfirm={() => handleDocReopen(doc)} okText={'\u786e\u5b9a'} cancelText={'\u53d6\u6d88'}>
                                      <Button type="text" size="small" title={'\u53d6\u6d88\u5b8c\u6210'} icon={<CloseOutlined />} style={{ padding: '0 3px', color: '#fa8c16' }} />
                                    </Popconfirm>
                                  ) : (
                                    <Button type="text" size="small" title={'\u6807\u8bb0\u5b8c\u6210\u5e76\u5b66\u4e60'} icon={<CheckCircleOutlined />} onClick={() => handleDocComplete(doc)} style={{ padding: '0 3px', color: '#52c41a' }} />
                                  )}
                                  <Popconfirm title={'\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u6587\u6863\u8bb0\u5f55\uff1f'} onConfirm={() => deleteProjectDoc(doc.id)}>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ padding: '0 3px' }} />
                                  </Popconfirm>
                                </Space>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 3 }}>
                                <Text type="secondary" style={{ fontSize: 10, flex: 1, minWidth: 0 }}>
                                  更新：{formatDateTime(getDocActivityAt(doc))}
                                </Text>
                                <Space size={4} style={{ flexShrink: 0 }}>
                                  {isLatest && <Tag color="blue" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>最新</Tag>}
                                  <Tag color={doc.overallProgress >= 80 ? 'green' : doc.overallProgress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>{doc.overallProgress}%</Tag>
                                </Space>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AnimatedExpand>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="暂无项目文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}

          {/* 关联项目文档弹窗 */}
          <Modal
            title="关联项目文档"
            open={addModalOpen}
            onOk={handleAddDoc}
            onCancel={() => setAddModalOpen(false)}
            okText="关联并分析"
            cancelText="取消"
            width={420}
          >
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>选择模板</Text>
              <Select
                placeholder="选择文档模板（如提案表、可研报告）"
                style={{ width: '100%' }}
                value={selectedTemplateId || undefined}
                onChange={setSelectedTemplateId}
                options={templateOptions()}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>选择可对比文件</Text>
              <Select
                placeholder="选择已导入或同步的文件"
                style={{ width: '100%' }}
                value={selectedVersionId || undefined}
                onChange={setSelectedVersionId}
                options={projectVersions.map(v => ({
                  value: v.id,
                  label: `${v.fileName} (${v.fileType.toUpperCase()})`,
                }))}
              />
            </div>
            {projectVersions.length === 0 && (
              <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                请先在"文件"页面导入文档
              </Text>
            )}
          </Modal>
        </div>
      ),
    },
    {
      key: 'plan',
      label: '计划',
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <Text strong style={{ fontSize: 13 }}>阶段计划 ({planSegments.length})</Text>
            <Button size="small" onClick={() => openDetail('plan')}>详情</Button>
          </div>

          {planSegments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {planSegments.map(segment => {
                const color = stageMeta[segment.stage].color;
                const isCompleted = Boolean(segment.completedAt);
                const segDlStatus = getDlStatus(segment.deadline, segment.completedAt);
                const statusColor = segDlStatus === 'overdue' ? '#ff4d4f' : segDlStatus === 'aboutToExpire' ? '#faad14' : color;

                return (
                  <div
                    key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
                    style={{
                      padding: '10px 12px',
                      border: `1px solid ${segDlStatus === 'overdue' ? '#ffccc7' : segDlStatus === 'aboutToExpire' ? '#ffe58f' : '#f0f0f0'}`,
                      borderRadius: 8,
                      background: segDlStatus === 'overdue' ? '#fff7f6' : segDlStatus === 'aboutToExpire' ? '#fffbe6' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <Space size={6}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: statusColor, display: 'inline-block' }} />
                        <Text strong style={{ fontSize: 13 }}>{segment.label}</Text>
                        {isCompleted ? (
                          <Tag color="green" style={{ margin: 0, fontSize: 11 }}>已完成</Tag>
                        ) : segDlStatus === 'overdue' ? (
                          <Tag color="red" style={{ margin: 0, fontSize: 11 }}>逾期</Tag>
                        ) : segDlStatus === 'aboutToExpire' ? (
                          <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>即将逾期</Tag>
                        ) : (
                          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>进行中</Tag>
                        )}
                      </Space>
                      {isCompleted ? (
                        <Button size="small" onClick={() => handleStageReopen(segment)}>
                          取消完成
                        </Button>
                      ) : (
                        <Button size="small" type="primary" onClick={() => handleStageComplete(segment)}>
                          完成
                        </Button>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>文件数</Text>
                        <Text style={{ fontSize: 11 }}>{segment.sourceDocNames.length} 个</Text>
                      </div>
                      <div>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>截止时间</Text>
                        <DatePicker
                          showTime
                          allowClear
                          size="small"
                          style={{ width: '100%' }}
                          value={segment.deadline ? dayjs(segment.deadline) : null}
                          placeholder="设置计划截止时间"
                          onChange={(value) => handleStageDeadline(segment, value ? value.toDate().toISOString() : undefined)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="暂无可计划的阶段" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                新增文件
              </Button>
            </Empty>
          )}
        </div>
      ),
    },
    {
      key: 'tasks',
      label: '进度',
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>阶段进度</Text>
          <Button size="small" onClick={() => openDetail('team')}>详情</Button>
          </div>
          {planSegments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {planSegments.map(segment => {
                const color = stageMeta[segment.stage]?.color || '#8c8c8c';
                const isCompleted = Boolean(segment.completedAt);
                const isExpanded = expandedStage === segment.stage;
                const docsInStage = sortDocsByLatestActivity(projectDocsList.filter(d => segment.sourceDocIds.includes(d.id)));
                const latestDoc = docsInStage[0];
                const latestDocName = latestDoc ? getDocDisplayName(latestDoc) : '';

                const borderVisible = stageBorderVisible[segment.stage] || isExpanded;
                return (
                  <div
                    key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
                    style={{
                      border: '1px solid #edf0f5',
                      borderLeft: `3px solid ${borderVisible ? color : '#edf0f5'}`,
                      borderRadius: 8,
                      background: '#fff',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s ease, background 0.2s ease',
                    }}
                  >
                    {/* 阶段标题行 */}
                    <div
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedStage(null);
                          setTimeout(() => setStageBorderVisible(prev => ({ ...prev, [segment.stage]: false })), 550);
                        } else {
                          setExpandedStage(segment.stage);
                          setStageBorderVisible(prev => ({ ...prev, [segment.stage]: true }));
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        background: isExpanded ? '#fbfdff' : '#fff',
                        cursor: 'pointer',
                        borderBottom: isExpanded ? '1px solid #eef4ff' : '1px solid transparent',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={6}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                          <Text strong style={{ fontSize: 12 }}>{segment.label}</Text>
                          {isCompleted ? (
                            <Tag color="green" style={{ margin: 0, fontSize: 10 }}>已完成</Tag>
                          ) : (
                            <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{segment.sourceDocNames.length} 个文件</Tag>
                          )}
                        </Space>
                        <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {latestDoc && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 14 }}>
                          <Text type="secondary" style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: latestDocName }}>
                            最新编辑：{latestDocName}
                          </Text>
                          <Text style={{ fontSize: 11, color: getProgressColor(latestDoc.overallProgress), fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {latestDoc.overallProgress}%
                          </Text>
                        </div>
                      )}
                    </div>
                    {/* 展开的文档列表 */}
                    <AnimatedExpand open={isExpanded} borderColor="transparent">
                      <div style={{
                        borderRadius: '0 0 8px 8px',
                        padding: '8px 10px',
                        background: '#fff',
                      }}>
                        {docsInStage.length > 0 ? docsInStage.map((doc, idx) => {
                          const isLatest = idx === 0;
                          return (
                            <div
                              key={doc.id}
                              onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                marginBottom: idx < docsInStage.length - 1 ? 4 : 0,
                                background: selectedDocId === doc.id ? '#f5faff' : '#fafafa',
                                border: `1px solid ${selectedDocId === doc.id ? '#d6eaff' : 'transparent'}`,
                                cursor: 'pointer',
                              }}
                            >
                              <Text style={{ display: 'block', fontSize: 11, lineHeight: '20px' }} ellipsis={{ tooltip: getDocDisplayName(doc) }}>
                                {getDocDisplayName(doc)}
                              </Text>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 3 }}>
                                <Text type="secondary" style={{ fontSize: 10, flex: 1, minWidth: 0 }}>
                                  更新：{formatDateTime(getDocActivityAt(doc))}
                                </Text>
                                <Space size={4} style={{ flexShrink: 0 }}>
                                  {isLatest && <Tag color="blue" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>最新</Tag>}
                                  <Tag color={doc.overallProgress >= 80 ? 'green' : doc.overallProgress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>{doc.overallProgress}%</Tag>
                                </Space>
                              </div>
                            </div>
                          );
                        }) : (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', textAlign: 'center', padding: 8 }}>暂无文档</Text>
                        )}
                      </div>
                    </AnimatedExpand>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <ExclamationCircleOutlined style={{ fontSize: 32, color: '#d9d9d9', marginBottom: 12 }} />
              <div>
                <Text type="secondary" style={{ fontSize: 13 }}>暂无阶段数据</Text>
              </div>
              <Button type="link" size="small" onClick={() => setAddModalOpen(true)} style={{ marginTop: 8 }}>
                新增文件
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'members',
      label: '团队',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>团队协同</Text>
            <Button size="small" type="primary" onClick={() => openDetail('team')}>详情</Button>
          </div>
          <div style={summaryCardStyle}>
            <Text type="secondary" style={{ fontSize: 12 }}>阶段、审查和任务在这里汇总，方便判断下一步该谁推进什么。</Text>
          </div>
          <Text strong style={{ fontSize: 13 }}>AI协同</Text>
          <div style={{ ...summaryCardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Select
              placeholder="选择模板"
              size="small"
              style={{ width: '100%' }}
              value={selectedWritingTemplateId || undefined}
              onChange={setSelectedWritingTemplateId}
              options={templates.map(t => ({ value: t.id, label: t.name }))}
            />
            {selectedWritingTemplateId && (
              <>
                <Select
                  mode="multiple"
                  placeholder="导入文稿参考（可多选）"
                  size="small"
                  style={{ width: '100%' }}
                  value={selectedWritingDocIds}
                  onChange={setSelectedWritingDocIds}
                  options={projectDocsList.map(d => ({ value: d.id, label: d.name }))}
                  maxTagCount={2}
                  maxTagTextLength={12}
                />
                <Space size={4}>
                  <Button size="small" onClick={() => handleBatchImportDocs(selectedWritingDocIds)} disabled={selectedWritingDocIds.length === 0}>
                    导入选中文档
                  </Button>
                  <Button size="small" onClick={handleImportAllDocs} disabled={projectDocsList.length === 0}>
                    导入全部文档
                  </Button>
                </Space>
                <TextArea
                  value={writingContent}
                  onChange={(e) => setWritingContent(e.target.value)}
                  placeholder="在此编写文档内容..."
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  style={{ fontSize: 12 }}
                />
                <Button type="primary" size="small" block onClick={handleQuickExport} disabled={!writingContent.trim()}>
                  导出 Word
                </Button>
              </>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'report',
      label: '报告',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 统计概览 */}
          <div style={summaryCardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div><Text type="secondary" style={{ fontSize: 11 }}>已分析文档</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{totalAnalyzed}</div></div>
              <div><Text type="secondary" style={{ fontSize: 11 }}>分析阶段</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{analyzedDocsByStage.length}</div></div>
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>未读报告</Text>
                <div style={{ fontSize: 20, fontWeight: 700, color: totalUnread > 0 ? '#ff4d4f' : undefined }}>{totalUnread}</div>
              </div>
            </div>
          </div>

          {/* 按阶段分组的报告列表 */}
          {analyzedDocsByStage.length > 0 ? analyzedDocsByStage.map(group => {
            const color = stageMeta[group.stage]?.color || '#8c8c8c';
            const isExpanded = expandedReportStage === group.stage;
            return (
              <div key={group.stage} style={{
                border: '1px solid #edf0f5',
                borderLeft: `3px solid ${isExpanded ? color : '#edf0f5'}`,
                borderRadius: 8,
                background: '#fff',
                overflow: 'hidden',
                transition: 'border-color 0.2s ease',
              }}>
                {/* 阶段标题行 */}
                <div
                  onClick={() => setExpandedReportStage(isExpanded ? null : group.stage)}
                  style={{
                    padding: '8px 10px',
                    background: isExpanded ? '#fbfdff' : '#fff',
                    cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid #eef4ff' : '1px solid transparent',
                    transition: 'background 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Space size={6}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                      <Text strong style={{ fontSize: 12 }}>{stageMeta[group.stage]?.label || group.stage}</Text>
                      <Tag style={{ margin: 0, fontSize: 10 }}>{group.docs.length} 份</Tag>
                      {group.hasUnread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff4d4f', display: 'inline-block' }} />}
                    </Space>
                    <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </div>
                </div>
                {/* 展开的报告列表 */}
                <AnimatedExpand open={isExpanded} borderColor="transparent">
                  <div style={{ padding: '6px 10px', background: '#fff' }}>
                    {group.docs.map(doc => {
                      const isRead = readReportIds.has(doc.id);
                      return (
                        <div
                          key={doc.id}
                          onClick={() => {
                            if (!isRead) setReadReportIds(prev => new Set(prev).add(doc.id));
                          }}
                          onDoubleClick={() => {
                            useProjectStore.getState().setPendingReportDocId(doc.id);
                            useProjectStore.getState().setPendingReportDocOnly(true);
                            openDetail('report');
                          }}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 6,
                            marginBottom: 4,
                            background: isRead ? '#fafafa' : '#f5faff',
                            border: `1px solid ${isRead ? 'transparent' : '#d6eaff'}`,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease, border-color 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {!isRead && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', flexShrink: 0 }} />}
                            <Text style={{ display: 'block', flex: 1, minWidth: 0, fontSize: 11, lineHeight: '20px' }} ellipsis={{ tooltip: doc.name }}>
                              {doc.name}
                            </Text>
                            <Tag color={doc.overallProgress >= 80 ? 'green' : doc.overallProgress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>
                              {doc.overallProgress}%
                            </Tag>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: isRead ? 0 : 12 }}>
                            <Text type="secondary" style={{ fontSize: 10, flex: 1 }}>
                              章节 {doc.sections.filter(s => s.status === 'completed').length}/{doc.sections.length} 完成
                            </Text>
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              {dayjs(doc.analyzedAt).format('MM-DD HH:mm')}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AnimatedExpand>
              </div>
            );
          }) : (
            <div style={summaryCardStyle}>
              <Text type="secondary" style={{ fontSize: 12 }}>暂无分析报告，在「文件」Tab 中点击分析按钮生成。</Text>
            </div>
          )}

          <Button size="small" block onClick={() => {
            useProjectStore.getState().setPendingReportDocId(null);
            useProjectStore.getState().setPendingReportDocOnly(false);
            openDetail('report');
          }}>进入报告工作台</Button>
        </div>
      ),
    },
    {
      key: 'review',
      label: '\u5ba1\u67e5',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>{'\u5ba1\u67e5'}</Text>
            <Button size="small" type="primary" onClick={() => openDetail('review')}>{'\u8be6\u60c5'}</Button>
          </div>

          {!latestReview ? (
            <div style={summaryCardStyle}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0\u5ba1\u67e5\u8bb0\u5f55'} />
              <Text type="secondary" style={{ display: 'block', fontSize: 12, textAlign: 'center', marginTop: -4 }}>
                {'\u8fdb\u5165\u5ba1\u67e5\u5de5\u4f5c\u53f0\u540e\uff0c\u53ef\u6309\u9636\u6bb5\u9009\u62e9\u6a21\u677f\u548c\u6587\u4ef6\u751f\u6210\u5ba1\u67e5\u7ed3\u679c\u3002'}
              </Text>
            </div>
          ) : (
            <>
              <div style={summaryCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Progress
                    type="circle"
                    percent={latestReview.score}
                    size={58}
                    strokeColor={getReviewScoreColor(latestReview.score)}
                    format={(percent) => `${percent || 0}`}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 13 }}>{'\u6700\u65b0\u5ba1\u67e5\u7ed3\u679c'}</Text>
                      <Tag color={latestReview.score >= 80 ? 'green' : latestReview.score >= 60 ? 'orange' : 'red'} style={{ margin: 0, fontSize: 10 }}>
                        {latestReview.score} {'\u5206'}
                      </Tag>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {formatDateTime(latestReview.createdAt)} {'\u00b7'} {'\u95ee\u9898'} {latestReviewIssues.length} {'\u4e2a'}
                    </Text>
                    <Space size={4} wrap style={{ marginTop: 6 }}>
                      <Tag color="red" style={{ margin: 0, fontSize: 10 }}>{'\u4e25\u91cd'} {reviewErrorCount}</Tag>
                      <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>{'\u63d0\u9192'} {reviewWarningCount}</Tag>
                      <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{'\u8bb0\u5f55'} {projectReviews.length}</Tag>
                    </Space>
                  </div>
                </div>
                {latestReview.summary && (
                  <Paragraph type="secondary" ellipsis={{ rows: 2, tooltip: latestReview.summary }} style={{ fontSize: 12, margin: '10px 0 0' }}>
                    {latestReview.summary}
                  </Paragraph>
                )}
              </div>

              <div style={summaryCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>{'\u5ba1\u67e5\u5f85\u529e'}</Text>
                  <Tag color={pendingReviewTaskCount > 0 ? 'red' : 'green'} style={{ margin: 0, fontSize: 10 }}>
                    {pendingReviewTaskCount}/{reviewTasks.length}
                  </Tag>
                </div>
                {reviewTaskPreview.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0\u5ba1\u67e5\u5f85\u529e'} />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {reviewTaskPreview.map(task => {
                      const checked = task.status === 'completed';
                      const color = task.priority === 'high' ? '#ff4d4f' : task.priority === 'medium' ? '#faad14' : '#52c41a';
                      return (
                        <div
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openWorkflowTask(task)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openWorkflowTask(task);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '7px 8px',
                            borderRadius: 6,
                            border: '1px solid #eef2f7',
                            background: checked ? '#f6ffed' : '#fafafa',
                            cursor: 'pointer',
                          }}
                        >
                          <Checkbox
                            checked={checked}
                            onClick={(event) => event.stopPropagation()}
                            onChange={event => { void handleToggleTaskComplete(task, event.target.checked); }}
                            style={{ marginTop: 2 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: 2, background: color, flexShrink: 0 }} />
                              <Text strong={!checked} delete={checked} style={{ fontSize: 12, minWidth: 0 }} ellipsis={{ tooltip: task.title }}>{task.title}</Text>
                            </div>
                            {(task.sectionTitle || task.description) && (
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }} ellipsis={{ tooltip: task.description || task.sectionTitle }}>
                                {task.sectionTitle || task.description}
                              </Text>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {reviewTasks.length > reviewTaskPreview.length && (
                      <Button size="small" type="link" onClick={() => openDetail('review')} style={{ padding: 0, height: 20 }}>
                        {'\u67e5\u770b\u5168\u90e8'} {reviewTasks.length} {'\u4e2a\u5ba1\u67e5\u5f85\u529e'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <Button size="small" block onClick={() => openDetail('review')}>{'\u8fdb\u5165\u5ba1\u67e5\u5de5\u4f5c\u53f0'}</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="detail-panel detail-panel-polished detail-panel-ready" style={{ padding: '16px 18px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className="detail-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, background: '#e6f7ff', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FolderOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Title level={5} title={currentProject.name} ellipsis style={{ margin: 0, fontSize: 15, maxWidth: 260 }}>{currentProject.name}</Title>
          </div>
        </div>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          size="small"
          style={{ transition: 'transform 0.15s ease, background 0.15s ease' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'rotate(90deg)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'rotate(0deg)'; }}
        />
      </div>

      {contentReady ? (
        <Tabs className="detail-panel-tabs detail-panel-tabs-polished" activeKey={activeTab} onChange={setActiveTab} items={tabItems} size="small" style={{ flex: 1, overflow: 'hidden' }} animated={false} />
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['概览', '文件', '计划'].map(t => (
              <div key={t} className="skeleton-loading" style={{ width: 48, height: 28, borderRadius: 6 }} />
            ))}
          </div>
          <div className="skeleton-loading" style={{ flex: 1, borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
};

export default DetailPanel;

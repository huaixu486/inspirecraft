import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Typography } from 'antd';
import StatsCards from './StatsCards';
import GanttChart from './GanttChart';
import ProjectTable from './ProjectTable';
import DetailPanel from './DetailPanel';
import DeferredBlock from './DeferredBlock';
import { SegmentsContext } from './SegmentsContext';
import { Project, ProjectDocument, DocumentVersion } from '../../../shared/types';
import type { ProjectDetailPage } from './DetailPanel';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildProjectStageSegments, getAllStages, TimelineStageSegment } from '../../utils/timelineStages';

const { Text } = Typography;
// 必须与 styles.css 的 --overview-detail-*-duration 保持一致；
// 状态提前结束会让甘特图在尺寸动画尚未完成时重新测量并造成卡顿。
const DETAIL_PANEL_OPEN_MS = 420;
const DETAIL_PANEL_CLOSE_MS = 420;
const DETAIL_PANEL_OPEN_START_DELAY_MS = 16;
// 主页先开始收缩，侧边窗随后跟进；与 styles.css 中的 rail delay 保持一致。
const DETAIL_RAIL_OPEN_DELAY_MS = 48;

const StatsSkeleton = () => (
  <div style={{ display: 'flex', gap: 12, maxWidth: '100%', boxSizing: 'border-box' }}>
    {[1, 2, 3, 4].map(i => (
      <div key={i} className="skeleton-loading" style={{ flex: 1, height: 80, borderRadius: 12 }} />
    ))}
  </div>
);

const GanttSkeleton = () => (
  <div className="skeleton-loading" style={{ height: 200, borderRadius: 12, maxWidth: '100%', boxSizing: 'border-box' }} />
);

const TableSkeleton = () => (
  <div className="skeleton-loading" style={{ height: 300, borderRadius: 12, maxWidth: '100%', boxSizing: 'border-box' }} />
);

interface Props {
  visible?: boolean;
  onEnterProject: (project: Project, initialTab?: string, snapshot?: { wasOpen: boolean; projectId?: string } | null) => void;
  panelInitialTab?: string;
  onOpenProjectDetail?: (page: ProjectDetailPage) => void;
}

const Overview: React.FC<Props> = ({ visible, onEnterProject, panelInitialTab, onOpenProjectDetail }) => {
  const currentProject = useProjectStore((state) => state.currentProject);
  const projects = useProjectStore(s => s.projects);
  const versions = useProjectStore(s => s.versions);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const templates = useTemplateStore(s => s.templates);
  const customStages = useSettingsStore(s => s.customStages);
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);

  // 侧边窗开合状态：Rail 用 transform:translateX 滑入（零 reflow），主页用 width 同步收缩。
  // 从项目工作台返回时 currentProject 仍然存在。首帧就恢复分栏布局，
  // 让主页与侧边窗骨架同时按正确宽度显示，而不是先闪出全宽骨架再收缩。
  const [panelOpen, setPanelOpen] = useState(() => Boolean(currentProject));
  const [panelVisible, setPanelVisible] = useState(() => Boolean(currentProject));
  const [panelTransitioning, setPanelTransitioning] = useState(false);
  const [panelOpening, setPanelOpening] = useState(false);
  const [panelClosing, setPanelClosing] = useState(false);
  const [panelSwitching, setPanelSwitching] = useState(false);
  const [panelProject, setPanelProject] = useState<Project | null>(currentProject);
  const [panelIntentProject, setPanelIntentProject] = useState<Project | null>(currentProject);
  const mainRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number>(0);
  const openFrameRef = useRef<number>(0);
  const panelTransitionTimerRef = useRef<number>(0);
  const panelSwitchTimerRef = useRef<number>(0);
  const prevProjectIdRef = useRef<string | null>(null);
  const previewHandledProjectIdRef = useRef<string | null>(null);

  // 双击进入文件详情前，捕获当前侧边窗状态作为快照
  const handleEnterProject = React.useCallback((project: Project, initialTab?: string) => {
    const snapshot = {
      wasOpen: panelOpen || panelVisible,
      projectId: panelProject?.id,
    };
    onEnterProject(project, initialTab, snapshot);
  }, [onEnterProject, panelOpen, panelVisible, panelProject?.id]);

  useEffect(() => {
    if (currentProject?.id && previewHandledProjectIdRef.current === currentProject.id) {
      previewHandledProjectIdRef.current = null;
      return;
    }
    setPanelIntentProject(currentProject);
  }, [currentProject?.id]);

  // The rail keeps its own project object while opening/closing to avoid a
  // visual jump.  Keep that object fresh for in-place updates (description,
  // status, progress, etc.); previously it only refreshed when the project ID
  // changed, so edits to the selected project remained visibly stale.
  useEffect(() => {
    if (!currentProject || panelProject?.id !== currentProject.id) return;
    setPanelProject(currentProject);
  }, [currentProject, panelProject?.id]);

  const cancelPendingPanelOpen = React.useCallback(() => {
    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = 0;
    }
  }, []);

  const schedulePanelOpen = React.useCallback(() => {
    cancelPendingPanelOpen();
    openFrameRef.current = window.requestAnimationFrame(() => {
      setPanelOpen(true);
      openFrameRef.current = 0;
    });
  }, [cancelPendingPanelOpen]);

  const previewProjectInPanel = React.useCallback((project: Project) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = 0;
    }
    cancelPendingPanelOpen();
    if (panelTransitionTimerRef.current) {
      window.clearTimeout(panelTransitionTimerRef.current);
      panelTransitionTimerRef.current = 0;
    }
    if (panelSwitchTimerRef.current) {
      window.clearTimeout(panelSwitchTimerRef.current);
      panelSwitchTimerRef.current = 0;
    }

    const layoutWillChange = !panelOpen;
    prevProjectIdRef.current = project.id;
    previewHandledProjectIdRef.current = project.id;

    setPanelIntentProject(project);
    setPanelProject(project);
    setPanelVisible(true);
    setPanelClosing(false);
    setPanelSwitching(false);

    if (layoutWillChange) {
      setPanelTransitioning(true);
      setPanelOpening(true);
      setPanelOpen(false);
      schedulePanelOpen();
      panelTransitionTimerRef.current = window.setTimeout(() => {
        setPanelTransitioning(false);
        setPanelOpening(false);
        setPanelClosing(false);
        panelTransitionTimerRef.current = 0;
      }, DETAIL_PANEL_OPEN_START_DELAY_MS + DETAIL_RAIL_OPEN_DELAY_MS + DETAIL_PANEL_OPEN_MS);
    } else {
      setPanelOpen(true);
      setPanelOpening(false);
    }
  }, [cancelPendingPanelOpen, panelOpen, schedulePanelOpen]);

  React.useLayoutEffect(() => {
    if (panelIntentProject?.id && previewHandledProjectIdRef.current === panelIntentProject.id) {
      return;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = 0;
    }
    cancelPendingPanelOpen();

    const nextOpen = Boolean(panelIntentProject);
    const layoutWillChange = nextOpen !== panelOpen;
    if (layoutWillChange) {
      if (panelTransitionTimerRef.current) {
        window.clearTimeout(panelTransitionTimerRef.current);
        panelTransitionTimerRef.current = 0;
      }
      setPanelTransitioning(true);
      setPanelOpening(nextOpen);
      setPanelClosing(!nextOpen);
      panelTransitionTimerRef.current = window.setTimeout(() => {
        setPanelTransitioning(false);
        setPanelOpening(false);
        setPanelClosing(false);
        panelTransitionTimerRef.current = 0;
      }, nextOpen
        ? DETAIL_PANEL_OPEN_START_DELAY_MS + DETAIL_RAIL_OPEN_DELAY_MS + DETAIL_PANEL_OPEN_MS
        : DETAIL_PANEL_CLOSE_MS);
    }

    if (panelIntentProject) {
      prevProjectIdRef.current = panelIntentProject.id;
      if (panelSwitchTimerRef.current) {
        window.clearTimeout(panelSwitchTimerRef.current);
        panelSwitchTimerRef.current = 0;
      }
      setPanelSwitching(false);
      setPanelProject(panelIntentProject);
      setPanelVisible(true);
      setPanelClosing(false);
      if (layoutWillChange) {
        setPanelOpen(false);
        schedulePanelOpen();
      } else {
        setPanelOpen(true);
      }
    } else {
      if (panelSwitchTimerRef.current) {
        window.clearTimeout(panelSwitchTimerRef.current);
        panelSwitchTimerRef.current = 0;
      }
      setPanelSwitching(false);
      setPanelOpening(false);
      setPanelClosing(true);
      setPanelOpen(false);
      closeTimerRef.current = window.setTimeout(() => {
        setPanelVisible(false);
        setPanelProject(null);
        setPanelClosing(false);
        closeTimerRef.current = 0;
      }, DETAIL_PANEL_CLOSE_MS);
    }
  }, [cancelPendingPanelOpen, panelIntentProject?.id, schedulePanelOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = 0;
      }
      cancelPendingPanelOpen();
      if (panelTransitionTimerRef.current) {
        window.clearTimeout(panelTransitionTimerRef.current);
        panelTransitionTimerRef.current = 0;
      }
      if (panelSwitchTimerRef.current) {
        window.clearTimeout(panelSwitchTimerRef.current);
        panelSwitchTimerRef.current = 0;
      }
    };
  }, []);

  const segmentsByProject = useMemo(() => {
    const map = new Map<string, TimelineStageSegment[]>();
    for (const project of projects) {
      map.set(
        project.id,
        buildProjectStageSegments(
          project,
          projectDocs.filter(d => d.projectId === project.id),
          templates,
          versions.filter(v => v.projectId === project.id),
          allStages,
        ),
      );
    }
    return map;
  }, [projects, projectDocs, templates, versions, allStages]);

  return (
    <SegmentsContext.Provider value={segmentsByProject}>
    <div className={`overview-shell overview-shell-polished${panelOpen ? ' overview-main-pushed' : ''}${panelClosing ? ' overview-main-closing' : ''}${panelVisible ? ' overview-shell-with-detail' : ''}${panelTransitioning ? ' overview-shell-detail-transitioning' : ''}`} style={{ height: '100%', position: 'relative', display: 'flex', overflow: 'hidden' }}>
      <div
        ref={mainRef}
        className="overview-main"
        style={{
          height: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
          minWidth: 0,
          paddingRight: 0,
          position: 'relative',
        }}
      >
        <div
          className="overview-main-inner"
        >
          <div className="overview-header overview-header-polished animate-slide-up" style={{ marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: 0 }}>项目总览</div>
              <Text type="secondary" style={{ fontSize: 13 }}>双击项目进入文件详情，单击项目打开项目侧边窗</Text>
            </div>
          </div>
          <DeferredBlock skeleton={<StatsSkeleton />} delayMs={0}>
            <StatsCards onSelectProject={previewProjectInPanel} />
          </DeferredBlock>
          <div style={{ marginTop: 18 }}>
            <DeferredBlock skeleton={<GanttSkeleton />} delayMs={50}>
              <GanttChart
                isActive={visible}
                layoutTransitioning={panelTransitioning}
              />
            </DeferredBlock>
          </div>
          <div style={{ marginTop: 18 }}>
            <DeferredBlock skeleton={<TableSkeleton />} delayMs={100}>
              <ProjectTable onEnterProject={handleEnterProject} onPreviewProject={previewProjectInPanel} />
            </DeferredBlock>
          </div>
        </div>
        <div className="overview-motion-veil" aria-hidden="true" />
      </div>
      {/* 侧边窗常驻 DOM：absolute 右栏，transform 滑入（零 reflow） */}
      <aside
        className={`overview-detail-rail${panelVisible ? ' detail-rail-mounted' : ''}${panelOpen ? ' detail-rail-open' : ' detail-rail-closed'}${panelOpening ? ' detail-rail-opening' : ''}${panelClosing ? ' detail-rail-closing' : ''}${panelSwitching ? ' detail-rail-switching' : ''}`}
        style={{
          zIndex: 10,
          overflow: 'hidden',
          visibility: panelVisible ? 'visible' : 'hidden',
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
      >
        <DetailPanel
          project={panelProject}
          isOpen={panelOpen}
          isOpening={panelOpening}
          isSwitching={panelSwitching}
          initialTab={panelInitialTab}
          onOpenDetail={onOpenProjectDetail}
          onClose={() => {
            setPanelIntentProject(null);
            useProjectStore.getState().setCurrentProject(null);
          }}
        />
      </aside>
    </div>
    </SegmentsContext.Provider>
  );
};

export default Overview;

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

const StatsSkeleton = () => (
  <div style={{ display: 'flex', gap: 12 }}>
    {[1, 2, 3, 4].map(i => (
      <div key={i} className="skeleton-loading" style={{ flex: 1, height: 80, borderRadius: 12 }} />
    ))}
  </div>
);

const GanttSkeleton = () => (
  <div className="skeleton-loading" style={{ height: 200, borderRadius: 12 }} />
);

const TableSkeleton = () => (
  <div className="skeleton-loading" style={{ height: 300, borderRadius: 12 }} />
);

interface Props {
  visible?: boolean;
  onEnterProject: (project: Project, initialTab?: string) => void;
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

  // 侧边窗开合状态：与 currentProject 联动，但独立控制动画
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false); // DOM 是否可见（含退出动画）
  const closeTimerRef = useRef<number>(0);
  const prevProjectIdRef = useRef<string | null>(null);
  const isSwitchingRef = useRef(false); // 切换项目 vs 首次打开

  useEffect(() => {
    if (currentProject) {
      // 打开或切换项目
      isSwitchingRef.current = panelOpen && prevProjectIdRef.current !== currentProject.id;
      prevProjectIdRef.current = currentProject.id;
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = 0; }
      setPanelVisible(true);
      // 用 rAF 确保 DOM 已渲染后再触发动画
      requestAnimationFrame(() => setPanelOpen(true));
    } else {
      // 关闭：先播放退出动画，再隐藏 DOM
      setPanelOpen(false);
      closeTimerRef.current = window.setTimeout(() => {
        setPanelVisible(false);
        closeTimerRef.current = 0;
      }, 350); // 与 CSS transition 时长匹配
    }
    return () => { if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = 0; } };
  }, [currentProject?.id]);

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
    <div className={`overview-shell overview-shell-polished${panelOpen ? ' overview-shell-with-detail' : ''}`} style={{ height: '100%', position: 'relative', display: 'flex', overflow: 'hidden' }}>
      <div
        className="overview-main"
        style={{
          height: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
          flex: '1 1 auto',
          minWidth: 0,
          paddingRight: panelOpen ? 430 : 0,
          transition: 'padding-right 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div className="overview-header overview-header-polished animate-slide-up" style={{ marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: 0 }}>项目总览</div>
            <Text type="secondary" style={{ fontSize: 13 }}>双击项目进入文件详情，单击项目打开项目侧边窗</Text>
          </div>
        </div>
        <DeferredBlock skeleton={<StatsSkeleton />} delayMs={0}>
          <StatsCards />
        </DeferredBlock>
        <div style={{ marginTop: 18 }}>
          <DeferredBlock skeleton={<GanttSkeleton />} delayMs={50}>
            <GanttChart isActive={visible} />
          </DeferredBlock>
        </div>
        <div style={{ marginTop: 18 }}>
          <DeferredBlock skeleton={<TableSkeleton />} delayMs={100}>
            <ProjectTable onEnterProject={onEnterProject} />
          </DeferredBlock>
        </div>
      </div>
      {/* 侧边窗常驻 DOM：absolute 浮层，不挤压主区域 */}
      <aside
        className={`overview-detail-rail${panelOpen ? ' detail-rail-open' : ' detail-rail-closed'}${isSwitchingRef.current ? ' detail-rail-switching' : ''}`}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 420,
          zIndex: 10,
          overflow: 'hidden',
          borderRadius: '14px 0 0 14px',
          visibility: panelVisible ? 'visible' : 'hidden',
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
      >
        <DetailPanel
          project={currentProject}
          isOpen={panelOpen}
          isSwitching={isSwitchingRef.current}
          initialTab={panelInitialTab}
          onOpenDetail={onOpenProjectDetail}
          onClose={() => useProjectStore.getState().setCurrentProject(null)}
        />
      </aside>
    </div>
    </SegmentsContext.Provider>
  );
};

export default Overview;



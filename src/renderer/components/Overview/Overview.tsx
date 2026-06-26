import React from 'react';
import { Typography } from 'antd';
import StatsCards from './StatsCards';
import GanttChart from './GanttChart';
import ProjectTable from './ProjectTable';
import DetailPanel from './DetailPanel';
import { Project } from '../../../shared/types';
import type { ProjectDetailPage } from './DetailPanel';
import { useProjectStore } from '../../stores/projectStore';

const { Text } = Typography;

interface Props {
  onEnterProject: (project: Project, initialTab?: string) => void;
  panelInitialTab?: string;
  onOpenProjectDetail?: (page: ProjectDetailPage) => void;
}

const Overview: React.FC<Props> = ({ onEnterProject, panelInitialTab, onOpenProjectDetail }) => {
  const currentProject = useProjectStore((state) => state.currentProject);

  return (
    <div className="overview-shell overview-shell-polished" style={{ height: '100%', position: 'relative', display: 'flex', overflow: 'hidden' }}>
      <div
        className="overview-main"
        style={{
          height: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
          flex: '1 1 auto',
          minWidth: 0,
          transition: 'width 0.2s ease, flex-basis 0.2s ease',
          paddingRight: 0,
        }}
      >
        <div className="overview-header overview-header-polished animate-slide-up" style={{ marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: 0 }}>项目总览</div>
            <Text type="secondary" style={{ fontSize: 13 }}>双击项目进入文件详情，单击项目打开项目侧边窗</Text>
          </div>
        </div>
        <StatsCards />
        <div style={{ marginTop: 18 }}>
          <GanttChart />
        </div>
        <div style={{ marginTop: 18 }}>
          <ProjectTable onEnterProject={onEnterProject} />
        </div>
      </div>
      {currentProject && (
        <aside
          className="overview-detail-rail animate-slide-in-right"
          style={{
            width: 420,
            flex: '0 0 420px',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          <DetailPanel initialTab={panelInitialTab} onOpenDetail={onOpenProjectDetail} />
        </aside>
      )}
    </div>
  );
};

export default Overview;

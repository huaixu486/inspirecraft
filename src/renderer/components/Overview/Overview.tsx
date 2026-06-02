import React from 'react';
import { Typography } from 'antd';
import StatsCards from './StatsCards';
import GanttChart from './GanttChart';
import ProjectTable from './ProjectTable';
import DetailPanel from './DetailPanel';
import { useProjectStore } from '../../stores/projectStore';

const { Text } = Typography;

const Overview: React.FC = () => {
  const { currentProject } = useProjectStore();

  return (
    <div className="overview-shell" style={{ display: 'flex', height: '100%' }}>
      {/* Left main content */}
      <div className="overview-main" style={{ flex: 1, overflow: 'auto' }}>
        {/* Top title bar */}
        <div className="overview-header" style={{ marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: 0 }}>项目总览</div>
            <Text type="secondary" style={{ fontSize: 13 }}>掌控全局，推进每个项目的成功</Text>
          </div>
        </div>

        {/* Stats cards */}
        <StatsCards />

        {/* Gantt chart timeline */}
        <div style={{ marginTop: 18 }}>
          <GanttChart />
        </div>

        {/* Project table */}
        <div style={{ marginTop: 18 }}>
          <ProjectTable />
        </div>
      </div>

      {/* Right detail panel */}
      <div className="overview-detail-rail" style={{
        width: currentProject ? 360 : 0,
        borderLeft: currentProject ? '1px solid rgba(226, 232, 240, 0.82)' : 'none',
        overflow: 'hidden',
        background: currentProject ? 'rgba(255, 255, 255, 0.72)' : 'transparent',
        transition: 'width 0.2s',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <DetailPanel />
      </div>

    </div>
  );
};

export default Overview;

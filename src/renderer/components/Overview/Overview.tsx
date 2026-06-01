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
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left main content */}
      <div style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
        {/* Top title bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}>项目总览</div>
          <Text type="secondary" style={{ fontSize: 13 }}>掌控全局，推进每个项目的成功</Text>
        </div>

        {/* Stats cards */}
        <StatsCards />

        {/* Gantt chart timeline */}
        <div style={{ marginTop: 16 }}>
          <GanttChart />
        </div>

        {/* Project table */}
        <div style={{ marginTop: 16 }}>
          <ProjectTable />
        </div>
      </div>

      {/* Right detail panel */}
      <div style={{
        width: currentProject ? 340 : 0,
        borderLeft: currentProject ? '1px solid #f0f0f0' : 'none',
        overflow: 'hidden',
        background: '#fff',
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


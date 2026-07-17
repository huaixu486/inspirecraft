import React from 'react';
import { Space, Tag, Typography } from 'antd';

const { Title, Text } = Typography;

interface ProjectOverviewStatsProps {
  status: {
    color: string;
    label: string;
  };
  createdAtLabel: string;
  fileVersionCount: number;
  documentCount: number;
  extractionCount: number;
  completedStagePercent: number;
  activeStagePercent: number;
}

const StageProgressLinearBar = React.memo(({ percent }: { percent: number }) => {
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

const ProjectOverviewStats: React.FC<ProjectOverviewStatsProps> = ({
  status,
  createdAtLabel,
  fileVersionCount,
  documentCount,
  extractionCount,
  completedStagePercent,
  activeStagePercent,
}) => (
  <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
        <Tag color={status.color} style={{ margin: 0, fontSize: 11 }}>{status.label}</Tag>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>创建时间</Text>
        <Text style={{ fontSize: 12 }}>{createdAtLabel}</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>文件版本</Text>
        <Text style={{ fontSize: 12 }}>{fileVersionCount} 个</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>关联文档</Text>
        <Text style={{ fontSize: 12 }}>{documentCount} 份</Text>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>提炼数</Text>
        <Text style={{ fontSize: 12 }}>{extractionCount} 条</Text>
      </div>
    </div>

    <Title level={5} style={{ fontSize: 14, marginBottom: 12 }}>阶段完成度</Title>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      <StageProgressLinearBar percent={completedStagePercent} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space size={4}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#52c41a', display: 'inline-block' }} />
            <Text style={{ fontSize: 12 }}>已完成</Text>
          </Space>
          <Text style={{ fontSize: 12 }}>{completedStagePercent}%</Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space size={4}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#1890ff', display: 'inline-block' }} />
            <Text style={{ fontSize: 12 }}>进行中</Text>
          </Space>
          <Text style={{ fontSize: 12 }}>{activeStagePercent}%</Text>
        </div>
      </div>
    </div>
  </>
);

export default ProjectOverviewStats;

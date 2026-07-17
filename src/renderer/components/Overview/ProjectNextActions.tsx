import React from 'react';
import { Tag, Typography } from 'antd';
import {
  BookOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DiffOutlined,
  EditOutlined,
  FileTextOutlined,
  RightOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ProjectNextAction } from '../../utils/projectNextActions';

const { Title, Text } = Typography;

const ACTION_KIND_ICON: Record<string, React.ReactNode> = {
  task: <CheckCircleOutlined style={{ color: '#1677ff' }} />,
  review: <WarningOutlined style={{ color: '#ff4d4f' }} />,
  document: <FileTextOutlined style={{ color: '#722ed1' }} />,
  stage: <CalendarOutlined style={{ color: '#13c2c2' }} />,
  diff: <DiffOutlined style={{ color: '#faad14' }} />,
  memory: <BookOutlined style={{ color: '#52c41a' }} />,
  description: <EditOutlined style={{ color: '#8c8c8c' }} />,
};

interface ProjectNextActionsProps {
  actions: ProjectNextAction[];
  onOpen: (action: ProjectNextAction) => void;
}

const ProjectNextActions: React.FC<ProjectNextActionsProps> = ({ actions, onOpen }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Title level={5} style={{ fontSize: 14, margin: 0 }}>下一步行动</Title>
      <Tag color="default" style={{ margin: 0, fontSize: 10 }}>{actions.length} 项</Tag>
    </div>
    {actions.length === 0 ? (
      <Text type="secondary" style={{ fontSize: 12 }}>当前项目没有待推进事项</Text>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actions.map(action => (
          <div
            key={action.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(action)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(action);
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
);

export default ProjectNextActions;

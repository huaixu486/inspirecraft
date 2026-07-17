import React from 'react';
import { Card, Empty, List, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, RollbackOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { canRestoreCollaborationActivity, type CollaborationActivity } from '../../../stores/collaborationActivityStore';

const { Text } = Typography;

interface ExecutionHistoryProps {
  activities: CollaborationActivity[];
  onRestore: (activity: CollaborationActivity) => void;
}

const kindMeta: Record<CollaborationActivity['kind'], { label: string; color: string; icon: React.ReactNode }> = {
  friend: { label: '好友协作', color: 'blue', icon: <TeamOutlined /> },
  'ai-writing': { label: 'AI 写作', color: 'purple', icon: <EditOutlined /> },
  'ai-revision': { label: 'AI 修订', color: 'cyan', icon: <EditOutlined /> },
};

const ExecutionHistory: React.FC<ExecutionHistoryProps> = ({ activities, onRestore }) => (
  <Card
    title="协作动态"
    extra={<Text type="secondary" style={{ fontSize: 11 }}>最多保留 100 条</Text>}
    size="small"
    className="team-side-card team-activity-card"
  >
    {activities.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无好友协作或 AI 写作记录" /> : (
      <List
        size="small"
        dataSource={activities}
        renderItem={item => {
          const meta = kindMeta[item.kind];
          const restorable = canRestoreCollaborationActivity(item);
          return (
            <List.Item
              className={`team-activity-item${restorable ? ' is-restorable' : ''}`}
              role={restorable ? 'button' : undefined}
              tabIndex={restorable ? 0 : undefined}
              title={restorable ? '点击恢复本次提示词和生成内容' : undefined}
              onClick={restorable ? () => onRestore(item) : undefined}
              onKeyDown={restorable ? event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onRestore(item);
              } : undefined}
            >
              <Space align="start" size={9}>
                <span className={`team-activity-icon team-activity-icon-${item.status}`}>
                  {item.status === 'failed' ? <CloseCircleOutlined /> : item.status === 'success' ? <CheckCircleOutlined /> : meta.icon}
                </span>
                <div className="team-activity-copy">
                  <div className="team-activity-title-row">
                    <Text strong ellipsis={{ tooltip: item.title }}>{item.title}</Text>
                    <Tag color={meta.color}>{meta.label}</Tag>
                    {restorable && <RollbackOutlined className="team-activity-restore-icon" />}
                  </div>
                  {item.detail && <Text type="secondary" className="team-activity-detail" ellipsis={{ tooltip: item.detail }}>{item.detail}</Text>}
                  <Text type="secondary" className="team-activity-time">{dayjs(item.createdAt).format('MM-DD HH:mm')}</Text>
                </div>
              </Space>
            </List.Item>
          );
        }}
      />
    )}
  </Card>
);

export default ExecutionHistory;

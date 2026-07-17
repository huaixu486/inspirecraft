import React from 'react';
import { Button, Card, Checkbox, Empty, Select, Space, Tag, Typography } from 'antd';
import { SendOutlined, TeamOutlined } from '@ant-design/icons';

const { Text } = Typography;

type DispatchTask = {
  id: string;
  type?: 'manual' | 'ai';
  title: string;
  description?: string;
  source?: string;
  sectionTitle?: string;
  workflowId?: string;
  workflowOrder?: number;
  workflowName?: string;
  priority?: 'high' | 'medium' | 'low';
};

interface CollaborationDispatchProps {
  tasks: DispatchTask[];
  friends: CollaborationPeerInfo[];
  selectedTaskIds: string[];
  selectedFriendId: string;
  attachmentPaths: string[];
  attachFile: boolean;
  sending: boolean;
  fileName: (path: string) => string;
  onTaskToggle: (value: string) => void;
  onToggleAllTasks: (selected: boolean) => void;
  onFriendChange: (value: string) => void;
  onAttachFileChange: (value: boolean) => void;
  onSend: () => void;
}

const CollaborationDispatch: React.FC<CollaborationDispatchProps> = props => (
  <Card title={<Space><TeamOutlined style={{ color: '#1677ff' }} /><span>协同派发</span></Space>} size="small" className="team-side-card">
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text type="secondary">人工、AI和审查任务都可独立勾选；支持一次将多个任务派发给同一位在线好友。</Text>
      {props.tasks.length > 0 ? (
        <>
          <div className="team-dispatch-select-bar">
            <Checkbox
              checked={props.selectedTaskIds.length === props.tasks.length}
              indeterminate={props.selectedTaskIds.length > 0 && props.selectedTaskIds.length < props.tasks.length}
              onChange={event => props.onToggleAllTasks(event.target.checked)}
            >全选</Checkbox>
            <Text type="secondary">已选择 {props.selectedTaskIds.length}/{props.tasks.length}</Text>
          </div>
          <div className="team-dispatch-task-list">
            {props.tasks.map(task => {
              const selected = props.selectedTaskIds.includes(task.id);
              const taskLabel = task.source === 'review' ? '审查修改' : task.type === 'ai' ? 'AI任务' : '人工任务';
              const taskColor = task.source === 'review' ? 'purple' : task.type === 'ai' ? 'cyan' : 'blue';
              return (
                <div
                  key={task.id}
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={selected}
                  className={`team-dispatch-task-option${selected ? ' is-selected' : ''}`}
                  onClick={() => props.onTaskToggle(task.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      props.onTaskToggle(task.id);
                    }
                  }}
                >
                  <div className="team-dispatch-task-option-head">
                    <Space size={5} wrap>
                      <Checkbox checked={selected} tabIndex={-1} aria-hidden />
                      <Tag color={taskColor}>{taskLabel}</Tag>
                      {task.workflowOrder && <Tag>第 {task.workflowOrder} 步</Tag>}
                      {task.sectionTitle && <Tag>{task.sectionTitle}</Tag>}
                    </Space>
                  </div>
                  <Text strong>{task.title}</Text>
                  {task.description && <Text type="secondary" className="team-dispatch-task-option-description">{task.description}</Text>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="team-dispatch-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可派发的独立任务" />
          <Text type="secondary">请先在报告页确认生成工作流，人工步骤会逐条显示在这里。</Text>
        </div>
      )}
      <Select value={props.selectedFriendId || undefined} placeholder="选择在线好友" style={{ width: '100%' }} onChange={props.onFriendChange} options={props.friends.filter(friend => friend.online).map(friend => ({ value: friend.id, label: `${friend.name || friend.email || friend.host} · 在线` }))} notFoundContent="暂无在线好友，请先在消息中心添加好友" />
      <Checkbox checked={props.attachFile} disabled={props.attachmentPaths.length === 0} onChange={event => props.onAttachFileChange(event.target.checked)}>
        {props.attachmentPaths.length === 0
          ? '所选任务没有可发送的关联文件'
          : props.attachmentPaths.length === 1
            ? `附带关联文件：${props.fileName(props.attachmentPaths[0])}`
            : `附带 ${props.attachmentPaths.length} 个关联文件（自动去重）`}
      </Checkbox>
      <Button type="primary" icon={<SendOutlined />} block loading={props.sending} disabled={props.selectedTaskIds.length === 0 || !props.selectedFriendId} onClick={props.onSend}>
        发送选中的 {props.selectedTaskIds.length} 个任务
      </Button>
    </Space>
  </Card>
);

export default CollaborationDispatch;

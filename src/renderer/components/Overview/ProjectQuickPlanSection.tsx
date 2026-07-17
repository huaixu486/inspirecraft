import React from 'react';
import { Button, Checkbox, Input, Space, Typography } from 'antd';
import { ClockCircleOutlined, ExperimentOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons';
import type { TaskItem } from '../../../shared/types';

const { TextArea } = Input;
const { Title, Text } = Typography;

export type QuickPlanType = 'ai' | 'manual';

interface ProjectQuickPlanSectionProps {
  editing: boolean;
  title: string;
  description: string;
  type: QuickPlanType;
  tasks: TaskItem[];
  titleInputRef: React.RefObject<HTMLInputElement>;
  onOpenEditor: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTypeChange: (value: QuickPlanType) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onOpenTask: (task: TaskItem) => void;
  onToggleComplete: (task: TaskItem, checked: boolean) => void;
  onToggleType: (task: TaskItem) => void;
  getDestinationLabel: (task: TaskItem) => string;
}

const ProjectQuickPlanSection: React.FC<ProjectQuickPlanSectionProps> = ({
  editing,
  title,
  description,
  type,
  tasks,
  titleInputRef,
  onOpenEditor,
  onTitleChange,
  onDescriptionChange,
  onTypeChange,
  onConfirm,
  onCancel,
  onOpenTask,
  onToggleComplete,
  onToggleType,
  getDestinationLabel,
}) => (
  <>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <Title level={5} style={{ fontSize: 14, margin: 0 }}>下一步计划</Title>
      {!editing && (
        <Button
          type="text"
          size="small"
          shape="circle"
          icon={<PlusOutlined />}
          title="新增计划"
          onClick={onOpenEditor}
          style={{ color: '#1677ff', background: '#edf7ff' }}
        />
      )}
    </div>

    {editing && (
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
          ref={titleInputRef as any}
          value={title}
          onChange={event => onTitleChange(event.target.value)}
          placeholder="计划标题"
          size="small"
          style={{ fontSize: 13 }}
          onPressEnter={onConfirm}
        />
        <TextArea
          value={description}
          onChange={event => onDescriptionChange(event.target.value)}
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
            icon={type === 'ai' ? <ExperimentOutlined /> : <UserOutlined />}
            onClick={() => onTypeChange(type === 'ai' ? 'manual' : 'ai')}
            title={type === 'ai' ? '当前为 AI 任务，点击切换为人工任务' : '当前为人工任务，点击切换为 AI 任务'}
            aria-label={type === 'ai' ? '切换为人工任务' : '切换为 AI 任务'}
            style={{
              width: 28,
              minWidth: 28,
              height: 28,
              color: type === 'ai' ? '#1677ff' : '#d46b08',
              background: type === 'ai' ? '#e6f4ff' : '#fff7e6',
            }}
          />
          <Space size={6}>
            <Button size="small" onClick={onCancel}>取消</Button>
            <Button size="small" type="primary" onClick={onConfirm}>确认</Button>
          </Space>
        </div>
      </div>
    )}

    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      {tasks.length === 0 && !editing ? (
        <div style={{ padding: '18px 12px', textAlign: 'center' }}>
          <ClockCircleOutlined style={{ fontSize: 22, color: '#bfbfbf', marginBottom: 8 }} />
          <div><Text type="secondary" style={{ fontSize: 12 }}>暂未生成计划</Text></div>
        </div>
      ) : (
        tasks.map(task => {
          const checked = task.status === 'completed';
          const color = task.priority === 'high' ? '#ff4d4f' : task.priority === 'medium' ? '#faad14' : '#52c41a';
          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              title="进入对应工作台"
              onClick={() => onOpenTask(task)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenTask(task);
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
                onClick={event => event.stopPropagation()}
                onChange={event => onToggleComplete(task, event.target.checked)}
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Button
                    type="text"
                    size="small"
                    title={task.type === 'ai' ? '当前为 AI 任务，点击切换为人工任务' : '当前为人工任务，点击切换为 AI 任务'}
                    icon={task.type === 'ai' ? <ExperimentOutlined /> : <UserOutlined />}
                    onClick={event => {
                      event.stopPropagation();
                      onToggleType(task);
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
                  点击进入{getDestinationLabel(task)}
                </Text>
              </div>
            </div>
          );
        })
      )}
    </div>
  </>
);

export default ProjectQuickPlanSection;

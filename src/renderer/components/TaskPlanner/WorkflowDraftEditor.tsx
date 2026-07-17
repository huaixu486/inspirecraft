import React from 'react';
import { Button, Col, Input, List, Row, Select, Space, Tag, Typography } from 'antd';
import type { WorkflowDraftItem } from './taskPlannerTypes';

const { Text, Title } = Typography;

interface WorkflowDraftEditorProps {
  items: WorkflowDraftItem[];
  onAdd: (type: 'manual' | 'ai') => void;
  onUpdate: (id: string, updates: Partial<WorkflowDraftItem>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onConfirm: () => void;
}

const WorkflowDraftEditor: React.FC<WorkflowDraftEditorProps> = ({ items, onAdd, onUpdate, onDelete, onMove, onConfirm }) => {
  const sortedItems = [...items].sort((a, b) => a.order - b.order);
  return (
    <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>工作流草稿</Title>
          <Text type="secondary">按 AI框架/初稿、人工补资料、AI扩写/润色、人工成稿确认的流转排序，确认前可调整</Text>
        </div>
        <Space wrap>
          <Button size="small" onClick={() => onAdd('ai')}>增加AI步骤</Button>
          <Button size="small" onClick={() => onAdd('manual')}>增加人工步骤</Button>
          <Button type="primary" size="small" disabled={items.length === 0} onClick={onConfirm}>确认并生成工作流</Button>
        </Space>
      </div>
      <List
        size="small"
        dataSource={sortedItems}
        locale={{ emptyText: '暂无工作流草稿，请先生成 AI 报告或手动增加步骤' }}
        renderItem={(item, index) => (
          <List.Item style={{ alignItems: 'flex-start' }}>
            <div style={{ width: '100%' }}>
              <Row gutter={[8, 8]} align="middle">
                <Col flex="64px"><Tag color={item.type === 'ai' ? 'blue' : 'orange'}>第{index + 1}步</Tag></Col>
                <Col flex="112px"><Select size="small" value={item.type} style={{ width: '100%' }} options={[{ value: 'ai', label: 'AI执行' }, { value: 'manual', label: '人工处理' }]} onChange={(value) => onUpdate(item.id, { type: value })} /></Col>
                <Col flex="auto"><Input size="small" value={item.title} placeholder="输入任务标题" onChange={(event) => onUpdate(item.id, { title: event.target.value })} /></Col>
                <Col flex="104px"><Select size="small" value={item.priority} style={{ width: '100%' }} options={[{ value: 'high', label: '高优先级' }, { value: 'medium', label: '中优先级' }, { value: 'low', label: '低优先级' }]} onChange={(value) => onUpdate(item.id, { priority: value })} /></Col>
                <Col flex="184px">
                  <Space size={4}>
                    <Button size="small" disabled={index === 0} onClick={() => onMove(item.id, 'up')}>上移</Button>
                    <Button size="small" disabled={index === sortedItems.length - 1} onClick={() => onMove(item.id, 'down')}>下移</Button>
                    <Button size="small" danger onClick={() => onDelete(item.id)}>删除</Button>
                  </Space>
                </Col>
                <Col span={24}><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} value={item.description} placeholder="补充执行说明，可留空" onChange={(event) => onUpdate(item.id, { description: event.target.value })} /></Col>
                {item.reason && <Col span={24}><Text type="secondary">排序理由：{item.reason}</Text></Col>}
              </Row>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};

export default WorkflowDraftEditor;

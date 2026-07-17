import React, { ReactNode } from 'react';
import { Button, Card, Divider, Input, Progress, Space, Typography } from 'antd';
import { FileSearchOutlined, PlusOutlined } from '@ant-design/icons';
import type { ReviewResult } from '../../../shared/types';

const { Text } = Typography;

export interface CustomReviewIssueDraft {
  sectionTitle: string;
  message: string;
  suggestion: string;
}

interface LatestReviewResultPanelProps {
  review?: ReviewResult;
  scoreColor: string;
  showFindings: boolean;
  findings: ReactNode;
  editorOpen: boolean;
  draft: CustomReviewIssueDraft;
  onDraftChange: (draft: CustomReviewIssueDraft) => void;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onAddIssue: () => void;
  onCreateTasks: () => void;
}

const LatestReviewResultPanel: React.FC<LatestReviewResultPanelProps> = ({ review, scoreColor, showFindings, findings, editorOpen, draft, onDraftChange, onOpenEditor, onCloseEditor, onAddIssue, onCreateTasks }) => {
  if (!review) return <div className="review-empty-result"><FileSearchOutlined /><div><Text strong>暂无审查结果</Text><Text type="secondary">选择文件和审查规则后即可开始审查</Text></div></div>;
  return (
    <Card
      key={review.id}
      title="最新审查结果"
      style={{ marginBottom: 16 }}
      extra={<Space wrap><Button size="small" icon={<PlusOutlined />} onClick={onOpenEditor}>新增审查问题</Button><Button size="small" type="primary" icon={<PlusOutlined />} onClick={onCreateTasks}>生成选中任务</Button></Space>}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16 }}>
        <div><Text strong>审查时间：{new Date(review.createdAt).toLocaleString('zh-CN')}</Text><br /><Text type="secondary">{review.summary}</Text></div>
        <div style={{ textAlign: 'center', flex: '0 0 auto' }}><Progress type="circle" percent={review.score} size={80} strokeColor={scoreColor} format={(percent) => `${percent}分`} /></div>
      </div>
      {showFindings && (
        <>
          <Divider>问题与建议</Divider>
          {editorOpen && (
            <Card size="small" style={{ marginBottom: 12, background: '#fbfdff' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text strong>新增审查问题</Text>
                <Input placeholder="相关章节，可选" value={draft.sectionTitle} onChange={(event) => onDraftChange({ ...draft, sectionTitle: event.target.value })} />
                <Input.TextArea placeholder="问题描述" value={draft.message} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => onDraftChange({ ...draft, message: event.target.value })} />
                <Input.TextArea placeholder="修改建议，可选" value={draft.suggestion} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => onDraftChange({ ...draft, suggestion: event.target.value })} />
                <Space><Button size="small" type="primary" onClick={onAddIssue}>加入列表</Button><Button size="small" onClick={onCloseEditor}>取消</Button></Space>
              </Space>
            </Card>
          )}
          {findings}
        </>
      )}
    </Card>
  );
};

export default LatestReviewResultPanel;

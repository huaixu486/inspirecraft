import React from 'react';
import { Alert, Button, Card, Checkbox, Col, Empty, Row, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleFilled, FileTextOutlined, FolderOpenOutlined, PlayCircleOutlined, SyncOutlined } from '@ant-design/icons';
import type { ReviewConfig } from '../../../shared/types';

const { Text } = Typography;

export interface ReviewDocumentOption {
  id: string;
  name: string;
  kindLabel?: string;
  kindMismatch: boolean;
  versionDescription: string;
  progress: number;
  canSyncVersion: boolean;
  syncing: boolean;
}

interface ReviewSetupPanelProps {
  currentStage?: string;
  stageOptions: Array<{ value: string; label: string }>;
  selectedTemplateId?: string;
  templateOptions: Array<{ value: string; label: string }>;
  documents: ReviewDocumentOption[];
  selectedDocumentId?: string;
  mismatchMessage?: string;
  config: ReviewConfig;
  isReviewing: boolean;
  blockReview: boolean;
  onStageChange: (stage: string) => void;
  onTemplateChange: (templateId: string) => void;
  onDocumentChange: (documentId: string) => void;
  onPickDocument: () => void;
  onSyncVersion: (documentId: string) => void;
  onConfigChange: (config: ReviewConfig) => void;
  onStartReview: () => void;
}

const ReviewSetupPanel: React.FC<ReviewSetupPanelProps> = ({
  currentStage,
  stageOptions,
  selectedTemplateId,
  templateOptions,
  documents,
  selectedDocumentId,
  mismatchMessage,
  config,
  isReviewing,
  blockReview,
  onStageChange,
  onTemplateChange,
  onDocumentChange,
  onPickDocument,
  onSyncVersion,
  onConfigChange,
  onStartReview,
}) => (
  <Card title="审查设置" size="small" className="review-setup-card">
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Text strong className="review-field-label">审查阶段</Text>
          <Select placeholder="先选择要审查的阶段" style={{ width: '100%' }} value={currentStage || undefined} onChange={onStageChange} options={stageOptions} />
        </Col>
        <Col xs={24} md={16}>
          <Text strong className="review-field-label">审查模板</Text>
          <Select
            placeholder={currentStage ? '选择当前阶段内的模板' : '请先选择阶段'}
            style={{ width: '100%' }}
            value={selectedTemplateId || undefined}
            disabled={!currentStage}
            notFoundContent={currentStage ? '当前阶段暂无模板' : '请先选择阶段'}
            onChange={onTemplateChange}
            options={templateOptions}
          />
        </Col>
      </Row>

      {currentStage && templateOptions.length === 0 && <Alert showIcon type="info" message="当前阶段还没有可用的审查模板" description="可以先在该阶段导入或创建模板，已导入的阶段文件仍会显示在下方便于核对。" />}

      {currentStage && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
            <Text strong>待审文件<Text type="secondary" style={{ fontWeight: 'normal', marginLeft: 8 }}>{currentStage} · {documents.length} 个文件</Text></Text>
            <Button size="small" icon={<FolderOpenOutlined />} onClick={onPickDocument}>从项目文件中选择</Button>
          </div>
          {documents.length === 0 ? <Empty description="当前阶段暂无可审查文件" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
            <div className="review-document-list">
              {documents.map(document => {
                const selected = selectedDocumentId === document.id;
                return (
                  <div key={document.id} role="button" tabIndex={0} onClick={() => onDocumentChange(document.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDocumentChange(document.id); } }} className={`review-document-option${selected ? ' is-selected' : ''}`}>
                    <span className="review-document-icon"><FileTextOutlined /></span>
                    <div className="review-document-copy">
                      <div className="review-document-name-row">
                        <Text style={{ display: 'block', fontSize: 13 }} ellipsis={{ tooltip: document.name }}>{document.name}</Text>
                        {document.kindLabel && <Tag color={document.kindMismatch ? 'orange' : 'blue'}>{document.kindLabel}</Tag>}
                      </div>
                      <Text type="secondary" className="review-document-version-description">{document.versionDescription}</Text>
                    </div>
                    <Space size={8} wrap className="review-document-actions">
                      {document.canSyncVersion && <Button size="small" icon={<SyncOutlined />} loading={document.syncing} onClick={(event) => { event.stopPropagation(); onSyncVersion(document.id); }}>同步版本</Button>}
                      <Tag color={document.progress >= 100 ? 'success' : 'processing'} bordered={false} style={{ margin: 0 }}>{document.progress}%</Tag>
                      {selected && <CheckCircleFilled className="review-document-selected-icon" />}
                    </Space>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {mismatchMessage && <Alert showIcon type="warning" message="模板与文件类型不匹配" description={`${mismatchMessage} 建议切换正确模板后再审查；如果只是想做格式/内容提示，可以先取消“检查缺失章节”。`} />}

      {selectedDocumentId && (
        <div className="review-config-bar">
          <Space wrap size={[16, 8]}>
            <Checkbox checked={config.checkMissingSections} onChange={(event) => onConfigChange({ ...config, checkMissingSections: event.target.checked })}>缺失章节</Checkbox>
            <Checkbox checked={config.checkFormatting} onChange={(event) => onConfigChange({ ...config, checkFormatting: event.target.checked })}>格式规范</Checkbox>
            <Checkbox checked={config.checkContentDeviation} onChange={(event) => onConfigChange({ ...config, checkContentDeviation: event.target.checked })}>内容偏差</Checkbox>
            <Checkbox checked={config.enableAI} onChange={(event) => onConfigChange({ ...config, enableAI: event.target.checked })}>AI 建议</Checkbox>
          </Space>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={onStartReview} loading={isReviewing} disabled={blockReview}>开始审查</Button>
        </div>
      )}
    </Space>
  </Card>
);

export default ReviewSetupPanel;

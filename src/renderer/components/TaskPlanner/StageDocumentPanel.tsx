import React, { ReactNode } from 'react';
import { Card, Col, Empty, Row, Select, Space, Tag, Typography } from 'antd';
import { FileTextOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ProjectDocument } from '../../../shared/types';

const { Text } = Typography;

interface StageDocumentPanelProps {
  extra?: ReactNode;
  stageOptions: Array<{ label: string; value: string; count: number }>;
  selectedStage?: string;
  onStageChange: (stage: string) => void;
  stageDocuments: ProjectDocument[];
  selectedDocument?: ProjectDocument;
  selectedVersionIndex: number;
  stageProgress: number;
  onPickDocument: () => void;
  children?: ReactNode;
}

const getDocumentCreatedAt = (document: ProjectDocument) => document.sourceFileCreatedAt || document.createdAt;

const StageDocumentPanel: React.FC<StageDocumentPanelProps> = ({
  extra,
  stageOptions,
  selectedStage,
  onStageChange,
  stageDocuments,
  selectedDocument,
  selectedVersionIndex,
  stageProgress,
  onPickDocument,
  children,
}) => (
  <Card title="阶段文档报告" extra={extra} size="small" className="report-stage-card">
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={12} align="bottom">
        <Col span={9}>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>选择阶段</Text>
          <Select
            style={{ width: '100%' }}
            value={selectedStage || undefined}
            placeholder="选择阶段"
            onChange={onStageChange}
            options={stageOptions}
          />
          <Text type="secondary" className="report-stage-file-count">
            当前阶段匹配 {stageDocuments.length} 个文件
          </Text>
        </Col>
        <Col span={15}>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>阶段文档</Text>
          <Text type="secondary">点击当前文档可打开该阶段的文件列表并切换版本。</Text>
        </Col>
      </Row>

      {stageDocuments.length > 0 ? (
        <div className="report-current-document-shell">
          <button
            type="button"
            onClick={onPickDocument}
            className="report-current-document-button"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Space size={8} style={{ minWidth: 0 }}>
                <span className="report-current-document-icon"><FileTextOutlined /></span>
                <Tag color="blue" bordered={false} style={{ margin: 0 }}>当前</Tag>
                <Text strong>V{Math.max(selectedVersionIndex + 1, 1)} / {stageDocuments.length}</Text>
                <Text style={{ maxWidth: 620 }} ellipsis={{ tooltip: selectedDocument?.name }}>
                  {selectedDocument?.name || '请选择版本'}
                </Text>
              </Space>
              <Space size={8}>
                {selectedDocument && <Tag color={stageProgress >= 100 ? 'success' : 'processing'} bordered={false} style={{ margin: 0 }}>完成度 {stageProgress}%</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {selectedDocument ? dayjs(getDocumentCreatedAt(selectedDocument)).format('MM-DD HH:mm') : ''}
                </Text>
                <RightOutlined className="report-current-document-arrow" />
              </Space>
            </div>
          </button>
        </div>
      ) : (
        <Empty description="该阶段暂无可出具报告的文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      {children}
    </Space>
  </Card>
);

export default StageDocumentPanel;

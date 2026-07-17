import React from 'react';
import { Button, Progress, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, FileTextOutlined, RobotOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ProjectDocument, SectionAnalysis } from '../../../shared/types';

const { Text, Title } = Typography;

interface StageDocumentOverviewProps {
  document: ProjectDocument;
  selectedStage?: string;
  versionSummary: string;
  templateName?: string;
  reviewSummary: string;
  stageProgress: number;
  completionScore: number;
  sections: SectionAnalysis[];
  completedCount: number;
  partialCount: number;
  missingCount: number;
  openTaskCount: number;
  completionFormulaText: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  formatSectionTitle: (title: string) => string;
}

const getDocumentCreatedAt = (document: ProjectDocument) => document.sourceFileCreatedAt || document.createdAt;

const StageDocumentOverview: React.FC<StageDocumentOverviewProps> = ({
  document,
  selectedStage,
  versionSummary,
  templateName,
  reviewSummary,
  stageProgress,
  completionScore,
  sections,
  completedCount,
  partialCount,
  missingCount,
  openTaskCount,
  completionFormulaText,
  isRefreshing,
  onRefresh,
  formatSectionTitle,
}) => {
  const metrics = [
    { label: '当前版本', value: versionSummary, note: '当前选中文档', color: '#1677ff', icon: <FileTextOutlined /> },
    { label: '文档完成度', value: `${stageProgress}%`, note: `${completionScore}/${sections.length || 0} 章节分`, color: '#52c41a', icon: <CheckCircleOutlined /> },
    { label: '章节问题', value: missingCount + partialCount, note: `缺失 ${missingCount} · 部分 ${partialCount}`, color: '#fa8c16', icon: <SyncOutlined /> },
    { label: '关联待办', value: openTaskCount, note: '未完成任务', color: '#722ed1', icon: <RobotOutlined /> },
  ];

  return (
    <div className="report-document-overview">
      <div className="report-snapshot-bar">
        {metrics.map((item) => (
          <div key={item.label} className="report-snapshot-item">
            <div className="report-snapshot-icon" style={{ color: item.color, background: `${item.color}12` }}>{item.icon}</div>
            <div className="report-snapshot-copy">
              <Text type="secondary">{item.label}</Text>
              <Text strong ellipsis={{ tooltip: String(item.value) }}>{item.value}</Text>
              <Text type="secondary">{item.note}</Text>
            </div>
          </div>
        ))}
      </div>

      <div className="report-document-meta-card">
        <div className="report-section-heading"><Title level={5}>报告信息</Title></div>
        <div className="report-document-meta-grid">
          {[['阶段', selectedStage || '未识别阶段'], ['文档', document.name], ['模板', templateName || '未关联模板'], ['创建时间', dayjs(getDocumentCreatedAt(document)).format('YYYY-MM-DD HH:mm')], ['最近审查', reviewSummary]].map(([label, value]) => (
            <div key={label} className={`report-document-meta-item${label === '文档' ? ' is-wide' : ''}`}>
              <Text type="secondary">{label}</Text>
              <Text ellipsis={{ tooltip: value }}>{value}</Text>
            </div>
          ))}
        </div>
      </div>

      <div className="report-status-card">
        <div className="report-status-card-head">
          <div>
            <Space size={8}>
              <Title level={5} style={{ margin: 0 }}>阶段文档状态</Title>
              <Tag color={stageProgress >= 100 ? 'success' : 'processing'} bordered={false}>{stageProgress}%</Tag>
            </Space>
            <Text type="secondary">按模板章节检查当前文档的覆盖与完整程度</Text>
          </div>
          <Button size="small" loading={isRefreshing} onClick={onRefresh}>重新分析</Button>
        </div>
        <div className="report-stage-progress-block">
          <div className="report-stage-progress-label"><Text type="secondary">章节完成度</Text><Text strong>{stageProgress}%</Text></div>
          <Progress percent={stageProgress} size="small" showInfo={false} strokeColor={stageProgress >= 100 ? '#52c41a' : '#1677ff'} />
        </div>
        <div className="report-status-detail-row">
          <Space wrap className="report-status-summary">
            <Tag color="green">已完成 {completedCount}</Tag>
            <Tag color="orange">部分完成 {partialCount}</Tag>
            <Tag color="red">缺失 {missingCount}</Tag>
            <Tag color="blue">待办 {openTaskCount}</Tag>
          </Space>
          <Text type="secondary">{completionFormulaText}</Text>
        </div>
        {sections.length > 0 && (
          <div className="report-section-list">
            <Text strong>章节列表</Text>
            <div className="report-section-grid">
              {sections.map((section, index) => {
                const statusColor = section.status === 'missing' ? 'red' : section.status === 'partial' ? 'orange' : 'green';
                const statusText = section.status === 'missing' ? '缺失' : section.status === 'partial' ? '部分完成' : '已完成';
                return (
                  <div key={`${section.title}-${index}`} className="report-section-item">
                    <div className="report-section-item-head">
                      {section.status === 'completed' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <Tag color={statusColor}>{statusText}</Tag>}
                      <Text strong ellipsis={{ tooltip: formatSectionTitle(section.title) }}>{formatSectionTitle(section.title)}</Text>
                      <Text type="secondary">{section.wordCount} 字</Text>
                    </div>
                    <Text type="secondary" ellipsis={{ tooltip: section.aiComment }}>{section.aiComment || (section.status === 'missing' ? '当前文档中未稳定提取到该章节正文。' : section.status === 'partial' ? '已识别到该章节，但内容仍需补充完善。' : '已识别到该章节，内容相对完整。')}</Text>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StageDocumentOverview;

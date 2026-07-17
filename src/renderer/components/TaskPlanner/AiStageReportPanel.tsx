import React from 'react';
import { Button, Checkbox, Col, Empty, Input, List, Row, Select, Space, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import WorkflowDraftEditor from './WorkflowDraftEditor';
import type { AiStageReport, SectionAdviceDraftItem, WorkflowDraftItem } from './taskPlannerTypes';

const { Paragraph, Text, Title } = Typography;

interface AiStageReportPanelProps {
  report: AiStageReport | null;
  displayReport: AiStageReport | null;
  adviceItems: SectionAdviceDraftItem[];
  onUpdateAdviceItem: (id: string, updates: Partial<SectionAdviceDraftItem>) => void;
  onToggleAllAdvice: (selected: boolean) => void;
  isGenerating: boolean;
  selectedVersionId: string;
  onVersionChange: (versionId: string) => void;
  onRegenerate: () => void;
  workflowItems: WorkflowDraftItem[];
  onAddWorkflowItem: (type: 'manual' | 'ai') => void;
  onUpdateWorkflowItem: (id: string, updates: Partial<WorkflowDraftItem>) => void;
  onDeleteWorkflowItem: (id: string) => void;
  onMoveWorkflowItem: (id: string, direction: 'up' | 'down') => void;
  onConfirmWorkflow: () => void;
  formatSectionTitle: (title: string) => string;
}

const AiStageReportPanel: React.FC<AiStageReportPanelProps> = ({
  report,
  displayReport,
  adviceItems,
  onUpdateAdviceItem,
  onToggleAllAdvice,
  isGenerating,
  selectedVersionId,
  onVersionChange,
  onRegenerate,
  workflowItems,
  onAddWorkflowItem,
  onUpdateWorkflowItem,
  onDeleteWorkflowItem,
  onMoveWorkflowItem,
  onConfirmWorkflow,
  formatSectionTitle,
}) => {
  const adviceGroups = adviceItems.reduce<Array<{ title: string; items: SectionAdviceDraftItem[] }>>((groups, item) => {
    const existing = groups.find(group => group.title === item.sectionTitle);
    if (existing) existing.items.push(item);
    else groups.push({ title: item.sectionTitle, items: [item] });
    return groups;
  }, []);
  const selectedAdviceCount = adviceItems.filter(item => item.selected).length;
  const allAdviceSelected = adviceItems.length > 0 && selectedAdviceCount === adviceItems.length;

  return (
  <div style={{ border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 8, padding: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
      <div>
        <Title level={5} style={{ margin: 0 }}>{report?.reportTitle || 'AI写作框架'}</Title>
        <Text type="secondary">基于模板要求、范文结构、参考内容和当前正文规划</Text>
      </div>
      <Space wrap>
        {report?.parallelVersions?.length ? (
          <Select
            size="small"
            value={selectedVersionId}
            style={{ minWidth: 220 }}
            onChange={onVersionChange}
            options={[
              { value: 'synthesis', label: `综合版本${report.synthesisModelName ? `（${report.synthesisModelName}）` : ''}` },
              ...report.parallelVersions.map(item => ({ value: item.id, label: `${item.modelName}${item.ok ? '' : '（失败）'}` })),
            ]}
          />
        ) : null}
        <Button icon={<RobotOutlined />} loading={isGenerating} onClick={onRegenerate}>重新生成</Button>
      </Space>
    </div>

    {report && (
      <div className="ai-stage-report-stack">
        <div style={{ padding: '12px 14px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>报告摘要</Text>
          <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{report.reportSummary || '暂无摘要'}</Paragraph>
        </div>

        {displayReport?.qualityAssessment?.length ? (
          <div style={{ padding: '12px 14px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>质量评估</Text>
            <List size="small" dataSource={displayReport.qualityAssessment} renderItem={(item) => <List.Item style={{ paddingLeft: 0 }}><Text>{item}</Text></List.Item>} />
          </div>
        ) : null}

        <div style={{ border: '1px solid #dbeafe', background: '#fff', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div>
              <Title level={5} style={{ margin: 0 }}>按章节的问题与建议</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>默认全部选中；可修改内容或取消不需要执行的步骤</Text>
            </div>
            {adviceItems.length > 0 && (
              <Space size={10}>
                <Text type="secondary" style={{ fontSize: 12 }}>已选 {selectedAdviceCount}/{adviceItems.length}</Text>
                <Checkbox
                  checked={allAdviceSelected}
                  indeterminate={selectedAdviceCount > 0 && !allAdviceSelected}
                  onChange={event => onToggleAllAdvice(event.target.checked)}
                >全选</Checkbox>
              </Space>
            )}
          </div>
          {adviceGroups.length > 0 ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {adviceGroups.map((section, sectionIndex) => (
                <div key={`${section.title}-${sectionIndex}`} className="report-advice-section">
                  <div style={{ padding: '10px 12px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <Text strong>{formatSectionTitle(section.title)}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{section.items.filter(item => item.selected).length}/{section.items.length} 项已选</Text>
                  </div>
                  <div className="report-advice-items">
                    {section.items.map((item, itemIndex) => (
                      <div key={item.id} className={`report-advice-item${item.selected ? ' is-selected' : ''}`}>
                        <div className="report-advice-item-head">
                          <Checkbox checked={item.selected} onChange={event => onUpdateAdviceItem(item.id, { selected: event.target.checked })}>
                            纳入工作流
                          </Checkbox>
                          <Tag color={item.selected ? 'blue' : 'default'} style={{ margin: 0 }}>步骤 {itemIndex + 1}</Tag>
                        </div>
                        <Row gutter={12}>
                          <Col xs={24} md={12}>
                            <Text strong className="report-advice-label is-problem">问题</Text>
                            <Input.TextArea
                              value={item.problem}
                              autoSize={{ minRows: 2, maxRows: 6 }}
                              placeholder="填写该章节存在的问题"
                              onChange={event => onUpdateAdviceItem(item.id, { problem: event.target.value })}
                            />
                          </Col>
                          <Col xs={24} md={12}>
                            <Text strong className="report-advice-label is-suggestion">修改建议</Text>
                            <Input.TextArea
                              value={item.suggestion}
                              autoSize={{ minRows: 2, maxRows: 6 }}
                              placeholder="填写需要执行的修改建议"
                              onChange={event => onUpdateAdviceItem(item.id, { suggestion: event.target.value })}
                            />
                          </Col>
                        </Row>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Space>
          ) : (
            <Empty description="暂无需要展示的问题与建议，请重新生成 AI 写作建议" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>

        {(displayReport?.contentGaps?.length || displayReport?.optimizationFocus?.length) ? (
          <Row gutter={12}>
            {displayReport?.contentGaps?.length ? <Col span={12}><div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12, height: '100%' }}><Title level={5} style={{ marginTop: 0 }}>内容缺口</Title><List size="small" dataSource={displayReport.contentGaps} renderItem={(item) => <List.Item><Text>{item}</Text></List.Item>} /></div></Col> : null}
            {displayReport?.optimizationFocus?.length ? <Col span={displayReport?.contentGaps?.length ? 12 : 24}><div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12, height: '100%' }}><Title level={5} style={{ marginTop: 0 }}>优化重点</Title><List size="small" dataSource={displayReport.optimizationFocus} renderItem={(item) => <List.Item><Text>{item}</Text></List.Item>} /></div></Col> : null}
          </Row>
        ) : null}

        <WorkflowDraftEditor items={workflowItems} onAdd={onAddWorkflowItem} onUpdate={onUpdateWorkflowItem} onDelete={onDeleteWorkflowItem} onMove={onMoveWorkflowItem} onConfirm={onConfirmWorkflow} />

        {displayReport?.rawText && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>查看 AI 原始响应</summary>
            <pre style={{ marginTop: 8, padding: 12, background: '#f8f9fa', borderRadius: 6, fontSize: 11, lineHeight: 1.6, overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#475569' }}>{displayReport.rawText}</pre>
          </details>
        )}
      </div>
    )}
  </div>
  );
};

export default AiStageReportPanel;

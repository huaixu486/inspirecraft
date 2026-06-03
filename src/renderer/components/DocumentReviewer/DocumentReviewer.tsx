import React, { useEffect, useState, useMemo } from 'react';
import {
  Card,
  Button,
  Select,
  Space,
  Typography,
  message,
  List,
  Tag,
  Progress,
  Empty,
  Checkbox,
  Divider,
  Spin,
  Tabs,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  SwapOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { ReviewConfig, ReviewIssue, ReviewResult } from '../../shared/types';
import DiffMatchPatch from 'diff-match-patch';

const { Title, Text, Paragraph } = Typography;

const DocumentReviewer: React.FC = () => {
  const { currentProject, versions, loadVersions } = useProjectStore();
  const { templates, reviews, loadTemplates, loadReviews, executeReview } = useTemplateStore();
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>({
    checkMissingSections: true,
    checkFormatting: true,
    checkContentDeviation: true,
    enableAI: false,
  });

  // 版本对比状态
  const [selectedVersionA, setSelectedVersionA] = useState<string>('');
  const [selectedVersionB, setSelectedVersionB] = useState<string>('');
  const [isAnalyzingDiff, setIsAnalyzingDiff] = useState(false);
  const [diffAnalysis, setDiffAnalysis] = useState<string>('');

  useEffect(() => {
    loadVersions();
    loadTemplates();
    loadReviews();
  }, []);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const projectVersions = versions.filter(v => v.projectId === currentProject.id);
  const projectReviews = reviews
    .filter(r => r.projectId === currentProject.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleStartReview = async () => {
    if (!selectedVersion) {
      message.warning('请选择要审查的版本');
      return;
    }
    if (!selectedTemplate) {
      message.warning('请选择审查模板');
      return;
    }

    setIsReviewing(true);
    try {
      const result = await executeReview(selectedVersion, selectedTemplate, reviewConfig);
      if (result.success) {
        message.success('审查完成');
      } else {
        message.error(result.error || '审查失败');
      }
    } catch (error: any) {
      message.error(`审查失败: ${error.message}`);
    } finally {
      setIsReviewing(false);
    }
  };

  // 版本对比相关函数
  const getVersionContent = (versionId: string) => {
    const version = versions.find(v => v.id === versionId);
    return version?.content || '';
  };

  const computeDiff = (textA: string, textB: string) => {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(textA, textB);
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
  };

  const contentA = getVersionContent(selectedVersionA);
  const contentB = getVersionContent(selectedVersionB);

  const diffResult = useMemo(() => {
    if (!selectedVersionA || !selectedVersionB) return [];
    return computeDiff(contentA, contentB);
  }, [contentA, contentB, selectedVersionA, selectedVersionB]);

  const diffStats = useMemo(() => {
    let insert = 0, deleteCount = 0, equal = 0;
    for (const [op, text] of diffResult) {
      const lines = text.split('\n').length - 1 || 1;
      if (op === 0) equal += lines;
      else if (op === 1) insert += lines;
      else if (op === -1) deleteCount += lines;
    }
    return { insert, delete: deleteCount, equal, total: insert + deleteCount + equal };
  }, [diffResult]);

  const handleAiDiffAnalysis = async () => {
    if (!selectedVersionA || !selectedVersionB) {
      message.warning('请先选择两个版本');
      return;
    }
    setIsAnalyzingDiff(true);
    setDiffAnalysis('');
    try {
      const versionA = versions.find(v => v.id === selectedVersionA);
      const versionB = versions.find(v => v.id === selectedVersionB);
      const prompt = `你是一个文档版本对比分析专家。请对比以下两个版本的差异，并给出详细的分析报告。

## 版本A：${versionA?.fileName || '未知'}
\`\`\`
${contentA.substring(0, 4000)}
\`\`\`

## 版本B：${versionB?.fileName || '未知'}
\`\`\`
${contentB.substring(0, 4000)}
\`\`\`

请分析：
1. 主要变更内容概述
2. 新增了哪些内容
3. 删除了哪些内容
4. 修改了哪些内容
5. 这些变更对文档质量的影响评估
6. 建议和注意事项`;

      const result = await window.electronAPI.callAI({ prompt });
      setDiffAnalysis(result);
    } catch (error: any) {
      message.error(`AI 分析失败: ${error.message}`);
    } finally {
      setIsAnalyzingDiff(false);
    }
  };

  const getIssueIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'warning':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'info':
        return <InfoCircleOutlined style={{ color: '#1677ff' }} />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  const getIssueTag = (type: string) => {
    switch (type) {
      case 'missing_section':
        return <Tag color="red">缺失章节</Tag>;
      case 'wrong_format':
        return <Tag color="orange">格式错误</Tag>;
      case 'content_deviation':
        return <Tag color="yellow">内容偏差</Tag>;
      default:
        return <Tag>其他</Tag>;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#52c41a';
    if (score >= 60) return '#faad14';
    return '#ff4d4f';
  };

  return (
    <div>
      <Title level={4}>文档审查</Title>

      <Tabs
        defaultActiveKey="review"
        items={[
          {
            key: 'review',
            label: '文档审查',
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space wrap>
                      <Select
                        placeholder="选择版本"
                        style={{ width: 300 }}
                        value={selectedVersion || undefined}
                        onChange={setSelectedVersion}
                        options={projectVersions.map(v => ({
                          value: v.id,
                          label: `${v.fileName} - ${new Date(v.createdAt).toLocaleDateString('zh-CN')}`,
                        }))}
                      />
                      <Select
                        placeholder="选择模板"
                        style={{ width: 300 }}
                        value={selectedTemplate || undefined}
                        onChange={setSelectedTemplate}
                        options={templates.map(t => ({
                          value: t.id,
                          label: `${t.name} (${t.category})`,
                        }))}
                      />
                    </Space>

                    <Space wrap>
                      <Checkbox
                        checked={reviewConfig.checkMissingSections}
                        onChange={(e) => setReviewConfig({ ...reviewConfig, checkMissingSections: e.target.checked })}
                      >
                        检查缺失章节
                      </Checkbox>
                      <Checkbox
                        checked={reviewConfig.checkFormatting}
                        onChange={(e) => setReviewConfig({ ...reviewConfig, checkFormatting: e.target.checked })}
                      >
                        检查格式
                      </Checkbox>
                      <Checkbox
                        checked={reviewConfig.checkContentDeviation}
                        onChange={(e) => setReviewConfig({ ...reviewConfig, checkContentDeviation: e.target.checked })}
                      >
                        检查内容偏差
                      </Checkbox>
                      <Checkbox
                        checked={reviewConfig.enableAI}
                        onChange={(e) => setReviewConfig({ ...reviewConfig, enableAI: e.target.checked })}
                      >
                        启用AI建议
                      </Checkbox>
                    </Space>

                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={handleStartReview}
                      loading={isReviewing}
                      disabled={!selectedVersion || !selectedTemplate}
                    >
                      开始审查
                    </Button>
                  </Space>
                </Card>

                {projectReviews.length === 0 ? (
                  <Empty description="暂无审查记录" />
                ) : (
                  <List
                    dataSource={projectReviews.slice(0, 5)}
                    renderItem={(review) => (
                      <Card style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                          <div>
                            <Text strong>审查时间：{new Date(review.createdAt).toLocaleString('zh-CN')}</Text>
                            <br />
                            <Text type="secondary">{review.summary}</Text>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <Progress
                              type="circle"
                              percent={review.score}
                              size={80}
                              strokeColor={getScoreColor(review.score)}
                              format={(percent) => `${percent}分`}
                            />
                          </div>
                        </div>

                        {review.issues.length > 0 && (
                          <>
                            <Divider>问题列表</Divider>
                            <List
                              size="small"
                              dataSource={review.issues}
                              renderItem={(issue: ReviewIssue) => (
                                <List.Item>
                                  <Space align="start">
                                    {getIssueIcon(issue.severity)}
                                    <div>
                                      <Space>
                                        {getIssueTag(issue.type)}
                                        {issue.sectionTitle && <Text strong>{issue.sectionTitle}</Text>}
                                      </Space>
                                      <br />
                                      <Text>{issue.message}</Text>
                                      {issue.suggestion && (
                                        <>
                                          <br />
                                          <Text type="secondary">建议：{issue.suggestion}</Text>
                                        </>
                                      )}
                                    </div>
                                  </Space>
                                </List.Item>
                              )}
                            />
                          </>
                        )}

                        {review.aiSuggestions && (
                          <>
                            <Divider>AI 建议</Divider>
                            <Paragraph>{review.aiSuggestions}</Paragraph>
                          </>
                        )}
                      </Card>
                    )}
                  />
                )}
              </>
            ),
          },
          {
            key: 'diff',
            label: '版本对比',
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Space wrap size="large">
                    <div>
                      <Text strong>基准版本：</Text>
                      <Select
                        style={{ width: 280 }}
                        placeholder="选择基准版本"
                        value={selectedVersionA || undefined}
                        onChange={setSelectedVersionA}
                        options={projectVersions.map(v => ({
                          value: v.id,
                          label: `${v.fileName} - ${new Date(v.createdAt).toLocaleDateString('zh-CN')}`,
                        }))}
                      />
                    </div>
                    <SwapOutlined style={{ fontSize: 18, color: '#999' }} />
                    <div>
                      <Text strong>对比版本：</Text>
                      <Select
                        style={{ width: 280 }}
                        placeholder="选择对比版本"
                        value={selectedVersionB || undefined}
                        onChange={setSelectedVersionB}
                        options={projectVersions.map(v => ({
                          value: v.id,
                          label: `${v.fileName} - ${new Date(v.createdAt).toLocaleDateString('zh-CN')}`,
                        }))}
                      />
                    </div>
                  </Space>
                </Card>

                {selectedVersionA && selectedVersionB && (
                  <>
                    <Card style={{ marginBottom: 16 }}>
                      <Row gutter={16}>
                        <Col span={6}>
                          <Statistic title="总行数" value={diffStats.total} />
                        </Col>
                        <Col span={6}>
                          <Statistic title="新增" value={diffStats.insert} valueStyle={{ color: '#52c41a' }} prefix="+" />
                        </Col>
                        <Col span={6}>
                          <Statistic title="删除" value={diffStats.delete} valueStyle={{ color: '#ff4d4f' }} prefix="-" />
                        </Col>
                        <Col span={6}>
                          <Statistic title="未变更" value={diffStats.equal} valueStyle={{ color: '#999' }} />
                        </Col>
                      </Row>
                    </Card>

                    <Card
                      title="差异详情"
                      extra={
                        <Button
                          type="primary"
                          icon={<RobotOutlined />}
                          loading={isAnalyzingDiff}
                          onClick={handleAiDiffAnalysis}
                        >
                          AI 分析对比
                        </Button>
                      }
                    >
                      <div style={{
                        fontFamily: 'monospace',
                        fontSize: 13,
                        lineHeight: 1.8,
                        maxHeight: 500,
                        overflow: 'auto',
                        background: '#fafafa',
                        borderRadius: 4,
                        padding: 12,
                      }}>
                        {diffResult.map(([op, text], index) => {
                          const lines = text.split('\n');
                          return lines.map((line, lineIndex) => {
                            const key = `${index}-${lineIndex}`;
                            let bgColor = 'transparent';
                            let prefix = ' ';

                            if (op === 1) {
                              bgColor = '#e6ffec';
                              prefix = '+';
                            } else if (op === -1) {
                              bgColor = '#ffebe9';
                              prefix = '-';
                            }

                            return (
                              <div key={key} style={{ display: 'flex', background: bgColor, borderBottom: '1px solid #f0f0f0' }}>
                                <span style={{ width: 20, textAlign: 'center', color: op === 1 ? '#52c41a' : op === -1 ? '#ff4d4f' : '#999', userSelect: 'none' }}>
                                  {prefix}
                                </span>
                                <span style={{ flex: 1, paddingLeft: 8 }}>{line}</span>
                              </div>
                            );
                          });
                        })}
                      </div>
                    </Card>

                    {diffAnalysis && (
                      <Card title="AI 分析报告" style={{ marginTop: 16 }}>
                        <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{diffAnalysis}</Paragraph>
                      </Card>
                    )}
                  </>
                )}

                {!selectedVersionA || !selectedVersionB ? (
                  <Empty description="请选择两个版本进行对比" />
                ) : null}
              </>
            ),
          },
        ]}
      />
    </div>
  );
};

export default DocumentReviewer;

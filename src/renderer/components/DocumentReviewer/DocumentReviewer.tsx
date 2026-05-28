import React, { useEffect, useState } from 'react';
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
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { ReviewConfig, ReviewIssue, ReviewResult } from '../../shared/types';

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
    </div>
  );
};

export default DocumentReviewer;

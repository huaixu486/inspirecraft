import React, { useMemo, useState } from 'react';
import { Badge, Button, Empty, List, Popover, Progress, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, ClearOutlined, CloseCircleOutlined,
  LoadingOutlined, RobotOutlined, StopOutlined, ReloadOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { AIJob, AIJobStatus } from '../../../shared/types';
import { useAIJobStore } from '../../stores/aiJobStore';

const { Text } = Typography;

const statusMeta: Record<AIJobStatus, { label: string; color: string; icon?: React.ReactNode }> = {
  queued: { label: '排队中', color: 'default' },
  running: { label: '执行中', color: 'processing', icon: <LoadingOutlined /> },
  completed: { label: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: 'error', icon: <CloseCircleOutlined /> },
  cancelled: { label: '已取消', color: 'default' },
};

const sceneLabel: Record<string, string> = {
  report: '报告',
  review: '审查',
  rewrite: '改写',
  diff: '对比',
  summary: '摘要',
  memory: '记忆',
  description: '描述',
  taskExecute: '任务',
  sectionAnalysis: '分析',
  templateExtract: '模板',
  general: 'AI',
};

const formatTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const formatDuration = (start?: string, end?: string) => {
  if (!start) return '';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.round((endTime - startTime) / 1000);
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
};

const getJobSummary = (job: AIJob) => job.error || job.resultPreview || '';

const AIJobCenter: React.FC = () => {
  const { jobs, clearFinished, cancelJob, retryJob, clearJob } = useAIJobStore();
  const [open, setOpen] = useState(false);

  const activeCount = useMemo(() => jobs.filter((job) => job.status === 'queued' || job.status === 'running').length, [jobs]);
  const failedCount = useMemo(() => jobs.filter((job) => job.status === 'failed' || job.status === 'cancelled').length, [jobs]);
  const badgeCount = activeCount;

  // 分类排序：进行中 → 等待中 → 最近完成 → 失败/已取消
  const sortedJobs = useMemo(() => {
    const order: Record<AIJobStatus, number> = { running: 0, queued: 1, completed: 2, failed: 3, cancelled: 4 };
    return [...jobs].sort((a, b) => {
      const oa = order[a.status] ?? 5;
      const ob = order[b.status] ?? 5;
      if (oa !== ob) return oa - ob;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [jobs]);

  const content = (
    <div style={{ width: 360, maxWidth: 'calc(100vw - 48px)', userSelect: 'none' }} onWheel={(event) => event.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space size={6}>
          <Text strong>AI 任务</Text>
          {activeCount > 0 && <Tag color="processing" style={{ margin: 0 }}>{activeCount} 进行中</Tag>}
          {failedCount > 0 && <Tag color="error" style={{ margin: 0 }}>{failedCount} 失败</Tag>}
        </Space>
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<ClearOutlined />}
            onClick={clearFinished}
            disabled={!jobs.some((job) => isTerminalStatus(job.status))}
          >
            清理
          </Button>
        </Space>
      </div>
      {sortedJobs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 AI 任务" />
      ) : (
        <div style={{ maxHeight: 400, overflowY: 'auto', paddingRight: 4, overscrollBehavior: 'contain' }}>
          <List
            size="small"
            dataSource={sortedJobs.slice(0, 15)}
            renderItem={(job) => {
              const meta = statusMeta[job.status];
              const summary = getJobSummary(job);
              const canCancel = job.status === 'queued' || job.status === 'running';
              const canRetry = job.canRetry && isTerminalStatus(job.status);
              const duration = formatDuration(job.startedAt, job.finishedAt);
              return (
                <List.Item
                  style={{
                    padding: '8px 6px',
                    borderBlockEnd: 'none',
                    borderRadius: 7,
                    marginBottom: 4,
                    background: job.status === 'failed' ? '#fff2f0' : job.status === 'running' ? '#f6fbff' : 'transparent',
                  }}
                  actions={[
                    canCancel && (
                      <Button key="cancel" size="small" type="text" danger icon={<StopOutlined />} onClick={() => cancelJob(job.id)}>
                        取消
                      </Button>
                    ),
                    canRetry && (
                      <Button key="retry" size="small" type="text" icon={<ReloadOutlined />} onClick={() => retryJob(job.id)}>
                        重试
                      </Button>
                    ),
                    isTerminalStatus(job.status) && (
                      <Button key="dismiss" size="small" type="text" icon={<CloseOutlined style={{ fontSize: 10 }} />} onClick={() => clearJob(job.id)} style={{ padding: '0 4px' }} />
                    ),
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6} style={{ maxWidth: '100%' }}>
                        <Text strong style={{ maxWidth: 160, fontSize: 12 }} ellipsis={{ tooltip: job.title }}>{job.title}</Text>
                        <Tag color={sceneLabel[job.scene] ? 'blue' : 'default'} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
                          {sceneLabel[job.scene] || 'AI'}
                        </Tag>
                        <Tag icon={meta.icon} color={meta.color} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
                          {meta.label}
                        </Tag>
                      </Space>
                    }
                    description={
                      <div>
                        {(job.status === 'running' || job.status === 'queued') && (
                          <Progress percent={job.progress} size="small" showInfo={false} style={{ margin: '2px 0 3px' }} />
                        )}
                        {summary && (
                          <Text type={job.status === 'failed' ? 'danger' : 'secondary'} style={{ display: 'block', fontSize: 11 }} ellipsis={{ tooltip: summary }}>
                            {summary}
                          </Text>
                        )}
                        <Space size={8} style={{ marginTop: 2 }}>
                          <Text type="secondary" style={{ fontSize: 10 }}>{formatTime(job.createdAt)}</Text>
                          {duration && <Text type="secondary" style={{ fontSize: 10 }}>耗时 {duration}</Text>}
                          {job.retryOf && <Text type="secondary" style={{ fontSize: 10 }}>重试</Text>}
                        </Space>
                      </div>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={content} arrow overlayStyle={{ maxWidth: 400 }}>
      <Badge count={badgeCount} size="small" overflowCount={9} offset={[-2, 4]}>
        <Button icon={<RobotOutlined />} title="AI 任务" aria-label="AI 任务" onMouseDown={(event) => event.preventDefault()} />
      </Badge>
    </Popover>
  );
};

const isTerminalStatus = (status: AIJobStatus) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

export default AIJobCenter;

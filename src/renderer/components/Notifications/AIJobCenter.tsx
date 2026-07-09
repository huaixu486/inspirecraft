import React, { useMemo, useState } from 'react';
import { Badge, Button, Empty, List, Popover, Progress, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClearOutlined, CloseCircleOutlined, LoadingOutlined, RobotOutlined, StopOutlined } from '@ant-design/icons';
import type { AIJob, AIJobStatus } from '../../../shared/types';
import { useAIJobStore } from '../../stores/aiJobStore';

const { Text } = Typography;

const statusMeta: Record<AIJobStatus, { label: string; color: string; icon?: React.ReactNode }> = {
  queued: { label: '\u6392\u961f\u4e2d', color: 'default' },
  running: { label: '\u6267\u884c\u4e2d', color: 'processing', icon: <LoadingOutlined /> },
  completed: { label: '\u5df2\u5b8c\u6210', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: '\u5931\u8d25', color: 'error', icon: <CloseCircleOutlined /> },
  cancelled: { label: '\u5df2\u53d6\u6d88', color: 'default' },
};

const sceneLabel: Record<string, string> = {
  report: '\u62a5\u544a',
  review: '\u5ba1\u67e5',
  rewrite: '\u6539\u5199',
  diff: '\u5bf9\u6bd4',
  summary: '\u6458\u8981',
  memory: '\u8bb0\u5fc6',
  description: '\u63cf\u8ff0',
  taskExecute: '\u4efb\u52a1',
  sectionAnalysis: '\u5206\u6790',
  templateExtract: '\u6a21\u677f',
  general: 'AI',
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const getJobSummary = (job: AIJob) => job.error || job.resultPreview || '';

const AIJobCenter: React.FC = () => {
  const { jobs, clearFinished, cancelJob } = useAIJobStore();
  const [open, setOpen] = useState(false);

  const activeCount = useMemo(() => jobs.filter((job) => job.status === 'queued' || job.status === 'running').length, [jobs]);
  const failedCount = useMemo(() => jobs.filter((job) => job.status === 'failed').length, [jobs]);
  const badgeCount = activeCount + failedCount;

  const content = (
    <div style={{ width: 336, maxWidth: 'calc(100vw - 48px)', userSelect: 'none' }} onWheel={(event) => event.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space size={6}>
          <Text strong>{'AI \u4efb\u52a1'}</Text>
          {activeCount > 0 && <Tag color="processing" style={{ margin: 0 }}>{activeCount} {'\u8fdb\u884c\u4e2d'}</Tag>}
          {failedCount > 0 && <Tag color="error" style={{ margin: 0 }}>{failedCount} {'\u5931\u8d25'}</Tag>}
        </Space>
        <Button
          size="small"
          type="text"
          icon={<ClearOutlined />}
          onClick={clearFinished}
          disabled={!jobs.some((job) => job.status !== 'queued' && job.status !== 'running')}
        >
          {'\u6e05\u7406'}
        </Button>
      </div>
      {jobs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0 AI \u4efb\u52a1'} />
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4, overscrollBehavior: 'contain' }}>
          <List
            size="small"
            dataSource={jobs.slice(0, 10)}
            renderItem={(job) => {
              const meta = statusMeta[job.status];
              const summary = getJobSummary(job);
              const canCancel = job.status === 'queued' || job.status === 'running';
              return (
                <List.Item
                  style={{ padding: '8px 6px', borderBlockEnd: 'none', borderRadius: 7, marginBottom: 4, background: job.status === 'failed' ? '#fff2f0' : job.status === 'running' ? '#f6fbff' : 'transparent' }}
                  actions={canCancel ? [
                    <Button key="cancel" size="small" type="text" danger icon={<StopOutlined />} onClick={() => cancelJob(job.id)}>
                      {'取消'}
                    </Button>,
                  ] : undefined}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6} style={{ maxWidth: '100%' }}>
                        <Text strong style={{ maxWidth: 174, fontSize: 12 }} ellipsis={{ tooltip: job.title }}>{job.title}</Text>
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
                        {summary && <Text type={job.status === 'failed' ? 'danger' : 'secondary'} style={{ display: 'block', fontSize: 11 }} ellipsis={{ tooltip: summary }}>{summary}</Text>}
                        <Text type="secondary" style={{ display: 'block', fontSize: 10, marginTop: 1 }}>{formatTime(job.updatedAt)}</Text>
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
    <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={content} arrow overlayStyle={{ maxWidth: 366 }}>
      <Badge count={badgeCount} size="small" overflowCount={9} offset={[-2, 4]}>
        <Button icon={<RobotOutlined />} title={'AI \u4efb\u52a1'} aria-label={'AI \u4efb\u52a1'} onMouseDown={(event) => event.preventDefault()} />
      </Badge>
    </Popover>
  );
};

export default AIJobCenter;

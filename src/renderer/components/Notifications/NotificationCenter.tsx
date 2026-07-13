import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Empty, List, Popover, Progress, Space, Tabs, Tag, Typography } from 'antd';
import { BellOutlined, CheckCircleOutlined, CheckOutlined, CloseCircleOutlined, CloseOutlined, LoadingOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAIJobStore } from '../../stores/aiJobStore';
import type { AIJob, ProjectDocument, ReviewResult } from '../../../shared/types';

type NotificationTarget = 'overview' | 'project-plan' | 'project-report' | 'project-review';

type NotificationItem = {
  id: string;
  type: 'report' | 'review' | 'deadline';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  projectId?: string;
  target: NotificationTarget;
  createdAt: string;
  native?: boolean;
};

const { Text } = Typography;
const READ_KEY = 'projecthub.notification.readIds.v2';
const NATIVE_KEY = 'projecthub.notification.nativeSentIds.v2';

const safeDateMs = (value?: string) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const loadIdSet = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
};

const saveIdSet = (key: string, ids: Set<string>) => {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-300)));
  } catch {}
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const severityColor: Record<NotificationItem['severity'], string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue',
};

const typeLabel: Record<NotificationItem['type'], string> = {
  report: '\u62a5\u544a',
  review: '\u5ba1\u67e5',
  deadline: '\u622a\u6b62',
};

const aiSceneLabel: Record<AIJob['scene'], string> = {
  report: 'AI 报告生成',
  review: 'AI 文档审查',
  rewrite: 'AI 文稿改写',
  diff: 'AI 版本对比',
  summary: 'AI 摘要生成',
  memory: 'AI 阶段记忆整理',
  description: 'AI 项目概述编写',
  taskExecute: 'AI 任务执行',
  sectionAnalysis: 'AI 章节分析',
  templateExtract: 'AI 模板提取',
  general: 'AI 处理',
};

const aiStatusMeta: Record<AIJob['status'], { label: string; color: string; icon?: React.ReactNode }> = {
  queued: { label: '排队中', color: 'default' },
  running: { label: '进行中', color: 'processing', icon: <LoadingOutlined /> },
  completed: { label: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: 'error', icon: <CloseCircleOutlined /> },
  cancelled: { label: '已取消', color: 'default' },
};

const isActiveAIJob = (job: AIJob) => job.status === 'queued' || job.status === 'running';

const buildLatestReportNotification = (projectId: string, projectName: string, docs: ProjectDocument[]): NotificationItem | null => {
  const reportDocs = docs
    .filter(doc => doc.projectId === projectId && Boolean(doc.aiReport))
    .sort((a, b) => safeDateMs(b.analyzedAt || b.createdAt) - safeDateMs(a.analyzedAt || a.createdAt));
  const latest = reportDocs[0];
  if (!latest) return null;
  const createdAt = latest.analyzedAt || latest.createdAt;
  return {
    id: `report-project-${projectId}-${createdAt}-${reportDocs.length}`,
    type: 'report',
    severity: 'low',
    title: `\u9879\u76ee\u62a5\u544a\u751f\u6210\u5b8c\u6bd5\uff1a${projectName}`,
    description: reportDocs.length > 1
      ? `\u5df2\u751f\u6210/\u66f4\u65b0 ${reportDocs.length} \u4efd\u62a5\u544a\uff0c\u6700\u65b0\uff1a${latest.name}`
      : `\u5df2\u751f\u6210\u62a5\u544a\uff1a${latest.name}`,
    projectId,
    target: 'project-report',
    createdAt,
    native: true,
  };
};

const buildLatestReviewNotification = (projectId: string, projectName: string, reviews: ReviewResult[]): NotificationItem | null => {
  const projectReviews = reviews
    .filter(review => review.projectId === projectId)
    .sort((a, b) => safeDateMs(b.createdAt) - safeDateMs(a.createdAt));
  const latest = projectReviews[0];
  if (!latest) return null;
  const issueCount = latest.issues?.length || 0;
  const errors = latest.issues?.filter(issue => issue.severity === 'error').length || 0;
  const severity: NotificationItem['severity'] = errors > 0 || latest.score < 60 ? 'high' : issueCount > 0 || latest.score < 80 ? 'medium' : 'low';
  return {
    id: `review-project-${projectId}-${latest.id}`,
    type: 'review',
    severity,
    title: `\u9879\u76ee\u5ba1\u67e5\u5b8c\u6210\uff1a${projectName}`,
    description: `${latest.score} \u5206\uff0c\u5171 ${issueCount} \u4e2a\u95ee\u9898`,
    projectId,
    target: 'project-review',
    createdAt: latest.createdAt,
    native: severity !== 'low',
  };
};

const buildDeadlineNotification = (projectId: string, projectName: string, docs: ProjectDocument[]): NotificationItem | null => {
  const relevant = docs
    .filter(doc => doc.projectId === projectId && doc.deadline && !doc.completedAt)
    .map(doc => ({ doc, deadlineMs: safeDateMs(doc.deadline) }))
    .filter(item => item.deadlineMs > 0);
  const now = Date.now();
  const visible = relevant.filter(item => item.deadlineMs - now <= 3 * 24 * 60 * 60 * 1000);
  if (visible.length === 0) return null;
  const overdueCount = visible.filter(item => item.deadlineMs < now).length;
  const latestActivity = Math.max(...visible.map(item => item.deadlineMs));
  const nearest = [...visible].sort((a, b) => a.deadlineMs - b.deadlineMs)[0];
  return {
    id: `deadline-project-${projectId}-${visible.length}-${overdueCount}-${nearest.doc.deadline}`,
    type: 'deadline',
    severity: overdueCount > 0 ? 'high' : 'medium',
    title: overdueCount > 0 ? `\u9879\u76ee\u5b58\u5728\u903e\u671f\u4e8b\u9879\uff1a${projectName}` : `\u9879\u76ee\u9636\u6bb5\u5373\u5c06\u5230\u671f\uff1a${projectName}`,
    description: overdueCount > 0
      ? `${overdueCount} \u4e2a\u9636\u6bb5\u5df2\u903e\u671f\uff0c\u8bf7\u53ca\u65f6\u5904\u7406`
      : `${visible.length} \u4e2a\u9636\u6bb5\u4e34\u671f\uff0c\u6700\u8fd1\u622a\u6b62 ${formatTime(nearest.doc.deadline || '')}`,
    projectId,
    target: 'project-plan',
    createdAt: new Date(Math.max(now, latestActivity)).toISOString(),
    native: true,
  };
};

interface Props {
  onOpenTarget: (target: NotificationTarget, projectId?: string) => void;
  hidden?: boolean;
}

const NotificationCenter: React.FC<Props> = ({ onOpenTarget, hidden = false }) => {
  const { projects } = useProjectStore();
  const { reviews } = useTemplateStore();
  const { projectDocs } = useProjectDocStore();
  const { jobs: aiJobs, cancelJob, retryJob, clearJob, syncExternalActivity } = useAIJobStore();
  const { enableSystemNotifications } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIdSet(READ_KEY));
  const nativeIdsRef = useRef<Set<string>>(loadIdSet(NATIVE_KEY));
  const didPrimeNativeRef = useRef(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.electronAPI.onAIActivity?.(syncExternalActivity), [syncExternalActivity]);

  const items = useMemo(() => {
    const list: NotificationItem[] = [];
    projects.forEach(project => {
      const report = buildLatestReportNotification(project.id, project.name, projectDocs);
      if (report) list.push(report);
      const review = buildLatestReviewNotification(project.id, project.name, reviews);
      if (review) list.push(review);
      const deadline = buildDeadlineNotification(project.id, project.name, projectDocs);
      if (deadline) list.push(deadline);
    });
    return list
      .sort((a, b) => safeDateMs(b.createdAt) - safeDateMs(a.createdAt))
      .slice(0, 24);
  }, [projectDocs, projects, reviews]);

  const sortedAIJobs = useMemo(() => {
    const order: Record<AIJob['status'], number> = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
    return [...aiJobs].sort((a, b) => {
      const rank = (order[a.status] ?? 5) - (order[b.status] ?? 5);
      return rank || safeDateMs(b.updatedAt) - safeDateMs(a.updatedAt);
    }).slice(0, 20);
  }, [aiJobs]);

  const unreadCount = items.filter(item => !readIds.has(item.id)).length;
  const activeAICount = aiJobs.filter(job => job.status === 'queued' || job.status === 'running').length;
  const failedAICount = aiJobs.filter(job => job.status === 'failed').length;

  useEffect(() => {
    if (items.length === 0) return;
    if (!didPrimeNativeRef.current) {
      // 启动时静默标记：只抑制 low 级别的通知，high/medium（逾期、严重审查问题）仍然触发
      items.forEach(item => {
        if (item.severity === 'low' || !item.native) {
          nativeIdsRef.current.add(item.id);
        }
      });
      saveIdSet(NATIVE_KEY, nativeIdsRef.current);
      didPrimeNativeRef.current = true;
      // 不 return — 让 high/medium 的通知继续走下面的发送逻辑
    }

    const nextNativeIds = new Set(nativeIdsRef.current);
    void Promise.all(items.map(async (item) => {
      if (!item.native || nextNativeIds.has(item.id)) return;
      nextNativeIds.add(item.id);
      if (enableSystemNotifications) {
        try {
          const result = await window.electronAPI.showSystemNotification?.({
            title: item.title,
            body: item.description,
            target: item.target,
            projectId: item.projectId,
          });
          if (result && !result.success) {
            console.warn('[NotificationCenter] 系统通知发送失败:', result.error);
          } else if (!result) {
            console.warn('[NotificationCenter] showSystemNotification 不可用（preload 未暴露）');
          }
        } catch (error) {
          console.warn('[NotificationCenter] 系统通知异常:', error);
        }
      }
    })).finally(() => {
      nativeIdsRef.current = nextNativeIds;
      saveIdSet(NATIVE_KEY, nextNativeIds);
    });
  }, [enableSystemNotifications, items]);

  const clearInteractionState = () => {
    window.getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const markAllRead = () => {
    clearInteractionState();
    const next = new Set(readIds);
    items.forEach(item => next.add(item.id));
    setReadIds(next);
    saveIdSet(READ_KEY, next);
  };

  const openItem = (item: NotificationItem) => {
    clearInteractionState();
    const next = new Set(readIds);
    next.add(item.id);
    setReadIds(next);
    saveIdSet(READ_KEY, next);
    setOpen(false);
    onOpenTarget(item.target, item.projectId);
    window.requestAnimationFrame(clearInteractionState);
  };

  const handlePopoverWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop += event.deltaY;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const content = (
    <div style={{ width: 350, maxWidth: 'calc(100vw - 48px)', overscrollBehavior: 'contain', userSelect: 'none' }}>
      <Tabs
        size="small"
        defaultActiveKey="system"
        items={[
          {
            key: 'system',
            label: <Space size={5}>系统{unreadCount > 0 && <Tag color="blue" style={{ margin: 0 }}>{unreadCount}</Tag>}</Space>,
            children: <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <Button size="small" type="text" icon={<CheckOutlined />} onClick={markAllRead} disabled={unreadCount === 0}>全部已读</Button>
              </div>
              {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无系统提醒" /> : (
                <div ref={listScrollRef} style={{ maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 4 }} onWheel={handlePopoverWheel}>
                  <List
                    size="small"
                    dataSource={items.slice(0, 10)}
                    renderItem={(item) => {
                      const unread = !readIds.has(item.id);
                      return (
                        <List.Item
                          onClick={() => openItem(item)}
                          style={{ cursor: 'pointer', alignItems: 'flex-start', borderRadius: 7, padding: '8px 7px', background: unread ? '#f5faff' : 'transparent', borderBlockEnd: 'none', marginBottom: 3 }}
                        >
                          <List.Item.Meta
                            title={<Space size={5} style={{ maxWidth: '100%' }}>{unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1677ff', flexShrink: 0 }} />}<Text strong={unread} style={{ fontSize: 12, maxWidth: 188 }} ellipsis={{ tooltip: item.title }}>{item.title}</Text><Tag color={severityColor[item.severity]} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>{typeLabel[item.type]}</Tag></Space>}
                            description={<div><Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: item.description }}>{item.description}</Text><Text type="secondary" style={{ display: 'block', fontSize: 10, marginTop: 1 }}>{formatTime(item.createdAt)}</Text></div>}
                          />
                        </List.Item>
                      );
                    }}
                  />
                </div>
              )}
            </>,
          },
          {
            key: 'ai',
            label: <Space size={5}>AI{activeAICount > 0 && <Tag color="processing" style={{ margin: 0 }}>{activeAICount}</Tag>}{failedAICount > 0 && <Tag color="error" style={{ margin: 0 }}>{failedAICount}</Tag>}</Space>,
            children: sortedAIJobs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 AI 任务" /> : (
              <div style={{ maxHeight: 350, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 4 }}>
                <List
                  size="small"
                  dataSource={sortedAIJobs}
                  renderItem={(job) => {
                    const meta = aiStatusMeta[job.status];
                    const canRetry = job.status === 'failed' && job.canRetry;
                    const usage = job.tokenUsage && job.tokenUsage.totalTokens > 0
                      ? `Token ${job.tokenUsage.totalTokens.toLocaleString()}（入 ${job.tokenUsage.inputTokens.toLocaleString()} / 出 ${job.tokenUsage.outputTokens.toLocaleString()}）${job.tokenUsage.source === 'estimated' ? ' 估算' : ''}`
                      : '';
                    return (
                      <List.Item
                        style={{ alignItems: 'flex-start', borderRadius: 7, padding: '8px 7px', borderBlockEnd: 'none', marginBottom: 3, background: job.status === 'failed' ? '#fff2f0' : isActiveAIJob(job) ? '#f5faff' : 'transparent' }}
                        actions={[
                          isActiveAIJob(job) && <Button key="cancel" size="small" type="text" danger icon={<StopOutlined />} onClick={() => cancelJob(job.id)}>取消</Button>,
                          canRetry && <Button key="retry" size="small" type="text" icon={<ReloadOutlined />} onClick={() => void retryJob(job.id)}>重试</Button>,
                          !isActiveAIJob(job) && <Button key="dismiss" size="small" type="text" icon={<CloseOutlined style={{ fontSize: 10 }} />} onClick={() => clearJob(job.id)} style={{ padding: '0 4px' }} />,
                        ].filter(Boolean)}
                      >
                        <List.Item.Meta
                          title={<Space size={5} style={{ maxWidth: '100%' }}><Text strong style={{ maxWidth: 170, fontSize: 12 }} ellipsis={{ tooltip: job.title }}>{aiSceneLabel[job.scene]}</Text><Tag icon={meta.icon} color={meta.color} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>{meta.label}</Tag></Space>}
                          description={<div><Text type={job.status === 'failed' ? 'danger' : 'secondary'} style={{ display: 'block', fontSize: 11 }} ellipsis={{ tooltip: job.error || job.resultPreview || job.title }}>{job.error || job.resultPreview || job.title}</Text>{isActiveAIJob(job) && <Progress percent={job.progress} size="small" showInfo={false} style={{ margin: '3px 0 1px' }} />}<Text type="secondary" style={{ display: 'block', fontSize: 10, marginTop: 1 }}>{formatTime(job.finishedAt || job.startedAt || job.createdAt)}{usage ? ` · ${usage}` : ''}</Text></div>}
                        />
                      </List.Item>
                    );
                  }}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  if (hidden) return null;

  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={content} arrow overlayStyle={{ maxWidth: 316 }}>
      <Badge className="notification-bell-badge" count={unreadCount} size="small" overflowCount={99} offset={[-7, 2]}>
        <Button icon={<BellOutlined />} title={'\u901a\u77e5'} onMouseDown={(event) => event.preventDefault()} />
      </Badge>
    </Popover>
  );
};

export default NotificationCenter;

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Card, Row, Col, Typography, Modal, Tag, Empty, Progress } from 'antd';
import {
  FolderOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { Project } from '../../../shared/types';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { checkDeadlineStatus, type TimelineStageSegment } from '../../utils/timelineStages';
import { useSegmentsByProject } from './SegmentsContext';

/** 数字递增动画 Hook */
function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setDisplay(0); return; }
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

const { Text } = Typography;

type StatKind = 'projects' | 'completed' | 'aboutToExpire' | 'overdue';

interface StatsCardsProps {
  onSelectProject?: (project: Project) => void;
}

interface ProjectStatListItem {
  project: Project;
  segments: TimelineStageSegment[];
}

const formatDateTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

const projectStatusMeta: Record<Project['status'], { label: string; color: string }> = {
  active: { label: '进行中', color: 'blue' },
  completed: { label: '已完成', color: 'green' },
  paused: { label: '已暂停', color: 'default' },
};

const StatsCards: React.FC<StatsCardsProps> = ({ onSelectProject }) => {
  const projects = useProjectStore(s => s.projects);
  const segmentsByProject = useSegmentsByProject();
  const [activeStat, setActiveStat] = useState<StatKind | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalProjects = projects.length;
  const activeProjects = useMemo(() => projects.filter(p => p.status === 'active').length, [projects]);
  const completedProjects = useMemo(() => projects.filter(p => p.status === 'completed').length, [projects]);

  // 从共享 Context 获取 segments，不再重复计算
  const allSegments = useMemo(() => {
    const result: any[] = [];
    for (const segments of segmentsByProject.values()) {
      result.push(...segments);
    }
    return result;
  }, [segmentsByProject]);

  const totalStages = allSegments.length;
  const completedStages = useMemo(() => allSegments.filter(s => Boolean(s.completedAt)).length, [allSegments]);

  // 逾期和即将逾期判断（统一使用 checkDeadlineStatus）
  const segmentDlStatus = (s: { deadline?: string; completedAt?: string }) =>
    (!s.deadline || s.completedAt) ? 'normal' as const : checkDeadlineStatus(s.deadline, nowMs);

  const overdueStages = useMemo(() => allSegments.filter(s => segmentDlStatus(s) === 'overdue').length, [allSegments]);
  const aboutToExpireStages = useMemo(() => allSegments.filter(s => segmentDlStatus(s) === 'aboutToExpire').length, [allSegments]);

  const stats: StatCardData[] = [
    {
      key: 'projects',
      title: '项目总数',
      value: totalProjects,
      icon: <FolderOutlined />,
      iconBg: '#1890ff',
      subtitle: `进行中 ${activeProjects} | 已完成 ${completedProjects}`,
    },
    {
      key: 'completed',
      title: '已完成阶段',
      value: completedStages,
      icon: <CheckCircleOutlined />,
      iconBg: '#52c41a',
      subtitle: `共 ${totalStages} 个阶段`,
    },
    {
      key: 'aboutToExpire',
      title: '即将逾期',
      value: aboutToExpireStages,
      icon: <ExclamationCircleOutlined />,
      iconBg: '#faad14',
      subtitle: aboutToExpireStages > 0 ? '今天到期未完成' : '暂无即将逾期',
    },
    {
      key: 'overdue',
      title: '已逾期',
      value: overdueStages,
      icon: <WarningOutlined />,
      iconBg: overdueStages > 0 ? '#ff4d4f' : '#d9d9d9',
      subtitle: overdueStages > 0 ? `${overdueStages} 项阶段逾期` : '暂无逾期',
    },
  ];

  const modalItems = useMemo<ProjectStatListItem[]>(() => {
    if (!activeStat) return [];
    return projects.flatMap(project => {
      const segments = segmentsByProject.get(project.id) || [];
      if (activeStat === 'projects') return [{ project, segments }];
      const matched = segments.filter(segment => {
        if (activeStat === 'completed') return Boolean(segment.completedAt);
        return segmentDlStatus(segment) === activeStat;
      });
      return matched.length ? [{ project, segments: matched }] : [];
    });
  }, [activeStat, projects, segmentsByProject, nowMs]);

  const activeStatData = stats.find(stat => stat.key === activeStat);
  const modalStageCount = modalItems.reduce((total, item) => total + item.segments.length, 0);

  const handleProjectSelect = (project: Project) => {
    setActiveStat(null);
    onSelectProject?.(project);
  };

  return (
    <Row className="stats-grid" gutter={[16, 16]}>
      {stats.map((stat, index) => (
        <Col xs={12} sm={12} md={6} key={index}>
          <Card
            className={`dashboard-card stat-card stat-card-action animate-slide-up stagger-${index + 1}`}
            variant="borderless"
            role="button"
            tabIndex={0}
            aria-label={`查看${stat.title}列表`}
            onClick={() => setActiveStat(stat.key)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActiveStat(stat.key);
              }
            }}
            style={{
              height: '100%',
            }}
            styles={{ body: { padding: '18px 18px 16px' } }}
          >
            <StatCardContent stat={stat} />
          </Card>
        </Col>
      ))}
      <Modal
        open={Boolean(activeStat)}
        onCancel={() => setActiveStat(null)}
        footer={null}
        width={760}
        centered
        className="stats-list-modal"
        title={(
          <div className="stats-list-title">
            <span className="stats-list-title-icon" style={{ color: activeStatData?.iconBg, background: `${activeStatData?.iconBg}12` }}>
              {activeStatData?.icon}
            </span>
            <span>
              <strong>{activeStatData?.title}</strong>
              <small>
                {activeStat === 'projects'
                  ? `共 ${modalItems.length} 个项目`
                  : `涉及 ${modalItems.length} 个项目，共 ${modalStageCount} 个阶段`}
              </small>
            </span>
          </div>
        )}
      >
        <div className="stats-list-body">
          {modalItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={activeStat === 'aboutToExpire' ? '暂无即将逾期的阶段' : activeStat === 'overdue' ? '暂无已逾期的阶段' : '暂无相关项目'} />
          ) : modalItems.map(({ project, segments }) => {
            const statusMeta = projectStatusMeta[project.status];
            const completedCount = segments.filter(segment => Boolean(segment.completedAt)).length;
            const progress = activeStat === 'projects' && segments.length
              ? Math.round((completedCount / segments.length) * 100)
              : project.progress;
            return (
              <button key={project.id} type="button" className="stats-project-item" onClick={() => handleProjectSelect(project)}>
                <div className="stats-project-main">
                  <div className="stats-project-heading">
                    <span className="stats-project-folder"><FolderOutlined /></span>
                    <strong title={project.name}>{project.name}</strong>
                    <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                  </div>
                  {activeStat === 'projects' ? (
                    <div className="stats-project-progress">
                      <Progress percent={progress} size="small" showInfo={false} />
                      <span>{segments.length ? `${completedCount}/${segments.length} 个阶段` : '暂无阶段文件'}</span>
                    </div>
                  ) : (
                    <div className="stats-stage-list">
                      {segments.map(segment => (
                        <div className="stats-stage-row" key={`${segment.projectId}-${segment.stage}`}>
                          <Tag color={activeStat === 'completed' ? 'success' : activeStat === 'overdue' ? 'error' : 'warning'}>{segment.label}</Tag>
                          <span>{activeStat === 'completed' ? `完成于 ${formatDateTime(segment.completedAt)}` : `截止 ${formatDateTime(segment.deadline)}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <RightOutlined className="stats-project-enter" />
              </button>
            );
          })}
        </div>
      </Modal>
    </Row>
  );
};

/** 单个统计卡片内容（带数字递增动画） */
interface StatCardData {
  key: StatKind;
  title: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  subtitle: string;
}

const StatCardContent: React.FC<{ stat: StatCardData }> = ({ stat }) => {
  const animatedValue = useCountUp(stat.value);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{stat.title}</Text>
        <div style={{
          fontSize: 28, fontWeight: 700, marginTop: 9, lineHeight: 1, color: '#0f172a',
          transition: 'color 0.2s ease',
        }}>
          {animatedValue}
        </div>
        <Text type="secondary" style={{ fontSize: 11, marginTop: 10, display: 'block' }} ellipsis>
          {stat.subtitle}
        </Text>
      </div>
      <div style={{
        width: 42, height: 42, borderRadius: 12,
        background: `${stat.iconBg}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        boxShadow: `0 10px 24px ${stat.iconBg}18`,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}>
        {React.cloneElement(stat.icon as React.ReactElement, { style: { fontSize: 20, color: stat.iconBg } })}
      </div>
    </div>
  );
};

export default StatsCards;

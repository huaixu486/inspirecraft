import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Card, Row, Col, Typography } from 'antd';
import {
  FolderOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { checkDeadlineStatus } from '../../utils/timelineStages';
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

const StatsCards: React.FC = () => {
  const projects = useProjectStore(s => s.projects);
  const segmentsByProject = useSegmentsByProject();

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

  const nowMs = Date.now();

  const totalStages = allSegments.length;
  const completedStages = useMemo(() => allSegments.filter(s => Boolean(s.completedAt)).length, [allSegments]);

  // 逾期和即将逾期判断（统一使用 checkDeadlineStatus）
  const segmentDlStatus = (s: { deadline?: string; completedAt?: string }) =>
    (!s.deadline || s.completedAt) ? 'normal' as const : checkDeadlineStatus(s.deadline, nowMs);

  const overdueStages = useMemo(() => allSegments.filter(s => segmentDlStatus(s) === 'overdue').length, [allSegments]);
  const aboutToExpireStages = useMemo(() => allSegments.filter(s => segmentDlStatus(s) === 'aboutToExpire').length, [allSegments]);

  const stats: StatCardData[] = [
    {
      title: '项目总数',
      value: totalProjects,
      icon: <FolderOutlined />,
      iconBg: '#1890ff',
      subtitle: `进行中 ${activeProjects} | 已完成 ${completedProjects}`,
    },
    {
      title: '已完成阶段',
      value: completedStages,
      icon: <CheckCircleOutlined />,
      iconBg: '#52c41a',
      subtitle: `共 ${totalStages} 个阶段`,
    },
    {
      title: '即将逾期',
      value: aboutToExpireStages,
      icon: <ExclamationCircleOutlined />,
      iconBg: '#faad14',
      subtitle: aboutToExpireStages > 0 ? '今天到期未完成' : '暂无即将逾期',
    },
    {
      title: '已逾期',
      value: overdueStages,
      icon: <WarningOutlined />,
      iconBg: overdueStages > 0 ? '#ff4d4f' : '#d9d9d9',
      subtitle: overdueStages > 0 ? `${overdueStages} 项阶段逾期` : '暂无逾期',
    },
  ];

  return (
    <Row className="stats-grid" gutter={[16, 16]}>
      {stats.map((stat, index) => (
        <Col xs={12} sm={12} md={6} key={index}>
          <Card
            className={`dashboard-card stat-card animate-slide-up stagger-${index + 1}`}
            variant="borderless"
            style={{
              height: '100%',
            }}
            styles={{ body: { padding: '18px 18px 16px' } }}
          >
            <StatCardContent stat={stat} />
          </Card>
        </Col>
      ))}
    </Row>
  );
};

/** 单个统计卡片内容（带数字递增动画） */
interface StatCardData {
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

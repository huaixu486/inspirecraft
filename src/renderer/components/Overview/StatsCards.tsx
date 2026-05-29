import React from 'react';
import { Card, Row, Col, Typography } from 'antd';
import {
  FolderOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { buildProjectStageSegments } from '../../utils/timelineStages';

const { Text } = Typography;

const StatsCards: React.FC = () => {
  const { projects, versions } = useProjectStore();
  const { projectDocs } = useProjectDocStore();
  const { templates } = useTemplateStore();

  const totalProjects = projects.length;
  const activeProjects = projects.filter(p => p.status === 'active').length;
  const completedProjects = projects.filter(p => p.status === 'completed').length;

  // 按阶段类型分组统计（一个阶段 = 一个 TimelineStageSegment，不是单个文件）
  const allSegments = projects.flatMap(project =>
    buildProjectStageSegments(
      project,
      projectDocs.filter(d => d.projectId === project.id),
      templates,
      versions.filter(v => v.projectId === project.id),
    ),
  );

  const nowMs = Date.now();

  const totalStages = allSegments.length;
  const completedStages = allSegments.filter(s => Boolean(s.completedAt)).length;

  // 逾期和即将逾期判断（与 GanttChart 逻辑一致）
  const isSegmentOverdue = (s: { deadline?: string; completedAt?: string }) => {
    if (!s.deadline || s.completedAt) return false;
    const dlMs = new Date(s.deadline).getTime();
    const d = new Date(s.deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return dlMs < nowMs;
    const nowD = new Date();
    const dlD = new Date(s.deadline);
    return (dlD.getFullYear() < nowD.getFullYear())
      || (dlD.getFullYear() === nowD.getFullYear() && dlD.getMonth() < nowD.getMonth())
      || (dlD.getFullYear() === nowD.getFullYear() && dlD.getMonth() === nowD.getMonth() && dlD.getDate() < nowD.getDate());
  };

  const isSegmentAboutToExpire = (s: { deadline?: string; completedAt?: string }) => {
    if (!s.deadline || s.completedAt || isSegmentOverdue(s)) return false;
    const d = new Date(s.deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return nowMs >= new Date(s.deadline).getTime() - 24 * 60 * 60 * 1000;
    const nowD = new Date();
    return nowD.getFullYear() === d.getFullYear() && nowD.getMonth() === d.getMonth() && nowD.getDate() === d.getDate();
  };

  const overdueStages = allSegments.filter(isSegmentOverdue).length;
  const aboutToExpireStages = allSegments.filter(isSegmentAboutToExpire).length;

  const stats = [
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
    <Row gutter={[16, 16]}>
      {stats.map((stat, index) => (
        <Col xs={12} sm={12} md={6} key={index}>
          <Card
            variant="borderless"
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              height: '100%',
            }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{stat.title}</Text>
                <div style={{ fontSize: 28, fontWeight: 'bold', marginTop: 8, lineHeight: 1, color: '#1a1a1a' }}>
                  {stat.value}
                </div>
                <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }} ellipsis>
                  {stat.subtitle}
                </Text>
              </div>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: `${stat.iconBg}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {React.cloneElement(stat.icon as React.ReactElement, { style: { fontSize: 20, color: stat.iconBg } })}
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default StatsCards;

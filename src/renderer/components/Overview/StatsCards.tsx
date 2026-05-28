import React from 'react';
import { Card, Row, Col, Typography } from 'antd';
import {
  FolderOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';

const { Text } = Typography;

const StatsCards: React.FC = () => {
  const { projects } = useProjectStore();
  const { projectDocs } = useProjectDocStore();

  const totalProjects = projects.length;
  const activeProjects = projects.filter(p => p.status === 'active').length;
  const completedProjects = projects.filter(p => p.status === 'completed').length;

  // 逾期：有 deadline 且已过期且未完成的文档
  const now = new Date();
  const overdueDocs = projectDocs.filter(d =>
    d.deadline && !d.completedAt && new Date(d.deadline) < now
  );

  // 即将到期（7天内）
  const upcomingDocs = projectDocs.filter(d => {
    if (!d.deadline || d.completedAt) return false;
    const deadline = new Date(d.deadline);
    const diff = deadline.getTime() - now.getTime();
    return diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000;
  });

  const stats = [
    {
      title: '项目总数',
      value: totalProjects,
      icon: <FolderOutlined />,
      iconBg: '#1890ff',
      subtitle: `进行中 ${activeProjects} | 已完成 ${completedProjects}`,
    },
    {
      title: '进行中',
      value: activeProjects,
      icon: <CheckCircleOutlined />,
      iconBg: '#52c41a',
      subtitle: `共 ${totalProjects} 个项目`,
    },
    {
      title: '即将到期',
      value: upcomingDocs.length,
      icon: <ClockCircleOutlined />,
      iconBg: '#faad14',
      subtitle: upcomingDocs.length > 0 ? '7天内到期' : '暂无到期任务',
    },
    {
      title: '已逾期',
      value: overdueDocs.length,
      icon: <WarningOutlined />,
      iconBg: overdueDocs.length > 0 ? '#ff4d4f' : '#d9d9d9',
      subtitle: overdueDocs.length > 0 ? `${overdueDocs.length} 项文档逾期` : '暂无逾期',
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

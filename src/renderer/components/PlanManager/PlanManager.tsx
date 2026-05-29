import React, { useMemo } from 'react';
import {
  Typography, Card, Tag, Button, Space, Empty, DatePicker, Popconfirm, Badge, Collapse,
} from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, WarningOutlined,
  FolderOutlined, CalendarOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import {
  buildProjectStageSegments,
  timelineStageMeta,
  TimelineStageSegment,
} from '../../utils/timelineStages';

const { Text, Title } = Typography;

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '未设置';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const PlanManager: React.FC = () => {
  const { projects, versions } = useProjectStore();
  const { projectDocs, updateProjectDoc } = useProjectDocStore();
  const { templates } = useTemplateStore();

  const projectSegments = useMemo(() => {
    return projects.map(project => ({
      project,
      segments: buildProjectStageSegments(
        project,
        projectDocs.filter(d => d.projectId === project.id),
        templates,
        versions.filter(v => v.projectId === project.id),
      ),
    }));
  }, [projects, projectDocs, templates, versions]);

  const totalStages = projectSegments.reduce((acc, p) => acc + p.segments.length, 0);
  const completedStages = projectSegments.reduce(
    (acc, p) => acc + p.segments.filter(s => Boolean(s.completedAt)).length, 0,
  );
  const overdueStages = projectSegments.reduce(
    (acc, p) => acc + p.segments.filter(
      s => s.deadline && new Date(s.deadline).getTime() < Date.now() && !s.completedAt,
    ).length, 0,
  );

  const handleStageComplete = async (segment: TimelineStageSegment) => {
    const completedAt = new Date().toISOString();
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt })));
  };

  const handleStageReopen = async (segment: TimelineStageSegment) => {
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt: undefined })));
  };

  const handleStageDeadline = async (segment: TimelineStageSegment, deadline?: string) => {
    // 规范化为当天 00:00:00，避免 showTime 导致的时间判断问题
    const normalized = deadline ? (() => { const d = new Date(deadline); d.setHours(0, 0, 0, 0); return d.toISOString(); })() : undefined;
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { deadline: normalized })));
  };

  const renderSegment = (segment: TimelineStageSegment) => {
    const color = timelineStageMeta[segment.stage].color;
    const isCompleted = Boolean(segment.completedAt);
    const isOverdue = segment.deadline
      && new Date(segment.deadline).getTime() < Date.now()
      && !isCompleted;

    return (
      <div
        key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
        style={{
          padding: '12px 14px',
          border: `1px solid ${isOverdue ? '#ffccc7' : '#f0f0f0'}`,
          borderRadius: 8,
          background: isOverdue ? '#fff7f6' : isCompleted ? '#f6ffed' : '#fff',
          transition: 'background 0.3s',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Space size={8} align="center">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block', flexShrink: 0 }} />
            <Text strong style={{ fontSize: 14 }}>{segment.label}</Text>
            {isCompleted ? (
              <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0 }}>已完成</Tag>
            ) : isOverdue ? (
              <Tag icon={<WarningOutlined />} color="error" style={{ margin: 0 }}>逾期</Tag>
            ) : (
              <Tag icon={<ClockCircleOutlined />} color="processing" style={{ margin: 0 }}>进行中</Tag>
            )}
          </Space>
          <Space size={6}>
            {isCompleted ? (
              <Popconfirm title="确定取消完成？" onConfirm={() => handleStageReopen(segment)} okText="确定" cancelText="取消">
                <Button size="small" icon={<ReloadOutlined />}>取消完成</Button>
              </Popconfirm>
            ) : (
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleStageComplete(segment)}>
                完成
              </Button>
            )}
          </Space>
        </div>

        {/* Info rows */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>开始时间</Text>
            <Text style={{ fontSize: 12 }}>{formatDateTime(segment.startAt)}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>完成时间</Text>
            <Text style={{ fontSize: 12, color: isCompleted ? '#52c41a' : undefined }}>
              {formatDateTime(segment.completedAt)}
            </Text>
          </div>
        </div>

        {/* Deadline */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarOutlined style={{ color: '#999', fontSize: 12 }} />
            <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>截止时间</Text>
            <DatePicker
              showTime
              allowClear
              size="small"
              style={{ flex: 1 }}
              value={segment.deadline ? dayjs(segment.deadline) : null}
              placeholder="设置截止时间"
              onChange={(value) => handleStageDeadline(segment, value ? value.toDate().toISOString() : undefined)}
            />
          </div>
        </div>

        {/* Source files */}
        {segment.sourceDocNames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {segment.sourceDocNames.map(name => (
              <Tag key={name} style={{ margin: 0, fontSize: 11 }}>{name}</Tag>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>计划管理</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          管理所有项目的阶段计划，完成阶段将同步更新时间线彩条
        </Text>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <Card size="small" style={{ borderRadius: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#1890ff' }}>{totalStages}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>总阶段数</Text>
          </div>
        </Card>
        <Card size="small" style={{ borderRadius: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#52c41a' }}>{completedStages}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>已完成</Text>
          </div>
        </Card>
        <Card size="small" style={{ borderRadius: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#ff4d4f' }}>{overdueStages}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>已逾期</Text>
          </div>
        </Card>
      </div>

      {/* Project list */}
      {projectSegments.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {projectSegments.map(({ project, segments }) => {
            const completed = segments.filter(s => Boolean(s.completedAt)).length;
            const overdue = segments.filter(
              s => s.deadline && new Date(s.deadline).getTime() < Date.now() && !s.completedAt,
            ).length;

            return (
              <Card
                key={project.id}
                size="small"
                title={
                  <Space align="center">
                    <FolderOutlined style={{ color: '#1890ff' }} />
                    <Text strong>{project.name}</Text>
                    <Badge
                      count={`${completed}/${segments.length}`}
                      style={{
                        backgroundColor: completed === segments.length && segments.length > 0 ? '#52c41a' : '#1890ff',
                      }}
                    />
                    {overdue > 0 && (
                      <Badge count={overdue} style={{ backgroundColor: '#ff4d4f' }} title="逾期" />
                    )}
                  </Space>
                }
                style={{ borderRadius: 10 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {segments.map(renderSegment)}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty description="暂无项目阶段数据" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            请先在总览或项目页面创建项目并关联文档
          </Text>
        </Empty>
      )}
    </div>
  );
};

export default PlanManager;

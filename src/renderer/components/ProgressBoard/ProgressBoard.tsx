import React, { useEffect, useMemo } from 'react';
import { Card, Progress, List, Tag, Typography, Empty, Space, Statistic, Row, Col, Divider } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { buildProjectStageSegments, getAllStages, getProjectProgress, getStageMeta } from '../../utils/timelineStages';

const { Text, Title } = Typography;

const ProgressBoard: React.FC = () => {
  const { currentProject, versions } = useProjectStore();
  const { projectDocs, loadProjectDocs } = useProjectDocStore();
  const { customStages } = useSettingsStore();
  const { tasks, loadTasks } = useTaskStore();
  const { templates, reviews, loadTemplates, loadReviews } = useTemplateStore();

  useEffect(() => {
    loadProjectDocs();
    loadTasks();
    loadTemplates();
    loadReviews();
  }, []);


  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);
  const projectVersions = currentProject ? versions.filter((v) => v.projectId === currentProject.id) : [];
  const projectDocsList = currentProject ? projectDocs.filter((d) => d.projectId === currentProject.id) : [];
  const projectTasks = currentProject ? tasks.filter((t) => t.projectId === currentProject.id) : [];
  const projectReviews = currentProject ? reviews.filter((r) => r.projectId === currentProject.id) : [];
  const projectProgress = currentProject ? getProjectProgress(currentProject, projectDocsList, templates, projectVersions, allStages) : 0;
  const stageSegments = currentProject ? buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages) : [];

  const openTasks = projectTasks.filter(task => task.status !== 'completed');
  const completedTasks = projectTasks.filter(task => task.status === 'completed');
  const highPriorityTasks = openTasks.filter(task => task.priority === 'high');
  const reviewTasks = openTasks.filter(task => task.source === 'review');
  const latestReview = [...projectReviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const stageRows = stageSegments.map(segment => {
    const docs = projectDocsList.filter(doc => segment.sourceDocIds.includes(doc.id));
    const progress = docs.length
      ? Math.round(docs.reduce((sum, doc) => sum + doc.overallProgress, 0) / docs.length)
      : segment.completedAt ? 100 : 0;
    const overdue = !segment.completedAt && segment.deadline && new Date(segment.deadline).getTime() < Date.now();
    const stageTasks = openTasks.filter(task => task.stageName === segment.stage || segment.sourceDocIds.includes(task.relatedDocId || ''));
    return { segment, progress, overdue, taskCount: stageTasks.length };
  });

  const workload = useMemo(() => {
    const map = new Map<string, { name: string; open: number; high: number; completed: number }>();
    projectTasks.forEach(task => {
      const name = task.assigneeName || (task.type === 'ai' ? 'AI 助手' : '未分配');
      const row = map.get(name) || { name, open: 0, high: 0, completed: 0 };
      if (task.status === 'completed') row.completed += 1;
      else {
        row.open += 1;
        if (task.priority === 'high') row.high += 1;
      }
      map.set(name, row);
    });
    return [...map.values()].sort((a, b) => b.open - a.open || b.high - a.high);
  }, [projectTasks]);

  const recentActivities = [
    ...projectTasks.map(task => ({
      id: `task-${task.id}`,
      title: task.title,
      type: task.source === 'review' ? '审查任务' : task.source === 'report' ? '报告任务' : '任务',
      time: task.completedAt || task.createdAt,
      status: task.status,
    })),
    ...projectReviews.map(review => ({
      id: `review-${review.id}`,
      title: review.summary,
      type: '审查记录',
      time: review.createdAt,
      status: review.score >= 80 ? 'completed' : 'pending',
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{currentProject.name} - 团队协同</Title>
        <Text type="secondary">阶段、审查和任务会在这里汇总，方便判断下一步该谁推进什么。</Text>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card>
          <Row gutter={16}>
            <Col span={6}><Statistic title="阶段进度" value={projectProgress} suffix="%" /></Col>
            <Col span={6}><Statistic title="待处理任务" value={openTasks.length} /></Col>
            <Col span={6}><Statistic title="高优先级" value={highPriorityTasks.length} valueStyle={{ color: highPriorityTasks.length ? '#ff4d4f' : undefined }} /></Col>
            <Col span={6}><Statistic title="最近审查" value={latestReview ? latestReview.score : 0} suffix={latestReview ? '分' : ''} /></Col>
          </Row>
          <Progress percent={projectProgress} style={{ marginTop: 12, marginBottom: 0 }} />
        </Card>

        <Row gutter={16}>
          <Col span={14}>
            <Card title="阶段推进">
              {stageRows.length === 0 ? (
                <Empty description="暂无阶段数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  dataSource={stageRows}
                  renderItem={({ segment, progress, overdue, taskCount }) => (
                    <List.Item>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: stageMeta[segment.stage]?.color || '#1677ff' }} />
                          <Text strong>{segment.label}</Text>
                          {segment.completedAt && <Tag color="green">已完成</Tag>}
                          {overdue && <Tag color="red">逾期</Tag>}
                          {taskCount > 0 && <Tag color="blue">{taskCount} 个待办</Tag>}
                          {segment.deadline && <Text type="secondary" style={{ marginLeft: 'auto' }}>截止 {dayjs(segment.deadline).format('MM-DD')}</Text>}
                        </div>
                        <Progress percent={progress} size="small" strokeColor={overdue ? '#ff4d4f' : stageMeta[segment.stage]?.color} />
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>

          <Col span={10}>
            <Card title="协同负载">
              {workload.length === 0 ? (
                <Empty description="暂无任务分配" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  dataSource={workload}
                  renderItem={(row) => (
                    <List.Item>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <TeamOutlined />
                          <Text>{row.name}</Text>
                        </Space>
                        <Space>
                          <Tag color={row.high ? 'red' : 'default'}>高 {row.high}</Tag>
                          <Tag color="blue">待办 {row.open}</Tag>
                          <Tag color="green">完成 {row.completed}</Tag>
                        </Space>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Card title="风险与待办">
              <List
                dataSource={openTasks.slice(0, 8)}
                locale={{ emptyText: '暂无待办任务' }}
                renderItem={(task) => (
                  <List.Item>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space wrap>
                        {task.priority === 'high'
                          ? <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                          : <ClockCircleOutlined style={{ color: '#faad14' }} />}
                        <Text strong>{task.title}</Text>
                        <Tag>{task.source === 'review' ? '审查' : task.source === 'report' ? '报告' : '任务'}</Tag>
                        {task.assigneeName && <Tag color="blue">{task.assigneeName}</Tag>}
                      </Space>
                      {task.description && <Text type="secondary" ellipsis>{task.description}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Space>
                <Tag color="red">审查待办 {reviewTasks.length}</Tag>
                <Tag color="green">已完成任务 {completedTasks.length}</Tag>
              </Space>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="最近动态">
              <List
                dataSource={recentActivities}
                locale={{ emptyText: '暂无动态' }}
                renderItem={(item) => (
                  <List.Item>
                    <Space>
                      {item.status === 'completed'
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : <FileTextOutlined style={{ color: '#1677ff' }} />}
                      <div>
                        <Text>{item.title}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.type} · {dayjs(item.time).format('MM-DD HH:mm')}
                        </Text>
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  );
};

export default ProgressBoard;

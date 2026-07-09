import React, { useEffect, useMemo, useState } from 'react';
import {
  Typography,
  Card,
  Tag,
  Button,
  Space,
  Empty,
  DatePicker,
  Popconfirm,
  Progress,
  List,
  Row,
  Col,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  FolderOutlined,
  CalendarOutlined,
  LeftOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { ProjectDocument, TaskItem } from '../../../shared/types';
import {
  buildProjectStageSegments,
  getAllStages,
  getStageMeta,
  TimelineStageSegment,
} from '../../utils/timelineStages';

const { Text, Title, Paragraph } = Typography;

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '未设置';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '未设置';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const statusLabels: Record<TaskItem['status'], string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
};

const statusColors: Record<TaskItem['status'], string> = {
  pending: 'default',
  in_progress: 'processing',
  completed: 'success',
};

const PlanManager: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { projects, currentProject, currentStageName, versions, setCurrentProject, setCurrentStageName } = useProjectStore();
  const { projectDocs, updateProjectDoc } = useProjectDocStore();
  const { templates } = useTemplateStore();
  const { customStages } = useSettingsStore();
  const { tasks, loadTasks, updateTask } = useTaskStore();
  const { learnStageFinal, deleteStageMemoriesForDoc } = useKnowledgeStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  useEffect(() => {
    loadTasks();
  }, []);

  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);

  const isOverdue = (deadline?: string, completedAt?: string) => {
    if (!deadline || completedAt) return false;
    const d = new Date(deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return d.getTime() < Date.now();
    const now = new Date();
    return (d.getFullYear() < now.getFullYear())
      || (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())
      || (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() < now.getDate());
  };

  const isAboutToExpire = (deadline?: string, completedAt?: string) => {
    if (!deadline || completedAt || isOverdue(deadline, completedAt)) return false;
    const d = new Date(deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return Date.now() >= d.getTime() - 24 * 60 * 60 * 1000;
    const now = new Date();
    return now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
  };

  const projectPlans = useMemo(() => {
    return projects.map(project => {
      const docs = projectDocs.filter(d => d.projectId === project.id);
      const projectVersions = versions.filter(v => v.projectId === project.id);
      const segments = buildProjectStageSegments(project, docs, templates, projectVersions, allStages);
      const projectTasks = tasks.filter(task => task.projectId === project.id);
      const workflowTasks = projectTasks.filter(task => task.workflowId);
      const completed = segments.filter(s => Boolean(s.completedAt)).length;
      const overdue = segments.filter(s => isOverdue(s.deadline, s.completedAt)).length;
      const aboutToExpire = segments.filter(s => isAboutToExpire(s.deadline, s.completedAt)).length;
      const activeTasks = projectTasks.filter(task => task.status !== 'completed').length;
      const workflowCompleted = workflowTasks.filter(task => task.status === 'completed').length;
      return {
        project,
        segments,
        docs,
        projectTasks,
        workflowTasks,
        completed,
        overdue,
        aboutToExpire,
        activeTasks,
        workflowProgress: workflowTasks.length ? Math.round((workflowCompleted / workflowTasks.length) * 100) : 0,
      };
    });
  }, [projects, projectDocs, templates, versions, allStages, tasks]);

  useEffect(() => {
    if (!projectPlans.length) {
      setSelectedProjectId('');
      return;
    }
    const globalProjectExists = currentProject && projectPlans.some(plan => plan.project.id === currentProject.id);
    if (globalProjectExists && selectedProjectId !== currentProject.id) {
      setSelectedProjectId(currentProject.id);
      return;
    }
    if (!selectedProjectId || !projectPlans.some(plan => plan.project.id === selectedProjectId)) {
      setSelectedProjectId(projectPlans[0].project.id);
    }
  }, [currentProject, projectPlans, selectedProjectId]);

  const selectedPlan = projectPlans.find(plan => plan.project.id === selectedProjectId) || projectPlans[0];

  const totalStages = projectPlans.reduce((acc, p) => acc + p.segments.length, 0);
  const completedStages = projectPlans.reduce((acc, p) => acc + p.completed, 0);
  const overdueStages = projectPlans.reduce((acc, p) => acc + p.overdue, 0);
  const aboutToExpireStages = projectPlans.reduce((acc, p) => acc + p.aboutToExpire, 0);
  const totalWorkflowTasks = projectPlans.reduce((acc, p) => acc + p.workflowTasks.length, 0);
  const totalWorkflowDone = projectPlans.reduce((acc, p) => acc + p.workflowTasks.filter(task => task.status === 'completed').length, 0);

  const selectedWorkflowGroups = useMemo(() => {
    if (!selectedPlan) return [];
    const groups = new Map<string, TaskItem[]>();
    selectedPlan.workflowTasks
      .filter(task => !currentStageName || task.stageName === currentStageName)
      .forEach(task => {
      const id = task.workflowId || 'workflow-unknown';
      groups.set(id, [...(groups.get(id) || []), task]);
    });
    return [...groups.entries()].map(([workflowId, groupTasks]) => {
      const sortedTasks = [...groupTasks].sort((a, b) =>
        (a.workflowOrder || 999) - (b.workflowOrder || 999)
        || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const completed = sortedTasks.filter(task => task.status === 'completed').length;
      const currentTask = sortedTasks.find(task => task.status !== 'completed') || sortedTasks[sortedTasks.length - 1];
      return {
        workflowId,
        name: sortedTasks[0]?.workflowName || '未命名工作流',
        tasks: sortedTasks,
        completed,
        progress: sortedTasks.length ? Math.round((completed / sortedTasks.length) * 100) : 0,
        currentTask,
      };
    }).sort((a, b) => new Date(b.tasks[0]?.createdAt || 0).getTime() - new Date(a.tasks[0]?.createdAt || 0).getTime());
  }, [currentStageName, selectedPlan]);

  const learnPlanDocument = async (doc: ProjectDocument, segment: TimelineStageSegment) => {
    if (!selectedPlan?.project) return;
    const version = doc.versionId ? versions.find(item => item.id === doc.versionId) : undefined;
    await learnStageFinal({
      projectId: selectedPlan.project.id,
      projectName: selectedPlan.project.name,
      stageName: segment.stage,
      docId: doc.id,
      docName: doc.name,
      sourceFilePath: doc.sourceFilePath || version?.filePath,
      content: version?.content,
    });
  };

  const handleStageComplete = async (segment: TimelineStageSegment) => {
    const completedAt = new Date().toISOString();
    // Only mark the newest source document to preserve old-version completion history.
    const lastDocId = segment.sourceDocIds[segment.sourceDocIds.length - 1];
    const doc = lastDocId ? projectDocs.find(item => item.id === lastDocId) : undefined;
    if (doc) {
      await updateProjectDoc(doc.id, { completedAt });
      await learnPlanDocument({ ...doc, completedAt }, segment);
    }
  };

  const handleStageReopen = async (segment: TimelineStageSegment) => {
    // Only reopen the newest source document to match completion behavior above.
    const lastDocId = segment.sourceDocIds[segment.sourceDocIds.length - 1];
    if (lastDocId) {
      await updateProjectDoc(lastDocId, { completedAt: undefined });
      await deleteStageMemoriesForDoc(lastDocId);
    }
  };

  const handleStageDeadline = async (segment: TimelineStageSegment, deadline?: string) => {
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { deadline })));
  };

  const isTaskBlocked = (task: TaskItem) => {
    if (!task.dependsOnTaskId || !selectedPlan) return false;
    const dependency = selectedPlan.projectTasks.find(item => item.id === task.dependsOnTaskId);
    return Boolean(dependency && dependency.status !== 'completed');
  };

  const handleTaskStatus = async (task: TaskItem, status: TaskItem['status']) => {
    await updateTask(task.id, {
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
    });
  };

  const renderMetric = (label: string, value: number | string, color: string) => (
    <Card size="small" style={{ borderRadius: 8 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 650, color }}>{value}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      </div>
    </Card>
  );

  const renderSegment = (segment: TimelineStageSegment) => {
    const color = stageMeta[segment.stage]?.color || '#8c8c8c';
    const isCompleted = Boolean(segment.completedAt);
    const segmentOverdue = isOverdue(segment.deadline, segment.completedAt);
    const segmentAboutToExpire = isAboutToExpire(segment.deadline, segment.completedAt);
    const statusColor = segmentOverdue ? '#ff4d4f' : segmentAboutToExpire ? '#faad14' : color;
    const isCurrentStage = currentStageName === segment.stage;
    const docPreview = segment.sourceDocNames.slice(0, 3);
    const hiddenDocCount = Math.max(segment.sourceDocNames.length - docPreview.length, 0);

    return (
      <div
        key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
        style={{
          border: `1px solid ${isCurrentStage ? '#1677ff' : segmentOverdue ? '#ffccc7' : segmentAboutToExpire ? '#ffe58f' : '#e5e7eb'}`,
          borderLeft: `4px solid ${statusColor}`,
          borderRadius: 8,
          background: isCurrentStage ? '#f0f7ff' : isCompleted ? '#fbfff7' : '#fff',
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <Space wrap>
              <Text strong style={{ fontSize: 15 }}>{segment.label}</Text>
              {isCompleted ? (
                <Tag icon={<CheckCircleOutlined />} color="success">已完成</Tag>
              ) : segmentOverdue ? (
                <Tag icon={<WarningOutlined />} color="error">已逾期</Tag>
              ) : segmentAboutToExpire ? (
                <Tag icon={<WarningOutlined />} color="warning">即将逾期</Tag>
              ) : (
                <Tag icon={<ClockCircleOutlined />} color="processing">进行中</Tag>
              )}
              <Tag>{segment.sourceDocIds.length} 个文档</Tag>
            </Space>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
              <Text type="secondary">开始 {formatDateTime(segment.startAt)}</Text>
              <Text type="secondary">完成 {formatDateTime(segment.completedAt)}</Text>
              <Text type={segmentOverdue ? 'danger' : 'secondary'}>截止 {formatDateTime(segment.deadline)}</Text>
            </div>
          </div>
          <Space size={6} wrap>
            <Button size="small" type={isCurrentStage ? 'primary' : 'default'} onClick={() => setCurrentStageName(segment.stage)}>
              {isCurrentStage ? '当前阶段' : '设为当前'}
            </Button>
            {isCompleted ? (
              <Popconfirm title="确定取消完成？" onConfirm={() => handleStageReopen(segment)} okText="确定" cancelText="取消">
                <Button size="small" icon={<ReloadOutlined />}>取消完成</Button>
              </Popconfirm>
            ) : (
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleStageComplete(segment)}>
                完成阶段
              </Button>
            )}
          </Space>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <CalendarOutlined style={{ color: '#8c8c8c' }} />
          <DatePicker
            allowClear
            size="small"
            style={{ flex: 1, maxWidth: 360 }}
            value={segment.deadline ? dayjs(segment.deadline) : null}
            placeholder="设置阶段截止时间"
            onChange={(value) => handleStageDeadline(segment, value ? value.toDate().toISOString() : undefined)}
          />
        </div>

        {docPreview.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {docPreview.map(name => <Tag key={name} style={{ margin: 0 }}>{name}</Tag>)}
            {hiddenDocCount > 0 && <Tag style={{ margin: 0 }}>另有 {hiddenDocCount} 个文档</Tag>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
          <Title level={4} style={{ margin: 0 }}>计划管理</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>
          按项目推进阶段计划，并集中查看报告页生成的 AI/人工工作流。
        </Text>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        {renderMetric('总阶段数', totalStages, '#1677ff')}
        {renderMetric('已完成', completedStages, '#52c41a')}
        {renderMetric('即将逾期', aboutToExpireStages, '#faad14')}
        {renderMetric('已逾期', overdueStages, '#ff4d4f')}
        {renderMetric('工作流进度', totalWorkflowTasks ? `${totalWorkflowDone}/${totalWorkflowTasks}` : '0/0', '#722ed1')}
      </div>

      {projectPlans.length > 0 && selectedPlan ? (
        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <Card
            size="small"
            title="项目列表"
            style={{ borderRadius: 10, maxHeight: 'max(260px, calc(100vh - 280px))', overflow: 'hidden' }}
            bodyStyle={{ padding: 8, maxHeight: 'max(210px, calc(100vh - 335px))', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
              {projectPlans.map(plan => {
                const selected = plan.project.id === selectedPlan.project.id;
                const progress = plan.segments.length ? Math.round((plan.completed / plan.segments.length) * 100) : 0;
                return (
                  <button
                    key={plan.project.id}
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(plan.project.id);
                      setCurrentProject(plan.project);
                    }}
                    style={{
                      textAlign: 'left',
                      border: selected ? '1px solid #1677ff' : '1px solid #e5e7eb',
                      background: selected ? '#f0f7ff' : '#fff',
                      borderRadius: 8,
                      padding: 12,
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <Space size={8} style={{ minWidth: 0 }}>
                        <FolderOutlined style={{ color: selected ? '#1677ff' : '#8c8c8c' }} />
                        <Text strong ellipsis style={{ maxWidth: 190 }}>{plan.project.name}</Text>
                      </Space>
                      <Tag color={progress === 100 && plan.segments.length > 0 ? 'green' : 'blue'} style={{ margin: 0 }}>
                        {plan.completed}/{plan.segments.length}
                      </Tag>
                    </div>
                    <Progress percent={progress} size="small" showInfo={false} style={{ marginTop: 10, marginBottom: 6 }} />
                    <Space size={6} wrap>
                      {plan.overdue > 0 && <Tag color="red" style={{ margin: 0 }}>逾期 {plan.overdue}</Tag>}
                      {plan.aboutToExpire > 0 && <Tag color="orange" style={{ margin: 0 }}>临期 {plan.aboutToExpire}</Tag>}
                      {plan.activeTasks > 0 && <Tag style={{ margin: 0 }}>待办 {plan.activeTasks}</Tag>}
                      {plan.workflowTasks.length > 0 && <Tag color="purple" style={{ margin: 0 }}>工作流 {plan.workflowTasks.length}</Tag>}
                    </Space>
                  </button>
                );
              })}
            </div>
          </Card>

          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" style={{ borderRadius: 10 }}>
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <Space wrap>
                    <Title level={4} style={{ margin: 0 }}>{selectedPlan.project.name}</Title>
                    <Tag color="blue">{selectedPlan.docs.length} 个文档</Tag>
                    <Tag color="purple">{selectedWorkflowGroups.length} 条工作流</Tag>
                    {currentStageName && <Tag color="blue">当前阶段：{currentStageName}</Tag>}
                  </Space>
                  <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                    当前项目阶段边界、截止时间和执行工作流集中在这里处理。
                  </Paragraph>
                </Col>
                <Col flex="220px">
                  <Progress
                    percent={selectedPlan.segments.length ? Math.round((selectedPlan.completed / selectedPlan.segments.length) * 100) : 0}
                    status={selectedPlan.overdue > 0 ? 'exception' : 'normal'}
                  />
                </Col>
              </Row>
            </Card>

            <Card size="small" title={currentStageName ? `工作流进度 · ${currentStageName}` : '工作流进度'} style={{ borderRadius: 10 }}>
              {selectedWorkflowGroups.length === 0 ? (
                <Empty description="暂无工作流任务，可在报告页确认 AI/人工计划后生成" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {selectedWorkflowGroups.map(group => (
                    <div key={group.workflowId} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <Space wrap>
                            <Text strong>{group.name}</Text>
                            <Tag color="purple">{group.completed}/{group.tasks.length}</Tag>
                          </Space>
                          <div style={{ marginTop: 4 }}>
                            <Text type="secondary">当前步骤：{group.currentTask?.title || '已完成'}</Text>
                          </div>
                        </div>
                        <Text type="secondary">{group.progress}%</Text>
                      </div>
                      <Progress percent={group.progress} size="small" style={{ marginBottom: 10 }} />
                      <List
                        size="small"
                        dataSource={group.tasks}
                        renderItem={(task) => {
                          const blocked = isTaskBlocked(task);
                          return (
                            <List.Item
                              actions={[
                                task.status === 'pending' && !blocked && (
                                  <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleTaskStatus(task, 'in_progress')}>开始</Button>
                                ),
                                task.status !== 'completed' && !blocked && (
                                  <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleTaskStatus(task, 'completed')}>完成</Button>
                                ),
                                task.status === 'completed' && (
                                  <Button size="small" icon={<ReloadOutlined />} onClick={() => handleTaskStatus(task, 'pending')}>重开</Button>
                                ),
                              ].filter(Boolean)}
                            >
                              <Space align="start">
                                {blocked
                                  ? <ClockCircleOutlined style={{ color: '#faad14', marginTop: 4 }} />
                                  : task.type === 'ai'
                                    ? <RobotOutlined style={{ color: '#1677ff', marginTop: 4 }} />
                                    : <UserOutlined style={{ color: '#52c41a', marginTop: 4 }} />}
                                <div>
                                  <Space wrap>
                                    <Text strong>{task.workflowOrder ? `${task.workflowOrder}. ` : ''}{task.title}</Text>
                                    <Tag color={task.type === 'ai' ? 'blue' : 'green'}>{task.type === 'ai' ? 'AI执行' : '人工处理'}</Tag>
                                    <Tag color={statusColors[task.status]}>{statusLabels[task.status]}</Tag>
                                    {blocked && <Tag color="orange">等待前置任务</Tag>}
                                  </Space>
                                  {task.description && (
                                    <div style={{ marginTop: 4 }}>
                                      <Text type="secondary">{task.description}</Text>
                                    </div>
                                  )}
                                </div>
                              </Space>
                            </List.Item>
                          );
                        }}
                      />
                    </div>
                  ))}
                </Space>
              )}
            </Card>

            <Card size="small" title="阶段计划" style={{ borderRadius: 10 }}>
              {selectedPlan.segments.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedPlan.segments.map(renderSegment)}
                </div>
              ) : (
                <Empty description="该项目暂无阶段文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Space>
        </div>
      ) : (
        <Empty description="暂无项目阶段数据" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            请先在总览或项目页面创建项目并关联文档。
          </Text>
        </Empty>
      )}
    </div>
  );
};

export default PlanManager;
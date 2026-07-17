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
  Tooltip,
  message,
  Form,
  Input,
  Modal,
  Select,
  Divider,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CalendarOutlined,
  LeftOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
  PlayCircleOutlined,
  SwapOutlined,
  PlusOutlined,
  DeleteOutlined,
  TeamOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useStageLifecycleStore } from '../../stores/stageLifecycleStore';
import { ProjectDocument, TaskItem } from '../../../shared/types';
import { useNavigationStore } from '../../stores/navigationStore';
import {
  buildProjectStageSegments,
  getAllStages,
  getStageMeta,
  TimelineStageSegment,
} from '../../utils/timelineStages';
import { buildTaskPrompt, isRevisionTask, resolveTaskTarget } from '../../utils/workflowTaskRouting';
import { getActiveStageCompletionEvent } from '../../utils/stageCompletion';

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

const taskSourceLabels: Record<NonNullable<TaskItem['source']>, string> = {
  manual: '手动',
  report: '报告',
  review: '审查',
  stage: '阶段',
};

const taskPriorityLabels: Record<TaskItem['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const taskPriorityColors: Record<TaskItem['priority'], string> = {
  high: 'red',
  medium: 'orange',
  low: 'green',
};

const PlanManager: React.FC<{ onBack?: () => void; hideHeader?: boolean }> = ({ onBack, hideHeader = false }) => {
  const { projects, currentProject, currentStageName, versions, setCurrentStageName, updateProject } = useProjectStore();
  const { projectDocs, updateProjectDoc } = useProjectDocStore();
  const { templates } = useTemplateStore();
  const { customStages, autoStageMemoryEnabled } = useSettingsStore();
  const {
    tasks,
    loadTasks,
    addTask,
    deleteTask,
    isTaskBlocked: isTaskBlockedInStore,
    setTaskExecutor,
    transitionTaskStatus,
  } = useTaskStore();
  const navigateWorkbench = useNavigationStore(state => state.navigate);
  const { completeStage, reopenStage, retryStageLearning, busyStageKeys } = useStageLifecycleStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [expandedStageDocs, setExpandedStageDocs] = useState<Set<string>>(() => new Set());
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | TaskItem['status']>('all');
  const [taskSourceFilter, setTaskSourceFilter] = useState<'all' | NonNullable<TaskItem['source']>>('all');
  const [taskStageFilter, setTaskStageFilter] = useState<string>('all');
  const [taskKeyword, setTaskKeyword] = useState('');
  const [taskForm] = Form.useForm();

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
      // 报告和审查都可以生成任务。兼容历史数据：旧审查任务没有 workflowId，
      // 仍按审查记录归到同一个工作流，避免生成后在计划详情里“消失”。
      const workflowTasks = projectTasks.filter(task =>
        Boolean(task.workflowId) || task.source === 'report' || task.source === 'review'
      );
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
    selectedPlan.workflowTasks.forEach(task => {
      const id = task.workflowId
        || (task.source === 'review' ? `review-${task.relatedReviewId || task.stageName || 'general'}` : '')
        || (task.source === 'report' ? `report-${task.relatedDocId || task.stageName || 'general'}` : '')
        || 'workflow-unknown';
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
        name: sortedTasks[0]?.workflowName
          || (sortedTasks[0]?.source === 'review' ? '审查修改任务' : sortedTasks[0]?.source === 'report' ? '报告执行任务' : '未命名工作流'),
        tasks: sortedTasks,
        completed,
        progress: sortedTasks.length ? Math.round((completed / sortedTasks.length) * 100) : 0,
        currentTask,
      };
    }).sort((a, b) => new Date(b.tasks[0]?.createdAt || 0).getTime() - new Date(a.tasks[0]?.createdAt || 0).getTime());
  }, [selectedPlan]);

  const dispatchTasks = useMemo(() => {
    if (!selectedPlan) return [];
    const keyword = taskKeyword.trim().toLocaleLowerCase();
    return selectedPlan.projectTasks.filter(task => {
      if (taskStatusFilter !== 'all' && task.status !== taskStatusFilter) return false;
      if (taskSourceFilter !== 'all' && (task.source || 'manual') !== taskSourceFilter) return false;
      if (taskStageFilter !== 'all' && task.stageName !== taskStageFilter) return false;
      if (keyword && ![task.title, task.description, task.sectionTitle, task.workflowName]
        .filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(keyword))) return false;
      return true;
    }).sort((a, b) => {
      const statusOrder = { in_progress: 0, pending: 1, completed: 2 };
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return statusOrder[a.status] - statusOrder[b.status]
        || priorityOrder[a.priority] - priorityOrder[b.priority]
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [selectedPlan, taskKeyword, taskSourceFilter, taskStageFilter, taskStatusFilter]);

  const dispatchStats = useMemo(() => {
    const all = selectedPlan?.projectTasks || [];
    return {
      pending: all.filter(task => task.status === 'pending').length,
      running: all.filter(task => task.status === 'in_progress').length,
      blocked: all.filter(task => task.dependsOnTaskId && all.some(item => item.id === task.dependsOnTaskId && item.status !== 'completed')).length,
      completed: all.filter(task => task.status === 'completed').length,
    };
  }, [selectedPlan]);

  const getStageDocs = (segment: TimelineStageSegment) => segment.sourceDocIds
    .map(id => projectDocs.find(item => item.id === id))
    .filter((doc): doc is ProjectDocument => Boolean(doc))
    .sort((a, b) => {
      const aTime = new Date(a.sourceFileModifiedAt || a.analyzedAt || a.createdAt).getTime();
      const bTime = new Date(b.sourceFileModifiedAt || b.analyzedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

  const getStageSelectionKey = (segment: TimelineStageSegment) => segment.stage;

  const getStageFinalDoc = (segment: TimelineStageSegment) => {
    const docs = getStageDocs(segment);
    const project = projects.find(item => item.id === segment.projectId);
    const selectedId = project?.stageSummarySourceDocIds?.[getStageSelectionKey(segment)];
    return docs.find(doc => doc.id === selectedId) || docs[0];
  };

  const handleStageFinalDocSelect = async (segment: TimelineStageSegment, docId: string) => {
    const project = projects.find(item => item.id === segment.projectId);
    if (!project || !segment.sourceDocIds.includes(docId)) return;
    await updateProject(project.id, {
      stageSummarySourceDocIds: {
        ...(project.stageSummarySourceDocIds || {}),
        [getStageSelectionKey(segment)]: docId,
      },
    });
  };

  const handleStageComplete = async (segment: TimelineStageSegment) => {
    if (!selectedPlan?.project) return;
    const docs = getStageDocs(segment);
    const defaultDoc = getStageFinalDoc(segment);
    let selectedDocId = defaultDoc?.id;
    Modal.confirm({
      title: `确认完成“${segment.label}”`,
      width: 560,
      content: <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Text type="secondary">阶段内文档将统一标记完成。请选择一份最终文档用于阶段记忆提炼，默认是最后修改的文档。</Text>
        <Select defaultValue={selectedDocId} style={{ width: '100%' }} placeholder="选择提炼文档" onChange={value => { selectedDocId = value; }} options={docs.map(doc => ({ value: doc.id, label: doc.name }))} />
      </Space>,
      okText: '完成阶段',
      cancelText: '取消',
      onOk: async () => {
        const result = await completeStage({
          project: selectedPlan.project,
          scope: { projectId: segment.projectId, stageName: segment.stage, sourceDocIds: segment.sourceDocIds },
          extractionDocId: selectedDocId,
          autoLearn: autoStageMemoryEnabled,
        });
        if (result.status === 'learning_failed') message.warning('阶段已完成，但记忆学习失败，可在阶段卡片中重试');
        else message.success(result.status === 'learned' ? '阶段已完成并生成阶段记忆' : '阶段已完成');
      },
    });
  };

  const handleStageReopen = async (segment: TimelineStageSegment) => {
    if (!selectedPlan?.project) return;
    await reopenStage(selectedPlan.project, { projectId: segment.projectId, stageName: segment.stage, sourceDocIds: segment.sourceDocIds });
    message.success('已取消阶段完成；本次完成事件生成的记忆已撤回，手工记忆不受影响');
  };

  const handleStageDeadline = async (segment: TimelineStageSegment, deadline?: string) => {
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { deadline })));
  };

  const isTaskBlocked = (task: TaskItem) => isTaskBlockedInStore(task.id);

  const handleTaskStatus = async (task: TaskItem, status: TaskItem['status']) => {
    const changed = await transitionTaskStatus(task.id, status);
    if (!changed) message.warning('前置任务尚未完成，当前任务不能开始执行');
  };

  const handleExecuteTask = async (task: TaskItem) => {
    if (isTaskBlocked(task)) return;
    if (task.status === 'pending') await handleTaskStatus(task, 'in_progress');

    const relatedDoc = task.relatedDocId ? projectDocs.find(doc => doc.id === task.relatedDocId) : undefined;
    const relatedVersion = relatedDoc?.versionId ? versions.find(version => version.id === relatedDoc.versionId) : undefined;
    const filePath = relatedDoc?.sourceFilePath || relatedVersion?.filePath;

    // 人工任务优先交给用户熟悉的本地编辑器；计划状态只切为“进行中”，
    // 是否完成仍由用户在本页确认，避免打开文件即误判完成。
    if (task.type === 'manual' && filePath) {
      const result = await window.electronAPI.openFileWithApp(filePath);
      if (result?.success) {
        message.success('已在默认应用中打开关联文件');
        return;
      }
      message.warning(result?.error || '无法打开关联文件，已转到对应工作台');
    }

    const target = resolveTaskTarget(task);
    navigateWorkbench({
      target,
      projectId: task.projectId,
      docId: task.relatedDocId,
      taskId: task.id,
      reviewId: task.relatedReviewId,
      issueId: task.relatedIssueId,
      stageName: task.stageName,
      sectionTitle: task.sectionTitle,
      sourceLineNumber: task.sourceLineNumber,
      source: task.source === 'review' ? 'review' : 'task',
      intent: target === 'team' ? (isRevisionTask(task) ? 'revision' : 'writing') : undefined,
      prompt: buildTaskPrompt(task),
    });
  };

  const toggleTaskExecutor = async (task: TaskItem) => {
    const nextExecutor = task.executor === 'ai' || (!task.executor && task.type === 'ai') ? 'human' : 'ai';
    await setTaskExecutor(task.id, nextExecutor);
    message.success(nextExecutor === 'ai' ? '已切换为 AI 执行：点击“执行”后进入对应 AI 工作台' : '已切换为人工执行：点击“执行”后打开关联文件');
  };

  const sendTaskToCollaboration = (task: TaskItem) => {
    navigateWorkbench({
      target: 'team',
      projectId: task.projectId,
      taskId: task.id,
      docId: task.relatedDocId,
      reviewId: task.relatedReviewId,
      issueId: task.relatedIssueId,
      stageName: task.stageName,
      sectionTitle: task.sectionTitle,
      sourceLineNumber: task.sourceLineNumber,
      source: task.source === 'review' ? 'review' : 'task',
      intent: 'dispatch',
      prompt: buildTaskPrompt(task),
    });
  };

  const handleCreateTask = async () => {
    if (!selectedPlan?.project) return;
    const values = await taskForm.validateFields();
    const now = new Date().toISOString();
    const task: TaskItem = {
      id: `plan-${Date.now()}`,
      projectId: selectedPlan.project.id,
      title: values.title,
      description: values.description || '',
      type: values.type || 'manual',
      status: 'pending',
      priority: values.priority || 'medium',
      source: values.source || 'manual',
      stageName: values.stageName,
      relatedDocId: values.relatedDocId,
      dependsOnTaskId: values.dependsOnTaskId,
      assigneeName: values.assigneeName,
      dueAt: values.dueAt?.toISOString(),
      createdAt: now,
    };
    await addTask(task);
    setTaskModalOpen(false);
    taskForm.resetFields();
    message.success('任务已加入统一调度中心');
  };

  const getTaskDocName = (task: TaskItem) => {
    const doc = task.relatedDocId ? projectDocs.find(item => item.id === task.relatedDocId) : undefined;
    if (!doc) return '';
    const version = doc.versionId ? versions.find(item => item.id === doc.versionId) : undefined;
    return version?.fileName || doc.name;
  };

  const renderDispatchTask = (task: TaskItem) => {
    const blocked = isTaskBlocked(task);
    const docName = getTaskDocName(task);
    return (
      <div key={task.id} className={`plan-dispatch-task${blocked ? ' is-blocked' : ''}${task.status === 'completed' ? ' is-completed' : ''}`}>
        <div className="plan-dispatch-task-main">
          <Space wrap size={5}>
            <Tag color={task.source === 'review' ? 'purple' : task.source === 'report' ? 'cyan' : 'default'}>{taskSourceLabels[task.source || 'manual']}</Tag>
            <Tag color={taskPriorityColors[task.priority]}>{taskPriorityLabels[task.priority]}</Tag>
            <Tag color={statusColors[task.status]}>{statusLabels[task.status]}</Tag>
            {task.workflowName && <Tag icon={<ApartmentOutlined />}>{task.workflowName}</Tag>}
            {blocked && <Tag color="orange">等待前置任务</Tag>}
          </Space>
          <Text strong delete={task.status === 'completed'}>{task.title}</Text>
          {(docName || task.sectionTitle || task.stageName) && <Text type="secondary" className="plan-dispatch-context">{[task.stageName, docName, task.sectionTitle ? `章节：${task.sectionTitle}` : ''].filter(Boolean).join(' · ')}</Text>}
          {task.description && <Paragraph type="secondary" ellipsis={{ rows: 2, expandable: true }} style={{ margin: 0 }}>{task.description}</Paragraph>}
          {task.result && <div className="plan-dispatch-result"><Text type="secondary">执行结果</Text><Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ margin: 0 }}>{task.result}</Paragraph></div>}
        </div>
        <Space wrap size={6} className="plan-dispatch-actions">
          <Tooltip title={task.type === 'ai' ? '切换为人工执行' : '切换为 AI 执行'}><Button size="small" icon={<SwapOutlined />} onClick={() => void toggleTaskExecutor(task)}>{task.type === 'ai' ? 'AI' : '人工'}</Button></Tooltip>
          {task.status !== 'completed' && <Button size="small" type="primary" icon={<PlayCircleOutlined />} disabled={blocked} onClick={() => void handleExecuteTask(task)}>执行</Button>}
          {task.status !== 'completed' && <Button size="small" icon={<TeamOutlined />} disabled={blocked} onClick={() => sendTaskToCollaboration(task)}>协同</Button>}
          <Select size="small" value={task.status} style={{ width: 96 }} onChange={value => void handleTaskStatus(task, value)} options={[{ value: 'pending', label: '待处理' }, { value: 'in_progress', label: '进行中' }, { value: 'completed', label: '已完成' }]} />
          <Popconfirm title="确定删除该任务？" onConfirm={() => void deleteTask(task.id)}><Button type="text" danger size="small" icon={<DeleteOutlined />} /></Popconfirm>
        </Space>
      </div>
    );
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
    const stageDocs = getStageDocs(segment);
    const extractionDoc = getStageFinalDoc(segment);
    const completionEvent = selectedPlan?.project
      ? getActiveStageCompletionEvent(selectedPlan.project, segment.stage)
      : undefined;
    const stageBusy = busyStageKeys.includes(`${segment.projectId}:${segment.stage}`);
    const stageDocsKey = `${segment.projectId}:${segment.stage}`;
    const docsExpanded = expandedStageDocs.has(stageDocsKey);
    // The extraction document is always first, followed by the other documents
    // in last-modified order. This makes the upcoming AI learning source clear.
    const orderedDocs = extractionDoc
      ? [extractionDoc, ...stageDocs.filter(doc => doc.id !== extractionDoc.id)]
      : stageDocs;
    const docPreview = docsExpanded ? orderedDocs : orderedDocs.slice(0, 3);
    const hiddenDocCount = Math.max(orderedDocs.length - docPreview.length, 0);

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
              {completionEvent?.status === 'learning' && <Tag color="processing">记忆学习中</Tag>}
              {completionEvent?.status === 'learned' && <Tag color="purple">记忆已生成</Tag>}
              {completionEvent?.status === 'learning_failed' && <Tag color="error">记忆学习失败</Tag>}
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
                <Button size="small" icon={<ReloadOutlined />} loading={stageBusy}>取消完成</Button>
              </Popconfirm>
            ) : (
              <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={stageBusy} onClick={() => handleStageComplete(segment)}>
                完成阶段
              </Button>
            )}
            {completionEvent && ['learning_failed', 'learned'].includes(completionEvent.status) && selectedPlan?.project && (
              <Button size="small" danger={completionEvent?.status === 'learning_failed'} loading={stageBusy} onClick={async () => {
                const result = await retryStageLearning(selectedPlan.project, completionEvent.id);
                if (result?.status === 'learned') message.success('阶段记忆重学成功');
                else message.warning('阶段记忆仍未生成，请检查文档内容和 AI 配置');
              }}>{completionEvent?.status === 'learned' ? '重新学习' : '重试学习'}</Button>
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
            {docPreview.map(doc => {
              const isExtractionDoc = doc.id === extractionDoc?.id;
              const versionName = doc.versionId ? versions.find(item => item.id === doc.versionId)?.fileName : undefined;
              const displayName = versionName || doc.name;
              return (
                <Tooltip key={doc.id} title={isExtractionDoc ? '当前用于阶段提炼；点击可切换提炼文档' : '点击设为阶段提炼文档'}>
                  <Tag
                    color={isExtractionDoc ? 'blue' : undefined}
                    style={{ margin: 0, cursor: 'pointer', maxWidth: 430, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={() => { void handleStageFinalDocSelect(segment, doc.id); }}
                  >
                    {isExtractionDoc ? `提炼文档 · ${displayName}` : displayName}
                  </Tag>
                </Tooltip>
              );
            })}
            {hiddenDocCount > 0 && (
              <Tag
                style={{ margin: 0, cursor: 'pointer' }}
                onClick={() => setExpandedStageDocs(previous => new Set(previous).add(stageDocsKey))}
              >
                另有 {hiddenDocCount} 个文档
              </Tag>
            )}
            {docsExpanded && orderedDocs.length > 3 && (
              <Tag
                style={{ margin: 0, cursor: 'pointer' }}
                onClick={() => setExpandedStageDocs(previous => {
                  const next = new Set(previous);
                  next.delete(stageDocsKey);
                  return next;
                })}
              >
                收起
              </Tag>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="plan-manager-page">
      {!hideHeader && <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
          <Title level={4} style={{ margin: 0 }}>计划管理</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>
          按项目推进阶段计划，并集中查看报告页生成的 AI/人工工作流。
        </Text>
      </div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        {renderMetric('总阶段数', totalStages, '#1677ff')}
        {renderMetric('已完成', completedStages, '#52c41a')}
        {renderMetric('即将逾期', aboutToExpireStages, '#faad14')}
        {renderMetric('已逾期', overdueStages, '#ff4d4f')}
        {renderMetric('工作流进度', totalWorkflowTasks ? `${totalWorkflowDone}/${totalWorkflowTasks}` : '0/0', '#722ed1')}
      </div>

      {projectPlans.length > 0 && selectedPlan ? (
        <div style={{ width: '100%' }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
              size="small"
              className="plan-dispatch-center"
              title={<Space><ApartmentOutlined style={{ color: '#722ed1' }} /><span>统一协同调度</span><Tag color="purple">{selectedPlan.projectTasks.length} 个任务</Tag></Space>}
              extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setTaskModalOpen(true)}>新建任务</Button>}
              style={{ borderRadius: 10 }}
            >
              <Text type="secondary">报告与审查负责产出任务；这里统一决定由 AI、本人或好友执行，并持续回收状态和结果。</Text>
              <div className="plan-dispatch-metrics">
                <div><b>{dispatchStats.pending}</b><span>待规划</span></div>
                <div><b>{dispatchStats.running}</b><span>执行中</span></div>
                <div><b>{dispatchStats.blocked}</b><span>被阻塞</span></div>
                <div><b>{dispatchStats.completed}</b><span>已完成</span></div>
                <div><b>{selectedWorkflowGroups.length}</b><span>任务流</span></div>
              </div>
              <div className="plan-dispatch-toolbar">
                <Input.Search allowClear value={taskKeyword} onChange={event => setTaskKeyword(event.target.value)} placeholder="搜索任务、文档或问题章节" style={{ minWidth: 220, flex: 1 }} />
                <Select value={taskStatusFilter} onChange={setTaskStatusFilter} style={{ width: 112 }} options={[{ value: 'all', label: '全部状态' }, { value: 'pending', label: '待处理' }, { value: 'in_progress', label: '进行中' }, { value: 'completed', label: '已完成' }]} />
                <Select value={taskSourceFilter} onChange={setTaskSourceFilter} style={{ width: 112 }} options={[{ value: 'all', label: '全部来源' }, { value: 'report', label: '报告' }, { value: 'review', label: '审查' }, { value: 'stage', label: '阶段' }, { value: 'manual', label: '手动' }]} />
                <Select value={taskStageFilter} onChange={setTaskStageFilter} style={{ width: 136 }} options={[{ value: 'all', label: '全部阶段' }, ...allStages.map(stage => ({ value: stage.name, label: stage.name }))]} />
              </div>
              {dispatchTasks.length === 0 ? <Empty description="暂无匹配任务；可在报告或审查中确认任务，也可在此新建" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                <div className="plan-dispatch-lanes">
                  <section className="plan-dispatch-lane is-manual">
                    <header><div><UserOutlined /><b>人工任务</b><span>本人执行或转派好友</span></div><Tag>{dispatchTasks.filter(task => task.type === 'manual').length}</Tag></header>
                    <div>{dispatchTasks.filter(task => task.type === 'manual').map(renderDispatchTask)}</div>
                  </section>
                  <section className="plan-dispatch-lane is-ai">
                    <header><div><RobotOutlined /><b>AI 任务</b><span>按任务语义进入写作、修订或审查工具</span></div><Tag color="blue">{dispatchTasks.filter(task => task.type === 'ai').length}</Tag></header>
                    <div>{dispatchTasks.filter(task => task.type === 'ai').map(renderDispatchTask)}</div>
                  </section>
                </div>
              )}
              {selectedWorkflowGroups.length > 0 && <><Divider orientation="left">任务流概览</Divider><div className="plan-workflow-summary">{selectedWorkflowGroups.map(group => <div key={group.workflowId}><Space wrap><ApartmentOutlined /><Text strong>{group.name}</Text><Tag color="purple">{group.completed}/{group.tasks.length}</Tag></Space><Progress percent={group.progress} size="small" /><Text type="secondary">当前：{group.currentTask?.title || '已完成'}</Text></div>)}</div></>}
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
      <Modal title="新建调度任务" open={taskModalOpen} onOk={() => void handleCreateTask()} onCancel={() => setTaskModalOpen(false)} okText="加入调度" cancelText="取消" width={680}>
        <Form form={taskForm} layout="vertical" initialValues={{ type: 'manual', priority: 'medium', source: 'manual' }}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}><Input placeholder="例如：修订审查发现的格式问题" /></Form.Item>
          <Form.Item name="description" label="任务说明"><Input.TextArea rows={3} placeholder="说明执行要求、问题背景和验收标准" /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="type" label="执行方式"><Select options={[{ value: 'manual', label: '人工执行' }, { value: 'ai', label: 'AI 执行' }]} /></Form.Item></Col>
            <Col span={8}><Form.Item name="priority" label="优先级"><Select options={[{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} /></Form.Item></Col>
            <Col span={8}><Form.Item name="source" label="来源"><Select options={[{ value: 'manual', label: '手动' }, { value: 'report', label: '报告' }, { value: 'review', label: '审查' }, { value: 'stage', label: '阶段' }]} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="stageName" label="关联阶段"><Select allowClear options={allStages.map(stage => ({ value: stage.name, label: stage.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="relatedDocId" label="关联文档"><Select allowClear showSearch optionFilterProp="label" options={(selectedPlan?.docs || []).map(doc => ({ value: doc.id, label: doc.name }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="dependsOnTaskId" label="前置任务"><Select allowClear showSearch optionFilterProp="label" options={(selectedPlan?.projectTasks || []).filter(task => task.status !== 'completed').map(task => ({ value: task.id, label: task.title }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="assigneeName" label="负责人"><Input placeholder="未分配" /></Form.Item></Col>
            <Col span={8}><Form.Item name="dueAt" label="截止时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default PlanManager;

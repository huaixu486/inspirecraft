import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Card, Table, Tag, Progress, Typography, Space, Button, Dropdown, Modal, Form, Input, message, Tooltip } from 'antd';
import {
  FolderOutlined, CalendarOutlined, WarningOutlined, ExclamationCircleOutlined,
  PlusOutlined, FolderOpenOutlined, FileZipOutlined, SearchOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTemplateStore } from '../../stores/templateStore';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { markAutoDescriptionFileActivity, maybeGenerateAutoProjectDescription, shouldGenerateAutoProjectDescription, isManualProjectDescription } from '../../utils/autoProjectDescription';
import { buildProjectStageSegments, getAllStages, getStageMeta, detectTimelineStage, getGlobalStageProgress, checkDeadlineStatus } from '../../utils/timelineStages';
import { deriveProjectNextActions, ProjectNextAction } from '../../utils/projectNextActions';
import type { ProjectDocument, TaskItem } from '../../../shared/types';
import type { StageConfig } from '../../utils/timelineStages';
import { Project } from '../../../shared/types';

const { Text } = Typography;
const PROJECT_TABLE_SCROLL_X = 1180;
const PROJECT_TABLE_SCROLL_Y = 'max(280px, calc(100vh - 520px))';
const PROJECT_TABLE_ROW_HEIGHT = 58;
const PROJECT_TABLE_SINGLE_CLICK_DELAY_MS = 120;

interface Props {
  onEnterProject: (project: Project, initialTab?: string) => void;
  onPreviewProject?: (project: Project) => void;
}

const ProjectTable: React.FC<Props> = ({ onEnterProject, onPreviewProject }) => {
  const projects = useProjectStore(s => s.projects);
  const versions = useProjectStore(s => s.versions);
  const addProject = useProjectStore(s => s.addProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const setCurrentProject = useProjectStore(s => s.setCurrentProject);
  const setCurrentStageName = useProjectStore(s => s.setCurrentStageName);
  // 响应式订阅 currentProject.id，确保单击时行高亮立即跟随
  const currentProjectId = useProjectStore(s => s.currentProject?.id);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const addProjectDoc = useProjectDocStore(s => s.addProjectDoc);
  const updateProjectDoc = useProjectDocStore(s => s.updateProjectDoc);
  const templates = useTemplateStore(s => s.templates);
  const reviews = useTemplateStore(s => s.reviews);
  const tasks = useTaskStore(s => s.tasks);
  const stageMemories = useKnowledgeStore(s => s.stageMemories);
  const loadKnowledge = useKnowledgeStore(s => s.loadKnowledge);
  const navigateWorkbench = useNavigationStore(state => state.navigate);
  const workspacePath = useSettingsStore(s => s.workspacePath);
  const customStages = useSettingsStore(s => s.customStages);
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);

  const [searchKeyword, setSearchKeyword] = useState('');
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [tableBodyElement, setTableBodyElement] = useState<HTMLElement | null>(null);
  const [rowHighlight, setRowHighlight] = useState({
    top: 0,
    height: 0,
    visible: false,
    variant: 'selected' as 'preview' | 'selected',
  });
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const singleClickTimerRef = useRef<number>(0);
  const activeHighlightId = highlightedProjectId || currentProjectId || null;
  const activeHighlightVariant: 'preview' | 'selected' = highlightedProjectId ? 'preview' : 'selected';

  const showRowHighlight = (row: HTMLElement | null, variant: 'preview' | 'selected') => {
    const body = tableBodyElement || tableWrapRef.current?.querySelector<HTMLElement>('.ant-table-body') || null;
    if (!row || !body) return;
    const bodyRect = body.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setRowHighlight({
      top: rowRect.top - bodyRect.top + body.scrollTop,
      height: PROJECT_TABLE_ROW_HEIGHT,
      visible: true,
      variant,
    });
  };

  useEffect(() => {
    if (highlightedProjectId && highlightedProjectId === currentProjectId) {
      setHighlightedProjectId(null);
    }
  }, [currentProjectId, highlightedProjectId]);

  useEffect(() => {
    return () => {
      if (singleClickTimerRef.current) {
        window.clearTimeout(singleClickTimerRef.current);
        singleClickTimerRef.current = 0;
      }
    };
  }, []);

  const cancelPendingSingleClickOpen = () => {
    if (singleClickTimerRef.current) {
      window.clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = 0;
    }
  };

  const openProjectFromRow = (project: Project, initialTab?: string, row?: HTMLElement | null) => {
    cancelPendingSingleClickOpen();
    if (initialTab === 'files') {
      onEnterProject(project, 'files');
      return;
    }

    // 等待系统判定单击：若随后收到 dblclick，此回调会被取消，
    // 因此双击只进入文件页，不会先闪出项目侧边窗。
    singleClickTimerRef.current = window.setTimeout(() => {
      singleClickTimerRef.current = 0;
      flushSync(() => {
        showRowHighlight(row || null, 'preview');
        setHighlightedProjectId(project.id);
        onPreviewProject?.(project);
      });
    }, PROJECT_TABLE_SINGLE_CLICK_DELAY_MS);
  };

  // --- 索引：按 projectId 分组，避免每行 filter ---
  const docsByProjectId = useMemo(() => {
    const map = new Map<string, ProjectDocument[]>();
    for (const doc of projectDocs) {
      const arr = map.get(doc.projectId);
      if (arr) arr.push(doc); else map.set(doc.projectId, [doc]);
    }
    return map;
  }, [projectDocs]);

  const versionsByProjectId = useMemo(() => {
    const map = new Map<string, typeof versions>();
    for (const v of versions) {
      const arr = map.get(v.projectId);
      if (arr) arr.push(v); else map.set(v.projectId, [v]);
    }
    return map;
  }, [versions]);

  const tasksByProjectId = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      const arr = map.get(t.projectId);
      if (arr) arr.push(t); else map.set(t.projectId, [t]);
    }
    return map;
  }, [tasks]);

  // --- 预计算每个项目的摘要（阶段、进度、截止日期、下一步计划）一次算完 ---
  interface ProjectSummary {
    stage: string;
    stageColor: string;
    stageLabel: string;
    progress: number;
    deadline?: { date: string; status: 'overdue' | 'aboutToExpire' | 'normal'; hasCompleted: boolean };
    nextAction: ProjectNextAction | null;
  }

  const projectSummaryMap = useMemo(() => {
    const map = new Map<string, ProjectSummary>();
    for (const project of projects) {
      const pid = project.id;
      const docs = docsByProjectId.get(pid) || [];
      const pVersions = versionsByProjectId.get(pid) || [];
      const pTasks = tasksByProjectId.get(pid) || [];

      // 阶段
      const stage = detectTimelineStage(allStages, ...docs.map(d => d.name));
      const meta = stageMeta[stage];

      // 进度
      const progress = getGlobalStageProgress(project, docs, templates, pVersions, allStages);

      // 截止日期
      const dlDocs = docs.filter(d => d.deadline);
      let deadline: ProjectSummary['deadline'];
      if (dlDocs.length > 0) {
        const latest = dlDocs.reduce((max, d) => {
          const dl = new Date(d.deadline!);
          return dl > max ? dl : max;
        }, new Date(0));
        const hasCompleted = dlDocs.some(d => d.completedAt);
        const dlStatus = hasCompleted ? 'normal' as const : checkDeadlineStatus(latest.toISOString(), Date.now());
        deadline = { date: latest.toLocaleDateString('zh-CN'), status: dlStatus, hasCompleted };
      }

      // 下一步计划
      const nextAction = deriveProjectNextActions({
        project, tasks: pTasks, projectDocs: docs, versions: pVersions,
        templates, reviews, stageMemories, allStages, limit: 1,
      })[0] || null;

      map.set(pid, {
        stage, stageColor: meta?.color || '#8c8c8c', stageLabel: meta?.label || stage,
        progress, deadline, nextAction,
      });
    }
    return map;
  }, [projects, docsByProjectId, versionsByProjectId, tasksByProjectId, templates, reviews, stageMemories, allStages, stageMeta]);

  const getSummary = (project: Project): ProjectSummary =>
    projectSummaryMap.get(project.id) || { stage: '其他', stageColor: '#8c8c8c', stageLabel: '其他', progress: 0, nextAction: null };

  // 后台扫描：阶段文件同步 + 项目文件活动检测 + AI 生成
  const autoScanCancelledRef = useRef(false);
  const autoScanBusyRef = useRef(false);

  // 轻量扫描：检测项目文件活动（不读内容，只看修改时间）
  const scanProjectFileActivity = useCallback(async (project: Project) => {
    if (!project.folderPath) return;
    if (isManualProjectDescription(project)) return;
    if (project.autoDescriptionGeneratedAt) return;
    try {
      const result = await window.electronAPI.scanProjectFiles(project.folderPath);
      if (!result.success || !result.files?.length) return;

      const files = result.files;
      const latestModified = files.reduce((max, f) => f.modifiedAt > max ? f.modifiedAt : max, '');

      // 有新活动：重置三天计时
      if (latestModified && latestModified > (project.autoDescriptionLastFileActivityAt || '')) {
        const activityFileNames = files
          .filter(f => f.modifiedAt > (project.autoDescriptionLastFileActivityAt || ''))
          .slice(0, 10)
          .map(f => f.path.split(/[/\\]/).pop() || '');
        await markAutoDescriptionFileActivity(project, updateProject, {
          activityAt: latestModified,
          fileNames: activityFileNames,
        });
      }
    } catch (error) {
      console.warn('Project file activity scan failed:', error);
    }
  }, [updateProject]);

  // 阶段文件同步 + 活动检测（主扫描）
  const scanOne = useCallback(async (project: Project): Promise<boolean> => {
    if (!project.folderPath || autoScanCancelledRef.current) return false;
    try {
      const latestDocs = useProjectDocStore.getState().projectDocs;
      const result = await syncProjectStageFiles(project, {
        allStages,
        projectDocs: latestDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
      });
      // 额外扫描项目文件活动（覆盖非阶段文件的修改）
      await scanProjectFileActivity(project);
      return result.created > 0 || result.updated > 0;
    } catch (error) {
      console.warn('Auto stage scan failed:', error);
      return false;
    }
  }, [allStages, templates, addProjectDoc, updateProjectDoc, updateProject, scanProjectFileActivity]);

  // 执行一轮完整扫描（所有项目）+ AI 生成
  const runFullScan = useCallback(async () => {
    if (autoScanBusyRef.current) return;
    autoScanBusyRef.current = true;
    autoScanCancelledRef.current = false;
    const idleApi = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandles: number[] = [];

    try {
      const currentProjects = useProjectStore.getState().projects;
      let anyChanged = false;

      for (const project of currentProjects) {
        if (autoScanCancelledRef.current) break;
        const changed = await scanOne(project);
        if (changed) anyChanged = true;
        await new Promise<void>(resolve => {
          if (typeof idleApi.requestIdleCallback === 'function') {
            const h = idleApi.requestIdleCallback(() => resolve(), { timeout: 3000 });
            idleHandles.push(h);
          } else {
            const t = window.setTimeout(resolve, 500);
            idleHandles.push(t);
          }
        });
      }

      if (!autoScanCancelledRef.current && anyChanged) {
        void useProjectStore.getState().loadProjects({ silent: true });
      }

      // AI 生成
      if (!autoScanCancelledRef.current) {
        const latestProjects = useProjectStore.getState().projects;
        const latestDocs = useProjectDocStore.getState().projectDocs;
        for (const project of latestProjects) {
          if (autoScanCancelledRef.current) break;
          if (!shouldGenerateAutoProjectDescription(project)) continue;
          try {
            const statsResult = await window.electronAPI.getTreeStats(project.folderPath);
            const fileCount = statsResult?.stats?.fileCount ?? 0;
            if (fileCount < 2) continue;
            await maybeGenerateAutoProjectDescription(project, latestDocs, allStages, updateProject, fileCount);
          } catch {}
        }
      }
    } finally {
      idleHandles.forEach(h => {
        if (typeof idleApi.cancelIdleCallback === 'function') idleApi.cancelIdleCallback(h);
        else window.clearTimeout(h);
      });
      autoScanBusyRef.current = false;
    }
  }, [allStages, templates, addProjectDoc, updateProjectDoc, updateProject, scanOne]);

  // 启动后延迟扫描一次 + 每 15 分钟周期扫描
  useEffect(() => {
    if (!projects.length || !allStages.length) return;
    autoScanCancelledRef.current = false;

    const startTimer = window.setTimeout(() => {
      if (!autoScanCancelledRef.current) void runFullScan();
    }, 3000);

    const periodicTimer = window.setInterval(() => {
      if (!autoScanCancelledRef.current) void runFullScan();
    }, 15 * 60 * 1000);

    const handleFocus = () => {
      if (!autoScanCancelledRef.current && !autoScanBusyRef.current) void runFullScan();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      autoScanCancelledRef.current = true;
      window.clearTimeout(startTimer);
      window.clearInterval(periodicTimer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [projects.length, allStages.length, runFullScan]);

  const isPlanRelatedTask = (task: TaskItem) =>
    task.source === 'report' ||
    task.source === 'review' ||
    task.source === 'stage' ||
    Boolean(task.workflowId || task.workflowName || task.relatedDocId || task.stageName);

  const getTaskRank = (task: TaskItem) => {
    const statusRank = task.status === 'in_progress' ? 0 : task.status === 'pending' ? 1 : 2;
    const priorityRank = task.priority === 'high' ? 0 : task.priority === 'medium' ? 1 : 2;
    return { statusRank, priorityRank };
  };

  const getNextPlanInfo = (project: Project) => {
    const projectTasks = tasks
      .filter(task => task.projectId === project.id && task.status !== 'completed' && isPlanRelatedTask(task))
      .sort((a, b) => {
        const aRank = getTaskRank(a);
        const bRank = getTaskRank(b);
        if (aRank.statusRank !== bRank.statusRank) return aRank.statusRank - bRank.statusRank;
        const aOrder = a.workflowOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.workflowOrder ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        if (aRank.priorityRank !== bRank.priorityRank) return aRank.priorityRank - bRank.priorityRank;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    const nextTask = projectTasks[0];
    if (nextTask) {
      return {
        type: 'task' as const,
        title: nextTask.title,
        detail: nextTask.workflowName || nextTask.stageName || nextTask.description || '计划任务',
        count: projectTasks.length,
        stageName: nextTask.stageName,
      };
    }

    const docs = projectDocs.filter(doc => doc.projectId === project.id);
    const projectVersions = versions.filter(version => version.projectId === project.id);
    const nextStage = buildProjectStageSegments(project, docs, templates, projectVersions, allStages)
      .filter(segment => !segment.completedAt)
      .sort((a, b) => new Date(a.deadline || a.startAt || 0).getTime() - new Date(b.deadline || b.startAt || 0).getTime())[0];

    if (nextStage) {
      return {
        type: 'stage' as const,
        title: nextStage.label,
        detail: nextStage.deadline ? `截止 ${new Date(nextStage.deadline).toLocaleDateString('zh-CN')}` : '阶段计划',
        count: 0,
        stageName: nextStage.stage,
      };
    }

    return null;
  };

  const getNextAction = (project: Project) => deriveProjectNextActions({
    project,
    tasks,
    projectDocs,
    versions,
    templates,
    reviews,
    stageMemories,
    allStages,
    limit: 1,
  })[0] || null;

  const openProjectAction = (project: Project, action: ProjectNextAction) => {
    setCurrentProject(project);
    if (action.stageName) setCurrentStageName(action.stageName);
    navigateWorkbench({
      projectId: project.id,
      target: action.target,
      stageName: action.stageName,
      docId: action.docId,
      taskId: action.taskId,
      reviewId: action.reviewId,
      source: 'overview',
      prompt: action.detail,
    });
  };

  const openProjectPlan = (project: Project, stageName?: string) => {
    setCurrentProject(project);
    if (stageName) setCurrentStageName(stageName);
    navigateWorkbench({
      projectId: project.id,
      target: 'plan',
      stageName,
      source: 'overview',
    });
  };
  const formatProjectTime = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 按项目文件夹内最新文件/目录修改时间降序排序，并支持名称、描述、路径搜索。
  const visibleProjects = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return [...projects]
      .filter(project => {
        if (!keyword) return true;
        return [
          project.name,
          project.description,
          project.folderPath,
          project.folderPath?.split(/[/\\]/).pop(),
        ].some(value => String(value || '').toLowerCase().includes(keyword));
      })
      .sort((a, b) => {
        const aTime = new Date(a.folderModifiedAt || a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.folderModifiedAt || b.updatedAt || b.createdAt).getTime();
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      });
  }, [projects, searchKeyword]);
  useLayoutEffect(() => {
    setTableBodyElement(tableWrapRef.current?.querySelector<HTMLElement>('.ant-table-body') || null);
  }, [visibleProjects.length]);

  useLayoutEffect(() => {
    const body = tableBodyElement;
    if (!body || !activeHighlightId) {
      setRowHighlight(prev => prev.visible ? { ...prev, visible: false } : prev);
      return;
    }

    const row = body.querySelector<HTMLTableRowElement>(
      activeHighlightVariant === 'preview'
        ? '.overview-project-row-preview'
        : '.overview-project-row-selected',
    );
    if (!row) {
      setRowHighlight(prev => prev.visible ? { ...prev, visible: false } : prev);
      return;
    }

    const bodyRect = body.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setRowHighlight({
      top: rowRect.top - bodyRect.top + body.scrollTop,
      height: PROJECT_TABLE_ROW_HEIGHT,
      visible: true,
      variant: activeHighlightVariant,
    });
  }, [activeHighlightId, activeHighlightVariant, tableBodyElement, visibleProjects.length, searchKeyword]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  // 消费命令面板触发的一次性 overview 动作
  const overviewAction = useNavigationStore(s => s.overviewAction);
  const consumeOverviewAction = useNavigationStore(s => s.consumeOverviewAction);
  useEffect(() => {
    if (overviewAction === 'create-project') {
      consumeOverviewAction();
      setCreateModalOpen(true);
    }
  }, [overviewAction, consumeOverviewAction]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const result = await window.electronAPI.createProjectFolder({
        projectName: values.name,
        workspacePath,
      });
      if (!result.success) {
        message.error(`创建失败: ${result.error}`);
        return;
      }
      const folderPath = result.folderPath || '';
      const newProject: Project = {
        id: Date.now().toString(),
        name: values.name,
        description: values.description || '',
        descriptionSource: values.description?.trim() ? 'manual' : 'auto',
        folderPath,
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addProject(newProject);
      await syncProjectStageFiles(newProject, {
        allStages,
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
      });
      setCreateModalOpen(false);
      form.resetFields();
      message.success(`项目「${values.name}」创建成功`);
    } catch (error) {
      console.error('创建项目失败:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleImportFromFolder = async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (!folderPath) return;
    if (projects.some(p => p.folderPath === folderPath)) {
      message.warning('该文件夹已导入为项目');
      return;
    }
    const folderName = folderPath.split(/[/\\]/).pop() || '未命名项目';
    const newProject: Project = {
      id: Date.now().toString(),
      name: folderName,
      description: '',
      descriptionSource: 'auto',
      folderPath,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await addProject(newProject);
    const syncResult = await syncProjectStageFiles(newProject, { allStages, projectDocs, templates, addProjectDoc, updateProjectDoc });
    const activityFiles = [...syncResult.createdFileNames, ...syncResult.updatedFileNames];
    if (activityFiles.length > 0) await markAutoDescriptionFileActivity(newProject, updateProject, { activityAt: syncResult.latestActivityAt, fileNames: activityFiles });
    message.success(`已导入项目：${folderName}`);
  };

  const handleImportFromZip = async () => {
    const zipPath = await window.electronAPI.openZipFile();
    if (!zipPath) return;
    const result = await window.electronAPI.importFromZip({ zipPath, workspacePath });
    if (result.success) {
      const folderPath = result.project?.folderPath || '';
      const folderName = folderPath.split(/[/\\]/).pop() || '未命名项目';
      const newProject: Project = {
        id: Date.now().toString(),
        name: folderName,
        description: '',
        descriptionSource: 'auto',
        folderPath,
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addProject(newProject);
      const syncResult = await syncProjectStageFiles(newProject, { allStages, projectDocs, templates, addProjectDoc, updateProjectDoc });
      const activityFiles2 = [...syncResult.createdFileNames, ...syncResult.updatedFileNames];
      if (activityFiles2.length > 0) await markAutoDescriptionFileActivity(newProject, updateProject, { activityAt: syncResult.latestActivityAt, fileNames: activityFiles2 });
      message.success(`已导入项目：${folderName}`);
    } else {
      message.error(result.error || '导入失败');
    }
  };

  // columns 用 useMemo 固定，避免每次 render 重建列配置
  const columns = useMemo(() => [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      render: (name: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, overflow: 'hidden' }}>
          <FolderOutlined style={{ color: '#1890ff', fontSize: 16, flexShrink: 0 }} />
          <Text
            strong
            title={name}
            ellipsis
            style={{ display: 'block', flex: '1 1 auto', minWidth: 0, maxWidth: '100%', fontSize: 13 }}
          >
            {name}
          </Text>
        </div>
      ),
    },
    {
      title: '阶段',
      key: 'stage',
      width: 110,
      render: (_: any, record: Project) => {
        const s = getSummary(record);
        return (
          <Tag
            color={s.stageColor}
            style={{ maxWidth: 92, marginInlineEnd: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={s.stageLabel}
          >
            {s.stageLabel}
          </Tag>
        );
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 180,
      render: (_: any, record: Project) => {
        const avg = getSummary(record).progress;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={avg}
              size="small"
              showInfo={false}
              strokeColor={avg >= 80 ? '#52c41a' : avg >= 50 ? '#1890ff' : avg >= 30 ? '#faad14' : '#ff4d4f'}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <Text style={{ fontSize: 12, color: '#666', minWidth: 32 }}>{avg}%</Text>
          </div>
        );
      },
    },
    {
      title: '截止日期',
      key: 'deadline',
      width: 150,
      render: (_: any, record: Project) => {
        const dl = getSummary(record).deadline;
        if (!dl) return <Text type="secondary" style={{ fontSize: 12 }}>未设置</Text>;
        const statusColor = dl.status === 'overdue' ? '#ff4d4f' : dl.status === 'aboutToExpire' ? '#faad14' : '#999';
        return (
          <Space size={4}>
            {dl.status === 'overdue' && <WarningOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />}
            {dl.status === 'aboutToExpire' && <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 12 }} />}
            <CalendarOutlined style={{ color: statusColor, fontSize: 12 }} />
            <Text style={{ fontSize: 12, color: statusColor }}>{dl.date}</Text>
          </Space>
        );
      },
    },
    {
      title: '最近文件',
      key: 'folderModifiedAt',
      width: 130,
      render: (_: any, record: Project) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatProjectTime(record.folderModifiedAt || record.updatedAt)}
        </Text>
      ),
    },
    {
      title: '下一步计划',
      key: 'nextPlan',
      width: 370,
      render: (_: any, record: Project) => {
        const nextPlan = getSummary(record).nextAction;
        if (!nextPlan) {
          return (
            <div className="overview-next-plan overview-next-plan-empty" style={{ height: PROJECT_TABLE_ROW_HEIGHT - 18 }}>
              <Text type="secondary" className="overview-next-plan-title">
                暂无计划
              </Text>
              <span className="overview-next-plan-detail" aria-hidden="true">&nbsp;</span>
            </div>
          );
        }

        return (
          <Tooltip title="双击进入对应工作台">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openProjectAction(record, nextPlan);
              }}
              style={{
                width: '100%',
                height: PROJECT_TABLE_ROW_HEIGHT - 18,
                minWidth: 0,
                border: 0,
                background: 'transparent',
                padding: 0,
                textAlign: 'left',
                cursor: 'default',
              }}
              className="overview-next-plan"
            >
              <div className="overview-next-plan-main">
                <ClockCircleOutlined style={{ color: nextPlan.severity === 'high' ? '#ff4d4f' : nextPlan.severity === 'medium' ? '#faad14' : '#1677ff', fontSize: 12, flexShrink: 0 }} />
                <Text ellipsis className="overview-next-plan-title">
                  {nextPlan.title}
                </Text>
                {typeof nextPlan.count === 'number' && nextPlan.count > 1 && <Tag style={{ margin: 0, fontSize: 10 }}>{nextPlan.count}</Tag>}
              </div>
              <Text type="secondary" ellipsis className="overview-next-plan-detail">
                {nextPlan.detail}
              </Text>
            </button>
          </Tooltip>
        );
      },
    },
  ], [projectSummaryMap, openProjectAction]);

  return (
    <>
    <Card
      className="dashboard-card project-table-card animate-slide-up stagger-4"
      title="项目列表"
      bordered={false}
      style={{}}
      extra={
        <Space size={4}>
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder="搜索项目名称、描述或文件夹路径"
            value={searchKeyword}
            onChange={event => setSearchKeyword(event.target.value)}
            style={{ width: 280 }}
          />
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            新建项目
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'folder', icon: <FolderOpenOutlined />, label: '从文件夹导入' },
                { key: 'zip', icon: <FileZipOutlined />, label: '从 ZIP 导入' },
              ],
              onClick: ({ key }) => {
                if (key === 'folder') handleImportFromFolder();
                else if (key === 'zip') handleImportFromZip();
              },
            }}
          >
            <Button size="small">导入 ▾</Button>
          </Dropdown>
        </Space>
      }
    >
      <div ref={tableWrapRef} className="overview-project-table-wrap">
      <Table
        className="overview-project-table"
        columns={columns}
        dataSource={visibleProjects}
        rowKey="id"
        pagination={false}
        size="middle"
        tableLayout="fixed"
        scroll={{ x: PROJECT_TABLE_SCROLL_X, y: PROJECT_TABLE_SCROLL_Y }}
        locale={{
          emptyText: (
            <div style={{ padding: '40px 0', color: '#94a3b8' }}>
              <FolderOutlined style={{ fontSize: 36, marginBottom: 12, display: 'block', opacity: 0.4 }} />
              <div style={{ fontSize: 14 }}>暂无项目</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>点击右上角创建或导入项目</div>
            </div>
          ),
        }}
        onRow={(record) => ({
          onMouseDown: (e) => {
            if (e.detail > 1) {
              cancelPendingSingleClickOpen();
            }
          },
          onClick: (e) => {
            if (e.detail > 1) return;
            openProjectFromRow(record, undefined, e.currentTarget as HTMLElement);
          },
          onDoubleClick: (e) => {
            cancelPendingSingleClickOpen();
            openProjectFromRow(record, 'files', e.currentTarget as HTMLElement);
          },
          style: { cursor: 'pointer' },
        })}
        rowClassName={(record) =>
          record.id === highlightedProjectId
            ? 'overview-project-row-preview'
            : record.id === currentProjectId
              ? 'overview-project-row-selected'
              : ''
        }
      />
      {tableBodyElement && createPortal(
        <div
          className={`overview-project-row-highlight overview-project-row-highlight-${rowHighlight.variant}`}
          style={{
            height: PROJECT_TABLE_ROW_HEIGHT,
            opacity: rowHighlight.visible ? 1 : 0,
            transform: `translate3d(0, ${rowHighlight.top}px, 0)`,
          }}
        />,
        tableBodyElement,
      )}
      </div>
    </Card>

    <Modal
      title="新建项目"
      open={createModalOpen}
      onOk={handleCreate}
      onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
      okText="创建"
      cancelText="取消"
      confirmLoading={creating}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input placeholder="例如：XX可行性研究项目" />
        </Form.Item>
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={2} placeholder="可选" />
        </Form.Item>
      </Form>
    </Modal>
    </>
  );
};

export default ProjectTable;

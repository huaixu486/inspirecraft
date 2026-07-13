import React, { useMemo } from 'react';
import { Space, Tag, Typography, Tooltip, Button, Dropdown } from 'antd';
import {
  FileTextOutlined, CalendarOutlined,
  CheckCircleOutlined, ExperimentOutlined,
  TeamOutlined, LeftOutlined,
  FolderOpenOutlined, EditOutlined, DiffOutlined,
  BookOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { WorkbenchPage, WorkbenchFocus } from '../../../shared/types';
import { getAllStages, getStageMeta, detectTimelineStage } from '../../utils/timelineStages';

const { Text } = Typography;

type GlobalPage = 'overview' | 'calendar' | 'settings' | 'project-files' | 'project-plan' | 'project-team' | 'project-templates' | 'project-report' | 'project-review' | 'project-writing';

interface Props {
  globalPage: GlobalPage;
  embedded?: boolean;
  hideProjectTitle?: boolean;
  mode?: 'full' | 'status' | 'nav';
  onBack?: () => void;
}

const globalToWorkbench: Record<string, WorkbenchPage> = {
  'project-files': 'files',
  'project-plan': 'plan',
  'project-team': 'team',
  'project-templates': 'templates',
  'project-report': 'report',
  'project-review': 'review',
  'project-writing': 'team',
  calendar: 'calendar',
};

const pageLabels: Partial<Record<GlobalPage, string>> = {
  'project-files': '文件详情',
  'project-plan': '计划管理',
  'project-team': '团队协同',
  'project-templates': '模板管理',
  'project-report': '阶段报告与任务',
  'project-review': '文档审查',
  'project-writing': '团队协同',
};

const WorkbenchContextBar: React.FC<Props> = ({ globalPage, embedded = false, hideProjectTitle = false, mode = 'full', onBack }) => {
  const currentProject = useProjectStore(s => s.currentProject);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const reviews = useTemplateStore(s => s.reviews);
  const stageMemories = useKnowledgeStore(s => s.stageMemories);
  const navigate = useNavigationStore(s => s.navigate);
  const customStages = useSettingsStore(s => s.customStages);

  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);

  const projectDocsList = useMemo(
    () => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [],
    [projectDocs, currentProject],
  );
  const projectReviews = useMemo(
    () => currentProject ? reviews.filter(r => r.projectId === currentProject.id) : [],
    [reviews, currentProject],
  );
  const projectMemories = useMemo(
    () => currentProject ? stageMemories.filter(m => m.projectId === currentProject.id) : [],
    [stageMemories, currentProject],
  );

  const currentStage = useMemo(() => {
    if (!currentProject) return null;
    const sorted = [...projectDocsList].sort((a, b) => {
      const aTime = a.sourceFileModifiedAt || a.analyzedAt || a.createdAt;
      const bTime = b.sourceFileModifiedAt || b.analyzedAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    const latest = sorted[0];
    if (!latest) return null;
    return detectTimelineStage(allStages, latest.name, latest.sourceFilePath);
  }, [currentProject, projectDocsList, allStages]);

  const progress = useMemo(() => {
    if (!currentProject || projectDocsList.length === 0) return 0;
    const completed = projectDocsList.filter(d => d.overallProgress >= 90).length;
    return Math.round((completed / projectDocsList.length) * 100);
  }, [currentProject, projectDocsList]);

  const latestReview = projectReviews.length > 0
    ? [...projectReviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;
  const memoryCount = projectMemories.length;

  // 当前文档：当前阶段最新文档 → 项目最近修改文档
  const currentDoc = useMemo(() => {
    if (!currentProject) return null;
    const sorted = [...projectDocsList].sort((a, b) => {
      const aTime = a.sourceFileModifiedAt || a.analyzedAt || a.createdAt;
      const bTime = b.sourceFileModifiedAt || b.analyzedAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    if (currentStage) {
      const stageDoc = sorted.find(d => detectTimelineStage(allStages, d.name, d.sourceFilePath) === currentStage);
      if (stageDoc) return stageDoc;
    }
    return sorted[0] || null;
  }, [currentProject, projectDocsList, currentStage, allStages]);

  // 快捷操作
  const handleOpenFolder = async () => {
    if (currentProject?.folderPath) {
      await window.electronAPI.openInExplorer(currentProject.folderPath);
    }
  };
  const tasks = useTaskStore(s => s.tasks);
  const incompleteTasks = useMemo(
    () => currentProject ? tasks.filter(t => t.projectId === currentProject.id && t.status !== 'completed') : [],
    [tasks, currentProject],
  );

  if (!currentProject) return null;

  const currentWorkbench = globalToWorkbench[globalPage];
  const showProjectTitle = !hideProjectTitle && mode === 'full';
  const showStatus = mode !== 'nav';
  const showNavigation = mode !== 'status';
  const showQuickActions = showNavigation && globalPage !== 'project-files';
  const isFullDock = !embedded && mode === 'full';
  const stageColor = currentStage ? (stageMeta[currentStage]?.color || '#1677ff') : '#999';

  const handleNavigate = (page: WorkbenchPage) => {
    const focus: WorkbenchFocus = { target: page, projectId: currentProject.id, source: 'overview' };
    navigate(focus);
  };

  const navItems = [
    { key: 'files' as WorkbenchPage, icon: <FileTextOutlined />, label: '文件' },
    { key: 'plan' as WorkbenchPage, icon: <CalendarOutlined />, label: '计划' },
    { key: 'report' as WorkbenchPage, icon: <ExperimentOutlined />, label: '报告' },
    { key: 'review' as WorkbenchPage, icon: <CheckCircleOutlined />, label: '审查', extra: latestReview ? `${latestReview.score}分` : undefined },
    { key: 'team' as WorkbenchPage, icon: <TeamOutlined />, label: '团队' },
  ];

  return (
    <div className={`workbench-context-bar${isFullDock ? ' workbench-context-dock' : ''}${embedded ? ' workbench-context-embedded' : ''}${mode === 'nav' ? ' workbench-context-nav-only' : ''}`}>
      <div className="workbench-context-summary">
        {showProjectTitle && (
          onBack && <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回项目总览" className="workbench-context-back-button" />
        )}
        {showProjectTitle && (
          <Tooltip title="点击返回总览">
            <Text
              strong
              className="workbench-context-project-name"
              onClick={onBack}
            >
              {currentProject.name}
            </Text>
          </Tooltip>
        )}

        {showProjectTitle && pageLabels[globalPage] && <span className="workbench-context-page-label">{pageLabels[globalPage]}</span>}

        {showStatus && currentStage && (
          <Tag color={stageColor} className="workbench-context-status-tag">
            {currentStage}
          </Tag>
        )}
        {showStatus && (
          <Tooltip title="文档完成进度">
            <Tag className="workbench-context-status-tag workbench-context-progress-tag">
              进度 {progress}%
            </Tag>
          </Tooltip>
        )}
      </div>

      {showNavigation && (
        <div className="workbench-context-nav">
          <Space size={mode === 'nav' ? 6 : 4} wrap>
            {navItems.map(item => {
              const isActive = currentWorkbench === item.key;
              return (
                <Button
                  key={item.key}
                  size="small"
                  type={isActive ? 'primary' : 'text'}
                  icon={item.icon}
                  onClick={() => handleNavigate(item.key)}
                  className={`workbench-context-nav-button${isActive ? ' is-active' : ''}`}
                >
                  {item.label}
                  {item.extra && (
                    <Text type="secondary" className="workbench-context-nav-extra">{item.extra}</Text>
                  )}
                </Button>
              );
            })}
          </Space>
        </div>
      )}

      {showQuickActions && (
        <div className="workbench-context-quick-actions">
          <Dropdown
            menu={{
              items: [
                { key: 'folder', icon: <FolderOpenOutlined />, label: '打开文件夹', onClick: () => void handleOpenFolder() },
                currentDoc ? { key: 'writing', icon: <EditOutlined />, label: '进入写作', onClick: () => navigate({ target: 'team', projectId: currentProject.id, docId: currentDoc?.id, source: 'overview' }) } : null,
                currentDoc ? { key: 'review', icon: <CheckCircleOutlined />, label: '开始审查', onClick: () => navigate({ target: 'review', projectId: currentProject.id, docId: currentDoc?.id, source: 'overview' }) } : null,
                { key: 'diff', icon: <DiffOutlined />, label: '版本对比', onClick: () => navigate({ target: 'review', projectId: currentProject.id, source: 'overview' }) },
                incompleteTasks.length > 0 ? { key: 'tasks', icon: <ThunderboltOutlined />, label: `${incompleteTasks.length} 个待办`, onClick: () => navigate({ target: 'plan', projectId: currentProject.id, source: 'overview' }) } : null,
                memoryCount > 0 ? { key: 'memory', icon: <BookOutlined />, label: `阶段记忆 (${memoryCount})`, onClick: () => navigate({ target: 'report', projectId: currentProject.id, source: 'overview' }) } : null,
              ].filter(Boolean),
            }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button size="small" type="text" icon={<ThunderboltOutlined />} style={{ color: '#8c8c8c' }}>
              快捷
            </Button>
          </Dropdown>
        </div>
      )}
    </div>
  );
};

export default WorkbenchContextBar;

import React, { useMemo } from 'react';
import { Space, Tag, Typography, Tooltip, Button } from 'antd';
import { FileTextOutlined, CalendarOutlined, CheckCircleOutlined, ExperimentOutlined, TeamOutlined, LeftOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { WorkbenchPage, WorkbenchFocus } from '../../../shared/types';
import { getAllStages, getCurrentStageDocumentProgress, getStageMeta } from '../../utils/timelineStages';

const { Text } = Typography;
type GlobalPage = 'overview' | 'calendar' | 'settings' | 'project-files' | 'project-plan' | 'project-team' | 'project-templates' | 'project-report' | 'project-review';
interface Props { globalPage: GlobalPage; embedded?: boolean; hideProjectTitle?: boolean; mode?: 'full' | 'status' | 'nav'; onBack?: () => void; }

const globalToWorkbench: Record<string, WorkbenchPage> = { 'project-files': 'files', 'project-plan': 'plan', 'project-team': 'team', 'project-templates': 'templates', 'project-report': 'report', 'project-review': 'review', calendar: 'calendar' };

const WorkbenchContextBar: React.FC<Props> = ({ globalPage, embedded = false, hideProjectTitle = false, mode = 'full', onBack }) => {
  const currentProject = useProjectStore(s => s.currentProject);
  const versions = useProjectStore(s => s.versions);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const templates = useTemplateStore(s => s.templates);
  const reviews = useTemplateStore(s => s.reviews);
  const navigate = useNavigationStore(s => s.navigate);
  const customStages = useSettingsStore(s => s.customStages);
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);
  const projectDocsList = useMemo(() => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [], [projectDocs, currentProject]);
  const projectReviews = useMemo(() => currentProject ? reviews.filter(r => r.projectId === currentProject.id) : [], [reviews, currentProject]);
  const currentStageProgress = useMemo(
    () => getCurrentStageDocumentProgress(projectDocsList, templates, versions, allStages),
    [allStages, projectDocsList, templates, versions],
  );
  const currentStage = currentStageProgress.stage;
  const progress = currentStageProgress.progress;
  const latestReview = projectReviews.length ? [...projectReviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] : null;
  if (!currentProject) return null;
  const currentWorkbench = globalToWorkbench[globalPage];
  const showProjectTitle = !hideProjectTitle && mode === 'full';
  const showStatus = mode !== 'nav';
  const showNavigation = mode !== 'status';
  const isFullDock = !embedded && mode === 'full';
  const stageColor = currentStage ? (stageMeta[currentStage]?.color || '#1677ff') : '#999';
  const handleNavigate = (page: WorkbenchPage) => navigate({ target: page, projectId: currentProject.id, source: 'overview' } as WorkbenchFocus);
  const navItems = [
    { key: 'files' as WorkbenchPage, icon: <FileTextOutlined />, label: '文件' },
    { key: 'plan' as WorkbenchPage, icon: <CalendarOutlined />, label: '计划' },
    { key: 'team' as WorkbenchPage, icon: <TeamOutlined />, label: '团队' },
    { key: 'report' as WorkbenchPage, icon: <ExperimentOutlined />, label: '报告' },
    { key: 'review' as WorkbenchPage, icon: <CheckCircleOutlined />, label: '审查', extra: latestReview ? `${latestReview.score}分` : undefined },
  ];
  return <div className={`workbench-context-bar${isFullDock ? ' workbench-dock-surface workbench-context-dock' : ''}${embedded ? ' workbench-context-embedded' : ''}${mode === 'nav' ? ' workbench-context-nav-only' : ''}`}>
    <div className={isFullDock ? 'workbench-dock-grid' : 'workbench-context-content'}>
    <div className="workbench-context-summary">
      {showProjectTitle && onBack && <Button type="text" size="middle" icon={<LeftOutlined />} onClick={onBack} title="返回项目总览" className="workbench-context-back-button" />}
      {showProjectTitle && <Tooltip title="点击返回总览"><Text strong className="workbench-context-project-name" onClick={onBack}>{currentProject.name}</Text></Tooltip>}
    </div>
    {showStatus && <div className="workbench-context-status">
      {showStatus && currentStage && <Tag color={stageColor} className="workbench-context-status-tag">{currentStage}</Tag>}
      {showStatus && <Tooltip title="文档完成进度"><Tag className="workbench-context-status-tag workbench-context-progress-tag">进度 {progress}%</Tag></Tooltip>}
    </div>}
    {showNavigation && <div className="workbench-context-nav"><Space size={6}>{navItems.map(item => {
      const isActive = currentWorkbench === item.key;
      return <Button key={item.key} size="middle" type={isActive ? 'primary' : 'text'} icon={item.icon} onClick={() => handleNavigate(item.key)} className={`workbench-context-nav-button${isActive ? ' is-active' : ''}`}>{item.label}{item.extra && <Text type="secondary" className="workbench-context-nav-extra">{item.extra}</Text>}</Button>;
    })}</Space></div>}
    </div>
  </div>;
};
export default WorkbenchContextBar;

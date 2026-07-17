import React, { useMemo } from 'react';
import { Space, Tag, Typography, Tooltip, Button } from 'antd';
import { FileTextOutlined, CalendarOutlined, CheckCircleOutlined, ExperimentOutlined, TeamOutlined, LeftOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { WorkbenchPage, WorkbenchFocus } from '../../../shared/types';
import { getAllStages, getStageMeta, detectTimelineStage } from '../../utils/timelineStages';

const { Text } = Typography;
type GlobalPage = 'overview' | 'calendar' | 'settings' | 'project-files' | 'project-plan' | 'project-team' | 'project-templates' | 'project-report' | 'project-review';
interface Props { globalPage: GlobalPage; embedded?: boolean; hideProjectTitle?: boolean; mode?: 'full' | 'status' | 'nav'; onBack?: () => void; }

const globalToWorkbench: Record<string, WorkbenchPage> = { 'project-files': 'files', 'project-plan': 'plan', 'project-team': 'team', 'project-templates': 'templates', 'project-report': 'report', 'project-review': 'review', calendar: 'calendar' };
const pageLabels: Partial<Record<GlobalPage, string>> = { 'project-files': '文件详情', 'project-plan': '计划管理', 'project-team': '团队协同', 'project-templates': '模板管理', 'project-report': '阶段报告与任务', 'project-review': '文档审查' };

const WorkbenchContextBar: React.FC<Props> = ({ globalPage, embedded = false, hideProjectTitle = false, mode = 'full', onBack }) => {
  const currentProject = useProjectStore(s => s.currentProject);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const reviews = useTemplateStore(s => s.reviews);
  const navigate = useNavigationStore(s => s.navigate);
  const customStages = useSettingsStore(s => s.customStages);
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);
  const projectDocsList = useMemo(() => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [], [projectDocs, currentProject]);
  const projectReviews = useMemo(() => currentProject ? reviews.filter(r => r.projectId === currentProject.id) : [], [reviews, currentProject]);
  const currentStage = useMemo(() => {
    const latest = [...projectDocsList].sort((a, b) => new Date(b.sourceFileModifiedAt || b.analyzedAt || b.createdAt).getTime() - new Date(a.sourceFileModifiedAt || a.analyzedAt || a.createdAt).getTime())[0];
    return latest ? detectTimelineStage(allStages, latest.name, latest.sourceFilePath) : null;
  }, [projectDocsList, allStages]);
  const progress = useMemo(() => projectDocsList.length ? Math.round((projectDocsList.filter(d => d.overallProgress >= 90).length / projectDocsList.length) * 100) : 0, [projectDocsList]);
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
  return <div className={`workbench-context-bar${isFullDock ? ' workbench-context-dock' : ''}${embedded ? ' workbench-context-embedded' : ''}${mode === 'nav' ? ' workbench-context-nav-only' : ''}`}>
    <div className="workbench-context-summary">
      {showProjectTitle && onBack && <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回项目总览" className="workbench-context-back-button" />}
      {showProjectTitle && <Tooltip title="点击返回总览"><Text strong className="workbench-context-project-name" onClick={onBack}>{currentProject.name}</Text></Tooltip>}
      {showProjectTitle && pageLabels[globalPage] && <span className="workbench-context-page-label">{pageLabels[globalPage]}</span>}
      {showStatus && currentStage && <Tag color={stageColor} className="workbench-context-status-tag">{currentStage}</Tag>}
      {showStatus && <Tooltip title="文档完成进度"><Tag className="workbench-context-status-tag workbench-context-progress-tag">进度 {progress}%</Tag></Tooltip>}
    </div>
    {showNavigation && <div className="workbench-context-nav"><Space size={mode === 'nav' ? 6 : 4} wrap>{navItems.map(item => {
      const isActive = currentWorkbench === item.key;
      return <Button key={item.key} size="small" type={isActive ? 'primary' : 'text'} icon={item.icon} onClick={() => handleNavigate(item.key)} className={`workbench-context-nav-button${isActive ? ' is-active' : ''}`}>{item.label}{item.extra && <Text type="secondary" className="workbench-context-nav-extra">{item.extra}</Text>}</Button>;
    })}</Space></div>}
  </div>;
};
export default WorkbenchContextBar;

import React, { useMemo } from 'react';
import { Space, Tag, Typography, Tooltip, Button, Badge } from 'antd';
import {
  FileTextOutlined, CalendarOutlined, EditOutlined,
  CheckCircleOutlined, ExperimentOutlined, ReadOutlined,
  BookOutlined, TeamOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { WorkbenchPage, WorkbenchFocus } from '../../../shared/types';
import { getAllStages, getStageMeta, detectTimelineStage, getProjectProgress } from '../../utils/timelineStages';

const { Text } = Typography;

type GlobalPage = 'overview' | 'calendar' | 'settings' | 'project-files' | 'project-plan' | 'project-team' | 'project-templates' | 'project-report' | 'project-review' | 'project-writing';

interface Props {
  globalPage: GlobalPage;
  embedded?: boolean;
  hideProjectTitle?: boolean;
}

/** 全局页 → WorkbenchPage 映射 */
const globalToWorkbench: Record<string, WorkbenchPage> = {
  'project-files': 'files',
  'project-plan': 'plan',
  'project-team': 'team',
  'project-templates': 'templates',
  'project-report': 'report',
  'project-review': 'review',
  'project-writing': 'writing',
  'calendar': 'calendar',
};

const WorkbenchContextBar: React.FC<Props> = ({ globalPage, embedded = false, hideProjectTitle = false }) => {
  const currentProject = useProjectStore(s => s.currentProject);
  const setCurrentProject = useProjectStore(s => s.setCurrentProject);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const tasks = useTaskStore(s => s.tasks);
  const reviews = useTemplateStore(s => s.reviews);
  const stageMemories = useKnowledgeStore(s => s.stageMemories);
  const navigate = useNavigationStore(s => s.navigate);
  const customStages = useSettingsStore(s => s.customStages);

  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const stageMeta = useMemo(() => getStageMeta(allStages), [allStages]);

  // 当前项目数据
  const projectDocsList = useMemo(
    () => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [],
    [projectDocs, currentProject],
  );
  const projectTasks = useMemo(
    () => currentProject ? tasks.filter(t => t.projectId === currentProject.id) : [],
    [tasks, currentProject],
  );
  const projectReviews = useMemo(
    () => currentProject ? reviews.filter(r => r.projectId === currentProject.id) : [],
    [reviews, currentProject],
  );
  const projectMemories = useMemo(
    () => currentProject ? stageMemories.filter(m => m.projectId === currentProject.id) : [],
    [stageMemories, currentProject],
  );

  // 当前阶段检测
  const currentStage = useMemo(() => {
    if (!currentProject) return null;
    // 取最近活动的文档来推断阶段
    const sorted = [...projectDocsList].sort((a, b) => {
      const aTime = a.sourceFileModifiedAt || a.analyzedAt || a.createdAt;
      const bTime = b.sourceFileModifiedAt || b.analyzedAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    const latest = sorted[0];
    if (!latest) return null;
    return detectTimelineStage(allStages, latest.name, latest.sourceFilePath);
  }, [currentProject, projectDocsList, allStages]);

  // 项目进度
  const progress = useMemo(() => {
    if (!currentProject) return 0;
    // 简单计算：已完成文档 / 总文档
    if (projectDocsList.length === 0) return 0;
    const completed = projectDocsList.filter(d => d.overallProgress >= 90).length;
    return Math.round((completed / projectDocsList.length) * 100);
  }, [currentProject, projectDocsList]);

  // 统计
  const pendingTaskCount = projectTasks.filter(t => t.status === 'pending').length;
  const latestReview = projectReviews.length > 0
    ? projectReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;
  const memoryCount = projectMemories.length;

  if (!currentProject) return null;

  const currentWorkbench = globalToWorkbench[globalPage];

  const handleNavigate = (page: WorkbenchPage) => {
    const focus: WorkbenchFocus = { target: page, projectId: currentProject.id, source: 'overview' };
    navigate(focus);
  };

  const stageColor = currentStage ? (stageMeta[currentStage]?.color || '#1677ff') : '#999';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: embedded ? '8px 0 0' : '8px 18px',
      background: embedded ? 'transparent' : 'linear-gradient(135deg, #fafbfc 0%, #f5f7fa 100%)',
      borderBottom: embedded ? 'none' : '1px solid #f0f0f0',
      flexWrap: 'wrap',
      minHeight: embedded ? 30 : 44,
    }}>
      {!hideProjectTitle && (
        <>
          <Tooltip title="点击返回总览">
            <Text strong style={{ fontSize: 13, cursor: 'pointer', color: '#0f172a' }}
              onClick={() => setCurrentProject(null)}>
              {currentProject.name}
            </Text>
          </Tooltip>

          <span style={{ color: '#d9d9d9', fontSize: 11 }}>|</span>
        </>
      )}

      {/* 当前阶段 */}
      {/* 当前阶段 */}
      {currentStage && (
        <Tag color={stageColor} style={{ margin: 0, fontSize: 11 }}>
          {currentStage}
        </Tag>
      )}

      {/* 进度 */}
      <Tooltip title="文档完成进度">
        <Tag style={{ margin: 0, fontSize: 11 }}>
          进度 {progress}%
        </Tag>
      </Tooltip>

      <span style={{ color: '#d9d9d9', fontSize: 11 }}>|</span>

      {/* 快捷导航按钮 */}
      <Space size={4}>
        {[
          { key: 'files' as WorkbenchPage, icon: <FileTextOutlined />, label: '文件', count: projectDocsList.length },
          { key: 'plan' as WorkbenchPage, icon: <CalendarOutlined />, label: '计划' },
          { key: 'report' as WorkbenchPage, icon: <ExperimentOutlined />, label: '报告', count: pendingTaskCount },
          { key: 'review' as WorkbenchPage, icon: <CheckCircleOutlined />, label: '审查', extra: latestReview ? `${latestReview.score}分` : undefined },
          { key: 'writing' as WorkbenchPage, icon: <EditOutlined />, label: '写作' },
          { key: 'templates' as WorkbenchPage, icon: <BookOutlined />, label: '模板' },
          { key: 'calendar' as WorkbenchPage, icon: <AppstoreOutlined />, label: '对比' },
        ].map(item => {
          const isActive = currentWorkbench === item.key;
          return (
            <Tooltip key={item.key} title={item.label}>
              <Button
                size="small"
                type={isActive ? 'primary' : 'text'}
                icon={item.icon}
                onClick={() => handleNavigate(item.key)}
                style={{
                  fontSize: 11,
                  height: 26,
                  paddingInline: 8,
                  color: isActive ? undefined : '#666',
                }}
              >
                {item.label}
                {item.count !== undefined && item.count > 0 && (
                  <Badge count={item.count} size="small" style={{ marginLeft: 4 }} />
                )}
                {item.extra && (
                  <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>{item.extra}</Text>
                )}
              </Button>
            </Tooltip>
          );
        })}
      </Space>

      {/* 阶段记忆数 */}
      {memoryCount > 0 && (
        <>
          <span style={{ color: '#d9d9d9', fontSize: 11 }}>|</span>
          <Tooltip title="阶段记忆条数">
            <Tag style={{ margin: 0, fontSize: 11, color: '#999' }}>
              记忆 {memoryCount}
            </Tag>
          </Tooltip>
        </>
      )}
    </div>
  );
};

export default WorkbenchContextBar;

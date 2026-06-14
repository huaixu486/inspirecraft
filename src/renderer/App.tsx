import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import {
  CalendarOutlined,
  FileTextOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import DiffViewer from './components/DiffViewer/DiffViewer';
import AISettings from './components/AISettings/AISettings';
import Overview from './components/Overview/Overview';
import ProjectFileExplorer from './components/ProjectList/ProjectFileExplorer';
import ProgressBoard from './components/ProgressBoard/ProgressBoard';
import PlanManager from './components/PlanManager/PlanManager';
import TemplateManager from './components/TemplateManager/TemplateManager';
import TaskPlanner from './components/TaskPlanner/TaskPlanner';
import DocumentReviewer from './components/DocumentReviewer/DocumentReviewer';
import DocumentWriter from './components/DocumentWriter/DocumentWriter';
import { useProjectStore } from './stores/projectStore';
import { useTemplateStore } from './stores/templateStore';
import { useTaskStore } from './stores/taskStore';
import { useSettingsStore } from './stores/settingsStore';
import { useProjectDocStore } from './stores/projectDocStore';
import { Project } from '../shared/types';

const { Title, Text } = Typography;

type GlobalPage = 'overview' | 'calendar' | 'settings' | 'project-files' | 'project-plan' | 'project-team' | 'project-templates' | 'project-report' | 'project-review' | 'project-writing';
type ProjectDetailPage = 'files' | 'plan' | 'team' | 'templates' | 'report' | 'review' | 'writing';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'red' }}>
          <h3>渲染错误：</h3>
          <pre>{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const [globalPage, setGlobalPage] = useState<GlobalPage>('overview');
  const [panelInitialTab, setPanelInitialTab] = useState('overview');
  // 设置页动画状态
  const [settingsAnim, setSettingsAnim] = useState<{
    phase: 'idle' | 'closed' | 'opening' | 'closing';
    x: number;
    y: number;
  }>({ phase: 'idle', x: 0, y: 0 });
  const settingsFabRef = useRef<HTMLButtonElement>(null);
  const {
    loadProjects,
    loadVersions,
    currentProject,
    setCurrentProject,
  } = useProjectStore();
  const { loadTemplates, loadReviews } = useTemplateStore();
  const { loadTasks } = useTaskStore();
  const { loadSettings } = useSettingsStore();
  const { loadProjectDocs } = useProjectDocStore();

  useEffect(() => {
    loadProjects();
    loadVersions();
    loadTemplates();
    loadReviews();
    loadTasks();
    loadSettings();
    loadProjectDocs();
  }, []);

  useEffect(() => {
    let scrollTimer: NodeJS.Timeout;
    const showScrollbar = (el: HTMLElement) => {
      if (!el?.classList) return;
      el.classList.add('scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => el.classList.remove('scrolling'), 1000);
    };
    const handleScroll = (e: Event) => showScrollbar(e.target as HTMLElement);
    const handleWheel = (e: WheelEvent) => {
      let el = e.target as HTMLElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
          showScrollbar(el);
          break;
        }
        el = el.parentElement!;
      }
    };
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('wheel', handleWheel);
      clearTimeout(scrollTimer);
    };
  }, []);

  const openProjectPanel = (project: Project, initialTab = 'overview') => {
    setCurrentProject(project);
    if (initialTab === 'files') {
      // 双击项目 → 直接进入文件详情页
      setGlobalPage('project-files');
    } else {
      setPanelInitialTab(initialTab);
      setGlobalPage('overview');
    }
  };

  const openProjectDetail = (page: ProjectDetailPage) => {
    const pageMap: Record<ProjectDetailPage, GlobalPage> = {
      files: 'project-files',
      plan: 'project-plan',
      team: 'project-team',
      templates: 'project-templates',
      report: 'project-report',
      review: 'project-review',
      writing: 'project-writing',
    };
    setGlobalPage(pageMap[page]);
  };

  // 设置页：从按钮位置展开
  const handleOpenSettings = useCallback(() => {
    const btn = settingsFabRef.current;
    if (!btn) { setGlobalPage('settings'); return; }
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // 先设为 closed 状态（circle 0%），下一帧再设为 open（circle 150%），触发 CSS transition
    setSettingsAnim({ phase: 'closed', x: cx, y: cy });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSettingsAnim({ phase: 'opening', x: cx, y: cy });
      });
    });
  }, []);

  // 从设置页返回：收缩回按钮位置
  const handleCloseSettings = useCallback(() => {
    const btn = settingsFabRef.current;
    if (!btn) { setGlobalPage('overview'); setSettingsAnim({ phase: 'idle', x: 0, y: 0 }); return; }
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // 先设为 opening（circle 150%），下一帧设为 closed（circle 0%），触发收缩动画
    setSettingsAnim({ phase: 'opening', x: cx, y: cy });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSettingsAnim({ phase: 'closed', x: cx, y: cy });
        // 动画结束后清理
        setTimeout(() => {
          setGlobalPage('overview');
          setSettingsAnim({ phase: 'idle', x: 0, y: 0 });
        }, 380);
      });
    });
  }, []);

  const renderContent = () => {
    if (globalPage === 'calendar') return <DiffViewer onBack={() => setGlobalPage('overview')} />;
    // 设置页由覆盖层动画渲染，不在主内容区渲染
    if (globalPage === 'settings' && settingsAnim.phase === 'idle') return <AISettings />;
    if (globalPage === 'project-files' && currentProject) {
      return <ProjectFileExplorer project={currentProject} onBack={() => setGlobalPage('overview')} />;
    }
    if (globalPage === 'project-plan') return <PlanManager onBack={() => setGlobalPage('overview')} />;
    if (globalPage === 'project-team') return <ProgressBoard onBack={() => setGlobalPage('overview')} />;
    if (globalPage === 'project-templates') return <TemplateManager onBack={() => setGlobalPage('overview')} />;
    if (globalPage === 'project-report') return <TaskPlanner onBack={() => setGlobalPage('overview')} />;
    if (globalPage === 'project-review') return <DocumentReviewer onBack={() => setGlobalPage('overview')} />;
    if (globalPage === 'project-writing') return <DocumentWriter onBack={() => setGlobalPage('overview')} />;
    return <Overview onEnterProject={openProjectPanel} panelInitialTab={panelInitialTab} onOpenProjectDetail={openProjectDetail} />;
  };

  const pageTitleMap: Record<GlobalPage, string> = {
    overview: 'ProjectHub',
    calendar: '日历',
    settings: '设置',
    'project-files': '文件详情',
    'project-plan': '计划详情',
    'project-team': '团队协同',
    'project-templates': '模板管理',
    'project-report': '报告工作台',
    'project-review': '审查工作台',
    'project-writing': 'AI协同',
  };
  const title = pageTitleMap[globalPage];
  const subtitle = globalPage === 'overview' ? '项目总览' : currentProject?.name || '全局工具';

  return (
    <div className="app-shell app-shell-polished" style={{ height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <div
        className="app-topbar"
        style={{
          height: 62,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            className="app-topbar-logo"
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, #1677ff 0%, #24a3ff 100%)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 16,
              boxShadow: '0 10px 22px rgba(22, 119, 255, 0.24)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            P
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Title level={5} style={{ margin: 0, color: '#0f172a' }}>
              {title}
            </Title>
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>
              {subtitle}
            </Text>
          </div>
        </div>

        <Space size={8}>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => setGlobalPage('project-templates')}
            type={globalPage === 'project-templates' ? 'primary' : 'default'}
          >
            模板
          </Button>
          <Button
            icon={<CalendarOutlined />}
            onClick={() => setGlobalPage('calendar')}
            type={globalPage === 'calendar' ? 'primary' : 'default'}
          >
            日历
          </Button>
        </Space>
      </div>

      <main
        className="app-content"
        style={{
          height: 'calc(100vh - 62px)',
          overflow: 'hidden',
          padding: 18,
          background: 'transparent',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ErrorBoundary>
          <div
            className="page-transition"
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            {renderContent()}
          </div>
        </ErrorBoundary>
      </main>

      <Button
        ref={settingsFabRef}
        shape="circle"
        icon={<SettingOutlined style={{ color: settingsAnim.phase !== 'idle' ? '#1677ff' : undefined }} />}
        type="default"
        onClick={settingsAnim.phase !== 'idle' ? handleCloseSettings : handleOpenSettings}
        title="设置"
        className={`app-settings-fab${settingsAnim.phase !== 'idle' ? ' app-settings-fab-active' : ''}`}
        style={{
          position: 'fixed',
          left: 18,
          bottom: 18,
          width: 42,
          height: 42,
          zIndex: 200,
          borderColor: settingsAnim.phase !== 'idle' ? '#1677ff' : undefined,
          boxShadow: settingsAnim.phase !== 'idle' ? '0 0 0 3px rgba(22, 119, 255, 0.15)' : undefined,
        }}
      />

      {/* 设置页圆形展开/收缩动画覆盖层 */}
      {settingsAnim.phase !== 'idle' && (
        <div
          className="settings-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: '#fff',
            clipPath: settingsAnim.phase === 'opening'
              ? `circle(150% at ${settingsAnim.x}px ${settingsAnim.y}px)`
              : `circle(0% at ${settingsAnim.x}px ${settingsAnim.y}px)`,
            overflow: 'auto',
          }}
        >
          <div style={{ padding: 18 }}>
            <AISettings />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

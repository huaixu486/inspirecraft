import React, { useState, useEffect } from 'react';
import { Layout, Menu, theme, Typography, Button, Space, Progress } from 'antd';
import {
  FolderOutlined,
  FileTextOutlined,
  DiffOutlined,
  BarChartOutlined,
  RobotOutlined,
  FileSearchOutlined,
  FormOutlined,
  SettingOutlined,
  PlusOutlined,
  ImportOutlined,
  UserOutlined,
  RightOutlined,
  BellOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import ProjectList from './components/ProjectList/ProjectList';
import VersionViewer from './components/VersionViewer/VersionViewer';
import DiffViewer from './components/DiffViewer/DiffViewer';
import ProgressBoard from './components/ProgressBoard/ProgressBoard';
import TaskPlanner from './components/TaskPlanner/TaskPlanner';
import TemplateManager from './components/TemplateManager/TemplateManager';
import DocumentReviewer from './components/DocumentReviewer/DocumentReviewer';
import AISettings from './components/AISettings/AISettings';
import Overview from './components/Overview/Overview';
import PlanManager from './components/PlanManager/PlanManager';
import { useProjectStore } from './stores/projectStore';
import { useTemplateStore } from './stores/templateStore';
import { useTaskStore } from './stores/taskStore';
import { useSettingsStore } from './stores/settingsStore';
import { useProjectDocStore } from './stores/projectDocStore';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

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
  const [selectedKey, setSelectedKey] = useState('overview');
  const { loadProjects, loadVersions } = useProjectStore();
  const { loadTemplates, loadReviews } = useTemplateStore();
  const { loadTasks } = useTaskStore();
  const { loadSettings, workspaceCapacity, workspaceUsedBytes, userProfile } = useSettingsStore();
  const { loadProjectDocs } = useProjectDocStore();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  useEffect(() => {
    loadProjects();
    loadVersions();
    loadTemplates();
    loadReviews();
    loadTasks();
    loadSettings();
    loadProjectDocs();
  }, []);

  // 全局滚动检测：滚动时添加 .scrolling 类，停止后移除
  useEffect(() => {
    let scrollTimer: NodeJS.Timeout;
    const showScrollbar = (el: HTMLElement) => {
      if (!el?.classList) return;
      el.classList.add('scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        el.classList.remove('scrolling');
      }, 1000);
    };

    const handleScroll = (e: Event) => {
      showScrollbar(e.target as HTMLElement);
    };

    const handleWheel = (e: WheelEvent) => {
      // 找到最近的可滚动父元素
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

  const menuItems = [
    { key: 'overview', icon: <BarChartOutlined />, label: '总览' },
    { key: 'projects', icon: <FolderOutlined />, label: '项目' },
    { key: 'plan', icon: <CalendarOutlined />, label: '计划' },
    { key: 'templates', icon: <FormOutlined />, label: '模板' },
    { key: 'diff', icon: <DiffOutlined />, label: '日历' },
    { key: 'progress', icon: <BarChartOutlined />, label: '团队' },
    { key: 'tasks', icon: <RobotOutlined />, label: '报告' },
    { key: 'review', icon: <FileSearchOutlined />, label: '审查' },
    { key: 'ai-settings', icon: <SettingOutlined />, label: '设置' },
  ];

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const usedGB = workspaceUsedBytes / (1024 * 1024 * 1024);
  const storagePercent = workspaceCapacity > 0
    ? Math.min(Math.round((usedGB / workspaceCapacity) * 100), 100)
    : 0;

  const renderContent = () => {
    switch (selectedKey) {
      case 'overview':
        return <Overview />;
      case 'projects':
        return <ProjectList />;
      case 'plan':
        return <PlanManager />;
      case 'templates':
        return <TemplateManager />;
      case 'diff':
        return <DiffViewer />;
      case 'progress':
        return <ProgressBoard />;
      case 'tasks':
        return <TaskPlanner />;
      case 'review':
        return <DocumentReviewer />;
      case 'ai-settings':
        return <AISettings />;
      default:
        return <Overview />;
    }
  };

  return (
    <Layout className="app-shell" style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider className="app-sidebar" width={210} theme="light" style={{ borderRight: '1px solid rgba(226, 232, 240, 0.72)', height: '100vh', overflow: 'hidden' }}>
        <div className="app-brand" style={{ padding: '18px 20px 20px', borderBottom: '1px solid rgba(226, 232, 240, 0.45)' }}>
          <Space>
            <div style={{
              width: 32,
              height: 32,
              background: 'linear-gradient(135deg, #1677ff 0%, #5bb7ff 100%)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 14,
              boxShadow: '0 8px 18px rgba(22, 119, 255, 0.24)',
            }}>
              P
            </div>
            <Title level={5} style={{ margin: 0, color: '#0f172a' }}>
              ProjectHub
            </Title>
          </Space>
        </div>
        <Menu
          className="app-nav"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => setSelectedKey(key)}
          style={{ borderRight: 0, padding: '10px 12px' }}
        />

        {/* Storage info */}
        <div style={{
          position: 'absolute',
          bottom: 88,
          left: 16,
          right: 16,
          background: 'rgba(255, 255, 255, 0.72)',
          border: '1px solid rgba(226, 232, 240, 0.86)',
          borderRadius: 12,
          padding: '14px',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
        }}>
          <Text style={{ color: '#999', fontSize: 11 }}>存储空间</Text>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ color: '#333', fontSize: 12 }}>{formatBytes(workspaceUsedBytes)} / {workspaceCapacity} GB</Text>
          </div>
          <Progress
            percent={storagePercent}
            size="small"
            strokeColor={storagePercent > 90 ? '#ff4d4f' : '#1890ff'}
            trailColor="#e8e8e8"
            showInfo={false}
            style={{ marginTop: 4 }}
          />
        </div>

        {/* User info */}
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 16,
            right: 16,
            padding: '12px',
            border: '1px solid rgba(226, 232, 240, 0.78)',
            borderRadius: 12,
            background: 'rgba(255, 255, 255, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: '0 10px 26px rgba(15, 23, 42, 0.05)',
          }}
          onClick={() => setSelectedKey('ai-settings')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {userProfile?.avatar ? (
              <img
                src={userProfile.avatar}
                alt="avatar"
                style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: userProfile ? '#e6f7ff' : '#f5f5f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <UserOutlined style={{ color: userProfile ? '#1890ff' : '#999', fontSize: 14 }} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <Text style={{ color: '#333', fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userProfile?.nickname || '未登录'}
              </Text>
              <Text style={{ color: '#999', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {userProfile?.email || '点击设置个人信息'}
              </Text>
            </div>
          </div>
          <RightOutlined style={{ color: '#ccc', fontSize: 10, flexShrink: 0 }} />
        </div>
      </Sider>
      <Layout className="app-workspace" style={{ height: '100vh', overflow: 'hidden' }}>
        {/* Top bar with notification bell */}
        <div className="app-topbar" style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '8px 22px',
          borderBottom: '1px solid rgba(226, 232, 240, 0.55)',
          background: 'rgba(255, 255, 255, 0.58)',
          flexShrink: 0,
        }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.78)',
            border: '1px solid rgba(226, 232, 240, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}>
            <BellOutlined style={{ fontSize: 16, color: '#666' }} />
          </div>
        </div>
        <Content
          className="app-content"
          style={{
            margin: 0,
            padding: '20px',
            background: 'transparent',
            borderRadius: borderRadiusLG,
            flex: 1,
            overflow: 'auto',
          }}
        >
          <ErrorBoundary>
            {renderContent()}
          </ErrorBoundary>
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;

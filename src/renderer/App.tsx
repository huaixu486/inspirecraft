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
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0', height: '100vh', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Space>
            <div style={{
              width: 32,
              height: 32,
              background: '#fff',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1890ff',
              fontWeight: 'bold',
              fontSize: 14,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}>
              P
            </div>
            <Title level={5} style={{ margin: 0, color: '#1890ff' }}>
              ProjectHub
            </Title>
          </Space>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => setSelectedKey(key)}
          style={{ borderRight: 0, padding: '8px 0' }}
        />

        {/* Storage info */}
        <div style={{
          position: 'absolute',
          bottom: 56,
          left: 12,
          right: 12,
          background: '#f6f8fa',
          borderRadius: 8,
          padding: '12px',
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
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 16px',
            borderTop: '1px solid #f0f0f0',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
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
      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        {/* Top bar with notification bell */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 24px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fff',
          flexShrink: 0,
        }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}>
            <BellOutlined style={{ fontSize: 16, color: '#666' }} />
          </div>
        </div>
        <Content
          style={{
            margin: '16px',
            padding: 0,
            background: '#f5f5f5',
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

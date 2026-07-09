import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Empty, List, Modal, Popover, Space, Tabs, Tag, Typography, message } from 'antd';
import {
  CalendarOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
  UserAddOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import Overview from './components/Overview/Overview';
import NotificationCenter from './components/Notifications/NotificationCenter';
import AIJobCenter from './components/Notifications/AIJobCenter';
import ProjectFileExplorer from './components/ProjectList/ProjectFileExplorer';
import { useProjectStore } from './stores/projectStore';
import { useTemplateStore } from './stores/templateStore';
import { useTaskStore } from './stores/taskStore';
import { useSettingsStore } from './stores/settingsStore';
import { useProjectDocStore } from './stores/projectDocStore';
import { useNavigationStore } from './stores/navigationStore';
import { Project, WorkbenchFocus, WorkbenchPage } from '../shared/types';
import WorkbenchContextBar from './components/Workbench/WorkbenchContextBar';
import StartupOverlay, { BootPhase } from './components/Startup/StartupOverlay';

const { Title, Text } = Typography;
const MemoOverview = React.memo(Overview);
const LazyDiffViewer = lazy(() => import('./components/DiffViewer/DiffViewer'));
const LazyAISettings = lazy(() => import('./components/AISettings/AISettings'));
const LazyProgressBoard = lazy(() => import('./components/ProgressBoard/ProgressBoard'));
const LazyPlanManager = lazy(() => import('./components/PlanManager/PlanManager'));
const LazyTemplateManager = lazy(() => import('./components/TemplateManager/TemplateManager'));
const LazyTaskPlanner = lazy(() => import('./components/TaskPlanner/TaskPlanner'));
const LazyDocumentReviewer = lazy(() => import('./components/DocumentReviewer/DocumentReviewer'));
const LazyDocumentWriter = lazy(() => import('./components/DocumentWriter/DocumentWriter'));

const LazyPageFallback = () => (
  <div style={{ flex: 1, padding: '24px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
    {/* \u9876\u90e8\u5de5\u5177\u680f\u9aa8\u67b6 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.96)', border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <div className="skeleton-loading" style={{ width: 36, height: 36, borderRadius: 10 }} />
      <div className="skeleton-loading" style={{ width: 40, height: 40, borderRadius: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="skeleton-loading" style={{ width: 120, height: 16, borderRadius: 4 }} />
        <div className="skeleton-loading" style={{ width: 80, height: 12, borderRadius: 4 }} />
      </div>
      <div style={{ flex: 1 }} />
      <div className="skeleton-loading" style={{ width: 200, height: 32, borderRadius: 8 }} />
      <div className="skeleton-loading" style={{ width: 80, height: 32, borderRadius: 8 }} />
    </div>
    {/* \u5185\u5bb9\u533a\u57df\u9aa8\u67b6 */}
    {[1, 2, 3, 4, 5].map(i => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #f5f5f5' }}>
        <div className="skeleton-loading" style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0 }} />
        <div className="skeleton-loading" style={{ width: `${140 + i * 30}px`, height: 14, borderRadius: 4 }} />
        <div style={{ flex: 1 }} />
        <div className="skeleton-loading" style={{ width: 50, height: 14, borderRadius: 4 }} />
        <div className="skeleton-loading" style={{ width: 100, height: 14, borderRadius: 4 }} />
      </div>
    ))}
  </div>
);

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
  const [friendPopoverOpen, setFriendPopoverOpen] = useState(false);
  const [lanFriends, setLanFriends] = useState<CollaborationPeerInfo[]>([]);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addFriendTab, setAddFriendTab] = useState<'lan' | 'requests'>('lan');
  const [lanPeers, setLanPeers] = useState<CollaborationPeerInfo[]>([]);
  const [friendRequests, setFriendRequests] = useState<CollaborationFriendRequest[]>([]);
  const [scanningLan, setScanningLan] = useState(false);
  const [bootPhase, setBootPhase] = useState<BootPhase>('init');
  const [bootDone, setBootDone] = useState(false);
  const lastNonOverviewPageRef = useRef<GlobalPage | null>(null);
  const preSettingsPageRef = useRef<GlobalPage>('overview'); // 打开设置前的页面
  const logoRef = useRef<HTMLDivElement>(null);
  const didInitialProjectRefreshRef = useRef(false);
  const pageNavTimersRef = useRef<number[]>([]);
  const pendingNotificationTargetRef = useRef<{ targetPage: GlobalPage; projectId?: string } | null>(null);
  const [pageNavAnim, setPageNavAnim] = useState<{
    phase: 'idle' | 'leaving' | 'entering' | 'pulse';
    direction: 'toOverview' | 'fromOverview';
  }>({ phase: 'idle', direction: 'toOverview' });
  const settingsFabRef = useRef<HTMLButtonElement>(null);
  // 使用细粒度 selector，避免 store 任意字段变化触发 App 重渲染
  const projects = useProjectStore(s => s.projects);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const loadVersions = useProjectStore(s => s.loadVersions);
  const currentProject = useProjectStore(s => s.currentProject);
  const setCurrentProject = useProjectStore(s => s.setCurrentProject);
  const loadTemplates = useTemplateStore(s => s.loadTemplates);
  const loadReviews = useTemplateStore(s => s.loadReviews);
  const loadTasks = useTaskStore(s => s.loadTasks);
  const loadSettings = useSettingsStore(s => s.loadSettings);
  const loadProjectDocs = useProjectDocStore(s => s.loadProjectDocs);

  const refreshLanFriends = useCallback(async () => {
    const result = await window.electronAPI.listCollaborationFriends?.();
    if (result?.success) setLanFriends(result.friends || []);
  }, []);

  const scanLanPeers = useCallback(async () => {
    setScanningLan(true);
    try {
      const result = await window.electronAPI.listCollaborationPeers?.();
      if (result?.success) {
        setLanPeers(result.peers || []);
      }
    } finally {
      setScanningLan(false);
    }
  }, []);

  const refreshFriendRequests = useCallback(async () => {
    const result = await window.electronAPI.listFriendRequests?.();
    if (result?.success) setFriendRequests(result.requests || []);
  }, []);

  useEffect(() => {
    void refreshLanFriends();
    const offPeers = window.electronAPI.onCollaborationPeersChanged?.((payload) => {
      setLanFriends(payload.friends || []);
    });
    // 协作事件原生通知
    const offFile = window.electronAPI.onCollaborationFileReceived?.((payload) => {
      if (payload.fileName) {
        message.success(`已接收文件：${payload.fileName}`);
        window.electronAPI.showSystemNotification?.({
          title: '收到新文件',
          body: `${payload.senderName || '好友'} 发送了 ${payload.fileName}${payload.projectName ? `（${payload.projectName}）` : ''}`,
          target: 'overview',
        });
      }
    });
    const offTask = window.electronAPI.onCollaborationTaskReceived?.((payload) => {
      if (payload.task) {
        message.success(`收到新任务：${payload.task.title || '未命名任务'}`);
        window.electronAPI.showSystemNotification?.({
          title: '收到新任务',
          body: `${payload.senderName || '好友'} 发送了任务：${payload.task.title || '未命名任务'}`,
          target: 'project-report',
          projectId: payload.task.projectId,
        });
      }
    });
    const offFriendReq = window.electronAPI.onFriendRequestReceived?.((payload) => {
      if (payload.fromName) {
        message.info(`收到好友请求：${payload.fromName}`);
        window.electronAPI.showSystemNotification?.({
          title: '收到好友请求',
          body: `${payload.fromName}${payload.fromDeviceName ? ` (${payload.fromDeviceName})` : ''} 请求添加你为好友`,
          target: 'overview',
        });
        void refreshFriendRequests();
      }
    });
    return () => {
      offPeers?.();
      offFile?.();
      offTask?.();
      offFriendReq?.();
    };
  }, [refreshLanFriends, refreshFriendRequests]);

  // 启动遮罩 + 并行加载优化
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const idleHandles: number[] = [];
    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const scheduleIdle = (callback: () => void, timeout = 1200) => {
      if (typeof idleApi.requestIdleCallback === 'function') {
        const handle = idleApi.requestIdleCallback(() => {
          if (!cancelled) callback();
        }, { timeout });
        idleHandles.push(handle);
        return;
      }
      const timer = window.setTimeout(() => {
        if (!cancelled) callback();
      }, Math.min(timeout, 500));
      timers.push(timer);
    };

    const startTime = performance.now();

    // 并行加载关键数据（只加载渲染首页必需的数据，不阻塞文档索引）
    setBootPhase('settings');
    Promise.all([
      loadSettings(),
      loadProjects(),
    ]).then(() => {
      if (cancelled) return;
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`[Boot] 关键数据加载完成: ${elapsed}ms`);
      setBootPhase('ready');
    }).catch(err => {
      console.error('[Boot] 加载失败:', err);
      if (!cancelled) setBootPhase('ready'); // 即使失败也结束遮罩
    });

    // 延迟加载（不影响启动遮罩）
    scheduleIdle(() => { void loadProjectDocs(); }, 200);
    scheduleIdle(() => { void loadVersions(); }, 400);
    scheduleIdle(() => { void loadTemplates(); }, 600);
    scheduleIdle(() => { void loadTasks(); }, 800);
    scheduleIdle(() => { void loadReviews(); }, 1000);

    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
      if (typeof idleApi.cancelIdleCallback === 'function') {
        idleHandles.forEach(handle => idleApi.cancelIdleCallback!(handle));
      }
    };
  }, []);

  // 预加载策略：不启动后立即全量预加载（会和后台数据刷新抢资源），
  // 改为 5 秒后只预加载最常用的 2 个模块，其余通过悬停导航按钮触发
  useEffect(() => {
    if (!bootDone) return;
    const idleApi = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    let cancelled = false;
    // 只预加载最高频的 2 个模块，延迟 5 秒避开启动繁忙期
    const quickPreloads = [
      () => import('./components/PlanManager/PlanManager'),
      () => import('./components/TemplateManager/TemplateManager'),
    ];
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      let idx = 0;
      const scheduleNext = () => {
        if (cancelled || idx >= quickPreloads.length) return;
        const loader = quickPreloads[idx++];
        if (typeof idleApi.requestIdleCallback === 'function') {
          idleApi.requestIdleCallback(() => { void loader().then(scheduleNext); }, { timeout: 3000 });
        } else {
          setTimeout(() => { void loader().then(scheduleNext); }, 500);
        }
      };
      scheduleNext();
    }, 5000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [bootDone]);

  // 悬停预加载：鼠标悬停导航按钮时预加载对应页面模块
  const preloadedModulesRef = useRef<Set<string>>(new Set());
  const preloadModule = useCallback((key: string, loader: () => Promise<unknown>) => {
    if (preloadedModulesRef.current.has(key)) return;
    preloadedModulesRef.current.add(key);
    void loader();
  }, []);

  useEffect(() => {
    if (globalPage !== 'overview' && globalPage !== 'settings') {
      lastNonOverviewPageRef.current = globalPage;
    }
  }, [globalPage]);

  useEffect(() => {
    if (globalPage !== 'overview') return;
    if (!didInitialProjectRefreshRef.current) {
      didInitialProjectRefreshRef.current = true;
      return;
    }

    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleTimer: number | undefined;
    const timer = window.setTimeout(() => {
      if (typeof idleApi.requestIdleCallback === 'function') {
        idleTimer = idleApi.requestIdleCallback(() => {
          loadProjects({ silent: true });
        }, { timeout: 2000 });
      } else {
        loadProjects({ silent: true });
      }
    }, 900);

    return () => {
      window.clearTimeout(timer);
      if (idleTimer !== undefined && typeof idleApi.cancelIdleCallback === 'function') {
        idleApi.cancelIdleCallback(idleTimer);
      }
    };
  }, [globalPage, loadProjects]);
  useEffect(() => {
    return () => {
      pageNavTimersRef.current.forEach(timer => window.clearTimeout(timer));
      pageNavTimersRef.current = [];
    };
  }, []);
  // 滚动条显示：只监听 .app-content 内部，避免全局 wheel 遍历 DOM
  useEffect(() => {
    let scrollTimer: NodeJS.Timeout;
    let wheelRaf = 0;
    const appContent = document.querySelector('.app-content');
    if (!appContent) return;
    const showScrollbar = (el: HTMLElement) => {
      if (!el?.classList) return;
      el.classList.add('scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => el.classList.remove('scrolling'), 1000);
    };
    const handleScroll = (e: Event) => showScrollbar(e.target as HTMLElement);
    const handleWheel: EventListener = (event) => {
      const e = event as WheelEvent;
      if (wheelRaf) return; // rAF 节流
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0;
        let el = e.target as HTMLElement;
        // 只在 .app-content 内查找，不遍历整个 document
        while (el && el !== appContent) {
          if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
            showScrollbar(el);
            break;
          }
          el = el.parentElement!;
        }
      });
    };
    appContent.addEventListener('scroll', handleScroll, true);
    appContent.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      appContent.removeEventListener('scroll', handleScroll, true);
      appContent.removeEventListener('wheel', handleWheel);
      clearTimeout(scrollTimer);
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
    };
  }, []);

  const clearPageNavTimers = useCallback(() => {
    pageNavTimersRef.current.forEach(timer => window.clearTimeout(timer));
    pageNavTimersRef.current = [];
  }, []);

  const schedulePageNavTimer = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      pageNavTimersRef.current = pageNavTimersRef.current.filter(item => item !== timer);
      callback();
    }, delay);
    pageNavTimersRef.current.push(timer);
  }, []);

  const navigateToPage = useCallback((targetPage: GlobalPage) => {
    // 同页跳转才忽略，动画状态不阻塞导航
    if (targetPage === globalPage) return;

    const currentPage = globalPage;
    const direction = targetPage === 'overview' ? 'toOverview' : 'fromOverview';
    // 打断旧动画
    clearPageNavTimers();

    if (currentPage !== 'overview' && currentPage !== 'settings') {
      lastNonOverviewPageRef.current = currentPage;
    }

    // 立即切换页面，动画只是视觉过渡
    setGlobalPage(targetPage);
    setPageNavAnim({ phase: 'entering', direction });
    schedulePageNavTimer(() => {
      setPageNavAnim({ phase: 'idle', direction });
    }, 120);
  }, [clearPageNavTimers, globalPage, schedulePageNavTimer]);

  const navigateToOverview = useCallback(() => {
    navigateToPage('overview');
  }, [navigateToPage]);

  const openProjectPanel = useCallback((project: Project, initialTab = 'overview') => {
    setCurrentProject(project);
    if (initialTab === 'files') {
      navigateToPage('project-files');
    } else {
      setPanelInitialTab(initialTab);
      navigateToOverview();
    }
  }, [navigateToOverview, navigateToPage, setCurrentProject]);

  const openProjectDetail = useCallback((page: ProjectDetailPage) => {
    const pageMap: Record<ProjectDetailPage, GlobalPage> = {
      files: 'project-files',
      plan: 'project-plan',
      team: 'project-team',
      templates: 'project-templates',
      report: 'project-report',
      review: 'project-review',
      writing: 'project-writing',
    };
    navigateToPage(pageMap[page]);
  }, [navigateToPage]);

  const handleLogoNavigate = useCallback(() => {
    const targetPage = globalPage === 'overview'
      ? lastNonOverviewPageRef.current
      : 'overview';

    if (!targetPage || targetPage === globalPage) {
      const direction = globalPage === 'overview' ? 'fromOverview' : 'toOverview';
      clearPageNavTimers();
      setPageNavAnim({ phase: 'pulse', direction });
      schedulePageNavTimer(() => {
        setPageNavAnim({ phase: 'idle', direction });
      }, 180);
      return;
    }

    navigateToPage(targetPage);
  }, [clearPageNavTimers, globalPage, navigateToPage, schedulePageNavTimer]);


  const handleOpenNotificationTarget = useCallback((targetPage: GlobalPage, projectId?: string) => {
    if (projectId) {
      const project = projects.find(item => item.id === projectId);
      if (project) {
        setCurrentProject(project);
      } else {
        pendingNotificationTargetRef.current = { targetPage, projectId };
        void loadProjects({ silent: true });
        return;
      }
    }
    navigateToPage(targetPage);
  }, [loadProjects, navigateToPage, projects, setCurrentProject]);

  useEffect(() => {
    const pending = pendingNotificationTargetRef.current;
    if (!pending?.projectId) return;
    const project = projects.find(item => item.id === pending.projectId);
    if (!project) return;
    pendingNotificationTargetRef.current = null;
    setCurrentProject(project);
    navigateToPage(pending.targetPage);
  }, [navigateToPage, projects, setCurrentProject]);

  useEffect(() => {
    const validTargets = new Set<GlobalPage>(['overview', 'project-plan', 'project-report', 'project-review']);
    const unsubscribe = window.electronAPI.onSystemNotificationClick?.((payload) => {
      const targetPage = validTargets.has(payload?.target as GlobalPage) ? payload.target as GlobalPage : 'overview';
      handleOpenNotificationTarget(targetPage, payload?.projectId);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [handleOpenNotificationTarget]);

  // ─── 统一跳转上下文消费 ───────────────────────────────
  const { pendingFocus, consumePendingFocus, setActivePage } = useNavigationStore();

  // WorkbenchPage -> GlobalPage 映射
  const workbenchToGlobal = useCallback((target: WorkbenchPage): GlobalPage => {
    const map: Record<WorkbenchPage, GlobalPage> = {
      files: 'project-files',
      plan: 'project-plan',
      team: 'project-team',
      templates: 'project-templates',
      report: 'project-report',
      review: 'project-review',
      writing: 'project-writing',
      calendar: 'calendar',
    };
    return map[target];
  }, []);

  // 消费 pendingFocus：设置项目 + 导航
  useEffect(() => {
    if (!pendingFocus) return;
    const project = projects.find(p => p.id === pendingFocus.projectId);
    if (project) {
      setCurrentProject(project);
      navigateToPage(workbenchToGlobal(pendingFocus.target));
      setActivePage(pendingFocus.target);
      consumePendingFocus();
    } else {
      // 项目未加载，尝试加载后重试
      pendingNotificationTargetRef.current = { targetPage: workbenchToGlobal(pendingFocus.target), projectId: pendingFocus.projectId };
      void loadProjects({ silent: true });
      consumePendingFocus();
    }
  }, [pendingFocus, projects, setCurrentProject, navigateToPage, workbenchToGlobal, consumePendingFocus, setActivePage, loadProjects]);

  // Open settings from the floating button.
  const handleOpenSettings = useCallback(() => {
    preSettingsPageRef.current = globalPage;
    setGlobalPage('settings');
  }, [globalPage]);
  // Close settings back to the page before settings.
  const handleCloseSettings = useCallback(() => {
    const target = preSettingsPageRef.current === 'settings' ? 'overview' : preSettingsPageRef.current;
    navigateToPage(target);
  }, [navigateToPage]);

  const onlineFriendCount = lanFriends.filter(friend => friend.online).length;
  const pendingRequestCount = friendRequests.filter(r => r.status === 'pending').length;

  const handleAddFriend = async (peer: CollaborationPeerInfo) => {
    const result = await window.electronAPI.addCollaborationFriend?.({ ...peer, source: 'lan', status: 'accepted' });
    if (result?.success) {
      message.success(`\u5df2\u6dfb\u52a0 ${peer.name || peer.host} \u4e3a\u597d\u53cb`);
      setLanFriends(result.friends || []);
      setLanPeers(prev => prev.map(p => p.id === peer.id ? { ...p, added: true } : p));
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    const result = await window.electronAPI.removeCollaborationFriend?.(friendId);
    if (result?.success) {
      setLanFriends(result.friends || []);
      setLanPeers(prev => prev.map(p => p.id === friendId ? { ...p, added: false } : p));
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    const result = await window.electronAPI.acceptFriendRequest?.(requestId);
    if (result?.success) {
      message.success('\u5df2\u63a5\u53d7\u597d\u53cb\u8bf7\u6c42');
      setLanFriends(result.friends || []);
      void refreshFriendRequests();
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    const result = await window.electronAPI.rejectFriendRequest?.(requestId);
    if (result?.success) {
      void refreshFriendRequests();
    }
  };

  const openAddFriendModal = () => {
    setAddFriendOpen(true);
    setAddFriendTab('lan');
    void scanLanPeers();
    void refreshFriendRequests();
  };

  const friendPopoverContent = (
    <div style={{ width: 276, maxWidth: 'calc(100vw - 48px)', userSelect: 'none' }} onWheel={(event) => event.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Space size={6}>
          <Text strong>{'\u5c40\u57df\u7f51\u597d\u53cb'}</Text>
          <Tag color={onlineFriendCount > 0 ? 'green' : 'default'} style={{ margin: 0 }}>{onlineFriendCount} {'\u5728\u7ebf'}</Tag>
          {pendingRequestCount > 0 && <Tag color="orange" style={{ margin: 0 }}>{pendingRequestCount} {'\u8bf7\u6c42'}</Tag>}
        </Space>
        <Space size={4}>
          <Button size="small" type="text" icon={<UserAddOutlined />} onClick={openAddFriendModal}>{'\u6dfb\u52a0'}</Button>
          <Button size="small" type="text" onClick={refreshLanFriends}>{'\u5237\u65b0'}</Button>
        </Space>
      </div>
      {lanFriends.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0\u597d\u53cb\uff0c\u70b9\u51fb"\u6dfb\u52a0"\u641c\u7d22\u5c40\u57df\u7f51\u8bbe\u5907'} />
      ) : (
        <div style={{ maxHeight: 300, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 4 }}>
          <List
            size="small"
            dataSource={lanFriends}
            renderItem={(friend) => (
              <List.Item
                style={{ padding: '8px 6px', borderBlockEnd: 'none', borderRadius: 7, background: friend.online ? '#f6ffed' : 'transparent', marginBottom: 3 }}
                actions={[
                  <Button key="remove" type="text" size="small" danger onClick={() => handleRemoveFriend(friend.id)}>{'\u79fb\u9664'}</Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<span style={{ width: 8, height: 8, borderRadius: '50%', background: friend.online ? '#52c41a' : '#d9d9d9', display: 'inline-block', marginTop: 7 }} />}
                  title={<Space size={5}><Text style={{ maxWidth: 130 }} ellipsis={{ tooltip: friend.name || friend.host }}>{friend.name || friend.host}</Text><Tag color={friend.online ? 'green' : 'default'} style={{ margin: 0, fontSize: 10 }}>{friend.online ? '\u5728\u7ebf' : '\u79bb\u7ebf'}</Tag></Space>}
                  description={<Text type="secondary" style={{ fontSize: 11 }}>{friend.host}:{friend.port}</Text>}
                />
              </List.Item>
            )}
          />
        </div>
      )}
    </div>
  );
  // 从 navigationStore 取最近一次 focus 传递给目标页面
  const lastFocusRef = useRef<WorkbenchFocus | null>(null);
  useEffect(() => {
    if (pendingFocus) lastFocusRef.current = pendingFocus;
  }, [pendingFocus]);

  const renderActiveContent = (page: GlobalPage) => {
    const focus = lastFocusRef.current;
    if (page === 'calendar') return <LazyDiffViewer onBack={navigateToOverview} />;
    if (page === 'settings') return <LazyAISettings />;
    if (page === 'project-files' && currentProject) {
      return <ProjectFileExplorer project={currentProject} onBack={navigateToOverview} focus={focus?.target === 'files' ? focus : undefined} />;
    }
    if (page === 'project-plan') return <LazyPlanManager onBack={navigateToOverview} />;
    if (page === 'project-team') return <LazyProgressBoard onBack={navigateToOverview} />;
    if (page === 'project-templates') return <LazyTemplateManager onBack={navigateToOverview} />;
    if (page === 'project-report') return <LazyTaskPlanner onBack={navigateToOverview} focus={focus?.target === 'report' ? focus : undefined} />;
    if (page === 'project-review') return <LazyDocumentReviewer onBack={navigateToOverview} focus={focus?.target === 'review' ? focus : undefined} />;
    if (page === 'project-writing') return <LazyDocumentWriter onBack={navigateToOverview} focus={focus?.target === 'writing' ? focus : undefined} />;
    return null;
  };

  const pageTitleMap: Record<GlobalPage, string> = {
    overview: 'ProjectHub',
    calendar: '版本对比',
    settings: '\设\置',
    'project-files': '\文\件\详\情',
    'project-plan': '\计\划\详\情',
    'project-team': '\团\队\协\同',
    'project-templates': '\模\板\管\理',
    'project-report': '\报\告\工\作\台',
    'project-review': '\审\查\工\作\台',
    'project-writing': 'AI\协\同',
  };
  const title = pageTitleMap[globalPage];
  const subtitle = globalPage === 'overview' ? '\项\目\总\览' : currentProject?.name || '\全\局\工\具';

  return (
    <div className="app-shell app-shell-polished" style={{ height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {/* 启动遮罩 */}
      {!bootDone && (
        <StartupOverlay phase={bootPhase} onDone={() => setBootDone(true)} />
      )}
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
            ref={logoRef}
            className={`app-topbar-logo${pageNavAnim.phase !== 'idle' ? ' app-topbar-logo-navigating' : ''}`}
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
            onClick={handleLogoNavigate}
            title={globalPage === 'overview' ? '\返\回\上\次\打\开\的\页\面' : '\回\到\主\页'}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleLogoNavigate();
              }
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
          <AIJobCenter />
          <NotificationCenter onOpenTarget={handleOpenNotificationTarget} />
          <Popover open={friendPopoverOpen} onOpenChange={(open) => { setFriendPopoverOpen(open); if (open) void refreshLanFriends(); }} trigger="click" placement="bottomRight" content={friendPopoverContent} arrow overlayStyle={{ maxWidth: 306 }}>
            <Badge count={onlineFriendCount + pendingRequestCount} size="small" overflowCount={9} offset={[-2, 4]}>
              <Button icon={<TeamOutlined />} title={'\u597d\u53cb'} aria-label={'\u597d\u53cb'} onMouseDown={(event) => event.preventDefault()} />
            </Badge>
          </Popover>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => navigateToPage('project-templates')}
            onMouseEnter={() => preloadModule('templates', () => import('./components/TemplateManager/TemplateManager'))}
            type={globalPage === 'project-templates' ? 'primary' : 'default'}
            title={'\u6a21\u677f'}
            aria-label={'\u6a21\u677f'}
          />
          <Button
            icon={<CalendarOutlined />}
            onClick={() => navigateToPage('calendar')}
            onMouseEnter={() => preloadModule('calendar', () => import('./components/DiffViewer/DiffViewer'))}
            type={globalPage === 'calendar' ? 'primary' : 'default'}
            title={'版本对比'}
            aria-label={'版本对比'}
          />
        </Space>
      </div>

      <main
        className="app-content"
        style={{
          height: 'calc(100vh - 62px)',
          overflow: 'hidden',
          padding: globalPage === 'overview' ? 0 : 18,
          background: 'transparent',
          scrollbarGutter: globalPage === 'overview' ? 'auto' : 'stable',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 统一上下文栏：项目内页面显示 */}
        {globalPage !== 'overview' && globalPage !== 'settings' && globalPage !== 'project-files' && (
          <WorkbenchContextBar globalPage={globalPage} />
        )}
        <ErrorBoundary>
          <div
            className="app-page-stack"
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {globalPage === 'overview' && (
              <div
                className={`page-transition page-transition-${pageNavAnim.direction}${pageNavAnim.phase !== 'idle' ? ` page-transition-${pageNavAnim.phase}` : ''}`}
                style={{
                  position: 'absolute',
                  inset: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  zIndex: 2,
                }}
              >
                <MemoOverview visible onEnterProject={openProjectPanel} panelInitialTab={panelInitialTab} onOpenProjectDetail={openProjectDetail} />
              </div>
            )}
            {globalPage !== 'overview' && (
              <div
                key={globalPage}
                className={`page-transition page-transition-${pageNavAnim.direction}${pageNavAnim.phase !== 'idle' ? ` page-transition-${pageNavAnim.phase}` : ''} app-non-overview-page`}
                style={{
                  position: 'absolute',
                  inset: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  zIndex: 3,
                  background: 'transparent',
                  scrollbarGutter: 'stable',
                }}
              >
                <Suspense fallback={<LazyPageFallback />}>
                  {renderActiveContent(globalPage)}
                </Suspense>
              </div>
            )}
          </div>
        </ErrorBoundary>
      </main>

      <Button
        ref={settingsFabRef}
        shape="circle"
        icon={<SettingOutlined style={{ color: globalPage === 'settings' ? '#1677ff' : undefined }} />}
        type="default"
        onClick={globalPage === 'settings' ? handleCloseSettings : handleOpenSettings}
        onMouseEnter={() => preloadModule('settings', () => import('./components/AISettings/AISettings'))}
        title="设置"
        className={`app-settings-fab${globalPage === 'settings' ? ' app-settings-fab-active' : ''}`}
        style={{
          position: 'fixed',
          left: 18,
          bottom: 18,
          width: 42,
          height: 42,
          zIndex: 200,
          borderColor: globalPage === 'settings' ? '#1677ff' : undefined,
          boxShadow: globalPage === 'settings' ? '0 0 0 3px rgba(22, 119, 255, 0.15)' : undefined,
        }}
      />

      {/* 添加好友弹窗 */}
      <Modal
        title={'添加好友'}
        open={addFriendOpen}
        onCancel={() => setAddFriendOpen(false)}
        footer={null}
        width={420}
        destroyOnClose
      >
        <Tabs
          activeKey={addFriendTab}
          onChange={(key) => setAddFriendTab(key as 'lan' | 'requests')}
          items={[
            {
              key: 'lan',
              label: '局域网扫描',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {scanningLan ? '扫描中...' : `发现 ${lanPeers.length} 个设备`}
                    </Text>
                    <Button size="small" icon={<ReloadOutlined />} loading={scanningLan} onClick={scanLanPeers}>{'刷新'}</Button>
                  </div>
                  {lanPeers.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={scanningLan ? '正在扫描局域网设备...' : '未发现设备，请确认对方已开启局域网协作'} />
                  ) : (
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      <List
                        size="small"
                        dataSource={lanPeers}
                        renderItem={(peer) => (
                          <List.Item
                            style={{ padding: '8px 4px', borderBlockEnd: '1px solid #f0f0f0' }}
                            actions={[
                              peer.added
                                ? <Tag color="green">{'已添加'}</Tag>
                                : <Button type="primary" size="small" onClick={() => handleAddFriend(peer)}>{'添加'}</Button>,
                            ]}
                          >
                            <List.Item.Meta
                              avatar={<span style={{ width: 8, height: 8, borderRadius: '50%', background: peer.online ? '#52c41a' : '#d9d9d9', display: 'inline-block', marginTop: 7 }} />}
                              title={<Space size={5}><Text>{peer.name || peer.host}</Text><Tag color={peer.online ? 'green' : 'default'} style={{ margin: 0, fontSize: 10 }}>{peer.online ? '在线' : '离线'}</Tag></Space>}
                              description={<Text type="secondary" style={{ fontSize: 11 }}>{peer.deviceName ? `${peer.deviceName} · ` : ''}{peer.host}:{peer.port}</Text>}
                            />
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'requests',
              label: (
                <Space size={4}>
                  {'好友请求'}
                  {pendingRequestCount > 0 && <Badge count={pendingRequestCount} size="small" />}
                </Space>
              ),
              children: (
                <div>
                  {friendRequests.filter(r => r.status === 'pending').length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'暂无待处理的好友请求'} />
                  ) : (
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      <List
                        size="small"
                        dataSource={friendRequests.filter(r => r.status === 'pending')}
                        renderItem={(req) => (
                          <List.Item
                            style={{ padding: '8px 4px', borderBlockEnd: '1px solid #f0f0f0' }}
                            actions={[
                              <Button key="accept" type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleAcceptRequest(req.id)}>{'接受'}</Button>,
                              <Button key="reject" size="small" danger icon={<CloseOutlined />} onClick={() => handleRejectRequest(req.id)}>{'拒绝'}</Button>,
                            ]}
                          >
                            <List.Item.Meta
                              title={<Text>{req.fromName}</Text>}
                              description={
                                <div>
                                  <Text type="secondary" style={{ fontSize: 11 }}>{req.fromDeviceName ? `${req.fromDeviceName} · ` : ''}{req.fromHost}:{req.fromPort}</Text>
                                  {req.message && <div><Text type="secondary" style={{ fontSize: 11 }}>{req.message}</Text></div>}
                                </div>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                  {friendRequests.filter(r => r.status !== 'pending').length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{'已处理的请求：'}</Text>
                      <List
                        size="small"
                        dataSource={friendRequests.filter(r => r.status !== 'pending')}
                        renderItem={(req) => (
                          <List.Item style={{ padding: '4px', borderBlockEnd: 'none' }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {req.fromName} · <Tag color={req.status === 'accepted' ? 'green' : 'default'} style={{ fontSize: 10 }}>{req.status === 'accepted' ? '已接受' : '已拒绝'}</Tag>
                            </Text>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
};

export default App;


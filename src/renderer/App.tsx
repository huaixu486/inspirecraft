import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Badge, Button, Empty, Input, List, Modal, Space, Tabs, Tag, Typography, message } from 'antd';
import {
  CalendarOutlined,
  FileTextOutlined,
  SettingOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  SearchOutlined,
  MessageOutlined,
  FolderOpenOutlined,
  QuestionCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import NotificationRuntime from './components/Runtime/NotificationRuntime';
import CollaborationRuntime from './components/Runtime/CollaborationRuntime';
import { useOverlayRuntime } from './components/Runtime/useOverlayRuntime';
import PageRouter from './components/Runtime/PageRouter';
import AppShell from './components/Runtime/AppShell';
import { useProjectStore } from './stores/projectStore';
import { useTemplateStore } from './stores/templateStore';
import { useTaskStore } from './stores/taskStore';
import { useSettingsStore } from './stores/settingsStore';
import { useProjectDocStore } from './stores/projectDocStore';
import { AppPage, useNavigationStore } from './stores/navigationStore';
import { useAIJobStore } from './stores/aiJobStore';
import { Project, WorkbenchPage } from '../shared/types';
import WorkbenchContextBar from './components/Workbench/WorkbenchContextBar';
import FriendChatWorkspace from './components/Collaboration/FriendChatWorkspace';
import ProjectQuickDrawer from './components/ProjectSwitcher/ProjectQuickDrawer';
import { openProjectSwitcher, useProjectPickerStore } from './stores/projectPickerStore';
import { useCollaborationRuntimeStore } from './stores/collaborationRuntimeStore';
import FirstUseGuide, { GuidePage, hasCompletedFirstUseGuide } from './components/Onboarding/FirstUseGuide';

const { Title, Text } = Typography;
const LazyCommandPalette = lazy(() => import('./components/CommandPalette/CommandPalette'));

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

type GlobalPage = AppPage;
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
  const globalPage = useNavigationStore(state => state.activePage);
  const setActivePage = useNavigationStore(state => state.setActivePage);
  const lastPage = useNavigationStore(state => state.lastPage);
  const capturePanelSession = useNavigationStore(state => state.capturePanelSession);
  const markPanelSessionAway = useNavigationStore(state => state.markPanelSessionAway);
  const beginPanelSessionRestore = useNavigationStore(state => state.beginPanelSessionRestore);
  const clearPanelSession = useNavigationStore(state => state.clearPanelSession);
  const activeFocus = useNavigationStore(state => state.activeFocus);
  const [panelInitialTab, setPanelInitialTab] = useState('overview');
  const [aiMessagesReadAt, setAiMessagesReadAt] = useState(() => Date.now());
  const {
    workspaceOpen: friendWorkspaceOpen, setWorkspaceOpen: setFriendWorkspaceOpen,
    friends, setFriends, addFriendOpen, setAddFriendOpen, friendRequests, setFriendRequests,
    emailSearch, setEmailSearch, emailSearchResult, setEmailSearchResult, emailSearching, setEmailSearching,
    chatFriend, setChatFriend, chatMessages, setChatMessages, chatDraft, setChatDraft,
    chatLoading, setChatLoading, chatSending, setChatSending, chatFileSending, setChatFileSending,
  } = useCollaborationRuntimeStore();
  const [bootDone, setBootDone] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [firstUseGuideOpen, setFirstUseGuideOpen] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const didInitialProjectRefreshRef = useRef(false);
  const pageNavTimersRef = useRef<number[]>([]);
  const pendingNotificationTargetRef = useRef<{
    targetPage: GlobalPage;
    projectId?: string;
  } | null>(null);
  const [pageNavAnim, setPageNavAnim] = useState<{
    phase: 'idle' | 'leaving' | 'entering' | 'pulse';
    direction: 'toOverview' | 'fromOverview';
  }>({ phase: 'idle', direction: 'toOverview' });
  const [fabDockExpanded, setFabDockExpanded] = useState(false);
  const fabDockTimerRef = useRef<number>(0);
  const projectPickerOpen = useProjectPickerStore(state => state.open);
  const aiJobs = useAIJobStore(state => state.jobs);

  useEffect(() => () => {
    if (fabDockTimerRef.current) window.clearTimeout(fabDockTimerRef.current);
  }, []);

  useEffect(() => {
    if (!bootDone || hasCompletedFirstUseGuide()) return undefined;
    const timer = window.setTimeout(() => setFirstUseGuideOpen(true), 650);
    return () => window.clearTimeout(timer);
  }, [bootDone]);

  // Ctrl+K / Cmd+K 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 使用细粒度 selector，避免 store 任意字段变化触发 App 重渲染
  const projects = useProjectStore(s => s.projects);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const loadVersions = useProjectStore(s => s.loadVersions);
  const currentProject = useProjectStore(s => s.currentProject);
  const setCurrentProject = useProjectStore(s => s.setCurrentProject);
  const setCurrentStageName = useProjectStore(s => s.setCurrentStageName);
  const setPendingReportDocId = useProjectStore(s => s.setPendingReportDocId);
  const setPendingReportDocOnly = useProjectStore(s => s.setPendingReportDocOnly);
  const loadTemplates = useTemplateStore(s => s.loadTemplates);
  const loadReviews = useTemplateStore(s => s.loadReviews);
  const loadTasks = useTaskStore(s => s.loadTasks);
  const loadSettings = useSettingsStore(s => s.loadSettings);
  const userProfile = useSettingsStore(s => s.userProfile);
  const loadProjectDocs = useProjectDocStore(s => s.loadProjectDocs);
  const projectDocs = useProjectDocStore(s => s.projectDocs);

  const refreshLanFriends = useCallback(async () => {
    const result = await window.electronAPI.listCollaborationFriends?.();
    if (result?.success) setFriends(result.friends || []);
  }, []);

  const refreshFriendRequests = useCallback(async () => {
    const result = await window.electronAPI.listFriendRequests?.();
    if (result?.success) setFriendRequests(result.requests || []);
  }, []);

  const hasCollaborationEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(userProfile?.email || '').trim());

  const openChat = useCallback(async (friend: CollaborationPeerInfo) => {
    setChatFriend(friend);
    setChatDraft('');
    setChatLoading(true);
    try {
      const result = await window.electronAPI.listCollaborationChatMessages?.(friend.id);
      setChatMessages(result?.success ? result.messages || [] : []);
      if (!result?.success) message.error(result?.error || '无法加载聊天记录');
    } finally {
      setChatLoading(false);
    }
  }, []);

  const sendChatMessage = useCallback(async () => {
    const content = chatDraft.trim();
    if (!chatFriend || !content) return;
    setChatSending(true);
    try {
      const result = await window.electronAPI.sendCollaborationChatMessage?.({ friendId: chatFriend.id, content });
      if (!result?.success || !result.message) {
        message.error(result?.error || '消息发送失败');
        return;
      }
      setChatMessages(prev => [...prev, result.message!]);
      setChatDraft('');
    } finally {
      setChatSending(false);
    }
  }, [chatDraft, chatFriend]);

  const sendChatAttachment = useCallback(async (filePath: string, isDirectory: boolean) => {
    if (!chatFriend) {
      message.warning('请先选择一位好友');
      return;
    }
    if (!chatFriend.online) {
      message.warning('好友当前离线，暂不能发送文件');
      return;
    }
    setChatFileSending(true);
    try {
      const result = await window.electronAPI.sendCollaborationFile?.({
        friendId: chatFriend.id,
        filePath,
        projectName: currentProject?.name,
        senderName: userProfile?.nickname || 'ProjectHub 用户',
      });
      if (!result?.success) {
        message.error(result?.error || '文件发送失败');
        return;
      }
      message.success(isDirectory ? '文件夹已发送给好友' : '文件已发送给好友');
    } finally {
      setChatFileSending(false);
    }
  }, [chatFriend, currentProject?.name, userProfile?.nickname]);

  const sendChatFile = useCallback(async () => {
    const filePath = await window.electronAPI.openFile([{ name: '所有文件', extensions: ['*'] }]);
    if (filePath) await sendChatAttachment(filePath, false);
  }, [sendChatAttachment]);

  const sendChatFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (folderPath) await sendChatAttachment(folderPath, true);
  }, [sendChatAttachment]);

  const shareCurrentProjectToChat = useCallback(async () => {
    if (!chatFriend) {
      message.warning('请先选择一位好友');
      return;
    }
    if (!currentProject) {
      message.info('请先进入一个项目后再分享项目进度');
      return;
    }
    if (!chatFriend.online) {
      message.warning('好友当前离线，暂不能分享项目');
      return;
    }
    const description = String(currentProject.description || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const content = `邀请你协作项目《${currentProject.name}》\n当前进度：${currentProject.progress || 0}%${description ? `\n项目概述：${description}` : ''}`;
    setChatSending(true);
    try {
      const result = await window.electronAPI.sendCollaborationChatMessage?.({ friendId: chatFriend.id, content });
      if (!result?.success || !result.message) {
        message.error(result?.error || '项目分享失败');
        return;
      }
      setChatMessages(prev => [...prev, result.message!]);
      message.success('项目进度已发送到会话');
    } finally {
      setChatSending(false);
    }
  }, [chatFriend, currentProject]);

  const searchFriendByEmail = useCallback(async () => {
    const email = emailSearch.trim();
    if (!email) return;
    setEmailSearching(true);
    setEmailSearchResult(null);
    try {
      const result = await window.electronAPI.searchCollaborationFriendByEmail?.(email);
      if (!result?.success) {
        message.error(result?.error || '搜索失败');
        return;
      }
      setEmailSearchResult(result.peer || null);
      if (!result.peer) message.info('未发现该邮箱对应的可用好友账户');
    } finally {
      setEmailSearching(false);
    }
  }, [emailSearch]);

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
    Promise.all([
      loadSettings(),
      loadProjects(),
    ]).then(() => {
      if (cancelled) return;
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`[Boot] 关键数据加载完成: ${elapsed}ms`);
      setBootDone(true);
    }).catch(err => {
      console.error('[Boot] 加载失败:', err);
      if (!cancelled) setBootDone(true);
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
  // 滚动条显示：滚动时立即出现；鼠标停留在可滚动容器内一段时间后出现。
  useEffect(() => {
    type ScrollbarState = {
      hoverTimer: number;
      scrollTimer: number;
      hovered: boolean;
    };

    const states = new WeakMap<HTMLElement, ScrollbarState>();
    const touched = new Set<HTMLElement>();
    let wheelRaf = 0;

    const getState = (el: HTMLElement): ScrollbarState => {
      let state = states.get(el);
      if (!state) {
        state = { hoverTimer: 0, scrollTimer: 0, hovered: false };
        states.set(el, state);
        touched.add(el);
      }
      return state;
    };

    const getPageScroller = () => {
      const scrollingElement = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
      return scrollingElement === document.body ? document.documentElement : scrollingElement;
    };

    const isScrollable = (el: HTMLElement) => {
      if (el === document.body) return false;
      const style = window.getComputedStyle(el);
      if (el === document.documentElement || el === document.scrollingElement) {
        const pageCanScrollY = !/(hidden|clip)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
        const pageCanScrollX = !/(hidden|clip)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
        return pageCanScrollY || pageCanScrollX;
      }
      const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
      const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
      return canScrollY || canScrollX;
    };

    const findScrollable = (target: EventTarget | null): HTMLElement | null => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== document.body) {
        if (isScrollable(el)) return el;
        el = el.parentElement;
      }
      const pageScroller = getPageScroller();
      return isScrollable(pageScroller) ? pageScroller : null;
    };

    const showScrollbar = (el: HTMLElement) => {
      el.classList.add('scrollbar-visible');
    };

    const hideScrollbarIfIdle = (el: HTMLElement) => {
      const state = getState(el);
      if (!state.hovered && !state.scrollTimer) {
        el.classList.remove('scrollbar-visible');
      }
    };

    const revealForScroll = (el: HTMLElement) => {
      const state = getState(el);
      el.classList.add('scrollbar-visible', 'scrolling');
      if (state.scrollTimer) window.clearTimeout(state.scrollTimer);
      state.scrollTimer = window.setTimeout(() => {
        state.scrollTimer = 0;
        el.classList.remove('scrolling');
        hideScrollbarIfIdle(el);
      }, 850);
    };

    const handleScroll = (event: Event) => {
      const el = event.target === document ? getPageScroller() : event.target instanceof HTMLElement ? event.target : null;
      if (!el || !isScrollable(el)) return;
      revealForScroll(el);
    };

    const handleWheel: EventListener = (event) => {
      if (wheelRaf) return;
      wheelRaf = window.requestAnimationFrame(() => {
        wheelRaf = 0;
        const el = findScrollable(event.target);
        if (el) revealForScroll(el);
      });
    };

    const handlePointerOver = (event: PointerEvent) => {
      const el = findScrollable(event.target);
      if (!el) return;

      const state = getState(el);
      if (state.hovered || state.hoverTimer) return;
      state.hoverTimer = window.setTimeout(() => {
        state.hoverTimer = 0;
        state.hovered = true;
        el.classList.add('scrollbar-hovered');
        showScrollbar(el);
      }, 350);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const el = findScrollable(event.target);
      if (!el) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && el.contains(nextTarget)) return;

      const state = getState(el);
      if (state.hoverTimer) {
        window.clearTimeout(state.hoverTimer);
        state.hoverTimer = 0;
      }
      state.hovered = false;
      el.classList.remove('scrollbar-hovered');
      hideScrollbarIfIdle(el);
    };

    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('wheel', handleWheel, { passive: true });
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);

    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      touched.forEach(el => {
        const state = states.get(el);
        if (state?.hoverTimer) window.clearTimeout(state.hoverTimer);
        if (state?.scrollTimer) window.clearTimeout(state.scrollTimer);
        if (el.classList) {
          el.classList.remove('scrollbar-visible', 'scrollbar-hovered');
        }
      });
      if (wheelRaf) window.cancelAnimationFrame(wheelRaf);
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

    // 从文件详情跳转到非主页时，结束侧窗会话，避免过期恢复。
    if (currentPage === 'project-files' && targetPage !== 'overview') {
      clearPanelSession();
    }

    // 立即切换页面，动画只是视觉过渡
    setActivePage(targetPage);
    setPageNavAnim({ phase: 'entering', direction });
    schedulePageNavTimer(() => {
      setPageNavAnim({ phase: 'idle', direction });
    }, 120);
  }, [clearPageNavTimers, clearPanelSession, globalPage, schedulePageNavTimer, setActivePage]);

  const navigateToOverview = useCallback(() => {
    const session = beginPanelSessionRestore();
    if (session && globalPage !== 'overview') {
      if (session.wasOpen && session.projectId) {
        const project = projects.find(p => p.id === session.projectId);
        setCurrentProject(project || null);
      } else {
        setCurrentProject(null);
      }
      clearPanelSession();
    }
    navigateToPage('overview');
  }, [beginPanelSessionRestore, clearPanelSession, globalPage, navigateToPage, projects, setCurrentProject]);

  const openProjectPanel = useCallback((project: Project, initialTab = 'overview', snapshot?: { wasOpen: boolean; projectId?: string } | null) => {
    setCurrentProject(project);
    if (initialTab === 'files') {
      if (snapshot !== undefined) {
        if (snapshot) capturePanelSession(snapshot);
        else clearPanelSession();
      }
      markPanelSessionAway();
      navigateToPage('project-files');
    } else {
      setPanelInitialTab(initialTab);
      navigateToOverview();
    }
  }, [capturePanelSession, clearPanelSession, markPanelSessionAway, navigateToOverview, navigateToPage, setCurrentProject]);

  const openProjectDetail = useCallback((page: ProjectDetailPage) => {
    const pageMap: Record<ProjectDetailPage, GlobalPage> = {
      files: 'project-files',
      plan: 'project-plan',
      team: 'project-team',
      templates: 'project-templates',
      report: 'project-report',
      review: 'project-review',
      writing: 'project-team',
    };
    navigateToPage(pageMap[page]);
  }, [navigateToPage]);

  const handleGuideNavigate = useCallback((page: GuidePage) => {
    const projectPages: GuidePage[] = ['project-files', 'project-plan', 'project-report', 'project-review', 'project-team'];
    if (projectPages.includes(page) && !currentProject) {
      const fallbackProject = projects[0];
      if (!fallbackProject) {
        navigateToPage('overview');
        return;
      }
      setCurrentProject(fallbackProject);
    }
    navigateToPage(page);
  }, [currentProject, navigateToPage, projects, setCurrentProject]);

  const handleLogoNavigate = useCallback(() => {
    const targetPage = globalPage === 'overview'
      ? lastPage
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
  }, [clearPageNavTimers, globalPage, lastPage, navigateToPage, schedulePageNavTimer]);


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
  }, [
    navigateToPage,
    projects,
    setCurrentProject,
  ]);

  // ─── 统一跳转上下文消费 ───────────────────────────────
  const { pendingFocus, consumePendingFocus } = useNavigationStore();

  // WorkbenchPage -> GlobalPage 映射
  const workbenchToGlobal = useCallback((target: WorkbenchPage): GlobalPage => {
    const map: Record<WorkbenchPage, GlobalPage> = {
      files: 'project-files',
      plan: 'project-plan',
      team: 'project-team',
      templates: 'project-templates',
      report: 'project-report',
      review: 'project-review',
      writing: 'project-team',
      calendar: 'calendar',
    };
    return map[target];
  }, []);

  // 消费 pendingFocus：设置项目 + 导航
  useEffect(() => {
    if (!pendingFocus) return;
    const project = projects.find(p => p.id === pendingFocus.projectId);
    if (!project) {
      void loadProjects({ silent: true });
      return;
    }
    if (pendingFocus.docId && !projectDocs.some(doc => doc.id === pendingFocus.docId)) {
      void loadProjectDocs();
      return;
    }
    if (project) {
      setCurrentProject(project);
      if (pendingFocus.stageName) setCurrentStageName(pendingFocus.stageName);
      if (pendingFocus.target === 'report' && pendingFocus.docId) {
        setPendingReportDocId(pendingFocus.docId);
        setPendingReportDocOnly(true);
      }
      navigateToPage(workbenchToGlobal(pendingFocus.target));
      consumePendingFocus();
    }
  }, [
    pendingFocus,
    projectDocs,
    projects,
    setCurrentProject,
    setCurrentStageName,
    setPendingReportDocId,
    setPendingReportDocOnly,
    navigateToPage,
    workbenchToGlobal,
    consumePendingFocus,
    loadProjects,
    loadProjectDocs,
  ]);

  const { reveal: overlayReveal, open: handleRevealOpen, close: handleRevealClose } = useOverlayRuntime(navigateToPage);

  const handleOpenSettings = useCallback((e: React.MouseEvent) => {
    handleRevealOpen('settings', e);
  }, [handleRevealOpen]);

  const handleCloseSettings = useCallback(() => {
    handleRevealClose();
  }, [handleRevealClose]);

  const handleOpenRecycleBin = useCallback((e: React.MouseEvent) => {
    handleRevealOpen('recycle-bin', e);
  }, [handleRevealOpen]);

  const handleCloseRecycleBin = useCallback(() => {
    handleRevealClose();
  }, [handleRevealClose]);

  const onlineFriendCount = friends.filter(friend => friend.online).length;
  const pendingRequestCount = friendRequests.filter(r => r.status === 'pending').length;
  const unreadAIMessageCount = aiJobs.filter(job => {
    if (job.status !== 'completed' && job.status !== 'failed') return false;
    const timestamp = new Date(job.finishedAt || job.updatedAt || job.createdAt).getTime();
    return Number.isFinite(timestamp) && timestamp > aiMessagesReadAt;
  }).length;

  const handleAddFriend = async (peer: CollaborationPeerInfo) => {
    const result = await window.electronAPI.sendFriendRequest?.({
      targetId: peer.id,
      targetHost: peer.host,
      targetPort: peer.port,
      message: `来自 ${userProfile?.nickname || 'ProjectHub 用户'} 的好友请求`,
    });
    if (result?.success) {
      message.success(`已向 ${peer.name || peer.host} 发送好友请求`);
      setEmailSearchResult(current => current?.id === peer.id ? { ...current, added: true } : current);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    const result = await window.electronAPI.removeCollaborationFriend?.(friendId);
    if (result?.success) {
      setFriends(result.friends || []);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    const result = await window.electronAPI.acceptFriendRequest?.(requestId);
    if (result?.success) {
      message.success('\u5df2\u63a5\u53d7\u597d\u53cb\u8bf7\u6c42');
      setFriends(result.friends || []);
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
    if (!hasCollaborationEmail) {
      message.warning('请先在设置 - 基础设置中填写有效邮箱，才能使用好友功能');
      navigateToPage('settings');
      return;
    }
    setAddFriendOpen(true);
    void refreshFriendRequests();
  };

  const pageTitleMap: Record<GlobalPage, string> = {
    overview: 'ProjectHub',
    calendar: '项目日历',
    settings: '设置',
    'recycle-bin': '回收站',
    'project-files': '文件详情',
    'project-plan': '\计\划\详\情',
    'project-team': '\团\队\协\同',
    'project-templates': '\模\板\管\理',
    'project-report': '\报\告\工\作\台',
    'project-review': '\审\查\工\作\台',
  };
  const title = pageTitleMap[globalPage];
  const subtitle = globalPage === 'overview' ? '\项\目\总\览' : currentProject?.name || '\全\局\工\具';

  return (
    <AppShell>
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

        <Space size={8} className="app-topbar-actions">
          <Button
            icon={<QuestionCircleOutlined />}
            title="功能引导"
            aria-label="功能引导"
            onClick={() => setFirstUseGuideOpen(true)}
          />
          <Badge count={onlineFriendCount + pendingRequestCount + unreadAIMessageCount} size="small" overflowCount={9} offset={[-1, 3]}>
            <Button
              icon={<MessageOutlined />}
              title="消息中心"
              aria-label="消息中心"
              onClick={() => {
                setFriendWorkspaceOpen(true);
                setAiMessagesReadAt(Date.now());
                void refreshLanFriends();
                void refreshFriendRequests();
              }}
            />
          </Badge>
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
            onMouseEnter={() => preloadModule('calendar', () => import('./components/Calendar/CalendarView'))}
            type={globalPage === 'calendar' ? 'primary' : 'default'}
            title={'日历'}
            aria-label={'日历'}
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
        {globalPage !== 'overview' && globalPage !== 'settings' && globalPage !== 'recycle-bin' && globalPage !== 'project-files' && (
          <WorkbenchContextBar globalPage={globalPage} onBack={navigateToOverview} />
        )}
        <ErrorBoundary>
          <div
            className="app-page-stack"
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              position: 'relative',
              overflow: 'hidden',
              marginTop: globalPage !== 'overview' && globalPage !== 'settings' && globalPage !== 'recycle-bin' && globalPage !== 'project-files' ? 14 : 0,
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
                <PageRouter page="overview" currentProject={currentProject} focus={activeFocus} fallback={<LazyPageFallback />} panelInitialTab={panelInitialTab} onBack={navigateToOverview} onCloseRecycleBin={handleCloseRecycleBin} onEnterProject={openProjectPanel} onOpenProjectDetail={openProjectDetail} />
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
                <PageRouter page={globalPage} currentProject={currentProject} focus={activeFocus} fallback={<LazyPageFallback />} panelInitialTab={panelInitialTab} onBack={navigateToOverview} onCloseRecycleBin={handleCloseRecycleBin} onEnterProject={openProjectPanel} onOpenProjectDetail={openProjectDetail} />
              </div>
            )}
          </div>
        </ErrorBoundary>
      </main>

      {/* 左下角浮动工具栏：悬停展开，移出收起 */}
      <div
        className={`app-fab-dock${fabDockExpanded ? ' app-fab-dock-expanded' : ''}${globalPage === 'settings' || globalPage === 'recycle-bin' || projectPickerOpen ? ' app-fab-dock-active' : ''}`}
        onMouseEnter={() => {
          if (fabDockTimerRef.current) window.clearTimeout(fabDockTimerRef.current);
          fabDockTimerRef.current = window.setTimeout(() => {
            fabDockTimerRef.current = 0;
            setFabDockExpanded(true);
          }, 280);
        }}
        onMouseLeave={() => {
          if (fabDockTimerRef.current) window.clearTimeout(fabDockTimerRef.current);
          fabDockTimerRef.current = window.setTimeout(() => {
            fabDockTimerRef.current = 0;
            setFabDockExpanded(false);
          }, 200);
        }}
      >
        <Button
          shape="circle"
          icon={<FolderOpenOutlined style={{ color: projectPickerOpen ? '#1677ff' : undefined }} />}
          type="default"
          onClick={openProjectSwitcher}
          title="项目切换"
          className={`app-settings-fab${projectPickerOpen ? ' app-settings-fab-active' : ''}`}
          style={{ borderColor: projectPickerOpen ? '#1677ff' : undefined }}
        />
        <Button
          shape="circle"
          icon={<DeleteOutlined style={{ color: globalPage === 'recycle-bin' ? '#1677ff' : undefined }} />}
          type="default"
          onClick={globalPage === 'recycle-bin' ? handleCloseRecycleBin : handleOpenRecycleBin}
          onMouseEnter={() => preloadModule('recycle-bin', () => import('./components/RecycleBin/RecycleBinView'))}
          title="回收站"
          className={`app-settings-fab${globalPage === 'recycle-bin' ? ' app-settings-fab-active' : ''}`}
          style={{
            borderColor: globalPage === 'recycle-bin' ? '#1677ff' : undefined,
            boxShadow: globalPage === 'recycle-bin' ? '0 0 0 3px rgba(22, 119, 255, 0.15)' : undefined,
          }}
        />
        <Button
          shape="circle"
          icon={<SettingOutlined style={{ color: globalPage === 'settings' ? '#1677ff' : undefined }} />}
          type="default"
          onClick={globalPage === 'settings' ? handleCloseSettings : handleOpenSettings}
          onMouseEnter={() => preloadModule('settings', () => import('./components/AISettings/AISettings'))}
          title="设置"
          className={`app-settings-fab${globalPage === 'settings' ? ' app-settings-fab-active' : ''}`}
          style={{
            borderColor: globalPage === 'settings' ? '#1677ff' : undefined,
            boxShadow: globalPage === 'settings' ? '0 0 0 3px rgba(22, 119, 255, 0.15)' : undefined,
          }}
        />
      </div>

      {/* 水膜展开遮罩 */}
      {overlayReveal.page && overlayReveal.phase !== 'idle' && (
        <div
          className={`global-reveal-layer${
            overlayReveal.phase === 'opening' ? ' is-opening' :
            overlayReveal.phase === 'fading' ? ' is-fading' : ''
          }${overlayReveal.phase === 'open' ? ' is-open' : ''}`}
          style={{
            '--reveal-x': `${overlayReveal.x}px`,
            '--reveal-y': `${overlayReveal.y}px`,
          } as React.CSSProperties}
        />
      )}

      {/* 添加好友：只保留邮箱搜索和请求处理，不再提供局域网扫描入口 */}
      <Modal
        title={'添加好友'}
        open={addFriendOpen}
        onCancel={() => setAddFriendOpen(false)}
        footer={null}
        width={420}
        destroyOnClose
      >
        <Tabs
          defaultActiveKey="email"
          items={[
            {
              key: 'email',
              label: '邮箱搜索',
              children: (
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>输入对方邮箱搜索可添加的好友账户。</Text>
                  <Input.Search
                    value={emailSearch}
                    onChange={(event) => setEmailSearch(event.target.value)}
                    onSearch={() => void searchFriendByEmail()}
                    placeholder="输入好友邮箱"
                    enterButton={<SearchOutlined />}
                    loading={emailSearching}
                  />
                  {emailSearchResult && (
                    <List
                      size="small"
                      style={{ marginTop: 12 }}
                      dataSource={[emailSearchResult]}
                      renderItem={(peer) => (
                        <List.Item actions={[peer.added ? <Tag color="green">已添加</Tag> : <Button type="primary" size="small" onClick={() => handleAddFriend(peer)}>添加</Button>]}>
                          <List.Item.Meta
                            avatar={<Badge dot color={peer.online ? '#52c41a' : '#bfbfbf'} offset={[-1, 27]}><Avatar src={peer.avatar} icon={!peer.avatar ? <UserOutlined /> : undefined} /></Badge>}
                            title={<Space size={5}><Text>{peer.name || peer.host}</Text><Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{peer.email}</Tag></Space>}
                            description={<Text type="secondary" style={{ fontSize: 11 }}>{peer.deviceName ? `${peer.deviceName} · ` : ''}{peer.host}:{peer.port}</Text>}
                          />
                        </List.Item>
                      )}
                    />
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
                              avatar={<Avatar src={req.fromAvatar} icon={!req.fromAvatar ? <UserOutlined /> : undefined} />}
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

      {/* 保留系统与 AI 的后台通知、Windows 推送和状态同步；展示已并入消息中心。 */}
      <NotificationRuntime onOpenTarget={handleOpenNotificationTarget} />
      <CollaborationRuntime />

      <ProjectQuickDrawer onOpenProjectFiles={project => openProjectPanel(project, 'files')} />

      <FriendChatWorkspace
        open={friendWorkspaceOpen}
        friends={friends}
        selectedFriend={chatFriend}
        messages={chatMessages}
        loadingMessages={chatLoading}
        draft={chatDraft}
        sending={chatSending}
        sendingFile={chatFileSending}
        pendingRequestCount={pendingRequestCount}
        onClose={() => setFriendWorkspaceOpen(false)}
        onSelectFriend={(friend) => void openChat(friend)}
        onDraftChange={setChatDraft}
        onSendMessage={() => void sendChatMessage()}
        onSendFile={() => void sendChatFile()}
        onSendFolder={() => void sendChatFolder()}
        onShareProject={() => void shareCurrentProjectToChat()}
        onOpenAddFriend={openAddFriendModal}
        onRefresh={() => {
          void refreshLanFriends();
          void refreshFriendRequests();
        }}
        onRemoveFriend={(friendId) => void handleRemoveFriend(friendId)}
        onOpenSystemTarget={handleOpenNotificationTarget}
      />

      {/* Ctrl+K 命令面板 */}
      <LazyCommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={(page) => navigateToPage(page as any)}
        onOverviewAction={(action) => useNavigationStore.getState().triggerOverviewAction(action as any)}
      />
      <FirstUseGuide
        open={firstUseGuideOpen}
        activePage={globalPage as GuidePage}
        hasProject={projects.length > 0}
        onClose={() => setFirstUseGuideOpen(false)}
        onNavigate={handleGuideNavigate}
      />
    </AppShell>
  );
};

export default App;


import { create } from 'zustand';
import { WorkbenchFocus } from '../../shared/types';

export type AppPage =
  | 'overview'
  | 'calendar'
  | 'settings'
  | 'recycle-bin'
  | 'project-files'
  | 'project-plan'
  | 'project-team'
  | 'project-templates'
  | 'project-report'
  | 'project-review';

export interface PanelSession {
  wasOpen: boolean;
  projectId?: string;
  phase: 'captured' | 'away' | 'restoring';
}

// ─── 统一跳转 Store ─────────────────────────────────────
// 所有页面间跳转通过 focus 对象传递上下文。
// 消费方（App.tsx）监听 pendingFocus 变化后执行实际导航并清除。

export type OverviewAction = 'create-project' | null;

interface NavigationState {
  /** 当前激活的页面 */
  activePage: AppPage;
  /** 待处理的跳转请求（App.tsx 监听并消费） */
  pendingFocus: WorkbenchFocus | null;
  activeFocus: WorkbenchFocus | null;
  /** 最近一次非 overview 页面（用于 logo 回跳） */
  lastPage: AppPage | null;
  panelSession: PanelSession | null;
  /** 一次性 overview 动作（命令面板触发，ProjectTable 消费） */
  overviewAction: OverviewAction;

  /** 发起跳转 — 设置 pendingFocus，App.tsx 会响应 */
  navigate: (focus: WorkbenchFocus) => void;
  /** 直接切页面（无上下文，仅 overview/settings 用） */
  setActivePage: (page: AppPage) => void;
  /** App.tsx 消费 pendingFocus 后调用 */
  consumePendingFocus: () => void;
  acknowledgeActiveFocus: () => void;
  capturePanelSession: (snapshot: Omit<PanelSession, 'phase'>) => void;
  markPanelSessionAway: () => void;
  beginPanelSessionRestore: () => PanelSession | null;
  clearPanelSession: () => void;
  /** 触发一次性 overview 动作 */
  triggerOverviewAction: (action: OverviewAction) => void;
  /** 消费 overview 动作 */
  consumeOverviewAction: () => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  activePage: 'overview',
  pendingFocus: null,
  activeFocus: null,
  lastPage: null,
  panelSession: null,
  overviewAction: null,

  navigate: (focus) => {
    set({
      pendingFocus: focus,
    });
  },

  setActivePage: (page) => {
    set({
      activePage: page,
      lastPage: page !== 'overview' && page !== 'settings' && page !== 'recycle-bin' ? page : get().lastPage,
    });
  },

  consumePendingFocus: () => {
    set(state => ({ activeFocus: state.pendingFocus, pendingFocus: null }));
  },
  acknowledgeActiveFocus: () => set({ activeFocus: null }),

  capturePanelSession: (snapshot) => set({ panelSession: { ...snapshot, phase: 'captured' } }),
  markPanelSessionAway: () => set(state => ({ panelSession: state.panelSession ? { ...state.panelSession, phase: 'away' } : null })),
  beginPanelSessionRestore: () => {
    const session = get().panelSession;
    if (!session) return null;
    set({ panelSession: { ...session, phase: 'restoring' } });
    return session;
  },
  clearPanelSession: () => set({ panelSession: null }),

  triggerOverviewAction: (action) => {
    set({ overviewAction: action });
  },

  consumeOverviewAction: () => {
    set({ overviewAction: null });
  },
}));

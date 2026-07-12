import { create } from 'zustand';
import { WorkbenchFocus, WorkbenchPage } from '../../shared/types';

// ─── 统一跳转 Store ─────────────────────────────────────
// 所有页面间跳转通过 focus 对象传递上下文。
// 消费方（App.tsx）监听 pendingFocus 变化后执行实际导航并清除。

export type OverviewAction = 'create-project' | null;

interface NavigationState {
  /** 当前激活的页面 */
  activePage: WorkbenchPage | 'overview' | 'settings';
  /** 待处理的跳转请求（App.tsx 监听并消费） */
  pendingFocus: WorkbenchFocus | null;
  /** 最近一次非 overview 页面（用于 logo 回跳） */
  lastPage: WorkbenchPage | null;
  /** 一次性 overview 动作（命令面板触发，ProjectTable 消费） */
  overviewAction: OverviewAction;

  /** 发起跳转 — 设置 pendingFocus，App.tsx 会响应 */
  navigate: (focus: WorkbenchFocus) => void;
  /** 直接切页面（无上下文，仅 overview/settings 用） */
  setActivePage: (page: WorkbenchPage | 'overview' | 'settings') => void;
  /** App.tsx 消费 pendingFocus 后调用 */
  consumePendingFocus: () => void;
  /** 触发一次性 overview 动作 */
  triggerOverviewAction: (action: OverviewAction) => void;
  /** 消费 overview 动作 */
  consumeOverviewAction: () => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  activePage: 'overview',
  pendingFocus: null,
  lastPage: null,
  overviewAction: null,

  navigate: (focus) => {
    set({
      pendingFocus: focus,
      lastPage: focus.target,
    });
  },

  setActivePage: (page) => {
    set({
      activePage: page,
      lastPage: page !== 'overview' && page !== 'settings' ? page as WorkbenchPage : get().lastPage,
    });
  },

  consumePendingFocus: () => {
    set({ pendingFocus: null });
  },

  triggerOverviewAction: (action) => {
    set({ overviewAction: action });
  },

  consumeOverviewAction: () => {
    set({ overviewAction: null });
  },
}));

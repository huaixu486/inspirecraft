import { create } from 'zustand';
import { AppSettings, UserProfile } from '../../shared/types';

interface SettingsState {
  workspacePath: string;
  workspaceCapacity: number; // GB
  workspaceUsedBytes: number;
  userProfile: UserProfile | null;
  isLoading: boolean;

  loadSettings: () => Promise<void>;
  updateWorkspacePath: (path: string) => Promise<void>;
  updateWorkspaceCapacity: (gb: number) => Promise<void>;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  refreshWorkspaceUsed: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  workspacePath: '',
  workspaceCapacity: 10,
  workspaceUsedBytes: 0,
  userProfile: null,
  isLoading: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const settings = await window.electronAPI.loadSettings();
      if (settings) {
        set({
          workspacePath: settings.workspacePath,
          workspaceCapacity: settings.workspaceCapacity ?? 10,
          userProfile: settings.userProfile ?? null,
          isLoading: false,
        });
        // 加载已用空间
        get().refreshWorkspaceUsed();
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ isLoading: false });
    }
  },

  updateWorkspacePath: async (path: string) => {
    const { workspaceCapacity, userProfile } = get();
    set({ workspacePath: path });
    try {
      await window.electronAPI.saveSettings({ workspacePath: path, workspaceCapacity, userProfile });
      get().refreshWorkspaceUsed();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  },

  updateWorkspaceCapacity: async (gb: number) => {
    const { workspacePath, userProfile } = get();
    set({ workspaceCapacity: gb });
    try {
      await window.electronAPI.saveSettings({ workspacePath, workspaceCapacity: gb, userProfile });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  },

  updateUserProfile: async (profile: UserProfile) => {
    const { workspacePath, workspaceCapacity } = get();
    set({ userProfile: profile });
    try {
      await window.electronAPI.saveSettings({ workspacePath, workspaceCapacity, userProfile: profile });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  },

  refreshWorkspaceUsed: async () => {
    const { workspacePath } = get();
    if (!workspacePath) return;
    try {
      const result = await window.electronAPI.getWorkspaceSize(workspacePath);
      if (result.success) {
        set({ workspaceUsedBytes: result.bytes });
      }
    } catch (error) {
      console.error('Failed to get workspace size:', error);
    }
  },
}));

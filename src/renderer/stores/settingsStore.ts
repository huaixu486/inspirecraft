import { create } from 'zustand';
import { AppSettings, StageConfig, UserProfile } from '../../shared/types';
import { DEFAULT_STAGES } from '../utils/timelineStages';

interface SettingsState {
  workspacePath: string;
  workspaceCapacity: number; // GB
  workspaceUsedBytes: number;
  userProfile: UserProfile | null;
  customStages: StageConfig[];
  isLoading: boolean;

  loadSettings: () => Promise<void>;
  updateWorkspacePath: (path: string) => Promise<void>;
  updateWorkspaceCapacity: (gb: number) => Promise<void>;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  refreshWorkspaceUsed: () => Promise<void>;
  addStage: (stage: StageConfig) => Promise<void>;
  updateStage: (id: string, updates: Partial<StageConfig>) => Promise<void>;
  deleteStage: (id: string) => Promise<void>;
  saveAllStages: (stages: StageConfig[]) => Promise<void>;
}

const saveSettings = async (settings: AppSettings) => {
  await window.electronAPI.saveSettings(settings);
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  workspacePath: '',
  workspaceCapacity: 10,
  workspaceUsedBytes: 0,
  userProfile: null,
  customStages: [],
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
          customStages: settings.customStages ?? [],
          isLoading: false,
        });
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
    const { workspaceCapacity, userProfile, customStages } = get();
    set({ workspacePath: path });
    try {
      await saveSettings({ workspacePath: path, workspaceCapacity, userProfile: userProfile ?? undefined, customStages });
      get().refreshWorkspaceUsed();
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  },

  updateWorkspaceCapacity: async (gb: number) => {
    const { workspacePath, userProfile, customStages } = get();
    set({ workspaceCapacity: gb });
    try {
      await saveSettings({ workspacePath, workspaceCapacity: gb, userProfile: userProfile ?? undefined, customStages });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  },

  updateUserProfile: async (profile: UserProfile) => {
    const { workspacePath, workspaceCapacity, customStages } = get();
    set({ userProfile: profile });
    try {
      await saveSettings({ workspacePath, workspaceCapacity, userProfile: profile, customStages });
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

  addStage: async (stage: StageConfig) => {
    const { customStages, workspacePath, workspaceCapacity, userProfile } = get();
    const updated = [...customStages, stage];
    set({ customStages: updated });
    await saveSettings({ workspacePath, workspaceCapacity, userProfile: userProfile ?? undefined, customStages: updated });
  },

  updateStage: async (id: string, updates: Partial<StageConfig>) => {
    const { customStages, workspacePath, workspaceCapacity, userProfile } = get();
    const existing = customStages.find(s => s.id === id);
    let updated: StageConfig[];
    if (existing) {
      updated = customStages.map(s => s.id === id ? { ...s, ...updates } : s);
    } else {
      // 系统阶段编辑时，添加覆盖到customStages
      const sysStage = DEFAULT_STAGES.find(s => s.id === id);
      if (sysStage) {
        updated = [...customStages, { ...sysStage, ...updates }];
      } else {
        updated = customStages;
      }
    }
    set({ customStages: updated });
    await saveSettings({ workspacePath, workspaceCapacity, userProfile: userProfile ?? undefined, customStages: updated });
  },

  deleteStage: async (id: string) => {
    const { customStages, workspacePath, workspaceCapacity, userProfile } = get();
    const updated = customStages.filter(s => s.id !== id);
    set({ customStages: updated });
    await saveSettings({ workspacePath, workspaceCapacity, userProfile: userProfile ?? undefined, customStages: updated });
  },

  saveAllStages: async (stages: StageConfig[]) => {
    const { workspacePath, workspaceCapacity, userProfile } = get();
    set({ customStages: stages });
    await saveSettings({ workspacePath, workspaceCapacity, userProfile: userProfile ?? undefined, customStages: stages });
  },
}));

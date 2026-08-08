import { create } from 'zustand';
import {
  AppSettings,
  AppKeyboardShortcuts,
  AppShortcutAction,
  CalendarDayRecord,
  CalendarItinerary,
  CompositionWeightConfig,
  HolidayDataSource,
  StageConfig,
  UserProfile,
} from '../../shared/types';
import { DEFAULT_STAGES } from '../utils/timelineStages';
import { DEFAULT_KEYBOARD_SHORTCUTS, normalizeKeyboardShortcuts, normalizeKeyboardShortcut } from '../utils/keyboardShortcuts';
import { assertIpcMutationSucceeded, requireIpcObject } from '../utils/ipcResult';

interface SettingsState {
  workspacePath: string;
  workspaceCapacity: number;
  recycleBinRetentionDays: number;
  workspaceUsedBytes: number;
  userProfile: UserProfile | null;
  customStages: StageConfig[];
  compositionWeights: CompositionWeightConfig | null;
  compositionWeightsByScene: Partial<Record<import('../../shared/types').PromptScene, CompositionWeightConfig>>;
  enableSystemNotifications: boolean;
  autoLaunchEnabled: boolean;
  autoProjectDescriptionEnabled: boolean;
  autoStageMemoryEnabled: boolean;
  holidayDataSource: HolidayDataSource;
  holidayApiUrl: string;
  calendarDayRecords: CalendarDayRecord[];
  calendarItineraries: CalendarItinerary[];
  keyboardShortcuts: AppKeyboardShortcuts;
  isLoading: boolean;

  loadSettings: () => Promise<void>;
  updateWorkspacePath: (path: string) => Promise<void>;
  updateWorkspaceCapacity: (gb: number) => Promise<void>;
  updateRecycleBinRetentionDays: (days: number) => Promise<void>;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  updateSystemNotifications: (enabled: boolean) => Promise<void>;
  updateAutoLaunchEnabled: (enabled: boolean) => Promise<void>;
  updateAutoProjectDescriptionEnabled: (enabled: boolean) => Promise<void>;
  updateAutoStageMemoryEnabled: (enabled: boolean) => Promise<void>;
  updateHolidaySettings: (settings: { source?: HolidayDataSource; apiUrl?: string }) => Promise<void>;
  updateCalendarDayRecords: (records: CalendarDayRecord[]) => Promise<void>;
  updateCalendarItineraries: (itineraries: CalendarItinerary[]) => Promise<void>;
  updateCalendarItineraryById: (id: string, updates: Partial<CalendarItinerary>) => Promise<void>;
  updateKeyboardShortcut: (action: AppShortcutAction, shortcut: string) => Promise<void>;
  updateCompositionWeights: (weights: CompositionWeightConfig | null) => Promise<void>;
  updateCompositionWeightsForScene: (scene: import('../../shared/types').PromptScene, weights: CompositionWeightConfig | null) => Promise<void>;
  refreshWorkspaceUsed: () => Promise<void>;
  addStage: (stage: StageConfig) => Promise<void>;
  updateStage: (id: string, updates: Partial<StageConfig>) => Promise<void>;
  deleteStage: (id: string) => Promise<void>;
  saveAllStages: (stages: StageConfig[]) => Promise<void>;
}

const saveSettings = async (settings: AppSettings) => {
  const result = await window.electronAPI.saveSettings(settings);
  assertIpcMutationSucceeded(result, '保存设置失败');
};

function buildSettingsSnapshot(state: SettingsState, overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    workspacePath: state.workspacePath,
    workspaceCapacity: state.workspaceCapacity,
    recycleBinRetentionDays: state.recycleBinRetentionDays,
    userProfile: state.userProfile ?? undefined,
    customStages: state.customStages,
    compositionWeights: state.compositionWeights ?? undefined,
    compositionWeightsByScene: state.compositionWeightsByScene,
    enableSystemNotifications: state.enableSystemNotifications,
    autoLaunchEnabled: state.autoLaunchEnabled,
    autoProjectDescriptionEnabled: state.autoProjectDescriptionEnabled,
    autoStageMemoryEnabled: state.autoStageMemoryEnabled,
    holidayDataSource: state.holidayDataSource,
    holidayApiUrl: state.holidayApiUrl,
    calendarDayRecords: state.calendarDayRecords,
    calendarItineraries: state.calendarItineraries,
    keyboardShortcuts: state.keyboardShortcuts,
    ...overrides,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  workspacePath: '',
  workspaceCapacity: 10,
  recycleBinRetentionDays: 30,
  workspaceUsedBytes: 0,
  userProfile: null,
  customStages: [],
  compositionWeights: null,
  compositionWeightsByScene: {},
  enableSystemNotifications: true,
  autoLaunchEnabled: false,
  autoProjectDescriptionEnabled: true,
  autoStageMemoryEnabled: true,
  holidayDataSource: 'auto',
  holidayApiUrl: 'https://timor.tech/api/holiday/year/{year}',
  calendarDayRecords: [],
  calendarItineraries: [],
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  isLoading: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const [settingsValue, autoLaunchStatus] = await Promise.all([
        window.electronAPI.loadSettings(),
        window.electronAPI.getAutoLaunch(),
      ]);
      const settings = requireIpcObject<AppSettings>(settingsValue, '加载设置失败');
      if (settings) {
        set({
          workspacePath: settings.workspacePath,
          workspaceCapacity: settings.workspaceCapacity ?? 10,
          recycleBinRetentionDays: Math.min(365, Math.max(1, settings.recycleBinRetentionDays ?? 30)),
          userProfile: settings.userProfile ?? null,
          customStages: settings.customStages ?? [],
          compositionWeights: settings.compositionWeights ?? null,
          compositionWeightsByScene: settings.compositionWeightsByScene ?? {},
          enableSystemNotifications: settings.enableSystemNotifications !== false,
          autoLaunchEnabled: autoLaunchStatus.success
            ? autoLaunchStatus.enabled
            : settings.autoLaunchEnabled === true,
          autoProjectDescriptionEnabled: settings.autoProjectDescriptionEnabled !== false,
          autoStageMemoryEnabled: settings.autoStageMemoryEnabled !== false,
          holidayDataSource: settings.holidayDataSource || 'auto',
          holidayApiUrl: settings.holidayApiUrl || 'https://timor.tech/api/holiday/year/{year}',
          calendarDayRecords: settings.calendarDayRecords || [],
          calendarItineraries: settings.calendarItineraries || [],
          keyboardShortcuts: normalizeKeyboardShortcuts(settings.keyboardShortcuts),
          isLoading: false,
        });
        // 异步计算工作区大小，不阻塞设置加载
        void get().refreshWorkspaceUsed();
        void window.electronAPI.cleanupRecycleBin?.({ workspacePath: settings.workspacePath });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ isLoading: false });
    }
  },

  updateWorkspacePath: async (path: string) => {
    const prevPath = get().workspacePath;
    set({ workspacePath: path });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { workspacePath: path }));
      get().refreshWorkspaceUsed();
    } catch (error) {
      console.error('Failed to save settings:', error);
      set({ workspacePath: prevPath });
    }
  },

  updateWorkspaceCapacity: async (gb: number) => {
    const prevCap = get().workspaceCapacity;
    set({ workspaceCapacity: gb });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { workspaceCapacity: gb }));
    } catch (error) {
      console.error('Failed to save settings:', error);
      set({ workspaceCapacity: prevCap });
    }
  },

  updateRecycleBinRetentionDays: async (days: number) => {
    const previous = get().recycleBinRetentionDays;
    const next = Math.min(365, Math.max(1, Math.round(days || 30)));
    set({ recycleBinRetentionDays: next });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { recycleBinRetentionDays: next }));
      await window.electronAPI.cleanupRecycleBin?.({ workspacePath: get().workspacePath });
    } catch (error) {
      console.error('Failed to save recycle bin retention:', error);
      set({ recycleBinRetentionDays: previous });
    }
  },

  updateUserProfile: async (profile: UserProfile) => {
    const prevProfile = get().userProfile;
    set({ userProfile: profile });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { userProfile: profile }));
    } catch (error) {
      console.error('Failed to save settings:', error);
      set({ userProfile: prevProfile });
      throw error;
    }
  },

  updateSystemNotifications: async (enabled: boolean) => {
    const prevEnabled = get().enableSystemNotifications;
    set({ enableSystemNotifications: enabled });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { enableSystemNotifications: enabled }));
    } catch (error) {
      console.error('Failed to save settings:', error);
      set({ enableSystemNotifications: prevEnabled });
    }
  },

  updateAutoLaunchEnabled: async (enabled: boolean) => {
    const previous = get().autoLaunchEnabled;
    set({ autoLaunchEnabled: enabled });
    try {
      const result = await window.electronAPI.setAutoLaunch(enabled);
      if (!result.success || result.enabled !== enabled) {
        throw new Error(result.error || 'Windows 未能更新启动项');
      }
      await saveSettings(buildSettingsSnapshot(get(), { autoLaunchEnabled: enabled }));
    } catch (error) {
      set({ autoLaunchEnabled: previous });
      try { await window.electronAPI.setAutoLaunch(previous); } catch {}
      throw error;
    }
  },

  updateAutoProjectDescriptionEnabled: async (enabled: boolean) => {
    const previous = get().autoProjectDescriptionEnabled;
    set({ autoProjectDescriptionEnabled: enabled });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { autoProjectDescriptionEnabled: enabled }));
    } catch (error) {
      console.error('Failed to save auto project description setting:', error);
      set({ autoProjectDescriptionEnabled: previous });
    }
  },

  updateAutoStageMemoryEnabled: async (enabled: boolean) => {
    const previous = get().autoStageMemoryEnabled;
    set({ autoStageMemoryEnabled: enabled });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { autoStageMemoryEnabled: enabled }));
    } catch (error) {
      console.error('Failed to save automatic stage memory setting:', error);
      set({ autoStageMemoryEnabled: previous });
    }
  },

  updateHolidaySettings: async ({ source, apiUrl }) => {
    const prevSource = get().holidayDataSource;
    const prevApiUrl = get().holidayApiUrl;
    const nextSource = source || prevSource || 'auto';
    const nextApiUrl = apiUrl !== undefined ? apiUrl : prevApiUrl;
    set({ holidayDataSource: nextSource, holidayApiUrl: nextApiUrl });
    try {
      await saveSettings(buildSettingsSnapshot(get(), {
        holidayDataSource: nextSource,
        holidayApiUrl: nextApiUrl,
      }));
    } catch (error) {
      console.error('Failed to save holiday settings:', error);
      set({ holidayDataSource: prevSource, holidayApiUrl: prevApiUrl });
    }
  },

  updateCalendarDayRecords: async (records) => {
    const previous = get().calendarDayRecords;
    set({ calendarDayRecords: records });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { calendarDayRecords: records }));
    } catch (error) {
      console.error('Failed to save calendar day records:', error);
      set({ calendarDayRecords: previous });
    }
  },

  updateCalendarItineraries: async (itineraries) => {
    const previous = get().calendarItineraries;
    set({ calendarItineraries: itineraries });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { calendarItineraries: itineraries }));
    } catch (error) {
      console.error('Failed to save calendar itineraries:', error);
      set({ calendarItineraries: previous });
    }
  },

  updateCalendarItineraryById: async (id, updates) => {
    const previous = get().calendarItineraries;
    const next = previous.map(item => item.id === id ? { ...item, ...updates } : item);
    set({ calendarItineraries: next });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { calendarItineraries: next }));
    } catch (error) {
      console.error('Failed to update calendar itinerary:', error);
      set({ calendarItineraries: previous });
    }
  },

  updateKeyboardShortcut: async (action, shortcut) => {
    const previous = get().keyboardShortcuts;
    const normalized = normalizeKeyboardShortcut(shortcut);
    const next = { ...previous, [action]: normalized };
    set({ keyboardShortcuts: next });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { keyboardShortcuts: next }));
    } catch (error) {
      console.error('Failed to save keyboard shortcut:', error);
      set({ keyboardShortcuts: previous });
      throw error;
    }
  },

  updateCompositionWeights: async (weights: CompositionWeightConfig | null) => {
    const prevWeights = get().compositionWeights;
    set({ compositionWeights: weights });
    try {
      await saveSettings(buildSettingsSnapshot(get(), {
        compositionWeights: weights ?? undefined,
      }));
    } catch (error) {
      console.error('Failed to save composition weights:', error);
      set({ compositionWeights: prevWeights });
    }
  },

  updateCompositionWeightsForScene: async (scene, weights) => {
    const previous = get().compositionWeightsByScene;
    const next = { ...previous };
    if (weights) next[scene] = weights;
    else delete next[scene];
    set({ compositionWeightsByScene: next });
    try {
      await saveSettings(buildSettingsSnapshot(get(), { compositionWeightsByScene: next }));
    } catch (error) {
      console.error('Failed to save scene composition weights:', error);
      set({ compositionWeightsByScene: previous });
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
    const updated = [...get().customStages, stage];
    set({ customStages: updated });
    await saveSettings(buildSettingsSnapshot(get(), { customStages: updated }));
  },

  updateStage: async (id: string, updates: Partial<StageConfig>) => {
    const { customStages } = get();
    const existing = customStages.find(stage => stage.id === id);
    let updated: StageConfig[];
    if (existing) {
      updated = customStages.map(stage => (stage.id === id ? { ...stage, ...updates } : stage));
    } else {
      const sysStage = DEFAULT_STAGES.find(stage => stage.id === id);
      updated = sysStage ? [...customStages, { ...sysStage, ...updates }] : customStages;
    }
    set({ customStages: updated });
    await saveSettings(buildSettingsSnapshot(get(), { customStages: updated }));
  },

  deleteStage: async (id: string) => {
    const updated = get().customStages.filter(stage => stage.id !== id);
    set({ customStages: updated });
    await saveSettings(buildSettingsSnapshot(get(), { customStages: updated }));
  },

  saveAllStages: async (stages: StageConfig[]) => {
    set({ customStages: stages });
    await saveSettings(buildSettingsSnapshot(get(), { customStages: stages }));
  },
}));

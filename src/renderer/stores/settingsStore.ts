import { create } from 'zustand';
import {
  AppSettings,
  CalendarDayRecord,
  CalendarItinerary,
  CompositionWeightConfig,
  HolidayDataSource,
  StageConfig,
  UserProfile,
} from '../../shared/types';
import { DEFAULT_STAGES } from '../utils/timelineStages';

interface SettingsState {
  workspacePath: string;
  workspaceCapacity: number;
  recycleBinRetentionDays: number;
  workspaceUsedBytes: number;
  userProfile: UserProfile | null;
  customStages: StageConfig[];
  compositionWeights: CompositionWeightConfig | null;
  enableSystemNotifications: boolean;
  autoProjectDescriptionEnabled: boolean;
  holidayDataSource: HolidayDataSource;
  holidayApiUrl: string;
  calendarDayRecords: CalendarDayRecord[];
  calendarItineraries: CalendarItinerary[];
  isLoading: boolean;

  loadSettings: () => Promise<void>;
  updateWorkspacePath: (path: string) => Promise<void>;
  updateWorkspaceCapacity: (gb: number) => Promise<void>;
  updateRecycleBinRetentionDays: (days: number) => Promise<void>;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  updateSystemNotifications: (enabled: boolean) => Promise<void>;
  updateAutoProjectDescriptionEnabled: (enabled: boolean) => Promise<void>;
  updateHolidaySettings: (settings: { source?: HolidayDataSource; apiUrl?: string }) => Promise<void>;
  updateCalendarDayRecords: (records: CalendarDayRecord[]) => Promise<void>;
  updateCalendarItineraries: (itineraries: CalendarItinerary[]) => Promise<void>;
  updateCalendarItineraryById: (id: string, updates: Partial<CalendarItinerary>) => Promise<void>;
  updateCompositionWeights: (weights: CompositionWeightConfig | null) => Promise<void>;
  refreshWorkspaceUsed: () => Promise<void>;
  addStage: (stage: StageConfig) => Promise<void>;
  updateStage: (id: string, updates: Partial<StageConfig>) => Promise<void>;
  deleteStage: (id: string) => Promise<void>;
  saveAllStages: (stages: StageConfig[]) => Promise<void>;
}

const saveSettings = async (settings: AppSettings) => {
  await window.electronAPI.saveSettings(settings);
};

function buildSettingsSnapshot(state: SettingsState, overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    workspacePath: state.workspacePath,
    workspaceCapacity: state.workspaceCapacity,
    recycleBinRetentionDays: state.recycleBinRetentionDays,
    userProfile: state.userProfile ?? undefined,
    customStages: state.customStages,
    compositionWeights: state.compositionWeights ?? undefined,
    enableSystemNotifications: state.enableSystemNotifications,
    autoProjectDescriptionEnabled: state.autoProjectDescriptionEnabled,
    holidayDataSource: state.holidayDataSource,
    holidayApiUrl: state.holidayApiUrl,
    calendarDayRecords: state.calendarDayRecords,
    calendarItineraries: state.calendarItineraries,
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
  enableSystemNotifications: true,
  autoProjectDescriptionEnabled: true,
  holidayDataSource: 'auto',
  holidayApiUrl: 'https://timor.tech/api/holiday/year/{year}',
  calendarDayRecords: [],
  calendarItineraries: [],
  isLoading: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const settings = await window.electronAPI.loadSettings();
      if (settings) {
        set({
          workspacePath: settings.workspacePath,
          workspaceCapacity: settings.workspaceCapacity ?? 10,
          recycleBinRetentionDays: Math.min(365, Math.max(1, settings.recycleBinRetentionDays ?? 30)),
          userProfile: settings.userProfile ?? null,
          customStages: settings.customStages ?? [],
          compositionWeights: settings.compositionWeights ?? null,
          enableSystemNotifications: settings.enableSystemNotifications !== false,
          autoProjectDescriptionEnabled: settings.autoProjectDescriptionEnabled !== false,
          holidayDataSource: settings.holidayDataSource || 'auto',
          holidayApiUrl: settings.holidayApiUrl || 'https://timor.tech/api/holiday/year/{year}',
          calendarDayRecords: settings.calendarDayRecords || [],
          calendarItineraries: settings.calendarItineraries || [],
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

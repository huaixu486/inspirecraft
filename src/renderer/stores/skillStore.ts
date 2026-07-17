import { create } from 'zustand';
import { SkillPackage, PromptScene } from '../../shared/types';
import { assertIpcMutationSucceeded, requireIpcArray, requireIpcObject } from '../utils/ipcResult';

interface SkillState {
  skills: SkillPackage[];
  isLoading: boolean;
  loadSkills: () => Promise<void>;
  importSkill: (pkg: SkillPackage) => Promise<void>;
  importExternalSkill: () => Promise<{ success: boolean; cancelled?: boolean; error?: string; pkg?: SkillPackage }>;
  deleteSkill: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  setWeight: (id: string, weight: number) => Promise<void>;
  getEnabledByScene: (scene: PromptScene) => SkillPackage[];
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  isLoading: false,

  loadSkills: async () => {
    set({ isLoading: true });
    try {
      const skills = requireIpcArray<SkillPackage>(await window.electronAPI.loadSkillPackages(), '加载 Skill 包失败');
      set({ skills, isLoading: false });
    } catch (err) {
      console.error('[skillStore] loadSkills failed:', err);
      set({ isLoading: false });
    }
  },

  importSkill: async (pkg: SkillPackage) => {
    const { skills } = get();
    const idx = skills.findIndex(s => s.id === pkg.id);
    const next = [...skills];
    if (idx >= 0) next[idx] = pkg; else next.push(pkg);
    set({ skills: next });
    try {
      const result = await window.electronAPI.importSkillPackage(pkg);
      requireIpcObject<SkillPackage>(result, '导入 Skill 包失败');
    } catch (err) {
      console.error('[skillStore] importSkill failed:', err);
      set({ skills });
    }
  },

  importExternalSkill: async () => {
    try {
      const result = await window.electronAPI.importExternalSkillPackage();
      if (result.success && result.pkg) {
        const skills = get().skills;
        const index = skills.findIndex(skill => skill.id === result.pkg.id);
        const next = [...skills];
        if (index >= 0) next[index] = result.pkg; else next.push(result.pkg);
        set({ skills: next });
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error?.message || '导入外部 Skill 包失败' };
    }
  },

  deleteSkill: async (id: string) => {
    const prev = get().skills;
    set({ skills: prev.filter(s => s.id !== id) });
    try {
      const result = await window.electronAPI.deleteSkillPackage(id);
      assertIpcMutationSucceeded(result, '删除 Skill 包失败');
    } catch (err) {
      console.error('[skillStore] deleteSkill failed:', err);
      set({ skills: prev });
    }
  },

  setEnabled: async (id: string, enabled: boolean) => {
    const { skills } = get();
    const next = skills.map(s => s.id === id ? { ...s, enabled } : s);
    set({ skills: next });
    try {
      const result = await window.electronAPI.setSkillEnabled(id, enabled);
      assertIpcMutationSucceeded(result, '更新 Skill 启用状态失败');
    } catch (err) {
      console.error('[skillStore] setEnabled failed:', err);
      set({ skills });
    }
  },

  setWeight: async (id: string, weight: number) => {
    const { skills } = get();
    const clamped = Math.max(0, Math.min(100, weight));
    const next = skills.map(s => s.id === id ? { ...s, weight: clamped } : s);
    set({ skills: next });
    try {
      const result = await window.electronAPI.setSkillWeight(id, weight);
      assertIpcMutationSucceeded(result, '更新 Skill 权重失败');
    } catch (err) {
      console.error('[skillStore] setWeight failed:', err);
      set({ skills });
    }
  },

  /** 获取指定场景下已启用的 Skill 包（按权重降序） */
  getEnabledByScene: (scene: PromptScene): SkillPackage[] => {
    return get().skills
      .filter(s => s.enabled && s.type.includes(scene))
      .sort((a, b) => b.weight - a.weight);
  },
}));

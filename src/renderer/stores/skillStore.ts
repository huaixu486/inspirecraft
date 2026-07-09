import { create } from 'zustand';
import { SkillPackage, PromptScene } from '../../shared/types';

interface SkillState {
  skills: SkillPackage[];
  isLoading: boolean;
  loadSkills: () => Promise<void>;
  importSkill: (pkg: SkillPackage) => Promise<void>;
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
      const skills = await window.electronAPI.loadSkillPackages();
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
      await window.electronAPI.importSkillPackage(pkg);
    } catch (err) {
      console.error('[skillStore] importSkill failed:', err);
      set({ skills });
    }
  },

  deleteSkill: async (id: string) => {
    const prev = get().skills;
    set({ skills: prev.filter(s => s.id !== id) });
    try {
      await window.electronAPI.deleteSkillPackage(id);
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
      await window.electronAPI.setSkillEnabled(id, enabled);
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
      await window.electronAPI.setSkillWeight(id, weight);
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

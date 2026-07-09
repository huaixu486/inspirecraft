import { create } from 'zustand';
import { PromptScene, PromptTemplate } from '../../shared/types';

interface PromptState {
  templates: PromptTemplate[];
  isLoading: boolean;
  loadTemplates: () => Promise<void>;
  saveTemplate: (template: PromptTemplate) => Promise<void>;
  resetTemplate: (id: string) => Promise<void>;
  getByScene: (scene: PromptScene) => PromptTemplate | undefined;
  getUserByScene: (scene: PromptScene) => PromptTemplate | undefined;
  getAllByScene: (scene: PromptScene) => PromptTemplate[];
}

export const usePromptStore = create<PromptState>((set, get) => ({
  templates: [],
  isLoading: false,

  loadTemplates: async () => {
    set({ isLoading: true });
    try {
      const templates = await window.electronAPI.loadPromptTemplates();
      set({ templates, isLoading: false });
    } catch (err) {
      console.error('[promptStore] loadTemplates failed:', err);
      set({ isLoading: false });
    }
  },

  saveTemplate: async (template: PromptTemplate) => {
    const { templates } = get();
    const idx = templates.findIndex(t => t.id === template.id);
    const next = [...templates];
    if (idx >= 0) next[idx] = template; else next.push(template);
    set({ templates: next });
    try {
      await window.electronAPI.savePromptTemplate(template);
    } catch (err) {
      console.error('[promptStore] saveTemplate failed:', err);
      set({ templates });
    }
  },

  resetTemplate: async (id: string) => {
    const prev = get().templates;
    try {
      await window.electronAPI.resetPromptTemplate(id);
      const templates = await window.electronAPI.loadPromptTemplates();
      set({ templates });
    } catch (err) {
      console.error('[promptStore] resetTemplate failed:', err);
      set({ templates: prev });
    }
  },

  /** 获取指定场景的首选模板（用户自定义 > 内置） */
  getByScene: (scene: PromptScene): PromptTemplate | undefined => {
    const { templates } = get();
    const sceneTemplates = templates.filter(t => t.scene === scene);
    return sceneTemplates.find(t => !t.isBuiltin) || sceneTemplates.find(t => t.isBuiltin);
  },

  /** 获取指定场景的用户自定义模板 */
  getUserByScene: (scene: PromptScene): PromptTemplate | undefined => {
    return get().templates.find(t => t.scene === scene && !t.isBuiltin);
  },

  /** 获取指定场景的所有模板 */
  getAllByScene: (scene: PromptScene): PromptTemplate[] => {
    return get().templates.filter(t => t.scene === scene);
  },
}));

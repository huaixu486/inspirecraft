import { create } from 'zustand';
import { WritingTemplate, ReviewResult, ReviewConfig } from '../../shared/types';

interface TemplateState {
  templates: WritingTemplate[];
  reviews: ReviewResult[];
  isLoading: boolean;

  // 模板操作
  loadTemplates: () => Promise<void>;
  addTemplate: (template: WritingTemplate) => Promise<void>;
  updateTemplate: (id: string, updates: Partial<WritingTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  // 审查操作
  loadReviews: () => Promise<void>;
  executeReview: (versionId: string, templateId: string, config: ReviewConfig) => Promise<{ success: boolean; result?: ReviewResult; error?: string }>;
  deleteReview: (id: string) => Promise<void>;
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  reviews: [],
  isLoading: false,

  loadTemplates: async () => {
    set({ isLoading: true });
    try {
      const templates = await window.electronAPI.loadTemplates();
      set({ templates, isLoading: false });
    } catch (error) {
      console.error('Failed to load templates:', error);
      set({ isLoading: false });
    }
  },

  addTemplate: async (template) => {
    const newTemplates = [...get().templates, template];
    set({ templates: newTemplates });
    try {
      await window.electronAPI.saveTemplate(template);
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  },

  updateTemplate: async (id, updates) => {
    const templates = get().templates.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    );
    set({ templates });
    const updatedTemplate = templates.find(t => t.id === id);
    if (updatedTemplate) {
      try {
        await window.electronAPI.saveTemplate(updatedTemplate);
      } catch (error) {
        console.error('Failed to update template:', error);
      }
    }
  },

  deleteTemplate: async (id) => {
    const newTemplates = get().templates.filter((t) => t.id !== id);
    set({ templates: newTemplates });
    try {
      await window.electronAPI.deleteTemplate(id);
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  },

  loadReviews: async () => {
    try {
      const reviews = await window.electronAPI.loadReviews();
      set({ reviews });
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  },

  executeReview: async (versionId, templateId, config) => {
    try {
      const result = await window.electronAPI.executeReview({
        versionId,
        templateId,
        config,
      });
      if (result.success && result.result) {
        set({ reviews: [...get().reviews, result.result] });
      }
      return result;
    } catch (error: any) {
      console.error('Failed to execute review:', error);
      return { success: false, error: error.message };
    }
  },

  deleteReview: async (id) => {
    const newReviews = get().reviews.filter((r) => r.id !== id);
    set({ reviews: newReviews });
    try {
      await window.electronAPI.deleteReview(id);
    } catch (error) {
      console.error('Failed to delete review:', error);
    }
  },
}));

import { create } from 'zustand';
import { isAIJobCancelledError, useAIJobStore } from './aiJobStore';
import { WritingTemplate, ReviewResult, ReviewConfig } from '../../shared/types';
import { assertIpcMutationSucceeded, requireIpcArray } from '../utils/ipcResult';

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
      const templates = requireIpcArray<WritingTemplate>(await window.electronAPI.loadTemplates(), '加载模板失败');
      set({ templates, isLoading: false });
    } catch (error) {
      console.error('Failed to load templates:', error);
      set({ isLoading: false });
    }
  },

  addTemplate: async (template) => {
    const previous = get().templates;
    const newTemplates = [...previous, template];
    set({ templates: newTemplates });
    try {
      const result = await window.electronAPI.saveTemplate(template);
      assertIpcMutationSucceeded(result, '保存模板失败');
    } catch (error) {
      console.error('Failed to save template:', error);
      set({ templates: previous });
    }
  },

  updateTemplate: async (id, updates) => {
    const previous = get().templates;
    const templates = previous.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    );
    set({ templates });
    const updatedTemplate = templates.find(t => t.id === id);
    if (updatedTemplate) {
      try {
        const result = await window.electronAPI.saveTemplate(updatedTemplate);
        assertIpcMutationSucceeded(result, '更新模板失败');
      } catch (error) {
        console.error('Failed to update template:', error);
        set({ templates: previous });
      }
    }
  },

  deleteTemplate: async (id) => {
    const previous = get().templates;
    const newTemplates = previous.filter((t) => t.id !== id);
    set({ templates: newTemplates });
    try {
      const result = await window.electronAPI.deleteTemplate(id);
      assertIpcMutationSucceeded(result, '删除模板失败');
    } catch (error) {
      console.error('Failed to delete template:', error);
      set({ templates: previous });
    }
  },

  loadReviews: async () => {
    try {
      const reviews = requireIpcArray<ReviewResult>(await window.electronAPI.loadReviews(), '加载审查结果失败');
      set({ reviews });
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  },

  executeReview: async (versionId, templateId, config) => {
    try {
      const result = await useAIJobStore.getState().runAIJob<any>(
        {
          scene: 'review',
          title: '执行文档审核',
          inputHash: `${versionId}:${templateId}`,
          resultPreview: (value) => value?.summary || (value?.issues ? `发现 ${value.issues.length} 个问题` : undefined),
          // 通过 store 的完整操作重试，确保成功后仍会写入 reviews 列表。
          retry: async () => {
            await get().executeReview(versionId, templateId, config);
          },
        },
        async ({ jobId, setProgress, throwIfCancelled }) => {
          setProgress(35);
          const value = await window.electronAPI.executeReview({
            versionId,
            templateId,
            config,
            usageRequestId: jobId,
          });
          throwIfCancelled();
          setProgress(85);
          return value;
        },
      );
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
    const previous = get().reviews;
    const newReviews = previous.filter((r) => r.id !== id);
    set({ reviews: newReviews });
    try {
      const result = await window.electronAPI.deleteReview(id);
      assertIpcMutationSucceeded(result, '删除审查结果失败');
    } catch (error) {
      console.error('Failed to delete review:', error);
      set({ reviews: previous });
    }
  },
}));

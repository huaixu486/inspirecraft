import { create } from 'zustand';
import { ReferenceMaterial, StageMemoryEntry } from '../../shared/types';
import { assertIpcMutationSucceeded, requireIpcArray, requireIpcObject } from '../utils/ipcResult';

interface KnowledgeState {
  stageMemories: StageMemoryEntry[];
  referenceMaterials: ReferenceMaterial[];
  isLoading: boolean;
  loadKnowledge: () => Promise<void>;
  learnStageFinal: (params: {
    projectId: string;
    projectName: string;
    stageName: string;
    docId?: string;
    docName: string;
    sourceFilePath?: string;
    sourceVersionId?: string;
    sourceModifiedAt?: string;
    sourceKind?: 'stage-completion' | 'manual';
    completionEventId?: string;
    content?: string;
    usageRequestId?: string;
    usageTitle?: string;
  }) => Promise<StageMemoryEntry | null>;
  deleteStageMemory: (memoryId: string) => Promise<void>;
  deleteStageMemoryForEvent: (completionEventId: string) => Promise<number>;
  deleteStageMemoriesForDoc: (docId: string) => Promise<number>;
  importReferenceFiles: (projectId: string, filePaths: string[], source?: 'project-file' | 'external') => Promise<ReferenceMaterial[]>;
  addReferenceMaterial: (material: ReferenceMaterial) => Promise<ReferenceMaterial | null>;
  deleteReferenceMaterial: (materialId: string) => Promise<void>;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  stageMemories: [],
  referenceMaterials: [],
  isLoading: false,

  loadKnowledge: async () => {
    set({ isLoading: true });
    try {
      const [stageMemoryResult, referenceMaterialResult] = await Promise.all([
        window.electronAPI.loadStageMemories?.() || Promise.resolve([]),
        window.electronAPI.loadReferenceMaterials?.() || Promise.resolve([]),
      ]);
      const stageMemories = requireIpcArray<StageMemoryEntry>(stageMemoryResult, '加载阶段记忆失败');
      const referenceMaterials = requireIpcArray<ReferenceMaterial>(referenceMaterialResult, '加载参考资料失败');
      set({ stageMemories, referenceMaterials, isLoading: false });
    } catch (error) {
      console.error('Failed to load knowledge:', error);
      set({ isLoading: false });
    }
  },

  learnStageFinal: async (params) => {
    const result = await window.electronAPI.learnStageFinal?.(params);
    if (!result?.success || !result.entry) return null;
    const existing = get().stageMemories.filter(item => {
      if (item.id === result.entry.id) return false;
      if (params.docId && item.projectId === params.projectId && item.stageName === result.entry.stageName && item.docId === params.docId) return false;
      return true;
    });
    set({ stageMemories: [...existing, result.entry] });
    return result.entry;
  },

  deleteStageMemory: async (memoryId) => {
    const previous = get().stageMemories;
    set({ stageMemories: previous.filter(item => item.id !== memoryId) });
    try {
      const result = await window.electronAPI.deleteStageMemory?.(memoryId);
      assertIpcMutationSucceeded(result, '删除阶段记忆失败');
    } catch (error) {
      console.error('Failed to delete stage memory:', error);
      set({ stageMemories: previous });
      throw error;
    }
  },

  deleteStageMemoryForEvent: async (completionEventId) => {
    const memories = get().stageMemories.filter(item => item.completionEventId === completionEventId);
    for (const memory of memories) await get().deleteStageMemory(memory.id);
    return memories.length;
  },

  deleteStageMemoriesForDoc: async (docId) => {
    const previous = get().stageMemories;
    set({ stageMemories: previous.filter(item => item.docId !== docId) });
    try {
      const result = await window.electronAPI.deleteStageMemoriesForDoc?.(docId);
      assertIpcMutationSucceeded(result, '删除文档阶段记忆失败');
      return result?.removed || 0;
    } catch (error) {
      console.error('Failed to delete stage memories for doc:', error);
      set({ stageMemories: previous });
      return 0;
    }
  },

  importReferenceFiles: async (projectId, filePaths, source = 'external') => {
    const result = await window.electronAPI.importReferenceFiles?.({ projectId, filePaths, source });
    const materials = result?.success ? (result.materials || []) : [];
    if (materials.length) {
      const existing = get().referenceMaterials;
      set({ referenceMaterials: [...existing, ...materials] });
    }
    return materials;
  },

  addReferenceMaterial: async (material) => {
    const result = await window.electronAPI.saveReferenceMaterial?.(material);
    if (!result) return null;
    const saved = requireIpcObject<ReferenceMaterial>(result, '保存参考资料失败');
    const existing = get().referenceMaterials.filter(item => item.id !== saved.id);
    set({ referenceMaterials: [...existing, saved] });
    return saved;
  },

  deleteReferenceMaterial: async (materialId) => {
    const previous = get().referenceMaterials;
    set({ referenceMaterials: previous.filter(item => item.id !== materialId) });
    try {
      const result = await window.electronAPI.deleteReferenceMaterial?.(materialId);
      assertIpcMutationSucceeded(result, '删除参考资料失败');
    } catch (error) {
      console.error('Failed to delete reference material:', error);
      set({ referenceMaterials: previous });
    }
  },
}));

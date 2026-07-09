import { create } from 'zustand';
import { ReferenceMaterial, StageMemoryEntry } from '../../shared/types';

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
    content?: string;
  }) => Promise<StageMemoryEntry | null>;
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
      const [stageMemories, referenceMaterials] = await Promise.all([
        window.electronAPI.loadStageMemories?.() || Promise.resolve([]),
        window.electronAPI.loadReferenceMaterials?.() || Promise.resolve([]),
      ]);
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

  deleteStageMemoriesForDoc: async (docId) => {
    const previous = get().stageMemories;
    set({ stageMemories: previous.filter(item => item.docId !== docId) });
    try {
      const result = await window.electronAPI.deleteStageMemoriesForDoc?.(docId);
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
    const saved = await window.electronAPI.saveReferenceMaterial?.(material);
    if (!saved) return null;
    const existing = get().referenceMaterials.filter(item => item.id !== saved.id);
    set({ referenceMaterials: [...existing, saved] });
    return saved;
  },

  deleteReferenceMaterial: async (materialId) => {
    const previous = get().referenceMaterials;
    set({ referenceMaterials: previous.filter(item => item.id !== materialId) });
    try {
      await window.electronAPI.deleteReferenceMaterial?.(materialId);
    } catch (error) {
      console.error('Failed to delete reference material:', error);
      set({ referenceMaterials: previous });
    }
  },
}));

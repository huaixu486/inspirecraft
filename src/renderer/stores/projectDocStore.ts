import { create } from 'zustand';
import { ProjectDocument } from '../../shared/types';
import { assertIpcMutationSucceeded, requireIpcArray } from '../utils/ipcResult';

export const normalizeNewProjectDocument = (doc: ProjectDocument): ProjectDocument => {
  if (doc.lifecycleStatus) return doc;
  const lifecycleStatus = doc.templateId || doc.versionId || doc.sourceFilePath || doc.autoStage ? 'identified' : 'imported';
  return {
    ...doc,
    lifecycleStatus,
    lifecycleUpdatedAt: doc.createdAt,
  };
};

interface ProjectDocState {
  projectDocs: ProjectDocument[];
  isLoading: boolean;

  loadProjectDocs: () => Promise<void>;
  addProjectDoc: (doc: ProjectDocument) => Promise<void>;
  updateProjectDoc: (id: string, updates: Partial<ProjectDocument>) => Promise<void>;
  deleteProjectDoc: (id: string) => Promise<void>;
}

export const useProjectDocStore = create<ProjectDocState>((set, get) => ({
  projectDocs: [],
  isLoading: false,

  loadProjectDocs: async () => {
    set({ isLoading: true });
    try {
      const docs = requireIpcArray<ProjectDocument>(await window.electronAPI.loadProjectDocs(), '加载项目文档失败');
      set({ projectDocs: docs, isLoading: false });
    } catch (error) {
      console.error('Failed to load project docs:', error);
      set({ isLoading: false });
    }
  },

  addProjectDoc: async (doc) => {
    doc = normalizeNewProjectDocument(doc);
    const prev = get().projectDocs;
    const newDocs = [...prev, doc];
    set({ projectDocs: newDocs });
    try {
      const result = await window.electronAPI.saveProjectDoc(doc);
      assertIpcMutationSucceeded(result, '保存项目文档失败');
    } catch (error) {
      console.error('Failed to save project doc:', error);
      set({ projectDocs: prev });
    }
  },

  updateProjectDoc: async (id, updates) => {
    const prev = get().projectDocs;
    const docs = prev.map(d =>
      d.id === id ? { ...d, ...updates } : d
    );
    set({ projectDocs: docs });
    const updated = docs.find(d => d.id === id);
    if (updated) {
      try {
        const result = await window.electronAPI.saveProjectDoc(updated);
        assertIpcMutationSucceeded(result, '更新项目文档失败');
      } catch (error) {
        console.error('Failed to update project doc:', error);
        set({ projectDocs: prev });
      }
    }
  },

  deleteProjectDoc: async (id) => {
    const prev = get().projectDocs;
    const newDocs = prev.filter(d => d.id !== id);
    set({ projectDocs: newDocs });
    try {
      const result = await window.electronAPI.deleteProjectDoc(id);
      assertIpcMutationSucceeded(result, '删除项目文档失败');
    } catch (error) {
      console.error('Failed to delete project doc:', error);
      set({ projectDocs: prev });
    }
  },
}));

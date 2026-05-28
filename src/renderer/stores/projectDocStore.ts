import { create } from 'zustand';
import { ProjectDocument } from '../../shared/types';

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
      const docs = await window.electronAPI.loadProjectDocs();
      set({ projectDocs: docs, isLoading: false });
    } catch (error) {
      console.error('Failed to load project docs:', error);
      set({ isLoading: false });
    }
  },

  addProjectDoc: async (doc) => {
    const newDocs = [...get().projectDocs, doc];
    set({ projectDocs: newDocs });
    try {
      await window.electronAPI.saveProjectDoc(doc);
    } catch (error) {
      console.error('Failed to save project doc:', error);
    }
  },

  updateProjectDoc: async (id, updates) => {
    const docs = get().projectDocs.map(d =>
      d.id === id ? { ...d, ...updates } : d
    );
    set({ projectDocs: docs });
    const updated = docs.find(d => d.id === id);
    if (updated) {
      try {
        await window.electronAPI.saveProjectDoc(updated);
      } catch (error) {
        console.error('Failed to update project doc:', error);
      }
    }
  },

  deleteProjectDoc: async (id) => {
    const newDocs = get().projectDocs.filter(d => d.id !== id);
    set({ projectDocs: newDocs });
    try {
      await window.electronAPI.deleteProjectDoc(id);
    } catch (error) {
      console.error('Failed to delete project doc:', error);
    }
  },
}));

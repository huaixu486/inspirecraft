import { create } from 'zustand';
import { Project, DocumentVersion } from '../../shared/types';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  versions: DocumentVersion[];
  isLoading: boolean;

  // 项目操作
  loadProjects: () => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // 版本操作
  loadVersions: () => Promise<void>;
  addVersion: (version: DocumentVersion) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  versions: [],
  isLoading: false,

  loadProjects: async () => {
    set({ isLoading: true });
    try {
      const projects = await window.electronAPI.loadProjects();
      set({ projects, isLoading: false });
    } catch (error) {
      console.error('Failed to load projects:', error);
      set({ isLoading: false });
    }
  },

  addProject: async (project) => {
    const newProjects = [...get().projects, project];
    set({ projects: newProjects });
    try {
      await window.electronAPI.saveProject(project);
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  updateProject: async (id, updates) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
    );
    set({ projects });
    const updatedProject = projects.find(p => p.id === id);
    if (updatedProject) {
      try {
        await window.electronAPI.saveProject(updatedProject);
      } catch (error) {
        console.error('Failed to update project:', error);
      }
    }
  },

  deleteProject: async (id) => {
    const newProjects = get().projects.filter((p) => p.id !== id);
    set({ projects: newProjects });
    try {
      await window.electronAPI.deleteProject(id);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  },

  loadVersions: async () => {
    try {
      const versions = await window.electronAPI.loadVersions();
      set({ versions });
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
  },

  addVersion: async (version) => {
    const newVersions = [...get().versions, version];
    set({ versions: newVersions });
    try {
      await window.electronAPI.saveVersion(version);
    } catch (error) {
      console.error('Failed to save version:', error);
    }
  },

  deleteVersion: async (versionId) => {
    const newVersions = get().versions.filter((v) => v.id !== versionId);
    set({ versions: newVersions });
    try {
      await window.electronAPI.deleteVersion(versionId);
    } catch (error) {
      console.error('Failed to delete version:', error);
    }
  },
}));

import { create } from 'zustand';
import { Project, DocumentVersion } from '../../shared/types';
import { assertIpcMutationSucceeded, requireIpcArray } from '../utils/ipcResult';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  currentStageName: string;
  pendingReportDocId: string | null;  // 双击报告时传递的目标文档ID
  pendingReportDocOnly: boolean;     // 是否只显示该文档（双击进入 vs 按钮进入）
  versions: DocumentVersion[];
  isLoading: boolean;

  // 项目操作
  loadProjects: (options?: { silent?: boolean }) => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  setCurrentStageName: (stageName: string) => void;
  setPendingReportDocId: (docId: string | null) => void;
  setPendingReportDocOnly: (only: boolean) => void;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string, options?: { mode?: 'unregister' | 'delete-folder' }) => Promise<{ success: boolean; recycleEntry?: { id: string; name?: string } }>;

  // 版本操作
  loadVersions: () => Promise<void>;
  addVersion: (version: DocumentVersion) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  currentStageName: '',
  pendingReportDocId: null,
  pendingReportDocOnly: false,
  versions: [],
  isLoading: false,

  loadProjects: async (options) => {
    if (!options?.silent) set({ isLoading: true });
    try {
      const projects = requireIpcArray<Project>(await window.electronAPI.loadProjects(), '加载项目失败');
      set(options?.silent ? { projects } : { projects, isLoading: false });
      // 后台刷新目录修改时间（不阻塞加载，结果回来后静默更新 store）
      const projectIds = projects.map(p => p.id);
      void window.electronAPI.refreshProjectFolderModifiedAt(projectIds).then(updates => {
        if (!updates.length) return;
        const current = get().projects;
        const merged = current.map(p => {
          const u = updates.find(u => u.id === p.id);
          return u ? { ...p, folderModifiedAt: u.folderModifiedAt } : p;
        });
        set({ projects: merged });
      }).catch(() => {});
    } catch (error) {
      console.error('Failed to load projects:', error);
      if (!options?.silent) set({ isLoading: false });
    }
  },

  addProject: async (project) => {
    const prev = get().projects;
    const newProjects = [...prev, project];
    set({ projects: newProjects });
    try {
      const result = await window.electronAPI.saveProject(project);
      if (result && result.success === false) throw new Error(result.error || '保存项目失败');
    } catch (error) {
      console.error('Failed to save project:', error);
      set({ projects: prev });
    }
  },

  setCurrentProject: (project) => set((state) => ({
    currentProject: project,
    currentStageName: project && project.id === state.currentProject?.id
      ? state.currentStageName
      : '',
  })),

  setCurrentStageName: (stageName) => set({ currentStageName: stageName }),

  setPendingReportDocId: (docId) => set({ pendingReportDocId: docId }),
  setPendingReportDocOnly: (only) => set({ pendingReportDocOnly: only }),

  updateProject: async (id, updates) => {
    const prev = get().projects;
    const updatedAt = new Date().toISOString();
    const projects = prev.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt } : p
    );
    const currentProject = get().currentProject;
    set({
      projects,
      currentProject: currentProject?.id === id
        ? { ...currentProject, ...updates, updatedAt }
        : currentProject,
    });
    const updatedProject = projects.find(p => p.id === id);
    if (updatedProject) {
      try {
        const result = await window.electronAPI.saveProject(updatedProject);
        if (result && result.success === false) throw new Error(result.error || '保存项目失败');
      } catch (error) {
        console.error('Failed to update project:', error);
        // Do not roll back a newer local edit made while this save was pending.
        set((state) => ({
          projects: state.projects.map((project) => {
            if (project.id !== id || project.updatedAt !== updatedAt) return project;
            return prev.find(item => item.id === id) || project;
          }),
          currentProject: state.currentProject?.id === id && state.currentProject.updatedAt === updatedAt
            ? (prev.find(item => item.id === id) || state.currentProject)
            : state.currentProject,
        }));
      }
    }
  },

  deleteProject: async (id, options) => {
    try {
      const result = await window.electronAPI.deleteProject(id, options);
      if (!result?.success) throw new Error(result?.error || '删除项目失败');
      set((state) => ({
        projects: state.projects.filter((project) => project.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
      }));
      return result;
    } catch (error) {
      console.error('Failed to delete project:', error);
      throw error;
    }
  },

  loadVersions: async () => {
    try {
      const versions = requireIpcArray<DocumentVersion>(await window.electronAPI.loadVersions(), '加载文档版本失败');
      set({ versions });
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
  },

  addVersion: async (version) => {
    const previous = get().versions;
    const newVersions = [...previous, version];
    set({ versions: newVersions });
    try {
      const result = await window.electronAPI.saveVersion(version);
      assertIpcMutationSucceeded(result, '保存文档版本失败');
    } catch (error) {
      console.error('Failed to save version:', error);
      set(state => ({ versions: state.versions.filter(item => item.id !== version.id) }));
    }
  },

  deleteVersion: async (versionId) => {
    const previous = get().versions;
    const newVersions = previous.filter((v) => v.id !== versionId);
    set({ versions: newVersions });
    try {
      const result = await window.electronAPI.deleteVersion(versionId);
      assertIpcMutationSucceeded(result, '删除文档版本失败');
    } catch (error) {
      console.error('Failed to delete version:', error);
      set({ versions: previous });
    }
  },
}));

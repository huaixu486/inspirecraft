import { create } from 'zustand';
import { Project, DocumentVersion } from '../../shared/types';

export type WorkflowWorkbenchTarget = 'plan' | 'team' | 'report' | 'review' | 'writing';

export interface WorkflowFocus {
  projectId: string;
  workflowId?: string;
  taskId?: string;
  relatedDocId?: string;
  stageName?: string;
  source?: 'manual' | 'review' | 'stage' | 'report';
  prompt?: string;
  target: WorkflowWorkbenchTarget;
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  currentStageName: string;
  pendingReportDocId: string | null;  // 双击报告时传递的目标文档ID
  pendingReportDocOnly: boolean;     // 是否只显示该文档（双击进入 vs 按钮进入）
  versions: DocumentVersion[];
  pendingWorkflowFocus: WorkflowFocus | null;
  isLoading: boolean;

  // 项目操作
  loadProjects: (options?: { silent?: boolean }) => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  setCurrentStageName: (stageName: string) => void;
  setPendingReportDocId: (docId: string | null) => void;
  setPendingReportDocOnly: (only: boolean) => void;
  setPendingWorkflowFocus: (focus: WorkflowFocus | null) => void;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<{ success: boolean; recycleEntry?: { id: string; name?: string } }>;

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
  pendingWorkflowFocus: null,
  versions: [],
  isLoading: false,

  loadProjects: async (options) => {
    if (!options?.silent) set({ isLoading: true });
    try {
      const projects = await window.electronAPI.loadProjects();
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
    currentStageName: project ? state.currentStageName : '',
  })),

  setCurrentStageName: (stageName) => set({ currentStageName: stageName }),

  setPendingReportDocId: (docId) => set({ pendingReportDocId: docId }),
  setPendingReportDocOnly: (only) => set({ pendingReportDocOnly: only }),
  setPendingWorkflowFocus: (focus) => set({ pendingWorkflowFocus: focus }),

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

  deleteProject: async (id) => {
    const prev = get().projects;
    const previousCurrentProject = get().currentProject;
    const newProjects = prev.filter((p) => p.id !== id);
    set({
      projects: newProjects,
      currentProject: previousCurrentProject?.id === id ? null : previousCurrentProject,
    });
    try {
      const result = await window.electronAPI.deleteProject(id);
      if (!result?.success) throw new Error(result?.error || '删除项目失败');
      return result;
    } catch (error) {
      console.error('Failed to delete project:', error);
      set({ projects: prev, currentProject: previousCurrentProject });
      throw error;
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

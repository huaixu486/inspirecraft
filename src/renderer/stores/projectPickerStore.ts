import { create } from 'zustand';

export interface ProjectPickerFile {
  path: string;
  name: string;
}

type ProjectPickerMode = 'switch' | 'files';

interface ProjectPickerState {
  open: boolean;
  mode: ProjectPickerMode;
  projectId?: string;
  title?: string;
  selectedPaths: string[];
  searchQuery: string;
  /** A stage scope uses the same keyword recognition as stage documents. */
  stageName?: string;
  resolveFiles?: (files: ProjectPickerFile[]) => void;
  openProjectSwitcher: () => void;
  pickProjectFiles: (params?: { projectId?: string; title?: string; selectedPaths?: string[]; searchQuery?: string; stageName?: string }) => Promise<ProjectPickerFile[]>;
  close: () => void;
  confirmFiles: (files: ProjectPickerFile[]) => void;
}

export const useProjectPickerStore = create<ProjectPickerState>((set, get) => ({
  open: false,
  mode: 'switch',
  projectId: undefined,
  title: undefined,
  selectedPaths: [],
  searchQuery: '',
  stageName: undefined,
  resolveFiles: undefined,
  openProjectSwitcher: () => set({ open: true, mode: 'switch', projectId: undefined, title: undefined, selectedPaths: [], searchQuery: '', stageName: undefined, resolveFiles: undefined }),
  pickProjectFiles: (params = {}) => new Promise<ProjectPickerFile[]>(resolve => {
    const previousResolve = get().resolveFiles;
    previousResolve?.([]);
    set({
      open: true,
      mode: 'files',
      projectId: params.projectId,
      title: params.title || '选择项目资料',
      selectedPaths: params.selectedPaths || [],
      searchQuery: params.searchQuery || '',
      stageName: params.stageName,
      resolveFiles: resolve,
    });
  }),
  close: () => {
    const resolveFiles = get().resolveFiles;
    set({ open: false, resolveFiles: undefined, selectedPaths: [], searchQuery: '', stageName: undefined });
    resolveFiles?.([]);
  },
  confirmFiles: (files) => {
    const resolveFiles = get().resolveFiles;
    set({ open: false, resolveFiles: undefined, selectedPaths: [], searchQuery: '', stageName: undefined });
    resolveFiles?.(files);
  },
}));

export const openProjectSwitcher = () => useProjectPickerStore.getState().openProjectSwitcher();
export const pickProjectFiles = (params?: { projectId?: string; title?: string; selectedPaths?: string[]; searchQuery?: string; stageName?: string }) =>
  useProjectPickerStore.getState().pickProjectFiles(params);

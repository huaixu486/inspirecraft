import { create } from 'zustand';

export type FolderImportMode = 'shortcut' | 'move';

const STORAGE_KEY = 'projecthub.folder-import.default-mode.v1';

const loadDefaultMode = (): FolderImportMode | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'shortcut' || value === 'move' ? value : null;
  } catch {
    return null;
  }
};

interface FolderImportPreferenceState {
  defaultMode: FolderImportMode | null;
  setDefaultMode: (mode: FolderImportMode | null) => void;
}

export const useFolderImportPreferenceStore = create<FolderImportPreferenceState>(set => ({
  defaultMode: loadDefaultMode(),
  setDefaultMode: defaultMode => {
    try {
      if (typeof localStorage !== 'undefined') {
        if (defaultMode) localStorage.setItem(STORAGE_KEY, defaultMode);
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
    set({ defaultMode });
  },
}));

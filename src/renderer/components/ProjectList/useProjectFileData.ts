import { useCallback, useEffect, useRef, useState } from 'react';

export interface FileItem {
  name: string;
  isDirectory: boolean;
  ext: string;
  size: number;
  modifiedAt: string;
  path: string;
}

export interface TreeFileItem {
  name: string;
  path: string;
  relativePath: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

export interface TreeFolderItem {
  name: string;
  path: string;
  relativePath: string;
}

export interface TreeStats {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  typeCount: Record<string, number>;
}

interface UseProjectFileDataOptions {
  currentPath: string;
  onContentsLoaded?: () => unknown | Promise<unknown>;
}

const useProjectFileData = ({ currentPath, onContentsLoaded }: UseProjectFileDataOptions) => {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [treeFiles, setTreeFiles] = useState<TreeFileItem[]>([]);
  const [treeFolders, setTreeFolders] = useState<TreeFolderItem[]>([]);
  const [treeStats, setTreeStats] = useState<TreeStats | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const onContentsLoadedRef = useRef(onContentsLoaded);

  useEffect(() => {
    onContentsLoadedRef.current = onContentsLoaded;
  }, [onContentsLoaded]);

  const loadContents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.getFolderContents(currentPath);
      if (result.success) {
        setItems(result.items);
      }
      await onContentsLoadedRef.current?.();
    } catch (error) {
      console.error('Failed to load folder contents:', error);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  const loadTreeStats = useCallback(async () => {
    setTreeLoading(true);
    try {
      const result = await window.electronAPI.getTreeStats(currentPath);
      if (result.success && result.stats && result.files && result.folders) {
        setTreeStats(result.stats);
        setTreeFiles(result.files);
        setTreeFolders(result.folders);
      }
    } catch (error) {
      console.error('Failed to load tree stats:', error);
    } finally {
      setTreeLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    void loadContents();
    void loadTreeStats();
  }, [loadContents, loadTreeStats]);

  return {
    items,
    loading,
    treeFiles,
    treeFolders,
    treeStats,
    treeLoading,
    loadContents,
    loadTreeStats,
  };
};

export default useProjectFileData;

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Typography, Button, Space, Tag, Empty, Spin, Select, message, Modal, Input, Popconfirm, Badge, DatePicker, Dropdown,
} from 'antd';
import dayjs from 'dayjs';
import {
  FolderOutlined, FileTextOutlined, FilePdfOutlined, FileOutlined,
  FileExcelOutlined, FilePptOutlined, ArrowLeftOutlined, PlusOutlined,
  ReloadOutlined, FileWordOutlined, DeleteOutlined, FolderOpenOutlined, UndoOutlined,
  ImportOutlined, FolderAddOutlined, SearchOutlined,
} from '@ant-design/icons';
import { Project, WorkbenchFocus } from '../../../shared/types';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { getAllStages } from '../../utils/timelineStages';
import WorkbenchContextBar from '../Workbench/WorkbenchContextBar';

const { Text } = Typography;

interface FileItem {
  name: string;
  isDirectory: boolean;
  ext: string;
  size: number;
  modifiedAt: string;
  path: string;
}

interface TreeFileItem {
  name: string;
  path: string;
  relativePath: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

interface TreeFolderItem {
  name: string;
  path: string;
  relativePath: string;
}

interface TreeStats {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  typeCount: Record<string, number>;
}

// 撤销操作条目
interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

interface Props {
  project: Project;
  onBack: () => void;
  focus?: WorkbenchFocus;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fileIcon = (ext: string, isDir: boolean) => {
  if (isDir) return <FolderOutlined style={{ color: '#faad14', fontSize: 18 }} />;
  switch (ext) {
    case '.docx': case '.doc': return <FileWordOutlined style={{ color: '#1890ff', fontSize: 18 }} />;
    case '.pdf': return <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
    case '.xlsx': case '.xls': return <FileExcelOutlined style={{ color: '#52c41a', fontSize: 18 }} />;
    case '.pptx': case '.ppt': return <FilePptOutlined style={{ color: '#ff7a45', fontSize: 18 }} />;
    case '.txt': return <FileTextOutlined style={{ color: '#666', fontSize: 18 }} />;
    default: return <FileOutlined style={{ color: '#999', fontSize: 18 }} />;
  }
};

const extColorMap: Record<string, string> = {
  '.docx': 'blue', '.doc': 'blue',
  '.pdf': 'red',
  '.xlsx': 'green', '.xls': 'green',
  '.pptx': 'orange', '.ppt': 'orange',
  '.txt': 'default',
};

const getTemplateOutputType = (template: any): string =>
  template.outputFileType || template.filePath?.split('.').pop()?.toLowerCase() || 'docx';

const getFileNameFromPath = (filePath: string): string =>
  filePath.split(/[/\\]/).pop() || filePath;

const RENAME_TRIGGER_DELAY_MS = 650;
const FILE_LIST_ROW_HEIGHT = 44;

const getParentPath = (filePath: string): string => {
  const normalized = filePath.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return index > 0 ? normalized.slice(0, index) : normalized;
};

const normalizeFsPath = (filePath: string): string =>
  filePath.replace(/\\/g, '/').toLowerCase();

const normalizeSearchText = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(' ').replace(/\s+/g, '').toLowerCase();

const isPathEqualOrInside = (candidatePath: string, parentPath: string): boolean => {
  const candidate = normalizeFsPath(candidatePath);
  const parent = normalizeFsPath(parentPath).replace(/\/+$/, '');
  return candidate === parent || candidate.startsWith(`${parent}/`);
};

const replacePathPrefix = (candidatePath: string, oldPrefix: string, newPrefix: string): string => {
  if (!isPathEqualOrInside(candidatePath, oldPrefix)) return candidatePath;
  return `${newPrefix}${candidatePath.slice(oldPrefix.length)}`;
};

const isRenameTriggerClick = (event: React.MouseEvent) =>
  Boolean((event.target as HTMLElement).closest('[data-file-rename-trigger="true"]'));

const ProjectFileExplorer: React.FC<Props> = ({ project, onBack }) => {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(project.folderPath);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFileType, setNewFileType] = useState('docx');
  const [newFileName, setNewFileName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [deadline, setDeadline] = useState<dayjs.Dayjs | null>(null);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingPath, setRenamingPath] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDraggingFileOut, setIsDraggingFileOut] = useState(false);
  const [dragOverDirPath, setDragOverDirPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickRef = React.useRef<{ path: string; time: number } | null>(null);
  const lastSelectedPathRef = useRef<string>('');
  const renameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDoubleClickRef = useRef(false);
  const [internalDragPaths, setInternalDragPaths] = useState<Set<string>>(new Set());
  const internalDragPathsRef = useRef<Set<string>>(new Set());
  const internalCopyModeRef = useRef(false);
  const pointerDragRef = useRef<{
    startX: number;
    startY: number;
    paths: Set<string>;
    active: boolean;
    targetDirPath: string | null;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [internalDragOverPath, setInternalDragOverPath] = useState<string | null>(null);
  const explorerRootRef = useRef<HTMLDivElement | null>(null);

  // 子树统计状态
  const [treeFiles, setTreeFiles] = useState<TreeFileItem[]>([]);
  const [treeFolders, setTreeFolders] = useState<TreeFolderItem[]>([]);
  const [treeStats, setTreeStats] = useState<TreeStats | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  // 导入文件选择
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSource, setImportSource] = useState<'folder' | 'zip'>('folder');
  const [importFiles, setImportFiles] = useState<{ name: string; path: string; size: number }[]>([]);
  const [selectedImportFiles, setSelectedImportFiles] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const importZipPathRef = useRef<string>('');
  const { templates } = useTemplateStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const { customStages } = useSettingsStore();
  const allStages = getAllStages(customStages);
  const highlightTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const undoStackRef = useRef<UndoEntry[]>([]);

  // 保持 ref 同步
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);

  const invalidateProjectSearchIndex = () => {
    // Reserved for future disk-backed indexes. Current search stays in memory to keep typing responsive.
  };

  // Ctrl+Z 撤销快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack]);

  useEffect(() => {
    loadContents();
    loadTreeStats();
    return () => {
      highlightTimers.current.forEach(timer => clearTimeout(timer));
    };
  }, [currentPath]);

  useEffect(() => {
    setSearchQuery('');
    setFilterType(null);
  }, [project.id, project.folderPath]);

  const loadContents = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.getFolderContents(currentPath);
      if (result.success) {
        setItems(result.items);
      }
      await syncProjectStageFiles(project, { projectDocs: useProjectDocStore.getState().projectDocs, templates, addProjectDoc, updateProjectDoc, allStages });
    } catch (error) {
      console.error('Failed to load folder contents:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTreeStats = async () => {
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
  };

  const handleDoubleClick = (item: FileItem) => {
    // 标记为双击，取消慢双击重命名
    isDoubleClickRef.current = true;
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
    setRenamingPath('');
    if (item.isDirectory) {
      setSelectedPaths(new Set());
    }
    handleOpenFile(item);
  };

  const cancelRename = () => {
    setRenamingPath('');
    setRenameValue('');
  };

  const commitRename = async (item: FileItem) => {
    const rawName = renameValue.trim();
    if (!rawName || rawName === item.name) {
      cancelRename();
      return;
    }
    const finalName = !item.isDirectory && !/\.[^/.\\]+$/.test(rawName) && item.ext
      ? `${rawName}${item.ext}`
      : rawName;
    if (/[\\/]/.test(finalName)) {
      message.warning('文件名不能包含路径分隔符');
      return;
    }
    const result = await window.electronAPI.renameFile({ filePath: item.path, newName: finalName });
    if (!result.success || !result.filePath) {
      message.error(result.error || '重命名失败');
      return;
    }
    const oldPath = item.path;
    const newPath = result.filePath;
    invalidateProjectSearchIndex();
    const relatedDoc = projectDocs.find(doc => doc.sourceFilePath === oldPath);
    if (relatedDoc) {
      await updateProjectDoc(relatedDoc.id, {
        name: finalName,
        sourceFilePath: newPath,
        sourceFileModifiedAt: new Date().toISOString(),
      });
    }
    pushUndo({
      label: `重命名 ${item.name}`,
      undo: async () => {
        await window.electronAPI.renameFile({ filePath: newPath, newName: item.name });
        if (relatedDoc) {
          await updateProjectDoc(relatedDoc.id, {
            name: item.name,
            sourceFilePath: oldPath,
            sourceFileModifiedAt: item.modifiedAt || new Date().toISOString(),
          });
        }
        loadContents();
      },
    });
    cancelRename();
    message.success(`已重命名为 ${finalName}`);
    await loadContents();
    highlightFile(newPath);
  };

  const handleBack = () => {
    const parent = currentPath.replace(/[/\\][^/\\]+$/, '');
    if (parent.length >= project.folderPath.length && parent !== currentPath) {
      setCurrentPath(parent);
    }
  };

  const isInRoot = currentPath === project.folderPath;

  // 子树统计（来自 treeStats，currentPath 变化时加载）
  const KNOWN_EXTS = ['.docx', '.doc', '.pdf', '.xlsx', '.xls', '.pptx', '.ppt', '.txt'];
  const isOtherFilter = (value: string | null) => value === '其他' || value === '鍏粬' || value === 'other';

  // 显示逻辑：普通浏览看当前目录第一层，筛选/搜索看当前目录整棵子树
  const sq = searchQuery.trim();
  const isFiltering = !!filterType || !!sq;

  const treeTypeCount = treeStats?.typeCount || {};
  const treeFileCount = treeStats?.fileCount ?? 0;
  const treeFolderCount = treeStats?.folderCount ?? 0;
  const treeTotalSize = treeStats?.totalSize ?? 0;

  const matchesTreeFilter = (file: TreeFileItem) => {
    if (!filterType || filterType === '__dir__') return true;
    if (isOtherFilter(filterType)) return !KNOWN_EXTS.includes(file.ext);
    return file.ext === filterType;
  };

  const matchesSearch = (file: TreeFileItem) => {
    if (!sq) return true;
    const needle = sq.toLowerCase();
    return file.name.toLowerCase().includes(needle) || file.ext.replace('.', '').toLowerCase().includes(needle);
  };

  // 筛选/搜索时显示子树文件，否则显示当前目录第一层
  const displayItems: FileItem[] = isFiltering
    ? (filterType === '__dir__'
      ? treeFolders.map(d => ({
        name: d.name, isDirectory: true, ext: '', size: 0, modifiedAt: '', path: d.path,
      }))
      : treeFiles.filter(f => matchesTreeFilter(f) && matchesSearch(f)).map(f => ({
        name: f.name, isDirectory: false, ext: f.ext, size: f.size, modifiedAt: f.modifiedAt, path: f.path,
      }))
    )
    : items;

  // 选择模板时自动填充
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId) {
      const template = templates.find(t => t.id === templateId);
      if (template) {
        // 默认文件名：项目名称-模板名称
        setNewFileName(`${project.name}-${template.name}`);
        setNewFileType(getTemplateOutputType(template));
      }
    } else {
      setNewFileName('');
    }
  };

  // 检查同名文件并生成带版本号的文件名
  const getUniqueFileName = (baseName: string, ext: string): string => {
    const existingNames = items.map(i => i.name);
    const fullName = `${baseName}.${ext}`;
    if (!existingNames.includes(fullName)) return baseName;

    // 找到同模板已有的版本号
    let maxVer = 0;
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const verRegex = new RegExp(`^${escapedBase}V(\\d+)\\.${ext.replace('.', '\\.')}$`);
    for (const name of existingNames) {
      const match = name.match(verRegex);
      if (match) {
        maxVer = Math.max(maxVer, parseInt(match[1]));
      }
    }
    return `${baseName}V${maxVer + 1}`;
  };

  // 新建文件
  const handleCreateFile = async () => {
    if (!newFileName.trim()) {
      message.warning('请输入文件名');
      return;
    }

    let result: { success: boolean; filePath?: string; error?: string };
    const template = selectedTemplateId ? templates.find(t => t.id === selectedTemplateId) : null;

    // 自动处理同名文件
    const ext = template ? getTemplateOutputType(template) : newFileType;
    const finalName = getUniqueFileName(newFileName.trim(), ext);

    if (template) {
      // 从模板创建（复制模板源文件）
      result = await window.electronAPI.createFromTemplate({
        folderPath: currentPath,
        fileName: finalName,
        template,
        fileType: ext,
      });
    } else {
      // 创建空白文件
      result = await window.electronAPI.createBlankFile({
        folderPath: currentPath,
        fileName: finalName,
        fileType: newFileType,
      });
    }

    if (result.success) {
      // 如果选择了模板，自动创建 ProjectDocument 关联
      if (template) {
        const doc = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          projectId: project.id,
          templateId: selectedTemplateId,
          name: finalName,
          deadline: deadline ? deadline.toISOString() : undefined,
          sourceFilePath: result.filePath,
          sourceFileCreatedAt: new Date().toISOString(),
          sourceFileModifiedAt: new Date().toISOString(),
          sections: [],
          overallProgress: 0,
          createdAt: new Date().toISOString(),
        };
        await addProjectDoc(doc);
      }
      const createdPath = result.filePath || `${currentPath}\\${finalName}.${ext}`;
      const createdName = getFileNameFromPath(createdPath);
      pushUndo({
        label: `创建 ${createdName}`,
        undo: async () => {
          await window.electronAPI.deleteFile(createdPath);
          loadContents();
        },
      });
      message.success(`已创建 ${createdName}`);
      setAddModalOpen(false);
      setNewFileName('');
      setSelectedTemplateId('');
      await syncProjectStageFiles(project, { projectDocs: useProjectDocStore.getState().projectDocs, templates, addProjectDoc, updateProjectDoc, allStages });
      await loadContents();
      loadTreeStats();
      highlightFile(createdPath);
    } else {
      message.error(`创建失败: ${result.error || ''}`);
    }
  };

  // 新建文件夹
  const handleCreateFolder = async () => {
    const folderName = newFolderName.trim();
    if (!folderName) {
      message.warning('请输入文件夹名称');
      return;
    }
    if (/[<>:"/\\|?*]/.test(folderName) || /[. ]$/.test(folderName)) {
      message.warning('文件夹名称包含无效字符，或以点/空格结尾');
      return;
    }

    setCreatingFolder(true);
    try {
      const result = await window.electronAPI.createFolder({
        folderPath: currentPath,
        folderName,
      });
      if (!result.success || !result.folderPath) {
        message.error(result.error || '创建文件夹失败');
        return;
      }

      const createdPath = result.folderPath;
      pushUndo({
        label: `创建文件夹 ${folderName}`,
        undo: async () => {
          await window.electronAPI.deleteFolder(createdPath);
          await loadContents();
        },
      });
      setFolderModalOpen(false);
      setNewFolderName('');
      await loadContents();
      loadTreeStats();
      highlightFile(createdPath);
      message.success(`已创建文件夹 ${folderName}`);
    } finally {
      setCreatingFolder(false);
    }
  };
  // 模态框关闭时重置
  const handleModalClose = () => {
    setAddModalOpen(false);
    setNewFileName('');
    setSelectedTemplateId('');
    setNewFileType('docx');
    setDeadline(null);
  };

  // 高亮新文件（3秒后自动消失）
  const highlightFile = (filePath: string) => {
    setHighlightedPaths(prev => new Set(prev).add(filePath));
    const timer = setTimeout(() => {
      setHighlightedPaths(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      highlightTimers.current.delete(filePath);
    }, 3000);
    highlightTimers.current.set(filePath, timer);
  };

  // 压入撤销栈
  const pushUndo = (entry: UndoEntry) => {
    setUndoStack(prev => [entry, ...prev].slice(0, 20)); // 最多保留20步
  };

  // 执行撤销
  const handleUndo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) {
      message.info('没有可撤销的操作');
      return;
    }
    const entry = stack[0];
    setUndoStack(prev => prev.slice(1));
    await entry.undo();
    message.success(`已撤销：${entry.label}`);
  }, []);

  // 打开文件
  const handleOpenFile = async (item: FileItem) => {
    if (item.isDirectory) {
      setCurrentPath(item.path);
      return;
    }
    const result = await window.electronAPI.openFileWithApp(item.path);
    if (!result.success) {
      message.error('无法打开文件');
    }
  };

  // 判断是否为外部文件拖拽。Electron/Chromium 在不同拖拽来源下 types 形态不完全一致，这里统一转数组。
  const getDragTypes = (event: React.DragEvent) => Array.from(event.dataTransfer.types || []);

  const isExternalFileDrag = (event: React.DragEvent) => {
    const types = getDragTypes(event);
    if (types.includes('Files')) return true;
    if (types.includes('text/uri-list')) return true;
    return Array.from(event.dataTransfer.items || []).some(item => item.kind === 'file');
  };

  const getPathFromFile = (file: File) => {
    try {
      return window.electronAPI.getPathForFile?.(file) || (file as any).path as string | undefined;
    } catch {
      return (file as any).path as string | undefined;
    }
  };

  const getDraggedFilePaths = (event: React.DragEvent) => {
    const paths = new Set<string>();
    for (const file of Array.from(event.dataTransfer.files || [])) {
      const path = getPathFromFile(file);
      if (path) paths.add(path);
    }
    for (const item of Array.from(event.dataTransfer.items || [])) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      const path = getPathFromFile(file);
      if (path) paths.add(path);
    }
    const uriList = event.dataTransfer.getData('text/uri-list');
    for (const line of uriList.split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.startsWith('file://')) continue;
      const decoded = decodeURIComponent(line.replace(/^file:\/+/, ''));
      if (decoded) paths.add(decoded.length >= 3 && decoded[1] === ':' ? decoded : `/${decoded}`);
    }
    return Array.from(paths);
  };

  const normalizeDragPath = useCallback((value: string) => value.replace(/[/\\]+/g, '\\').toLowerCase(), []);

  const isInvalidFolderDropTarget = useCallback((targetPath: string, paths: Set<string>) => {
    const target = normalizeDragPath(targetPath);
    return Array.from(paths).some(sourcePath => {
      const source = normalizeDragPath(sourcePath);
      return target === source || target.startsWith(`${source}\\`);
    });
  }, [normalizeDragPath]);

  // 统一导入：选文件→直接导入，选ZIP/文件夹→弹窗勾选
  const handleImport = async () => {
    // 先弹文件选择（支持多选）
    const filePaths = await window.electronAPI.openFiles([{ name: '所有文件', extensions: ['*'] }]);
    if (filePaths && filePaths.length > 0) {
      // 有 ZIP → 弹窗勾选
      const zips = filePaths.filter(f => f.toLowerCase().endsWith('.zip'));
      if (zips.length > 0) {
        const result = await window.electronAPI.listZipFiles(zips[0]);
        if (result.success && result.files && result.files.length > 0) {
          importZipPathRef.current = zips[0];
          setImportSource('zip');
          setImportFiles(result.files.map(f => ({ name: f.name, path: f.path, size: f.size })));
          setSelectedImportFiles(result.files.map(f => f.path));
          setImportModalOpen(true);
        } else {
          message.warning('ZIP 文件为空');
        }
        return;
      }
      // 全是普通文件 → 直接导入
      const result = await window.electronAPI.importFiles({ folderPath: currentPath, filePaths });
      if (result.success) {
        loadContents();
        message.success(`已导入 ${result.files?.length || filePaths.length} 个文件`);
      } else {
        message.error(result.error || '导入失败');
      }
      return;
    }
    // 用户取消了文件选择 → 弹文件夹选择
    const srcFolder = await window.electronAPI.openFolder();
    if (!srcFolder) return;
    const dirResult = await window.electronAPI.scanStageFiles(srcFolder);
    if (dirResult.success && dirResult.files && dirResult.files.length > 0) {
      setImportSource('folder');
      setImportFiles(dirResult.files.map(f => ({ name: f.name, path: f.path, size: f.size })));
      setSelectedImportFiles(dirResult.files.map(f => f.path));
      setImportModalOpen(true);
    } else {
      message.warning('文件夹为空');
    }
  };

  // 执行导入
  const handleConfirmImport = async () => {
    if (selectedImportFiles.length === 0) {
      message.warning('请选择要导入的文件');
      return;
    }
    setImporting(true);
    try {
      if (importSource === 'folder') {
        const result = await window.electronAPI.importFiles({
          folderPath: currentPath,
          filePaths: selectedImportFiles,
        });
        if (result.success) {
          loadContents();
          loadTreeStats();
          message.success(`已导入 ${result.files?.length || selectedImportFiles.length} 个文件`);
        } else {
          message.error(result.error || '导入失败');
        }
      } else {
        const result = await window.electronAPI.extractZipFiles({
          zipPath: importZipPathRef.current,
          targetPath: currentPath,
          filePaths: selectedImportFiles,
        });
        if (result.success) {
          loadContents();
          loadTreeStats();
          message.success(`已导入 ${result.files?.length || selectedImportFiles.length} 个文件`);
        } else {
          message.error(result.error || '导入失败');
        }
      }
      setImportModalOpen(false);
    } finally {
      setImporting(false);
    }
  };

  const handleDropFiles = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    setIsDraggingFileOut(false);

    // Ctrl+内部拖拽到当前目录：创建文件或文件夹副本
    const draggedPaths = Array.from(internalDragPathsRef.current);
    if (draggedPaths.length > 0) {
      if (event.ctrlKey || internalCopyModeRef.current) {
        const result = await window.electronAPI.duplicateFiles({
          sourcePaths: draggedPaths,
          targetFolder: currentPath,
        });
        if (!result.success) {
          message.error(result.error || '创建副本失败');
        } else {
          const copies = result.copies || [];
          if (copies.length > 0) {
            pushUndo({
              label: `创建 ${copies.length} 个副本`,
              undo: async () => {
                for (const copy of copies) {
                  if (copy.isDirectory) await window.electronAPI.deleteFolder(copy.path);
                  else await window.electronAPI.deleteFile(copy.path);
                }
                await loadContents();
              },
            });
            message.success(`已创建 ${copies.length} 个副本`);
            await loadContents();
            copies.forEach(copy => highlightFile(copy.path));
          }
        }
      }
      internalDragPathsRef.current = new Set();
      internalCopyModeRef.current = false;
      setInternalDragPaths(new Set());
      setInternalDragOverPath(null);
      return;
    }

    // 外部文件拖入
    if (!isExternalFileDrag(event)) return;
    const filePaths = getDraggedFilePaths(event);
    if (filePaths.length === 0) {
      message.warning('未读取到可导入的文件路径');
      return;
    }
    const result = await window.electronAPI.importFiles({ folderPath: currentPath, filePaths });
    if (!result.success) {
      message.error(result.error || '导入失败');
      return;
    }
    const imported = result.files || [];
    if (imported.length === 0) {
      message.info('没有可导入的文件');
      return;
    }
    message.success(`已导入 ${imported.length} 个文件`);
    await syncProjectStageFiles(project, { projectDocs: useProjectDocStore.getState().projectDocs, templates, addProjectDoc, updateProjectDoc, allStages });
    await loadContents();
    loadTreeStats();
    imported.forEach(file => highlightFile(file.path));
  };

  // 拖出文件：Electron 官方链路要求从 HTML dragstart 事件内触发 webContents.startDrag
  const handleFileDragStart = (item: FileItem, event: React.DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (item.isDirectory || renamingPath === item.path || target.closest('[data-no-file-drag="true"]')) {
      event.preventDefault();
      return;
    }
    setSelectedPaths(prev => (prev.has(item.path) ? prev : new Set([item.path])));
    lastClickRef.current = null;
    suppressClickRef.current = true;
    setIsDraggingFileOut(true);
    setIsDragOver(false);

    const fileUrl = `file:///${item.path.replace(/\\/g, '/')}`;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', item.path);
    event.dataTransfer.setData('text/uri-list', fileUrl);
    event.dataTransfer.setData('DownloadURL', `application/octet-stream:${item.name}:${fileUrl}`);
    event.preventDefault();
    const result = window.electronAPI.startDrag(item.path);
    if (!result?.success) {
      setIsDraggingFileOut(false);
      message.warning(result?.error || '系统拖拽启动失败');
    }
  };

  // 拖入到子文件夹：将外部文件导入到该目录
  const handleDropToDir = async (event: React.DragEvent<HTMLDivElement>, dirPath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverDirPath(null);
    if (!isExternalFileDrag(event)) return;
    const filePaths = getDraggedFilePaths(event);
    if (filePaths.length === 0) {
      message.warning('未读取到可导入的文件路径');
      return;
    }
    const result = await window.electronAPI.importFiles({ folderPath: dirPath, filePaths });
    if (!result.success) {
      message.error(result.error || '导入失败');
      return;
    }
    const imported = result.files || [];
    if (imported.length > 0) {
      message.success(`已导入 ${imported.length} 个文件到子目录`);
      await loadContents();
      loadTreeStats();
    }
  };

  const handleDragOverDir = (event: React.DragEvent<HTMLDivElement>, dirPath: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOverDirPath(dirPath);
  };

  const handleDragLeaveDir = (event: React.DragEvent<HTMLDivElement>, dirPath: string) => {
    const related = event.relatedTarget as HTMLElement;
    if (related && event.currentTarget.contains(related)) return;
    setDragOverDirPath(prev => prev === dirPath ? null : prev);
  };

  // 资源管理器风格点击：单击选中，Ctrl+点击多选，Shift+点击范围选，慢双击重命名
  const handleFileClick = (item: FileItem, event: React.MouseEvent) => {
    if (renamingPath === item.path) return;

    // 多选逻辑
    if (event.shiftKey && lastSelectedPathRef.current) {
      const lastIdx = displayItems.findIndex(i => i.path === lastSelectedPathRef.current);
      const curIdx = displayItems.findIndex(i => i.path === item.path);
      if (lastIdx >= 0 && curIdx >= 0) {
        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        const rangePaths = displayItems.slice(start, end + 1).map(i => i.path);
        setSelectedPaths(prev => new Set([...prev, ...rangePaths]));
      }
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      });
      lastSelectedPathRef.current = item.path;
    } else {
      // 普通点击
      const isAlreadySelected = selectedPaths.has(item.path) && selectedPaths.size === 1;

      if (isAlreadySelected) {
        // 已选中状态下再次点击：延迟进入重命名
        // 如果是快双击，onDoubleClick 会取消这个定时器
        if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
        if (!isRenameTriggerClick(event)) {
          renameTimerRef.current = null;
          return;
        }
        isDoubleClickRef.current = false;
        renameTimerRef.current = setTimeout(() => {
          if (!isDoubleClickRef.current && !suppressClickRef.current) {
            setRenamingPath(item.path);
            setRenameValue(item.name);
          }
          renameTimerRef.current = null;
        }, RENAME_TRIGGER_DELAY_MS);
      } else {
        // 首次点击：选中
        setSelectedPaths(new Set([item.path]));
        lastSelectedPathRef.current = item.path;
      }
    }
  };

  // F2 重命名, Delete 删除, Ctrl+A 全选
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2' && selectedPaths.size === 1 && !renamingPath) {
        e.preventDefault();
        const path = Array.from(selectedPaths)[0];
        const item = items.find(i => i.path === path);
        if (item) {
          setRenamingPath(item.path);
          setRenameValue(item.name);
        }
      }
      if (e.key === 'Escape' && renamingPath) {
        cancelRename();
      }
      if (e.key === 'Delete' && selectedPaths.size > 0 && !renamingPath) {
        handleDeleteSelected();
      }
      if (e.ctrlKey && e.key === 'a' && !renamingPath) {
        e.preventDefault();
        setSelectedPaths(new Set(items.map(i => i.path)));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPaths, renamingPath, items]);

  // 删除文件或文件夹
  const handleDeleteFile = async (item: FileItem) => {
    const result = item.isDirectory
      ? await window.electronAPI.deleteFolder(item.path)
      : await window.electronAPI.deleteFile(item.path);
    if (result.success) {
      if (!item.isDirectory) {
        const ext = item.name.split('.').pop() || '';
        const nameWithoutExt = item.name.replace(/\.[^.]+$/, '');
        pushUndo({
          label: `删除 ${item.name}`,
          undo: async () => {
            await window.electronAPI.createBlankFile({
              folderPath: currentPath,
              fileName: nameWithoutExt,
              fileType: ext,
            });
            highlightFile(item.path);
            await loadContents();
          },
        });
      }
    } else {
      message.error(`删除 ${item.name} 失败`);
    }
  };

  // 批量删除选中文件
  const handleDeleteSelected = async () => {
    const paths = Array.from(selectedPaths);
    const toDelete = items.filter(i => paths.includes(i.path));
    if (toDelete.length === 0) return;
    for (const item of toDelete) {
      await handleDeleteFile(item);
    }
    message.success(`已删除 ${toDelete.length} 个项目`);
    setSelectedPaths(new Set());
    loadContents();
    loadTreeStats();
  };

  // 内部拖拽：普通拖动为移动，Ctrl+拖动为复制
  const updateMovedDocumentPaths = async (
    moved: Array<{ path: string; sourcePath: string; isDirectory: boolean }>,
    direction: 'forward' | 'backward',
  ) => {
    for (const entry of moved) {
      const fromPath = direction === 'forward' ? entry.sourcePath : entry.path;
      const toPath = direction === 'forward' ? entry.path : entry.sourcePath;
      const affectedDocs = projectDocs.filter(doc =>
        doc.projectId === project.id &&
        doc.sourceFilePath &&
        (entry.isDirectory
          ? isPathEqualOrInside(doc.sourceFilePath, fromPath)
          : normalizeFsPath(doc.sourceFilePath) === normalizeFsPath(fromPath))
      );

      for (const doc of affectedDocs) {
        await updateProjectDoc(doc.id, {
          sourceFilePath: replacePathPrefix(doc.sourceFilePath!, fromPath, toPath),
          sourceFileModifiedAt: new Date().toISOString(),
        });
      }
    }
  };
  const handleInternalDrop = async (targetDirPath: string, copyMode: boolean) => {
    const dragPathSet = new Set(internalDragPathsRef.current);
    const paths = Array.from(dragPathSet);
    if (paths.length === 0) return;

    try {
      if (isInvalidFolderDropTarget(targetDirPath, dragPathSet)) {
        message.warning('不能拖入自身或子文件夹');
        return;
      }

      if (copyMode) {
        const result = await window.electronAPI.duplicateFiles({ sourcePaths: paths, targetFolder: targetDirPath });
        if (!result.success) {
          message.error(result.error || '复制失败');
        } else {
          const copies = result.copies || [];
          if (copies.length > 0) {
            pushUndo({
              label: `复制 ${copies.length} 个项目`,
              undo: async () => {
                for (const copy of copies) {
                  if (copy.isDirectory) await window.electronAPI.deleteFolder(copy.path);
                  else await window.electronAPI.deleteFile(copy.path);
                }
                await loadContents();
              },
            });
            message.success(`已复制 ${copies.length} 个项目`);
            copies.forEach(copy => highlightFile(copy.path));
          }
        }
      } else {
        const result = await window.electronAPI.moveFiles({ sourcePaths: paths, targetFolder: targetDirPath });
        const moved = result.moved || [];
        if (moved.length > 0) {
          await updateMovedDocumentPaths(moved, 'forward');
          pushUndo({
            label: `移动 ${moved.length} 个项目`,
            undo: async () => {
              const byOriginalParent = new Map<string, string[]>();
              for (const entry of moved) {
                const parentPath = getParentPath(entry.sourcePath);
                const bucket = byOriginalParent.get(parentPath) || [];
                bucket.push(entry.path);
                byOriginalParent.set(parentPath, bucket);
              }
              for (const [parentPath, sourcePaths] of byOriginalParent) {
                await window.electronAPI.moveFiles({ sourcePaths, targetFolder: parentPath });
              }
              await updateMovedDocumentPaths(moved, 'backward');
              await loadContents();
            },
          });
          invalidateProjectSearchIndex();
          message.success(`已移动 ${moved.length} 个项目`);
        }
        if (!result.success && result.error) message.warning(result.error);
      }
      await loadContents();
    } finally {
      internalDragPathsRef.current = new Set();
      internalCopyModeRef.current = false;
      setInternalDragPaths(new Set());
      setInternalDragOverPath(null);
    }
  };

  // Electron 的原生 HTML 拖放会在页面内目标收到事件前显示拒绝状态。
  // 本页面移动改用指针命中检测，外部文件拖入仍保留原生 drop 通道。
  useEffect(() => {

    const getTargetFolder = (x: number, y: number, paths: Set<string>) => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      const folder = element?.closest('[data-folder-path]') as HTMLElement | null;
      const targetPath = folder?.dataset.folderPath || null;
      return targetPath && !isInvalidFolderDropTarget(targetPath, paths) ? targetPath : null;
    };

    const resetPointerDrag = () => {
      pointerDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setInternalDragOverPath(null);
      setInternalDragPaths(new Set());
      setIsDragOver(false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;
      if (!drag.active) {
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance < 6) return;
        drag.active = true;
        suppressClickRef.current = true;
        internalDragPathsRef.current = drag.paths;
        setInternalDragPaths(new Set(drag.paths));
        if (renameTimerRef.current) {
          clearTimeout(renameTimerRef.current);
          renameTimerRef.current = null;
        }
        setRenamingPath('');
        document.body.style.userSelect = 'none';
      }

      drag.targetDirPath = getTargetFolder(event.clientX, event.clientY, drag.paths);
      internalCopyModeRef.current = event.ctrlKey;
      setInternalDragOverPath(drag.targetDirPath);
      // Ctrl 拖到非文件夹区域时，目标就是当前目录，整页显示复制高亮。
      setIsDragOver(event.ctrlKey && !drag.targetDirPath);
      document.body.style.cursor = event.ctrlKey ? 'copy' : 'grabbing';
      event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;
      const copyMode = event.ctrlKey || internalCopyModeRef.current;
      const targetPath = drag.targetDirPath || (copyMode ? currentPath : null);
      if (drag.active && targetPath) {
        void handleInternalDrop(targetPath, copyMode);
      } else {
        internalDragPathsRef.current = new Set();
        internalCopyModeRef.current = false;
      }
      const suppressed = drag.active;
      resetPointerDrag();
      if (suppressed) setTimeout(() => { suppressClickRef.current = false; }, 0);
    };

    const handlePointerCancel = () => {
      internalDragPathsRef.current = new Set();
      internalCopyModeRef.current = false;
      resetPointerDrag();
      suppressClickRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [selectedPaths, renamingPath, currentPath, projectDocs, isInvalidFolderDropTarget]);

  const handleItemPointerDown = (item: FileItem, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || renamingPath === item.path) return;
    const target = event.target as HTMLElement;
    if (
      target.closest('[data-no-file-drag="true"]') ||
      target.closest('[data-native-file-drag="true"]') ||
      target.closest('input, button, textarea')
    ) return;
    const paths = selectedPaths.has(item.path) ? new Set(selectedPaths) : new Set([item.path]);
    pointerDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      paths,
      active: false,
      targetDirPath: null,
    };
  };

  const fileTypeOptions = [
    { value: 'docx', label: 'Word 文档 (.docx)' },
    { value: 'doc', label: 'Word 97-2003 (.doc)' },
    { value: 'pptx', label: 'PowerPoint (.pptx)' },
    { value: 'xlsx', label: 'Excel (.xlsx)' },
    { value: 'pdf', label: 'PDF (.pdf)' },
    { value: 'txt', label: '纯文本 (.txt)' },
    { value: 'md', label: 'Markdown (.md)' },
    { value: 'rtf', label: 'RTF 富文本 (.rtf)' },
  ];

  return (
    <div
      ref={explorerRootRef}
      style={{
        height: '100%',
        overflow: 'auto',
        outline: isDragOver ? '2px dashed #1677ff' : '2px dashed transparent',
        outlineOffset: -8,
        borderRadius: 8,
        background: isDragOver ? '#f0f7ff' : 'transparent',
        transition: 'background 0.15s, outline-color 0.15s',
      }}
      onDragOver={(event) => {
        // 内部拖拽到空白区域
        if (internalDragPathsRef.current.size > 0) {
          event.preventDefault();
          event.stopPropagation();
          if (event.ctrlKey) internalCopyModeRef.current = true;
          const copyMode = event.ctrlKey || internalCopyModeRef.current;
          event.dataTransfer.dropEffect = copyMode ? 'copy' : 'none';
          setIsDragOver(copyMode);
          return;
        }
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        setIsDraggingFileOut(false);
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setIsDragOver(false);
          setIsDraggingFileOut(false);
        }
      }}
      onDrop={handleDropFiles}
      onClick={(e) => { if (e.target === e.currentTarget) setSelectedPaths(new Set()); }}
    >
      {/* Header */}
      <div style={{
        marginBottom: 18, padding: '12px 14px', background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(10px)', border: '1px solid #e5e7eb', borderRadius: 12,
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, flex: '1 1 320px' }}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={isInRoot ? onBack : handleBack}
              title={isInRoot ? '返回项目列表' : '返回上级'}
              style={{ width: 36, height: 36, borderRadius: 10, color: '#374151', background: '#f8fafc', border: '1px solid #e5e7eb', flexShrink: 0 }}
            />
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FolderOpenOutlined style={{ color: '#1677ff', fontSize: 20 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Text strong style={{ fontSize: 17, color: '#111827', maxWidth: 320 }} ellipsis={{ tooltip: project.name }}>
                  {project.name}
                </Text>
                <Tag color={isInRoot ? 'blue' : 'default'} style={{ margin: 0, borderRadius: 999 }}>
                  {isInRoot ? '根目录' : '子目录'}
                </Tag>
              </div>
              <Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 12 }} ellipsis={{ tooltip: isInRoot ? project.folderPath : currentPath }}>
                {isInRoot ? '项目根目录' : currentPath.split(/[/\\]/).pop()}
              </Text>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', flex: '0 1 620px', minWidth: 300 }}>
            <Input
              allowClear
              size="middle"
              prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
              placeholder="搜索文件名 / 后缀"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              style={{ width: 240, borderRadius: 8 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 4, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              <Badge count={undoStack.length} size="small" offset={[-4, 0]}>
                <Button
                  icon={<UndoOutlined />}
                  onClick={handleUndo}
                  size="middle"
                  disabled={undoStack.length === 0}
                  title={undoStack.length > 0 ? `撤销：${undoStack[0].label} (Ctrl+Z)` : '无可撤销操作'}
                  style={{ borderRadius: 8 }}
                />
              </Badge>
              <Button icon={<ReloadOutlined />} onClick={() => { loadContents(); loadTreeStats(); }} size="middle" title="刷新" style={{ borderRadius: 8 }} />
            </div>
            <Button icon={<ImportOutlined />} size="middle" onClick={handleImport} style={{ borderRadius: 8 }}>导入</Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'file', icon: <FileOutlined />, label: '新建文件' },
                  { key: 'folder', icon: <FolderAddOutlined />, label: '新建文件夹' },
                ],
                onClick: ({ key }) => {
                  if (key === 'folder') setFolderModalOpen(true);
                  else setAddModalOpen(true);
                },
              }}
              trigger={['click']}
            >
              <Button type="primary" icon={<PlusOutlined />} size="middle" style={{ borderRadius: 8 }}>新建</Button>
            </Dropdown>
          </div>
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eef2f7' }}>
          <WorkbenchContextBar globalPage="project-files" embedded hideProjectTitle />
        </div>
      </div>
      {/* 多选状态栏 */}
      {selectedPaths.size > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
          padding: '8px 12px', background: '#e6f7ff', borderRadius: 6, fontSize: 12,
        }}>
          <Text style={{ fontSize: 12 }}>已选择 {selectedPaths.size} 个项目</Text>
          <div style={{ flex: 1 }} />
          <Button size="small" onClick={() => handleDeleteSelected()} danger>批量删除</Button>
          <Button size="small" onClick={() => setSelectedPaths(new Set())}>取消选择</Button>
        </div>
      )}

      {/* 概览卡片（统计当前目录及所有子目录） */}
      {treeStats && (
        <div style={{
          display: 'flex', gap: 12, marginBottom: 20,
          padding: '14px 16px', background: '#f6f8fa', borderRadius: 10,
        }}>
          <div
            style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '4px 0', borderRadius: 6, background: filterType === null ? '#e6f7ff' : 'transparent', transition: 'background 0.2s' }}
            onClick={() => setFilterType(null)}
            onMouseEnter={e => { if (filterType !== null) e.currentTarget.style.background = '#f0f0f0'; }}
            onMouseLeave={e => { if (filterType !== null) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ fontSize: 22, fontWeight: 'bold', color: filterType === null ? '#1890ff' : '#666' }}>{treeFileCount}</div>
            <Text type={filterType === null ? undefined : 'secondary'} style={{ fontSize: 11 }}>文件</Text>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#52c41a' }}>{formatSize(treeTotalSize)}</div>
            <Text type="secondary" style={{ fontSize: 11 }}>总大小</Text>
          </div>
          <div
            style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '4px 0', borderRadius: 6, background: filterType === '__dir__' ? '#e6f7ff' : 'transparent', transition: 'background 0.2s' }}
            onClick={() => setFilterType(filterType === '__dir__' ? null : '__dir__')}
            onMouseEnter={e => { if (filterType !== '__dir__') e.currentTarget.style.background = '#f0f0f0'; }}
            onMouseLeave={e => { if (filterType !== '__dir__') e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ fontSize: 22, fontWeight: 'bold', color: filterType === '__dir__' ? '#1890ff' : '#faad14' }}>{treeFolderCount}</div>
            <Text type={filterType === '__dir__' ? undefined : 'secondary'} style={{ fontSize: 11 }}>文件夹</Text>
          </div>
          {Object.entries(treeTypeCount).map(([ext, count]) => (
            <div
              key={ext}
              style={{
                flex: 1, textAlign: 'center', cursor: 'pointer',
                padding: '4px 0', borderRadius: 6,
                background: filterType === ext ? '#e6f7ff' : 'transparent',
                transition: 'background 0.2s',
              }}
              onClick={() => setFilterType(filterType === ext ? null : ext)}
              onMouseEnter={e => { if (filterType !== ext) e.currentTarget.style.background = '#f0f0f0'; }}
              onMouseLeave={e => { if (filterType !== ext) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 22, fontWeight: 'bold', color: filterType === ext ? '#1890ff' : '#666' }}>{count as number}</div>
              <Text type={filterType === ext ? undefined : 'secondary'} style={{ fontSize: 11 }}>{ext.replace('.', '').toUpperCase() || '其他'}</Text>
            </div>
          ))}
        </div>
      )}

      {/* 文件列表 */}
      {loading || treeLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : !isFiltering && items.length === 0 ? (
        <Empty description="此文件夹为空" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Space>
            <Button type="primary" icon={<FileOutlined />} onClick={() => setAddModalOpen(true)}>
              新建文件
            </Button>
            <Button icon={<FolderAddOutlined />} onClick={() => setFolderModalOpen(true)}>
              新建文件夹
            </Button>
          </Space>
        </Empty>
      ) : isFiltering && displayItems.length === 0 ? (
        <Empty description="当前目录及子目录内未找到匹配文件" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '36px 0' }} />
      ) : (
        <div>
          {/* 表头 */}
          <div style={{
            display: 'flex', alignItems: 'center', padding: '8px 12px', marginBottom: 4,
            borderBottom: '1px solid #f0f0f0',
          }}>
            <Text type="secondary" style={{ flex: 1, fontSize: 11 }}>名称</Text>
            <Text type="secondary" style={{ width: 80, fontSize: 11, textAlign: 'right' }}>大小</Text>
            <Text type="secondary" style={{ width: 140, fontSize: 11, textAlign: 'right' }}>修改时间</Text>
            <Text type="secondary" style={{ width: 70, fontSize: 11, textAlign: 'center' }}>操作</Text>
          </div>
          {isFiltering && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 8px', background: '#e6f7ff', borderRadius: 4, flexWrap: 'wrap' }}>
              {filterType && (
                <Text style={{ fontSize: 11 }}>
                  当前目录及子目录：{filterType === '__dir__' ? '文件夹' : filterType.replace('.', '').toUpperCase() || '其他'}
                  {sq ? '' : `，共 ${displayItems.length} 个${filterType === '__dir__' ? '文件夹' : '文件'}`}
                </Text>
              )}
              {sq && (
                <Text style={{ fontSize: 11 }}>
                  {filterType ? '' : '当前目录及子目录：'}搜索"{sq}"，匹配 {displayItems.length} 个文件
                </Text>
              )}
              <Button type="link" size="small" style={{ fontSize: 11, padding: 0 }} onClick={() => { setFilterType(null); setSearchQuery(''); }}>清除</Button>
            </div>
          )}
          {displayItems.map(item => {
            const isHighlighted = highlightedPaths.has(item.path);
            const isSelected = selectedPaths.has(item.path);
            const isDirDragOver = item.isDirectory && (internalDragOverPath === item.path || dragOverDirPath === item.path);
            const isInDrag = internalDragPaths.has(item.path);
            return (
              <div
                key={item.path}
                draggable={false}
                data-folder-path={item.isDirectory ? item.path : undefined}
                onPointerDown={(e) => handleItemPointerDown(item, e)}
                onDragStart={(e) => {
                  const paths = selectedPaths.has(item.path) ? new Set(selectedPaths) : new Set([item.path]);
                  if (!selectedPaths.has(item.path)) setSelectedPaths(paths);
                  internalDragPathsRef.current = paths;
                  internalCopyModeRef.current = e.ctrlKey;
                  setInternalDragPaths(paths);
                  e.dataTransfer.effectAllowed = e.ctrlKey ? 'copy' : 'move';
                  e.dataTransfer.setData('application/x-project-internal-drag', '1');
                  e.dataTransfer.setData('text/plain', Array.from(paths).join('\n'));
                }}
                onDragEnd={() => {
                  setIsDraggingFileOut(false);
                  internalDragPathsRef.current = new Set();
                  internalCopyModeRef.current = false;
                  setInternalDragPaths(new Set());
                  setInternalDragOverPath(null);
                  setIsDragOver(false);
                }}
                onDragOver={(e) => {
                  const dragPathSet = internalDragPathsRef.current;
                  if (item.isDirectory && dragPathSet.size > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isInvalidFolderDropTarget(item.path, dragPathSet)) {
                      e.dataTransfer.dropEffect = 'none';
                      setInternalDragOverPath(null);
                      return;
                    }
                    if (e.ctrlKey) internalCopyModeRef.current = true;
                    e.dataTransfer.dropEffect = (e.ctrlKey || internalCopyModeRef.current) ? 'copy' : 'move';
                    setInternalDragOverPath(item.path);
                  } else if (item.isDirectory) {
                    handleDragOverDir(e, item.path);
                  }
                }}
                onDragLeave={(e) => {
                  if (internalDragOverPath === item.path) setInternalDragOverPath(null);
                  handleDragLeaveDir(e, item.path);
                }}
                onDrop={(e) => {
                  if (item.isDirectory && internalDragPathsRef.current.size > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleInternalDrop(item.path, e.ctrlKey || internalCopyModeRef.current);
                  } else if (item.isDirectory) {
                    handleDropToDir(e, item.path);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', height: FILE_LIST_ROW_HEIGHT, minHeight: FILE_LIST_ROW_HEIGHT, padding: '0 12px',
                  boxSizing: 'border-box', borderRadius: 6, cursor: 'grab', marginBottom: 2, userSelect: 'none',
                  background: isDirDragOver ? '#e6f7ff' : isSelected ? '#e6f7ff' : isHighlighted ? '#f0f5ff' : 'transparent',
                  border: isDirDragOver ? '1px dashed #1890ff' : isSelected ? '1px solid #91d5ff' : '1px solid transparent',
                  transition: 'background 0.15s, border-color 0.15s',
                  opacity: isInDrag ? 0.5 : 1,
                }}
                onClick={(e) => {
                  if (suppressClickRef.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  handleFileClick(item, e);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDoubleClick(item);
                }}
                onMouseEnter={e => { if (!isSelected && !isDirDragOver) e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={e => { if (!isSelected && !isDirDragOver) e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  data-native-file-drag={!item.isDirectory ? 'true' : undefined}
                  draggable={!item.isDirectory && renamingPath !== item.path}
                  onDragStart={!item.isDirectory ? (e) => handleFileDragStart(item, e) : undefined}
                  onDragEnd={!item.isDirectory ? () => {
                    setIsDraggingFileOut(false);
                    setTimeout(() => { suppressClickRef.current = false; }, 0);
                  } : undefined}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, height: '100%', userSelect: 'none' }}
                  title={!item.isDirectory ? '拖动名称可发送文件；拖动行空白处可移动，按住 Ctrl 可复制' : '拖动行可移动文件夹，按住 Ctrl 可复制；双击进入文件夹'}
                >
                  {fileIcon(item.ext, item.isDirectory)}
                  <div data-file-rename-trigger="true" style={{ flex: 1, marginLeft: 10, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                    {renamingPath === item.path ? (
                      <Input
                        size="small"
                        value={renameValue}
                        autoFocus
                        onChange={e => setRenameValue(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onDoubleClick={e => e.stopPropagation()}
                        onBlur={() => commitRename(item)}
                        onPressEnter={() => commitRename(item)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            cancelRename();
                          }
                        }}
                      />
                    ) : (
                      <Text
                        data-file-rename-trigger="true"
                        style={{ display: 'block', maxWidth: '100%', fontSize: 13, lineHeight: '20px', fontWeight: isSelected ? 600 : 400, whiteSpace: 'nowrap' }}
                        ellipsis
                      >
                        {item.name}
                      </Text>
                    )}
                    {isHighlighted && (
                      <Tag color="blue" style={{ flexShrink: 0, fontSize: 9, lineHeight: '16px', marginLeft: 6, padding: '0 4px' }}>新</Tag>
                    )}
                  </div>
                </div>
                {!item.isDirectory && item.ext && (
                  <Tag color={extColorMap[item.ext] || 'default'} style={{ flexShrink: 0, fontSize: 10, lineHeight: '18px', margin: '0 8px' }}>
                    {item.ext.replace('.', '').toUpperCase()}
                  </Tag>
                )}
                <Text type="secondary" style={{ width: 80, flexShrink: 0, fontSize: 11, lineHeight: '20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {item.isDirectory ? '-' : formatSize(item.size)}
                </Text>
                <Text type="secondary" style={{ width: 140, flexShrink: 0, fontSize: 11, lineHeight: '20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {formatDate(item.modifiedAt)}
                </Text>
                <div data-no-file-drag="true" style={{ width: 70, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
                  <Button
                    type="text" size="small" icon={<FolderOpenOutlined />}
                    onClick={(e) => { e.stopPropagation(); window.electronAPI.openInExplorer(item.path); }}
                    title="打开文件所在位置"
                  />
                  <Popconfirm
                    title={`确定删除 ${item.name}？`}
                    onConfirm={(e) => { e?.stopPropagation(); handleDeleteFile(item); }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      type="text" size="small" danger icon={<DeleteOutlined />}
                      onClick={e => e.stopPropagation()}
                      title="删除"
                    />
                  </Popconfirm>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新建文件夹弹窗 */}
      <Modal
        title="新建文件夹"
        open={folderModalOpen}
        onOk={handleCreateFolder}
        onCancel={() => {
          if (creatingFolder) return;
          setFolderModalOpen(false);
          setNewFolderName('');
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={creatingFolder}
        width={400}
        destroyOnClose
      >
        <Text strong style={{ display: 'block', marginBottom: 6 }}>文件夹名称</Text>
        <Input
          autoFocus
          placeholder="输入文件夹名称"
          value={newFolderName}
          onChange={event => setNewFolderName(event.target.value)}
          onPressEnter={handleCreateFolder}
          maxLength={120}
        />
        <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
          文件夹将创建在当前目录中
        </Text>
      </Modal>
      {/* 新建文件弹窗 */}
      <Modal
        title="新建文件"
        open={addModalOpen}
        onOk={handleCreateFile}
        onCancel={handleModalClose}
        okText="创建"
        cancelText="取消"
        width={400}
      >
        {templates.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>从模板创建（可选）</Text>
            <Select
              allowClear
              placeholder="选择模板，自动填充文件名和类型"
              style={{ width: '100%' }}
              value={selectedTemplateId || undefined}
              onChange={(v) => handleTemplateChange(v || '')}
              options={templates.map(t => ({
                value: t.id,
                label: `${t.name} (${t.category} · ${(t.outputFileType || 'docx').toUpperCase()})`,
              }))}
            />
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>文件类型</Text>
          <Select
            style={{ width: '100%' }}
            value={newFileType}
            onChange={setNewFileType}
            options={fileTypeOptions}
            disabled={!!selectedTemplateId}
          />
          {selectedTemplateId && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
              选择模板后文件类型使用该模板的创建类型
            </Text>
          )}
        </div>
        <div style={{ marginBottom: 14 }}>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>文件名</Text>
          <Input
            placeholder="输入文件名（不含扩展名）"
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            onPressEnter={handleCreateFile}
            addonAfter={`.${newFileType}`}
          />
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>截止日期（可选）</Text>
          <DatePicker
            style={{ width: '100%' }}
            placeholder="设置截止日期，用于跟踪进度"
            value={deadline}
            onChange={setDeadline}
            allowClear
          />
          <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
            设定后将在时间线中显示，逾期会自动提醒
          </Text>
        </div>
      </Modal>

      {/* 导入文件选择弹窗 */}
      <Modal
        title={importSource === 'folder' ? '从文件夹导入' : '从 ZIP 导入'}
        open={importModalOpen}
        onOk={handleConfirmImport}
        onCancel={() => setImportModalOpen(false)}
        okText={`导入已选 (${selectedImportFiles.length})`}
        cancelText="取消"
        confirmLoading={importing}
        width={520}
      >
        <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">共 {importFiles.length} 个文件，点击勾选需要导入的文件</Text>
          <Space size={8}>
            <Button size="small" onClick={() => setSelectedImportFiles(importFiles.map(f => f.path))}>全选</Button>
            <Button size="small" onClick={() => setSelectedImportFiles([])}>全不选</Button>
          </Space>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
          {importFiles.map((file) => (
            <label
              key={file.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', cursor: 'pointer',
                borderBottom: '1px solid #f5f5f5',
                background: selectedImportFiles.includes(file.path) ? '#f0f7ff' : '#fff',
                transition: 'background 0.15s',
              }}
            >
              <input
                type="checkbox"
                checked={selectedImportFiles.includes(file.path)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedImportFiles(prev => [...prev, file.path]);
                  } else {
                    setSelectedImportFiles(prev => prev.filter(p => p !== file.path));
                  }
                }}
              />
              <FileTextOutlined style={{ color: '#1890ff', flexShrink: 0 }} />
              <Text style={{ flex: 1, fontSize: 12 }} ellipsis={{ tooltip: file.name }}>{file.name}</Text>
              <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{(file.size / 1024).toFixed(1)}KB</Text>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default ProjectFileExplorer;

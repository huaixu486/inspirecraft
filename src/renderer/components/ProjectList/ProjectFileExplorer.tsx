import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Typography, Button, Space, Tag, Empty, Spin, Select, message, Modal, Input, Popconfirm, Badge, DatePicker, Dropdown,
} from 'antd';
import dayjs from 'dayjs';
import {
  FolderOutlined, FileTextOutlined, FilePdfOutlined, FileOutlined,
  FileExcelOutlined, FilePptOutlined, ArrowLeftOutlined, PlusOutlined,
  ReloadOutlined, FileWordOutlined, DeleteOutlined, FolderOpenOutlined, UndoOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { Project } from '../../../shared/types';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { getAllStages } from '../../utils/timelineStages';

const { Text } = Typography;

interface FileItem {
  name: string;
  isDirectory: boolean;
  ext: string;
  size: number;
  modifiedAt: string;
  path: string;
}

// 撤销操作条目
interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

interface Props {
  project: Project;
  onBack: () => void;
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

const ProjectFileExplorer: React.FC<Props> = ({ project, onBack }) => {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(project.folderPath);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newFileType, setNewFileType] = useState('docx');
  const [newFileName, setNewFileName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [deadline, setDeadline] = useState<dayjs.Dayjs | null>(null);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [filterType, setFilterType] = useState<string | null>(null);
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
  const [internalDragOverPath, setInternalDragOverPath] = useState<string | null>(null);

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
    return () => {
      highlightTimers.current.forEach(timer => clearTimeout(timer));
    };
  }, [currentPath]);

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

  // 概览统计
  const files = items.filter(i => !i.isDirectory);
  const dirs = items.filter(i => i.isDirectory);
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const KNOWN_EXTS = ['.docx', '.doc', '.pdf', '.xlsx', '.xls', '.pptx', '.ppt', '.txt'];
  const typeCount: Record<string, number> = {};
  // 初始化所有已知类型，确保始终显示
  for (const ext of KNOWN_EXTS) typeCount[ext] = 0;
  typeCount['其他'] = 0;
  for (const f of files) {
    const key = KNOWN_EXTS.includes(f.ext) ? f.ext : '其他';
    typeCount[key] += 1;
  }

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
      highlightFile(createdPath);
    } else {
      message.error(`创建失败: ${result.error || ''}`);
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

  // 判断是否为外部文件拖拽
  const isExternalFileDrag = (event: React.DragEvent) => {
    return event.dataTransfer.types.includes('Files');
  };

  const getDraggedFilePaths = (event: React.DragEvent) => {
    const files = Array.from(event.dataTransfer.files);
    return files
      .map(file => window.electronAPI.getPathForFile?.(file) || (file as any).path as string | undefined)
      .filter(Boolean) as string[];
  };

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
    setIsDragOver(false);
    setIsDraggingFileOut(false);

    // 内部拖拽到空白区域：Ctrl = 复制副本，普通 = 无操作
    if (internalDragPaths.size > 0) {
      if (event.ctrlKey) {
        // Ctrl+拖拽到空白：在当前目录创建副本
        const paths = Array.from(internalDragPaths);
        let copied = 0;
        for (const srcPath of paths) {
          const item = items.find(i => i.path === srcPath);
          if (!item || item.isDirectory) continue;
          const result = await window.electronAPI.importFiles({ folderPath: currentPath, filePaths: [srcPath] });
          if (result.success) copied++;
        }
        if (copied > 0) {
          message.success(`已创建 ${copied} 个副本`);
          await loadContents();
        }
      }
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
    imported.forEach(file => highlightFile(file.path));
  };

  // 拖出文件：Electron 官方链路要求从 HTML dragstart 事件内触发 webContents.startDrag
  const handleFileDragStart = (item: FileItem, event: React.DragEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (item.isDirectory || renamingPath === item.path || target.closest('[data-no-file-drag="true"]')) {
      event.preventDefault();
      return;
    }
    setSelectedPaths(new Set([item.path]));
    lastClickRef.current = null;
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
    if (filePaths.length === 0) return;
    const result = await window.electronAPI.importFiles({ folderPath: dirPath, filePaths });
    if (!result.success) {
      message.error(result.error || '导入失败');
      return;
    }
    const imported = result.files || [];
    if (imported.length > 0) {
      message.success(`已导入 ${imported.length} 个文件到子目录`);
      await loadContents();
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
      const lastIdx = items.findIndex(i => i.path === lastSelectedPathRef.current);
      const curIdx = items.findIndex(i => i.path === item.path);
      if (lastIdx >= 0 && curIdx >= 0) {
        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        const rangePaths = items.slice(start, end + 1).map(i => i.path);
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
        isDoubleClickRef.current = false;
        renameTimerRef.current = setTimeout(() => {
          if (!isDoubleClickRef.current) {
            setRenamingPath(item.path);
            setRenameValue(item.name);
          }
          renameTimerRef.current = null;
        }, 300);
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

  // 删除文件
  const handleDeleteFile = async (item: FileItem) => {
    const result = await window.electronAPI.deleteFile(item.path);
    if (result.success) {
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
          loadContents();
        },
      });
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
  };

  // 内部拖拽：移动或复制文件到目标目录
  const handleInternalDrop = async (targetDirPath: string, copyMode: boolean) => {
    const paths = Array.from(internalDragPaths);
    if (paths.length === 0) return;
    let moved = 0, copied = 0;
    for (const srcPath of paths) {
      const item = items.find(i => i.path === srcPath);
      if (!item || item.isDirectory) continue;
      const destPath = `${targetDirPath}\\${item.name}`;
      if (copyMode) {
        const result = await window.electronAPI.importFiles({ folderPath: targetDirPath, filePaths: [srcPath] });
        if (result.success) copied++;
      } else {
        const result = await window.electronAPI.renameFile({ filePath: srcPath, newName: destPath });
        if (result.success) moved++;
      }
    }
    if (moved > 0) message.success(`已移动 ${moved} 个文件`);
    if (copied > 0) message.success(`已复制 ${copied} 个文件`);
    setInternalDragPaths(new Set());
    setInternalDragOverPath(null);
    loadContents();
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
        if (internalDragPaths.size > 0) {
          event.preventDefault();
          event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'none';
          if (event.ctrlKey) setIsDragOver(true);
          return;
        }
        if (isDraggingFileOut || !isExternalFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={isInRoot ? onBack : handleBack} title={isInRoot ? '返回项目列表' : '返回上级'} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a' }}>{project.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isInRoot ? '项目根目录' : currentPath.split(/[/\\]/).pop()}
          </Text>
        </div>
        <div style={{ flex: 1 }} />
        <Space>
          <Badge count={undoStack.length} size="small" offset={[-4, 0]}>
            <Button
              icon={<UndoOutlined />}
              onClick={handleUndo}
              size="small"
              disabled={undoStack.length === 0}
              title={undoStack.length > 0 ? `撤销：${undoStack[0].label} (Ctrl+Z)` : '无可撤销操作'}
            >
              撤销
            </Button>
          </Badge>
          <Button icon={<ReloadOutlined />} onClick={loadContents} size="small">刷新</Button>
          <Button icon={<ImportOutlined />} size="small" onClick={handleImport}>导入</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)} size="small">
            新建文件
          </Button>
        </Space>
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

      {/* 概览卡片 */}
      {isInRoot && (
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
            <div style={{ fontSize: 22, fontWeight: 'bold', color: filterType === null ? '#1890ff' : '#666' }}>{files.length}</div>
            <Text type={filterType === null ? undefined : 'secondary'} style={{ fontSize: 11 }}>文件</Text>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#52c41a' }}>{formatSize(totalSize)}</div>
            <Text type="secondary" style={{ fontSize: 11 }}>总大小</Text>
          </div>
          <div
            style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '4px 0', borderRadius: 6, background: filterType === '__dir__' ? '#e6f7ff' : 'transparent', transition: 'background 0.2s' }}
            onClick={() => setFilterType(filterType === '__dir__' ? null : '__dir__')}
            onMouseEnter={e => { if (filterType !== '__dir__') e.currentTarget.style.background = '#f0f0f0'; }}
            onMouseLeave={e => { if (filterType !== '__dir__') e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ fontSize: 22, fontWeight: 'bold', color: filterType === '__dir__' ? '#1890ff' : '#faad14' }}>{dirs.length}</div>
            <Text type={filterType === '__dir__' ? undefined : 'secondary'} style={{ fontSize: 11 }}>文件夹</Text>
          </div>
          {Object.entries(typeCount).map(([ext, count]) => (
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
              <div style={{ fontSize: 22, fontWeight: 'bold', color: filterType === ext ? '#1890ff' : '#666' }}>{count}</div>
              <Text type={filterType === ext ? undefined : 'secondary'} style={{ fontSize: 11 }}>{ext.replace('.', '').toUpperCase() || '其他'}</Text>
            </div>
          ))}
        </div>
      )}

      {/* 文件列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : items.length === 0 ? (
        <Empty description="此文件夹为空" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
            新建文件
          </Button>
        </Empty>
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
          {filterType && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 8px', background: '#e6f7ff', borderRadius: 4 }}>
              <Text style={{ fontSize: 11 }}>筛选：{filterType === '__dir__' ? '文件夹' : filterType.replace('.', '').toUpperCase() || '其他'}</Text>
              <Button type="link" size="small" style={{ fontSize: 11, padding: 0 }} onClick={() => setFilterType(null)}>清除</Button>
            </div>
          )}
          {(filterType === '__dir__'
            ? items.filter(i => i.isDirectory)
            : filterType === '其他'
              ? items.filter(i => !i.isDirectory && !KNOWN_EXTS.includes(i.ext))
              : filterType
                ? items.filter(i => !i.isDirectory && i.ext === filterType)
                : items
          ).map(item => {
            const isHighlighted = highlightedPaths.has(item.path);
            const isSelected = selectedPaths.has(item.path);
            const isDirDragOver = item.isDirectory && (internalDragOverPath === item.path || dragOverDirPath === item.path);
            const isInDrag = internalDragPaths.has(item.path);
            return (
              <div
                key={item.path}
                draggable={renamingPath !== item.path}
                onDragStart={(e) => {
                  if (item.isDirectory) {
                    // 目录拖拽：准备内部移动
                    if (!selectedPaths.has(item.path)) setSelectedPaths(new Set([item.path]));
                    setInternalDragPaths(new Set([item.path]));
                    e.dataTransfer.effectAllowed = 'move';
                  } else {
                    handleFileDragStart(item, e);
                    // 同时设置内部拖拽
                    const paths = selectedPaths.has(item.path) ? selectedPaths : new Set([item.path]);
                    setInternalDragPaths(paths);
                  }
                }}
                onDragEnd={() => {
                  setIsDraggingFileOut(false);
                  setInternalDragPaths(new Set());
                  setInternalDragOverPath(null);
                }}
                onDragOver={(e) => {
                  if (item.isDirectory && internalDragPaths.size > 0) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
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
                  if (item.isDirectory && internalDragPaths.size > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleInternalDrop(item.path, e.ctrlKey);
                  } else if (item.isDirectory) {
                    handleDropToDir(e, item.path);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', padding: '8px 12px',
                  borderRadius: 6, cursor: item.isDirectory ? 'pointer' : 'grab', marginBottom: 2, userSelect: 'none',
                  background: isDirDragOver ? '#e6f7ff' : isSelected ? '#e6f7ff' : isHighlighted ? '#f0f5ff' : 'transparent',
                  border: isDirDragOver ? '2px dashed #1890ff' : isSelected ? '1px solid #91d5ff' : '1px solid transparent',
                  transition: 'background 0.15s, border-color 0.15s',
                  opacity: isInDrag ? 0.5 : 1,
                }}
                onClick={(e) => item.isDirectory ? handleDoubleClick(item) : handleFileClick(item, e)}
                onDoubleClick={() => !item.isDirectory && handleDoubleClick(item)}
                onMouseEnter={e => { if (!isSelected && !isDirDragOver) e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={e => { if (!isSelected && !isDirDragOver) e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, userSelect: 'none' }}
                  title={!item.isDirectory ? '拖动到其他软件发送文件' : undefined}
                >
                  {fileIcon(item.ext, item.isDirectory)}
                  <div style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
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
                        style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}
                        ellipsis
                      >
                        {item.name}
                      </Text>
                    )}
                    {isHighlighted && (
                      <Tag color="blue" style={{ fontSize: 9, marginLeft: 6, padding: '0 4px' }}>新</Tag>
                    )}
                  </div>
                </div>
                {!item.isDirectory && item.ext && (
                  <Tag color={extColorMap[item.ext] || 'default'} style={{ fontSize: 10, margin: '0 8px' }}>
                    {item.ext.replace('.', '').toUpperCase()}
                  </Tag>
                )}
                <Text type="secondary" style={{ width: 80, fontSize: 11, textAlign: 'right' }}>
                  {item.isDirectory ? '-' : formatSize(item.size)}
                </Text>
                <Text type="secondary" style={{ width: 140, fontSize: 11, textAlign: 'right' }}>
                  {formatDate(item.modifiedAt)}
                </Text>
                <div data-no-file-drag="true" style={{ width: 70, display: 'flex', justifyContent: 'center', gap: 2 }}>
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

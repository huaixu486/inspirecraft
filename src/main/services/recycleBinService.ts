import * as fs from 'fs';
import * as path from 'path';
import {
  DocumentVersion,
  Project,
  ProjectDocument,
  ReferenceMaterial,
  ReviewResult,
  StageMemoryEntry,
  TaskItem,
} from '../types';

export const RECYCLE_BIN_DIR_NAME = '.projecthub-recycle-bin';
const RECYCLE_BIN_ENTRIES_DIR_NAME = 'entries';
const RECYCLE_BIN_INDEX_FILE_NAME = 'index.json';

export interface ProjectRecycleSnapshot {
  project: Project;
  versions: DocumentVersion[];
  documents: ProjectDocument[];
  tasks: TaskItem[];
  reviews: ReviewResult[];
  stageMemories: StageMemoryEntry[];
  referenceMaterials: ReferenceMaterial[];
}

export interface RecycleBinEntry {
  id: string;
  name: string;
  originalPath: string;
  recycledPath: string;
  isDirectory: boolean;
  deletedAt: string;
  size: number;
  projectSnapshot?: ProjectRecycleSnapshot;
}

export interface RecycleBinServiceDeps {
  getWorkspacePath: () => string;
  getRetentionDays: () => number;
  getDirSize: (directoryPath: string) => Promise<number>;
  hasProjectId: (projectId: string) => boolean;
  restoreProjectSnapshot: (snapshot: ProjectRecycleSnapshot) => void;
}

function isSameOrChildPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function movePath(sourcePath: string, targetPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) throw new Error('目标位置中已存在同名文件或文件夹');
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    const stat = await fs.promises.stat(sourcePath);
    if (stat.isDirectory()) {
      await fs.promises.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
      await fs.promises.rm(sourcePath, { recursive: true, force: false });
    } else {
      await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
      await fs.promises.unlink(sourcePath);
    }
  }
}

export function createRecycleBinService(deps: RecycleBinServiceDeps) {
  const getWorkspaceRoot = (requestedWorkspacePath?: string): string => {
    const configuredWorkspacePath = String(deps.getWorkspacePath() || '').trim();
    if (!configuredWorkspacePath) throw new Error('尚未设置工作区路径');
    const configuredRoot = path.resolve(configuredWorkspacePath);
    if (requestedWorkspacePath && path.resolve(requestedWorkspacePath) !== configuredRoot) {
      throw new Error('回收站只能操作当前工作区');
    }
    return configuredRoot;
  };

  const getPaths = (workspaceRoot: string) => {
    const root = path.join(workspaceRoot, RECYCLE_BIN_DIR_NAME);
    return {
      root,
      entries: path.join(root, RECYCLE_BIN_ENTRIES_DIR_NAME),
      index: path.join(root, RECYCLE_BIN_INDEX_FILE_NAME),
    };
  };

  const loadEntries = (workspaceRoot: string): RecycleBinEntry[] => {
    const { index } = getPaths(workspaceRoot);
    if (!fs.existsSync(index)) return [];
    try {
      const records = JSON.parse(fs.readFileSync(index, 'utf-8'));
      return Array.isArray(records) ? records : [];
    } catch {
      return [];
    }
  };

  const saveEntries = (workspaceRoot: string, entries: RecycleBinEntry[]): void => {
    const paths = getPaths(workspaceRoot);
    fs.mkdirSync(paths.entries, { recursive: true });
    const tempIndex = `${paths.index}.tmp`;
    fs.writeFileSync(tempIndex, JSON.stringify(entries, null, 2), 'utf-8');
    fs.renameSync(tempIndex, paths.index);
  };

  const removeEntryFile = async (entry: RecycleBinEntry): Promise<void> => {
    if (!fs.existsSync(entry.recycledPath)) return;
    if (entry.isDirectory) await fs.promises.rm(entry.recycledPath, { recursive: true, force: true });
    else await fs.promises.unlink(entry.recycledPath);
  };

  const cleanup = async (requestedWorkspacePath?: string): Promise<number> => {
    const workspaceRoot = getWorkspaceRoot(requestedWorkspacePath);
    const retentionDays = Math.min(365, Math.max(1, Number(deps.getRetentionDays() || 30)));
    const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = loadEntries(workspaceRoot);
    const expired = entries.filter(entry => !Number.isFinite(new Date(entry.deletedAt).getTime()) || new Date(entry.deletedAt).getTime() <= threshold);
    await Promise.all(expired.map(removeEntryFile));
    if (expired.length) saveEntries(workspaceRoot, entries.filter(entry => !expired.includes(entry)));
    return expired.length;
  };

  const moveToRecycleBin = async (filePath: string, options?: { allowOutsideWorkspace?: boolean }): Promise<RecycleBinEntry> => {
    const workspaceRoot = getWorkspaceRoot();
    const sourcePath = path.resolve(filePath);
    const recyclePaths = getPaths(workspaceRoot);
    const isOutsideWorkspace = !isSameOrChildPath(sourcePath, workspaceRoot);
    if ((isOutsideWorkspace && !options?.allowOutsideWorkspace) || isSameOrChildPath(sourcePath, recyclePaths.root)) {
      throw new Error('只能将当前工作区中的文件或文件夹移入回收站');
    }
    if (sourcePath === path.parse(sourcePath).root || sourcePath === workspaceRoot || isSameOrChildPath(workspaceRoot, sourcePath)) {
      throw new Error('不能删除磁盘根目录、当前工作区根目录或其上级目录');
    }
    if (!fs.existsSync(sourcePath)) throw new Error('文件或文件夹不存在');

    await cleanup(workspaceRoot);
    await fs.promises.mkdir(recyclePaths.entries, { recursive: true });
    const stat = await fs.promises.stat(sourcePath);
    const id = `recycle-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const recycledPath = path.join(recyclePaths.entries, `${id}-${path.basename(sourcePath)}`);
    await movePath(sourcePath, recycledPath);
    const entry: RecycleBinEntry = {
      id,
      name: path.basename(sourcePath),
      originalPath: sourcePath,
      recycledPath,
      isDirectory: stat.isDirectory(),
      deletedAt: new Date().toISOString(),
      size: stat.isDirectory() ? await deps.getDirSize(recycledPath) : stat.size,
    };
    saveEntries(workspaceRoot, [entry, ...loadEntries(workspaceRoot)]);
    return entry;
  };

  return {
    getWorkspaceRoot,
    cleanup,
    moveToRecycleBin,
    attachProjectSnapshot(entryId: string, snapshot: ProjectRecycleSnapshot) {
      const workspaceRoot = getWorkspaceRoot();
      const entries = loadEntries(workspaceRoot);
      const entry = entries.find(item => item.id === entryId);
      if (!entry) throw new Error('回收站项目不存在');
      entry.projectSnapshot = snapshot;
      saveEntries(workspaceRoot, entries);
    },
    async list(requestedWorkspacePath?: string) {
      const workspaceRoot = getWorkspaceRoot(requestedWorkspacePath);
      await cleanup(workspaceRoot);
      const allEntries = loadEntries(workspaceRoot);
      const validEntries = allEntries.filter(entry => fs.existsSync(entry.recycledPath));
      if (validEntries.length !== allEntries.length) saveEntries(workspaceRoot, validEntries);
      return validEntries
        .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime())
        .map(entry => ({ ...entry, isProject: Boolean(entry.projectSnapshot) }));
    },
    async restore(requestedWorkspacePath: string | undefined, id: string) {
      const workspaceRoot = getWorkspaceRoot(requestedWorkspacePath);
      const entries = loadEntries(workspaceRoot);
      const entry = entries.find(item => item.id === id);
      if (!entry) throw new Error('回收站项目不存在');
      if (!fs.existsSync(entry.recycledPath)) throw new Error('回收站中的文件已不存在');
      if (!isSameOrChildPath(entry.originalPath, workspaceRoot)) throw new Error('原始路径不在当前工作区');
      if (fs.existsSync(entry.originalPath)) throw new Error('原位置已有同名文件或文件夹，请先处理冲突');
      if (entry.projectSnapshot && deps.hasProjectId(entry.projectSnapshot.project.id)) throw new Error('同 ID 的项目记录已存在，无法恢复');
      await movePath(entry.recycledPath, entry.originalPath);
      if (entry.projectSnapshot) deps.restoreProjectSnapshot(entry.projectSnapshot);
      saveEntries(workspaceRoot, entries.filter(item => item.id !== entry.id));
    },
    async permanentlyDelete(requestedWorkspacePath: string | undefined, id: string) {
      const workspaceRoot = getWorkspaceRoot(requestedWorkspacePath);
      const entries = loadEntries(workspaceRoot);
      const entry = entries.find(item => item.id === id);
      if (!entry) throw new Error('回收站项目不存在');
      await removeEntryFile(entry);
      saveEntries(workspaceRoot, entries.filter(item => item.id !== entry.id));
    },
    async empty(requestedWorkspacePath?: string) {
      const workspaceRoot = getWorkspaceRoot(requestedWorkspacePath);
      const entries = loadEntries(workspaceRoot);
      await Promise.all(entries.map(removeEntryFile));
      saveEntries(workspaceRoot, []);
      return entries.length;
    },
  };
}

export type RecycleBinService = ReturnType<typeof createRecycleBinService>;

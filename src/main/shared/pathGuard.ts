import * as path from 'path';
import * as fs from 'fs';
import { settingsFile, dataDir, projectsFile } from './paths';
import { extractRegisteredProjectPaths } from './registeredProjectPaths';
import { readWorkspaceRootFromSettingsFile } from './workspaceSettings';

// ─── 内部工具 ────────────────────────────────────────────

function getWorkspaceRoot(): string {
  return readWorkspaceRootFromSettingsFile(settingsFile);
}

/**
 * 核心路径包含检查。
 * 用 path.resolve 规范化后做前缀比较，防止 .. 绕过。
 * Windows 上 path.resolve 保留输入大小写，所以比较也是大小写敏感的 —
 * 这是保守策略：宁可拒绝也不放行。
 */
function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithin(targetPath: string, root: string): boolean {
  if (!root) return false;
  const resolved = normalizeForCompare(targetPath);
  const resolvedRoot = normalizeForCompare(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

function getProjectRoots(): string[] {
  try {
    if (!fs.existsSync(projectsFile)) return [];
    return extractRegisteredProjectPaths(JSON.parse(fs.readFileSync(projectsFile, 'utf-8')));
  } catch {
    return [];
  }
}

// ─── 基础查询 ────────────────────────────────────────────

export function isWithinWorkspace(targetPath: string): boolean {
  const ws = getWorkspaceRoot();
  const resolved = path.resolve(targetPath);
  return isPathWithin(resolved, ws)
    || isPathWithin(resolved, dataDir)
    || getProjectRoots().some(projectRoot => isPathWithin(resolved, projectRoot));
}

// ─── 断言函数（抛异常版本）────────────────────────────────

export function assertWithinWorkspace(targetPath: string): void {
  if (!isWithinWorkspace(targetPath)) {
    throw new Error(`路径不在工作区内: ${targetPath}`);
  }
}

export function assertAllWithinWorkspace(paths: string[]): void {
  for (const p of paths) {
    assertWithinWorkspace(p);
  }
}

/**
 * 断言父目录在 workspace/dataDir 内。
 * 用于文件创建场景：parentPath 必须是安全目录，fileName 由 assertSafeChildName 单独校验。
 */
export function assertParentWithinWorkspace(parentPath: string): void {
  const resolved = path.resolve(parentPath);
  if (!isWithinWorkspace(resolved)) {
    throw new Error(`父目录不在工作区内: ${parentPath}`);
  }
}

/**
 * 断言文件/文件夹名是安全的 basename。
 * 拒绝：路径分隔符、..、绝对路径、盘符、空字符串、非法字符。
 */
export function assertSafeChildName(name: string): void {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('名称不能为空');

  // 空字节
  if (/\x00/.test(trimmed)) throw new Error('名称包含非法字符');

  // 路径分隔符
  if (/[\\/]/.test(trimmed)) throw new Error('名称不能包含路径分隔符');

  // ..  含义的名称
  if (trimmed === '..' || trimmed === '.') throw new Error('名称不能为 . 或 ..');

  // 盘符路径（Windows）
  if (/^[a-zA-Z]:/.test(trimmed)) throw new Error('名称不能是绝对路径');

  // UNC 路径
  if (/^\\\\/.test(trimmed)) throw new Error('名称不能是网络路径');

  // 非法字符（Windows 文件名不允许的）
  if (/[<>:"|?*]/.test(trimmed)) throw new Error('名称包含非法字符');

  // basename 一致性：path.basename(name) 必须等于 name 本身
  if (path.basename(trimmed) !== trimmed) throw new Error('名称不是有效的文件名');
}

/**
 * 断言解压目标路径在允许范围内。
 * 用于 ZIP Slip 防护：fullPath 必须在 targetRoot 内。
 */
export function assertPathInside(fullPath: string, targetRoot: string): void {
  const resolvedFile = path.resolve(fullPath);
  const resolvedRoot = path.resolve(targetRoot);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`ZIP 解压路径越界: ${fullPath}`);
  }
}

// ─── 带返回值的检查函数（不抛异常，适合 IPC handler）──────

export function checkWithinWorkspace(targetPath: string): { ok: true } | { ok: false; error: string } {
  if (!isWithinWorkspace(targetPath)) {
    const ws = getWorkspaceRoot();
    return { ok: false, error: `路径越界: ${path.resolve(targetPath)} 不在工作区 ${ws} 内` };
  }
  return { ok: true };
}

export function checkAllWithinWorkspace(paths: string[]): { ok: true } | { ok: false; error: string } {
  for (const p of paths) {
    const result = checkWithinWorkspace(p);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function checkParentWithinWorkspace(parentPath: string): { ok: true } | { ok: false; error: string } {
  if (!isWithinWorkspace(parentPath)) {
    return { ok: false, error: `父目录不在工作区内: ${parentPath}` };
  }
  return { ok: true };
}

export function checkSafeChildName(name: string): { ok: true } | { ok: false; error: string } {
  try {
    assertSafeChildName(name);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}

export function checkPathInside(fullPath: string, targetRoot: string): { ok: true } | { ok: false; error: string } {
  try {
    assertPathInside(fullPath, targetRoot);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}

export type ExistingPathKind = 'file' | 'directory' | 'any';

/**
 * Validate a user-selected external path without forcing it into the workspace.
 * This is intentionally separate from checkWithinWorkspace: import/open inputs
 * may live anywhere, while every write target still needs a workspace guard.
 */
export function checkExistingPath(
  targetPath: string,
  kind: ExistingPathKind = 'any',
): { ok: true; path: string } | { ok: false; error: string } {
  const value = String(targetPath || '').trim();
  if (!value || /\x00/.test(value)) return { ok: false, error: '路径无效' };
  const resolvedPath = path.resolve(value);
  try {
    const stat = fs.statSync(resolvedPath);
    if (kind === 'file' && !stat.isFile()) return { ok: false, error: '路径不是文件' };
    if (kind === 'directory' && !stat.isDirectory()) return { ok: false, error: '路径不是文件夹' };
    return { ok: true, path: resolvedPath };
  } catch {
    return { ok: false, error: '路径不存在或无法访问' };
  }
}

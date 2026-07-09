import * as fs from 'fs';
import { Project, DocumentVersion, WritingTemplate, ReviewResult, AIConfig, TaskItem, AppSettings, ProjectDocument } from '../types';
import { dataDir, projectsFile, versionsFile, templatesFile, reviewsFile, aiConfigFile, tasksFile, settingsFile, projectDocsFile } from './paths';
import { normalizeAIConfig } from './aiConfig';

// ========== 原子写 + 写队列 ==========
const writeQueues = new Map<string, Promise<void>>();

export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function enqueueWrite(filePath: string, fn: () => void): Promise<void> {
  const prev = writeQueues.get(filePath) ?? Promise.resolve();
  const next = prev.then(fn, fn).then(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

// ========== 数据目录 ==========
export function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// ========== Projects ==========
export function loadProjectsFromDisk(): Project[] {
  ensureDataDir();
  if (!fs.existsSync(projectsFile)) return [];
  try { return JSON.parse(fs.readFileSync(projectsFile, 'utf-8')); } catch { return []; }
}

export function saveProjectsToDisk(projects: Project[]) {
  ensureDataDir();
  atomicWriteJson(projectsFile, projects);
}

// ========== Versions ==========
export function loadVersionsFromDisk(): DocumentVersion[] {
  ensureDataDir();
  if (!fs.existsSync(versionsFile)) return [];
  try { return JSON.parse(fs.readFileSync(versionsFile, 'utf-8')); } catch { return []; }
}

export function saveVersionsToDisk(versions: DocumentVersion[]) {
  ensureDataDir();
  atomicWriteJson(versionsFile, versions);
}

// ========== Templates ==========
export function loadTemplatesFromDisk(): WritingTemplate[] {
  ensureDataDir();
  if (!fs.existsSync(templatesFile)) return [];
  try { return JSON.parse(fs.readFileSync(templatesFile, 'utf-8')); } catch { return []; }
}

export function saveTemplatesToDisk(templates: WritingTemplate[]) {
  ensureDataDir();
  atomicWriteJson(templatesFile, templates);
}

// ========== Reviews ==========
export function loadReviewsFromDisk(): ReviewResult[] {
  ensureDataDir();
  if (!fs.existsSync(reviewsFile)) return [];
  try { return JSON.parse(fs.readFileSync(reviewsFile, 'utf-8')); } catch { return []; }
}

export function saveReviewsToDisk(reviews: ReviewResult[]) {
  ensureDataDir();
  atomicWriteJson(reviewsFile, reviews);
}

// ========== AI Config ==========
export function loadAIConfigFromDisk(): AIConfig | null {
  ensureDataDir();
  if (!fs.existsSync(aiConfigFile)) return null;
  try { return normalizeAIConfig(JSON.parse(fs.readFileSync(aiConfigFile, 'utf-8'))); } catch { return null; }
}

export function saveAIConfigToDisk(config: AIConfig) {
  ensureDataDir();
  atomicWriteJson(aiConfigFile, normalizeAIConfig(config));
}

// ========== Tasks ==========
export function loadTasksFromDisk(): TaskItem[] {
  ensureDataDir();
  if (!fs.existsSync(tasksFile)) return [];
  try { return JSON.parse(fs.readFileSync(tasksFile, 'utf-8')); } catch { return []; }
}

export function saveTasksToDisk(tasks: TaskItem[]) {
  ensureDataDir();
  atomicWriteJson(tasksFile, tasks);
}

// ========== Settings ==========
export function loadSettingsFromDisk(): AppSettings {
  ensureDataDir();
  if (!fs.existsSync(settingsFile)) return { workspacePath: '', workspaceCapacity: 10 };
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { return { workspacePath: '', workspaceCapacity: 10 }; }
}

export function saveSettingsToDisk(settings: AppSettings) {
  ensureDataDir();
  atomicWriteJson(settingsFile, settings);
}

// ========== Project Documents ==========
export function loadProjectDocsFromDisk(): ProjectDocument[] {
  ensureDataDir();
  if (!fs.existsSync(projectDocsFile)) return [];
  try { return JSON.parse(fs.readFileSync(projectDocsFile, 'utf-8')); } catch { return []; }
}

export function saveProjectDocsToDisk(docs: ProjectDocument[]) {
  ensureDataDir();
  atomicWriteJson(projectDocsFile, docs);
}

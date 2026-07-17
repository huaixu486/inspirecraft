import * as fs from 'fs';
import { Project, DocumentVersion, WritingTemplate, ReviewResult, AIConfig, TaskItem, AppSettings, ProjectDocument } from '../types';
import { dataDir, projectsFile, versionsFile, templatesFile, reviewsFile, aiConfigFile, tasksFile, settingsFile, projectDocsFile } from './paths';
import { normalizeAIConfig } from './aiConfig';
import { readVersionedJsonFile, writeVersionedJsonFile } from './versionedJson';

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
  return readVersionedJsonFile<Project[]>(projectsFile, []).data;
}

export function saveProjectsToDisk(projects: Project[]) {
  ensureDataDir();
  writeVersionedJsonFile(projectsFile, projects);
}

// ========== Versions ==========
export function loadVersionsFromDisk(): DocumentVersion[] {
  ensureDataDir();
  return readVersionedJsonFile<DocumentVersion[]>(versionsFile, []).data;
}

export function saveVersionsToDisk(versions: DocumentVersion[]) {
  ensureDataDir();
  writeVersionedJsonFile(versionsFile, versions);
}

// ========== Templates ==========
export function loadTemplatesFromDisk(): WritingTemplate[] {
  ensureDataDir();
  return readVersionedJsonFile<WritingTemplate[]>(templatesFile, []).data;
}

export function saveTemplatesToDisk(templates: WritingTemplate[]) {
  ensureDataDir();
  writeVersionedJsonFile(templatesFile, templates);
}

// ========== Reviews ==========
export function loadReviewsFromDisk(): ReviewResult[] {
  ensureDataDir();
  return readVersionedJsonFile<ReviewResult[]>(reviewsFile, []).data;
}

export function saveReviewsToDisk(reviews: ReviewResult[]) {
  ensureDataDir();
  writeVersionedJsonFile(reviewsFile, reviews);
}

// ========== AI Config ==========
export function loadAIConfigFromDisk(): AIConfig | null {
  ensureDataDir();
  const config = readVersionedJsonFile<AIConfig | null>(aiConfigFile, null).data;
  return config ? normalizeAIConfig(config) : null;
}

export function saveAIConfigToDisk(config: AIConfig) {
  ensureDataDir();
  writeVersionedJsonFile(aiConfigFile, normalizeAIConfig(config));
}

// ========== Tasks ==========
export function loadTasksFromDisk(): TaskItem[] {
  ensureDataDir();
  return readVersionedJsonFile<TaskItem[]>(tasksFile, []).data;
}

export function saveTasksToDisk(tasks: TaskItem[]) {
  ensureDataDir();
  writeVersionedJsonFile(tasksFile, tasks);
}

// ========== Settings ==========
export function loadSettingsFromDisk(): AppSettings {
  ensureDataDir();
  return readVersionedJsonFile<AppSettings>(settingsFile, { workspacePath: '', workspaceCapacity: 10 }).data;
}

export function saveSettingsToDisk(settings: AppSettings) {
  ensureDataDir();
  writeVersionedJsonFile(settingsFile, settings);
}

// ========== Project Documents ==========
export function loadProjectDocsFromDisk(): ProjectDocument[] {
  ensureDataDir();
  return readVersionedJsonFile<ProjectDocument[]>(projectDocsFile, []).data;
}

export function saveProjectDocsToDisk(docs: ProjectDocument[]) {
  ensureDataDir();
  writeVersionedJsonFile(projectDocsFile, docs);
}

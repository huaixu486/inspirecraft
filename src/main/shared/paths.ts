import { app } from 'electron';
import * as path from 'path';

// 数据存储路径
export const userDataPath = app.getPath('userData');
export const dataDir = path.join(userDataPath, 'project-manager-data');
export const projectsFile = path.join(dataDir, 'projects.json');
export const versionsFile = path.join(dataDir, 'versions.json');
export const templatesFile = path.join(dataDir, 'templates.json');
export const reviewsFile = path.join(dataDir, 'reviews.json');
export const aiConfigFile = path.join(dataDir, 'ai-config.json');
export const aiUsageFile = path.join(dataDir, 'ai-usage.json');
export const tasksFile = path.join(dataDir, 'tasks.json');
export const settingsFile = path.join(dataDir, 'settings.json');
export const projectDocsFile = path.join(dataDir, 'project-documents.json');
export const templateFilesDir = path.join(dataDir, 'template-files');
export const logsDir = path.join(userDataPath, 'logs');
export const aiLogFile = path.join(logsDir, 'ai.log');
export const defaultWorkspacePath = path.join(userDataPath, 'projects');

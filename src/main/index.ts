import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Project, DocumentVersion, WritingTemplate, ReviewResult, ReviewIssue, ReviewConfig, AIConfig, TaskItem, AppSettings, ProjectDocument, SectionAnalysis, TemplateNode } from './types';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import * as JSZip from 'jszip';
import * as https from 'https';
import * as http from 'http';

let mainWindow: BrowserWindow | null = null;

// 文件夹监听器
const folderWatchers: Map<string, fs.FSWatcher> = new Map();

// 数据存储路径
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'project-manager-data');
const projectsFile = path.join(dataDir, 'projects.json');
const versionsFile = path.join(dataDir, 'versions.json');
const templatesFile = path.join(dataDir, 'templates.json');
const reviewsFile = path.join(dataDir, 'reviews.json');
const aiConfigFile = path.join(dataDir, 'ai-config.json');
const tasksFile = path.join(dataDir, 'tasks.json');
const settingsFile = path.join(dataDir, 'settings.json');
const projectDocsFile = path.join(dataDir, 'project-documents.json');
const templateFilesDir = path.join(dataDir, 'template-files');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 读取所有项目
function loadProjectsFromDisk(): Project[] {
  ensureDataDir();
  if (!fs.existsSync(projectsFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(projectsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存项目列表到磁盘
function saveProjectsToDisk(projects: Project[]) {
  ensureDataDir();
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2), 'utf-8');
}

// 读取所有版本
function loadVersionsFromDisk(): DocumentVersion[] {
  ensureDataDir();
  if (!fs.existsSync(versionsFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(versionsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存版本列表到磁盘
function saveVersionsToDisk(versions: DocumentVersion[]) {
  ensureDataDir();
  fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2), 'utf-8');
}

// 读取所有模板
function loadTemplatesFromDisk(): WritingTemplate[] {
  ensureDataDir();
  if (!fs.existsSync(templatesFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(templatesFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存模板列表到磁盘
function saveTemplatesToDisk(templates: WritingTemplate[]) {
  ensureDataDir();
  fs.writeFileSync(templatesFile, JSON.stringify(templates, null, 2), 'utf-8');
}

// 读取所有审查结果
function loadReviewsFromDisk(): ReviewResult[] {
  ensureDataDir();
  if (!fs.existsSync(reviewsFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(reviewsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存审查结果到磁盘
function saveReviewsToDisk(reviews: ReviewResult[]) {
  ensureDataDir();
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2), 'utf-8');
}

// 读取 AI 配置
function loadAIConfigFromDisk(): AIConfig | null {
  ensureDataDir();
  if (!fs.existsSync(aiConfigFile)) {
    return null;
  }
  try {
    const data = fs.readFileSync(aiConfigFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// 保存 AI 配置到磁盘
function saveAIConfigToDisk(config: AIConfig) {
  ensureDataDir();
  fs.writeFileSync(aiConfigFile, JSON.stringify(config, null, 2), 'utf-8');
}

// 读取所有任务
function loadTasksFromDisk(): TaskItem[] {
  ensureDataDir();
  if (!fs.existsSync(tasksFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(tasksFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存任务列表到磁盘
function saveTasksToDisk(tasks: TaskItem[]) {
  ensureDataDir();
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf-8');
}

// 默认工作区路径
const defaultWorkspacePath = path.join(userDataPath, 'projects');

// 读取设置
function loadSettingsFromDisk(): AppSettings {
  ensureDataDir();
  if (!fs.existsSync(settingsFile)) {
    return { workspacePath: defaultWorkspacePath, workspaceCapacity: 10 };
  }
  try {
    const data = fs.readFileSync(settingsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { workspacePath: defaultWorkspacePath, workspaceCapacity: 10 };
  }
}

// 递归计算目录大小（字节）
function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let totalSize = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirSize(fullPath);
      } else {
        try {
          totalSize += fs.statSync(fullPath).size;
        } catch {}
      }
    }
  } catch {}
  return totalSize;
}

// 保存设置
function saveSettingsToDisk(settings: AppSettings) {
  ensureDataDir();
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

// 读取项目文档
function loadProjectDocsFromDisk(): ProjectDocument[] {
  ensureDataDir();
  if (!fs.existsSync(projectDocsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(projectDocsFile, 'utf-8'));
  } catch { return []; }
}

// 保存项目文档
function saveProjectDocsToDisk(docs: ProjectDocument[]) {
  ensureDataDir();
  fs.writeFileSync(projectDocsFile, JSON.stringify(docs, null, 2), 'utf-8');
}

// ==================== 章节提取算法 ====================

// 中文数字映射
const cnNumMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };

// 检测标题行
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  // 匹配：一、 二、 第一章 1. 1、 (一) （1） 等
  return /^([一二三四五六七八九十十一十二]+[、.．）\)]|第[一-龥]{1,4}[章节部篇]|[\d]+[、.．）\)]|[\(（][\d一-龥]+[）\)])\s*\S/.test(trimmed);
}

// 从内容中提取章节
function extractSections(content: string): { title: string; content: string; startPos: number }[] {
  const lines = content.split('\n');
  const sections: { title: string; content: string; startPos: number }[] = [];
  let currentTitle = '';
  let currentContent = '';
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeadingLine(line)) {
      // 保存上一个章节
      if (currentTitle) {
        sections.push({ title: currentTitle.trim(), content: currentContent.trim(), startPos: currentStart });
      }
      currentTitle = line.trim();
      currentContent = '';
      currentStart = i;
    } else if (currentTitle) {
      currentContent += line + '\n';
    }
  }
  // 保存最后一个章节
  if (currentTitle) {
    sections.push({ title: currentTitle.trim(), content: currentContent.trim(), startPos: currentStart });
  }
  return sections;
}

// 模糊匹配章节标题
function matchHeading(extracted: string, templateTitle: string): boolean {
  const a = extracted.replace(/[\s　]/g, '').toLowerCase();
  const b = templateTitle.replace(/[\s　]/g, '').toLowerCase();
  return a.includes(b) || b.includes(a) || a === b;
}

// 递归获取所有模板节点（扁平化）
function flattenNodes(nodes: TemplateNode[]): TemplateNode[] {
  const result: TemplateNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children && node.children.length > 0) {
      result.push(...flattenNodes(node.children));
    }
  }
  return result;
}

// 基础分析（正则，无 AI）
function analyzeBasic(content: string, template: WritingTemplate): SectionAnalysis[] {
  const extracted = extractSections(content);
  const allNodes = flattenNodes(template.nodes);
  const results: SectionAnalysis[] = [];

  for (const node of allNodes) {
    const matched = extracted.find(e => matchHeading(e.title, node.title));
    if (matched) {
      const wordCount = matched.content.replace(/\s/g, '').length;
      results.push({
        nodeId: node.id,
        title: node.title,
        status: wordCount >= 50 ? 'completed' : wordCount > 0 ? 'partial' : 'missing',
        wordCount,
      });
    } else {
      results.push({
        nodeId: node.id,
        title: node.title,
        status: 'missing',
        wordCount: 0,
      });
    }
  }
  return results;
}

// HTTP 请求函数
function makeRequest(url: string, options: any, body?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 调用 Claude API
async function callClaudeAPI(config: AIConfig, prompt: string): Promise<string> {
  const url = config.endpoint || 'https://api.anthropic.com/v1/messages';
  const body = JSON.stringify({
    model: config.model || 'claude-3-sonnet-20240229',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
  };

  const result = await makeRequest(url, options, body);
  if (result.content && result.content[0]) {
    return result.content[0].text;
  }
  throw new Error(result.error?.message || 'Claude API 调用失败');
}

// 调用 OpenAI API
async function callOpenAIAPI(config: AIConfig, prompt: string): Promise<string> {
  const url = config.endpoint || 'https://api.openai.com/v1/chat/completions';
  const body = JSON.stringify({
    model: config.model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
  };

  const result = await makeRequest(url, options, body);
  if (result.choices && result.choices[0]) {
    return result.choices[0].message.content;
  }
  throw new Error(result.error?.message || 'OpenAI API 调用失败');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: '项目进度管理工具',
  });

  // 开发环境加载本地服务器，生产环境加载打包文件
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC 处理器
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择项目文件夹',
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('file:openInExplorer', async (_event: any, folderPath: string) => {
  await shell.openPath(folderPath);
});

// 用默认程序打开文件
ipcMain.handle('file:openWithDefaultApp', async (_event: any, filePath: string) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 删除文件
ipcMain.handle('file:delete', async (_event: any, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:read', async (_event: any, filePath: string) => {
  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('file:readDir', async (_event: any, dirPath: string) => {
  return fs.readdirSync(dirPath);
});

// 项目持久化
ipcMain.handle('project:save', async (_event: any, project: Project) => {
  const projects = loadProjectsFromDisk();
  const index = projects.findIndex(p => p.id === project.id);
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  saveProjectsToDisk(projects);
});

ipcMain.handle('project:loadAll', async () => {
  return loadProjectsFromDisk();
});

ipcMain.handle('project:delete', async (_event: any, projectId: string) => {
  const projects = loadProjectsFromDisk();
  const filtered = projects.filter(p => p.id !== projectId);
  saveProjectsToDisk(filtered);
});

// 文件选择对话框
ipcMain.handle('dialog:openFile', async (_event: any, filters?: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择文件',
    filters: filters || [
      { name: '文档文件', extensions: ['docx', 'pdf', 'txt'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

// 解析 Word 文档
ipcMain.handle('file:parseWord', async (_event: any, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return {
      success: true,
      content: result.value,
      fileName: path.basename(filePath),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
});

// 解析 PDF 文档
ipcMain.handle('file:parsePdf', async (_event: any, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return {
      success: true,
      content: data.text,
      fileName: path.basename(filePath),
      pages: data.numpages,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
});

// 版本操作
ipcMain.handle('version:save', async (_event: any, version: DocumentVersion) => {
  const versions = loadVersionsFromDisk();
  const index = versions.findIndex(v => v.id === version.id);
  if (index >= 0) {
    versions[index] = version;
  } else {
    versions.push(version);
  }
  saveVersionsToDisk(versions);
});

ipcMain.handle('version:loadAll', async () => {
  return loadVersionsFromDisk();
});

ipcMain.handle('version:delete', async (_event: any, versionId: string) => {
  const versions = loadVersionsFromDisk();
  const filtered = versions.filter(v => v.id !== versionId);
  saveVersionsToDisk(filtered);
});

// 模板操作
ipcMain.handle('template:save', async (_event: any, template: WritingTemplate) => {
  const templates = loadTemplatesFromDisk();
  const index = templates.findIndex(t => t.id === template.id);
  if (index >= 0) {
    templates[index] = template;
  } else {
    templates.push(template);
  }
  saveTemplatesToDisk(templates);
});

// 存储模板源文件（导入模板时调用）
ipcMain.handle('template:storeFile', async (_event: any, params: { templateId: string; sourcePath: string }) => {
  try {
    if (!fs.existsSync(templateFilesDir)) {
      fs.mkdirSync(templateFilesDir, { recursive: true });
    }
    const ext = path.extname(params.sourcePath);
    const destPath = path.join(templateFilesDir, `${params.templateId}${ext}`);
    fs.copyFileSync(params.sourcePath, destPath);
    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('template:loadAll', async () => {
  return loadTemplatesFromDisk();
});

ipcMain.handle('template:delete', async (_event: any, templateId: string) => {
  const templates = loadTemplatesFromDisk();
  const filtered = templates.filter(t => t.id !== templateId);
  saveTemplatesToDisk(filtered);
});

// 文档审查功能
ipcMain.handle('review:execute', async (_event: any, params: {
  versionId: string;
  templateId: string;
  config: ReviewConfig;
}) => {
  const versions = loadVersionsFromDisk();
  const templates = loadTemplatesFromDisk();

  const version = versions.find(v => v.id === params.versionId);
  const template = templates.find(t => t.id === params.templateId);

  if (!version || !template) {
    return { success: false, error: '版本或模板不存在' };
  }

  const issues: ReviewIssue[] = [];
  const content = version.content;

  // 检查缺失章节
  if (params.config.checkMissingSections) {
    for (const node of template.nodes) {
      const found = content.includes(node.title);
      if (node.isRequired && !found) {
        issues.push({
          id: `missing_${node.id}`,
          type: 'missing_section',
          severity: 'error',
          nodeId: node.id,
          sectionTitle: node.title,
          message: `缺少必需章节：${node.title}`,
          suggestion: `请添加"${node.title}"章节${node.description ? '，' + node.description : ''}`,
        });
      }
    }
  }

  // 计算得分
  const requiredNodes = template.nodes.filter(n => n.isRequired);
  const missingCount = issues.filter(i => i.type === 'missing_section').length;
  const score = requiredNodes.length > 0
    ? Math.round(((requiredNodes.length - missingCount) / requiredNodes.length) * 100)
    : 100;

  // 生成总结
  let summary = '';
  if (issues.length === 0) {
    summary = '文档结构完整，符合模板要求。';
  } else {
    summary = `发现 ${issues.length} 个问题，其中 ${missingCount} 个必需章节缺失。`;
  }

  const reviewResult: ReviewResult = {
    id: Date.now().toString(),
    projectId: version.projectId,
    versionId: params.versionId,
    templateId: params.templateId,
    issues,
    score,
    summary,
    createdAt: new Date().toISOString(),
  };

  // 保存审查结果
  const reviews = loadReviewsFromDisk();
  reviews.push(reviewResult);
  saveReviewsToDisk(reviews);

  return { success: true, result: reviewResult };
});

ipcMain.handle('review:loadAll', async () => {
  return loadReviewsFromDisk();
});

ipcMain.handle('review:delete', async (_event: any, reviewId: string) => {
  const reviews = loadReviewsFromDisk();
  const filtered = reviews.filter(r => r.id !== reviewId);
  saveReviewsToDisk(filtered);
});

// AI 配置操作
ipcMain.handle('ai:loadConfig', async () => {
  return loadAIConfigFromDisk();
});

ipcMain.handle('ai:saveConfig', async (_event: any, config: AIConfig) => {
  saveAIConfigToDisk(config);
});

// AI 调用
ipcMain.handle('ai:call', async (_event: any, prompt: string) => {
  const config = loadAIConfigFromDisk();
  if (!config || !config.apiKey) {
    throw new Error('请先配置 AI API 密钥');
  }

  try {
    if (config.provider === 'claude') {
      return await callClaudeAPI(config, prompt);
    } else if (config.provider === 'openai') {
      return await callOpenAIAPI(config, prompt);
    } else {
      throw new Error('不支持的 AI 提供商');
    }
  } catch (error: any) {
    throw new Error(`AI 调用失败: ${error.message}`);
  }
});

// AI 生成摘要
ipcMain.handle('ai:generateSummary', async (_event: any, content: string) => {
  const config = loadAIConfigFromDisk();
  if (!config || !config.apiKey) {
    return { success: false, error: '请先配置 AI API 密钥' };
  }

  const prompt = `请为以下文档内容生成一个简短的摘要（100-200字）：\n\n${content.substring(0, 3000)}`;

  try {
    let summary = '';
    if (config.provider === 'claude') {
      summary = await callClaudeAPI(config, prompt);
    } else if (config.provider === 'openai') {
      summary = await callOpenAIAPI(config, prompt);
    }
    return { success: true, summary };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// AI 审查建议
ipcMain.handle('ai:reviewSuggestion', async (_event: any, params: { content: string; template: string }) => {
  const config = loadAIConfigFromDisk();
  if (!config || !config.apiKey) {
    return { success: false, error: '请先配置 AI API 密钥' };
  }

  const prompt = `你是一个文档审查专家。请根据以下模板要求，审查文档内容并给出修改建议。

模板要求：
${params.template}

文档内容：
${params.content.substring(0, 3000)}

请指出：
1. 缺少的必要章节
2. 内容不完整或需要补充的部分
3. 格式或结构问题
4. 具体的修改建议`;

  try {
    let suggestions = '';
    if (config.provider === 'claude') {
      suggestions = await callClaudeAPI(config, prompt);
    } else if (config.provider === 'openai') {
      suggestions = await callOpenAIAPI(config, prompt);
    }
    return { success: true, suggestions };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 文件夹监听
ipcMain.handle('folder:startWatch', async (_event: any, params: { projectId: string; folderPath: string }) => {
  try {
    // 如果已经在监听，先停止
    if (folderWatchers.has(params.projectId)) {
      folderWatchers.get(params.projectId)?.close();
    }

    const watcher = fs.watch(params.folderPath, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;

      const ext = path.extname(filename).toLowerCase();
      const supportedExts = ['.docx', '.pdf', '.txt'];

      if (!supportedExts.includes(ext)) return;

      const filePath = path.join(params.folderPath, filename);

      // 检查文件是否存在（可能是删除操作）
      if (!fs.existsSync(filePath)) return;

      // 通知渲染进程有新文件
      if (mainWindow) {
        mainWindow.webContents.send('folder:fileDetected', {
          projectId: params.projectId,
          filePath,
          fileName: filename,
          fileType: ext.substring(1),
        });
      }
    });

    folderWatchers.set(params.projectId, watcher);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('folder:stopWatch', async (_event: any, projectId: string) => {
  try {
    if (folderWatchers.has(projectId)) {
      folderWatchers.get(projectId)?.close();
      folderWatchers.delete(projectId);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('folder:listFiles', async (_event: any, folderPath: string) => {
  try {
    const files = fs.readdirSync(folderPath);
    const supportedExts = ['.docx', '.pdf', '.txt'];
    const filteredFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return supportedExts.includes(ext);
    });
    return { success: true, files: filteredFiles };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 获取文件夹完整内容（含元数据）
ipcMain.handle('folder:getContents', async (_event: any, folderPath: string) => {
  try {
    if (!fs.existsSync(folderPath)) return { success: true, items: [] };
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const items = entries.map(entry => {
      const fullPath = path.join(folderPath, entry.name);
      let size = 0;
      let modifiedAt = '';
      try {
        const stat = fs.statSync(fullPath);
        size = entry.isDirectory() ? 0 : stat.size;
        modifiedAt = stat.mtime.toISOString();
      } catch {}
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        ext: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        size,
        modifiedAt,
        path: fullPath,
      };
    });
    // 目录在前，文件在后，各自按名称排序
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { success: true, items };
  } catch (error: any) {
    return { success: false, items: [], error: error.message };
  }
});

interface ScannedStageFile {
  name: string;
  path: string;
  ext: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
}

const stageScanExts = new Set(['.doc', '.docx', '.pdf', '.txt', '.ppt', '.pptx', '.xls', '.xlsx']);
const ignoredScanDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.cache']);

function scanStageFiles(folderPath: string, output: ScannedStageFile[] = []): ScannedStageFile[] {
  if (!fs.existsSync(folderPath)) return output;
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredScanDirs.has(entry.name)) scanStageFiles(fullPath, output);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!stageScanExts.has(ext)) continue;

    try {
      const stat = fs.statSync(fullPath);
      output.push({
        name: entry.name,
        path: fullPath,
        ext,
        size: stat.size,
        createdAt: (stat.birthtimeMs > 0 ? stat.birthtime : stat.ctime).toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {}
  }
  return output;
}

ipcMain.handle('folder:scanStageFiles', async (_event: any, folderPath: string) => {
  try {
    const files = scanStageFiles(folderPath)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { success: true, files };
  } catch (error: any) {
    return { success: false, files: [], error: error.message };
  }
});
// 任务操作
ipcMain.handle('task:save', async (_event: any, task: TaskItem) => {
  const tasks = loadTasksFromDisk();
  const index = tasks.findIndex(t => t.id === task.id);
  if (index >= 0) {
    tasks[index] = task;
  } else {
    tasks.push(task);
  }
  saveTasksToDisk(tasks);
});

ipcMain.handle('task:loadAll', async () => {
  return loadTasksFromDisk();
});

ipcMain.handle('task:delete', async (_event: any, taskId: string) => {
  const tasks = loadTasksFromDisk();
  const filtered = tasks.filter(t => t.id !== taskId);
  saveTasksToDisk(filtered);
});

// AI 执行任务
ipcMain.handle('task:executeAI', async (_event: any, params: { taskId: string; content: string; instruction: string }) => {
  const config = loadAIConfigFromDisk();
  if (!config || !config.apiKey) {
    return { success: false, error: '请先配置 AI API 密钥' };
  }

  const prompt = `你是一个文档处理助手。请根据以下指令处理文档内容：

指令：${params.instruction}

文档内容：
${params.content.substring(0, 3000)}

请直接输出处理后的内容，不要添加额外说明。`;

  try {
    let result = '';
    if (config.provider === 'claude') {
      result = await callClaudeAPI(config, prompt);
    } else if (config.provider === 'openai') {
      result = await callOpenAIAPI(config, prompt);
    }

    // 更新任务状态
    const tasks = loadTasksFromDisk();
    const taskIndex = tasks.findIndex(t => t.id === params.taskId);
    if (taskIndex >= 0) {
      tasks[taskIndex].status = 'completed';
      tasks[taskIndex].result = result;
      saveTasksToDisk(tasks);
    }

    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 设置操作
ipcMain.handle('settings:load', async () => {
  return loadSettingsFromDisk();
});

ipcMain.handle('settings:save', async (_event: any, settings: AppSettings) => {
  saveSettingsToDisk(settings);
});

// 获取工作区已用大小
ipcMain.handle('workspace:getSize', async (_event: any, workspacePath: string) => {
  try {
    const bytes = getDirSize(workspacePath);
    return { success: true, bytes };
  } catch (error: any) {
    return { success: true, bytes: 0 };
  }
});

// ==================== 项目文档操作 ====================

ipcMain.handle('projectDoc:save', async (_event: any, doc: ProjectDocument) => {
  const docs = loadProjectDocsFromDisk();
  const index = docs.findIndex(d => d.id === doc.id);
  if (index >= 0) {
    docs[index] = doc;
  } else {
    docs.push(doc);
  }
  saveProjectDocsToDisk(docs);
});

ipcMain.handle('projectDoc:loadAll', async () => {
  return loadProjectDocsFromDisk();
});

ipcMain.handle('projectDoc:delete', async (_event: any, docId: string) => {
  const docs = loadProjectDocsFromDisk();
  saveProjectDocsToDisk(docs.filter(d => d.id !== docId));
});

// 项目文档分析
ipcMain.handle('projectDoc:analyze', async (_event: any, params: {
  content: string;
  template: WritingTemplate;
  useAI?: boolean;
}) => {
  try {
    const { content, template, useAI } = params;

    // 基础分析
    const sections = analyzeBasic(content, template);

    // AI 深度分析
    if (useAI) {
      const config = loadAIConfigFromDisk();
      if (config && config.apiKey) {
        const extracted = extractSections(content);
        for (const section of sections) {
          if (section.status === 'missing') continue;
          const matched = extracted.find(e => matchHeading(e.title, section.title));
          if (!matched || matched.content.length < 10) continue;

          const prompt = `你是一个文档审查专家。请分析以下章节内容的完成度。

章节标题：${section.title}
章节内容（前1000字）：
${matched.content.substring(0, 1000)}

请评估：
1. 内容是否完整（completed/partial/missing）
2. 简短评语（30字以内）

请用 JSON 格式回复：{"status":"completed","comment":"评语"}`;

          try {
            let response = '';
            if (config.provider === 'claude') {
              response = await callClaudeAPI(config, prompt);
            } else if (config.provider === 'openai') {
              response = await callOpenAIAPI(config, prompt);
            }
            // 尝试解析 AI 回复
            const jsonMatch = response.match(/\{[^}]+\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.status) section.status = parsed.status;
              if (parsed.comment) section.aiComment = parsed.comment;
            }
          } catch {}
        }
      }
    }

    // 计算整体进度
    const total = sections.length;
    const completed = sections.filter(s => s.status === 'completed').length;
    const partial = sections.filter(s => s.status === 'partial').length;
    const overallProgress = total > 0
      ? Math.round(((completed + partial * 0.5) / total) * 100)
      : 0;

    return { success: true, sections, overallProgress };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 创建项目文件夹
ipcMain.handle('project:createFolder', async (_event: any, params: { projectName: string; workspacePath: string }) => {
  try {
    const { projectName, workspacePath } = params;

    // 确保工作区目录存在
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    // 生成文件夹名，处理重名
    let folderName = projectName;
    let folderPath = path.join(workspacePath, folderName);
    let counter = 1;
    while (fs.existsSync(folderPath)) {
      folderName = `${projectName}-${counter}`;
      folderPath = path.join(workspacePath, folderName);
      counter++;
    }

    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true, folderPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 列出目录下的子文件夹
ipcMain.handle('workspace:listFolders', async (_event: any, dirPath: string) => {
  try {
    if (!fs.existsSync(dirPath)) return { success: true, folders: [] };
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory()).map(e => e.name);
    return { success: true, folders };
  } catch (error: any) {
    return { success: false, folders: [], error: error.message };
  }
});

// 移动文件夹
ipcMain.handle('workspace:moveFolder', async (_event: any, params: { src: string; dest: string }) => {
  try {
    const { src, dest } = params;
    if (!fs.existsSync(src)) {
      return { success: false, error: '源文件夹不存在' };
    }
    // 确保目标父目录存在
    const destParent = path.dirname(dest);
    if (!fs.existsSync(destParent)) {
      fs.mkdirSync(destParent, { recursive: true });
    }
    fs.renameSync(src, dest);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 删除文件夹
ipcMain.handle('workspace:deleteFolder', async (_event: any, folderPath: string) => {
  try {
    if (!fs.existsSync(folderPath)) return { success: true };
    fs.rmSync(folderPath, { recursive: true, force: true });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 创建空白文件
ipcMain.handle('file:createBlank', async (_event: any, params: { folderPath: string; fileName: string; fileType: string }) => {
  try {
    const { folderPath, fileName, fileType } = params;
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const filePath = path.join(folderPath, `${fileName}.${fileType}`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8');
    }
    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 从模板创建文件（直接复制模板源文件并重命名）
ipcMain.handle('file:createFromTemplate', async (_event: any, params: { folderPath: string; fileName: string; template: WritingTemplate }) => {
  try {
    const { folderPath, fileName, template } = params;
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    if (!template.filePath || !fs.existsSync(template.filePath)) {
      return { success: false, error: '模板源文件不存在，请重新导入模板' };
    }

    const ext = path.extname(template.filePath);
    const destPath = path.join(folderPath, `${fileName}${ext}`);
    fs.copyFileSync(template.filePath, destPath);

    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// ========== ZIP 导入导出 ==========

// 递归添加文件夹到zip
function addFolderToZip(zip: JSZip, folderPath: string, basePath: string) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      addFolderToZip(zip, fullPath, basePath);
    } else {
      const content = fs.readFileSync(fullPath);
      zip.file(relativePath, content);
    }
  }
}

// 打开ZIP文件对话框
ipcMain.handle('dialog:openZip', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择 ZIP 文件',
    filters: [
      { name: 'ZIP 压缩包', extensions: ['zip'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

// 保存ZIP文件对话框
ipcMain.handle('dialog:saveZip', async () => {
  const result = await dialog.showSaveDialog({
    title: '导出项目为 ZIP',
    defaultPath: 'project-export.zip',
    filters: [
      { name: 'ZIP 压缩包', extensions: ['zip'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePath;
});

// 从ZIP导入项目
ipcMain.handle('project:importFromZip', async (_event: any, params: { zipPath: string; workspacePath: string }) => {
  try {
    const { zipPath, workspacePath } = params;

    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'ZIP 文件不存在' };
    }

    const buffer = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buffer);

    // 确定项目文件夹名（取ZIP文件名，去掉.zip后缀）
    const zipBaseName = path.basename(zipPath, '.zip');
    let projectFolderName = zipBaseName;

    // 检查是否只有一个顶级目录
    const rootEntries: string[] = [];
    zip.forEach((relativePath) => {
      const parts = relativePath.split('/');
      if (parts.length > 1 && parts[0]) {
        rootEntries.push(parts[0]);
      }
    });
    const uniqueRoots = [...new Set(rootEntries)];
    if (uniqueRoots.length === 1) {
      // 只有一个顶级目录，用它作为文件夹名
      projectFolderName = uniqueRoots[0];
    }

    // 在workspace中创建项目文件夹
    let folderPath = path.join(workspacePath, projectFolderName);
    if (fs.existsSync(folderPath)) {
      // 文件夹已存在，加后缀
      let i = 1;
      while (fs.existsSync(path.join(workspacePath, `${projectFolderName}-${i}`))) {
        i++;
      }
      projectFolderName = `${projectFolderName}-${i}`;
      folderPath = path.join(workspacePath, projectFolderName);
    }
    fs.mkdirSync(folderPath, { recursive: true });

    // 提取project.json（如果存在）
    let metadata: any = null;
    const projectJsonEntry = zip.file('project.json');
    if (projectJsonEntry) {
      const content = await projectJsonEntry.async('string');
      metadata = JSON.parse(content);
    }

    // 解压文件到项目文件夹（跳过project.json）
    let hasFiles = false;
    const filesToExtract: { path: string; data: any }[] = [];
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir || relativePath === 'project.json') return;

      // 去掉顶级目录前缀（如果有）
      let cleanPath = relativePath;
      if (uniqueRoots.length === 1 && cleanPath.startsWith(uniqueRoots[0] + '/')) {
        cleanPath = cleanPath.substring(uniqueRoots[0].length + 1);
      }
      if (!cleanPath) return;

      filesToExtract.push({ path: cleanPath, data: zipEntry });
    });

    for (const file of filesToExtract) {
      const fullPath = path.join(folderPath, file.path);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = await file.data.async('nodebuffer');
      fs.writeFileSync(fullPath, content);
      hasFiles = true;
    }

    if (!hasFiles && !metadata) {
      return { success: false, error: 'ZIP 文件为空，未找到任何项目文件' };
    }

    // 构建项目记录
    let project: any;
    if (metadata && metadata.project) {
      project = {
        ...metadata.project,
        id: Date.now().toString(),
        folderPath,
        updatedAt: new Date().toISOString(),
      };
    } else {
      project = {
        id: Date.now().toString(),
        name: projectFolderName,
        description: '',
        folderPath,
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 保存项目
    const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf-8')) as any[];
    projects.push(project);
    fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));

    // 如果有文档记录，也保存
    if (metadata && metadata.documents && Array.isArray(metadata.documents)) {
      const docs = JSON.parse(fs.readFileSync(projectDocsFile, 'utf-8')) as any[];
      for (const doc of metadata.documents) {
        docs.push({
          ...doc,
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          projectId: project.id,
          sourceFilePath: '', // 路径在不同机器上可能不同
        });
      }
      fs.writeFileSync(projectDocsFile, JSON.stringify(docs, null, 2));
    }

    return { success: true, project };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 导出项目为ZIP
ipcMain.handle('project:exportZip', async (_event: any, params: { project: any; savePath: string; projectDocs: any[] }) => {
  try {
    const { project, savePath, projectDocs } = params;

    if (!project.folderPath || !fs.existsSync(project.folderPath)) {
      return { success: false, error: '项目文件夹不存在' };
    }

    const zip = new JSZip();

    // 添加项目文件
    addFolderToZip(zip, project.folderPath, project.folderPath);

    // 添加project.json元数据
    const metadata = {
      version: 1,
      project,
      documents: projectDocs,
    };
    zip.file('project.json', JSON.stringify(metadata, null, 2));

    // 生成ZIP并写入文件
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(savePath, buffer);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});


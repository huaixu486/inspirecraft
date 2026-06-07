import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as zlib from 'zlib';
import { Project, DocumentVersion, WritingTemplate, ReviewResult, ReviewIssue, ReviewConfig, AIConfig, AIModelConfig, TaskItem, AppSettings, ProjectDocument, SectionAnalysis, TemplateNode } from './types';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
const JSZip = require('jszip');

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
    return normalizeAIConfig(JSON.parse(data));
  } catch {
    return null;
  }
}

// 保存 AI 配置到磁盘
function saveAIConfigToDisk(config: AIConfig) {
  ensureDataDir();
  fs.writeFileSync(aiConfigFile, JSON.stringify(normalizeAIConfig(config), null, 2), 'utf-8');
}

function normalizeAIConfig(config: AIConfig | null): AIConfig | null {
  if (!config) return null;
  if (Array.isArray(config.models) && config.models.length > 0) {
    const models = config.models.map((model, index) => ({
      ...model,
      id: model.id || `model-${Date.now()}-${index}`,
      name: model.name || model.model || `模型 ${index + 1}`,
      enabled: model.enabled !== false,
    }));
    const activeModelId = config.activeModelId && models.some(model => model.id === config.activeModelId)
      ? config.activeModelId
      : models[0].id;
    const parallelModelIds = (config.parallelModelIds || [activeModelId]).filter(id => models.some(model => model.id === id));
    return {
      models,
      activeModelId,
      parallelModelIds: parallelModelIds.length > 0 ? parallelModelIds : [activeModelId],
      multiModelMode: config.multiModelMode || 'single',
    };
  }

  if (config.provider && config.apiKey && config.model) {
    const legacyModel: AIModelConfig = {
      id: 'default',
      name: config.model,
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      endpoint: config.endpoint,
      enabled: true,
    };
    return {
      models: [legacyModel],
      activeModelId: legacyModel.id,
      parallelModelIds: [legacyModel.id],
      multiModelMode: 'single',
    };
  }

  return { models: [], multiModelMode: 'single' };
}

function getEnabledAIModels(config: AIConfig | null): AIModelConfig[] {
  return normalizeAIConfig(config)?.models?.filter(model => model.enabled !== false && model.apiKey && model.model) || [];
}

function getActiveAIModel(config: AIConfig | null, modelId?: string): AIModelConfig | null {
  const normalized = normalizeAIConfig(config);
  const models = getEnabledAIModels(normalized);
  if (models.length === 0) return null;
  return models.find(model => model.id === modelId)
    || models.find(model => model.id === normalized?.activeModelId)
    || models[0];
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
  if (!trimmed || trimmed.length > 120) return false;
  return /^([一二三四五六七八九十百千万零〇两]+[、.．）)]|第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇]|\d+(?:[.．-]\d+)*[、.．）)]?|[（(][一二三四五六七八九十百千万零〇两\d]+[）)])\s*\S/.test(trimmed);
}

function getHeadingLevel(line: string): number {
  const trimmed = line.trim();
  if (/^第[一二三四五六七八九十百千万零〇两\d]+[章篇部分]/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十百千万零〇两]+[、.．）)]/.test(trimmed)) return 1;
  const decimal = trimmed.match(/^\d+(?:[.．-]\d+)+/);
  if (decimal) return Math.min(decimal[0].split(/[.．-]/).length, 4);
  if (/^\d+[、.．）)]/.test(trimmed)) return 2;
  if (/^[（(][一二三四五六七八九十百千万零〇两\d]+[）)]/.test(trimmed)) return 3;
  return 2;
}

function stripHeadingPrefix(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇][、.．：:\s]*/, '')
    .replace(/^[一二三四五六七八九十百千万零〇两]+[、.．）)]\s*/, '')
    .replace(/^\d+(?:[.．-]\d+)*[、.．）)]?\s*/, '')
    .replace(/^[（(][一二三四五六七八九十百千万零〇两\d]+[）)]\s*/, '');
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function startsWithHeadingPattern(line: string): boolean {
  const trimmed = String(line || '').trim();
  return /^([一二三四五六七八九十百千万零〇两]+[、.．）)]|第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇]|\d+(?:[.．-]\d+)*[、.．）)]?|[（(][一二三四五六七八九十百千万零〇两\d]+[）)])\s*\S/.test(trimmed);
}

function normalizeHeadingForMatch(value: string): string {
  return stripHeadingPrefix(value)
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>]/g, '')
    .toLowerCase();
}

// 从内容中提取章节。一级章节会包含其下属子标题和正文，直到下一个同级/上级标题。
function extractSections(content: string): { title: string; content: string; startPos: number; level: number }[] {
  const lines = content.split('\n');
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index, level: getHeadingLevel(line) }))
    .filter(item => isHeadingLine(item.line));

  return headings.map((heading, headingIndex) => {
    const nextSameOrHigher = headings
      .slice(headingIndex + 1)
      .find(item => item.level <= heading.level);
    const end = nextSameOrHigher ? nextSameOrHigher.index : lines.length;
    return {
      title: heading.line,
      content: lines.slice(heading.index + 1, end).join('\n').trim(),
      startPos: heading.index,
      level: heading.level,
    };
  });
}

// 模糊匹配章节标题
function matchHeading(extracted: string, templateTitle: string): boolean {
  const a = normalizeHeadingForMatch(extracted);
  const b = normalizeHeadingForMatch(templateTitle);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || a === b;
}

function normalizeContentForSectionMatch(value: string): string {
  return String(value || '')
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>“”\"'‘’、.．]/g, '')
    .toLowerCase();
}

function countContentChars(value: string): number {
  return String(value || '').replace(/\s/g, '').length;
}

function parseWordLengthRequirement(text = ''): { minComplete: number; source: string } | null {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return null;

  const rangeMatch = normalized.match(/(\d{1,5})[~\-\u2014\uff0d\u81f3\u5230](\d{1,5})\u5b57/);
  if (rangeMatch) {
    const low = Math.min(Number(rangeMatch[1]), Number(rangeMatch[2]));
    if (low > 0) return { minComplete: Math.max(1, Math.floor(low * 0.85)), source: rangeMatch[0] };
  }

  const minMatch = normalized.match(/(?:\u4e0d\u5c11\u4e8e|\u4e0d\u4f4e\u4e8e|\u81f3\u5c11|\u5927\u4e8e|\u8d85\u8fc7)(\d{1,5})\u5b57/);
  if (minMatch) {
    const min = Number(minMatch[1]);
    if (min > 0) return { minComplete: Math.max(1, Math.floor(min * 0.9)), source: minMatch[0] };
  }

  const aroundMatch = normalized.match(/(?:\u7ea6|\u5927\u7ea6|\u5de6\u53f3)?(\d{1,5})\u5b57(?:\u5de6\u53f3|\u4e0a\u4e0b)?/);
  if (aroundMatch && !/(\u4e0d\u8d85\u8fc7|\u4e0d\u591a\u4e8e|\u4ee5\u5185|\u4ee5\u4e0b|\u4e4b\u5185)/.test(normalized.slice(Math.max(0, aroundMatch.index || 0) - 8, (aroundMatch.index || 0) + aroundMatch[0].length + 8))) {
    const target = Number(aroundMatch[1]);
    if (target > 0) return { minComplete: Math.max(1, Math.floor(target * 0.75)), source: aroundMatch[0] };
  }

  const maxMatch = normalized.match(/(?:\u4e0d\u8d85\u8fc7|\u4e0d\u591a\u4e8e|\u4ee5\u5185|\u4ee5\u4e0b|\u4e4b\u5185)(\d{1,5})\u5b57/);
  if (maxMatch) return { minComplete: 1, source: maxMatch[0] };

  return null;
}

function getSectionLengthRequirement(node: TemplateNode, template?: WritingTemplate): { minComplete: number; minPartial: number; source: string } {
  const textSources = [node.requirementText, node.description, template?.requirementText].filter(Boolean) as string[];
  for (const text of textSources) {
    const parsed = parseWordLengthRequirement(text);
    if (parsed) return { minComplete: parsed.minComplete, minPartial: Math.max(1, Math.floor(parsed.minComplete * 0.35)), source: '\u6a21\u677f\u8981\u6c42\uff1a' + parsed.source };
  }

  const exampleCount = countContentChars(node.exampleText || '');
  if (exampleCount > 0) {
    const minComplete = exampleCount <= 20 ? Math.max(1, Math.floor(exampleCount * 0.6)) : Math.max(10, Math.floor(exampleCount * 0.65));
    return { minComplete, minPartial: Math.max(1, Math.floor(minComplete * 0.35)), source: '\u8303\u6587\u53c2\u8003\u7ea6 ' + exampleCount + ' \u5b57' };
  }

  const title = node.title || '';
  if (/\u671f\u9650|\u65f6\u95f4|\u65e5\u671f|\u7ecf\u8d39|\u9650\u989d|\u5173\u952e\u8bcd|\u8054\u7cfb\u4eba|\u7535\u8bdd|\u90ae\u7bb1|\u7f16\u53f7|\u540d\u79f0|\u5355\u4f4d|\u91d1\u989d/.test(title)) {
    return { minComplete: 1, minPartial: 1, source: '\u77ed\u5b57\u6bb5\u7ae0\u8282' };
  }

  return { minComplete: 30, minPartial: 1, source: '\u9ed8\u8ba4\u77ed\u7ae0\u8282\u9608\u503c' };
}

function getSectionStatusByLength(wordCount: number, requirement: { minComplete: number; minPartial: number }): SectionAnalysis['status'] {
  if (wordCount <= 0) return 'missing';
  if (wordCount >= requirement.minComplete) return 'completed';
  if (wordCount >= requirement.minPartial) return 'partial';
  return 'missing';
}
function collectReviewEvidenceTerms(node: TemplateNode): string[] {
  const source = [node.title, node.requirementText, node.description]
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeContentForSectionMatch(source);
  const terms = new Set<string>();

  const preferredTerms = [
    '技术需求', '技术现状', '研究工作', '研究内容', '项目需求', '对应性', '应用场景', '典型场景',
    '移相器', '潮流控制', '运行策略', '工程经济性', '考核指标', '关键技术', '实施期限',
    '支持经费', '预期成果', '国内外', '创新', '示范应用', '电网', '新能源', '轻量化', '直驱浮空风力发电',
  ];
  preferredTerms.forEach(term => {
    const normalizedTerm = normalizeContentForSectionMatch(term);
    if (normalizedTerm && normalized.includes(normalizedTerm)) terms.add(normalizedTerm);
  });

  for (let size = 6; size >= 2; size--) {
    for (let index = 0; index <= normalized.length - size; index++) {
      const term = normalized.slice(index, index + size);
      if (/^\d+$/.test(term)) continue;
      if (/^(分析|研究|项目|内容|技术|需求|工作|说明|章节)$/.test(term)) continue;
      terms.add(term);
      if (terms.size >= 18) return [...terms];
    }
  }
  return [...terms];
}

function findEvidenceInContent(node: TemplateNode, normalizedContent: string) {
  const normalizedTitle = normalizeHeadingForMatch(node.title);
  if (normalizedTitle && normalizedContent.includes(normalizedTitle)) {
    return { matched: true, confidence: 1, terms: [normalizedTitle] };
  }

  const terms = collectReviewEvidenceTerms(node);
  const hitTerms = terms.filter(term => term.length >= 2 && normalizedContent.includes(term));
  const strongHits = hitTerms.filter(term => term.length >= 4);
  const confidence = terms.length ? hitTerms.length / Math.min(terms.length, 12) : 0;

  return {
    matched: strongHits.length >= 2 || hitTerms.length >= 4 || confidence >= 0.35,
    confidence,
    terms: hitTerms.slice(0, 6),
  };
}

function findLooseSectionContent(content: string, node: TemplateNode): string {
  const lines = content.split('\n');
  const strippedTemplateTitle = stripHeadingPrefix(node.title).trim();
  const normalizedTemplateTitle = normalizeHeadingForMatch(node.title);
  if (!normalizedTemplateTitle) return '';

  const startIndex = lines.findIndex(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const preview = trimmed.slice(0, 180);
    return matchHeading(preview, node.title)
      || normalizeContentForSectionMatch(preview).startsWith(normalizedTemplateTitle);
  });
  if (startIndex < 0) return '';

  const startLevel = startsWithHeadingPattern(lines[startIndex]) ? getHeadingLevel(lines[startIndex]) : node.level;
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (startsWithHeadingPattern(lines[index]) && getHeadingLevel(lines[index]) <= startLevel) {
      endIndex = index;
      break;
    }
  }

  const firstLine = lines[startIndex].trim();
  const firstLineWithoutPrefix = stripHeadingPrefix(firstLine);
  const startTitlePattern = strippedTemplateTitle
    ? new RegExp('^' + escapeRegExp(strippedTemplateTitle) + '[：:\\s　]*')
    : null;
  const sameLineContent = startTitlePattern
    ? firstLineWithoutPrefix.replace(startTitlePattern, '')
    : firstLineWithoutPrefix;
  return [sameLineContent, ...lines.slice(startIndex + 1, endIndex)].join('\n').trim();
}

function findSectionForTemplateNode(
  node: TemplateNode,
  extracted: { title: string; content: string; startPos: number; level: number }[],
  normalizedContent: string,
  rawContent = '',
): { title: string; content: string; startPos: number; level: number; matchedBy: 'heading' | 'content' | 'evidence'; evidenceTerms?: string[]; confidence?: number } | null {
  const headingMatch = extracted.find(section => matchHeading(section.title, node.title));
  if (headingMatch) return { ...headingMatch, matchedBy: 'heading', confidence: 1 };

  const looseContent = rawContent ? findLooseSectionContent(rawContent, node) : '';
  if (looseContent) {
    return {
      title: node.title,
      content: looseContent,
      startPos: -1,
      level: node.level,
      matchedBy: 'content',
      confidence: 0.9,
    };
  }

  const evidence = findEvidenceInContent(node, normalizedContent);
  if (evidence.matched) {
    return {
      title: node.title,
      content: '',
      startPos: -1,
      level: node.level,
      matchedBy: evidence.terms.length === 1 && evidence.confidence === 1 ? 'content' : 'evidence',
      evidenceTerms: evidence.terms,
      confidence: evidence.confidence,
    };
  }

  return null;
}

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
  const normalizedContent = normalizeContentForSectionMatch(content);
  const allNodes = flattenNodes(template.nodes);
  const results: SectionAnalysis[] = [];

  for (const node of allNodes) {
    const matched = findSectionForTemplateNode(node, extracted, normalizedContent, content);
    if (matched) {
      let wordCount = countContentChars(matched.content);
      const lengthRequirement = getSectionLengthRequirement(node, template);
      let status: SectionAnalysis['status'] = getSectionStatusByLength(wordCount, lengthRequirement);
      let aiComment: string | undefined;

      if (matched.matchedBy !== 'heading' && wordCount === 0) {
        wordCount = Math.max(1, Math.round((matched.confidence || 0.35) * 80));
        status = getSectionStatusByLength(wordCount, lengthRequirement);
        aiComment = matched.matchedBy === 'evidence'
          ? '依据关键词识别到对应内容：' + ((matched.evidenceTerms || []).join('、') || '相关内容')
          : '已在正文中识别到对应章节标题或内容。';
      } else if (matched.matchedBy !== 'heading') {
        aiComment = '\u5df2\u901a\u8fc7\u6b63\u6587\u5185\u5bb9\u5339\u914d\u5230\u8be5\u6a21\u677f\u7ae0\u8282\u3002';
      }
      if (status === 'partial') {
        aiComment = aiComment || '\u5f53\u524d\u7ea6 ' + wordCount + ' \u5b57\uff0c\u53c2\u8003\u6807\u51c6\uff1a' + lengthRequirement.source + '\uff0c\u5efa\u8bae\u8865\u81f3\u7ea6 ' + lengthRequirement.minComplete + ' \u5b57\u3002';
      } else if (status === 'completed' && lengthRequirement.source !== '\u9ed8\u8ba4\u77ed\u7ae0\u8282\u9608\u503c') {
        aiComment = aiComment || '\u5df2\u6ee1\u8db3\u5b57\u6570\u5224\u65ad\uff1a' + lengthRequirement.source + '\u3002';
      }

      results.push({
        nodeId: node.id,
        title: node.title,
        status,
        wordCount,
        aiComment,
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
    console.log(`[AI] Request: ${options?.method || 'GET'} ${url}`);
    const request = net.request({
      url,
      method: options?.method || 'GET',
    });

    Object.entries(options?.headers || {}).forEach(([key, value]) => {
      if (key !== 'Authorization') {
        request.setHeader(key, String(value));
      } else {
        // 只显示 apiKey 前8位
        const masked = String(value).replace(/Bearer (.*)/, (_, k) => `Bearer ${k.substring(0, 8)}...`);
        request.setHeader(key, masked);
      }
    });

    request.on('response', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`[AI] Response: ${res.statusCode} ${data.substring(0, 200)}`);
        let parsed: any = data;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        if (res.statusCode >= 400) {
          const message = parsed?.error?.message || parsed?.message || data || `HTTP ${res.statusCode}`;
          reject(new Error(`HTTP ${res.statusCode}: ${message}`));
          return;
        }
        resolve(parsed);
      });
    });

    request.on('error', (err) => {
      console.error(`[AI] Request error:`, err);
      reject(err);
    });
    if (body) request.write(body);
    request.end();
  });
}

function compactResponse(value: any, maxLength = 600): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return (raw || '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function getTextFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // 优先提取 text 类型的块
    const textParts = content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return '';
      })
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join('\n');

    // 如果没有 text 块，尝试提取所有非 thinking 块
    return content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item?.type === 'thinking') return '';
        return item?.text || item?.content || item?.value || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content?.text || content?.content || '';
}

function extractAIText(result: any): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.output_text === 'string') return result.output_text;
  if (typeof result.text === 'string') return result.text;
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) return getTextFromContent(result.content);

  const firstChoice = result.choices?.[0];
  if (firstChoice) {
    return getTextFromContent(firstChoice.message?.content)
      || getTextFromContent(firstChoice.delta?.content)
      || firstChoice.text
      || '';
  }

  if (Array.isArray(result.output)) {
    return result.output
      .map((item: any) => getTextFromContent(item.content) || item.text || '')
      .filter(Boolean)
      .join('\n');
  }

  if (result.data) return extractAIText(result.data);
  if (result.result) return extractAIText(result.result);
  return '';
}

function normalizeOpenAIEndpoint(endpoint?: string): string {
  const fallback = 'https://api.openai.com/v1/chat/completions';
  const raw = (endpoint || fallback).trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/v\d+$/i.test(normalized)) return `${normalized}/chat/completions`;
  return normalized;
}

function normalizeClaudeEndpoint(endpoint?: string): string {
  const fallback = 'https://api.anthropic.com/v1/messages';
  const raw = (endpoint || fallback).trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/\/+$/, '');
  if (/\/v\d+\/messages$/i.test(normalized) || /\/messages$/i.test(normalized)) return normalized;
  if (/\/v\d+$/i.test(normalized)) return `${normalized}/messages`;
  if (/\/anthropic$/i.test(normalized)) return `${normalized}/v1/messages`;
  return normalized;
}

// 调用 Claude API
async function callClaudeAPI(config: AIModelConfig, prompt: string): Promise<string> {
  const url = normalizeClaudeEndpoint(config.endpoint);
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
  const text = extractAIText(result);
  if (text) return text;
  throw new Error(result.error?.message || result.message || `Claude API 调用失败：响应中没有可读取文本（${url}）。响应：${compactResponse(result)}`);
}

// 调用 OpenAI API
async function callOpenAIAPI(config: AIModelConfig, prompt: string): Promise<string> {
  const url = normalizeOpenAIEndpoint(config.endpoint);
  console.log(`[AI] OpenAI call: url=${url}, model=${config.model || 'gpt-3.5-turbo'}, endpoint=${config.endpoint}`);
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
  console.log(`[AI] OpenAI result:`, JSON.stringify(result).substring(0, 500));
  const text = extractAIText(result);
  if (text) return text;
  throw new Error(result.error?.message || result.message || `OpenAI API 调用失败：响应中没有可读取文本（${url}）。响应：${compactResponse(result)}`);
}

async function callAIModel(config: AIModelConfig, prompt: string): Promise<string> {
  if (config.provider === 'claude') return callClaudeAPI(config, prompt);
  if (config.provider === 'custom' && /\/anthropic(?:\/|$)/i.test(config.endpoint || '')) {
    return callClaudeAPI(config, prompt);
  }
  if (config.provider === 'openai' || config.provider === 'custom') return callOpenAIAPI(config, prompt);
  throw new Error('不支持的 AI 提供商');
}

async function callDefaultAI(prompt: string, modelId?: string): Promise<string> {
  const model = getActiveAIModel(loadAIConfigFromDisk(), modelId);
  if (!model) throw new Error('请先配置至少一个可用 AI 模型');
  return callAIModel(model, prompt);
}

async function callParallelAI(prompt: string, modelIds?: string[]): Promise<string> {
  const config = normalizeAIConfig(loadAIConfigFromDisk());
  const enabledModels = getEnabledAIModels(config);
  const selectedIds = modelIds?.length ? modelIds : config?.parallelModelIds || [];
  const selectedModels = enabledModels.filter(model => selectedIds.includes(model.id));
  const models = selectedModels.length > 0 ? selectedModels : enabledModels.slice(0, 1);
  if (models.length === 0) throw new Error('请先配置至少一个可用 AI 模型');

  const results = await Promise.all(models.map(async model => {
    try {
      const output = await callAIModel(model, prompt);
      return `【${model.name}】\n${output}`;
    } catch (error: any) {
      return `【${model.name}】调用失败：${error.message}`;
    }
  }));
  return results.join('\n\n');
}

async function callConfiguredAI(prompt: string): Promise<string> {
  const config = normalizeAIConfig(loadAIConfigFromDisk());
  return config?.multiModelMode === 'parallel'
    ? callParallelAI(prompt, config.parallelModelIds)
    : callDefaultAI(prompt, config?.activeModelId);
}

async function callAIWithConfig(configValue: AIConfig, prompt: string, modelId?: string, modelIds?: string[], mode?: 'single' | 'parallel'): Promise<string> {
  const config = normalizeAIConfig(configValue);
  const enabledModels = getEnabledAIModels(config);
  if (enabledModels.length === 0) throw new Error('请先配置至少一个可用 AI 模型');

  if (mode === 'parallel') {
    const selectedIds = modelIds?.length ? modelIds : config?.parallelModelIds || [];
    const selectedModels = enabledModels.filter(model => selectedIds.includes(model.id));
    const models = selectedModels.length > 0 ? selectedModels : enabledModels.slice(0, 1);
    const results = await Promise.all(models.map(async model => {
      try {
        const output = await callAIModel(model, prompt);
        return `【${model.name}】\n${output}`;
      } catch (error: any) {
        return `【${model.name}】调用失败：${error.message}`;
      }
    }));
    return results.join('\n\n---\n\n');
  }

  const activeModel = enabledModels.find(model => model.id === modelId)
    || enabledModels.find(model => model.id === config?.activeModelId)
    || enabledModels[0];
  return callAIModel(activeModel, prompt);
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

ipcMain.handle('file:openInExplorer', async (_event: any, targetPath: string) => {
  try {
    if (!fs.existsSync(targetPath)) return { success: false, error: '路径不存在' };
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      shell.showItemInFolder(targetPath);
    } else {
      const error = await shell.openPath(targetPath);
      if (error) return { success: false, error };
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
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

let dragFileIconImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createDragIconPng(): Buffer {
  const width = 32;
  const height = 32;
  const rowSize = width * 4 + 1;
  const pixels = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    pixels[rowOffset] = 0; // PNG filter type: none
    for (let x = 0; x < width; x++) {
      const offset = rowOffset + 1 + x * 4;
      const border = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
      pixels[offset] = border ? 0x16 : 0xff;
      pixels[offset + 1] = border ? 0x77 : 0xff;
      pixels[offset + 2] = border ? 0xff : 0xff;
      pixels[offset + 3] = 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function getDragFileIcon() {
  if (dragFileIconImage && !dragFileIconImage.isEmpty()) return dragFileIconImage;
  dragFileIconImage = nativeImage.createFromBuffer(createDragIconPng());
  if (dragFileIconImage.isEmpty()) {
    throw new Error('拖拽图标创建失败');
  }
  return dragFileIconImage;
}

// 原生文件拖拽：同步 IPC 保证 startDrag 在 renderer dragstart 事件结束前执行
ipcMain.on('shell:startDrag', (event: any, filePath: string) => {
  try {
    if (!filePath) {
      event.returnValue = { success: false, error: '文件路径为空' };
      return;
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      event.returnValue = { success: false, error: '文件不存在' };
      return;
    }
    event.sender.startDrag({
      file: resolvedPath,
      icon: getDragFileIcon(),
    });
    event.returnValue = { success: true };
  } catch (error: any) {
    console.warn('Native file drag failed:', error);
    event.returnValue = { success: false, error: error?.message || '系统拖拽启动失败' };
  }
});

ipcMain.handle('file:rename', async (_event: any, params: { filePath: string; newName: string }) => {
  try {
    const { filePath, newName } = params;
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
    const safeName = path.basename(newName.trim());
    if (!safeName) return { success: false, error: '文件名不能为空' };
    if (safeName !== newName.trim()) return { success: false, error: '文件名不能包含路径' };
    const destPath = path.join(path.dirname(filePath), safeName);
    if (destPath === filePath) return { success: true, filePath };
    if (fs.existsSync(destPath)) return { success: false, error: '同名文件已存在' };
    fs.renameSync(filePath, destPath);
    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:importFiles', async (_event: any, params: { folderPath: string; filePaths: string[] }) => {
  try {
    const { folderPath, filePaths } = params;
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    const imported: { name: string; path: string }[] = [];
    for (const sourcePath of filePaths) {
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) continue;
      const ext = path.extname(sourcePath);
      const base = path.basename(sourcePath, ext);
      let destPath = path.join(folderPath, path.basename(sourcePath));
      let index = 1;
      while (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(sourcePath)) {
        destPath = path.join(folderPath, `${base} (${index})${ext}`);
        index += 1;
      }
      if (path.resolve(destPath) === path.resolve(sourcePath)) continue;
      fs.copyFileSync(sourcePath, destPath);
      imported.push({ name: path.basename(destPath), path: destPath });
    }
    return { success: true, files: imported };
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

const fallbackFontNames = [
  '宋体',
  '黑体',
  '微软雅黑',
  '仿宋',
  '楷体',
  '等线',
  'Arial',
  'Calibri',
  'Cambria',
  'Times New Roman',
];

function normalizeFontName(name: string): string {
  return name
    .replace(/\s*\((TrueType|OpenType|Type 1|Collection)\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function listInstalledFonts(): string[] {
  const fontNames = new Set<string>(fallbackFontNames);

  if (process.platform === 'win32') {
    try {
      const command = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
        encoding: 'utf8',
        windowsHide: true,
      });
      output.split(/\r?\n/).map(normalizeFontName).filter(Boolean).forEach(name => fontNames.add(name));
    } catch {}
  }

  return Array.from(fontNames).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

ipcMain.handle('system:listFonts', async () => {
  try {
    return { success: true, fonts: listInstalledFonts() };
  } catch (error: any) {
    return { success: false, fonts: fallbackFontNames, error: error.message };
  }
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
      { name: '文档文件', extensions: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'txt', 'md', 'rtf'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getXmlAttr(fragment: string, attrName: string): string {
  const match = fragment.match(new RegExp(`${attrName}="([^"]*)"`));
  return match?.[1] || '';
}

function getWordVal(fragment: string, tagName: string): string {
  const match = fragment.match(new RegExp(`<w:${tagName}\\b[^>]*w:val="([^"]*)"`, 'i'));
  return match?.[1] || '';
}

function extractReadableBinaryText(buffer: Buffer): string {
  const candidates = [buffer.toString('utf16le'), buffer.toString('utf8'), buffer.toString('latin1')]
    .map(value => normalizeExtractedText(
      value
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/\s]/g, ' ')
        .split(/\n| {2,}/)
        .map(line => line.trim())
        .filter(line => line.length >= 2)
        .join('\n')
    ))
    .filter(Boolean);
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

  const lines: string[] = [];
  for (const fileName of slideFiles) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const slideLines = Array.from(xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) as Iterable<RegExpMatchArray>)
      .map(match => normalizeExtractedText(decodeXmlText(match[1])))
      .filter(Boolean);
    if (slideLines.length > 0) lines.push(...slideLines);
  }
  return normalizeExtractedText(lines.join('\n'));
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedStringsXml
    ? Array.from(sharedStringsXml.matchAll(/<si\b[\s\S]*?<\/si>/g) as Iterable<RegExpMatchArray>).map(match => {
        const text = Array.from(match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) as Iterable<RegExpMatchArray>)
          .map(t => decodeXmlText(t[1]))
          .join('');
        return normalizeExtractedText(text);
      })
    : [];

  const sheetFiles = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/sheet(\d+)\.xml/i)?.[1] || 0));

  const lines: string[] = [];
  for (const fileName of sheetFiles) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const sheetLines: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g) as Iterable<RegExpMatchArray>) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g) as Iterable<RegExpMatchArray>) {
        const attrs = cellMatch[1] || '';
        const cellXml = cellMatch[2] || '';
        const type = getXmlAttr(attrs, 't');
        let value = '';
        if (type === 's') {
          const index = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || -1);
          value = sharedStrings[index] || '';
        } else if (type === 'inlineStr') {
          value = Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) as Iterable<RegExpMatchArray>)
            .map(match => decodeXmlText(match[1]))
            .join('');
        } else {
          value = decodeXmlText(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
        }
        const normalized = normalizeExtractedText(value);
        if (normalized) cells.push(normalized);
      }
      if (cells.length > 0) sheetLines.push(cells.join('  '));
    }
    if (sheetLines.length > 0) lines.push(...sheetLines);
  }
  return normalizeExtractedText(lines.join('\n'));
}

function chineseCounter(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 10) return value === 10 ? '十' : digits[value];
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const one = value % 10;
    return `${digits[ten]}十${one ? digits[one] : ''}`;
  }
  return String(value);
}

function romanCounter(value: number): string {
  const map: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let rest = value;
  let result = '';
  for (const [num, token] of map) {
    while (rest >= num) {
      result += token;
      rest -= num;
    }
  }
  return result || String(value);
}

function formatNumberByType(format: string, value: number): string {
  if (/chinese|japanese/i.test(format)) return chineseCounter(value);
  if (/lowerLetter/i.test(format)) return String.fromCharCode(96 + Math.max(1, Math.min(value, 26)));
  if (/upperLetter/i.test(format)) return String.fromCharCode(64 + Math.max(1, Math.min(value, 26)));
  if (/lowerRoman/i.test(format)) return romanCounter(value);
  if (/upperRoman/i.test(format)) return romanCounter(value).toUpperCase();
  return String(value);
}

async function extractDocxTextWithNumbering(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return '';
    const numberingXml = await zip.file('word/numbering.xml')?.async('string');

    const numToAbstract = new Map<string, string>();
    const levels = new Map<string, { format: string; text: string }>();
    if (numberingXml) {
      for (const numMatch of numberingXml.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g)) {
        const block = numMatch[0];
        const numId = getXmlAttr(block.match(/<w:num\b[^>]*>/)?.[0] || '', 'w:numId');
        const abstractNumId = getWordVal(block, 'abstractNumId');
        if (numId && abstractNumId) numToAbstract.set(numId, abstractNumId);
      }

      for (const abstractMatch of numberingXml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g)) {
        const block = abstractMatch[0];
        const abstractId = getXmlAttr(block.match(/<w:abstractNum\b[^>]*>/)?.[0] || '', 'w:abstractNumId');
        if (!abstractId) continue;
        for (const levelMatch of block.matchAll(/<w:lvl\b[\s\S]*?<\/w:lvl>/g)) {
          const levelBlock = levelMatch[0];
          const ilvl = getXmlAttr(levelBlock.match(/<w:lvl\b[^>]*>/)?.[0] || '', 'w:ilvl') || '0';
          levels.set(`${abstractId}:${ilvl}`, {
            format: getWordVal(levelBlock, 'numFmt'),
            text: decodeXmlText(getWordVal(levelBlock, 'lvlText')),
          });
        }
      }
    }

    const counters = new Map<string, number[]>();
    const lines: string[] = [];
    for (const paraMatch of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const paragraph = paraMatch[0];
      const text = normalizeExtractedText(
        Array.from(paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) as Iterable<RegExpMatchArray>)
          .map(match => decodeXmlText(match[1]))
          .join('')
      );
      if (!text) continue;

      const pPr = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
      const numPr = pPr.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/)?.[0] || '';
      const numId = getWordVal(numPr, 'numId');
      const ilvl = Number(getWordVal(numPr, 'ilvl') || '0');
      const sizes = Array.from(paragraph.matchAll(/<w:sz\b[^>]*w:val="(\d+)"/g) as Iterable<RegExpMatchArray>).map(match => Number(match[1]));
      const maxSize = sizes.length ? Math.max(...sizes) : 0;
      const isBold = /<w:b\b/.test(paragraph);
      const shouldRestoreNumber = Boolean(numId) && text.length <= 90 && (maxSize >= 28 || (isBold && maxSize >= 24));

      if (!shouldRestoreNumber) {
        lines.push(text);
        continue;
      }

      const abstractId = numToAbstract.get(numId);
      const level = abstractId ? levels.get(`${abstractId}:${ilvl}`) : undefined;
      const numCounters = counters.get(numId) || [];
      numCounters[ilvl] = (numCounters[ilvl] || 0) + 1;
      numCounters.length = ilvl + 1;
      counters.set(numId, numCounters);

      let label = '';
      if (level) {
        label = level.text || `%${ilvl + 1}`;
        label = label.replace(/%(\d+)/g, (_all, indexText) => {
          const refLevel = Number(indexText) - 1;
          const refValue = numCounters[refLevel] || 1;
          const refRule = abstractId ? levels.get(`${abstractId}:${refLevel}`) : undefined;
          return formatNumberByType(refRule?.format || level.format, refValue);
        });
        if (/chinese|japanese/i.test(level.format) && !/[、.．)）]/.test(label)) {
          label = `${formatNumberByType(level.format, numCounters[ilvl])}、`;
        }
      }

      lines.push(label && !text.startsWith(label) ? `${label} ${text}` : text);
    }

    return normalizeExtractedText(lines.join('\n'));
  } catch {
    return '';
  }
}
type ExtractedTemplateStyleKey = 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body' | 'caption' | 'tableTitle' | 'tableHeader';

interface ExtractedTemplateStyleSample {
  key: ExtractedTemplateStyleKey;
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
}

const styleKeyNames: Record<ExtractedTemplateStyleKey, string> = {
  heading1: '一级标题',
  heading2: '二级标题',
  heading3: '三级标题',
  heading4: '四级标题',
  body: '正文',
  caption: '图题/图例',
  tableTitle: '表题',
  tableHeader: '表头',
};

function xmlTextFromBlock(block: string): string {
  return normalizeExtractedText(
    Array.from(block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) as Iterable<RegExpMatchArray>)
      .map(match => decodeXmlText(match[1]))
      .join('')
  );
}

function parseStylePropsFromXml(xml: string): any {
  const fontFamily =
    xml.match(/<w:rFonts\b[^>]*(?:w:eastAsia|w:ascii|w:hAnsi)="([^"]+)"/)?.[1];
  const fontSizeRaw = xml.match(/<w:sz\b[^>]*w:val="(\d+)"/)?.[1];
  const lineRaw = xml.match(/<w:spacing\b[^>]*w:line="(\d+)"/)?.[1];
  const alignmentRaw = xml.match(/<w:jc\b[^>]*w:val="([^"]+)"/)?.[1];
  const alignmentMap: Record<string, string> = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', left: 'left' };
  return {
    fontFamily,
    fontSize: fontSizeRaw ? Number(fontSizeRaw) / 2 : undefined,
    fontWeight: /<w:b\b/.test(xml) ? 'bold' : undefined,
    alignment: alignmentRaw ? alignmentMap[alignmentRaw] : undefined,
    lineHeight: lineRaw ? Math.round((Number(lineRaw) / 240) * 100) / 100 : undefined,
  };
}

function parseStyleDefinitions(stylesXml?: string): Map<string, any> {
  const styles = new Map<string, any>();
  if (!stylesXml) return styles;
  for (const match of stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
    const block = match[0];
    const start = block.match(/<w:style\b[^>]*>/)?.[0] || '';
    const styleId = getXmlAttr(start, 'w:styleId');
    if (!styleId) continue;
    const name = decodeXmlText(getWordVal(block, 'name'));
    styles.set(styleId, { styleId, name, ...parseStylePropsFromXml(block) });
  }
  return styles;
}

function mergeStyleProps(base: any = {}, override: any = {}) {
  return {
    fontFamily: override.fontFamily || base.fontFamily,
    fontSize: override.fontSize || base.fontSize,
    fontWeight: override.fontWeight || base.fontWeight,
    alignment: override.alignment || base.alignment,
    lineHeight: override.lineHeight || base.lineHeight,
  };
}

function classifyTemplateText(text: string, styleId?: string, styleName?: string): ExtractedTemplateStyleKey {
  const normalized = text.trim();
  const styleText = `${styleId || ''} ${styleName || ''}`.toLowerCase();
  if (/heading\s*1|标题\s*1|标题 1|heading1/.test(styleText)) return 'heading1';
  if (/heading\s*2|标题\s*2|标题 2|heading2/.test(styleText)) return 'heading2';
  if (/heading\s*3|标题\s*3|标题 3|heading3/.test(styleText)) return 'heading3';
  if (/heading\s*4|标题\s*4|标题 4|heading4/.test(styleText)) return 'heading4';
  if (/caption|题注/.test(styleText)) return /^表/.test(normalized) ? 'tableTitle' : 'caption';
  if (/^(表|表格)\s*[\d一二三四五六七八九十]/.test(normalized)) return 'tableTitle';
  if (/^(图|图表|图例)\s*[\d一二三四五六七八九十]/.test(normalized)) return 'caption';
  if (/^(第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+[、.．])/.test(normalized)) return 'heading1';
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(normalized)) return 'heading2';
  if (/^\d+(?:[.．]\d+)+/.test(normalized)) return normalized.split(/[.．]/).length >= 3 ? 'heading3' : 'heading2';
  if (/^\d+[、.．)]/.test(normalized) && normalized.length < 80) return 'heading3';
  return 'body';
}

function mostCommon<T>(values: Array<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  values.filter(Boolean).forEach(value => counts.set(value as T, (counts.get(value as T) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function buildTemplateFormatRulesFromSamples(samples: ExtractedTemplateStyleSample[]) {
  const rules: Record<string, any> = {};
  const evidence: string[] = [];
  const keys: ExtractedTemplateStyleKey[] = ['heading1', 'heading2', 'heading3', 'heading4', 'body', 'caption', 'tableTitle', 'tableHeader'];
  keys.forEach(key => {
    const group = samples.filter(sample => sample.key === key);
    if (!group.length) return;
    const fontFamily = mostCommon(group.map(item => item.fontFamily));
    const fontSize = mostCommon(group.map(item => item.fontSize));
    const fontWeight = mostCommon(group.map(item => item.fontWeight));
    const alignment = mostCommon(group.map(item => item.alignment));
    const lineHeight = mostCommon(group.map(item => item.lineHeight));
    rules[key] = {
      fontRequirement: { fontFamily, fontSize, fontWeight, lineHeight },
      paragraphRequirement: { alignment },
    };
    evidence.push(`${styleKeyNames[key]}：${fontFamily || '未知字体'} ${fontSize || '未知字号'}pt${fontWeight === 'bold' ? ' 加粗' : ''}；样本「${group[0].text.slice(0, 36)}」`);
  });
  return { rules, evidence };
}

function describeTemplateStyleRule(rule: any): string {
  const font = rule?.fontRequirement || {};
  return [
    font.fontFamily,
    font.fontSize ? `${font.fontSize}pt` : '',
    font.fontWeight === 'bold' ? '加粗' : font.fontWeight === 'normal' ? '常规' : '',
  ].filter(Boolean).join(' ');
}

function compareTemplateFormatRules(expected: any = {}, actual: any = {}) {
  const labels: Record<string, string> = {
    heading1: '一级标题',
    heading2: '二级标题',
    heading3: '三级标题',
    heading4: '四级标题',
    body: '正文',
    caption: '图题/图例',
    tableTitle: '表题',
    tableHeader: '表头',
  };
  const issues: ReviewIssue[] = [];
  Object.entries(expected).forEach(([key, expectedRule]: [string, any]) => {
    const actualRule = actual?.[key];
    if (!actualRule) return;
    const expectedFont = expectedRule?.fontRequirement || {};
    const actualFont = actualRule?.fontRequirement || {};
    const mismatches: string[] = [];
    if (expectedFont.fontFamily && actualFont.fontFamily && expectedFont.fontFamily !== actualFont.fontFamily) {
      mismatches.push(`字体应为 ${expectedFont.fontFamily}，当前识别为 ${actualFont.fontFamily}`);
    }
    if (expectedFont.fontSize && actualFont.fontSize && Math.abs(Number(expectedFont.fontSize) - Number(actualFont.fontSize)) >= 0.5) {
      mismatches.push(`字号应为 ${expectedFont.fontSize}pt，当前识别为 ${actualFont.fontSize}pt`);
    }
    if (expectedFont.fontWeight && actualFont.fontWeight && expectedFont.fontWeight !== actualFont.fontWeight) {
      mismatches.push(`字重应为 ${expectedFont.fontWeight === 'bold' ? '加粗' : '常规'}，当前识别为 ${actualFont.fontWeight === 'bold' ? '加粗' : '常规'}`);
    }
    if (!mismatches.length) return;
    issues.push({
      id: `format_${key}_${issues.length}`,
      type: 'wrong_format',
      severity: key === 'body' ? 'warning' : 'info',
      sectionTitle: labels[key] || key,
      message: `${labels[key] || key}格式可能不一致：${mismatches.join('；')}`,
      suggestion: `模板要求：${describeTemplateStyleRule(expectedRule)}。请检查文档中${labels[key] || key}的实际格式。`,
    });
  });
  return issues;
}
async function extractDocxTemplateFormatRules(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const sourcePath = ext === '.doc' ? convertLegacyDocToDocx(filePath) : filePath;
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== '.docx') {
    return { success: false, error: ext === '.doc' ? '旧版 .doc 自动转换为 .docx 失败，请确认本机安装了 Microsoft Word 或 LibreOffice。' : '仅 .docx 支持读取实际段落和表格格式' };
  }
  const buffer = fs.readFileSync(sourcePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) return { success: false, error: '未找到 word/document.xml' };
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const styles = parseStyleDefinitions(stylesXml);
  const samples: ExtractedTemplateStyleSample[] = [];

  for (const match of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0];
    const text = xmlTextFromBlock(paragraph);
    if (!text || text.length > 600) continue;
    const pPr = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
    const styleId = getWordVal(pPr, 'pStyle');
    const style = styleId ? styles.get(styleId) : undefined;
    const runPr = paragraph.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const props = mergeStyleProps(style, mergeStyleProps(parseStylePropsFromXml(pPr), parseStylePropsFromXml(runPr)));
    const key = classifyTemplateText(text, styleId, style?.name);
    if (key === 'body' && (text.length < 30 || samples.filter(sample => sample.key === 'body').length >= 12)) continue;
    samples.push({ key, text, ...props });
  }

  for (const tableMatch of documentXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    const firstRow = tableMatch[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0];
    if (!firstRow) continue;
    for (const cellMatch of firstRow.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const cell = cellMatch[0];
      const text = xmlTextFromBlock(cell);
      if (!text) continue;
      const runPr = cell.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
      samples.push({ key: 'tableHeader', text, ...parseStylePropsFromXml(runPr) });
    }
  }

  const { rules, evidence } = buildTemplateFormatRulesFromSamples(samples);
  return { success: true, formatRules: rules, evidence, sampleCount: samples.length };
}

function stripRtf(value: string): string {
  return normalizeExtractedText(
    value
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+\d* ?/g, '')
      .replace(/[{}]/g, ' ')
  );
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function convertedDocxPathFor(filePath: string): string {
  ensureDataDir();
  const convertedDir = path.join(dataDir, 'converted-docx');
  if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir, { recursive: true });
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const safeBase = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*]+/g, '_').slice(0, 80);
  const stamp = stat ? `${Math.round(stat.mtimeMs)}-${stat.size}` : String(Date.now());
  return path.join(convertedDir, `${safeBase}-${stamp}.docx`);
}

function findLibreOfficeExecutable(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (candidate === 'soffice.exe' || fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function convertDocWithWordCom(filePath: string, targetPath: string): boolean {
  const command = `
$ErrorActionPreference = 'Stop'
$source = ${quotePowerShellString(filePath)}
$target = ${quotePowerShellString(targetPath)}
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($source, $false, $true)
  $doc.SaveAs2($target, 16)
} finally {
  if ($doc -ne $null) { $doc.Close($false) }
  if ($word -ne $null) { $word.Quit() }
}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
    });
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (error) {
    console.warn('Word COM doc conversion failed:', error);
    return false;
  }
}

function convertDocWithLibreOffice(filePath: string, targetPath: string): boolean {
  const soffice = findLibreOfficeExecutable();
  if (!soffice) return false;
  const outDir = path.dirname(targetPath);
  try {
    execFileSync(soffice, ['--headless', '--convert-to', 'docx', '--outdir', outDir, filePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
    });
    const generatedPath = path.join(outDir, `${path.basename(filePath, path.extname(filePath))}.docx`);
    if (fs.existsSync(generatedPath) && generatedPath !== targetPath) {
      fs.copyFileSync(generatedPath, targetPath);
    }
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (error) {
    console.warn('LibreOffice doc conversion failed:', error);
    return false;
  }
}

function convertLegacyDocToDocx(filePath: string): string | null {
  if (path.extname(filePath).toLowerCase() !== '.doc') return null;
  const targetPath = convertedDocxPathFor(filePath);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) return targetPath;
  if (convertDocWithWordCom(filePath, targetPath)) return targetPath;
  if (convertDocWithLibreOffice(filePath, targetPath)) return targetPath;
  return null;
}
function extractLegacyDocText(buffer: Buffer): string {
  const utf16 = normalizeExtractedText(buffer.toString('utf16le'));
  const utf8 = normalizeExtractedText(buffer.toString('utf8'));
  const best = utf16.length > utf8.length ? utf16 : utf8;
  return best
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && /[\u4e00-\u9fa5A-Za-z0-9]/.test(line))
    .join('\n');
}

function isReadableExtractedText(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  if (compact.length < 20) return false;
  const readable = compact.match(/[\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/]/g)?.length || 0;
  const replacement = compact.match(/�/g)?.length || 0;
  return readable / compact.length > 0.68 && replacement / compact.length < 0.05;
}

// 解析 Word 文档
ipcMain.handle('file:parseWord', async (_event: any, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    if (path.extname(filePath).toLowerCase() === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) {
        return {
          success: true,
          content: docxContent,
          fileName: path.basename(filePath),
        };
      }
    }
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

ipcMain.handle('file:extractTemplateFormatRules', async (_event: any, filePath: string) => {
  try {
    return await extractDocxTemplateFormatRules(filePath);
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('file:parseDocument', async (_event: any, filePath: string) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);

    if (ext === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) return { success: true, content: docxContent, fileName };
      const result = await mammoth.extractRawText({ buffer });
      return { success: true, content: normalizeExtractedText(result.value), fileName };
    }

    if (ext === '.doc') {
      const convertedPath = convertLegacyDocToDocx(filePath);
      if (convertedPath) {
        const convertedBuffer = fs.readFileSync(convertedPath);
        const docxContent = await extractDocxTextWithNumbering(convertedBuffer);
        if (docxContent) return { success: true, content: docxContent, fileName, convertedFilePath: convertedPath };
      }
      try {
        const result = await mammoth.extractRawText({ buffer });
        const content = normalizeExtractedText(result.value);
        if (content) return { success: true, content, fileName };
      } catch {}

      const content = extractLegacyDocText(buffer);
      if (!content || !isReadableExtractedText(content)) {
        return { success: false, error: '旧版 .doc 自动转换失败，且未提取到可读文本。请确认本机安装了 Microsoft Word 或 LibreOffice，或手动另存为 .docx。' };
      }
      return { success: true, content, fileName };
    }

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return { success: true, content: normalizeExtractedText(data.text), fileName, pages: data.numpages };
    }

    if (ext === '.pptx') {
      const content = await extractPptxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 PPTX 中提取到可识别文本' };
    }

    if (ext === '.xlsx') {
      const content = await extractXlsxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 Excel 中提取到可识别文本' };
    }

    if (ext === '.ppt' || ext === '.xls') {
      const content = extractReadableBinaryText(buffer);
      return content && isReadableExtractedText(content)
        ? { success: true, content, fileName }
        : { success: false, error: '旧版 .ppt/.xls 为二进制格式，未提取到可识别文本；建议另存为 .pptx/.xlsx 后导入' };
    }

    if (ext === '.rtf') {
      return { success: true, content: stripRtf(buffer.toString('utf8')), fileName };
    }

    if (ext === '.txt' || ext === '.md') {
      return { success: true, content: normalizeExtractedText(fs.readFileSync(filePath, 'utf-8')), fileName };
    }

    return { success: false, error: '不支持的文件格式' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:parseDocumentSilent', async (_event: any, filePath: string) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);

    if (ext === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) return { success: true, content: docxContent, fileName };
      const result = await mammoth.extractRawText({ buffer });
      return { success: true, content: normalizeExtractedText(result.value), fileName };
    }

    if (ext === '.doc') {
      const convertedPath = convertLegacyDocToDocx(filePath);
      if (convertedPath) {
        const convertedBuffer = fs.readFileSync(convertedPath);
        const docxContent = await extractDocxTextWithNumbering(convertedBuffer);
        if (docxContent) return { success: true, content: docxContent, fileName, convertedFilePath: convertedPath };
      }
      try {
        const result = await mammoth.extractRawText({ buffer });
        const content = normalizeExtractedText(result.value);
        if (content) return { success: true, content, fileName };
      } catch {}

      const content = extractLegacyDocText(buffer);
      if (content && isReadableExtractedText(content)) {
        return { success: true, content, fileName };
      }
      return { success: false, error: '旧版 .doc 自动转换失败，且未提取到可读文本。请确认本机安装了 Microsoft Word 或 LibreOffice，或手动另存为 .docx。' };
    }

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return { success: true, content: normalizeExtractedText(data.text), fileName, pages: data.numpages };
    }

    if (ext === '.pptx') {
      const content = await extractPptxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 PPTX 中提取到可识别文本' };
    }

    if (ext === '.xlsx') {
      const content = await extractXlsxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 Excel 中提取到可识别文本' };
    }

    if (ext === '.ppt' || ext === '.xls') {
      const content = extractReadableBinaryText(buffer);
      return content && isReadableExtractedText(content)
        ? { success: true, content, fileName }
        : { success: false, error: '旧版 .ppt/.xls 为二进制格式，未提取到可识别文本；建议另存为 .pptx/.xlsx 后导入' };
    }

    if (ext === '.rtf') {
      return { success: true, content: stripRtf(buffer.toString('utf8')), fileName };
    }

    if (ext === '.txt' || ext === '.md') {
      return { success: true, content: normalizeExtractedText(fs.readFileSync(filePath, 'utf-8')), fileName };
    }

    return { success: false, error: '不支持的文件格式' };
  } catch (error: any) {
    return { success: false, error: error.message };
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
  const allTemplateNodes = flattenNodes(template.nodes);
  const extractedSections = extractSections(content);
  const normalizedContent = normalizeContentForSectionMatch(content);
  const sectionMatches = new Map<string, ReturnType<typeof findSectionForTemplateNode>>();
  const getSectionMatch = (node: TemplateNode) => {
    if (!sectionMatches.has(node.id)) {
      sectionMatches.set(node.id, findSectionForTemplateNode(node, extractedSections, normalizedContent, content));
    }
    return sectionMatches.get(node.id) || null;
  };

  // 检查缺失章节：复用项目文档完成度的章节提取与模糊匹配，避免因编号、空格、标点或 Word 解析换行误判。
  if (params.config.checkMissingSections) {
    for (const node of allTemplateNodes) {
      if (!node.isRequired) continue;
      const matched = getSectionMatch(node);
      if (!matched) {
        issues.push({
          id: `missing_${node.id}`,
          type: 'missing_section',
          severity: 'error',
          nodeId: node.id,
          sectionTitle: node.title,
          message: `未识别到必需章节：${node.title}`,
          suggestion: `请确认正文中是否有"${node.title}"对应标题或内容；如已有内容，请检查标题编号、标题文字是否与模板结构可对应。${node.description ? ' ' + node.description : ''}`,
        });
      } else if (matched.matchedBy === 'evidence') {
        issues.push({
          id: `section_mapping_${node.id}`,
          type: 'suggestion',
          severity: 'info',
          nodeId: node.id,
          sectionTitle: node.title,
          message: `正文中发现与「${node.title}」相关的内容证据，未按缺失处理。`,
          suggestion: `建议人工确认该内容是否对应模板章节。匹配关键词：${(matched.evidenceTerms || []).join('、') || '相关内容'}。`,
        });
      }
    }
  }

  if (params.config.checkContentDeviation) {
    for (const node of allTemplateNodes) {
      if (!node.isRequired) continue;
      const matched = getSectionMatch(node);
      if (!matched || matched.matchedBy !== 'heading') continue;
      const wordCount = countContentChars(matched.content);
      const lengthRequirement = getSectionLengthRequirement(node, template);
      if (wordCount > 0 && wordCount < lengthRequirement.minComplete) {
        issues.push({
          id: `content_short_${node.id}`,
          type: 'content_deviation',
          severity: 'warning',
          nodeId: node.id,
          sectionTitle: node.title,
          message: `\u7ae0\u8282\u5185\u5bb9\u53ef\u80fd\u504f\u5c11\uff1a${node.title}\uff08\u7ea6 ${wordCount} \u5b57\uff0c\u53c2\u8003\u6807\u51c6\uff1a${lengthRequirement.source}\uff0c\u5efa\u8bae\u7ea6 ${lengthRequirement.minComplete} \u5b57\uff09`,
          suggestion: node.requirementText || node.description
            ? `请对照模板要求补充该章节：${node.requirementText || node.description}`
            : `\u8bf7\u786e\u8ba4\u8be5\u7ae0\u8282\u662f\u5426\u9700\u8981\u8865\u5145\u4e8b\u5b9e\u3001\u6570\u636e\u3001\u4f9d\u636e\u6216\u5c55\u5f00\u8bf4\u660e\uff1b\u5f53\u524d\u53c2\u8003\u6807\u51c6\u4e3a\uff1a${lengthRequirement.source}\u3002`,
        });
      }
    }
  }

  if (params.config.checkFormatting && template.formatRules && ['.docx', '.doc'].includes(path.extname(version.filePath || '').toLowerCase())) {
    try {
      const formatResult: any = await extractDocxTemplateFormatRules(version.filePath);
      if (formatResult.success && formatResult.formatRules) {
        issues.push(...compareTemplateFormatRules(template.formatRules, formatResult.formatRules));
      }
    } catch (error) {
      console.warn('Format review failed:', error);
    }
  }

  // 计算得分
  const requiredNodes = allTemplateNodes.filter(n => n.isRequired);
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

  let aiSuggestions: string | undefined;
  if (params.config.enableAI && getActiveAIModel(loadAIConfigFromDisk())) {
    try {
      const issueText = issues.length
        ? issues.map(issue => `- [${issue.severity}] ${issue.sectionTitle || ''}：${issue.message}${issue.suggestion ? `；建议：${issue.suggestion}` : ''}`).join('\n')
        : '当前未发现结构性问题。';
      const requiredOutline = allTemplateNodes
        .filter(node => node.isRequired)
        .map(node => `- ${node.title}${node.requirementText || node.description ? `：${node.requirementText || node.description}` : ''}`)
        .join('\n');
      aiSuggestions = await callDefaultAI(`你是文档审查与改稿助手。请严格按模板章节输出审查建议。\n\n目标：模板里有多个结构章节，例如“一、总体目标”“二、研究内容”。只输出存在问题或需要优化的章节；没有问题的章节不要输出。每个章节下面固定包含“问题”和“建议”。\n\n输出格式（必须严格遵守，不要添加其他标题、总体评估、寒暄或结尾）：\n## 一、章节名称\n问题：\n- 用一句话说明该章节的核心问题。\n- 如有第二个问题，再用一句话说明。\n建议：\n- 给出一条可执行修改建议。\n- 如需补写正文，给出一条简短参考句式；缺少事实数据时写“需人工补充：...”。\n\n规则：\n1. 只输出有问题或需要优化的模板章节。\n2. 章节标题必须尽量使用模板中的原始章节名。\n3. 每个章节必须同时包含“问题：”和“建议：”。\n4. 每个章节的问题最多 2 条，建议最多 3 条，每条不超过 80 字。\n5. 不要把程序已经模糊匹配到的章节重新判定为缺失；如果标题写法不同，只说明它与模板章节如何对应。\n6. 建议要围绕当前正文和模板要求，避免泛泛而谈。\n7. 不要输出长段落、引用块、成段示例、总体评估、“以下是建议”“好的”等非章节内容。\n\n模板必需章节：\n${requiredOutline || '无'}\n\n程序审查结果：\n${issueText}\n\n正文摘录：\n${content.slice(0, 6000)}`);
    } catch (error) {
      console.warn('AI review suggestion failed:', error);
    }
  }

  const reviewResult: ReviewResult = {
    id: Date.now().toString(),
    projectId: version.projectId,
    versionId: params.versionId,
    templateId: params.templateId,
    issues,
    score,
    summary,
    aiSuggestions,
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
ipcMain.handle('ai:call', async (_event: any, prompt: string | { prompt: string; modelId?: string; modelIds?: string[]; mode?: 'single' | 'parallel'; config?: AIConfig }) => {
  try {
    if (typeof prompt === 'string') return await callConfiguredAI(prompt);
    if (prompt.config) {
      return await callAIWithConfig(prompt.config, prompt.prompt, prompt.modelId, prompt.modelIds, prompt.mode);
    }
    return prompt.mode === 'parallel'
      ? await callParallelAI(prompt.prompt, prompt.modelIds)
      : await callDefaultAI(prompt.prompt, prompt.modelId);
  } catch (error: any) {
    throw new Error(`AI 调用失败: ${error.message}`);
  }
});

// AI 生成摘要
ipcMain.handle('ai:generateSummary', async (_event: any, content: string) => {
  const prompt = `请为以下文档内容生成一个简短的摘要（100-200字）：\n\n${content.substring(0, 3000)}`;

  try {
    const summary = await callConfiguredAI(prompt);
    return { success: true, summary };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// AI 审查建议
ipcMain.handle('ai:reviewSuggestion', async (_event: any, params: { content: string; template: string }) => {
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
    const suggestions = await callConfiguredAI(prompt);
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
  const prompt = `你是一个文档处理助手。请根据以下指令处理文档内容：

指令：${params.instruction}

文档内容：
${params.content.substring(0, 3000)}

请直接输出处理后的内容，不要添加额外说明。`;

  try {
    const result = await callConfiguredAI(prompt);

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
      if (getActiveAIModel(loadAIConfigFromDisk())) {
        const extracted = extractSections(content);
        const allTemplateNodes = flattenNodes(template.nodes);
        for (const section of sections) {
          if (section.status === 'missing') continue;
          const matched = extracted.find(e => matchHeading(e.title, section.title));
          if (!matched || matched.content.length < 10) continue;
          const templateNode = allTemplateNodes.find(node => node.id === section.nodeId);
          const requirement = templateNode?.description?.trim();

          const prompt = `你是一个文档审查专家。请分析以下章节内容的完成度。

章节标题：${section.title}
${requirement ? `模板要求：\n${requirement}\n` : ''}
章节内容（前1000字）：
${matched.content.substring(0, 1000)}

请评估：
1. 内容是否满足模板要求，状态为 completed/partial/missing
2. 简短评语（30字以内）

请用 JSON 格式回复：{"status":"completed","comment":"评语"}`;

          try {
            const response = await callConfiguredAI(prompt);
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
    const normalizedType = normalizeFileType(fileType);
    const filePath = path.join(folderPath, `${fileName}.${normalizedType}`);
    if (!fs.existsSync(filePath)) {
      await createFileByType(filePath, normalizedType);
    }
    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 从模板创建文件（直接复制模板源文件并重命名）
ipcMain.handle('file:createFromTemplate', async (_event: any, params: { folderPath: string; fileName: string; template: WritingTemplate; fileType?: string }) => {
  try {
    const { folderPath, fileName, template } = params;
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const outputFileType = normalizeFileType(params.fileType || template.outputFileType || 'docx');
    const outputExt = `.${outputFileType}`;

    if (!template.filePath || !fs.existsSync(template.filePath)) {
      const destPath = path.join(folderPath, `${fileName}${outputExt}`);
      if (!fs.existsSync(destPath)) {
        await createFileByType(destPath, outputFileType, template);
      }
      return { success: true, filePath: destPath };
    }

    const sourceExt = path.extname(template.filePath).toLowerCase();
    const destPath = path.join(folderPath, `${fileName}${outputExt}`);
    if (sourceExt === outputExt.toLowerCase() && outputFileType !== 'docx') {
      fs.copyFileSync(template.filePath, destPath);
    } else {
      await createFileByType(destPath, outputFileType, template);
    }

    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// ========== ZIP 导入导出 ==========

// 递归添加文件夹到zip
function addFolderToZip(zip: any, folderPath: string, basePath: string) {
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

function escapeXml(value: string = ''): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeFileType(fileType?: string): string {
  return (fileType || 'docx').replace(/^\./, '').toLowerCase();
}

function styleRuleFromTemplate(template?: WritingTemplate, key: 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body' = 'body') {
  const fallbackTitle = template?.titleFontRequirement || {};
  const fallbackBody = template?.bodyFontRequirement || {};
  const isHeading = key.startsWith('heading');
  return template?.formatRules?.[key] || {
    fontRequirement: isHeading ? fallbackTitle : fallbackBody,
    paragraphRequirement: {},
  };
}

function fontSizeToHalfPoints(size?: number, fallback = 12): number {
  return Math.round((size || fallback) * 2);
}

function pointsToTwips(value?: number): number {
  return Math.round((value || 0) * 20);
}

function lineHeightToWordLine(value?: number): number {
  return Math.round((value || 1.5) * 240);
}

function flattenTemplateNodes(nodes: TemplateNode[], output: TemplateNode[] = []): TemplateNode[] {
  for (const node of nodes || []) {
    output.push(node);
    if (node.children?.length) flattenTemplateNodes(node.children, output);
  }
  return output;
}

function buildWordStyle(styleId: string, name: string, rule: ReturnType<typeof styleRuleFromTemplate>, defaults: { font: string; size: number; bold?: boolean }) {
  const font = rule.fontRequirement || {};
  const paragraph = rule.paragraphRequirement || {};
  const fontFamily = escapeXml(font.fontFamily || defaults.font);
  const size = fontSizeToHalfPoints(font.fontSize, defaults.size);
  const color = (font.color || '#000000').replace('#', '');
  const bold = font.fontWeight === 'bold' || defaults.bold;
  const italic = font.fontStyle === 'italic';
  const spacing = font.letterSpacing ? `<w:spacing w:val="${pointsToTwips(font.letterSpacing)}"/>` : '';
  const align = paragraph.alignment ? `<w:jc w:val="${paragraph.alignment}"/>` : '';
  const firstLine = paragraph.indentFirstLine ? `<w:ind w:firstLineChars="${Math.round(paragraph.indentFirstLine * 100)}"/>` : '';

  return `
    <w:style w:type="paragraph" w:styleId="${styleId}">
      <w:name w:val="${escapeXml(name)}"/>
      <w:qFormat/>
      <w:pPr>
        ${align}
        ${firstLine}
        <w:spacing w:before="${pointsToTwips(paragraph.spaceBefore)}" w:after="${pointsToTwips(paragraph.spaceAfter)}" w:line="${lineHeightToWordLine(font.lineHeight)}" w:lineRule="auto"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}" w:eastAsia="${fontFamily}"/>
        ${bold ? '<w:b/><w:bCs/>' : ''}
        ${italic ? '<w:i/><w:iCs/>' : ''}
        ${spacing}
        <w:color w:val="${color}"/>
        <w:sz w:val="${size}"/>
        <w:szCs w:val="${size}"/>
      </w:rPr>
    </w:style>`;
}

function buildWordStylesXml(template?: WritingTemplate): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  ${buildWordStyle('Normal', '正文', styleRuleFromTemplate(template, 'body'), { font: '宋体', size: 12 })}
  ${buildWordStyle('Heading1', '标题 1', styleRuleFromTemplate(template, 'heading1'), { font: '黑体', size: 16, bold: true })}
  ${buildWordStyle('Heading2', '标题 2', styleRuleFromTemplate(template, 'heading2'), { font: '黑体', size: 15, bold: true })}
  ${buildWordStyle('Heading3', '标题 3', styleRuleFromTemplate(template, 'heading3'), { font: '黑体', size: 14, bold: true })}
  ${buildWordStyle('Heading4', '标题 4', styleRuleFromTemplate(template, 'heading4'), { font: '黑体', size: 12, bold: true })}
</w:styles>`;
}

function buildWordDocumentXml(template?: WritingTemplate): string {
  const nodes = flattenTemplateNodes(template?.nodes || []);
  const paragraphs = nodes.length > 0
    ? nodes.map(node => {
      const level = Math.min(Math.max(node.level || 1, 1), 4);
      const headingXml = `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${escapeXml(node.title)}</w:t></w:r></w:p>`;
      // 输出节点的描述/原始内容作为正文段落
      const bodyText = node.description || node.requirementText || '';
      if (!bodyText) return headingXml;
      const bodyParagraphs = bodyText.split('\n').filter(line => line.trim()).map(line =>
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${escapeXml(line.trim())}</w:t></w:r></w:p>`
      ).join('');
      return headingXml + bodyParagraphs;
    }).join('')
    : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>新建文档</w:t></w:r></w:p>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

async function writeDocxFile(filePath: string, template?: WritingTemplate) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word')?.file('document.xml', buildWordDocumentXml(template));
  zip.folder('word')?.file('styles.xml', buildWordStylesXml(template));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

async function writePptxFile(filePath: string, template?: WritingTemplate) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.folder('ppt')?.file('presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
</p:presentation>`);
  zip.folder('ppt')?.folder('_rels')?.file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
  const title = escapeXml(template?.name || '新建演示文稿');
  zip.folder('ppt')?.folder('slides')?.file('slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3200" b="1"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

async function writeXlsxFile(filePath: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.folder('xl')?.folder('worksheets')?.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

function writeRtfCompatibleFile(filePath: string) {
  fs.writeFileSync(filePath, '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0 SimSun;}}\\f0\\fs24\\par}', 'utf-8');
}

function writePdfFile(filePath: string) {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj
4 0 obj<</Length 0>>stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000208 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
257
%%EOF`;
  fs.writeFileSync(filePath, pdf, 'utf-8');
}

async function createFileByType(filePath: string, fileType: string, template?: WritingTemplate) {
  const normalized = normalizeFileType(fileType);
  if (normalized === 'docx') {
    await writeDocxFile(filePath, template);
    return;
  }
  if (normalized === 'pptx') {
    await writePptxFile(filePath, template);
    return;
  }
  if (normalized === 'xlsx') {
    await writeXlsxFile(filePath);
    return;
  }
  if (normalized === 'doc' || normalized === 'rtf') {
    writeRtfCompatibleFile(filePath);
    return;
  }
  if (normalized === 'pdf') {
    writePdfFile(filePath);
    return;
  }
  fs.writeFileSync(filePath, '', 'utf-8');
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
ipcMain.handle('dialog:saveZip', async (_event: any, projectName: string) => {
  const defaultName = projectName ? `${projectName}.zip` : 'project-export.zip';
  const result = await dialog.showSaveDialog({
    title: '导出项目为 ZIP',
    defaultPath: defaultName,
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
    zip.forEach((relativePath: string) => {
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
    zip.forEach((relativePath: string, zipEntry: any) => {
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

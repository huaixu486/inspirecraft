import React, { useEffect, useState } from 'react';
import {
  Card,
  Button,
  List,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Tag,
  message,
  Empty,
  Popconfirm,
  Divider,
  ColorPicker,
  AutoComplete,
  InputNumber,
  Switch,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HolderOutlined,
  ImportOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { WritingTemplate, TemplateNode, StageConfig, TemplateOutputFileType, TemplateFormatRules } from '../../shared/types';
import { getAllStages, getGlobalStageProgress } from '../../utils/timelineStages';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';

const { Title, Text } = Typography;
const { TextArea } = Input;

const templateFileTypeOptions: { value: TemplateOutputFileType; label: string }[] = [
  { value: 'docx', label: 'Word 文档 (.docx)' },
  { value: 'doc', label: 'Word 97-2003 (.doc)' },
  { value: 'pptx', label: 'PowerPoint 演示文稿 (.pptx)' },
  { value: 'xlsx', label: 'Excel 工作簿 (.xlsx)' },
  { value: 'pdf', label: 'PDF 文件 (.pdf)' },
  { value: 'txt', label: '纯文本 (.txt)' },
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'rtf', label: 'RTF 富文本 (.rtf)' },
];

const fontSizeOptions = [
  { value: 22, label: '二号 / 22pt' },
  { value: 16, label: '三号 / 16pt' },
  { value: 15, label: '小三 / 15pt' },
  { value: 14, label: '四号 / 14pt' },
  { value: 12, label: '小四 / 12pt' },
  { value: 10.5, label: '五号 / 10.5pt' },
  { value: 9, label: '小五 / 9pt' },
];

const fallbackFontNames = ['宋体', '黑体', '微软雅黑', '仿宋', '楷体', '等线', 'Arial', 'Calibri', 'Times New Roman'];
const supportedTemplateFileTypes = templateFileTypeOptions.map(option => option.value);
const formatRuleRows = [
  { key: 'heading1', label: '一级标题', defaultFont: '黑体', defaultSize: 16, defaultLineHeight: 1.5 },
  { key: 'heading2', label: '二级标题', defaultFont: '黑体', defaultSize: 15, defaultLineHeight: 1.5 },
  { key: 'heading3', label: '三级标题', defaultFont: '黑体', defaultSize: 14, defaultLineHeight: 1.5 },
  { key: 'heading4', label: '四级标题', defaultFont: '黑体', defaultSize: 12, defaultLineHeight: 1.5 },
  { key: 'body', label: '正文', defaultFont: '宋体', defaultSize: 12, defaultLineHeight: 1.5 },
] as const;

const getImportedBaseName = (filePath: string, fileName?: string) =>
  (fileName || filePath.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '');

const inferOutputFileType = (filePath: string): TemplateOutputFileType => {
  const ext = filePath.split('.').pop()?.toLowerCase() as TemplateOutputFileType | undefined;
  return ext && supportedTemplateFileTypes.includes(ext) ? ext : 'docx';
};

const normalizeImportedText = (value: string): string =>
  value
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const stripRtfText = (value: string): string =>
  normalizeImportedText(
    value
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+\d* ?/g, '')
      .replace(/[{}]/g, ' ')
  );

function isLikelyGarbledText(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  if (!compact) return false;
  const replacementCount = compact.match(/�/g)?.length || 0;
  const readableCount = compact.match(/[\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/]/g)?.length || 0;
  return replacementCount / compact.length > 0.03 || readableCount / compact.length < 0.55;
}

function isLikelyReadableHeading(value: string): boolean {
  const titlePart = value.replace(/^([一二三四五六七八九十十一十二]+[、.．）\)]|第[一-龥]{1,4}[章节部篇]|[\d]+([.．]\d+)*[、.．）\)]?|[\(（][\d一-龥]+[）\)])\s*/, '');
  const compact = titlePart.replace(/\s/g, '');
  if (compact.length < 2) return false;
  return !isLikelyGarbledText(compact);
}

async function parseImportedDocument(filePath: string): Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; error?: string }> {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const fileName = filePath.split(/[/\\]/).pop();
  const isMissingHandler = (message: string, channel: string) =>
    message.includes('No handler registered') || message.includes(channel);

  if (ext === 'doc') {
    try {
      const result = await window.electronAPI.parseDocumentSilent?.(filePath);
      if (result) {
        return {
          ...result,
          content: result.content ? normalizeImportedText(result.content) : undefined,
          fileName: result.fileName || fileName,
        };
      }
    } catch (error: any) {
      const message = String(error?.message || error || '');
      if (!isMissingHandler(message, 'file:parseDocumentSilent') && !message.includes('parseDocumentSilent')) {
        return { success: false, fileName, error: message || '静默解析文档失败' };
      }
    }
  } else {
    try {
      const result = await window.electronAPI.parseDocument(filePath);
      return {
        ...result,
        content: result.content ? normalizeImportedText(result.content) : undefined,
        fileName: result.fileName || fileName,
      };
    } catch (error: any) {
      const message = String(error?.message || error || '');
      if (!isMissingHandler(message, 'file:parseDocument')) {
        return { success: false, fileName, error: message || '解析文档失败' };
      }
    }
  }

  try {
    if (ext === 'doc' || ext === 'docx') {
      const result = await window.electronAPI.parseWordDocument(filePath);
      if (ext === 'doc' && !result.success) {
        const errorMessage = String(result.error || '');
        if (errorMessage.includes('Could not find the body element')) {
          return {
            success: true,
            fileName,
            error: undefined,
          };
        }
      }
      return {
        success: result.success,
        content: result.content ? normalizeImportedText(result.content) : undefined,
        fileName: result.fileName || fileName,
        error: result.error,
      };
    }

    if (ext === 'pdf') {
      const result = await window.electronAPI.parsePdfDocument(filePath);
      return {
        success: result.success,
        content: result.content ? normalizeImportedText(result.content) : undefined,
        fileName: result.fileName || fileName,
        pages: result.pages,
        error: result.error,
      };
    }

    if (ext === 'txt' || ext === 'md' || ext === 'rtf') {
      const content = await window.electronAPI.readFile(filePath);
      return {
        success: true,
        content: ext === 'rtf' ? stripRtfText(content) : normalizeImportedText(content),
        fileName,
      };
    }

    return { success: false, fileName, error: '当前运行的主进程不支持该文件格式，请重启应用后再试' };
  } catch (error: any) {
    return { success: false, fileName, error: error?.message || '解析文档失败' };
  }
}

const buildDefaultFormatFormValues = () => {
  const formatRules: Record<string, any> = {};
  formatRuleRows.forEach(row => {
    formatRules[row.key] = {
      fontFamily: row.defaultFont,
      fontSize: row.defaultSize,
      letterSpacing: 0,
      lineHeight: row.defaultLineHeight,
    };
  });
  return formatRules;
};

const flattenFormatRulesForForm = (rules?: TemplateFormatRules) => {
  const fallback = buildDefaultFormatFormValues();
  formatRuleRows.forEach(row => {
    const rule = rules?.[row.key];
    fallback[row.key] = {
      fontFamily: rule?.fontRequirement?.fontFamily || fallback[row.key].fontFamily,
      fontSize: rule?.fontRequirement?.fontSize || fallback[row.key].fontSize,
      letterSpacing: rule?.fontRequirement?.letterSpacing ?? fallback[row.key].letterSpacing,
      lineHeight: rule?.fontRequirement?.lineHeight || fallback[row.key].lineHeight,
    };
  });
  return fallback;
};

// ==================== 标题提取逻辑 ====================

interface HeadingMatch {
  title: string;
  level: number;
  token: string;
  kind: 'chapter' | 'chinese' | 'parenChinese' | 'number' | 'decimal' | 'parenNumber';
  numericDepth?: number;
}

function matchHeadingLine(line: string): HeadingMatch | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (!isLikelyReadableHeading(trimmed)) return null;

  const patterns: Array<{
    regex: RegExp;
    kind: HeadingMatch['kind'];
    level: (token: string) => number;
    numericDepth?: (token: string) => number;
  }> = [
    { regex: /^(第[一二三四五六七八九十百千万\d]+[章节部篇])[\s　]*(\S.*)$/, kind: 'chapter', level: () => 1 },
    { regex: /^([一二三四五六七八九十百千万]+[、.．）\)])[\s　]*(\S.*)$/, kind: 'chinese', level: () => 1 },
    { regex: /^([\(（][一二三四五六七八九十百千万]+[）\)])[\s　]*(\S.*)$/, kind: 'parenChinese', level: () => 2 },
    {
      regex: /^(\d+(?:[.．]\d+){1,3})[、.．）\)]?[\s　]*(\S.*)$/,
      kind: 'decimal',
      level: (token) => Math.min(token.split(/[.．]/).length, 4),
      numericDepth: (token) => token.split(/[.．]/).length,
    },
    { regex: /^([\(（]\d+[）\)])[\s　]*(\S.*)$/, kind: 'parenNumber', level: () => 4 },
    { regex: /^(\d+[、.．）\)])[\s　]*(\S.*)$/, kind: 'number', level: () => 1 },
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern.regex);
    if (!match) continue;
    const titleText = match[2]?.trim();
    if (!titleText || isLikelyGarbledText(titleText)) continue;
    const token = match[1].trim();
    return {
      title: `${token} ${titleText}`.trim(),
      level: pattern.level(token),
      token,
      kind: pattern.kind,
      numericDepth: pattern.numericDepth?.(token),
    };
  }

  return null;
}

function normalizeHeadingDescription(value?: string): string | undefined {
  if (!value) return undefined;
  const lines = value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[-—_=\s]{3,}$/.test(line));
  const compact = lines.join('\n').trim();
  return compact ? compact.slice(0, 1200) : undefined;
}

function nodesFromHeadingItems(items: Array<{ title: string; level?: number; description?: string }>): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  items
    .filter(item => item.title && !isLikelyGarbledText(item.title))
    .forEach((item, index) => {
      const node: TemplateNode = {
      id: `${Date.now()}-${index}`,
      title: item.title.trim(),
      level: Math.min(Math.max(Number(item.level) || 1, 1), 4),
      description: normalizeHeadingDescription(item.description),
      isRequired: true,
      };

      while (stack.length && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        nodes.push(node);
      }
      stack.push(node);
    });
  return nodes;
}

function parseAiHeadingResponse(response: string): TemplateNode[] {
  const jsonText = response.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return nodesFromHeadingItems(parsed.map((item: any) => ({
      title: String(item.title || item.name || '').trim(),
      level: Number(item.level) || 1,
      description: String(item.description || item.requirement || item.requirements || item.tips || '').trim(),
    })));
  } catch {
    return [];
  }
}

function inferHeadingLevel(heading: HeadingMatch, previous: HeadingMatch[]): number {
  const recent = previous.slice(-8);
  const hasChineseOutline = recent.some(item => item.kind === 'chinese' || item.kind === 'chapter' || item.kind === 'parenChinese');
  const hasParenChinese = recent.some(item => item.kind === 'parenChinese');

  if (heading.kind === 'chapter' || heading.kind === 'chinese') return 1;
  if (heading.kind === 'parenChinese') return hasChineseOutline ? 2 : 1;
  if (heading.kind === 'parenNumber') return hasParenChinese ? 4 : hasChineseOutline ? 3 : 2;
  if (heading.kind === 'number') return hasParenChinese ? 3 : hasChineseOutline ? 2 : 1;
  if (heading.kind === 'decimal') {
    const depth = heading.numericDepth || 1;
    if (hasParenChinese && depth === 1) return 3;
    if (hasChineseOutline && depth === 1) return 2;
    return Math.min(depth, 4);
  }
  return heading.level;
}

// 从文档内容提取章节结构为 TemplateNode[]（保留各章节内容）
function extractTemplateNodes(content: string): TemplateNode[] {
  const lines = content.split('\n');

  // 第一步：识别标题行及其位置
  const headingPositions: { lineIndex: number; title: string; level: number; match: HeadingMatch }[] = [];
  const previousHeadings: HeadingMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = matchHeadingLine(lines[i]);
    if (heading) {
      const level = inferHeadingLevel(heading, previousHeadings);
      headingPositions.push({ lineIndex: i, title: heading.title, level, match: heading });
      previousHeadings.push({ ...heading, level });
    }
  }

  // 第二步：提取每个标题下方的内容
  const headingContents: { title: string; level: number; description: string }[] = [];
  for (let i = 0; i < headingPositions.length; i++) {
    const start = headingPositions[i].lineIndex + 1;
    const end = i + 1 < headingPositions.length ? headingPositions[i + 1].lineIndex : lines.length;
    const contentLines = lines.slice(start, end).filter(l => l.trim().length > 0);
    headingContents.push({
      title: headingPositions[i].title,
      level: headingPositions[i].level,
      description: normalizeHeadingDescription(contentLines.join('\n')) || '',
    });
  }

  // 第三步：构建树结构
  const nodes: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  let idCounter = 0;

  for (const h of headingContents) {
    if (isLikelyGarbledText(h.title)) continue;
    idCounter++;
    const node: TemplateNode = {
      id: String(idCounter),
      title: h.title,
      level: h.level,
      isRequired: true,
      description: h.description || undefined,
    };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      nodes.push(node);
    }
    stack.push(node);
  }
  return nodes;
}

function mapTemplateNodes(nodes: TemplateNode[], id: string, updater: (node: TemplateNode) => TemplateNode): TemplateNode[] {
  return nodes.map(node => {
    if (node.id === id) return updater(node);
    if (node.children?.length) {
      return { ...node, children: mapTemplateNodes(node.children, id, updater) };
    }
    return node;
  });
}

function removeTemplateNodeById(nodes: TemplateNode[], id: string): TemplateNode[] {
  return nodes
    .filter(node => node.id !== id)
    .map(node => node.children?.length
      ? { ...node, children: removeTemplateNodeById(node.children, id) }
      : node);
}

function canMoveTemplateNode(nodes: TemplateNode[], id: string, direction: 'up' | 'down'): boolean {
  const index = nodes.findIndex(node => node.id === id);
  if (index >= 0) {
    return direction === 'up' ? index > 0 : index < nodes.length - 1;
  }
  return nodes.some(node => node.children?.length && canMoveTemplateNode(node.children, id, direction));
}

function moveTemplateNodeById(nodes: TemplateNode[], id: string, direction: 'up' | 'down'): TemplateNode[] {
  const index = nodes.findIndex(node => node.id === id);
  if (index >= 0) {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= nodes.length) return nodes;
    const updated = [...nodes];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    return updated;
  }

  return nodes.map(node => node.children?.length
    ? { ...node, children: moveTemplateNodeById(node.children, id, direction) }
    : node);
}

function flattenTemplateNodeRows(nodes: TemplateNode[], depth = 0): Array<{ node: TemplateNode; depth: number }> {
  return nodes.flatMap(node => [
    { node, depth },
    ...(node.children?.length ? flattenTemplateNodeRows(node.children, depth + 1) : []),
  ]);
}

function rebuildTemplateTree(nodes: TemplateNode[]): TemplateNode[] {
  const roots: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  nodes.forEach(source => {
    const node: TemplateNode = { ...source, children: undefined };
    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  });
  return roots;
}

function findEmptyNodeTitle(nodes: TemplateNode[]): TemplateNode | undefined {
  for (const node of nodes) {
    if (!node.title.trim()) return node;
    const child = node.children?.length ? findEmptyNodeTitle(node.children) : undefined;
    if (child) return child;
  }
  return undefined;
}

const TemplateManager: React.FC = () => {
  const { templates, loadTemplates, addTemplate, updateTemplate, deleteTemplate } = useTemplateStore();
  const { customStages, saveAllStages } = useSettingsStore();
  const { projects, versions, updateProject } = useProjectStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WritingTemplate | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [importedFilePath, setImportedFilePath] = useState<string>('');
  const [importedDocumentText, setImportedDocumentText] = useState<string>('');
  const [fontOptions, setFontOptions] = useState(fallbackFontNames.map(font => ({ value: font })));
  const [form] = Form.useForm();
  const enableFormatRules = Form.useWatch('enableFormatRules', form);

  // 阶段管理状态
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<StageConfig | null>(null);
  const [stageForm] = Form.useForm();
  const allStages = getAllStages(customStages);

  // 模板结构编辑器状态
  const [templateNodes, setTemplateNodes] = useState<TemplateNode[]>([]);

  // 模板结构编辑器操作
  const addTemplateNode = () => {
    const newNode: TemplateNode = {
      id: Date.now().toString(),
      title: '',
      level: 1,
      isRequired: true,
    };
    setTemplateNodes([...templateNodes, newNode]);
  };

  const removeTemplateNode = (id: string) => {
    setTemplateNodes(removeTemplateNodeById(templateNodes, id));
  };

  const updateTemplateNode = (id: string, updates: Partial<TemplateNode>) => {
    setTemplateNodes(mapTemplateNodes(templateNodes, id, node => ({ ...node, ...updates })));
  };

  const updateTemplateNodeLevel = (id: string, level: number) => {
    const flattened = flattenTemplateNodeRows(templateNodes).map(({ node }) => ({
      ...node,
      level: node.id === id ? level : node.level,
      children: undefined,
    }));
    setTemplateNodes(rebuildTemplateTree(flattened));
  };

  const moveTemplateNode = (id: string, direction: 'up' | 'down') => {
    setTemplateNodes(moveTemplateNodeById(templateNodes, id, direction));
  };

  // 打开弹窗时初始化节点
  const initTemplateNodes = (template: WritingTemplate | null) => {
    if (template?.nodes) {
      setTemplateNodes(template.nodes);
    } else {
      setTemplateNodes([]);
    }
  };

  // 重新扫描所有项目的阶段文件
  const resyncAllProjects = async (stages: StageConfig[]) => {
    let totalMatched = 0;
    for (const project of projects) {
      if (!project.folderPath) continue;
      const result = await syncProjectStageFiles(project, {
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
        allStages: stages,
      });
      totalMatched += result.matched;
    }

    const latestDocs = useProjectDocStore.getState().projectDocs;
    const latestTemplates = useTemplateStore.getState().templates;
    await Promise.all(projects.map(project => {
      const progress = getGlobalStageProgress(
        project,
        latestDocs.filter(doc => doc.projectId === project.id),
        latestTemplates,
        versions.filter(version => version.projectId === project.id),
        stages,
      );
      return updateProject(project.id, { progress });
    }));

    message.info(`已重新扫描 ${projects.length} 个项目，匹配到 ${totalMatched} 个阶段文件，并更新项目进度`);
  };

  const buildUpdatedCustomStages = (stage: StageConfig, mode: 'add' | 'update' | 'delete') => {
    const withoutCurrent = customStages.filter(s => s.id !== stage.id);
    if (mode === 'delete') {
      return stage.isSystem ? [...withoutCurrent, { ...stage, deleted: true }] : withoutCurrent;
    }
    return [...withoutCurrent, { ...stage, deleted: false }];
  };

  const colorValue = (color: any) => {
    if (typeof color === 'string') return color;
    return color?.toHexString?.() || '#1890ff';
  };

  const buildFormatRules = (values: any): TemplateFormatRules | undefined => {
    if (!values.enableFormatRules) return undefined;
    const rules: TemplateFormatRules = {};
    formatRuleRows.forEach(row => {
      const value = values.formatRules?.[row.key] || {};
      const hasAnyValue = value.fontFamily || value.fontSize || value.letterSpacing || value.lineHeight;
      if (!hasAnyValue) return;
      rules[row.key] = {
        fontRequirement: {
          fontFamily: value.fontFamily,
          fontSize: value.fontSize,
          letterSpacing: value.letterSpacing,
          lineHeight: value.lineHeight,
          fontWeight: row.key === 'body' ? 'normal' : 'bold',
        },
      };
    });
    return Object.keys(rules).length > 0 ? rules : undefined;
  };

  const flattenNodeCount = (nodes: TemplateNode[]): number =>
    nodes.reduce((count, node) => count + 1 + (node.children ? flattenNodeCount(node.children) : 0), 0);

  const countRequiredNodes = (nodes: TemplateNode[]): number =>
    nodes.reduce((count, node) => count + (node.isRequired ? 1 : 0) + (node.children ? countRequiredNodes(node.children) : 0), 0);

  const renderNodeRows = (nodes: TemplateNode[], depth = 0): React.ReactNode[] =>
    nodes.flatMap(node => [
      <div key={node.id} className="template-node-preview-row" style={{ paddingLeft: 10 + depth * 16 }}>
        <span className="template-node-level">{node.level}级</span>
        <Text strong style={{ fontSize: 12 }} ellipsis={{ tooltip: node.title }}>{node.title}</Text>
      </div>,
      ...(node.children ? renderNodeRows(node.children, depth + 1) : []),
    ]);

  const nodeTotal = flattenNodeCount(templateNodes);
  const requiredTotal = countRequiredNodes(templateNodes);

  const extractNodesWithAi = async (content: string) => {
    const prompt = `你是文档模板结构识别助手。请从下面文档文本中识别章节标题，并提取每个章节标题下方的写作要求、内容要求、格式要求或填写说明。

要求：
1. 只返回 JSON 数组，不要解释。
2. 每项格式为 {"title":"原始章节标题","level":1,"description":"该章节下方的要求或说明"}。
3. level 只允许 1-4；按文档上下文判断，“一、/第X章”通常为1级，“（一）”通常为2级，“1.”在“一、/（一）”之后通常为3级，“（1）”通常为4级。
4. description 只保留模板要求、编写提示、格式要求、内容说明；没有则为空字符串。
5. 不要返回乱码、正文句子、页眉页脚、目录页码。

文档文本：
${content.slice(0, 24000)}`;

    const response = await window.electronAPI.callAI(prompt);
    return parseAiHeadingResponse(response);
  };

  const handleAiExtract = async () => {
    if (!importedDocumentText) {
      message.warning('请先选择并解析一个文件');
      return;
    }

    setIsAiExtracting(true);
    try {
      const nodes = await extractNodesWithAi(importedDocumentText);
      if (nodes.length === 0) {
        message.warning('AI 未返回可用章节，请检查 AI 配置或文档内容');
        return;
      }
      setTemplateNodes(nodes);
      message.success(`AI 已识别 ${nodes.length} 个章节`);
    } catch (error: any) {
      message.warning(error?.message || 'AI 章节识别失败，请先配置 AI API 密钥');
    } finally {
      setIsAiExtracting(false);
    }
  };

  const handleCreateStage = () => {
    setEditingStage(null);
    stageForm.resetFields();
    stageForm.setFieldsValue({ color: '#1890ff' });
    setIsStageModalOpen(true);
  };

  const handleEditStage = (stage: StageConfig) => {
    setEditingStage(stage);
    stageForm.setFieldsValue({
      name: stage.name,
      keywords: stage.keywords.join(', '),
      color: stage.color,
    });
    setIsStageModalOpen(true);
  };

  const handleDeleteStage = async (id: string) => {
    const target = allStages.find(s => s.id === id);
    if (!target) return;
    const updatedCustomStages = buildUpdatedCustomStages(target, 'delete');
    await saveAllStages(updatedCustomStages);
    message.success('阶段已删除');
    const updatedStages = getAllStages(updatedCustomStages);
    await resyncAllProjects(updatedStages);
  };

  const handleStageSubmit = async () => {
    try {
      const values = await stageForm.validateFields();
      const keywords = values.keywords
        ? values.keywords.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean)
        : [];

      // 检查名称是否与已有阶段重复
      const exists = allStages.some(s =>
        s.name === values.name && s.id !== editingStage?.id
      );
      if (exists) {
        message.error('阶段名称已存在');
        return;
      }

      const color = colorValue(values.color);
      const stageToSave: StageConfig = editingStage
        ? { ...editingStage, name: values.name, keywords, color }
        : {
          id: `custom-${Date.now()}`,
          name: values.name,
          keywords,
          color,
          isSystem: false,
        };

      message.success(editingStage ? '阶段已更新' : '阶段已创建');

      setIsStageModalOpen(false);

      const updatedCustomStages = buildUpdatedCustomStages(stageToSave, editingStage ? 'update' : 'add');
      await saveAllStages(updatedCustomStages);
      const updatedStages = getAllStages(updatedCustomStages);
      await resyncAllProjects(updatedStages);
    } catch (error) {
      console.error('Stage submit error:', error);
    }
  };

  useEffect(() => {
    loadTemplates();
    window.electronAPI.listSystemFonts?.()
      .then(result => {
        const fonts = result?.fonts?.length ? result.fonts : fallbackFontNames;
        setFontOptions(fonts.map(font => ({ value: font })));
      })
      .catch(() => setFontOptions(fallbackFontNames.map(font => ({ value: font }))));
  }, []);

  const handleCreate = () => {
    setEditingTemplate(null);
    setImportedFilePath('');
    setImportedDocumentText('');
    form.resetFields();
    form.setFieldsValue({
      outputFileType: 'docx',
      enableFormatRules: false,
      formatRules: buildDefaultFormatFormValues(),
    });
    initTemplateNodes(null);
    setIsModalOpen(true);
  };

  const handleEdit = (template: WritingTemplate) => {
    setEditingTemplate(template);
    setImportedDocumentText('');
    form.setFieldsValue({
      name: template.name,
      description: template.description,
      category: template.category,
      outputFileType: template.outputFileType || inferOutputFileType(template.filePath || ''),
      enableFormatRules: Boolean(template.formatRules || template.titleFontRequirement || template.bodyFontRequirement),
      formatRules: flattenFormatRulesForForm(template.formatRules || {
        heading1: { fontRequirement: template.titleFontRequirement },
        body: { fontRequirement: template.bodyFontRequirement },
      }),
    });
    initTemplateNodes(template);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
    message.success('模板已删除');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (templateNodes.length === 0) {
        message.error('请至少添加一个章节');
        return;
      }

      // 验证每个节点都有标题
      const emptyTitle = findEmptyNodeTitle(templateNodes);
      if (emptyTitle) {
        message.error('请填写所有章节的标题');
        return;
      }

      const nodes = templateNodes;
      const formatRules = buildFormatRules(values);
      const heading1Rule = formatRules?.heading1?.fontRequirement;
      const bodyRule = formatRules?.body?.fontRequirement;

      const templateId = editingTemplate?.id || Date.now().toString();
      const templateData: WritingTemplate = {
        id: templateId,
        name: values.name,
        description: values.description,
        category: values.category,
        outputFileType: values.outputFileType || 'docx',
        titleFontRequirement: heading1Rule,
        bodyFontRequirement: bodyRule,
        formatRules,
        nodes,
        filePath: editingTemplate?.filePath,
        createdAt: editingTemplate?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 如果有导入的源文件，存储到模板目录
      if (importedFilePath) {
        const storeResult = await window.electronAPI.storeTemplateFile({
          templateId,
          sourcePath: importedFilePath,
        });
        if (storeResult.success && storeResult.filePath) {
          templateData.filePath = storeResult.filePath;
        }
      }

      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, templateData);
        message.success('模板已更新');
      } else {
        await addTemplate(templateData);
        message.success('模板已创建');
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const handleImportFromDoc = async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: '文档文件', extensions: ['doc', 'docx', 'pdf', 'txt', 'md', 'rtf'] },
        { name: '所有文件', extensions: ['*'] },
      ]);
      if (!filePath) return;

      setIsExtracting(true);
      setImportedFilePath(filePath);
      setImportedDocumentText('');

      const fileBaseName = getImportedBaseName(filePath);
      const currentName = form.getFieldValue('name');
      if (!currentName) {
        form.setFieldsValue({ name: fileBaseName });
      }
      form.setFieldsValue({ outputFileType: inferOutputFileType(filePath) });

      const result = await parseImportedDocument(filePath);
      const fileExt = filePath.split('.').pop()?.toLowerCase();
      if (!result.success || !result.content) {
        if (fileExt === 'doc' && !result.content) {
          message.warning(result.error || '旧版 .doc 文件已关联，但当前运行版本未提取到章节；重启应用后会使用新版解析器，或可另存为 .docx 后导入。');
        } else {
          message.warning(result.error ? `文件已关联，但解析失败：${result.error}` : '文件已关联，但未解析到可读文本');
        }
        return;
      }
      if (fileExt === 'doc' && isLikelyGarbledText(result.content)) {
        message.warning('文件已关联，但旧版 .doc 提取结果疑似乱码，已跳过章节生成；请重启应用使用新版静默解析，或将文件另存为 .docx 后导入。');
        return;
      }
      setImportedDocumentText(result.content);

      const importedName = getImportedBaseName(filePath, result.fileName);
      if (!currentName) {
        form.setFieldsValue({ name: importedName });
      }

      // 推断分类：用阶段关键词匹配
      const currentCategory = form.getFieldValue('category');
      if (!currentCategory) {
        for (const stage of allStages) {
          if (stage.keywords.some(kw => importedName.includes(kw))) {
            form.setFieldsValue({ category: stage.name });
            break;
          }
        }
      }

      const nodes = extractTemplateNodes(result.content);
      if (nodes.length === 0) {
        try {
          const aiNodes = await extractNodesWithAi(result.content);
          if (aiNodes.length > 0) {
            setTemplateNodes(aiNodes);
            message.success(`规则未检测到章节，AI 已识别 ${aiNodes.length} 个章节`);
            return;
          }
        } catch {}
        message.warning('文件已关联并填入模板名称，但未检测到章节标题。可以点击“AI识别”重试，或确认文档使用了一、二、三 / 第X章 / 1. 2. 3. 等编号格式。');
        return;
      }

      setTemplateNodes(nodes);
      message.success(`已从 ${result.fileName || '文档'} 提取 ${nodes.length} 个章节，请检查并调整`);
    } catch (error: any) {
      console.error('Import failed:', error);
      message.error(`导入失败：${error?.message || '未知错误'}`);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="template-manager-page">
      <section className="template-section">
      <div className="template-section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>模板管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>维护写作模板结构，可从 Word、PDF、文本等文档中提取章节</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          创建模板
        </Button>
      </div>

      {templates.length === 0 ? (
        <Empty description="暂无模板，请创建" />
      ) : (
        <List
          className="template-card-list"
          grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
          dataSource={templates}
          renderItem={(template) => (
            <List.Item>
              <Card
                className="template-card"
                actions={[
                  <EditOutlined key="edit" onClick={() => handleEdit(template)} />,
                  <Popconfirm
                    key="delete"
                    title="确定删除此模板？"
                    onConfirm={() => handleDelete(template.id)}
                  >
                    <DeleteOutlined />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                  title={template.name}
                  description={
                    <div>
                      <Tag color="blue" style={{ marginBottom: 8 }}>{template.category}</Tag>
                      <br />
                      <Text ellipsis={{ rows: 2 }}>{template.description}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {template.outputFileType?.toUpperCase() || 'DOCX'} · 包含 {flattenNodeCount(template.nodes)} 个章节{template.filePath ? ' · 已保存源文件' : ''}
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {template.formatRules ? `已配置格式规则 · 正文 ${template.bodyFontRequirement?.fontFamily || '宋体'}` : '未配置默认格式'}
                      </Text>
                    </div>
                  }
                />
              </Card>
            </List.Item>
          )}
        />
      )}
      </section>

      <Modal
        className="template-editor-modal"
        title={editingTemplate ? '编辑模板' : '创建模板'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        width="min(92vw, 1200px)"
        okText="保存模板"
        cancelText="取消"
        style={{ top: 16, maxHeight: 'calc(100vh - 32px)' }}
        styles={{ body: { height: 'calc(100vh - 120px)', overflow: 'hidden' } }}
      >
        <Form form={form} layout="vertical" className="template-editor-form">
          <div className="template-editor-grid">
            <div className="template-editor-main">
              <div className="template-form-section">
                <Text strong>基础信息</Text>
                <div className="template-form-row">
                  <Form.Item
                    name="name"
                    label="模板名称"
                    rules={[{ required: true, message: '请输入模板名称' }]}
                  >
                    <Input placeholder="例如：可研报告模板" />
                  </Form.Item>

                  <Form.Item
                    name="category"
                    label="关联阶段"
                    rules={[{ required: true, message: '请选择关联阶段' }]}
                  >
                    <Select
                      placeholder="选择阶段"
                      options={allStages.map(s => ({ value: s.name, label: s.name }))}
                    />
                  </Form.Item>

                  <Form.Item
                    name="outputFileType"
                    label="创建文件类型"
                    rules={[{ required: true, message: '请选择创建文件类型' }]}
                  >
                    <Select
                      placeholder="选择文件类型"
                      options={templateFileTypeOptions}
                    />
                  </Form.Item>
                </div>

                <Form.Item
                  name="description"
                  label="模板说明"
                >
                  <TextArea rows={2} placeholder="简要说明模板用途、适用范围或填写要求" />
                </Form.Item>

                <div className="template-format-toggle">
                  <div>
                    <Text strong>默认格式规则</Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      可选；开启后会在脚本创建 Word 文档时写入标题和正文样式。
                    </Text>
                  </div>
                  <Form.Item name="enableFormatRules" valuePropName="checked" style={{ margin: 0 }}>
                    <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                  </Form.Item>
                </div>

                {enableFormatRules && (
                  <div className="template-format-table">
                    <div className="template-format-head">
                      <span>样式</span>
                      <span>字体</span>
                      <span>字号</span>
                      <span>字间距</span>
                      <span>行间距</span>
                    </div>
                    {formatRuleRows.map(row => (
                      <div className="template-format-row" key={row.key}>
                        <Text strong style={{ fontSize: 12 }}>{row.label}</Text>
                        <Form.Item name={['formatRules', row.key, 'fontFamily']} style={{ margin: 0 }}>
                          <AutoComplete
                            options={fontOptions}
                            placeholder="字体"
                            filterOption={(input, option) =>
                              String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                        <Form.Item name={['formatRules', row.key, 'fontSize']} style={{ margin: 0 }}>
                          <Select options={fontSizeOptions} placeholder="字号" />
                        </Form.Item>
                        <Form.Item name={['formatRules', row.key, 'letterSpacing']} style={{ margin: 0 }}>
                          <InputNumber min={0} max={20} step={0.5} addonAfter="pt" />
                        </Form.Item>
                        <Form.Item name={['formatRules', row.key, 'lineHeight']} style={{ margin: 0 }}>
                          <InputNumber min={1} max={3} step={0.1} />
                        </Form.Item>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="template-import-panel">
                <div>
                  <Text strong>从文件导入结构</Text>
                  <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                    支持 .doc/.docx/.pdf/.txt/.md/.rtf，自动识别章节标题并保留源文件用于后续创建文件。
                  </Text>
                  {importedFilePath && (
                    <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 6 }} ellipsis={{ tooltip: importedFilePath }}>
                      已导入：{importedFilePath.split(/[/\\]/).pop()}
                    </Text>
                  )}
                </div>
                <Space>
                  <Button
                    icon={<ImportOutlined />}
                    loading={isExtracting}
                    onClick={handleImportFromDoc}
                  >
                    选择文件
                  </Button>
                  <Button
                    disabled={!importedDocumentText}
                    loading={isAiExtracting}
                    onClick={handleAiExtract}
                  >
                    AI识别
                  </Button>
                </Space>
              </div>

          {/* 模板结构编辑器 */}
          <div className="template-node-editor" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <Text strong>模板章节结构</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  共 {nodeTotal} 个章节，{requiredTotal} 个必需项
                </Text>
              </div>
              <Space>
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={addTemplateNode}
                >
                  添加章节
                </Button>
              </Space>
            </div>
            <div className="template-node-list">
              {flattenTemplateNodeRows(templateNodes).map(({ node, depth }, index) => (
                <div
                  key={node.id}
                  className="template-node-card"
                  style={{ marginLeft: depth * 18 }}
                >
                  <div className="template-node-order">
                    <HolderOutlined className="template-node-handle" />
                    <span className="template-node-index">{index + 1}</span>
                  </div>

                  <div className="template-node-content">
                    <Input
                      className="template-node-title-input"
                      value={node.title}
                      onChange={(e) => updateTemplateNode(node.id, { title: e.target.value })}
                      placeholder="例如：一、项目概述"
                    />
                    <div className="template-node-subline">
                      <Select
                        className="template-node-level-select"
                        size="small"
                        value={node.level}
                        onChange={(value) => updateTemplateNodeLevel(node.id, value)}
                        options={[
                          { value: 1, label: '第 1 级' },
                          { value: 2, label: '第 2 级' },
                          { value: 3, label: '第 3 级' },
                          { value: 4, label: '第 4 级' },
                        ]}
                      />
                      <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                        {node.description ? '已从导入文件提取章节说明' : '可作为文档进度检测节点'}
                      </Text>
                    </div>
                    <TextArea
                      className="template-node-description-input"
                      value={node.description}
                      onChange={(e) => updateTemplateNode(node.id, { description: e.target.value })}
                      placeholder="可填写或确认该章节的内容要求、格式要求、审阅重点"
                      autoSize={{ minRows: 1, maxRows: 4 }}
                    />
                  </div>

                  <div className="template-node-actions">
                    <Button
                      className={node.isRequired ? 'template-node-required active' : 'template-node-required'}
                      size="small"
                      onClick={() => updateTemplateNode(node.id, { isRequired: !node.isRequired })}
                    >
                      {node.isRequired ? '必需' : '可选'}
                    </Button>
                    <div className="template-node-move">
                      <Button
                        type="text"
                        size="small"
                        disabled={!canMoveTemplateNode(templateNodes, node.id, 'up')}
                        icon={<UpOutlined />}
                        onClick={() => moveTemplateNode(node.id, 'up')}
                      />
                      <Button
                        type="text"
                        size="small"
                        disabled={!canMoveTemplateNode(templateNodes, node.id, 'down')}
                        icon={<DownOutlined />}
                        onClick={() => moveTemplateNode(node.id, 'down')}
                      />
                    </div>
                    <Button
                      className="template-node-delete"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeTemplateNode(node.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
            {templateNodes.length === 0 && (
              <div style={{ textAlign: 'center', padding: 16, color: '#999', fontSize: 12 }}>
                点击"添加章节"或"从文档提取"开始构建模板结构
              </div>
            )}
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
              章节标题建议使用“一、二、三”“第X章”“1. 2. 3.”等清晰编号，便于后续文档进度检测。
            </Text>
          </div>
            </div>
            <div className="template-editor-side">
              <Text strong>结构预览</Text>
              <div className="template-node-preview">
                {templateNodes.length > 0 ? renderNodeRows(templateNodes) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>暂无章节</Text>
                )}
              </div>
            </div>
          </div>
        </Form>
      </Modal>

      {/* ========== 项目阶段管理 ========== */}
      <Divider className="template-page-divider" />
      <section className="template-section stage-section">
      <div className="template-section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>项目阶段管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>阶段会参与文件识别、进度计算、统计卡片、甘特图和项目表</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateStage}>
          新增阶段
        </Button>
      </div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        新增或修改阶段后，系统会重新扫描所有项目文件夹，并按新的阶段规则刷新项目进度。
      </Text>

      <List
        className="stage-list"
        dataSource={allStages}
        renderItem={(stage) => (
          <List.Item
            actions={[
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditStage(stage)}>编辑</Button>,
              <Popconfirm title="确定删除此阶段？删除后会重新计算所有项目进度。" onConfirm={() => handleDeleteStage(stage.id)}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: stage.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 'bold',
                }}>
                  {stage.name.charAt(0)}
                </div>
              }
              title={stage.name}
              description={
                <span style={{ fontSize: 12, color: '#999' }}>
                  关键词：{stage.keywords.length > 0 ? stage.keywords.join('、') : '（无）'}
                </span>
              }
            />
          </List.Item>
        )}
      />
      </section>

      {/* 新增/编辑阶段弹窗 */}
      <Modal
        title={editingStage ? '编辑阶段' : '新增阶段'}
        open={isStageModalOpen}
        onOk={handleStageSubmit}
        onCancel={() => setIsStageModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <Form form={stageForm} layout="vertical">
          <Form.Item
            name="name"
            label="阶段名称"
            rules={[{ required: true, message: '请输入阶段名称' }]}
          >
            <Input placeholder="例如：立项、招标、验收" />
          </Form.Item>
          <Form.Item
            name="keywords"
            label="识别关键词"
            extra="多个关键词用逗号分隔，文件名包含任一关键词即识别为该阶段"
          >
            <Input placeholder="例如：立项, 招标, 验收" />
          </Form.Item>
          <Form.Item
            name="color"
            label="阶段颜色"
            rules={[{ required: true, message: '请选择颜色' }]}
          >
            <ColorPicker format="hex" showText />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TemplateManager;

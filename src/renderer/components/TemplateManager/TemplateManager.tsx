import React, { useEffect, useRef, useState } from 'react';
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
  Dropdown,
  Spin,
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
  CaretRightOutlined,
  CaretDownOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { WritingTemplate, TemplateNode, StageConfig, TemplateOutputFileType, TemplateFormatRules } from '../../../shared/types';
import { getAllStages, getGlobalStageProgress } from '../../utils/timelineStages';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';

const { Title, Text, Paragraph } = Typography;
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
  { key: 'heading1', label: '一级标题', defaultFont: '黑体', defaultSize: 16, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'heading2', label: '二级标题', defaultFont: '黑体', defaultSize: 15, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'heading3', label: '三级标题', defaultFont: '黑体', defaultSize: 14, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'heading4', label: '四级标题', defaultFont: '黑体', defaultSize: 12, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'body', label: '正文', defaultFont: '宋体', defaultSize: 12, defaultLineHeight: 1.5, defaultBold: false },
  { key: 'caption', label: '图题/图例', defaultFont: '宋体', defaultSize: 10.5, defaultLineHeight: 1.5, defaultBold: false },
  { key: 'tableTitle', label: '表题', defaultFont: '宋体', defaultSize: 10.5, defaultLineHeight: 1.5, defaultBold: false },
  { key: 'tableHeader', label: '表头', defaultFont: '宋体', defaultSize: 10.5, defaultLineHeight: 1.5, defaultBold: true },
] as const;

const getImportedBaseName = (filePath: string, fileName?: string) =>
  (fileName || filePath.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '');

const inferOutputFileType = (filePath: string): TemplateOutputFileType => {
  const rawExt = filePath.split('.').pop()?.toLowerCase();
  if (rawExt === 'ppt') return 'pptx';
  if (rawExt === 'xls') return 'xlsx';
  const ext = rawExt as TemplateOutputFileType | undefined;
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

async function parseImportedDocument(filePath: string): Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; convertedFilePath?: string; error?: string }> {
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
      fontWeight: rule?.fontRequirement?.fontWeight || (row.defaultBold ? 'bold' : 'normal'),
    };
  });
  return fallback;
};

type TemplateFormatRuleKey = typeof formatRuleRows[number]['key'];

const fontSizeNameMap: Record<string, number> = {
  初号: 42,
  小初: 36,
  一号: 26,
  小一: 24,
  二号: 22,
  小二: 18,
  三号: 16,
  小三: 15,
  四号: 14,
  小四: 12,
  五号: 10.5,
  小五: 9,
  六号: 7.5,
  小六: 6.5,
};

const styleTextAliases: Record<TemplateFormatRuleKey, string[]> = {
  heading1: ['一级标题', '章标题', '一级题名'],
  heading2: ['二级标题', '节标题', '二级题名'],
  heading3: ['三级标题', '三级题名'],
  heading4: ['四级标题', '四级题名'],
  body: ['正文', '正文内容', '主体文字'],
  caption: ['图题', '图例', '图注', '图名', '图片标题'],
  tableTitle: ['表题', '表名', '表格标题'],
  tableHeader: ['表头', '表格表头', '表头文字'],
};

const mergeFormatFormValues = (base: Record<string, any>, incoming?: Record<string, any>) => {
  const merged = { ...base };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (!value) return;
    merged[key] = { ...(merged[key] || {}) };
    ['fontFamily', 'fontSize', 'letterSpacing', 'lineHeight', 'fontWeight'].forEach(field => {
      if ((value as any)[field] !== undefined && (value as any)[field] !== '') {
        merged[key][field] = (value as any)[field];
      }
    });
  });
  return merged;
};

const formatRulesToPartialFormValues = (rules?: TemplateFormatRules): Record<string, any> => {
  const result: Record<string, any> = {};
  formatRuleRows.forEach(row => {
    const rule = rules?.[row.key];
    if (!rule) return;
    result[row.key] = {
      fontFamily: rule.fontRequirement?.fontFamily,
      fontSize: rule.fontRequirement?.fontSize,
      letterSpacing: rule.fontRequirement?.letterSpacing,
      lineHeight: rule.fontRequirement?.lineHeight,
      fontWeight: rule.fontRequirement?.fontWeight,
    };
  });
  return result;
};

const parseFormatValuesFromText = (text: string) => {
  const fontFamily = fallbackFontNames.find(font => text.includes(font));
  const namedSize = Object.entries(fontSizeNameMap).find(([name]) => text.includes(name))?.[1];
  const ptSize = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:pt|磅)/i)?.[1]);
  const lineHeight = Number(text.match(/(?:行距|行间距|倍行距)[^\d]*(\d+(?:\.\d+)?)/)?.[1]);
  return {
    fontFamily,
    fontSize: namedSize || (Number.isFinite(ptSize) && ptSize > 0 ? ptSize : undefined),
    lineHeight: Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : undefined,
    fontWeight: /加粗|粗体|黑体/.test(text) ? 'bold' : /不加粗|常规|普通/.test(text) ? 'normal' : undefined,
  };
};

const inferFormatRulesFromText = (content: string): { values: Record<string, any>; evidence: string[] } => {
  const values: Record<string, any> = {};
  const evidence: string[] = [];
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  formatRuleRows.forEach(row => {
    const aliases = styleTextAliases[row.key];
    const matchedLine = lines.find(line =>
      aliases.some(alias => line.includes(alias)) && /(字体|字号|号|pt|磅|行距|加粗|黑体|宋体|仿宋|楷体|微软雅黑)/.test(line)
    );
    if (!matchedLine) return;
    const parsed = parseFormatValuesFromText(matchedLine);
    if (!parsed.fontFamily && !parsed.fontSize && !parsed.lineHeight && !parsed.fontWeight) return;
    values[row.key] = parsed;
    evidence.push(`${row.label}：根据文字说明「${matchedLine.slice(0, 80)}」识别`);
  });

  return { values, evidence };
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
  return compact || undefined;
}


type TemplateGuidanceParts = {
  requirementText: string;
  exampleText: string;
};

const uniqueTextLines = (lines: string[]) => {
  const seen = new Set<string>();
  return lines
    .map(line => normalizeHeadingDescription(line) || '')
    .filter(Boolean)
    .filter(line => {
      const key = line.replace(/\s+/g, ' ').slice(0, 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const isExampleHeadingText = (text: string) =>
  /(范文|示例|示范|样例|例文|参考文|参考写法|参考内容|优秀案例|写法参考)/.test(text);

const isRequirementHeadingText = (text: string) =>
  /(要求|填写|说明|格式|规范|须知|注意事项|编写|撰写|内容要点|提交材料|审查要点|评分|指标|标准)/.test(text);

const classifyTemplateBlock = (text: string, heading = ''): 'requirement' | 'example' | 'unknown' => {
  const target = `${heading}\n${text}`;
  if (isExampleHeadingText(heading)) return 'example';
  if (isRequirementHeadingText(heading)) return 'requirement';
  const exampleHits = (target.match(/范文|示例|示范|样例|例文|例如|参考写法|参考内容|以下为|如下所示|可参考/g) || []).length;
  const requirementHits = (target.match(/要求|应当|应|需|需要|必须|不得|填写|说明|格式|字号|字体|行距|内容包括|材料|附件|指标|标准|依据|编写/g) || []).length;
  if (exampleHits > requirementHits && exampleHits > 0) return 'example';
  if (requirementHits > 0) return 'requirement';
  return 'unknown';
};

const splitTemplateGuidanceText = (text = '', heading = ''): TemplateGuidanceParts => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);
  const requirementLines: string[] = [];
  const exampleLines: string[] = [];
  let mode: 'requirement' | 'example' | null = isExampleHeadingText(heading)
    ? 'example'
    : isRequirementHeadingText(heading)
      ? 'requirement'
      : null;

  const source = paragraphs.length ? paragraphs : text.split('\n').map(line => line.trim()).filter(Boolean);
  source.forEach(part => {
    if (isExampleHeadingText(part)) {
      mode = 'example';
      exampleLines.push(part);
      return;
    }
    if (isRequirementHeadingText(part)) {
      mode = 'requirement';
      requirementLines.push(part);
      return;
    }
    const kind = classifyTemplateBlock(part, heading);
    if (kind === 'example') {
      exampleLines.push(part);
    } else if (kind === 'requirement') {
      requirementLines.push(part);
    } else if (mode === 'example') {
      exampleLines.push(part);
    } else if (mode === 'requirement') {
      requirementLines.push(part);
    }
  });

  return {
    requirementText: uniqueTextLines(requirementLines).join('\n').slice(0, 5000),
    exampleText: uniqueTextLines(exampleLines).join('\n').slice(0, 6000),
  };
};

const collectTemplateGuidance = (nodes: TemplateNode[], originalContent = ''): TemplateGuidanceParts => {
  const requirementLines: string[] = [];
  const exampleLines: string[] = [];
  const visit = (items: TemplateNode[]) => {
    items.forEach(node => {
      if (node.requirementText) {
        requirementLines.push(node.requirementText);
      } else if (node.description) {
        const legacyGuidance = splitTemplateGuidanceText(node.description, node.title);
        requirementLines.push(legacyGuidance.requirementText);
        exampleLines.push(legacyGuidance.exampleText);
      }
      if (node.exampleText) exampleLines.push(`${node.title}\n${node.exampleText}`);
      if (node.children?.length) visit(node.children);
    });
  };
  visit(nodes);
  if (!requirementLines.length && !exampleLines.length && originalContent.trim()) {
    const fallback = splitTemplateGuidanceText(originalContent);
    requirementLines.push(fallback.requirementText);
    exampleLines.push(fallback.exampleText);
  }
  return {
    requirementText: uniqueTextLines(requirementLines).join('\n\n').slice(0, 8000),
    exampleText: uniqueTextLines(exampleLines).join('\n\n').slice(0, 10000),
  };
};


interface AiTemplateHeadingItem {
  title: string;
  level?: number;
  description?: string;
  requirementText?: string;
  exampleText?: string;
  isRequired?: boolean;
}

interface AiTemplateExtractionResult {
  nodes: TemplateNode[];
  requirementText: string;
  exampleText: string;
  formatRules?: TemplateFormatRules;
  formatValues?: Record<string, any>;
  evidence: string[];
}

const normalizeStringEvidence = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/\n/).map(item => item.trim()).filter(Boolean);
  return [];
};

function nodesFromHeadingItems(items: AiTemplateHeadingItem[]): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  items
    .filter(item => item.title && !isLikelyGarbledText(item.title))
    .forEach((item, index) => {
      const rawDescription = String(item.description || '').trim();
      const rawRequirement = String(item.requirementText || '').trim();
      const rawExample = String(item.exampleText || '').trim();
      const splitDescription = splitTemplateGuidanceText(rawDescription, item.title);
      const splitRequirement = splitTemplateGuidanceText(rawRequirement, item.title);
      const requirementText = uniqueTextLines([
        splitRequirement.requirementText || rawRequirement,
        splitDescription.requirementText,
      ]).join('\n');
      const exampleText = uniqueTextLines([
        rawExample,
        splitRequirement.exampleText,
        splitDescription.exampleText,
      ]).join('\n');
      const node: TemplateNode = {
        id: `${Date.now()}-${index}`,
        title: item.title.trim(),
        level: Math.min(Math.max(Number(item.level) || 1, 1), 4),
        description: requirementText || undefined,
        requirementText: requirementText || undefined,
        exampleText: exampleText || undefined,
        isRequired: item.isRequired === false ? false : !isExampleHeadingText(item.title),
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

const extractJsonForAiTemplate = (response: string): any | null => {
  const trimmed = String(response || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }
  return null;
};

const normalizeAiFormatStyleValues = (value: any) => {
  const source = value?.fontRequirement || value || {};
  const fontSize = Number(source.fontSize ?? source.size ?? source.pt);
  const lineHeight = Number(source.lineHeight ?? source.lineSpacing);
  const letterSpacing = Number(source.letterSpacing ?? source.spacing);
  const fontWeightText = String(source.fontWeight || source.weight || '').toLowerCase();
  return {
    fontFamily: source.fontFamily || source.font || source.fontName,
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : undefined,
    letterSpacing: Number.isFinite(letterSpacing) && letterSpacing >= 0 ? letterSpacing : undefined,
    lineHeight: Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : undefined,
    fontWeight: /bold|加粗|黑体|粗/.test(fontWeightText) ? 'bold' : /normal|常规|不加粗/.test(fontWeightText) ? 'normal' : undefined,
  };
};

const normalizeAiFormatRules = (raw: any): { rules?: TemplateFormatRules; values: Record<string, any>; evidence: string[] } => {
  const source = raw?.formatRules || raw?.styleRules || raw || {};
  const values: Record<string, any> = {};
  const evidence: string[] = [];
  const aliasMap: Record<string, TemplateFormatRuleKey> = {
    heading1: 'heading1',
    h1: 'heading1',
    title1: 'heading1',
    一级标题: 'heading1',
    heading2: 'heading2',
    h2: 'heading2',
    title2: 'heading2',
    二级标题: 'heading2',
    heading3: 'heading3',
    h3: 'heading3',
    三级标题: 'heading3',
    heading4: 'heading4',
    h4: 'heading4',
    四级标题: 'heading4',
    body: 'body',
    正文: 'body',
    caption: 'caption',
    图题: 'caption',
    图例: 'caption',
    tableTitle: 'tableTitle',
    表题: 'tableTitle',
    tableHeader: 'tableHeader',
    表头: 'tableHeader',
  };

  Object.entries(source || {}).forEach(([rawKey, rawValue]) => {
    const normalizedKey = String(rawKey).replace(/\s/g, '');
    const key = aliasMap[rawKey] || aliasMap[normalizedKey];
    if (!key) return;
    const styleValues = normalizeAiFormatStyleValues(rawValue);
    const hasValue = Object.values(styleValues).some(value => value !== undefined && value !== '');
    if (!hasValue) return;
    values[key] = styleValues;
    const row = formatRuleRows.find(item => item.key === key);
    evidence.push(`${row?.label || key}：AI根据模板文本说明/样式样本识别`);
  });

  const rules: TemplateFormatRules = {};
  formatRuleRows.forEach(row => {
    const value = values[row.key];
    if (!value) return;
    rules[row.key] = { fontRequirement: value };
  });

  return {
    rules: Object.keys(rules).length ? rules : undefined,
    values,
    evidence,
  };
};

function parseAiHeadingResponse(response: string): AiTemplateExtractionResult {
  const parsed = extractJsonForAiTemplate(response);
  if (!parsed) return { nodes: [], requirementText: '', exampleText: '', evidence: [] };
  const rawItems = Array.isArray(parsed)
    ? parsed
    : parsed.nodes || parsed.headings || parsed.sections || parsed.outline || [];
  if (!Array.isArray(rawItems)) return { nodes: [], requirementText: '', exampleText: '', evidence: [] };

  const items = rawItems.map((item: any) => ({
    title: String(item.title || item.name || item.heading || '').trim(),
    level: Number(item.level || item.headingLevel) || 1,
    description: String(item.description || item.tips || item.note || '').trim(),
    requirementText: String(item.requirementText || item.requirement || item.requirements || item.writingRequirement || item.contentRequirement || '').trim(),
    exampleText: String(item.exampleText || item.example || item.sample || item.sampleText || item.referenceText || '').trim(),
    isRequired: item.isRequired,
  }));
  const nodes = nodesFromHeadingItems(items);
  const guidance = collectTemplateGuidance(nodes);
  const normalizedFormat = normalizeAiFormatRules(parsed.formatRules || parsed.styleRules || parsed.format || {});
  const requirementText = uniqueTextLines([
    String(parsed.requirementText || parsed.requirements || parsed.templateRequirements || '').trim(),
    guidance.requirementText,
  ]).join('\n\n').slice(0, 8000);
  const exampleText = uniqueTextLines([
    String(parsed.exampleText || parsed.examples || parsed.sampleText || parsed.referenceWriting || '').trim(),
    guidance.exampleText,
  ]).join('\n\n').slice(0, 10000);
  return {
    nodes,
    requirementText,
    exampleText,
    formatRules: normalizedFormat.rules,
    formatValues: normalizedFormat.values,
    evidence: [
      ...normalizeStringEvidence(parsed.evidence || parsed.formatEvidence),
      ...normalizedFormat.evidence,
    ].slice(0, 12),
  };
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
    const guidance = splitTemplateGuidanceText(h.description, h.title);
    const node: TemplateNode = {
      id: String(idCounter),
      title: h.title,
      level: h.level,
      isRequired: !isExampleHeadingText(h.title),
      description: guidance.requirementText || undefined,
      requirementText: guidance.requirementText || undefined,
      exampleText: guidance.exampleText || undefined,
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

function flattenVisibleTemplateNodeRows(nodes: TemplateNode[], collapsedIds: Set<string>, depth = 0): Array<{ node: TemplateNode; depth: number }> {
  return nodes.flatMap(node => [
    { node, depth },
    ...(node.children?.length && !collapsedIds.has(node.id) ? flattenVisibleTemplateNodeRows(node.children, collapsedIds, depth + 1) : []),
  ]);
}

function findTemplateNodeAncestorIds(nodes: TemplateNode[], targetId: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return trail;
    if (node.children?.length) {
      const found = findTemplateNodeAncestorIds(node.children, targetId, [...trail, node.id]);
      if (found) return found;
    }
  }
  return null;
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
  const [isPreparingTemplateEditor, setIsPreparingTemplateEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WritingTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<WritingTemplate | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [importedFilePath, setImportedFilePath] = useState<string>('');
  const [importedDocumentText, setImportedDocumentText] = useState<string>('');
  const [formatRuleEvidence, setFormatRuleEvidence] = useState<string[]>([]);
  const [fontOptions, setFontOptions] = useState(fallbackFontNames.map(font => ({ value: font })));
  const [form] = Form.useForm();
  const enableFormatRules = Form.useWatch('enableFormatRules', form);

  useEffect(() => {
    document.body.classList.toggle('template-editor-modal-open', isModalOpen);
    return () => document.body.classList.remove('template-editor-modal-open');
  }, [isModalOpen]);

  // 阶段管理状态
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<StageConfig | null>(null);
  const [stageForm] = Form.useForm();
  const allStages = getAllStages(customStages);

  // 模板结构编辑器状态
  const [templateNodes, setTemplateNodes] = useState<TemplateNode[]>([]);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [activeNodeId, setActiveNodeId] = useState<string>('');
  const nodeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const toggleTemplateNodeCollapsed = (id: string) => {
    setCollapsedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const focusTemplateNode = (id: string) => {
    const ancestors = findTemplateNodeAncestorIds(templateNodes, id) || [];
    if (ancestors.length > 0) {
      setCollapsedNodeIds(prev => {
        const next = new Set(prev);
        ancestors.forEach(parentId => next.delete(parentId));
        return next;
      });
    }
    setActiveNodeId(id);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        nodeCardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  };

  // 打开弹窗时初始化节点
  const initTemplateNodes = (template: WritingTemplate | null) => {
    if (template?.nodes) {
      setTemplateNodes(template.nodes);
    } else {
      setTemplateNodes([]);
    }
    setCollapsedNodeIds(new Set());
    setActiveNodeId('');
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
      const hasAnyValue = value.fontFamily || value.fontSize || value.letterSpacing || value.lineHeight || value.fontWeight;
      if (!hasAnyValue) return;
      rules[row.key] = {
        fontRequirement: {
          fontFamily: value.fontFamily,
          fontSize: value.fontSize,
          letterSpacing: value.letterSpacing,
          lineHeight: value.lineHeight,
          fontWeight: value.fontWeight || (row.defaultBold ? 'bold' : 'normal'),
        },
      };
    });
    return Object.keys(rules).length > 0 ? rules : undefined;
  };

  const flattenNodeCount = (nodes: TemplateNode[]): number =>
    nodes.reduce((count, node) => count + 1 + (node.children ? flattenNodeCount(node.children) : 0), 0);

  const countRequiredNodes = (nodes: TemplateNode[]): number =>
    nodes.reduce((count, node) => count + (node.isRequired ? 1 : 0) + (node.children ? countRequiredNodes(node.children) : 0), 0);

  const renderLevelControl = (node: TemplateNode) => {
    const level = Math.min(Math.max(node.level || 1, 1), 4);
    const setLevel = (nextLevel: number) => updateTemplateNodeLevel(node.id, Math.min(Math.max(nextLevel, 1), 4));
    return (
      <div className="template-node-level-stepper">
        <Button
          className="template-node-level-step"
          type="text"
          size="small"
          icon={<MinusOutlined />}
          disabled={level <= 1}
          onClick={() => setLevel(level - 1)}
        />
        <Dropdown
          trigger={['click']}
          menu={{
            selectedKeys: [String(level)],
            items: [1, 2, 3, 4].map(itemLevel => ({
              key: String(itemLevel),
              label: `第 ${itemLevel} 级`,
              onClick: () => setLevel(itemLevel),
            })),
          }}
        >
          <Button className="template-node-level-current" size="small">
            第 {level} 级
          </Button>
        </Dropdown>
        <Button
          className="template-node-level-step"
          type="text"
          size="small"
          icon={<PlusOutlined />}
          disabled={level >= 4}
          onClick={() => setLevel(level + 1)}
        />
      </div>
    );
  };

  const renderNodeRows = (nodes: TemplateNode[], depth = 0, prefix: number[] = []): React.ReactNode[] =>
    nodes.map((node, index) => {
      const hasChildren = Boolean(node.children?.length);
      const isCollapsed = collapsedNodeIds.has(node.id);
      const nodeNumber = [...prefix, index + 1];
      return (
        <React.Fragment key={node.id}>
        <div
          className={activeNodeId === node.id ? 'template-node-preview-row active' : 'template-node-preview-row'}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => focusTemplateNode(node.id)}
        >
          {hasChildren ? (
            <Button
              className="template-preview-collapse"
              type="text"
              size="small"
              icon={isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                toggleTemplateNodeCollapsed(node.id);
              }}
            />
          ) : (
            <span className="template-preview-collapse-spacer" />
          )}
          <span className="template-node-level">{nodeNumber.join('.')}</span>
          <Text strong style={{ fontSize: 12 }} ellipsis={{ tooltip: node.title }}>{node.title}</Text>
        </div>
        {hasChildren && !isCollapsed && (
          <div className="template-node-preview-children">
            <div className="template-node-preview-children-inner">
              {renderNodeRows(node.children || [], depth + 1, nodeNumber)}
            </div>
          </div>
        )}
        </React.Fragment>
      );
    });

  const renderEditorNodeRows = (nodes: TemplateNode[], depth = 0, prefix: number[] = []): React.ReactNode[] =>
    nodes.map((node, index) => {
      const hasChildren = Boolean(node.children?.length);
      const isCollapsed = collapsedNodeIds.has(node.id);
      const nodeNumber = [...prefix, index + 1];
      return (
        <React.Fragment key={node.id}>
          <div
            ref={(element) => { nodeCardRefs.current[node.id] = element; }}
            className={activeNodeId === node.id ? 'template-node-card active' : 'template-node-card'}
            style={{ marginLeft: depth * 18 }}
          >
            <div className="template-node-order">
              {hasChildren ? (
                <Button
                  className="template-node-collapse"
                  type="text"
                  size="small"
                  icon={isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                  onClick={() => toggleTemplateNodeCollapsed(node.id)}
                />
              ) : (
                <span className="template-node-collapse-spacer" />
              )}
              <HolderOutlined className="template-node-handle" />
              <span className="template-node-index">{nodeNumber.join('.')}</span>
            </div>

            <div className="template-node-content">
              <Input
                className="template-node-title-input"
                value={node.title}
                onChange={(e) => updateTemplateNode(node.id, { title: e.target.value })}
                placeholder="例如：一、项目概述"
              />
              <div className="template-node-subline">
                {renderLevelControl(node)}
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
          {hasChildren && !isCollapsed && (
            <div className="template-node-editor-children">
              <div className="template-node-editor-children-inner">
                {renderEditorNodeRows(node.children || [], depth + 1, nodeNumber)}
              </div>
            </div>
          )}
        </React.Fragment>
      );
    });

  const nodeTotal = flattenNodeCount(templateNodes);
  const requiredTotal = countRequiredNodes(templateNodes);

  const extractNodesWithAi = async (content: string): Promise<AiTemplateExtractionResult> => {
    const prompt = `你是“文档模板结构、写作要求、范文和格式规则”识别助手。请从下面的模板文本中同时识别：
1. 标题结构和标题层级。
2. 每个标题下哪些是硬性写作要求、填写说明、内容要求、格式要求。
3. 每个标题下哪些是范文、示例、样例、参考写法。范文只作为写法参考，不可当作硬性要求。
4. 文档不同部分的格式规则，包括一级标题、二级标题、三级标题、四级标题、正文、图题/图例、表题、表头。

请只返回 JSON 对象，不要 Markdown，不要代码块。格式如下：
{
  "nodes": [
    {
      "title": "原始章节标题",
      "level": 1,
      "requirementText": "该章节硬性要求/填写说明/内容要求/格式要求；没有则为空字符串",
      "exampleText": "该章节范文/示例/样例/参考写法；没有则为空字符串",
      "isRequired": true
    }
  ],
  "requirementText": "模板全局硬性要求、填写说明、格式/内容约束；不要包含范文正文",
  "exampleText": "模板全局范文、示例、样例、参考写法；只用于提取写作结构和表达方法",
  "formatRules": {
    "heading1": {"fontFamily":"字体名","fontSize":14,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"bold"},
    "heading2": {"fontFamily":"字体名","fontSize":14,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"bold"},
    "heading3": {"fontFamily":"字体名","fontSize":14,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"bold"},
    "heading4": {"fontFamily":"字体名","fontSize":12,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"bold"},
    "body": {"fontFamily":"字体名","fontSize":12,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"normal"},
    "caption": {"fontFamily":"字体名","fontSize":10.5,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"normal"},
    "tableTitle": {"fontFamily":"字体名","fontSize":10.5,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"normal"},
    "tableHeader": {"fontFamily":"字体名","fontSize":10.5,"lineHeight":1.5,"letterSpacing":0,"fontWeight":"bold"}
  },
  "evidence": ["格式或分类识别依据，简短说明"]
}

识别规则：
1. level 只允许 1-4。按上下文判断：“一、/第X章”通常为1级，“（一）”通常为2级，“1.”通常为3级，“（1）”通常为4级；如果文档实际层级不同，以上下文为准。
2. requirementText 只放“要求、应当、必须、需、填写、说明、格式、字号、字体、行距、内容包括、提交材料、指标、标准、依据”等约束性内容。
3. exampleText 只放“范文、示例、示范、样例、参考写法、参考内容、例如、如下所示”等样例性内容。
4. 不要把范文中的项目事实、金额、时间、数据、背景当成当前模板要求。
5. 目录、页码、页眉页脚、乱码、孤立正文句子不要作为标题。
6. 如果格式在文本中明确说明，按说明提取；如果没有说明但模板文本明显展示了对应样式，请根据样式样本推断，并在 evidence 中说明。

模板文本：
${content.slice(0, 30000)}`;

    const response = await window.electronAPI.callAI(prompt);
    return parseAiHeadingResponse(response);
  };

  const applyAiTemplateExtraction = async (result: AiTemplateExtractionResult, successPrefix = 'AI 已识别') => {
    if (result.nodes.length === 0) {
      message.warning('AI 未返回可用章节，请检查 AI 配置或文档内容');
      return false;
    }

    const fallbackGuidance = collectTemplateGuidance(result.nodes, importedDocumentText);
    const requirementText = result.requirementText || fallbackGuidance.requirementText;
    const exampleText = result.exampleText || fallbackGuidance.exampleText;
    const currentFormatValues = form.getFieldValue('formatRules') || buildDefaultFormatFormValues();
    const mergedFormatValues = mergeFormatFormValues(
      currentFormatValues,
      result.formatValues || formatRulesToPartialFormValues(result.formatRules),
    );
    const evidence = result.evidence.slice(0, 12);

    form.setFieldsValue({
      requirementText,
      exampleText,
      ...(Object.keys(result.formatValues || {}).length || result.formatRules
        ? { enableFormatRules: true, formatRules: mergedFormatValues }
        : {}),
    });
    if (evidence.length > 0) {
      setFormatRuleEvidence(evidence);
    }
    setTemplateNodes(result.nodes);
    message.success(`${successPrefix} ${result.nodes.length} 个章节${evidence.length ? `，并补充 ${evidence.length} 条格式/分类依据` : ''}`);
    return true;
  };

  const enrichAiResultWithSourceFormat = async (result: AiTemplateExtractionResult) => {
    const fileExt = importedFilePath.split('.').pop()?.toLowerCase();
    if (!importedFilePath || (fileExt !== 'docx' && fileExt !== 'doc') || !window.electronAPI.extractTemplateFormatRules) {
      return result;
    }
    try {
      const formatResult = await window.electronAPI.extractTemplateFormatRules(importedFilePath);
      if (!formatResult.success || !formatResult.formatRules) return result;
      const actualValues = formatRulesToPartialFormValues(formatResult.formatRules as TemplateFormatRules);
      return {
        ...result,
        formatValues: mergeFormatFormValues(result.formatValues || {}, actualValues),
        evidence: [
          ...(formatResult.evidence || []),
          ...result.evidence,
        ].slice(0, 12),
      };
    } catch (error) {
      console.warn('Template source format enrichment failed:', error);
      return result;
    }
  };

  const handleAiExtract = async () => {

    if (!importedDocumentText) {
      message.warning('请先选择并解析一个文件');
      return;
    }

    setIsAiExtracting(true);
    try {
      const aiResult = await enrichAiResultWithSourceFormat(await extractNodesWithAi(importedDocumentText));
      await applyAiTemplateExtraction(aiResult);
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
    setIsPreparingTemplateEditor(true);
    setEditingTemplate(null);
    setIsModalOpen(true);
    window.requestAnimationFrame(() => {
      setImportedFilePath('');
      setImportedDocumentText('');
      setFormatRuleEvidence([]);
      form.resetFields();
      form.setFieldsValue({
        outputFileType: 'docx',
        requirementText: '',
        exampleText: '',
        enableFormatRules: false,
        formatRules: buildDefaultFormatFormValues(),
      });
      initTemplateNodes(null);
      setIsPreparingTemplateEditor(false);
    });
  };

  const handleEdit = (template: WritingTemplate) => {
    setIsPreparingTemplateEditor(true);
    setEditingTemplate(template);
    setIsModalOpen(true);
    window.requestAnimationFrame(() => {
      setImportedDocumentText('');
      setFormatRuleEvidence([]);
      form.setFieldsValue({
        name: template.name,
        description: template.description,
        requirementText: template.requirementText || collectTemplateGuidance(template.nodes || []).requirementText,
        exampleText: template.exampleText || collectTemplateGuidance(template.nodes || []).exampleText,
        category: template.category,
        outputFileType: template.outputFileType || inferOutputFileType(template.filePath || ''),
        enableFormatRules: Boolean(template.formatRules || template.titleFontRequirement || template.bodyFontRequirement),
        formatRules: flattenFormatRulesForForm(template.formatRules || {
          heading1: { fontRequirement: template.titleFontRequirement },
          body: { fontRequirement: template.bodyFontRequirement },
        }),
      });
      initTemplateNodes(template);
      setIsPreparingTemplateEditor(false);
    });
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
    setDeletingTemplate(null);
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
        requirementText: String(values.requirementText || '').trim(),
        exampleText: String(values.exampleText || '').trim(),
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
        { name: '文档文件', extensions: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'txt', 'md', 'rtf'] },
        { name: '所有文件', extensions: ['*'] },
      ]);
      if (!filePath) return;

      setIsExtracting(true);
      setImportedFilePath(filePath);
      setImportedDocumentText('');
      setFormatRuleEvidence([]);

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

      const textualFormat = inferFormatRulesFromText(result.content);
      let actualFormatValues: Record<string, any> = {};
      const actualEvidence: string[] = [];
      if ((fileExt === 'docx' || fileExt === 'doc') && window.electronAPI.extractTemplateFormatRules) {
        try {
          const formatResult = await window.electronAPI.extractTemplateFormatRules(filePath);
          if (formatResult.success && formatResult.formatRules) {
            actualFormatValues = formatRulesToPartialFormValues(formatResult.formatRules as TemplateFormatRules);
            actualEvidence.push(...(formatResult.evidence || []));
          }
        } catch (error) {
          console.warn('Template format extraction failed:', error);
        }
      }
      const currentFormatValues = form.getFieldValue('formatRules') || buildDefaultFormatFormValues();
      const mergedFormatValues = mergeFormatFormValues(
        mergeFormatFormValues(currentFormatValues, actualFormatValues),
        textualFormat.values,
      );
      const evidence = [...actualEvidence, ...textualFormat.evidence].slice(0, 12);
      if (evidence.length > 0) {
        form.setFieldsValue({ enableFormatRules: true, formatRules: mergedFormatValues });
        setFormatRuleEvidence(evidence);
      }

      const nodes = extractTemplateNodes(result.content);
      if (nodes.length === 0) {
        try {
          const aiResult = await extractNodesWithAi(result.content);
          if (await applyAiTemplateExtraction(aiResult, '规则未检测到章节，AI 已识别')) {
            return;
          }
        } catch {}
        message.warning('文件已关联并填入模板名称，但未检测到章节标题。可以点击“AI识别结构/要求/格式”重试，或确认文档使用了一、二、三 / 第X章 / 1. 2. 3. 等编号格式。');
        return;
      }

      const guidance = collectTemplateGuidance(nodes, result.content);
      form.setFieldsValue({ requirementText: guidance.requirementText, exampleText: guidance.exampleText });
      setTemplateNodes(nodes);
      message.success(`已从 ${result.fileName || '文档'} 提取 ${nodes.length} 个章节${evidence.length ? `，并识别 ${evidence.length} 条格式依据` : ''}`);
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
          <Text type="secondary" style={{ fontSize: 13 }}>维护写作模板结构，可从 Word、PPT、Excel、PDF、文本等文档中提取章节</Text>
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
                  <Button
                    key="edit"
                    className="template-card-action"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(template)}
                  />,
                  <Button
                    key="delete"
                    title="确定删除此模板？"
                    className="template-card-action"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setDeletingTemplate(template)}
                  />,
                ]}
              >
                <Card.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                  title={template.name}
                  description={
                    <div>
                      <Tag color="blue" style={{ marginBottom: 8 }}>{template.category}</Tag>
                      <br />
                      <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>{template.description}</Paragraph>
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
        rootClassName="template-editor-modal-root"
        title={editingTemplate ? '编辑模板' : '创建模板'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        afterClose={() => document.body.classList.remove('template-editor-modal-open')}
        destroyOnClose
        width="min(88vw, 1560px)"
        okText="保存模板"
        cancelText="取消"
        transitionName="template-modal-motion"
        maskTransitionName="template-modal-mask-motion"
        style={{ top: 0, maxHeight: 'calc(100vh - 16px)' }}
        styles={{ body: { overflow: 'hidden' } }}
        okButtonProps={{ disabled: isPreparingTemplateEditor }}
      >
        {isPreparingTemplateEditor ? (
          <div className="template-editor-loading">
            <Spin tip="正在准备模板..." />
          </div>
        ) : (
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

                <Form.Item
                  name="requirementText"
                  label="模板要求/填写说明"
                >
                  <TextArea rows={3} placeholder="导入后自动识别硬性要求、内容要求、格式要求；可人工修正" />
                </Form.Item>

                <Form.Item
                  name="exampleText"
                  label="范文/参考写法"
                >
                  <TextArea rows={3} placeholder="导入后自动识别范文、示例、样例内容；仅作为写法参考，不作为硬性要求" />
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

                {enableFormatRules && formatRuleEvidence.length > 0 && (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#f8fbff', marginBottom: 10 }}>
                    <Text strong style={{ fontSize: 12 }}>格式识别依据</Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {formatRuleEvidence.map(item => <Tag key={item} color="blue" style={{ margin: 0 }}>{item}</Tag>)}
                    </div>
                  </div>
                )}

                {enableFormatRules && (
                  <div className="template-format-table">
                    <div className="template-format-head">
                      <span>样式</span>
                      <span>字体</span>
                      <span>字号</span>
                      <span>字间距</span>
                      <span>行间距</span>
                      <span>字重</span>
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
                        <Form.Item name={['formatRules', row.key, 'fontWeight']} style={{ margin: 0 }}>
                          <Select options={[{ value: 'normal', label: '常规' }, { value: 'bold', label: '加粗' }]} />
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
                    支持 .doc/.docx/.ppt/.pptx/.xls/.xlsx/.pdf/.txt/.md/.rtf，自动识别章节标题并保留源文件用于后续创建文件。
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
                    AI识别结构/要求/格式
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
              {renderEditorNodeRows(templateNodes)}
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
        )}
      </Modal>

      <Modal
        title="删除模板"
        open={Boolean(deletingTemplate)}
        onOk={() => deletingTemplate && handleDelete(deletingTemplate.id)}
        onCancel={() => setDeletingTemplate(null)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Text>
          确定删除“{deletingTemplate?.name}”吗？此操作不会删除已保存的项目文档。
        </Text>
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

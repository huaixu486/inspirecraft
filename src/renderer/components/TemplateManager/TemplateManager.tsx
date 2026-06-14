import React, { useDeferredValue, useEffect, useRef, useState, useMemo } from 'react';
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
  LeftOutlined,
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

const formatTemplateAiError = (error: any): string => {
  const raw = String(error?.message || error || '').trim();
  const cleaned = raw
    .replace(/^Error invoking remote method ['"]ai:call['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/^AI 调用失败:\s*/i, '');

  if (/ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ECONNRESET|socket hang up|连接被中断/i.test(cleaned)) {
    return 'AI 接口连接被中断，系统已自动重试但仍失败。请检查网络/代理/API 地址，或稍后再试。';
  }
  if (/ETIMEDOUT|ERR_TIMED_OUT|请求超时|超时/i.test(cleaned)) {
    return 'AI 接口请求超时。建议检查网络/代理，或减少导入文档内容后再试。';
  }
  if (/thinking|思考块|输出额度耗尽|max_tokens|没有返回最终文本/i.test(cleaned)) {
    return 'AI 只返回了思考过程，没有返回最终结构。系统已自动尝试本地结构兜底；建议减少导入内容，或在模型服务中关闭思考输出/提高输出上限后重试。';
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|getaddrinfo|无法解析/i.test(cleaned)) {
    return '无法连接到 AI 接口地址，请检查 AI 设置里的接口地址或当前网络 DNS。';
  }
  if (/401|403|api.?key|unauthorized|forbidden|鉴权|密钥/i.test(cleaned)) {
    return 'AI 鉴权失败，请检查 API Key、模型权限和接口地址是否匹配。';
  }
  return cleaned || 'AI 章节识别失败，请检查 AI 配置后重试。';
};

const normalizeAiJsonText = (value: string): string =>
  String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .trim();

const parseJsonCandidateForTemplate = (value: string): any | null => {
  const candidates = [value, normalizeAiJsonText(value)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
};

const extractJsonForAiTemplate = (response: string): any | null => {
  const trimmed = normalizeAiJsonText(String(response || '').trim());
  const direct = parseJsonCandidateForTemplate(trimmed);
  if (direct) return direct;

  const fenceMatch = String(response || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const parsedFence = parseJsonCandidateForTemplate(fenceMatch[1]);
    if (parsedFence) return parsedFence;
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsedObject = parseJsonCandidateForTemplate(objectMatch[0]);
    if (parsedObject) return parsedObject;
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsedArray = parseJsonCandidateForTemplate(arrayMatch[0]);
    if (parsedArray) return parsedArray;
  }
  return null;
};

const firstStringValue = (source: any, keys: string[]): string => {
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) return value.filter(Boolean).join('\n');
    if (typeof value === 'object') return Object.values(value).filter(Boolean).join('\n');
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const normalizeAiHeadingLevel = (value: any, title: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(Math.max(value, 1), 4);
  const text = String(value || '').trim();
  const numeric = Number(text.match(/\d+/)?.[0]);
  if (Number.isFinite(numeric) && numeric > 0) return Math.min(Math.max(numeric, 1), 4);
  if (/一级|一[级級]|h1|heading1/i.test(text)) return 1;
  if (/二级|二[级級]|h2|heading2/i.test(text)) return 2;
  if (/三级|三[级級]|h3|heading3/i.test(text)) return 3;
  if (/四级|四[级級]|h4|heading4/i.test(text)) return 4;
  const heading = matchHeadingLine(title);
  return heading?.level || 1;
};

const collectAiTemplateItems = (parsed: any): any[] => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];

  const direct = parsed.nodes
    || parsed.headings
    || parsed.sections
    || parsed.outline
    || parsed.structure
    || parsed.templateNodes
    || parsed.templateStructure
    || parsed.chapterStructure
    || parsed.chapters
    || parsed.items
    || parsed['nodes']
    || parsed['headings']
    || parsed['sections']
    || parsed['outline']
    || parsed['章节']
    || parsed['章节结构']
    || parsed['标题结构']
    || parsed['模板章节']
    || parsed['大纲']
    || parsed['目录'];
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') {
    const nested = collectAiTemplateItems(direct);
    if (nested.length > 0) return nested;
  }

  const nestedContainers = [parsed.template, parsed.result, parsed.data, parsed.content, parsed.analysis].filter(Boolean);
  for (const container of nestedContainers) {
    const nested = collectAiTemplateItems(container);
    if (nested.length > 0) return nested;
  }

  const metadataKeys = new Set([
    'formatRules', 'styleRules', 'format', 'evidence', 'formatEvidence',
    'requirementText', 'requirements', 'templateRequirements',
    'exampleText', 'examples', 'sampleText', 'referenceWriting',
    '格式规则', '格式要求', '识别依据', '格式依据', '模板要求', '填写说明', '写作要求', '范文', '示例', '参考写法'
  ]);
  const entryItems = Object.entries(parsed)
    .filter(([key, value]) => !metadataKeys.has(key) && value && typeof value === 'object')
    .map(([key, value]: [string, any]) => ({
      title: value.title || value.heading || value.name || key,
      ...value,
    }));
  return entryItems.length > 0 ? entryItems : [];
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
  const rawItems = collectAiTemplateItems(parsed);

  const items = rawItems.map((item: any) => {
    const title = firstStringValue(item, [
      'title', 'name', 'heading', 'headingTitle', 'sectionTitle', 'chapterTitle', 'label', 'text',
      '标题', '名称', '章节标题', '标题名称', '章标题', '节标题'
    ]);
    return {
      title: title.trim(),
      level: normalizeAiHeadingLevel(item.level ?? item.headingLevel ?? item.depth ?? item.type ?? item['level'] ?? item['层级'] ?? item['标题级别'], title),
      description: firstStringValue(item, ['description', 'tips', 'note', 'notes', 'summary', '说明', '描述', '备注', '写作说明']).trim(),
      requirementText: firstStringValue(item, [
        'requirementText', 'requirement', 'requirements', 'writingRequirement', 'contentRequirement', 'formatRequirement',
        '要求', '写作要求', '填写说明', '内容要求', '格式要求'
      ]).trim(),
      exampleText: firstStringValue(item, [
        'exampleText', 'example', 'examples', 'sample', 'sampleText', 'referenceText', 'referenceWriting',
        '范文', '示例', '样例', '参考写法', '参考内容'
      ]).trim(),
      isRequired: item.isRequired ?? item.required ?? item['是否必需'],
    };
  });
  const nodes = nodesFromHeadingItems(items);
  const guidance = collectTemplateGuidance(nodes);
  const normalizedFormat = normalizeAiFormatRules(parsed.formatRules || parsed.styleRules || parsed.format || parsed['格式规则'] || parsed['格式要求'] || {});
  const requirementText = uniqueTextLines([
    firstStringValue(parsed, ['requirementText', 'requirements', 'templateRequirements', 'writingRequirements', '模板要求', '填写说明', '写作要求']),
    guidance.requirementText,
  ]).join('\n\n').slice(0, 8000);
  const exampleText = uniqueTextLines([
    firstStringValue(parsed, ['exampleText', 'examples', 'sampleText', 'referenceWriting', '范文', '示例', '参考写法']),
    guidance.exampleText,
  ]).join('\n\n').slice(0, 10000);
  return {
    nodes,
    requirementText,
    exampleText,
    formatRules: normalizedFormat.rules,
    formatValues: normalizedFormat.values,
    evidence: [
      ...normalizeStringEvidence(parsed.evidence || parsed.formatEvidence || parsed['识别依据'] || parsed['格式依据']),
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

type ImportedTemplateFile = { filePath: string; text: string; fileName?: string };

function normalizeTemplateHeadingTitle(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^第[一二三四五六七八九十百千万\d]+[章节篇部分]/, '')
    .replace(/^[一二三四五六七八九十百千万\d]+[、.．]/, '')
    .replace(/^[（(][一二三四五六七八九十百千万\d]+[）)]/, '')
    .replace(/^\d+(?:[.．]\d+)*[、.．)]?/, '')
    .replace(/[：:。.]$/, '')
    .toLowerCase();
}

function flattenTemplateNodesForMatch(nodes: TemplateNode[]): TemplateNode[] {
  return nodes.flatMap(node => [
    node,
    ...(node.children?.length ? flattenTemplateNodesForMatch(node.children) : []),
  ]);
}

function getCommonExampleHeadingKeys(files: ImportedTemplateFile[]) {
  const extracted = files.map(file => extractTemplateNodes(file.text));
  const keySets = extracted.map(nodes => {
    const keys = new Set<string>();
    flattenTemplateNodesForMatch(nodes).forEach(node => {
      const key = normalizeTemplateHeadingTitle(node.title);
      if (key) keys.add(key);
    });
    return keys;
  });
  const commonKeys = new Set<string>(keySets[0] || []);
  keySets.slice(1).forEach(keys => {
    [...commonKeys].forEach(key => {
      if (!keys.has(key)) commonKeys.delete(key);
    });
  });
  return { commonKeys, extracted };
}

function mergeCommonExampleNodeGuidance(node: TemplateNode, extracted: TemplateNode[][]): TemplateNode {
  const key = normalizeTemplateHeadingTitle(node.title);
  const sameTitleNodes = extracted
    .flatMap(nodes => flattenTemplateNodesForMatch(nodes))
    .filter(item => normalizeTemplateHeadingTitle(item.title) === key);
  const descriptions = uniqueTextLines([
    node.description || '',
    ...sameTitleNodes.map(item => item.description || ''),
  ]).join('\n\n');
  const requirementText = uniqueTextLines([
    node.requirementText || '',
    ...sameTitleNodes.map(item => item.requirementText || ''),
  ]).join('\n\n');
  const exampleText = uniqueTextLines([
    node.exampleText || '',
    ...sameTitleNodes.map(item => item.exampleText || ''),
  ]).join('\n\n');
  return {
    ...node,
    description: descriptions || node.description,
    requirementText: requirementText || node.requirementText,
    exampleText: exampleText || node.exampleText,
  };
}

function filterNodesByCommonExampleHeadings(
  nodes: TemplateNode[],
  commonKeys: Set<string>,
  extracted: TemplateNode[][],
): TemplateNode[] {
  return nodes.flatMap(node => {
    const children = node.children?.length
      ? filterNodesByCommonExampleHeadings(node.children, commonKeys, extracted)
      : [];
    const key = normalizeTemplateHeadingTitle(node.title);
    if (!key || !commonKeys.has(key)) return children;
    return [{ ...mergeCommonExampleNodeGuidance(node, extracted), children: children.length ? children : undefined }];
  });
}

function buildCommonExampleTemplateNodes(sourceNodes: TemplateNode[], files: ImportedTemplateFile[]) {
  if (files.length < 2) {
    return { nodes: sourceNodes, evidence: '' };
  }
  const { commonKeys, extracted } = getCommonExampleHeadingKeys(files);
  let nodes = filterNodesByCommonExampleHeadings(sourceNodes, commonKeys, extracted);
  if (nodes.length === 0 && extracted[0]?.length) {
    nodes = filterNodesByCommonExampleHeadings(extracted[0], commonKeys, extracted);
  }
  return {
    nodes,
    evidence: `已按 ${files.length} 篇范文取共同标题，保留 ${flattenTemplateNodesForMatch(nodes).length} 个共同章节`,
  };
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

function collectTemplateNodeMoveAvailability(nodes: TemplateNode[]): { up: Set<string>; down: Set<string> } {
  const up = new Set<string>();
  const down = new Set<string>();
  const visit = (items: TemplateNode[]) => {
    items.forEach((node, index) => {
      if (index > 0) up.add(node.id);
      if (index < items.length - 1) down.add(node.id);
      if (node.children?.length) visit(node.children);
    });
  };
  visit(nodes);
  return { up, down };
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

function collectTemplateNodeIdsByLevel(nodes: TemplateNode[], levels: number[]): string[] {
  const allowed = new Set(levels);
  const ids: string[] = [];
  const visit = (items: TemplateNode[]) => {
    items.forEach(node => {
      if (allowed.has(node.level)) ids.push(node.id);
      if (node.children?.length) visit(node.children);
    });
  };
  visit(nodes);
  return ids;
}

function countSelectedTemplateNodesWithChildren(nodes: TemplateNode[], selectedIds: Set<string>, parentSelected = false): number {
  return nodes.reduce((count, node) => {
    const selected = parentSelected || selectedIds.has(node.id);
    return count + (selected ? 1 : 0) + (node.children?.length ? countSelectedTemplateNodesWithChildren(node.children, selectedIds, selected) : 0);
  }, 0);
}

function removeTemplateNodesByIds(nodes: TemplateNode[], selectedIds: Set<string>): TemplateNode[] {
  return nodes
    .filter(node => !selectedIds.has(node.id))
    .map(node => node.children?.length ? { ...node, children: removeTemplateNodesByIds(node.children, selectedIds) } : node);
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

const TemplateManager: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const templates = useTemplateStore(state => state.templates);
  const loadTemplates = useTemplateStore(state => state.loadTemplates);
  const addTemplate = useTemplateStore(state => state.addTemplate);
  const updateTemplate = useTemplateStore(state => state.updateTemplate);
  const deleteTemplate = useTemplateStore(state => state.deleteTemplate);
  const customStages = useSettingsStore(state => state.customStages);
  const saveAllStages = useSettingsStore(state => state.saveAllStages);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPreparingTemplateEditor, setIsPreparingTemplateEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WritingTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<WritingTemplate | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [importedFiles, setImportedFiles] = useState<Array<{ filePath: string; text: string; fileName?: string }>>([]);
  const [formatRuleEvidence, setFormatRuleEvidence] = useState<string[]>([]);
  const [fontOptions, setFontOptions] = useState(fallbackFontNames.map(font => ({ value: font })));
  const [headingLevelFilter, setHeadingLevelFilter] = useState<number[]>([1, 2, 3, 4]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [isStageSectionExpanded, setIsStageSectionExpanded] = useState(false);
  const hasRequestedTemplateRefreshRef = useRef(false);
  const hasRequestedFontsRef = useRef(false);
  const [form] = Form.useForm();
  const enableFormatRules = Form.useWatch('enableFormatRules', form);
  const templateType = Form.useWatch('templateType', form);

  // 兼容：合并所有导入文件的文本
  const importedDocumentText = useMemo(() => importedFiles.map(f => f.text).join('\n\n'), [importedFiles]);
  const importedFilePath = importedFiles[0]?.filePath || '';

  useEffect(() => {
    document.body.classList.toggle('template-editor-modal-open', isModalOpen);
    return () => document.body.classList.remove('template-editor-modal-open');
  }, [isModalOpen]);

  // 阶段管理状态
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<StageConfig | null>(null);
  const [stageForm] = Form.useForm();
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);

  // 模板结构编辑器状态
  const [templateNodes, setTemplateNodes] = useState<TemplateNode[]>([]);
  const deferredPreviewNodes = useDeferredValue(templateNodes);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [activeNodeId, setActiveNodeId] = useState<string>('');
  const nodeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 缓存：实际存在的标题级别
  const availableLevels = useMemo(() => {
    const levels = new Set<number>();
    const collect = (nodes: TemplateNode[]) => {
      nodes.forEach(n => { levels.add(n.level); if (n.children) collect(n.children); });
    };
    collect(templateNodes);
    return Array.from(levels).sort();
  }, [templateNodes]);

  const activeHeadingLevelFilter = useMemo(() => {
    if (availableLevels.length === 0) return headingLevelFilter;
    const validLevels = headingLevelFilter.filter(level => availableLevels.includes(level));
    return validLevels.length > 0 ? validLevels : availableLevels;
  }, [availableLevels, headingLevelFilter]);

  const filteredNodeIds = useMemo(
    () => collectTemplateNodeIdsByLevel(templateNodes, activeHeadingLevelFilter),
    [activeHeadingLevelFilter, templateNodes]
  );
  const filteredNodeIdSet = useMemo(() => new Set(filteredNodeIds), [filteredNodeIds]);
  const selectedFilteredCount = useMemo(
    () => Array.from(selectedNodeIds).filter(id => filteredNodeIdSet.has(id)).length,
    [filteredNodeIdSet, selectedNodeIds]
  );
  const allFilteredSelected = filteredNodeIds.length > 0 && selectedFilteredCount === filteredNodeIds.length;
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;
  const selectedCascadeCount = useMemo(
    () => countSelectedTemplateNodesWithChildren(templateNodes, selectedNodeIds),
    [selectedNodeIds, templateNodes]
  );

  const templateNodeMoveAvailability = useMemo(
    () => collectTemplateNodeMoveAvailability(templateNodes),
    [templateNodes]
  );

  useEffect(() => {
    if (availableLevels.length === 0) {
      setSelectedNodeIds(prev => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const validLevels = headingLevelFilter.filter(level => availableLevels.includes(level));
    if (validLevels.length !== headingLevelFilter.length || validLevels.length === 0) {
      setHeadingLevelFilter(validLevels.length > 0 ? validLevels : availableLevels);
    }

    const validIds = new Set(collectTemplateNodeIdsByLevel(templateNodes, validLevels.length > 0 ? validLevels : availableLevels));
    setSelectedNodeIds(prev => {
      const next = new Set(Array.from(prev).filter(id => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableLevels, headingLevelFilter, templateNodes]);

  const handleHeadingLevelFilterChange = (levels: number[]) => {
    const nextLevels = levels.length > 0 ? levels : availableLevels;
    const nextIds = new Set(collectTemplateNodeIdsByLevel(templateNodes, nextLevels));
    setHeadingLevelFilter(nextLevels);
    setSelectedNodeIds(prev => {
      const next = new Set(Array.from(prev).filter(id => nextIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  };

  const toggleSelectFilteredNodes = () => {
    setSelectedNodeIds(allFilteredSelected ? new Set() : new Set(filteredNodeIds));
  };

  const deleteSelectedTemplateNodes = () => {
    setTemplateNodes(prev => removeTemplateNodesByIds(prev, selectedNodeIds));
    setSelectedNodeIds(new Set());
    setActiveNodeId(prev => (selectedNodeIds.has(prev) ? '' : prev));
    message.success(`已删除 ${selectedCascadeCount} 个章节`);
  };

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
    const { projects, versions, updateProject } = useProjectStore.getState();
    const { addProjectDoc, updateProjectDoc } = useProjectDocStore.getState();
    const currentTemplates = useTemplateStore.getState().templates;
    let totalMatched = 0;

    for (const project of projects) {
      if (!project.folderPath) continue;
      const result = await syncProjectStageFiles(project, {
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates: currentTemplates,
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
    nodes
      .filter(node => nodeMatchesFilter(node, activeHeadingLevelFilter))
      .map((node, index) => {
        const hasChildren = Boolean(node.children?.length);
        const isCollapsed = collapsedNodeIds.has(node.id);
        const nodeNumber = [...prefix, index + 1];
        const nodeVisible = activeHeadingLevelFilter.includes(node.level);
        return (
          <React.Fragment key={node.id}>
          <div
            className={activeNodeId === node.id ? 'template-node-preview-row active' : 'template-node-preview-row'}
            style={{ paddingLeft: 8 + depth * 16, opacity: nodeVisible ? 1 : 0.4 }}
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

  // 递归检查节点或其子节点是否匹配筛选
  const nodeMatchesFilter = (node: TemplateNode, filter: number[]): boolean => {
    if (filter.includes(node.level)) return true;
    return node.children?.some(c => nodeMatchesFilter(c, filter)) || false;
  };

  const renderEditorNodeRows = (nodes: TemplateNode[], depth = 0, prefix: number[] = []): React.ReactNode[] =>
    nodes
      .filter(node => nodeMatchesFilter(node, activeHeadingLevelFilter))
      .map((node, index) => {
        const hasChildren = Boolean(node.children?.length);
        const isCollapsed = collapsedNodeIds.has(node.id);
        const nodeNumber = [...prefix, index + 1];
        const isSelected = selectedNodeIds.has(node.id);
        const nodeVisible = activeHeadingLevelFilter.includes(node.level);
        return (
          <React.Fragment key={node.id}>
            <div
              ref={(element) => { nodeCardRefs.current[node.id] = element; }}
              className={`template-node-card${activeNodeId === node.id ? ' active' : ''}${nodeVisible ? '' : ' filtered-context'}`}
              style={{ marginLeft: depth * 18 }}
            >
              <div className="template-node-order">
                <input
                  type="checkbox"
                  className="template-node-selectbox"
                  checked={nodeVisible && isSelected}
                  disabled={!nodeVisible}
                  title={nodeVisible ? '选择该筛选结果' : '仅作为层级上下文显示'}
                  onChange={(e) => {
                    if (!nodeVisible) return;
                    setSelectedNodeIds(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(node.id);
                      else next.delete(node.id);
                      return next;
                    });
                  }}
                />
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
                  {node.description ? (templateType === 'example' ? '已提取写作方法/技巧提示' : '已从导入文件提取章节说明') : '可作为文档进度检测节点'}
                </Text>
              </div>
              <TextArea
                className="template-node-description-input"
                value={node.description}
                onChange={(e) => updateTemplateNode(node.id, { description: e.target.value })}
                placeholder={templateType === 'example' ? '写作方法、技巧、内容要点提示（供后续写作参考）' : '可填写或确认该章节的内容要求、格式要求、审阅重点'}
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
                  disabled={!templateNodeMoveAvailability.up.has(node.id)}
                  icon={<UpOutlined />}
                  onClick={() => moveTemplateNode(node.id, 'up')}
                />
                <Button
                  type="text"
                  size="small"
                  disabled={!templateNodeMoveAvailability.down.has(node.id)}
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

  const editorNodeRows = useMemo(
    () => renderEditorNodeRows(templateNodes),
    [templateNodes, activeHeadingLevelFilter, collapsedNodeIds, activeNodeId, selectedNodeIds, templateType, templateNodeMoveAvailability]
  );
  const previewNodeRows = useMemo(
    () => renderNodeRows(deferredPreviewNodes),
    [deferredPreviewNodes, activeHeadingLevelFilter, collapsedNodeIds, activeNodeId]
  );
  const nodeTotal = useMemo(() => flattenNodeCount(templateNodes), [templateNodes]);
  const requiredTotal = useMemo(() => countRequiredNodes(templateNodes), [templateNodes]);
  const templateCardItems = useMemo(
    () => templates.map(template => ({
      template,
      nodeCount: flattenNodeCount(template.nodes || []),
    })),
    [templates]
  );

  const extractNodesWithAi = async (content: string): Promise<AiTemplateExtractionResult> => {
    const currentType = form.getFieldValue('templateType') || 'direct';
    const fileCount = importedFiles.length;

    const multiFileNote = fileCount > 1
      ? `\n注意：本次导入了 ${fileCount} 篇范文。章节结构只保留各篇范文中名称相同的共同标题；不要把只出现在单篇范文里的项目化小标题、个性化小节放入 nodes。一级标题通常是共同写作大方向，应优先保留。差异性的内容只总结进 description 或 evidence。`
      : '';

    const examplePrompt = `你是”范文写作分析”助手。下面是${fileCount > 1 ? `${fileCount}篇范文` : '一篇范文'}，请分析其写作方法、格式特征和结构，生成一份写作指导。${multiFileNote}

分析要求：
1. 提取范文的章节结构（标题和层级）。如果是多篇范文，只输出各篇都出现过的共同标题/共同写作骨架；同名标题可忽略编号差异，例如“一、项目背景”和“1. 项目背景”视为同一标题。
2. 对每个章节，分析：
   - 该章节的写作方法和技巧（如论述方式、数据运用、逻辑结构）
   - 建议字数范围（基于范文实际字数）
   - 内容要点提示（该章节应该包含什么）
3. 提取范文的整体格式规范（标题字体、正文字体、字号、行距等）
4. 总结范文的整体写作风格和特点

请只返回 JSON 对象，不要 Markdown，不要代码块。格式如下：
{
  “nodes”: [
    {
      “title”: “章节标题”,
      “level”: 1,
      “description”: “该章节的写作方法/技巧/内容要点提示（供后续写作参考，不是硬性要求）”,
      “requirementText”: “建议字数：约XXX字”,
      “isRequired”: true
    }
  ],
  “formatRules”: {
    “heading1”: {“fontFamily”:”字体名”,”fontSize”:14,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “heading2”: {“fontFamily”:”字体名”,”fontSize”:14,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “heading3”: {“fontFamily”:”字体名”,”fontSize”:14,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “heading4”: {“fontFamily”:”字体名”,”fontSize”:12,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “body”: {“fontFamily”:”字体名”,”fontSize”:12,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”normal”},
    “caption”: {“fontFamily”:”字体名”,”fontSize”:10.5,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”normal”},
    “tableTitle”: {“fontFamily”:”字体名”,”fontSize”:10.5,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”normal”},
    “tableHeader”: {“fontFamily”:”字体名”,”fontSize”:10.5,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”}
  },
  “evidence”: [“格式或分类识别依据，简短说明”]
}

规则：
1. level 只允许 1-4。
2. description 要写具体的写作方法和技巧，不是直接复制范文原文，而是分析总结。
3. requirementText 只写建议字数，不要写硬性要求。
4. 格式规则要从范文中实际使用的格式推断，如果范文使用了某种字体/字号/行距，请提取出来。
5. 目录、页码、页眉页脚、乱码不要作为标题。
6. 多篇范文中只在某一篇出现的小标题、项目名称、实施地点、金额、时间、单位名称等个性化标题，不要放入 nodes。

范文内容：
${content.slice(0, 22000)}`;

    const directPrompt = `你是”文档模板结构、写作要求、范文和格式规则”识别助手。请从下面的模板文本中同时识别：
1. 标题结构和标题层级。
2. 每个标题下哪些是硬性写作要求、填写说明、内容要求、格式要求。
3. 每个标题下哪些是范文、示例、样例、参考写法。范文只作为写法参考，不可当作硬性要求。
4. 文档不同部分的格式规则，包括一级标题、二级标题、三级标题、四级标题、正文、图题/图例、表题、表头。

请只返回 JSON 对象，不要 Markdown，不要代码块。格式如下：
{
  “nodes”: [
    {
      “title”: “原始章节标题”,
      “level”: 1,
      “requirementText”: “该章节硬性要求/填写说明/内容要求/格式要求；没有则为空字符串”,
      “exampleText”: “该章节范文/示例/样例/参考写法；没有则为空字符串”,
      “isRequired”: true
    }
  ],
  “requirementText”: “模板全局硬性要求、填写说明、格式/内容约束；不要包含范文正文”,
  “exampleText”: “模板全局范文、示例、样例、参考写法；只用于提取写作结构和表达方法”,
  “formatRules”: {
    “heading1”: {“fontFamily”:”字体名”,”fontSize”:14,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “heading2”: {“fontFamily”:”字体名”,”fontSize”:14,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “heading3”: {“fontFamily”:”字体名”,”fontSize”:14,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “heading4”: {“fontFamily”:”字体名”,”fontSize”:12,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”},
    “body”: {“fontFamily”:”字体名”,”fontSize”:12,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”normal”},
    “caption”: {“fontFamily”:”字体名”,”fontSize”:10.5,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”normal”},
    “tableTitle”: {“fontFamily”:”字体名”,”fontSize”:10.5,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”normal”},
    “tableHeader”: {“fontFamily”:”字体名”,”fontSize”:10.5,”lineHeight”:1.5,”letterSpacing”:0,”fontWeight”:”bold”}
  },
  “evidence”: [“格式或分类识别依据，简短说明”]
}

识别规则：
1. level 只允许 1-4。按上下文判断：”一、/第X章”通常为1级，”（一）”通常为2级，”1.”通常为3级，”（1）”通常为4级；如果文档实际层级不同，以上下文为准。
2. requirementText 只放”要求、应当、必须、需、填写、说明、格式、字号、字体、行距、内容包括、提交材料、指标、标准、依据”等约束性内容。
3. exampleText 只放”范文、示例、示范、样例、参考写法、参考内容、例如、如下所示”等样例性内容。
4. 不要把范文中的项目事实、金额、时间、数据、背景当成当前模板要求。
5. 目录、页码、页眉页脚、乱码、孤立正文句子不要作为标题。
6. 如果格式在文本中明确说明，按说明提取；如果没有说明但模板文本明显展示了对应样式，请根据样式样本推断，并在 evidence 中说明。

模板文本：
${content.slice(0, 22000)}`;

    const strictJsonInstruction = `

重要：请严格返回可被 JSON.parse 解析的标准 JSON。必须使用英文半角双引号，不要使用中文弯引号，不要输出 Markdown 代码块。
不要输出思考过程、分析过程、解释性前言或结尾。第一字符必须是 {，最后一个字符必须是 }。
最小格式：
{
  "nodes": [
    {
      "title": "一、章节标题",
      "level": 1,
      "requirementText": "要求或填写说明",
      "exampleText": "范文或参考写法",
      "isRequired": true
    }
  ],
  "requirementText": "全局模板要求",
  "exampleText": "全局范文参考",
  "formatRules": {},
  "evidence": []
}
`;
    const prompt = `${currentType === 'example' ? examplePrompt : directPrompt}${strictJsonInstruction}`;

    const response = await window.electronAPI.callAI(prompt);
    const aiResult = parseAiHeadingResponse(response);
    if (aiResult.nodes.length === 0) {
      console.warn('[Template AI] Empty node result. Raw response preview:', String(response || '').slice(0, 1200));
    }
    return aiResult;
  };

  const applyAiTemplateExtraction = async (result: AiTemplateExtractionResult, successPrefix = 'AI 已识别') => {
    if (result.nodes.length === 0) {
      message.warning('AI 未返回可用章节，请检查 AI 配置或文档内容');
      return false;
    }

    const currentType = form.getFieldValue('templateType') || 'direct';
    const commonResult = currentType === 'example'
      ? buildCommonExampleTemplateNodes(result.nodes, importedFiles)
      : { nodes: result.nodes, evidence: '' };
    if (currentType === 'example' && importedFiles.length > 1 && commonResult.nodes.length === 0) {
      message.warning('多篇范文未识别到共同章节标题，请检查标题命名是否一致，或保留一篇范文后再识别。');
      return false;
    }
    const currentFormatValues = form.getFieldValue('formatRules') || buildDefaultFormatFormValues();
    const mergedFormatValues = mergeFormatFormValues(
      currentFormatValues,
      result.formatValues || formatRulesToPartialFormValues(result.formatRules),
    );
    const evidence = [
      ...(commonResult.evidence ? [commonResult.evidence] : []),
      ...result.evidence,
    ].slice(0, 12);

    // 范文模板：全局字段留空，内容在节点里；直接套用：保留全局字段
    const formValues: any = {
      ...(Object.keys(result.formatValues || {}).length || result.formatRules
        ? { enableFormatRules: true, formatRules: mergedFormatValues }
        : {}),
    };
    if (currentType !== 'example') {
      const fallbackGuidance = collectTemplateGuidance(commonResult.nodes, importedDocumentText);
      formValues.requirementText = result.requirementText || fallbackGuidance.requirementText;
      formValues.exampleText = result.exampleText || fallbackGuidance.exampleText;
    }

    form.setFieldsValue(formValues);
    if (evidence.length > 0) {
      setFormatRuleEvidence(evidence);
    }
    setTemplateNodes(commonResult.nodes);
    message.success(`${successPrefix} ${flattenTemplateNodesForMatch(commonResult.nodes).length} 个章节${evidence.length ? `，并补充 ${evidence.length} 条格式/分类依据` : ''}`);
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
      if (aiResult.nodes.length === 0) {
        const fallbackNodes = extractTemplateNodes(importedDocumentText);
        if (fallbackNodes.length > 0) {
          const guidance = collectTemplateGuidance(fallbackNodes, importedDocumentText);
          await applyAiTemplateExtraction({
            ...aiResult,
            nodes: fallbackNodes,
            requirementText: aiResult.requirementText || guidance.requirementText,
            exampleText: aiResult.exampleText || guidance.exampleText,
            evidence: [...aiResult.evidence, 'AI未返回标准章节数组，已使用本地标题识别结果兜底'].slice(0, 12),
          }, '已使用本地结构兜底识别');
          return;
        }
      }
      await applyAiTemplateExtraction(aiResult);
    } catch (error: any) {
      const fallbackNodes = extractTemplateNodes(importedDocumentText);
      if (fallbackNodes.length > 0) {
        const guidance = collectTemplateGuidance(fallbackNodes, importedDocumentText);
        await applyAiTemplateExtraction({
          nodes: fallbackNodes,
          requirementText: guidance.requirementText,
          exampleText: guidance.exampleText,
          formatRules: undefined,
          evidence: ['AI接口未返回最终文本，已使用本地标题识别结果兜底'].slice(0, 12),
        }, '已使用本地结构兜底识别');
        message.warning(formatTemplateAiError(error), 7);
        return;
      }
      message.error(formatTemplateAiError(error), 7);
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
    if (hasRequestedTemplateRefreshRef.current || templates.length > 0) return;
    hasRequestedTemplateRefreshRef.current = true;
    loadTemplates();
  }, [loadTemplates, templates.length]);

  useEffect(() => {
    if (!isModalOpen || hasRequestedFontsRef.current) return;
    hasRequestedFontsRef.current = true;
    const timer = window.setTimeout(() => {
      window.electronAPI.listSystemFonts?.()
        .then(result => {
          const fonts = result?.fonts?.length ? result.fonts : fallbackFontNames;
          setFontOptions(fonts.map(font => ({ value: font })));
        })
        .catch(() => setFontOptions(fallbackFontNames.map(font => ({ value: font }))));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [isModalOpen]);

  const handleCreate = () => {
    setIsPreparingTemplateEditor(true);
    setEditingTemplate(null);
    setIsModalOpen(true);
    window.requestAnimationFrame(() => {
      setImportedFiles([]);
      setFormatRuleEvidence([]);
      setHeadingLevelFilter([1, 2, 3, 4]);
      setSelectedNodeIds(new Set());
      setSelectedNodeIds(new Set());
      form.resetFields();
      form.setFieldsValue({
        outputFileType: 'docx',
        templateType: 'direct',
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
      setImportedFiles([]);
      setFormatRuleEvidence([]);
      setHeadingLevelFilter([1, 2, 3, 4]);
      setSelectedNodeIds(new Set());
      form.setFieldsValue({
        name: template.name,
        description: template.description,
        requirementText: template.requirementText || collectTemplateGuidance(template.nodes || []).requirementText,
        exampleText: template.exampleText || collectTemplateGuidance(template.nodes || []).exampleText,
        category: template.category,
        outputFileType: template.outputFileType || inferOutputFileType(template.filePath || ''),
        templateType: template.templateType || 'direct',
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
        templateType: values.templateType || 'direct',
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

      // 检查是否已导入过该文件
      if (importedFiles.some(f => f.filePath === filePath)) {
        message.warning('该文件已导入');
        return;
      }

      setIsExtracting(true);

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

      const newFile = { filePath, text: result.content, fileName: result.fileName };

      // 范文模板追加文件，直接套用替换文件
      const currentType = form.getFieldValue('templateType') || 'direct';
      const newFiles = currentType === 'example'
        ? [...importedFiles, newFile]
        : [newFile];
      setImportedFiles(newFiles);

      // 第一个文件设置模板名称和类型
      if (newFiles.length === 1) {
        const fileBaseName = getImportedBaseName(filePath);
        const currentName = form.getFieldValue('name');
        if (!currentName) {
          form.setFieldsValue({ name: fileBaseName });
        }
        form.setFieldsValue({ outputFileType: inferOutputFileType(filePath) });

        // 推断分类
        const importedName = getImportedBaseName(filePath, result.fileName);
        const currentCategory = form.getFieldValue('category');
        if (!currentCategory) {
          for (const stage of allStages) {
            if (stage.keywords.some(kw => importedName.includes(kw))) {
              form.setFieldsValue({ category: stage.name });
              break;
            }
          }
        }
      }

      // 提取格式规则（从第一个docx文件）
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
      // 从最新文件提取章节结构
      const extractedNodes = extractTemplateNodes(result.content);
      const commonImportResult = currentType === 'example'
        ? buildCommonExampleTemplateNodes(extractedNodes, newFiles)
        : { nodes: extractedNodes, evidence: '' };
      const nodes = commonImportResult.nodes;
      const evidence = [
        ...(commonImportResult.evidence ? [commonImportResult.evidence] : []),
        ...actualEvidence,
        ...textualFormat.evidence,
      ].slice(0, 12);
      if (evidence.length > 0) {
        form.setFieldsValue({ enableFormatRules: true, formatRules: mergedFormatValues });
        setFormatRuleEvidence(evidence);
      }

      if (nodes.length === 0) {
        message.warning(currentType === 'example' && newFiles.length > 1
          ? '已导入范文，但多篇范文未识别到共同章节标题。请检查标题名称是否一致，或点击“AI识别结构/分析范文”重试。'
          : '文件已关联，但未检测到章节标题。可以点击”AI识别结构”重试，或确认文档使用了一、二、三 / 第X章 / 1. 2. 3. 等编号格式。');
      } else {
        if (currentType !== 'example') {
          const guidance = collectTemplateGuidance(nodes, result.content);
          form.setFieldsValue({ requirementText: guidance.requirementText, exampleText: guidance.exampleText });
        }
        setTemplateNodes(nodes);
      }

      const fileCount = newFiles.length;
      message.success(`已导入 ${result.fileName || '文档'}${fileCount > 1 ? `（共 ${fileCount} 个文件）` : ''}${nodes.length > 0 ? `，提取 ${nodes.length} 个章节` : ''}${evidence.length ? `，识别 ${evidence.length} 条格式依据` : ''}`);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && <Button type="text" icon={<LeftOutlined />} onClick={onBack} />}
          <div>
            <Title level={4} style={{ margin: 0 }}>模板管理</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>维护写作模板结构，可从 Word、PPT、Excel、PDF、文本等文档中提取章节</Text>
          </div>
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
          pagination={templateCardItems.length > 12 ? { pageSize: 12, size: 'small', showSizeChanger: false, hideOnSinglePage: true } : false}
          dataSource={templateCardItems}
          renderItem={({ template, nodeCount }) => (
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
                      <Tag color={template.templateType === 'example' ? 'green' : 'default'} style={{ marginBottom: 8 }}>
                        {template.templateType === 'example' ? '范文模板' : '直接套用'}
                      </Tag>
                      <br />
                      <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>{template.description}</Paragraph>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {template.outputFileType?.toUpperCase() || 'DOCX'} · 包含 {nodeCount} 个章节{template.filePath ? ' · 已保存源文件' : ''}
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
                  name="templateType"
                  label="模板类型"
                  extra="直接套用模板：要求文字作为硬性检查标准；范文模板：作为格式和风格参考，字数为建议值"
                >
                  <Select
                    options={[
                      { value: 'direct', label: '直接套用模板' },
                      { value: 'example', label: '范文模板' },
                    ]}
                  />
                </Form.Item>

                <Form.Item
                  name="description"
                  label="模板说明"
                >
                  <TextArea rows={2} placeholder="简要说明模板用途、适用范围或填写要求" />
                </Form.Item>

                <Form.Item
                  name="requirementText"
                  label="模板要求/填写说明"
                  style={{ display: templateType === 'example' ? 'none' : undefined }}
                >
                  <TextArea rows={3} placeholder="导入后自动识别硬性要求、内容要求、格式要求；可人工修正" />
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
                    {templateType === 'example'
                      ? '支持导入多个范文文件；多篇范文会只保留共同标题，差异化小标题用于分析写作特征。'
                      : '支持 .doc/.docx/.ppt/.pptx/.xls/.xlsx/.pdf/.txt/.md/.rtf，自动识别章节标题并保留源文件用于后续创建文件。'}
                  </Text>
                  {importedFiles.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {importedFiles.map((f, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <Text type="secondary" ellipsis style={{ flex: 1 }}>
                            {idx + 1}. {f.fileName || f.filePath.split(/[/\\]/).pop()}
                          </Text>
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => {
                              const newFiles = importedFiles.filter((_, i) => i !== idx);
                              setImportedFiles(newFiles);
                              if (templateType === 'example') {
                                if (newFiles.length === 0) {
                                  setTemplateNodes([]);
                                } else {
                                  const baseNodes = extractTemplateNodes(newFiles[0].text);
                                  const commonResult = buildCommonExampleTemplateNodes(baseNodes, newFiles);
                                  setTemplateNodes(commonResult.nodes);
                                  if (commonResult.evidence) {
                                    setFormatRuleEvidence(prev => [commonResult.evidence, ...prev].slice(0, 12));
                                  }
                                }
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Space wrap>
                  <Button
                    icon={<ImportOutlined />}
                    loading={isExtracting}
                    onClick={handleImportFromDoc}
                  >
                    {templateType === 'example' && importedFiles.length > 0 ? '继续添加文件' : '选择文件'}
                  </Button>
                  <Button
                    disabled={importedFiles.length === 0}
                    loading={isAiExtracting}
                    onClick={handleAiExtract}
                  >
                    {templateType === 'example' ? 'AI识别结构/分析范文' : 'AI识别结构/要求/格式'}
                  </Button>
                </Space>
              </div>

          {/* 模板结构编辑器 */}
          <div className="template-node-editor" style={{ marginBottom: 16 }}>
            <div className="template-node-toolbar">
              <div className="template-node-toolbar-title">
                <div className="template-node-bulk-select">
                  <input
                    type="checkbox"
                    className="template-node-selectbox"
                    checked={allFilteredSelected}
                    ref={el => { if (el) el.indeterminate = someFilteredSelected; }}
                    disabled={filteredNodeIds.length === 0}
                    onChange={toggleSelectFilteredNodes}
                  />
                </div>
                <div>
                  <Text strong>模板章节结构</Text>
                  <div className="template-node-toolbar-meta">
                    <span>共 {nodeTotal} 个章节</span>
                    <span>{requiredTotal} 个必需项</span>
                    <span>当前筛选 {filteredNodeIds.length} 项</span>
                    {selectedFilteredCount > 0 && <Tag color="blue">已选 {selectedFilteredCount} 项</Tag>}
                    {selectedCascadeCount > selectedFilteredCount && <Tag color="orange">含子章节共 {selectedCascadeCount} 项</Tag>}
                  </div>
                </div>
              </div>
              <Space wrap size={8}>
                {availableLevels.length > 0 && (
                  <Select
                    mode="multiple"
                    size="small"
                    className="template-node-filter-select"
                    placeholder="筛选标题级别"
                    value={activeHeadingLevelFilter}
                    onChange={handleHeadingLevelFilterChange}
                    maxTagCount={2}
                    options={availableLevels.map(l => ({ value: l, label: `${['一','二','三','四'][l - 1] || l}级标题` }))}
                  />
                )}
                <Button
                  size="small"
                  disabled={filteredNodeIds.length === 0}
                  onClick={toggleSelectFilteredNodes}
                >
                  {allFilteredSelected ? '取消全选' : '全选筛选结果'}
                </Button>
                {selectedFilteredCount > 0 && (
                  <Popconfirm
                    title={`确定删除当前选中的 ${selectedFilteredCount} 个筛选结果？`}
                    description={selectedCascadeCount > selectedFilteredCount ? `其中包含父章节，删除后会连同子章节共删除 ${selectedCascadeCount} 个章节。` : '删除后会重新计算模板结构。'}
                    onConfirm={deleteSelectedTemplateNodes}
                  >
                    <Button size="small" danger>
                      删除选中 ({selectedFilteredCount})
                    </Button>
                  </Popconfirm>
                )}
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
              {editorNodeRows}
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
                {templateNodes.length > 0 ? previewNodeRows : (
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
        <div className="template-section-header" style={{ marginBottom: isStageSectionExpanded ? 16 : 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>项目阶段管理</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              阶段会参与文件识别、进度计算、统计卡片、甘特图和项目表；列表已按需展开，避免进入模板页时卡顿。
            </Text>
          </div>
          <Space>
            <Button onClick={() => setIsStageSectionExpanded(prev => !prev)}>
              {isStageSectionExpanded ? '收起阶段' : `展开阶段（${allStages.length}）`}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateStage}>
              新增阶段
            </Button>
          </Space>
        </div>

        {isStageSectionExpanded && (
          <>
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
          </>
        )}
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

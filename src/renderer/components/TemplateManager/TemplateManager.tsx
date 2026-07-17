import React, { useDeferredValue, useEffect, useRef, useState, useMemo } from 'react';
import { Form, Typography, message } from 'antd';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';
import { AIConfig, WritingTemplate, TemplateNode, StageConfig, TemplateOutputFileType, TemplateFormatRules } from '../../../shared/types';
import { getAllStages, getGlobalStageProgress } from '../../utils/timelineStages';
import { requireIpcObject } from '../../utils/ipcResult';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import {
  mapTemplateNodes,
  removeTemplateNodeById,
  canMoveTemplateNode,
  moveTemplateNodeById,
  collectTemplateNodeMoveAvailability,
  flattenTemplateNodeRows,
  flattenVisibleTemplateNodeRows,
  findTemplateNodeAncestorIds,
  collectTemplateNodeIdsByLevel,
  collectCollapsibleTemplateNodeIds,
  countSelectedTemplateNodesWithChildren,
  removeTemplateNodesByIds,
  rebuildTemplateTree,
  findEmptyNodeTitle,
} from './templateNodeUtils';
import { TemplateCatalog, TemplateDeleteModal } from './TemplateCatalog';
import { ProjectStageModal, ProjectStageSection } from './ProjectStageManager';
import { TemplateBasicInfoSection, TemplateEditorModal } from './TemplateEditorBasics';
import { TemplateFormatRulesSection } from './TemplateFormatRulesSection';
import { formatRuleRows, TemplateFormatRuleKey } from './templateFormatRuleConfig';
import { ImportedTemplateFile, TemplateImportPanel } from './TemplateImportPanel';
import { TemplateStructurePreview, TemplateStructureToolbar } from './TemplateStructurePanels';
import { TemplateEditorNodeRows, TemplatePreviewNodeRows } from './TemplateNodeRows';
import {
  HeadingMatch,
  buildTemplateNodeTree,
  getExplicitTopLevelOrder,
  inferHeadingLevel,
  isLikelyBodyEnumerationTitle,
  isLikelyGarbledText,
  isLikelyMeasurementOrTableValue,
  isLikelyNumericDataText,
  matchHeadingLine,
  normalizeImportedText,
  normalizeTopLevelOutlineOrder,
  stripRtfText,
  stripTemplateHeadingPrefix,
} from './templateDocumentParser';

const { Text } = Typography;

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

const fallbackFontNames = ['宋体', '黑体', '微软雅黑', '仿宋', '楷体', '等线', 'Arial', 'Calibri', 'Times New Roman'];
const supportedTemplateFileTypes = templateFileTypeOptions.map(option => option.value);

const getImportedBaseName = (filePath: string, fileName?: string) =>
  (fileName || filePath.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '');

const inferOutputFileType = (filePath: string): TemplateOutputFileType => {
  const rawExt = filePath.split('.').pop()?.toLowerCase();
  if (rawExt === 'ppt') return 'pptx';
  if (rawExt === 'xls') return 'xlsx';
  const ext = rawExt as TemplateOutputFileType | undefined;
  return ext && supportedTemplateFileTypes.includes(ext) ? ext : 'docx';
};

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
      if (node.requirementText) requirementLines.push(node.requirementText);
      if (node.description && node.description !== node.requirementText) requirementLines.push(node.description);
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


function cleanAiTemplateNodeTitle(value: string): string {
  const lines = String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const firstLine = lines.find(line => matchHeadingLine(line)) || lines[0] || '';
  let title = firstLine.replace(/\s+/g, ' ').trim();
  if (title.length > 80) {
    title = title
      .split(/[。；;]|(?<=.{36})[，,]/)[0]
      .trim();
  }
  return title
    .replace(/[：:；;，,。.\s]+$/, '')
    .slice(0, 80)
    .trim();
}

function cleanAiTemplateNodes(nodes: TemplateNode[]): TemplateNode[] {
  return nodes
    .map(node => {
      const children = node.children?.length ? cleanAiTemplateNodes(node.children) : undefined;
      return {
        ...node,
        title: cleanAiTemplateNodeTitle(node.title),
        children: children?.length ? children : undefined,
      };
    })
    .filter(node => Boolean(node.title) && !isLikelyNumericDataText(node.title) && !isLikelyBodyEnumerationTitle(node.title));
}
function nodesFromHeadingItems(items: AiTemplateHeadingItem[]): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  items
    .map(item => ({ ...item, title: cleanAiTemplateNodeTitle(item.title) }))
    .filter(item => item.title && !isLikelyGarbledText(item.title) && !isLikelyNumericDataText(item.title) && !isLikelyBodyEnumerationTitle(item.title))
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
        title: item.title,
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
  return dedupeTemplateNodesByExactTitle(nodes);
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
      title: cleanAiTemplateNodeTitle(title),
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



// 从文档内容提取章节结构为 TemplateNode[]（保留各章节内容）
function extractTemplateNodes(content: string): TemplateNode[] {
  const lines = content.split('\n');

  // 第一步：识别标题行及其位置。PDF 常把“6.5”和标题正文拆成两行，需要在明确章节上下文中安全合并。
  const headingPositions: { lineIndex: number; contentStartLineIndex: number; title: string; level: number; match: HeadingMatch }[] = [];
  const previousHeadings: HeadingMatch[] = [];
  let currentExplicitTopLevelOrder: number | undefined;
  const isSafeSplitHeadingText = (value: string) => value.length >= 2
    && value.length <= 50
    && !/[。；;！？!?]$/.test(value)
    && !/^(?:第[一二三四五六七八九十百千万\d]+[章节部篇]|[一二三四五六七八九十百千万]+[、.．）)]|\d+(?:[.．]\d+)*)/.test(value)
    && !isLikelyMeasurementOrTableValue(value)
    && !isLikelyNumericDataText(value);
  const hasDirectNumberedDescendant = (token: string, startIndex: number) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const descendantPattern = new RegExp(`^${escaped}[.．]\\d+[、.．）)]?(?:\\s|\\S)`);
    return lines
      .slice(startIndex + 1, Math.min(lines.length, startIndex + 700))
      .some(line => descendantPattern.test(line.trim()));
  };
  const recoverDecimalHeading = (token: string, titleText: string): HeadingMatch => ({
    title: `${token} ${titleText}`.trim(),
    level: Math.min(token.split(/[.．]/).length, 4),
    token,
    kind: 'decimal',
    numericDepth: token.split(/[.．]/).length,
    recoveredFromStructure: true,
  });

  for (let i = 0; i < lines.length; i++) {
    let heading = matchHeadingLine(lines[i]);
    const headingLineIndex = i;
    let contentStartLineIndex = i;

    if (!heading) {
      const sameLineCandidate = lines[i].trim().match(/^(\d+(?:[.．]\d+){1,3})[、.．）)]?[\s　]*(\S.*)$/);
      const sameLineToken = sameLineCandidate?.[1];
      const sameLineTitle = sameLineCandidate?.[2]?.trim() || '';
      const sameLineParts = sameLineToken?.split(/[.．]/).map(Number) || [];
      if (sameLineToken
        && sameLineParts.length >= 2
        && sameLineParts[0] === currentExplicitTopLevelOrder
        && isSafeSplitHeadingText(sameLineTitle)
        && hasDirectNumberedDescendant(sameLineToken, i)) {
        heading = recoverDecimalHeading(sameLineToken, sameLineTitle);
      }
    }

    if (!heading) {
      const isolatedToken = lines[i].trim().match(/^(\d+(?:[.．]\d+){1,3})[、.．）)]?$/)?.[1];
      const tokenParts = isolatedToken?.split(/[.．]/).map(Number) || [];
      if (isolatedToken && tokenParts.length >= 2 && tokenParts[0] === currentExplicitTopLevelOrder) {
        let nextIndex = i + 1;
        while (nextIndex < lines.length && !lines[nextIndex].trim() && nextIndex <= i + 2) nextIndex += 1;
        const nextText = lines[nextIndex]?.trim() || '';
        if (isSafeSplitHeadingText(nextText)) {
          const combined = matchHeadingLine(`${isolatedToken} ${nextText}`);
          if (combined?.kind === 'decimal' || hasDirectNumberedDescendant(isolatedToken, nextIndex)) {
            heading = combined?.kind === 'decimal' ? combined : recoverDecimalHeading(isolatedToken, nextText);
            contentStartLineIndex = nextIndex;
            i = nextIndex;
          }
        }
      }
    }

    if (heading) {
      const level = inferHeadingLevel(heading, previousHeadings);
      headingPositions.push({ lineIndex: headingLineIndex, contentStartLineIndex, title: heading.title, level, match: heading });
      previousHeadings.push({ ...heading, level });
      const isExplicitChapterContext = heading.kind === 'chapter'
        || (heading.kind === 'chinese' && /[、.．）)]$/.test(heading.token));
      if (level === 1 && isExplicitChapterContext) {
        currentExplicitTopLevelOrder = getExplicitTopLevelOrder(heading.title);
      }
    }
  }

  // 第二步：提取每个标题下方的内容
  const headingContents: { title: string; level: number; description: string; match: HeadingMatch }[] = [];
  for (let i = 0; i < headingPositions.length; i++) {
    const start = headingPositions[i].contentStartLineIndex + 1;
    const end = i + 1 < headingPositions.length ? headingPositions[i + 1].lineIndex : lines.length;
    const contentLines = lines.slice(start, end).filter(l => l.trim().length > 0);
    headingContents.push({
      title: headingPositions[i].title,
      level: headingPositions[i].level,
      description: normalizeHeadingDescription(contentLines.join('\n')) || '',
      match: headingPositions[i].match,
    });
  }

  return buildTemplateNodeTree(headingContents, {
    splitGuidance: splitTemplateGuidanceText,
    isExampleHeading: isExampleHeadingText,
    isInvalidHeading: isInvalidTemplateHeadingTitle,
    dedupeNodes: dedupeTemplateNodesByExactTitle,
  });
}

function isInvalidTemplateHeadingTitle(title: string, detectedHeading?: HeadingMatch): boolean {
  // matchHeadingLine already validates readability, measurements and body enumerations.
  // A parent recovered from numbered descendants has stronger structural evidence than body-text heuristics.
  if (detectedHeading?.recoveredFromStructure || matchHeadingLine(title)) return false;
  return isLikelyGarbledText(title)
    || isLikelyNumericDataText(title)
    || isLikelyMeasurementOrTableValue(title)
    || isLikelyBodyEnumerationTitle(title);
}
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

function normalizeExactTemplateHeadingIdentity(value: string): string {
  return cleanAiTemplateNodeTitle(value)
    .replace(/\s+/g, '')
    .replace(/[，,]/g, '，')
    .replace(/[：:]/g, '：')
    .replace(/[；;]/g, '；')
    .replace(/[．。]/g, '.')
    .replace(/[）)]/g, ')')
    .replace(/[（(]/g, '(')
    .toLowerCase();
}

function dedupeTemplateNodesByExactTitle(nodes: TemplateNode[]): TemplateNode[] {
  const seen = new Map<string, TemplateNode>();
  const mergeText = (first?: string, second?: string) => {
    const merged = uniqueTextLines([first || '', second || '']).join('\n');
    return merged || undefined;
  };

  const visit = (items: TemplateNode[]): TemplateNode[] => {
    const output: TemplateNode[] = [];
    items.forEach(source => {
      const key = normalizeExactTemplateHeadingIdentity(source.title);
      if (!key) return;
      const existing = seen.get(key);
      if (existing) {
        existing.description = mergeText(existing.description, source.description);
        existing.requirementText = mergeText(existing.requirementText, source.requirementText);
        existing.exampleText = mergeText(existing.exampleText, source.exampleText);
        existing.isRequired = existing.isRequired !== false || source.isRequired !== false;
        const extraChildren = source.children?.length ? visit(source.children) : [];
        if (extraChildren.length) existing.children = [...(existing.children || []), ...extraChildren];
        return;
      }

      const node: TemplateNode = { ...source, children: undefined };
      seen.set(key, node);
      const children = source.children?.length ? visit(source.children) : [];
      if (children.length) node.children = children;
      output.push(node);
    });
    return output;
  };

  return visit(nodes);
}

function attachGlobalGuidanceToTopLevel(
  nodes: TemplateNode[],
  requirementText = '',
  exampleText = '',
): TemplateNode[] {
  if (!nodes.length || (!requirementText.trim() && !exampleText.trim())) return nodes;
  const output = nodes.map(node => ({ ...node }));
  const targetIndex = output.findIndex(node => (node.level || 1) === 1);
  const index = targetIndex >= 0 ? targetIndex : 0;
  const target = output[index];
  const mergedRule = uniqueTextLines([
    target.description || '',
    target.requirementText || '',
    requirementText,
  ]).join('\n');
  const mergedExample = uniqueTextLines([target.exampleText || '', exampleText]).join('\n');
  output[index] = {
    ...target,
    description: mergedRule || undefined,
    requirementText: mergedRule || undefined,
    exampleText: mergedExample || undefined,
  };
  return output;
}

function getTemplateNodeRuleText(node: TemplateNode): string {
  return uniqueTextLines([node.description || '', node.requirementText || '']).join('\n');
}

function reconcileAiGuidanceWithSourceOutline(sourceNodes: TemplateNode[], aiNodes: TemplateNode[]): TemplateNode[] {
  const aiByIdentity = new Map<string, TemplateNode>();
  flattenTemplateNodesForMatch(aiNodes).forEach(node => {
    const key = normalizeExactTemplateHeadingIdentity(node.title);
    if (key && !aiByIdentity.has(key)) aiByIdentity.set(key, node);
  });

  const mergeText = (first?: string, second?: string) => {
    const merged = uniqueTextLines([first || '', second || '']).join('\n');
    return merged || undefined;
  };
  const enrich = (nodes: TemplateNode[]): TemplateNode[] => nodes.map(source => {
    const aiNode = aiByIdentity.get(normalizeExactTemplateHeadingIdentity(source.title));
    const children = source.children?.length ? enrich(source.children) : undefined;
    return {
      ...source,
      description: mergeText(source.description, aiNode?.description),
      requirementText: mergeText(source.requirementText, aiNode?.requirementText),
      exampleText: mergeText(source.exampleText, aiNode?.exampleText),
      isRequired: source.isRequired === false ? false : aiNode?.isRequired !== false,
      children: children?.length ? children : undefined,
    };
  });

  return dedupeTemplateNodesByExactTitle(enrich(sourceNodes));
}

function hasReliableExplicitSourceOutline(nodes: TemplateNode[]): boolean {
  const orders = new Set<number>();
  nodes.forEach(node => {
    if ((node.level || 1) !== 1) return;
    const order = getExplicitTopLevelOrder(node.title);
    if (order !== undefined) orders.add(order);
  });
  if (orders.size < 2) return false;
  const sorted = [...orders].sort((a, b) => a - b);
  // A source outline may intentionally skip a number, but a multi-chapter numbered sequence is still more reliable than generative output.
  return sorted[0] === 1 || sorted.length >= 3;
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

function classifyExampleWritingDirection(title: string): string {
  const key = normalizeTemplateHeadingTitle(title);
  if (!key) return '';
  if (/项目|概述|概况|背景|总体|简介|建设内容/.test(key)) return 'overview';
  if (/总结|展望|结论|成效|启示/.test(key)) return 'summary';
  if (/应用|试点|试验|测试|验证|运行|使用情况|示范/.test(key)) return 'application';
  if (/系统|技术|方案|路线|架构|平台|算法|模型|识别|检测|监测|机器人|功能|模块|装置/.test(key)) {
    return `technical:${key}`;
  }
  return `section:${key}`;
}

function cloneTemplateNodeWithFreshIds(node: TemplateNode, idPrefix: string, counter: { value: number }): TemplateNode {
  counter.value += 1;
  const clonedChildren = node.children?.map(child => cloneTemplateNodeWithFreshIds(child, idPrefix, counter));
  return {
    ...node,
    id: `${idPrefix}-${counter.value}`,
    children: clonedChildren?.length ? clonedChildren : undefined,
  };
}

function mergeExampleDirectionGuidance(node: TemplateNode, extracted: TemplateNode[][]): TemplateNode {
  const direction = classifyExampleWritingDirection(node.title);
  const exactKey = normalizeTemplateHeadingTitle(node.title);
  const candidates = extracted
    .flatMap(nodes => nodes)
    .filter(item => {
      const itemKey = normalizeTemplateHeadingTitle(item.title);
      if (itemKey && itemKey === exactKey) return true;
      const itemDirection = classifyExampleWritingDirection(item.title);
      return direction && itemDirection === direction && ['overview', 'summary', 'application'].includes(direction);
    });
  const descriptions = uniqueTextLines([
    node.description || '',
    ...candidates.map(item => item.description || ''),
  ]).join('\n\n');
  const requirementText = uniqueTextLines([
    node.requirementText || '',
    ...candidates.map(item => item.requirementText || ''),
  ]).join('\n\n');
  const exampleText = uniqueTextLines([
    node.exampleText || '',
    ...candidates.map(item => item.exampleText || ''),
  ]).join('\n\n');
  return {
    ...node,
    description: descriptions || node.description,
    requirementText: requirementText || node.requirementText,
    exampleText: exampleText || node.exampleText,
  };
}


const genericExampleOutlineNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function formatGenericExampleOutlineTitle(index: number, title = ''): string {
  const prefix = `${genericExampleOutlineNumbers[index] || String(index + 1)}、`;
  const cleanTitle = stripTemplateHeadingPrefix(title).replace(/^[、.．\s]+/, '').trim();
  return `${prefix}${cleanTitle}`.trim();
}

function getGenericExampleDirectionTitle(title: string, index: number): string {
  const direction = classifyExampleWritingDirection(title);
  if (direction === 'overview') return '项目整体概述';
  if (direction === 'summary') return '总结与展望';
  if (direction === 'application') return '试验验证与应用情况';
  if (direction.startsWith('technical:')) {
    return index <= 1 ? '总体技术方案' : '关键技术与系统实现';
  }
  return `写作方向${index + 1}`;
}

function getExampleDirectionNamingGuide(title: string, index: number): string {
  const direction = classifyExampleWritingDirection(title);
  const cleanTitle = cleanAiTemplateNodeTitle(title).replace(/^[一二三四五六七八九十百千万\d]+[、.．）\)]\s*/, '');
  if (direction === 'overview') {
    return '标题命名方向：项目整体概述、背景、建设内容或总体情况。';
  }
  if (direction === 'summary') {
    return '标题命名方向：总结、成效、结论或后续展望。';
  }
  if (direction === 'application') {
    return '标题命名方向：试验验证、应用情况、运行效果或示范推广。';
  }
  if (direction.startsWith('technical:')) {
    return `标题命名方向：围绕当前项目的核心技术、系统组成、关键功能或技术路线命名；参考方向为“${cleanTitle || `技术章节${index + 1}`}”。`;
  }
  return `标题命名方向：结合当前项目内容自拟一级标题；参考方向为“${cleanTitle || `章节${index + 1}`}”。`;
}

function buildDefaultExampleWritingDirectionNodes(): TemplateNode[] {
  const guides = [
    '标题命名方向：项目整体概述、背景、建设内容或总体情况。写作功能：先交代项目是什么、为什么做、整体目标和技术报告范围。',
    '标题命名方向：围绕当前项目的总体技术方案、系统架构、技术路线或核心系统组成命名。写作功能：从整体到局部说明技术实现框架。',
    '标题命名方向：围绕关键技术、关键功能、算法模型、设备模块或创新点命名。写作功能：展开项目最核心的技术细节和能力特点。',
    '标题命名方向：试验验证、应用情况、运行效果、测试结果或示范推广。写作功能：说明技术如何落地、验证效果和应用价值。',
    '标题命名方向：总结、成效、结论或后续展望。写作功能：概括成果、经验、不足和下一步方向。',
  ];
  const titles = ['项目整体概述', '总体技术方案', '关键技术与实现', '试验验证与应用情况', '总结与展望'];
  return guides.map((guide, index) => ({
    id: `example-default-${index + 1}`,
    title: formatGenericExampleOutlineTitle(index, titles[index]),
    level: 1,
    isRequired: false,
    description: guide,
    requirementText: guide,
  }));
}

function dedupeExampleNodesByTitle(nodes: TemplateNode[]): TemplateNode[] {
  const seen = new Set<string>();
  return nodes.flatMap(node => {
    const key = `${node.level || 1}:${normalizeTemplateHeadingTitle(node.title)}`;
    if (!key || seen.has(key)) return [];
    seen.add(key);
    const children = node.children?.length ? dedupeExampleNodesByTitle(node.children) : undefined;
    return [{
      ...node,
      children: children?.length ? children : undefined,
    }];
  });
}

function countUniqueExampleTitles(nodes: TemplateNode[]): number {
  const keys = new Set<string>();
  flattenTemplateNodesForMatch(nodes).forEach(node => {
    const key = normalizeTemplateHeadingTitle(node.title);
    if (key) keys.add(key);
  });
  return keys.size;
}
function normalizeExampleAiOutlineNodes(nodes: TemplateNode[]): TemplateNode[] {
  const cleanNodes = cleanAiTemplateNodes(nodes);
  const topLevelNodes = cleanNodes.filter(node => (node.level || 1) <= 1);
  const sourceNodes = (topLevelNodes.length ? topLevelNodes : cleanNodes).slice(0, 8);
  const normalized = sourceNodes.flatMap((node, index) => {
    const coreTitle = stripTemplateHeadingPrefix(cleanAiTemplateNodeTitle(node.title || '')).trim()
      || getGenericExampleDirectionTitle(node.title || '', index);
    if (!coreTitle || isInvalidTemplateHeadingTitle(coreTitle)) return [];
    const guidance = uniqueTextLines([
      node.description || '',
      node.requirementText || '',
      '范文模板仅作为写作方向参考；后续 AI 报告和审查应按该方向给建议，不把标题作为硬性缺失项。',
    ]).join('\n\n');
    return [{
      ...node,
      id: `example-ai-outline-${index + 1}`,
      title: formatGenericExampleOutlineTitle(index, coreTitle),
      level: 1,
      isRequired: false,
      description: guidance || undefined,
      requirementText: guidance || undefined,
      children: undefined,
    }];
  });
  return normalized.length > 0 ? normalized : buildDefaultExampleWritingDirectionNodes();
}
function buildExampleWritingDirectionNodes(sourceNodes: TemplateNode[], extracted: TemplateNode[][]): TemplateNode[] {
  const baseNodes = sourceNodes.length ? sourceNodes : (extracted[0] || []);
  const topLevelNodes = baseNodes.filter(node => (node.level || 1) <= 1);
  const representativeNodes = topLevelNodes.length ? topLevelNodes : baseNodes;
  const seenDirections = new Set<string>();
  const counter = { value: 0 };
  const nodes = representativeNodes.flatMap(node => {
    const direction = classifyExampleWritingDirection(node.title) || normalizeTemplateHeadingTitle(node.title);
    if (!direction || seenDirections.has(direction)) return [];
    seenDirections.add(direction);
    const merged = mergeExampleDirectionGuidance(node, extracted);
    const namingGuide = getExampleDirectionNamingGuide(node.title, counter.value);
    const writingGuide = uniqueTextLines([
      namingGuide,
      merged.description || '',
      merged.requirementText || '',
    ]).join('\n\n');
    counter.value += 1;
    return [{
      ...merged,
      id: `example-direction-${counter.value}`,
      title: formatGenericExampleOutlineTitle(counter.value - 1, getGenericExampleDirectionTitle(node.title, counter.value - 1)),
      level: 1,
      isRequired: false,
      description: writingGuide || namingGuide,
      requirementText: writingGuide || namingGuide,
      children: undefined,
    }];
  });
  return nodes.length > 1 ? nodes : buildDefaultExampleWritingDirectionNodes();
}

function getExampleTitleChars(title: string): Set<string> {
  const key = normalizeTemplateHeadingTitle(title)
    .replace(/[的和及与在中为之其该本各类一种以及通过基于关于]/g, '');
  return new Set(Array.from(key));
}

function getBroadExampleDirection(title: string): string {
  const direction = classifyExampleWritingDirection(title);
  if (['overview', 'summary', 'application'].includes(direction)) return direction;
  if (direction.startsWith('technical:')) return 'technical';
  return 'section';
}

function calculateExampleTitleSimilarity(a: string, b: string): number {
  const aKey = normalizeTemplateHeadingTitle(a);
  const bKey = normalizeTemplateHeadingTitle(b);
  if (!aKey || !bKey) return 0;
  if (aKey === bKey) return 1;
  const aChars = getExampleTitleChars(a);
  const bChars = getExampleTitleChars(b);
  if (aChars.size === 0 || bChars.size === 0) return 0;
  const intersection = [...aChars].filter(ch => bChars.has(ch)).length;
  const union = new Set([...aChars, ...bChars]).size;
  return union > 0 ? intersection / union : 0;
}

function isMergeableExampleNode(node: TemplateNode): boolean {
  const title = cleanAiTemplateNodeTitle(node.title || '');
  const key = normalizeTemplateHeadingTitle(title);
  if (!key) return false;
  if (isInvalidTemplateHeadingTitle(title)) return false;
  if ((node.level || 1) >= 3 && key.length < 3) return false;
  return true;
}

function getExampleMergeSimilarityThreshold(level: number): number {
  if (level <= 1) return 0.12;
  if (level === 2) return 0.18;
  return 0.32;
}
function areExampleHeadingNodesSimilar(a: TemplateNode, b: TemplateNode): boolean {
  const level = Math.max(a.level || 1, b.level || 1);
  if ((a.level || 1) !== (b.level || 1)) return false;
  if (!isMergeableExampleNode(a) || !isMergeableExampleNode(b)) return false;

  const similarity = calculateExampleTitleSimilarity(a.title, b.title);
  const threshold = getExampleMergeSimilarityThreshold(level);
  if (similarity >= threshold) return true;

  const aDirection = getBroadExampleDirection(a.title);
  const bDirection = getBroadExampleDirection(b.title);
  if (level <= 2 && aDirection !== 'section' && aDirection === bDirection && similarity >= Math.max(0.08, threshold - 0.08)) return true;

  const aKey = normalizeTemplateHeadingTitle(a.title);
  const bKey = normalizeTemplateHeadingTitle(b.title);
  const minContainsLength = level >= 3 ? 6 : 4;
  return Boolean(
    (aKey.length >= minContainsLength && bKey.includes(aKey)) ||
    (bKey.length >= minContainsLength && aKey.includes(bKey))
  );
}

function getExampleHeadingMatchScore(a: TemplateNode, b: TemplateNode): number {
  const similarity = calculateExampleTitleSimilarity(a.title, b.title);
  const aDirection = getBroadExampleDirection(a.title);
  const bDirection = getBroadExampleDirection(b.title);
  const directionBonus = aDirection !== 'section' && aDirection === bDirection ? 0.12 : 0;
  const containsBonus = normalizeTemplateHeadingTitle(a.title).includes(normalizeTemplateHeadingTitle(b.title)) ||
    normalizeTemplateHeadingTitle(b.title).includes(normalizeTemplateHeadingTitle(a.title)) ? 0.08 : 0;
  return similarity + directionBonus + containsBonus;
}

function findBestSimilarExampleNode(base: TemplateNode, candidates: TemplateNode[], usedIds: Set<string>): TemplateNode | undefined {
  let bestNode: TemplateNode | undefined;
  let bestScore = -1;
  candidates.forEach(candidate => {
    if (usedIds.has(candidate.id)) return;
    if (!areExampleHeadingNodesSimilar(base, candidate)) return;
    const score = getExampleHeadingMatchScore(base, candidate);
    if (score > bestScore) {
      bestNode = candidate;
      bestScore = score;
    }
  });
  return bestNode;
}

function mergeSimilarExampleNodeCluster(nodes: TemplateNode[], id: string): TemplateNode {
  const base = nodes[0];
  const titles = uniqueTextLines(nodes.map(node => cleanAiTemplateNodeTitle(node.title)));
  const namingGuide = titles.length > 1
    ? `相似范文标题：${titles.join(' / ')}`
    : '';
  const descriptions = uniqueTextLines([
    namingGuide,
    ...nodes.map(node => node.description || ''),
    ...nodes.map(node => node.requirementText || ''),
  ]).join('\n\n');
  const exampleText = uniqueTextLines(nodes.map(node => node.exampleText || '')).join('\n\n');
  return {
    ...base,
    id,
    title: cleanAiTemplateNodeTitle(base.title),
    description: descriptions || base.description,
    requirementText: descriptions || base.requirementText,
    exampleText: exampleText || base.exampleText,
    children: undefined,
  };
}

function buildMergedExampleSiblingNodes(siblingGroups: TemplateNode[][], counter: { value: number }): TemplateNode[] {
  if (siblingGroups.length < 2 || siblingGroups.some(group => group.length === 0)) return [];
  const filteredGroups = siblingGroups.map(group => group.filter(isMergeableExampleNode));
  if (filteredGroups.some(group => group.length === 0)) return [];
  const baseGroup = filteredGroups[0];
  const usedByGroup = filteredGroups.map(() => new Set<string>());
  const merged: TemplateNode[] = [];

  baseGroup.forEach(base => {
    const matchedNodes: TemplateNode[] = [base];
    for (let groupIndex = 1; groupIndex < siblingGroups.length; groupIndex += 1) {
      const match = findBestSimilarExampleNode(base, filteredGroups[groupIndex], usedByGroup[groupIndex]);
      if (!match) return;
      matchedNodes.push(match);
      usedByGroup[groupIndex].add(match.id);
    }

    counter.value += 1;
    const node = mergeSimilarExampleNodeCluster(matchedNodes, `example-merged-${counter.value}`);
    const childGroups = matchedNodes.map(item => item.children || []);
    const children = buildMergedExampleSiblingNodes(childGroups, counter);
    merged.push({
      ...node,
      children: children.length ? children : undefined,
    });
  });

  return merged;
}
function buildCommonExampleTemplateNodes(sourceNodes: TemplateNode[], files: ImportedTemplateFile[]) {
  if (files.length < 2) {
    return { nodes: sourceNodes, evidence: '' };
  }
  return {
    nodes: buildDefaultExampleWritingDirectionNodes(),
    evidence: '多篇范文不再使用本地标题相似度硬合并；请点击 AI 识别，由 AI 综合原文生成建议性的合并写作大纲。当前仅显示默认技术报告方向。',
  };
}


const AI_EXTRACT_STALE_SECONDS = 300;

const getAiExtractWaitingStatus = (seconds: number) => {
  if (seconds >= 180) return 'AI 仍在处理，等待时间较长；若无响应会自动释放按钮';
  if (seconds >= 60) return 'AI 仍在处理，较大的范文可能需要几分钟';
  if (seconds >= 15) return '请求已发送，正在等待 AI 生成结构和格式规则';
  return '请求已发送，等待 AI 返回';
};

const TemplateManager: React.FC<{ onBack?: () => void; hideHeader?: boolean }> = ({ onBack, hideHeader = false }) => {
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
  const [aiExtractStatus, setAiExtractStatus] = useState('');
  const [aiExtractStartedAt, setAiExtractStartedAt] = useState<number | null>(null);
  const [aiExtractElapsedSeconds, setAiExtractElapsedSeconds] = useState(0);
  const [importedFiles, setImportedFiles] = useState<ImportedTemplateFile[]>([]);
  const [exampleStructureView, setExampleStructureView] = useState('merged');
  const [aiMergedExampleNodes, setAiMergedExampleNodes] = useState<TemplateNode[]>([]);
  const [aiMergedExampleEvidence, setAiMergedExampleEvidence] = useState('');
  const [formatRuleEvidence, setFormatRuleEvidence] = useState<string[]>([]);
  const [fontOptions, setFontOptions] = useState(fallbackFontNames.map(font => ({ value: font })));
  const [headingLevelFilter, setHeadingLevelFilter] = useState<number[]>([1, 2, 3, 4]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const lastSelectedNodeIdRef = useRef<string>('');
  const hasRequestedTemplateRefreshRef = useRef(false);
  const hasRequestedFontsRef = useRef(false);
  const aiExtractStaleNotifiedRef = useRef(false);
  const [form] = Form.useForm();
  const enableFormatRules = Form.useWatch('enableFormatRules', form);
  const templateType = Form.useWatch('templateType', form);

  // 兼容：合并所有导入文件的文本
  const importedDocumentText = useMemo(() => importedFiles.map(f => f.text).join('\n\n'), [importedFiles]);
  const importedFilePath = importedFiles[0]?.filePath || '';

  const resetAiExtractState = (status = 'AI 识别状态已重置，可以重新点击识别') => {
    aiExtractStaleNotifiedRef.current = false;
    setIsAiExtracting(false);
    setAiExtractStartedAt(null);
    setAiExtractElapsedSeconds(0);
    setAiExtractStatus(status);
  };

  useEffect(() => {
    if (!isAiExtracting || !aiExtractStartedAt) return;
    aiExtractStaleNotifiedRef.current = false;
    const updateElapsed = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - aiExtractStartedAt) / 1000));
      setAiExtractElapsedSeconds(seconds);
      if (seconds >= AI_EXTRACT_STALE_SECONDS && !aiExtractStaleNotifiedRef.current) {
        aiExtractStaleNotifiedRef.current = true;
        setIsAiExtracting(false);
        setAiExtractStartedAt(null);
        setAiExtractStatus('AI 识别等待过久，已自动重置，请重新点击识别');
        message.warning('AI 识别等待过久，已自动重置；请重新点击识别。', 6);
        return;
      }
      setAiExtractStatus(getAiExtractWaitingStatus(seconds));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [aiExtractStartedAt, isAiExtracting]);


  const buildExampleStructureResult = (view: string, files = importedFiles) => {
    if (files.length === 0) return { nodes: [] as TemplateNode[], evidence: '' };
    if (view.startsWith('file:')) {
      const index = Math.min(Math.max(Number(view.split(':')[1]) || 0, 0), files.length - 1);
      const nodes = extractTemplateNodes(files[index]?.text || '');
      return {
        nodes,
        evidence: `当前显示范文${index + 1}的原始章节结构`,
      };
    }
    if (aiMergedExampleNodes.length > 0) {
      return {
        nodes: aiMergedExampleNodes,
        evidence: aiMergedExampleEvidence || '当前显示 AI 综合多篇范文生成的建议性合并写作大纲',
      };
    }
    return buildCommonExampleTemplateNodes(extractTemplateNodes(files[0]?.text || ''), files);
  };

  const applyExampleStructureView = (view: string, files = importedFiles) => {
    setExampleStructureView(view);
    const result = buildExampleStructureResult(view, files);
    setTemplateNodes(result.nodes);
    setCollapsedNodeIds(collectCollapsibleTemplateNodeIds(result.nodes));
    setActiveNodeId('');
    if (result.evidence) {
      setFormatRuleEvidence(prev => [result.evidence, ...prev.filter(item => !/当前显示范文|同级同位置|同级标题相似度|未发现 .*共同章节/.test(item))].slice(0, 12));
    }
  };

  const exampleStructureViewOptions = useMemo(() => [
    ...(importedFiles.length > 1 ? [{ value: 'merged', label: '合并结构' }] : []),
    ...importedFiles.map((file, index) => ({
      value: `file:${index}`,
      label: `范文${index + 1}结构`,
    })),
  ], [importedFiles]);

  const handleRemoveImportedFile = (index: number) => {
    const newFiles = importedFiles.filter((_, fileIndex) => fileIndex !== index);
    setImportedFiles(newFiles);
    if (templateType !== 'example') return;

    setAiMergedExampleNodes([]);
    setAiMergedExampleEvidence('');
    if (newFiles.length === 0) {
      setTemplateNodes([]);
      setExampleStructureView('merged');
      return;
    }

    const nextView = newFiles.length > 1 ? 'merged' : 'file:0';
    applyExampleStructureView(nextView, newFiles);
  };

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
      lastSelectedNodeIdRef.current = '';
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

  useEffect(() => {
    if (lastSelectedNodeIdRef.current && !filteredNodeIdSet.has(lastSelectedNodeIdRef.current)) {
      lastSelectedNodeIdRef.current = '';
    }
  }, [filteredNodeIdSet]);

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
    lastSelectedNodeIdRef.current = '';
    setSelectedNodeIds(allFilteredSelected ? new Set() : new Set(filteredNodeIds));
  };

  const updateTemplateNodeSelection = (nodeId: string, checked: boolean, shiftKey: boolean) => {
    if (!filteredNodeIdSet.has(nodeId)) return;
    const lastSelectedNodeId = lastSelectedNodeIdRef.current;
    setSelectedNodeIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedNodeId && lastSelectedNodeId !== nodeId) {
        const startIndex = filteredNodeIds.indexOf(lastSelectedNodeId);
        const endIndex = filteredNodeIds.indexOf(nodeId);
        if (startIndex >= 0 && endIndex >= 0) {
          const from = Math.min(startIndex, endIndex);
          const to = Math.max(startIndex, endIndex);
          filteredNodeIds.slice(from, to + 1).forEach(id => {
            if (checked) next.add(id);
            else next.delete(id);
          });
          return next;
        }
      }
      if (checked) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
    lastSelectedNodeIdRef.current = nodeId;
  };
  const deleteSelectedTemplateNodes = () => {
    setTemplateNodes(prev => removeTemplateNodesByIds(prev, selectedNodeIds));
    lastSelectedNodeIdRef.current = '';
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
    setCollapsedNodeIds(collectCollapsibleTemplateNodeIds(template?.nodes || []));
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
      ? `\n注意：本次导入了 ${fileCount} 篇范文。不要在 nodes 中做标题交集或硬合并；请综合多篇范文提炼“写作大纲/大方向”。原文里的个性化章节、项目名称和小标题只作为分析素材，写入对应 description 或 evidence。`
      : '';

    const examplePrompt = `你是”范文写作分析”助手。下面是${fileCount > 1 ? `${fileCount}篇范文` : '一篇范文'}，请分析其写作方法、格式特征和结构，生成一份写作指导。${multiFileNote}

分析要求：
1. 范文模板的 nodes 输出“写作大纲/大方向”，不是固定章节清单。多篇范文时请综合提炼 5-7 个一级写作方向；不要照搬任一篇的完整标题，也不要做标题交集。
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
3. title 只能是干净的章节标题或写作方向名称，不能包含正文句子、段落、事实描述或换行内容。
4. requirementText 只写建议字数，不要写硬性要求。
5. 格式规则要从范文中实际使用的格式推断，如果范文使用了某种字体/字号/行距，请提取出来。
6. 目录、页码、页眉页脚、乱码不要作为标题。
7. 多篇范文中只在某一篇出现的小标题、项目名称、实施地点、金额、时间、单位名称等个性化标题，不要放入 nodes；只把它们总结成某个一级写作方向的命名参考或写作提示。
8. 范文模板的结构用于后续 AI 报告和审查的建议性参考，不作为硬性缺失/多余章节要求。

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

    const aiConfig = requireIpcObject<AIConfig>(await window.electronAPI.loadAIConfig(), '加载 AI 配置失败');
    const useParallel = aiConfig?.multiModelMode === 'parallel' && (aiConfig.parallelModelIds?.length || 0) > 1 && window.electronAPI.callAIParallelDetails;
    let response = '';
    let parallelEvidence: string[] = [];
    if (useParallel) {
      const details = await useAIJobStore.getState().runAIJob<{ synthesis: string; variants: Array<{ modelName: string; ok: boolean; output: string; error?: string }> }>(
        {
          scene: 'templateExtract',
          title: 'AI 识别模板结构',
          resultPreview: (value) => value.synthesis,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(35);
          const value = await window.electronAPI.callAIParallelDetails({ prompt, config: aiConfig, modelIds: aiConfig.parallelModelIds, modelId: aiConfig.activeModelId });
          throwIfCancelled();
          setProgress(85);
          return value;
        },
      );
      response = details.synthesis;
      parallelEvidence = details.variants.map(variant => variant.ok
        ? `${variant.modelName}: \u5df2\u53c2\u4e0e\u6a21\u677f\u7ed3\u6784/\u683c\u5f0f\u8bc6\u522b`
        : `${variant.modelName}: \u8bc6\u522b\u5931\u8d25\uff0c${variant.error || '\u65e0\u8fd4\u56de'}`
      );
    } else {
      response = await useAIJobStore.getState().runAIJob<string>(
        {
          scene: 'templateExtract',
          title: 'AI 识别模板结构',
          resultPreview: (value) => value,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(35);
          const value = await window.electronAPI.callAI(prompt);
          throwIfCancelled();
          setProgress(85);
          return String(value || '');
        },
      );
    }
    const aiResult = parseAiHeadingResponse(response);
    if (parallelEvidence.length) {
      aiResult.evidence = [...parallelEvidence, ...aiResult.evidence].slice(0, 16);
    }
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
    let cleanResultNodes = dedupeTemplateNodesByExactTitle(normalizeTopLevelOutlineOrder(cleanAiTemplateNodes(result.nodes)));
    let restoredSourceOutlineCount = 0;
    if (currentType !== 'example') {
      const sourceNodes = extractTemplateNodes(importedDocumentText);
      if (hasReliableExplicitSourceOutline(sourceNodes)) {
        const aiCount = flattenTemplateNodesForMatch(cleanResultNodes).length;
        cleanResultNodes = reconcileAiGuidanceWithSourceOutline(sourceNodes, cleanResultNodes);
        restoredSourceOutlineCount = Math.max(0, flattenTemplateNodesForMatch(cleanResultNodes).length - aiCount);
      }
    }
    const exampleOutlineNodes = currentType === 'example'
      ? normalizeExampleAiOutlineNodes(cleanResultNodes)
      : [];
    const commonBaseNodes = currentType === 'example' ? exampleOutlineNodes : cleanResultNodes;
    const commonNodes = attachGlobalGuidanceToTopLevel(commonBaseNodes, result.requirementText, result.exampleText);
    const commonResult = currentType === 'example'
      ? { nodes: commonNodes, evidence: '已使用 AI 综合范文生成建议性合并写作大纲；单篇范文结构仍可在结构视图中切换查看' }
      : { nodes: commonNodes, evidence: '' };
    const currentFormatValues = form.getFieldValue('formatRules') || buildDefaultFormatFormValues();
    const mergedFormatValues = mergeFormatFormValues(
      currentFormatValues,
      result.formatValues || formatRulesToPartialFormValues(result.formatRules),
    );
    const evidence = [
      ...(commonResult.evidence ? [commonResult.evidence] : []),
      ...(restoredSourceOutlineCount > 0 ? [`原文编号结构优先：已补回 AI 遗漏的 ${restoredSourceOutlineCount} 个章节节点`] : []),
      ...result.evidence,
    ].slice(0, 12);

    // 范文模板：全局字段留空，内容在节点里；直接套用：保留全局字段
    const formValues: any = {
      ...(Object.keys(result.formatValues || {}).length || result.formatRules
        ? { enableFormatRules: true, formatRules: mergedFormatValues }
        : {}),
    };

    form.setFieldsValue(formValues);
    if (evidence.length > 0) {
      setFormatRuleEvidence(evidence);
    }
    if (currentType === 'example') {
      setAiMergedExampleNodes(commonResult.nodes);
      setAiMergedExampleEvidence(commonResult.evidence);
      setExampleStructureView('merged');
    }
    setTemplateNodes(commonResult.nodes);
    setCollapsedNodeIds(collectCollapsibleTemplateNodeIds(commonResult.nodes));
    setActiveNodeId('');
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
    if (isAiExtracting) {
      message.info(aiExtractStatus || 'AI 识别仍在运行，请稍等或点击重置');
      return;
    }
    if (isExtracting) {
      message.info('文件仍在解析，请稍等片刻再识别');
      return;
    }

    if (!importedDocumentText) {
      message.warning('请先选择并解析一个文件');
      return;
    }

    aiExtractStaleNotifiedRef.current = false;
    setIsAiExtracting(true);
    setAiExtractStartedAt(Date.now());
    setAiExtractElapsedSeconds(0);
    setAiExtractStatus(getAiExtractWaitingStatus(0));
    try {
      const aiResult = await enrichAiResultWithSourceFormat(await extractNodesWithAi(importedDocumentText));
      if (aiResult.nodes.length === 0) {
        const currentType = form.getFieldValue('templateType') || 'direct';
      const fallbackNodes = currentType === 'example' && importedFiles.length > 1
        ? buildDefaultExampleWritingDirectionNodes()
        : extractTemplateNodes(importedDocumentText);
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
      const currentType = form.getFieldValue('templateType') || 'direct';
      const fallbackNodes = currentType === 'example' && importedFiles.length > 1
        ? buildDefaultExampleWritingDirectionNodes()
        : extractTemplateNodes(importedDocumentText);
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
      setAiExtractStartedAt(null);
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
      setExampleStructureView('merged');
      setAiMergedExampleNodes([]);
      setAiMergedExampleEvidence('');
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
      setExampleStructureView('merged');
      setAiMergedExampleNodes([]);
      setAiMergedExampleEvidence('');
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
      const nodeGuidance = collectTemplateGuidance(nodes);
      const formatRules = buildFormatRules(values);
      const heading1Rule = formatRules?.heading1?.fontRequirement;
      const bodyRule = formatRules?.body?.fontRequirement;

      const templateId = editingTemplate?.id || Date.now().toString();
      const templateData: WritingTemplate = {
        id: templateId,
        name: values.name,
        description: values.description,
        requirementText: nodeGuidance.requirementText,
        exampleText: nodeGuidance.exampleText,
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
      if (currentType === 'example') {
        setAiMergedExampleNodes([]);
        setAiMergedExampleEvidence('');
      }

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
      const nextExampleView = currentType === 'example' && newFiles.length > 1 ? 'merged' : 'file:0';
      if (currentType === 'example') {
        setExampleStructureView(nextExampleView);
      }
      const commonImportResult = currentType === 'example'
        ? buildExampleStructureResult(nextExampleView, newFiles)
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
          ? '已导入范文；合并结构需要点击“AI识别结构/分析范文”生成建议性写作大纲。'
          : '文件已关联，但未检测到章节标题。可以点击”AI识别结构”重试，或确认文档使用了一、二、三 / 第X章 / 1. 2. 3. 等编号格式。');
      } else {

        setTemplateNodes(nodes);
        setCollapsedNodeIds(collectCollapsibleTemplateNodeIds(nodes));
        setActiveNodeId('');
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
      <TemplateCatalog
        items={templateCardItems}
        hideHeader={hideHeader}
        onBack={onBack}
        onCreate={handleCreate}
        onEdit={handleEdit}
        onDelete={setDeletingTemplate}
      />

      <TemplateEditorModal
        editingTemplate={editingTemplate}
        open={isModalOpen}
        form={form}
        preparing={isPreparingTemplateEditor}
        onSubmit={() => { void handleSubmit(); }}
        onCancel={() => setIsModalOpen(false)}
      >
          <div className="template-editor-grid">
            <div className="template-editor-main">
              <div className="template-form-section">
                <TemplateBasicInfoSection stages={allStages} fileTypeOptions={templateFileTypeOptions} />

                <TemplateFormatRulesSection
                  enabled={Boolean(enableFormatRules)}
                  evidence={formatRuleEvidence}
                  fontOptions={fontOptions}
                />
              </div>

              <TemplateImportPanel
                templateType={templateType}
                files={importedFiles}
                structureView={exampleStructureView}
                structureViewOptions={exampleStructureViewOptions}
                extracting={isExtracting}
                aiExtracting={isAiExtracting}
                aiExtractStatus={aiExtractStatus}
                aiExtractElapsedSeconds={aiExtractElapsedSeconds}
                onRemoveFile={handleRemoveImportedFile}
                onStructureViewChange={value => applyExampleStructureView(value)}
                onImport={() => { void handleImportFromDoc(); }}
                onAiExtract={() => { void handleAiExtract(); }}
                onResetAiExtract={() => {
                  resetAiExtractState();
                  message.info('已重置 AI 识别状态，可以重新点击识别');
                }}
              />

          {/* 模板结构编辑器 */}
          <div className="template-node-editor" style={{ marginBottom: 16 }}>
            <TemplateStructureToolbar
              allFilteredSelected={allFilteredSelected}
              someFilteredSelected={someFilteredSelected}
              filteredCount={filteredNodeIds.length}
              nodeTotal={nodeTotal}
              requiredTotal={requiredTotal}
              selectedFilteredCount={selectedFilteredCount}
              selectedCascadeCount={selectedCascadeCount}
              availableLevels={availableLevels}
              activeLevels={activeHeadingLevelFilter}
              onToggleFilteredSelection={toggleSelectFilteredNodes}
              onLevelsChange={handleHeadingLevelFilterChange}
              onDeleteSelected={deleteSelectedTemplateNodes}
              onAddNode={addTemplateNode}
            />
            <div className="template-node-list">
              <TemplateEditorNodeRows
                nodes={templateNodes}
                activeLevels={activeHeadingLevelFilter}
                collapsedNodeIds={collapsedNodeIds}
                activeNodeId={activeNodeId}
                selectedNodeIds={selectedNodeIds}
                canMoveUp={nodeId => templateNodeMoveAvailability.up.has(nodeId)}
                canMoveDown={nodeId => templateNodeMoveAvailability.down.has(nodeId)}
                getRuleText={getTemplateNodeRuleText}
                onCardRef={(nodeId, element) => { nodeCardRefs.current[nodeId] = element; }}
                onToggleCollapsed={toggleTemplateNodeCollapsed}
                onSelectionChange={updateTemplateNodeSelection}
                onUpdate={updateTemplateNode}
                onLevelChange={updateTemplateNodeLevel}
                onMove={moveTemplateNode}
                onRemove={removeTemplateNode}
              />
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
            <TemplateStructurePreview
              hasNodes={templateNodes.length > 0}
              rows={(
                <TemplatePreviewNodeRows
                  nodes={deferredPreviewNodes}
                  activeLevels={activeHeadingLevelFilter}
                  collapsedNodeIds={collapsedNodeIds}
                  activeNodeId={activeNodeId}
                  selectedNodeIds={selectedNodeIds}
                  onToggleCollapsed={toggleTemplateNodeCollapsed}
                  onSelectionChange={updateTemplateNodeSelection}
                  onFocus={focusTemplateNode}
                />
              )}
            />
          </div>
      </TemplateEditorModal>

      <TemplateDeleteModal
        template={deletingTemplate}
        onDelete={template => { void handleDelete(template.id); }}
        onCancel={() => setDeletingTemplate(null)}
      />

      <ProjectStageSection
        stages={allStages}
        onCreate={handleCreateStage}
        onEdit={handleEditStage}
        onDelete={stageId => { void handleDeleteStage(stageId); }}
      />

      <ProjectStageModal
        editingStage={editingStage}
        open={isStageModalOpen}
        form={stageForm}
        onSubmit={() => { void handleStageSubmit(); }}
        onCancel={() => setIsStageModalOpen(false)}
      />
    </div>
  );
};

export default TemplateManager;

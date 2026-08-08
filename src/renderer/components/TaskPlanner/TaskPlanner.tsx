import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Modal,
  Space,
  Typography,
  message,
} from 'antd';
import {
  FileTextOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { AIConfig, ProjectDocument, ReferenceMaterial, SectionAnalysis, StageMemoryEntry, TaskItem, WritingTemplate } from '../../../shared/types';
import { buildProjectStageSegments, detectTimelineStage, getAllStages } from '../../utils/timelineStages';
import { requireIpcObject } from '../../utils/ipcResult';
import { composePromptAsync } from '../../utils/promptComposer';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';
import { pickProjectFiles } from '../../stores/projectPickerStore';
import StageDocumentPanel from './StageDocumentPanel';
import StageDocumentOverview from './StageDocumentOverview';
import AiStageReportPanel from './AiStageReportPanel';
import type { AiReportVariant, AiSectionAdvice, AiStageReport, AiWorkflowPlanItem, SectionAdviceDraftItem, WorkflowDraftItem } from './taskPlannerTypes';

const { Text, Title } = Typography;

const REPORT_WORKFLOW_DRAFTS_KEY = 'projecthub.report-workflow-drafts.v1';

interface StoredReportWorkflowDraft {
  adviceItems: SectionAdviceDraftItem[];
  workflowItems: WorkflowDraftItem[];
  updatedAt: string;
}

const loadStoredReportWorkflowDraft = (key: string): StoredReportWorkflowDraft | null => {
  if (!key) return null;
  try {
    const records = JSON.parse(localStorage.getItem(REPORT_WORKFLOW_DRAFTS_KEY) || '{}') as Record<string, StoredReportWorkflowDraft>;
    const record = records[key];
    return record && Array.isArray(record.adviceItems) && Array.isArray(record.workflowItems) ? record : null;
  } catch {
    return null;
  }
};

const saveStoredReportWorkflowDraft = (key: string, draft: StoredReportWorkflowDraft) => {
  if (!key) return;
  try {
    const records = JSON.parse(localStorage.getItem(REPORT_WORKFLOW_DRAFTS_KEY) || '{}') as Record<string, StoredReportWorkflowDraft>;
    records[key] = draft;
    const retained = Object.entries(records)
      .sort((a, b) => new Date(b[1]?.updatedAt || 0).getTime() - new Date(a[1]?.updatedAt || 0).getTime())
      .slice(0, 40);
    localStorage.setItem(REPORT_WORKFLOW_DRAFTS_KEY, JSON.stringify(Object.fromEntries(retained)));
  } catch {
    // Draft persistence is best-effort and must not interrupt report editing.
  }
};

const normalizeKnowledgeStageNameForPrompt = (value?: string) => String(value || '').trim().replace(/\s+/g, ' ') || 'unknown';

const formatPromptKnowledgeItems = (items: Array<StageMemoryEntry | ReferenceMaterial>, type: 'memory' | 'reference') =>
  items
    .slice(0, type === 'memory' ? 4 : 5)
    .map((item, index) => {
      const body = type === 'memory'
        ? (item as StageMemoryEntry).summary
        : ((item as ReferenceMaterial).summary || (item as ReferenceMaterial).contentPreview || '');
      const name = type === 'memory' ? (item as StageMemoryEntry).docName : (item as ReferenceMaterial).name;
      return String(index + 1) + '. ' + (name || 'item') + '\n' + String(body || '').slice(0, type === 'memory' ? 1200 : 1600);
    })
    .filter(Boolean)
    .join('\n\n');
const getDocCreatedAt = (doc: ProjectDocument) => doc.sourceFileCreatedAt || doc.createdAt;

const cleanReportHeadingTitle = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  if (!line) return '';
  const headingLike = /^第[一二三四五六七八九十百千万零〇两\d]+章/.test(line)
    || /^[一二三四五六七八九十百千万零〇两]+[、.．）)]/.test(line)
    || /^\d{1,2}[、.．）)]/.test(line);
  if (!headingLike) return line;
  return line
    .replace(/\.{2,}\s*\d{1,4}\s*$/, '')
    .replace(/[·•…]{2,}\s*\d{1,4}\s*$/, '')
    .replace(/([\u4e00-\u9fa5A-Za-z）)])\s*\d{1,4}\s*$/, '$1')
    .trim();
};

const isTocLikeReportHeading = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  return /\.{2,}\s*\d{1,4}\s*$|[·•…]{2,}\s*\d{1,4}\s*$|[\u4e00-\u9fa5A-Za-z）)]\s*\d{1,4}\s*$/.test(line);
};

const normalizeReportHeadingKey = (value: string) => cleanReportHeadingTitle(value)
  .trim()
  .replace(/^第[一二三四五六七八九十百千万零〇两\d]+章[、.．：:\s]*/, '')
  .replace(/^[一二三四五六七八九十百千万零〇两]+[、.．）)]\s*/, '')
  .replace(/^\d{1,3}[、.．）)]\s*/, '')
  .replace(/\s+/g, '')
  .replace(/[：:；;，,。.【】\[\]（）()《》<>]/g, '')
  .toLowerCase();

const isCanonicalReportTopLevelHeading = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  return /^第[一二三四五六七八九十百千万零〇两\d]+章(?:[、.．：:\s]+|(?=[\u4e00-\u9fa5]))\S+/.test(line)
    || /^[一二三四五六七八九十百千万零〇两]+[、.．）)]\s*\S+/.test(line);
};

const isArabicNumberedReportHeading = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  return /^\d{1,2}[、.．）)]\s*(?!\d)\S+/.test(line)
    || /^\d{1,2}\s+[\u4e00-\u9fa5]\S*/.test(line);
};

const isReportTopLevelHeading = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  if (!line || line.length > 90) return false;
  if (/\.{3,}\s*\d+\s*$|[·•…]{3,}\s*\d+\s*$/.test(line)) return false;
  if (/[。；;，,：:]$/.test(line)) return false;
  if (/^[+\-]?\d+(?:\.\d+)?\s*(?:kN|N|MN|MPa|kPa|Pa|kg|mm|cm|km|m\/s|km\/h|kV|Hz|%|℃|°)\b/i.test(line)) return false;
  if (/^\d+(?:[.．]\d+)+/.test(line)) return false;

  return isCanonicalReportTopLevelHeading(line) || isArabicNumberedReportHeading(line);
};

const isStandaloneReportChapterMarker = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  if (!line || line.length > 24) return false;
  return /^第[一二三四五六七八九十百千万零〇两\d]+章$/.test(line)
    || /^[一二三四五六七八九十百千万零〇两]+[、.．）)]$/.test(line)
    || /^\d{1,2}[、.．）)]$/.test(line);
};

const canUseNextLineAsReportHeadingTitle = (value: string) => {
  const line = String(value || '').replace(/[\t　]+/g, ' ').trim();
  if (!line || line.length > 80) return false;
  if (isReportTopLevelHeading(line) || isStandaloneReportChapterMarker(line)) return false;
  if (/^[\d\s.,，。:：;；%+-]+$/.test(line)) return false;
  if (/^[+\-]?\d+(?:\.\d+)?\s*(?:kN|N|MN|MPa|kPa|Pa|kg|mm|cm|km|m\/s|km\/h|kV|Hz|%|℃|°)\b/i.test(line)) return false;
  if (/^(图|表)\s*\d/.test(line)) return false;
  if (/[。；;，,]$/.test(line)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(line);
};

// 报告工作台只关心当前文档自身的一级章节，模板标题不得进入这里。
const extractCurrentDocumentSections = (content: string): SectionAnalysis[] => {
  const lines = String(content || '').split(/\r?\n/);
  const normalizedLines = lines.map((raw, index) => ({
    title: raw.replace(/[\t　]+/g, ' ').trim(),
    index,
  }));

  let headings: Array<{ title: string; index: number; bodyStartIndex: number }> = [];
  normalizedLines.forEach((line, index) => {
    if (!line.title) return;

    if (isStandaloneReportChapterMarker(line.title)) {
      const next = normalizedLines.slice(index + 1, index + 4).find(item => item.title);
      if (next && canUseNextLineAsReportHeadingTitle(next.title)) {
        headings.push({
          title: `${line.title} ${next.title}`,
          index: line.index,
          bodyStartIndex: next.index + 1,
        });
      }
      return;
    }

    if (isReportTopLevelHeading(line.title)) {
      headings.push({ title: line.title, index: line.index, bodyStartIndex: line.index + 1 });
    }
  });
  if (!headings.length) return [];

  const hasCanonicalTopLevel = headings.some(heading => isCanonicalReportTopLevelHeading(heading.title));
  if (hasCanonicalTopLevel) {
    headings = headings.filter(heading => !isArabicNumberedReportHeading(heading.title));
  }
  if (!headings.length) return [];

  const candidates = headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? lines.length;
    const body = lines.slice(heading.bodyStartIndex, end).join('\n').trim();
    return {
      ...heading,
      title: cleanReportHeadingTitle(heading.title),
      isTocLike: isTocLikeReportHeading(heading.title),
      body,
      wordCount: body.replace(/\s/g, '').length,
    };
  });
  const bestByTitle = new Map<string, typeof candidates[number]>();
  candidates.forEach(candidate => {
    const key = normalizeReportHeadingKey(candidate.title);
    if (!key) return;
    const existing = bestByTitle.get(key);
    // 目录和正文重复时，正文通常拥有更多内容，优先保留正文位置。
    if (!existing || (existing.isTocLike && !candidate.isTocLike) || (existing.isTocLike === candidate.isTocLike && candidate.wordCount > existing.wordCount)) bestByTitle.set(key, candidate);
  });

  return [...bestByTitle.values()]
    .sort((a, b) => a.index - b.index)
    .map((section, index) => ({
      nodeId: `document-heading:renderer:${index}:${section.index}`,
      title: section.title,
      status: section.wordCount >= 80 ? 'completed' : section.wordCount > 0 ? 'partial' : 'missing',
      wordCount: section.wordCount,
      aiComment: section.wordCount === 0 ? '已识别到章节标题，但标题下暂未提取到正文。' : undefined,
    }));
};

const getTemplateStageName = (template: WritingTemplate, allStages: any[]) =>
  template.category || detectTimelineStage(allStages, template.name, template.description);

const templateKindGroups = [
  ['申报指南', '指南'],
  ['提案表', '提案'],
  ['可研报告', '可行性研究', '可研'],
  ['任务书'],
  ['合同'],
  ['预算', '经费'],
  ['验收报告', '验收'],
  ['总结报告', '总结'],
  ['审查意见', '审查'],
];

const normalizeMatchText = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(' ').toLowerCase();

const findKindGroup = (text: string) =>
  templateKindGroups.find(group => group.some(token => text.includes(token.toLowerCase())));

const matchesKindGroup = (template: WritingTemplate, group?: string[]) => {
  if (!group) return false;
  const templateText = normalizeMatchText(template.name, template.category, template.description);
  return group.some(token => templateText.includes(token.toLowerCase()));
};

const isGenericStageMatch = (template: WritingTemplate, allStages: any[], stage: string) => {
  if (!stage) return false;
  const templateStage = getTemplateStageName(template, allStages);
  return templateStage === stage || Boolean(template.category?.includes(stage)) || template.name.includes(stage);
};

const sortNewestTemplate = (items: WritingTemplate[]) =>
  [...items].sort((a, b) =>
    new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  );

const findReplacementTemplateForDoc = (
  doc: ProjectDocument,
  templates: WritingTemplate[],
  allStages: any[],
  selectedStage?: string,
) => {
  const docText = normalizeMatchText(doc.name, doc.sourceFilePath);
  const docKindGroup = findKindGroup(docText);
  const exact = templates.find(template => template.id === doc.templateId);

  if (exact && (!docKindGroup || matchesKindGroup(exact, docKindGroup))) {
    return exact;
  }

  if (docKindGroup) {
    const kindMatches = templates.filter(template => matchesKindGroup(template, docKindGroup));
    if (kindMatches.length > 0) return sortNewestTemplate(kindMatches)[0];
    return exact;
  }

  if (exact) return exact;

  const directMatches = templates.filter(template => {
    const templateName = String(template.name || '').toLowerCase();
    const templateCategory = String(template.category || '').toLowerCase();
    return (
      Boolean(templateName && docText.includes(templateName)) ||
      Boolean(templateCategory && docText.includes(templateCategory))
    );
  });
  if (directMatches.length > 0) return sortNewestTemplate(directMatches)[0];

  const detectedStage = selectedStage || detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
  const stageMatches = templates.filter(template => isGenericStageMatch(template, allStages, detectedStage));
  return stageMatches.length === 1 ? stageMatches[0] : undefined;
};


const flattenTemplateTitleTexts = (nodes: any[] = []): string[] =>
  nodes.flatMap(node => [
    String(node.title || '').trim(),
    ...flattenTemplateTitleTexts(node.children || []),
  ]).filter(Boolean);

const normalizeSectionTitleForCompare = (value: string) =>
  String(value || '')
    .replace(/^([一二三四五六七八九十百千万]+[、.．）)]|第[一二三四五六七八九十百千万\d]+[章节部分篇]|\d+(?:[.．-]\d+)*[、.．）)]?|[（(][一二三四五六七八九十百千万\d]+[）)])\s*/, '')
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>]/g, '')
    .toLowerCase();

const isSectionAnalysisStaleForTemplate = (
  doc: ProjectDocument | undefined,
  template: WritingTemplate | undefined,
  sections: Array<{ title?: string }> = [],
) => {
  if (!doc || !template) return false;
  const templateTitles = flattenTemplateTitleTexts(template.nodes || []);
  if (!templateTitles.length) return false;
  if (!sections.length) return true;

  const analyzedAt = doc.analyzedAt ? new Date(doc.analyzedAt).getTime() : 0;
  const templateUpdatedAt = template.updatedAt ? new Date(template.updatedAt).getTime() : 0;
  if (templateUpdatedAt && (!analyzedAt || templateUpdatedAt > analyzedAt)) return true;

  const normalizedTemplateTitles = new Set(templateTitles.map(normalizeSectionTitleForCompare).filter(Boolean));
  const staleSectionCount = sections.filter(section => {
    const normalized = normalizeSectionTitleForCompare(String(section.title || ''));
    return normalized && !normalizedTemplateTitles.has(normalized);
  }).length;
  if (staleSectionCount > 0) return true;

  return Math.abs(templateTitles.length - sections.length) >= 2;
};

const normalizeDocumentContentForSectionCompare = (value: string) =>
  String(value || '')
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>]/g, '')
    .toLowerCase();

const isLikelyFalseMissingSectionAnalysis = (
  sections: Array<{ title?: string; status?: string; wordCount?: number }> = [],
  content = '',
) => {
  const normalizedContent = normalizeDocumentContentForSectionCompare(content);
  if (!normalizedContent) return false;
  const problematicSections = sections.filter(section =>
    section.status === 'missing' || (section.status === 'partial' && !section.wordCount)
  );
  if (!problematicSections.length) return false;

  return problematicSections.some(section => {
    const normalizedTitle = normalizeSectionTitleForCompare(String(section.title || ''));
    if (normalizedTitle && normalizedContent.includes(normalizedTitle)) return true;
    if (normalizedTitle && normalizedTitle.length >= 4) {
      const fragments = Array.from(new Set([
        normalizedTitle,
        normalizedTitle.slice(0, 4),
        normalizedTitle.slice(-4),
      ].filter(fragment => fragment.length >= 2)));
      return fragments.some(fragment => normalizedContent.includes(fragment));
    }
    return false;
  });
};


const flattenTemplateNodesForPrompt = (nodes: any[] = [], depth = 0, isExampleTemplate = false): string[] => nodes.flatMap((node) => {
  const prefix = `${'  '.repeat(depth)}- ${node.title || '未命名章节'}`;
  const details = [
    (node.requirementText || node.description) ? `${isExampleTemplate ? '参考方向' : '写作要求'}：${node.requirementText || node.description}` : '',
    isExampleTemplate ? '范文标题非固定，仅作写作方向参考' : (node.isRequired === false ? '可选章节' : '必需章节'),
    node.fontRequirement ? `字体要求：${JSON.stringify(node.fontRequirement)}` : '',
    node.paragraphRequirement ? `段落要求：${JSON.stringify(node.paragraphRequirement)}` : '',
    node.exampleText ? `范文写法参考：${String(node.exampleText).slice(0, 500)}` : '',
  ].filter(Boolean).join('；');
  return [`${prefix}${details ? `（${details}）` : ''}`, ...flattenTemplateNodesForPrompt(node.children || [], depth + 1, isExampleTemplate)];
});



const splitLegacyTemplateNodeGuidance = (text = '', heading = '') => {
  const target = `${heading}\n${text}`;
  const isExample = /(范文|示例|示范|样例|例文|参考文|参考写法|参考内容|优秀案例|写法参考)/.test(target);
  const isRequirement = /(要求|填写|说明|格式|规范|须知|注意事项|编写|撰写|内容要点|提交材料|指标|标准|必须|不得|应当)/.test(target);
  if (isExample && !isRequirement) return { requirementText: '', exampleText: text };
  if (isExample && /(范文|示例|示范|样例|例文|参考写法|参考内容)/.test(heading)) return { requirementText: '', exampleText: text };
  return { requirementText: text, exampleText: '' };
};

const extractTemplateGuidanceText = (template: any) => {
  const requirementLines: string[] = [];
  const exampleLines: string[] = [];
  const visit = (nodes: any[] = []) => {
    nodes.forEach(node => {
      if (node.requirementText) {
        requirementLines.push(node.requirementText);
      } else if (node.description) {
        const legacyGuidance = splitLegacyTemplateNodeGuidance(node.description, node.title || '');
        if (legacyGuidance.requirementText) requirementLines.push(legacyGuidance.requirementText);
        if (legacyGuidance.exampleText) exampleLines.push(`${node.title || '示例'}\n${legacyGuidance.exampleText}`);
      }
      if (node.exampleText) exampleLines.push(`${node.title || '示例'}\n${node.exampleText}`);
      if (node.children?.length) visit(node.children);
    });
  };
  if (template?.requirementText) requirementLines.push(template.requirementText);
  if (template?.exampleText) exampleLines.push(template.exampleText);
  visit(template?.nodes || []);
  const uniq = (items: string[]) => Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)));
  return {
    requirementText: uniq(requirementLines).join('\n\n').slice(0, 8000),
    exampleText: uniq(exampleLines).join('\n\n').slice(0, 10000),
  };
};

const splitLoadedTemplateReference = (content: string) => {
  const paragraphs = content
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);
  const exampleLines: string[] = [];
  let inExample = false;
  paragraphs.forEach(part => {
    if (/(范文|示例|示范|样例|例文|参考写法|参考内容|优秀案例)/.test(part)) {
      inExample = true;
      exampleLines.push(part);
      return;
    }
    if (/(要求|填写|说明|格式|规范|须知|注意事项|编写|撰写|内容要点|提交材料|审查要点)/.test(part)) {
      inExample = false;
      return;
    }
    if (inExample) exampleLines.push(part);
  });
  return exampleLines.join('\n\n').slice(0, 6000);
};


const extractJsonObject = (value: string): any | null => {
  let trimmed = value.trim();

  // 1. 先尝试去除 markdown 代码块包裹
  const codeBlockMatch = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    trimmed = codeBlockMatch[1].trim();
  }

  // 2. 直接解析
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 3. 尝试提取最外层 JSON 对象（贪婪匹配）
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {}

  // 4. 尝试修复常见JSON问题
  try {
    let fixable = match[0]
      .replace(/,\s*([}\]])/g, '$1')        // 移除末尾多余逗号
      .replace(/[\x00-\x1f]+/g, '')      // Remove control characters
      .replace(/\\"/g, '"')                   // 修复转义引号
      .replace(/\\n/g, '\\n');                // 保留换行符
    return JSON.parse(fixable);
  } catch {}

  // 5. 尝试逐行修复JSON
  try {
    let lines = match[0].split('\n');
    let fixed = lines.map(line => {
      // 修复行内未转义的引号
      return line.replace(/: "([^"]*)"([^",}\]]*)"([^",}\]]*)/g, ': "$1\\"$2\\"$3"');
    }).join('\n');
    return JSON.parse(fixed);
  } catch {}

  return null;
};

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'object' && item !== null) {
          // 如果是对象，尝试提取 title 或 name 字段
          const record = item as Record<string, unknown>;
          return String(record.title || record.name || record.text || JSON.stringify(item)).trim();
        }
        return String(item || '').trim();
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|；|;|，/)
      .map(item => item.replace(/^[-\d.、\s]+/, '').trim())
      .filter(item => item.length > 1);  // 过滤掉单个字符的无效项
  }
  return [];
};

const normalizeTaskType = (value: unknown): 'manual' | 'ai' => {
  const text = String(value || '').toLowerCase();
  return text.includes('ai') || text.includes('智能') ? 'ai' : 'manual';
};

const normalizePriority = (value: unknown, fallback: TaskItem['priority'] = 'medium'): TaskItem['priority'] => {
  const text = String(value || '').toLowerCase();
  if (text.includes('high') || text.includes('高')) return 'high';
  if (text.includes('low') || text.includes('低')) return 'low';
  if (text.includes('medium') || text.includes('中')) return 'medium';
  return fallback;
};

const normalizeSectionAdvice = (value: unknown): AiSectionAdvice[] => {
  if (!Array.isArray(value)) return [];
  const items: AiSectionAdvice[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const title = String(record.title || record.sectionTitle || record.chapter || record.name || '').trim();
    if (!title) return;
    const advice: AiSectionAdvice = {
      title,
      problems: normalizeStringList(record.problems || record.issues || record.question || record.problem),
      suggestions: normalizeStringList(record.suggestions || record.advice || record.recommendations || record.actions),
    };
    if ((advice.problems?.length || 0) > 0 || (advice.suggestions?.length || 0) > 0) {
      items.push(advice);
    }
  });
  return items;
};

// 即使模型响应在尾部被截断，也尽量从 sectionAdvice 数组中恢复已完整输出的章节对象。
const extractSectionAdviceFromRaw = (value: string): AiSectionAdvice[] => {
  const marker = /["'](?:sectionAdvice|chapterAdvice|sectionPlans|sections)["']\s*:/i.exec(value);
  if (!marker) return [];
  const arrayStart = value.indexOf('[', marker.index + marker[0].length);
  if (arrayStart < 0) return [];

  const recovered: AiSectionAdvice[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = arrayStart + 1; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        const candidate = value.slice(objectStart, index + 1)
          .replace(/,\s*([}\]])/g, '$1');
        try {
          recovered.push(...normalizeSectionAdvice([JSON.parse(candidate)]));
        } catch {
          // 单个对象损坏不影响后续完整对象的恢复。
        }
        objectStart = -1;
      }
      continue;
    }
    if (char === ']' && depth === 0) break;
  }

  return recovered;
};

const normalizeWorkflowPlan = (value: unknown): AiWorkflowPlanItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const cleaned = item.replace(/^第?\d+[步、.]\s*/, '').trim();
        if (!cleaned) return null;
        return {
          type: normalizeTaskType(cleaned),
          title: cleaned,
          priority: index === 0 ? 'high' : 'medium',
        };
      }
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const title = String(record.title || record.task || record.name || record.step || '').trim();
      if (!title) return null;
      return {
        type: normalizeTaskType(record.type || record.owner || record.role),
        title: title.replace(/^第?\d+[步、.]\s*/, ''),
        description: String(record.description || record.detail || record.instruction || record.content || '').trim(),
        priority: normalizePriority(record.priority, index === 0 ? 'high' : 'medium'),
        reason: String(record.reason || record.orderReason || record.note || '').trim(),
      };
    })
    .filter(Boolean) as AiWorkflowPlanItem[];
};

const createSectionAdviceDraftItems = (sections: AiSectionAdvice[]): SectionAdviceDraftItem[] =>
  sections.flatMap((section, sectionIndex) => {
    const problems = section.problems || [];
    const suggestions = section.suggestions || [];
    return suggestions.map((suggestion, itemIndex) => ({
      id: `advice-${sectionIndex}-${itemIndex}`,
      sectionTitle: section.title,
      problem: problems[itemIndex] || (suggestions.length === 1 ? problems.join('；') : problems[0]) || '',
      suggestion,
      selected: true,
    }));
  });

const adviceExecutionType = (suggestion: string): 'manual' | 'ai' =>
  /人工|补充资料|提供资料|核实|确认|审核|协调|签字|口径/.test(suggestion) ? 'manual' : 'ai';

const createWorkflowItemFromAdvice = (item: SectionAdviceDraftItem, order: number): WorkflowDraftItem => ({
  id: `draft-${item.id}`,
  sourceAdviceId: item.id,
  type: adviceExecutionType(item.suggestion),
  title: `${item.sectionTitle}：${item.suggestion}`.replace(/[。.]$/, ''),
  description: item.problem ? `针对问题：${item.problem}` : '',
  priority: order === 1 ? 'high' : 'medium',
  order,
});

const parseAiStageReport = (value: string): AiStageReport => {
  const parsed = extractJsonObject(value);
  if (!parsed) {
    // 解析失败时，尝试从原始文本中提取可读内容
    const cleanText = value
      .replace(/```[\s\S]*?```/g, '')  // 移除代码块
      .replace(/^\s*[\n\r]+/gm, '')     // 移除空行
      .trim();

    // 尝试从原始文本中提取各个字段（处理截断的JSON）
    const extractField = (field: string): string => {
      const regex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
      const match = cleanText.match(regex);
      return match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '';
    };

    const extractArray = (field: string): string[] => {
      const regex = new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`, 's');
      const match = cleanText.match(regex);
      if (!match) return [];
      try {
        return JSON.parse(`[${match[1]}]`);
      } catch {
        return match[1].split(',')
          .map(s => s.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      }
    };

    return {
      rawText: value,
      reportTitle: extractField('reportTitle'),
      reportSummary: extractField('reportSummary'),
      templateFit: extractArray('templateFit'),
      writingStyleNotes: extractArray('writingStyleNotes'),
      writingFramework: extractArray('writingFramework'),
      writingDirection: extractArray('writingDirection'),
      materialPlan: extractArray('materialPlan'),
      draftPlan: extractArray('draftPlan'),
      humanTasks: extractArray('humanTasks'),
      aiTasks: extractArray('aiTasks'),
      sectionAdvice: extractSectionAdviceFromRaw(cleanText),
    };
  }

  // 从 parsed 中提取 reportSummary，如果是对象则取其摘要字段
  let reportSummary = '';
  if (typeof parsed.reportSummary === 'string') {
    reportSummary = parsed.reportSummary;
  } else if (typeof parsed.summary === 'string') {
    reportSummary = parsed.summary;
  } else if (parsed.reportSummary && typeof parsed.reportSummary === 'object') {
    // 如果 reportSummary 是对象，尝试提取文本
    reportSummary = parsed.reportSummary.text || parsed.reportSummary.content || JSON.stringify(parsed.reportSummary);
  }

  const parsedSectionAdvice = normalizeSectionAdvice(parsed.sectionAdvice || parsed.chapterAdvice || parsed.sectionPlans || parsed.sections);

  return {
    reportTitle: String(parsed.reportTitle || parsed.title || '').trim(),
    reportSummary: String(reportSummary).trim(),
    qualityAssessment: normalizeStringList(parsed.qualityAssessment),
    templateFit: normalizeStringList(parsed.templateFit),
    writingStyleNotes: normalizeStringList(parsed.writingStyleNotes),
    writingFramework: normalizeStringList(parsed.writingFramework || parsed.framework || parsed.outline),
    writingDirection: normalizeStringList(parsed.writingDirection || parsed.direction || parsed.writingFocus),
    materialPlan: normalizeStringList(parsed.materialPlan || parsed.materials || parsed.referenceUse),
    draftPlan: normalizeStringList(parsed.draftPlan || parsed.draftingPlan || parsed.structurePlan),
    contentGaps: normalizeStringList(parsed.contentGaps || parsed.contentIssues || parsed.gaps),
    optimizationFocus: normalizeStringList(parsed.optimizationFocus || parsed.optimizationSuggestions || parsed.revisionFocus),
    risks: normalizeStringList(parsed.risks),
    humanTasks: normalizeStringList(parsed.humanTasks),
    aiTasks: normalizeStringList(parsed.aiTasks),
    workflowPlan: normalizeWorkflowPlan(parsed.workflowPlan || parsed.workflow || parsed.orderedTasks),
    sectionAdvice: parsedSectionAdvice.length ? parsedSectionAdvice : extractSectionAdviceFromRaw(value),
    rawText: value,
  };
};

const TaskPlanner: React.FC<{ onBack?: () => void; focus?: import('../../../shared/types').WorkbenchFocus; hideHeader?: boolean }> = ({ onBack, focus, hideHeader = false }) => {
  const {
    currentProject,
    currentStageName,
    versions,
    pendingReportDocId,
    pendingReportDocOnly,
    setCurrentStageName,
    setPendingReportDocId,
    setPendingReportDocOnly,
  } = useProjectStore();
  const { projectDocs, loadProjectDocs, updateProjectDoc } = useProjectDocStore();
  const { customStages } = useSettingsStore();
  const { tasks, loadTasks, addTask, deleteTask } = useTaskStore();
  const { templates, reviews, loadTemplates, loadReviews } = useTemplateStore();
  const { stageMemories, referenceMaterials, loadKnowledge } = useKnowledgeStore();
  const [selectedStageName, setSelectedStageName] = useState<string>('');
  const [selectedReportDocId, setSelectedReportDocId] = useState<string>('');
  const [focusedReportDocId, setFocusedReportDocId] = useState<string>('');
  const [isGeneratingAiReport, setIsGeneratingAiReport] = useState(false);
  const [refreshingAnalysisKey, setRefreshingAnalysisKey] = useState('');
  const [aiStageReport, setAiStageReport] = useState<AiStageReport | null>(null);
  const [aiStageReportSourceDocId, setAiStageReportSourceDocId] = useState('');
  const [selectedAiReportVersionId, setSelectedAiReportVersionId] = useState<string>('synthesis');
  const [isRefreshingDocStatus, setIsRefreshingDocStatus] = useState(false);
  const [workflowDraftItems, setWorkflowDraftItems] = useState<WorkflowDraftItem[]>([]);
  const [sectionAdviceDraftItems, setSectionAdviceDraftItems] = useState<SectionAdviceDraftItem[]>([]);
  const [hydratedWorkflowDraftKey, setHydratedWorkflowDraftKey] = useState('');

  useEffect(() => {
    loadTasks();
    loadProjectDocs();
    loadTemplates();
    loadReviews();
    loadKnowledge();
  }, []);

  const allStages = getAllStages(customStages);
  const projectVersions = currentProject ? versions.filter((v) => v.projectId === currentProject.id) : [];
  const projectDocsList = currentProject ? projectDocs.filter((d) => d.projectId === currentProject.id) : [];

  // 从项目侧边窗进入报告时，只改变当前选中版本和阶段，不缩小阶段版本列表。
  const projectTasks = currentProject
    ? tasks
      .filter((t) => t.projectId === currentProject.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const projectReviews = currentProject
    ? reviews
      .filter((r) => r.projectId === currentProject.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const stageSegments = useMemo(
    () => currentProject ? buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages) : [],
    [currentProject, projectDocsList, templates, projectVersions, allStages]
  );
  const stageDocumentsByName = useMemo(() => {
    const names = new Set<string>();
    stageSegments.forEach(segment => names.add(segment.stage));
    projectDocsList.forEach(doc => {
      const template = findReplacementTemplateForDoc(doc, templates, allStages);
      names.add(template?.category || detectTimelineStage(allStages, doc.name, doc.sourceFilePath));
    });
    return new Map([...names].map(stageName => {
      const sourceIds = new Set(
        stageSegments
          .filter(segment => segment.stage === stageName)
          .flatMap(segment => segment.sourceDocIds),
      );
      const documents = projectDocsList
        .filter(doc => {
          if (sourceIds.has(doc.id)) return true;
          const template = findReplacementTemplateForDoc(doc, templates, allStages);
          const detectedStage = template?.category || detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
          return detectedStage === stageName;
        })
        .sort((a, b) => new Date(getDocCreatedAt(a)).getTime() - new Date(getDocCreatedAt(b)).getTime());
      return [stageName, documents] as const;
    }));
  }, [allStages, projectDocsList, stageSegments, templates]);

  const stageOptions = useMemo(() => [...stageDocumentsByName.entries()].map(([name, documents]) => ({
    value: name,
    label: `${name} · ${documents.length} 个文件`,
    count: documents.length,
  })), [stageDocumentsByName]);

  const pendingFocusedDoc = useMemo(() => {
    const targetId = pendingReportDocId || focusedReportDocId || selectedReportDocId || '';
    return targetId ? projectDocsList.find(doc => doc.id === targetId) : undefined;
  }, [focusedReportDocId, pendingReportDocId, projectDocsList, selectedReportDocId]);

  const pendingFocusedStage = useMemo(() => {
    if (!pendingFocusedDoc) return '';
    const template = findReplacementTemplateForDoc(pendingFocusedDoc, templates, allStages);
    return template?.category || detectTimelineStage(allStages, pendingFocusedDoc.name, pendingFocusedDoc.sourceFilePath);
  }, [allStages, pendingFocusedDoc, templates]);

  const lockedFocusedStage = (pendingReportDocId || focusedReportDocId) && pendingFocusedStage
    ? pendingFocusedStage
    : '';
  const selectedStage =
    lockedFocusedStage ||
    selectedStageName ||
    pendingFocusedStage ||
    currentStageName ||
    stageOptions[0]?.value ||
    '';

  const reportStageMemoryCandidates = useMemo(
    () => stageMemories
      .filter(item => normalizeKnowledgeStageNameForPrompt(item.stageName) === normalizeKnowledgeStageNameForPrompt(selectedStage))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()),
    [stageMemories, selectedStage],
  );
  const reportReferenceMaterials = useMemo(
    () => currentProject ? referenceMaterials.filter(item => item.projectId === currentProject.id) : [],
    [currentProject?.id, referenceMaterials],
  );
  const stageDocs = selectedStage ? stageDocumentsByName.get(selectedStage) || [] : [];

  useEffect(() => {
    if (!currentProject) return;

    const stageExists = (stageName: string) => stageOptions.some(option => option.value === stageName);
    const firstStage = stageOptions[0]?.value || '';
    // 手动切换阶段后，不能再被旧文档的自动识别结果覆盖。
    // 只有仍在处理“指定报告文档跳转”时，才允许该文档锁定当前阶段。
    const hasFocusedReport = Boolean(pendingReportDocId || focusedReportDocId);
    const preferredStage = hasFocusedReport
      ? pendingFocusedStage
      : (selectedStageName || currentStageName);
    const nextStage = preferredStage && stageExists(preferredStage) ? preferredStage : firstStage;

    if (nextStage && selectedStageName !== nextStage) {
      setSelectedStageName(nextStage);
    }
    if (nextStage && currentStageName !== nextStage) {
      setCurrentStageName(nextStage);
    }
    if (!nextStage && selectedStageName) {
      setSelectedStageName('');
    }
  }, [currentProject?.id, currentStageName, focusedReportDocId, pendingFocusedStage, pendingReportDocId, selectedStageName, stageOptions, setCurrentStageName]);

  useEffect(() => {
    if (!pendingReportDocId) return;

    const targetDoc = projectDocsList.find(doc => doc.id === pendingReportDocId);
    if (!targetDoc) return;
    if (currentProject && targetDoc.projectId !== currentProject.id) return;

    setFocusedReportDocId(pendingReportDocId);
    setSelectedReportDocId(pendingReportDocId);
    setAiStageReport(null);
    setAiStageReportSourceDocId('');
    setWorkflowDraftItems([]);
    setSectionAdviceDraftItems([]);

    const targetStage = targetDoc
      ? (findReplacementTemplateForDoc(targetDoc, templates, allStages)?.category ||
        detectTimelineStage(allStages, targetDoc.name, targetDoc.sourceFilePath))
      : '';
    if (targetStage) {
      setSelectedStageName(targetStage);
      setCurrentStageName(targetStage);
    }

    setPendingReportDocId(null);
    setPendingReportDocOnly(false);
  }, [
    allStages,
    currentProject,
    pendingReportDocId,
    pendingReportDocOnly,
    projectDocsList,
    setCurrentStageName,
    setPendingReportDocId,
    setPendingReportDocOnly,
    templates,
  ]);

  useEffect(() => {
    if (pendingReportDocId) return;

    if (focusedReportDocId) {
      if (stageDocs.some(doc => doc.id === focusedReportDocId)) {
        if (selectedReportDocId !== focusedReportDocId) {
          setSelectedReportDocId(focusedReportDocId);
        }
        setFocusedReportDocId('');
      }
      return;
    }

    const latestDocId = stageDocs[stageDocs.length - 1]?.id || '';
    if (latestDocId && !stageDocs.some(doc => doc.id === selectedReportDocId)) {
      setSelectedReportDocId(latestDocId);
    }
    if (!latestDocId && selectedReportDocId) {
      setSelectedReportDocId('');
    }
  }, [focusedReportDocId, pendingReportDocId, selectedReportDocId, stageDocs]);

  const selectedReportDoc: ProjectDocument | undefined = stageDocs.find(doc => doc.id === selectedReportDocId) || stageDocs[0];
  const selectedStageVersionIndex = selectedReportDoc ? stageDocs.findIndex(doc => doc.id === selectedReportDoc.id) : -1;
  const selectedDocTemplate = selectedReportDoc
    ? findReplacementTemplateForDoc(selectedReportDoc, templates, allStages, selectedStage)
    : undefined;
  const selectedDocVersion = selectedReportDoc?.versionId
    ? projectVersions.find(version => version.id === selectedReportDoc.versionId)
    : undefined;

  const handlePickStageDocument = async () => {
    if (!currentProject || !stageDocs.length) return;
    const pathForDoc = (doc: ProjectDocument) => doc.sourceFilePath || projectVersions.find(version => version.id === doc.versionId)?.filePath || '';
    const selected = await pickProjectFiles({
      projectId: currentProject.id,
      title: `${selectedStage || '当前阶段'} · 选择报告文档`,
      selectedPaths: selectedReportDoc ? [pathForDoc(selectedReportDoc)].filter(Boolean) : [],
      stageName: selectedStage,
    });
    const selectedPath = selected[0]?.path;
    const selectedDoc = stageDocs.find(doc => pathForDoc(doc) === selectedPath);
    if (selectedDoc) setSelectedReportDocId(selectedDoc.id);
  };
  const selectedDocReviews = selectedReportDoc
    ? projectReviews.filter(review =>
      review.versionId === selectedReportDoc.versionId ||
      (review.templateId === selectedReportDoc.templateId && review.projectId === selectedReportDoc.projectId)
    )
    : [];
  const latestDocReview = selectedDocReviews[0];
  const latestReviewIssues = Array.isArray(latestDocReview?.issues) ? latestDocReview.issues : [];

  useEffect(() => {
    if (!selectedReportDoc || !selectedDocTemplate) return;
    if (selectedReportDoc.templateId === selectedDocTemplate.id) return;
    updateProjectDoc(selectedReportDoc.id, { templateId: selectedDocTemplate.id });
  }, [selectedReportDoc?.id, selectedReportDoc?.templateId, selectedDocTemplate?.id]);
  const savedSelectedSections = Array.isArray(selectedReportDoc?.sections) ? selectedReportDoc.sections : [];
  const selectedDocContent = selectedDocVersion?.content || '';
  const hasSavedCurrentDocumentStructure = savedSelectedSections.length > 0 && savedSelectedSections.every(section =>
    String(section.nodeId || '').startsWith('document-heading:')
  );
  const currentDocumentSections = useMemo(
    () => extractCurrentDocumentSections(selectedDocContent),
    [selectedDocContent]
  );
  const selectedSections = currentDocumentSections.length > 0
    ? currentDocumentSections
    : hasSavedCurrentDocumentStructure ? savedSelectedSections : [];
  const hasCurrentDocumentStructure = selectedSections.length > 0 && selectedSections.every(section =>
    String(section.nodeId || '').startsWith('document-heading:')
  );
  const selectedAnalysisHasIncompleteSections = selectedSections.some(section =>
    section.status === 'missing' || section.status === 'partial'
  );
  const canRefreshSelectedAnalysisFromFile = Boolean(selectedReportDoc?.sourceFilePath || selectedDocVersion?.filePath);
  const isSelectedAnalysisStale = isSectionAnalysisStaleForTemplate(selectedReportDoc, selectedDocTemplate, savedSelectedSections);
  const isSelectedAnalysisLikelyFalseMissing = isLikelyFalseMissingSectionAnalysis(savedSelectedSections, selectedDocContent);
  const sourceChangedAfterAnalysis = Boolean(
    selectedReportDoc?.sourceFileModifiedAt &&
    (!selectedReportDoc.analyzedAt || new Date(selectedReportDoc.sourceFileModifiedAt).getTime() > new Date(selectedReportDoc.analyzedAt).getTime())
  );
  const shouldRefreshSelectedAnalysis =
    !hasCurrentDocumentStructure ||
    sourceChangedAfterAnalysis ||
    isSelectedAnalysisLikelyFalseMissing;

  useEffect(() => {
    if (!selectedReportDoc || !selectedDocTemplate || !shouldRefreshSelectedAnalysis) return;
    const refreshKey = [
      selectedReportDoc.id,
      selectedDocTemplate.id,
      selectedDocTemplate.updatedAt || '',
      selectedDocVersion?.id || '',
      selectedReportDoc.sourceFileModifiedAt || '',
      isSelectedAnalysisLikelyFalseMissing ? 'false-missing-v2' : '',
      selectedAnalysisHasIncompleteSections ? 'length-rule-v2' : '',
    ].join('|');
    if (refreshingAnalysisKey === refreshKey) return;

    let cancelled = false;
    setRefreshingAnalysisKey(refreshKey);
    const run = async () => {
      let content = selectedDocVersion?.content?.trim() || '';
      if (!content) {
        const candidatePath = selectedReportDoc.sourceFilePath || selectedDocVersion?.filePath;
        if (candidatePath) {
          try {
            const parsed = await window.electronAPI.parseDocument(candidatePath);
            if (parsed.success && parsed.content?.trim()) {
              content = parsed.content.trim();
            }
          } catch (error) {
            console.warn('Failed to parse document for stale section refresh:', error);
          }
        }
      }
      if (cancelled || !content) return;

      try {
        const localSections = extractCurrentDocumentSections(content);
        let sections = localSections;
        let overallProgress = localSections.length
          ? Math.round(localSections.reduce((sum, section) => sum + (section.status === 'completed' ? 1 : section.status === 'partial' ? 0.5 : 0), 0) / localSections.length * 100)
          : 0;

        if (!sections.length) {
          const result = await window.electronAPI.analyzeProjectDoc({
            content,
            template: selectedDocTemplate,
            useAI: false,
            actualStructure: true,
          });
          if (result.success) {
            sections = result.sections || [];
            overallProgress = result.overallProgress ?? 0;
          }
        }

        if (!cancelled) {
          await updateProjectDoc(selectedReportDoc.id, {
            templateId: selectedDocTemplate.id,
            sections,
            overallProgress,
            analyzedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.warn('Failed to refresh current document section analysis:', error);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    shouldRefreshSelectedAnalysis,
    isSelectedAnalysisLikelyFalseMissing,
    refreshingAnalysisKey,
    selectedDocTemplate?.id,
    selectedDocTemplate?.updatedAt,
    selectedDocContent,
    selectedDocVersion?.filePath,
    selectedDocVersion?.id,
    selectedReportDoc?.analyzedAt,
    selectedReportDoc?.id,
    selectedReportDoc?.sourceFileModifiedAt,
    selectedReportDoc?.sourceFilePath,
  ]);
  const stageDocIdSet = useMemo(() => new Set(stageDocs.map(doc => doc.id)), [stageDocs]);
  const scopedProjectTasks = useMemo(() => {
    if (!selectedStage) return projectTasks;
    return projectTasks.filter(task =>
      task.stageName === selectedStage ||
      Boolean(task.relatedDocId && stageDocIdSet.has(task.relatedDocId)) ||
      Boolean(task.workflowName && task.workflowName.includes(selectedStage))
    );
  }, [projectTasks, selectedStage, stageDocIdSet]);
  const selectedDocTasks = selectedReportDoc
    ? projectTasks.filter(task =>
      task.relatedDocId === selectedReportDoc.id ||
      (task.stageName === selectedStage && task.status !== 'completed')
    )
    : [];
  const openSelectedDocTasks = selectedDocTasks.filter(task => task.status !== 'completed');
  const missingSections = selectedSections.filter(section => section.status === 'missing');
  const partialSections = selectedSections.filter(section => section.status === 'partial');
  const completedSections = selectedSections.filter(section => section.status === 'completed');
  const incompleteSections = [...missingSections, ...partialSections];
  const totalSections = selectedSections.length;
  const completionScore = completedSections.length + partialSections.length * 0.5;
  const stageProgressPercent = totalSections ? Math.round(completionScore / totalSections * 100) : (selectedReportDoc?.overallProgress ?? 0);
  const completionFormulaText = totalSections
    ? `完成度 = (已完成 ${completedSections.length} + 部分完成 ${partialSections.length} × 0.5) / 当前文档章节 ${totalSections} = ${stageProgressPercent}%`
    : '当前文档暂未识别到章节，无法计算完成度';

  useEffect(() => {
    // 尝试从 ProjectDocument 恢复已保存的 AI 报告
    if (selectedReportDoc?.aiReport) {
      try {
        let saved = JSON.parse(selectedReportDoc.aiReport);
        // 修复：如果 reportSummary 包含完整 JSON 字符串，则解析并合并所有字段
        if (saved.reportSummary && typeof saved.reportSummary === 'string') {
          const trimmed = saved.reportSummary.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const innerParsed = JSON.parse(trimmed);
              // 合并内层 JSON 的所有字段到外层
              saved = { ...innerParsed, rawText: saved.rawText || trimmed };
            } catch {}
          }
        }
        const restored = (!saved.sectionAdvice?.length && saved.rawText)
          ? { ...saved, ...parseAiStageReport(saved.rawText), rawText: saved.rawText }
          : saved;
        setAiStageReport(restored);
        setAiStageReportSourceDocId(selectedReportDoc.id);
        setSelectedAiReportVersionId('synthesis');
        setWorkflowDraftItems([]);
      } catch {
        setAiStageReport(null);
        setAiStageReportSourceDocId('');
        setWorkflowDraftItems([]);
      }
    } else {
      setAiStageReport(null);
      setAiStageReportSourceDocId('');
      setSelectedAiReportVersionId('synthesis');
      setWorkflowDraftItems([]);
    }
    setSectionAdviceDraftItems([]);
  }, [selectedReportDoc?.id, selectedStage, selectedReportDoc?.aiReport]);

  const topLevelTemplateTitles = useMemo(() => {
    const nodes = Array.isArray((selectedDocTemplate as any)?.nodes) ? (selectedDocTemplate as any).nodes : [];
    return nodes
      .map((node: any) => String(node.title || '').trim())
      .filter(Boolean);
  }, [selectedDocTemplate]);

  const isGlobalStructureAdviceText = (value: string) => {
    const raw = String(value || '');
    const normalized = normalizeDocumentContentForSectionCompare(raw);
    // 过滤掉包含多个章节标题的结构建议
    const chapterHits = [
      '总体目标',
      '研究内容',
      '预期成果',
      '考核指标',
      '成果应用与转化',
      '项目实施期限',
      '支持经费限额',
    ].filter(title => normalized.includes(normalizeDocumentContentForSectionCompare(title))).length;
    if (chapterHits >= 4 && /(七章|七章节|章节结构|硬性规定|硬性要求|遵循模板|模板规定|七段式)/.test(raw)) return true;
    // 过滤掉包含箭头的结构流程建议
    if (/->|→|-->|—>/.test(raw) && chapterHits >= 2) return true;
    // 过滤掉以"严格遵循"开头的结构建议
    if (/严格遵循/.test(raw) && chapterHits >= 2) return true;
    return false;
  };

  const uniqueReadableItems = (items: string[] = []) => {
    const seen = new Set<string>();
    return items
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .filter(item => {
        const key = normalizeDocumentContentForSectionCompare(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const cleanSectionAdviceItems = (items: AiSectionAdvice[]) => items
    .map(section => {
      const problems = uniqueReadableItems(section.problems || []);
      const suggestions = uniqueReadableItems(section.suggestions || [])
        .filter(item => !isGlobalStructureAdviceText(item));
      if (!suggestions.length && problems.length) {
        suggestions.push('围绕该章节补齐事实、数据、依据和表达口径，再由 AI 做扩写、结构优化或润色。');
      }
      return { ...section, problems, suggestions };
    })
    .filter(section => (section.problems?.length || 0) > 0 || (section.suggestions?.length || 0) > 0);

  const displayAiStageReport = useMemo<AiStageReport | null>(() => {
    if (!aiStageReport) return null;
    if (selectedAiReportVersionId === 'synthesis') return aiStageReport;
    const variant = aiStageReport.parallelVersions?.find(item => item.id === selectedAiReportVersionId);
    if (!variant) return aiStageReport;
    if (!variant.ok) {
      return {
        reportTitle: `${variant.modelName} 输出失败`,
        reportSummary: variant.error || '该模型未返回可用内容',
        rawText: variant.error || variant.rawText,
      };
    }
    return {
      ...(variant.report || parseAiStageReport(variant.rawText)),
      reportTitle: (variant.report?.reportTitle || `${variant.modelName} ??`),
      rawText: variant.rawText,
    };
  }, [aiStageReport, selectedAiReportVersionId]);

  const sectionAdviceItems = useMemo<AiSectionAdvice[]>(() => {
    const currentDocumentTitles = selectedSections.map(section => section.title).filter(Boolean);
    const explicit = displayAiStageReport?.sectionAdvice || [];
    if (explicit.length > 0) {
      const cleanedExplicit = cleanSectionAdviceItems(explicit);
      if (!currentDocumentTitles.length) return cleanedExplicit;

      return currentDocumentTitles
        .map((title) => {
          const normalizedTitle = normalizeSectionTitleForCompare(title);
          const matchedAdvice = cleanedExplicit.find(section => {
            const normalizedAdvice = normalizeSectionTitleForCompare(section.title || '');
            return normalizedAdvice === normalizedTitle ||
              normalizedAdvice.includes(normalizedTitle) ||
              normalizedTitle.includes(normalizedAdvice);
          });
          if (matchedAdvice) return { ...matchedAdvice, title: cleanReportHeadingTitle(title) };

          const matchedSection = selectedSections.find(section => normalizeSectionTitleForCompare(section.title || '') === normalizedTitle);
          if (!matchedSection || matchedSection.status === 'completed') return null;
          const problems = matchedSection.status === 'missing'
            ? ['当前文档中未稳定提取到该章节正文。']
            : [`当前文档已识别到该章节，但内容仍偏薄或缺少支撑材料（约 ${matchedSection.wordCount || 0} 字）。`];
          const suggestions = ['围绕当前文档该章节补齐事实、数据、依据和表达口径，再由 AI 做扩写、结构优化或润色。'];
          return { title: cleanReportHeadingTitle(title), problems, suggestions };
        })
        .filter(Boolean) as AiSectionAdvice[];
    }

    const titles: string[] = currentDocumentTitles;
    const generalSuggestions: string[] = [
      ...(displayAiStageReport?.writingFramework || []),
      ...(displayAiStageReport?.writingDirection || []),
      ...(displayAiStageReport?.materialPlan || []),
      ...(displayAiStageReport?.draftPlan || []),
      ...(displayAiStageReport?.optimizationFocus || []),
    ];

    const usedSuggestions = new Set<string>(); // 跨章节去重

    return titles
      .map((title: string) => {
        const normalizedTitle = normalizeSectionTitleForCompare(title);
        const matchedSection = selectedSections.find(section => {
          const normalizedSection = normalizeSectionTitleForCompare(section.title || '');
          return normalizedSection === normalizedTitle ||
            normalizedSection.includes(normalizedTitle) ||
            normalizedTitle.includes(normalizedSection);
        });
        const problems: string[] = [];
        if (matchedSection?.status === 'missing') {
          problems.push('当前正文未稳定匹配到该一级标题下的有效内容。');
        } else if (matchedSection?.status === 'partial') {
          problems.push(`已识别到该章节，但内容仍偏薄或缺少支撑材料（约 ${matchedSection.wordCount || 0} 字）。`);
        } else if (!matchedSection && selectedSections.length > 0) {
          problems.push('当前章节分析中未找到清晰对应项，建议确认标题编号和模板结构是否一致。');
        }
        if (matchedSection?.aiComment) problems.push(matchedSection.aiComment);

        const suggestions = uniqueReadableItems(generalSuggestions)
          .filter((item: string) => {
            if (isGlobalStructureAdviceText(item)) return false;
            const normalizedItem = normalizeSectionTitleForCompare(item);
            if (!normalizedItem.includes(normalizedTitle) && !normalizedTitle.includes(normalizedItem.slice(0, Math.min(6, normalizedItem.length)))) return false;
            // 跨章节去重：已用过的建议不再显示
            if (usedSuggestions.has(normalizedItem)) return false;
            usedSuggestions.add(normalizedItem);
            return true;
          })
          .slice(0, 5);

        if (!suggestions.length && problems.length) {
          suggestions.push('按模板要求补齐该章节的核心事实、数据、依据和表达口径，再交给 AI 做扩写或润色。');
        }

        return { title: cleanReportHeadingTitle(title), problems, suggestions };
      })
      .filter(item => item.problems.length > 0 || item.suggestions.length > 0)
      .slice(0, 12);
  }, [displayAiStageReport, selectedSections]);

  const workflowDraftStorageKey = useMemo(() => {
    if (!currentProject || !selectedReportDoc || !aiStageReport || aiStageReportSourceDocId !== selectedReportDoc.id) return '';
    const reportRevision = selectedReportDoc.analyzedAt || selectedReportDoc.createdAt || 'unsaved';
    return `${currentProject.id}:${selectedReportDoc.id}:${reportRevision}:${selectedAiReportVersionId}`;
  }, [aiStageReport, aiStageReportSourceDocId, currentProject?.id, selectedAiReportVersionId, selectedReportDoc?.analyzedAt, selectedReportDoc?.createdAt, selectedReportDoc?.id]);

  useEffect(() => {
    if (!workflowDraftStorageKey) {
      setHydratedWorkflowDraftKey('');
      return;
    }
    const stored = loadStoredReportWorkflowDraft(workflowDraftStorageKey);
    if (stored) {
      setSectionAdviceDraftItems(stored.adviceItems);
      setWorkflowDraftItems(stored.workflowItems);
    } else {
      const drafts = createSectionAdviceDraftItems(sectionAdviceItems);
      setSectionAdviceDraftItems(drafts);
      setWorkflowDraftItems(
        drafts
          .filter(item => item.selected && item.suggestion.trim())
          .map((item, index) => createWorkflowItemFromAdvice(item, index + 1))
      );
    }
    setHydratedWorkflowDraftKey(workflowDraftStorageKey);
  }, [workflowDraftStorageKey]);

  useEffect(() => {
    if (!workflowDraftStorageKey || hydratedWorkflowDraftKey !== workflowDraftStorageKey) return undefined;
    const timer = window.setTimeout(() => {
      saveStoredReportWorkflowDraft(workflowDraftStorageKey, {
        adviceItems: sectionAdviceDraftItems,
        workflowItems: workflowDraftItems,
        updatedAt: new Date().toISOString(),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hydratedWorkflowDraftKey, sectionAdviceDraftItems, workflowDraftItems, workflowDraftStorageKey]);

  const nextActions = useMemo(() => {
    const actions: string[] = [];
    if (!selectedReportDoc) return ['先选择一个阶段文档，再生成下一步动作。'];

    const hasDraftContent = completedSections.length > 0 || partialSections.length > 0 || selectedReportDoc.overallProgress > 20;
    if (!hasDraftContent) {
      actions.push('AI依据模板要求和范文结构生成当前阶段文档初稿。');
      actions.push('人工补充项目数据、附件依据和不能由AI判断的关键口径。');
    }
    missingSections.slice(0, 3).forEach(section => {
      actions.push(`AI依据模板要求补写缺失章节「${section.title}」，并标注需要人工确认的数据。`);
    });
    partialSections.slice(0, 3).forEach(section => {
      actions.push(`AI对「${section.title}」进行扩写、结构优化和表达润色。`);
    });
    latestReviewIssues.slice(0, 4).forEach(issue => {
      actions.push(`AI按审查意见优化${issue.sectionTitle ? `「${issue.sectionTitle}」` : '当前文档'}：${issue.suggestion || issue.message}`);
    });
    if (hasDraftContent) {
      actions.push('AI依据模板要求和范文写法生成写作框架、章节展开方向和材料补充清单。');
      actions.push('人工根据写作框架补充事实、数据、附件依据和表达口径。');
    }
    actions.push('AI根据人工补充内容整理下一版提纲、段落安排和表达建议。');
    actions.push('人工在成稿后提交领导审核，领导返稿意见再进入审查或修订流程。');
    openSelectedDocTasks.slice(0, 3).forEach(task => {
      actions.push(`推进既有任务「${task.title}」。`);
    });
    return [...new Set(actions)].slice(0, 8);
  }, [
    completedSections.length,
    latestReviewIssues.length,
    missingSections.length,
    openSelectedDocTasks.length,
    partialSections.length,
    selectedReportDoc?.id,
    selectedReportDoc?.overallProgress,
  ]);

  const workflowReportLines = workflowDraftItems.length
    ? [...workflowDraftItems]
      .sort((a, b) => a.order - b.order)
      .filter(item => item.title.trim())
      .map(item => `${item.type === 'ai' ? 'AI' : '人工'}：${item.title.trim()}`)
    : nextActions;

  const reportText = useMemo(() => {
    if (!selectedReportDoc) return '请选择一个阶段文档后出具报告。';

    return [
      `阶段：${selectedStage || '未识别阶段'}`,
      `阶段版本：V${selectedStageVersionIndex + 1} / 共 ${stageDocs.length} 版`,
      `文档：${selectedReportDoc.name}`,
      selectedDocTemplate ? `模板：${selectedDocTemplate.name}` : '',
      `创建时间：${dayjs(getDocCreatedAt(selectedReportDoc)).format('YYYY-MM-DD HH:mm')}`,
      `完成度：${selectedReportDoc.overallProgress}%`,
      latestDocReview ? `最近审查：${latestDocReview.score} 分，${latestReviewIssues.length} 个问题` : '最近审查：暂无',
      '',
      '阶段文档状态：',
      `- 已完成章节：${completedSections.length}`,
      `- 部分完成章节：${partialSections.length}`,
      `- 缺失章节：${missingSections.length}`,
      `- 当前关联待办：${openSelectedDocTasks.length}`,
      `- 完成度计算：${completionFormulaText}`,
      '',
      '未完成项：',
      ...(incompleteSections.length
        ? incompleteSections.map(section => `- [${section.status === 'missing' ? '缺失' : '部分完成'}] ${section.title}：字数 ${section.wordCount}${section.aiComment ? `；说明：${section.aiComment}` : section.status === 'missing' ? '；说明：模板要求有该章节，但当前正文未匹配到对应标题或内容' : '；说明：已识别到章节，但内容仍需补充完善'}`)
        : ['- 暂无未完成章节']),
      '',
      '工作流草稿：',
      ...workflowReportLines.map(action => `- ${action}`),
    ].filter(Boolean).join('\n');
  }, [
    completedSections.length,
    completionFormulaText,
    latestDocReview,
    latestReviewIssues.length,
    missingSections.length,
    workflowReportLines,
    openSelectedDocTasks.length,
    partialSections.length,
    selectedDocTemplate,
    selectedReportDoc,
    selectedStage,
    selectedStageVersionIndex,
    stageDocs.length,
  ]);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const handleCreateReportTask = async () => {
    if (!selectedReportDoc) {
      message.warning('请先选择阶段文档');
      return;
    }

    const task: TaskItem = {
      id: Date.now().toString(),
      projectId: currentProject.id,
      title: `${selectedStage}阶段报告 V${selectedStageVersionIndex + 1}：${selectedReportDoc.name}`,
      description: reportText,
      type: 'manual',
      status: 'pending',
      priority: missingSections.length || latestReviewIssues.some(issue => issue.severity === 'error') ? 'high' : 'medium',
      source: 'report',
      relatedDocId: selectedReportDoc.id,
      stageName: selectedStage,
      createdAt: new Date().toISOString(),
    };
    await addTask(task);
    message.success('已生成阶段报告任务');
  };

  const loadTemplateExampleContent = async () => {
    const storedGuidance = extractTemplateGuidanceText(selectedDocTemplate);
    if (storedGuidance.exampleText) return storedGuidance.exampleText.slice(0, 6000);
    if (!selectedDocTemplate?.filePath) return '';
    try {
      const parsed = await window.electronAPI.parseDocument(selectedDocTemplate.filePath);
      if (parsed.success && parsed.content) return splitLoadedTemplateReference(parsed.content) || '';
    } catch {}
    try {
      const content = await window.electronAPI.readFile(selectedDocTemplate.filePath);
      return splitLoadedTemplateReference(content) || '';
    } catch {
      return '';
    }
  };

  const loadReportDocumentContent = async () => {
    const versionContent = selectedDocVersion?.content?.trim();
    if (versionContent) {
      return { content: versionContent, source: '版本库内容' };
    }

    const candidatePath = selectedReportDoc?.sourceFilePath || selectedDocVersion?.filePath;
    if (!candidatePath) {
      return { content: '', source: '未找到原始文件路径' };
    }

    try {
      const parsed = await window.electronAPI.parseDocument(candidatePath);
      if (parsed.success && parsed.content?.trim()) {
        return { content: parsed.content.trim(), source: `实时解析：${parsed.fileName || candidatePath}` };
      }
      return { content: '', source: parsed.error || '实时解析未提取到文本' };
    } catch (error: any) {
      return { content: '', source: error.message || '实时解析失败' };
    }
  };

  const refreshReportDocAnalysis = async (content: string) => {
    if (!selectedReportDoc || !selectedDocTemplate || !content.trim()) return null;

    try {
      let sections = extractCurrentDocumentSections(content);
      let overallProgress = sections.length
        ? Math.round(sections.reduce((sum, section) => sum + (section.status === 'completed' ? 1 : section.status === 'partial' ? 0.5 : 0), 0) / sections.length * 100)
        : 0;

      if (!sections.length) {
        const result = await window.electronAPI.analyzeProjectDoc({
          content,
          template: selectedDocTemplate,
          useAI: false,
          actualStructure: true,
        });
        if (!result.success) return null;
        sections = result.sections || [];
        overallProgress = result.overallProgress ?? selectedReportDoc.overallProgress;
      }

      const refreshed = { sections, overallProgress };
      await updateProjectDoc(selectedReportDoc.id, {
        ...refreshed,
        analyzedAt: new Date().toISOString(),
      });
      return refreshed;
    } catch (error) {
      console.warn('Failed to refresh report doc analysis:', error);
    }
    return null;
  };
  const handleRefreshReportDocStatus = async () => {
    if (!selectedReportDoc) {
      message.warning('请先选择阶段文档');
      return;
    }
    if (!selectedDocTemplate) {
      message.warning('当前文档未关联模板，无法获取文档状态');
      return;
    }

    setIsRefreshingDocStatus(true);
    try {
      const reportDocument = await loadReportDocumentContent();
      if (!reportDocument.content.trim()) {
        message.warning(`未能读取文档内容：${reportDocument.source}`);
        return;
      }
      const refreshed = await refreshReportDocAnalysis(reportDocument.content);
      if (!refreshed || refreshed.sections.length === 0) {
        message.warning('未识别到当前文档章节，请检查文档标题格式');
        return;
      }
      message.success(`已获取文档状态：识别到 ${refreshed.sections.length} 个章节`);
    } finally {
      setIsRefreshingDocStatus(false);
    }
  };
  const handleGenerateAiStageReport = async () => {
    if (!selectedReportDoc) {
      message.warning('请先选择阶段文档');
      return;
    }
    if (!selectedDocTemplate) {
      message.warning('当前文档未关联模板，且未能按阶段自动匹配到新模板，请在模板页确认模板的关联阶段');
      return;
    }

    setIsGeneratingAiReport(true);
    try {
      const isExampleTemplate = selectedDocTemplate.templateType === 'example';
      const templateGuidance = extractTemplateGuidanceText(selectedDocTemplate);
      const templateRequirementText = isExampleTemplate ? '' : templateGuidance.requirementText;
      const templateExample = await loadTemplateExampleContent();
      const templateNodes = flattenTemplateNodesForPrompt(selectedDocTemplate.nodes, 0, isExampleTemplate).join('\n');
      const formatRules = JSON.stringify(selectedDocTemplate.formatRules || {
        titleFontRequirement: selectedDocTemplate.titleFontRequirement,
        bodyFontRequirement: selectedDocTemplate.bodyFontRequirement,
      }, null, 2);
      const reviewIssues = latestReviewIssues.map(issue => (
        `- [${issue.severity}] ${issue.sectionTitle || ''} ${issue.message}${issue.suggestion ? `；建议：${issue.suggestion}` : ''}`
      )).join('\n') || '暂无审查Tab结果';
      const reportDocument = await loadReportDocumentContent();
      const effectiveSections = selectedSections;
      const effectiveProgress = stageProgressPercent;
      const sectionStatus = effectiveSections.map(section => (
        `- ${section.title}：${section.status}，字数 ${section.wordCount}${section.aiComment ? `，评语：${section.aiComment}` : ''}`
      )).join('\n');
      const documentContent = reportDocument.content || sectionStatus || selectedReportDoc.name;
      const stageMemoryContext = formatPromptKnowledgeItems(reportStageMemoryCandidates, 'memory');
      const referenceContext = formatPromptKnowledgeItems(reportReferenceMaterials, 'reference');

      const prompt = `你是阶段文档写作框架与方向规划助手。审查、评分、问题判定应交给审查Tab；你在这里只负责根据模板、范文/参考内容和当前正文，给出写作框架、章节展开方向、材料组织方式和下一步写作任务。

真实工作流：
1. 若当前正文为空或明显不成稿，先给出 AI 初稿框架：章节顺序、每章写什么、参考范文的结构如何迁移。
2. 若已有正文，给出下一版写作方向：哪些章节应展开什么内容、材料如何组织、哪些事实/数据/附件需要人工补齐。
3. 人工随后补充数据、附件、事实依据、项目口径和无法由 AI 判断的内容。
4. AI 可以继续基于人工补充内容生成提纲、扩写段落、润色表达或整理下一版草稿。
5. 成稿之后再提交审查Tab或领导审核；不要在本输出里替代审查Tab做质量审查。

要求：
1. 必须围绕当前阶段和当前文档，不要写整个项目总报告。
2. 模板硬性要求/填写说明只能来自“模板硬性要求/填写说明”和章节写作要求；不要把范文中的事实、案例、金额、时间、项目背景当作当前文档必须满足的要求。
3. 如果模板范文/参考写法存在，只提取它的写作结构、表达方法、组织方式和格式特征，并转化为当前文档的写作框架；不得照搬范文事实，不得把范文内容放入 templateFit。
4. 模板格式要求一旦存在就是硬性要求；即使当前是范文模板，也必须把标题/正文/图表格式作为严格约束，不得按“参考方向”放宽。
5. 下一步任务必须针对“写作产出”：框架、提纲、章节展开、材料清单、初稿/扩写/润色，不输出审查结论、质量评分或风险判定。
5. 输出必须是 JSON 对象，不要输出 Markdown，不要包裹代码块。
6. sectionAdvice 是生成工作流草稿的唯一建议来源；每条 suggestion 都必须是可独立选择和执行的修改步骤。
7. 需要人工补资料、确认数据/口径或审核时，在 suggestion 中明确写出“人工”；可由 AI 完成的扩写、润色、结构调整则写清具体产出。
8. 每条建议要具体、可执行，避免空泛建议，不要再额外输出另一套任务清单或工作流。
9. 审查Tab已有结果只能作为背景参考，不能在这里重新做审查或下结论。
10. 前台主要展示 sectionAdvice。sectionAdvice 的 title 必须优先使用“当前文档章节状态”中的当前文档一级标题；不要使用范文标题替代当前文档标题。${isExampleTemplate ? '当前是范文模板：范文只用于写作方向，不判定范文标题缺失。' : '当前是直接套用模板：可参考模板要求判断问题，但展示标题仍使用当前文档标题。'}
11. ${isExampleTemplate ? '范文模板只参考“整体概述 -> 技术层面由浅入深展开 -> 试验/应用 -> 总结展望”等路径，不把范文事实或标题当硬约束。' : '直接套用模板的全局结构约束不要重复写入每个章节的 suggestions；只有缺少标题、顺序错误或结构错乱时才指出。'}

JSON 字段（必须先完整输出 sectionAdvice，再输出其余数组，避免长响应截断时丢失前台核心内容）：
{
  "reportTitle": "标题",
  "reportSummary": "阶段文档写作框架与方向摘要，300-600字",
  "sectionAdvice": [{"title": "必须使用当前文档章节状态中的当前文档一级标题", "problems": ["结合该章现有正文指出具体问题，不得复制其他章节的通用句"], "suggestions": ["该章节下一步怎么写、补什么、AI如何改，必须可执行"]}],
  "templateFit": ["模板要求转化成的写作约束"],
  "writingStyleNotes": ["从范文/参考内容提取的结构、方法和表达特征"],
  "writingFramework": ["供AI内部参考的章节框架，不作为前台主要展示"],
  "writingDirection": ["供AI内部参考的写作方向，不作为前台主要展示"],
  "materialPlan": ["需要人工准备或确认的材料、数据、附件、口径"],
  "draftPlan": ["AI可执行的初稿、扩写、润色、整理任务"]
}

项目信息：
项目：${currentProject.name}
阶段：${selectedStage}
阶段版本：V${selectedStageVersionIndex + 1} / ${stageDocs.length}
当前文档：${selectedReportDoc.name}
创建时间：${dayjs(getDocCreatedAt(selectedReportDoc)).format('YYYY-MM-DD HH:mm')}
完成度：${effectiveProgress}%

模板信息：
模板名称：${selectedDocTemplate.name}
模板分类：${selectedDocTemplate.category}
模板说明：${selectedDocTemplate.description || '无'}

模板硬性要求/填写说明：
${templateRequirementText || '无'}

${isExampleTemplate ? '范文参考方向与结构路径（标题非固定）' : '模板章节结构与章节写作要求'}：
${templateNodes || '无'}

模板格式要求（硬性规则，范文模板也必须严格执行）：
${formatRules}

模板范文/参考写法（只用于提取结构、方法、表达风格，不作为当前文档硬性要求）：
${templateExample || '无'}

当前文档章节状态：
${sectionStatus || '暂无章节分析'}

当前文档内容来源：
${reportDocument.source}；提取字符数：${reportDocument.content.length}

审查Tab已有结果（仅作背景，不重新审查）：
${reviewIssues}

当前阶段记忆（只作为当前项目事实和既有口径参考，不得覆盖用户本次要求）：
${stageMemoryContext}

项目参考资料（用于补充事实、数据、附件依据和表达口径；无法确认时必须明确标注需要人工核实）：
${referenceContext}

当前文档内容摘录：
${documentContent.slice(0, 9000)}`;

      // 运行时只使用设置页中可编辑的场景提示词；上面的旧文案仅保留为迁移期源码参考。
      const configuredPrompt = await composePromptAsync('workflowPlanning', {
        projectName: currentProject.name,
        stage: selectedStage,
        stageVersion: `V${selectedStageVersionIndex + 1} / ${stageDocs.length}`,
        docName: selectedReportDoc.name,
        createdAt: dayjs(getDocCreatedAt(selectedReportDoc)).format('YYYY-MM-DD HH:mm'),
        progress: String(effectiveProgress),
        templateName: selectedDocTemplate.name,
        templateCategory: selectedDocTemplate.category,
        templateDescription: selectedDocTemplate.description || '无',
        templateMode: isExampleTemplate ? '范文模板' : '直接套用模板',
        templateRequirements: templateRequirementText || '无',
        templateNodes: templateNodes || '无',
        formatRules,
        templateExample: templateExample || '无',
        sectionStatus: sectionStatus || '暂无章节分析',
        reviewIssues,
        stageMemory: stageMemoryContext,
        reference: referenceContext,
        content: documentContent.slice(0, 9000),
      });

      const aiConfig = requireIpcObject<AIConfig>(await window.electronAPI.loadAIConfig(), '加载 AI 配置失败');
      const useParallelVersions = aiConfig?.multiModelMode === 'parallel' && (aiConfig.parallelModelIds?.length || 0) > 1;
      let response = '';
      let parallelVersions: AiReportVariant[] = [];
      let synthesisModelName: string | undefined;
      if (useParallelVersions && window.electronAPI.callAIParallelDetails) {
        const details = await useAIJobStore.getState().runAIJob<{ synthesis: string; synthesisModelName?: string; variants: Array<{ modelId: string; modelName: string; ok: boolean; output: string; error?: string }> }>(
          {
            scene: 'workflowPlanning',
            title: '生成 AI 阶段报告',
            projectId: currentProject.id,
            docId: selectedReportDoc.id,
            resultPreview: (value) => value.synthesis,
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAIParallelDetails({ prompt: configuredPrompt, config: aiConfig, modelIds: aiConfig.parallelModelIds, modelId: aiConfig.activeModelId });
            throwIfCancelled();
            setProgress(85);
            return value;
          },
        );
        response = details.synthesis;
        synthesisModelName = details.synthesisModelName;
        parallelVersions = details.variants.map((variant, index) => ({
          id: `model-${index}-${variant.modelId}`,
          modelId: variant.modelId,
          modelName: variant.modelName,
          ok: variant.ok,
          rawText: variant.output || variant.error || '',
          error: variant.error,
          report: variant.ok ? parseAiStageReport(variant.output) : undefined,
        }));
      } else {
        response = await useAIJobStore.getState().runAIJob<string>(
          {
            scene: 'workflowPlanning',
            title: '生成 AI 阶段报告',
            projectId: currentProject.id,
            docId: selectedReportDoc.id,
            resultPreview: (value) => value,
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAI({ prompt: configuredPrompt });
            throwIfCancelled();
            setProgress(85);
            return String(value || '');
          },
        );
      }
      const parsed = { ...parseAiStageReport(response), parallelVersions, synthesisModelName };
      setAiStageReport(parsed);
      setAiStageReportSourceDocId(selectedReportDoc.id);
      setSelectedAiReportVersionId('synthesis');
      setWorkflowDraftItems([]);
      // 持久化 AI 报告到 ProjectDocument（从 store 取最新对象，避免闭包引用旧值）
      const latestDoc = useProjectDocStore.getState().projectDocs.find(d => d.id === selectedReportDoc?.id);
      if (latestDoc) {
        await updateProjectDoc(latestDoc.id, { aiReport: JSON.stringify(parsed), analyzedAt: new Date().toISOString() });
      }
      message.success(`AI 阶段报告已生成，正文提取 ${reportDocument.content.length} 字，已整理为可编辑工作流草稿`);
    } catch (error: any) {
      message.error(`AI 阶段报告生成失败：${error.message}`);
    } finally {
      setIsGeneratingAiReport(false);
    }
  };

  const normalizeDraftOrders = (items: WorkflowDraftItem[]) => items
    .map((item, index) => ({ ...item, order: index + 1 }));

  const handleUpdateSectionAdviceDraftItem = (id: string, updates: Partial<SectionAdviceDraftItem>) => {
    const current = sectionAdviceDraftItems.find(item => item.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setSectionAdviceDraftItems(items => items.map(item => item.id === id ? next : item));
    setWorkflowDraftItems(items => {
      const existing = items.find(item => item.sourceAdviceId === id);
      if (!next.selected || !next.suggestion.trim()) {
        return normalizeDraftOrders(items.filter(item => item.sourceAdviceId !== id));
      }
      if (existing) {
        return items.map(item => item.sourceAdviceId === id ? {
          ...item,
          title: `${next.sectionTitle}：${next.suggestion}`.replace(/[。.]$/, ''),
          description: next.problem ? `针对问题：${next.problem}` : '',
        } : item);
      }
      return normalizeDraftOrders([
        ...[...items].sort((a, b) => a.order - b.order),
        createWorkflowItemFromAdvice(next, items.length + 1),
      ]);
    });
  };

  const handleToggleAllSectionAdvice = (selected: boolean) => {
    const nextAdviceItems = sectionAdviceDraftItems.map(item => ({ ...item, selected }));
    setSectionAdviceDraftItems(nextAdviceItems);
    setWorkflowDraftItems(items => {
      const manuallyAddedItems = items.filter(item => !item.sourceAdviceId);
      const selectedAdviceItems = selected
        ? nextAdviceItems.filter(item => item.suggestion.trim())
        : [];
      return normalizeDraftOrders([
        ...selectedAdviceItems.map((item, index) => createWorkflowItemFromAdvice(item, index + 1)),
        ...manuallyAddedItems.sort((a, b) => a.order - b.order),
      ]);
    });
  };

  const handleAddWorkflowDraftItem = (type: 'manual' | 'ai' = 'manual') => {
    setWorkflowDraftItems(items => normalizeDraftOrders([
      ...[...items].sort((a, b) => a.order - b.order),
      {
        id: `draft-${Date.now()}`,
        type,
        title: type === 'ai' ? 'AI生成写作框架和章节方向' : '人工按写作框架补充资料并确认口径',
        description: '',
        priority: 'medium',
        order: items.length + 1,
      },
    ]));
  };

  const handleUpdateWorkflowDraftItem = (id: string, updates: Partial<WorkflowDraftItem>) => {
    setWorkflowDraftItems(items => items.map(item => (item.id === id ? { ...item, ...updates } : item)));
  };

  const handleDeleteWorkflowDraftItem = (id: string) => {
    const sourceAdviceId = workflowDraftItems.find(item => item.id === id)?.sourceAdviceId;
    if (sourceAdviceId) {
      setSectionAdviceDraftItems(items => items.map(item => item.id === sourceAdviceId ? { ...item, selected: false } : item));
    }
    setWorkflowDraftItems(items => normalizeDraftOrders(
      [...items].sort((a, b) => a.order - b.order).filter(item => item.id !== id)
    ));
  };

  const handleMoveWorkflowDraftItem = (id: string, direction: 'up' | 'down') => {
    setWorkflowDraftItems(items => {
      const sorted = [...items].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(item => item.id === id);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return items;
      [sorted[index], sorted[targetIndex]] = [sorted[targetIndex], sorted[index]];
      return normalizeDraftOrders(sorted);
    });
  };

  const handleConfirmWorkflowDraft = async () => {
    if (!selectedReportDoc) {
      message.warning('请先选择阶段文档');
      return;
    }
    const draftItems = [...workflowDraftItems]
      .sort((a, b) => a.order - b.order)
      .filter(item => item.title.trim());
    if (draftItems.length === 0) {
      message.warning('请先生成或添加工作流步骤');
      return;
    }

    const createdAt = new Date().toISOString();
    const workflowId = `workflow-${Date.now()}`;
    const workflowName = `${selectedStage || '阶段'} V${selectedStageVersionIndex + 1}：${selectedReportDoc.name}`;
    const existingWorkflowTasks = useTaskStore.getState().tasks.filter(task =>
      task.projectId === currentProject.id &&
      task.source === 'report' &&
      task.relatedDocId === selectedReportDoc.id &&
      Boolean(task.workflowId)
    );
    await Promise.all(existingWorkflowTasks.map(task => deleteTask(task.id)));
    let previousTaskId: string | undefined;

    for (let i = 0; i < draftItems.length; i++) {
      const item = draftItems[i];
      const taskId = `${workflowId}-${i + 1}`;
      const descriptionLines = [
        item.description,
        item.reason ? `排序理由：${item.reason}` : '',
        `来自 AI 写作框架工作流：${workflowName}`,
      ].filter(Boolean);
      const task: TaskItem = {
        id: taskId,
        projectId: currentProject.id,
        title: item.title.trim(),
        description: descriptionLines.join('\n'),
        type: item.type,
        status: 'pending',
        priority: item.priority,
        source: 'report',
        relatedDocId: selectedReportDoc.id,
        stageName: selectedStage,
        workflowId,
        workflowName,
        workflowOrder: i + 1,
        dependsOnTaskId: previousTaskId,
        createdAt,
      };
      await addTask(task);
      previousTaskId = taskId;
    }

    message.success(`已生成 ${draftItems.length} 个有顺序的工作流任务，可在计划页查看进度`);
  };
  const versionSummary = selectedReportDoc
    ? `V${selectedStageVersionIndex + 1} / ${stageDocs.length} · ${dayjs(getDocCreatedAt(selectedReportDoc)).format('YYYY-MM-DD HH:mm')}`
    : '暂无阶段版本';

  return (
    <div
      className="report-workbench-page"
      style={{
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingRight: 4,
        scrollbarGutter: 'stable',
      }}
    >
      {!hideHeader && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
            <Title level={4} style={{ margin: 0 }}>{currentProject.name} - 阶段报告与任务</Title>
          </div>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>按阶段生成报告、AI写作框架建议和下一步任务</Text>
        </div>
        <Space>
          <Button icon={<FileTextOutlined />} onClick={handleCreateReportTask}>保存为报告任务</Button>
        </Space>
      </div>}

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <StageDocumentPanel
          extra={hideHeader ? <Button size="small" icon={<FileTextOutlined />} onClick={handleCreateReportTask}>保存为报告任务</Button> : null}
          stageOptions={stageOptions}
          selectedStage={selectedStage}
          onStageChange={(value) => {
            setSelectedStageName(value);
            setCurrentStageName(value);
            // 用户明确选择阶段，取消此前由文件详情带入的阶段锁定。
            setPendingReportDocId(null);
            setPendingReportDocOnly(false);
            setFocusedReportDocId('');
            setSelectedReportDocId('');
          }}
          stageDocuments={stageDocs}
          selectedDocument={selectedReportDoc}
          selectedVersionIndex={selectedStageVersionIndex}
          stageProgress={stageProgressPercent}
          onPickDocument={() => void handlePickStageDocument()}
        >

            {selectedReportDoc && (
              <>
                <StageDocumentOverview
                  document={selectedReportDoc}
                  selectedStage={selectedStage}
                  versionSummary={versionSummary}
                  templateName={selectedDocTemplate?.name}
                  reviewSummary={latestDocReview ? `${latestDocReview.score} 分，${latestReviewIssues.length} 个问题` : '暂无'}
                  stageProgress={stageProgressPercent}
                  completionScore={completionScore}
                  sections={selectedSections}
                  completedCount={completedSections.length}
                  partialCount={partialSections.length}
                  missingCount={missingSections.length}
                  openTaskCount={openSelectedDocTasks.length}
                  completionFormulaText={completionFormulaText}
                  isRefreshing={isRefreshingDocStatus}
                  onRefresh={handleRefreshReportDocStatus}
                  formatSectionTitle={cleanReportHeadingTitle}
                />

                {(aiStageReport || isGeneratingAiReport) && (
                  <AiStageReportPanel
                    report={aiStageReport}
                    displayReport={displayAiStageReport}
                    adviceItems={sectionAdviceDraftItems}
                    onUpdateAdviceItem={handleUpdateSectionAdviceDraftItem}
                    onToggleAllAdvice={handleToggleAllSectionAdvice}
                    isGenerating={isGeneratingAiReport}
                    selectedVersionId={selectedAiReportVersionId}
                    onVersionChange={setSelectedAiReportVersionId}
                    onRegenerate={() => void handleGenerateAiStageReport()}
                    workflowItems={workflowDraftItems}
                    onAddWorkflowItem={handleAddWorkflowDraftItem}
                    onUpdateWorkflowItem={handleUpdateWorkflowDraftItem}
                    onDeleteWorkflowItem={handleDeleteWorkflowDraftItem}
                    onMoveWorkflowItem={handleMoveWorkflowDraftItem}
                    onConfirmWorkflow={() => void handleConfirmWorkflowDraft()}
                    formatSectionTitle={cleanReportHeadingTitle}
                  />
                )}
              </>
            )}
        </StageDocumentPanel>

      </Space>

    </div>
  );
};

export default TaskPlanner;

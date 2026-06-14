import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LeftOutlined,
  PlusOutlined,
  RobotOutlined,
  SyncOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { ProjectDocument, TaskItem, WritingTemplate } from '../../../shared/types';
import { buildProjectStageSegments, detectTimelineStage, getAllStages, getProjectProgress } from '../../utils/timelineStages';

const { Text, Paragraph, Title } = Typography;

const priorityColors: Record<TaskItem['priority'], string> = {
  high: 'red',
  medium: 'orange',
  low: 'green',
};

const priorityLabels: Record<TaskItem['priority'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const statusLabels: Record<TaskItem['status'], string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
};

const sourceLabels: Record<NonNullable<TaskItem['source']>, string> = {
  manual: '手动',
  review: '审查',
  stage: '阶段',
  report: '报告',
};

const getDocCreatedAt = (doc: ProjectDocument) => doc.sourceFileCreatedAt || doc.createdAt;


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


interface AiWorkflowPlanItem {
  type: 'manual' | 'ai';
  title: string;
  description?: string;
  priority?: TaskItem['priority'];
  reason?: string;
}

interface AiSectionAdvice {
  title: string;
  problems?: string[];
  suggestions?: string[];
}

interface AiStageReport {
  reportTitle?: string;
  reportSummary?: string;
  qualityAssessment?: string[];
  templateFit?: string[];
  writingStyleNotes?: string[];
  writingFramework?: string[];
  writingDirection?: string[];
  materialPlan?: string[];
  draftPlan?: string[];
  contentGaps?: string[];
  optimizationFocus?: string[];
  risks?: string[];
  humanTasks?: string[];
  aiTasks?: string[];
  workflowPlan?: AiWorkflowPlanItem[];
  sectionAdvice?: AiSectionAdvice[];
  rawText?: string;
}

interface WorkflowDraftItem {
  id: string;
  type: 'manual' | 'ai';
  title: string;
  description: string;
  priority: TaskItem['priority'];
  order: number;
  reason?: string;
}

interface NextActionDraftItem {
  id: string;
  type: 'manual' | 'ai';
  title: string;
  description: string;
  priority: TaskItem['priority'];
}

const flattenTemplateNodesForPrompt = (nodes: any[] = [], depth = 0): string[] => nodes.flatMap((node) => {
  const prefix = `${'  '.repeat(depth)}- ${node.title || '未命名章节'}`;
  const details = [
    (node.requirementText || node.description) ? `写作要求：${node.requirementText || node.description}` : '',
    node.isRequired === false ? '可选章节' : '必需章节',
    node.fontRequirement ? `字体要求：${JSON.stringify(node.fontRequirement)}` : '',
    node.paragraphRequirement ? `段落要求：${JSON.stringify(node.paragraphRequirement)}` : '',
    node.exampleText ? `范文写法参考：${String(node.exampleText).slice(0, 500)}` : '',
  ].filter(Boolean).join('；');
  return [`${prefix}${details ? `（${details}）` : ''}`, ...flattenTemplateNodesForPrompt(node.children || [], depth + 1)];
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

  // 3. 尝试提取最外层 JSON 对象
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {}

  // 4. 尝试修复常见问题：末尾多余逗号、单引号等
  try {
    let fixable = match[0]
      .replace(/,\s*([}\]])/g, '$1')        // 移除末尾多余逗号
      .replace(/'/g, '"');                    // 单引号转双引号（简单替换）
    return JSON.parse(fixable);
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

const createNextActionDraftItems = (actions: string[], hasMissingSections = false): NextActionDraftItem[] => actions.map((action, index) => ({
  id: `next-${Date.now()}-${index}`,
  type: /AI|智能|框架|方向|提纲|初稿|补写|扩写|润色|优化|修复/.test(action) ? 'ai' : 'manual',
  title: action.replace(/[。.]$/, ''),
  description: /AI|智能|框架|方向|提纲|初稿|补写|扩写|润色|优化|修复/.test(action)
    ? '围绕当前文章内容执行：依据模板要求、范文结构和现有正文进行框架规划、提纲、初稿、扩写或润色。'
    : '围绕当前文章内容执行：补充资料、确认口径、人工改稿、领导审核或处理返稿意见。',
  priority: index === 0 || hasMissingSections ? 'high' : 'medium',
}));

const createWorkflowDraftItemsFromReport = (report: AiStageReport): WorkflowDraftItem[] => {
  const plan: AiWorkflowPlanItem[] = report.workflowPlan?.length
    ? report.workflowPlan
    : [
      ...(report.aiTasks || []).map((title, index) => ({ type: 'ai' as const, title, priority: index === 0 ? 'high' as const : 'medium' as const })),
      ...(report.humanTasks || []).map((title, index) => ({ type: 'manual' as const, title, priority: index === 0 && !(report.aiTasks || []).length ? 'high' as const : 'medium' as const })),
    ];

  return plan.map((item, index) => ({
    id: `draft-${Date.now()}-${index}`,
    type: item.type,
    title: item.title.replace(/[。.]$/, ''),
    description: item.description || '',
    priority: item.priority || (index === 0 ? 'high' : 'medium'),
    order: index + 1,
    reason: item.reason,
  }));
};

const parseAiStageReport = (value: string): AiStageReport => {
  const parsed = extractJsonObject(value);
  if (!parsed) {
    // 解析失败时，尝试从原始文本中提取可读内容
    const cleanText = value
      .replace(/```[\s\S]*?```/g, '')  // 移除代码块
      .replace(/^\s*[\n\r]+/gm, '')     // 移除空行
      .trim();
    return {
      rawText: value,
      reportSummary: cleanText || 'AI 返回内容无法解析，请重试',
    };
  }
  return {
    reportTitle: String(parsed.reportTitle || parsed.title || '').trim(),
    reportSummary: String(parsed.reportSummary || parsed.summary || '').trim(),
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
    sectionAdvice: normalizeSectionAdvice(parsed.sectionAdvice || parsed.chapterAdvice || parsed.sectionPlans || parsed.sections),
    rawText: value,
  };
};

const TaskPlanner: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const { tasks, loadTasks, addTask, deleteTask, executeAITask, updateTask } = useTaskStore();
  const { templates, reviews, loadTemplates, loadReviews } = useTemplateStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskItem['status']>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | NonNullable<TaskItem['source']>>('all');
  const [selectedStageName, setSelectedStageName] = useState<string>('');
  const [selectedReportDocId, setSelectedReportDocId] = useState<string>('');
  const [focusedReportDocId, setFocusedReportDocId] = useState<string>('');
  const [versionsExpanded, setVersionsExpanded] = useState(false);
  const [isGeneratingAiReport, setIsGeneratingAiReport] = useState(false);
  const [refreshingAnalysisKey, setRefreshingAnalysisKey] = useState('');
  const [aiStageReport, setAiStageReport] = useState<AiStageReport | null>(null);
  const [workflowDraftItems, setWorkflowDraftItems] = useState<WorkflowDraftItem[]>([]);
  const [nextActionDraftItems, setNextActionDraftItems] = useState<NextActionDraftItem[]>([]);
  const [form] = Form.useForm();

  useEffect(() => {
    loadTasks();
    loadProjectDocs();
    loadTemplates();
    loadReviews();
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
  const stageSegments = currentProject
    ? buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages)
    : [];
  const projectProgress = currentProject
    ? getProjectProgress(currentProject, projectDocsList, templates, projectVersions, allStages)
    : 0;

  const stageOptions = useMemo(() => {
    const names = new Set<string>();
    stageSegments.forEach(segment => names.add(segment.stage));
    projectDocsList.forEach(doc => {
      const template = findReplacementTemplateForDoc(doc, templates, allStages);
      names.add(template?.category || detectTimelineStage(allStages, doc.name, doc.sourceFilePath));
    });
    return [...names].map(name => ({ value: name, label: name }));
  }, [allStages, projectDocsList, stageSegments, templates]);

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

  const stageDocs = useMemo(() => {
    if (!selectedStage) return [];
    const sourceIds = new Set(
      stageSegments
        .filter(segment => segment.stage === selectedStage)
        .flatMap(segment => segment.sourceDocIds)
    );
    return projectDocsList
      .filter(doc => {
        if (sourceIds.has(doc.id)) return true;
        const template = findReplacementTemplateForDoc(doc, templates, allStages, selectedStage);
        const detectedStage = template?.category || detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
        return detectedStage === selectedStage;
      })
      .sort((a, b) => new Date(getDocCreatedAt(a)).getTime() - new Date(getDocCreatedAt(b)).getTime());
  }, [allStages, projectDocsList, selectedStage, stageSegments, templates]);

  useEffect(() => {
    if (!currentProject) return;

    const stageExists = (stageName: string) => stageOptions.some(option => option.value === stageName);
    const firstStage = stageOptions[0]?.value || '';
    const preferredStage = pendingFocusedStage || currentStageName;
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
  }, [currentProject?.id, currentStageName, pendingFocusedStage, selectedStageName, stageOptions, setCurrentStageName]);

  useEffect(() => {
    if (!pendingReportDocId) return;

    const targetDoc = projectDocsList.find(doc => doc.id === pendingReportDocId);
    if (!targetDoc) return;
    if (currentProject && targetDoc.projectId !== currentProject.id) return;

    setFocusedReportDocId(pendingReportDocId);
    setSelectedReportDocId(pendingReportDocId);
    setVersionsExpanded(false);
    setAiStageReport(null);
    setWorkflowDraftItems([]);
    setNextActionDraftItems([]);

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

    const firstDocId = stageDocs[0]?.id || '';
    if (firstDocId && !stageDocs.some(doc => doc.id === selectedReportDocId)) {
      setSelectedReportDocId(firstDocId);
    }
    if (!firstDocId && selectedReportDocId) {
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
  const selectedSections = Array.isArray(selectedReportDoc?.sections) ? selectedReportDoc.sections : [];
  const selectedDocContent = selectedDocVersion?.content || '';
  const selectedAnalysisHasIncompleteSections = selectedSections.some(section =>
    section.status === 'missing' || section.status === 'partial'
  );
  const canRefreshSelectedAnalysisFromFile = Boolean(selectedReportDoc?.sourceFilePath || selectedDocVersion?.filePath);
  const isSelectedAnalysisStale = isSectionAnalysisStaleForTemplate(selectedReportDoc, selectedDocTemplate, selectedSections);
  const isSelectedAnalysisLikelyFalseMissing = isLikelyFalseMissingSectionAnalysis(selectedSections, selectedDocContent);
  const shouldRefreshSelectedAnalysis =
    isSelectedAnalysisStale ||
    isSelectedAnalysisLikelyFalseMissing ||
    (selectedAnalysisHasIncompleteSections && canRefreshSelectedAnalysisFromFile);

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
        const result = await window.electronAPI.analyzeProjectDoc({
          content,
          template: selectedDocTemplate,
          useAI: false,
        });
        if (!cancelled && result.success && result.sections) {
          await updateProjectDoc(selectedReportDoc.id, {
            templateId: selectedDocTemplate.id,
            sections: result.sections,
            overallProgress: result.overallProgress ?? 0,
            analyzedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.warn('Failed to refresh stale section analysis:', error);
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
  const stageProgressPercent = selectedReportDoc?.overallProgress ?? (totalSections ? Math.round(completionScore / totalSections * 100) : 0);
  const completionFormulaText = totalSections
    ? `完成度 = (已完成 ${completedSections.length} + 部分完成 ${partialSections.length} × 0.5) / 模板章节 ${totalSections} = ${selectedReportDoc?.overallProgress || 0}%`
    : '暂无模板章节，无法计算完成度';

  useEffect(() => {
    // 尝试从 ProjectDocument 恢复已保存的 AI 报告
    if (selectedReportDoc?.aiReport) {
      try {
        const saved = JSON.parse(selectedReportDoc.aiReport);
        setAiStageReport(saved);
        setWorkflowDraftItems(createWorkflowDraftItemsFromReport(saved));
      } catch {
        setAiStageReport(null);
        setWorkflowDraftItems([]);
      }
    } else {
      setAiStageReport(null);
      setWorkflowDraftItems([]);
    }
    setNextActionDraftItems([]);
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

  const sectionAdviceItems = useMemo<AiSectionAdvice[]>(() => {
    const explicit = aiStageReport?.sectionAdvice || [];
    if (explicit.length > 0) return cleanSectionAdviceItems(explicit);

    const titles: string[] = topLevelTemplateTitles.length
      ? topLevelTemplateTitles
      : selectedSections.map(section => section.title).filter(Boolean);
    const generalSuggestions: string[] = [
      ...(aiStageReport?.writingFramework || []),
      ...(aiStageReport?.writingDirection || []),
      ...(aiStageReport?.materialPlan || []),
      ...(aiStageReport?.draftPlan || []),
      ...(aiStageReport?.optimizationFocus || []),
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

        return { title, problems, suggestions };
      })
      .filter(item => item.problems.length > 0 || item.suggestions.length > 0)
      .slice(0, 12);
  }, [aiStageReport, selectedSections, topLevelTemplateTitles]);

  const taskStats = useMemo(() => {
    const open = scopedProjectTasks.filter((t) => t.status !== 'completed').length;
    const completed = scopedProjectTasks.filter((t) => t.status === 'completed').length;
    const high = scopedProjectTasks.filter((t) => t.priority === 'high' && t.status !== 'completed').length;
    const review = scopedProjectTasks.filter((t) => t.source === 'review' && t.status !== 'completed').length;
    return { open, completed, high, review };
  }, [scopedProjectTasks]);

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

  const nextActionReportLines = nextActionDraftItems.length
    ? nextActionDraftItems
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
      '下一步需要做什么：',
      ...nextActionReportLines.map(action => `- ${action}`),
    ].filter(Boolean).join('\n');
  }, [
    completedSections.length,
    completionFormulaText,
    latestDocReview,
    latestReviewIssues.length,
    missingSections.length,
    nextActionReportLines,
    openSelectedDocTasks.length,
    partialSections.length,
    selectedDocTemplate,
    selectedReportDoc,
    selectedStage,
    selectedStageVersionIndex,
    stageDocs.length,
  ]);

  const filteredTasks = scopedProjectTasks.filter((task) => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (sourceFilter !== 'all' && (task.source || 'manual') !== sourceFilter) return false;
    return true;
  });
  const workflowTasks = filteredTasks.filter(task => Boolean(task.workflowId));
  const aiTasks = filteredTasks.filter(task => task.type === 'ai' && !task.workflowId);
  const manualTasks = filteredTasks.filter(task => task.type === 'manual' && !task.workflowId);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const newTask: TaskItem = {
        id: Date.now().toString(),
        projectId: currentProject.id,
        title: values.title,
        description: values.description || '',
        type: values.type,
        status: 'pending',
        priority: values.priority || 'medium',
        source: values.source || 'manual',
        relatedDocId: values.relatedDocId,
        stageName: values.stageName,
        assigneeName: values.assigneeName,
        dueAt: values.dueAt ? values.dueAt.toISOString() : undefined,
        createdAt: new Date().toISOString(),
      };
      await addTask(newTask);
      setIsModalOpen(false);
      form.resetFields();
      message.success('任务已创建');
    } catch (error) {
      console.error('Task form validation failed:', error);
    }
  };

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
    const hasUsableSectionStats = selectedSections.some(section => section.wordCount > 0 || section.status !== 'missing');
    const isStale = isSectionAnalysisStaleForTemplate(selectedReportDoc, selectedDocTemplate, selectedSections);
    const likelyFalseMissing = isLikelyFalseMissingSectionAnalysis(selectedSections, content);
    if (hasUsableSectionStats && !isStale && !likelyFalseMissing) return null;

    try {
      const result = await window.electronAPI.analyzeProjectDoc({
        content,
        template: selectedDocTemplate,
        useAI: false,
      });
      if (result.success && result.sections) {
        const refreshed = {
          sections: result.sections,
          overallProgress: result.overallProgress ?? selectedReportDoc.overallProgress,
        };
        await updateProjectDoc(selectedReportDoc.id, {
          ...refreshed,
          analyzedAt: new Date().toISOString(),
        });
        return refreshed;
      }
    } catch (error) {
      console.warn('Failed to refresh report doc analysis:', error);
    }
    return null;
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
      const templateGuidance = extractTemplateGuidanceText(selectedDocTemplate);
      const templateRequirementText = templateGuidance.requirementText;
      const templateExample = await loadTemplateExampleContent();
      const templateNodes = flattenTemplateNodesForPrompt(selectedDocTemplate.nodes).join('\n');
      const formatRules = JSON.stringify(selectedDocTemplate.formatRules || {
        titleFontRequirement: selectedDocTemplate.titleFontRequirement,
        bodyFontRequirement: selectedDocTemplate.bodyFontRequirement,
      }, null, 2);
      const reviewIssues = latestReviewIssues.map(issue => (
        `- [${issue.severity}] ${issue.sectionTitle || ''} ${issue.message}${issue.suggestion ? `；建议：${issue.suggestion}` : ''}`
      )).join('\n') || '暂无审查Tab结果';
      const reportDocument = await loadReportDocumentContent();
      const refreshedAnalysis = await refreshReportDocAnalysis(reportDocument.content);
      const effectiveSections = refreshedAnalysis?.sections || selectedSections;
      const effectiveProgress = refreshedAnalysis?.overallProgress ?? selectedReportDoc.overallProgress;
      const sectionStatus = effectiveSections.map(section => (
        `- ${section.title}：${section.status}，字数 ${section.wordCount}${section.aiComment ? `，评语：${section.aiComment}` : ''}`
      )).join('\n');
      const documentContent = reportDocument.content || sectionStatus || selectedReportDoc.name;

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
4. 下一步任务必须针对“写作产出”：框架、提纲、章节展开、材料清单、初稿/扩写/润色，不输出审查结论、质量评分或风险判定。
5. 输出必须是 JSON 对象，不要输出 Markdown，不要包裹代码块。
6. humanTasks 强调补资料、确认数据/口径、提供附件依据、决定领导审核时机。
7. aiTasks 强调搭框架、列提纲、生成初稿、按范文结构扩写、润色、整理材料引用路径。
8. workflowPlan 必须按真实写作流转排序；通常优先 AI 框架/初稿，然后人工补资料确认，再 AI 扩写/润色，再人工成稿确认。
9. 每个任务要具体、可执行，避免空泛建议。
10. 审查Tab已有结果只能作为背景参考，不能在这里重新做审查或下结论。
11. 前台主要展示 sectionAdvice。必须按模板一级标题逐项输出；每个一级标题只包含 problems 和 suggestions 两类内容。有问题才输出，没有问题的一级标题可以省略。
12. “遵循模板硬性规定的七章节结构：一、总体目标；二、研究内容；三、预期成果；四、考核指标；五、成果应用与转化；六、项目实施期限；七、支持经费限额”属于全局结构约束，不要重复写入每个章节的 suggestions。只有当当前文档缺少某个一级标题、标题顺序错误或结构明显错乱时，才在对应章节的 problems/suggestions 中提一次。

JSON 字段：
{
  "reportTitle": "标题",
  "reportSummary": "阶段文档写作框架与方向摘要，300-600字",
  "templateFit": ["模板要求转化成的写作约束"],
  "writingStyleNotes": ["从范文/参考内容提取的结构、方法和表达特征"],
  "writingFramework": ["供AI内部参考的章节框架，不作为前台主要展示"],
  "writingDirection": ["供AI内部参考的写作方向，不作为前台主要展示"],
  "sectionAdvice": [{"title": "模板一级标题，如 一、总体目标", "problems": ["该章节当前存在的问题，必须具体"], "suggestions": ["该章节下一步怎么写、补什么、AI如何改，必须可执行"]}],
  "materialPlan": ["需要人工准备或确认的材料、数据、附件、口径"],
  "draftPlan": ["AI可执行的初稿、扩写、润色、整理任务"],
  "humanTasks": ["人工资料/口径/成稿确认任务"],
  "aiTasks": ["AI框架/提纲/初稿/扩写/润色任务"],
  "workflowPlan": [{"type": "ai|manual", "title": "工作流步骤标题", "description": "执行说明，说明产出物和对应章节", "priority": "high|medium|low", "reason": "排序理由"}]
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

模板章节结构与章节写作要求：
${templateNodes || '无'}

模板格式要求：
${formatRules}

模板范文/参考写法（只用于提取结构、方法、表达风格，不作为当前文档硬性要求）：
${templateExample || '无'}

当前文档章节状态：
${sectionStatus || '暂无章节分析'}

当前文档内容来源：
${reportDocument.source}；提取字符数：${reportDocument.content.length}

审查Tab已有结果（仅作背景，不重新审查）：
${reviewIssues}

当前文档内容摘录：
${documentContent.slice(0, 9000)}`;

      const response = await window.electronAPI.callAI({ prompt });
      const parsed = parseAiStageReport(response);
      setAiStageReport(parsed);
      setWorkflowDraftItems(createWorkflowDraftItemsFromReport(parsed));
      // 持久化 AI 报告到 ProjectDocument（从 store 取最新对象，避免闭包引用旧值）
      const latestDoc = useProjectDocStore.getState().projectDocs.find(d => d.id === selectedReportDoc?.id);
      if (latestDoc) {
        await updateProjectDoc(latestDoc.id, { aiReport: JSON.stringify(parsed) });
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

    setWorkflowDraftItems([]);
    message.success(`已生成 ${draftItems.length} 个有顺序的工作流任务，可在计划页查看进度`);
  };
  const handleFillNextActionDraftItems = () => {
    if (!selectedReportDoc) {
      message.warning('请先选择阶段文档');
      return;
    }
    setNextActionDraftItems(createNextActionDraftItems(nextActions, missingSections.length > 0));
    message.success('已根据当前文档状态填充建议草稿，可继续删减和调整');
  };

  const handleAddNextActionDraftItem = (type: 'manual' | 'ai' = 'manual') => {
    setNextActionDraftItems(items => ([
      ...items,
      {
        id: `next-${Date.now()}`,
        type,
        title: type === 'ai' ? 'AI生成当前正文的写作框架和方向' : '人工按写作框架补充资料并确认口径',
        description: '',
        priority: 'medium',
      },
    ]));
  };

  const handleUpdateNextActionDraftItem = (id: string, updates: Partial<NextActionDraftItem>) => {
    setNextActionDraftItems(items => items.map(item => (item.id === id ? { ...item, ...updates } : item)));
  };

  const handleDeleteNextActionDraftItem = (id: string) => {
    setNextActionDraftItems(items => items.filter(item => item.id !== id));
  };

  const handleCreateNextActionTasks = async (taskType: 'manual' | 'ai') => {
    if (!selectedReportDoc) {
      message.warning('请先选择阶段文档');
      return;
    }
    const draftItems = nextActionDraftItems
      .filter(item => item.type === taskType && item.title.trim());
    if (draftItems.length === 0) {
      message.warning(taskType === 'ai' ? '暂无可生成的 AI 下一步' : '暂无可生成的人工下一步');
      return;
    }
    for (let i = 0; i < draftItems.length; i++) {
      const item = draftItems[i];
      const task: TaskItem = {
        id: `${Date.now()}-${taskType}-next-${i}`,
        projectId: currentProject.id,
        title: item.title.trim().replace(/[。.]$/, ''),
        description: item.description || `来自阶段报告 V${selectedStageVersionIndex + 1}：${selectedReportDoc.name}`,
        type: item.type,
        status: 'pending',
        priority: item.priority,
        source: 'report',
        relatedDocId: selectedReportDoc.id,
        stageName: selectedStage,
        createdAt: new Date().toISOString(),
      };
      await addTask(task);
    }
    message.success(`已生成 ${draftItems.length} 个${taskType === 'ai' ? 'AI' : '人工'}下一步任务`);
  };
  const handleExecuteAI = async (task: TaskItem) => {
    const relatedDoc = task.relatedDocId ? projectDocsList.find((doc) => doc.id === task.relatedDocId) : null;
    const relatedVersion = relatedDoc?.versionId
      ? projectVersions.find((version) => version.id === relatedDoc.versionId)
      : null;
    const latestVersion = [...projectVersions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const content = relatedVersion?.content || latestVersion?.content || reportText;

    setExecutingTaskId(task.id);
    try {
      const result = await executeAITask(task.id, content, task.description || task.title);
      if (result.success) {
        message.success('AI 任务执行完成');
      } else {
        message.error(`执行失败: ${result.error}`);
      }
    } catch (error: any) {
      message.error(`执行失败: ${error.message}`);
    } finally {
      setExecutingTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    await deleteTask(taskId);
    message.success('任务已删除');
  };

  const handleStatusChange = async (taskId: string, status: TaskItem['status']) => {
    await updateTask(taskId, {
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
    });
    message.success('状态已更新');
  };

  const renderTaskItem = (task: TaskItem) => {
    const relatedDoc = task.relatedDocId ? projectDocsList.find((doc) => doc.id === task.relatedDocId) : null;
    const source = task.source || 'manual';
    return (
      <List.Item
        actions={[
          task.type === 'ai' && task.status !== 'completed' && (
            <Button
              type="primary"
              size="small"
              icon={<RobotOutlined />}
              loading={executingTaskId === task.id}
              onClick={() => handleExecuteAI(task)}
            >
              执行
            </Button>
          ),
          task.status !== 'completed' && (
            <Select
              size="small"
              value={task.status}
              onChange={(value) => handleStatusChange(task.id, value)}
              style={{ width: 104 }}
              options={[
                { value: 'pending', label: '待处理' },
                { value: 'in_progress', label: '进行中' },
                { value: 'completed', label: '已完成' },
              ]}
            />
          ),
          <Popconfirm title="确定删除此任务？" onConfirm={() => handleDeleteTask(task.id)}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>,
        ].filter(Boolean)}
      >
        <List.Item.Meta
          avatar={task.type === 'ai'
            ? <RobotOutlined style={{ color: '#1677ff', fontSize: 18 }} />
            : <UserOutlined style={{ color: '#52c41a', fontSize: 18 }} />}
          title={
            <Space wrap size={6}>
              <Text delete={task.status === 'completed'}>{task.title}</Text>
              <Tag color={priorityColors[task.priority]}>{priorityLabels[task.priority]}</Tag>
              <Tag icon={task.status === 'completed' ? <CheckCircleOutlined /> : <SyncOutlined spin={task.status === 'in_progress'} />}>
                {statusLabels[task.status]}
              </Tag>
              <Tag>{sourceLabels[source]}</Tag>
              {task.stageName && <Tag color="blue">{task.stageName}</Tag>}
            </Space>
          }
          description={
            <div>
              <Space wrap size={6} style={{ marginBottom: 4 }}>
                {task.assigneeName && <Text type="secondary">负责人：{task.assigneeName}</Text>}
                {task.dueAt && <Text type="secondary">截止：{dayjs(task.dueAt).format('MM-DD')}</Text>}
                {relatedDoc && <Text type="secondary">文档：{relatedDoc.name}</Text>}
                {task.sectionTitle && <Text type="secondary">章节：{task.sectionTitle}</Text>}
              </Space>
              {task.description && (
                <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4 }}>
                  {task.description}
                </Paragraph>
              )}
              {task.result && (
                <div style={{ marginTop: 8, padding: 10, background: '#f6f8fa', borderRadius: 6, fontSize: 12 }}>
                  <Text type="secondary">AI 执行结果：</Text>
                  <Paragraph ellipsis={{ rows: 3, expandable: true }} style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {task.result}
                  </Paragraph>
                </div>
              )}
            </div>
          }
        />
      </List.Item>
    );
  };

  const versionSummary = selectedReportDoc
    ? `V${selectedStageVersionIndex + 1} / ${stageDocs.length} · ${dayjs(getDocCreatedAt(selectedReportDoc)).format('YYYY-MM-DD HH:mm')}`
    : '暂无阶段版本';

  const renderTaskGroup = (title: string, subtitle: string, items: TaskItem[], color: string) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderTop: `3px solid ${color}`, borderBottom: '1px solid #eef0f4' }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Text strong>{title}</Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{subtitle}</Text>
          </div>
          <Tag color={items.length ? 'blue' : 'default'} style={{ margin: 0 }}>{items.length}</Tag>
        </Space>
      </div>
      <div style={{ padding: '0 10px' }}>
        <List
          size="small"
          dataSource={items}
          renderItem={renderTaskItem}
          locale={{ emptyText: '暂无匹配任务' }}
        />
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
            <Title level={4} style={{ margin: 0 }}>{currentProject.name} - 阶段报告与任务</Title>
          </div>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>按阶段生成报告、AI写作框架建议和下一步任务</Text>
        </div>
        <Space>
          <Button icon={<FileTextOutlined />} onClick={handleCreateReportTask}>保存为报告任务</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>新建任务</Button>
        </Space>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card>
          <Row gutter={16}>
            <Col span={6}><Statistic title="项目进度" value={projectProgress} suffix="%" /></Col>
            <Col span={6}><Statistic title="阶段版本" value={stageDocs.length} /></Col>
            <Col span={6}><Statistic title="待处理任务" value={taskStats.open} /></Col>
            <Col span={6}><Statistic title="审查待办" value={taskStats.review} /></Col>
          </Row>
          <Progress percent={selectedReportDoc?.overallProgress || projectProgress} style={{ marginTop: 12, marginBottom: 0 }} />
        </Card>

        <Card title="阶段文档报告">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Row gutter={12} align="bottom">
              <Col span={8}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>选择阶段</Text>
                <Select
                  style={{ width: '100%' }}
                  value={selectedStage || undefined}
                  placeholder="选择阶段"
                                      onChange={(value) => {
                      setSelectedStageName(value);
                      setCurrentStageName(value);
                      setFocusedReportDocId('');
                      setSelectedReportDocId('');
                      setVersionsExpanded(false);
                    }}
                  options={stageOptions}
                />
              </Col>
              <Col span={16}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>阶段版本</Text>
                <Text type="secondary">一个阶段有多少个相关文档，就形成多少个版本；版本按文档创建时间排序。</Text>
              </Col>
            </Row>

            {stageDocs.length > 0 ? (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                <button
                  type="button"
                  onClick={() => setVersionsExpanded(prev => !prev)}
                  style={{
                    width: '100%',
                    border: 0,
                    background: '#f8fbff',
                    padding: '12px 14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Space size={8} style={{ minWidth: 0 }}>
                      <Tag color="blue" style={{ margin: 0 }}>当前</Tag>
                      <Text strong>
                        V{Math.max(selectedStageVersionIndex + 1, 1)} / {stageDocs.length}
                      </Text>
                      <Text style={{ maxWidth: 620 }} ellipsis={{ tooltip: selectedReportDoc?.name }}>
                        {selectedReportDoc?.name || '请选择版本'}
                      </Text>
                    </Space>
                    <Space size={10}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {selectedReportDoc ? dayjs(getDocCreatedAt(selectedReportDoc)).format('MM-DD HH:mm') : ''}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {versionsExpanded ? '收起版本' : '展开全部版本'}
                      </Text>
                    </Space>
                  </div>
                  {selectedReportDoc && (
                    <Progress percent={selectedReportDoc.overallProgress} size="small" showInfo={false} style={{ marginTop: 8, marginBottom: 0 }} />
                  )}
                </button>

                {versionsExpanded && (
                  <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, borderTop: '1px solid #e5e7eb' }}>
                    {stageDocs.map((doc, index) => {
                      const selected = doc.id === selectedReportDoc?.id;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setSelectedReportDocId(doc.id)}
                          style={{
                            textAlign: 'left',
                            border: selected ? '1px solid #1677ff' : '1px solid #e5e7eb',
                            background: selected ? '#eef6ff' : '#fff',
                            boxShadow: selected ? '0 8px 18px rgba(22, 119, 255, 0.12)' : 'none',
                            borderRadius: 8,
                            padding: '10px 12px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <Space size={6}>
                              <Text strong>V{index + 1}</Text>
                              {selected && <Tag color="blue" style={{ margin: 0 }}>已选</Tag>}
                            </Space>
                            <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(getDocCreatedAt(doc)).format('MM-DD HH:mm')}</Text>
                          </div>
                          <Text style={{ display: 'block' }} ellipsis={{ tooltip: doc.name }}>{doc.name}</Text>
                          <Progress percent={doc.overallProgress} size="small" showInfo={false} style={{ marginTop: 8, marginBottom: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <Empty description="该阶段暂无可出具报告的文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}

            {selectedReportDoc && (
              <>
                <Row gutter={12}>
                  <Col span={6}>
                    <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 12 }}>
                      <Text type="secondary">当前版本</Text>
                      <Title level={5} style={{ margin: '6px 0 0' }}>{versionSummary}</Title>
                    </div>
                  </Col>
                  <Col span={6}>
                    <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 12 }}>
                      <Text type="secondary">文档完成度</Text>
                      <Title level={5} style={{ margin: '6px 0 0' }}>{selectedReportDoc.overallProgress}%</Title>
                      <Text type="secondary" style={{ fontSize: 12 }}>{completionScore}/{totalSections || 0} 章节分</Text>
                    </div>
                  </Col>
                  <Col span={6}>
                    <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 12 }}>
                      <Text type="secondary">章节问题</Text>
                      <Title level={5} style={{ margin: '6px 0 0' }}>{missingSections.length + partialSections.length}</Title>
                    </div>
                  </Col>
                  <Col span={6}>
                    <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 12 }}>
                      <Text type="secondary">关联待办</Text>
                      <Title level={5} style={{ margin: '6px 0 0' }}>{openSelectedDocTasks.length}</Title>
                    </div>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={10}>
                    <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 14, height: '100%' }}>
                      <Title level={5} style={{ marginTop: 0 }}>报告摘要</Title>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Text>阶段：{selectedStage || '未识别阶段'}</Text>
                        <Text>文档：{selectedReportDoc.name}</Text>
                        <Text>模板：{selectedDocTemplate?.name || '未关联模板'}</Text>
                        <Text>创建时间：{dayjs(getDocCreatedAt(selectedReportDoc)).format('YYYY-MM-DD HH:mm')}</Text>
                        <Text>最近审查：{latestDocReview ? `${latestDocReview.score} 分，${latestReviewIssues.length} 个问题` : '暂无'}</Text>
                      </Space>
                    </div>
                  </Col>
                  <Col span={14}>
                    <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 14, height: '100%' }}>
                      <Title level={5} style={{ marginTop: 0 }}>阶段文档状态</Title>
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <div>
                          <Text type="secondary">已完成章节</Text>
                          <Progress percent={stageProgressPercent} size="small" />
                        </div>
                        <Space wrap>
                          <Tag color="green">已完成 {completedSections.length}</Tag>
                          <Tag color="orange">部分完成 {partialSections.length}</Tag>
                          <Tag color="red">缺失 {missingSections.length}</Tag>
                          <Tag color="blue">待办 {openSelectedDocTasks.length}</Tag>
                        </Space>
                        <Text type="secondary">{completionFormulaText}</Text>
                        {incompleteSections.length > 0 && (
                          <div style={{ borderTop: '1px solid #edf0f5', paddingTop: 10 }}>
                            <Text strong>未完成项</Text>
                            <List
                              size="small"
                              dataSource={incompleteSections}
                              style={{ marginTop: 6 }}
                              renderItem={(section) => (
                                <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
                                  <List.Item.Meta
                                    title={
                                      <Space wrap>
                                        <Tag color={section.status === 'missing' ? 'red' : 'orange'}>
                                          {section.status === 'missing' ? '缺失' : '部分完成'}
                                        </Tag>
                                        <Text>{section.title}</Text>
                                        <Text type="secondary">{section.wordCount} 字</Text>
                                      </Space>
                                    }
                                    description={
                                      section.aiComment ||
                                      (section.status === 'missing'
                                        ? '模板要求有该章节，但当前正文未匹配到对应标题或内容。'
                                        : '已识别到该章节，但内容仍需补充完善。')
                                    }
                                  />
                                </List.Item>
                              )}
                            />
                          </div>
                        )}
                      </Space>
                    </div>
                  </Col>
                </Row>

                <div style={{ border: '1px solid #edf0f5', borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>下一步需要做什么</Title>
                      <Text type="secondary">这里面向当前文章内容：AI负责框架/提纲/初稿/扩写，人工负责资料/口径/成稿确认</Text>
                    </div>
                    <Space wrap>
                      <Button size="small" onClick={handleFillNextActionDraftItems}>填充建议草稿</Button>
                      <Button size="small" icon={<UserOutlined />} onClick={() => handleAddNextActionDraftItem('manual')}>增加人工下一步</Button>
                      <Button size="small" icon={<RobotOutlined />} onClick={() => handleAddNextActionDraftItem('ai')}>增加AI下一步</Button>
                    </Space>
                  </div>
                  <List
                    size="small"
                    dataSource={nextActionDraftItems}
                    locale={{ emptyText: '暂无下一步。点击“填充建议草稿”、手动增加，或先运行 AI 写作框架建议。' }}
                    renderItem={(item, index) => (
                      <List.Item style={{ alignItems: 'flex-start' }}>
                        <div style={{ width: '100%' }}>
                          <Row gutter={[8, 8]} align="middle">
                            <Col flex="56px"><Tag color={item.type === 'ai' ? 'blue' : 'orange'}>{index + 1}</Tag></Col>
                            <Col flex="112px">
                              <Select
                                size="small"
                                value={item.type}
                                style={{ width: '100%' }}
                                options={[{ value: 'manual', label: '人工处理' }, { value: 'ai', label: 'AI处理' }]}
                                onChange={(value) => handleUpdateNextActionDraftItem(item.id, { type: value })}
                              />
                            </Col>
                            <Col flex="auto">
                              <Input
                                size="small"
                                value={item.title}
                                placeholder="输入下一步任务"
                                onChange={(event) => handleUpdateNextActionDraftItem(item.id, { title: event.target.value })}
                              />
                            </Col>
                            <Col flex="104px">
                              <Select
                                size="small"
                                value={item.priority}
                                style={{ width: '100%' }}
                                options={[{ value: 'high', label: '高优先级' }, { value: 'medium', label: '中优先级' }, { value: 'low', label: '低优先级' }]}
                                onChange={(value) => handleUpdateNextActionDraftItem(item.id, { priority: value })}
                              />
                            </Col>
                            <Col flex="64px">
                              <Button size="small" danger onClick={() => handleDeleteNextActionDraftItem(item.id)}>删除</Button>
                            </Col>
                            <Col span={24}>
                              <Input.TextArea
                                autoSize={{ minRows: 1, maxRows: 3 }}
                                value={item.description}
                                placeholder={item.type === 'ai' ? '说明 AI 应该如何搭框架、列提纲、补写、扩写或润色' : '说明人工需要补充、确认或协调的内容'}
                                onChange={(event) => handleUpdateNextActionDraftItem(item.id, { description: event.target.value })}
                              />
                            </Col>
                          </Row>
                        </div>
                      </List.Item>
                    )}
                  />
                  <Space style={{ marginTop: 12 }} wrap>
                    <Button type="primary" icon={<UserOutlined />} onClick={() => handleCreateNextActionTasks('manual')}>
                      生成人工下一步任务
                    </Button>
                    <Button icon={<RobotOutlined />} onClick={() => handleCreateNextActionTasks('ai')}>
                      生成AI下一步任务
                    </Button>
                    <Button icon={<FileTextOutlined />} onClick={handleCreateReportTask}>
                      保存为报告任务
                    </Button>
                    <Button icon={<RobotOutlined />} loading={isGeneratingAiReport} onClick={handleGenerateAiStageReport}>
                      AI写作框架与任务建议
                    </Button>
                  </Space>
                </div>

                {(aiStageReport || isGeneratingAiReport) && (
                  <div style={{ border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 8, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                      <div>
                        <Title level={5} style={{ margin: 0 }}>{aiStageReport?.reportTitle || 'AI写作框架'}</Title>
                        <Text type="secondary">基于模板要求、范文结构、参考内容和当前正文规划</Text>
                      </div>
                      <Button icon={<RobotOutlined />} loading={isGeneratingAiReport} onClick={handleGenerateAiStageReport}>
                        重新生成
                      </Button>
                    </div>

                    {aiStageReport && (
                      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        {/* 报告摘要 */}
                        <div style={{ padding: '12px 14px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>报告摘要</Text>
                          <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                            {aiStageReport.reportSummary || '暂无摘要'}
                          </Paragraph>
                        </div>

                        {/* 质量评估 */}
                        {aiStageReport.qualityAssessment && aiStageReport.qualityAssessment.length > 0 && (
                          <div style={{ padding: '12px 14px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>质量评估</Text>
                            <List
                              size="small"
                              dataSource={aiStageReport.qualityAssessment}
                              renderItem={(item) => <List.Item style={{ paddingLeft: 0 }}><Text>{item}</Text></List.Item>}
                            />
                          </div>
                        )}

                        <div style={{ border: '1px solid #dbeafe', background: '#fff', borderRadius: 10, padding: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <Title level={5} style={{ margin: 0 }}>按章节的问题与建议</Title>
                            <Text type="secondary" style={{ fontSize: 12 }}>按模板一级标题组织；无问题章节不显示</Text>
                          </div>
                          {sectionAdviceItems.length > 0 ? (
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                              {sectionAdviceItems.map((section, sectionIndex) => (
                                <div key={`${section.title}-${sectionIndex}`} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                                  <div style={{ padding: '10px 12px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                    <Text strong>{section.title}</Text>
                                    <Tag color="blue" style={{ margin: 0 }}>一级标题</Tag>
                                  </div>
                                  <Row gutter={0}>
                                    <Col span={12}>
                                      <div style={{ padding: 12, borderRight: '1px solid #eef2f7', minHeight: 120 }}>
                                        <Text strong style={{ color: '#cf1322', display: 'block', marginBottom: 8 }}>问题</Text>
                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                          {(section.problems?.length ? section.problems : ['暂无明确问题']).map((item, index) => (
                                            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.7 }}>
                                              <Tag color={section.problems?.length ? 'red' : 'default'} style={{ margin: 0, flexShrink: 0 }}>{index + 1}</Tag>
                                              <Text type={section.problems?.length ? undefined : 'secondary'}>{item}</Text>
                                            </div>
                                          ))}
                                        </Space>
                                      </div>
                                    </Col>
                                    <Col span={12}>
                                      <div style={{ padding: 12, minHeight: 120 }}>
                                        <Text strong style={{ color: '#1677ff', display: 'block', marginBottom: 8 }}>建议</Text>
                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                          {(section.suggestions?.length ? section.suggestions : ['暂无具体建议']).map((item, index) => (
                                            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.7 }}>
                                              <Tag color={section.suggestions?.length ? 'blue' : 'default'} style={{ margin: 0, flexShrink: 0 }}>{index + 1}</Tag>
                                              <Text type={section.suggestions?.length ? undefined : 'secondary'}>{item}</Text>
                                            </div>
                                          ))}
                                        </Space>
                                      </div>
                                    </Col>
                                  </Row>
                                </div>
                              ))}
                            </Space>
                          ) : (
                            <Empty description="暂无需要展示的问题与建议，请重新生成 AI 写作建议" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          )}
                        </div>

                        <Row gutter={12}>
                          <Col span={12}>
                            <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12, height: '100%' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                <Title level={5} style={{ margin: 0 }}>人工改稿/确认</Title>
                                <Text type="secondary">确认后可进入下方工作流草稿</Text>
                              </div>
                              <List
                                size="small"
                                dataSource={aiStageReport.humanTasks || []}
                                locale={{ emptyText: '暂无人工任务建议' }}
                                renderItem={(item, index) => <List.Item><Space align="start"><Tag color="orange">{index + 1}</Tag><Text>{item}</Text></Space></List.Item>}
                              />
                            </div>
                          </Col>
                          <Col span={12}>
                            <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12, height: '100%' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                <Title level={5} style={{ margin: 0 }}>AI框架/写作</Title>
                                <Text type="secondary">确认后可进入下方工作流草稿</Text>
                              </div>
                              <List
                                size="small"
                                dataSource={aiStageReport.aiTasks || []}
                                locale={{ emptyText: '暂无AI任务建议' }}
                                renderItem={(item, index) => <List.Item><Space align="start"><Tag color="blue">{index + 1}</Tag><Text>{item}</Text></Space></List.Item>}
                              />
                            </div>
                          </Col>
                        </Row>

                        {/* 内容缺口与优化重点 */}
                        {(aiStageReport.contentGaps?.length || aiStageReport.optimizationFocus?.length) ? (
                          <Row gutter={12}>
                            {aiStageReport.contentGaps && aiStageReport.contentGaps.length > 0 && (
                              <Col span={12}>
                                <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12, height: '100%' }}>
                                  <Title level={5} style={{ marginTop: 0 }}>内容缺口</Title>
                                  <List
                                    size="small"
                                    dataSource={aiStageReport.contentGaps}
                                    renderItem={(item) => <List.Item><Text>{item}</Text></List.Item>}
                                  />
                                </div>
                              </Col>
                            )}
                            {aiStageReport.optimizationFocus && aiStageReport.optimizationFocus.length > 0 && (
                              <Col span={aiStageReport.contentGaps?.length ? 12 : 24}>
                                <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12, height: '100%' }}>
                                  <Title level={5} style={{ marginTop: 0 }}>优化重点</Title>
                                  <List
                                    size="small"
                                    dataSource={aiStageReport.optimizationFocus}
                                    renderItem={(item) => <List.Item><Text>{item}</Text></List.Item>}
                                  />
                                </div>
                              </Col>
                            )}
                          </Row>
                        ) : null}

                        <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                            <div>
                              <Title level={5} style={{ margin: 0 }}>工作流草稿</Title>
                              <Text type="secondary">按 AI框架/初稿、人工补资料、AI扩写/润色、人工成稿确认的流转排序，确认前可调整</Text>
                            </div>
                            <Space wrap>
                              <Button size="small" onClick={() => handleAddWorkflowDraftItem('ai')}>增加AI步骤</Button>
                              <Button size="small" onClick={() => handleAddWorkflowDraftItem('manual')}>增加人工步骤</Button>
                              <Button type="primary" size="small" disabled={workflowDraftItems.length === 0} onClick={handleConfirmWorkflowDraft}>确认并生成工作流</Button>
                            </Space>
                          </div>
                          <List
                            size="small"
                            dataSource={[...workflowDraftItems].sort((a, b) => a.order - b.order)}
                            locale={{ emptyText: '暂无工作流草稿，请先生成 AI 报告或手动增加步骤' }}
                            renderItem={(item, index) => (
                              <List.Item style={{ alignItems: 'flex-start' }}>
                                <div style={{ width: '100%' }}>
                                  <Row gutter={[8, 8]} align="middle">
                                    <Col flex="64px"><Tag color={item.type === 'ai' ? 'blue' : 'orange'}>第{index + 1}步</Tag></Col>
                                    <Col flex="112px">
                                      <Select
                                        size="small"
                                        value={item.type}
                                        style={{ width: '100%' }}
                                        options={[{ value: 'ai', label: 'AI执行' }, { value: 'manual', label: '人工处理' }]}
                                        onChange={(value) => handleUpdateWorkflowDraftItem(item.id, { type: value })}
                                      />
                                    </Col>
                                    <Col flex="auto">
                                      <Input
                                        size="small"
                                        value={item.title}
                                        placeholder="输入任务标题"
                                        onChange={(event) => handleUpdateWorkflowDraftItem(item.id, { title: event.target.value })}
                                      />
                                    </Col>
                                    <Col flex="104px">
                                      <Select
                                        size="small"
                                        value={item.priority}
                                        style={{ width: '100%' }}
                                        options={[{ value: 'high', label: '高优先级' }, { value: 'medium', label: '中优先级' }, { value: 'low', label: '低优先级' }]}
                                        onChange={(value) => handleUpdateWorkflowDraftItem(item.id, { priority: value })}
                                      />
                                    </Col>
                                    <Col flex="184px">
                                      <Space size={4}>
                                        <Button size="small" disabled={index === 0} onClick={() => handleMoveWorkflowDraftItem(item.id, 'up')}>上移</Button>
                                        <Button size="small" disabled={index === workflowDraftItems.length - 1} onClick={() => handleMoveWorkflowDraftItem(item.id, 'down')}>下移</Button>
                                        <Button size="small" danger onClick={() => handleDeleteWorkflowDraftItem(item.id)}>删除</Button>
                                      </Space>
                                    </Col>
                                    <Col span={24}>
                                      <Input.TextArea
                                        autoSize={{ minRows: 1, maxRows: 3 }}
                                        value={item.description}
                                        placeholder="补充执行说明，可留空"
                                        onChange={(event) => handleUpdateWorkflowDraftItem(item.id, { description: event.target.value })}
                                      />
                                    </Col>
                                    {item.reason && (
                                      <Col span={24}>
                                        <Text type="secondary">排序理由：{item.reason}</Text>
                                      </Col>
                                    )}
                                  </Row>
                                </div>
                              </List.Item>
                            )}
                          />
                        </div>

                        {/* 原始响应（可折叠，用于调试） */}
                        {aiStageReport.rawText && (
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>
                              查看 AI 原始响应
                            </summary>
                            <pre style={{
                              marginTop: 8,
                              padding: 12,
                              background: '#f8f9fa',
                              borderRadius: 6,
                              fontSize: 11,
                              lineHeight: 1.6,
                              overflow: 'auto',
                              maxHeight: 300,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              color: '#475569',
                            }}>
                              {aiStageReport.rawText}
                            </pre>
                          </details>
                        )}
                      </Space>
                    )}
                  </div>
                )}
              </>
            )}
          </Space>
        </Card>

        <Card
          title={`任务工作台${selectedStage ? ` · ${selectedStage}` : ''}`}
          extra={
            <Space>
              <Select
                size="small"
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 112 }}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'pending', label: '待处理' },
                  { value: 'in_progress', label: '进行中' },
                  { value: 'completed', label: '已完成' },
                ]}
              />
              <Select
                size="small"
                value={sourceFilter}
                onChange={setSourceFilter}
                style={{ width: 112 }}
                options={[
                  { value: 'all', label: '全部来源' },
                  { value: 'manual', label: '手动' },
                  { value: 'review', label: '审查' },
                  { value: 'stage', label: '阶段' },
                  { value: 'report', label: '报告' },
                ]}
              />
            </Space>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {renderTaskGroup('人工任务', '资料、口径、改稿、成稿确认', manualTasks, '#52c41a')}
            {renderTaskGroup('AI任务', '框架、提纲、初稿、扩写、润色', aiTasks, '#1677ff')}
            {renderTaskGroup('工作流任务', '报告页确认后的顺序执行计划', workflowTasks, '#722ed1')}
          </div>
        </Card>
      </Space>

      <Modal
        title="新建任务"
        open={isModalOpen}
        onOk={handleCreate}
        onCancel={() => setIsModalOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'manual', priority: 'medium', source: 'manual' }}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input placeholder="例如：补充可研报告风险章节" />
          </Form.Item>
          <Form.Item name="description" label="任务说明">
            <Input.TextArea rows={3} placeholder="说明任务背景、验收标准或 AI 执行要求" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="type" label="处理方式" rules={[{ required: true, message: '请选择处理方式' }]}>
                <Select options={[{ value: 'manual', label: '人工处理' }, { value: 'ai', label: 'AI 处理' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级">
                <Select options={[{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="source" label="任务来源">
                <Select options={[{ value: 'manual', label: '手动' }, { value: 'stage', label: '阶段' }, { value: 'review', label: '审查' }, { value: 'report', label: '报告' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assigneeName" label="负责人">
                <Input placeholder="未分配" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="stageName" label="关联阶段">
                <Select
                  allowClear
                  options={allStages.map((stage) => ({ value: stage.name, label: stage.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dueAt" label="截止时间">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="relatedDocId" label="关联文档">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={projectDocsList.map((doc) => ({ value: doc.id, label: doc.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TaskPlanner;

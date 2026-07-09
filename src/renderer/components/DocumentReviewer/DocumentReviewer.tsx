import React, { useEffect, useState, useMemo } from 'react';
import {
  Card,
  Button,
  Select,
  Space,
  Typography,
  message,
  Tag,
  Progress,
  Empty,
  Checkbox,
  Divider,
  Row,
  Col,
  Statistic,
  Alert,
  Input,
  Spin,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  SwapOutlined,
  RobotOutlined,
  PlusOutlined,
  SyncOutlined,
  EditOutlined,
  DeleteOutlined,
  SaveOutlined,
  CloseOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTaskStore } from '../../stores/taskStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { DocumentVersion, ProjectDocument, ReviewConfig, ReviewIssue, ReviewResult, TaskItem } from '../../../shared/types';
import { detectTimelineStage, getAllStages } from '../../utils/timelineStages';
import DiffMatchPatch from 'diff-match-patch';
import { composePrompt } from '../../utils/promptComposer';
import { buildLifecyclePatch, reviewLifecycleStatus } from '../../utils/documentLifecycle';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';

const { Title, Text, Paragraph } = Typography;


type ReviewerDocKind =
  | 'guide_document'
  | 'guide_instruction'
  | 'proposal_form'
  | 'feasibility_report'
  | 'task_book'
  | 'contract'
  | 'budget'
  | 'acceptance_report'
  | 'summary_report'
  | 'review_opinion';

const reviewerKindLabels: Record<ReviewerDocKind, string> = {
  guide_document: '申报指南正文',
  guide_instruction: '指南编制说明',
  proposal_form: '提案表',
  feasibility_report: '可研报告',
  task_book: '任务书',
  contract: '合同',
  budget: '预算/经费文件',
  acceptance_report: '验收报告',
  summary_report: '总结报告',
  review_opinion: '审查意见',
};

const reviewerKindGroups = [
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

const normalizeReviewerMatchText = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(' ').toLowerCase();

const findReviewerKindGroup = (text: string) =>
  reviewerKindGroups.find(group => group.some(token => text.includes(token.toLowerCase())));

const reviewerTemplateMatchesKind = (template: { name?: string; category?: string; description?: string }, group?: string[]) => {
  if (!group) return false;
  const templateText = normalizeReviewerMatchText(template.name, template.category, template.description);
  return group.some(token => templateText.includes(token.toLowerCase()));
};

const inferReviewerKindFromText = (value: string): ReviewerDocKind | undefined => {
  const text = value.toLowerCase();
  if (/编制说明|填写说明|指南说明/.test(text)) return 'guide_instruction';
  if (/项目申报指南|申报指南/.test(text)) return 'guide_document';
  if (/提案表|提案/.test(text)) return 'proposal_form';
  if (/可研报告|可行性研究|可研/.test(text)) return 'feasibility_report';
  if (/任务书/.test(text)) return 'task_book';
  if (/合同/.test(text)) return 'contract';
  if (/预算|经费/.test(text)) return 'budget';
  if (/验收报告|验收/.test(text)) return 'acceptance_report';
  if (/总结报告|总结/.test(text)) return 'summary_report';
  if (/审查意见|审查/.test(text)) return 'review_opinion';
  if (/指南/.test(text)) return 'guide_document';
  return undefined;
};

const inferReviewerTemplateKind = (template?: { name?: string; category?: string; description?: string }) =>
  template ? inferReviewerKindFromText(normalizeReviewerMatchText(template.name, template.category, template.description)) : undefined;

const inferReviewerProjectDocKind = (doc?: ProjectDocument, version?: DocumentVersion) =>
  doc ? inferReviewerKindFromText(normalizeReviewerMatchText(doc.name, doc.sourceFilePath, version?.fileName, version?.filePath)) : undefined;

const reviewerKindsCompatible = (templateKind?: ReviewerDocKind, docKind?: ReviewerDocKind) => {
  if (!templateKind || !docKind) return true;
  return templateKind === docKind;
};

const buildKindMismatchMessage = (templateKind?: ReviewerDocKind, docKind?: ReviewerDocKind) => {
  if (!templateKind || !docKind || reviewerKindsCompatible(templateKind, docKind)) return '';
  return `当前选择的是「${reviewerKindLabels[templateKind]}」模板，但文件看起来是「${reviewerKindLabels[docKind]}」。如果继续检查缺失章节，会把另一类文档的章节当作硬性要求，容易产生误判。`;
};

const getFileExtension = (fileName = '') => {
  const cleanName = fileName.split(/[\\/]/).pop() || fileName;
  const dotIndex = cleanName.lastIndexOf('.');
  return dotIndex >= 0 ? cleanName.slice(dotIndex).toLowerCase() : '';
};

const getFileBaseName = (filePath = '') => filePath.split(/[\\/]/).pop() || filePath;

const inferVersionFileType = (fileName = ''): DocumentVersion['fileType'] => {
  const ext = getFileExtension(fileName);
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.rtf'].includes(ext)) return 'txt';
  return 'docx';
};

const formatVersionDate = (dateStr?: string) => {
  if (!dateStr) return '未知时间';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

type AiSuggestionBlock = {
  id: string;
  title: string;
  problem: string;
  suggestion: string;
};

type AiRewriteVariant = {
  id: string;
  modelName: string;
  ok: boolean;
  replacement: string;
  reason?: string;
  error?: string;
};

type AiRewritePreview = {
  id: string;
  title: string;
  original: string;
  replacement: string;
  reason?: string;
  status?: 'pending' | 'accepted';
  variants?: AiRewriteVariant[];
};

type ReviewSectionFinding = {
  key: string;
  title: string;
  issues: ReviewIssue[];
  aiProblems: string[];
  aiSuggestions: string[];
};

const splitLongSuggestionLine = (line: string) => {
  if (line.length <= 120) return [line];
  return line
    .replace(/([。；;])\s*/g, '$1\n')
    .replace(/(\s(?=\d+[.、]\s))/g, '\n')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
};

const cleanAiSuggestionLine = (line: string) =>
  line
    .replace(/^[-*\s]+/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .replace(/^【(.+)】$/, '$1')
    .replace(/^#+\s*/, '')
    .trim();

const normalizeReviewSectionKey = (value = '') =>
  cleanAiSuggestionLine(value)
    .replace(/^章节[:：]\s*/, '')
    .replace(/^部分[:：]\s*/, '')
    .replace(/^项目\d+\s*[-—:：]\s*/, '')
    .replace(/^第\s*\d+\s*部分\s*[:：-]?\s*/, '')
    .replace(/\s+/g, '')
    .replace(/[：:，,。；;（）()【】\[\]《》<>“”"'\-—_]/g, '')
    .toLowerCase();

const isSameReviewSection = (left = '', right = '') => {
  const a = normalizeReviewSectionKey(left);
  const b = normalizeReviewSectionKey(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

const isAiSuggestionHeading = (line: string) => {
  const clean = cleanAiSuggestionLine(line);
  if (!clean) return false;
  if (/^(问题|建议|修改|改稿|修订|可改为|参考修改|建议修改|具体修改)[:：]/.test(clean)) return false;
  if (/^[一二三四五六七八九十]+[、.．]/.test(clean)) return true;
  if (/^第\s*\d+\s*部分/.test(clean)) return true;
  if (/^章节[:：]/.test(clean)) return true;
  return clean.length <= 48 && /章节|部分|结构|内容|格式|成果|期限|经费|指标|目标|需求|研究|应用|风险/.test(clean) && !/[。；;]/.test(clean);
};

const stripAiPreface = (value: string) =>
  value
    .replace(/^好的[，,。\s].*?(?=\n|$)/, '')
    .replace(/^作为.*?助手[，,。\s].*?(?=\n|$)/, '')
    .replace(/总体评估[:：]?[\s\S]*?(?=\n##|\n[一二三四五六七八九十]+[、.．]|$)/, '')
    .trim();

const splitAiSuggestionText = (value = ''): AiSuggestionBlock[] => {
  const normalized = stripAiPreface(value)
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .replace(/\`\`\`[\s\S]*?\`\`\`/g, block => block.replace(/\`\`\`/g, ''))
    .replace(/---+/g, '\n')
    .replace(/\[error\]/gi, '')
    .replace(/\[warning\]/gi, '')
    .replace(/(问题[:：]|建议[:：]|修改[:：]|改稿[:：]|修订[:：]|可改为[:：]|参考修改[:：]|建议修改[:：]|具体修改[:：])/g, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  const blocks: Array<{ title: string; problemLines: string[]; suggestionLines: string[] }> = [];
  let current: { title: string; problemLines: string[]; suggestionLines: string[] } | null = null;
  let mode: 'problem' | 'suggestion' = 'problem';

  const ensureCurrent = () => {
    if (!current) current = { title: `建议 ${blocks.length + 1}`, problemLines: [], suggestionLines: [] };
    return current;
  };

  const pushCurrent = () => {
    if (!current) return;
    const problem = current.problemLines.join('\n').trim();
    const suggestion = current.suggestionLines.join('\n').trim();
    if ((problem || suggestion) && !/^建议\s*\d+$/.test(current.title)) blocks.push(current);
    current = null;
    mode = 'problem';
  };

  const lines = normalized
    .split('\n')
    .map(line => cleanAiSuggestionLine(line))
    .filter(Boolean);

  for (const line of lines) {
    if (isAiSuggestionHeading(line)) {
      pushCurrent();
      current = { title: cleanAiSuggestionLine(line).replace(/[：:]$/, ''), problemLines: [], suggestionLines: [] };
      mode = 'problem';
      continue;
    }

    const problemMatch = line.match(/^(问题|主要问题|风险|不足|现状问题)[:：]?\s*(.*)$/);
    if (problemMatch) {
      mode = 'problem';
      const rest = problemMatch[2]?.trim();
      if (rest) ensureCurrent().problemLines.push(...splitLongSuggestionLine(rest));
      continue;
    }

    const suggestionMatch = line.match(/^(建议|审查建议|优化建议|修改|修改建议|改稿|改写|修订|可改为|参考修改|建议修改|具体修改)[:：]?\s*(.*)$/);
    if (suggestionMatch) {
      mode = 'suggestion';
      const rest = suggestionMatch[2]?.trim();
      if (rest) ensureCurrent().suggestionLines.push(...splitLongSuggestionLine(rest));
      continue;
    }

    const target = mode === 'suggestion' ? ensureCurrent().suggestionLines : ensureCurrent().problemLines;
    target.push(...splitLongSuggestionLine(line));
  }
  pushCurrent();

  return blocks
    .map((block, index) => ({
      id: `ai-suggestion-${index}`,
      title: block.title,
      problem: block.problemLines.join('\n').trim(),
      suggestion: block.suggestionLines.join('\n').trim(),
    }))
    .filter(block => block.problem || block.suggestion);
};


const DocumentReviewer: React.FC<{ onBack?: () => void; focus?: import('../../../shared/types').WorkbenchFocus }> = ({ onBack, focus }) => {
  const {
    currentProject,
    currentStageName,
    versions,
    pendingWorkflowFocus,
    loadVersions,
    addVersion,
    setCurrentStageName,
    setPendingWorkflowFocus,
  } = useProjectStore();
  const { templates, reviews, loadTemplates, loadReviews, executeReview } = useTemplateStore();
  const { projectDocs, loadProjectDocs, updateProjectDoc } = useProjectDocStore();
  const { tasks, loadTasks, addTask } = useTaskStore();
  const { customStages } = useSettingsStore();
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [syncingDocId, setSyncingDocId] = useState<string>('');
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>({
    checkMissingSections: true,
    checkFormatting: true,
    checkContentDeviation: true,
    enableAI: false,
  });

  // 版本对比状态
  const [selectedVersionA, setSelectedVersionA] = useState<string>('');
  const [selectedVersionB, setSelectedVersionB] = useState<string>('');
  const [stageCompareFiles, setStageCompareFiles] = useState<Array<{ name: string; path: string; ext: string; size: number; createdAt: string; modifiedAt: string }>>([]);
  const [parsedCompareContent, setParsedCompareContent] = useState<Record<string, string>>({});
  const [parsingCompareIds, setParsingCompareIds] = useState<Record<string, boolean>>({});
  const [formatCompareById, setFormatCompareById] = useState<Record<string, { loading?: boolean; error?: string; paragraphs?: any[] }>>({});
  const [selectedFormatDiffKeys, setSelectedFormatDiffKeys] = useState<Record<string, boolean>>({});
  const [applyingFormat, setApplyingFormat] = useState('');
  const [isAnalyzingDiff, setIsAnalyzingDiff] = useState(false);
  const [diffAnalysis, setDiffAnalysis] = useState<string>('');
  const [editingSuggestionKey, setEditingSuggestionKey] = useState<string>('');
  const [expandedSuggestionKey, setExpandedSuggestionKey] = useState<string>('');
  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, string>>({});
  const [deletedSuggestionKeys, setDeletedSuggestionKeys] = useState<Record<string, boolean>>({});
  const [createdSuggestionTaskKeys, setCreatedSuggestionTaskKeys] = useState<Record<string, boolean>>({});
  const [aiAssistPrompt, setAiAssistPrompt] = useState('');
  const [aiAssistPromptSuggestion, setAiAssistPromptSuggestion] = useState('');
  const [focusedWorkflowTaskId, setFocusedWorkflowTaskId] = useState('');
  const [aiRewritePreviews, setAiRewritePreviews] = useState<AiRewritePreview[]>([]);
  const [isGeneratingRewritePlan, setIsGeneratingRewritePlan] = useState(false);
  const [applyingRewriteId, setApplyingRewriteId] = useState('');
  const [selectedReviewTaskKeys, setSelectedReviewTaskKeys] = useState<Record<string, boolean>>({});
  const [customIssueEditorOpen, setCustomIssueEditorOpen] = useState(false);
  const [customIssueDraft, setCustomIssueDraft] = useState({ sectionTitle: '', message: '', suggestion: '' });
  const [customReviewIssuesByReview, setCustomReviewIssuesByReview] = useState<Record<string, ReviewIssue[]>>({});

  useEffect(() => {
    loadVersions();
    loadTemplates();
    loadReviews();
    loadProjectDocs();
    loadTasks();
  }, []);


  const projectVersions = currentProject ? versions.filter(v => v.projectId === currentProject.id) : [];
  const projectReviews = currentProject
    ? reviews
      .filter(r => r.projectId === currentProject.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const projectTasks = currentProject ? tasks.filter(t => t.projectId === currentProject.id) : [];
  const latestReview = projectReviews[0];
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);

  const getProjectDocStageName = (doc: ProjectDocument) => {
    const template = templates.find(t => t.id === doc.templateId);
    const version = doc.versionId ? projectVersions.find(item => item.id === doc.versionId) : undefined;
    return detectTimelineStage(
      allStages,
      doc.name,
      doc.sourceFilePath,
      template?.name,
      template?.category,
      version?.fileName,
    );
  };

  const getReviewTemplateStageName = (template: typeof templates[number]) => {
    if (allStages.some(stage => stage.name === template.category)) return template.category;
    return detectTimelineStage(allStages, template.name, template.description, template.category);
  };

  const reviewerStageOptions = useMemo(() => {
    return allStages.map(stage => {
      const templateCount = templates.filter(template => getReviewTemplateStageName(template) === stage.name).length;
      const docCount = currentProject
        ? projectDocs.filter(doc => doc.projectId === currentProject.id && getProjectDocStageName(doc) === stage.name).length
        : 0;
      return {
        value: stage.name,
        label: `${stage.name}\uff08\u6a21\u677f ${templateCount} / \u6587\u4ef6 ${docCount}\uff09`,
        templateCount,
        docCount,
      };
    });
  }, [allStages, currentProject?.id, projectDocs, projectVersions, templates]);

  useEffect(() => {
    if (!currentProject || currentStageName) return;
    const preferredStage = reviewerStageOptions.find(option => option.templateCount > 0 || option.docCount > 0) || reviewerStageOptions[0];
    if (preferredStage) setCurrentStageName(preferredStage.value);
  }, [currentProject?.id, currentStageName, reviewerStageOptions, setCurrentStageName]);

  const visibleTemplates = useMemo(() => {
    if (!currentStageName) return [];
    const stageScopedTemplates = templates.filter(template => getReviewTemplateStageName(template) === currentStageName);
    const stageDocKinds = new Set(
      projectDocs
        .filter(doc => currentProject && doc.projectId === currentProject.id && getProjectDocStageName(doc) === currentStageName)
        .map(doc => inferReviewerProjectDocKind(doc, doc.versionId ? projectVersions.find(item => item.id === doc.versionId) : undefined))
        .filter(Boolean) as ReviewerDocKind[]
    );
    return [...stageScopedTemplates].sort((a, b) => {
      const aKind = inferReviewerTemplateKind(a);
      const bKind = inferReviewerTemplateKind(b);
      const aScore = aKind && stageDocKinds.has(aKind) ? 1 : 0;
      const bScore = bKind && stageDocKinds.has(bKind) ? 1 : 0;
      return bScore - aScore || new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
  }, [currentProject?.id, currentStageName, projectDocs, projectVersions, templates]);

  useEffect(() => {
    if (!currentProject || !currentStageName) return;
    if (visibleTemplates.length === 0) {
      if (selectedTemplate) setSelectedTemplate('');
      if (selectedDocId) setSelectedDocId('');
      return;
    }
    if (selectedTemplate && visibleTemplates.some(template => template.id === selectedTemplate)) return;
    setSelectedTemplate(visibleTemplates[0].id);
    setSelectedDocId('');
  }, [currentProject?.id, currentStageName, selectedDocId, selectedTemplate, visibleTemplates]);

  // Stage-first review: list files in the selected stage first, then sort by template compatibility.
  const matchedDocs = useMemo(() => {
    if (!currentProject || !currentStageName) return [];
    const selectedTpl = templates.find(t => t.id === selectedTemplate);
    const selectedKind = inferReviewerTemplateKind(selectedTpl);
    const stageDocs = projectDocs.filter(doc => doc.projectId === currentProject.id && getProjectDocStageName(doc) === currentStageName);
    return [...stageDocs].sort((a, b) => {
      const aVersion = a.versionId ? projectVersions.find(item => item.id === a.versionId) : undefined;
      const bVersion = b.versionId ? projectVersions.find(item => item.id === b.versionId) : undefined;
      const aKind = inferReviewerProjectDocKind(a, aVersion);
      const bKind = inferReviewerProjectDocKind(b, bVersion);
      const aScore = selectedKind && aKind && reviewerKindsCompatible(selectedKind, aKind) ? 1 : 0;
      const bScore = selectedKind && bKind && reviewerKindsCompatible(selectedKind, bKind) ? 1 : 0;
      return bScore - aScore || new Date(b.analyzedAt || b.createdAt).getTime() - new Date(a.analyzedAt || a.createdAt).getTime();
    });
  }, [currentProject?.id, currentStageName, projectDocs, projectVersions, selectedTemplate, templates]);

  useEffect(() => {
    if (!pendingWorkflowFocus || pendingWorkflowFocus.target !== 'review') return;
    if (!currentProject || pendingWorkflowFocus.projectId !== currentProject.id) return;

    if (pendingWorkflowFocus.stageName && pendingWorkflowFocus.stageName !== currentStageName) {
      setCurrentStageName(pendingWorkflowFocus.stageName);
    }

    if (pendingWorkflowFocus.relatedDocId) {
      const targetDoc = projectDocs.find(doc => doc.id === pendingWorkflowFocus.relatedDocId);
      if (targetDoc) {
        const targetTemplateId = targetDoc.templateId || selectedTemplate;
        if (targetTemplateId) setSelectedTemplate(targetTemplateId);
        setSelectedDocId(targetDoc.id);
      }
    }

    setFocusedWorkflowTaskId(pendingWorkflowFocus.taskId || '');
    setAiAssistPrompt('');
    setAiAssistPromptSuggestion(pendingWorkflowFocus.prompt || '');
    setAiRewritePreviews([]);
    setPendingWorkflowFocus(null);
  }, [
    currentProject?.id,
    currentStageName,
    pendingWorkflowFocus,
    projectDocs,
    selectedTemplate,
    setCurrentStageName,
    setPendingWorkflowFocus,
  ]);

  useEffect(() => {
    if (pendingWorkflowFocus?.target === 'review') return;
    const firstDocId = matchedDocs[0]?.id || '';
    if (firstDocId && !matchedDocs.some(doc => doc.id === selectedDocId)) {
      setSelectedDocId(firstDocId);
    }
    if (!firstDocId && selectedDocId) {
      setSelectedDocId('');
    }
  }, [matchedDocs, pendingWorkflowFocus?.target, selectedDocId]);

  // 选中文档后，获取其关联的版本
  const selectedDoc = matchedDocs.find(d => d.id === selectedDocId);

  const getDocumentVersion = (doc?: ProjectDocument) => {
    if (!doc) return undefined;
    if (doc.versionId) {
      const byId = projectVersions.find(version => version.id === doc.versionId);
      if (byId) return byId;
    }
    return projectVersions.find(version =>
      Boolean(doc.sourceFilePath && version.filePath === doc.sourceFilePath) ||
      version.fileName === doc.name
    );
  };

  const ensureDocumentVersion = async (doc: ProjectDocument): Promise<string> => {
    if (!currentProject) throw new Error('请先选择项目');
    const existingVersion = getDocumentVersion(doc);
    if (existingVersion) {
      if (doc.versionId !== existingVersion.id) {
        await updateProjectDoc(doc.id, { versionId: existingVersion.id, ...buildLifecyclePatch('identified') });
      }
      return existingVersion.id;
    }

    const sourcePath = doc.sourceFilePath;
    if (!sourcePath) {
      throw new Error('该阶段文档没有原始文件路径，请先在项目文件中重新关联或导入文件');
    }

    setSyncingDocId(doc.id);
    try {
      const parsed = await window.electronAPI.parseDocument(sourcePath);
      const content = parsed.content?.trim();
      if (!parsed.success || !content) {
        throw new Error(parsed.error || '未能从该文件提取到可审查内容');
      }

      const now = new Date().toISOString();
      const fileName = parsed.fileName || doc.name || getFileBaseName(sourcePath);
      const version: DocumentVersion = {
        id: `version-${doc.id}-${Date.now()}`,
        projectId: currentProject.id,
        fileName,
        filePath: parsed.convertedFilePath || sourcePath,
        fileType: inferVersionFileType(fileName || sourcePath),
        content,
        createdAt: doc.sourceFileCreatedAt || doc.createdAt || now,
      };

      await addVersion(version);
      await updateProjectDoc(doc.id, {
        versionId: version.id,
        sourceFilePath: doc.sourceFilePath || sourcePath,
        sourceFileModifiedAt: doc.sourceFileModifiedAt || now,
        ...buildLifecyclePatch('identified'),
      });
      await loadVersions();
      return version.id;
    } finally {
      setSyncingDocId('');
    }
  };

  const handleSyncDocumentVersion = async (doc: ProjectDocument) => {
    try {
      await ensureDocumentVersion(doc);
      message.success('已同步为可审查版本');
    } catch (error: any) {
      message.error(error.message || '同步版本失败');
    }
  };

  const selectedDocVersion = getDocumentVersion(selectedDoc);
  const selectedTemplateMeta = templates.find(t => t.id === selectedTemplate);
  const selectedTemplateKind = inferReviewerTemplateKind(selectedTemplateMeta);
  const selectedDocKind = inferReviewerProjectDocKind(selectedDoc, selectedDocVersion);
  const templateDocMismatchMessage = buildKindMismatchMessage(selectedTemplateKind, selectedDocKind);
  const shouldBlockMissingSectionReview = Boolean(templateDocMismatchMessage && reviewConfig.checkMissingSections);

  useEffect(() => {
    if (!selectedDoc || !selectedTemplate) return;
    if (selectedDoc.templateId === selectedTemplate) return;
    updateProjectDoc(selectedDoc.id, { templateId: selectedTemplate });
  }, [selectedDoc?.id, selectedDoc?.templateId, selectedTemplate]);


  const hasTaskForIssue = (reviewId: string, issueId: string) =>
    projectTasks.some(task => task.relatedReviewId === reviewId && task.relatedIssueId === issueId);

  const getIssueTaskKey = (reviewId: string, issueId: string) => reviewId + ':issue:' + issueId;

  const toggleReviewTaskSelection = (key: string, checked: boolean) => {
    setSelectedReviewTaskKeys(prev => ({ ...prev, [key]: checked }));
  };

  const getReviewIssues = (review: ReviewResult) => [
    ...review.issues,
    ...(customReviewIssuesByReview[review.id] || []),
  ];

  const buildIssueTask = (review: ReviewResult, issue: ReviewIssue, index = 0): TaskItem => {
    const template = templates.find(t => t.id === review.templateId);
    const relatedDoc = projectDocs.find(doc => doc.versionId === review.versionId);
    const priority: TaskItem['priority'] = issue.severity === 'error'
      ? 'high'
      : issue.severity === 'warning'
        ? 'medium'
        : 'low';

    return {
      id: `${Date.now()}-${index}-${issue.id}`,
      projectId: review.projectId,
      title: issue.sectionTitle ? `处理审查问题：${issue.sectionTitle}` : '处理审查问题',
      description: [issue.message, issue.suggestion ? `建议：${issue.suggestion}` : ''].filter(Boolean).join('\n'),
      type: 'manual',
      status: 'pending',
      priority,
      source: 'review',
      relatedDocId: relatedDoc?.id,
      relatedReviewId: review.id,
      relatedIssueId: issue.id,
      sectionTitle: issue.sectionTitle,
      stageName: template?.category,
      createdAt: new Date().toISOString(),
    };
  };

  const buildAiSuggestionTask = (review: ReviewResult, sectionTitle: string, suggestionKey: string, suggestionText: string): TaskItem => {
    const template = templates.find(t => t.id === review.templateId);
    const relatedDoc = projectDocs.find(doc => doc.versionId === review.versionId);
    return {
      id: `${Date.now()}-${suggestionKey}`,
      projectId: review.projectId,
      title: sectionTitle ? `处理 AI 建议：${sectionTitle}` : '处理 AI 审查建议',
      description: suggestionText.trim(),
      type: 'manual',
      status: 'pending',
      priority: 'medium',
      source: 'review',
      relatedDocId: relatedDoc?.id,
      relatedReviewId: review.id,
      sectionTitle,
      stageName: template?.category,
      createdAt: new Date().toISOString(),
    };
  };

  const handleCreateReviewTasks = async (review: ReviewResult) => {
    const selectedKeys = Object.entries(selectedReviewTaskKeys).filter(([, checked]) => checked).map(([key]) => key);
    if (selectedKeys.length === 0) {
      message.warning('请先勾选要生成任务的问题或建议');
      return;
    }

    let createdCount = 0;
    const createdKeys: Record<string, boolean> = {};
    const allIssues = getReviewIssues(review);
    for (let i = 0; i < allIssues.length; i++) {
      const issue = allIssues[i];
      const key = getIssueTaskKey(review.id, issue.id);
      if (!selectedReviewTaskKeys[key] || hasTaskForIssue(review.id, issue.id)) continue;
      await addTask(buildIssueTask(review, issue, i));
      createdKeys[key] = false;
      createdCount += 1;
    }

    const findings = buildReviewSectionFindings(review);
    for (const section of findings) {
      const sectionKey = normalizeReviewSectionKey(section.title);
      const aiSuggestionItems = normalizeReviewDisplayItems(section.aiSuggestions, 5);
      for (let index = 0; index < aiSuggestionItems.length; index++) {
        const suggestionKey = review.id + ':' + sectionKey + ':ai:' + index;
        if (!selectedReviewTaskKeys[suggestionKey] || deletedSuggestionKeys[suggestionKey] || createdSuggestionTaskKeys[suggestionKey]) continue;
        const value = (suggestionDrafts[suggestionKey] ?? aiSuggestionItems[index]).trim();
        if (!value) continue;
        await addTask(buildAiSuggestionTask(review, section.title, suggestionKey, value));
        setCreatedSuggestionTaskKeys(prev => ({ ...prev, [suggestionKey]: true }));
        createdKeys[suggestionKey] = false;
        createdCount += 1;
      }
    }

    if (createdCount === 0) {
      message.info('选中项已生成任务或内容为空');
      return;
    }
    setSelectedReviewTaskKeys(prev => ({ ...prev, ...createdKeys }));
    message.success(`已生成 ${createdCount} 个任务`);
  };

  const handleAddCustomReviewIssue = (review: ReviewResult) => {
    const messageText = customIssueDraft.message.trim();
    if (!messageText) {
      message.warning('请先填写审查问题');
      return;
    }
    const issue: ReviewIssue = {
      id: 'custom-' + Date.now(),
      type: 'suggestion',
      severity: 'warning',
      sectionTitle: customIssueDraft.sectionTitle.trim() || '用户补充',
      message: messageText,
      suggestion: customIssueDraft.suggestion.trim() || undefined,
    };
    setCustomReviewIssuesByReview(prev => ({
      ...prev,
      [review.id]: [...(prev[review.id] || []), issue],
    }));
    setSelectedReviewTaskKeys(prev => ({ ...prev, [getIssueTaskKey(review.id, issue.id)]: true }));
    setCustomIssueDraft({ sectionTitle: '', message: '', suggestion: '' });
    setCustomIssueEditorOpen(false);
  };

  const handleCreateAiSuggestionTask = async (review: ReviewResult, sectionTitle: string, suggestionKey: string, suggestionText: string) => {
    const content = suggestionText.trim();
    if (!content) {
      message.warning('建议内容为空，无法生成任务');
      return;
    }
    if (createdSuggestionTaskKeys[suggestionKey]) {
      message.info('该 AI 建议已生成任务');
      return;
    }
    await addTask(buildAiSuggestionTask(review, sectionTitle, suggestionKey, content));
    setCreatedSuggestionTaskKeys(prev => ({ ...prev, [suggestionKey]: true }));
    message.success('已根据 AI 建议生成任务');
  };

  const handleStartReview = async () => {
    if (!selectedTemplate) {
      message.warning('请选择审查模板');
      return;
    }
    if (!selectedDoc) {
      message.warning('请选择要审查的文件');
      return;
    }
    if (shouldBlockMissingSectionReview) {
      message.warning('模板与文件类型不匹配，请先更换模板或关闭缺失章节检查');
      return;
    }
    setIsReviewing(true);
    try {
      const versionId = await ensureDocumentVersion(selectedDoc);
      const result = await executeReview(versionId, selectedTemplate, reviewConfig);
      if (result.success) {
        if (result.result) {
          const reviewedAt = new Date().toISOString();
          await updateProjectDoc(selectedDoc.id, {
            reviewedAt,
            ...buildLifecyclePatch(reviewLifecycleStatus(result.result.issues), reviewedAt),
          });
        }
        message.success('审查完成');
      } else {
        message.error(result.error || '审查失败');
      }
    } catch (error: any) {
      message.error(`审查失败: ${error.message}`);
    } finally {
      setIsReviewing(false);
    }
  };

  // 版本对比相关函数：同阶段项目文件都可参与，不要求先同步成版本或完成审查。
  type ReviewerComparableVersion = {
    id: string;
    source: 'version' | 'project-doc' | 'project-file';
    fileName: string;
    filePath?: string;
    content: string;
    createdAt: string;
    modifiedAt?: string;
  };

  const compareFileExts = new Set(['.doc', '.docx', '.pdf', '.txt', '.md', '.rtf', '.ppt', '.pptx', '.xls', '.xlsx']);
  const normalizeComparePath = (value = '') => value.trim().toLowerCase();
  const getCompareSourceLabel = (source: ReviewerComparableVersion['source']) => {
    if (source === 'project-doc') return '项目文档';
    if (source === 'project-file') return '项目文件';
    return '版本记录';
  };
  const getCompareStage = (...parts: Array<string | undefined>) => detectTimelineStage(allStages, ...parts);

  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      if (!currentProject?.folderPath) {
        setStageCompareFiles([]);
        return;
      }
      try {
        const result = await window.electronAPI.scanStageFiles(currentProject.folderPath);
        if (!cancelled) setStageCompareFiles(result.success ? result.files || [] : []);
      } catch (error) {
        console.warn('Failed to scan reviewer compare files:', error);
        if (!cancelled) setStageCompareFiles([]);
      }
    };
    void scan();
    return () => { cancelled = true; };
  }, [currentProject?.id, currentProject?.folderPath]);

  // 行级 diff：先按行拆分，再对每行做字符级 diff 高亮
  type DiffLine = { type: 'equal' | 'insert' | 'delete'; text: string; lineA?: number; lineB?: number; charDiffs?: [number, string][] };

  const computeLineDiff = (textA: string, textB: string): DiffLine[] => {
    const dmp = new DiffMatchPatch();
    const lineDiffs = dmp.diff_linesToChars_(textA, textB);
    const diffs = dmp.diff_main(lineDiffs.chars1, lineDiffs.chars2, false);
    dmp.diff_charsToLines_(diffs, lineDiffs.lineArray);
    dmp.diff_cleanupSemantic(diffs);

    const result: DiffLine[] = [];
    let lineA = 1, lineB = 1;
    for (const [op, text] of diffs) {
      const lines = text.split('\n');
      const actualLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
      for (const line of actualLines) {
        if (op === 0) {
          result.push({ type: 'equal', text: line, lineA, lineB });
          lineA++;
          lineB++;
        } else if (op === -1) {
          result.push({ type: 'delete', text: line, lineA });
          lineA++;
        } else if (op === 1) {
          result.push({ type: 'insert', text: line, lineB });
          lineB++;
        }
      }
    }
    return result;
  };

  const comparableVersions = useMemo((): ReviewerComparableVersion[] => {
    if (!currentProject) return [];
    const currentStage = currentStageName || '';
    const isSameStage = (...parts: Array<string | undefined>) => !currentStage || getCompareStage(...parts) === currentStage;
    const usedPaths = new Set<string>();
    const usedVersionIds = new Set<string>();
    const items: ReviewerComparableVersion[] = [];

    for (const doc of projectDocs) {
      if (doc.projectId !== currentProject.id) continue;
      const version = getDocumentVersion(doc);
      const filePath = doc.sourceFilePath || version?.filePath || '';
      const fileName = version?.fileName || getFileBaseName(filePath) || doc.name;
      const stageOk = isSameStage(doc.name, doc.sourceFilePath, version?.fileName, version?.filePath);
      if (!stageOk) continue;
      if (filePath) usedPaths.add(normalizeComparePath(filePath));
      if (version?.id) usedVersionIds.add(version.id);
      items.push({
        id: `doc:${doc.id}`,
        source: 'project-doc',
        fileName,
        filePath,
        content: parsedCompareContent[`doc:${doc.id}`] || version?.content || '',
        createdAt: doc.sourceFileCreatedAt || version?.createdAt || doc.createdAt,
        modifiedAt: doc.sourceFileModifiedAt || doc.analyzedAt || version?.createdAt || doc.createdAt,
      });
    }

    for (const version of projectVersions) {
      if (usedVersionIds.has(version.id)) continue;
      if (!isSameStage(version.fileName, version.filePath)) continue;
      if (version.filePath) usedPaths.add(normalizeComparePath(version.filePath));
      items.push({
        id: `version:${version.id}`,
        source: 'version',
        fileName: version.fileName,
        filePath: version.filePath,
        content: parsedCompareContent[`version:${version.id}`] || version.content || '',
        createdAt: version.createdAt,
        modifiedAt: version.createdAt,
      });
    }

    for (const file of stageCompareFiles) {
      if (!compareFileExts.has(String(file.ext || '').toLowerCase())) continue;
      if (!isSameStage(file.name, file.path)) continue;
      const pathKey = normalizeComparePath(file.path);
      if (usedPaths.has(pathKey)) continue;
      const id = `file:${file.path}`;
      items.push({
        id,
        source: 'project-file',
        fileName: file.name || getFileBaseName(file.path),
        filePath: file.path,
        content: parsedCompareContent[id] || '',
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt || file.createdAt,
      });
      usedPaths.add(pathKey);
    }

    return items.sort((a, b) => {
      const bTime = new Date(b.modifiedAt || b.createdAt).getTime();
      const aTime = new Date(a.modifiedAt || a.createdAt).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [currentProject?.id, currentStageName, projectDocs, projectVersions, stageCompareFiles, parsedCompareContent]);

  const selectedVersionMetaA = comparableVersions.find(version => version.id === selectedVersionA);
  const selectedVersionMetaB = comparableVersions.find(version => version.id === selectedVersionB);

  useEffect(() => {
    if (selectedVersionA && !comparableVersions.some(version => version.id === selectedVersionA)) setSelectedVersionA('');
    if (selectedVersionB && !comparableVersions.some(version => version.id === selectedVersionB)) setSelectedVersionB('');
  }, [comparableVersions, selectedVersionA, selectedVersionB]);

  const ensureCompareContent = async (item?: ReviewerComparableVersion) => {
    if (!item || item.content || !item.filePath || parsedCompareContent[item.id] || parsingCompareIds[item.id]) return;
    setParsingCompareIds(prev => ({ ...prev, [item.id]: true }));
    try {
      const parser = window.electronAPI.parseDocumentSilent || window.electronAPI.parseDocument;
      const parsed = await parser(item.filePath);
      let content = parsed.success ? parsed.content?.trim() || '' : '';
      const ext = getFileExtension(item.fileName || item.filePath);
      if (!content && ['.txt', '.md'].includes(ext)) {
        content = (await window.electronAPI.readFile(item.filePath)).trim();
      }
      if (content) setParsedCompareContent(prev => ({ ...prev, [item.id]: content }));
    } catch (error) {
      console.warn('Failed to parse reviewer compare document:', error);
    } finally {
      setParsingCompareIds(prev => ({ ...prev, [item.id]: false }));
    }
  };

  useEffect(() => {
    void ensureCompareContent(selectedVersionMetaA);
    void ensureCompareContent(selectedVersionMetaB);
  }, [selectedVersionA, selectedVersionB, selectedVersionMetaA?.filePath, selectedVersionMetaB?.filePath]);

  const contentA = selectedVersionMetaA?.content || '';
  const contentB = selectedVersionMetaB?.content || '';

  const diffResult = useMemo((): DiffLine[] => {
    if (!selectedVersionA || !selectedVersionB) return [];
    return computeLineDiff(contentA, contentB);
  }, [contentA, contentB, selectedVersionA, selectedVersionB]);

  const diffStats = useMemo(() => {
    let insert = 0, deleteCount = 0, equal = 0;
    for (const line of diffResult) {
      if (line.type === 'equal') equal++;
      else if (line.type === 'insert') insert++;
      else if (line.type === 'delete') deleteCount++;
    }
    return { insert, delete: deleteCount, equal, total: insert + deleteCount + equal };
  }, [diffResult]);
  type FormatDiffFieldChange = {
    fieldKey: string;
    label: string;
    left: string;
    right: string;
    text: string;
  };

  type FormatDiffItem = {
    key: string;
    index: number;
    title: string;
    aText: string;
    bText: string;
    diffs: string[];
    fieldChanges: FormatDiffFieldChange[];
    summary: string;
  };

  const formatFields: Array<{ key: string; label: string }> = [
    { key: 'key', label: '段落类型' },
    { key: 'styleName', label: '样式' },
    { key: 'fontFamily', label: '字体' },
    { key: 'fontSize', label: '字号' },
    { key: 'fontWeight', label: '加粗' },
    { key: 'fontStyle', label: '斜体' },
    { key: 'alignment', label: '对齐方式' },
    { key: 'lineHeight', label: '行距' },
    { key: 'indentFirstLine', label: '首行缩进' },
    { key: 'spaceBefore', label: '段前间距' },
    { key: 'spaceAfter', label: '段后间距' },
  ];

  const styleNameLabels: Record<string, string> = {
    body: '正文样式',
    normal: '正文样式',
    paragraph: '普通段落',
    title: '标题样式',
    subtitle: '副标题样式',
    heading: '标题样式',
    heading1: '一级标题',
    heading2: '二级标题',
    heading3: '三级标题',
    heading4: '四级标题',
    heading5: '五级标题',
    heading6: '六级标题',
  };

  const normalizeFormatToken = (value: any) => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const formatValue = (value: any) => value === undefined || value === null || value === '' ? '未识别' : String(value);
  const formatReadableValue = (fieldKey: string, value: any) => {
    const raw = formatValue(value);
    const token = normalizeFormatToken(raw);
    if (raw === '未识别') return raw;
    if (fieldKey === 'key' || fieldKey === 'styleName') return styleNameLabels[token] || raw;
    if (fieldKey === 'fontWeight') {
      if (['bold', 'bolder', '700', '800', '900', 'true', '1'].includes(token)) return '加粗';
      if (['normal', 'regular', '400', 'false', '0'].includes(token)) return '不加粗';
    }
    if (fieldKey === 'fontStyle') {
      if (['italic', 'oblique', 'true', '1'].includes(token)) return '斜体';
      if (['normal', 'false', '0'].includes(token)) return '不斜体';
    }
    if (fieldKey === 'alignment') {
      const alignmentMap: Record<string, string> = {
        left: '左对齐',
        center: '居中对齐',
        centre: '居中对齐',
        right: '右对齐',
        justify: '两端对齐',
        both: '两端对齐',
        distribute: '分散对齐',
      };
      return alignmentMap[token] || raw;
    }
    return raw;
  };
  const buildFormatDiffText = (_fieldKey: string, label: string, left: string, right: string) =>
    `${label}不同：A 是${left}，B 是${right}`;
  const previewCompareText = (value = '') => value.replace(/\s+/g, ' ').slice(0, 42) || '空段落';
  const canReadFormat = (item?: ReviewerComparableVersion) => Boolean(item?.filePath && ['.doc', '.docx'].includes(getFileExtension(item.filePath || item.fileName)));

  const ensureCompareFormat = async (item?: ReviewerComparableVersion) => {
    if (!item || !canReadFormat(item) || !window.electronAPI.extractTemplateFormatRules) return;
    const cached = formatCompareById[item.id];
    if (cached?.loading || cached?.paragraphs || cached?.error) return;
    setFormatCompareById(prev => ({ ...prev, [item.id]: { loading: true } }));
    try {
      const result = await window.electronAPI.extractTemplateFormatRules!(item.filePath!);
      setFormatCompareById(prev => ({
        ...prev,
        [item.id]: result.success
          ? { paragraphs: result.paragraphs || [] }
          : { error: result.error || '格式提取失败' },
      }));
    } catch (error: any) {
      setFormatCompareById(prev => ({ ...prev, [item.id]: { error: error?.message || '格式提取失败' } }));
    }
  };

  useEffect(() => {
    void ensureCompareFormat(selectedVersionMetaA);
    void ensureCompareFormat(selectedVersionMetaB);
  }, [selectedVersionA, selectedVersionB, selectedVersionMetaA?.filePath, selectedVersionMetaB?.filePath]);

  const formatDiffs = useMemo((): FormatDiffItem[] => {
    const paragraphsA = selectedVersionMetaA ? formatCompareById[selectedVersionMetaA.id]?.paragraphs || [] : [];
    const paragraphsB = selectedVersionMetaB ? formatCompareById[selectedVersionMetaB.id]?.paragraphs || [] : [];
    const max = Math.min(Math.max(paragraphsA.length, paragraphsB.length), 80);
    const result: FormatDiffItem[] = [];
    for (let index = 0; index < max; index++) {
      const a = paragraphsA[index];
      const b = paragraphsB[index];
      if (!a || !b) continue;
      const fieldChanges = formatFields
        .map(field => {
          const leftRaw = formatValue(a[field.key]);
          const rightRaw = formatValue(b[field.key]);
          if (leftRaw === rightRaw) return null;
          const left = formatReadableValue(field.key, leftRaw);
          const right = formatReadableValue(field.key, rightRaw);
          return {
            fieldKey: field.key,
            label: field.label,
            left,
            right,
            text: buildFormatDiffText(field.key, field.label, left, right),
          };
        })
        .filter(Boolean) as FormatDiffFieldChange[];
      if (!fieldChanges.length) continue;
      const diffs = fieldChanges.map(item => item.text);
      result.push({
        key: `format-${index}`,
        index,
        title: `第 ${index + 1} 段格式不一致`,
        aText: previewCompareText(a.text),
        bText: previewCompareText(b.text),
        diffs,
        fieldChanges,
        summary: fieldChanges.slice(0, 2).map(item => item.text).join('；') + (fieldChanges.length > 2 ? ` 等 ${fieldChanges.length} 项` : ''),
      });
    }
    return result;
  }, [formatCompareById, selectedVersionMetaA?.id, selectedVersionMetaB?.id]);

  useEffect(() => {
    setSelectedFormatDiffKeys({});
  }, [selectedVersionA, selectedVersionB]);

  const selectedFormatDiffs = formatDiffs.filter(item => selectedFormatDiffKeys[item.key]);
  const selectedFormatDiffKeySet = useMemo(() => new Set(selectedFormatDiffs.map(item => item.key)), [selectedFormatDiffs]);
  const formatDiffByLine = useMemo(() => new Map(formatDiffs.map(item => [item.index + 1, item])), [formatDiffs]);
  type DiffRow = { left?: DiffLine; right?: DiffLine; formatDiff?: FormatDiffItem };

  const diffRows = useMemo((): DiffRow[] => {
    const rows: DiffRow[] = [];
    const resolveFormatDiff = (left?: DiffLine, right?: DiffLine) => {
      const leftHit = left?.lineA ? formatDiffByLine.get(left.lineA) : undefined;
      const rightHit = right?.lineB ? formatDiffByLine.get(right.lineB) : undefined;
      return leftHit || rightHit;
    };

    for (let index = 0; index < diffResult.length; index++) {
      const line = diffResult[index];
      if (line.type === 'equal') {
        rows.push({ left: line, right: line, formatDiff: resolveFormatDiff(line, line) });
        continue;
      }

      if (line.type === 'delete') {
        const deletes: DiffLine[] = [];
        while (index < diffResult.length && diffResult[index].type === 'delete') {
          deletes.push(diffResult[index]);
          index++;
        }
        const inserts: DiffLine[] = [];
        while (index < diffResult.length && diffResult[index].type === 'insert') {
          inserts.push(diffResult[index]);
          index++;
        }
        index--;
        const count = Math.max(deletes.length, inserts.length);
        for (let offset = 0; offset < count; offset++) {
          const left = deletes[offset];
          const right = inserts[offset];
          rows.push({ left, right, formatDiff: resolveFormatDiff(left, right) });
        }
        continue;
      }

      const inserts: DiffLine[] = [];
      while (index < diffResult.length && diffResult[index].type === 'insert') {
        inserts.push(diffResult[index]);
        index++;
      }
      index--;
      for (const right of inserts) rows.push({ right, formatDiff: resolveFormatDiff(undefined, right) });
    }
    return rows;
  }, [diffResult, formatDiffByLine]);

  const toggleFormatDiff = (key: string, checked: boolean) => {
    setSelectedFormatDiffKeys(prev => ({ ...prev, [key]: checked }));
  };

  const handleApplySelectedFormat = async (sourceSide: 'A' | 'B') => {
    const source = sourceSide === 'A' ? selectedVersionMetaA : selectedVersionMetaB;
    const target = sourceSide === 'A' ? selectedVersionMetaB : selectedVersionMetaA;
    if (!source || !target) {
      message.warning('请先选择两个文档');
      return;
    }
    if (!window.electronAPI.applyDocumentParagraphFormats) {
      message.warning('当前版本暂不支持格式套用');
      return;
    }
    if (!source.filePath || !target.filePath) {
      message.warning('源文档或目标文档缺少文件路径');
      return;
    }
    if (getFileExtension(target.filePath) !== '.docx') {
      message.warning('目前只支持把格式套用到 .docx 文档');
      return;
    }
    const paragraphIndices = selectedFormatDiffs.map(item => item.index);
    if (paragraphIndices.length === 0) {
      message.warning('请先勾选需要套用格式的段落');
      return;
    }

    setApplyingFormat(sourceSide);
    try {
      const result = await window.electronAPI.applyDocumentParagraphFormats({
        sourcePath: source.filePath,
        targetPath: target.filePath,
        paragraphIndices,
      });
      if (!result.success) {
        message.error(result.error || '格式套用失败');
        return;
      }
      setFormatCompareById(prev => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setSelectedFormatDiffKeys({});
      message.success(`已套用 ${result.appliedCount || paragraphIndices.length} 段格式${result.backupPath ? '，原文件已备份' : ''}`);
      void ensureCompareFormat(target);
    } finally {
      setApplyingFormat('');
    }
  };
  const getSelectedDocumentPath = () => {
    if (!selectedDoc) return '';
    return selectedDoc.sourceFilePath || getDocumentVersion(selectedDoc)?.filePath || '';
  };

  const parseAiRewritePreviews = (raw: string, sourceName = 'AI\u7248\u672c'): AiRewritePreview[] => {
    const text = String(raw || '').trim();
    const jsonText = text.match(/\[[\s\S]*\]/)?.[0] || text.match(/\{[\s\S]*\}/)?.[0] || '';
    try {
      const parsed = JSON.parse(jsonText);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
      return items
        .map((item: any, index: number) => ({
          id: 'rewrite-' + Date.now() + '-' + index,
          title: String(item.title || item.section || '修改建议 ' + (index + 1)).trim(),
          original: String(item.original || item.originalText || '').trim(),
          replacement: String(item.replacement || item.revised || item.revisedText || item.suggestion || '').trim(),
          reason: String(item.reason || item.explanation || '').trim(),
          status: 'pending' as const,
          variants: [{
            id: 'variant-' + Date.now() + '-' + index,
            modelName: sourceName,
            ok: true,
            replacement: String(item.replacement || item.revised || item.revisedText || item.suggestion || '').trim(),
            reason: String(item.reason || item.explanation || '').trim(),
          }],
        }))
        .filter((item: AiRewritePreview) => item.original && item.replacement);
    } catch {
      return [];
    }
  };

  const updateAiRewritePreview = (id: string, updates: Partial<AiRewritePreview>) => {
    setAiRewritePreviews(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };


  const normalizeRewriteOriginalKey = (value: string) => String(value || '')
    .replace(/\s+/g, '')
    .slice(0, 180);

  const mergeParallelRewritePreviews = (groups: Array<{ modelName: string; ok: boolean; error?: string; previews: AiRewritePreview[] }>) => {
    const merged: AiRewritePreview[] = [];
    const byKey = new Map<string, AiRewritePreview>();
    groups.forEach((group, groupIndex) => {
      group.previews.forEach((preview, previewIndex) => {
        const key = normalizeRewriteOriginalKey(preview.original) || `${groupIndex}-${previewIndex}-${preview.title}`;
        let target = byKey.get(key);
        const variant: AiRewriteVariant = {
          id: `${groupIndex}-${previewIndex}-${Date.now()}`,
          modelName: group.modelName,
          ok: group.ok,
          replacement: preview.replacement,
          reason: preview.reason,
          error: group.error,
        };
        if (!target) {
          target = {
            ...preview,
            id: `rewrite-${Date.now()}-${merged.length}`,
            variants: [variant],
          };
          byKey.set(key, target);
          merged.push(target);
        } else {
          target.variants = [...(target.variants || []), variant];
        }
      });
    });
    return merged;
  };

  const handleGenerateRewritePlan = async () => {
    const instruction = (aiAssistPrompt || aiAssistPromptSuggestion).trim();
    const filePath = getSelectedDocumentPath();
    if (!selectedDoc || !filePath) {
      message.warning('请先选择要修改的文档');
      return;
    }
    if (!instruction) {
      message.warning('请先填写或按 Tab 填充修改提示词');
      return;
    }

    setIsGeneratingRewritePlan(true);
    try {
      const parsed = await window.electronAPI.parseDocument(filePath);
      if (!parsed.success || !parsed.content) {
        message.error(parsed.error || '未能读取文档内容');
        return;
      }
      const prompt = composePrompt('rewrite', {
        sectionTitle: '（全文改稿）',
        requirement: `修改要求：${instruction}`,
        example: 'None',
        stageMemory: 'None',
        reference: 'None',
        currentContent: parsed.content.slice(0, 16000),
      });
      const aiConfig = await window.electronAPI.loadAIConfig();
      const useParallel = aiConfig?.multiModelMode === 'parallel' && (aiConfig.parallelModelIds?.length || 0) > 1 && window.electronAPI.callAIParallelDetails;
      let previews: AiRewritePreview[] = [];
      if (useParallel) {
        const details = await useAIJobStore.getState().runAIJob<{ synthesis?: string; variants: Array<{ modelName: string; ok: boolean; output: string; error?: string }> }>(
          {
            scene: 'rewrite',
            title: '生成审核修订预览',
            projectId: currentProject?.id,
            resultPreview: () => '已生成审核修订预览',
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAIParallelDetails({ prompt, config: aiConfig, modelIds: aiConfig.parallelModelIds, modelId: aiConfig.activeModelId });
            throwIfCancelled();
            setProgress(85);
            return value;
          },
        );
        previews = mergeParallelRewritePreviews(details.variants.map(variant => ({
          modelName: variant.modelName,
          ok: variant.ok,
          error: variant.error,
          previews: variant.ok ? parseAiRewritePreviews(variant.output, variant.modelName) : [],
        })));
        if (previews.length === 0 && details.synthesis) {
          previews = parseAiRewritePreviews(details.synthesis, '\u7efc\u5408\u7248\u672c');
        }
      } else {
        const result = await useAIJobStore.getState().runAIJob<string>(
          {
            scene: 'rewrite',
            title: '生成审核修订预览',
            projectId: currentProject?.id,
            resultPreview: (value) => value,
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAI({ prompt });
            throwIfCancelled();
            setProgress(85);
            return String(value || '');
          },
        );
        previews = parseAiRewritePreviews(result);
      }
      if (previews.length === 0) {
        message.warning('AI \u672a\u751f\u6210\u53ef\u76f4\u63a5\u66ff\u6362\u7684\u539f\u6587\u5757\uff0c\u8bf7\u8865\u5145\u66f4\u660e\u786e\u7684\u95ee\u9898\u63cf\u8ff0\u540e\u91cd\u8bd5');
      }
      setAiRewritePreviews(previews);
    } catch (error: any) {
      message.error('生成修改预览失败：' + (error.message || String(error)));
    } finally {
      setIsGeneratingRewritePlan(false);
    }
  };

  const handleAcceptRewrite = async (preview: AiRewritePreview, variant?: AiRewriteVariant) => {
    const filePath = getSelectedDocumentPath();
    if (!filePath) {
      message.warning('未找到当前文档的源文件路径');
      return;
    }
    const replacementText = (variant?.replacement || preview.replacement || '').trim();
    if (!preview.original.trim() || !replacementText) {
      message.warning('原文和建议修改都不能为空');
      return;
    }

    setApplyingRewriteId(preview.id);
    try {
      const result = await window.electronAPI.replaceDocumentText({
        filePath,
        originalText: preview.original,
        replacementText,
      });
      if (!result.success) {
        message.error(result.error || '替换失败');
        return;
      }
      updateAiRewritePreview(preview.id, { status: 'accepted' });
      await loadVersions();
      message.success(result.backupPath ? '已替换原文，并已自动备份原文件' : '已替换原文');
    } catch (error: any) {
      message.error('接受修改失败：' + (error.message || String(error)));
    } finally {
      setApplyingRewriteId('');
    }
  };

  const handleAiDiffAnalysis = async () => {
    if (!selectedVersionA || !selectedVersionB) {
      message.warning('请先选择两个版本');
      return;
    }
    setIsAnalyzingDiff(true);
    setDiffAnalysis('');
    try {
      const versionA = versions.find(v => v.id === selectedVersionA);
      const versionB = versions.find(v => v.id === selectedVersionB);
      const prompt = composePrompt('diff', {
        versionAName: versionA?.fileName || '未知',
        contentA: contentA.substring(0, 12000),
        versionBName: versionB?.fileName || '未知',
        contentB: contentB.substring(0, 12000),
      });

      const aiConfig = await window.electronAPI.loadAIConfig();
      const useParallel = aiConfig?.multiModelMode === 'parallel' && (aiConfig.parallelModelIds?.length || 0) > 1 && window.electronAPI.callAIParallelDetails;
      if (useParallel) {
        const details = await useAIJobStore.getState().runAIJob<{ synthesis: string; variants: Array<{ modelName: string; ok: boolean }> }>(
          {
            scene: 'diff',
            title: 'AI 分析版本差异',
            projectId: currentProject?.id,
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
        const sourceLine = details.variants
          .map(variant => `${variant.modelName}${variant.ok ? '\u5df2\u53c2\u4e0e' : '\u5931\u8d25'}`)
          .join('?');
        setDiffAnalysis(`${details.synthesis}

---
\u5e76\u884c\u6a21\u578b\u6765\u6e90\uff1a${sourceLine}`);
      } else {
        const result = await useAIJobStore.getState().runAIJob<string>(
          {
            scene: 'diff',
            title: 'AI 分析版本差异',
            projectId: currentProject?.id,
            resultPreview: (value) => value,
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAI({ prompt });
            throwIfCancelled();
            setProgress(85);
            return String(value || '');
          },
        );
        setDiffAnalysis(result);
      }
    } catch (error: any) {
      message.error(`AI 分析失败: ${error.message}`);
    } finally {
      setIsAnalyzingDiff(false);
    }
  };

  const getIssueIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'warning':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'info':
        return <InfoCircleOutlined style={{ color: '#1677ff' }} />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  const getIssueTag = (type: string) => {
    switch (type) {
      case 'missing_section':
        return <Tag color="red">缺失章节</Tag>;
      case 'wrong_format':
        return <Tag color="orange">格式错误</Tag>;
      case 'content_deviation':
        return <Tag color="yellow">内容偏差</Tag>;
      default:
        return <Tag>其他</Tag>;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#52c41a';
    if (score >= 60) return '#faad14';
    return '#ff4d4f';
  };

  const normalizeReviewDisplayItems = (lines: string[], maxItems = 6) => {
    const seen = new Set<string>();
    const items = lines
      .flatMap(line => String(line || '')
        .replace(/\r/g, '')
        .replace(/^>\s*/gm, '')
        .replace(/[“”]/g, '"')
        .replace(/^["']|["']$/g, '')
        .replace(/\n+/g, '\n')
        .split(/\n|(?<=。)\s*(?=同样|例如|在原有|采用|建议|当前|程序|需人工|具体|补充)/)
      )
      .map(line => cleanAiSuggestionLine(line)
        .replace(/^[-•·]\s*/, '')
        .replace(/^[:：]+/, '')
        .replace(/^["']|["']$/g, '')
        .trim()
      )
      .filter(line => line && !/^(具体|表达|补充材料\/表达|以下是具体的改稿|的回应)$/.test(line))
      .filter(line => {
        const key = normalizeReviewSectionKey(line);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return items.slice(0, maxItems);
  };

  const renderReviewItems = (items: string[], tone: 'problem' | 'suggestion') => {
    if (items.length === 0) {
      return <Text type="secondary">{tone === 'problem' ? '暂无具体问题描述。' : '暂无建议。'}</Text>;
    }
    const color = tone === 'problem' ? '#ff4d4f' : '#1677ff';
    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {items.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{
              width: 20,
              height: 20,
              lineHeight: '20px',
              textAlign: 'center',
              borderRadius: 10,
              background: tone === 'problem' ? '#fff1f0' : '#e6f4ff',
              color,
              fontSize: 12,
              flex: '0 0 auto',
              marginTop: 2,
            }}>
              {index + 1}
            </span>
            <Paragraph
              style={{ marginBottom: 0, color: '#1f2937', lineHeight: 1.85, fontSize: 14 }}
              ellipsis={item.length > 260 ? { rows: 3, expandable: true, symbol: tone === 'problem' ? '展开问题' : '展开建议' } : false}
            >
              {item}
            </Paragraph>
          </div>
        ))}
      </Space>
    );
  };

  const renderIssueItems = (review: ReviewResult, issues: ReviewIssue[]) => {
    if (issues.length === 0) return <Text type="secondary">暂无具体问题描述。</Text>;

    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {issues.map((issue, index) => {
          const key = getIssueTaskKey(review.id, issue.id);
          const disabled = hasTaskForIssue(review.id, issue.id);
          return (
            <div key={issue.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Checkbox
                checked={Boolean(selectedReviewTaskKeys[key])}
                disabled={disabled}
                onChange={(event) => toggleReviewTaskSelection(key, event.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{
                width: 20,
                height: 20,
                lineHeight: '20px',
                textAlign: 'center',
                borderRadius: 10,
                background: '#fff1f0',
                color: '#ff4d4f',
                fontSize: 12,
                flex: '0 0 auto',
                marginTop: 2,
              }}>
                {index + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Space size={6} wrap style={{ marginBottom: 4 }}>
                  {getIssueTag(issue.type)}
                  {disabled && <Tag color="green">已生成任务</Tag>}
                  {issue.id.startsWith('custom-') && <Tag color="purple">用户补充</Tag>}
                </Space>
                <Paragraph style={{ marginBottom: issue.suggestion ? 4 : 0, color: '#1f2937', lineHeight: 1.85, fontSize: 14 }}>
                  {issue.message}
                </Paragraph>
                {issue.suggestion && (
                  <Text type="secondary" style={{ display: 'block', lineHeight: 1.7 }}>建议：{issue.suggestion}</Text>
                )}
              </div>
            </div>
          );
        })}
      </Space>
    );
  };

  const renderEditableAiSuggestionItems = (review: ReviewResult, sectionTitle: string, items: string[], startIndex = 0) => {
    const sectionKey = normalizeReviewSectionKey(sectionTitle);
    const visibleItems = items
      .map((item, index) => ({ item, originalIndex: index }))
      .filter(({ originalIndex }) => !deletedSuggestionKeys[review.id + ':' + sectionKey + ':ai:' + originalIndex]);

    if (visibleItems.length === 0) return null;

    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {visibleItems.map(({ item, originalIndex }, visibleIndex) => {
          const suggestionKey = review.id + ':' + sectionKey + ':ai:' + originalIndex;
          const value = suggestionDrafts[suggestionKey] ?? item;
          const isEditing = editingSuggestionKey === suggestionKey;
          const isExpanded = expandedSuggestionKey === suggestionKey || isEditing;
          const isCreated = createdSuggestionTaskKeys[suggestionKey];
          const disabledByTask = isCreated;

          return (
            <div
              key={suggestionKey}
              style={{
                border: isExpanded ? '1px solid #91caff' : '1px solid #e5eefc',
                background: isExpanded ? '#ffffff' : '#f8fbff',
                borderRadius: 8,
                padding: isExpanded ? '10px 12px' : '8px 12px',
                cursor: isEditing ? 'default' : 'pointer',
                boxShadow: isExpanded ? '0 4px 14px rgba(22, 119, 255, 0.08)' : 'none',
                transition: 'all 0.16s ease',
              }}
              onClick={() => {
                if (!isEditing) setExpandedSuggestionKey(isExpanded ? '' : suggestionKey);
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 28 }}>
                <Checkbox
                  checked={Boolean(selectedReviewTaskKeys[suggestionKey])}
                  disabled={disabledByTask}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => toggleReviewTaskSelection(suggestionKey, event.target.checked)}
                />
                <span style={{
                  width: 22,
                  height: 22,
                  lineHeight: '22px',
                  textAlign: 'center',
                  borderRadius: 11,
                  background: isExpanded ? '#1677ff' : '#e6f4ff',
                  color: isExpanded ? '#fff' : '#1677ff',
                  fontSize: 12,
                  flex: '0 0 auto',
                }}>
                  {startIndex + visibleIndex + 1}
                </span>
                <Text
                  style={{ flex: 1, minWidth: 0, color: '#1f2937' }}
                  ellipsis={!isExpanded ? { tooltip: value } : false}
                >
                  {value}
                </Text>
                {isCreated && <Tag color="green" style={{ marginInlineEnd: 0 }}>{'\u5df2\u751f\u6210'}</Tag>}
              </div>

              {isExpanded && (
                <div
                  style={{ marginTop: 10, paddingLeft: 32 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {isEditing ? (
                    <Input.TextArea
                      value={value}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      onChange={(event) => setSuggestionDrafts(prev => ({ ...prev, [suggestionKey]: event.target.value }))}
                    />
                  ) : (
                    <Paragraph style={{ marginBottom: 0, color: '#334155', lineHeight: 1.8, fontSize: 14 }}>
                      {value}
                    </Paragraph>
                  )}

                  <Space size={8} wrap style={{ marginTop: 8 }}>
                    {isEditing ? (
                      <>
                        <Button
                          size="small"
                          icon={<SaveOutlined />}
                          onClick={() => {
                            setEditingSuggestionKey('');
                            message.success('\u5df2\u66f4\u65b0\u5efa\u8bae\u5185\u5bb9');
                          }}
                        >
                          {'\u4fdd\u5b58'}
                        </Button>
                        <Button
                          size="small"
                          icon={<CloseOutlined />}
                          onClick={() => {
                            setSuggestionDrafts(prev => ({ ...prev, [suggestionKey]: item }));
                            setEditingSuggestionKey('');
                          }}
                        >
                          {'\u53d6\u6d88'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setSuggestionDrafts(prev => ({ ...prev, [suggestionKey]: value }));
                          setExpandedSuggestionKey(suggestionKey);
                          setEditingSuggestionKey(suggestionKey);
                        }}
                      >
                        {'\u7f16\u8f91'}
                      </Button>
                    )}
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        setDeletedSuggestionKeys(prev => ({ ...prev, [suggestionKey]: true }));
                        if (expandedSuggestionKey === suggestionKey) setExpandedSuggestionKey('');
                      }}
                    >
                      {'\u5220\u9664'}
                    </Button>

                  </Space>
                </div>
              )}
            </div>
          );
        })}
      </Space>
    );
  };

  const buildReviewSectionFindings = (review: ReviewResult): ReviewSectionFinding[] => {
    const sectionMap = new Map<string, ReviewSectionFinding>();

    const ensureSection = (title: string) => {
      const fallbackTitle = title || '未归类问题';
      const key = normalizeReviewSectionKey(fallbackTitle) || fallbackTitle;
      const existing = sectionMap.get(key);
      if (existing) return existing;
      const next: ReviewSectionFinding = {
        key,
        title: fallbackTitle,
        issues: [],
        aiProblems: [],
        aiSuggestions: [],
      };
      sectionMap.set(key, next);
      return next;
    };

    getReviewIssues(review).forEach(issue => {
      ensureSection(issue.sectionTitle || '未归类问题').issues.push(issue);
    });

    splitAiSuggestionText(review.aiSuggestions || '').forEach(block => {
      let section = Array.from(sectionMap.values()).find(item => isSameReviewSection(item.title, block.title));
      if (!section) section = ensureSection(block.title);
      if (block.problem) section.aiProblems.push(block.problem);
      if (block.suggestion) section.aiSuggestions.push(block.suggestion);
    });

    return Array.from(sectionMap.values()).filter(section =>
      section.issues.length > 0 || section.aiProblems.length > 0 || section.aiSuggestions.length > 0
    );
  };

  const renderReviewSectionFindings = (review: ReviewResult) => {
    const findings = buildReviewSectionFindings(review);
    if (findings.length === 0) {
      return <Empty description="暂未发现需要处理的问题" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {findings.map(section => {
          const issueSuggestions = section.issues.map(issue => issue.suggestion).filter(Boolean) as string[];
          const problemLines = [
            ...section.issues.map(issue => issue.message),
            ...section.aiProblems,
          ].filter(Boolean);
          const suggestionLines = issueSuggestions.filter(Boolean);
          const aiSuggestionItems = normalizeReviewDisplayItems(section.aiSuggestions, 5);

          const problemItems = normalizeReviewDisplayItems(problemLines, 5);
          const suggestionItems = normalizeReviewDisplayItems(suggestionLines, 5);

          return (
            <div key={section.key} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
                <Text strong style={{ fontSize: 16, marginRight: 4 }}>{section.title}</Text>
                {section.issues.map(issue => (
                  <span key={issue.id}>{getIssueTag(issue.type)}</span>
                ))}
                {section.aiProblems.length > 0 || section.aiSuggestions.length > 0 ? <Tag color="blue">AI补充</Tag> : null}
              </div>

              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div style={{ borderLeft: '3px solid #ff7875', background: '#fffafa', padding: '12px 14px', borderRadius: 6 }}>
                  <Text strong style={{ display: 'block', marginBottom: 8, color: '#a8071a' }}>问题</Text>
                  {renderIssueItems(review, section.issues)}
                  {section.aiProblems.length > 0 && (
                    <div style={{ marginTop: section.issues.length > 0 ? 10 : 0 }}>
                      {renderReviewItems(normalizeReviewDisplayItems(section.aiProblems, 5), 'problem')}
                    </div>
                  )}
                </div>
                <div style={{ borderLeft: '3px solid #69b1ff', background: '#f8fbff', padding: '12px 14px', borderRadius: 6 }}>
                  <Text strong style={{ display: 'block', marginBottom: 8, color: '#0958d9' }}>建议</Text>
                  {suggestionItems.length > 0 && renderReviewItems(suggestionItems, 'suggestion')}
                  {aiSuggestionItems.length > 0 && (
                    <div style={{ marginTop: suggestionItems.length > 0 ? 10 : 0, paddingTop: suggestionItems.length > 0 ? 10 : 0, borderTop: suggestionItems.length > 0 ? '1px solid #dbeafe' : 'none' }}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{'\u70b9\u51fb\u5efa\u8bae\u6761\u76ee\u540e\u53ef\u7f16\u8f91\u3001\u5220\u9664\u6216\u751f\u6210\u4efb\u52a1'}</Text>
                      {renderEditableAiSuggestionItems(review, section.title, aiSuggestionItems, suggestionItems.length)}
                    </div>
                  )}
                </div>
              </Space>

            </div>
          );
        })}
      </Space>
    );
  };


  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
          <Title level={4} style={{ margin: 0 }}>文档审查</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>对比模板要求审查文档，查看AI建议和版本差异</Text>
      </div>

      {aiAssistPromptSuggestion && (
        <Card
          title="\u5ba1\u67e5 - AI\u534f\u4f5c"
          style={{ marginBottom: 16, borderColor: '#91caff' }}
          extra={focusedWorkflowTaskId ? <Tag color="blue">{'\u6765\u81ea\u5de5\u4f5c\u6d41'}</Tag> : null}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text type="secondary">{'\u70b9\u51fb\u8f93\u5165\u6846\u540e\u6309 Tab\uff0c\u81ea\u52a8\u586b\u5145\u5f53\u524d\u5de5\u4f5c\u6d41\u95ee\u9898\u7684\u63d0\u793a\u8bcd\u3002'}</Text>
            <Input.TextArea
              value={aiAssistPrompt}
              autoSize={{ minRows: 4, maxRows: 10 }}
              placeholder="\u6309 Tab \u81ea\u52a8\u586b\u5145\u63d0\u793a\u8bcd"
              onChange={(event) => setAiAssistPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Tab' && !aiAssistPrompt.trim()) {
                  event.preventDefault();
                  setAiAssistPrompt(aiAssistPromptSuggestion);
                }
              }}
            />
            <Space wrap>
              <Button size="small" onClick={() => setAiAssistPrompt(aiAssistPromptSuggestion)}>{'\u586b\u5145\u63d0\u793a\u8bcd'}</Button>
              <Button size="small" onClick={() => setAiAssistPrompt('')}>{'\u6e05\u7a7a'}</Button>
              <Button size="small" type="primary" icon={<RobotOutlined />} loading={isGeneratingRewritePlan} onClick={handleGenerateRewritePlan}>
                {'\u751f\u6210\u4fee\u6539\u9884\u89c8'}
              </Button>
            </Space>
            {aiRewritePreviews.length > 0 && (
              <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
                {aiRewritePreviews.map(preview => (
                  <div key={preview.id} style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 12, background: '#f8fbff' }}>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space wrap>
                        <Text strong>{preview.title}</Text>
                        {preview.status === 'accepted' ? <Tag color="green">{'\u5df2\u91c7\u7528'}</Tag> : null}
                      </Space>
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, background: '#fff' }}>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>{'\u5f85\u66ff\u6362\u539f\u6587'}</Text>
                        <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 3, expandable: true }}>{preview.original}</Paragraph>
                      </div>
                      <Row gutter={[10, 10]}>
                        {(preview.variants?.length ? preview.variants : [{ id: 'default', modelName: 'AI\u7248\u672c', ok: true, replacement: preview.replacement, reason: preview.reason }]).map(variant => (
                          <Col key={variant.id} xs={24} md={preview.variants && preview.variants.length > 1 ? 12 : 24}>
                            <div style={{ height: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' }}>
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                  <Tag color={variant.ok ? 'blue' : 'red'}>{variant.modelName}</Tag>
                                  <Button
                                    size="small"
                                    type="primary"
                                    disabled={!variant.ok || !variant.replacement.trim() || preview.status === 'accepted'}
                                    loading={applyingRewriteId === `${preview.id}:${variant.id}`}
                                    onClick={() => handleAcceptRewrite(preview, variant)}
                                  >
                                    {'\u91c7\u7528\u6b64\u7248\u672c'}
                                  </Button>
                                </Space>
                                {variant.error ? <Text type="danger">{variant.error}</Text> : null}
                                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 5, expandable: true }}>{variant.replacement}</Paragraph>
                                {variant.reason ? <Text type="secondary">{variant.reason}</Text> : null}
                              </Space>
                            </div>
                          </Col>
                        ))}
                      </Row>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Space>
        </Card>
      )}


      {/* 文档审查 */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>{'\u9009\u62e9\u5ba1\u67e5\u9636\u6bb5'}</Text>
              <Select
                placeholder={'先选择要审查的阶段'}
                style={{ width: '100%' }}
                value={currentStageName || undefined}
                onChange={(val) => {
                  setCurrentStageName(val);
                  setSelectedTemplate('');
                  setSelectedDocId('');
                }}
                options={reviewerStageOptions.map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </Col>
            <Col xs={24} md={16}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>{'\u9009\u62e9\u5ba1\u67e5\u6a21\u677f\u6216\u7248\u672c'}</Text>
              <Select
                placeholder={currentStageName ? '\u9009\u62e9\u5f53\u524d\u9636\u6bb5\u5185\u7684\u6a21\u677f' : '\u8bf7\u5148\u9009\u62e9\u9636\u6bb5'}
                style={{ width: '100%' }}
                value={selectedTemplate || undefined}
                disabled={!currentStageName}
                notFoundContent={currentStageName ? '\u5f53\u524d\u9636\u6bb5\u6682\u65e0\u6a21\u677f' : '\u8bf7\u5148\u9009\u62e9\u9636\u6bb5'}
                onChange={(val) => { setSelectedTemplate(val); setSelectedDocId(''); }}
                options={visibleTemplates.map(t => {
                  const typeLabel = t.templateType === 'example' ? '\u8303\u6587\u6a21\u677f' : '\u76f4\u63a5\u6a21\u677f';
                  return {
                    value: t.id,
                    label: `${t.name}\uff08${typeLabel} \u00b7 ${formatVersionDate(t.updatedAt || t.createdAt)}\uff09`,
                  };
                })}
              />
            </Col>
          </Row>

          {currentStageName && visibleTemplates.length === 0 && (
            <Alert
              showIcon
              type="info"
              message={'当前阶段还没有可用的审查模板'}
              description={'可以先在该阶段导入或创建模板，已导入的阶段文件仍会显示在下方便于核对。'}
            />
          )}

          {currentStageName && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                {'\u9009\u62e9\u5f85\u5ba1\u6587\u4ef6'}
                <Text type="secondary" style={{ fontWeight: 'normal', marginLeft: 8 }}>
                  {`\u5f53\u524d\u9636\u6bb5 ${currentStageName}\uff0c\u5171 ${matchedDocs.length} \u4e2a\u9636\u6bb5\u6587\u4ef6`}
                </Text>
              </Text>
              {matchedDocs.length === 0 ? (
                <Empty
                  description={'当前阶段暂无可审查文件'}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {matchedDocs.map(doc => {
                    const version = getDocumentVersion(doc);
                    const docKind = inferReviewerProjectDocKind(doc, version);
                    const isKindMismatch = Boolean(selectedTemplateKind && docKind && !reviewerKindsCompatible(selectedTemplateKind, docKind));
                    const isSelected = selectedDocId === doc.id;
                    const canSyncVersion = !version && Boolean(doc.sourceFilePath);
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDocId(doc.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: isSelected ? '2px solid #1890ff' : '1px solid #f0f0f0',
                          background: isSelected ? '#e6f7ff' : '#fafafa',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Space size={6} style={{ maxWidth: '100%' }}>
                            <Text style={{ display: 'block', fontSize: 13, maxWidth: 520 }} ellipsis={{ tooltip: doc.name }}>{doc.name}</Text>
                            {docKind && <Tag color={isKindMismatch ? 'orange' : 'blue'}>{reviewerKindLabels[docKind]}</Tag>}
                          </Space>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                            {version ? `\u7248\u672c: ${version.fileName}` : canSyncVersion ? '\u672a\u540c\u6b65\u7248\u672c\uff0c\u5ba1\u67e5\u65f6\u4f1a\u81ea\u52a8\u540c\u6b65' : '\u6682\u65e0\u7248\u672c'}
                            {doc.analyzedAt ? ` \u00b7 \u5206\u6790\u4e8e ${new Date(doc.analyzedAt).toLocaleDateString('zh-CN')}` : ''}
                            {isKindMismatch ? ' \u00b7 \u7c7b\u578b\u4e0e\u5f53\u524d\u6a21\u677f\u4e0d\u4e00\u81f4' : ''}
                          </Text>
                        </div>
                        <Space size={8} wrap>
                          {canSyncVersion && (
                            <Button
                              size="small"
                              icon={<SyncOutlined />}
                              loading={syncingDocId === doc.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleSyncDocumentVersion(doc);
                              }}
                            >
                              {'\u540c\u6b65\u7248\u672c'}
                            </Button>
                          )}
                          <Progress percent={doc.overallProgress} size="small" style={{ width: 100, marginBottom: 0 }} />
                        </Space>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {templateDocMismatchMessage && (
            <Alert
              showIcon
              type="warning"
              message="模板与文件类型不匹配"
              description={`${templateDocMismatchMessage} 建议切换正确模板后再审查；如果只是想做格式/内容提示，可以先取消“检查缺失章节”。`}
            />
          )}

          {/* 审查配置 */}
          {selectedDocId && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <Space wrap>
                <Checkbox
                  checked={reviewConfig.checkMissingSections}
                  onChange={(e) => setReviewConfig({ ...reviewConfig, checkMissingSections: e.target.checked })}
                >
                  检查缺失章节
                </Checkbox>
                <Checkbox
                  checked={reviewConfig.checkFormatting}
                  onChange={(e) => setReviewConfig({ ...reviewConfig, checkFormatting: e.target.checked })}
                >
                  检查格式
                </Checkbox>
                <Checkbox
                  checked={reviewConfig.checkContentDeviation}
                  onChange={(e) => setReviewConfig({ ...reviewConfig, checkContentDeviation: e.target.checked })}
                >
                  检查内容偏差
                </Checkbox>
                <Checkbox
                  checked={reviewConfig.enableAI}
                  onChange={(e) => setReviewConfig({ ...reviewConfig, enableAI: e.target.checked })}
                >
                  启用AI建议
                </Checkbox>
              </Space>

              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartReview}
                loading={isReviewing}
                disabled={shouldBlockMissingSectionReview}
              >
                开始审查
              </Button>
            </>
          )}
        </Space>
      </Card>

      {!latestReview ? (
        <Empty description="暂无审查记录" />
      ) : (
        <Card
          key={latestReview.id}
          title="最新审查结果"
          style={{ marginBottom: 16 }}
          extra={(
            <Space wrap>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setCustomIssueEditorOpen(true)}>
                新增审查问题
              </Button>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => handleCreateReviewTasks(latestReview)}>
                生成选中任务
              </Button>
            </Space>
          )}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16 }}>
            <div>
              <Text strong>审查时间：{new Date(latestReview.createdAt).toLocaleString('zh-CN')}</Text>
              <br />
              <Text type="secondary">{latestReview.summary}</Text>
            </div>
            <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
              <Progress
                type="circle"
                percent={latestReview.score}
                size={80}
                strokeColor={getScoreColor(latestReview.score)}
                format={(percent) => `${percent}分`}
              />
            </div>
          </div>

          {(latestReview.issues.length > 0 || latestReview.aiSuggestions || customIssueEditorOpen || (customReviewIssuesByReview[latestReview.id] || []).length > 0) && (
            <>
              <Divider>问题与建议</Divider>
              {customIssueEditorOpen && latestReview && (
                <Card size="small" style={{ marginBottom: 12, background: '#fbfdff' }}>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Text strong>新增审查问题</Text>
                    <Input
                      placeholder="相关章节，可选"
                      value={customIssueDraft.sectionTitle}
                      onChange={(event) => setCustomIssueDraft(prev => ({ ...prev, sectionTitle: event.target.value }))}
                    />
                    <Input.TextArea
                      placeholder="问题描述"
                      value={customIssueDraft.message}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      onChange={(event) => setCustomIssueDraft(prev => ({ ...prev, message: event.target.value }))}
                    />
                    <Input.TextArea
                      placeholder="修改建议，可选"
                      value={customIssueDraft.suggestion}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      onChange={(event) => setCustomIssueDraft(prev => ({ ...prev, suggestion: event.target.value }))}
                    />
                    <Space>
                      <Button size="small" type="primary" onClick={() => handleAddCustomReviewIssue(latestReview)}>加入列表</Button>
                      <Button size="small" onClick={() => setCustomIssueEditorOpen(false)}>取消</Button>
                    </Space>
                  </Space>
                </Card>
              )}
              {renderReviewSectionFindings(latestReview)}
            </>
          )}
        </Card>
      )}

      {/* 版本对比 */}
      <Card
        title={currentStageName ? `版本对比 · ${currentStageName}` : '版本对比'}
        style={{ marginTop: 16, overflow: 'hidden' }}
        styles={{ body: { overflow: 'hidden' } }}
        extra={
          <Space size={8} wrap>
            {selectedVersionA && selectedVersionB && (
              <Button
                icon={<SwapOutlined />}
                size="small"
                onClick={() => { const tmp = selectedVersionA; setSelectedVersionA(selectedVersionB); setSelectedVersionB(tmp); }}
                title="交换 A/B 版本"
              />
            )}
            <Button
              type="primary"
              icon={<RobotOutlined />}
              loading={isAnalyzingDiff}
              disabled={!selectedVersionA || !selectedVersionB || Boolean(parsingCompareIds[selectedVersionA] || parsingCompareIds[selectedVersionB])}
              onClick={handleAiDiffAnalysis}
            >
              AI 分析对比
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {/* 版本选择器 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'stretch', width: '100%', minWidth: 0 }}>
            <div style={{ minWidth: 0, border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', background: '#fafbfc', overflow: 'hidden' }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>基准 (A)</Text>
              <Select
                showSearch
                size="small"
                style={{ width: '100%', marginTop: 6, minWidth: 0 }}
                placeholder="选择基准版本"
                value={selectedVersionA || undefined}
                optionFilterProp="label"
                onChange={setSelectedVersionA}
                options={comparableVersions.map(version => ({
                  value: version.id,
                  label: `${version.fileName} · ${formatVersionDate(version.createdAt)}`,
                }))}
              />
              {selectedVersionMetaA && (
                <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 11 }} ellipsis={{ tooltip: selectedVersionMetaA.fileName }}>
                  {selectedVersionMetaA.content.length.toLocaleString()} 字 · {getCompareSourceLabel(selectedVersionMetaA.source)} · {selectedVersionMetaA.fileName}
                </Text>
              )}
            </div>
            <div style={{ minWidth: 0, border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', background: '#fafbfc', overflow: 'hidden' }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>对比 (B)</Text>
              <Select
                showSearch
                size="small"
                style={{ width: '100%', marginTop: 6, minWidth: 0 }}
                placeholder="选择对比版本"
                value={selectedVersionB || undefined}
                optionFilterProp="label"
                onChange={setSelectedVersionB}
                options={comparableVersions.map(version => ({
                  value: version.id,
                  label: `${version.fileName} · ${formatVersionDate(version.createdAt)}`,
                }))}
              />
              {selectedVersionMetaB && (
                <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 11 }} ellipsis={{ tooltip: selectedVersionMetaB.fileName }}>
                  {selectedVersionMetaB.content.length.toLocaleString()} 字 · {getCompareSourceLabel(selectedVersionMetaB.source)} · {selectedVersionMetaB.fileName}
                </Text>
              )}
            </div>
          </div>

          {selectedVersionA && selectedVersionB ? (
            <>
              {/* 统计栏 */}
              <div style={{ display: 'flex', gap: 16, rowGap: 6, flexWrap: 'wrap', padding: '8px 16px', background: '#f6f8fa', borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: '#8c8c8c' }}>共 <strong>{diffStats.total}</strong> 行</span>
                <span style={{ color: '#52c41a' }}>+{diffStats.insert} 新增</span>
                <span style={{ color: '#ff4d4f' }}>-{diffStats.delete} 删除</span>
                <span style={{ color: '#8c8c8c' }}>{diffStats.equal} 未变</span>
                {diffStats.total > 0 && (
                  <span style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 12, whiteSpace: 'nowrap' }}>
                    变更率 {((diffStats.insert + diffStats.delete) / diffStats.total * 100).toFixed(1)}%
                  </span>
                )}
              </div>

              {/* 格式工具条：格式差异嵌入下方内容行内显示 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, rowGap: 6, flexWrap: 'wrap', padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffe7ba', borderRadius: 8 }}>
                {!selectedVersionMetaA || !selectedVersionMetaB ? (
                  <Text type="secondary">请选择两个文档后查看格式差异</Text>
                ) : !canReadFormat(selectedVersionMetaA) || !canReadFormat(selectedVersionMetaB) ? (
                  <Text type="secondary">格式对比暂只支持 Word 文档，当前仅显示内容差异</Text>
                ) : formatCompareById[selectedVersionMetaA.id]?.loading || formatCompareById[selectedVersionMetaB.id]?.loading ? (
                  <><Spin size="small" /><Text type="secondary">正在提取段落格式...</Text></>
                ) : formatCompareById[selectedVersionMetaA.id]?.error || formatCompareById[selectedVersionMetaB.id]?.error ? (
                  <Text type="secondary">格式提取失败：{formatCompareById[selectedVersionMetaA.id]?.error || formatCompareById[selectedVersionMetaB.id]?.error}</Text>
                ) : (
                  <>
                    <Tag color={formatDiffs.length > 0 ? 'orange' : 'green'} style={{ margin: 0 }}>
                      格式差异 {formatDiffs.length} 处
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>格式差异已用行首感叹号标注，悬停查看说明，点击即可选择</Text>
                    {formatDiffs.length > 0 && (
                      <Button size="small" onClick={() => setSelectedFormatDiffKeys(Object.fromEntries(formatDiffs.map(item => [item.key, true])))}>
                        全选格式差异
                      </Button>
                    )}
                    <Button
                      size="small"
                      disabled={selectedFormatDiffs.length === 0 || !canReadFormat(selectedVersionMetaA) || !selectedVersionMetaB?.filePath}
                      loading={applyingFormat === 'A'}
                      onClick={() => handleApplySelectedFormat('A')}
                    >
                      套用 A 格式到 B
                    </Button>
                    <Button
                      size="small"
                      disabled={selectedFormatDiffs.length === 0 || !canReadFormat(selectedVersionMetaB) || !selectedVersionMetaA?.filePath}
                      loading={applyingFormat === 'B'}
                      onClick={() => handleApplySelectedFormat('B')}
                    >
                      套用 B 格式到 A
                    </Button>
                  </>
                )}
              </div>

              {formatDiffs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, rowGap: 6, flexWrap: 'wrap', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <Text strong style={{ fontSize: 12, flex: '0 0 auto' }}>已选择格式：</Text>
                  {selectedFormatDiffs.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>点击内容行前的感叹号，选择要套用格式的段落</Text>
                  ) : (
                    <Space size={6} wrap style={{ flex: 1, minWidth: 0 }}>
                      {selectedFormatDiffs.map(item => (
                        <Tag
                          key={item.key}
                          color="orange"
                          closable
                          onClose={() => toggleFormatDiff(item.key, false)}
                          style={{ maxWidth: 520, whiteSpace: 'normal', lineHeight: 1.5, margin: 0 }}
                        >
                          {item.title}：{item.summary}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </div>
              )}
              {/* Diff 视图 */}
              <div style={{
                maxHeight: 520,
                overflowY: 'auto',
                overflowX: 'hidden',
                background: '#f8fafc',
                border: '1px solid #d1d5db',
                borderRadius: 8,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 34px minmax(0, 1fr)', width: '100%', minWidth: 0 }}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 3, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', color: '#374151', fontWeight: 600 }}>
                    A 文档
                  </div>
                  <div style={{ position: 'sticky', top: 0, zIndex: 3, background: '#f8fafc', borderBottom: '1px solid #d1d5db' }} />
                  <div style={{ position: 'sticky', top: 0, zIndex: 3, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #d1d5db', borderLeft: '1px solid #d1d5db', color: '#374151', fontWeight: 600 }}>
                    B 文档
                  </div>

                  {diffRows.map((row, index) => {
                    const left = row.left;
                    const right = row.right;
                    const formatDiff = row.formatDiff;
                    const isLast = index === diffRows.length - 1;
                    const getTextColor = (line?: DiffLine, side?: 'left' | 'right') => {
                      if (!line) return '#64748b';
                      if (line.type === 'equal') return '#cbd5e1';
                      if (line.type === 'delete' || side === 'left') return '#fca5a5';
                      return '#86efac';
                    };
                    const getCellBackground = (line?: DiffLine, side?: 'left' | 'right') => {
                      if (!line) return '#0f172a';
                      if (line.type === 'equal') return '#111827';
                      if (line.type === 'delete' || side === 'left') return '#3a1a1a';
                      return '#16351f';
                    };
                    const renderCell = (line?: DiffLine, side?: 'left' | 'right') => (
                      <div
                        style={{
                          minHeight: 32,
                          display: 'flex',
                          alignItems: 'stretch',
                          minWidth: 0,
                          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                          fontSize: 12.5,
                          lineHeight: 1.65,
                          background: getCellBackground(line, side),
                          borderBottom: isLast ? 'none' : '1px solid rgba(148, 163, 184, 0.16)',
                          borderRight: side === 'left' ? '1px solid #d1d5db' : undefined,
                          borderLeft: side === 'right' ? '1px solid #d1d5db' : undefined,
                        }}
                      >
                        <span style={{ width: 42, flexShrink: 0, padding: '5px 6px 5px 0', textAlign: 'right', color: line ? '#64748b' : '#334155', background: 'rgba(255,255,255,0.04)', borderRight: '1px solid rgba(255,255,255,0.08)', userSelect: 'none' }}>
                          {side === 'left' ? line?.lineA || '' : line?.lineB || ''}
                        </span>
                        <span style={{ width: 20, flexShrink: 0, padding: '5px 0', textAlign: 'center', color: getTextColor(line, side), fontWeight: 700, userSelect: 'none' }}>
                          {!line ? '' : line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' '}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, padding: '5px 10px 5px 4px', color: getTextColor(line, side), whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                          {line?.text || ' '}
                        </span>
                      </div>
                    );

                    return (
                      <React.Fragment key={index}>
                        {renderCell(left, 'left')}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 32, background: '#f8fafc', borderBottom: isLast ? 'none' : '1px solid #e5e7eb' }}>
                          {formatDiff && (
                            <Tooltip
                              placement="top"
                              title={(
                                <div style={{ maxWidth: 360 }}>
                                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{formatDiff.title}</div>
                                  {formatDiff.fieldChanges.slice(0, 6).map(change => (
                                    <div key={change.fieldKey} style={{ lineHeight: 1.7 }}>{change.text}</div>
                                  ))}
                                  {formatDiff.fieldChanges.length > 6 && <div>还有 {formatDiff.fieldChanges.length - 6} 项格式差异</div>}
                                  <div style={{ marginTop: 6, opacity: 0.8 }}>点击图标可选择或取消该段格式</div>
                                </div>
                              )}
                            >
                              <button
                                type="button"
                                aria-label={`${formatDiff.title}，点击选择或取消`}
                                aria-pressed={Boolean(selectedFormatDiffKeys[formatDiff.key])}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleFormatDiff(formatDiff.key, !selectedFormatDiffKeys[formatDiff.key]);
                                }}
                                style={{
                                  width: 19,
                                  height: 19,
                                  borderRadius: '50%',
                                  border: selectedFormatDiffKeySet.has(formatDiff.key) ? '1px solid #d97706' : '1px solid #f59e0b',
                                  background: selectedFormatDiffKeySet.has(formatDiff.key) ? '#f59e0b' : '#fff7ed',
                                  color: selectedFormatDiffKeySet.has(formatDiff.key) ? '#111827' : '#d97706',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: 0,
                                  cursor: 'pointer',
                                  boxShadow: selectedFormatDiffKeySet.has(formatDiff.key) ? '0 0 0 2px rgba(245, 158, 11, 0.22)' : 'none',
                                }}
                              >
                                <ExclamationCircleOutlined style={{ fontSize: 13 }} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                        {renderCell(right, 'right')}
                      </React.Fragment>
                    );
                  })}
                </div>
                {diffRows.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>两个版本内容完全相同</div>
                )}
              </div>
            </>
          ) : (
            <Empty
              description={comparableVersions.length >= 2 ? '请选择两个版本进行对比' : '当前阶段暂无两个可对比文档；可先在该项目阶段文件夹中导入或新建文档'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}

          {/* AI 分析报告 */}
          {diffAnalysis && (
            <div style={{ border: '1px solid #dbeafe', borderRadius: 8, background: '#f0f7ff', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <RobotOutlined style={{ color: '#1677ff' }} />
                <Text strong style={{ color: '#1677ff' }}>AI 分析报告</Text>
              </div>
              <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13, lineHeight: 1.8 }}>{diffAnalysis}</Paragraph>
            </div>
          )}
        </Space>
      </Card>

    </div>
  );
};

export default DocumentReviewer;

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


const DocumentReviewer: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { currentProject, currentStageName, versions, loadVersions, addVersion } = useProjectStore();
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
  const [isAnalyzingDiff, setIsAnalyzingDiff] = useState(false);
  const [diffAnalysis, setDiffAnalysis] = useState<string>('');
  const [editingSuggestionKey, setEditingSuggestionKey] = useState<string>('');
  const [expandedSuggestionKey, setExpandedSuggestionKey] = useState<string>('');
  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, string>>({});
  const [deletedSuggestionKeys, setDeletedSuggestionKeys] = useState<Record<string, boolean>>({});
  const [createdSuggestionTaskKeys, setCreatedSuggestionTaskKeys] = useState<Record<string, boolean>>({});

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
  const visibleTemplates = useMemo(() => {
    const stageScopedTemplates = currentStageName
      ? templates.filter(template => {
        const detectedStage = detectTimelineStage(allStages, template.name, template.description, template.category);
        return template.category === currentStageName || detectedStage === currentStageName;
      })
      : templates;
    const baseTemplates = stageScopedTemplates.length > 0 ? stageScopedTemplates : templates;
    const stageDocKinds = new Set(
      projectDocs
        .filter(doc => {
          if (!currentProject || doc.projectId !== currentProject.id) return false;
          if (!currentStageName) return true;
          const version = doc.versionId ? projectVersions.find(item => item.id === doc.versionId) : undefined;
          const detectedStage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath, version?.fileName);
          return detectedStage === currentStageName;
        })
        .map(doc => inferReviewerProjectDocKind(doc, doc.versionId ? projectVersions.find(item => item.id === doc.versionId) : undefined))
        .filter(Boolean) as ReviewerDocKind[]
    );
    return [...baseTemplates].sort((a, b) => {
      const aKind = inferReviewerTemplateKind(a);
      const bKind = inferReviewerTemplateKind(b);
      const aScore = aKind && stageDocKinds.has(aKind) ? 1 : 0;
      const bScore = bKind && stageDocKinds.has(bKind) ? 1 : 0;
      return bScore - aScore;
    });
  }, [allStages, currentProject, currentStageName, projectDocs, projectVersions, templates]);

  useEffect(() => {
    if (!currentProject || visibleTemplates.length === 0) return;
    if (selectedTemplate && visibleTemplates.some(template => template.id === selectedTemplate)) return;
    setSelectedTemplate(visibleTemplates[0].id);
    setSelectedDocId('');
  }, [currentProject?.id, currentStageName, selectedTemplate, visibleTemplates]);

  // 选中模板后，筛选该项目下属于该模板的文档
  const matchedDocs = useMemo(() => {
    if (!selectedTemplate || !currentProject) return [];
    const selectedTpl = templates.find(t => t.id === selectedTemplate);
    if (!selectedTpl) return [];
    const selectedKind = inferReviewerTemplateKind(selectedTpl);
    const selectedKindGroup = findReviewerKindGroup(normalizeReviewerMatchText(selectedTpl.name, selectedTpl.category, selectedTpl.description));
    return projectDocs.filter(d => {
      if (d.projectId !== currentProject.id) return false;
      const oldTemplate = templates.find(t => t.id === d.templateId);
      const version = d.versionId ? projectVersions.find(item => item.id === d.versionId) : undefined;
      if (currentStageName) {
        const detectedStage = detectTimelineStage(
          allStages,
          d.name,
          d.sourceFilePath,
          oldTemplate?.name,
          oldTemplate?.category,
          version?.fileName,
        );
        if (detectedStage !== currentStageName && oldTemplate?.category !== currentStageName) return false;
      }
      const docKind = inferReviewerProjectDocKind(d, version);
      if (selectedKind && docKind && !reviewerKindsCompatible(selectedKind, docKind)) return false;
      if (selectedKind && docKind) return true;

      const docText = normalizeReviewerMatchText(d.name, d.sourceFilePath, version?.fileName);
      const docKindGroup = findReviewerKindGroup(docText);
      if (docKindGroup) {
        return reviewerTemplateMatchesKind(selectedTpl, docKindGroup);
      }
      if (d.templateId === selectedTemplate) return true;
      if (oldTemplate?.category === selectedTpl.category && !selectedKindGroup) return true;
      return Boolean(String(selectedTpl.name || '').toLowerCase() && docText.includes(String(selectedTpl.name || '').toLowerCase()));
    });
  }, [allStages, currentStageName, projectDocs, projectVersions, selectedTemplate, templates, currentProject]);

  useEffect(() => {
    const firstDocId = matchedDocs[0]?.id || '';
    if (firstDocId && !matchedDocs.some(doc => doc.id === selectedDocId)) {
      setSelectedDocId(firstDocId);
    }
    if (!firstDocId && selectedDocId) {
      setSelectedDocId('');
    }
  }, [matchedDocs, selectedDocId]);

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
        await updateProjectDoc(doc.id, { versionId: existingVersion.id });
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

  const handleCreateIssueTask = async (review: ReviewResult, issue: ReviewIssue) => {
    if (hasTaskForIssue(review.id, issue.id)) {
      message.info('该问题已有关联任务');
      return;
    }
    await addTask(buildIssueTask(review, issue));
    message.success('已生成审查任务');
  };

  const handleCreateReviewTasks = async (review: ReviewResult) => {
    const pendingIssues = review.issues.filter(issue => !hasTaskForIssue(review.id, issue.id));
    if (pendingIssues.length === 0) {
      message.info('这次审查的问题都已生成任务');
      return;
    }
    for (let i = 0; i < pendingIssues.length; i++) {
      await addTask(buildIssueTask(review, pendingIssues[i], i));
    }
    message.success(`已生成 ${pendingIssues.length} 个审查任务`);
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
    const template = templates.find(t => t.id === review.templateId);
    const relatedDoc = projectDocs.find(doc => doc.versionId === review.versionId);
    await addTask({
      id: `${Date.now()}-${suggestionKey}`,
      projectId: review.projectId,
      title: sectionTitle ? `处理 AI 建议：${sectionTitle}` : '处理 AI 审查建议',
      description: content,
      type: 'manual',
      status: 'pending',
      priority: 'medium',
      source: 'review',
      relatedDocId: relatedDoc?.id,
      relatedReviewId: review.id,
      sectionTitle,
      stageName: template?.category,
      createdAt: new Date().toISOString(),
    });
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

  // 版本对比相关函数
  const getVersionContent = (versionId: string) => {
    const version = versions.find(v => v.id === versionId);
    return version?.content || '';
  };

  const computeDiff = (textA: string, textB: string) => {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(textA, textB);
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
  };

  const stageVersionIds = new Set(matchedDocs.map(doc => getDocumentVersion(doc)?.id).filter(Boolean) as string[]);
  const stageComparableVersions = projectVersions.filter(version => stageVersionIds.has(version.id));
  const comparableVersions = [...(stageComparableVersions.length >= 2 ? stageComparableVersions : projectVersions)]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const selectedVersionMetaA = comparableVersions.find(version => version.id === selectedVersionA);
  const selectedVersionMetaB = comparableVersions.find(version => version.id === selectedVersionB);

  useEffect(() => {
    if (selectedVersionA && !projectVersions.some(version => version.id === selectedVersionA)) setSelectedVersionA('');
    if (selectedVersionB && !projectVersions.some(version => version.id === selectedVersionB)) setSelectedVersionB('');
  }, [projectVersions, selectedVersionA, selectedVersionB]);

  const contentA = getVersionContent(selectedVersionA);
  const contentB = getVersionContent(selectedVersionB);

  const diffResult = useMemo(() => {
    if (!selectedVersionA || !selectedVersionB) return [];
    return computeDiff(contentA, contentB);
  }, [contentA, contentB, selectedVersionA, selectedVersionB]);

  const diffStats = useMemo(() => {
    let insert = 0, deleteCount = 0, equal = 0;
    for (const [op, text] of diffResult) {
      const lines = text.split('\n').length - 1 || 1;
      if (op === 0) equal += lines;
      else if (op === 1) insert += lines;
      else if (op === -1) deleteCount += lines;
    }
    return { insert, delete: deleteCount, equal, total: insert + deleteCount + equal };
  }, [diffResult]);

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
      const prompt = `你是一个文档版本对比分析专家。请对比以下两个版本的差异，并给出详细的分析报告。

## 版本A：${versionA?.fileName || '未知'}
\`\`\`
${contentA.substring(0, 4000)}
\`\`\`

## 版本B：${versionB?.fileName || '未知'}
\`\`\`
${contentB.substring(0, 4000)}
\`\`\`

请分析：
1. 主要变更内容概述
2. 新增了哪些内容
3. 删除了哪些内容
4. 修改了哪些内容
5. 这些变更对文档质量的影响评估
6. 建议和注意事项`;

      const result = await window.electronAPI.callAI({ prompt });
      setDiffAnalysis(result);
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
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<PlusOutlined />}
                      disabled={isCreated}
                      onClick={() => handleCreateAiSuggestionTask(review, sectionTitle, suggestionKey, value)}
                    >
                      {isCreated ? '\u5df2\u751f\u6210\u4efb\u52a1' : '\u751f\u6210\u4efb\u52a1'}
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

    review.issues.forEach(issue => {
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
                  {renderReviewItems(problemItems, 'problem')}
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

              {section.issues.length > 0 && (
                <Space wrap style={{ marginTop: 12 }}>
                  {section.issues.map(issue => (
                    <Button
                      key={issue.id}
                      size="small"
                      type="link"
                      icon={<PlusOutlined />}
                      disabled={hasTaskForIssue(review.id, issue.id)}
                      onClick={() => handleCreateIssueTask(review, issue)}
                      style={{ padding: 0 }}
                    >
                      {hasTaskForIssue(review.id, issue.id) ? '已生成任务' : '生成任务'}
                    </Button>
                  ))}
                </Space>
              )}
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

      {/* 文档审查 */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {/* 第一步：选择模板 */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>选择审查模板</Text>
            <Select
              placeholder={currentStageName ? `选择模板（当前阶段：${currentStageName}）` : '选择模板（按阶段分类）'}
              style={{ width: '100%' }}
              value={selectedTemplate || undefined}
              onChange={(val) => { setSelectedTemplate(val); setSelectedDocId(''); }}
              options={visibleTemplates.map(t => ({
                value: t.id,
                label: `${t.name}（${t.category}）`,
              }))}
            />
          </div>

          {/* 第二步：选择文件 */}
          {selectedTemplate && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                选择审查文件
                <Text type="secondary" style={{ fontWeight: 'normal', marginLeft: 8 }}>
                  当前阶段 {currentStageName || '全部'}，共 {matchedDocs.length} 个相关文件
                </Text>
              </Text>
              {matchedDocs.length === 0 ? (
                <Empty
                  description={selectedTemplateKind === 'guide_instruction'
                    ? '当前模板是指南编制说明模板，不会用于审查申报指南正文。请切换到申报指南正文模板，或导入对应模板后再审查。'
                    : '该项目下没有匹配的文件'}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {matchedDocs.map(doc => {
                    const version = getDocumentVersion(doc);
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
                          <Text style={{ display: 'block', fontSize: 13 }} ellipsis={{ tooltip: doc.name }}>{doc.name}</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {version ? `版本: ${version.fileName}` : canSyncVersion ? '未同步版本，审查时会自动同步' : '暂无版本'}
                            {doc.analyzedAt ? ` · 分析于 ${new Date(doc.analyzedAt).toLocaleDateString('zh-CN')}` : ''}
                          </Text>
                        </div>
                        <Space size={8}>
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
                              同步版本
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
          extra={latestReview.issues.length > 0 ? (
            <Button size="small" icon={<PlusOutlined />} onClick={() => handleCreateReviewTasks(latestReview)}>
              生成任务
            </Button>
          ) : null}
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

          {(latestReview.issues.length > 0 || latestReview.aiSuggestions) && (
            <>
              <Divider>问题与建议</Divider>
              {renderReviewSectionFindings(latestReview)}
            </>
          )}
        </Card>
      )}

      {/* 版本对比 */}
      <Card
        title={currentStageName ? `版本对比 · ${currentStageName}` : '版本对比'}
        style={{ marginTop: 16 }}
        extra={
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={isAnalyzingDiff}
            disabled={!selectedVersionA || !selectedVersionB}
            onClick={handleAiDiffAnalysis}
          >
            AI 分析对比
          </Button>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Row gutter={[12, 12]}>
            <Col span={12}>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, height: '100%', background: '#fff' }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>基准版本</Text>
                <Select
                  showSearch
                  style={{ width: '100%' }}
                  placeholder="选择基准版本"
                  value={selectedVersionA || undefined}
                  optionFilterProp="label"
                  onChange={setSelectedVersionA}
                  options={comparableVersions.map(version => ({
                    value: version.id,
                    label: `${version.fileName} · ${formatVersionDate(version.createdAt)}`,
                  }))}
                />
                <Text type="secondary" style={{ display: 'block', marginTop: 8 }} ellipsis={{ tooltip: selectedVersionMetaA?.fileName }}>
                  {selectedVersionMetaA ? `内容 ${selectedVersionMetaA.content.length} 字 · ${selectedVersionMetaA.fileName}` : '未选择'}
                </Text>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, height: '100%', background: '#fff' }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>对比版本</Text>
                <Select
                  showSearch
                  style={{ width: '100%' }}
                  placeholder="选择对比版本"
                  value={selectedVersionB || undefined}
                  optionFilterProp="label"
                  onChange={setSelectedVersionB}
                  options={comparableVersions.map(version => ({
                    value: version.id,
                    label: `${version.fileName} · ${formatVersionDate(version.createdAt)}`,
                  }))}
                />
                <Text type="secondary" style={{ display: 'block', marginTop: 8 }} ellipsis={{ tooltip: selectedVersionMetaB?.fileName }}>
                  {selectedVersionMetaB ? `内容 ${selectedVersionMetaB.content.length} 字 · ${selectedVersionMetaB.fileName}` : '未选择'}
                </Text>
              </div>
            </Col>
          </Row>

          {selectedVersionA && selectedVersionB ? (
            <>
              <Row gutter={12}>
                <Col span={6}><Statistic title="总行数" value={diffStats.total} /></Col>
                <Col span={6}><Statistic title="新增" value={diffStats.insert} valueStyle={{ color: '#52c41a' }} prefix="+" /></Col>
                <Col span={6}><Statistic title="删除" value={diffStats.delete} valueStyle={{ color: '#ff4d4f' }} prefix="-" /></Col>
                <Col span={6}><Statistic title="未变更" value={diffStats.equal} valueStyle={{ color: '#8c8c8c' }} /></Col>
              </Row>

              <div style={{
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: 1.8,
                maxHeight: 420,
                overflow: 'auto',
                background: '#fafafa',
                border: '1px solid #edf0f5',
                borderRadius: 8,
                padding: 12,
              }}>
                {diffResult.map(([op, diffText], index) => {
                  const lines = diffText.split('\n');
                  return lines.map((line, lineIndex) => {
                    const key = `${index}-${lineIndex}`;
                    let bgColor = 'transparent';
                    let prefix = ' ';

                    if (op === 1) {
                      bgColor = '#e6ffec';
                      prefix = '+';
                    } else if (op === -1) {
                      bgColor = '#ffebe9';
                      prefix = '-';
                    }

                    return (
                      <div key={key} style={{ display: 'flex', background: bgColor, borderBottom: '1px solid #f0f0f0' }}>
                        <span style={{ width: 20, textAlign: 'center', color: op === 1 ? '#52c41a' : op === -1 ? '#ff4d4f' : '#999', userSelect: 'none' }}>
                          {prefix}
                        </span>
                        <span style={{ flex: 1, paddingLeft: 8, whiteSpace: 'pre-wrap' }}>{line}</span>
                      </div>
                    );
                  });
                })}
              </div>
            </>
          ) : (
            <Empty
              description={comparableVersions.length >= 2 ? '请选择两个版本进行对比' : '当前阶段暂无两个可对比版本，可先在上方同步文件为版本'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}

          {diffAnalysis && (
            <div style={{ border: '1px solid #dbeafe', borderRadius: 8, background: '#f8fbff', padding: 12 }}>
              <Text strong>AI 分析报告</Text>
              <Paragraph style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{diffAnalysis}</Paragraph>
            </div>
          )}
        </Space>
      </Card>

    </div>
  );
};

export default DocumentReviewer;

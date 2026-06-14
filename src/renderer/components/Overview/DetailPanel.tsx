import React, { useState, useRef, useEffect } from 'react';
import { Typography, Tabs, Progress, List, Button, Space, Tag, Empty, Modal, Select, Collapse, message, Popconfirm, DatePicker, Input } from 'antd';

const { TextArea } = Input;
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseOutlined,
  FolderOutlined, FileOutlined, ExclamationCircleOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined, ExperimentOutlined,
  RightOutlined, DownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { ProjectDocument, WritingTemplate } from '../../../shared/types';
import {
  buildProjectStageSegments,
  getStageMeta,
  getAllStages,
  getProjectProgress,
  TimelineStageSegment,
  detectTimelineStage,
} from '../../utils/timelineStages';
import { useSettingsStore } from '../../stores/settingsStore';

const { Title, Text, Paragraph } = Typography;

// 折叠展开动画组件
const AnimatedExpand: React.FC<{
  open: boolean;
  children: React.ReactNode;
  borderColor?: string;
}> = ({ open, children, borderColor = '#f0f0f0' }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(open ? 9999 : 0);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      setHeight(open ? (contentRef.current?.scrollHeight || 9999) : 0);
      return;
    }
    if (!contentRef.current) return;
    if (open) {
      const scrollH = contentRef.current.scrollHeight;
      setHeight(scrollH);
    } else {
      setHeight(0);
    }
  }, [open]);

  return (
    <div style={{
      height,
      overflow: 'hidden',
      transition: 'height 0.2s ease-in-out',
    }}>
      <div ref={contentRef}>
        {children}
      </div>
    </div>
  );
};

export type ProjectDetailPage = 'files' | 'plan' | 'team' | 'templates' | 'report' | 'review' | 'writing';

const DetailPanel: React.FC<{ initialTab?: string; onOpenDetail?: (page: ProjectDetailPage) => void }> = ({ initialTab = 'overview', onOpenDetail }) => {
  const { currentProject, setCurrentProject, versions } = useProjectStore();
  const { templates } = useTemplateStore();
  const { projectDocs, addProjectDoc, updateProjectDoc, deleteProjectDoc } = useProjectDocStore();
  const { customStages } = useSettingsStore();
  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [analyzingDocId, setAnalyzingDocId] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  // 延迟收起边框状态，让边框在动画结束后再渐隐
  const [stageBorderVisible, setStageBorderVisible] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState(initialTab);
  // 报告Tab：已读报告 & 展开的阶段
  const [readReportIds, setReadReportIds] = useState<Set<string>>(new Set());
  const [expandedReportStage, setExpandedReportStage] = useState<string | null>(null);

  // 团队Tab：AI协同
  const [selectedWritingTemplateId, setSelectedWritingTemplateId] = useState<string>('');
  const [selectedWritingDocIds, setSelectedWritingDocIds] = useState<string[]>([]);
  const [writingContent, setWritingContent] = useState('');

  useEffect(() => {
    if (currentProject) setActiveTab(initialTab || 'overview');
  }, [currentProject?.id, initialTab]);

  const isOverdue = (deadline?: string, completedAt?: string) => {
    if (!deadline || completedAt) return false;
    const d = new Date(deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return d.getTime() < Date.now();
    const now = new Date();
    return (d.getFullYear() < now.getFullYear())
      || (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())
      || (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() < now.getDate());
  };

  const isAboutToExpire = (deadline?: string, completedAt?: string) => {
    if (!deadline || completedAt || isOverdue(deadline, completedAt)) return false;
    const d = new Date(deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return Date.now() >= d.getTime() - 24 * 60 * 60 * 1000;
    const now = new Date();
    return now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
  };

  if (!currentProject) return null;

  const projectVersions = versions.filter(v => v.projectId === currentProject.id);
  const projectDocsList = projectDocs.filter(d => d.projectId === currentProject.id);

  // 报告Tab：已分析的文档按阶段分组
  const analyzedDocsByStage = (() => {
    const analyzed = projectDocsList.filter(doc => doc.analyzedAt && doc.sections?.length > 0);
    const stageMap = new Map<string, ProjectDocument[]>();
    for (const doc of analyzed) {
      const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
      const arr = stageMap.get(stage) || [];
      arr.push(doc);
      stageMap.set(stage, arr);
    }
    return Array.from(stageMap.entries()).map(([stage, docs]) => ({
      stage,
      docs: docs.sort((a, b) => new Date(b.analyzedAt!).getTime() - new Date(a.analyzedAt!).getTime()),
      hasUnread: docs.some(doc => !readReportIds.has(doc.id)),
    }));
  })();
  const totalAnalyzed = projectDocsList.filter(doc => doc.analyzedAt).length;
  const totalUnread = totalAnalyzed - analyzedDocsByStage.reduce((sum, g) => sum + g.docs.filter(d => readReportIds.has(d.id)).length, 0);

  const selectedDoc = projectDocsList.find(d => d.id === selectedDocId) || null;
  const planSegments = buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages);

  // 当前项目阶段完成度：已完成阶段 / 当前项目已创建阶段
  const avgProgress = getProjectProgress(currentProject, projectDocsList, templates, projectVersions, allStages);
  const completedStageCount = planSegments.filter(s => Boolean(s.completedAt)).length;
  const activeStageCount = planSegments.filter(s => !s.completedAt).length;
  const createdStageCount = planSegments.length;

  const statusMap: Record<string, { color: string; label: string }> = {
    active: { color: 'blue', label: '进行中' },
    completed: { color: 'green', label: '已完成' },
    paused: { color: 'orange', label: '已暂停' },
  };
  const statusInfo = statusMap[currentProject.status] || { color: 'default', label: '未知' };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '未设置';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getVersionForDoc = (doc: ProjectDocument) =>
    versions.find(v => v.id === doc.versionId);

  const getDocDisplayName = (doc: ProjectDocument) =>
    getVersionForDoc(doc)?.fileName || doc.name;

  const getDocActivityAt = (doc: ProjectDocument) =>
    doc.sourceFileModifiedAt || doc.analyzedAt || getVersionForDoc(doc)?.createdAt || doc.sourceFileCreatedAt || doc.createdAt;

  const getDocActivityMs = (doc: ProjectDocument) => {
    const ms = new Date(getDocActivityAt(doc)).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const sortDocsByLatestActivity = (docs: ProjectDocument[]) =>
    [...docs].sort((a, b) => getDocActivityMs(b) - getDocActivityMs(a));

  const getProgressColor = (progress: number) =>
    progress >= 80 ? '#52c41a' : progress >= 40 ? '#1890ff' : progress > 0 ? '#faad14' : '#8c8c8c';

  // 按模板分组（未关联模板的文件通过关键字自动匹配）
  const groupedByTemplate = () => {
    const map = new Map<string, ProjectDocument[]>();
    for (const doc of projectDocsList) {
      let templateId = doc.templateId;
      // 未关联模板时，通过关键字自动匹配
      if (!templateId) {
        const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
        const matched = templates.find(t =>
          t.name.includes(stage) || t.category?.includes(stage) || detectTimelineStage(allStages, t.name, t.category) === stage
        );
        templateId = matched?.id || '__unmatched__';
      }
      const arr = map.get(templateId) || [];
      arr.push(doc);
      map.set(templateId, arr);
    }
    const groups: { templateId: string; templateName: string; docs: ProjectDocument[] }[] = [];
    for (const [templateId, docs] of map) {
      const template = templates.find(t => t.id === templateId);
      groups.push({
        templateId,
        templateName: template?.name || (templateId === '__unmatched__' ? '未匹配模板' : '未知模板'),
        docs,
      });
    }
    return groups;
  };

  // 可选的模板列表（已有模板 + 未使用的新模板）
  const parseSidePanelAiReport = (value: string, fallbackTitle: string) => {
    const normalizeList = (input: unknown): string[] => {
      if (Array.isArray(input)) return input.map(item => String(item || '').trim()).filter(Boolean);
      if (typeof input === 'string') {
        return input.split(/\n|；|;|，/).map(item => item.replace(/^[-\d.、\s]+/, '').trim()).filter(Boolean);
      }
      return [];
    };

    let payload = value.trim();
    const codeBlock = payload.match(/\`\`\`(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*\`\`\`/);
    if (codeBlock) payload = codeBlock[1].trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      const match = payload.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
        } catch {}
      }
    }

    if (!parsed) {
      return {
        reportTitle: fallbackTitle,
        reportSummary: value.trim(),
        writingFramework: [],
        writingDirection: [],
        materialPlan: [],
        draftPlan: [],
        humanTasks: [],
        aiTasks: [],
        workflowPlan: [],
        rawText: value,
      };
    }

    return {
      reportTitle: String(parsed.reportTitle || parsed.title || fallbackTitle).trim(),
      reportSummary: String(parsed.reportSummary || parsed.summary || '').trim(),
      templateFit: normalizeList(parsed.templateFit),
      writingStyleNotes: normalizeList(parsed.writingStyleNotes),
      writingFramework: normalizeList(parsed.writingFramework),
      writingDirection: normalizeList(parsed.writingDirection),
      materialPlan: normalizeList(parsed.materialPlan),
      draftPlan: normalizeList(parsed.draftPlan),
      humanTasks: normalizeList(parsed.humanTasks),
      aiTasks: normalizeList(parsed.aiTasks),
      workflowPlan: Array.isArray(parsed.workflowPlan) ? parsed.workflowPlan : [],
      rawText: value,
    };
  };

  const flattenTemplateNodesForSidePanelPrompt = (nodes: any[] = [], depth = 0): string[] => nodes.flatMap(node => {
    const title = String(node.title || '').trim();
    const requirement = String(node.requirementText || node.description || '').trim();
    const example = String(node.exampleText || '').trim();
    const line = [
      `${'  '.repeat(depth)}- ${title || '未命名章节'}`,
      requirement ? `要求：${requirement.slice(0, 500)}` : '',
      example ? `范文写法参考：${example.slice(0, 400)}` : '',
    ].filter(Boolean).join('；');
    return [line, ...flattenTemplateNodesForSidePanelPrompt(node.children || [], depth + 1)];
  });

  const generateAiReportForDoc = async (
    doc: ProjectDocument,
    content: string,
    template: WritingTemplate,
    sections: any[] = [],
    overallProgress = 0,
  ) => {
    const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
    const version = getVersionForDoc(doc);
    const sectionStatus = sections.map(section =>
      `- ${section.title || '未命名章节'}：${section.status || 'unknown'}，字数 ${section.wordCount || 0}${section.aiComment ? `，说明：${section.aiComment}` : ''}`
    ).join('\n');
    const templateNodes = flattenTemplateNodesForSidePanelPrompt((template as any).nodes || []).join('\n');
    const fallbackTitle = `${stage}阶段写作报告：${getDocDisplayName(doc)}`;
    const prompt = `你是项目阶段文档的写作框架助手。请基于当前文档、关联模板、模板章节要求和范文写法，生成“报告详情页”可展示的 AI 写作框架报告。

注意：
1. 这不是审查结论，不要打分，不要泛泛说风险。
2. 如果模板里有范文，只提取范文的结构、写法、段落组织和表达特征，不要把范文事实当作当前项目要求。
3. 输出必须是 JSON 对象，不要 Markdown，不要代码块。
4. 任务建议要贴合“AI先写初稿/人工补资料/AI再优化/人工确认/再审查”的工作流。
5. 七章节结构属于全局模板约束，不要在每个章节建议里反复输出；只有章节缺失、顺序错误或结构错乱时，才在对应章节提一次。

JSON 字段：
{
  "reportTitle": "标题",
  "reportSummary": "300字以内概述当前文档写作状态和下一步方向",
  "templateFit": ["模板要求转化成的写作约束"],
  "writingStyleNotes": ["从范文或模板中提取的写法特征"],
  "writingFramework": ["建议采用的章节框架或段落组织"],
  "writingDirection": ["下一版写作方向，尽量对应章节"],
  "materialPlan": ["需要人工补充或确认的资料、数据、附件、口径"],
  "draftPlan": ["AI可以执行的初稿、扩写、润色、整理任务"],
  "humanTasks": ["人工下一步任务"],
  "aiTasks": ["AI下一步任务"],
  "sectionAdvice": [{"title":"模板一级标题","problems":["该章节当前存在的问题"],"suggestions":["该章节下一步怎么写、补什么、AI如何改"]}],
  "workflowPlan": [{"type":"ai|manual","title":"任务标题","description":"执行说明","priority":"high|medium|low","reason":"排序理由"}]
}

项目：${currentProject.name}
阶段：${stage}
文档：${doc.name}
文件名：${version?.fileName || getDocDisplayName(doc)}
创建时间：${dayjs(getDocActivityAt(doc)).format('YYYY-MM-DD HH:mm')}
完成度：${overallProgress}%

模板：${template.name}
模板分类：${template.category || '无'}
模板说明：${template.description || '无'}

模板章节和写作要求：
${templateNodes || '无'}

当前章节分析：
${sectionStatus || '暂无章节分析'}

当前文档正文摘录：
${content.slice(0, 9000)}`;

    const response = await window.electronAPI.callAI({ prompt });
    const aiReport = parseSidePanelAiReport(response, fallbackTitle);
    await updateProjectDoc(doc.id, {
      aiReport: JSON.stringify(aiReport),
      analyzedAt: new Date().toISOString(),
    });
    return aiReport;
  };

  const templateOptions = () => {
    const usedTemplateIds = new Set(projectDocsList.map(d => d.templateId));
    const options: { value: string; label: string; isNew: boolean }[] = [];
    // 已使用的模板（可继续添加文件）
    for (const tid of usedTemplateIds) {
      const t = templates.find(t => t.id === tid);
      if (t) options.push({ value: t.id, label: `${t.name}（添加文件）`, isNew: false });
    }
    // 未使用的新模板
    for (const t of templates) {
      if (!usedTemplateIds.has(t.id)) {
        options.push({ value: t.id, label: `${t.name} (${t.category})`, isNew: true });
      }
    }
    return options;
  };

  // 关联文件：创建 ProjectDocument
  const handleAddDoc = async () => {
    if (!selectedTemplateId || !selectedVersionId) {
      message.warning('请选择模板和文件版本');
      return;
    }
    const template = templates.find(t => t.id === selectedTemplateId);
    const version = versions.find(v => v.id === selectedVersionId);
    if (!template || !version) return;

    // 命名：项目名称-模板名称，如果同模板有多个文件则加上文件名
    const existingDocs = projectDocsList.filter(d => d.templateId === selectedTemplateId);
    let docName = `${currentProject.name}-${template.name}`;
    if (existingDocs.length > 0) {
      const baseName = version.fileName.replace(/\.[^.]+$/, '');
      docName = `${currentProject.name}-${template.name}(${baseName})`;
    }

    const newDoc: ProjectDocument = {
      id: Date.now().toString(),
      projectId: currentProject.id,
      templateId: selectedTemplateId,
      versionId: selectedVersionId,
      name: docName,
      sections: [],
      overallProgress: 0,
      createdAt: new Date().toISOString(),
    };

    await addProjectDoc(newDoc);
    setAddModalOpen(false);
    setSelectedTemplateId('');
    setSelectedVersionId('');
    message.success('已关联文件，正在分析...');

    // 自动执行基础分析
    await runAnalysis(newDoc.id, version.content, template, false);
  };

  // 执行分析
  const runAnalysis = async (docId: string, content: string, template: WritingTemplate, useAI: boolean) => {
    setAnalyzingDocId(docId);
    try {
      const result = await window.electronAPI.analyzeProjectDoc({ content, template, useAI });
      if (result.success && result.sections) {
        await updateProjectDoc(docId, {
          sections: result.sections,
          overallProgress: result.overallProgress ?? 0,
          analyzedAt: new Date().toISOString(),
        });
        message.success(useAI ? 'AI分析完成，正在生成报告...' : '基础分析完成');
        return result;
      }
      return null;
    } catch (error) {
      console.error('Analysis failed:', error);
      message.error('分析失败');
      return null;
    } finally {
      setAnalyzingDocId(null);
    }
  };

  const handleAnalyze = async (doc: ProjectDocument, useAI: boolean) => {
    const version = doc.versionId ? versions.find(v => v.id === doc.versionId) : undefined;
    const template = doc.templateId ? templates.find(t => t.id === doc.templateId) : undefined;

    // 尝试从源文件实时解析内容
    let content = version?.content || '';
    if (!content && doc.sourceFilePath) {
      try {
        const parsed = await window.electronAPI.parseDocument(doc.sourceFilePath);
        if (parsed.success && parsed.content?.trim()) {
          content = parsed.content.trim();
        }
      } catch {}
    }

    if (!content) {
      message.warning('该文档暂无文本内容，请先导入文件版本');
      return;
    }
    if (!template) {
      message.warning('该文档未关联模板，请先在关联文件时选择模板');
      return;
    }
    const result = await runAnalysis(doc.id, content, template, useAI);
    if (useAI && result?.success) {
      setAnalyzingDocId(doc.id);
      try {
        await generateAiReportForDoc(
          doc,
          content,
          template,
          result.sections || doc.sections || [],
          result.overallProgress ?? doc.overallProgress ?? 0,
        );
        message.success('AI报告已生成，双击报告即可查看详情');
      } catch (error: any) {
        console.error('AI report generation failed:', error);
        message.error(`AI报告生成失败：${error.message || '未知错误'}`);
      } finally {
        setAnalyzingDocId(null);
      }
    }
  };

  // 快速导出 Word
  const handleQuickExport = async () => {
    const template = templates.find(t => t.id === selectedWritingTemplateId);
    if (!template || !currentProject) return;
    try {
      const result = await window.electronAPI.generateFromContent({
        template,
        sectionContents: { 'main': writingContent },
        folderPath: currentProject.folderPath,
        fileName: `${currentProject.name}-${template.name}`,
      });
      if (result.success) {
        message.success(`文档已导出`);
        if (result.filePath) await window.electronAPI.openInExplorer(result.filePath);
      } else {
        message.error(result.error || '导出失败');
      }
    } catch (error: any) {
      message.error(`导出失败：${error.message}`);
    }
  };

  // 导入单个文档内容
  const handleImportWritingDoc = async (docId: string) => {
    const doc = projectDocsList.find(d => d.id === docId);
    if (!doc) return '';
    const version = doc.versionId ? versions.find(v => v.id === doc.versionId) : undefined;
    let content = version?.content || '';
    if (!content && doc.sourceFilePath) {
      try {
        const parsed = await window.electronAPI.parseDocument(doc.sourceFilePath);
        if (parsed.success && parsed.content?.trim()) content = parsed.content.trim();
      } catch {}
    }
    return content;
  };

  // 批量导入文档内容
  const handleBatchImportDocs = async (docIds: string[]) => {
    const contents: string[] = [];
    for (const docId of docIds) {
      const content = await handleImportWritingDoc(docId);
      if (content) contents.push(content);
    }
    if (contents.length > 0) {
      setWritingContent(prev => prev ? prev + '\n\n' + contents.join('\n\n') : contents.join('\n\n'));
      message.success(`已导入 ${contents.length} 个文档内容`);
    } else {
      message.warning('所选文档暂无文本内容');
    }
  };

  // 导入项目所有文档
  const handleImportAllDocs = async () => {
    const allDocIds = projectDocsList.map(d => d.id);
    if (allDocIds.length === 0) {
      message.warning('项目暂无关联文档');
      return;
    }
    await handleBatchImportDocs(allDocIds);
  };

  const handleStageDeadline = async (segment: TimelineStageSegment, deadline?: string) => {
    const normalized = deadline ? (() => { const d = new Date(deadline); d.setHours(0, 0, 0, 0); return d.toISOString(); })() : undefined;
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { deadline: normalized })));
    message.success(deadline ? '已更新计划截止时间' : '已清除计划截止时间');
  };

  const handleStageComplete = async (segment: TimelineStageSegment) => {
    const completedAt = new Date().toISOString();
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt })));
    message.success('已标记阶段完成');
  };

  const handleStageReopen = async (segment: TimelineStageSegment) => {
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt: undefined })));
    message.success('已取消完成状态');
  };


  const openDetail = (page: ProjectDetailPage) => {
    onOpenDetail?.(page);
  };

  const summaryCardStyle: React.CSSProperties = {
    border: '1px solid rgba(226, 232, 240, 0.9)',
    borderRadius: 10,
    background: 'rgba(255, 255, 255, 0.92)',
    padding: '12px 14px',
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.035)',
  };

  const recentVersions = [...projectVersions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // 状态图标
  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />;
    if (status === 'partial') return <ClockCircleOutlined style={{ color: '#faad14', fontSize: 14 }} />;
    return <CloseOutlined style={{ color: '#d9d9d9', fontSize: 14 }} />;
  };

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <div>
          <Title level={5} style={{ fontSize: 14, marginBottom: 8 }}>项目描述</Title>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 20 }}>
            {currentProject.description || '暂无描述'}
          </Paragraph>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
              <Tag color={statusInfo.color} style={{ margin: 0, fontSize: 11 }}>{statusInfo.label}</Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>创建时间</Text>
              <Text style={{ fontSize: 12 }}>{formatDate(currentProject.createdAt)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>文件版本</Text>
              <Text style={{ fontSize: 12 }}>{projectVersions.length} 个</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>关联文档</Text>
              <Text style={{ fontSize: 12 }}>{projectDocsList.length} 份</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>关联文件夹</Text>
              <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: currentProject.folderPath }}>
                {currentProject.folderPath ? currentProject.folderPath.split(/[/\\]/).pop() : '未关联'}
              </Text>
            </div>
          </div>

          {/* 阶段完成度 - 圆形进度 + 百分比统计 */}
          <Title level={5} style={{ fontSize: 14, marginBottom: 12 }}>阶段完成度</Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
            <Progress
              type="circle"
              percent={avgProgress}
              size={80}
              strokeColor={avgProgress >= 80 ? '#52c41a' : avgProgress >= 40 ? '#1890ff' : '#faad14'}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              {(() => {
                const total = createdStageCount || 1;
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#52c41a', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>已完成</Text></Space>
                      <Text style={{ fontSize: 12 }}>{Math.round(completedStageCount / total * 100)}%</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#1890ff', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>进行中</Text></Space>
                      <Text style={{ fontSize: 12 }}>{Math.round(activeStageCount / total * 100)}%</Text>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* 下一步计划/建议 */}
          {planSegments.length > 0 && (
            <>
              <Title level={5} style={{ fontSize: 14, marginBottom: 10 }}>下一步计划</Title>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {planSegments.filter(s => !s.completedAt).slice(0, 3).map(segment => {
                  const color = stageMeta[segment.stage].color;
                  const segOverdue = isOverdue(segment.deadline, segment.completedAt);
                  const segAboutToExpire = isAboutToExpire(segment.deadline, segment.completedAt);
                  return (
                    <div key={`${segment.stage}-${segment.sourceDocIds.join('-')}`} style={{
                      padding: '8px 10px', borderRadius: 6, border: `1px solid ${segOverdue ? '#ffccc7' : segAboutToExpire ? '#ffe58f' : '#f0f0f0'}`,
                      background: segOverdue ? '#fff7f6' : segAboutToExpire ? '#fffbe6' : '#fafafa',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: segOverdue ? '#ff4d4f' : segAboutToExpire ? '#faad14' : color, flexShrink: 0 }} />
                        <Text strong style={{ fontSize: 12 }}>{segment.label}</Text>
                        {segment.deadline && (
                          <Text type="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>截止 {formatDate(segment.deadline)}</Text>
                        )}
                      </div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {segOverdue ? '已逾期，请尽快完成' : segAboutToExpire ? '今天到期，请抓紧完成' : `包含 ${segment.sourceDocNames.length} 个文件，继续推进中`}
                      </Text>
                    </div>
                  );
                })}
                {planSegments.filter(s => !s.completedAt).length === 0 && (
                  <div style={{ padding: '12px', textAlign: 'center' }}>
                    <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a', marginBottom: 8 }} />
                    <div><Text type="secondary" style={{ fontSize: 12 }}>所有阶段已完成</Text></div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 近期任务汇总 - 跨项目统计 */}
          {(() => {
            const { projects: allProjects } = useProjectStore.getState();
            const allDocs = useProjectDocStore.getState().projectDocs;
            const allTemplates = useTemplateStore.getState().templates;
            const stageOrder = allStages.map(s => s.name);
            const stageSummary = stageOrder.map(stage => {
              let total = 0;
              let completed = 0;
              for (const p of allProjects) {
                const segs = buildProjectStageSegments(p, allDocs.filter(d => d.projectId === p.id), allTemplates, [], allStages);
                const seg = segs.find(s => s.stage === stage);
                if (seg) {
                  total += 1;
                  if (seg.completedAt) completed += 1;
                }
              }
              return { stage, total, completed };
            }).filter(s => s.total > 0);

            if (stageSummary.length === 0) return null;
            return (
              <>
                <Title level={5} style={{ fontSize: 14, marginBottom: 10 }}>近期任务</Title>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stageSummary.map(({ stage, total, completed }) => (
                    <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: stageMeta[stage].color, flexShrink: 0 }} />
                      <Text style={{ fontSize: 12, flex: 1 }}>{stageMeta[stage].label}</Text>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>{completed}/{total}</Text>
                      <Progress
                        percent={Math.round(completed / total * 100)}
                        size="small"
                        style={{ width: 60, margin: 0 }}
                        showInfo={false}
                        strokeColor={completed === total ? '#52c41a' : '#1890ff'}
                      />
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      ),
    },
    {
      key: 'files',
      label: '文件',
      children: (
        <div style={{ height: '100%' }}>
          {/* 文件版本概览 */}
          <div style={{ ...summaryCardStyle, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div><Text type="secondary" style={{ fontSize: 11 }}>文件版本</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{projectVersions.length}</div></div>
              <div><Text type="secondary" style={{ fontSize: 11 }}>关联文档</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{projectDocsList.length}</div></div>
              <div><Text type="secondary" style={{ fontSize: 11 }}>可用模板</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{templates.length}</div></div>
            </div>
            {recentVersions.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>最近导入</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {recentVersions.slice(0, 3).map(version => (
                    <div key={version.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ fontSize: 11, minWidth: 0, flex: 1 }} ellipsis={{ tooltip: version.fileName }}>{version.fileName}</Text>
                      <Tag style={{ margin: 0, fontSize: 9 }}>{version.fileType.toUpperCase()}</Tag>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <Text strong style={{ fontSize: 13 }}>关联文档 ({projectDocsList.length})</Text>
            <Space size={6}>
              <Button size="small" onClick={() => openDetail('files')}>详情</Button>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                新增文件
              </Button>
            </Space>
          </div>
          {projectDocsList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupedByTemplate().map(group => {
                const sortedDocs = sortDocsByLatestActivity(group.docs);
                const latestDoc = sortedDocs[0];
                const latestProgress = latestDoc?.overallProgress ?? 0;
                const isExpanded = expandedTemplate === group.templateId;
                return (
                  <div
                    key={group.templateId}
                    style={{
                      border: '1px solid #edf0f5',
                      borderLeft: `3px solid ${isExpanded ? '#1890ff' : '#edf0f5'}`,
                      borderRadius: 8,
                      background: '#fff',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s ease, background 0.2s ease',
                    }}
                  >
                    {/* 模板标题行 */}
                    <div
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedTemplate(null);
                        } else {
                          setExpandedTemplate(group.templateId);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        background: isExpanded ? '#f8fbff' : '#fff',
                        cursor: 'pointer',
                        borderBottom: isExpanded ? '1px solid #eef4ff' : '1px solid transparent',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={6}>
                          <FileOutlined style={{ color: '#1890ff', fontSize: 13 }} />
                          <Text strong style={{ fontSize: 12 }}>{group.templateName}</Text>
                          <Tag style={{ margin: 0, fontSize: 10 }}>{group.docs.length} 份</Tag>
                        </Space>
                        <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {latestDoc && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 19 }}>
                          <Text type="secondary" style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: getDocDisplayName(latestDoc) }}>
                            最新编辑：{getDocDisplayName(latestDoc)}
                          </Text>
                          <Text style={{ fontSize: 11, minWidth: 32, color: getProgressColor(latestProgress), fontWeight: 600 }}>{latestProgress}%</Text>
                        </div>
                      )}
                    </div>
                    {/* 展开的文档列表 */}
                    <AnimatedExpand open={isExpanded} borderColor="transparent">
                      <div style={{
                        padding: '8px 10px',
                        background: '#fff',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                          <Button
                            type="link" size="small" icon={<PlusOutlined />}
                            onClick={(e) => { e.stopPropagation(); setSelectedTemplateId(group.templateId); setAddModalOpen(true); }}
                            style={{ padding: 0, fontSize: 11 }}
                          >
                            添加文件
                          </Button>
                        </div>
                        {sortedDocs.map(doc => {
                          const isLatest = latestDoc?.id === doc.id;
                          return (
                            <div
                              key={doc.id}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                marginBottom: 4,
                                background: '#fafafa',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                <Text style={{ display: 'block', flex: 1, minWidth: 0, fontSize: 11, lineHeight: '20px' }} ellipsis={{ tooltip: getDocDisplayName(doc) }}>
                                  {getDocDisplayName(doc)}
                                </Text>
                                <Space size={2} style={{ flexShrink: 0 }}>
                                  <Button type="text" size="small" icon={<ReloadOutlined />} loading={analyzingDocId === doc.id} onClick={() => handleAnalyze(doc, false)} style={{ padding: '0 3px' }} />
                                  <Button type="text" size="small" icon={<ExperimentOutlined />} loading={analyzingDocId === doc.id} onClick={() => handleAnalyze(doc, true)} style={{ padding: '0 3px' }} />
                                  <Popconfirm title="确定删除？" onConfirm={() => deleteProjectDoc(doc.id)}>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ padding: '0 3px' }} />
                                  </Popconfirm>
                                </Space>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 3 }}>
                                <Text type="secondary" style={{ fontSize: 10, flex: 1, minWidth: 0 }}>
                                  更新：{formatDateTime(getDocActivityAt(doc))}
                                </Text>
                                <Space size={4} style={{ flexShrink: 0 }}>
                                  {isLatest && <Tag color="blue" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>最新</Tag>}
                                  <Tag color={doc.overallProgress >= 80 ? 'green' : doc.overallProgress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>{doc.overallProgress}%</Tag>
                                </Space>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AnimatedExpand>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="暂未关联文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}

          {/* 关联文件弹窗 */}
          <Modal
            title="关联文件"
            open={addModalOpen}
            onOk={handleAddDoc}
            onCancel={() => setAddModalOpen(false)}
            okText="关联并分析"
            cancelText="取消"
            width={420}
          >
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>选择模板</Text>
              <Select
                placeholder="选择文档模板（如提案表、可研报告）"
                style={{ width: '100%' }}
                value={selectedTemplateId || undefined}
                onChange={setSelectedTemplateId}
                options={templateOptions()}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>选择文件版本</Text>
              <Select
                placeholder="选择已导入的文件"
                style={{ width: '100%' }}
                value={selectedVersionId || undefined}
                onChange={setSelectedVersionId}
                options={projectVersions.map(v => ({
                  value: v.id,
                  label: `${v.fileName} (${v.fileType.toUpperCase()})`,
                }))}
              />
            </div>
            {projectVersions.length === 0 && (
              <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                请先在"文件"页面导入文档
              </Text>
            )}
          </Modal>
        </div>
      ),
    },
    {
      key: 'plan',
      label: '计划',
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <Text strong style={{ fontSize: 13 }}>阶段计划 ({planSegments.length})</Text>
            <Button size="small" onClick={() => openDetail('plan')}>详情</Button>
          </div>

          {planSegments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {planSegments.map(segment => {
                const color = stageMeta[segment.stage].color;
                const isCompleted = Boolean(segment.completedAt);
                const segOverdue = isOverdue(segment.deadline, segment.completedAt);
                const segAboutToExpire = isAboutToExpire(segment.deadline, segment.completedAt);
                const statusColor = segOverdue ? '#ff4d4f' : segAboutToExpire ? '#faad14' : color;

                return (
                  <div
                    key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
                    style={{
                      padding: '10px 12px',
                      border: `1px solid ${segOverdue ? '#ffccc7' : segAboutToExpire ? '#ffe58f' : '#f0f0f0'}`,
                      borderRadius: 8,
                      background: segOverdue ? '#fff7f6' : segAboutToExpire ? '#fffbe6' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <Space size={6}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: statusColor, display: 'inline-block' }} />
                        <Text strong style={{ fontSize: 13 }}>{segment.label}</Text>
                        {isCompleted ? (
                          <Tag color="green" style={{ margin: 0, fontSize: 11 }}>已完成</Tag>
                        ) : segOverdue ? (
                          <Tag color="red" style={{ margin: 0, fontSize: 11 }}>逾期</Tag>
                        ) : segAboutToExpire ? (
                          <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>即将逾期</Tag>
                        ) : (
                          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>进行中</Tag>
                        )}
                      </Space>
                      {isCompleted ? (
                        <Button size="small" onClick={() => handleStageReopen(segment)}>
                          取消完成
                        </Button>
                      ) : (
                        <Button size="small" type="primary" onClick={() => handleStageComplete(segment)}>
                          完成
                        </Button>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>文件数</Text>
                        <Text style={{ fontSize: 11 }}>{segment.sourceDocNames.length} 个</Text>
                      </div>
                      <div>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>截止时间</Text>
                        <DatePicker
                          showTime
                          allowClear
                          size="small"
                          style={{ width: '100%' }}
                          value={segment.deadline ? dayjs(segment.deadline) : null}
                          placeholder="设置计划截止时间"
                          onChange={(value) => handleStageDeadline(segment, value ? value.toDate().toISOString() : undefined)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="暂无可计划的阶段" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                新增文件
              </Button>
            </Empty>
          )}
        </div>
      ),
    },
    {
      key: 'tasks',
      label: '进度',
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>阶段进度</Text>
          <Button size="small" onClick={() => openDetail('team')}>详情</Button>
          </div>
          {planSegments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {planSegments.map(segment => {
                const color = stageMeta[segment.stage]?.color || '#8c8c8c';
                const isCompleted = Boolean(segment.completedAt);
                const isExpanded = expandedStage === segment.stage;
                const docsInStage = sortDocsByLatestActivity(projectDocsList.filter(d => segment.sourceDocIds.includes(d.id)));
                const latestDoc = docsInStage[0];
                const latestDocName = latestDoc ? getDocDisplayName(latestDoc) : '';

                const borderVisible = stageBorderVisible[segment.stage] || isExpanded;
                return (
                  <div
                    key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
                    style={{
                      border: '1px solid #edf0f5',
                      borderLeft: `3px solid ${borderVisible ? color : '#edf0f5'}`,
                      borderRadius: 8,
                      background: '#fff',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s ease, background 0.2s ease',
                    }}
                  >
                    {/* 阶段标题行 */}
                    <div
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedStage(null);
                          setTimeout(() => setStageBorderVisible(prev => ({ ...prev, [segment.stage]: false })), 550);
                        } else {
                          setExpandedStage(segment.stage);
                          setStageBorderVisible(prev => ({ ...prev, [segment.stage]: true }));
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        background: isExpanded ? '#fbfdff' : '#fff',
                        cursor: 'pointer',
                        borderBottom: isExpanded ? '1px solid #eef4ff' : '1px solid transparent',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={6}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                          <Text strong style={{ fontSize: 12 }}>{segment.label}</Text>
                          {isCompleted ? (
                            <Tag color="green" style={{ margin: 0, fontSize: 10 }}>已完成</Tag>
                          ) : (
                            <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{segment.sourceDocNames.length} 个文件</Tag>
                          )}
                        </Space>
                        <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {latestDoc && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 14 }}>
                          <Text type="secondary" style={{ fontSize: 11, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: latestDocName }}>
                            最新编辑：{latestDocName}
                          </Text>
                          <Text style={{ fontSize: 11, color: getProgressColor(latestDoc.overallProgress), fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {latestDoc.overallProgress}%
                          </Text>
                        </div>
                      )}
                    </div>
                    {/* 展开的文档列表 */}
                    <AnimatedExpand open={isExpanded} borderColor="transparent">
                      <div style={{
                        borderRadius: '0 0 8px 8px',
                        padding: '8px 10px',
                        background: '#fff',
                      }}>
                        {docsInStage.length > 0 ? docsInStage.map((doc, idx) => {
                          const isLatest = idx === 0;
                          return (
                            <div
                              key={doc.id}
                              onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                marginBottom: idx < docsInStage.length - 1 ? 4 : 0,
                                background: selectedDocId === doc.id ? '#f5faff' : '#fafafa',
                                border: `1px solid ${selectedDocId === doc.id ? '#d6eaff' : 'transparent'}`,
                                cursor: 'pointer',
                              }}
                            >
                              <Text style={{ display: 'block', fontSize: 11, lineHeight: '20px' }} ellipsis={{ tooltip: getDocDisplayName(doc) }}>
                                {getDocDisplayName(doc)}
                              </Text>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 3 }}>
                                <Text type="secondary" style={{ fontSize: 10, flex: 1, minWidth: 0 }}>
                                  更新：{formatDateTime(getDocActivityAt(doc))}
                                </Text>
                                <Space size={4} style={{ flexShrink: 0 }}>
                                  {isLatest && <Tag color="blue" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>最新</Tag>}
                                  <Tag color={doc.overallProgress >= 80 ? 'green' : doc.overallProgress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>{doc.overallProgress}%</Tag>
                                </Space>
                              </div>
                            </div>
                          );
                        }) : (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', textAlign: 'center', padding: 8 }}>暂无文档</Text>
                        )}
                      </div>
                    </AnimatedExpand>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <ExclamationCircleOutlined style={{ fontSize: 32, color: '#d9d9d9', marginBottom: 12 }} />
              <div>
                <Text type="secondary" style={{ fontSize: 13 }}>暂无阶段数据</Text>
              </div>
              <Button type="link" size="small" onClick={() => setAddModalOpen(true)} style={{ marginTop: 8 }}>
                新增文件
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'members',
      label: '团队',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>团队协同</Text>
            <Button size="small" type="primary" onClick={() => openDetail('team')}>详情</Button>
          </div>
          <div style={summaryCardStyle}>
            <Text type="secondary" style={{ fontSize: 12 }}>阶段、审查和任务在这里汇总，方便判断下一步该谁推进什么。</Text>
          </div>
          <Text strong style={{ fontSize: 13 }}>AI协同</Text>
          <div style={{ ...summaryCardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Select
              placeholder="选择模板"
              size="small"
              style={{ width: '100%' }}
              value={selectedWritingTemplateId || undefined}
              onChange={setSelectedWritingTemplateId}
              options={templates.map(t => ({ value: t.id, label: t.name }))}
            />
            {selectedWritingTemplateId && (
              <>
                <Select
                  mode="multiple"
                  placeholder="导入文稿参考（可多选）"
                  size="small"
                  style={{ width: '100%' }}
                  value={selectedWritingDocIds}
                  onChange={setSelectedWritingDocIds}
                  options={projectDocsList.map(d => ({ value: d.id, label: d.name }))}
                  maxTagCount={2}
                  maxTagTextLength={12}
                />
                <Space size={4}>
                  <Button size="small" onClick={() => handleBatchImportDocs(selectedWritingDocIds)} disabled={selectedWritingDocIds.length === 0}>
                    导入选中文档
                  </Button>
                  <Button size="small" onClick={handleImportAllDocs} disabled={projectDocsList.length === 0}>
                    导入全部文档
                  </Button>
                </Space>
                <TextArea
                  value={writingContent}
                  onChange={(e) => setWritingContent(e.target.value)}
                  placeholder="在此编写文档内容..."
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  style={{ fontSize: 12 }}
                />
                <Button type="primary" size="small" block onClick={handleQuickExport} disabled={!writingContent.trim()}>
                  导出 Word
                </Button>
              </>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'report',
      label: '报告',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 统计概览 */}
          <div style={summaryCardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div><Text type="secondary" style={{ fontSize: 11 }}>已分析文档</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{totalAnalyzed}</div></div>
              <div><Text type="secondary" style={{ fontSize: 11 }}>分析阶段</Text><div style={{ fontSize: 20, fontWeight: 700 }}>{analyzedDocsByStage.length}</div></div>
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>未读报告</Text>
                <div style={{ fontSize: 20, fontWeight: 700, color: totalUnread > 0 ? '#ff4d4f' : undefined }}>{totalUnread}</div>
              </div>
            </div>
          </div>

          {/* 按阶段分组的报告列表 */}
          {analyzedDocsByStage.length > 0 ? analyzedDocsByStage.map(group => {
            const color = stageMeta[group.stage]?.color || '#8c8c8c';
            const isExpanded = expandedReportStage === group.stage;
            return (
              <div key={group.stage} style={{
                border: '1px solid #edf0f5',
                borderLeft: `3px solid ${isExpanded ? color : '#edf0f5'}`,
                borderRadius: 8,
                background: '#fff',
                overflow: 'hidden',
                transition: 'border-color 0.2s ease',
              }}>
                {/* 阶段标题行 */}
                <div
                  onClick={() => setExpandedReportStage(isExpanded ? null : group.stage)}
                  style={{
                    padding: '8px 10px',
                    background: isExpanded ? '#fbfdff' : '#fff',
                    cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid #eef4ff' : '1px solid transparent',
                    transition: 'background 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Space size={6}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                      <Text strong style={{ fontSize: 12 }}>{stageMeta[group.stage]?.label || group.stage}</Text>
                      <Tag style={{ margin: 0, fontSize: 10 }}>{group.docs.length} 份</Tag>
                      {group.hasUnread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff4d4f', display: 'inline-block' }} />}
                    </Space>
                    <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </div>
                </div>
                {/* 展开的报告列表 */}
                <AnimatedExpand open={isExpanded} borderColor="transparent">
                  <div style={{ padding: '6px 10px', background: '#fff' }}>
                    {group.docs.map(doc => {
                      const isRead = readReportIds.has(doc.id);
                      return (
                        <div
                          key={doc.id}
                          onClick={() => {
                            if (!isRead) setReadReportIds(prev => new Set(prev).add(doc.id));
                          }}
                          onDoubleClick={() => {
                            useProjectStore.getState().setPendingReportDocId(doc.id);
                            useProjectStore.getState().setPendingReportDocOnly(true);
                            openDetail('report');
                          }}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 6,
                            marginBottom: 4,
                            background: isRead ? '#fafafa' : '#f5faff',
                            border: `1px solid ${isRead ? 'transparent' : '#d6eaff'}`,
                            cursor: 'pointer',
                            transition: 'background 0.15s ease, border-color 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {!isRead && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', flexShrink: 0 }} />}
                            <Text style={{ display: 'block', flex: 1, minWidth: 0, fontSize: 11, lineHeight: '20px' }} ellipsis={{ tooltip: doc.name }}>
                              {doc.name}
                            </Text>
                            <Tag color={doc.overallProgress >= 80 ? 'green' : doc.overallProgress > 0 ? 'orange' : 'default'} style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>
                              {doc.overallProgress}%
                            </Tag>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: isRead ? 0 : 12 }}>
                            <Text type="secondary" style={{ fontSize: 10, flex: 1 }}>
                              章节 {doc.sections.filter(s => s.status === 'completed').length}/{doc.sections.length} 完成
                            </Text>
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              {dayjs(doc.analyzedAt).format('MM-DD HH:mm')}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AnimatedExpand>
              </div>
            );
          }) : (
            <div style={summaryCardStyle}>
              <Text type="secondary" style={{ fontSize: 12 }}>暂无分析报告，在「文件」Tab 中点击分析按钮生成。</Text>
            </div>
          )}

          <Button size="small" block onClick={() => {
            useProjectStore.getState().setPendingReportDocId(null);
            useProjectStore.getState().setPendingReportDocOnly(false);
            openDetail('report');
          }}>进入报告工作台</Button>
        </div>
      ),
    },
    {
      key: 'review',
      label: '审查',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>审查</Text>
            <Button size="small" type="primary" onClick={() => openDetail('review')}>详情</Button>
          </div>
          <div style={summaryCardStyle}>
            <Text type="secondary" style={{ fontSize: 12 }}>进入审查工作台后查看最新审查结果、AI建议和生成任务。</Text>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="detail-panel detail-panel-polished" style={{ padding: '16px 18px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className="detail-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, background: '#e6f7ff', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FolderOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          </div>
          <div>
            <Title level={5} style={{ margin: 0, fontSize: 15 }}>{currentProject.name}</Title>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Tag color={statusInfo.color} style={{ margin: 0, fontSize: 11 }}>{statusInfo.label}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{avgProgress}% 阶段完成度</Text>
            </div>
          </div>
        </div>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={() => setCurrentProject(null)}
          size="small"
          style={{ transition: 'transform 0.15s ease, background 0.15s ease' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'rotate(90deg)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'rotate(0deg)'; }}
        />
      </div>

      <Tabs className="detail-panel-tabs detail-panel-tabs-polished" activeKey={activeTab} onChange={setActiveTab} items={tabItems} size="small" style={{ flex: 1, overflow: 'hidden' }} animated={false} />
    </div>
  );
};

export default DetailPanel;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Space, Tag, Typography, message } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useStageLifecycleStore } from '../../stores/stageLifecycleStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { detectTimelineStage, getAllStages, getCurrentStageDocumentProgress } from '../../utils/timelineStages';
import { composePromptAsync } from '../../utils/promptComposer';
import {
  buildLongFormSectionPlan,
  buildQuickDraftTemplateContext,
  countDraftCharacters,
  selectRelevantReferenceExcerpts,
  shouldGenerateLongForm,
  type DraftReferenceDocument,
} from '../../utils/quickDraftPrompt';
import { mapDraftToTemplateSections } from '../../utils/draftSectionMapper';
import { isRevisionWorkflowFocus } from '../../utils/workflowTaskRouting';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';
import { type CollaborationActivity, useCollaborationActivityStore } from '../../stores/collaborationActivityStore';
import { pickProjectFiles } from '../../stores/projectPickerStore';
import TeamWritingStudio from './studios/TeamWritingStudio';
import RevisionStudio from './studios/RevisionStudio';
import CollaborationDispatch from './studios/CollaborationDispatch';
import ExecutionHistory from './studios/ExecutionHistory';

const { Text, Title } = Typography;

interface ProgressBoardProps {
  onBack?: () => void;
  hideHeader?: boolean;
}

type ExternalReference = { path: string; name: string; content?: string };

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const ProgressBoard: React.FC<ProgressBoardProps> = ({ onBack, hideHeader = false }) => {
  const { currentProject, versions, setCurrentStageName, loadVersions } = useProjectStore();
  const pendingWorkflowFocus = useNavigationStore(state => state.activeFocus);
  const acknowledgeWorkflowFocus = useNavigationStore(state => state.acknowledgeActiveFocus);
  const { projectDocs, loadProjectDocs } = useProjectDocStore();
  const { customStages, enableSystemNotifications } = useSettingsStore();
  const { tasks, loadTasks, updateTask, setTaskExecutor } = useTaskStore();
  const { templates, reviews, loadTemplates, loadReviews } = useTemplateStore();
  const { stageMemories, loadKnowledge } = useKnowledgeStore();
  const removeStageMemory = useStageLifecycleStore(state => state.removeStageMemory);
  const collaborationActivities = useCollaborationActivityStore(state => state.activities);
  const recordActivity = useCollaborationActivityStore(state => state.recordActivity);

  const [selectedWritingTemplateId, setSelectedWritingTemplateId] = useState('');
  const [selectedWritingDocIds, setSelectedWritingDocIds] = useState<string[]>([]);
  const [externalReferences, setExternalReferences] = useState<ExternalReference[]>([]);
  const [writingInstruction, setWritingInstruction] = useState('');
  const [writingDraft, setWritingDraft] = useState('');
  const [workflowPromptSuggestion, setWorkflowPromptSuggestion] = useState('');
  const [focusedWorkflowTaskId, setFocusedWorkflowTaskId] = useState('');
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [excludedMemoryIds, setExcludedMemoryIds] = useState<string[]>([]);

  const [selectedRevisionDocId, setSelectedRevisionDocId] = useState('');
  const [revisionDocumentContent, setRevisionDocumentContent] = useState('');
  const [revisionSelection, setRevisionSelection] = useState('');
  const [revisionRange, setRevisionRange] = useState<{ start: number; end: number } | null>(null);
  const [revisionInstruction, setRevisionInstruction] = useState('');
  const [revisionPromptSuggestion, setRevisionPromptSuggestion] = useState('');
  const [revisionProposal, setRevisionProposal] = useState('');
  const [revisionProposalSelection, setRevisionProposalSelection] = useState('');
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [isGeneratingRevision, setIsGeneratingRevision] = useState(false);
  const [isApplyingRevision, setIsApplyingRevision] = useState(false);
  const [collaborationFriends, setCollaborationFriends] = useState<CollaborationPeerInfo[]>([]);
  const [selectedDispatchTaskIds, setSelectedDispatchTaskIds] = useState<string[]>([]);
  const [selectedDispatchFriendId, setSelectedDispatchFriendId] = useState('');
  const [attachTaskFile, setAttachTaskFile] = useState(true);
  const [isSendingTask, setIsSendingTask] = useState(false);
  const writingStudioRef = useRef<HTMLDivElement>(null);
  const revisionStudioRef = useRef<HTMLDivElement>(null);
  const collaborationStudioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([loadProjectDocs(), loadTasks(), loadTemplates(), loadReviews(), loadKnowledge()]);
    void window.electronAPI.listCollaborationFriends?.().then(result => {
      if (result?.success) setCollaborationFriends(result.friends || []);
    });
  }, []);

  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const projectVersions = useMemo(() => currentProject ? versions.filter(v => v.projectId === currentProject.id) : [], [currentProject, versions]);
  const projectDocsList = useMemo(() => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [], [currentProject, projectDocs]);
  const projectTasks = useMemo(() => currentProject ? tasks.filter(t => t.projectId === currentProject.id) : [], [currentProject, tasks]);
  const projectReviews = useMemo(() => currentProject ? reviews.filter(r => r.projectId === currentProject.id) : [], [currentProject, reviews]);
  const projectMemories = useMemo(() => currentProject ? stageMemories.filter(memory => memory.projectId === currentProject.id) : [], [currentProject, stageMemories]);
  const enabledProjectMemories = useMemo(() => projectMemories.filter(memory => !excludedMemoryIds.includes(memory.id)), [excludedMemoryIds, projectMemories]);
  const selectedWritingTemplate = templates.find(template => template.id === selectedWritingTemplateId);
  const selectedWritingStage = selectedWritingTemplate
    ? detectTimelineStage(allStages, selectedWritingTemplate.name, selectedWritingTemplate.category, selectedWritingTemplate.description)
    : '';
  const selectedRevisionDoc = projectDocsList.find(doc => doc.id === selectedRevisionDocId);
  const selectedRevisionDocPath = selectedRevisionDoc ? (selectedRevisionDoc.sourceFilePath || projectVersions.find(version => version.id === selectedRevisionDoc.versionId)?.filePath || '') : '';
  const projectProgress = useMemo(
    () => currentProject
      ? getCurrentStageDocumentProgress(projectDocsList, templates, projectVersions, allStages).progress
      : 0,
    [allStages, currentProject, projectDocsList, projectVersions, templates],
  );
  const openTasks = useMemo(() => projectTasks.filter(task => task.status !== 'completed'), [projectTasks]);
  const highPriorityTasks = useMemo(() => openTasks.filter(task => task.priority === 'high'), [openTasks]);
  const latestReview = [...projectReviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const dispatchableTasks = useMemo(() => openTasks
    .filter(task => {
      const isAggregateReportTask = task.source === 'report' && !task.workflowId;
      return !isAggregateReportTask;
    })
    .sort((a, b) =>
      Number(b.source === 'review') - Number(a.source === 'review')
      || Number(b.priority === 'high') - Number(a.priority === 'high')
      || (a.workflowOrder || Number.MAX_SAFE_INTEGER) - (b.workflowOrder || Number.MAX_SAFE_INTEGER)
    ),
  [openTasks]);
  const selectedDispatchTasks = dispatchableTasks.filter(task => selectedDispatchTaskIds.includes(task.id));
  const getDispatchTaskPath = (task: (typeof dispatchableTasks)[number]) => {
    const document = task.relatedDocId ? projectDocsList.find(doc => doc.id === task.relatedDocId) : undefined;
    const version = document?.versionId ? projectVersions.find(item => item.id === document.versionId) : undefined;
    return document?.sourceFilePath || version?.filePath || '';
  };
  const selectedDispatchPaths = [...new Set(selectedDispatchTasks.map(getDispatchTaskPath).filter(Boolean))];

  useEffect(() => {
    const validIds = selectedDispatchTaskIds.filter(id => dispatchableTasks.some(task => task.id === id));
    if (validIds.length !== selectedDispatchTaskIds.length || validIds.some((id, index) => id !== selectedDispatchTaskIds[index])) {
      setSelectedDispatchTaskIds(validIds);
    }
  }, [dispatchableTasks, selectedDispatchTaskIds]);

  const handleToggleDispatchTask = (taskId: string) => {
    setSelectedDispatchTaskIds(ids => ids.includes(taskId) ? ids.filter(id => id !== taskId) : [...ids, taskId]);
  };

  const handleToggleAllDispatchTasks = (selected: boolean) => {
    setSelectedDispatchTaskIds(selected ? dispatchableTasks.map(task => task.id) : []);
  };

  const handleSendCollaborationTask = async () => {
    if (!currentProject || selectedDispatchTasks.length === 0 || !selectedDispatchFriendId) {
      message.warning('请选择至少一个任务和在线好友');
      return;
    }
    const friend = collaborationFriends.find(item => item.id === selectedDispatchFriendId);
    if (!friend?.online) {
      message.warning('请选择在线好友');
      return;
    }
    setIsSendingTask(true);
    const sentFilePaths = new Set<string>();
    const succeededTaskIds: string[] = [];
    const failedTasks: Array<{ title: string; error: string }> = [];
    for (const selectedTask of selectedDispatchTasks) {
      try {
        const attachmentPath = attachTaskFile ? getDispatchTaskPath(selectedTask) : '';
        const attachmentName = attachmentPath ? fileName(attachmentPath) : undefined;
        if (attachmentPath && !sentFilePaths.has(attachmentPath)) {
          const fileResult = await window.electronAPI.sendCollaborationFile?.({ friendId: friend.id, filePath: attachmentPath, projectName: currentProject.name });
          if (!fileResult?.success) throw new Error(fileResult?.error || '关联文件发送失败');
          sentFilePaths.add(attachmentPath);
        }
        const task = {
          ...selectedTask,
          description: [
            selectedTask.description,
            selectedTask.source === 'review' ? `审查问题定位：${selectedTask.sectionTitle || '未标注章节'}` : '',
            selectedTask.sourceLineNumber ? `原始行号：第 ${selectedTask.sourceLineNumber} 行` : '',
          ].filter(Boolean).join('\n'),
        };
        const result = await window.electronAPI.sendCollaborationTask?.({ friendId: friend.id, task, projectName: currentProject.name, attachmentName });
        if (!result?.success) throw new Error(result?.error || '任务发送失败');
        await setTaskExecutor(selectedTask.id, 'friend');
        await updateTask(selectedTask.id, { action: 'dispatch', updatedAt: new Date().toISOString() });
        succeededTaskIds.push(selectedTask.id);
        recordActivity({
          projectId: currentProject.id,
          projectName: currentProject.name,
          kind: 'friend',
          status: 'success',
          title: `已发送给 ${friend.name || friend.email || '好友'}`,
          detail: `${selectedTask.title}${attachmentName ? ` · 附件 ${attachmentName}` : ''}`,
        });
      } catch (error: any) {
        failedTasks.push({ title: selectedTask.title, error: error?.message || '发送失败' });
      }
    }
    setIsSendingTask(false);
    setSelectedDispatchTaskIds(ids => ids.filter(id => !succeededTaskIds.includes(id)));
    if (failedTasks.length === 0) {
      message.success(`已发送 ${succeededTaskIds.length} 个协作任务，等待对方接受`);
    } else if (succeededTaskIds.length > 0) {
      message.warning(`已发送 ${succeededTaskIds.length} 个任务，${failedTasks.length} 个发送失败`);
    } else {
      message.error(failedTasks[0]?.error || '批量发送协作任务失败');
    }
  };

  const readProjectDoc = async (docId: string) => {
    const doc = projectDocsList.find(item => item.id === docId);
    if (!doc) return '';
    const version = projectVersions.find(item => item.id === doc.versionId);
    if (version?.content?.trim()) return version.content.trim();
    const sourcePath = doc.sourceFilePath || version?.filePath;
    if (!sourcePath) return '';
    const parsed = await window.electronAPI.parseDocumentSilent?.(sourcePath);
    return parsed?.success && parsed.content ? parsed.content.trim() : '';
  };

  const locateRevisionRange = (content: string, sectionTitle?: string, sourceLineNumber?: number) => {
    if (!content.trim()) return null;
    const lines = content.split(/\r?\n/);
    if (sourceLineNumber && sourceLineNumber > 0 && sourceLineNumber <= lines.length) {
      const start = lines.slice(0, sourceLineNumber - 1).join('\n').length + (sourceLineNumber > 1 ? 1 : 0);
      const end = Math.min(content.length, start + 1800);
      return { start, end };
    }
    const normalizedTitle = sectionTitle?.trim() || '';
    const start = normalizedTitle ? content.indexOf(normalizedTitle) : -1;
    if (start < 0) return null;
    const remainder = content.slice(start + normalizedTitle.length);
    const nextHeading = remainder.search(/\n\s*(?:\d+(?:\.\d+)*[、.．\s]|第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+、)/);
    const end = nextHeading > 0
      ? start + normalizedTitle.length + nextHeading
      : Math.min(content.length, start + 1800);
    return { start, end: Math.max(end, Math.min(content.length, start + normalizedTitle.length)) };
  };

  const handleAddExternalReferences = async () => {
    const paths = await window.electronAPI.openFiles([{ name: '可解析文档', extensions: ['docx', 'doc', 'pdf', 'txt', 'md', 'xlsx', 'xls', 'pptx', 'ppt'] }]);
    if (!paths?.length) return;
    const additions = await Promise.all(paths.map(async (path: string) => {
      const parsed = await window.electronAPI.parseDocumentSilent?.(path);
      return { path, name: fileName(path), content: parsed?.success ? String(parsed.content || '').trim() : '' };
    }));
    const readable = additions.filter(item => item.content);
    setExternalReferences(previous => [...previous, ...readable.filter(item => !previous.some(existing => existing.path === item.path))]);
    if (readable.length) message.success(`已临时加入 ${readable.length} 份外部参考资料`);
    else message.warning('未能读取所选资料中的文本内容');
  };

  const handleAddProjectReferences = async () => {
    if (!currentProject) return;
    const selected = await pickProjectFiles({
      projectId: currentProject.id,
      title: '选择项目内参考资料',
      selectedPaths: selectedWritingDocIds.map(id => {
        const doc = projectDocsList.find(item => item.id === id);
        return doc?.sourceFilePath || projectVersions.find(version => version.id === doc?.versionId)?.filePath || '';
      }).filter(Boolean),
    });
    if (!selected.length) return;
    const selectedPathSet = new Set(selected.map(item => item.path));
    const matchingDocIds = projectDocsList
      .filter(doc => selectedPathSet.has(doc.sourceFilePath || projectVersions.find(version => version.id === doc.versionId)?.filePath || ''))
      .map(doc => doc.id);
    setSelectedWritingDocIds(previous => [...new Set([...previous, ...matchingDocIds])]);
    const unmatched = selected.filter(item => !projectDocsList.some(doc => (doc.sourceFilePath || projectVersions.find(version => version.id === doc.versionId)?.filePath) === item.path));
    if (unmatched.length) {
      const additions = await Promise.all(unmatched.map(async item => {
        const parsed = await window.electronAPI.parseDocumentSilent?.(item.path);
        return { path: item.path, name: item.name, content: parsed?.success ? String(parsed.content || '').trim() : '' };
      }));
      setExternalReferences(previous => [...previous, ...additions.filter(item => item.content && !previous.some(existing => existing.path === item.path))]);
    }
    message.success(`已加入 ${selected.length} 份项目参考资料`);
  };

  const collectWritingReferences = async (): Promise<DraftReferenceDocument[]> => {
    const projectResults = await Promise.all(selectedWritingDocIds.map(async id => {
      const doc = projectDocsList.find(item => item.id === id);
      const content = await readProjectDoc(id);
      return content ? { name: doc?.name || '未命名项目文件', content, kind: 'project' as const } : null;
    }));
    const projectContents: DraftReferenceDocument[] = projectResults.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    const externalContents = externalReferences
      .filter(item => item.content)
      .map(item => ({ name: item.name, content: String(item.content), kind: 'external' as const }));
    const templateSources: DraftReferenceDocument[] = [];
    if (selectedWritingTemplate?.filePath) {
      const parsed = await window.electronAPI.parseDocumentSilent?.(selectedWritingTemplate.filePath);
      if (parsed?.success && String(parsed.content || '').trim()) {
        templateSources.push({
          name: fileName(selectedWritingTemplate.filePath),
          content: String(parsed.content).trim(),
          kind: 'template',
        });
      }
    }
    const collected = [...projectContents, ...externalContents, ...templateSources];
    const expectedCount = selectedWritingDocIds.length + externalReferences.length + (selectedWritingTemplate?.filePath ? 1 : 0);
    if (collected.length < expectedCount) {
      message.warning(`有 ${expectedCount - collected.length} 份参考文件未能提取文本，未将空内容发送给 AI`);
    }
    return collected;
  };

  const handleGenerateDraft = async () => {
    if (!currentProject || !selectedWritingTemplate) {
      message.warning('请先选择用于起草的写作模板');
      return;
    }
    const referenceDocuments = await collectWritingReferences();
    const memories = enabledProjectMemories.map(item => `【${item.stageName}】${item.summary}`).join('\n').slice(0, 8000) || '暂无可用阶段记忆';
    const instruction = (writingInstruction || workflowPromptSuggestion).trim() || '请依据模板完成一版可供人工继续编辑的初稿。';
    const templateContext = buildQuickDraftTemplateContext(selectedWritingTemplate);
    const projectContext = [
      `【当前项目】${currentProject.name}`,
      currentProject.description?.trim() ? `【项目简介】${currentProject.description.trim()}` : '',
    ].filter(Boolean).join('\n\n') || '当前仅有项目名称，暂无其他项目资料。';
    const sectionPlan = buildLongFormSectionPlan(selectedWritingTemplate);
    const useLongForm = shouldGenerateLongForm(selectedWritingTemplate, sectionPlan);
    setIsGeneratingDraft(true);
    try {
      const result = await useAIJobStore.getState().runAIJob<string>(
        { scene: useLongForm ? 'longFormSection' : 'draft', title: `AI 写作：${selectedWritingTemplate.name}`, projectId: currentProject.id, resultPreview: value => String(value || '').slice(0, 240) },
        async ({ jobId, setProgress, throwIfCancelled }) => {
          if (useLongForm) {
            const completedSections: string[] = [];
            for (let index = 0; index < sectionPlan.length; index += 1) {
              throwIfCancelled();
              const section = sectionPlan[index];
              const references = selectRelevantReferenceExcerpts(
                referenceDocuments,
                `${section.title}\n${section.guidance}`,
              );
              const prompt = await composePromptAsync('longFormSection', {
                stage: selectedWritingStage,
                templateName: selectedWritingTemplate.name,
                sectionIndex: String(index + 1),
                sectionCount: String(sectionPlan.length),
                sectionTitle: section.title,
                instruction,
                projectContext,
                outline: (selectedWritingTemplate.nodes || []).map((node, nodeIndex) => `${nodeIndex + 1}. ${node.title}`).join('\n'),
                sectionGuidance: section.guidance || '围绕本节标题形成完整、专业、可编辑的正文。',
                targetMin: String(section.targetMin),
                targetMax: String(section.targetMax),
                stageMemory: memories,
                references,
                templateRequirements: templateContext.requirements,
                templateExamples: templateContext.examples,
              });
              setProgress(5 + Math.floor((index / sectionPlan.length) * 85));
              let sectionDraft = String(await window.electronAPI.callAI({
                prompt,
                usageRequestId: jobId,
                usageTitle: `AI 写作：${selectedWritingTemplate.name} · ${section.title}`,
                usageScene: 'longFormSection',
                silentActivity: true,
              }) || '').trim();
              throwIfCancelled();

              const minimumAccepted = Math.floor(section.targetMin * 0.72);
              if (countDraftCharacters(sectionDraft) < minimumAccepted) {
                const expansionPrompt = await composePromptAsync('sectionExpansion', {
                  stage: selectedWritingStage,
                  sectionTitle: section.title,
                  currentLength: String(countDraftCharacters(sectionDraft)),
                  targetMin: String(section.targetMin),
                  instruction,
                  sectionGuidance: section.guidance,
                  templateRequirements: templateContext.requirements,
                  references,
                  draft: sectionDraft,
                });
                sectionDraft = String(await window.electronAPI.callAI({
                  prompt: expansionPrompt,
                  usageRequestId: jobId,
                  usageTitle: `AI 扩写：${selectedWritingTemplate.name} · ${section.title}`,
                  usageScene: 'sectionExpansion',
                  silentActivity: true,
                }) || '').trim();
                throwIfCancelled();
              }
              if (!sectionDraft) throw new Error(`“${section.title}”未生成可用正文`);
              completedSections.push(`${section.title}\n${sectionDraft}`);
            }
            setProgress(92);
            const combined = completedSections.join('\n\n');
            const expectedMinimum = sectionPlan.reduce((sum, section) => sum + section.targetMin, 0);
            if (countDraftCharacters(combined) < Math.floor(expectedMinimum * 0.65)) {
              throw new Error(`长篇初稿仅生成 ${countDraftCharacters(combined)} 字符，未达到模板最低篇幅要求，请检查模型输出上限或重试`);
            }
            return combined;
          }

          const reference = referenceDocuments
            .map(item => `【${item.kind === 'template' ? '模板范文' : item.kind === 'external' ? '外部资料' : '项目资料'}：${item.name}｜已提取 ${item.content.length} 字符】\n${item.content}`)
            .join('\n\n')
            .slice(0, 28000);
          const prompt = await composePromptAsync('draft', {
            stage: selectedWritingStage,
            sectionTitle: selectedWritingTemplate.name,
            instruction,
            templateRequirements: templateContext.requirements,
            templateExamples: templateContext.examples,
            stageMemory: memories,
            reference: [projectContext, `【参考资料清单与实际传入正文】\n${reference || '未选择或未成功解析任何参考文件'}`].filter(Boolean).join('\n\n'),
            currentContent: '当前尚无初稿。请从零起草一份完整、连贯、可继续修改的第一稿。',
          });
          setProgress(25);
          const value = await window.electronAPI.callAI({ prompt, usageRequestId: jobId, usageTitle: `AI 写作：${selectedWritingTemplate.name}`, usageScene: 'draft' });
          throwIfCancelled();
          setProgress(88);
          return String(value || '').trim();
        },
      );
      if (!result.trim()) throw new Error('AI 未返回可用初稿');
      setWritingDraft(result);
      recordActivity({
        projectId: currentProject.id,
        projectName: currentProject.name,
        kind: 'ai-writing',
        status: 'success',
        title: `AI 写作完成：${selectedWritingTemplate.name}`,
        detail: `生成 ${result.length.toLocaleString()} 字符的初稿`,
        resumeData: {
          type: 'ai-writing',
          prompt: instruction,
          content: result,
          templateId: selectedWritingTemplate.id,
          templateName: selectedWritingTemplate.name,
          selectedDocIds: [...selectedWritingDocIds],
        },
      });
      if (useLongForm && enableSystemNotifications !== false) {
        await window.electronAPI.showSystemNotification?.({
          title: `AI 写作已完成：${selectedWritingTemplate.name}`,
          body: `全部 ${sectionPlan.length} 个章节已生成、合并并通过篇幅校验。`,
          target: 'project-report',
          projectId: currentProject.id,
        });
      }
      message.success('已生成初稿，可先人工编辑后导出 Word');
    } catch (error: any) {
      if (!isAIJobCancelledError(error)) {
        recordActivity({
          projectId: currentProject.id,
          projectName: currentProject.name,
          kind: 'ai-writing',
          status: 'failed',
          title: `AI 写作失败：${selectedWritingTemplate.name}`,
          detail: error.message || String(error),
        });
        message.error(`AI 写作失败：${error.message || String(error)}`);
      }
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleExportDraft = async () => {
    if (!currentProject || !selectedWritingTemplate || !writingDraft.trim()) return;
    try {
      const exportBaseName = `${currentProject.name}-${selectedWritingTemplate.name}-初稿`;
      const result = await window.electronAPI.generateFromContent({
        template: selectedWritingTemplate,
        sectionContents: mapDraftToTemplateSections(selectedWritingTemplate, writingDraft),
        folderPath: currentProject.folderPath,
        fileName: exportBaseName,
      });
      if (!result.success) throw new Error(result.error || '导出失败');
      const outputType = String(selectedWritingTemplate.outputFileType || 'docx').replace(/^\./, '').toLowerCase();
      const expectedFileName = `${exportBaseName}.${outputType}`;
      const actualFileName = result.filePath?.split(/[\\/]/).pop();
      message.success(actualFileName && actualFileName !== expectedFileName
        ? `原文件正在使用，已另存为：${actualFileName}`
        : '初稿已导出到项目文件夹');
      if (result.filePath) await window.electronAPI.openInExplorer(result.filePath);
    } catch (error: any) {
      message.error(`导出失败：${error.message || String(error)}`);
    }
  };

  const handleLoadRevisionDocument = async () => {
    if (!selectedRevisionDocId) {
      message.warning('请先选择要修订的项目文件');
      return;
    }
    const content = await readProjectDoc(selectedRevisionDocId);
    if (!content) {
      message.warning('该文件没有可读取的文本内容');
      return;
    }
    setRevisionDocumentContent(content);
    setRevisionSelection('');
    setRevisionRange(null);
    setRevisionProposal('');
    setRevisionProposalSelection('');
    message.success('已载入全文；用鼠标拖选要修改的段落');
  };

  const captureRevisionSelection = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart || 0;
    const end = target.selectionEnd || 0;
    if (end <= start) return;
    setRevisionRange({ start, end });
    setRevisionSelection(revisionDocumentContent.slice(start, end));
  };

  const handleOpenRevisionDialog = () => {
    if (!selectedRevisionDocId || !revisionDocumentContent) {
      message.warning('请先选择并载入要修订的文件');
      return;
    }
    if (!revisionSelection.trim() || !revisionRange) {
      message.warning('请先在全文中用鼠标拖选需要修订的内容');
      return;
    }
    setRevisionProposal('');
    setRevisionModalOpen(true);
  };

  const handleGenerateRevision = async () => {
    if (!currentProject || !revisionSelection.trim()) return;
    const instruction = revisionInstruction.trim() || '请提升表达的清晰度、专业性与逻辑连贯性，不改变事实。';
    setIsGeneratingRevision(true);
    try {
      const prompt = await composePromptAsync('precisionRewrite', {
        stage: selectedRevisionDoc ? detectTimelineStage(allStages, selectedRevisionDoc.name, selectedRevisionDoc.sourceFilePath) : '',
        sectionTitle: selectedRevisionDoc?.name || '选中文本',
        instruction,
        templateRequirements: '保持原文事实、术语和语气；仅修改用户选中的内容。',
        stageMemory: projectMemories.map(item => item.summary).join('\n').slice(0, 5000) || '无',
        reference: '无',
        currentContent: revisionSelection,
      });
      const result = await useAIJobStore.getState().runAIJob<string>(
        { scene: 'precisionRewrite', title: `AI 修订：${selectedRevisionDoc?.name || '选中文本'}`, projectId: currentProject.id, docId: selectedRevisionDocId, resultPreview: value => String(value || '').slice(0, 240) },
        async ({ jobId, setProgress, throwIfCancelled }) => {
          setProgress(30);
          const value = await window.electronAPI.callAI({ prompt, usageRequestId: jobId, usageTitle: `AI 修订：${selectedRevisionDoc?.name || '选中文本'}`, usageScene: 'precisionRewrite' });
          throwIfCancelled();
          setProgress(88);
          return String(value || '').trim();
        },
      );
      if (!result) throw new Error('AI 未返回修订内容');
      setRevisionProposal(result);
      setRevisionProposalSelection('');
      recordActivity({
        projectId: currentProject.id,
        projectName: currentProject.name,
        kind: 'ai-revision',
        status: 'success',
        title: `AI 修订完成：${selectedRevisionDoc?.name || '选中文本'}`,
        detail: `已生成 ${result.length.toLocaleString()} 字符的修订建议`,
        resumeData: {
          type: 'ai-revision',
          prompt: instruction,
          content: result,
          documentId: selectedRevisionDocId || undefined,
          documentName: selectedRevisionDoc?.name,
          sourceText: revisionSelection,
        },
      });
    } catch (error: any) {
      if (!isAIJobCancelledError(error)) {
        recordActivity({
          projectId: currentProject.id,
          projectName: currentProject.name,
          kind: 'ai-revision',
          status: 'failed',
          title: `AI 修订失败：${selectedRevisionDoc?.name || '选中文本'}`,
          detail: error.message || String(error),
        });
        message.error(`生成修订失败：${error.message || String(error)}`);
      }
    } finally {
      setIsGeneratingRevision(false);
    }
  };

  const applyRevision = async (replacement: string) => {
    if (!selectedRevisionDocPath || !revisionSelection || !replacement.trim()) {
      message.warning('缺少可写回的文件或修订内容');
      return;
    }
    setIsApplyingRevision(true);
    try {
      const result = await window.electronAPI.replaceDocumentText({ filePath: selectedRevisionDocPath, originalText: revisionSelection, replacementText: replacement.trim() });
      if (!result.success) throw new Error(result.error || '写回失败');
      const start = revisionRange?.start ?? 0;
      const end = revisionRange?.end ?? start;
      const next = revisionDocumentContent.slice(0, start) + replacement.trim() + revisionDocumentContent.slice(end);
      setRevisionDocumentContent(next);
      setRevisionRange({ start, end: start + replacement.trim().length });
      setRevisionSelection(replacement.trim());
      setRevisionModalOpen(false);
      setRevisionProposal('');
      await loadVersions();
      message.success(result.backupPath ? '已写回修订，并已创建原文件备份' : '已写回修订');
    } catch (error: any) {
      message.error(`接受修订失败：${error.message || String(error)}`);
    } finally {
      setIsApplyingRevision(false);
    }
  };

  useEffect(() => {
    if (!pendingWorkflowFocus || !['team', 'writing'].includes(pendingWorkflowFocus.target) || !currentProject || pendingWorkflowFocus.projectId !== currentProject.id) return;
    let cancelled = false;
    if (pendingWorkflowFocus.stageName) setCurrentStageName(pendingWorkflowFocus.stageName);
    if (pendingWorkflowFocus.intent === 'dispatch') {
      if (pendingWorkflowFocus.taskId) setSelectedDispatchTaskIds([pendingWorkflowFocus.taskId]);
      acknowledgeWorkflowFocus();
      requestAnimationFrame(() => collaborationStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return () => { cancelled = true; };
    }
    const isRevisionFlow = isRevisionWorkflowFocus(pendingWorkflowFocus);
    const target = pendingWorkflowFocus.docId
      ? projectDocsList.find(doc => doc.id === pendingWorkflowFocus.docId)
      : undefined;
    // 懒加载团队页时，项目文档可能尚未进 store。保留 focus 等待数据到位，
    // 不能先清空它再退回 AI 初稿区。
    if (pendingWorkflowFocus.docId && !target) return;
    if (target) {
      setSelectedRevisionDocId(target.id);
      if (target.templateId) setSelectedWritingTemplateId(target.templateId);
      if (!isRevisionFlow) setSelectedWritingDocIds([target.id]);
    }
    setFocusedWorkflowTaskId(pendingWorkflowFocus.taskId || '');
    if (!isRevisionFlow) {
      setWorkflowPromptSuggestion(pendingWorkflowFocus.prompt || '');
      setWritingInstruction(pendingWorkflowFocus.prompt || '');
    }
    if (isRevisionFlow && target) {
      const focus = { ...pendingWorkflowFocus };
      void (async () => {
        const content = await readProjectDoc(target.id);
        if (cancelled || !content) return;
        const range = locateRevisionRange(content, focus.sectionTitle, focus.sourceLineNumber);
        setRevisionDocumentContent(content);
        setRevisionProposal('');
        setRevisionProposalSelection('');
        setRevisionPromptSuggestion(focus.prompt || '');
        setRevisionInstruction('');
        if (range) {
          setRevisionRange(range);
          setRevisionSelection(content.slice(range.start, range.end));
          setRevisionModalOpen(true);
        } else {
          setRevisionRange(null);
          setRevisionSelection('');
          message.info('已载入关联文件；请在全文中拖选审查问题对应的内容后修订');
        }
        requestAnimationFrame(() => revisionStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      })();
    } else {
      requestAnimationFrame(() => writingStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    acknowledgeWorkflowFocus();
    return () => { cancelled = true; };
  }, [acknowledgeWorkflowFocus, currentProject, pendingWorkflowFocus, projectDocsList, setCurrentStageName]);

  const recentActivities = collaborationActivities.filter(activity => (
    activity.projectId === currentProject?.id
    || (!activity.projectId && activity.projectName === currentProject?.name)
  ));

  const handleRestoreActivity = async (activity: CollaborationActivity) => {
    const snapshot = activity.resumeData;
    if (!snapshot || activity.status !== 'success') {
      message.info('这条历史动态没有可恢复的写作内容');
      return;
    }

    if (snapshot.type === 'ai-writing') {
      if (snapshot.templateId && templates.some(template => template.id === snapshot.templateId)) {
        setSelectedWritingTemplateId(snapshot.templateId);
      }
      setSelectedWritingDocIds((snapshot.selectedDocIds || []).filter(id => projectDocsList.some(doc => doc.id === id)));
      setWritingInstruction(snapshot.prompt);
      setWorkflowPromptSuggestion('');
      setFocusedWorkflowTaskId('');
      setWritingDraft(snapshot.content);
      requestAnimationFrame(() => writingStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      message.success('已恢复该次 AI 写作的提示词和初稿内容');
      return;
    }

    const target = snapshot.documentId
      ? projectDocsList.find(doc => doc.id === snapshot.documentId)
      : undefined;
    let documentContent = '';
    if (target) {
      setSelectedRevisionDocId(target.id);
      documentContent = await readProjectDoc(target.id);
    } else {
      setSelectedRevisionDocId('');
    }
    let start = documentContent.indexOf(snapshot.sourceText);
    if (start < 0) {
      documentContent = snapshot.sourceText;
      start = 0;
    }
    setRevisionDocumentContent(documentContent);
    setRevisionRange({ start, end: start + snapshot.sourceText.length });
    setRevisionSelection(snapshot.sourceText);
    setRevisionInstruction(snapshot.prompt);
    setRevisionPromptSuggestion('');
    setRevisionProposal(snapshot.content);
    setRevisionProposalSelection('');
    setRevisionModalOpen(true);
    requestAnimationFrame(() => revisionStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    message.success(target
      ? '已恢复该次 AI 修订的提示词、原文和建议内容'
      : '关联文件已不存在，已恢复当时的选区、提示词和建议内容');
  };

  if (!currentProject) return <Empty description="请先选择一个项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  return <div className="team-workbench-page">
    {!hideHeader && <div className="team-page-header"><Space><Button type="text" size="small" icon={<FileTextOutlined />} onClick={onBack}>返回</Button><Title level={4}>{currentProject.name}</Title><Tag color="blue">团队协同</Tag></Space><Text type="secondary">围绕项目任务、初稿与精确修订协同推进。</Text></div>}
    <div className="team-stats-row">
      {[{ label: '阶段进度', value: projectProgress, suffix: '%', color: '#1677ff' }, { label: '待处理任务', value: openTasks.length, color: '#faad14' }, { label: '高优先级', value: highPriorityTasks.length, color: highPriorityTasks.length ? '#ff4d4f' : '#52c41a' }, { label: '最近审查', value: latestReview?.score || 0, suffix: latestReview ? '分' : '', color: '#722ed1' }].map(stat => <div key={stat.label} className="team-stat-card"><div className="team-stat-value" style={{ color: stat.color }}>{stat.value}<span className="team-stat-suffix">{stat.suffix || ''}</span></div><div className="team-stat-label">{stat.label}</div></div>)}
    </div>
    <div className="team-main-grid">
      <div className="team-main-left">
        <div ref={writingStudioRef} className="team-ai-studio-anchor">
          <TeamWritingStudio templates={templates} projectDocs={projectDocsList} selectedTemplateId={selectedWritingTemplateId} selectedDocIds={selectedWritingDocIds} externalReferences={externalReferences} instruction={writingInstruction} draft={writingDraft} workflowPromptSuggestion={workflowPromptSuggestion} focusedWorkflowTaskId={focusedWorkflowTaskId} memories={projectMemories} excludedMemoryIds={excludedMemoryIds} generating={isGeneratingDraft} onTemplateChange={setSelectedWritingTemplateId} onInstructionChange={setWritingInstruction} onDraftChange={setWritingDraft} onAddProjectReferences={() => void handleAddProjectReferences()} onAddExternalReferences={() => void handleAddExternalReferences()} onRemoveDoc={id => setSelectedWritingDocIds(previous => previous.filter(item => item !== id))} onRemoveExternalReference={path => setExternalReferences(previous => previous.filter(item => item.path !== path))} onMemoryEnabledChange={(id, enabled) => setExcludedMemoryIds(previous => enabled ? previous.filter(item => item !== id) : [...new Set([...previous, id])])} onDeleteMemory={id => { if (currentProject) void removeStageMemory(currentProject, id); }} onGenerate={() => void handleGenerateDraft()} onExport={() => void handleExportDraft()} />
        </div>
        <div ref={revisionStudioRef} className="team-ai-studio-anchor">
          <RevisionStudio documents={projectDocsList} selectedDocumentId={selectedRevisionDocId} documentContent={revisionDocumentContent} selection={revisionSelection} instruction={revisionInstruction} promptSuggestion={revisionPromptSuggestion} proposal={revisionProposal} proposalSelection={revisionProposalSelection} modalOpen={revisionModalOpen} generating={isGeneratingRevision} applying={isApplyingRevision} onDocumentChange={setSelectedRevisionDocId} onLoad={() => void handleLoadRevisionDocument()} onCaptureSelection={captureRevisionSelection} onOpenDialog={handleOpenRevisionDialog} onInstructionChange={setRevisionInstruction} onGenerate={() => void handleGenerateRevision()} onProposalChange={setRevisionProposal} onProposalSelectionChange={setRevisionProposalSelection} onApply={value => void applyRevision(value)} onClose={() => setRevisionModalOpen(false)} onDiscard={() => setRevisionProposal('')} />
        </div>
      </div>
      <div className="team-main-right">
        <div ref={collaborationStudioRef} className="team-ai-studio-anchor">
          <CollaborationDispatch
            tasks={dispatchableTasks}
            friends={collaborationFriends}
            selectedTaskIds={selectedDispatchTaskIds}
            selectedFriendId={selectedDispatchFriendId}
            attachmentPaths={selectedDispatchPaths}
            attachFile={attachTaskFile}
            sending={isSendingTask}
            fileName={fileName}
            onTaskToggle={handleToggleDispatchTask}
            onToggleAllTasks={handleToggleAllDispatchTasks}
            onFriendChange={setSelectedDispatchFriendId}
            onAttachFileChange={setAttachTaskFile}
            onSend={() => void handleSendCollaborationTask()}
          />
        </div>
        <ExecutionHistory activities={recentActivities} onRestore={activity => void handleRestoreActivity(activity)} />
      </div>
    </div>
  </div>;
};

export default ProgressBoard;

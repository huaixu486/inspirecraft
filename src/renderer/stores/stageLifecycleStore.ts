import { create } from 'zustand';
import { Project, StageCompletionEvent, StageMemoryEntry } from '../../shared/types';
import { useAIJobStore } from './aiJobStore';
import { useKnowledgeStore } from './knowledgeStore';
import { useProjectDocStore } from './projectDocStore';
import { useProjectStore } from './projectStore';
import {
  buildStageCompletionDocumentPatch,
  buildStageReopenDocumentPatch,
  createStageCompletionEvent,
  getActiveStageCompletionEvent,
  replaceStageCompletionEvent,
  selectStageExtractionDocument,
  StageCompletionScope,
} from '../utils/stageCompletion';

interface CompleteStageParams {
  project: Project;
  scope: StageCompletionScope;
  extractionDocId?: string;
  autoLearn: boolean;
}

interface StageLifecycleState {
  busyStageKeys: string[];
  completeStage: (params: CompleteStageParams) => Promise<StageCompletionEvent>;
  reopenStage: (project: Project, scope: StageCompletionScope) => Promise<void>;
  retryStageLearning: (project: Project, eventId: string) => Promise<StageCompletionEvent | null>;
  removeStageMemory: (project: Project, memoryId: string) => Promise<void>;
}

const stageKey = (projectId: string, stageName: string) => `${projectId}:${stageName}`;

const updatePersistedEvent = async (projectId: string, event: StageCompletionEvent) => {
  const project = useProjectStore.getState().projects.find(item => item.id === projectId)
    || (useProjectStore.getState().currentProject?.id === projectId ? useProjectStore.getState().currentProject : null);
  if (!project) return;
  await useProjectStore.getState().updateProject(projectId, {
    stageCompletionEvents: replaceStageCompletionEvent(project.stageCompletionEvents, event),
  });
};

const learnCompletionEvent = async (project: Project, event: StageCompletionEvent): Promise<StageCompletionEvent> => {
  const doc = useProjectDocStore.getState().projectDocs.find(item => item.id === event.extractionDocId);
  if (!doc) {
    const failed = { ...event, status: 'learning_failed' as const, learningError: '提炼文档不存在' };
    await updatePersistedEvent(project.id, failed);
    return failed;
  }
  const version = doc.versionId ? useProjectStore.getState().versions.find(item => item.id === doc.versionId) : undefined;
  try {
    const memory = await useAIJobStore.getState().runAIJob<StageMemoryEntry>(
      { scene: 'memory', title: `阶段记忆学习：${event.stageName}`, projectId: project.id, docId: doc.id, resultPreview: entry => entry?.summary || '已沉淀阶段写作记忆' },
      async ({ jobId, setProgress, throwIfCancelled }) => {
        setProgress(30);
        const entry = await useKnowledgeStore.getState().learnStageFinal({
          projectId: project.id,
          projectName: project.name,
          stageName: event.stageName,
          docId: doc.id,
          docName: doc.name,
          sourceFilePath: doc.sourceFilePath || version?.filePath,
          sourceVersionId: doc.versionId,
          sourceModifiedAt: doc.sourceFileModifiedAt || version?.createdAt,
          sourceKind: 'stage-completion',
          completionEventId: event.id,
          content: (doc.sourceFilePath || version?.filePath) ? undefined : version?.content,
          usageRequestId: jobId,
          usageTitle: `阶段记忆学习：${event.stageName}`,
        });
        throwIfCancelled();
        setProgress(88);
        if (!entry) throw new Error('未能生成阶段写作记忆');
        return entry;
      },
    );
    const learnedAt = memory.updatedAt || new Date().toISOString();
    await useProjectDocStore.getState().updateProjectDoc(doc.id, {
      learnedAt,
      lifecycleStatus: 'learned',
      lifecycleUpdatedAt: learnedAt,
    });
    const learned = { ...event, status: 'learned' as const, memoryId: memory.id, learnedAt, learningError: undefined };
    await updatePersistedEvent(project.id, learned);
    return learned;
  } catch (error: any) {
    const failed = { ...event, status: 'learning_failed' as const, learningError: error?.message || String(error) };
    await updatePersistedEvent(project.id, failed);
    return failed;
  }
};

export const useStageLifecycleStore = create<StageLifecycleState>((set, get) => ({
  busyStageKeys: [],

  completeStage: async ({ project, scope, extractionDocId, autoLearn }) => {
    const key = stageKey(project.id, scope.stageName);
    set(state => ({ busyStageKeys: [...new Set([...state.busyStageKeys, key])] }));
    try {
      const docs = useProjectDocStore.getState().projectDocs.filter(doc => scope.sourceDocIds.includes(doc.id));
      const extractionDoc = selectStageExtractionDocument(project, scope, docs, extractionDocId);
      const event = createStageCompletionEvent(scope, extractionDoc, autoLearn);
      await useProjectStore.getState().updateProject(project.id, {
        stageSummarySourceDocIds: extractionDoc ? { ...(project.stageSummarySourceDocIds || {}), [scope.stageName]: extractionDoc.id } : project.stageSummarySourceDocIds,
        stageCompletionEvents: [...(project.stageCompletionEvents || []), event],
      });
      await Promise.all(docs.map(doc => useProjectDocStore.getState().updateProjectDoc(doc.id, buildStageCompletionDocumentPatch(doc, event))));
      return event.status === 'learning' ? await learnCompletionEvent(project, event) : event;
    } finally {
      set(state => ({ busyStageKeys: state.busyStageKeys.filter(item => item !== key) }));
    }
  },

  reopenStage: async (project, scope) => {
    const key = stageKey(project.id, scope.stageName);
    set(state => ({ busyStageKeys: [...new Set([...state.busyStageKeys, key])] }));
    try {
      const latestProject = useProjectStore.getState().projects.find(item => item.id === project.id) || project;
      const event = getActiveStageCompletionEvent(latestProject, scope.stageName);
      const docs = useProjectDocStore.getState().projectDocs.filter(doc => scope.sourceDocIds.includes(doc.id));
      await Promise.all(docs.map(doc => useProjectDocStore.getState().updateProjectDoc(doc.id, buildStageReopenDocumentPatch(doc))));
      if (event) {
        await useKnowledgeStore.getState().deleteStageMemoryForEvent(event.id);
        await updatePersistedEvent(project.id, { ...event, status: 'reopened', reopenedAt: new Date().toISOString() });
      }
    } finally {
      set(state => ({ busyStageKeys: state.busyStageKeys.filter(item => item !== key) }));
    }
  },

  retryStageLearning: async (project, eventId) => {
    const latestProject = useProjectStore.getState().projects.find(item => item.id === project.id) || project;
    const event = latestProject.stageCompletionEvents?.find(item => item.id === eventId);
    if (!event || !['learning_failed', 'learned'].includes(event.status)) return null;
    const learning = { ...event, status: 'learning' as const, learningError: undefined };
    await updatePersistedEvent(project.id, learning);
    return learnCompletionEvent(project, learning);
  },

  removeStageMemory: async (project, memoryId) => {
    const memory = useKnowledgeStore.getState().stageMemories.find(item => item.id === memoryId);
    await useKnowledgeStore.getState().deleteStageMemory(memoryId);
    if (!memory?.completionEventId) return;
    const latestProject = useProjectStore.getState().projects.find(item => item.id === project.id) || project;
    const event = latestProject.stageCompletionEvents?.find(item => item.id === memory.completionEventId);
    if (!event) return;
    const doc = useProjectDocStore.getState().projectDocs.find(item => item.id === event.extractionDocId);
    if (doc) await useProjectDocStore.getState().updateProjectDoc(doc.id, {
      learnedAt: undefined,
      lifecycleStatus: 'completed',
      lifecycleUpdatedAt: new Date().toISOString(),
    });
    await updatePersistedEvent(project.id, {
      ...event,
      status: 'learning_failed',
      memoryId: undefined,
      learnedAt: undefined,
      learningError: '阶段记忆已由用户删除，可按需重新学习',
    });
  },
}));

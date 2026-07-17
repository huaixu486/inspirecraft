import { Project, ProjectDocument, StageCompletionEvent } from '../../shared/types';
import { inferProjectDocumentLifecycle, reopenLifecycleStatus, transitionProjectDocumentLifecycle } from './documentLifecycle';

export interface StageCompletionScope {
  projectId: string;
  stageName: string;
  sourceDocIds: string[];
}

export const sortStageDocuments = (docs: ProjectDocument[]) => [...docs].sort((a, b) => {
  const aTime = new Date(a.sourceFileModifiedAt || a.analyzedAt || a.createdAt).getTime();
  const bTime = new Date(b.sourceFileModifiedAt || b.analyzedAt || b.createdAt).getTime();
  return bTime - aTime;
});

export const selectStageExtractionDocument = (
  project: Project,
  scope: StageCompletionScope,
  docs: ProjectDocument[],
  requestedDocId?: string,
) => {
  const sorted = sortStageDocuments(docs.filter(doc => scope.sourceDocIds.includes(doc.id)));
  const selectedId = requestedDocId || project.stageSummarySourceDocIds?.[scope.stageName];
  return sorted.find(doc => doc.id === selectedId) || sorted[0];
};

export const createStageCompletionEvent = (
  scope: StageCompletionScope,
  sourceDoc: ProjectDocument | undefined,
  shouldLearn: boolean,
  timestamp = new Date().toISOString(),
): StageCompletionEvent => ({
  id: `stage-completion-${scope.projectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  projectId: scope.projectId,
  stageName: scope.stageName,
  sourceDocIds: [...scope.sourceDocIds],
  extractionDocId: sourceDoc?.id,
  extractionVersionId: sourceDoc?.versionId,
  completedAt: timestamp,
  status: shouldLearn && sourceDoc ? 'learning' : 'completed',
});

export const getActiveStageCompletionEvent = (project: Project, stageName: string) =>
  [...(project.stageCompletionEvents || [])]
    .reverse()
    .find(event => event.stageName === stageName && event.status !== 'reopened');

export const buildStageCompletionDocumentPatch = (
  doc: ProjectDocument,
  event: StageCompletionEvent,
): Partial<ProjectDocument> => ({
  completedAt: event.completedAt,
  completionEventId: event.id,
  lifecycleStatusBeforeCompletion: inferProjectDocumentLifecycle(doc),
  ...transitionProjectDocumentLifecycle(doc, 'completed', event.completedAt),
});

export const buildStageReopenDocumentPatch = (
  doc: ProjectDocument,
  timestamp = new Date().toISOString(),
): Partial<ProjectDocument> => ({
  completedAt: undefined,
  learnedAt: undefined,
  completionEventId: undefined,
  reopenedAt: timestamp,
  lifecycleStatus: doc.lifecycleStatusBeforeCompletion || reopenLifecycleStatus({ ...doc, completedAt: undefined, learnedAt: undefined }),
  lifecycleStatusBeforeCompletion: undefined,
  lifecycleUpdatedAt: timestamp,
});

export const replaceStageCompletionEvent = (
  events: StageCompletionEvent[] = [],
  next: StageCompletionEvent,
) => [...events.filter(event => event.id !== next.id), next];

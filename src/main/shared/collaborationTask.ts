import type { TaskItem } from '../types';

export const buildAcceptedCollaborationTask = (params: {
  incoming: TaskItem;
  localProjectId: string;
  offerId: string;
  sourceMessageId: string;
  sourceProjectName?: string;
  now?: string;
}): TaskItem => {
  const now = params.now || new Date().toISOString();
  const { incoming } = params;
  return {
    ...incoming,
    id: `incoming-${params.offerId}-${Date.now()}`,
    projectId: params.localProjectId,
    description: [
      incoming.description,
      params.sourceProjectName ? `来自协作项目：${params.sourceProjectName}` : '',
    ].filter(Boolean).join('\n'),
    executor: incoming.type === 'ai' ? 'ai' : 'human',
    workStatus: 'pending',
    action: incoming.action === 'dispatch' ? (incoming.type === 'ai' ? 'write' : 'open_file') : incoming.action,
    status: 'pending',
    source: incoming.source === 'review' ? 'review' : 'manual',
    relatedDocId: undefined,
    relatedReviewId: undefined,
    relatedIssueId: undefined,
    documentContext: undefined,
    workflowId: undefined,
    workflowName: undefined,
    workflowOrder: undefined,
    dependsOnTaskId: undefined,
    dependsOn: undefined,
    sourceMessageId: params.sourceMessageId,
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
  };
};

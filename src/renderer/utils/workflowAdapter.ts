import { TaskItem, WorkItem, WorkItemAction, WorkItemExecutor, WorkItemSource, WorkItemStatus } from '../../shared/types';

export interface WorkItemQuery {
  projectId?: string;
  stageName?: string;
  source?: WorkItemSource;
  executor?: WorkItemExecutor;
  status?: WorkItemStatus;
}

const statusFromLegacy = (task: TaskItem): WorkItemStatus => task.workStatus || task.status;

const actionFromLegacy = (task: TaskItem): WorkItemAction => {
  if (task.source === 'review') return 'revise';
  if (task.source === 'report') return 'write';
  if (task.type === 'manual' && task.relatedDocId) return 'open_file';
  return task.type === 'ai' ? 'write' : 'open_file';
};

export const adaptTaskItemToWorkItem = (task: TaskItem): WorkItem => ({
  id: task.id,
  projectId: task.projectId,
  stageName: task.stageName,
  title: task.title,
  description: task.description || undefined,
  source: task.source || 'manual',
  executor: task.executor || (task.type === 'ai' ? 'ai' : 'human'),
  status: statusFromLegacy(task),
  priority: task.priority,
  documentContext: task.documentContext || (task.relatedDocId || task.sectionTitle || task.sourceLineNumber
    ? {
        projectDocumentId: task.relatedDocId,
        sectionTitle: task.sectionTitle,
        lineNumber: task.sourceLineNumber,
      }
    : undefined),
  action: task.action || actionFromLegacy(task),
  dependsOn: task.dependsOn || (task.dependsOnTaskId ? [task.dependsOnTaskId] : undefined),
  assigneeId: task.assigneeName,
  dueAt: task.dueAt,
  resultRef: task.result,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt || task.completedAt || task.createdAt,
  completedAt: task.completedAt,
});

export const normalizeTaskItemContract = (task: TaskItem): TaskItem => {
  const workItem = adaptTaskItemToWorkItem(task);
  return {
    ...task,
    executor: workItem.executor,
    workStatus: workItem.status === 'blocked' ? (task.workStatus || task.status) : workItem.status,
    action: workItem.action,
    documentContext: workItem.documentContext,
    dependsOn: workItem.dependsOn,
    updatedAt: task.updatedAt || task.createdAt,
  };
};

export const adaptTaskItemsToWorkItems = (tasks: TaskItem[]): WorkItem[] => {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  return tasks.map(task => {
    const workItem = adaptTaskItemToWorkItem(task);
    const dependencyIds = task.dependsOn || (task.dependsOnTaskId ? [task.dependsOnTaskId] : []);
    if (!dependencyIds.length || workItem.status === 'completed') return workItem;
    const blocked = dependencyIds.some(id => {
      const dependency = taskById.get(id);
      return !dependency || adaptTaskItemToWorkItem(dependency).status !== 'completed';
    });
    return blocked
      ? { ...workItem, status: 'blocked' }
      : workItem;
  });
};

export const selectWorkItems = (workItems: WorkItem[], query: WorkItemQuery = {}): WorkItem[] =>
  workItems.filter(item =>
    (!query.projectId || item.projectId === query.projectId)
    && (!query.stageName || item.stageName === query.stageName)
    && (!query.source || item.source === query.source)
    && (!query.executor || item.executor === query.executor)
    && (!query.status || item.status === query.status));

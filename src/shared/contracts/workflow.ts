export type WorkItemSource = 'manual' | 'report' | 'review' | 'stage' | 'friend';
export type WorkItemExecutor = 'human' | 'ai' | 'friend';
export type WorkItemStatus = 'draft' | 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type WorkItemAction = 'write' | 'revise' | 'review' | 'format' | 'open_file' | 'dispatch';

export interface WorkItemDocumentContext {
  projectDocumentId?: string;
  versionId?: string;
  filePath?: string;
  sectionTitle?: string;
  lineNumber?: number;
  selectedText?: string;
}

export interface WorkItem {
  id: string;
  projectId: string;
  stageName?: string;
  title: string;
  description?: string;
  source: WorkItemSource;
  executor: WorkItemExecutor;
  status: WorkItemStatus;
  priority: 'high' | 'medium' | 'low';
  documentContext?: WorkItemDocumentContext;
  action: WorkItemAction;
  dependsOn?: string[];
  assigneeId?: string;
  dueAt?: string;
  resultRef?: string;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type WorkflowWorkbenchTarget = 'plan' | 'team' | 'report' | 'review' | 'writing';

export interface WorkflowFocus {
  projectId: string;
  workflowId?: string;
  workItemId?: string;
  taskId?: string;
  relatedDocId?: string;
  documentContext?: WorkItemDocumentContext;
  stageName?: string;
  sectionTitle?: string;
  sourceLineNumber?: number;
  intent?: 'writing' | 'revision' | 'dispatch';
  source?: WorkItemSource;
  prompt?: string;
  target: WorkflowWorkbenchTarget;
}


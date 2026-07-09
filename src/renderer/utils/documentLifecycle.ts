import { ProjectDocument, ProjectDocumentLifecycleStatus, ReviewIssue } from '../../shared/types';

export const DOCUMENT_LIFECYCLE_LABELS: Record<ProjectDocumentLifecycleStatus, string> = {
  imported: '\u5df2\u5bfc\u5165',
  identified: '\u5df2\u8bc6\u522b\u9636\u6bb5',
  writing: '\u5199\u4f5c\u4e2d',
  analyzed: '\u5df2\u5206\u6790',
  reviewed: '\u5df2\u5ba1\u6838',
  needs_revision: '\u5f85\u4fee\u6539',
  completed: '\u5df2\u5b8c\u6210',
  learned: '\u5df2\u5b66\u4e60',
  archived: '\u5df2\u5f52\u6863',
};

export const DOCUMENT_LIFECYCLE_COLORS: Record<ProjectDocumentLifecycleStatus, string> = {
  imported: 'default',
  identified: 'blue',
  writing: 'processing',
  analyzed: 'cyan',
  reviewed: 'geekblue',
  needs_revision: 'orange',
  completed: 'green',
  learned: 'purple',
  archived: 'default',
};

export const inferProjectDocumentLifecycle = (doc: ProjectDocument): ProjectDocumentLifecycleStatus => {
  if (doc.lifecycleStatus === 'archived') return 'archived';
  if (doc.learnedAt || doc.lifecycleStatus === 'learned') return 'learned';
  if (doc.completedAt || doc.lifecycleStatus === 'completed') return 'completed';
  if (doc.lifecycleStatus === 'needs_revision' || doc.lifecycleStatus === 'reviewed') return doc.lifecycleStatus;
  if (doc.analyzedAt || doc.aiReport || (doc.sections?.length || 0) > 0) return 'analyzed';
  if (doc.templateId || doc.versionId || doc.sourceFilePath || doc.autoStage) return 'identified';
  return 'imported';
};

export const getProjectDocumentLifecycleLabel = (doc: ProjectDocument) =>
  DOCUMENT_LIFECYCLE_LABELS[inferProjectDocumentLifecycle(doc)];

export const getProjectDocumentLifecycleColor = (doc: ProjectDocument) =>
  DOCUMENT_LIFECYCLE_COLORS[inferProjectDocumentLifecycle(doc)];

export const buildLifecyclePatch = (
  status: ProjectDocumentLifecycleStatus,
  timestamp = new Date().toISOString(),
): Partial<ProjectDocument> => ({
  lifecycleStatus: status,
  lifecycleUpdatedAt: timestamp,
});

export const reviewLifecycleStatus = (issues: ReviewIssue[] = []): ProjectDocumentLifecycleStatus => {
  const hasActionableIssue = issues.some(issue => issue.severity === 'error' || issue.severity === 'warning');
  return hasActionableIssue ? 'needs_revision' : 'reviewed';
};

export const reopenLifecycleStatus = (doc: ProjectDocument): ProjectDocumentLifecycleStatus => {
  if (doc.reviewedAt || doc.lifecycleStatus === 'reviewed' || doc.lifecycleStatus === 'needs_revision') {
    return doc.lifecycleStatus === 'reviewed' ? 'reviewed' : 'needs_revision';
  }
  if (doc.analyzedAt || doc.aiReport || (doc.sections?.length || 0) > 0) return 'analyzed';
  if (doc.templateId || doc.versionId || doc.sourceFilePath || doc.autoStage) return 'identified';
  return 'imported';
};

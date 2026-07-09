import {
  DocumentVersion,
  Project,
  ProjectDocument,
  ReviewResult,
  StageConfig,
  StageMemoryEntry,
  TaskItem,
  WorkbenchPage,
  WritingTemplate,
} from '../../shared/types';
import { buildProjectStageSegments, detectTimelineStage } from './timelineStages';
import { inferProjectDocumentLifecycle } from './documentLifecycle';

export type ProjectNextActionKind =
  | 'task'
  | 'review'
  | 'document'
  | 'stage'
  | 'diff'
  | 'memory'
  | 'description';

export interface ProjectNextAction {
  id: string;
  kind: ProjectNextActionKind;
  priority: number;
  title: string;
  detail: string;
  target: WorkbenchPage;
  stageName?: string;
  docId?: string;
  taskId?: string;
  reviewId?: string;
  count?: number;
  severity?: 'high' | 'medium' | 'low';
}

interface DeriveProjectNextActionsParams {
  project: Project;
  tasks: TaskItem[];
  projectDocs: ProjectDocument[];
  versions: DocumentVersion[];
  templates: WritingTemplate[];
  reviews: ReviewResult[];
  stageMemories: StageMemoryEntry[];
  allStages: StageConfig[];
  limit?: number;
}

const toMs = (value?: string) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const getTaskTarget = (task: TaskItem): WorkbenchPage => {
  if (task.source === 'review' || task.relatedReviewId || task.relatedIssueId) return 'review';
  if (task.source === 'report') return task.type === 'ai' ? 'team' : 'report';
  if (task.source === 'stage' || task.stageName) return 'plan';
  if (task.relatedDocId) return task.type === 'ai' ? 'team' : 'report';
  if (task.type === 'ai') return 'team';
  return 'plan';
};

const taskPriorityScore = (task: TaskItem) => {
  const statusScore = task.status === 'in_progress' ? 0 : task.status === 'pending' ? 8 : 30;
  const priorityScore = task.priority === 'high' ? 0 : task.priority === 'medium' ? 4 : 8;
  const sourceScore = task.source === 'review' ? 0 : task.source === 'report' ? 2 : task.source === 'stage' ? 4 : 6;
  return statusScore + priorityScore + sourceScore;
};

const getDocDisplayName = (doc: ProjectDocument, versions: DocumentVersion[]) =>
  versions.find(version => version.id === doc.versionId)?.fileName || doc.name;

const getStageForDoc = (
  doc: ProjectDocument,
  versions: DocumentVersion[],
  templates: WritingTemplate[],
  allStages: StageConfig[],
) => {
  const version = versions.find(item => item.id === doc.versionId);
  const template = templates.find(item => item.id === doc.templateId);
  return detectTimelineStage(
    allStages,
    doc.name,
    doc.sourceFilePath,
    version?.fileName,
    version?.filePath,
    template?.name,
    template?.category,
  );
};

export const deriveProjectNextActions = ({
  project,
  tasks,
  projectDocs,
  versions,
  templates,
  reviews,
  stageMemories,
  allStages,
  limit = 6,
}: DeriveProjectNextActionsParams): ProjectNextAction[] => {
  const actions: ProjectNextAction[] = [];
  const projectTasks = tasks.filter(task => task.projectId === project.id && task.status !== 'completed');
  const projectDocsList = projectDocs.filter(doc => doc.projectId === project.id);
  const projectVersions = versions.filter(version => version.projectId === project.id);

  const topTasks = [...projectTasks]
    .sort((a, b) => {
      const scoreDiff = taskPriorityScore(a) - taskPriorityScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      const aOrder = a.workflowOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.workflowOrder ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return toMs(a.createdAt) - toMs(b.createdAt);
    })
    .slice(0, 3);

  topTasks.forEach((task, index) => {
    actions.push({
      id: 'task:' + task.id,
      kind: 'task',
      priority: 10 + index + taskPriorityScore(task),
      title: task.title || '\u5904\u7406\u5f85\u529e\u4efb\u52a1',
      detail: task.workflowName || task.description || task.stageName || '\u6765\u81ea\u9879\u76ee\u8ba1\u5212\u7684\u5f85\u529e\u4e8b\u9879',
      target: getTaskTarget(task),
      stageName: task.stageName,
      docId: task.relatedDocId,
      taskId: task.id,
      reviewId: task.relatedReviewId,
      severity: task.priority === 'high' ? 'high' : task.priority === 'medium' ? 'medium' : 'low',
    });
  });

  const latestReview = [...reviews]
    .filter(review => review.projectId === project.id)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0];
  const latestIssues = Array.isArray(latestReview?.issues) ? latestReview.issues : [];
  const errorCount = latestIssues.filter(issue => issue.severity === 'error').length;
  const warningCount = latestIssues.filter(issue => issue.severity === 'warning').length;
  if (latestReview && (errorCount > 0 || warningCount > 0)) {
    actions.push({
      id: 'review:' + latestReview.id,
      kind: 'review',
      priority: errorCount > 0 ? 4 : 18,
      title: errorCount > 0 ? '\u5904\u7406 ' + errorCount + ' \u4e2a\u4e25\u91cd\u5ba1\u6838\u95ee\u9898' : '\u67e5\u770b ' + warningCount + ' \u4e2a\u5ba1\u6838\u63d0\u9192',
      detail: latestReview.summary || '\u6700\u8fd1\u5ba1\u6838\u5206\u6570 ' + latestReview.score + '\uff0c\u5efa\u8bae\u5148\u5904\u7406\u5ba1\u6838\u7ed3\u8bba',
      target: 'review',
      reviewId: latestReview.id,
      count: latestIssues.length,
      severity: errorCount > 0 ? 'high' : 'medium',
    });
  }

  const unfinishedDocs = projectDocsList
    .filter(doc => !['completed', 'learned', 'archived'].includes(inferProjectDocumentLifecycle(doc)) && (doc.overallProgress ?? 0) < 100)
    .sort((a, b) => {
      const progressDiff = (a.overallProgress ?? 0) - (b.overallProgress ?? 0);
      if (progressDiff !== 0) return progressDiff;
      return toMs(b.sourceFileModifiedAt || b.analyzedAt || b.createdAt) - toMs(a.sourceFileModifiedAt || a.analyzedAt || a.createdAt);
    });
  const nextDoc = unfinishedDocs[0];
  if (nextDoc) {
    const stageName = getStageForDoc(nextDoc, projectVersions, templates, allStages);
    actions.push({
      id: 'doc:' + nextDoc.id,
      kind: 'document',
      priority: 28 + Math.round((nextDoc.overallProgress ?? 0) / 10),
      title: '\u7ee7\u7eed\u5b8c\u5584\uff1a' + getDocDisplayName(nextDoc, projectVersions),
      detail: '\u5f53\u524d\u5b8c\u6210\u5ea6 ' + (nextDoc.overallProgress ?? 0) + '%' + (stageName ? '\uff0c\u9636\u6bb5\uff1a' + stageName : ''),
      target: 'report',
      stageName,
      docId: nextDoc.id,
      severity: (nextDoc.overallProgress ?? 0) < 40 ? 'medium' : 'low',
    });
  }

  const segments = buildProjectStageSegments(project, projectDocsList, templates, projectVersions, allStages);
  const nextStage = segments
    .filter(segment => !segment.completedAt)
    .sort((a, b) => {
      const aDeadline = toMs(a.deadline);
      const bDeadline = toMs(b.deadline);
      if (aDeadline && bDeadline && aDeadline !== bDeadline) return aDeadline - bDeadline;
      if (aDeadline !== bDeadline) return bDeadline - aDeadline;
      return toMs(b.lastActivityAt || b.startAt) - toMs(a.lastActivityAt || a.startAt);
    })[0];
  if (nextStage) {
    actions.push({
      id: 'stage:' + nextStage.stage,
      kind: 'stage',
      priority: nextStage.deadline ? 34 : 46,
      title: '\u63a8\u8fdb\u9636\u6bb5\uff1a' + nextStage.label,
      detail: nextStage.deadline
        ? '\u8ba1\u5212\u622a\u6b62 ' + new Date(nextStage.deadline).toLocaleDateString('zh-CN')
        : nextStage.sourceDocNames.length + ' \u4efd\u5173\u8054\u6587\u6863\u5f85\u63a8\u8fdb',
      target: 'plan',
      stageName: nextStage.stage,
      count: nextStage.sourceDocNames.length,
      severity: nextStage.deadline ? 'medium' : 'low',
    });
  }

  const learnedDocIds = new Set(stageMemories.filter(item => item.projectId === project.id && item.docId).map(item => item.docId));
  const unlearnedCompletedDoc = projectDocsList
    .filter(doc => doc.completedAt && !learnedDocIds.has(doc.id))
    .sort((a, b) => toMs(b.completedAt) - toMs(a.completedAt))[0];
  if (unlearnedCompletedDoc) {
    const stageName = getStageForDoc(unlearnedCompletedDoc, projectVersions, templates, allStages);
    actions.push({
      id: 'memory:' + unlearnedCompletedDoc.id,
      kind: 'memory',
      priority: 22,
      title: '\u66f4\u65b0\u9636\u6bb5\u8bb0\u5fc6',
      detail: '\u5df2\u5b8c\u6210\u6587\u6863\u300c' + getDocDisplayName(unlearnedCompletedDoc, projectVersions) + '\u300d\u8fd8\u672a\u8fdb\u5165\u9636\u6bb5\u8bb0\u5fc6',
      target: 'report',
      stageName,
      docId: unlearnedCompletedDoc.id,
      severity: 'medium',
    });
  }

  if (project.descriptionSource !== 'manual' && project.autoDescriptionPendingSince) {
    actions.push({
      id: 'description:' + project.id,
      kind: 'description',
      priority: 55,
      title: '\u7b49\u5f85\u66f4\u65b0\u9879\u76ee\u7b80\u8ff0',
      detail: project.autoDescriptionPendingFileNames?.length
        ? '\u5df2\u8bb0\u5f55 ' + project.autoDescriptionPendingFileNames.length + ' \u4e2a\u65b0\u589e\u6587\u4ef6\uff0c\u5468\u671f\u5230\u671f\u540e\u81ea\u52a8\u66f4\u65b0'
        : '\u5df2\u6709\u65b0\u589e\u6587\u4ef6\u8bb0\u5f55\uff0c\u9879\u76ee\u7b80\u8ff0\u5c06\u5728\u66f4\u65b0\u5468\u671f\u5185\u81ea\u52a8\u751f\u6210',
      target: 'files',
      severity: 'low',
    });
  }

  const versionsByStage = new Map<string, DocumentVersion[]>();
  projectVersions.forEach(version => {
    const stage = detectTimelineStage(allStages, version.fileName, version.filePath);
    const list = versionsByStage.get(stage) || [];
    list.push(version);
    versionsByStage.set(stage, list);
  });
  const comparableStage = Array.from(versionsByStage.entries())
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (comparableStage) {
    actions.push({
      id: 'diff:' + comparableStage[0],
      kind: 'diff',
      priority: 60,
      title: '\u53ef\u8fdb\u884c\u7248\u672c\u5bf9\u6bd4',
      detail: comparableStage[0] + ' \u9636\u6bb5\u6709 ' + comparableStage[1].length + ' \u4e2a\u53ef\u5bf9\u6bd4\u7248\u672c',
      target: 'calendar',
      stageName: comparableStage[0],
      count: comparableStage[1].length,
      severity: 'low',
    });
  }

  const byId = new Map<string, ProjectNextAction>();
  actions.forEach(action => {
    const existing = byId.get(action.id);
    if (!existing || action.priority < existing.priority) byId.set(action.id, action);
  });

  return Array.from(byId.values())
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
};

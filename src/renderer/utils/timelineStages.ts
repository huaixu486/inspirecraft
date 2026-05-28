import { DocumentVersion, Project, ProjectDocument, WritingTemplate } from '../../shared/types';

export type TimelineStageName = '提案' | '指南编写' | '可研' | '其他';

export const timelineStageMeta: Record<TimelineStageName, { color: string; label: string }> = {
  '提案': { color: '#1677ff', label: '提案阶段' },
  '指南编写': { color: '#faad14', label: '指南编写' },
  '可研': { color: '#52c41a', label: '可研阶段' },
  '其他': { color: '#8c8c8c', label: '其他阶段' },
};

export interface TimelineStageSegment {
  projectId: string;
  projectName: string;
  stage: TimelineStageName;
  label: string;
  startAt: string;
  deadline?: string;
  completedAt?: string;
  lastActivityAt?: string;
  sourceDocIds: string[];
  sourceDocNames: string[];
}

const STAGE_ORDER: TimelineStageName[] = ['提案', '指南编写', '可研', '其他'];

const toMs = (value?: string) => {
  if (!value) return Number.NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
};

const validTimes = (values: Array<string | undefined>) =>
  values.map(toMs).filter(Number.isFinite);

export const detectTimelineStage = (...parts: Array<string | undefined>): TimelineStageName => {
  const text = parts.filter(Boolean).join(' ');
  if (/可研|可行性/.test(text)) return '可研';
  if (/指南/.test(text)) return '指南编写';
  if (/提案|投标/.test(text)) return '提案';
  return '其他';
};

export const buildProjectStageSegments = (
  project: Project,
  projectDocs: ProjectDocument[],
  templates: WritingTemplate[],
  versions: DocumentVersion[],
): TimelineStageSegment[] => {
  const docsByStage = new Map<TimelineStageName, ProjectDocument[]>();

  for (const doc of projectDocs) {
    const template = templates.find(t => t.id === doc.templateId);
    const version = versions.find(v => v.id === doc.versionId);
    const stage = detectTimelineStage(
      doc.name,
      doc.sourceFilePath,
      template?.name,
      template?.category,
      version?.fileName,
    );
    const docs = docsByStage.get(stage) || [];
    docs.push(doc);
    docsByStage.set(stage, docs);
  }

  return STAGE_ORDER.flatMap(stage => {
    const docs = docsByStage.get(stage) || [];
    if (docs.length === 0) return [];

    const sourceDocNames = docs.map(doc => {
      const version = versions.find(v => v.id === doc.versionId);
      return version?.fileName || doc.name;
    });
    const docStartTimes = docs.map(doc => {
      const version = versions.find(v => v.id === doc.versionId);
      const sourceMs = toMs(doc.sourceFileCreatedAt);
      const versionMs = toMs(version?.createdAt);
      if (Number.isFinite(sourceMs)) return sourceMs;
      if (Number.isFinite(versionMs)) return versionMs;
      return toMs(doc.createdAt);
    }).filter(Number.isFinite);

    const projectCreatedMs = toMs(project.createdAt);
    const hasSourceFiles = docs.some(doc => Boolean(doc.sourceFileCreatedAt));
    const startMs = stage === '提案' && !hasSourceFiles
      ? (Number.isFinite(projectCreatedMs) ? projectCreatedMs : Math.min(...docStartTimes))
      : Math.min(...docStartTimes);

    const deadlineTimes = validTimes(docs.map(doc => doc.deadline));
    const completedTimes = validTimes(docs.map(doc => doc.completedAt));
    const activityTimes = docs.flatMap(doc => {
      const version = versions.find(v => v.id === doc.versionId);
      return [doc.sourceFileModifiedAt, doc.sourceFileCreatedAt, version?.createdAt, doc.createdAt];
    }).map(toMs).filter(Number.isFinite);
    const allCompleted = docs.length > 0 && docs.every(doc => Boolean(doc.completedAt));

    return [{
      projectId: project.id,
      projectName: project.name,
      stage,
      label: timelineStageMeta[stage].label,
      startAt: new Date(startMs).toISOString(),
      deadline: deadlineTimes.length > 0 ? new Date(Math.max(...deadlineTimes)).toISOString() : undefined,
      completedAt: allCompleted && completedTimes.length > 0
        ? new Date(Math.max(...completedTimes)).toISOString()
        : undefined,
      lastActivityAt: activityTimes.length > 0 ? new Date(Math.max(...activityTimes)).toISOString() : undefined,
      sourceDocIds: docs.map(doc => doc.id),
      sourceDocNames,
    }];
  });
};

import { DocumentVersion, Project, ProjectDocument, StageConfig, WritingTemplate } from '../../shared/types';

export type { StageConfig } from '../../shared/types';

// 默认系统阶段
export const DEFAULT_STAGES: StageConfig[] = [
  { id: 'system-1', name: '提案', keywords: ['提案', '投标'], color: '#1677ff', isSystem: true },
  { id: 'system-2', name: '指南编写', keywords: ['指南'], color: '#722ed1', isSystem: true },
  { id: 'system-3', name: '可研', keywords: ['可研', '可行性'], color: '#52c41a', isSystem: true },
  { id: 'system-4', name: '其他', keywords: [], color: '#8c8c8c', isSystem: true },
];

// 获取所有阶段（系统 + 自定义）
export const getAllStages = (customStages: StageConfig[]): StageConfig[] => {
  return [...DEFAULT_STAGES, ...customStages];
};

// 获取阶段元数据（名称 → 颜色/标签）
export const getStageMeta = (allStages: StageConfig[]): Record<string, { color: string; label: string }> => {
  const meta: Record<string, { color: string; label: string }> = {};
  for (const stage of allStages) {
    meta[stage.name] = { color: stage.color, label: stage.name };
  }
  return meta;
};

// 获取阶段排序列表
export const getStageOrder = (allStages: StageConfig[]): string[] => {
  return allStages.map(s => s.name);
};

// 统一的项目进度计算函数
// 返回 0-100 的进度百分比，基于已完成阶段数 / 总阶段数
export const getProjectProgress = (
  project: Project,
  projectDocs: ProjectDocument[],
  templates: WritingTemplate[],
  versions: DocumentVersion[],
  allStages: StageConfig[],
): number => {
  const segments = buildProjectStageSegments(project, projectDocs, templates, versions, allStages);
  if (segments.length === 0) return 0;
  const completed = segments.filter(s => Boolean(s.completedAt)).length;
  return Math.round((completed / segments.length) * 100);
};

export interface TimelineStageSegment {
  projectId: string;
  projectName: string;
  stage: string;
  label: string;
  startAt: string;
  deadline?: string;
  completedAt?: string;
  lastActivityAt?: string;
  sourceDocIds: string[];
  sourceDocNames: string[];
}

const toMs = (value?: string) => {
  if (!value) return Number.NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
};

const validTimes = (values: Array<string | undefined>) =>
  values.map(toMs).filter(Number.isFinite);

// 根据关键词检测文件所属阶段
export const detectTimelineStage = (
  allStages: StageConfig[],
  ...parts: Array<string | undefined>
): string => {
  const text = parts.filter(Boolean).join(' ');
  // 先检查自定义阶段（按顺序匹配）
  for (const stage of allStages) {
    if (stage.isSystem) continue; // 系统阶段最后匹配
    if (stage.keywords.length === 0) continue;
    for (const keyword of stage.keywords) {
      if (text.includes(keyword)) return stage.name;
    }
  }
  // 再检查系统阶段
  for (const stage of allStages) {
    if (!stage.isSystem) continue;
    if (stage.name === '其他') continue; // "其他"最后匹配
    for (const keyword of stage.keywords) {
      if (text.includes(keyword)) return stage.name;
    }
  }
  // 默认归入"其他"
  return '其他';
};

export const buildProjectStageSegments = (
  project: Project,
  projectDocs: ProjectDocument[],
  templates: WritingTemplate[],
  versions: DocumentVersion[],
  allStages: StageConfig[],
): TimelineStageSegment[] => {
  const docsByStage = new Map<string, ProjectDocument[]>();
  const stageOrder = getStageOrder(allStages);

  for (const doc of projectDocs) {
    const template = templates.find(t => t.id === doc.templateId);
    const version = versions.find(v => v.id === doc.versionId);
    const stage = detectTimelineStage(
      allStages,
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

  return stageOrder.flatMap(stage => {
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

    const stageMeta = getStageMeta(allStages)[stage] || { color: '#8c8c8c', label: stage };

    return [{
      projectId: project.id,
      projectName: project.name,
      stage,
      label: stageMeta.label,
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

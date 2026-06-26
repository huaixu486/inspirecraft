import { DocumentVersion, Project, ProjectDocument, StageConfig, WritingTemplate } from '../../shared/types';

export type { StageConfig } from '../../shared/types';

// 默认系统阶段
export const DEFAULT_STAGES: StageConfig[] = [
  { id: 'system-1', name: '\u63d0\u6848', keywords: ['\u63d0\u6848', '\u6295\u6807'], color: '#1677ff', isSystem: true },
  { id: 'system-2', name: '\u6307\u5357\u7f16\u5199', keywords: ['\u6307\u5357'], color: '#722ed1', isSystem: true },
  { id: 'system-3', name: '\u53ef\u7814', keywords: ['\u53ef\u7814', '\u53ef\u884c\u6027'], color: '#52c41a', isSystem: true },
  { id: 'system-4', name: '\u5176\u4ed6', keywords: [], color: '#8c8c8c', isSystem: true },
];

const isOtherStage = (stage: StageConfig) => stage.id === 'system-4' || stage.name.trim() === '\u5176\u4ed6';

const placeOtherStageLast = (stages: StageConfig[]): StageConfig[] => {
  const regularStages = stages.filter(stage => !isOtherStage(stage));
  const otherStages = stages.filter(isOtherStage);
  return [...regularStages, ...otherStages];
};

// 获取所有阶段（系统 + 自定义，自定义可覆盖同id的系统阶段）
export const getAllStages = (customStages: StageConfig[]): StageConfig[] => {
  const defaultIds = new Set(DEFAULT_STAGES.map(s => s.id));
  const overrides = new Map(customStages.map(s => [s.id, s]));
  const systemStages = DEFAULT_STAGES.flatMap(stage => {
    const override = overrides.get(stage.id);
    if (override?.deleted) return [];
    return [{ ...stage, ...override, isSystem: true, deleted: false }];
  });
  const customOnly = customStages.filter(stage => !stage.deleted && !defaultIds.has(stage.id));
  return placeOtherStageLast([...systemStages, ...customOnly]);
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

const countCompletedStages = (segments: TimelineStageSegment[]): number =>
  segments.filter(s => Boolean(s.completedAt)).length;

// 项目列表进度：已完成阶段数 / 当前系统中启用的全部阶段数
export const getGlobalStageProgress = (
  project: Project,
  projectDocs: ProjectDocument[],
  templates: WritingTemplate[],
  versions: DocumentVersion[],
  allStages: StageConfig[],
): number => {
  if (allStages.length === 0) return 0;
  const segments = buildProjectStageSegments(project, projectDocs, templates, versions, allStages);
  return Math.round((countCompletedStages(segments) / allStages.length) * 100);
};

// 当前项目阶段完成度：已完成阶段数 / 当前项目已创建的阶段数
export const getProjectProgress = (
  project: Project,
  projectDocs: ProjectDocument[],
  templates: WritingTemplate[],
  versions: DocumentVersion[],
  allStages: StageConfig[],
): number => {
  const segments = buildProjectStageSegments(project, projectDocs, templates, versions, allStages);
  if (segments.length === 0) return 0;
  return Math.round((countCompletedStages(segments) / segments.length) * 100);
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
  const fallbackStage = allStages.find(stage => stage.keywords.length === 0)?.name || '\u5176\u4ed6';
  const primaryText = parts[0] || '';
  const secondaryText = parts.slice(1).filter(Boolean).join(' ');
  const candidates = allStages
    .filter(stage => stage.name !== fallbackStage && stage.keywords.length > 0)
    .map((stage, order) => {
      let score = 0;
      if (primaryText.includes(stage.name)) score += 90;
      if (secondaryText.includes(stage.name)) score += 8;
      for (const keyword of stage.keywords) {
        if (!keyword) continue;
        if (primaryText.includes(keyword)) score += 100 + keyword.length / 100;
        if (secondaryText.includes(keyword)) score += 10 + keyword.length / 1000;
      }
      return { stage, score, order };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);

  return candidates[0]?.stage.name || fallbackStage;
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

    const isImportedDoc = (doc: ProjectDocument) => Boolean(doc.autoStage && doc.sourceFilePath);
    const getDocStartMs = (doc: ProjectDocument) => {
      const version = versions.find(v => v.id === doc.versionId);
      if (isImportedDoc(doc)) {
        const sourceMs = toMs(doc.sourceFileCreatedAt);
        if (Number.isFinite(sourceMs)) return sourceMs;
      }
      const versionMs = toMs(version?.createdAt);
      if (Number.isFinite(versionMs)) return versionMs;
      return toMs(doc.createdAt);
    };
    const getDocEndMs = (doc: ProjectDocument) => {
      if (isImportedDoc(doc)) {
        const modifiedMs = toMs(doc.sourceFileModifiedAt);
        if (Number.isFinite(modifiedMs)) return modifiedMs;
        const createdMs = toMs(doc.sourceFileCreatedAt);
        if (Number.isFinite(createdMs)) return createdMs;
      }
      return toMs(doc.completedAt);
    };
    const getDocActivityMs = (doc: ProjectDocument) => {
      const version = versions.find(v => v.id === doc.versionId);
      if (isImportedDoc(doc)) {
        const modifiedMs = toMs(doc.sourceFileModifiedAt);
        if (Number.isFinite(modifiedMs)) return modifiedMs;
        const createdMs = toMs(doc.sourceFileCreatedAt);
        if (Number.isFinite(createdMs)) return createdMs;
      }
      return Math.max(
        ...[doc.completedAt, doc.analyzedAt, version?.createdAt, doc.createdAt].map(toMs).filter(Number.isFinite),
      );
    };

    const docStartTimes = docs.map(getDocStartMs).filter(Number.isFinite);
    const projectCreatedMs = toMs(project.createdAt);
    const hasImportedFiles = docs.some(isImportedDoc);
    const startMs = stage === '\u63d0\u6848' && !hasImportedFiles
      ? (Number.isFinite(projectCreatedMs) ? projectCreatedMs : Math.min(...docStartTimes))
      : Math.min(...docStartTimes);

    const deadlineTimes = validTimes(docs.map(doc => doc.deadline));
    const completedTimes = docs.map(getDocEndMs).filter(Number.isFinite);
    const activityTimes = docs.map(getDocActivityMs).filter(Number.isFinite);
    const allCompleted = docs.length > 0 && docs.every(doc => isImportedDoc(doc) ? Number.isFinite(getDocEndMs(doc)) : Boolean(doc.completedAt));

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

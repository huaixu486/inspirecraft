import { Project, ProjectDocument, StageConfig, WritingTemplate } from '../../shared/types';
import { detectTimelineStage } from './timelineStages';

interface ScannedStageFile {
  name: string;
  path: string;
  ext: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
}

interface SyncDeps {
  allStages: StageConfig[];
  projectDocs: ProjectDocument[];
  templates: WritingTemplate[];
  addProjectDoc: (doc: ProjectDocument) => Promise<void>;
  updateProjectDoc: (id: string, updates: Partial<ProjectDocument>) => Promise<void>;
}

interface SyncResult {
  matched: number;
  created: number;
  updated: number;
}

const normalizePath = (value: string) => value.toLowerCase().replace(/\\/g, '/');

const hashPath = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const hasStageKeyword = (allStages: StageConfig[], file: ScannedStageFile) =>
  detectTimelineStage(allStages, file.name, file.path) !== '其他';

const templateKindGroups = [
  ['申报指南', '指南'],
  ['提案表', '提案'],
  ['可研报告', '可行性研究', '可研'],
  ['任务书'],
  ['合同'],
  ['预算', '经费'],
  ['验收报告', '验收'],
  ['总结报告', '总结'],
  ['审查意见', '审查'],
];

const normalizeMatchText = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(' ').toLowerCase();

const findKindGroup = (text: string) =>
  templateKindGroups.find(group => group.some(token => text.includes(token.toLowerCase())));

const templateMatchesKind = (template: WritingTemplate, group?: string[]) => {
  if (!group) return false;
  const templateText = normalizeMatchText(template.name, template.category, template.description);
  return group.some(token => templateText.includes(token.toLowerCase()));
};

const sortNewestTemplate = (items: WritingTemplate[]) =>
  [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

const matchTemplateForFile = (templates: WritingTemplate[], allStages: StageConfig[], file: ScannedStageFile, stage: string) => {
  const fileText = normalizeMatchText(file.name, file.path);
  const kindGroup = findKindGroup(fileText);
  if (kindGroup) {
    const kindMatches = templates.filter(template => templateMatchesKind(template, kindGroup));
    return kindMatches.length ? sortNewestTemplate(kindMatches)[0] : undefined;
  }
  const directMatches = templates.filter(template => {
    const templateName = String(template.name || '').toLowerCase();
    const templateCategory = String(template.category || '').toLowerCase();
    return Boolean(templateName && fileText.includes(templateName)) || Boolean(templateCategory && fileText.includes(templateCategory));
  });
  if (directMatches.length) return sortNewestTemplate(directMatches)[0];
  const stageMatches = templates.filter(t =>
    t.name.includes(stage) || t.category?.includes(stage) || detectTimelineStage(allStages, t.name, t.category) === stage
  );
  return stageMatches.length === 1 ? stageMatches[0] : undefined;
};

export const syncProjectStageFiles = async (
  project: Project,
  deps: SyncDeps,
): Promise<SyncResult> => {
  if (!project.folderPath) return { matched: 0, created: 0, updated: 0 };

  const result = await window.electronAPI.scanStageFiles(project.folderPath);
  if (!result.success) return { matched: 0, created: 0, updated: 0 };

  const files = result.files.filter(f => hasStageKeyword(deps.allStages, f));
  let created = 0;
  let updated = 0;

  for (const file of files) {
    const stage = detectTimelineStage(deps.allStages, file.name, file.path);
    const matchedTemplate = matchTemplateForFile(deps.templates, deps.allStages, file, stage);
    const normalizedFilePath = normalizePath(file.path);
    const existing = deps.projectDocs.find(doc =>
      doc.projectId === project.id &&
      doc.sourceFilePath &&
      normalizePath(doc.sourceFilePath) === normalizedFilePath
    );

    const common: Partial<ProjectDocument> = {
      name: file.name,
      sourceFilePath: file.path,
      sourceFileCreatedAt: file.createdAt,
      sourceFileModifiedAt: file.modifiedAt,
      autoStage: true,
      completedAt: file.modifiedAt || file.createdAt,
    };

    if (existing) {
      const changed = existing.name !== file.name ||
        existing.sourceFileCreatedAt !== file.createdAt ||
        existing.sourceFileModifiedAt !== file.modifiedAt ||
        !existing.completedAt;
      if (changed) {
        await deps.updateProjectDoc(existing.id, common);
        updated += 1;
      }
      if (matchedTemplate?.id && existing.templateId !== matchedTemplate.id) {
        await deps.updateProjectDoc(existing.id, { templateId: matchedTemplate.id });
        updated += 1;
      }
      continue;
    }

    await deps.addProjectDoc({
      id: `auto-${project.id}-${hashPath(file.path)}`,
      projectId: project.id,
      templateId: matchedTemplate?.id || '',
      name: file.name,
      sections: [],
      overallProgress: 0,
      createdAt: file.createdAt,
      ...common,
    });
    created += 1;
  }

  return { matched: files.length, created, updated };
};

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
    };

    if (existing) {
      const changed = existing.name !== file.name ||
        existing.sourceFileCreatedAt !== file.createdAt ||
        existing.sourceFileModifiedAt !== file.modifiedAt;
      if (changed) {
        await deps.updateProjectDoc(existing.id, common);
        updated += 1;
      }
      continue;
    }

    // 通过关键字自动匹配模板
    const stage = detectTimelineStage(deps.allStages, file.name, file.path);
    const matchedTemplate = deps.templates.find(t =>
      t.name.includes(stage) || t.category?.includes(stage) || detectTimelineStage(deps.allStages, t.name, t.category) === stage
    );

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

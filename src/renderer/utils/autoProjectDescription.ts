import { Project, ProjectDocument, StageConfig } from '../../shared/types';
import { detectTimelineStage } from './timelineStages';
import { composePrompt } from './promptComposer';
import { isAIJobCancelledError, useAIJobStore } from '../stores/aiJobStore';

export const AUTO_PROJECT_DESCRIPTION_INTERVAL_DAYS = 5;
const MAX_PENDING_FILE_NAMES = 10;
const MAX_DOC_NAMES_FOR_PROMPT = 14;

export type UpdateProjectFn = (id: string, updates: Partial<Project>) => Promise<void>;

export const isManualProjectDescription = (project?: Project | null) =>
  Boolean(project?.description?.trim()) && project?.descriptionSource !== 'auto';

export const isAutoDescriptionProject = (project?: Project | null) =>
  Boolean(project) && !isManualProjectDescription(project);

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const cleanFileName = (value = '') => value.split(/[\\/]/).pop()?.trim() || value.trim();

export const markAutoDescriptionFileActivity = async (
  project: Project,
  updateProject: UpdateProjectFn,
  fileNames: string[] = [],
) => {
  if (!isAutoDescriptionProject(project)) return;
  const now = new Date();
  const cleanedNames = fileNames.map(cleanFileName).filter(Boolean);
  const pendingNames = [
    ...(project.autoDescriptionPendingFileNames || []),
    ...cleanedNames,
  ].filter((name, index, arr) => arr.indexOf(name) === index).slice(-MAX_PENDING_FILE_NAMES);

  await updateProject(project.id, {
    descriptionSource: 'auto',
    autoDescriptionPendingSince: project.autoDescriptionPendingSince || now.toISOString(),
    autoDescriptionNextUpdateAt: project.autoDescriptionNextUpdateAt || addDays(now, AUTO_PROJECT_DESCRIPTION_INTERVAL_DAYS).toISOString(),
    autoDescriptionPendingFileNames: pendingNames,
  });
};

export const shouldGenerateAutoProjectDescription = (project?: Project | null) => {
  if (!project || !isAutoDescriptionProject(project)) return false;
  if (!project.autoDescriptionPendingSince) return false;
  const nextAt = project.autoDescriptionNextUpdateAt || project.autoDescriptionPendingSince;
  return new Date(nextAt).getTime() <= Date.now();
};

const normalizeAiSummary = (value: string) =>
  value
    .replace(/^项目描述[:：]?\s*/i, '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

const buildAutoDescriptionPrompt = (project: Project, docs: ProjectDocument[], allStages: StageConfig[]) => {
  const projectDocs = docs.filter(doc => doc.projectId === project.id);
  const pendingNames = (project.autoDescriptionPendingFileNames || []).slice(-MAX_PENDING_FILE_NAMES);
  const docNames = projectDocs
    .map(doc => cleanFileName(doc.name || doc.sourceFilePath || ''))
    .filter(Boolean)
    .slice(-MAX_DOC_NAMES_FOR_PROMPT);
  const stages = Array.from(new Set(projectDocs
    .map(doc => detectTimelineStage(allStages, doc.name, doc.sourceFilePath))
    .filter(stage => stage && stage !== '其他'))).slice(0, 5);

  return composePrompt('description', {
    projectName: project.name,
    stages: stages.join('、'),
    pendingFiles: pendingNames.join('、'),
    existingFiles: docNames.join('、'),
  });
};

export const maybeGenerateAutoProjectDescription = async (
  project: Project,
  docs: ProjectDocument[],
  allStages: StageConfig[],
  updateProject: UpdateProjectFn,
) => {
  if (!shouldGenerateAutoProjectDescription(project)) return false;
  try {
    const prompt = buildAutoDescriptionPrompt(project, docs, allStages);
    const response = await useAIJobStore.getState().runAIJob(
      {
        scene: 'description',
        title: `\u66f4\u65b0\u9879\u76ee\u63cf\u8ff0\uff1a${project.name}`,
        projectId: project.id,
        inputHash: `${project.id}:${project.autoDescriptionPendingSince || ''}:${(project.autoDescriptionPendingFileNames || []).join('|')}`,
        resultPreview: (value) => normalizeAiSummary(String(value || '')),
      },
      async ({ setProgress, throwIfCancelled }) => {
        setProgress(45);
        const value = await window.electronAPI.callAI({ prompt, mode: 'single' });
        throwIfCancelled();
        setProgress(85);
        return value;
      },
    );
    const description = normalizeAiSummary(String(response || ''));
    if (!description) {
      await updateProject(project.id, {
        autoDescriptionNextUpdateAt: addDays(new Date(), 1).toISOString(),
      });
      return false;
    }
    await updateProject(project.id, {
      description,
      descriptionSource: 'auto',
      autoDescriptionUpdatedAt: new Date().toISOString(),
      autoDescriptionPendingSince: undefined,
      autoDescriptionNextUpdateAt: undefined,
      autoDescriptionPendingFileNames: [],
    });
    return true;
  } catch (error) {
    if (isAIJobCancelledError(error)) return false;
    console.warn('Auto project description failed:', error);
    await updateProject(project.id, {
      autoDescriptionNextUpdateAt: addDays(new Date(), 1).toISOString(),
    });
    return false;
  }
};
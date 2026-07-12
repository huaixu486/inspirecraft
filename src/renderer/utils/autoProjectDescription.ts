import { Project, ProjectDocument, StageConfig } from '../../shared/types';
import { detectTimelineStage } from './timelineStages';
import { composePromptAsync } from './promptComposer';
import { isAIJobCancelledError, useAIJobStore } from '../stores/aiJobStore';
import { useProjectStore } from '../stores/projectStore';
import { useProjectDocStore } from '../stores/projectDocStore';

export const AUTO_PROJECT_DESCRIPTION_INTERVAL_DAYS = 3;
const RETRY_INTERVAL_HOURS = 24;
const MAX_PENDING_FILE_NAMES = 10;
const MAX_DOC_NAMES_FOR_PROMPT = 5;

export type UpdateProjectFn = (id: string, updates: Partial<Project>) => Promise<void>;

/** 用户手动写过描述 → 永不覆盖 */
export const isManualProjectDescription = (project?: Project | null) =>
  Boolean(project?.description?.trim()) && project?.descriptionSource !== 'auto';

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

const cleanFileName = (value = '') => value.split(/[\\/]/).pop()?.trim() || value.trim();

/**
 * 记录文件活动，重置三天静默计时。
 * 跳过条件：手动描述、已成功生成。
 */
export const markAutoDescriptionFileActivity = async (
  project: Project,
  updateProject: UpdateProjectFn,
  options: { activityAt?: string; fileNames?: string[] } = {},
) => {
  if (isManualProjectDescription(project)) return;
  if (project.autoDescriptionGeneratedAt) return;

  const activityAt = options.activityAt || new Date().toISOString();
  const cleanedNames = (options.fileNames || []).map(cleanFileName).filter(Boolean);
  const pendingNames = [
    ...(project.autoDescriptionPendingFileNames || []),
    ...cleanedNames,
  ].filter((name, index, arr) => arr.indexOf(name) === index).slice(-MAX_PENDING_FILE_NAMES);

  await updateProject(project.id, {
    descriptionSource: 'auto',
    autoDescriptionLastFileActivityAt: activityAt,
    autoDescriptionPendingSince: activityAt,
    autoDescriptionNextUpdateAt: addDays(new Date(activityAt), AUTO_PROJECT_DESCRIPTION_INTERVAL_DAYS).toISOString(),
    autoDescriptionPendingFileNames: pendingNames,
  });
};

/**
 * 判断是否应该生成：
 * 1. 不是手动描述
 * 2. 未成功生成过（autoDescriptionGeneratedAt 为空）
 * 3. 当前没有描述内容
 * 4. 有待处理文件活动且已过三天
 * 5. 不在重试退避期内（autoDescriptionRetryAt > now 则跳过）
 */
export const shouldGenerateAutoProjectDescription = (
  project?: Project | null,
  fileCount?: number,
) => {
  if (!project) return false;
  if (isManualProjectDescription(project)) return false;
  if (project.autoDescriptionGeneratedAt) return false;
  if (project.description?.trim()) return false;
  // 没有活动基线时，不能把历史文件误判为用户刚刚的操作。
  if (!project.autoDescriptionLastFileActivityAt) return false;
  if (!project.autoDescriptionPendingSince) return false;
  if (fileCount !== undefined && fileCount < 2) return false;

  // 重试退避：如果设置了 retryAt 且还没到时间，跳过
  if (project.autoDescriptionRetryAt) {
    const retryAt = new Date(project.autoDescriptionRetryAt).getTime();
    if (retryAt > Date.now()) return false;
  }

  const nextAt = project.autoDescriptionNextUpdateAt || project.autoDescriptionPendingSince;
  return new Date(nextAt).getTime() <= Date.now();
};

const normalizeAiSummary = (value: string) =>
  value
    .replace(/^项目描述[:：]?\s*/i, '')
    .replace(/["""]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

const buildAutoDescriptionPrompt = async (project: Project, docs: ProjectDocument[], allStages: StageConfig[]) => {
  const projectDocs = docs.filter(doc => doc.projectId === project.id);
  const docNames = projectDocs
    .map(doc => cleanFileName(doc.name || doc.sourceFilePath || ''))
    .filter(Boolean)
    .slice(0, MAX_DOC_NAMES_FOR_PROMPT);
  const stages = Array.from(new Set(projectDocs
    .map(doc => detectTimelineStage(allStages, doc.name, doc.sourceFilePath))
    .filter(stage => stage && stage !== '其他'))).slice(0, 5);

  // The automatic scanner can run before the renderer has loaded prompt
  // templates.  Use the async composer so a valid description template is
  // loaded before an AI request is allowed to leave the application.
  return composePromptAsync('description', {
    projectName: project.name,
    stages: stages.join('、') || '暂无',
    pendingFiles: '',
    existingFiles: docNames.join('、') || '暂无',
  });
};

export const maybeGenerateAutoProjectDescription = async (
  project: Project,
  docs: ProjectDocument[],
  allStages: StageConfig[],
  updateProject: UpdateProjectFn,
  fileCount?: number,
  options: { forceRetry?: boolean } = {},
) => {
  const isEligibleForRetry = !isManualProjectDescription(project)
    && !project.autoDescriptionGeneratedAt
    && !project.description?.trim()
    && (fileCount === undefined || fileCount >= 2);
  if (options.forceRetry ? !isEligibleForRetry : !shouldGenerateAutoProjectDescription(project, fileCount)) return false;
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const prompt = await buildAutoDescriptionPrompt(project, docs, allStages);
    if (!prompt.trim()) {
      // Never spend tokens on a blank prompt: providers will answer it like a
      // general chat request, which is not a project description.
      throw new Error('项目概述提示词未就绪，已取消本次 AI 请求');
    }
    const response = await useAIJobStore.getState().runAIJob(
      {
        scene: 'description',
        title: `生成项目概述：${project.name}`,
        projectId: project.id,
        inputHash: `auto-desc:${project.id}:${project.autoDescriptionPendingSince || ''}`,
        resultPreview: (value) => normalizeAiSummary(String(value || '')),
        retry: async () => {
          // Re-read the project state before retrying. A user may have edited
          // the description after the original request failed.
          const latestProject = useProjectStore.getState().projects.find(item => item.id === project.id);
          if (!latestProject) return;
          await maybeGenerateAutoProjectDescription(
            latestProject,
            useProjectDocStore.getState().projectDocs,
            allStages,
            updateProject,
            fileCount,
            { forceRetry: true },
          );
        },
      },
      async ({ setProgress, throwIfCancelled }) => {
        setProgress(45);
        const value = await window.electronAPI.callAI({ prompt, mode: 'single' });
        throwIfCancelled();
        setProgress(85);
        if (!normalizeAiSummary(String(value || ''))) {
          throw new Error('AI 未返回可用的项目概述');
        }
        return value;
      },
    );
    const description = normalizeAiSummary(String(response || ''));
    if (!description) {
      // AI 返回空内容：不永久锁定，24 小时后重试
      await updateProject(project.id, {
        autoDescriptionGenerationAttempted: true,
        autoDescriptionLastErrorAt: nowIso,
        autoDescriptionRetryAt: addHours(now, RETRY_INTERVAL_HOURS).toISOString(),
      });
      return false;
    }
    // 成功：写入描述并永久锁定
    await updateProject(project.id, {
      description,
      descriptionSource: 'auto',
      autoDescriptionUpdatedAt: nowIso,
      autoDescriptionGeneratedAt: nowIso,
      autoDescriptionGenerationAttempted: true,
      autoDescriptionPendingSince: undefined,
      autoDescriptionNextUpdateAt: undefined,
      autoDescriptionRetryAt: undefined,
      autoDescriptionLastErrorAt: undefined,
      autoDescriptionPendingFileNames: [],
    });
    return true;
  } catch (error) {
    if (isAIJobCancelledError(error)) return false;
    console.warn('Auto project description failed:', error);
    // 失败：不永久锁定，24 小时后重试
    await updateProject(project.id, {
      autoDescriptionGenerationAttempted: true,
      autoDescriptionLastErrorAt: nowIso,
      autoDescriptionRetryAt: addHours(now, RETRY_INTERVAL_HOURS).toISOString(),
    });
    return false;
  }
};

/**
 * 清除自动生成锁定，允许重新生成。
 * 用于用户手动点击"恢复自动生成资格"按钮。
 */
export const resetAutoDescriptionLock = async (
  project: Project,
  updateProject: UpdateProjectFn,
) => {
  await updateProject(project.id, {
    description: '',
    descriptionSource: undefined,
    autoDescriptionGeneratedAt: undefined,
    autoDescriptionGenerationAttempted: undefined,
    autoDescriptionUpdatedAt: undefined,
    autoDescriptionRetryAt: undefined,
    autoDescriptionLastErrorAt: undefined,
  });
};

/**
 * 将自动生成的描述转为手动描述（用户编辑后）。
 */
export const convertToManualDescription = async (
  project: Project,
  updateProject: UpdateProjectFn,
  newDescription: string,
) => {
  await updateProject(project.id, {
    description: newDescription,
    descriptionSource: 'manual',
    autoDescriptionGeneratedAt: undefined,
    autoDescriptionGenerationAttempted: undefined,
    autoDescriptionUpdatedAt: undefined,
    autoDescriptionPendingSince: undefined,
    autoDescriptionNextUpdateAt: undefined,
    autoDescriptionRetryAt: undefined,
    autoDescriptionLastErrorAt: undefined,
    autoDescriptionPendingFileNames: [],
  });
};

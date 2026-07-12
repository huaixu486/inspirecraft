import { create } from 'zustand';
import type { AIJob, AIJobScene } from '../../shared/types';

export class AIJobCancelledError extends Error {
  constructor(message = 'AI 任务已取消') {
    super(message);
    this.name = 'AIJobCancelledError';
  }
}

export const isAIJobCancelledError = (error: unknown): error is AIJobCancelledError =>
  error instanceof AIJobCancelledError || (error instanceof Error && error.name === 'AIJobCancelledError');

type AIJobRunHelpers = {
  jobId: string;
  signal: AbortSignal;
  setProgress: (progress: number) => void;
  isCancelled: () => boolean;
  throwIfCancelled: () => void;
};

type AIJobRunOptions<T> = {
  scene: AIJobScene;
  title: string;
  projectId?: string;
  docId?: string;
  taskId?: string;
  inputHash?: string;
  dedupeKey?: string;
  resultPreview?: (result: T) => string | undefined;
  /**
   * Re-run the complete business operation, not just the raw model request.
   * A caller must provide this explicitly because most AI operations have
   * follow-up side effects (saving reviews, versions, tasks, etc.).
   */
  retry?: () => Promise<void>;
};

interface AIJobState {
  jobs: AIJob[];
  updateJob: (id: string, updates: Partial<AIJob>) => void;
  cancelJob: (id: string) => void;
  retryJob: (id: string) => Promise<boolean>;
  clearFinished: () => void;
  clearJob: (id: string) => void;
  runAIJob: <T>(options: AIJobRunOptions<T>, executor: (helpers: AIJobRunHelpers) => Promise<T>) => Promise<T>;
}

const MAX_JOBS = 60;
const activeControllers = new Map<string, AbortController>();
// Executors alone are not enough for retrying: their callers usually persist
// the returned result afterwards. Only explicitly registered whole-operation
// handlers are allowed to power the Retry button.
const retryHandlers = new Map<string, () => Promise<void>>();

const nowIso = () => new Date().toISOString();

const createJobId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ai-job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeProgress = (progress: number) => Math.max(0, Math.min(100, Math.round(progress)));

const isTerminalStatus = (status: AIJob['status']) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

const defaultPreview = (value: unknown) => {
  if (value == null) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
};

/** 生成去重 key：scene + projectId + docId + inputHash */
const buildDedupeKey = (options: { scene: string; projectId?: string; docId?: string; inputHash?: string }) =>
  [options.scene, options.projectId || '', options.docId || '', options.inputHash || ''].join(':');

export const useAIJobStore = create<AIJobState>((set, get) => ({
  jobs: [],

  updateJob: (id, updates) => {
    set((state) => ({
      jobs: state.jobs.map((job) => (
        job.id === id
          ? { ...job, ...updates, updatedAt: nowIso() }
          : job
      )),
    }));
  },

  cancelJob: (id) => {
    const job = get().jobs.find((item) => item.id === id);
    if (!job || isTerminalStatus(job.status)) return;
    activeControllers.get(id)?.abort();
    activeControllers.delete(id);
    get().updateJob(id, {
      status: 'cancelled',
      progress: 100,
      error: undefined,
      resultPreview: '用户已取消',
      finishedAt: nowIso(),
    });
  },

  retryJob: async (id) => {
    const job = get().jobs.find((item) => item.id === id);
    const retry = retryHandlers.get(id);
    if (!job || !isTerminalStatus(job.status) || !retry) return false;

    // 标记原任务为可重试状态已消耗。真正的重试由业务层重新执行
    // 完整操作，避免只得到 AI 文本却没有保存审查、版本或任务结果。
    get().updateJob(id, { canRetry: false });
    retryHandlers.delete(id);
    try {
      await retry();
      return true;
    } catch (error) {
      // The retry operation owns its user-facing error handling. Preserve the
      // original failure record instead of fabricating a permanently queued job.
      console.warn('AI job retry failed to start:', error);
      return false;
    }
  },

  clearFinished: () => {
    set((state) => {
      state.jobs
        .filter((job) => isTerminalStatus(job.status))
        .forEach((job) => retryHandlers.delete(job.id));
      return { jobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running') };
    });
  },

  clearJob: (id) => {
    retryHandlers.delete(id);
    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== id),
    }));
  },

  runAIJob: async (options, executor) => {
    // 去重检查：如果已有相同 dedupeKey 的 queued/running 任务，直接复用
    const dedupeKey = options.dedupeKey || buildDedupeKey(options);
    const existing = get().jobs.find(
      (job) => job.dedupeKey === dedupeKey && (job.status === 'queued' || job.status === 'running'),
    );
    if (existing) {
      // 等待已有任务完成，返回其结果（通过轮询状态）
      return new Promise<any>((resolve, reject) => {
        const check = () => {
          const current = get().jobs.find((j) => j.id === existing.id);
          if (!current) { reject(new Error('任务已移除')); return; }
          if (current.status === 'completed') { resolve(current.resultPreview as any); return; }
          if (current.status === 'failed') { reject(new Error(current.error || '任务失败')); return; }
          if (current.status === 'cancelled') { reject(new AIJobCancelledError()); return; }
          setTimeout(check, 300);
        };
        check();
      });
    }

    const createdAt = nowIso();
    const id = createJobId();
    const job: AIJob = {
      id,
      scene: options.scene,
      title: options.title,
      status: 'queued',
      progress: 0,
      projectId: options.projectId,
      docId: options.docId,
      taskId: options.taskId,
      inputHash: options.inputHash,
      dedupeKey,
      createdAt,
      updatedAt: createdAt,
    };

    set((state) => {
      const nextJobs = [job, ...state.jobs].slice(0, MAX_JOBS);
      state.jobs.slice(Math.max(0, MAX_JOBS - 1)).forEach((trimmed) => retryHandlers.delete(trimmed.id));
      return { jobs: nextJobs };
    });
    if (options.retry) retryHandlers.set(id, options.retry);

    const controller = new AbortController();
    activeControllers.set(id, controller);

    const getCurrentJob = () => get().jobs.find((item) => item.id === id);
    const isCancelled = () => controller.signal.aborted || getCurrentJob()?.status === 'cancelled';
    const throwIfCancelled = () => {
      if (isCancelled()) throw new AIJobCancelledError();
    };
    const setProgress = (progress: number) => {
      const current = getCurrentJob();
      if (!current || isTerminalStatus(current.status)) return;
      get().updateJob(id, { progress: normalizeProgress(progress) });
    };

    try {
      get().updateJob(id, { status: 'running', progress: 10, startedAt: nowIso() });
      throwIfCancelled();
      const result = await executor({ jobId: id, signal: controller.signal, setProgress, isCancelled, throwIfCancelled });
      throwIfCancelled();
      const resultPreview = options.resultPreview?.(result) || defaultPreview(result);
      const resultUsage = (result as { usage?: AIJob['tokenUsage'] } | null)?.usage;
      const tokenUsage = resultUsage || (typeof window !== 'undefined'
        ? await window.electronAPI?.getAIUsageForRequest?.(id).catch(() => undefined)
        : undefined);
      get().updateJob(id, {
        status: 'completed',
        progress: 100,
        resultPreview,
        error: undefined,
        finishedAt: nowIso(),
        canRetry: false,
        tokenUsage: tokenUsage && tokenUsage.totalTokens > 0 ? tokenUsage : undefined,
      });
      return result;
    } catch (error: any) {
      if (isAIJobCancelledError(error) || isCancelled()) {
        get().updateJob(id, {
          status: 'cancelled',
          progress: 100,
          error: undefined,
          resultPreview: '用户已取消',
          finishedAt: nowIso(),
        });
        throw new AIJobCancelledError();
      }
      get().updateJob(id, {
        status: 'failed',
        progress: 100,
        error: error?.message || String(error),
        finishedAt: nowIso(),
        canRetry: Boolean(options.retry),
      });
      throw error;
    } finally {
      activeControllers.delete(id);
    }
  },
}));

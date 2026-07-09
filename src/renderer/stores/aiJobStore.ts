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
  resultPreview?: (result: T) => string | undefined;
};

interface AIJobState {
  jobs: AIJob[];
  updateJob: (id: string, updates: Partial<AIJob>) => void;
  cancelJob: (id: string) => void;
  clearFinished: () => void;
  runAIJob: <T>(options: AIJobRunOptions<T>, executor: (helpers: AIJobRunHelpers) => Promise<T>) => Promise<T>;
}

const MAX_JOBS = 60;
const activeControllers = new Map<string, AbortController>();

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
    });
  },

  clearFinished: () => {
    set((state) => ({
      jobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
    }));
  },

  runAIJob: async (options, executor) => {
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
      createdAt,
      updatedAt: createdAt,
    };

    set((state) => ({ jobs: [job, ...state.jobs].slice(0, MAX_JOBS) }));

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
      get().updateJob(id, { status: 'running', progress: 10 });
      throwIfCancelled();
      const result = await executor({ signal: controller.signal, setProgress, isCancelled, throwIfCancelled });
      throwIfCancelled();
      const resultPreview = options.resultPreview?.(result) || defaultPreview(result);
      get().updateJob(id, {
        status: 'completed',
        progress: 100,
        resultPreview,
        error: undefined,
      });
      return result;
    } catch (error: any) {
      if (isAIJobCancelledError(error) || isCancelled()) {
        get().updateJob(id, {
          status: 'cancelled',
          progress: 100,
          error: undefined,
          resultPreview: '用户已取消',
        });
        throw new AIJobCancelledError();
      }
      get().updateJob(id, {
        status: 'failed',
        progress: 100,
        error: error?.message || String(error),
      });
      throw error;
    } finally {
      activeControllers.delete(id);
    }
  },
}));

import { create } from 'zustand';
import { AITokenUsage, TaskItem, WorkItem, WorkItemExecutor, WorkItemStatus } from '../../shared/types';
import { isAIJobCancelledError, useAIJobStore } from './aiJobStore';
import { adaptTaskItemsToWorkItems, normalizeTaskItemContract, selectWorkItems, WorkItemQuery } from '../utils/workflowAdapter';
import { assertIpcMutationSucceeded, requireIpcArray } from '../utils/ipcResult';

const taskTimeMs = (value?: string) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const normalizeTaskText = (value?: string) => String(value || '')
  .replace(/^\u6765\u81ea AI \u5199\u4f5c\u6846\u67b6\u5de5\u4f5c\u6d41\uff1a.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const getTaskSemanticKey = (task: TaskItem) => [
  task.projectId,
  task.relatedDocId || '',
  task.source || 'manual',
  task.type,
  normalizeTaskText(task.title),
  normalizeTaskText(task.description),
].join('|');

const dedupeTasks = (tasks: TaskItem[]) => {
  const byKey = new Map<string, TaskItem>();
  tasks.forEach((task) => {
    const key = getTaskSemanticKey(task);
    const existing = byKey.get(key);
    if (!existing || taskTimeMs(task.createdAt) >= taskTimeMs(existing.createdAt)) {
      byKey.set(key, task);
    }
  });
  return Array.from(byKey.values()).sort((a, b) => taskTimeMs(b.createdAt) - taskTimeMs(a.createdAt));
};


interface TaskState {
  tasks: TaskItem[];
  workItems: WorkItem[];
  isLoading: boolean;

  // 任务操作
  loadTasks: () => Promise<void>;
  addTask: (task: TaskItem) => Promise<void>;
  updateTask: (id: string, updates: Partial<TaskItem>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  getWorkItems: (query?: WorkItemQuery) => WorkItem[];
  isTaskBlocked: (id: string) => boolean;
  setTaskExecutor: (id: string, executor: WorkItemExecutor) => Promise<void>;
  transitionTaskStatus: (id: string, status: Extract<WorkItemStatus, 'pending' | 'in_progress' | 'completed'>) => Promise<boolean>;

  // AI 执行
  executeAITask: (taskId: string, content: string, instruction: string) => Promise<{ success: boolean; result?: string; usage?: AITokenUsage; error?: string }>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  workItems: [],
  isLoading: false,

  loadTasks: async () => {
    set({ isLoading: true });
    try {
      const tasks = requireIpcArray<TaskItem>(await window.electronAPI.loadTasks(), '加载任务失败');
      const normalized = dedupeTasks(tasks);
      set({ tasks: normalized, workItems: adaptTaskItemsToWorkItems(normalized), isLoading: false });
    } catch (error) {
      console.error('Failed to load tasks:', error);
      set({ isLoading: false });
    }
  },

  addTask: async (task) => {
    const prev = get().tasks;
    const normalizedTask = normalizeTaskItemContract(task);
    const newTasks = dedupeTasks([...prev.filter(t => t.id !== task.id), normalizedTask]);
    set({ tasks: newTasks, workItems: adaptTaskItemsToWorkItems(newTasks) });
    try {
      const result = await window.electronAPI.saveTask(normalizedTask);
      assertIpcMutationSucceeded(result, '保存任务失败');
    } catch (error) {
      console.error('Failed to save task:', error);
      set({ tasks: prev, workItems: adaptTaskItemsToWorkItems(prev) });
    }
  },

  updateTask: async (id, updates) => {
    const prev = get().tasks;
    const tasks = dedupeTasks(prev.map((t) =>
      t.id === id ? normalizeTaskItemContract({ ...t, ...updates, updatedAt: new Date().toISOString() }) : t
    ));
    set({ tasks, workItems: adaptTaskItemsToWorkItems(tasks) });
    const updatedTask = tasks.find(t => t.id === id);
    if (updatedTask) {
      try {
        const result = await window.electronAPI.saveTask(updatedTask);
        assertIpcMutationSucceeded(result, '更新任务失败');
      } catch (error) {
        console.error('Failed to update task:', error);
        set({ tasks: prev, workItems: adaptTaskItemsToWorkItems(prev) });
      }
    }
  },

  deleteTask: async (id) => {
    const prev = get().tasks;
    const newTasks = prev.filter((t) => t.id !== id);
    set({ tasks: newTasks, workItems: adaptTaskItemsToWorkItems(newTasks) });
    try {
      const result = await window.electronAPI.deleteTask(id);
      assertIpcMutationSucceeded(result, '删除任务失败');
    } catch (error) {
      console.error('Failed to delete task:', error);
      set({ tasks: prev, workItems: adaptTaskItemsToWorkItems(prev) });
    }
  },

  getWorkItems: (query) => selectWorkItems(get().workItems, query),

  isTaskBlocked: (id) => get().workItems.some(item => item.id === id && item.status === 'blocked'),

  setTaskExecutor: async (id, executor) => {
    await get().updateTask(id, {
      executor,
      type: executor === 'ai' ? 'ai' : 'manual',
      updatedAt: new Date().toISOString(),
    });
  },

  transitionTaskStatus: async (id, status) => {
    const task = get().tasks.find(item => item.id === id);
    if (!task) return false;
    if (status !== 'pending' && get().isTaskBlocked(id)) return false;
    await get().updateTask(id, {
      status,
      workStatus: status,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    });
    return true;
  },

  executeAITask: async (taskId, content, instruction) => {
    const prevTask = get().tasks.find(t => t.id === taskId);
    if (get().isTaskBlocked(taskId)) {
      return { success: false, error: '前置任务尚未完成' };
    }
    try {
      await get().updateTask(taskId, { status: 'in_progress' });

      const result = await useAIJobStore.getState().runAIJob<{ success: boolean; result?: string; usage?: AITokenUsage; error?: string }>(
        {
          scene: 'taskExecute',
          title: `\u6267\u884c\u4efb\u52a1\uff1a${prevTask?.title || taskId}`,
          projectId: prevTask?.projectId,
          taskId,
          inputHash: `${taskId}:${content.length}:${instruction.length}`,
          resultPreview: (value) => value.success ? value.result : value.error,
          // 重试必须重新运行完整的任务流程，确保结果会写回任务状态。
          retry: async () => {
            await get().executeAITask(taskId, content, instruction);
          },
        },
        async ({ jobId, setProgress, throwIfCancelled }) => {
          setProgress(35);
          const value = await window.electronAPI.executeAITask({
            taskId,
            content,
            instruction,
            usageRequestId: jobId,
          });
          throwIfCancelled();
          setProgress(85);
          if (!value.success) {
            throw new Error(value.error || '\u4efb\u52a1\u6267\u884c\u5931\u8d25');
          }
          return value;
        },
      );

      if (result.success) {
        await get().updateTask(taskId, {
          status: 'completed',
          result: result.result,
          completedAt: new Date().toISOString(),
        });
      } else {
        // 失败：恢复原状态，保留错误信息
        await get().updateTask(taskId, {
          status: prevTask?.status || 'pending',
          result: `执行失败: ${result.error || '未知错误'}`,
        });
      }

      return result;
    } catch (error: any) {
      console.error('Failed to execute AI task:', error);
      await get().updateTask(taskId, {
        status: prevTask?.status || 'pending',
        result: `执行异常: ${error.message}`,
      });
      return { success: false, error: error.message };
    }
  },
}));

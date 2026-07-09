import { create } from 'zustand';
import { TaskItem } from '../../shared/types';
import { isAIJobCancelledError, useAIJobStore } from './aiJobStore';

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
  isLoading: boolean;

  // 任务操作
  loadTasks: () => Promise<void>;
  addTask: (task: TaskItem) => Promise<void>;
  updateTask: (id: string, updates: Partial<TaskItem>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  // AI 执行
  executeAITask: (taskId: string, content: string, instruction: string) => Promise<{ success: boolean; result?: string; error?: string }>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  isLoading: false,

  loadTasks: async () => {
    set({ isLoading: true });
    try {
      const tasks = await window.electronAPI.loadTasks();
      set({ tasks: dedupeTasks(tasks), isLoading: false });
    } catch (error) {
      console.error('Failed to load tasks:', error);
      set({ isLoading: false });
    }
  },

  addTask: async (task) => {
    const prev = get().tasks;
    const newTasks = dedupeTasks([...prev.filter(t => t.id !== task.id), task]);
    set({ tasks: newTasks });
    try {
      await window.electronAPI.saveTask(task);
    } catch (error) {
      console.error('Failed to save task:', error);
      set({ tasks: prev });
    }
  },

  updateTask: async (id, updates) => {
    const prev = get().tasks;
    const tasks = dedupeTasks(prev.map((t) =>
      t.id === id ? { ...t, ...updates } : t
    ));
    set({ tasks });
    const updatedTask = tasks.find(t => t.id === id);
    if (updatedTask) {
      try {
        await window.electronAPI.saveTask(updatedTask);
      } catch (error) {
        console.error('Failed to update task:', error);
        set({ tasks: prev });
      }
    }
  },

  deleteTask: async (id) => {
    const prev = get().tasks;
    const newTasks = prev.filter((t) => t.id !== id);
    set({ tasks: newTasks });
    try {
      await window.electronAPI.deleteTask(id);
    } catch (error) {
      console.error('Failed to delete task:', error);
      set({ tasks: prev });
    }
  },

  executeAITask: async (taskId, content, instruction) => {
    const prevTask = get().tasks.find(t => t.id === taskId);
    try {
      await get().updateTask(taskId, { status: 'in_progress' });

      const result = await useAIJobStore.getState().runAIJob<{ success: boolean; result?: string; error?: string }>(
        {
          scene: 'taskExecute',
          title: `\u6267\u884c\u4efb\u52a1\uff1a${prevTask?.title || taskId}`,
          projectId: prevTask?.projectId,
          taskId,
          inputHash: `${taskId}:${content.length}:${instruction.length}`,
          resultPreview: (value) => value.success ? value.result : value.error,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(35);
          const value = await window.electronAPI.executeAITask({
            taskId,
            content,
            instruction,
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

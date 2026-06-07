import { create } from 'zustand';
import { TaskItem } from '../../shared/types';

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
      set({ tasks, isLoading: false });
    } catch (error) {
      console.error('Failed to load tasks:', error);
      set({ isLoading: false });
    }
  },

  addTask: async (task) => {
    const newTasks = [...get().tasks, task];
    set({ tasks: newTasks });
    try {
      await window.electronAPI.saveTask(task);
    } catch (error) {
      console.error('Failed to save task:', error);
    }
  },

  updateTask: async (id, updates) => {
    const tasks = get().tasks.map((t) =>
      t.id === id ? { ...t, ...updates } : t
    );
    set({ tasks });
    const updatedTask = tasks.find(t => t.id === id);
    if (updatedTask) {
      try {
        await window.electronAPI.saveTask(updatedTask);
      } catch (error) {
        console.error('Failed to update task:', error);
      }
    }
  },

  deleteTask: async (id) => {
    const newTasks = get().tasks.filter((t) => t.id !== id);
    set({ tasks: newTasks });
    try {
      await window.electronAPI.deleteTask(id);
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  },

  executeAITask: async (taskId, content, instruction) => {
    try {
      // 更新任务状态为进行中
      await get().updateTask(taskId, { status: 'in_progress' });

      const result = await window.electronAPI.executeAITask({
        taskId,
        content,
        instruction,
      });

      if (result.success) {
        // 更新任务状态为已完成
        await get().updateTask(taskId, {
          status: 'completed',
          result: result.result,
          completedAt: new Date().toISOString(),
        });
      } else {
        // 更新任务状态为待处理（失败）
        await get().updateTask(taskId, { status: 'pending' });
      }

      return result;
    } catch (error: any) {
      console.error('Failed to execute AI task:', error);
      await get().updateTask(taskId, { status: 'pending' });
      return { success: false, error: error.message };
    }
  },
}));

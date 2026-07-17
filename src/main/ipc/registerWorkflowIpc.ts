import { TaskItem } from '../types';
import { defineIpcHandler } from './registry';

export const isWorkflowIpc = (channel: string) => /^task:/.test(channel);

export const defineWorkflowIpc = (deps: {
  loadTasks: () => TaskItem[];
  saveTasks: (tasks: TaskItem[]) => void;
  executeAiTask: (params: { taskId: string; content: string; instruction: string; usageRequestId?: string }) => Promise<any>;
}) => {
  defineIpcHandler('task:save', async (_event, task: TaskItem) => {
    const tasks = deps.loadTasks();
    const index = tasks.findIndex(item => item.id === task.id);
    if (index >= 0) tasks[index] = task;
    else tasks.push(task);
    deps.saveTasks(tasks);
  });
  defineIpcHandler('task:loadAll', async () => deps.loadTasks());
  defineIpcHandler('task:delete', async (_event, taskId: string) => deps.saveTasks(deps.loadTasks().filter(item => item.id !== taskId)));
  defineIpcHandler('task:executeAI', async (_event, params) => deps.executeAiTask(params));
};

import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskItem } from '../../../shared/types';
import { useAIJobStore } from '../aiJobStore';
import { useTaskStore } from '../taskStore';

const reset = () => {
  useTaskStore.setState({ tasks: [], isLoading: false });
  useAIJobStore.getState().jobs.forEach(job => useAIJobStore.getState().clearJob(job.id));
};

test('retrying a failed AI task reruns the task store operation and persists completion', async () => {
  reset();
  let attempts = 0;
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: {
      saveTask: async () => undefined,
      executeAITask: async () => {
        attempts += 1;
        return attempts === 1
          ? { success: false, error: 'temporary provider failure' }
          : { success: true, result: 'completed by retry' };
      },
    },
  };

  const task: TaskItem = {
    id: 'task-1',
    projectId: 'project-1',
    title: 'AI 执行任务',
    description: '测试重试',
    type: 'ai',
    status: 'pending',
    priority: 'medium',
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
  useTaskStore.setState({ tasks: [task] });

  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    const first = await useTaskStore.getState().executeAITask(task.id, '上下文', '执行任务');
    assert.equal(first.success, false);
    const failedJob = useAIJobStore.getState().jobs.find(job => job.status === 'failed');
    assert.ok(failedJob?.canRetry);

    assert.equal(await useAIJobStore.getState().retryJob(failedJob.id), true);
    const retriedTask = useTaskStore.getState().tasks.find(item => item.id === task.id);
    assert.equal(retriedTask?.status, 'completed');
    assert.equal(retriedTask?.result, 'completed by retry');
    assert.equal(attempts, 2);
  } finally {
    console.error = previousConsoleError;
    reset();
  }
});

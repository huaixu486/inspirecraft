import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskItem } from '../../../shared/types';
import { useAIJobStore } from '../aiJobStore';
import { useTaskStore } from '../taskStore';
import { adaptTaskItemsToWorkItems } from '../../utils/workflowAdapter';

const reset = () => {
  useTaskStore.setState({ tasks: [], workItems: [], isLoading: false });
  useAIJobStore.getState().jobs.forEach(job => useAIJobStore.getState().clearJob(job.id));
};

const seedTasks = (tasks: TaskItem[]) => {
  useTaskStore.setState({ tasks, workItems: adaptTaskItemsToWorkItems(tasks), isLoading: false });
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
  seedTasks([task]);

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

test('work item selectors expose one canonical view across project and source', () => {
  reset();
  const base = new Date().toISOString();
  seedTasks([
    { id: 'review-1', projectId: 'project-1', title: '审查修订', description: '', type: 'ai', status: 'pending', priority: 'high', source: 'review', createdAt: base },
    { id: 'report-1', projectId: 'project-1', title: '阶段报告', description: '', type: 'manual', status: 'pending', priority: 'medium', source: 'report', createdAt: base },
    { id: 'other-1', projectId: 'project-2', title: '其他项目', description: '', type: 'manual', status: 'pending', priority: 'low', source: 'manual', createdAt: base },
  ]);

  const reviewItems = useTaskStore.getState().getWorkItems({ projectId: 'project-1', source: 'review' });
  assert.equal(reviewItems.length, 1);
  assert.equal(reviewItems[0].action, 'revise');
  reset();
});

test('dependency blocking is enforced by the store before execution', async () => {
  reset();
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: { saveTask: async () => undefined },
  };
  const createdAt = new Date().toISOString();
  seedTasks([
    { id: 'first', projectId: 'project-1', title: '前置任务', description: '', type: 'manual', status: 'pending', priority: 'medium', createdAt },
    { id: 'second', projectId: 'project-1', title: '后续任务', description: '', type: 'ai', status: 'pending', priority: 'medium', dependsOnTaskId: 'first', createdAt },
  ]);

  assert.equal(useTaskStore.getState().isTaskBlocked('second'), true);
  assert.equal(await useTaskStore.getState().transitionTaskStatus('second', 'in_progress'), false);
  assert.equal(await useTaskStore.getState().transitionTaskStatus('second', 'completed'), false);
  assert.equal(await useTaskStore.getState().transitionTaskStatus('first', 'completed'), true);
  assert.equal(useTaskStore.getState().isTaskBlocked('second'), false);
  assert.equal(await useTaskStore.getState().transitionTaskStatus('second', 'in_progress'), true);
  reset();
});

test('switching to friend execution updates the same task instead of cloning it', async () => {
  reset();
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: { saveTask: async () => undefined },
  };
  const task: TaskItem = { id: 'dispatch-1', projectId: 'project-1', title: '协同任务', description: '', type: 'manual', status: 'pending', priority: 'medium', createdAt: new Date().toISOString() };
  seedTasks([task]);

  await useTaskStore.getState().setTaskExecutor(task.id, 'friend');
  assert.equal(useTaskStore.getState().tasks.length, 1);
  assert.equal(useTaskStore.getState().tasks[0].executor, 'friend');
  assert.equal(useTaskStore.getState().getWorkItems()[0].executor, 'friend');
  reset();
});

test('resolved IPC failure rolls back an optimistic task write', async () => {
  reset();
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: { saveTask: async () => ({ success: false, error: 'disk write failed' }) },
  };
  const task: TaskItem = {
    id: 'failed-save',
    projectId: 'project-1',
    title: '不应留在内存中的任务',
    description: '',
    type: 'manual',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date().toISOString(),
  };
  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    await useTaskStore.getState().addTask(task);
    assert.equal(useTaskStore.getState().tasks.length, 0);
    assert.equal(useTaskStore.getState().workItems.length, 0);
  } finally {
    console.error = previousConsoleError;
    reset();
  }
});

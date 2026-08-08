import assert from 'node:assert/strict';
import test from 'node:test';
import { useAIJobStore } from '../aiJobStore';

const resetJobs = () => {
  const state = useAIJobStore.getState();
  [...state.jobs].forEach(job => state.clearJob(job.id));
};

test('AI job retry reruns the registered whole operation instead of creating a stalled queue entry', async () => {
  resetJobs();
  let attempts = 0;

  const execute = async (): Promise<string> => useAIJobStore.getState().runAIJob(
    {
      scene: 'general',
      title: 'retry test',
      inputHash: 'retry-test',
      retry: async () => { await execute(); },
    },
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('first attempt fails');
      return 'second attempt succeeds';
    },
  );

  await assert.rejects(execute(), /first attempt fails/);
  const failedJob = useAIJobStore.getState().jobs.find(job => job.status === 'failed');
  assert.ok(failedJob);
  assert.equal(failedJob.canRetry, true);

  const didStart = await useAIJobStore.getState().retryJob(failedJob.id);
  assert.equal(didStart, true);
  assert.equal(attempts, 2);

  const jobs = useAIJobStore.getState().jobs;
  assert.equal(jobs.filter(job => job.status === 'queued').length, 0);
  assert.equal(jobs.filter(job => job.status === 'completed').length, 1);
  assert.equal(useAIJobStore.getState().jobs.find(job => job.id === failedJob.id)?.canRetry, false);
  resetJobs();
});

test('AI job without a registered whole-operation retry does not expose a fake retry state', async () => {
  resetJobs();
  await assert.rejects(
    useAIJobStore.getState().runAIJob(
      { scene: 'general', title: 'no retry test', inputHash: 'no-retry-test' },
      async () => { throw new Error('fails without retry'); },
    ),
    /fails without retry/,
  );

  const failedJob = useAIJobStore.getState().jobs.find(job => job.status === 'failed');
  assert.ok(failedJob);
  assert.equal(failedJob.canRetry, false);
  assert.equal(await useAIJobStore.getState().retryJob(failedJob.id), false);
  resetJobs();
});

test('AI jobs retain correlation and work item identifiers', async () => {
  resetJobs();
  await useAIJobStore.getState().runAIJob(
    {
      scene: 'taskExecute',
      title: 'correlation test',
      inputHash: 'correlation-test',
      taskId: 'legacy-task-1',
      workItemId: 'work-item-1',
      correlationId: 'correlation-1',
    },
    async () => 'done',
  );

  const job = useAIJobStore.getState().jobs.find(item => item.title === 'correlation test');
  assert.equal(job?.taskId, 'legacy-task-1');
  assert.equal(job?.workItemId, 'work-item-1');
  assert.equal(job?.correlationId, 'correlation-1');
  resetJobs();
});

test('silent model calls do not create premature completed jobs', () => {
  resetJobs();
  const state = useAIJobStore.getState();
  const base = {
    id: 'section-call-1',
    createdAt: new Date().toISOString(),
    modelName: 'section model',
    model: 'section-model',
    requestId: 'long-form-job',
    silent: true,
  };

  state.syncExternalActivity({ ...base, status: 'started' });
  state.syncExternalActivity({ ...base, status: 'completed' });

  assert.equal(useAIJobStore.getState().jobs.length, 0);
  resetJobs();
});

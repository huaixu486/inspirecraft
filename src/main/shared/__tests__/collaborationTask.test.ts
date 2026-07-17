import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskItem } from '../../types';
import { buildAcceptedCollaborationTask } from '../collaborationTask';

test('accepted collaboration task is mapped to a local project and detached from remote dependencies', () => {
  const incoming: TaskItem = {
    id: 'remote-task',
    projectId: 'remote-project',
    title: 'AI 修改章节',
    description: '处理正文',
    type: 'ai',
    executor: 'friend',
    status: 'in_progress',
    priority: 'high',
    source: 'report',
    relatedDocId: 'remote-doc',
    workflowId: 'remote-workflow',
    dependsOnTaskId: 'remote-previous',
    dependsOn: ['remote-previous'],
    createdAt: '2026-07-15T00:00:00.000Z',
  };

  const accepted = buildAcceptedCollaborationTask({
    incoming,
    localProjectId: 'local-project',
    offerId: 'offer-1',
    sourceMessageId: 'message-1',
    sourceProjectName: '外部项目',
    now: '2026-07-16T00:00:00.000Z',
  });

  assert.equal(accepted.projectId, 'local-project');
  assert.equal(accepted.type, 'ai');
  assert.equal(accepted.executor, 'ai');
  assert.equal(accepted.status, 'pending');
  assert.equal(accepted.source, 'manual');
  assert.equal(accepted.sourceMessageId, 'message-1');
  assert.equal(accepted.relatedDocId, undefined);
  assert.equal(accepted.workflowId, undefined);
  assert.equal(accepted.dependsOnTaskId, undefined);
  assert.deepEqual(accepted.dependsOn, undefined);
  assert.match(accepted.description, /来自协作项目：外部项目/);
});

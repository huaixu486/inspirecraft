import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskItem } from '../../../shared/types';
import { adaptTaskItemToWorkItem, normalizeTaskItemContract } from '../workflowAdapter';

const legacyTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: 'legacy-1',
  projectId: 'project-1',
  title: '修订风险章节',
  description: '按照审查意见修订',
  type: 'ai',
  status: 'pending',
  priority: 'high',
  source: 'review',
  relatedDocId: 'doc-1',
  sectionTitle: '风险分析',
  sourceLineNumber: 18,
  createdAt: '2026-07-14T00:00:00.000Z',
  ...overrides,
});

test('legacy review tasks adapt to AI revision work items with document context', () => {
  const workItem = adaptTaskItemToWorkItem(legacyTask());
  assert.equal(workItem.executor, 'ai');
  assert.equal(workItem.action, 'revise');
  assert.equal(workItem.documentContext?.projectDocumentId, 'doc-1');
  assert.equal(workItem.documentContext?.sectionTitle, '风险分析');
  assert.equal(workItem.documentContext?.lineNumber, 18);
});

test('legacy dependencies become a dependency list', () => {
  assert.deepEqual(
    adaptTaskItemToWorkItem(legacyTask({ dependsOnTaskId: 'before-1' })).dependsOn,
    ['before-1'],
  );
});

test('new writes are enriched with canonical workflow fields without losing legacy compatibility', () => {
  const normalized = normalizeTaskItemContract(legacyTask());
  assert.equal(normalized.type, 'ai');
  assert.equal(normalized.executor, 'ai');
  assert.equal(normalized.action, 'revise');
  assert.equal(normalized.documentContext?.projectDocumentId, 'doc-1');
  assert.equal(normalized.workStatus, 'pending');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskItem } from '../../../shared/types';
import {
  buildTaskPrompt,
  isRevisionWorkflowFocus,
  resolveTaskTarget,
} from '../workflowTaskRouting';

const task = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: 'task-1',
  projectId: 'project-1',
  title: '处理任务',
  description: '',
  type: 'manual',
  status: 'pending',
  priority: 'medium',
  createdAt: '2026-07-14T00:00:00.000Z',
  ...overrides,
});

test('review findings always route to the team revision studio', () => {
  const reviewTask = task({
    source: 'review',
    relatedDocId: 'doc-1',
    sectionTitle: '风险分析',
    sourceLineNumber: 42,
  });

  assert.equal(resolveTaskTarget(reviewTask), 'team');
  assert.match(buildTaskPrompt(reviewTask), /定位段落：风险分析/);
  assert.match(buildTaskPrompt(reviewTask), /第 42 行/);
  assert.equal(isRevisionWorkflowFocus({ source: 'review', prompt: reviewTask.title }), true);
});

test('explicit revision intent is not misrouted to first-draft writing', () => {
  assert.equal(isRevisionWorkflowFocus({ source: 'task', intent: 'revision', prompt: '处理文档' }), true);
});

test('manual report tasks stay in the report workbench', () => {
  assert.equal(resolveTaskTarget(task({ source: 'report', type: 'manual' })), 'report');
});


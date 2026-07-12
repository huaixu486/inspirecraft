import assert from 'node:assert/strict';
import test from 'node:test';
import { useNavigationStore } from '../navigationStore';

const reset = () => useNavigationStore.setState({
  activePage: 'overview',
  pendingFocus: null,
  lastPage: null,
  overviewAction: null,
});

test('navigation keeps the complete workbench focus until App consumes it', () => {
  reset();
  const focus = {
    target: 'review' as const,
    projectId: 'project-1',
    docId: 'doc-1',
    taskId: 'task-1',
    stageName: '报告阶段',
    prompt: '请修复审查问题',
    source: 'overview' as const,
  };

  useNavigationStore.getState().navigate(focus);
  assert.deepEqual(useNavigationStore.getState().pendingFocus, focus);
  assert.equal(useNavigationStore.getState().lastPage, 'review');

  useNavigationStore.getState().consumePendingFocus();
  assert.equal(useNavigationStore.getState().pendingFocus, null);
});

test('overview actions are one-shot commands', () => {
  reset();
  useNavigationStore.getState().triggerOverviewAction('create-project');
  assert.equal(useNavigationStore.getState().overviewAction, 'create-project');
  useNavigationStore.getState().consumeOverviewAction();
  assert.equal(useNavigationStore.getState().overviewAction, null);
});

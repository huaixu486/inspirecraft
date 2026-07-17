import assert from 'node:assert/strict';
import test from 'node:test';
import { useNavigationStore } from '../navigationStore';

const reset = () => useNavigationStore.setState({
  activePage: 'overview',
  pendingFocus: null,
  activeFocus: null,
  lastPage: null,
  panelSession: null,
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
  assert.equal(useNavigationStore.getState().lastPage, null);

  useNavigationStore.getState().consumePendingFocus();
  assert.equal(useNavigationStore.getState().pendingFocus, null);
  assert.deepEqual(useNavigationStore.getState().activeFocus, focus);
  useNavigationStore.getState().acknowledgeActiveFocus();
  assert.equal(useNavigationStore.getState().activeFocus, null);
});

test('panel session has an explicit capture, away, restore lifecycle', () => {
  reset();
  useNavigationStore.getState().capturePanelSession({ wasOpen: true, projectId: 'project-1' });
  assert.equal(useNavigationStore.getState().panelSession?.phase, 'captured');
  useNavigationStore.getState().markPanelSessionAway();
  assert.equal(useNavigationStore.getState().panelSession?.phase, 'away');
  const restored = useNavigationStore.getState().beginPanelSessionRestore();
  assert.equal(restored?.projectId, 'project-1');
  assert.equal(useNavigationStore.getState().panelSession?.phase, 'restoring');
  useNavigationStore.getState().clearPanelSession();
  assert.equal(useNavigationStore.getState().panelSession, null);
});

test('overview actions are one-shot commands', () => {
  reset();
  useNavigationStore.getState().triggerOverviewAction('create-project');
  assert.equal(useNavigationStore.getState().overviewAction, 'create-project');
  useNavigationStore.getState().consumeOverviewAction();
  assert.equal(useNavigationStore.getState().overviewAction, null);
});

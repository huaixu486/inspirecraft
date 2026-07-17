import assert from 'node:assert/strict';
import test from 'node:test';
import { Project, ProjectDocument, StageCompletionEvent } from '../../../shared/types';
import {
  buildStageCompletionDocumentPatch,
  buildStageReopenDocumentPatch,
  createStageCompletionEvent,
  getActiveStageCompletionEvent,
  selectStageExtractionDocument,
} from '../stageCompletion';
import { normalizeNewProjectDocument } from '../../stores/projectDocStore';

const project: Project = {
  id: 'project-1', name: '项目', description: '', folderPath: 'D:/project', status: 'active', progress: 0,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
};
const doc = (id: string, modifiedAt: string): ProjectDocument => ({
  id, projectId: project.id, templateId: '', name: id, sections: [], overallProgress: 0,
  lifecycleStatus: 'identified', sourceFileModifiedAt: modifiedAt, createdAt: modifiedAt,
});
const scope = { projectId: project.id, stageName: 'proposal', sourceDocIds: ['doc-old', 'doc-new'] };

test('latest modified document is the default extraction source', () => {
  const selected = selectStageExtractionDocument(project, scope, [doc('doc-old', '2026-07-13T00:00:00.000Z'), doc('doc-new', '2026-07-14T00:00:00.000Z')]);
  assert.equal(selected?.id, 'doc-new');
});

test('new scanned documents are identified but never implicitly completed', () => {
  const normalized = normalizeNewProjectDocument({ ...doc('scan', '2026-07-14T00:00:00.000Z'), lifecycleStatus: undefined, autoStage: true });
  assert.equal(normalized.lifecycleStatus, 'identified');
  assert.equal(normalized.completedAt, undefined);
});

test('persisted user selection overrides the latest document default', () => {
  const selected = selectStageExtractionDocument({ ...project, stageSummarySourceDocIds: { proposal: 'doc-old' } }, scope, [doc('doc-old', '2026-07-13T00:00:00.000Z'), doc('doc-new', '2026-07-14T00:00:00.000Z')]);
  assert.equal(selected?.id, 'doc-old');
});

test('completion and reopen patches preserve an explicit event boundary', () => {
  const source = doc('doc-new', '2026-07-14T00:00:00.000Z');
  const event = createStageCompletionEvent(scope, source, true, '2026-07-14T01:00:00.000Z');
  const completed = { ...source, ...buildStageCompletionDocumentPatch(source, event) };
  assert.equal(completed.lifecycleStatus, 'completed');
  assert.equal(completed.completionEventId, event.id);
  const reopened = buildStageReopenDocumentPatch(completed, '2026-07-14T02:00:00.000Z');
  assert.equal(reopened.completedAt, undefined);
  assert.equal(reopened.completionEventId, undefined);
  assert.equal(reopened.lifecycleStatus, 'identified');
});

test('reopened events are not treated as the active completion', () => {
  const oldEvent: StageCompletionEvent = { id: 'old', projectId: project.id, stageName: 'proposal', sourceDocIds: scope.sourceDocIds, completedAt: '2026-07-14T01:00:00.000Z', status: 'reopened', reopenedAt: '2026-07-14T02:00:00.000Z' };
  const activeEvent: StageCompletionEvent = { ...oldEvent, id: 'new', status: 'learned', reopenedAt: undefined };
  assert.equal(getActiveStageCompletionEvent({ ...project, stageCompletionEvents: [oldEvent, activeEvent] }, 'proposal')?.id, 'new');
});

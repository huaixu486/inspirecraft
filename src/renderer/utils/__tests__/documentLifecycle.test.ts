import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectDocument } from '../../../shared/types';
import {
  canTransitionProjectDocumentLifecycle,
  transitionProjectDocumentLifecycle,
} from '../documentLifecycle';

const document = (lifecycleStatus: ProjectDocument['lifecycleStatus']): ProjectDocument => ({
  id: 'doc-1',
  projectId: 'project-1',
  templateId: '',
  name: '项目文档',
  sections: [],
  overallProgress: 0,
  lifecycleStatus,
  createdAt: '2026-07-14T00:00:00.000Z',
});

test('identified documents can enter writing and completion', () => {
  assert.equal(canTransitionProjectDocumentLifecycle('identified', 'writing'), true);
  assert.equal(canTransitionProjectDocumentLifecycle('identified', 'completed'), true);
});

test('completed documents can reopen without deleting document history', () => {
  const patch = transitionProjectDocumentLifecycle(
    document('completed'),
    'needs_revision',
    '2026-07-14T01:00:00.000Z',
  );
  assert.deepEqual(patch, {
    lifecycleStatus: 'needs_revision',
    lifecycleUpdatedAt: '2026-07-14T01:00:00.000Z',
  });
});

test('archived documents reject implicit return to active writing', () => {
  assert.throws(
    () => transitionProjectDocumentLifecycle(document('archived'), 'writing'),
    /archived -> writing/,
  );
});


import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../../../shared/types';
import { getAutoProjectDescriptionStatus, resetAutoDescriptionLock, shouldGenerateAutoProjectDescription } from '../autoProjectDescription';

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

const createProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: '测试项目',
  description: '',
  descriptionSource: 'auto',
  folderPath: 'C:\\workspace\\project-1',
  status: 'active',
  progress: 0,
  createdAt: iso(-10 * 24 * 60 * 60 * 1000),
  updatedAt: iso(-10 * 24 * 60 * 60 * 1000),
  autoDescriptionLastFileActivityAt: iso(-4 * 24 * 60 * 60 * 1000),
  autoDescriptionPendingSince: iso(-4 * 24 * 60 * 60 * 1000),
  autoDescriptionNextUpdateAt: iso(-24 * 60 * 60 * 1000),
  ...overrides,
});

test('auto description requires a quiet due project with at least two files', () => {
  assert.equal(shouldGenerateAutoProjectDescription(createProject(), 2), true);
  assert.equal(shouldGenerateAutoProjectDescription(createProject(), 1), false);
  assert.equal(shouldGenerateAutoProjectDescription(createProject({
    autoDescriptionNextUpdateAt: iso(60 * 60 * 1000),
  }), 2), false);
  assert.equal(shouldGenerateAutoProjectDescription(createProject({
    autoDescriptionLastFileActivityAt: undefined,
  }), 2), false);
  assert.equal(shouldGenerateAutoProjectDescription(createProject(), 2, false), false);
});

test('manual or already generated descriptions are never automatically overwritten', () => {
  assert.equal(shouldGenerateAutoProjectDescription(createProject({
    description: '用户手写的项目概述',
    descriptionSource: 'manual',
  }), 2), false);
  assert.equal(shouldGenerateAutoProjectDescription(createProject({
    autoDescriptionGeneratedAt: iso(-60 * 60 * 1000),
  }), 2), false);
});

test('failed attempts observe retry backoff instead of permanently locking generation', () => {
  assert.equal(shouldGenerateAutoProjectDescription(createProject({
    autoDescriptionGenerationAttempted: true,
    autoDescriptionRetryAt: iso(60 * 60 * 1000),
  }), 2), false);
  assert.equal(shouldGenerateAutoProjectDescription(createProject({
    autoDescriptionGenerationAttempted: true,
    autoDescriptionRetryAt: iso(-60 * 60 * 1000),
  }), 2), true);
});

test('description status communicates completed, pending, and retry states', () => {
  assert.equal(getAutoProjectDescriptionStatus(createProject({
    description: 'AI 生成的项目概述',
    descriptionSource: 'auto',
  })), 'completed');
  assert.equal(getAutoProjectDescriptionStatus(createProject({
    autoDescriptionLastErrorAt: iso(-60 * 60 * 1000),
    autoDescriptionRetryAt: iso(60 * 60 * 1000),
  })), 'failed');
  assert.equal(getAutoProjectDescriptionStatus(createProject()), 'pending');
});

test('clearing a description removes old AI locks and schedules a fresh quiet period', async () => {
  let patch: Partial<Project> | undefined;
  const project = createProject({
    description: '旧 AI 概述',
    autoDescriptionGeneratedAt: iso(-60 * 60 * 1000),
    autoDescriptionGenerationAttempted: true,
  });
  await resetAutoDescriptionLock(project, async (_id, updates) => { patch = updates; });
  assert.equal(patch?.description, '');
  assert.equal(patch?.autoDescriptionGeneratedAt, undefined);
  assert.equal(patch?.autoDescriptionGenerationAttempted, undefined);
  assert.equal(patch?.descriptionSource, 'auto');
  assert.ok(patch?.autoDescriptionPendingSince);
  assert.ok(patch?.autoDescriptionGenerationToken);
});

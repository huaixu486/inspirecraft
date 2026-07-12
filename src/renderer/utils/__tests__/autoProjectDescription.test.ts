import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../../../shared/types';
import { shouldGenerateAutoProjectDescription } from '../autoProjectDescription';

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

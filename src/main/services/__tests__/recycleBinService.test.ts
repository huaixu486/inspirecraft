import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRecycleBinService, type ProjectRecycleSnapshot } from '../recycleBinService';

const makeHarness = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-recycle-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const restoredSnapshots: ProjectRecycleSnapshot[] = [];
  const service = createRecycleBinService({
    getWorkspacePath: () => workspace,
    getRetentionDays: () => 30,
    getDirSize: async directoryPath => {
      const visit = (currentPath: string): number => fs.readdirSync(currentPath, { withFileTypes: true })
        .reduce((total, entry) => {
          const entryPath = path.join(currentPath, entry.name);
          return total + (entry.isDirectory() ? visit(entryPath) : fs.statSync(entryPath).size);
        }, 0);
      return visit(directoryPath);
    },
    hasProjectId: () => false,
    restoreProjectSnapshot: snapshot => restoredSnapshots.push(snapshot),
  });
  return { root, workspace, service, restoredSnapshots };
};

test('moves a workspace file to the recycle bin and restores it', async t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const filePath = path.join(harness.workspace, 'report.txt');
  fs.writeFileSync(filePath, 'report');

  const entry = await harness.service.moveToRecycleBin(filePath);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal((await harness.service.list(harness.workspace)).length, 1);

  await harness.service.restore(harness.workspace, entry.id);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'report');
  assert.deepEqual(await harness.service.list(harness.workspace), []);
});

test('rejects requests and delete sources outside the configured workspace', async t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const outsideFile = path.join(harness.root, 'outside.txt');
  fs.writeFileSync(outsideFile, 'outside');

  await assert.rejects(() => harness.service.list(harness.root), /当前工作区/);
  await assert.rejects(() => harness.service.moveToRecycleBin(outsideFile), /当前工作区/);
  assert.equal(fs.existsSync(outsideFile), true);
});

test('permanently deletes one entry and can empty the remaining entries', async t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const firstPath = path.join(harness.workspace, 'first.txt');
  const secondPath = path.join(harness.workspace, 'second.txt');
  fs.writeFileSync(firstPath, 'first');
  fs.writeFileSync(secondPath, 'second');
  const first = await harness.service.moveToRecycleBin(firstPath);
  await harness.service.moveToRecycleBin(secondPath);

  await harness.service.permanentlyDelete(harness.workspace, first.id);
  assert.equal((await harness.service.list(harness.workspace)).length, 1);
  assert.equal(await harness.service.empty(harness.workspace), 1);
  assert.deepEqual(await harness.service.list(harness.workspace), []);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileSystemService } from '../fileSystemService';

const makeHarness = (writeDocxWithContent: (filePath: string) => Promise<void> = async filePath => {
  fs.writeFileSync(filePath, 'generated');
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-files-'));
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const checkInside = (targetPath: string) => {
    const relative = path.relative(workspace, path.resolve(targetPath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      ? { ok: true as const }
      : { ok: false as const, error: 'path outside workspace' };
  };
  const recycle = {
    async moveToRecycleBin(filePath: string) {
      const recycledPath = path.join(workspace, '.trash', path.basename(filePath));
      fs.mkdirSync(path.dirname(recycledPath), { recursive: true });
      fs.renameSync(filePath, recycledPath);
      return {
        id: 'recycled', name: path.basename(filePath), originalPath: filePath, recycledPath,
        isDirectory: false, deletedAt: new Date().toISOString(), size: fs.statSync(recycledPath).size,
      };
    },
  };
  const service = createFileSystemService(recycle, {
    checkWithinWorkspace: checkInside,
    checkParentWithinWorkspace: checkInside,
    checkSafeChildName: name => name && path.basename(name) === name && !/[\\/]/.test(name)
      ? { ok: true }
      : { ok: false, error: 'unsafe name' },
  }, {
    createByType: async filePath => { fs.writeFileSync(filePath, 'created'); },
    writeDocxWithContent,
    createFolderShortcut: (shortcutPath, targetPath) => { fs.writeFileSync(shortcutPath, targetPath); },
  });
  return { root, workspace, outside, service };
};

test('imports external files only into a guarded workspace target', t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const sourcePath = path.join(harness.outside, 'source.txt');
  fs.writeFileSync(sourcePath, 'external');
  const target = path.join(harness.workspace, 'imports');

  const imported = harness.service.importFiles({ folderPath: target, filePaths: [sourcePath] });
  assert.equal(imported.length, 1);
  assert.equal(fs.readFileSync(path.join(target, 'source.txt'), 'utf8'), 'external');
  assert.deepEqual(harness.service.importFiles({ folderPath: target, filePaths: [path.join(target, 'source.txt')] }), []);
  assert.throws(() => harness.service.importFiles({ folderPath: harness.outside, filePaths: [sourcePath] }), /outside workspace/);
});

test('imports an external folder as a shortcut or moves it into the project', t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const shortcutSource = path.join(harness.outside, 'references');
  const moveSource = path.join(harness.outside, 'deliverables');
  fs.mkdirSync(shortcutSource);
  fs.mkdirSync(moveSource);
  fs.writeFileSync(path.join(moveSource, 'report.txt'), 'report');

  const shortcut = harness.service.importFolder({ sourcePath: shortcutSource, targetFolder: harness.workspace, mode: 'shortcut' });
  assert.match(shortcut.name, /快捷方式\.lnk$/);
  assert.equal(fs.readFileSync(shortcut.path, 'utf8'), shortcutSource);
  assert.equal(fs.existsSync(shortcutSource), true);

  const moved = harness.service.importFolder({ sourcePath: moveSource, targetFolder: harness.workspace, mode: 'move' });
  assert.equal(fs.existsSync(moveSource), false);
  assert.equal(fs.readFileSync(path.join(moved.path, 'report.txt'), 'utf8'), 'report');
});

test('renames, duplicates and moves files while preserving collision rules', t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const sourcePath = path.join(harness.workspace, 'draft.txt');
  fs.writeFileSync(sourcePath, 'draft');
  const renamedPath = harness.service.rename({ filePath: sourcePath, newName: 'report.txt' });
  assert.equal(path.basename(renamedPath), 'report.txt');

  const copies = harness.service.duplicate({ sourcePaths: [renamedPath], targetFolder: harness.workspace });
  assert.equal(copies[0].name, 'report - 副本.txt');
  const targetFolder = path.join(harness.workspace, 'done');
  const moved = harness.service.move({ sourcePaths: [renamedPath], targetFolder });
  assert.equal(moved.errors.length, 0);
  assert.equal(fs.readFileSync(path.join(targetFolder, 'report.txt'), 'utf8'), 'draft');
  assert.throws(() => harness.service.rename({ filePath: copies[0].path, newName: '../escape.txt' }), /unsafe name/);
});

test('reads directory entries and delegates non-permanent deletion to recycle bin', async t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const filePath = path.join(harness.workspace, 'notes.txt');
  fs.writeFileSync(filePath, 'notes');
  assert.equal(harness.service.read(filePath), 'notes');
  assert.equal((await harness.service.listDirectoryEntries(harness.workspace))[0].name, 'notes.txt');

  const entry = await harness.service.delete(filePath);
  assert.equal(entry?.id, 'recycled');
  assert.equal(fs.existsSync(filePath), false);
  assert.throws(() => harness.service.read(path.join(harness.outside, 'secret.txt')), /outside workspace/);
});

test('toggles a workspace file read-only attribute and reports it in directory entries', async t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const filePath = path.join(harness.workspace, 'protected.txt');
  fs.writeFileSync(filePath, 'protected');

  assert.deepEqual(harness.service.setReadOnly({ filePath, readOnly: true }), { readOnly: true });
  assert.equal((await harness.service.listDirectoryEntries(harness.workspace))[0].readOnly, true);
  assert.deepEqual(harness.service.setReadOnly({ filePath, readOnly: false }), { readOnly: false });
  assert.equal((await harness.service.listDirectoryEntries(harness.workspace))[0].readOnly, false);
  assert.throws(() => harness.service.setReadOnly({ filePath: path.join(harness.outside, 'escape.txt'), readOnly: true }), /outside workspace/);
});

test('creates guarded folders, blank files and template-based output', async t => {
  const harness = makeHarness();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const folderPath = harness.service.createFolder({ folderPath: harness.workspace, folderName: 'drafts' });
  const blankPath = await harness.service.createBlank({ folderPath, fileName: 'blank', fileType: '.docx' });
  assert.equal(fs.readFileSync(blankPath, 'utf8'), 'created');

  const generatedPath = await harness.service.generateFromContent({
    folderPath,
    fileName: 'report',
    template: { id: 'template', name: 'Template', nodes: [], outputFileType: 'docx' } as any,
    sectionContents: {},
  });
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), 'generated');
  const firstProject = harness.service.createProjectFolder({ workspacePath: harness.workspace, projectName: 'Project' });
  const secondProject = harness.service.createProjectFolder({ workspacePath: harness.workspace, projectName: 'Project' });
  assert.equal(path.basename(firstProject), 'Project');
  assert.equal(path.basename(secondProject), 'Project-1');
  await assert.rejects(() => harness.service.createBlank({ folderPath: harness.outside, fileName: 'escape', fileType: 'txt' }), /outside workspace/);
});

test('exports to an available sibling when the requested document is locked', async t => {
  const attemptedPaths: string[] = [];
  const harness = makeHarness(async filePath => {
    attemptedPaths.push(filePath);
    if (path.basename(filePath) === 'report.docx') {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    }
    fs.writeFileSync(filePath, 'generated fallback');
  });
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));

  const generatedPath = await harness.service.generateFromContent({
    folderPath: harness.workspace,
    fileName: 'report',
    template: { id: 'template', name: 'Template', nodes: [], outputFileType: 'docx' } as any,
    sectionContents: {},
  });

  assert.deepEqual(attemptedPaths.map(item => path.basename(item)), ['report.docx', 'report (1).docx']);
  assert.equal(path.basename(generatedPath), 'report (1).docx');
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), 'generated fallback');
});

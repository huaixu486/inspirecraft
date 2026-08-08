import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { IPC_DOMAIN_MATCHERS } from '../registerAllIpc';

const mainRoot = path.resolve(process.cwd(), 'src/main');
const collectTs = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory()) return collectTs(fullPath);
  return entry.isFile() && entry.name.endsWith('.ts') && !fullPath.includes(`${path.sep}__tests__${path.sep}`) ? [fullPath] : [];
});
const sources = collectTs(mainRoot).map(filePath => ({ filePath, content: fs.readFileSync(filePath, 'utf8') }));
const definitions = sources.flatMap(source => [...source.content.matchAll(/defineIpc(?:Handler|Event)\('([^']+)'/g)].map(match => ({ channel: match[1], filePath: source.filePath })));

test('all IPC channels are unique, classified, and centrally registered', () => {
  assert.equal(definitions.length, 129);
  assert.equal(new Set(definitions.map(item => item.channel)).size, definitions.length);
  for (const definition of definitions) {
    const matches = IPC_DOMAIN_MATCHERS.filter(matcher => matcher(definition.channel));
    assert.equal(matches.length, 1, `${definition.channel} should belong to exactly one IPC domain`);
  }
  const directRegistrations = sources.filter(source => !source.filePath.endsWith(path.join('ipc', 'registerAllIpc.ts')))
    .flatMap(source => [...source.content.matchAll(/ipcMain\.(?:handle|on)\(/g)].map(() => source.filePath));
  assert.deepEqual(directRegistrations, []);
});

test('destructive filesystem handlers guard paths at the handler boundary', () => {
  const indexSource = fs.readFileSync(path.join(mainRoot, 'index.ts'), 'utf8');
  const workspaceRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerRecycleBinIpc.ts'), 'utf8');
  for (const channel of ['workspace:moveFolder', 'workspace:deleteFolder']) {
    assert.match(workspaceRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?deps\\.`), `${channel} must delegate through the workspace boundary`);
  }
  for (const callback of ['moveWorkspaceFolderEntry', 'deleteWorkspaceFolder']) {
    assert.match(indexSource, new RegExp(`const ${callback}[\\s\\S]*?checkWithinWorkspace`), `${callback} must guard paths before mutation`);
  }

  const recycleRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerRecycleBinIpc.ts'), 'utf8');
  const recycleService = fs.readFileSync(path.join(mainRoot, 'services', 'recycleBinService.ts'), 'utf8');
  for (const channel of [
    'workspace:restoreRecycleBinItem', 'workspace:permanentlyDeleteRecycleBinItem',
    'workspace:emptyRecycleBin', 'workspace:cleanupRecycleBin',
  ]) {
    assert.match(recycleRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?service\\.`), `${channel} must delegate through the recycle-bin boundary`);
  }
  assert.match(recycleService, /const getWorkspaceRoot[\s\S]*回收站只能操作当前工作区/, 'recycle service must pin requests to the configured workspace');

  const fileRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerFileIpc.ts'), 'utf8');
  const fileService = fs.readFileSync(path.join(mainRoot, 'services', 'fileSystemService.ts'), 'utf8');
  for (const channel of ['file:rename', 'file:importFolder', 'file:move', 'file:duplicate', 'file:delete', 'file:setReadOnly', 'file:createFolder', 'file:createBlank']) {
    assert.match(fileRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?service\\.`), `${channel} must delegate through the file service boundary`);
  }
  assert.match(fileService, /rename\([\s\S]*checkWithinWorkspace[\s\S]*checkSafeChildName/);
  assert.match(fileService, /async delete\([\s\S]*checkWithinWorkspace[\s\S]*moveToRecycleBin/);
  assert.match(fileService, /setReadOnly\([\s\S]*checkWithinWorkspace[\s\S]*chmodSync/);
  assert.match(fileService, /createFolder\([\s\S]*checkParentWithinWorkspace[\s\S]*checkSafeChildName/);
  assert.match(fileService, /async createBlank\([\s\S]*checkParentWithinWorkspace[\s\S]*checkSafeChildName/);
  for (const channel of ['file:compressToZip', 'file:extractZip', 'zip:extractFiles']) {
    assert.match(fileRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?deps\\.`), `${channel} must delegate through the archive boundary`);
  }
  assert.match(indexSource, /const compressFileToZip[\s\S]*checkWithinWorkspace[\s\S]*createZipArchiveFromPath/);
  assert.match(indexSource, /const extractZipToNewFolder[\s\S]*checkWithinWorkspace[\s\S]*extractZipArchiveToNewFolder/);
});

test('path-bearing IPC separates workspace writes from external read inputs', () => {
  const indexSource = fs.readFileSync(path.join(mainRoot, 'index.ts'), 'utf8');
  const fileService = fs.readFileSync(path.join(mainRoot, 'services', 'fileSystemService.ts'), 'utf8');
  assert.match(fileService, /importFiles\([\s\S]*checkParentWithinWorkspace[\s\S]*mkdirSync/, 'file imports must guard the target before creating it');
  assert.match(fileService, /createProjectFolder\([\s\S]*checkParentWithinWorkspace[\s\S]*checkSafeChildName/);
  assert.match(indexSource, /const importProjectFromZip[\s\S]*checkWithinWorkspace[\s\S]*checkExistingPath[\s\S]*checkPathInside/);
  assert.match(indexSource, /const extractSelectedZipFiles[\s\S]*checkWithinWorkspace[\s\S]*checkExistingPath[\s\S]*checkPathInside/);
  assert.match(indexSource, /const exportProjectZip[\s\S]*checkWithinWorkspace[\s\S]*checkExistingPath/);

  const fileRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerFileIpc.ts'), 'utf8');
  for (const channel of ['folder:startWatch', 'folder:listFiles', 'folder:getContents', 'folder:searchFiles', 'folder:scanStageFiles', 'folder:getTreeStats']) {
    assert.match(fileRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?deps\\.`), `${channel} must delegate through the folder-query boundary`);
  }
  for (const callback of ['startFolderWatch', 'listSupportedFolderFiles', 'getFolderContents', 'searchFolderFiles', 'scanFolderStageFiles', 'getFolderTreeStats', 'scanWorkspaceProjectFiles']) {
    assert.match(indexSource, new RegExp(`const ${callback}[\\s\\S]*?checkWithinWorkspace`), `${callback} must guard the workspace path`);
  }

  const platformRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerPlatformIpc.ts'), 'utf8');
  assert.match(platformRegistrar, /defineIpcHandler\('file:openInExplorer'[\s\S]*?deps\.openInExplorer/, 'file:openInExplorer must delegate through the platform boundary');
  assert.match(platformRegistrar, /defineIpcHandler\('file:openWithDefaultApp'[\s\S]*?deps\.openWithDefaultApp/, 'file:openWithDefaultApp must delegate through the platform boundary');
  assert.match(indexSource, /const openPathInExplorer[\s\S]*?checkExistingPath/, 'openPathInExplorer must validate the selected external input');
  assert.match(indexSource, /const openFileWithDefaultApp[\s\S]*?checkExistingPath/, 'openFileWithDefaultApp must validate the selected external input');
  const documentRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerDocumentIpc.ts'), 'utf8');
  for (const channel of ['file:replaceDocumentText', 'file:parseWord', 'file:applyDocumentParagraphFormats', 'file:extractTemplateFormatRules', 'file:parseDocument', 'file:parseDocumentSilent', 'file:parsePdf']) {
    assert.match(documentRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?deps\\.`), `${channel} must delegate through the document boundary`);
  }
  for (const callback of ['parseWordDocument', 'readTemplateFormatRules', 'parseDocument', 'parseDocumentSilent', 'parsePdfDocument']) {
    assert.match(indexSource, new RegExp(`(?:const|function) ${callback}[\\s\\S]*?checkExistingPath`), `${callback} must validate external input`);
  }
  assert.match(indexSource, /async function replaceDocumentText[\s\S]*checkWithinWorkspace/);
  assert.match(indexSource, /async function applyDocumentParagraphFormats[\s\S]*checkWithinWorkspace/);
  assert.match(indexSource, /const listZipFiles[\s\S]*checkExistingPath/);

  const storeTemplateStart = indexSource.indexOf('const storeTemplateFile');
  assert.notEqual(storeTemplateStart, -1);
  assert.match(indexSource.slice(storeTemplateStart, storeTemplateStart + 900), /checkSafeChildName[\s\S]*checkExistingPath/, 'template file storage must validate id and source before copying');

  const collaborationRegistrar = fs.readFileSync(path.join(mainRoot, 'ipc', 'registerCollaborationIpc.ts'), 'utf8');
  for (const channel of ['collaboration:sendTask', 'collaboration:sendChatMessage', 'collaboration:sendFile', 'communication:saveMessageCenterState']) {
    assert.match(collaborationRegistrar, new RegExp(`defineIpcHandler\\('${channel}'[\\s\\S]*?deps\\.`), `${channel} must delegate through the collaboration boundary`);
  }
  assert.match(indexSource, /async function sendFileToPeer[\s\S]*checkExistingPath[\s\S]*fs\.statSync[\s\S]*fs\.createReadStream/, 'collaboration file transfer must validate the selected external input before reading it');
});

test('domain registrars own every IPC definition', () => {
  const owners = new Map(definitions.map(item => [item.channel, item.filePath]));
  for (const channel of ['version:save', 'template:save', 'template:storeFile', 'project:createFolder', 'project:importFromZip', 'project:exportZip', 'file:rename', 'file:delete', 'file:createBlank', 'file:createFromTemplate', 'file:compressToZip', 'file:parseDocument', 'file:applyDocumentParagraphFormats', 'folder:getContents', 'folder:getTreeStats', 'zip:listFiles', 'workspace:scanProjectFiles', 'workspace:listRecycleBin', 'workspace:restoreRecycleBinItem', 'prompt:save', 'prompt:reset', 'skill:importExternal', 'skill:setWeight', 'ai:loadConfig', 'ai:call', 'ai:usageStatistics', 'ai:reviewSuggestion', 'collaboration:startReceiver', 'collaboration:sendTask', 'collaboration:sendFile', 'communication:saveMessageCenterState', 'settings:save', 'task:executeAI']) {
    assert.match(owners.get(channel) || '', /src[\\/]main[\\/]ipc[\\/]register/);
  }
  for (const definition of definitions) {
    assert.match(definition.filePath, /src[\\/]main[\\/]ipc[\\/]register/, `${definition.channel} must be owned by a domain registrar`);
  }
});

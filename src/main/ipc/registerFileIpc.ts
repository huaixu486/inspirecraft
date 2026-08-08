import type { FileSystemService } from '../services/fileSystemService';
import type { WritingTemplate } from '../types';
import { defineIpcHandler } from './registry';

export const isFileIpc = (channel: string) => /^(file|dialog|folder|zip|shell):/.test(channel);

export const defineCoreFileIpc = (service: FileSystemService) => {
  defineIpcHandler('file:rename', async (_event, params: { filePath: string; newName: string }) => {
    try { return { success: true, filePath: service.rename(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:importFiles', async (_event, params: { folderPath: string; filePaths: string[] }) => {
    try { return { success: true, files: service.importFiles(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:importFolder', async (_event, params: { sourcePath: string; targetFolder: string; mode: 'shortcut' | 'move' }) => {
    try { return { success: true, item: service.importFolder(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:move', async (_event, params: { sourcePaths: string[]; targetFolder: string }) => {
    try {
      const result = service.move(params);
      return { success: result.errors.length === 0, ...result, error: result.errors.join('；') || undefined };
    } catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:duplicate', async (_event, params: { sourcePaths: string[]; targetFolder: string }) => {
    try { return { success: true, copies: service.duplicate(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:delete', async (_event, filePath: string, options?: { permanent?: boolean }) => {
    try { return { success: true, recycleEntry: await service.delete(filePath, options) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:setReadOnly', async (_event, params: { filePath: string; readOnly: boolean }) => {
    try { return { success: true, ...service.setReadOnly(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:read', async (_event, filePath: string) => service.read(filePath));
  defineIpcHandler('file:readDir', async (_event, dirPath: string) => service.readDir(dirPath));
  defineIpcHandler('file:listDirectoryEntries', async (_event, dirPath: string) => {
    try { return { success: true, entries: await service.listDirectoryEntries(dirPath) }; }
    catch (error: any) { return { success: false, entries: [], error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:createFolder', async (_event, params: { folderPath: string; folderName: string }) => {
    try { return { success: true, folderPath: service.createFolder(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:createBlank', async (_event, params: { folderPath: string; fileName: string; fileType: string }) => {
    try { return { success: true, filePath: await service.createBlank(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:generateFromContent', async (_event, params: { template: WritingTemplate; sectionContents: Record<string, string>; folderPath: string; fileName: string }) => {
    try { return { success: true, filePath: await service.generateFromContent(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
  defineIpcHandler('file:createFromTemplate', async (_event, params: { folderPath: string; fileName: string; template: WritingTemplate; fileType?: string }) => {
    try { return { success: true, filePath: await service.createFromTemplate(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
};

export const defineArchiveFileIpc = (deps: {
  compressToZip: (sourcePath: string) => Promise<unknown>;
  extractZip: (zipPath: string) => Promise<unknown>;
  listZipFiles: (zipPath: string) => Promise<unknown>;
  extractZipFiles: (params: { zipPath: string; targetPath: string; filePaths: string[] }) => Promise<unknown>;
}) => {
  defineIpcHandler('file:compressToZip', async (_event, sourcePath: string) => deps.compressToZip(sourcePath));
  defineIpcHandler('file:extractZip', async (_event, zipPath: string) => deps.extractZip(zipPath));
  defineIpcHandler('zip:listFiles', async (_event, zipPath: string) => deps.listZipFiles(zipPath));
  defineIpcHandler('zip:extractFiles', async (_event, params: { zipPath: string; targetPath: string; filePaths: string[] }) => deps.extractZipFiles(params));
};

export const defineFolderQueryIpc = (deps: {
  startWatch: (params: { projectId: string; folderPath: string }) => Promise<unknown>;
  stopWatch: (projectId: string) => Promise<unknown>;
  listFiles: (folderPath: string) => Promise<unknown>;
  getContents: (folderPath: string) => Promise<unknown>;
  searchFiles: (params: { folderPath: string; query: string }) => Promise<unknown>;
  scanStageFiles: (folderPath: string) => Promise<unknown>;
  getTreeStats: (folderPath: string) => Promise<unknown>;
}) => {
  defineIpcHandler('folder:startWatch', async (_event, params: { projectId: string; folderPath: string }) => deps.startWatch(params));
  defineIpcHandler('folder:stopWatch', async (_event, projectId: string) => deps.stopWatch(projectId));
  defineIpcHandler('folder:listFiles', async (_event, folderPath: string) => deps.listFiles(folderPath));
  defineIpcHandler('folder:getContents', async (_event, folderPath: string) => deps.getContents(folderPath));
  defineIpcHandler('folder:searchFiles', async (_event, params: { folderPath: string; query: string }) => deps.searchFiles(params));
  defineIpcHandler('folder:scanStageFiles', async (_event, folderPath: string) => deps.scanStageFiles(folderPath));
  defineIpcHandler('folder:getTreeStats', async (_event, folderPath: string) => deps.getTreeStats(folderPath));
};

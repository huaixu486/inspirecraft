import type { RecycleBinService } from '../services/recycleBinService';
import { defineIpcHandler } from './registry';

export const isRecycleBinIpc = (channel: string) => /^workspace:/.test(channel);

export const defineRecycleBinIpc = (service: RecycleBinService) => {
  defineIpcHandler('workspace:listRecycleBin', async (_event, params: { workspacePath: string }) => {
    try {
      return { success: true, entries: await service.list(params?.workspacePath) };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  defineIpcHandler('workspace:restoreRecycleBinItem', async (_event, params: { workspacePath: string; id: string }) => {
    try {
      await service.restore(params?.workspacePath, params?.id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  defineIpcHandler('workspace:permanentlyDeleteRecycleBinItem', async (_event, params: { workspacePath: string; id: string }) => {
    try {
      await service.permanentlyDelete(params?.workspacePath, params?.id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  defineIpcHandler('workspace:emptyRecycleBin', async (_event, params: { workspacePath: string }) => {
    try {
      return { success: true, removed: await service.empty(params?.workspacePath) };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
  defineIpcHandler('workspace:cleanupRecycleBin', async (_event, params: { workspacePath: string }) => {
    try {
      return { success: true, removed: await service.cleanup(params?.workspacePath) };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });
};

export const defineWorkspaceScanIpc = (scanProjectFiles: (folderPath: string) => Promise<unknown>) => {
  defineIpcHandler('workspace:scanProjectFiles', async (_event, folderPath: string) => scanProjectFiles(folderPath));
};

export const defineWorkspaceManagementIpc = (deps: {
  getSize: (workspacePath: string) => Promise<unknown>;
  listMigrationProjects: (params: { sourceWorkspacePath: string }) => Promise<unknown>;
  migrateProjects: (params: { sourceWorkspacePath: string; targetWorkspacePath: string; projectIds: string[] }) => Promise<unknown>;
  listFolders: (dirPath: string) => Promise<unknown>;
  moveFolder: (params: { src: string; dest: string }) => Promise<unknown>;
  deleteFolder: (folderPath: string, options?: { permanent?: boolean }) => Promise<unknown>;
}) => {
  defineIpcHandler('workspace:getSize', async (_event, workspacePath: string) => deps.getSize(workspacePath));
  defineIpcHandler('workspace:listMigrationProjects', async (_event, params: { sourceWorkspacePath: string }) => deps.listMigrationProjects(params));
  defineIpcHandler('workspace:migrateProjects', async (_event, params: { sourceWorkspacePath: string; targetWorkspacePath: string; projectIds: string[] }) => deps.migrateProjects(params));
  defineIpcHandler('workspace:listFolders', async (_event, dirPath: string) => deps.listFolders(dirPath));
  defineIpcHandler('workspace:moveFolder', async (_event, params: { src: string; dest: string }) => deps.moveFolder(params));
  defineIpcHandler('workspace:deleteFolder', async (_event, folderPath: string, options?: { permanent?: boolean }) => deps.deleteFolder(folderPath, options));
};

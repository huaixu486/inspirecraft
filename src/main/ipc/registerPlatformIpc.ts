import { defineIpcEvent, defineIpcHandler } from './registry';

export const definePlatformIpc = (deps: {
  openFolder: (options?: { title?: string; buttonLabel?: string }) => Promise<unknown>;
  openInExplorer: (targetPath: string) => Promise<unknown>;
  openWithDefaultApp: (filePath: string) => Promise<unknown>;
  startDrag: (event: any, filePath: string) => void;
  listFonts: () => Promise<unknown>;
  notify: (params: any) => Promise<unknown>;
  notificationStatus: () => Promise<unknown>;
  openFile: (filters?: any[]) => Promise<unknown>;
  openFiles: (filters?: any[]) => Promise<unknown>;
  openZip: () => Promise<unknown>;
  saveZip: (projectName: string) => Promise<unknown>;
}) => {
  defineIpcHandler('dialog:openFolder', async (_event, options?: { title?: string; buttonLabel?: string }) => deps.openFolder(options));
  defineIpcHandler('file:openInExplorer', async (_event, targetPath: string) => deps.openInExplorer(targetPath));
  defineIpcHandler('file:openWithDefaultApp', async (_event, filePath: string) => deps.openWithDefaultApp(filePath));
  defineIpcEvent('shell:startDrag', (event, filePath: string) => deps.startDrag(event, filePath));
  defineIpcHandler('system:listFonts', async () => deps.listFonts());
  defineIpcHandler('system:notify', async (_event, params: any) => deps.notify(params));
  defineIpcHandler('system:notificationStatus', async () => deps.notificationStatus());
  defineIpcHandler('dialog:openFile', async (_event, filters?: any[]) => deps.openFile(filters));
  defineIpcHandler('dialog:openFiles', async (_event, filters?: any[]) => deps.openFiles(filters));
  defineIpcHandler('dialog:openZip', async () => deps.openZip());
  defineIpcHandler('dialog:saveZip', async (_event, projectName: string) => deps.saveZip(projectName));
};

import { DocumentVersion, WritingTemplate } from '../types';
import { defineIpcHandler } from './registry';
import type { FileSystemService } from '../services/fileSystemService';

export const isProjectIpc = (channel: string) => /^(project|version|template):/.test(channel) && !/^projectDoc:/.test(channel);

export const defineVersionIpc = (deps: {
  loadVersions: () => DocumentVersion[];
  saveVersions: (versions: DocumentVersion[]) => void;
}) => {
  defineIpcHandler('version:save', async (_event, version: DocumentVersion) => {
    const versions = deps.loadVersions();
    const index = versions.findIndex(item => item.id === version.id);
    if (index >= 0) versions[index] = version;
    else versions.push(version);
    deps.saveVersions(versions);
  });
  defineIpcHandler('version:loadAll', async () => deps.loadVersions());
  defineIpcHandler('version:delete', async (_event, versionId: string) => deps.saveVersions(deps.loadVersions().filter(item => item.id !== versionId)));
};

export interface TemplateAnalysisParams {
  exampleContents: string[];
  templateNodes: Array<{ id: string; title: string; level: number }>;
  templateName: string;
  existingAnalysis?: string;
}

export const defineTemplateIpc = (deps: {
  load: () => WritingTemplate[];
  save: (templates: WritingTemplate[]) => void;
  storeFile: (params: { templateId: string; sourcePath: string }) => Promise<unknown>;
  analyzeExamples: (params: TemplateAnalysisParams) => Promise<unknown>;
}) => {
  defineIpcHandler('template:save', async (_event, template: WritingTemplate) => {
    const templates = deps.load();
    const index = templates.findIndex(item => item.id === template.id);
    if (index >= 0) templates[index] = template;
    else templates.push(template);
    deps.save(templates);
  });
  defineIpcHandler('template:storeFile', async (_event, params: { templateId: string; sourcePath: string }) => deps.storeFile(params));
  defineIpcHandler('template:loadAll', async () => deps.load());
  defineIpcHandler('template:delete', async (_event, templateId: string) => deps.save(deps.load().filter(item => item.id !== templateId)));
  defineIpcHandler('template:analyzeExamples', async (_event, params: TemplateAnalysisParams) => deps.analyzeExamples(params));
};

export const defineProjectArchiveIpc = (deps: {
  importFromZip: (params: { zipPath: string; workspacePath: string }) => Promise<unknown>;
  exportZip: (params: { project: any; savePath: string; projectDocs: any[] }) => Promise<unknown>;
}) => {
  defineIpcHandler('project:importFromZip', async (_event, params: { zipPath: string; workspacePath: string }) => deps.importFromZip(params));
  defineIpcHandler('project:exportZip', async (_event, params: { project: any; savePath: string; projectDocs: any[] }) => deps.exportZip(params));
};

export const defineProjectFolderIpc = (service: Pick<FileSystemService, 'createProjectFolder'>) => {
  defineIpcHandler('project:createFolder', async (_event, params: { projectName: string; workspacePath: string }) => {
    try { return { success: true, folderPath: service.createProjectFolder(params) }; }
    catch (error: any) { return { success: false, error: error?.message || String(error) }; }
  });
};

export const defineProjectPersistenceIpc = (deps: {
  save: (project: any) => Promise<unknown>;
  loadAll: () => Promise<unknown>;
  refreshFolderModifiedAt: (projectIds: string[]) => Promise<unknown>;
  delete: (projectId: string, options?: { mode?: 'unregister' | 'delete-folder' }) => Promise<unknown>;
}) => {
  defineIpcHandler('project:save', async (_event, project: any) => deps.save(project));
  defineIpcHandler('project:loadAll', async () => deps.loadAll());
  defineIpcHandler('project:refreshFolderModifiedAt', async (_event, projectIds: string[]) => deps.refreshFolderModifiedAt(projectIds));
  defineIpcHandler('project:delete', async (_event, projectId: string, options?: { mode?: 'unregister' | 'delete-folder' }) => deps.delete(projectId, options));
};

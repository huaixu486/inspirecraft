import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFile: (filters?: any[]) => ipcRenderer.invoke('dialog:openFile', filters),
  openInExplorer: (folderPath: string) => ipcRenderer.invoke('file:openInExplorer', folderPath),
  openFileWithApp: (filePath: string) => ipcRenderer.invoke('file:openWithDefaultApp', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('file:readDir', dirPath),
  parseWordDocument: (filePath: string) => ipcRenderer.invoke('file:parseWord', filePath),
  parsePdfDocument: (filePath: string) => ipcRenderer.invoke('file:parsePdf', filePath),

  // 项目操作
  saveProject: (project: any) => ipcRenderer.invoke('project:save', project),
  loadProjects: () => ipcRenderer.invoke('project:loadAll'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),

  // 版本操作
  saveVersion: (version: any) => ipcRenderer.invoke('version:save', version),
  loadVersions: () => ipcRenderer.invoke('version:loadAll'),
  deleteVersion: (versionId: string) => ipcRenderer.invoke('version:delete', versionId),

  // 模板操作
  saveTemplate: (template: any) => ipcRenderer.invoke('template:save', template),
  loadTemplates: () => ipcRenderer.invoke('template:loadAll'),
  deleteTemplate: (templateId: string) => ipcRenderer.invoke('template:delete', templateId),
  storeTemplateFile: (params: { templateId: string; sourcePath: string }) =>
    ipcRenderer.invoke('template:storeFile', params),

  // 审查操作
  executeReview: (params: any) => ipcRenderer.invoke('review:execute', params),
  loadReviews: () => ipcRenderer.invoke('review:loadAll'),
  deleteReview: (reviewId: string) => ipcRenderer.invoke('review:delete', reviewId),

  // AI操作
  loadAIConfig: () => ipcRenderer.invoke('ai:loadConfig'),
  saveAIConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
  callAI: (prompt: string) => ipcRenderer.invoke('ai:call', prompt),
  generateSummary: (content: string) => ipcRenderer.invoke('ai:generateSummary', content),
  reviewSuggestion: (params: any) => ipcRenderer.invoke('ai:reviewSuggestion', params),

  // 文件夹监听
  startFolderWatch: (params: any) => ipcRenderer.invoke('folder:startWatch', params),
  stopFolderWatch: (projectId: string) => ipcRenderer.invoke('folder:stopWatch', projectId),
  listFolderFiles: (folderPath: string) => ipcRenderer.invoke('folder:listFiles', folderPath),
  onFileDetected: (callback: (data: any) => void) => {
    ipcRenderer.on('folder:fileDetected', (_event, data) => callback(data));
  },

  // 任务操作
  saveTask: (task: any) => ipcRenderer.invoke('task:save', task),
  loadTasks: () => ipcRenderer.invoke('task:loadAll'),
  deleteTask: (taskId: string) => ipcRenderer.invoke('task:delete', taskId),
  executeAITask: (params: any) => ipcRenderer.invoke('task:executeAI', params),

  // 设置操作
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (config: any) => ipcRenderer.invoke('settings:save', config),
  createProjectFolder: (params: { projectName: string; workspacePath: string }) =>
    ipcRenderer.invoke('project:createFolder', params),
  getWorkspaceSize: (workspacePath: string) => ipcRenderer.invoke('workspace:getSize', workspacePath),
  listWorkspaceFolders: (dirPath: string) => ipcRenderer.invoke('workspace:listFolders', dirPath),
  moveFolder: (params: { src: string; dest: string }) => ipcRenderer.invoke('workspace:moveFolder', params),
  deleteFolder: (folderPath: string) => ipcRenderer.invoke('workspace:deleteFolder', folderPath),

  // 项目文档操作
  saveProjectDoc: (doc: any) => ipcRenderer.invoke('projectDoc:save', doc),
  loadProjectDocs: () => ipcRenderer.invoke('projectDoc:loadAll'),
  deleteProjectDoc: (docId: string) => ipcRenderer.invoke('projectDoc:delete', docId),
  analyzeProjectDoc: (params: { content: string; template: any; useAI?: boolean }) =>
    ipcRenderer.invoke('projectDoc:analyze', params),

  // 文件创建
  createBlankFile: (params: { folderPath: string; fileName: string; fileType: string }) =>
    ipcRenderer.invoke('file:createBlank', params),
  getFolderContents: (folderPath: string) => ipcRenderer.invoke('folder:getContents', folderPath),
  scanStageFiles: (folderPath: string) => ipcRenderer.invoke('folder:scanStageFiles', folderPath),
  createFromTemplate: (params: { folderPath: string; fileName: string; template: any }) =>
    ipcRenderer.invoke('file:createFromTemplate', params),

  // ZIP 导入导出
  openZipFile: () => ipcRenderer.invoke('dialog:openZip'),
  importFromZip: (params: { zipPath: string; workspacePath: string }) =>
    ipcRenderer.invoke('project:importFromZip', params),
  saveZipFile: () => ipcRenderer.invoke('dialog:saveZip'),
  exportZip: (params: { project: any; savePath: string; projectDocs: any[] }) =>
    ipcRenderer.invoke('project:exportZip', params),
});


import { contextBridge, ipcRenderer, webUtils } from 'electron';

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFile: (filters?: any[]) => ipcRenderer.invoke('dialog:openFile', filters),
  openFiles: (filters?: any[]) => ipcRenderer.invoke('dialog:openFiles', filters),
  openInExplorer: (folderPath: string) => ipcRenderer.invoke('file:openInExplorer', folderPath),
  openFileWithApp: (filePath: string) => ipcRenderer.invoke('file:openWithDefaultApp', filePath),
  startDrag: (filePath: string) => ipcRenderer.sendSync('shell:startDrag', filePath),
  getPathForFile: (file: any) => webUtils.getPathForFile(file),
  renameFile: (params: { filePath: string; newName: string }) => ipcRenderer.invoke('file:rename', params),
  importFiles: (params: { folderPath: string; filePaths: string[] }) => ipcRenderer.invoke('file:importFiles', params),
  duplicateFiles: (params: { sourcePaths: string[]; targetFolder: string }) => ipcRenderer.invoke('file:duplicate', params),
  moveFiles: (params: { sourcePaths: string[]; targetFolder: string }) => ipcRenderer.invoke('file:move', params),
  deleteFile: (filePath: string, options?: { permanent?: boolean }) => ipcRenderer.invoke('file:delete', filePath, options),
  createFolder: (params: { folderPath: string; folderName: string }) => ipcRenderer.invoke('file:createFolder', params),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('file:readDir', dirPath),
  listSystemFonts: () => ipcRenderer.invoke('system:listFonts'),
  showSystemNotification: (params: { title: string; body?: string; silent?: boolean; target?: string; projectId?: string }) => ipcRenderer.invoke('system:notify', params),
  getSystemNotificationStatus: () => ipcRenderer.invoke('system:notificationStatus'),
  onSystemNotificationClick: (callback: (payload: { target?: string; projectId?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { target?: string; projectId?: string }) => callback(payload);
    ipcRenderer.on('system:notification-click', listener);
    return () => ipcRenderer.removeListener('system:notification-click', listener);
  },
  onAIActivity: (callback: (activity: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, activity: any) => callback(activity);
    ipcRenderer.on('ai:activity', listener);
    return () => ipcRenderer.removeListener('ai:activity', listener);
  },
  parseWordDocument: (filePath: string) => ipcRenderer.invoke('file:parseWord', filePath),
  parseDocument: (filePath: string) => ipcRenderer.invoke('file:parseDocument', filePath),
  replaceDocumentText: (params: { filePath: string; originalText: string; replacementText: string }) => ipcRenderer.invoke('file:replaceDocumentText', params),
  parseDocumentSilent: (filePath: string) => ipcRenderer.invoke('file:parseDocumentSilent', filePath),
  extractTemplateFormatRules: (filePath: string) => ipcRenderer.invoke('file:extractTemplateFormatRules', filePath),
  applyDocumentParagraphFormats: (params: { sourcePath: string; targetPath: string; paragraphIndices: number[] }) => ipcRenderer.invoke('file:applyDocumentParagraphFormats', params),
  parsePdfDocument: (filePath: string) => ipcRenderer.invoke('file:parsePdf', filePath),

  // 项目操作
  saveProject: (project: any) => ipcRenderer.invoke('project:save', project),
  loadProjects: () => ipcRenderer.invoke('project:loadAll'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),
  refreshProjectFolderModifiedAt: (projectIds: string[]) => ipcRenderer.invoke('project:refreshFolderModifiedAt', projectIds),

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
  analyzeExamples: (params: { exampleContents: string[]; templateNodes: Array<{ id: string; title: string; level: number }>; templateName: string; existingAnalysis?: string }) =>
    ipcRenderer.invoke('template:analyzeExamples', params),

  // 审查操作
  executeReview: (params: any) => ipcRenderer.invoke('review:execute', params),
  loadReviews: () => ipcRenderer.invoke('review:loadAll'),
  deleteReview: (reviewId: string) => ipcRenderer.invoke('review:delete', reviewId),

  // AI操作
  loadAIConfig: () => ipcRenderer.invoke('ai:loadConfig'),
  saveAIConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
  callAI: (prompt: string | { prompt: string; modelId?: string; modelIds?: string[]; mode?: 'single' | 'parallel'; config?: any; usageRequestId?: string }) => ipcRenderer.invoke('ai:call', prompt),
  callAIParallelDetails: (params: { prompt: string; modelId?: string; modelIds?: string[]; config?: any }) => ipcRenderer.invoke('ai:callParallelDetails', params),
  getAIUsageStatistics: () => ipcRenderer.invoke('ai:usageStatistics'),
  getAIUsageForRequest: (requestId: string) => ipcRenderer.invoke('ai:usageForRequest', requestId),
  generateSummary: (content: string) => ipcRenderer.invoke('ai:generateSummary', content),
  reviewSuggestion: (params: any) => ipcRenderer.invoke('ai:reviewSuggestion', params),

  // 提示词模板
  loadPromptTemplates: () => ipcRenderer.invoke('prompt:loadAll'),
  savePromptTemplate: (template: any) => ipcRenderer.invoke('prompt:save', template),
  resetPromptTemplate: (id: string) => ipcRenderer.invoke('prompt:reset', id),

  // Skill 包管理
  loadSkillPackages: () => ipcRenderer.invoke('skill:loadAll'),
  importSkillPackage: (pkg: any) => ipcRenderer.invoke('skill:import', pkg),
  deleteSkillPackage: (id: string) => ipcRenderer.invoke('skill:delete', id),
  setSkillEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('skill:setEnabled', id, enabled),
  setSkillWeight: (id: string, weight: number) => ipcRenderer.invoke('skill:setWeight', id, weight),

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


  // LAN collaboration
  startCollaborationReceiver: (params?: { port?: number }) => ipcRenderer.invoke('collaboration:startReceiver', params),
  stopCollaborationReceiver: () => ipcRenderer.invoke('collaboration:stopReceiver'),
  getCollaborationStatus: () => ipcRenderer.invoke('collaboration:getStatus'),
  sendCollaborationTask: (params: { endpoint?: string; friendId?: string; task: any; projectName?: string; senderName?: string }) => ipcRenderer.invoke('collaboration:sendTask', params),
  listCollaborationPeers: () => ipcRenderer.invoke('collaboration:listPeers'),
  listCollaborationFriends: () => ipcRenderer.invoke('collaboration:listFriends'),
  searchCollaborationFriendByEmail: (email: string) => ipcRenderer.invoke('collaboration:searchByEmail', email),
  listCollaborationChatMessages: (friendId: string) => ipcRenderer.invoke('collaboration:listChatMessages', friendId),
  sendCollaborationChatMessage: (params: { friendId: string; content: string }) => ipcRenderer.invoke('collaboration:sendChatMessage', params),
  addCollaborationFriend: (peer: any) => ipcRenderer.invoke('collaboration:addFriend', peer),
  removeCollaborationFriend: (friendId: string) => ipcRenderer.invoke('collaboration:removeFriend', friendId),
  sendCollaborationFile: (params: { endpoint?: string; friendId?: string; filePath: string; projectName?: string; senderName?: string }) => ipcRenderer.invoke('collaboration:sendFile', params),
  sendFriendRequest: (params: { targetId: string; targetHost: string; targetPort: number; message?: string }) => ipcRenderer.invoke('collaboration:sendFriendRequest', params),
  listFriendRequests: () => ipcRenderer.invoke('collaboration:listFriendRequests'),
  acceptFriendRequest: (requestId: string) => ipcRenderer.invoke('collaboration:acceptFriendRequest', requestId),
  rejectFriendRequest: (requestId: string) => ipcRenderer.invoke('collaboration:rejectFriendRequest', requestId),
  onCollaborationPeersChanged: (callback: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('collaboration:peersChanged', listener);
    return () => ipcRenderer.removeListener('collaboration:peersChanged', listener);
  },
  onCollaborationFileReceived: (callback: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('collaboration:fileReceived', listener);
    return () => ipcRenderer.removeListener('collaboration:fileReceived', listener);
  },
  onCollaborationTaskReceived: (callback: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('collaboration:taskReceived', listener);
    return () => ipcRenderer.removeListener('collaboration:taskReceived', listener);
  },
  onCollaborationChatReceived: (callback: (message: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: any) => callback(message);
    ipcRenderer.on('collaboration:chatReceived', listener);
    return () => ipcRenderer.removeListener('collaboration:chatReceived', listener);
  },
  onFriendRequestReceived: (callback: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('collaboration:friendRequestReceived', listener);
    return () => ipcRenderer.removeListener('collaboration:friendRequestReceived', listener);
  },

  // 设置操作
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (config: any) => ipcRenderer.invoke('settings:save', config),
  createProjectFolder: (params: { projectName: string; workspacePath: string }) =>
    ipcRenderer.invoke('project:createFolder', params),
  getWorkspaceSize: (workspacePath: string) => ipcRenderer.invoke('workspace:getSize', workspacePath),
  listWorkspaceFolders: (dirPath: string) => ipcRenderer.invoke('workspace:listFolders', dirPath),
  listWorkspaceMigrationProjects: (params: { sourceWorkspacePath: string }) =>
    ipcRenderer.invoke('workspace:listMigrationProjects', params),
  migrateWorkspaceProjects: (params: { sourceWorkspacePath: string; targetWorkspacePath: string; projectIds: string[] }) =>
    ipcRenderer.invoke('workspace:migrateProjects', params),
  moveFolder: (params: { src: string; dest: string }) => ipcRenderer.invoke('workspace:moveFolder', params),
  deleteFolder: (folderPath: string, options?: { permanent?: boolean }) => ipcRenderer.invoke('workspace:deleteFolder', folderPath, options),
  listRecycleBin: (params: { workspacePath: string }) => ipcRenderer.invoke('workspace:listRecycleBin', params),
  restoreRecycleBinItem: (params: { workspacePath: string; id: string }) => ipcRenderer.invoke('workspace:restoreRecycleBinItem', params),
  permanentlyDeleteRecycleBinItem: (params: { workspacePath: string; id: string }) => ipcRenderer.invoke('workspace:permanentlyDeleteRecycleBinItem', params),
  emptyRecycleBin: (params: { workspacePath: string }) => ipcRenderer.invoke('workspace:emptyRecycleBin', params),
  cleanupRecycleBin: (params: { workspacePath: string }) => ipcRenderer.invoke('workspace:cleanupRecycleBin', params),
  scanProjectFiles: (folderPath: string) => ipcRenderer.invoke('workspace:scanProjectFiles', folderPath),

  // 项目文档操作
  saveProjectDoc: (doc: any) => ipcRenderer.invoke('projectDoc:save', doc),
  loadProjectDocs: () => ipcRenderer.invoke('projectDoc:loadAll'),
  deleteProjectDoc: (docId: string) => ipcRenderer.invoke('projectDoc:delete', docId),
  analyzeProjectDoc: (params: { content: string; template: any; useAI?: boolean; actualStructure?: boolean }) =>
    ipcRenderer.invoke('projectDoc:analyze', params),

  // Knowledge and reference materials
  loadStageMemories: () => ipcRenderer.invoke('knowledge:loadStageMemories'),
  saveStageMemory: (entry: any) => ipcRenderer.invoke('knowledge:saveStageMemory', entry),
  deleteStageMemory: (memoryId: string) => ipcRenderer.invoke('knowledge:deleteStageMemory', memoryId),
  deleteStageMemoriesForDoc: (docId: string) => ipcRenderer.invoke('knowledge:deleteStageMemoriesForDoc', docId),
  learnStageFinal: (params: any) => ipcRenderer.invoke('knowledge:learnStageFinal', params),
  loadReferenceMaterials: () => ipcRenderer.invoke('knowledge:loadReferenceMaterials'),
  saveReferenceMaterial: (material: any) => ipcRenderer.invoke('knowledge:saveReferenceMaterial', material),
  deleteReferenceMaterial: (materialId: string) => ipcRenderer.invoke('knowledge:deleteReferenceMaterial', materialId),
  importReferenceFiles: (params: { projectId: string; filePaths: string[]; source?: 'project-file' | 'external' }) =>
    ipcRenderer.invoke('knowledge:importReferenceFiles', params),

  // 文件创建
  createBlankFile: (params: { folderPath: string; fileName: string; fileType: string }) =>
    ipcRenderer.invoke('file:createBlank', params),
  getFolderContents: (folderPath: string) => ipcRenderer.invoke('folder:getContents', folderPath),
  getTreeStats: (folderPath: string) => ipcRenderer.invoke('folder:getTreeStats', folderPath),
  searchProjectFiles: (params: { folderPath: string; query: string }) => ipcRenderer.invoke('folder:searchFiles', params),
  scanStageFiles: (folderPath: string) => ipcRenderer.invoke('folder:scanStageFiles', folderPath),
  createFromTemplate: (params: { folderPath: string; fileName: string; template: any; fileType?: string }) =>
    ipcRenderer.invoke('file:createFromTemplate', params),
  generateFromContent: (params: { template: any; sectionContents: Record<string, string>; folderPath: string; fileName: string }) =>
    ipcRenderer.invoke('file:generateFromContent', params),

  // ZIP 导入导出
  openZipFile: () => ipcRenderer.invoke('dialog:openZip'),
  importFromZip: (params: { zipPath: string; workspacePath: string }) =>
    ipcRenderer.invoke('project:importFromZip', params),
  listZipFiles: (zipPath: string) => ipcRenderer.invoke('zip:listFiles', zipPath),
  extractZipFiles: (params: { zipPath: string; targetPath: string; filePaths: string[] }) =>
    ipcRenderer.invoke('zip:extractFiles', params),
  saveZipFile: (projectName: string) => ipcRenderer.invoke('dialog:saveZip', projectName),
  exportZip: (params: { project: any; savePath: string; projectDocs: any[] }) =>
    ipcRenderer.invoke('project:exportZip', params),
});

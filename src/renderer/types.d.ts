interface CollaborationPeerInfo {
  id: string;
  name: string;
  nickname?: string;
  email?: string;
  deviceName?: string;
  host: string;
  port: number;
  source?: string;
  status?: string;
  lastSeenAt?: string;
  addedAt?: string;
  online?: boolean;
  added?: boolean;
}
interface CollaborationFriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromDeviceName?: string;
  fromEmail?: string;
  fromHost: string;
  fromPort: number;
  message?: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}
interface CollaborationChatMessage {
  id: string;
  friendId: string;
  direction: 'incoming' | 'outgoing';
  content: string;
  senderName?: string;
  createdAt: string;
}
interface ElectronAPI {
  // 文件操作
  openFolder: () => Promise<string | null>;
  openFile: (filters?: any[]) => Promise<string | null>;
  openFiles: (filters?: any[]) => Promise<string[] | null>;
  openInExplorer: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  openFileWithApp: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  compressToZip: (sourcePath: string) => Promise<{ success: boolean; filePath?: string; fileName?: string; error?: string }>;
  extractZip: (zipPath: string) => Promise<{ success: boolean; targetPath?: string; fileCount?: number; error?: string }>;
    startDrag: (filePath: string) => { success: boolean; error?: string };
  getPathForFile: (file: File) => string;
  renameFile: (params: { filePath: string; newName: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  importFiles: (params: { folderPath: string; filePaths: string[] }) => Promise<{ success: boolean; files?: { name: string; path: string }[]; error?: string }>;
  duplicateFiles: (params: { sourcePaths: string[]; targetFolder: string }) => Promise<{ success: boolean; copies?: { name: string; path: string; isDirectory: boolean }[]; error?: string }>;
  moveFiles: (params: { sourcePaths: string[]; targetFolder: string }) => Promise<{ success: boolean; moved?: { name: string; path: string; sourcePath: string; isDirectory: boolean }[]; errors?: string[]; error?: string }>;
  deleteFile: (filePath: string, options?: { permanent?: boolean }) => Promise<{ success: boolean; recycleEntry?: { id: string }; error?: string }>;
  createFolder: (params: { folderPath: string; folderName: string }) => Promise<{ success: boolean; folderPath?: string; error?: string }>;
  readFile: (filePath: string) => Promise<string>;
  readDir: (dirPath: string) => Promise<string[]>;
  listSystemFonts: () => Promise<{ success: boolean; fonts: string[]; error?: string }>;
  showSystemNotification?: (params: { title: string; body?: string; silent?: boolean; target?: string; projectId?: string }) => Promise<{ success: boolean; error?: string; shortcut?: any; appUserModelId?: string }>;
  getSystemNotificationStatus?: () => Promise<{ supported: boolean; shortcut?: any; appUserModelId?: string }>;
  onSystemNotificationClick?: (callback: (payload: { target?: string; projectId?: string }) => void) => () => void;
  onAIActivity?: (callback: (activity: { id: string; status: 'started' | 'completed' | 'failed'; createdAt: string; modelName: string; model: string; requestId?: string; error?: string }) => void) => () => void;
  parseWordDocument: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; error?: string }>;
  parseDocument: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; convertedFilePath?: string; error?: string }>;
  replaceDocumentText: (params: { filePath: string; originalText: string; replacementText: string }) => Promise<{ success: boolean; replacedCount?: number; backupPath?: string; matchMode?: 'exact' | 'compact'; error?: string }>;
  parseDocumentSilent?: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; convertedFilePath?: string; error?: string }>;
  extractTemplateFormatRules?: (filePath: string) => Promise<{ success: boolean; formatRules?: any; paragraphs?: any[]; evidence?: string[]; sampleCount?: number; paragraphCount?: number; error?: string }>;
  applyDocumentParagraphFormats?: (params: { sourcePath: string; targetPath: string; paragraphIndices: number[] }) => Promise<{ success: boolean; appliedCount?: number; backupPath?: string; error?: string }>;
  parsePdfDocument: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; error?: string }>;

  // 项目操作
  saveProject: (project: any) => Promise<void>;
  loadProjects: () => Promise<any[]>;
  deleteProject: (projectId: string) => Promise<void>;
  refreshProjectFolderModifiedAt: (projectIds: string[]) => Promise<{ id: string; folderModifiedAt: string }[]>;

  // 版本操作
  saveVersion: (version: any) => Promise<void>;
  loadVersions: () => Promise<any[]>;
  deleteVersion: (versionId: string) => Promise<void>;

  // 模板操作
  saveTemplate: (template: any) => Promise<void>;
  loadTemplates: () => Promise<any[]>;
  deleteTemplate: (templateId: string) => Promise<void>;
  storeTemplateFile: (params: { templateId: string; sourcePath: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  analyzeExamples: (params: { exampleContents: string[]; templateNodes: Array<{ id: string; title: string; level: number }>; templateName: string; existingAnalysis?: string }) => Promise<{ success: boolean; analysis?: string; rawAnalysis?: any; error?: string }>;

  // 审查操作
  executeReview: (params: any) => Promise<{ success: boolean; result?: any; error?: string }>;
  loadReviews: () => Promise<any[]>;
  deleteReview: (reviewId: string) => Promise<void>;

  // AI操作
  loadAIConfig: () => Promise<any>;
  saveAIConfig: (config: any) => Promise<void>;
  callAI: (prompt: string | { prompt: string; modelId?: string; modelIds?: string[]; mode?: 'single' | 'parallel'; config?: any; usageRequestId?: string }) => Promise<string>;
  callAIParallelDetails: (params: { prompt: string; modelId?: string; modelIds?: string[]; config?: any }) => Promise<{ mode: 'single' | 'parallel'; synthesis: string; synthesisModelId?: string; synthesisModelName?: string; variants: Array<{ modelId: string; modelName: string; ok: boolean; output: string; error?: string }> }>;
  getAIUsageStatistics: () => Promise<import('../shared/types').AIUsageStatistics>;
  getAIUsageForRequest: (requestId: string) => Promise<import('../shared/types').AITokenUsage>;
  generateSummary: (content: string) => Promise<{ success: boolean; summary?: string; error?: string }>;
  reviewSuggestion: (params: any) => Promise<{ success: boolean; suggestions?: string; error?: string }>;

  // 提示词模板
  loadPromptTemplates: () => Promise<any[]>;
  savePromptTemplate: (template: any) => Promise<void>;
  resetPromptTemplate: (id: string) => Promise<void>;

  // Skill 包管理
  loadSkillPackages: () => Promise<any[]>;
  importSkillPackage: (pkg: any) => Promise<any>;
  deleteSkillPackage: (id: string) => Promise<void>;
  setSkillEnabled: (id: string, enabled: boolean) => Promise<void>;
  setSkillWeight: (id: string, weight: number) => Promise<void>;

  // 文件夹监听
  startFolderWatch: (params: { projectId: string; folderPath: string }) => Promise<{ success: boolean; error?: string }>;
  stopFolderWatch: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  listFolderFiles: (folderPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  onFileDetected: (callback: (data: { projectId: string; filePath: string; fileName: string; fileType: string }) => void) => void;

  // 任务操作
  saveTask: (task: any) => Promise<void>;
  loadTasks: () => Promise<any[]>;
  deleteTask: (taskId: string) => Promise<void>;
  executeAITask: (params: { taskId: string; content: string; instruction: string; usageRequestId?: string }) => Promise<{ success: boolean; result?: string; usage?: import('../shared/types').AITokenUsage; error?: string }>;


  // LAN collaboration
  startCollaborationReceiver?: (params?: { port?: number }) => Promise<{ success: boolean; port?: number; addresses?: string[]; urls?: string[]; peers?: CollaborationPeerInfo[]; friends?: CollaborationPeerInfo[]; error?: string }>;
  stopCollaborationReceiver?: () => Promise<{ success: boolean; error?: string }>;
  getCollaborationStatus?: () => Promise<{ success: boolean; running: boolean; port?: number; addresses?: string[]; urls?: string[]; peers?: CollaborationPeerInfo[]; friends?: CollaborationPeerInfo[]; error?: string }>;
  sendCollaborationTask?: (params: { endpoint?: string; friendId?: string; task: any; projectName?: string; senderName?: string }) => Promise<{ success: boolean; result?: any; error?: string }>;
  listCollaborationPeers?: () => Promise<{ success: boolean; peers?: CollaborationPeerInfo[]; friends?: CollaborationPeerInfo[]; error?: string }>;
  listCollaborationFriends?: () => Promise<{ success: boolean; friends?: CollaborationPeerInfo[]; error?: string }>;
  searchCollaborationFriendByEmail?: (email: string) => Promise<{ success: boolean; peer?: CollaborationPeerInfo | null; error?: string }>;
  listCollaborationChatMessages?: (friendId: string) => Promise<{ success: boolean; messages?: CollaborationChatMessage[]; error?: string }>;
  sendCollaborationChatMessage?: (params: { friendId: string; content: string }) => Promise<{ success: boolean; message?: CollaborationChatMessage; error?: string }>;
  addCollaborationFriend?: (peer: CollaborationPeerInfo) => Promise<{ success: boolean; friend?: CollaborationPeerInfo; friends?: CollaborationPeerInfo[]; error?: string }>;
  removeCollaborationFriend?: (friendId: string) => Promise<{ success: boolean; friends?: CollaborationPeerInfo[]; error?: string }>;
  sendCollaborationFile?: (params: { endpoint?: string; friendId?: string; filePath: string; projectName?: string; senderName?: string }) => Promise<{ success: boolean; result?: any; error?: string }>;
  onCollaborationPeersChanged?: (callback: (payload: { peers?: CollaborationPeerInfo[]; friends?: CollaborationPeerInfo[] }) => void) => () => void;
  onCollaborationFileReceived?: (callback: (payload: { filePath?: string; fileName?: string; size?: number; isDirectory?: boolean; fileCount?: number; senderName?: string; projectName?: string; receivedAt?: string }) => void) => () => void;
  onCollaborationTaskReceived?: (callback: (payload: { task?: any; projectName?: string; senderName?: string; sentAt?: string }) => void) => () => void;
  onCollaborationChatReceived?: (callback: (message: CollaborationChatMessage) => void) => () => void;
  sendFriendRequest?: (params: { targetId: string; targetHost: string; targetPort: number; message?: string }) => Promise<{ success: boolean; request?: any; error?: string }>;
  listFriendRequests?: () => Promise<{ success: boolean; requests?: CollaborationFriendRequest[]; error?: string }>;
  acceptFriendRequest?: (requestId: string) => Promise<{ success: boolean; friends?: CollaborationPeerInfo[]; error?: string }>;
  rejectFriendRequest?: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  onFriendRequestReceived?: (callback: (payload: CollaborationFriendRequest) => void) => () => void;

  // 设置操作
  loadSettings: () => Promise<{ workspacePath: string; workspaceCapacity: number; recycleBinRetentionDays?: number; userProfile?: { nickname: string; email: string; avatar?: string }; customStages?: any[]; compositionWeights?: import('../shared/types').CompositionWeightConfig; enableSystemNotifications?: boolean; autoProjectDescriptionEnabled?: boolean; holidayDataSource?: 'auto' | 'local' | 'online'; holidayApiUrl?: string; calendarDayRecords?: import('../shared/types').CalendarDayRecord[]; calendarItineraries?: import('../shared/types').CalendarItinerary[] } | null>;
  saveSettings: (config: any) => Promise<void>;
  createProjectFolder: (params: { projectName: string; workspacePath: string }) => Promise<{ success: boolean; folderPath?: string; error?: string }>;
  getWorkspaceSize: (workspacePath: string) => Promise<{ success: boolean; bytes: number }>;
  listWorkspaceFolders: (dirPath: string) => Promise<{ success: boolean; folders: string[]; error?: string }>;
  listWorkspaceMigrationProjects: (params: { sourceWorkspacePath: string }) => Promise<{
    success: boolean;
    projects?: Array<{ id: string; name: string; folderPath: string; folderName: string; exists: boolean }>;
    error?: string;
  }>;
  migrateWorkspaceProjects: (params: { sourceWorkspacePath: string; targetWorkspacePath: string; projectIds: string[] }) => Promise<{
    success: boolean;
    migratedProjectIds?: string[];
    failed?: Array<{ id: string; name: string; error: string }>;
    error?: string;
  }>;
  moveFolder: (params: { src: string; dest: string }) => Promise<{ success: boolean; error?: string }>;
  deleteFolder: (folderPath: string, options?: { permanent?: boolean }) => Promise<{ success: boolean; recycleEntry?: { id: string }; error?: string }>;
  listRecycleBin: (params: { workspacePath: string }) => Promise<{ success: boolean; entries?: Array<{ id: string; name: string; originalPath: string; isDirectory: boolean; deletedAt: string; size: number }>; error?: string }>;
  restoreRecycleBinItem: (params: { workspacePath: string; id: string }) => Promise<{ success: boolean; error?: string }>;
  permanentlyDeleteRecycleBinItem: (params: { workspacePath: string; id: string }) => Promise<{ success: boolean; error?: string }>;
  emptyRecycleBin: (params: { workspacePath: string }) => Promise<{ success: boolean; removed?: number; error?: string }>;
  cleanupRecycleBin?: (params: { workspacePath: string }) => Promise<{ success: boolean; removed?: number; error?: string }>;
  scanProjectFiles: (folderPath: string) => Promise<{ success: boolean; files?: Array<{ path: string; size: number; modifiedAt: string }>; error?: string }>;

  // 项目文档操作
  saveProjectDoc: (doc: any) => Promise<void>;
  loadProjectDocs: () => Promise<any[]>;
  deleteProjectDoc: (docId: string) => Promise<void>;
  analyzeProjectDoc: (params: { content: string; template: any; useAI?: boolean; actualStructure?: boolean }) => Promise<{ success: boolean; sections?: any[]; overallProgress?: number; error?: string }>;
  loadStageMemories?: () => Promise<any[]>;
  saveStageMemory?: (entry: any) => Promise<any>;
  deleteStageMemory?: (memoryId: string) => Promise<void>;
  deleteStageMemoriesForDoc?: (docId: string) => Promise<{ success: boolean; removed?: number; error?: string }>;
  learnStageFinal?: (params: any) => Promise<{ success: boolean; entry?: any; error?: string }>;
  loadReferenceMaterials?: () => Promise<any[]>;
  saveReferenceMaterial?: (material: any) => Promise<any>;
  deleteReferenceMaterial?: (materialId: string) => Promise<void>;
  importReferenceFiles?: (params: { projectId: string; filePaths: string[]; source?: 'project-file' | 'external' }) => Promise<{ success: boolean; materials?: any[]; error?: string }>;

  // 文件创建
  createBlankFile: (params: { folderPath: string; fileName: string; fileType: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  getFolderContents: (folderPath: string) => Promise<{ success: boolean; items: { name: string; isDirectory: boolean; ext: string; size: number; modifiedAt: string; path: string }[]; error?: string }>;
  getTreeStats: (folderPath: string) => Promise<{
    success: boolean;
    stats?: {
      fileCount: number;
      folderCount: number;
      totalSize: number;
      typeCount: Record<string, number>;
    };
    files?: { name: string; path: string; relativePath: string; ext: string; size: number; modifiedAt: string }[];
    folders?: { name: string; path: string; relativePath: string }[];
    error?: string;
  }>;
  searchProjectFiles: (params: { folderPath: string; query: string }) => Promise<{ success: boolean; files: { name: string; path: string; ext: string; size: number; modifiedAt: string }[]; error?: string }>;
  scanStageFiles: (folderPath: string) => Promise<{ success: boolean; files: { name: string; path: string; ext: string; size: number; createdAt: string; modifiedAt: string }[]; error?: string }>;
  createFromTemplate: (params: { folderPath: string; fileName: string; template: any; fileType?: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // ZIP 导入导出
  openZipFile: () => Promise<string | null>;
  importFromZip: (params: { zipPath: string; workspacePath: string }) => Promise<{ success: boolean; project?: any; error?: string }>;
  listZipFiles: (zipPath: string) => Promise<{ success: boolean; files?: { name: string; path: string; size: number; isDirectory: boolean }[]; error?: string }>;
  extractZipFiles: (params: { zipPath: string; targetPath: string; filePaths: string[] }) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  saveZipFile: (projectName: string) => Promise<string | null>;
  exportZip: (params: { project: any; savePath: string; projectDocs: any[] }) => Promise<{ success: boolean; error?: string }>;
  generateFromContent: (params: { template: any; sectionContents: Record<string, string>; folderPath: string; fileName: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
}

interface Window {
  electronAPI: ElectronAPI;
}

interface ElectronAPI {
  // 文件操作
  openFolder: () => Promise<string | null>;
  openFile: (filters?: any[]) => Promise<string | null>;
  openInExplorer: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  openFileWithApp: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    startDrag: (filePath: string) => { success: boolean; error?: string };
  getPathForFile: (file: File) => string;
  renameFile: (params: { filePath: string; newName: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  importFiles: (params: { folderPath: string; filePaths: string[] }) => Promise<{ success: boolean; files?: { name: string; path: string }[]; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  readFile: (filePath: string) => Promise<string>;
  readDir: (dirPath: string) => Promise<string[]>;
  listSystemFonts: () => Promise<{ success: boolean; fonts: string[]; error?: string }>;
  parseWordDocument: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; error?: string }>;
  parseDocument: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; convertedFilePath?: string; error?: string }>;
  parseDocumentSilent?: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; convertedFilePath?: string; error?: string }>;
  extractTemplateFormatRules?: (filePath: string) => Promise<{ success: boolean; formatRules?: any; evidence?: string[]; sampleCount?: number; error?: string }>;
  parsePdfDocument: (filePath: string) => Promise<{ success: boolean; content?: string; fileName?: string; pages?: number; error?: string }>;

  // 项目操作
  saveProject: (project: any) => Promise<void>;
  loadProjects: () => Promise<any[]>;
  deleteProject: (projectId: string) => Promise<void>;

  // 版本操作
  saveVersion: (version: any) => Promise<void>;
  loadVersions: () => Promise<any[]>;
  deleteVersion: (versionId: string) => Promise<void>;

  // 模板操作
  saveTemplate: (template: any) => Promise<void>;
  loadTemplates: () => Promise<any[]>;
  deleteTemplate: (templateId: string) => Promise<void>;
  storeTemplateFile: (params: { templateId: string; sourcePath: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // 审查操作
  executeReview: (params: any) => Promise<{ success: boolean; result?: any; error?: string }>;
  loadReviews: () => Promise<any[]>;
  deleteReview: (reviewId: string) => Promise<void>;

  // AI操作
  loadAIConfig: () => Promise<any>;
  saveAIConfig: (config: any) => Promise<void>;
  callAI: (prompt: string | { prompt: string; modelId?: string; modelIds?: string[]; mode?: 'single' | 'parallel'; config?: any }) => Promise<string>;
  generateSummary: (content: string) => Promise<{ success: boolean; summary?: string; error?: string }>;
  reviewSuggestion: (params: any) => Promise<{ success: boolean; suggestions?: string; error?: string }>;

  // 文件夹监听
  startFolderWatch: (params: { projectId: string; folderPath: string }) => Promise<{ success: boolean; error?: string }>;
  stopFolderWatch: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  listFolderFiles: (folderPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  onFileDetected: (callback: (data: { projectId: string; filePath: string; fileName: string; fileType: string }) => void) => void;

  // 任务操作
  saveTask: (task: any) => Promise<void>;
  loadTasks: () => Promise<any[]>;
  deleteTask: (taskId: string) => Promise<void>;
  executeAITask: (params: { taskId: string; content: string; instruction: string }) => Promise<{ success: boolean; result?: string; error?: string }>;

  // 设置操作
  loadSettings: () => Promise<{ workspacePath: string; workspaceCapacity: number; userProfile?: { nickname: string; email: string; avatar?: string }; customStages?: any[] } | null>;
  saveSettings: (config: any) => Promise<void>;
  createProjectFolder: (params: { projectName: string; workspacePath: string }) => Promise<{ success: boolean; folderPath?: string; error?: string }>;
  getWorkspaceSize: (workspacePath: string) => Promise<{ success: boolean; bytes: number }>;
  listWorkspaceFolders: (dirPath: string) => Promise<{ success: boolean; folders: string[]; error?: string }>;
  moveFolder: (params: { src: string; dest: string }) => Promise<{ success: boolean; error?: string }>;
  deleteFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;

  // 项目文档操作
  saveProjectDoc: (doc: any) => Promise<void>;
  loadProjectDocs: () => Promise<any[]>;
  deleteProjectDoc: (docId: string) => Promise<void>;
  analyzeProjectDoc: (params: { content: string; template: any; useAI?: boolean }) => Promise<{ success: boolean; sections?: any[]; overallProgress?: number; error?: string }>;

  // 文件创建
  createBlankFile: (params: { folderPath: string; fileName: string; fileType: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  getFolderContents: (folderPath: string) => Promise<{ success: boolean; items: { name: string; isDirectory: boolean; ext: string; size: number; modifiedAt: string; path: string }[]; error?: string }>;
  scanStageFiles: (folderPath: string) => Promise<{ success: boolean; files: { name: string; path: string; ext: string; size: number; createdAt: string; modifiedAt: string }[]; error?: string }>;
  createFromTemplate: (params: { folderPath: string; fileName: string; template: any; fileType?: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // ZIP 导入导出
  openZipFile: () => Promise<string | null>;
  importFromZip: (params: { zipPath: string; workspacePath: string }) => Promise<{ success: boolean; project?: any; error?: string }>;
  saveZipFile: (projectName: string) => Promise<string | null>;
  exportZip: (params: { project: any; savePath: string; projectDocs: any[] }) => Promise<{ success: boolean; error?: string }>;
}

interface Window {
  electronAPI: ElectronAPI;
}

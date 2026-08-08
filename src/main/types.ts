// 项目类型定义
export interface Project {
  id: string;
  name: string;
  description: string; // 项目描述
  descriptionSource?: 'manual' | 'auto';
  autoDescriptionUpdatedAt?: string;
  autoDescriptionPendingSince?: string;
  autoDescriptionNextUpdateAt?: string;
  autoDescriptionPendingFileNames?: string[];
  autoDescriptionLastFileActivityAt?: string;
  autoDescriptionGeneratedAt?: string;
  autoDescriptionGenerationAttempted?: boolean;
  autoDescriptionLastScannedAt?: string;
  autoDescriptionRetryAt?: string;
  autoDescriptionLastErrorAt?: string;
  autoDescriptionGenerationToken?: string;
  stageSummarySourceDocIds?: Record<string, string>;
  stageCompletionEvents?: StageCompletionEvent[];
  folderPath: string;
  folderModifiedAt?: string; // 项目文件夹内最近文件/目录修改时间
  status: 'active' | 'completed' | 'paused';
  progress: number; // 0-100
  templateId?: string; // 关联的模板ID
  createdAt: string;
  updatedAt: string;
}

// 文档版本类型
export interface DocumentVersion {
  id: string;
  projectId: string;
  fileName: string;
  filePath: string;
  fileType: 'docx' | 'pdf' | 'txt';
  content: string; // 解析后的文本内容
  summary?: string; // AI生成的摘要
  createdAt: string;
}

// 版本对比结果
export interface DiffResult {
  versionA: string;
  versionB: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'insert' | 'delete' | 'equal';
  text: string;
}

// 任务项
export interface TaskItem {
  id: string;
  projectId: string;
  title: string;
  description: string; // 任务描述
  type: 'ai' | 'manual'; // AI处理或人工处理
  executor?: 'human' | 'ai' | 'friend';
  workStatus?: 'draft' | 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  action?: 'write' | 'revise' | 'review' | 'format' | 'open_file' | 'dispatch';
  documentContext?: {
    projectDocumentId?: string;
    versionId?: string;
    filePath?: string;
    sectionTitle?: string;
    lineNumber?: number;
    selectedText?: string;
  };
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  source?: 'manual' | 'review' | 'stage' | 'report';
  relatedDocId?: string;
  relatedReviewId?: string;
  relatedIssueId?: string;
  sectionTitle?: string;
  /** 审查结果给出的原始行号，用于任务执行时定位文档内容 */
  sourceLineNumber?: number;
  stageName?: string;
  workflowId?: string;
  workflowName?: string;
  workflowOrder?: number;
  dependsOnTaskId?: string;
  dependsOn?: string[];
  assigneeName?: string;
  dueAt?: string;
  completedAt?: string;
  result?: string; // AI执行结果
  sourceMessageId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface StageCompletionEvent {
  id: string;
  projectId: string;
  stageName: string;
  sourceDocIds: string[];
  extractionDocId?: string;
  extractionVersionId?: string;
  completedAt: string;
  status: 'completed' | 'learning' | 'learned' | 'learning_failed' | 'reopened';
  memoryId?: string;
  learnedAt?: string;
  learningError?: string;
  reopenedAt?: string;
}

// AI配置
export type AIProvider = 'claude' | 'openai' | 'custom';

export interface AIModelConfig {
  id: string;
  name: string;
  provider: AIProvider;
  apiKey: string;
  model: string;
  endpoint?: string;
  enabled?: boolean;
  /** Maximum tokens requested from this model for one response. */
  maxOutputTokens?: number;
}

export interface AIConfig {
  provider?: AIProvider; // 兼容旧版单模型配置
  apiKey?: string;       // 兼容旧版单模型配置
  model?: string;        // 兼容旧版单模型配置
  endpoint?: string;
  models?: AIModelConfig[];
  activeModelId?: string;
  parallelModelIds?: string[];
  multiModelMode?: 'single' | 'parallel';
}

// ==================== 模板相关类型 ====================

export type TemplateOutputFileType = 'docx' | 'doc' | 'pptx' | 'xlsx' | 'pdf' | 'txt' | 'md' | 'rtf';

// 字体格式要求
export interface FontRequirement {
  fontFamily?: string; // 字体，如 "宋体"、"Times New Roman"
  fontSize?: number; // 字号，如 12、14、16
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number; // 行距，如 1.5、2.0
  letterSpacing?: number; // 字间距（磅）
  color?: string; // 颜色，如 "#000000"
}

// 段落格式要求
export interface ParagraphRequirement {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indentFirstLine?: number; // 首行缩进（字符数）
  spaceBefore?: number; // 段前间距（磅）
  spaceAfter?: number; // 段后间距（磅）
}

export interface TemplateStyleRule {
  fontRequirement?: FontRequirement;
  paragraphRequirement?: ParagraphRequirement;
}

export interface TemplateFormatRules {
  heading1?: TemplateStyleRule;
  heading2?: TemplateStyleRule;
  heading3?: TemplateStyleRule;
  heading4?: TemplateStyleRule;
  body?: TemplateStyleRule;
  caption?: TemplateStyleRule;
  tableTitle?: TemplateStyleRule;
  tableHeader?: TemplateStyleRule;
}

export type TemplateFormatRuleKey = keyof TemplateFormatRules;

export interface ExtractedParagraphFormat {
  index: number;
  key: TemplateFormatRuleKey;
  text: string;
  styleId?: string;
  styleName?: string;
  isTableCell?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
  indentFirstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface TemplateFormatExtractionResult {
  success: boolean;
  formatRules?: TemplateFormatRules;
  paragraphs?: ExtractedParagraphFormat[];
  evidence?: string[];
  sampleCount?: number;
  paragraphCount?: number;
  error?: string;
}

// 模板节点（支持层级结构）
export interface TemplateNode {
  id: string;
  title: string; // 节点标题，如 "一、项目背景"
  level: number; // 层级，1=一级标题，2=二级标题
  description?: string; // 写作提示/说明
  requirementText?: string; // 从模板中识别出的硬性要求/填写说明
  exampleText?: string; // 从模板中识别出的范文或示例写法，不作为硬性要求
  isRequired: boolean; // 是否必需
  fontRequirement?: FontRequirement; // 字体格式要求
  paragraphRequirement?: ParagraphRequirement; // 段落格式要求
  children?: TemplateNode[]; // 子节点
}

// 写作模板
export interface WritingTemplate {
  id: string;
  name: string; // 模板名称，如 "可研报告模板"
  description: string; // 模板说明
  requirementText?: string; // 模板中的硬性要求、填写说明、格式/内容约束
  exampleText?: string; // 模板中的范文、样例或参考写法，只用于提取结构和表达特征
  category: string; // 分类，如 "可研报告"、"提案表"
  outputFileType?: TemplateOutputFileType; // 使用模板创建文件时的默认文件类型
  titleFontRequirement?: FontRequirement; // 标题字体规则
  bodyFontRequirement?: FontRequirement; // 正文字体规则
  formatRules?: TemplateFormatRules; // 创建办公文档时注入的默认格式规则
  nodes: TemplateNode[]; // 模板结构节点
  filePath?: string; // 模板源文件路径（导入时保存）
  templateType?: 'direct' | 'example'; // 模板类型：direct=直接套用模板，example=范文模板，默认 direct
  exampleFilePaths?: string[]; // 范文模板的多篇范文文件路径
  exampleAnalysis?: string; // 范文模板的AI分析摘要
  createdAt: string;
  updatedAt: string;
}

// ==================== 审查相关类型 ====================

// 审查问题类型
export type ReviewIssueType = 'missing_section' | 'wrong_format' | 'content_deviation' | 'typo' | 'suggestion';

// 审查问题严重程度
export type ReviewIssueSeverity = 'error' | 'warning' | 'info';

// 审查问题
export interface ReviewIssue {
  id: string;
  type: ReviewIssueType;
  severity: ReviewIssueSeverity;
  nodeId?: string; // 关联的模板节点ID
  sectionTitle?: string; // 相关章节标题
  message: string; // 问题描述
  suggestion?: string; // 修改建议
  lineNumber?: number; // 相关行号（如有）
}

// 审查结果
export interface ReviewResult {
  id: string;
  projectId: string;
  versionId: string;
  templateId: string;
  issues: ReviewIssue[];
  score: number; // 0-100 分
  summary: string; // 审查总结
  aiSuggestions?: string; // AI生成的详细建议
  createdAt: string;
}

// 审查配置
export interface ReviewConfig {
  checkMissingSections: boolean; // 检查缺失章节
  checkFormatting: boolean; // 检查格式
  checkContentDeviation: boolean; // 检查内容偏差
  enableAI: boolean; // 启用AI建议
}

// ==================== 项目文档进度相关 ====================

// 章节分析结果
export interface SectionAnalysis {
  nodeId: string;           // 模板节点ID
  title: string;            // 章节标题
  status: 'completed' | 'partial' | 'missing';
  wordCount: number;        // 字数
  aiComment?: string;       // AI 评语
}

// 项目文档（关联模板+文件）
export type ProjectDocumentLifecycleStatus =
  | 'imported'
  | 'identified'
  | 'writing'
  | 'analyzed'
  | 'reviewed'
  | 'needs_revision'
  | 'completed'
  | 'learned'
  | 'archived';

export interface ProjectDocument {
  id: string;
  projectId: string;
  templateId: string;       // 使用的模板
  versionId?: string;       // 关联的文件版本
  name: string;             // 显示名称，如 "XX项目-提案表"
  sections: SectionAnalysis[];  // 各章节分析结果
  overallProgress: number;  // 0-100 整体完成度
  lifecycleStatus?: ProjectDocumentLifecycleStatus;
  lifecycleStatusBeforeCompletion?: ProjectDocumentLifecycleStatus;
  lifecycleUpdatedAt?: string;
  reviewedAt?: string;
  learnedAt?: string;
  reopenedAt?: string;
  deadline?: string;        // 截止日期 ISO string
  completedAt?: string;     // 完成日期 ISO string
  completionEventId?: string;
  analyzedAt?: string;      // 最近分析时间
  aiReport?: string;        // AI writing framework report JSON
  sourceFilePath?: string;  // 自动阶段识别关联的真实文件路径
  sourceFileCreatedAt?: string;  // 真实文件创建时间
  sourceFileModifiedAt?: string; // 真实文件最近修改时间
  autoStage?: boolean;      // 是否由文件名/文件夹扫描自动关联
  createdAt: string;
}

// 用户资料
export interface StageMemoryEntry {
  id: string;
  projectId: string;
  projectName: string;
  stageName: string;
  docId?: string;
  docName: string;
  sourceFilePath?: string;
  sourceVersionId?: string;
  sourceModifiedAt?: string;
  sourceKind?: 'stage-completion' | 'manual';
  completionEventId?: string;
  summary: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceMaterial {
  id: string;
  projectId: string;
  name: string;
  filePath?: string;
  source: 'project-file' | 'external';
  contentPreview?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  nickname: string;
  email: string;
  avatar?: string; // 压缩后的 data URL，用于本机显示和局域网好友同步
}

// 自定义阶段配置
export interface StageConfig {
  id: string;
  name: string;
  keywords: string[];
  color: string;
  isSystem?: boolean;
  deleted?: boolean;
}

// 应用设置
export type HolidayDataSource = 'auto' | 'local' | 'online';
export type CalendarDayTypeOverride = 'workday' | 'rest';
export type CalendarWorkStatus = 'leave' | 'business' | 'overtime';

export interface CalendarDayRecord {
  date: string;
  dayType?: CalendarDayTypeOverride;
  workStatus?: CalendarWorkStatus;
  note?: string;
  updatedAt: string;
}

export interface CalendarItinerary {
  id: string;
  date: string;
  title: string;
  note?: string;
  reminderAt?: string;
  notifiedAt?: string;
  createdAt: string;
}

export interface AppSettings {
  workspacePath: string; // 项目工作区路径
  workspaceCapacity: number; // 工作区容量上限（GB）
  recycleBinRetentionDays?: number; // 回收站自动清理天数，1-365
  userProfile?: UserProfile; // 用户资料，未设置时显示"未登录"
  enableSystemNotifications?: boolean; // Enable Windows system notifications
  autoLaunchEnabled?: boolean; // Launch ProjectHub when the user signs in to Windows
  closeWindowBehavior?: 'ask' | 'background' | 'quit'; // Close button behavior
  autoProjectDescriptionEnabled?: boolean; // Automatically generate an empty project overview after file activity settles
  autoStageMemoryEnabled?: boolean; // Learn reusable stage-writing memory after completion
  holidayDataSource?: HolidayDataSource; // Calendar holiday source
  holidayApiUrl?: string; // Calendar holiday API URL, supports {year}
  calendarDayRecords?: CalendarDayRecord[];
  calendarItineraries?: CalendarItinerary[];
  customStages?: StageConfig[]; // 自定义阶段配置
  keyboardShortcuts?: AppKeyboardShortcuts;
}

export type AppShortcutAction = 'globalSearch';

export interface AppKeyboardShortcuts {
  globalSearch: string;
}

// ─── 提示词模板系统 ─────────────────────────────────────

export type PromptScene =
  | 'draft'
  | 'longFormSection'
  | 'sectionExpansion'
  | 'precisionRewrite'
  | 'report'
  | 'review'
  | 'rewrite'
  | 'diff'
  | 'summary'
  | 'memory'
  | 'description'
  | 'taskExecute'
  | 'sectionAnalysis'
  | 'workflowPlanning'
  | 'templateExtract'
  | 'templateExampleExtract'
  | 'templateDirectExtract'
  | 'templateExampleAnalysis'
  | 'templateExampleCompare';

export interface PromptRule {
  id: string;
  text: string;
  enabled: boolean;
  type: 'must' | 'must_not' | 'prefer';
}

export interface OutputField {
  key: string;
  label: string;
  description: string;
}

export interface StructuredPrompt {
  scene: PromptScene;
  mode: 'structured' | 'raw';
  role: string;
  goals: string[];
  rules: PromptRule[];
  outputFields: OutputField[];
  rawPrompt?: string;
}

export interface PromptTemplate {
  id: string;
  scene: PromptScene;
  /** 未设置时为通用版本；设置后只在对应项目阶段生效。 */
  stageId?: string;
  stageName?: string;
  name: string;
  content: string;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
  structured?: StructuredPrompt;
}

export interface SkillPackage {
  id: string;
  name: string;
  version: string;
  type: PromptScene[];
  scope: 'global' | 'project';
  weight: number;
  enabled: boolean;
  prompts: Partial<Record<PromptScene, string>>;
  rules: string[];
  importedAt: string;
}

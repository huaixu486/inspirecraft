import { PromptScene } from './types';

export const PROMPT_SCENE_LABELS: Record<PromptScene, string> = {
  draft: '完整第一稿',
  longFormSection: '长篇分章写作',
  sectionExpansion: '章节篇幅扩写',
  precisionRewrite: '选区精确修订',
  report: '\u62a5\u544a\u751f\u6210',
  review: '\u6587\u6863\u5ba1\u67e5',
  rewrite: '\u7ae0\u8282\u6539\u5199',
  diff: '\u7248\u672c\u5bf9\u6bd4',
  summary: '\u6587\u6863\u6458\u8981',
  memory: '\u9636\u6bb5\u8bb0\u5fc6\u5b66\u4e60',
  description: '\u9879\u76ee\u63cf\u8ff0\u751f\u6210',
  taskExecute: '\u4efb\u52a1\u6267\u884c',
  sectionAnalysis: '\u7ae0\u8282\u5b8c\u6210\u5ea6\u5206\u6790',
  workflowPlanning: '阶段写作工作流规划',
  templateExtract: '\u6a21\u677f\u7ed3\u6784\u63d0\u53d6',
  templateExampleExtract: '范文模板识别',
  templateDirectExtract: '直接套用模板识别',
  templateExampleAnalysis: '范文写法分析',
  templateExampleCompare: '范文差异分析',
};

export type PromptSceneCategory = 'writing' | 'review' | 'planning' | 'automation' | 'template';

export const PROMPT_CATEGORY_LABELS: Record<PromptSceneCategory, string> = {
  writing: 'AI 写作与修订',
  review: '审查与版本对比',
  planning: '报告与任务规划',
  automation: '自动化与记忆',
  template: '模板识别',
};

export const PROMPT_SCENE_CATEGORIES: Record<PromptScene, PromptSceneCategory> = {
  draft: 'writing',
  longFormSection: 'writing',
  sectionExpansion: 'writing',
  precisionRewrite: 'writing',
  rewrite: 'writing',
  review: 'review',
  diff: 'review',
  sectionAnalysis: 'review',
  report: 'planning',
  workflowPlanning: 'planning',
  taskExecute: 'planning',
  summary: 'automation',
  memory: 'automation',
  description: 'automation',
  templateExtract: 'template',
  templateExampleExtract: 'template',
  templateDirectExtract: 'template',
  templateExampleAnalysis: 'template',
  templateExampleCompare: 'template',
};

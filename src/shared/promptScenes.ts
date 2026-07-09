import { PromptScene } from './types';

export const PROMPT_SCENE_LABELS: Record<PromptScene, string> = {
  report: '\u62a5\u544a\u751f\u6210',
  review: '\u6587\u6863\u5ba1\u67e5',
  rewrite: '\u7ae0\u8282\u6539\u5199',
  diff: '\u7248\u672c\u5bf9\u6bd4',
  summary: '\u6587\u6863\u6458\u8981',
  memory: '\u9636\u6bb5\u8bb0\u5fc6\u5b66\u4e60',
  description: '\u9879\u76ee\u63cf\u8ff0\u751f\u6210',
  taskExecute: '\u4efb\u52a1\u6267\u884c',
  sectionAnalysis: '\u7ae0\u8282\u5b8c\u6210\u5ea6\u5206\u6790',
  templateExtract: '\u6a21\u677f\u7ed3\u6784\u63d0\u53d6',
};
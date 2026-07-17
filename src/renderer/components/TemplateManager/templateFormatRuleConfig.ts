export const formatRuleRows = [
  { key: 'heading1', label: '一级标题', defaultFont: '黑体', defaultSize: 16, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'heading2', label: '二级标题', defaultFont: '黑体', defaultSize: 15, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'heading3', label: '三级标题', defaultFont: '黑体', defaultSize: 14, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'heading4', label: '四级标题', defaultFont: '黑体', defaultSize: 12, defaultLineHeight: 1.5, defaultBold: true },
  { key: 'body', label: '正文', defaultFont: '宋体', defaultSize: 12, defaultLineHeight: 1.5, defaultBold: false },
  { key: 'caption', label: '图题/图例', defaultFont: '宋体', defaultSize: 10.5, defaultLineHeight: 1.5, defaultBold: false },
  { key: 'tableTitle', label: '表题', defaultFont: '宋体', defaultSize: 10.5, defaultLineHeight: 1.5, defaultBold: false },
  { key: 'tableHeader', label: '表头', defaultFont: '宋体', defaultSize: 10.5, defaultLineHeight: 1.5, defaultBold: true },
] as const;

export type TemplateFormatRuleKey = typeof formatRuleRows[number]['key'];

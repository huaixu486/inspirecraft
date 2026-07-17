import type { TemplateNode, WritingTemplate } from '../../shared/types';

export interface QuickDraftTemplateContext {
  mode: 'direct' | 'example';
  requirements: string;
  examples: string;
}

type FlatTemplateNode = { node: TemplateNode; depth: number };

function flattenNodes(nodes: TemplateNode[] = [], depth = 0): FlatTemplateNode[] {
  return nodes.flatMap(node => [
    { node, depth },
    ...flattenNodes(node.children || [], depth + 1),
  ]);
}

function joinNonEmpty(parts: Array<string | undefined>, separator = '\n'): string {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join(separator);
}

function limitText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n（其余内容因长度限制省略）`;
}

function formatStructure(template: WritingTemplate, rows: FlatTemplateNode[]): string {
  const isExample = template.templateType === 'example';
  const outline = rows.map(({ node, depth }) => `${'  '.repeat(depth)}- ${node.title}`).join('\n');
  const guidanceLines = rows.map(({ node, depth }) => {
    const guidance = joinNonEmpty([
      node.description && `写作说明：${node.description}`,
      node.requirementText && `填写要求：${node.requirementText}`,
    ], '；');
    return guidance ? `${'  '.repeat(depth)}【${node.title}】${guidance}` : '';
  }).filter(Boolean);
  const label = isExample
    ? '范文提炼的建议性写作方向（用于组织内容，可根据当前项目调整标题，不要照搬范文项目事实）'
    : '通用模板章节结构（应按顺序覆盖，必填章节不得遗漏）';
  return joinNonEmpty([
    `${label}：\n${outline || '模板未配置章节节点'}`,
    guidanceLines.length ? `各章节具体写作要求：\n${guidanceLines.join('\n')}` : '',
  ], '\n\n');
}

function formatExamples(template: WritingTemplate, rows: FlatTemplateNode[]): string {
  const nodeExamples = rows
    .filter(({ node }) => node.exampleText?.trim())
    .map(({ node }) => `【${node.title}的参考写法】\n${node.exampleText!.trim()}`)
    .join('\n\n');
  const parts = [
    template.exampleAnalysis && `【范文分析摘要】\n${template.exampleAnalysis}`,
    template.exampleText && `【模板全局范文/示例】\n${template.exampleText}`,
    nodeExamples,
  ];
  return limitText(joinNonEmpty(parts, '\n\n') || '模板未提供范文内容；仅依据模板结构和写作要求起草。', 12000);
}

export function buildQuickDraftTemplateContext(template: WritingTemplate): QuickDraftTemplateContext {
  const mode = template.templateType === 'example' ? 'example' : 'direct';
  const rows = flattenNodes(template.nodes || []);
  const formatRules = template.formatRules
    ? `文档格式规则：${limitText(JSON.stringify(template.formatRules), 2500)}`
    : '';
  const requirements = limitText(joinNonEmpty([
    `模板名称：${template.name}`,
    `模板类型：${mode === 'example' ? '范文模板' : '通用模板'}`,
    template.description && `模板说明：${template.description}`,
    template.requirementText && `全局硬性要求：${template.requirementText}`,
    formatStructure(template, rows),
    formatRules,
  ], '\n\n'), 16000);

  return {
    mode,
    requirements,
    examples: formatExamples(template, rows),
  };
}

export function buildQuickDraftTaskInstructions(mode: 'direct' | 'example'): string {
  const templateRule = mode === 'example'
    ? '范文模板用于约束写作方向、内容组织、篇幅和表达风格；可按当前项目调整标题，不照抄范文中的单位、项目、数据或结论。'
    : '通用模板的章节顺序、必填内容、篇幅和填写要求属于主要约束，应尽量完整覆盖。';

  return `[AI 写作任务]
请直接生成一份可供人工继续修改的完整第一稿，不要输出写作建议、分析过程或填空式提纲。
${templateRule}

起草规则：
1. 优先遵循用户本次要求、模板结构与要求，并参考模板范文的段落组织和表达方式。
2. 即使项目资料有限，也要根据项目名称、项目简介、写作主题和模板信息先形成连贯、专业、可编辑的正文；可以作合理的概括、组织和一般性论述。
3. 不得虚构精确数值、日期、型号、单位名称、已经发生的事件或未经资料支持的结论。
4. 优先使用不依赖具体数值的完整表述。只有确实无法绕开的关键事实才使用简短“待确认”标记，且应少量、分散出现；不要输出“【待补充：……】”式变量说明，不要让占位内容主导正文。
5. 模板中的范文只用于学习结构和写法，范文事实不属于当前项目。
6. 输出文稿正文即可。保留必要的章节标题，但不要使用代码块，不要附加说明或致歉。`;
}

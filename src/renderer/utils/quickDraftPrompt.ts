import type { TemplateNode, WritingTemplate } from '../../shared/types';

export interface QuickDraftTemplateContext {
  mode: 'direct' | 'example';
  requirements: string;
  examples: string;
}

export interface DraftReferenceDocument {
  name: string;
  content: string;
  kind?: 'project' | 'external' | 'template';
}

export interface LongFormSectionPlan {
  id: string;
  title: string;
  guidance: string;
  targetMin: number;
  targetMax: number;
  hasExplicitLength: boolean;
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

function parseLengthRange(value: string): { min: number; max: number; explicit: boolean } {
  const normalized = String(value || '').replace(/[,，]/g, '').replace(/[～—–至]/g, '-');
  const range = normalized.match(/(\d{2,6})\s*-\s*(\d{2,6})\s*(?:字|字符)?/);
  if (range) {
    const first = Number(range[1]);
    const second = Number(range[2]);
    return { min: Math.min(first, second), max: Math.max(first, second), explicit: true };
  }
  const minimum = normalized.match(/(?:不少于|至少|不低于)\s*(\d{2,6})\s*(?:字|字符)?/);
  if (minimum) {
    const min = Number(minimum[1]);
    return { min, max: Math.ceil(min * 1.25), explicit: true };
  }
  const approximate = normalized.match(/(?:约|大约|建议字数[:：]?\s*约?)\s*(\d{2,6})\s*(?:字|字符)/);
  if (approximate) {
    const target = Number(approximate[1]);
    return { min: Math.floor(target * 0.9), max: Math.ceil(target * 1.1), explicit: true };
  }
  return { min: 0, max: 0, explicit: false };
}

function formatNodeGuidance(node: TemplateNode): string {
  const own = joinNonEmpty([node.description, node.requirementText], '；');
  const children = (node.children || []).map(child => {
    const detail = joinNonEmpty([child.description, child.requirementText], '；');
    return detail ? `${child.title}：${detail}` : child.title;
  });
  return joinNonEmpty([own, children.length ? `本节应覆盖：${children.join('；')}` : ''], '\n');
}

export function buildLongFormSectionPlan(template: WritingTemplate): LongFormSectionPlan[] {
  const reportLike = /报告|方案|研究|可研|论文|总结|申报书/.test(`${template.name} ${template.category || ''}`);
  return (template.nodes || []).map(node => {
    const guidance = formatNodeGuidance(node);
    const parsed = parseLengthRange(`${node.description || ''} ${node.requirementText || ''} ${guidance}`);
    const fallback = reportLike ? 1200 : 800;
    return {
      id: node.id,
      title: node.title,
      guidance,
      targetMin: parsed.explicit ? parsed.min : fallback,
      targetMax: parsed.explicit ? parsed.max : Math.ceil(fallback * 1.25),
      hasExplicitLength: parsed.explicit,
    };
  });
}

export function shouldGenerateLongForm(template: WritingTemplate, plan = buildLongFormSectionPlan(template)): boolean {
  const expectedMinimum = plan.reduce((sum, section) => sum + section.targetMin, 0);
  return plan.length >= 3 && (expectedMinimum >= 2500 || /报告|方案|研究|可研|论文/.test(template.name));
}

export function countDraftCharacters(value: string): number {
  return String(value || '').replace(/\s/g, '').length;
}

function splitReferenceContent(value: string, chunkSize = 1800): string[] {
  const paragraphs = String(value || '').split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > chunkSize) {
      chunks.push(current);
      current = '';
    }
    if (paragraph.length > chunkSize) {
      if (current) chunks.push(current);
      for (let index = 0; index < paragraph.length; index += chunkSize) {
        chunks.push(paragraph.slice(index, index + chunkSize));
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function queryTerms(value: string): string[] {
  const cleaned = String(value || '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(item => item.length >= 2);
  const chinese = String(value || '').replace(/[^\u4e00-\u9fff]/g, '');
  const fragments: string[] = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= chinese.length; index += Math.max(1, size - 1)) {
      fragments.push(chinese.slice(index, index + size));
    }
  }
  return [...new Set([...cleaned, ...fragments])].slice(0, 80);
}

export function selectRelevantReferenceExcerpts(
  documents: DraftReferenceDocument[],
  query: string,
  maxLength = 10000,
): string {
  const terms = queryTerms(query);
  const ranked = documents.flatMap(document => splitReferenceContent(document.content).map((chunk, index) => {
    const score = terms.reduce((sum, term) => sum + (chunk.includes(term) ? Math.min(8, term.length) : 0), 0);
    return { document, chunk, index, score };
  })).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: string[] = [];
  let length = 0;
  for (const item of ranked) {
    if (selected.length >= 8) break;
    const block = `【${item.document.kind === 'template' ? '模板范文' : item.document.kind === 'external' ? '外部资料' : '项目资料'}：${item.document.name}】\n${item.chunk}`;
    if (length && length + block.length > maxLength) continue;
    selected.push(block);
    length += block.length;
  }
  const manifest = documents.length
    ? `【参考资料清单】\n${documents.map((document, index) => `${index + 1}. ${document.name}（${document.kind}，已提取 ${document.content.length} 字符）`).join('\n')}`
    : '【参考资料清单】未选择或未成功解析任何参考文件';
  const excerpts = selected.join('\n\n') || '未找到与本节直接相关的可读资料，请仅基于已知项目背景作稳健表述。';
  return `${manifest}\n\n【本节实际传入的资料摘录】\n${excerpts}`;
}

export function buildLongFormSectionPrompt(params: {
  template: WritingTemplate;
  section: LongFormSectionPlan;
  sectionIndex: number;
  sectionCount: number;
  instruction: string;
  projectContext: string;
  stageMemory: string;
  references: string;
  templateContext: QuickDraftTemplateContext;
}): string {
  const { template, section, sectionIndex, sectionCount, instruction, projectContext, stageMemory, references, templateContext } = params;
  const outline = (template.nodes || []).map((node, index) => `${index + 1}. ${node.title}`).join('\n');
  return `[长篇文档分章起草任务]
你正在撰写《${template.name}》第 ${sectionIndex + 1}/${sectionCount} 节：${section.title}。

【用户要求】
${instruction}

【当前项目】
${projectContext}

【全文结构】
${outline}

【本节要求】
${section.guidance || '围绕本节标题形成完整、专业、可编辑的正文。'}
本节正文目标篇幅：${section.targetMin}-${section.targetMax} 个中文字符左右。必须充分展开，不能用提纲、摘要或几段泛泛表述代替正文。

【阶段记忆】
${stageMemory}

【与本节相关的资料摘录】
${references}

【模板约束】
${limitText(templateContext.requirements, 6000)}
${limitText(templateContext.examples, 5000)}

写作规则：
1. 只输出本节正文，不重复输出章节标题，不输出分析过程、写作建议、字数说明、致歉或代码块。
2. 内容须紧扣当前项目及资料；模板范文仅用于结构、术语密度和表达方式，不得照搬其他项目事实。
3. 资料不足时仍要写成连贯正文，可作有依据的一般性分析；不得虚构已完成的试验、精确数据、型号、日期或结论。
4. 用户允许先补数据时，只能将必要数据明确写成“示例数据（待替换）”或“待试验补充”，不得伪装成真实结果。
5. 与其他章节保持边界，避免大段重复；可使用本节必要的二级、三级标题。`;
}

export function buildSectionExpansionPrompt(section: LongFormSectionPlan, draft: string): string {
  return `[扩写校验]
下面是“${section.title}”的初稿，目前只有约 ${countDraftCharacters(draft)} 个字符，明显低于 ${section.targetMin} 个字符的目标。
请在不删除原有有效信息、不虚构事实的前提下，补充应用场景、技术机理、实施方法、关键环节、风险与验证方式等有实质内容的论述，将正文扩展到至少 ${section.targetMin} 个字符。
只输出扩写后的完整本节正文，不输出章节标题、解释、字数说明或代码块。

【现有正文】
${draft}`;
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

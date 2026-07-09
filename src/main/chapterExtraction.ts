import { TemplateNode, WritingTemplate, SectionAnalysis } from './types';

// 中文数字映射
const cnNumMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };

export function normalizeTechnicalValueText(value: string): string {
  return String(value || '')
    .replace(/[，]/g, ',')
    .replace(/[．。]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[－–—]/g, '-')
    .replace(/[～]/g, '~')
    .replace(/\s+/g, '');
}

export function stripDocumentHeadingPrefix(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇][、.．：:\s]*/, '')
    .replace(/^[一二三四五六七八九十百千万零〇两]+[、.．）)]\s*/, '')
    .replace(/^\d+(?:[.．-]\d+)*[、.．）)]?\s*/, '')
    .replace(/^[（(][一二三四五六七八九十百千万零〇两\d]+[）)]\s*/, '');
}

export function isLikelyTechnicalValueLine(value: string): boolean {
  const original = normalizeTechnicalValueText(value);
  const stripped = normalizeTechnicalValueText(stripDocumentHeadingPrefix(value));
  const raw = original || stripped;
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const hasCjk = /[一-龥]/.test(lower);
  const unit = '(?:km/h|m/s|kn|mn|mpa|kpa|pa|kg|mm|cm|km|kv|ma|hz|min|ms|rpm|kw|db|n|g|t|m|v|a|s|h|w|%|deg|rad|°|℃|nm|Ω)';
  const number = '[+-]?\\d+(?:\\.\\d+)?';
  const headingLikeEnding = /(?:系统|方案|设计|架构|功能|模块|流程|方法|算法|模型|平台|装置|应用|试验|测试|验证|分析|结果|原理|结构|小结|概述|现状|总结|展望)$/;
  if (hasCjk && headingLikeEnding.test(raw)) return false;

  const valueWithUnit = new RegExp(`^${number}${unit}(?:[~\\-至到,，;；、/]?${number}${unit}?)*`, 'i');
  if ((valueWithUnit.test(raw) || valueWithUnit.test(stripped)) && !headingLikeEnding.test(raw)) return true;

  const pureValueList = new RegExp(`^(?:${number}|${number}${unit})(?:[~\\-至到,，;；、/]?(?:${number}|${number}${unit}))*$`, 'i');
  if (!hasCjk && (pureValueList.test(raw) || pureValueList.test(stripped))) return true;

  const strippedKnown = lower
    .replace(new RegExp(unit, 'gi'), '')
    .replace(/\d+(?:\.\d+)?/g, '')
    .replace(/[+\-~～至到,，;；、:：\/\\()[\]{}<>≤≥=×x*%°℃′'″"·]/g, '');
  if (!hasCjk && strippedKnown.length === 0 && /\d/.test(lower)) return true;
  if (!hasCjk && new RegExp(unit, 'i').test(lower) && /^[\d.+\-~～,，;；、:：\/\\()[\]{}<>≤≥=×x*%°℃′'″"·a-zωΩ]+$/i.test(lower)) return true;
  return false;
}

export function isLikelyTableOfContentsLine(value: string): boolean {
  const line = String(value || '').trim();
  if (!line) return false;
  if (/\.{3,}\s*\d+\s*$/.test(line)) return true;
  if (/[·•…]{3,}\s*\d+\s*$/.test(line)) return true;
  return /\s{2,}\d+\s*$/.test(line) && /^([一二三四五六七八九十百千万零〇两]+[、.．）)]|第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇]|\d+(?:[.．-]\d+)+)/.test(line);
}

export function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (isLikelyTableOfContentsLine(trimmed)) return false;
  if (isLikelyTechnicalValueLine(trimmed)) return false;
  return /^([一二三四五六七八九十百千万零〇两]+[、.．）)]|第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇]|\d+(?:[.．-]\d+)*[、.．）)]?|[（(][一二三四五六七八九十百千万零〇两\d]+[）)])\s*\S/.test(trimmed);
}

export function getHeadingLevel(line: string): number {
  const trimmed = line.trim();
  if (/^第[一二三四五六七八九十百千万零〇两\d]+[章篇部分]/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十百千万零〇两]+[、.．）)]/.test(trimmed)) return 1;
  const decimal = trimmed.match(/^\d+(?:[.．-]\d+)+/);
  if (decimal) return Math.min(decimal[0].split(/[.．-]/).length, 4);
  if (/^\d+[、.．）)]/.test(trimmed)) return 2;
  if (/^[（(][一二三四五六七八九十百千万零〇两\d]+[）)]/.test(trimmed)) return 3;
  return 2;
}

export function stripHeadingPrefix(value: string): string {
  return stripDocumentHeadingPrefix(value);
}

export function escapeRegExp(value: string): string {
  return String(value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function startsWithHeadingPattern(line: string): boolean {
  return isHeadingLine(String(line || ''));
}

export function normalizeHeadingForMatch(value: string): string {
  return stripHeadingPrefix(value)
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>]/g, '')
    .toLowerCase();
}

export function extractSections(content: string): { title: string; content: string; startPos: number; level: number }[] {
  const lines = content.split('\n');
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index, level: getHeadingLevel(line) }))
    .filter(item => isHeadingLine(item.line));

  return headings.map((heading, headingIndex) => {
    const nextSameOrHigher = headings
      .slice(headingIndex + 1)
      .find(item => item.level <= heading.level);
    const end = nextSameOrHigher ? nextSameOrHigher.index : lines.length;
    return {
      title: heading.line,
      content: lines.slice(heading.index + 1, end).join('\n').trim(),
      startPos: heading.index,
      level: heading.level,
    };
  });
}

export function matchHeading(extracted: string, templateTitle: string): boolean {
  const a = normalizeHeadingForMatch(extracted);
  const b = normalizeHeadingForMatch(templateTitle);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || a === b;
}

export function normalizeContentForSectionMatch(value: string): string {
  return String(value || '')
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>""\"' ''.．]/g, '')
    .toLowerCase();
}

export function countContentChars(value: string): number {
  return String(value || '').replace(/\s/g, '').length;
}

export function parseWordLengthRequirement(text = ''): { minComplete: number; source: string } | null {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return null;

  const rangeMatch = normalized.match(/(\d{1,5})[~\-—－至到](\d{1,5})字/);
  if (rangeMatch) {
    const low = Math.min(Number(rangeMatch[1]), Number(rangeMatch[2]));
    if (low > 0) return { minComplete: Math.max(1, Math.floor(low * 0.85)), source: rangeMatch[0] };
  }

  const minMatch = normalized.match(/(?:不少于|不低于|至少|大于|超过)(\d{1,5})字/);
  if (minMatch) {
    const min = Number(minMatch[1]);
    if (min > 0) return { minComplete: Math.max(1, Math.floor(min * 0.9)), source: minMatch[0] };
  }

  const aroundMatch = normalized.match(/(?:约|大约|左右)?(\d{1,5})字(?:左右|上下)?/);
  if (aroundMatch && !/(不超过|不多于|以内|以下|之内)/.test(normalized.slice(Math.max(0, aroundMatch.index || 0) - 8, (aroundMatch.index || 0) + aroundMatch[0].length + 8))) {
    const target = Number(aroundMatch[1]);
    if (target > 0) return { minComplete: Math.max(1, Math.floor(target * 0.75)), source: aroundMatch[0] };
  }

  const maxMatch = normalized.match(/(?:不超过|不多于|以内|以下|之内)(\d{1,5})字/);
  if (maxMatch) return { minComplete: 1, source: maxMatch[0] };

  return null;
}

export function getSectionLengthRequirement(node: TemplateNode, template?: WritingTemplate): { minComplete: number; minPartial: number; source: string } {
  if (template?.templateType === 'example') {
    return { minComplete: 1, minPartial: 1, source: '范文模板仅作写作方向参考' };
  }
  const textSources = [node.requirementText, node.description, template?.requirementText].filter(Boolean) as string[];
  for (const text of textSources) {
    const parsed = parseWordLengthRequirement(text);
    if (parsed) return { minComplete: parsed.minComplete, minPartial: Math.max(1, Math.floor(parsed.minComplete * 0.35)), source: '模板要求：' + parsed.source };
  }

  const exampleCount = countContentChars(node.exampleText || '');
  if (exampleCount > 0) {
    const minComplete = exampleCount <= 20 ? Math.max(1, Math.floor(exampleCount * 0.6)) : Math.max(10, Math.floor(exampleCount * 0.65));
    return { minComplete, minPartial: Math.max(1, Math.floor(minComplete * 0.35)), source: '范文参考约 ' + exampleCount + ' 字' };
  }

  const title = node.title || '';
  if (/期限|时间|日期|经费|限额|关键词|联系人|电话|邮箱|编号|名称|单位|金额/.test(title)) {
    return { minComplete: 1, minPartial: 1, source: '短字段章节' };
  }

  return { minComplete: 30, minPartial: 1, source: '默认短章节阈值' };
}

export function getSectionStatusByLength(wordCount: number, requirement: { minComplete: number; minPartial: number }): SectionAnalysis['status'] {
  if (wordCount <= 0) return 'missing';
  if (wordCount >= requirement.minComplete) return 'completed';
  if (wordCount >= requirement.minPartial) return 'partial';
  return 'missing';
}

export function collectReviewEvidenceTerms(node: TemplateNode): string[] {
  const source = [node.title, node.requirementText, node.description]
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeContentForSectionMatch(source);
  const terms = new Set<string>();

  const preferredTerms = [
    '技术需求', '技术现状', '研究工作', '研究内容', '项目需求', '对应性', '应用场景', '典型场景',
    '移相器', '潮流控制', '运行策略', '工程经济性', '考核指标', '关键技术', '实施期限',
    '支持经费', '预期成果', '国内外', '创新', '示范应用', '电网', '新能源', '轻量化', '直驱浮空风力发电',
  ];
  preferredTerms.forEach(term => {
    const normalizedTerm = normalizeContentForSectionMatch(term);
    if (normalizedTerm && normalized.includes(normalizedTerm)) terms.add(normalizedTerm);
  });

  for (let size = 6; size >= 2; size--) {
    for (let index = 0; index <= normalized.length - size; index++) {
      const term = normalized.slice(index, index + size);
      if (/^\d+$/.test(term)) continue;
      if (/^(分析|研究|项目|内容|技术|需求|工作|说明|章节)$/.test(term)) continue;
      terms.add(term);
      if (terms.size >= 18) return [...terms];
    }
  }
  return [...terms];
}

export function findEvidenceInContent(node: TemplateNode, normalizedContent: string) {
  const normalizedTitle = normalizeHeadingForMatch(node.title);
  if (normalizedTitle && normalizedContent.includes(normalizedTitle)) {
    return { matched: true, confidence: 1, terms: [normalizedTitle] };
  }

  const terms = collectReviewEvidenceTerms(node);
  const hitTerms = terms.filter(term => term.length >= 2 && normalizedContent.includes(term));
  const strongHits = hitTerms.filter(term => term.length >= 4);
  const confidence = terms.length ? hitTerms.length / Math.min(terms.length, 12) : 0;

  return {
    matched: strongHits.length >= 2 || hitTerms.length >= 4 || confidence >= 0.35,
    confidence,
    terms: hitTerms.slice(0, 6),
  };
}

export function findLooseSectionContent(content: string, node: TemplateNode): string {
  const lines = content.split('\n');
  const strippedTemplateTitle = stripHeadingPrefix(node.title).trim();
  const normalizedTemplateTitle = normalizeHeadingForMatch(node.title);
  if (!normalizedTemplateTitle) return '';

  const startIndex = lines.findIndex(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const preview = trimmed.slice(0, 180);
    return matchHeading(preview, node.title)
      || normalizeContentForSectionMatch(preview).startsWith(normalizedTemplateTitle);
  });
  if (startIndex < 0) return '';

  const startLevel = startsWithHeadingPattern(lines[startIndex]) ? getHeadingLevel(lines[startIndex]) : node.level;
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (startsWithHeadingPattern(lines[index]) && getHeadingLevel(lines[index]) <= startLevel) {
      endIndex = index;
      break;
    }
  }

  const firstLine = lines[startIndex].trim();
  const firstLineWithoutPrefix = stripHeadingPrefix(firstLine);
  const startTitlePattern = strippedTemplateTitle
    ? new RegExp('^' + escapeRegExp(strippedTemplateTitle) + '[：:\\s　]*')
    : null;
  const sameLineContent = startTitlePattern
    ? firstLineWithoutPrefix.replace(startTitlePattern, '')
    : firstLineWithoutPrefix;
  return [sameLineContent, ...lines.slice(startIndex + 1, endIndex)].join('\n').trim();
}

export function findSectionForTemplateNode(
  node: TemplateNode,
  extracted: { title: string; content: string; startPos: number; level: number }[],
  normalizedContent: string,
  rawContent = '',
): { title: string; content: string; startPos: number; level: number; matchedBy: 'heading' | 'content' | 'evidence'; evidenceTerms?: string[]; confidence?: number } | null {
  const headingMatch = extracted.find(section => matchHeading(section.title, node.title));
  if (headingMatch) return { ...headingMatch, matchedBy: 'heading', confidence: 1 };

  const looseContent = rawContent ? findLooseSectionContent(rawContent, node) : '';
  if (looseContent) {
    return {
      title: node.title,
      content: looseContent,
      startPos: -1,
      level: node.level,
      matchedBy: 'content',
      confidence: 0.9,
    };
  }

  const evidence = findEvidenceInContent(node, normalizedContent);
  if (evidence.matched) {
    return {
      title: node.title,
      content: '',
      startPos: -1,
      level: node.level,
      matchedBy: evidence.terms.length === 1 && evidence.confidence === 1 ? 'content' : 'evidence',
      evidenceTerms: evidence.terms,
      confidence: evidence.confidence,
    };
  }

  return null;
}

export function isOperationalTemplateNode(node: TemplateNode, template?: WritingTemplate): boolean {
  const title = String(node.title || '').trim();
  if (!title || isLikelyTechnicalValueLine(title)) return false;
  if (template?.templateType === 'example') return (node.level || 1) <= 1;
  return true;
}

export function flattenNodes(nodes: TemplateNode[], template?: WritingTemplate): TemplateNode[] {
  const result: TemplateNode[] = [];
  for (const node of nodes || []) {
    if (!isOperationalTemplateNode(node, template)) continue;
    result.push(node);
    if (template?.templateType !== 'example' && node.children && node.children.length > 0) {
      result.push(...flattenNodes(node.children, template));
    }
  }
  return result;
}

export function analyzeActualDocumentStructure(content: string): SectionAnalysis[] {
  const extracted = extractSections(content);
  if (!extracted.length) return [];

  const topLevel = extracted.filter(section => section.level === 1);
  const minimumLevel = Math.min(...extracted.map(section => section.level));
  const candidates = topLevel.length
    ? topLevel
    : extracted.filter(section => section.level === minimumLevel);
  const bestByTitle = new Map<string, typeof candidates[number]>();

  candidates.forEach(section => {
    const key = normalizeHeadingForMatch(section.title);
    if (!key) return;
    const existing = bestByTitle.get(key);
    if (!existing || countContentChars(section.content) > countContentChars(existing.content)) {
      bestByTitle.set(key, section);
    }
  });

  return [...bestByTitle.values()]
    .sort((a, b) => a.startPos - b.startPos)
    .map((section, index) => {
      const wordCount = countContentChars(section.content);
      const status: SectionAnalysis['status'] = wordCount >= 80
        ? 'completed'
        : wordCount > 0 ? 'partial' : 'missing';
      return {
        nodeId: `document-heading:${index}:${section.startPos}`,
        title: section.title,
        status,
        wordCount,
        aiComment: wordCount === 0 ? '已识别到章节标题，但标题下暂未提取到正文。' : undefined,
      };
    });
}

export function analyzeBasic(content: string, template: WritingTemplate): SectionAnalysis[] {
  const extracted = extractSections(content);
  const normalizedContent = normalizeContentForSectionMatch(content);
  const allNodes = flattenNodes(template.nodes, template);
  const isExampleTemplate = template.templateType === 'example';
  const results: SectionAnalysis[] = [];

  for (const node of allNodes) {
    const matched = findSectionForTemplateNode(node, extracted, normalizedContent, content);
    if (matched) {
      let wordCount = countContentChars(matched.content);
      const lengthRequirement = getSectionLengthRequirement(node, template);
      let status: SectionAnalysis['status'] = getSectionStatusByLength(wordCount, lengthRequirement);
      let aiComment: string | undefined;

      if (matched.matchedBy !== 'heading' && wordCount === 0) {
        wordCount = Math.max(1, Math.round((matched.confidence || 0.35) * 80));
        status = getSectionStatusByLength(wordCount, lengthRequirement);
        aiComment = matched.matchedBy === 'evidence'
          ? '依据关键词识别到对应内容：' + ((matched.evidenceTerms || []).join('、') || '相关内容')
          : '已在正文中识别到对应章节标题或内容。';
      } else if (matched.matchedBy !== 'heading') {
        aiComment = '已通过正文内容匹配到该模板章节。';
      }
      if (status === 'partial') {
        aiComment = aiComment || '当前约 ' + wordCount + ' 字，参考标准：' + lengthRequirement.source + '，建议补至约 ' + lengthRequirement.minComplete + ' 字。';
      } else if (status === 'completed' && lengthRequirement.source !== '默认短章节阈值') {
        aiComment = aiComment || '已满足字数判断：' + lengthRequirement.source + '。';
      }

      results.push({
        nodeId: node.id,
        title: node.title,
        status,
        wordCount,
        aiComment,
      });
    } else {
      results.push({
        nodeId: node.id,
        title: node.title,
        status: isExampleTemplate ? 'partial' : 'missing',
        wordCount: 0,
        aiComment: isExampleTemplate ? '范文模板节点仅代表写作方向，未按固定标题判定缺失。' : undefined,
      });
    }
  }
  return results;
}

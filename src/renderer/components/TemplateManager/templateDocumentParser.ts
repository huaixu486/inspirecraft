import type { TemplateNode } from '../../../shared/types';

export interface HeadingMatch {
  title: string;
  level: number;
  token: string;
  kind: 'chapter' | 'chinese' | 'parenChinese' | 'number' | 'decimal' | 'parenNumber';
  numericDepth?: number;
  recoveredFromStructure?: boolean;
}

export const normalizeImportedText = (value: string): string =>
  value
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const stripRtfText = (value: string): string =>
  normalizeImportedText(
    value
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+\d* ?/g, '')
      .replace(/[{}]/g, ' '),
  );

export function isLikelyGarbledText(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  if (!compact) return false;
  const replacementCount = compact.match(/�/g)?.length || 0;
  const readableCount = compact.match(/[\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/]/g)?.length || 0;
  return replacementCount / compact.length > 0.03 || readableCount / compact.length < 0.55;
}

function isLikelyReadableHeading(value: string): boolean {
  const titlePart = value.replace(/^([一二三四五六七八九十十一十二]+[、.．）\)]|第[一-龥]{1,4}[章节部篇]|[\d]+([.．]\d+)*[、.．）\)]?|[\(（][\d一-龥]+[）\)])\s*/, '');
  const compact = titlePart.replace(/\s/g, '');
  if (compact.length < 2) return false;
  return !isLikelyGarbledText(compact);
}

export function stripTemplateHeadingPrefix(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^第[一二三四五六七八九十百千万\d]+[章节部篇][\s　]*/, '')
    .replace(/^[一二三四五六七八九十百千万]+[、.．）\)][\s　]*/, '')
    .replace(/^[\(（][一二三四五六七八九十百千万\d]+[）\)][\s　]*/, '')
    .replace(/^\d+(?:[.．]\d+)*[、.．）\)]?[\s　]*/, '');
}

export function isLikelyBodyEnumerationTitle(value: string, kind?: HeadingMatch['kind']): boolean {
  const text = stripTemplateHeadingPrefix(value).replace(/\s+/g, '');
  if (!text || text.length < 4) return false;
  if (kind === 'chapter' || kind === 'chinese' || kind === 'parenChinese') return false;

  const bodyStart = /^(?:\u80fd\u591f|\u80fd|\u53ef\u4ee5|\u53ef|\u5e94|\u9700|\u9700\u8981|\u5c06|\u5f53|\u5bf9|\u6839\u636e|\u91c7\u7528|\u901a\u8fc7|\u57fa\u4e8e|\u5229\u7528|\u5728|\u4e3a|\u7531|\u4f9d\u6b21|\u5206\u522b|\u540c\u65f6)/;
  const actionPhrase = /(?:\u80fd\u591f|\u53ef\u4ee5|\u53ef\u5b9e\u73b0|\u5b9e\u73b0|\u652f\u6301|\u91c7\u7528|\u6839\u636e|\u901a\u8fc7|\u7ecf\u8fc7|\u5bf9\u63a5|\u8bbe\u8ba1\u5236\u4f5c|\u5236\u4f5c|\u9a71\u52a8|\u63a5\u5165|\u8f93\u51fa|\u8f93\u5165|\u5c55\u793a|\u5224\u65ad|\u8865\u507f|\u63a7\u5236|\u7ba1\u7406|\u5904\u7406|\u901a\u4fe1|\u4f20\u8f93|\u68c0\u6d4b|\u76d1\u6d4b|\u5206\u6790)/;
  const headingEnding = /(?:\u6982\u8ff0|\u6982\u51b5|\u7b80\u4ecb|\u7cfb\u7edf|\u65b9\u6848|\u8bbe\u8ba1|\u67b6\u6784|\u529f\u80fd|\u6a21\u5757|\u6d41\u7a0b|\u65b9\u6cd5|\u7b97\u6cd5|\u6a21\u578b|\u5e73\u53f0|\u88c5\u7f6e|\u5e94\u7528|\u8bd5\u9a8c|\u6d4b\u8bd5|\u9a8c\u8bc1|\u603b\u7ed3|\u5c55\u671b|\u95ee\u9898|\u63aa\u65bd|\u7ed3\u8bba|\u80cc\u666f|\u9700\u6c42|\u76ee\u6807|\u7ec4\u6210|\u539f\u7406|\u5206\u6790|\u7ed3\u679c|\u60c5\u51b5|\u5185\u5bb9|\u8981\u70b9|\u521b\u65b0|\u7a81\u7834|\u6210\u6548)$/;
  const taskEnumerationStart = /^(?:\u68b3\u7406|\u8c03\u7814|\u7814\u7a76|\u5206\u6790|\u5b8c\u6210|\u5f00\u5c55|\u63d0\u51fa|\u63a2\u7d22|\u63a8\u8fdb|\u5efa\u7acb|\u5f62\u6210|\u603b\u7ed3|\u660e\u786e|\u89e3\u51b3|\u4f18\u5316|\u6539\u8fdb|\u9a8c\u8bc1|\u6574\u7406|\u6536\u96c6|\u5bf9\u6bd4|\u9009\u53d6|\u6784\u5efa|\u8bbe\u8ba1|\u5f00\u53d1)/;

  if (/[，,；;。]/.test(text) && actionPhrase.test(text)) return true;
  if (bodyStart.test(text) && actionPhrase.test(text)) return true;
  if (/^(?:\u80fd\u591f|\u80fd|\u53ef\u4ee5|\u53ef).{0,8}\u5b9e\u73b0/.test(text)) return true;
  if (/^(?:\u6839\u636e|\u91c7\u7528|\u901a\u8fc7|\u57fa\u4e8e|\u5229\u7528).{2,}/.test(text) && actionPhrase.test(text)) return true;
  if (/^\u5bf9\u63a5.{2,}(?:\u4f20\u611f\u5668|\u6570\u636e|\u63a5\u53e3|\u7cfb\u7edf)/.test(text)) return true;
  if (/^\u8bbe\u8ba1\u5236\u4f5c/.test(text)) return true;
  if ((kind === 'number' || kind === 'parenNumber') && taskEnumerationStart.test(text) && text.length >= 8 && !headingEnding.test(text)) return true;
  if (text.length >= 16 && actionPhrase.test(text) && !headingEnding.test(text)) return true;
  return false;
}

function normalizeMeasurementText(value: string): string {
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

export function isLikelyMeasurementOrTableValue(value: string): boolean {
  const original = normalizeMeasurementText(value);
  const stripped = normalizeMeasurementText(stripTemplateHeadingPrefix(value));
  const raw = original || stripped;
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const hasCjk = /[\u4e00-\u9fa5]/.test(lower);
  const unit = '(?:km/h|m/s|kn|mn|mpa|kpa|pa|kg|mm|cm|km|kv|ma|hz|min|ms|rpm|kw|db|n|g|t|m|v|a|s|h|w|%|deg|rad|°|℃)';
  const number = '[+-]?\\d+(?:\\.\\d+)?';
  const headingLikeEnding = /(?:\u7cfb\u7edf|\u65b9\u6848|\u8bbe\u8ba1|\u67b6\u6784|\u529f\u80fd|\u6a21\u5757|\u6d41\u7a0b|\u65b9\u6cd5|\u7b97\u6cd5|\u6a21\u578b|\u5e73\u53f0|\u88c5\u7f6e|\u5e94\u7528|\u8bd5\u9a8c|\u6d4b\u8bd5|\u9a8c\u8bc1|\u5206\u6790|\u7ed3\u679c|\u539f\u7406|\u7ed3\u6784)$/;
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

  const hasUnit = new RegExp(unit, 'i').test(lower);
  if (!hasCjk && hasUnit && /^[\d.+\-~～,，;；、:：\/\\()[\]{}<>≤≥=×x*%°℃′'″"·a-z]+$/i.test(lower)) return true;
  return false;
}

export function isLikelyNumericDataText(value: string): boolean {
  const raw = String(value || '').replace(/\s+/g, '');
  const text = stripTemplateHeadingPrefix(value).replace(/\s+/g, '');
  const source = text || raw;
  if (!source) return false;
  if (isLikelyMeasurementOrTableValue(source) || isLikelyMeasurementOrTableValue(raw)) return true;
  const hasWord = /[\u4e00-\u9fa5A-Za-z]/.test(source);
  const measurementUnit = /(?:m\/s|km\/h|mm|cm|kg|kv|hz|mpa|pa|℃|°|%|‰)/i;
  if (/^[\d.．+\-~～°℃%'"/:：,，;；\[\]【】（）()]+$/.test(source)) return true;
  if (/^(?:m\/s|km\/h|mm|cm|m|kg|kv|v|a|hz|n|mpa|pa|s|min|h|°|℃|%|‰)/i.test(source)) return true;
  if (/^\d+(?:\.\d+)?(?:m\/s|km\/h|mm|cm|m|kg|kv|v|a|hz|n|mpa|pa|s|min|h|°|℃|%|‰)/i.test(source)) return true;
  if (!hasWord && measurementUnit.test(raw)) return true;
  if (!hasWord && /(?:\d+[°%℃])|(?:[°%℃]\d+)/.test(raw)) return true;
  return false;
}

function isLikelyNumericDataHeading(token: string, titleText: string, kind: HeadingMatch['kind']): boolean {
  if (kind === 'chapter' || kind === 'chinese' || kind === 'parenChinese') return false;
  const title = String(titleText || '').trim();
  const compactTitle = title.replace(/\s+/g, '');
  const normalizedToken = String(token || '').replace(/[()（）]/g, '').replace(/[、.．）)]$/, '');
  const tokenParts = normalizedToken.split(/[.．]/).filter(Boolean);

  if (kind === 'decimal') {
    if (tokenParts.some(part => part.length > 2)) return true;
    if (tokenParts.length <= 2 && !/^[\u4e00-\u9fa5A-Za-z]/.test(compactTitle)) return true;
  }

  if (!/[\u4e00-\u9fa5A-Za-z]/.test(compactTitle)) return true;
  return isLikelyNumericDataText(`${token} ${titleText}`);
}

function isLikelyTableOfContentsLine(value: string): boolean {
  const line = String(value || '').trim();
  if (!line) return false;
  if (/\.{3,}\s*\d+\s*$/.test(line)) return true;
  if (/[·•…]{3,}\s*\d+\s*$/.test(line)) return true;
  if (/\s{2,}\d+\s*$/.test(line) && /^(?:第[\u4e00-\u9fa5\d]+[章节部篇]|[一二三四五六七八九十百千万]+[、.．）)]|\d+(?:[.．]\d+)+)/.test(line)) return true;
  return false;
}

export function matchHeadingLine(line: string): HeadingMatch | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (isLikelyTableOfContentsLine(trimmed)) return null;
  if (!isLikelyReadableHeading(trimmed)) return null;

  const patterns: Array<{
    regex: RegExp;
    kind: HeadingMatch['kind'];
    level: (token: string) => number;
    numericDepth?: (token: string) => number;
  }> = [
    { regex: /^(第[一二三四五六七八九十百千万\d]+[章节部篇])[\s　]*(\S.*)$/, kind: 'chapter', level: () => 1 },
    { regex: /^([一二三四五六七八九十百千万]+[、.．）\)])[\s　]*(\S.*)$/, kind: 'chinese', level: () => 1 },
    { regex: /^([一二三四五六七八九十百千万]+)[\s　]+(?!是|为|要|个|种|类|方面)(\S.*)$/, kind: 'chinese', level: () => 1 },
    { regex: /^([\(（][一二三四五六七八九十百千万]+[）\)])[\s　]*(\S.*)$/, kind: 'parenChinese', level: () => 2 },
    {
      regex: /^(\d+(?:[.．]\d+){1,3})[、.．）\)]?[\s　]*(\S.*)$/,
      kind: 'decimal',
      level: token => Math.min(token.split(/[.．]/).length, 4),
      numericDepth: token => token.split(/[.．]/).length,
    },
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern.regex);
    if (!match) continue;
    const titleText = match[2]?.trim();
    if (!titleText || isLikelyGarbledText(titleText)) continue;
    const token = match[1].trim();
    const compactTechnicalTerm = titleText.replace(/\s+/g, '');
    const knownTechnicalAcronym = /^(?:Mesh|LoRa|CAN|EtherCAT|MOD|TCP|IP|HTTP|MQTT|ZMP|CNN|YOLO|GPS|GNSS|GIS|BIM|AI)$/i;
    const technicalTermWithSuffix = /^[A-Za-z][A-Za-z0-9+#.-]{1,24}(?:技术|系统|协议|网络|模块|算法|平台|架构|设计)$/i;
    const numberedTechnicalTerm = pattern.kind === 'decimal'
      && (knownTechnicalAcronym.test(compactTechnicalTerm) || technicalTermWithSuffix.test(compactTechnicalTerm));
    if (!numberedTechnicalTerm && (isLikelyMeasurementOrTableValue(titleText) || isLikelyMeasurementOrTableValue(`${token} ${titleText}`))) continue;
    if (!numberedTechnicalTerm && isLikelyNumericDataHeading(token, titleText, pattern.kind)) continue;
    if (isLikelyBodyEnumerationTitle(`${token} ${titleText}`, pattern.kind)) continue;
    return {
      title: `${token} ${titleText}`.trim(),
      level: pattern.level(token),
      token,
      kind: pattern.kind,
      numericDepth: pattern.numericDepth?.(token),
    };
  }

  return null;
}

const chineseOutlineOrderMap: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseChineseOutlineOrder(value: string): number | undefined {
  const text = String(value || '').replace(/\s/g, '');
  if (!text) return undefined;
  if (chineseOutlineOrderMap[text] !== undefined) return chineseOutlineOrderMap[text];
  const digit = Number(text);
  if (Number.isFinite(digit) && digit > 0) return digit;
  if (!/^[一二三四五六七八九十百千万]+$/.test(text)) return undefined;

  let total = 0;
  let section = 0;
  const unitMap: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  Array.from(text).forEach(char => {
    const digitValue = chineseOutlineOrderMap[char];
    const unitValue = unitMap[char];
    if (unitValue) {
      section = (section || 1) * unitValue;
      total += section;
      section = 0;
    } else if (digitValue !== undefined) {
      section = digitValue;
    }
  });
  return total + section || undefined;
}

export function getExplicitTopLevelOrder(title: string): number | undefined {
  const text = String(title || '').trim();
  const chapterMatch = text.match(/^第([一二三四五六七八九十百千万]+|\d+)[章节部篇]/);
  const chineseMatch = text.match(/^([一二三四五六七八九十百千万]+|\d+)(?:[、.．）\)]|\s)/);
  const value = chapterMatch?.[1] || chineseMatch?.[1];
  return value ? parseChineseOutlineOrder(value) : undefined;
}

export function normalizeTopLevelOutlineOrder(nodes: TemplateNode[]): TemplateNode[] {
  const orderedCount = nodes.filter(node => node.level === 1 && getExplicitTopLevelOrder(node.title) !== undefined).length;
  if (orderedCount < 2) return nodes;
  return [...nodes].sort((a, b) => {
    const aOrder = a.level === 1 ? getExplicitTopLevelOrder(a.title) : undefined;
    const bOrder = b.level === 1 ? getExplicitTopLevelOrder(b.title) : undefined;
    if (aOrder === undefined || bOrder === undefined) return 0;
    return aOrder - bOrder;
  });
}

export function getDecimalHeadingParts(match?: HeadingMatch): number[] {
  if (!match || match.kind !== 'decimal') return [];
  return match.token
    .split(/[.．]/)
    .map(part => Number(part))
    .filter(part => Number.isFinite(part) && part > 0);
}

export function getDecimalRootOrder(match?: HeadingMatch): number | undefined {
  const first = getDecimalHeadingParts(match)[0];
  return Number.isFinite(first) && first > 0 ? first : undefined;
}

function getNodeOrderParts(node: TemplateNode): number[] | undefined {
  if ((node.level || 1) <= 1) {
    const order = getExplicitTopLevelOrder(node.title);
    return order === undefined ? undefined : [order];
  }
  const decimalMatch = String(node.title || '').trim().match(/^(\d+(?:[.．]\d+){1,3})/);
  if (!decimalMatch) return undefined;
  const parts = decimalMatch[1].split(/[.．]/).map(part => Number(part));
  return parts.every(part => Number.isFinite(part)) ? parts : undefined;
}

function compareNumberParts(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function sortTemplateNodesByDetectedOrder(nodes: TemplateNode[]): TemplateNode[] {
  return nodes
    .map((node, originalIndex) => ({
      node: {
        ...node,
        children: node.children?.length ? sortTemplateNodesByDetectedOrder(node.children) : undefined,
      },
      originalIndex,
      orderParts: getNodeOrderParts(node),
    }))
    .sort((a, b) => {
      if (!a.orderParts || !b.orderParts) return a.originalIndex - b.originalIndex;
      const diff = compareNumberParts(a.orderParts, b.orderParts);
      return diff || a.originalIndex - b.originalIndex;
    })
    .map(item => item.node);
}

export function inferHeadingLevel(heading: HeadingMatch, previous: HeadingMatch[]): number {
  const recent = previous.slice(-8);
  const hasChineseOutline = recent.some(item => item.kind === 'chinese' || item.kind === 'chapter' || item.kind === 'parenChinese');
  const hasParenChinese = recent.some(item => item.kind === 'parenChinese');

  if (heading.kind === 'chapter' || heading.kind === 'chinese') return 1;
  if (heading.kind === 'parenChinese') return hasChineseOutline ? 2 : 1;
  if (heading.kind === 'parenNumber') return hasParenChinese ? 4 : hasChineseOutline ? 3 : 2;
  if (heading.kind === 'number') return hasParenChinese ? 3 : hasChineseOutline ? 2 : 1;
  if (heading.kind === 'decimal') {
    const depth = heading.numericDepth || 1;
    if (hasParenChinese && depth === 1) return 3;
    if (hasChineseOutline && depth === 1) return 2;
    return Math.min(depth, 4);
  }
  return heading.level;
}

export interface ExtractedHeadingContent {
  title: string;
  level: number;
  description: string;
  match: HeadingMatch;
}

interface TemplateNodeTreeStrategies {
  splitGuidance: (description: string, title: string) => { requirementText: string; exampleText: string };
  isExampleHeading: (title: string) => boolean;
  isInvalidHeading: (title: string, match?: HeadingMatch) => boolean;
  dedupeNodes: (nodes: TemplateNode[]) => TemplateNode[];
}

export function buildTemplateNodeTree(
  headingContents: ExtractedHeadingContent[],
  strategies: TemplateNodeTreeStrategies,
): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  const topLevelByOrder = new Map<number, TemplateNode>();
  const rootNodeByContentIndex = new Map<number, TemplateNode>();
  const decimalStacksByRoot = new Map<number, TemplateNode[]>();
  let idCounter = 0;

  const createNode = (heading: ExtractedHeadingContent, level = heading.level): TemplateNode => {
    idCounter += 1;
    const guidance = strategies.splitGuidance(heading.description, heading.title);
    return {
      id: String(idCounter),
      title: heading.title,
      level,
      isRequired: !strategies.isExampleHeading(heading.title),
      description: guidance.requirementText || undefined,
      requirementText: guidance.requirementText || undefined,
      exampleText: guidance.exampleText || undefined,
    };
  };

  headingContents.forEach((heading, index) => {
    if (strategies.isInvalidHeading(heading.title, heading.match) || heading.level !== 1) return;
    const order = getExplicitTopLevelOrder(heading.title);
    if (order === undefined || topLevelByOrder.has(order)) return;
    const node = createNode(heading, 1);
    nodes.push(node);
    topLevelByOrder.set(order, node);
    rootNodeByContentIndex.set(index, node);
  });

  const hasExplicitTopLevelOutlines = topLevelByOrder.size > 0;

  headingContents.forEach((heading, index) => {
    if (strategies.isInvalidHeading(heading.title, heading.match)) return;

    const existingRoot = rootNodeByContentIndex.get(index);
    if (existingRoot) {
      stack.splice(0, stack.length, existingRoot);
      const order = getExplicitTopLevelOrder(existingRoot.title);
      if (order !== undefined) decimalStacksByRoot.set(order, [existingRoot]);
      return;
    }

    if (heading.level === 1) {
      const explicitOrder = getExplicitTopLevelOrder(heading.title);
      if (explicitOrder !== undefined && topLevelByOrder.has(explicitOrder)) return;
    }

    const decimalRootOrder = getDecimalRootOrder(heading.match);
    const explicitRoot = decimalRootOrder === undefined ? undefined : topLevelByOrder.get(decimalRootOrder);
    if (heading.match.kind === 'decimal' && explicitRoot) {
      const parts = getDecimalHeadingParts(heading.match);
      const level = Math.min(Math.max(parts.length, 2), 4);
      const node = createNode(heading, level);
      const rootStack = decimalStacksByRoot.get(decimalRootOrder!) || [explicitRoot];
      while (rootStack.length > 1 && rootStack[rootStack.length - 1].level >= node.level) rootStack.pop();
      const parent = rootStack[rootStack.length - 1] || explicitRoot;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
      rootStack.push(node);
      decimalStacksByRoot.set(decimalRootOrder!, rootStack);
      return;
    }

    if (heading.match.kind === 'decimal' && decimalRootOrder !== undefined && hasExplicitTopLevelOutlines) return;

    const node = createNode(heading);
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      nodes.push(node);
    }
    stack.push(node);
  });

  return strategies.dedupeNodes(normalizeTopLevelOutlineOrder(sortTemplateNodesByDetectedOrder(nodes)));
}

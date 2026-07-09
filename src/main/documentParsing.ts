import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
const JSZip = require('jszip');
import { SectionAnalysis, TemplateNode, WritingTemplate, TemplateFormatRules, TemplateStyleRule, FontRequirement, ParagraphRequirement, ReviewIssue } from './types';
import { normalizeHeadingForMatch, escapeRegExp } from './chapterExtraction';
import { appendAiLog } from './shared/aiLogging';
import { ensureDataDir } from './shared/persistence';
import { dataDir } from './shared/paths';

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function getXmlAttr(fragment: string, attrName: string): string {
  const match = fragment.match(new RegExp(`${attrName}="([^"]*)"`));
  return match?.[1] || '';
}

export function getWordVal(fragment: string, tagName: string): string {
  const match = fragment.match(new RegExp(`<w:${tagName}\\b[^>]*w:val="([^"]*)"`, 'i'));
  return match?.[1] || '';
}

export function extractReadableBinaryText(buffer: Buffer): string {
  const candidates = [buffer.toString('utf16le'), buffer.toString('utf8'), buffer.toString('latin1')]
    .map(value => normalizeExtractedText(
      value
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/\s]/g, ' ')
        .split(/\n| {2,}/)
        .map(line => line.trim())
        .filter(line => line.length >= 2)
        .join('\n')
    ))
    .filter(Boolean);
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

export async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

  const lines: string[] = [];
  for (const fileName of slideFiles) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const slideLines = Array.from(xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) as Iterable<RegExpMatchArray>)
      .map(match => normalizeExtractedText(decodeXmlText(match[1])))
      .filter(Boolean);
    if (slideLines.length > 0) lines.push(...slideLines);
  }
  return normalizeExtractedText(lines.join('\n'));
}

export async function extractXlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedStringsXml
    ? Array.from(sharedStringsXml.matchAll(/<si\b[\s\S]*?<\/si>/g) as Iterable<RegExpMatchArray>).map(match => {
        const text = Array.from(match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) as Iterable<RegExpMatchArray>)
          .map(t => decodeXmlText(t[1]))
          .join('');
        return normalizeExtractedText(text);
      })
    : [];

  const sheetFiles = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/sheet(\d+)\.xml/i)?.[1] || 0));

  const lines: string[] = [];
  for (const fileName of sheetFiles) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const sheetLines: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g) as Iterable<RegExpMatchArray>) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g) as Iterable<RegExpMatchArray>) {
        const attrs = cellMatch[1] || '';
        const cellXml = cellMatch[2] || '';
        const type = getXmlAttr(attrs, 't');
        let value = '';
        if (type === 's') {
          const index = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || -1);
          value = sharedStrings[index] || '';
        } else if (type === 'inlineStr') {
          value = Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) as Iterable<RegExpMatchArray>)
            .map(match => decodeXmlText(match[1]))
            .join('');
        } else {
          value = decodeXmlText(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
        }
        const normalized = normalizeExtractedText(value);
        if (normalized) cells.push(normalized);
      }
      if (cells.length > 0) sheetLines.push(cells.join('  '));
    }
    if (sheetLines.length > 0) lines.push(...sheetLines);
  }
  return normalizeExtractedText(lines.join('\n'));
}

export function chineseCounter(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 10) return value === 10 ? '十' : digits[value];
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const one = value % 10;
    return `${digits[ten]}十${one ? digits[one] : ''}`;
  }
  return String(value);
}

export function romanCounter(value: number): string {
  const map: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let rest = value;
  let result = '';
  for (const [num, token] of map) {
    while (rest >= num) {
      result += token;
      rest -= num;
    }
  }
  return result || String(value);
}

export function formatNumberByType(format: string, value: number): string {
  if (/chinese|japanese/i.test(format)) return chineseCounter(value);
  if (/lowerLetter/i.test(format)) return String.fromCharCode(96 + Math.max(1, Math.min(value, 26)));
  if (/upperLetter/i.test(format)) return String.fromCharCode(64 + Math.max(1, Math.min(value, 26)));
  if (/lowerRoman/i.test(format)) return romanCounter(value);
  if (/upperRoman/i.test(format)) return romanCounter(value).toUpperCase();
  return String(value);
}

export async function extractDocxTextWithNumbering(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return '';
    const numberingXml = await zip.file('word/numbering.xml')?.async('string');

    const numToAbstract = new Map<string, string>();
    const levels = new Map<string, { format: string; text: string }>();
    if (numberingXml) {
      for (const numMatch of numberingXml.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g)) {
        const block = numMatch[0];
        const numId = getXmlAttr(block.match(/<w:num\b[^>]*>/)?.[0] || '', 'w:numId');
        const abstractNumId = getWordVal(block, 'abstractNumId');
        if (numId && abstractNumId) numToAbstract.set(numId, abstractNumId);
      }

      for (const abstractMatch of numberingXml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g)) {
        const block = abstractMatch[0];
        const abstractId = getXmlAttr(block.match(/<w:abstractNum\b[^>]*>/)?.[0] || '', 'w:abstractNumId');
        if (!abstractId) continue;
        for (const levelMatch of block.matchAll(/<w:lvl\b[\s\S]*?<\/w:lvl>/g)) {
          const levelBlock = levelMatch[0];
          const ilvl = getXmlAttr(levelBlock.match(/<w:lvl\b[^>]*>/)?.[0] || '', 'w:ilvl') || '0';
          levels.set(`${abstractId}:${ilvl}`, {
            format: getWordVal(levelBlock, 'numFmt'),
            text: decodeXmlText(getWordVal(levelBlock, 'lvlText')),
          });
        }
      }
    }

    const counters = new Map<string, number[]>();
    const lines: string[] = [];
    for (const paraMatch of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const paragraph = paraMatch[0];
      const text = normalizeExtractedText(
        Array.from(paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) as Iterable<RegExpMatchArray>)
          .map(match => decodeXmlText(match[1]))
          .join('')
      );
      if (!text) continue;

      const pPr = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
      const numPr = pPr.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/)?.[0] || '';
      const numId = getWordVal(numPr, 'numId');
      const ilvl = Number(getWordVal(numPr, 'ilvl') || '0');
      const sizes = Array.from(paragraph.matchAll(/<w:sz\b[^>]*w:val="(\d+)"/g) as Iterable<RegExpMatchArray>).map(match => Number(match[1]));
      const maxSize = sizes.length ? Math.max(...sizes) : 0;
      const isBold = /<w:b\b/.test(paragraph);
      const shouldRestoreNumber = Boolean(numId) && text.length <= 90 && (maxSize >= 28 || (isBold && maxSize >= 24));

      if (!shouldRestoreNumber) {
        lines.push(text);
        continue;
      }

      const abstractId = numToAbstract.get(numId);
      const level = abstractId ? levels.get(`${abstractId}:${ilvl}`) : undefined;
      const numCounters = counters.get(numId) || [];
      numCounters[ilvl] = (numCounters[ilvl] || 0) + 1;
      numCounters.length = ilvl + 1;
      counters.set(numId, numCounters);

      let label = '';
      if (level) {
        label = level.text || `%${ilvl + 1}`;
        label = label.replace(/%(\d+)/g, (_all, indexText) => {
          const refLevel = Number(indexText) - 1;
          const refValue = numCounters[refLevel] || 1;
          const refRule = abstractId ? levels.get(`${abstractId}:${refLevel}`) : undefined;
          return formatNumberByType(refRule?.format || level.format, refValue);
        });
        if (/chinese|japanese/i.test(level.format) && !/[、.．)）]/.test(label)) {
          label = `${formatNumberByType(level.format, numCounters[ilvl])}、`;
        }
      }

      lines.push(label && !text.startsWith(label) ? `${label} ${text}` : text);
    }

    return normalizeExtractedText(lines.join('\n'));
  } catch {
    return '';
  }
}
export type ExtractedTemplateStyleKey = 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body' | 'caption' | 'tableTitle' | 'tableHeader';

export interface ExtractedTemplateStyleSample {
  key: ExtractedTemplateStyleKey;
  text: string;
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

export interface ExtractedTemplateParagraphStyle extends ExtractedTemplateStyleSample {
  index: number;
  styleId?: string;
  styleName?: string;
  isTableCell?: boolean;
}

export const styleKeyNames: Record<ExtractedTemplateStyleKey, string> = {
  heading1: '一级标题',
  heading2: '二级标题',
  heading3: '三级标题',
  heading4: '四级标题',
  body: '正文',
  caption: '图题/图例',
  tableTitle: '表题',
  tableHeader: '表头',
};

export function xmlTextFromBlock(block: string): string {
  return normalizeExtractedText(
    Array.from(block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) as Iterable<RegExpMatchArray>)
      .map(match => decodeXmlText(match[1]))
      .join('')
  );
}

export function isWordToggleEnabled(xml: string, tagName: string): boolean | undefined {
  const match = xml.match(new RegExp(`<w:${tagName}\\b[^>]*>`, 'i'));
  if (!match) return undefined;
  const value = match[0].match(/\bw:val="([^"]+)"/i)?.[1];
  return value ? !/^(0|false|off)$/i.test(value) : true;
}

export function parseStylePropsFromXml(xml: string): any {
  const fontFamily =
    xml.match(/<w:rFonts\b[^>]*(?:w:eastAsia|w:ascii|w:hAnsi)="([^"]+)"/)?.[1];
  const fontSizeRaw = xml.match(/<w:sz\b[^>]*w:val="(\d+)"/)?.[1];
  const lineRaw = xml.match(/<w:spacing\b[^>]*w:line="(\d+)"/)?.[1];
  const letterSpacingRaw = xml.match(/<w:spacing\b[^>]*w:val="(-?\d+)"/)?.[1];
  const alignmentRaw = xml.match(/<w:jc\b[^>]*w:val="([^"]+)"/)?.[1];
  const colorRaw = xml.match(/<w:color\b[^>]*w:val="([^"]+)"/)?.[1];
  const firstLineCharsRaw = xml.match(/<w:ind\b[^>]*w:firstLineChars="(\d+)"/)?.[1];
  const firstLineRaw = xml.match(/<w:ind\b[^>]*w:firstLine="(\d+)"/)?.[1];
  const beforeRaw = xml.match(/<w:spacing\b[^>]*w:before="(\d+)"/)?.[1];
  const afterRaw = xml.match(/<w:spacing\b[^>]*w:after="(\d+)"/)?.[1];
  const isBold = isWordToggleEnabled(xml, 'b');
  const isItalic = isWordToggleEnabled(xml, 'i');
  const alignmentMap: Record<string, string> = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', left: 'left' };
  return {
    fontFamily,
    fontSize: fontSizeRaw ? Number(fontSizeRaw) / 2 : undefined,
    fontWeight: isBold === undefined ? undefined : isBold ? 'bold' : 'normal',
    fontStyle: isItalic === undefined ? undefined : isItalic ? 'italic' : 'normal',
    alignment: alignmentRaw ? alignmentMap[alignmentRaw] : undefined,
    lineHeight: lineRaw ? Math.round((Number(lineRaw) / 240) * 100) / 100 : undefined,
    letterSpacing: letterSpacingRaw ? Math.round((Number(letterSpacingRaw) / 20) * 100) / 100 : undefined,
    color: colorRaw && colorRaw !== 'auto' ? `#${colorRaw}` : undefined,
    indentFirstLine: firstLineCharsRaw
      ? Number(firstLineCharsRaw) / 100
      : firstLineRaw ? Math.round((Number(firstLineRaw) / 240) * 100) / 100 : undefined,
    spaceBefore: beforeRaw ? Math.round((Number(beforeRaw) / 20) * 100) / 100 : undefined,
    spaceAfter: afterRaw ? Math.round((Number(afterRaw) / 20) * 100) / 100 : undefined,
  };
}

export function parseStyleDefinitions(stylesXml?: string): Map<string, any> {
  const styles = new Map<string, any>();
  if (!stylesXml) return styles;
  for (const match of stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
    const block = match[0];
    const start = block.match(/<w:style\b[^>]*>/)?.[0] || '';
    const styleId = getXmlAttr(start, 'w:styleId');
    if (!styleId) continue;
    const name = decodeXmlText(getWordVal(block, 'name'));
    styles.set(styleId, { styleId, name, ...parseStylePropsFromXml(block) });
  }
  return styles;
}

export function mergeStyleProps(base: any = {}, override: any = {}) {
  return {
    fontFamily: override.fontFamily || base.fontFamily,
    fontSize: override.fontSize || base.fontSize,
    fontWeight: override.fontWeight || base.fontWeight,
    fontStyle: override.fontStyle || base.fontStyle,
    alignment: override.alignment || base.alignment,
    lineHeight: override.lineHeight || base.lineHeight,
    letterSpacing: override.letterSpacing ?? base.letterSpacing,
    color: override.color || base.color,
    indentFirstLine: override.indentFirstLine ?? base.indentFirstLine,
    spaceBefore: override.spaceBefore ?? base.spaceBefore,
    spaceAfter: override.spaceAfter ?? base.spaceAfter,
  };
}

export function classifyTemplateText(text: string, styleId?: string, styleName?: string): ExtractedTemplateStyleKey {
  const normalized = text.trim();
  const styleText = `${styleId || ''} ${styleName || ''}`.toLowerCase();
  if (/heading\s*1|标题\s*1|标题 1|heading1/.test(styleText)) return 'heading1';
  if (/heading\s*2|标题\s*2|标题 2|heading2/.test(styleText)) return 'heading2';
  if (/heading\s*3|标题\s*3|标题 3|heading3/.test(styleText)) return 'heading3';
  if (/heading\s*4|标题\s*4|标题 4|heading4/.test(styleText)) return 'heading4';
  if (/caption|题注/.test(styleText)) return /^表/.test(normalized) ? 'tableTitle' : 'caption';
  if (/^(表|表格)\s*[\d一二三四五六七八九十]/.test(normalized)) return 'tableTitle';
  if (/^(图|图表|图例)\s*[\d一二三四五六七八九十]/.test(normalized)) return 'caption';
  if (/^(第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+[、.．])/.test(normalized)) return 'heading1';
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(normalized)) return 'heading2';
  if (/^\d+(?:[.．]\d+)+/.test(normalized)) return normalized.split(/[.．]/).length >= 3 ? 'heading3' : 'heading2';
  if (/^\d+[、.．)]/.test(normalized) && normalized.length < 80) return 'heading3';
  return 'body';
}

export function mostCommon<T>(values: Array<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  values.filter(Boolean).forEach(value => counts.set(value as T, (counts.get(value as T) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function buildTemplateFormatRulesFromSamples(samples: ExtractedTemplateStyleSample[]) {
  const rules: Record<string, any> = {};
  const evidence: string[] = [];
  const keys: ExtractedTemplateStyleKey[] = ['heading1', 'heading2', 'heading3', 'heading4', 'body', 'caption', 'tableTitle', 'tableHeader'];
  keys.forEach(key => {
    const group = samples.filter(sample => sample.key === key);
    if (!group.length) return;
    const fontFamily = mostCommon(group.map(item => item.fontFamily));
    const fontSize = mostCommon(group.map(item => item.fontSize));
    const fontWeight = mostCommon(group.map(item => item.fontWeight));
    const fontStyle = mostCommon(group.map(item => item.fontStyle));
    const alignment = mostCommon(group.map(item => item.alignment));
    const lineHeight = mostCommon(group.map(item => item.lineHeight));
    const letterSpacing = mostCommon(group.map(item => item.letterSpacing));
    const color = mostCommon(group.map(item => item.color));
    const indentFirstLine = mostCommon(group.map(item => item.indentFirstLine));
    const spaceBefore = mostCommon(group.map(item => item.spaceBefore));
    const spaceAfter = mostCommon(group.map(item => item.spaceAfter));
    rules[key] = {
      fontRequirement: { fontFamily, fontSize, fontWeight, fontStyle, lineHeight, letterSpacing, color },
      paragraphRequirement: { alignment, indentFirstLine, spaceBefore, spaceAfter },
    };
    evidence.push(`${styleKeyNames[key]}：${fontFamily || '未知字体'} ${fontSize || '未知字号'}pt${fontWeight === 'bold' ? ' 加粗' : ''}；样本「${group[0].text.slice(0, 36)}」`);
  });
  return { rules, evidence };
}

export function styleRuleFromExtractedSample(sample: ExtractedTemplateStyleSample) {
  return {
    fontRequirement: {
      fontFamily: sample.fontFamily,
      fontSize: sample.fontSize,
      fontWeight: sample.fontWeight,
      fontStyle: sample.fontStyle,
      lineHeight: sample.lineHeight,
      letterSpacing: sample.letterSpacing,
      color: sample.color,
    },
    paragraphRequirement: {
      alignment: sample.alignment,
      indentFirstLine: sample.indentFirstLine,
      spaceBefore: sample.spaceBefore,
      spaceAfter: sample.spaceAfter,
    },
  };
}

export function describeTemplateStyleRule(rule: any): string {
  const font = rule?.fontRequirement || {};
  return [
    font.fontFamily,
    font.fontSize ? `${font.fontSize}pt` : '',
    font.fontWeight === 'bold' ? '加粗' : font.fontWeight === 'normal' ? '常规' : '',
  ].filter(Boolean).join(' ');
}

export const templateStyleLabels: Record<string, string> = {
  heading1: '一级标题',
  heading2: '二级标题',
  heading3: '三级标题',
  heading4: '四级标题',
  body: '正文',
  caption: '图题/图例',
  tableTitle: '表题',
  tableHeader: '表头',
};

export function alignmentLabel(value?: string) {
  const labels: Record<string, string> = { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' };
  return value ? labels[value] || value : '';
}

export function compareNumberField(label: string, expected?: number, actual?: number, unit = '', tolerance = 0.1) {
  if (expected === undefined || actual === undefined || Math.abs(Number(expected) - Number(actual)) < tolerance) return '';
  return `${label}应为 ${expected}${unit}，当前识别为 ${actual}${unit}`;
}

export function collectFormatMismatches(expectedRule: any = {}, actualRule: any = {}) {
  const expectedFont = expectedRule?.fontRequirement || {};
  const actualFont = actualRule?.fontRequirement || {};
  const expectedParagraph = expectedRule?.paragraphRequirement || {};
  const actualParagraph = actualRule?.paragraphRequirement || {};
  const mismatches: string[] = [];

  if (expectedFont.fontFamily && actualFont.fontFamily && expectedFont.fontFamily !== actualFont.fontFamily) {
    mismatches.push(`字体应为 ${expectedFont.fontFamily}，当前识别为 ${actualFont.fontFamily}`);
  }
  const fontSizeMismatch = compareNumberField('字号', expectedFont.fontSize, actualFont.fontSize, 'pt', 0.5);
  if (fontSizeMismatch) mismatches.push(fontSizeMismatch);
  if (expectedFont.fontWeight && actualFont.fontWeight && expectedFont.fontWeight !== actualFont.fontWeight) {
    mismatches.push(`字重应为 ${expectedFont.fontWeight === 'bold' ? '加粗' : '常规'}，当前识别为 ${actualFont.fontWeight === 'bold' ? '加粗' : '常规'}`);
  }
  if (expectedFont.fontStyle && actualFont.fontStyle && expectedFont.fontStyle !== actualFont.fontStyle) {
    mismatches.push(`字形应为 ${expectedFont.fontStyle === 'italic' ? '斜体' : '常规'}，当前识别为 ${actualFont.fontStyle === 'italic' ? '斜体' : '常规'}`);
  }
  const lineHeightMismatch = compareNumberField('行距', expectedFont.lineHeight, actualFont.lineHeight, '', 0.05);
  if (lineHeightMismatch) mismatches.push(lineHeightMismatch);
  const letterSpacingMismatch = compareNumberField('字间距', expectedFont.letterSpacing, actualFont.letterSpacing, 'pt', 0.1);
  if (letterSpacingMismatch) mismatches.push(letterSpacingMismatch);
  if (expectedFont.color && actualFont.color && expectedFont.color.toLowerCase() !== actualFont.color.toLowerCase()) {
    mismatches.push(`颜色应为 ${expectedFont.color}，当前识别为 ${actualFont.color}`);
  }
  if (expectedParagraph.alignment && actualParagraph.alignment && expectedParagraph.alignment !== actualParagraph.alignment) {
    mismatches.push(`对齐方式应为 ${alignmentLabel(expectedParagraph.alignment)}，当前识别为 ${alignmentLabel(actualParagraph.alignment)}`);
  }
  const indentMismatch = compareNumberField('首行缩进', expectedParagraph.indentFirstLine, actualParagraph.indentFirstLine, '字符', 0.2);
  if (indentMismatch) mismatches.push(indentMismatch);
  const beforeMismatch = compareNumberField('段前间距', expectedParagraph.spaceBefore, actualParagraph.spaceBefore, 'pt', 0.5);
  if (beforeMismatch) mismatches.push(beforeMismatch);
  const afterMismatch = compareNumberField('段后间距', expectedParagraph.spaceAfter, actualParagraph.spaceAfter, 'pt', 0.5);
  if (afterMismatch) mismatches.push(afterMismatch);

  return mismatches;
}

export function previewParagraphText(text: string) {
  return text.replace(/\s+/g, ' ').slice(0, 42);
}

export function compareTemplateFormatRules(expected: any = {}, actual: any = {}, actualParagraphs: ExtractedTemplateParagraphStyle[] = []) {
  const issues: ReviewIssue[] = [];
  const detailedLimit = 20;
  const formatSeverity = (key: string): ReviewIssue['severity'] =>
    ['heading1', 'heading2', 'heading3', 'heading4', 'body'].includes(key) ? 'error' : 'warning';

  if (actualParagraphs.length > 0) {
    for (const paragraph of actualParagraphs) {
      if (issues.length >= detailedLimit) break;
      const expectedRule = expected?.[paragraph.key];
      if (!expectedRule) continue;
      const actualRule = styleRuleFromExtractedSample(paragraph);
      const mismatches = collectFormatMismatches(expectedRule, actualRule);
      if (!mismatches.length) continue;
      const label = templateStyleLabels[paragraph.key] || paragraph.key;
      issues.push({
        id: `format_para_${paragraph.index}_${issues.length}`,
        type: 'wrong_format',
        severity: formatSeverity(paragraph.key),
        sectionTitle: label,
        lineNumber: paragraph.index + 1,
        message: `第 ${paragraph.index + 1} 段「${previewParagraphText(paragraph.text)}」${label}格式不一致：${mismatches.slice(0, 4).join('；')}`,
        suggestion: `格式规则为硬性要求：${describeTemplateStyleRule(expectedRule)}。请严格按${label}格式调整该段。`,
      });
    }
    if (issues.length >= detailedLimit) {
      issues.push({
        id: `format_more_${issues.length}`,
        type: 'wrong_format',
        severity: 'warning',
        sectionTitle: '格式检查',
        message: `已列出前 ${detailedLimit} 个段落格式问题，其余相同类型问题请按模板规则继续检查。`,
        suggestion: '建议先统一修改标题样式和正文样式，再重新运行模板审查。',
      });
    }
    return issues;
  }

  Object.entries(expected).forEach(([key, expectedRule]: [string, any]) => {
    const actualRule = actual?.[key];
    if (!actualRule) return;
    const mismatches = collectFormatMismatches(expectedRule, actualRule);
    if (!mismatches.length) return;
    issues.push({
      id: `format_${key}_${issues.length}`,
      type: 'wrong_format',
      severity: formatSeverity(key),
      sectionTitle: templateStyleLabels[key] || key,
      message: `${templateStyleLabels[key] || key}格式可能不一致：${mismatches.join('；')}`,
      suggestion: `格式规则为硬性要求：${describeTemplateStyleRule(expectedRule)}。请检查并严格统一文档中${templateStyleLabels[key] || key}的实际格式。`,
    });
  });
  return issues;
}
export async function extractDocxTemplateFormatRules(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const sourcePath = ext === '.doc' ? convertLegacyDocToDocx(filePath) : filePath;
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== '.docx') {
    return { success: false, error: ext === '.doc' ? '旧版 .doc 自动转换为 .docx 失败，请确认本机安装了 Microsoft Word 或 LibreOffice。' : '仅 .docx 支持读取实际段落和表格格式' };
  }
  const buffer = fs.readFileSync(sourcePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) return { success: false, error: '未找到 word/document.xml' };
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const styles = parseStyleDefinitions(stylesXml);
  const samples: ExtractedTemplateStyleSample[] = [];
  const paragraphs: ExtractedTemplateParagraphStyle[] = [];

  for (const match of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0];
    const text = xmlTextFromBlock(paragraph);
    if (!text) continue;
    const pPr = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
    const styleId = getWordVal(pPr, 'pStyle');
    const style = styleId ? styles.get(styleId) : undefined;
    const runPr = paragraph.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const props = mergeStyleProps(style, mergeStyleProps(parseStylePropsFromXml(pPr), parseStylePropsFromXml(runPr)));
    const key = classifyTemplateText(text, styleId, style?.name);
    paragraphs.push({
      index: paragraphs.length,
      key,
      text: text.slice(0, 600),
      styleId,
      styleName: style?.name,
      ...props,
    });
    if (text.length > 600) continue;
    if (key === 'body' && (text.length < 30 || samples.filter(sample => sample.key === 'body').length >= 12)) continue;
    samples.push({ key, text, ...props });
  }

  for (const tableMatch of documentXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    const firstRow = tableMatch[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0];
    if (!firstRow) continue;
    for (const cellMatch of firstRow.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const cell = cellMatch[0];
      const text = xmlTextFromBlock(cell);
      if (!text) continue;
      const runPr = cell.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
      const props = parseStylePropsFromXml(runPr);
      samples.push({ key: 'tableHeader', text, ...props });
      paragraphs.push({
        index: paragraphs.length,
        key: 'tableHeader',
        text: text.slice(0, 600),
        isTableCell: true,
        ...props,
      });
    }
  }

  const { rules, evidence } = buildTemplateFormatRulesFromSamples(samples);
  return {
    success: true,
    formatRules: rules,
    paragraphs,
    evidence: [`已逐段识别 ${paragraphs.length} 段文字格式`, ...evidence],
    sampleCount: samples.length,
    paragraphCount: paragraphs.length,
  };
}

export function stripRtf(value: string): string {
  return normalizeExtractedText(
    value
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+\d* ?/g, '')
      .replace(/[{}]/g, ' ')
  );
}

export function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function convertedDocxPathFor(filePath: string): string {
  ensureDataDir();
  const convertedDir = path.join(dataDir, 'converted-docx');
  if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir, { recursive: true });
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const safeBase = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*]+/g, '_').slice(0, 80);
  const stamp = stat ? `${Math.round(stat.mtimeMs)}-${stat.size}` : String(Date.now());
  return path.join(convertedDir, `${safeBase}-${stamp}.docx`);
}

export function findLibreOfficeExecutable(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (candidate === 'soffice.exe' || fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function convertDocWithWordCom(filePath: string, targetPath: string): boolean {
  const command = `
$ErrorActionPreference = 'Stop'
$source = ${quotePowerShellString(filePath)}
$target = ${quotePowerShellString(targetPath)}
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($source, $false, $true)
  $doc.SaveAs2($target, 16)
} finally {
  if ($doc -ne $null) { $doc.Close($false) }
  if ($word -ne $null) { $word.Quit() }
}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
    });
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (error) {
    console.warn('Word COM doc conversion failed:', error);
    return false;
  }
}

export function convertDocWithLibreOffice(filePath: string, targetPath: string): boolean {
  const soffice = findLibreOfficeExecutable();
  if (!soffice) return false;
  const outDir = path.dirname(targetPath);
  try {
    execFileSync(soffice, ['--headless', '--convert-to', 'docx', '--outdir', outDir, filePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
    });
    const generatedPath = path.join(outDir, `${path.basename(filePath, path.extname(filePath))}.docx`);
    if (fs.existsSync(generatedPath) && generatedPath !== targetPath) {
      fs.copyFileSync(generatedPath, targetPath);
    }
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (error) {
    console.warn('LibreOffice doc conversion failed:', error);
    return false;
  }
}

export function convertLegacyDocToDocx(filePath: string): string | null {
  if (path.extname(filePath).toLowerCase() !== '.doc') return null;
  const targetPath = convertedDocxPathFor(filePath);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) return targetPath;
  if (convertDocWithWordCom(filePath, targetPath)) return targetPath;
  if (convertDocWithLibreOffice(filePath, targetPath)) return targetPath;
  return null;
}
export function extractLegacyDocText(buffer: Buffer): string {
  const utf16 = normalizeExtractedText(buffer.toString('utf16le'));
  const utf8 = normalizeExtractedText(buffer.toString('utf8'));
  const best = utf16.length > utf8.length ? utf16 : utf8;
  return best
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && /[\u4e00-\u9fa5A-Za-z0-9]/.test(line))
    .join('\n');
}

export function isReadableExtractedText(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  if (compact.length < 20) return false;
  const readable = compact.match(/[\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/]/g)?.length || 0;
  const replacement = compact.match(/�/g)?.length || 0;
  return readable / compact.length > 0.68 && replacement / compact.length < 0.05;
}

// 解析 Word 文档

export function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function getBackupPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return path.join(dir, `${base}.bak-${stamp}${ext}`);
}

export function normalizeForSearch(value: string): { text: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  Array.from(value).forEach((char, index) => {
    if (/\s/.test(char)) return;
    chars.push(char);
    map.push(index);
  });
  return { text: chars.join(''), map };
}

export function findTextRange(haystack: string, needle: string): { start: number; end: number; mode: 'exact' | 'compact' } | null {
  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0) return { start: exactIndex, end: exactIndex + needle.length, mode: 'exact' };
  const compactHaystack = normalizeForSearch(haystack);
  const compactNeedle = normalizeForSearch(needle);
  if (!compactNeedle.text) return null;
  const compactIndex = compactHaystack.text.indexOf(compactNeedle.text);
  if (compactIndex < 0) return null;
  return {
    start: compactHaystack.map[compactIndex],
    end: compactHaystack.map[compactIndex + compactNeedle.text.length - 1] + 1,
    mode: 'compact',
  };
}

export function replaceDocxXmlText(xml: string, originalText: string, replacementText: string) {
  const segments: Array<{ start: number; end: number; inner: string; text: string }> = [];
  const textRegex = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  let fullText = '';
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml))) {
    const text = decodeXmlText(match[2]);
    segments.push({ start: fullText.length, end: fullText.length + text.length, inner: match[2], text });
    fullText += text;
  }

  const range = findTextRange(fullText, originalText);
  if (!range) return { replaced: false, xml, mode: 'none' as const };

  let inserted = false;
  let segmentIndex = 0;
  const nextXml = xml.replace(textRegex, (_all, open: string, inner: string, close: string) => {
    const segment = segments[segmentIndex++];
    if (!segment || segment.end <= range.start || segment.start >= range.end) return open + inner + close;
    const overlapStart = Math.max(range.start, segment.start);
    const overlapEnd = Math.min(range.end, segment.end);
    const before = overlapStart > segment.start ? segment.text.slice(0, overlapStart - segment.start) : '';
    const after = overlapEnd < segment.end ? segment.text.slice(overlapEnd - segment.start) : '';
    const nextText = inserted ? after : before + replacementText + after;
    inserted = true;
    return open + encodeXmlText(nextText) + close;
  });

  return { replaced: true, xml: nextXml, mode: range.mode };
}

export async function replaceDocumentText(params: { filePath: string; originalText: string; replacementText: string }) {
  const filePath = String(params?.filePath || '');
  const originalText = String(params?.originalText || '').trim();
  const replacementText = String(params?.replacementText || '').trim();
  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '文件不存在或路径无效' };
  if (!originalText) return { success: false, error: '原文内容不能为空' };
  if (!replacementText) return { success: false, error: '建议修改内容不能为空' };

  const ext = path.extname(filePath).toLowerCase();
  const backupPath = getBackupPath(filePath);
  fs.copyFileSync(filePath, backupPath);

  try {
    if (ext === '.txt' || ext === '.md') {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const range = findTextRange(raw, originalText);
      if (!range) return { success: false, error: '未在文档中找到匹配的原文内容，请调整原文后重试', backupPath };
      fs.writeFileSync(filePath, raw.slice(0, range.start) + replacementText + raw.slice(range.end), 'utf-8');
      return { success: true, replacedCount: 1, backupPath, matchMode: range.mode };
    }

    if (ext === '.docx') {
      const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
      const docFile = zip.file('word/document.xml');
      if (!docFile) return { success: false, error: '未找到 docx 主文档内容', backupPath };
      const xml = await docFile.async('string');
      const result = replaceDocxXmlText(xml, originalText, replacementText);
      if (!result.replaced) return { success: false, error: '未在 docx 中找到匹配的原文内容，请调整原文后重试', backupPath };
      zip.file('word/document.xml', result.xml);
      fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
      return { success: true, replacedCount: 1, backupPath, matchMode: result.mode };
    }

    return { success: false, error: '暂只支持 .docx、.txt、.md 的自动替换', backupPath };
  } catch (error: any) {
    try {
      if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, filePath);
    } catch {}
    return { success: false, error: error.message || '替换失败，已尝试恢复原文件', backupPath };
  }
}



import * as fs from 'fs';
import * as path from 'path';
import { WritingTemplate, TemplateNode, TemplateStyleRule } from './types';
const JSZip = require('jszip');

// ========== ZIP 导入导出 ==========

// 递归添加文件夹到zip
export function addFolderToZip(zip: any, folderPath: string, basePath: string) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      addFolderToZip(zip, fullPath, basePath);
    } else {
      const content = fs.readFileSync(fullPath);
      zip.file(relativePath, content);
    }
  }
}

export function escapeXml(value: string = ''): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function normalizeFileType(fileType?: string): string {
  return (fileType || 'docx').replace(/^\./, '').toLowerCase();
}

export function styleRuleFromTemplate(template?: WritingTemplate, key: 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body' = 'body') {
  const fallbackTitle = template?.titleFontRequirement || {};
  const fallbackBody = template?.bodyFontRequirement || {};
  const isHeading = key.startsWith('heading');
  return template?.formatRules?.[key] || {
    fontRequirement: isHeading ? fallbackTitle : fallbackBody,
    paragraphRequirement: {},
  };
}

export function fontSizeToHalfPoints(size?: number, fallback = 12): number {
  return Math.round((size || fallback) * 2);
}

export function pointsToTwips(value?: number): number {
  return Math.round((value || 0) * 20);
}

export function lineHeightToWordLine(value?: number): number {
  return Math.round((value || 1.5) * 240);
}

export function flattenTemplateNodes(nodes: TemplateNode[], output: TemplateNode[] = []): TemplateNode[] {
  for (const node of nodes || []) {
    output.push(node);
    if (node.children?.length) flattenTemplateNodes(node.children, output);
  }
  return output;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractWordXmlText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map(match => unescapeXml(match[1]))
    .join('');
}

function normalizeWordHeading(value: string): string {
  return value.replace(/[\s*_`#：:]/g, '').toLocaleLowerCase();
}

function normalizeGuidanceText(value: string): string {
  return value.replace(/[\s\r\n，,。；;：:（）()]/g, '').toLocaleLowerCase();
}

function isNodeGuidanceText(value: string, node?: TemplateNode): boolean {
  const text = normalizeGuidanceText(value);
  if (!text || !node) return false;
  return [node.requirementText, node.description]
    .filter(Boolean)
    .some(source => {
      const normalized = normalizeGuidanceText(String(source));
      return normalized && (normalized.includes(text) || text.includes(normalized));
    });
}

function findBodyFormatPrototype(containerXml: string, node?: TemplateNode, heading?: string): string | undefined {
  const paragraphs = [...containerXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(match => match[0]);
  const headingIndex = heading
    ? paragraphs.findIndex(paragraph => normalizeWordHeading(extractWordXmlText(paragraph)).includes(heading))
    : -1;
  const candidates = paragraphs.slice(headingIndex + 1).filter(paragraph => /<w:pPr\b/.test(paragraph));
  const bodyPrototype = candidates.find(paragraph => {
    const text = extractWordXmlText(paragraph).trim();
    return text && !isNodeGuidanceText(text, node) && !/<w:color\b[^>]*w:val="(?:FF0000|F00)"/i.test(paragraph);
  });
  if (bodyPrototype) return bodyPrototype;
  return candidates.find(paragraph => !extractWordXmlText(paragraph).trim());
}

function extractPrototypeProperties(prototypeXml?: string): { pPr?: string; rPr?: string } {
  if (!prototypeXml) return {};
  const pPr = prototypeXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0];
  const paragraphRunProperties = pPr?.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0];
  const runProperties = prototypeXml.match(/<w:r\b[\s\S]*?<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0]
    ?.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0];
  return { pPr, rPr: paragraphRunProperties || runProperties };
}

function removeParagraphRunProperties(pPrXml: string): string {
  return pPrXml.replace(/<w:rPr\b[\s\S]*?<\/w:rPr>/gi, '');
}

function buildBodyParagraphsXml(content: string, template: WritingTemplate, node?: TemplateNode, prototypeXml?: string): string {
  const rule = styleRuleFromTemplate(template, 'body');
  const font = { ...(rule.fontRequirement || {}), ...(node?.fontRequirement || {}) };
  const paragraph = { ...(rule.paragraphRequirement || {}), ...(node?.paragraphRequirement || {}) };
  const fontFamily = escapeXml(font.fontFamily || template.bodyFontRequirement?.fontFamily || '宋体');
  const size = fontSizeToHalfPoints(font.fontSize || template.bodyFontRequirement?.fontSize, 12);
  const color = (font.color || '#000000').replace('#', '');
  const bold = font.fontWeight === 'bold';
  const italic = font.fontStyle === 'italic';
  const runSpacing = `<w:spacing w:val="${pointsToTwips(font.letterSpacing)}"/>`;
  const alignment = paragraph.alignment ? `<w:jc w:val="${paragraph.alignment}"/>` : '';
  const firstLine = paragraph.indentFirstLine ? `<w:ind w:firstLineChars="${Math.round(paragraph.indentFirstLine * 100)}"/>` : '';
  const paragraphSpacing = `<w:spacing w:before="${pointsToTwips(paragraph.spaceBefore)}" w:after="${pointsToTwips(paragraph.spaceAfter)}" w:line="${lineHeightToWordLine(font.lineHeight || template.bodyFontRequirement?.lineHeight)}" w:lineRule="auto"/>`;
  const generatedPPr = `<w:pPr><w:pStyle w:val="Normal"/>${alignment}${firstLine}${paragraphSpacing}</w:pPr>`;
  const generatedRPr = `<w:rPr><w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}" w:eastAsia="${fontFamily}"/>${bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>'}${italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>'}${runSpacing}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const prototype = extractPrototypeProperties(prototypeXml);
  // Preserve the paragraph geometry from the template, but never inherit its
  // placeholder run formatting. Empty template paragraphs frequently carry
  // red, bold, or fallback-font properties that must not leak into body text.
  const pPr = prototype.pPr ? removeParagraphRunProperties(prototype.pPr) : generatedPPr;
  const rPr = generatedRPr;
  return content.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const value = line.trim();
    if (!value) return `<w:p>${pPr}</w:p>`;
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;
  }).join('');
}

function replaceCellParagraphs(cellXml: string, paragraphsXml: string): string {
  const withoutParagraphs = cellXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, '');
  return withoutParagraphs.replace('</w:tc>', `${paragraphsXml}</w:tc>`);
}

function appendCellParagraphs(cellXml: string, paragraphsXml: string): string {
  return cellXml.replace('</w:tc>', `${paragraphsXml}</w:tc>`);
}

function replaceTemplateGuidanceWithBody(cellXml: string, heading: string, content: string, template: WritingTemplate, node: TemplateNode): string {
  const paragraphs = [...cellXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const headingParagraph = paragraphs.find(match => normalizeWordHeading(extractWordXmlText(match[0])).includes(heading));
  const paragraphsXml = buildBodyParagraphsXml(content, template, node, findBodyFormatPrototype(cellXml, node, heading));
  if (!headingParagraph) return appendCellParagraphs(cellXml, paragraphsXml);
  const withoutParagraphs = cellXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, '');
  return withoutParagraphs.replace('</w:tc>', `${headingParagraph[0]}${paragraphsXml}</w:tc>`);
}

function resolveNodeContent(nodes: TemplateNode[], node: TemplateNode, sectionContents: Record<string, string>): string {
  const direct = String(sectionContents[node.id] || '').trim();
  if (direct) return direct;
  const hasMappedContent = nodes.some(item => String(sectionContents[item.id] || '').trim());
  return !hasMappedContent && node.id === nodes[0]?.id ? String(sectionContents.main || '').trim() : '';
}

function replaceStandaloneSectionWithBody(
  documentXml: string,
  template: WritingTemplate,
  nodes: TemplateNode[],
  node: TemplateNode,
  content: string,
): { xml: string; replaced: boolean } {
  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const title = normalizeWordHeading(node.title);
  const headingIndex = paragraphs.findIndex(match => normalizeWordHeading(extractWordXmlText(match[0])) === title);
  if (headingIndex < 0) return { xml: documentXml, replaced: false };

  const nextHeadingIndex = paragraphs.findIndex((match, index) => index > headingIndex && nodes.some(candidate => (
    candidate.id !== node.id
    && normalizeWordHeading(extractWordXmlText(match[0])) === normalizeWordHeading(candidate.title)
  )));
  const headingParagraph = paragraphs[headingIndex];
  const segmentStart = (headingParagraph.index || 0) + headingParagraph[0].length;
  const segmentEnd = nextHeadingIndex >= 0
    ? (paragraphs[nextHeadingIndex].index || documentXml.length)
    : documentXml.indexOf('<w:sectPr', segmentStart) >= 0
      ? documentXml.indexOf('<w:sectPr', segmentStart)
      : documentXml.lastIndexOf('</w:body>');
  if (segmentEnd < segmentStart) return { xml: documentXml, replaced: false };

  const segment = documentXml.slice(segmentStart, segmentEnd);
  const prototype = findBodyFormatPrototype(segment, node);
  const paragraphsXml = buildBodyParagraphsXml(content, template, node, prototype);
  const containsTableStructure = /<w:(?:tbl|tr|tc)\b/.test(segment);
  const remainder = containsTableStructure
    ? segment.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraphXml => {
      const text = extractWordXmlText(paragraphXml).trim();
      return !text || isNodeGuidanceText(text, node) ? '' : paragraphXml;
    })
    : segment.replace(/<w:p\b[\s\S]*?<\/w:p>/g, '');
  return {
    xml: `${documentXml.slice(0, segmentStart)}${paragraphsXml}${remainder}${documentXml.slice(segmentEnd)}`,
    replaced: true,
  };
}

interface TemplateContinuationSlot {
  marker: string;
  primaryContent: string;
  continuationContent: string;
}

function findTemplateContinuationSlot(
  documentXml: string,
  nodes: TemplateNode[],
  node: TemplateNode,
  content: string,
): TemplateContinuationSlot | undefined {
  const rows = [...documentXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(match => match[0]);
  const title = normalizeWordHeading(node.title);
  const headingIndex = rows.findIndex(rowXml => (
    [...rowXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
      .some(match => normalizeWordHeading(extractWordXmlText(match[0])) === title)
  ));
  if (headingIndex < 0) return undefined;

  const nextHeadingIndex = rows.findIndex((rowXml, index) => index > headingIndex && (
    nodes.some(candidate => candidate.id !== node.id && (
      [...rowXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
        .some(match => normalizeWordHeading(extractWordXmlText(match[0])) === normalizeWordHeading(candidate.title))
    ))
  ));
  const sectionRows = rows.slice(headingIndex + 1, nextHeadingIndex >= 0 ? nextHeadingIndex : rows.length);
  for (const rowXml of sectionRows) {
    const marker = [...rowXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
      .map(match => extractWordXmlText(match[0]).trim())
      .find(text => text && text.length <= 30 && isNodeGuidanceText(text, node));
    if (!marker) continue;
    const markerIndex = content.indexOf(marker);
    return {
      marker,
      primaryContent: markerIndex >= 0 ? content.slice(0, markerIndex).trim() : content.trim(),
      continuationContent: markerIndex >= 0 ? content.slice(markerIndex).trim() : '',
    };
  }
  return undefined;
}

function replaceContinuationRow(
  rowXml: string,
  slot: TemplateContinuationSlot,
  template: WritingTemplate,
  node: TemplateNode,
): string {
  const cells = [...rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)];
  const target = cells.find(match => extractWordXmlText(match[0]).includes(slot.marker));
  if (!target) return rowXml;
  const paragraphsXml = slot.continuationContent
    ? buildBodyParagraphsXml(slot.continuationContent, template, node, findBodyFormatPrototype(target[0], node))
    : '<w:p/>';
  const replacement = replaceCellParagraphs(target[0], paragraphsXml);
  return `${rowXml.slice(0, target.index)}${replacement}${rowXml.slice((target.index || 0) + target[0].length)}`;
}

/** Fill an imported direct-use DOCX template while preserving its tables, headers, styles and other package parts. */
export function fillTemplateDocumentXmlWithContent(
  documentXml: string,
  template: WritingTemplate,
  sectionContents: Record<string, string>,
): string {
  const nodes = flattenTemplateNodes(template.nodes || []);
  let output = documentXml;

  for (const node of nodes) {
      const content = resolveNodeContent(nodes, node, sectionContents);
      if (!content) continue;
      const title = normalizeWordHeading(node.title);
      const continuationSlot = findTemplateContinuationSlot(output, nodes, node, content);
      const primaryContent = continuationSlot?.primaryContent || content;
      let inserted = false;

      output = output.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, rowXml => {
        if (inserted) {
          return continuationSlot ? replaceContinuationRow(rowXml, continuationSlot, template, node) : rowXml;
        }
        const cells = [...rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)];
        const headingCellIndex = cells.findIndex(match => normalizeWordHeading(extractWordXmlText(match[0])).includes(title));
        if (headingCellIndex < 0) return rowXml;

        const targetCellIndex = cells.length > 1 && headingCellIndex < cells.length - 1
          ? headingCellIndex + 1
          : headingCellIndex;
        const target = cells[targetCellIndex];
        const replacement = targetCellIndex === headingCellIndex
          ? replaceTemplateGuidanceWithBody(target[0], title, primaryContent, template, node)
          : replaceCellParagraphs(target[0], buildBodyParagraphsXml(primaryContent, template, node, findBodyFormatPrototype(target[0], node)));
        inserted = true;
        return `${rowXml.slice(0, target.index)}${replacement}${rowXml.slice((target.index || 0) + target[0].length)}`;
      });

    if (!inserted) {
      const standalone = replaceStandaloneSectionWithBody(output, template, nodes, node, content);
      output = standalone.xml;
    }
  }

  return output;
}

export function buildWordStyle(styleId: string, name: string, rule: ReturnType<typeof styleRuleFromTemplate>, defaults: { font: string; size: number; bold?: boolean }) {
  const font = rule.fontRequirement || {};
  const paragraph = rule.paragraphRequirement || {};
  const fontFamily = escapeXml(font.fontFamily || defaults.font);
  const size = fontSizeToHalfPoints(font.fontSize, defaults.size);
  const color = (font.color || '#000000').replace('#', '');
  const bold = font.fontWeight === 'bold' || defaults.bold;
  const italic = font.fontStyle === 'italic';
  const spacing = font.letterSpacing ? `<w:spacing w:val="${pointsToTwips(font.letterSpacing)}"/>` : '';
  const align = paragraph.alignment ? `<w:jc w:val="${paragraph.alignment}"/>` : '';
  const firstLine = paragraph.indentFirstLine ? `<w:ind w:firstLineChars="${Math.round(paragraph.indentFirstLine * 100)}"/>` : '';

  return `
    <w:style w:type="paragraph" w:styleId="${styleId}">
      <w:name w:val="${escapeXml(name)}"/>
      <w:qFormat/>
      <w:pPr>
        ${align}
        ${firstLine}
        <w:spacing w:before="${pointsToTwips(paragraph.spaceBefore)}" w:after="${pointsToTwips(paragraph.spaceAfter)}" w:line="${lineHeightToWordLine(font.lineHeight)}" w:lineRule="auto"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}" w:eastAsia="${fontFamily}"/>
        ${bold ? '<w:b/><w:bCs/>' : ''}
        ${italic ? '<w:i/><w:iCs/>' : ''}
        ${spacing}
        <w:color w:val="${color}"/>
        <w:sz w:val="${size}"/>
        <w:szCs w:val="${size}"/>
      </w:rPr>
    </w:style>`;
}

export function buildWordStylesXml(template?: WritingTemplate): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  ${buildWordStyle('Normal', '正文', styleRuleFromTemplate(template, 'body'), { font: '宋体', size: 12 })}
  ${buildWordStyle('Heading1', '标题 1', styleRuleFromTemplate(template, 'heading1'), { font: '黑体', size: 16, bold: true })}
  ${buildWordStyle('Heading2', '标题 2', styleRuleFromTemplate(template, 'heading2'), { font: '黑体', size: 15, bold: true })}
  ${buildWordStyle('Heading3', '标题 3', styleRuleFromTemplate(template, 'heading3'), { font: '黑体', size: 14, bold: true })}
  ${buildWordStyle('Heading4', '标题 4', styleRuleFromTemplate(template, 'heading4'), { font: '黑体', size: 12, bold: true })}
</w:styles>`;
}

// 带用户内容的 Word XML 生成
export function buildWordDocumentXmlWithContent(template: WritingTemplate, sectionContents: Record<string, string>): string {
  const nodes = flattenTemplateNodes(template.nodes || []);
  const paragraphs = nodes.length > 0
    ? nodes.map(node => {
      const level = Math.min(Math.max(node.level || 1, 1), 4);
      const headingXml = `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${escapeXml(node.title)}</w:t></w:r></w:p>`;
      const userContent = resolveNodeContent(nodes, node, sectionContents);
      if (!userContent) return headingXml;
      const bodyParagraphs = userContent.split('\n').filter(line => line.trim()).map(line =>
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${escapeXml(line.trim())}</w:t></w:r></w:p>`
      ).join('');
      return headingXml + bodyParagraphs;
    }).join('')
    : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>新建文档</w:t></w:r></w:p>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

// 带用户内容的 docx 写入
export async function writeDocxFileWithContent(filePath: string, template: WritingTemplate, sectionContents: Record<string, string>) {
  if (template.templateType !== 'example' && template.filePath && path.extname(template.filePath).toLowerCase() === '.docx' && fs.existsSync(template.filePath)) {
    const sourceZip = await JSZip.loadAsync(fs.readFileSync(template.filePath));
    const documentEntry = sourceZip.file('word/document.xml');
    if (!documentEntry) throw new Error('模板文件缺少 word/document.xml，无法填充正文');
    const documentXml = await documentEntry.async('string');
    sourceZip.file('word/document.xml', fillTemplateDocumentXmlWithContent(documentXml, template, sectionContents));
    const buffer = await sourceZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(filePath, buffer);
    return;
  }

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  zip.file('[Content_Types].xml', contentTypes);

  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.folder('word')?.file('document.xml', buildWordDocumentXmlWithContent(template, sectionContents));
  zip.folder('word')?.file('styles.xml', buildWordStylesXml(template));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

export function buildWordDocumentXml(template?: WritingTemplate): string {
  const nodes = flattenTemplateNodes(template?.nodes || []);
  const paragraphs = nodes.length > 0
    ? nodes.map(node => {
      const level = Math.min(Math.max(node.level || 1, 1), 4);
      const headingXml = `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${escapeXml(node.title)}</w:t></w:r></w:p>`;
      // 输出节点的描述/原始内容作为正文段落
      const bodyText = node.description || node.requirementText || '';
      if (!bodyText) return headingXml;
      const bodyParagraphs = bodyText.split('\n').filter(line => line.trim()).map(line =>
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${escapeXml(line.trim())}</w:t></w:r></w:p>`
      ).join('');
      return headingXml + bodyParagraphs;
    }).join('')
    : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>新建文档</w:t></w:r></w:p>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

export async function writeDocxFile(filePath: string, template?: WritingTemplate) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word')?.file('document.xml', buildWordDocumentXml(template));
  zip.folder('word')?.file('styles.xml', buildWordStylesXml(template));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

export async function writePptxFile(filePath: string, template?: WritingTemplate) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.folder('ppt')?.file('presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
</p:presentation>`);
  zip.folder('ppt')?.folder('_rels')?.file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
  const title = escapeXml(template?.name || '新建演示文稿');
  zip.folder('ppt')?.folder('slides')?.file('slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3200" b="1"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

export async function writeXlsxFile(filePath: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.folder('xl')?.folder('worksheets')?.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

export function writeRtfCompatibleFile(filePath: string) {
  fs.writeFileSync(filePath, '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0 SimSun;}}\\f0\\fs24\\par}', 'utf-8');
}

export function writePdfFile(filePath: string) {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj
4 0 obj<</Length 0>>stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000208 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
257
%%EOF`;
  fs.writeFileSync(filePath, pdf, 'utf-8');
}

export async function createFileByType(filePath: string, fileType: string, template?: WritingTemplate) {
  const normalized = normalizeFileType(fileType);
  if (normalized === 'docx') {
    await writeDocxFile(filePath, template);
    return;
  }
  if (normalized === 'pptx') {
    await writePptxFile(filePath, template);
    return;
  }
  if (normalized === 'xlsx') {
    await writeXlsxFile(filePath);
    return;
  }
  if (normalized === 'doc' || normalized === 'rtf') {
    writeRtfCompatibleFile(filePath);
    return;
  }
  if (normalized === 'pdf') {
    writePdfFile(filePath);
    return;
  }
  fs.writeFileSync(filePath, '', 'utf-8');
}

// 打开ZIP文件对话框

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
      const userContent = sectionContents[node.id] || '';
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

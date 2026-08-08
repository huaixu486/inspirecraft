import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WritingTemplate } from '../types';
import {
  fillTemplateDocumentXmlWithContent,
  writeDocxFileWithContent,
} from '../fileCreation';

const JSZip = require('jszip');

const template = (filePath?: string): WritingTemplate => ({
  id: 'proposal',
  name: '提案表',
  description: '',
  category: '提案',
  templateType: 'direct',
  filePath,
  bodyFontRequirement: {
    fontFamily: '方正仿宋_GBK',
    fontSize: 14,
    lineHeight: 2.25,
  },
  nodes: [
    { id: 'keywords', title: '提案关键词', level: 1, isRequired: true },
    { id: '1', title: '一、 问题描述', level: 1, isRequired: true },
  ],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
});

const sourceDocumentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>
  <w:tr><w:tc><w:p><w:r><w:t>提案关键词</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>（三个以内关键词）</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>一、问题描述</w:t></w:r></w:p><w:p><w:r><w:t>（说明实际难题）</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl></w:body></w:document>`;

test('direct template XML keeps its table and inserts each mapped section into the correct cell', () => {
  const result = fillTemplateDocumentXmlWithContent(sourceDocumentXml, template(), {
    keywords: '导线压接；智能控制',
    '1': '当前压接过程依赖人工经验。',
  });

  assert.match(result, /<w:tbl>/);
  assert.match(result, /提案关键词/);
  assert.match(result, /导线压接；智能控制/);
  assert.doesNotMatch(result, /三个以内关键词/);
  assert.doesNotMatch(result, /说明实际难题/);
  assert.match(result, /当前压接过程依赖人工经验/);
  assert.match(result, /w:eastAsia="方正仿宋_GBK"/);
  assert.match(result, /w:sz w:val="28"/);
  assert.match(result, /w:line="540"/);
});

test('direct template body replaces red guidance and inherits the real body placeholder formatting', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>
  <w:tr><w:tc>
    <w:p><w:r><w:t>一、问题描述</w:t></w:r></w:p>
    <w:p><w:pPr><w:rPr><w:color w:val="FF0000"/></w:rPr></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>（说明实际难题）</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:line="540" w:lineRule="exact"/><w:ind w:firstLine="280" w:firstLineChars="100"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:b/><w:sz w:val="24"/></w:rPr></w:pPr></w:p>
  </w:tc></w:tr>
</w:tbl></w:body></w:document>`;
  const result = fillTemplateDocumentXmlWithContent(source, template(), {
    '1': '生成后的问题描述正文。',
  });

  assert.doesNotMatch(result, /说明实际难题/);
  assert.doesNotMatch(result, /FF0000/);
  assert.match(result, /生成后的问题描述正文/);
  assert.match(result, /w:line="540" w:lineRule="exact"/);
  assert.match(result, /w:firstLine="280" w:firstLineChars="100"/);
  assert.match(result, /w:eastAsia="方正仿宋_GBK"/);
  assert.match(result, /w:sz w:val="28"/);
  assert.match(result, /w:color w:val="000000"/);
  assert.doesNotMatch(result, /w:eastAsia="宋体"|w:sz w:val="24"|<w:b\/>/);
});

test('explicit template paragraph rules override placeholder paragraph formatting on export', () => {
  const configured = template();
  configured.formatRules = {
    body: {
      fontRequirement: { fontFamily: 'Arial', fontSize: 11, lineHeight: 1.5 },
      paragraphRequirement: { alignment: 'justify', indentFirstLine: 2, spaceBefore: 3, spaceAfter: 6 },
    },
  };
  const source = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc>
    <w:p><w:r><w:t>一、问题描述</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/><w:ind w:firstLineChars="100"/></w:pPr><w:r><w:t>（说明实际难题）</w:t></w:r></w:p>
  </w:tc></w:tr></w:tbl></w:body></w:document>`;
  const result = fillTemplateDocumentXmlWithContent(source, configured, { '1': '正文内容' });

  assert.match(result, /w:jc w:val="both"/);
  assert.match(result, /w:firstLineChars="200"/);
  assert.match(result, /w:before="60"/);
  assert.match(result, /w:after="120"/);
  assert.match(result, /w:line="360"/);
  assert.doesNotMatch(result, /w:jc w:val="center"/);
});

test('direct template replaces a continuation sample row with generated continuation content', () => {
  const configured = template();
  configured.nodes = [{
    id: 'section-a',
    title: 'Section A',
    level: 1,
    isRequired: true,
    description: 'Write the main section. Expected results:',
    requirementText: 'Write the main section. Expected results:',
  }];
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>
  <w:tr><w:tc><w:p><w:r><w:t>Section A</w:t></w:r></w:p><w:p><w:r><w:t>Write the main section.</w:t></w:r></w:p><w:p/></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Expected results:</w:t></w:r></w:p><w:p><w:r><w:t>Template sample result 1</w:t></w:r></w:p><w:p><w:r><w:t>Template sample result 2</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl></w:body></w:document>`;
  const result = fillTemplateDocumentXmlWithContent(source, configured, {
    'section-a': 'Generated main text.\nExpected results:\nGenerated result A.\nGenerated result B.',
  });

  assert.doesNotMatch(result, /Write the main section|Template sample result/);
  assert.match(result, /Generated main text/);
  assert.match(result, /Expected results/);
  assert.match(result, /Generated result A/);
  assert.match(result, /Generated result B/);
});

test('standalone template sections replace guidance and example text before the next heading', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>一、问题描述</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>（说明实际难题）</w:t></w:r></w:p>
  <w:p><w:pPr><w:ind w:firstLineChars="200"/><w:rPr><w:rFonts w:eastAsia="方正仿宋_GBK"/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:t>模板示例正文</w:t></w:r></w:p>
  <w:p><w:r><w:t>二、研究意义</w:t></w:r></w:p>
  <w:p><w:r><w:t>下一章节原文</w:t></w:r></w:p>
  <w:sectPr/>
</w:body></w:document>`;
  const configured = template();
  configured.nodes.push({ id: '2', title: '二、研究意义', level: 1, isRequired: true });
  const result = fillTemplateDocumentXmlWithContent(source, configured, { '1': '新的问题描述正文。' });

  assert.doesNotMatch(result, /说明实际难题|模板示例正文/);
  assert.match(result, /新的问题描述正文/);
  assert.match(result, /二、研究意义/);
  assert.match(result, /下一章节原文/);
  assert.match(result, /w:firstLineChars="200"/);
});

test('DOCX export edits the imported template package instead of replacing it with a blank document', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-docx-fill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.docx');
  const outputPath = path.join(root, 'output.docx');
  const zip = new JSZip();
  zip.file('word/document.xml', sourceDocumentXml);
  zip.file('word/custom-preserved.xml', '<preserved>true</preserved>');
  fs.writeFileSync(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }));

  await writeDocxFileWithContent(outputPath, template(sourcePath), {
    keywords: '压接设备',
    '1': '生成后的问题描述正文。',
  });

  const outputZip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const outputXml = await outputZip.file('word/document.xml')!.async('string');
  assert.match(outputXml, /生成后的问题描述正文/);
  assert.ok(outputZip.file('word/custom-preserved.xml'));
});

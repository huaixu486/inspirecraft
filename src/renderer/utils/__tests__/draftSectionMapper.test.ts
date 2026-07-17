import assert from 'node:assert/strict';
import test from 'node:test';
import type { WritingTemplate } from '../../../shared/types';
import { mapDraftToTemplateSections } from '../draftSectionMapper';

const template: WritingTemplate = {
  id: 'proposal',
  name: '提案表',
  description: '',
  category: '提案',
  nodes: [
    { id: '1', title: '一、 问题描述', level: 1, isRequired: true },
    { id: '2', title: '二、 研究意义', level: 1, isRequired: true },
    { id: 'keywords', title: '提案关键词', level: 1, isRequired: true },
  ],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

test('full AI draft is mapped to template node ids while markdown headings are removed', () => {
  const sections = mapDraftToTemplateSections(template, `# 铝钢绞线压接设备提案

**一、 问题描述**
当前导线压接依赖人工控制。

## 二、研究意义
该设备可提升施工质量。

提案关键词
导线压接；智能控制`);

  assert.match(sections['1'], /铝钢绞线压接设备提案/);
  assert.match(sections['1'], /依赖人工控制/);
  assert.equal(sections['2'], '该设备可提升施工质量。');
  assert.equal(sections.keywords, '导线压接；智能控制');
  assert.doesNotMatch(sections['1'], /一、 问题描述/);
});

test('unstructured draft is retained instead of being silently discarded', () => {
  assert.deepEqual(mapDraftToTemplateSections(template, '一份没有章节标题的完整正文'), {
    main: '一份没有章节标题的完整正文',
  });
});

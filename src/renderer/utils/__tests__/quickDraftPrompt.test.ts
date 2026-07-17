import assert from 'node:assert/strict';
import test from 'node:test';
import type { WritingTemplate } from '../../../shared/types';
import {
  buildQuickDraftTaskInstructions,
  buildQuickDraftTemplateContext,
} from '../quickDraftPrompt';

const makeTemplate = (overrides: Partial<WritingTemplate> = {}): WritingTemplate => ({
  id: 'template-1',
  name: '科技项目申报书',
  description: '用于科技项目申报',
  category: '申报材料',
  templateType: 'direct',
  nodes: [{
    id: 'node-1',
    title: '一、问题描述',
    level: 1,
    description: '说明实际应用场景',
    requirementText: '400-480字',
    exampleText: '范文采用现状、原因、影响、目标四段式展开。',
    isRequired: true,
  }],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...overrides,
});

test('direct templates expose structure, requirements, and example writing separately', () => {
  const context = buildQuickDraftTemplateContext(makeTemplate({
    requirementText: '不得遗漏应用场景',
  }));

  assert.equal(context.mode, 'direct');
  assert.match(context.requirements, /通用模板章节结构/);
  assert.match(context.requirements, /400-480字/);
  assert.match(context.requirements, /不得遗漏应用场景/);
  assert.match(context.examples, /四段式展开/);
});

test('example templates prioritize their analysis and mark headings as adaptable directions', () => {
  const context = buildQuickDraftTemplateContext(makeTemplate({
    templateType: 'example',
    exampleAnalysis: '采用问题—措施—成效的递进结构，语气正式。',
  }));

  assert.equal(context.mode, 'example');
  assert.match(context.requirements, /建议性写作方向/);
  assert.match(context.examples, /问题—措施—成效/);
});

test('first-draft instructions require a complete draft and only sparse fact markers', () => {
  const instructions = buildQuickDraftTaskInstructions('direct');

  assert.match(instructions, /完整第一稿/);
  assert.match(instructions, /资料有限/);
  assert.match(instructions, /少量、分散出现/);
  assert.match(instructions, /不要输出“【待补充/);
});

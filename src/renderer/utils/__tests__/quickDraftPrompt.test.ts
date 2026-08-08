import assert from 'node:assert/strict';
import test from 'node:test';
import type { WritingTemplate } from '../../../shared/types';
import {
  buildLongFormSectionPlan,
  buildLongFormSectionPrompt,
  buildQuickDraftTaskInstructions,
  buildQuickDraftTemplateContext,
  countDraftCharacters,
  selectRelevantReferenceExcerpts,
  shouldGenerateLongForm,
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

test('technical reports are split into sections and honor explicit length ranges', () => {
  const template = makeTemplate({
    name: '技术报告',
    category: '技术报告',
    nodes: [
      { id: '1', title: '一、项目背景', level: 1, isRequired: true, requirementText: '建议字数：约800-1000字' },
      { id: '2', title: '二、技术方案', level: 1, isRequired: true, requirementText: '不少于1500字' },
      { id: '3', title: '三、试验验证', level: 1, isRequired: true, requirementText: '600～800字' },
    ],
  });
  const plan = buildLongFormSectionPlan(template);

  assert.equal(plan.length, 3);
  assert.deepEqual([plan[0].targetMin, plan[0].targetMax], [800, 1000]);
  assert.deepEqual([plan[1].targetMin, plan[1].targetMax], [1500, 1875]);
  assert.deepEqual([plan[2].targetMin, plan[2].targetMax], [600, 800]);
  assert.equal(shouldGenerateLongForm(template, plan), true);
});

test('reference selection favors excerpts related to the current section', () => {
  const selected = selectRelevantReferenceExcerpts([
    { name: '背景.docx', kind: 'project', content: '项目背景主要介绍行业发展和建设必要性。' },
    { name: '试验.docx', kind: 'project', content: '试验验证采用缺陷样本集，统计识别准确率并分析误报漏报。' },
  ], '试验验证 识别准确率');

  assert.match(selected, /试验\.docx/);
  assert.match(selected, /识别准确率/);
});

test('section prompts request substantial body text without inventing experiment results', () => {
  const template = makeTemplate({ name: '技术报告' });
  const section = { ...buildLongFormSectionPlan(template)[0], targetMin: 1200, targetMax: 1500 };
  const prompt = buildLongFormSectionPrompt({
    template,
    section,
    sectionIndex: 0,
    sectionCount: 4,
    instruction: '先生成初稿，试验数据后续补充',
    projectContext: '导线缺陷检测项目',
    stageMemory: '暂无',
    references: '现有资料',
    templateContext: buildQuickDraftTemplateContext(template),
  });

  assert.match(prompt, /1200-1500/);
  assert.match(prompt, /待试验补充/);
  assert.match(prompt, /不重复输出章节标题/);
  assert.equal(countDraftCharacters('一 段\n正文'), 4);
});

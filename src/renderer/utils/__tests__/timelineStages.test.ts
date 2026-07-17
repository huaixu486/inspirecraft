import assert from 'node:assert/strict';
import test from 'node:test';
import { detectTimelineStage, getAllStages } from '../timelineStages';

const stages = getAllStages([]);

test('primary file name keywords take priority over conflicting path keywords', () => {
  assert.equal(
    detectTimelineStage(stages, '项目可研报告.docx', 'D:/项目/指南资料/项目可研报告.docx'),
    '可研',
  );
});

test('multiple keywords for the same stage strengthen that stage match', () => {
  assert.equal(
    detectTimelineStage(stages, '投标提案与可研说明.docx'),
    '提案',
  );
});

test('custom stage keywords participate in the shared detection rules', () => {
  const customStages = getAllStages([
    { id: 'custom-design', name: '初步设计', keywords: ['初设', '设计稿'], color: '#13c2c2' },
  ]);

  assert.equal(detectTimelineStage(customStages, '园区初设设计稿.docx'), '初步设计');
});

test('unmatched files fall back to the configured other stage', () => {
  assert.equal(detectTimelineStage(stages, '会议纪要.docx'), '其他');
});


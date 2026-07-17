import assert from 'node:assert/strict';
import test from 'node:test';
import type { PromptTemplate } from '../../../shared/types';
import { usePromptStore } from '../../stores/promptStore';
import { useSkillStore } from '../../stores/skillStore';
import { composePromptAsync } from '../promptComposer';

const rewriteTemplate: PromptTemplate = {
  id: 'builtin-rewrite',
  scene: 'rewrite',
  name: '章节改稿',
  content: '用户要求：{{requirement}}\n模板参考：{{example}}\n项目资料：{{reference}}',
  isBuiltin: true,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

test('async prompt composition loads missing prompt data before assembling user context', async () => {
  let promptLoadCount = 0;
  let skillLoadCount = 0;
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: {
      loadPromptTemplates: async () => {
        promptLoadCount += 1;
        return [rewriteTemplate];
      },
      loadSkillPackages: async () => {
        skillLoadCount += 1;
        return [];
      },
    },
  };
  usePromptStore.setState({ templates: [], isLoading: false });
  useSkillStore.setState({ skills: [], isLoading: false });

  const prompt = await composePromptAsync('rewrite', {
    requirement: '生成铝钢绞线压接设备提案表',
    example: '按提案表章节组织',
    reference: '项目用于输电线路导线压接',
  });

  assert.equal(promptLoadCount, 1);
  assert.equal(skillLoadCount, 1);
  assert.match(prompt, /铝钢绞线压接设备/);
  assert.match(prompt, /输电线路导线压接/);
});

test('async prompt composition fails visibly instead of calling AI with an empty context', async () => {
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: {
      loadPromptTemplates: async () => [],
      loadSkillPackages: async () => [],
    },
  };
  usePromptStore.setState({ templates: [], isLoading: false });
  useSkillStore.setState({ skills: [], isLoading: false });

  await assert.rejects(
    composePromptAsync('rewrite', { requirement: '必须保留的用户要求' }),
    /未能加载.*rewrite.*提示词模板/,
  );
});

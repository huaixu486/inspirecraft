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

test('long-form writing uses its exposed editable prompt and preserves user instructions', async () => {
  const longFormTemplate: PromptTemplate = {
    id: 'prompt-long-form',
    scene: 'longFormSection',
    name: '长篇分章写作',
    content: '公开配置：{{sectionTitle}}\n用户要求：{{instruction}}\n资料：{{references}}',
    isBuiltin: false,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
  (globalThis as typeof globalThis & { window: any }).window = {
    electronAPI: {
      loadPromptTemplates: async () => [longFormTemplate],
      loadSkillPackages: async () => [],
    },
  };
  usePromptStore.setState({ templates: [], isLoading: false });
  useSkillStore.setState({ skills: [], isLoading: false });

  const prompt = await composePromptAsync('longFormSection', {
    sectionTitle: '技术方案',
    instruction: '重点说明地锚钻旋入与调平协同控制',
    references: '施工记录与设备方案',
  });

  assert.match(prompt, /公开配置：技术方案/);
  assert.match(prompt, /地锚钻旋入与调平协同控制/);
  assert.match(prompt, /施工记录与设备方案/);
});

test('stage-specific prompt overrides the common prompt and other stages inherit common', async () => {
  const common: PromptTemplate = {
    id: 'draft-common', scene: 'draft', name: 'common', content: 'COMMON {{instruction}}',
    isBuiltin: false, createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
  };
  const proposal: PromptTemplate = {
    ...common,
    id: 'draft-proposal',
    name: 'proposal',
    content: 'PROPOSAL {{instruction}}',
    stageId: 'system-1',
    stageName: '提案',
  };
  usePromptStore.setState({ templates: [common, proposal], isLoading: false });
  useSkillStore.setState({ skills: [], isLoading: false });

  const proposalPrompt = await composePromptAsync('draft', { stage: '提案', instruction: 'write' });
  const researchPrompt = await composePromptAsync('draft', { stage: '可研', instruction: 'write' });

  assert.match(proposalPrompt, /阶段：提案/);
  assert.match(proposalPrompt, /PROPOSAL write/);
  assert.match(researchPrompt, /COMMON write/);
});

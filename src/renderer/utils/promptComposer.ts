import {
  CompositionWeightConfig,
  PromptScene,
  PromptTemplate,
  SkillPackage,
  StructuredPrompt,
} from '../../shared/types';
import { usePromptStore } from '../stores/promptStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSkillStore } from '../stores/skillStore';

function fillTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] ?? '');
}

function lineList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export function assembleStructuredPrompt(sp: StructuredPrompt): string {
  const parts: string[] = [];
  const role = sp.role.trim() || '\u4e13\u4e1a\u7684 AI \u52a9\u624b';
  parts.push(`\u4f60\u662f${role}\u3002`);

  const goals = sp.goals.map(g => g.trim()).filter(Boolean);
  if (goals.length > 0) {
    parts.push(`\n\u4efb\u52a1\u76ee\u6807\uff1a\n${lineList(goals)}`);
  }

  const enabledRules = sp.rules.filter(rule => rule.enabled && rule.text.trim());
  if (enabledRules.length > 0) {
    const ruleLabel = {
      must: '\u5fc5\u987b\u505a',
      must_not: '\u4e0d\u80fd\u505a',
      prefer: '\u4f18\u5148\u8003\u8651',
    } as const;
    parts.push(`\n\u6267\u884c\u89c4\u5219\uff1a\n${enabledRules.map((rule, index) => `${index + 1}. [${ruleLabel[rule.type]}] ${rule.text.trim()}`).join('\n')}`);
  }

  const fields = sp.outputFields.filter(field => field.label.trim() || field.description.trim());
  if (fields.length > 0) {
    parts.push(`\n\u8f93\u51fa\u5185\u5bb9\u7ed3\u6784\uff1a\n${fields.map(field => {
      const key = field.key.trim();
      const label = field.label.trim() || key;
      const desc = field.description.trim();
      return `- ${label}${key ? ` (${key})` : ''}\uff1a${desc}`;
    }).join('\n')}`);
  }

  parts.push('\n\u4f18\u5148\u9075\u5faa\u5f53\u524d\u6587\u6863\u4e8b\u5b9e\u3001\u6a21\u677f\u786c\u6027\u8981\u6c42\u548c\u7528\u6237\u660e\u786e\u6307\u4ee4\u3002\u4fe1\u606f\u4e0d\u8db3\u65f6\u8bf7\u6807\u8bb0\u9700\u8981\u4eba\u5de5\u8865\u5145\uff0c\u4e0d\u8981\u7f16\u9020\u6570\u636e\u3002');

  return parts.join('\n');
}

export function getEffectivePromptContent(template: PromptTemplate): string {
  if (template.structured?.mode === 'structured') {
    return assembleStructuredPrompt(template.structured);
  }
  return template.structured?.rawPrompt || template.content;
}

export function composePrompt(
  scene: PromptScene,
  context: Record<string, string>,
  overrides?: PromptTemplate[],
): string {
  const store = usePromptStore.getState();
  const templates = overrides || store.templates;
  const sceneTemplates = templates.filter(t => t.scene === scene);
  const chosen = sceneTemplates.find(t => !t.isBuiltin) || sceneTemplates.find(t => t.isBuiltin);

  if (!chosen) {
    console.warn(`[promptComposer] No template found for scene: ${scene}`);
    return '';
  }

  const weights = getActiveCompositionWeights(undefined, scene);
  const basePrompt = fillTemplate(getEffectivePromptContent(chosen), context);
  const sourcePrioritySection = `\n\n[本场景来源优先级]\n${getCompositionRules(scene, weights).map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`;
  const skillStore = useSkillStore.getState();
  const activeSkills = skillStore.getEnabledByScene(scene);

  if (activeSkills.length === 0) {
    return basePrompt + sourcePrioritySection;
  }

  const skillSections = buildSkillSections(activeSkills, scene, weights);
  const rulesSection = buildRulesSection(activeSkills);

  if (skillSections.length === 0) {
    return basePrompt + sourcePrioritySection + rulesSection;
  }

  return `${basePrompt}

[Skill \u589e\u5f3a\u5c42 - \u4ee5\u4e0b\u4e3a\u9644\u52a0\u6307\u5bfc\uff0c\u4e0d\u5f97\u8986\u76d6\u4e0a\u8ff0\u6a21\u677f\u8981\u6c42]
${skillSections.join('\n\n')}${rulesSection}${sourcePrioritySection}`;
}

export async function composePromptAsync(
  scene: PromptScene,
  context: Record<string, string>,
): Promise<string> {
  const store = usePromptStore.getState();
  if (store.templates.length === 0) {
    await store.loadTemplates();
  }
  const skillStore = useSkillStore.getState();
  if (skillStore.skills.length === 0) {
    await skillStore.loadSkills();
  }
  const prompt = composePrompt(scene, context);
  if (!prompt.trim()) {
    throw new Error(`未能加载“${scene}”场景的提示词模板，请重试或检查提示词设置`);
  }
  return prompt;
}

export function previewCompose(
  templateContent: string,
  context: Record<string, string>,
): string {
  return fillTemplate(templateContent, context);
}

export function extractPlaceholders(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
}

export function previewComposeWithSkills(
  templateContent: string,
  context: Record<string, string>,
  skills: SkillPackage[],
  scene: PromptScene,
): string {
  const base = fillTemplate(templateContent, context);
  const activeSkills = skills
    .filter(s => s.enabled && s.type.includes(scene))
    .sort((a, b) => b.weight - a.weight);

  if (activeSkills.length === 0) return base;

  const weights = getActiveCompositionWeights(undefined, scene);
  const skillSections = buildSkillSections(activeSkills, scene, weights);
  const rulesSection = buildRulesSection(activeSkills);

  if (skillSections.length === 0) return base + rulesSection;

  return `${base}

[Skill \u589e\u5f3a\u5c42 - \u4ee5\u4e0b\u4e3a\u9644\u52a0\u6307\u5bfc\uff0c\u4e0d\u5f97\u8986\u76d6\u4e0a\u8ff0\u6a21\u677f\u8981\u6c42]
${skillSections.join('\n\n')}${rulesSection}`;
}

function buildSkillSections(skills: SkillPackage[], scene: PromptScene, weights: CompositionWeightConfig): string[] {
  const sections: string[] = [];
  for (const skill of skills) {
    const skillPrompt = skill.prompts[scene];
    if (!skillPrompt) continue;
    const cappedWeight = Math.min(skill.weight, weights.SKILL_MAX_CAP);
    sections.push(`[Skill: ${skill.name} (\u6743\u91cd ${cappedWeight})]\n${skillPrompt}`);
  }
  return sections;
}

function buildRulesSection(skills: SkillPackage[]): string {
  const allRules = skills.flatMap(skill => skill.rules).filter(Boolean);
  return allRules.length > 0
    ? `\n\n[Skill \u589e\u5f3a\u89c4\u5219]\n${allRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`
    : '';
}

export type PromptSourceType = 'system' | 'user' | 'skill' | 'project';

export interface PromptSource {
  type: PromptSourceType;
  label: string;
  weight: number;
  description: string;
  content?: string;
  isUsed: boolean;
}

export const WEIGHT_CONSTANTS: CompositionWeightConfig = {
  CURRENT_DOCUMENT: 100,
  TEMPLATE_REQUIREMENT: 95,
  USER_EXPLICIT_INPUT: 90,
  USER_CUSTOM_PROMPT: 75,
  STAGE_MEMORY: 55,
  SKILL_GLOBAL: 35,
  SKILL_REPORT: 55,
  SKILL_REVIEW: 60,
  SKILL_WRITING: 50,
  SKILL_MAX_CAP: 70,
  REFERENCE_MATERIAL: 35,
  SYSTEM_DEFAULT: 25,
};

export const SCENE_WEIGHT_KEYS: Record<PromptScene, Array<keyof CompositionWeightConfig>> = {
  report: ['CURRENT_DOCUMENT', 'TEMPLATE_REQUIREMENT', 'USER_EXPLICIT_INPUT', 'USER_CUSTOM_PROMPT', 'STAGE_MEMORY', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_REPORT', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  review: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'USER_CUSTOM_PROMPT', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_REVIEW', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  rewrite: ['CURRENT_DOCUMENT', 'TEMPLATE_REQUIREMENT', 'USER_EXPLICIT_INPUT', 'USER_CUSTOM_PROMPT', 'STAGE_MEMORY', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_WRITING', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  diff: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'USER_CUSTOM_PROMPT', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_REVIEW', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  summary: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'USER_CUSTOM_PROMPT', 'STAGE_MEMORY', 'SKILL_GLOBAL', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  memory: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  description: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  taskExecute: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'USER_CUSTOM_PROMPT', 'STAGE_MEMORY', 'REFERENCE_MATERIAL', 'SKILL_GLOBAL', 'SKILL_WRITING', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  sectionAnalysis: ['CURRENT_DOCUMENT', 'TEMPLATE_REQUIREMENT', 'USER_EXPLICIT_INPUT', 'SKILL_GLOBAL', 'SKILL_REVIEW', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
  templateExtract: ['CURRENT_DOCUMENT', 'USER_EXPLICIT_INPUT', 'SKILL_GLOBAL', 'SKILL_MAX_CAP', 'SYSTEM_DEFAULT'],
};

export function getActiveCompositionWeights(override?: CompositionWeightConfig | null, scene?: PromptScene): CompositionWeightConfig {
  const settings = useSettingsStore.getState();
  const custom = override ?? (scene ? settings.compositionWeightsByScene?.[scene] ?? settings.compositionWeights : settings.compositionWeights);
  return {
    ...WEIGHT_CONSTANTS,
    ...(custom || {}),
  };
}

function getSkillWeightForScene(skill: SkillPackage, scene: PromptScene, weights: CompositionWeightConfig): number {
  if (skill.type.includes('review') || skill.type.includes('diff')) return weights.SKILL_REVIEW;
  if (skill.type.includes('report')) return weights.SKILL_REPORT;
  if (skill.type.includes('rewrite') || skill.type.includes('taskExecute')) return weights.SKILL_WRITING;
  return weights.SKILL_GLOBAL;
}

export function getCompositionSources(scene: PromptScene, overrideWeights?: CompositionWeightConfig | null): PromptSource[] {
  const promptStore = usePromptStore.getState();
  const skillStore = useSkillStore.getState();
  const weights = getActiveCompositionWeights(overrideWeights, scene);
  const supports = (key: keyof CompositionWeightConfig) => SCENE_WEIGHT_KEYS[scene].includes(key);
  const sources: PromptSource[] = [
    ...(supports('CURRENT_DOCUMENT') ? [{
      type: 'project' as const,
      label: '\u5f53\u524d\u6587\u6863\u4e8b\u5b9e',
      weight: weights.CURRENT_DOCUMENT,
      description: '\u7528\u6237\u5f53\u524d\u6253\u5f00\u6216\u9009\u4e2d\u7684\u6587\u6863\u5185\u5bb9',
      isUsed: true,
    }] : []),
    ...(supports('TEMPLATE_REQUIREMENT') ? [{
      type: 'project' as const,
      label: '\u6a21\u677f\u786c\u6027\u8981\u6c42',
      weight: weights.TEMPLATE_REQUIREMENT,
      description: '\u7ae0\u8282\u3001\u683c\u5f0f\u548c\u586b\u5199\u8981\u6c42',
      isUsed: true,
    }] : []),
    ...(supports('USER_EXPLICIT_INPUT') ? [{
      type: 'project' as const,
      label: '\u7528\u6237\u660e\u786e\u8f93\u5165',
      weight: weights.USER_EXPLICIT_INPUT,
      description: '\u7528\u6237\u5728\u5f53\u524d\u64cd\u4f5c\u4e2d\u8f93\u5165\u7684\u76f4\u63a5\u8981\u6c42',
      isUsed: true,
    }] : []),
    {
      type: 'project' as const,
      label: '\u9636\u6bb5\u8bb0\u5fc6',
      weight: weights.STAGE_MEMORY,
      description: '\u9879\u76ee\u9636\u6bb5\u5b8c\u6210\u540e\u6c89\u6dc0\u7684\u53ef\u590d\u7528\u7ecf\u9a8c',
      isUsed: true,
    },
    {
      type: 'project' as const,
      label: '\u53c2\u8003\u6750\u6599',
      weight: weights.REFERENCE_MATERIAL,
      description: '\u53ea\u63d0\u4f9b\u8bc1\u636e\u548c\u7d20\u6750\uff0c\u4e0d\u4f5c\u4e3a\u552f\u4e00\u7ed3\u8bba\u6765\u6e90',
      isUsed: true,
    },
  ];
  const builtinTemplate = promptStore.templates.find(t => t.scene === scene && t.isBuiltin);
  const userTemplate = promptStore.templates.find(t => t.scene === scene && !t.isBuiltin);

  if (userTemplate && supports('USER_CUSTOM_PROMPT')) {
    sources.push({
      type: 'user',
      label: '\u7528\u6237\u81ea\u5b9a\u4e49\u6a21\u677f',
      weight: weights.USER_CUSTOM_PROMPT,
      description: '\u7528\u6237\u5728\u8bbe\u7f6e\u9875\u4fee\u6539\u540e\u7684\u63d0\u793a\u8bcd',
      content: getEffectivePromptContent(userTemplate).slice(0, 200),
      isUsed: true,
    });
  }

  if (builtinTemplate && supports('SYSTEM_DEFAULT')) {
    sources.push({
      type: 'system',
      label: '\u7cfb\u7edf\u9ed8\u8ba4\u6a21\u677f',
      weight: weights.SYSTEM_DEFAULT,
      description: userTemplate ? '\u5df2\u88ab\u7528\u6237\u81ea\u5b9a\u4e49\u6a21\u677f\u8986\u76d6' : '\u7cfb\u7edf\u5185\u7f6e\u7684\u57fa\u7840\u63d0\u793a\u8bcd',
      content: getEffectivePromptContent(builtinTemplate).slice(0, 200),
      isUsed: !userTemplate,
    });
  }

  for (const skill of skillStore.getEnabledByScene(scene)) {
    const skillPrompt = skill.prompts[scene];
    if (!skillPrompt) continue;
    sources.push({
      type: 'skill',
      label: `Skill: ${skill.name}`,
      weight: Math.min(skill.weight || getSkillWeightForScene(skill, scene, weights), weights.SKILL_MAX_CAP),
      description: '\u5df2\u542f\u7528\u7684 Skill \u5305\u9644\u52a0\u80fd\u529b\uff0c\u53ea\u4f5c\u4e3a\u589e\u5f3a\u5c42',
      content: skillPrompt.slice(0, 200),
      isUsed: true,
    });
  }

  return sources
    .filter(source => {
      if (source.label === '阶段记忆') return supports('STAGE_MEMORY');
      if (source.label === '参考资料') return supports('REFERENCE_MATERIAL');
      return true;
    })
    .sort((a, b) => b.weight - a.weight);
}

export function getCompositionRules(scene: PromptScene, weights: CompositionWeightConfig = getActiveCompositionWeights(undefined, scene)): string[] {
  const labels: Partial<Record<keyof CompositionWeightConfig, string>> = {
    CURRENT_DOCUMENT: '当前文档事实', TEMPLATE_REQUIREMENT: '模板硬性要求', USER_EXPLICIT_INPUT: '用户明确输入', USER_CUSTOM_PROMPT: '用户自定义提示词', STAGE_MEMORY: '阶段记忆', REFERENCE_MATERIAL: '参考资料', SKILL_GLOBAL: '通用 Skill', SKILL_REPORT: '报告 Skill', SKILL_REVIEW: '审查/对比 Skill', SKILL_WRITING: '写作/修订 Skill', SYSTEM_DEFAULT: '系统默认模板',
  };
  const keys = SCENE_WEIGHT_KEYS[scene];
  const ordinary = keys.filter(key => !['SKILL_MAX_CAP', 'SKILL_GLOBAL', 'SKILL_REPORT', 'SKILL_REVIEW', 'SKILL_WRITING'].includes(key));
  const skillKeys = keys.filter(key => ['SKILL_GLOBAL', 'SKILL_REPORT', 'SKILL_REVIEW', 'SKILL_WRITING'].includes(key));
  return [
    `本场景参与来源：${ordinary.map(key => `${labels[key]} ${weights[key]}`).join('，')}`,
    skillKeys.length ? `Skill 优先级：${skillKeys.map(key => `${labels[key]} ${weights[key]}`).join('，')}` : '',
    `单个 Skill 的有效权重不超过 ${weights.SKILL_MAX_CAP}，且不能覆盖用户明确输入或模板硬性要求。`,
  ].filter(Boolean);
}

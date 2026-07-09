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

  const weights = getActiveCompositionWeights();
  const basePrompt = fillTemplate(getEffectivePromptContent(chosen), context);
  const skillStore = useSkillStore.getState();
  const activeSkills = skillStore.getEnabledByScene(scene);

  if (activeSkills.length === 0) {
    return basePrompt;
  }

  const skillSections = buildSkillSections(activeSkills, scene, weights);
  const rulesSection = buildRulesSection(activeSkills);

  if (skillSections.length === 0) {
    return basePrompt + rulesSection;
  }

  return `${basePrompt}

[Skill \u589e\u5f3a\u5c42 - \u4ee5\u4e0b\u4e3a\u9644\u52a0\u6307\u5bfc\uff0c\u4e0d\u5f97\u8986\u76d6\u4e0a\u8ff0\u6a21\u677f\u8981\u6c42]
${skillSections.join('\n\n')}${rulesSection}`;
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
  return composePrompt(scene, context);
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

  const weights = getActiveCompositionWeights();
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

export function getActiveCompositionWeights(override?: CompositionWeightConfig | null): CompositionWeightConfig {
  const custom = override ?? useSettingsStore.getState().compositionWeights;
  return {
    ...WEIGHT_CONSTANTS,
    ...(custom || {}),
  };
}

function getSkillWeightForScene(skill: SkillPackage, scene: PromptScene, weights: CompositionWeightConfig): number {
  if (skill.type.includes('review')) return weights.SKILL_REVIEW;
  if (skill.type.includes('report')) return weights.SKILL_REPORT;
  if (skill.type.includes('rewrite') || skill.type.includes('taskExecute')) return weights.SKILL_WRITING;
  return weights.SKILL_GLOBAL;
}

export function getCompositionSources(scene: PromptScene, overrideWeights?: CompositionWeightConfig | null): PromptSource[] {
  const promptStore = usePromptStore.getState();
  const skillStore = useSkillStore.getState();
  const weights = getActiveCompositionWeights(overrideWeights);
  const sources: PromptSource[] = [
    {
      type: 'project',
      label: '\u5f53\u524d\u6587\u6863\u4e8b\u5b9e',
      weight: weights.CURRENT_DOCUMENT,
      description: '\u7528\u6237\u5f53\u524d\u6253\u5f00\u6216\u9009\u4e2d\u7684\u6587\u6863\u5185\u5bb9',
      isUsed: true,
    },
    {
      type: 'project',
      label: '\u6a21\u677f\u786c\u6027\u8981\u6c42',
      weight: weights.TEMPLATE_REQUIREMENT,
      description: '\u7ae0\u8282\u3001\u683c\u5f0f\u548c\u586b\u5199\u8981\u6c42',
      isUsed: true,
    },
    {
      type: 'project',
      label: '\u7528\u6237\u660e\u786e\u8f93\u5165',
      weight: weights.USER_EXPLICIT_INPUT,
      description: '\u7528\u6237\u5728\u5f53\u524d\u64cd\u4f5c\u4e2d\u8f93\u5165\u7684\u76f4\u63a5\u8981\u6c42',
      isUsed: true,
    },
    {
      type: 'project',
      label: '\u9636\u6bb5\u8bb0\u5fc6',
      weight: weights.STAGE_MEMORY,
      description: '\u9879\u76ee\u9636\u6bb5\u5b8c\u6210\u540e\u6c89\u6dc0\u7684\u53ef\u590d\u7528\u7ecf\u9a8c',
      isUsed: true,
    },
    {
      type: 'project',
      label: '\u53c2\u8003\u6750\u6599',
      weight: weights.REFERENCE_MATERIAL,
      description: '\u53ea\u63d0\u4f9b\u8bc1\u636e\u548c\u7d20\u6750\uff0c\u4e0d\u4f5c\u4e3a\u552f\u4e00\u7ed3\u8bba\u6765\u6e90',
      isUsed: true,
    },
  ];
  const builtinTemplate = promptStore.templates.find(t => t.scene === scene && t.isBuiltin);
  const userTemplate = promptStore.templates.find(t => t.scene === scene && !t.isBuiltin);

  if (userTemplate) {
    sources.push({
      type: 'user',
      label: '\u7528\u6237\u81ea\u5b9a\u4e49\u6a21\u677f',
      weight: weights.USER_CUSTOM_PROMPT,
      description: '\u7528\u6237\u5728\u8bbe\u7f6e\u9875\u4fee\u6539\u540e\u7684\u63d0\u793a\u8bcd',
      content: getEffectivePromptContent(userTemplate).slice(0, 200),
      isUsed: true,
    });
  }

  if (builtinTemplate) {
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

  return sources.sort((a, b) => b.weight - a.weight);
}

export function getCompositionRules(weights: CompositionWeightConfig = getActiveCompositionWeights()): string[] {
  return [
    `\u5f53\u524d\u6587\u6863\u4e8b\u5b9e\u6743\u91cd ${weights.CURRENT_DOCUMENT}\uff0c\u6a21\u677f\u786c\u6027\u8981\u6c42\u6743\u91cd ${weights.TEMPLATE_REQUIREMENT}`,
    `\u7528\u6237\u660e\u786e\u8f93\u5165\u6743\u91cd ${weights.USER_EXPLICIT_INPUT}\uff0c\u7528\u6237\u81ea\u5b9a\u4e49\u63d0\u793a\u8bcd\u6743\u91cd ${weights.USER_CUSTOM_PROMPT}`,
    `Skill \u5305\u6743\u91cd\u4e0a\u9650 ${weights.SKILL_MAX_CAP}\uff0c\u4e0d\u80fd\u8986\u76d6\u6a21\u677f\u786c\u6027\u8981\u6c42`,
    `\u9636\u6bb5\u8bb0\u5fc6\u6743\u91cd ${weights.STAGE_MEMORY}\uff0c\u53c2\u8003\u6750\u6599\u6743\u91cd ${weights.REFERENCE_MATERIAL}`,
    `\u7cfb\u7edf\u9ed8\u8ba4\u6a21\u677f\u6743\u91cd ${weights.SYSTEM_DEFAULT}\uff0c\u4ec5\u5728\u6ca1\u6709\u81ea\u5b9a\u4e49\u6a21\u677f\u65f6\u4f5c\u4e3a\u57fa\u7840\u89c4\u5219`,
  ];
}
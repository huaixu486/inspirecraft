import type { AIConfig, PromptTemplate, SkillPackage } from '../types';
import { defineIpcHandler } from './registry';

export const isAiIpc = (channel: string) => /^(ai|prompt|skill):/.test(channel);

export const definePromptIpc = (deps: {
  load: () => PromptTemplate[];
  save: (templates: PromptTemplate[]) => void;
  defaults: () => PromptTemplate[];
}) => {
  defineIpcHandler('prompt:loadAll', async () => deps.load());
  defineIpcHandler('prompt:save', async (_event, template: PromptTemplate) => {
    const templates = deps.load();
    const index = templates.findIndex(item => item.id === template.id);
    if (index >= 0) templates[index] = template;
    else templates.push(template);
    deps.save(templates);
  });
  defineIpcHandler('prompt:reset', async (_event, id: string) => {
    const defaultTemplate = deps.defaults().find(item => item.id === id);
    if (!defaultTemplate) return;
    const templates = deps.load();
    const index = templates.findIndex(item => item.id === id);
    if (index >= 0) templates[index] = defaultTemplate;
    else templates.push(defaultTemplate);
    deps.save(templates);
  });
};

export const defineSkillIpc = (deps: {
  load: () => SkillPackage[];
  save: (skills: SkillPackage[]) => void;
  importExternal: () => Promise<unknown>;
}) => {
  defineIpcHandler('skill:loadAll', async () => deps.load());
  defineIpcHandler('skill:import', async (_event, pkg: SkillPackage) => {
    const skills = deps.load();
    const index = skills.findIndex(item => item.id === pkg.id);
    if (index >= 0) skills[index] = pkg;
    else skills.push(pkg);
    deps.save(skills);
    return pkg;
  });
  defineIpcHandler('skill:importExternal', async () => deps.importExternal());
  defineIpcHandler('skill:delete', async (_event, id: string) => deps.save(deps.load().filter(item => item.id !== id)));
  defineIpcHandler('skill:setEnabled', async (_event, id: string, enabled: boolean) => {
    const skills = deps.load();
    const skill = skills.find(item => item.id === id);
    if (skill) {
      skill.enabled = enabled;
      deps.save(skills);
    }
  });
  defineIpcHandler('skill:setWeight', async (_event, id: string, weight: number) => {
    const skills = deps.load();
    const skill = skills.find(item => item.id === id);
    if (skill) {
      skill.weight = Math.max(0, Math.min(100, weight));
      deps.save(skills);
    }
  });
};

export const defineAiRuntimeIpc = (deps: {
  loadConfig: () => AIConfig | null;
  saveConfig: (config: AIConfig) => void;
  call: (request: any) => Promise<unknown>;
  usageStatistics: () => unknown;
  usageForRequest: (requestId: string) => unknown;
  callParallelDetails: (params: any) => Promise<unknown>;
  generateSummary: (content: string) => Promise<unknown>;
  reviewSuggestion: (params: { content: string; template: string }) => Promise<unknown>;
}) => {
  defineIpcHandler('ai:loadConfig', async () => deps.loadConfig());
  defineIpcHandler('ai:saveConfig', async (_event, config: AIConfig) => deps.saveConfig(config));
  defineIpcHandler('ai:call', async (_event, request: any) => deps.call(request));
  defineIpcHandler('ai:usageStatistics', async () => deps.usageStatistics());
  defineIpcHandler('ai:usageForRequest', async (_event, requestId: string) => deps.usageForRequest(requestId));
  defineIpcHandler('ai:callParallelDetails', async (_event, params: any) => deps.callParallelDetails(params));
  defineIpcHandler('ai:generateSummary', async (_event, content: string) => deps.generateSummary(content));
  defineIpcHandler('ai:reviewSuggestion', async (_event, params: { content: string; template: string }) => deps.reviewSuggestion(params));
};

import { AIConfig, AIModelConfig } from '../types';

export function normalizeAIConfig(config: AIConfig | null): AIConfig | null {
  if (!config) return null;
  if (Array.isArray(config.models) && config.models.length > 0) {
    const models = config.models.map((model, index) => ({
      ...model,
      id: model.id || `model-${Date.now()}-${index}`,
      name: model.name || model.model || `模型 ${index + 1}`,
      enabled: model.enabled !== false,
    }));
    const activeModelId = config.activeModelId && models.some(model => model.id === config.activeModelId)
      ? config.activeModelId
      : models[0].id;
    const parallelModelIds = (config.parallelModelIds || [activeModelId]).filter(id => models.some(model => model.id === id));
    return {
      models,
      activeModelId,
      parallelModelIds: parallelModelIds.length > 0 ? parallelModelIds : [activeModelId],
      multiModelMode: config.multiModelMode || 'single',
    };
  }

  if (config.provider && config.apiKey && config.model) {
    const legacyModel: AIModelConfig = {
      id: 'default',
      name: config.model,
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      endpoint: config.endpoint,
      enabled: true,
    };
    return {
      models: [legacyModel],
      activeModelId: legacyModel.id,
      parallelModelIds: [legacyModel.id],
      multiModelMode: 'single',
    };
  }

  return { models: [], multiModelMode: 'single' };
}

export function getEnabledAIModels(config: AIConfig | null): AIModelConfig[] {
  return normalizeAIConfig(config)?.models?.filter(model => model.enabled !== false && model.apiKey && model.model) || [];
}

export function getActiveAIModel(config: AIConfig | null, modelId?: string): AIModelConfig | null {
  const normalized = normalizeAIConfig(config);
  const models = getEnabledAIModels(normalized);
  if (models.length === 0) return null;
  return models.find(model => model.id === modelId)
    || models.find(model => model.id === normalized?.activeModelId)
    || models[0];
}

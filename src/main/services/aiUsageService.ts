import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { EventEmitter } from 'events';
import { AIModelConfig } from '../types';
import { aiUsageFile } from '../shared/paths';

export type TokenUsageSource = 'reported' | 'estimated';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: TokenUsageSource;
}

export interface AIUsageRecord extends TokenUsage {
  id: string;
  createdAt: string;
  modelId?: string;
  modelName: string;
  model: string;
  provider: AIModelConfig['provider'];
  requestId?: string;
}

const MAX_RECORDS = 20000;
const requestContext = new AsyncLocalStorage<string>();
const activityEvents = new EventEmitter();

export type AIActivityStatus = 'started' | 'completed' | 'failed';

export interface AIActivity {
  id: string;
  status: AIActivityStatus;
  createdAt: string;
  modelName: string;
  model: string;
  requestId?: string;
  error?: string;
}

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

const normalizeUsage = (usage?: Partial<TokenUsage>): TokenUsage => {
  const inputTokens = safeNumber(usage?.inputTokens);
  const outputTokens = safeNumber(usage?.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: safeNumber(usage?.totalTokens) || inputTokens + outputTokens,
    source: usage?.source === 'reported' ? 'reported' : 'estimated',
  };
};

function loadRecords(): AIUsageRecord[] {
  try {
    if (!fs.existsSync(aiUsageFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(aiUsageFile, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map((record: any) => ({
      ...record,
      ...normalizeUsage(record),
    })).filter((record: AIUsageRecord) => record.createdAt && record.model);
  } catch {
    return [];
  }
}

function saveRecords(records: AIUsageRecord[]) {
  try {
    fs.mkdirSync(path.dirname(aiUsageFile), { recursive: true });
    fs.writeFileSync(aiUsageFile, JSON.stringify(records.slice(-MAX_RECORDS), null, 2), 'utf-8');
  } catch (error) {
    console.warn('[AI Usage] Failed to persist usage:', error);
  }
}

export function runWithAIUsageContext<T>(requestId: string, callback: () => Promise<T>): Promise<T> {
  return requestContext.run(requestId, callback);
}

export const getAIUsageContext = () => requestContext.getStore();

export function emitAIActivity(activity: Omit<AIActivity, 'createdAt' | 'requestId'>) {
  activityEvents.emit('activity', {
    ...activity,
    createdAt: new Date().toISOString(),
    requestId: requestContext.getStore(),
  } satisfies AIActivity);
}

export function onAIActivity(listener: (activity: AIActivity) => void) {
  activityEvents.on('activity', listener);
  return () => activityEvents.off('activity', listener);
}

export function recordAIUsage(model: AIModelConfig, usage: Partial<TokenUsage>): AIUsageRecord {
  const normalized = normalizeUsage(usage);
  const record: AIUsageRecord = {
    id: `ai-usage-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    modelId: model.id,
    modelName: model.name || model.model,
    model: model.model,
    provider: model.provider,
    requestId: requestContext.getStore(),
    ...normalized,
  };
  const records = loadRecords();
  records.push(record);
  saveRecords(records);
  return record;
}

export function getAIUsageRecords(requestId?: string): AIUsageRecord[] {
  const records = loadRecords();
  const filtered = requestId ? records.filter(record => record.requestId === requestId) : records;
  return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function sumAIUsage(records: AIUsageRecord[]): TokenUsage {
  const values = records.reduce((total, record) => ({
    inputTokens: total.inputTokens + record.inputTokens,
    outputTokens: total.outputTokens + record.outputTokens,
    totalTokens: total.totalTokens + record.totalTokens,
    source: total.source === 'estimated' || record.source === 'estimated' ? 'estimated' as const : 'reported' as const,
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'reported' as TokenUsageSource });
  return values;
}

export function getAIUsageStatistics() {
  const records = getAIUsageRecords();
  const now = new Date();
  const hourStart = new Date(now); hourStart.setMinutes(0, 0, 0);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const after = (start: Date) => records.filter(record => new Date(record.createdAt).getTime() >= start.getTime());
  const byModel = Array.from(records.reduce((groups, record) => {
    const key = `${record.modelId || ''}:${record.model}`;
    const group = groups.get(key) || { modelId: record.modelId, modelName: record.modelName, model: record.model, provider: record.provider, records: [] as AIUsageRecord[] };
    group.records.push(record);
    groups.set(key, group);
    return groups;
  }, new Map<string, { modelId?: string; modelName: string; model: string; provider: AIModelConfig['provider']; records: AIUsageRecord[] }>()).values())
    .map(group => ({ ...group, ...sumAIUsage(group.records) }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .map(({ records: _records, ...group }) => group);

  return {
    total: sumAIUsage(records),
    hourly: sumAIUsage(after(hourStart)),
    daily: sumAIUsage(after(dayStart)),
    monthly: sumAIUsage(after(monthStart)),
    byModel,
    recent: records.slice(0, 60),
  };
}

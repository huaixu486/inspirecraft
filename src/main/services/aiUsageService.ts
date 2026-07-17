import { AsyncLocalStorage } from 'async_hooks';
import { EventEmitter } from 'events';
import { AIModelConfig } from '../types';
import { aiUsageFile } from '../shared/paths';
import { readVersionedJsonFile, writeVersionedJsonFile } from '../shared/versionedJson';

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
  correlationId?: string;
  workItemId?: string;
  requestTitle?: string;
  scene?: string;
  durationMs?: number;
  status?: 'completed' | 'failed';
}

const MAX_RECORDS = 20000;
export type AIUsageContext = {
  requestId: string;
  correlationId?: string;
  workItemId?: string;
  requestTitle?: string;
  scene?: string;
  startedAt?: number;
};
const requestContext = new AsyncLocalStorage<AIUsageContext>();
const activityEvents = new EventEmitter();

export type AIActivityStatus = 'started' | 'completed' | 'failed';

export interface AIActivity {
  id: string;
  status: AIActivityStatus;
  createdAt: string;
  modelName: string;
  model: string;
  requestId?: string;
  correlationId?: string;
  workItemId?: string;
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
  const parsed = readVersionedJsonFile<AIUsageRecord[]>(aiUsageFile, []).data;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(Boolean).map((record: any) => ({
    ...record,
    ...normalizeUsage(record),
  })).filter((record: AIUsageRecord) => record.createdAt && record.model);
}

function saveRecords(records: AIUsageRecord[]) {
  try {
    writeVersionedJsonFile(aiUsageFile, records.slice(-MAX_RECORDS));
  } catch (error) {
    console.warn('[AI Usage] Failed to persist usage:', error);
  }
}

export function runWithAIUsageContext<T>(context: string | AIUsageContext, callback: () => Promise<T>): Promise<T> {
  const normalized = typeof context === 'string' ? { requestId: context } : context;
  return requestContext.run({
    ...normalized,
    correlationId: normalized.correlationId || normalized.requestId,
    startedAt: normalized.startedAt || Date.now(),
  }, callback);
}

export const getAIUsageContext = () => requestContext.getStore()?.requestId;

export function emitAIActivity(activity: Omit<AIActivity, 'createdAt' | 'requestId'>) {
  activityEvents.emit('activity', {
    ...activity,
    createdAt: new Date().toISOString(),
    requestId: requestContext.getStore()?.requestId,
    correlationId: requestContext.getStore()?.correlationId,
    workItemId: requestContext.getStore()?.workItemId,
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
    requestId: requestContext.getStore()?.requestId,
    correlationId: requestContext.getStore()?.correlationId,
    workItemId: requestContext.getStore()?.workItemId,
    requestTitle: requestContext.getStore()?.requestTitle,
    scene: requestContext.getStore()?.scene,
    durationMs: requestContext.getStore()?.startedAt ? Math.max(0, Date.now() - requestContext.getStore()!.startedAt!) : undefined,
    status: 'completed',
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
  const byTask = Array.from(records.reduce((groups, record) => {
    const key = record.requestId || `legacy:${record.id}`;
    const legacyTitle = record.requestId?.startsWith('task:') ? 'AI 任务执行' : '未标记任务';
    const group = groups.get(key) || { requestId: record.requestId, correlationId: record.correlationId, workItemId: record.workItemId, requestTitle: record.requestTitle || legacyTitle, scene: record.scene, records: [] as AIUsageRecord[] };
    group.records.push(record);
    if (record.requestTitle) group.requestTitle = record.requestTitle;
    if (record.scene) group.scene = record.scene;
    groups.set(key, group);
    return groups;
  }, new Map<string, { requestId?: string; correlationId?: string; workItemId?: string; requestTitle: string; scene?: string; records: AIUsageRecord[] }>()).values())
    .map(group => ({
      ...sumAIUsage(group.records),
      requestId: group.requestId,
      correlationId: group.correlationId,
      workItemId: group.workItemId,
      requestTitle: group.requestTitle,
      scene: group.scene,
      requestCount: group.records.length,
      firstAt: group.records.reduce((min, item) => min < item.createdAt ? min : item.createdAt, group.records[0].createdAt),
      lastAt: group.records.reduce((max, item) => max > item.createdAt ? max : item.createdAt, group.records[0].createdAt),
      models: [...new Set(group.records.map(item => item.modelName || item.model))],
    }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  const trendStart = new Date(now); trendStart.setDate(now.getDate() - 6); trendStart.setHours(0, 0, 0, 0);
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(trendStart); date.setDate(trendStart.getDate() + index);
    const next = new Date(date); next.setDate(date.getDate() + 1);
    const values = records.filter(record => { const time = new Date(record.createdAt).getTime(); return time >= date.getTime() && time < next.getTime(); });
    return { date: date.toISOString().slice(0, 10), requestCount: values.length, ...sumAIUsage(values) };
  });

  return {
    total: sumAIUsage(records),
    hourly: sumAIUsage(after(hourStart)),
    daily: sumAIUsage(after(dayStart)),
    monthly: sumAIUsage(after(monthStart)),
    byModel,
    byTask,
    trend,
    recent: records.slice(0, 60),
  };
}

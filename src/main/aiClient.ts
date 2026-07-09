import { net } from 'electron';
import { AIConfig, AIModelConfig } from './types';
import { appendAiLog } from './shared/aiLogging';
import { normalizeAIConfig, getEnabledAIModels, getActiveAIModel } from './shared/aiConfig';
import { loadAIConfigFromDisk } from './shared/persistence';

export const AI_REQUEST_TIMEOUT_MS = 240000;
export const AI_REQUEST_RETRY_DELAY_MS = 900;

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function isRetryableAIRequestError(error: any): boolean {
  const message = String(error?.message || error || '');
  return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ECONNRESET|ETIMEDOUT|ERR_TIMED_OUT|ERR_NETWORK_CHANGED|socket hang up/i.test(message);
}

export function normalizeAIRequestError(error: any): Error {
  const message = String(error?.message || error || '');
  if (/ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ECONNRESET|socket hang up/i.test(message)) {
    return new Error('AI 接口连接被中断。可能是网络不稳定、代理/网关关闭连接，或请求内容过长。系统已自动重试，仍失败时请稍后重试或检查 AI 接口地址/代理。');
  }
  if (/ETIMEDOUT|ERR_TIMED_OUT|请求超时/i.test(message)) {
    return new Error('AI 接口请求超时。请检查网络、代理或模型服务是否可用，也可以减少导入文档内容后重试。');
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(message)) {
    return new Error('无法解析 AI 接口地址。请检查 AI 设置中的接口地址或当前网络 DNS。');
  }
  return error instanceof Error ? error : new Error(message || 'AI 请求失败');
}

export async function makeRequest(url: string, options: any, body?: string): Promise<any> {
  const maxAttempts = 2;
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await makeSingleRequest(url, options, body, attempt);
    } catch (error: any) {
      lastError = error;
      if (attempt < maxAttempts && isRetryableAIRequestError(error)) {
        appendAiLog('Request failed; retrying', { attempt, maxAttempts, error });
        console.warn(`[AI] Request failed, retrying (${attempt}/${maxAttempts}): ${error?.message || error}`);
        await sleep(AI_REQUEST_RETRY_DELAY_MS);
        continue;
      }
      throw normalizeAIRequestError(error);
    }
  }

  throw normalizeAIRequestError(lastError);
}

export function makeSingleRequest(url: string, options: any, body: string | undefined, attempt: number): Promise<any> {
  return new Promise((resolve, reject) => {
    appendAiLog('Request start', {
      method: options?.method || 'GET',
      url,
      attempt,
      bodyLength: body?.length || 0,
    });
    console.log(`[AI] Request: ${options?.method || 'GET'} ${url} (attempt ${attempt})`);
    const request = net.request({
      url,
      method: options?.method || 'GET',
    });

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      appendAiLog('Request timeout', {
        url,
        attempt,
        timeoutMs: AI_REQUEST_TIMEOUT_MS,
        bodyLength: body?.length || 0,
      });
      try {
        request.abort();
      } catch {}
      finish(() => reject(new Error(`请求超时（${Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}秒）`)));
    }, AI_REQUEST_TIMEOUT_MS);

    Object.entries(options?.headers || {}).forEach(([key, value]) => {
      request.setHeader(key, String(value));
    });

    request.on('response', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('error', (err) => {
        appendAiLog('Response stream error', { url, attempt, error: err });
        console.error('[AI] Response stream error:', err);
        finish(() => reject(err));
      });
      res.on('end', () => {
        finish(() => {
          appendAiLog('Response end', {
            url,
            attempt,
            statusCode: res.statusCode,
            responseLength: data.length,
            responsePreview: data.substring(0, 500),
          });
          console.log(`[AI] Response: ${res.statusCode} ${data.substring(0, 200)}`);
          let parsed: any = data;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          if (res.statusCode >= 400) {
            const message = parsed?.error?.message || parsed?.message || data || `HTTP ${res.statusCode}`;
            reject(new Error(`HTTP ${res.statusCode}: ${message}`));
            return;
          }
          resolve(parsed);
        });
      });
    });

    request.on('error', (err) => {
      appendAiLog('Request error', { url, attempt, error: err });
      console.error('[AI] Request error:', err);
      finish(() => reject(err));
    });

    request.on('abort', () => {
      appendAiLog('Request abort', { url, attempt });
      finish(() => reject(new Error('AI 请求已中止')));
    });

    if (body) request.write(body);
    request.end();
  });
}

export function sanitizeAIResponseForLog(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => sanitizeAIResponseForLog(item));
  if (value.type === 'thinking') {
    const thinking = typeof value.thinking === 'string' ? value.thinking : '';
    return {
      ...value,
      thinking: thinking ? `[thinking omitted, ${thinking.length} chars]` : '[thinking omitted]',
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, sanitizeAIResponseForLog(entryValue)]),
  );
}

export function compactResponse(value: any, maxLength = 600): string {
  const safeValue = sanitizeAIResponseForLog(value);
  const raw = typeof safeValue === 'string' ? safeValue : JSON.stringify(safeValue);
  return (raw || '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

export function getTextFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // 优先提取 text 类型的块
    const textParts = content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return '';
      })
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join('\n');

    // 如果没有 text 块，尝试提取所有非 thinking 块
    return content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item?.type === 'thinking') return '';
        return item?.text || item?.content || item?.value || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content?.text || content?.content || '';
}

export function extractAIText(result: any): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.output_text === 'string') return result.output_text;
  if (typeof result.text === 'string') return result.text;
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) return getTextFromContent(result.content);

  const firstChoice = result.choices?.[0];
  if (firstChoice) {
    return getTextFromContent(firstChoice.message?.content)
      || getTextFromContent(firstChoice.delta?.content)
      || firstChoice.text
      || '';
  }

  if (Array.isArray(result.output)) {
    return result.output
      .map((item: any) => getTextFromContent(item.content) || item.text || '')
      .filter(Boolean)
      .join('\n');
  }

  if (result.data) return extractAIText(result.data);
  if (result.result) return extractAIText(result.result);
  return '';
}


export function getAIContentBlocks(result: any): any[] {
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.content)) return result.content;
  if (Array.isArray(result.output)) {
    return result.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []);
  }
  const firstChoice = result.choices?.[0];
  const choiceContent = firstChoice?.message?.content || firstChoice?.delta?.content;
  return Array.isArray(choiceContent) ? choiceContent : [];
}

export function isThinkingOnlyMaxTokensResponse(result: any): boolean {
  if (!result || typeof result !== 'object') return false;
  if (extractAIText(result).trim()) return false;
  const blocks = getAIContentBlocks(result);
  const hasThinking = blocks.some((item: any) => item?.type === 'thinking');
  const hasText = blocks.some((item: any) => item?.type === 'text' && String(item?.text || '').trim());
  return hasThinking && !hasText && /max_tokens/i.test(String(result.stop_reason || result.finish_reason || ''));
}

export function buildNoReadableAITextError(provider: string, url: string, result: any): Error {
  if (isThinkingOnlyMaxTokensResponse(result)) {
    return new Error(`${provider} API 调用失败：模型输出额度耗尽，只返回了 thinking 思考块，没有返回最终文本。系统已尝试让模型直接输出结果；如果仍失败，请减少导入文档内容，或在 AI 服务中关闭思考输出/提高输出上限。`);
  }
  return new Error(result.error?.message || result.message || `${provider} API 调用失败：响应中没有可读取文本（${url}）。响应：${compactResponse(result)}`);
}

export function normalizeOpenAIEndpoint(endpoint?: string): string {
  const fallback = 'https://api.openai.com/v1/chat/completions';
  const raw = (endpoint || fallback).trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/v\d+$/i.test(normalized)) return `${normalized}/chat/completions`;
  return normalized;
}

export function normalizeClaudeEndpoint(endpoint?: string): string {
  const fallback = 'https://api.anthropic.com/v1/messages';
  const raw = (endpoint || fallback).trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/\/+$/, '');
  if (/\/v\d+\/messages$/i.test(normalized) || /\/messages$/i.test(normalized)) return normalized;
  if (/\/v\d+$/i.test(normalized)) return `${normalized}/messages`;
  if (/\/anthropic$/i.test(normalized)) return `${normalized}/v1/messages`;
  return normalized;
}

// 调用 Claude API
export async function callClaudeAPI(config: AIModelConfig, prompt: string): Promise<string> {
  const url = normalizeClaudeEndpoint(config.endpoint);
  const buildBody = (maxTokens: number, userPrompt = prompt) => JSON.stringify({
    model: config.model || 'claude-3-sonnet-20240229',
    max_tokens: maxTokens,
    temperature: 0,
    system: '直接输出最终答案，不要输出思考过程、分析过程或 Markdown 包裹。若任务要求 JSON，只输出可被 JSON.parse 解析的 JSON。',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
  };

  let result = await makeRequest(url, options, buildBody(4096));
  let text = extractAIText(result);
  if (text) return text;

  if (isThinkingOnlyMaxTokensResponse(result)) {
    console.warn('[AI] Claude returned thinking-only max_tokens response; retrying with direct-output prompt.');
    const retryPrompt = `请不要输出思考过程。请直接完成下面任务，并只输出最终结果。\n\n${prompt}`;
    result = await makeRequest(url, options, buildBody(8192, retryPrompt));
    text = extractAIText(result);
    if (text) return text;
  }

  throw buildNoReadableAITextError('Claude', url, result);
}

// 调用 OpenAI API
export async function callOpenAIAPI(config: AIModelConfig, prompt: string): Promise<string> {
  const url = normalizeOpenAIEndpoint(config.endpoint);
  appendAiLog('OpenAI call', { url, model: config.model || 'gpt-3.5-turbo', endpoint: config.endpoint });
  console.log(`[AI] OpenAI call: url=${url}, model=${config.model || 'gpt-3.5-turbo'}, endpoint=${config.endpoint}`);
  const body = JSON.stringify({
    model: config.model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
  };

  const result = await makeRequest(url, options, body);
  appendAiLog('OpenAI result parsed', { preview: compactResponse(result, 500) });
  console.log(`[AI] OpenAI result:`, JSON.stringify(result).substring(0, 500));
  const text = extractAIText(result);
  if (text) return text;
  throw buildNoReadableAITextError('OpenAI', url, result);
}

export async function callAIModel(config: AIModelConfig, prompt: string): Promise<string> {
  if (config.provider === 'claude') return callClaudeAPI(config, prompt);
  if (config.provider === 'custom' && /\/anthropic(?:\/|$)/i.test(config.endpoint || '')) {
    return callClaudeAPI(config, prompt);
  }
  if (config.provider === 'openai' || config.provider === 'custom') return callOpenAIAPI(config, prompt);
  throw new Error('不支持的 AI 提供商');
}

export async function callDefaultAI(prompt: string, modelId?: string): Promise<string> {
  const model = getActiveAIModel(loadAIConfigFromDisk(), modelId);
  if (!model) throw new Error('请先配置至少一个可用 AI 模型');
  return callAIModel(model, prompt);
}

export type ParallelModelResult = {
  model: AIModelConfig;
  ok: boolean;
  output: string;
};

function buildParallelSynthesisPrompt(originalPrompt: string, results: ParallelModelResult[]): string {
  const successful = results
    .filter(item => item.ok && item.output.trim())
    .map((item, index) => `### Model ${index + 1}: ${item.model.name || item.model.model}\n${item.output.trim()}`)
    .join('\n\n');
  const failures = results
    .filter(item => !item.ok)
    .map(item => `- ${item.model.name || item.model.model}: ${item.output}`)
    .join('\n');

  return [
    'You are a multi-model synthesis engine. The same original task and several independent model answers are provided below.',
    'Merge complementary information, remove repetition, resolve conflicts, and output one final answer that can be used directly by the application.',
    'Strictly follow the output format required by the original task. If the original task asks for JSON, output only valid JSON parsable by JSON.parse, with no explanation.',
    failures ? `The following model calls failed and should only be treated as background:\n${failures}` : '',
    `\n## Original task\n${originalPrompt}`,
    `\n## Model answers\n${successful}`,
    '\n## Final answer',
  ].filter(Boolean).join('\n\n');
}

async function runParallelModelCalls(prompt: string, models: AIModelConfig[]): Promise<ParallelModelResult[]> {
  return Promise.all(models.map(async model => {
    try {
      const output = await callAIModel(model, prompt);
      return { model, ok: true, output };
    } catch (error: any) {
      return { model, ok: false, output: error?.message || String(error) };
    }
  }));
}

async function synthesizeParallelResults(prompt: string, results: ParallelModelResult[], synthesisModel: AIModelConfig): Promise<string> {
  const successful = results.filter(item => item.ok && item.output.trim());
  if (successful.length === 0) {
    const errors = results.map(item => `${item.model.name || item.model.model}: ${item.output}`).join('\n');
    throw new Error(`All parallel model calls failed:\n${errors}`);
  }
  if (successful.length === 1) return successful[0].output;
  return callAIModel(synthesisModel, buildParallelSynthesisPrompt(prompt, results));
}

export async function callParallelAI(prompt: string, modelIds?: string[]): Promise<string> {
  const config = normalizeAIConfig(loadAIConfigFromDisk());
  const enabledModels = getEnabledAIModels(config);
  const selectedIds = modelIds?.length ? modelIds : config?.parallelModelIds || [];
  const selectedModels = enabledModels.filter(model => selectedIds.includes(model.id));
  const models = selectedModels.length > 0 ? selectedModels : enabledModels.slice(0, 1);
  if (models.length === 0) throw new Error('Please configure at least one available AI model');

  const results = await runParallelModelCalls(prompt, models);
  const synthesisModel = getActiveAIModel(config, config?.activeModelId) || models[0];
  return synthesizeParallelResults(prompt, results, synthesisModel);
}

async function callConfiguredAI(prompt: string): Promise<string> {
  const config = normalizeAIConfig(loadAIConfigFromDisk());
  return config?.multiModelMode === 'parallel'
    ? callParallelAI(prompt, config.parallelModelIds)
    : callDefaultAI(prompt, config?.activeModelId);
}

export async function callAIWithConfig(configValue: AIConfig, prompt: string, modelId?: string, modelIds?: string[], mode?: 'single' | 'parallel'): Promise<string> {
  const config = normalizeAIConfig(configValue);
  const enabledModels = getEnabledAIModels(config);
  if (enabledModels.length === 0) throw new Error('请先配置至少一个可用 AI 模型');

  if (mode === 'parallel') {
    const selectedIds = modelIds?.length ? modelIds : config?.parallelModelIds || [];
    const selectedModels = enabledModels.filter(model => selectedIds.includes(model.id));
    const models = selectedModels.length > 0 ? selectedModels : enabledModels.slice(0, 1);
    const results = await runParallelModelCalls(prompt, models);
    const synthesisModel = enabledModels.find(model => model.id === modelId)
      || enabledModels.find(model => model.id === config?.activeModelId)
      || models[0];
    return synthesizeParallelResults(prompt, results, synthesisModel);
  }

  const activeModel = enabledModels.find(model => model.id === modelId)
    || enabledModels.find(model => model.id === config?.activeModelId)
    || enabledModels[0];
  return callAIModel(activeModel, prompt);
}

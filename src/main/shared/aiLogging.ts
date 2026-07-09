import * as fs from 'fs';
import { logsDir, aiLogFile } from './paths';

export function createSafeLogReplacer() {
  const seen = new WeakSet<object>();
  return (key: string, value: any) => {
    if (/api[-_]?key|authorization|token|secret/i.test(key)) return '[redacted]';
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack?.split('\n').slice(0, 6).join('\n'),
      };
    }
    if (typeof value === 'string') {
      return value.length > 1200 ? value.slice(0, 1200) + '...[truncated]' : value;
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
    }
    return value;
  };
}

export function formatAiLogValue(value: any, maxLength = 2400): string {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, createSafeLogReplacer());
    return String(raw || '').replace(/\s+/g, ' ').slice(0, maxLength);
  } catch {
    return String(value || '').replace(/\s+/g, ' ').slice(0, maxLength);
  }
}

export function appendAiLog(event: string, data?: any) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const payload = data === undefined ? '' : ' ' + formatAiLogValue(data);
    fs.appendFileSync(aiLogFile, '[' + new Date().toISOString() + '] ' + event + payload + '\n', 'utf-8');
  } catch {
    // Logging must never break the AI request flow.
  }
}

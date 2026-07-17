import * as fs from 'fs';
import * as path from 'path';

export const CURRENT_DATA_SCHEMA_VERSION = 1;

export interface VersionedJsonEnvelope<T> {
  schemaVersion: number;
  data: T;
}

export interface VersionedJsonReadResult<T> {
  data: T;
  source: 'missing' | 'legacy' | 'versioned' | 'invalid' | 'unsupported';
  error?: string;
}

const isEnvelope = (value: unknown): value is { schemaVersion: unknown; data?: unknown } =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'schemaVersion' in value);

export const decodeVersionedJson = <T>(value: unknown, fallback: T): VersionedJsonReadResult<T> => {
  if (!isEnvelope(value)) return { data: value as T, source: 'legacy' };
  if (value.schemaVersion !== CURRENT_DATA_SCHEMA_VERSION) {
    return {
      data: fallback,
      source: 'unsupported',
      error: `Unsupported schema version: ${String(value.schemaVersion)}`,
    };
  }
  if (!('data' in value)) {
    return { data: fallback, source: 'invalid', error: 'Versioned data file has no data field' };
  }
  return { data: value.data as T, source: 'versioned' };
};

export const readVersionedJsonFile = <T>(filePath: string, fallback: T): VersionedJsonReadResult<T> => {
  if (!fs.existsSync(filePath)) return { data: fallback, source: 'missing' };
  try {
    return decodeVersionedJson<T>(JSON.parse(fs.readFileSync(filePath, 'utf-8')), fallback);
  } catch (error) {
    return {
      data: fallback,
      source: 'invalid',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const writeVersionedJsonFile = <T>(filePath: string, data: T): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = readVersionedJsonFile<unknown>(filePath, null);
  if (existing.source === 'invalid' || existing.source === 'unsupported') {
    throw new Error(`Refusing to overwrite unsafe data file ${filePath}: ${existing.error || existing.source}`);
  }
  if (existing.source === 'legacy') {
    const backupPath = `${filePath}.schema-v0.bak`;
    if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  }

  const envelope: VersionedJsonEnvelope<T> = {
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    data,
  };
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(envelope, null, 2), 'utf-8');
  fs.renameSync(temporaryPath, filePath);
};


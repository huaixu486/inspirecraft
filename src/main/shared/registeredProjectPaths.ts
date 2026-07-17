import * as path from 'path';
import { decodeVersionedJson } from './versionedJson';

/**
 * Read registered project roots from both the legacy array format and the
 * current versioned JSON envelope. Invalid or future-version data stays
 * closed by returning no trusted paths.
 */
export function extractRegisteredProjectPaths(value: unknown): string[] {
  const projects = decodeVersionedJson<unknown>(value, []).data;
  if (!Array.isArray(projects)) return [];

  return projects
    .map(project => String(project?.folderPath || '').trim())
    .filter(Boolean)
    .map(folderPath => path.resolve(folderPath));
}

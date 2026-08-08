import * as path from 'path';
import { AppSettings } from '../types';
import { readVersionedJsonFile } from './versionedJson';

const defaultSettings: AppSettings = {
  workspacePath: '',
  workspaceCapacity: 10,
};

/**
 * Read the workspace root from both legacy settings JSON and the current
 * schemaVersion/data envelope. Invalid or unsupported settings fail closed.
 */
export function readWorkspaceRootFromSettingsFile(filePath: string): string {
  const settings = readVersionedJsonFile<AppSettings>(filePath, defaultSettings).data;
  const workspacePath = typeof settings?.workspacePath === 'string'
    ? settings.workspacePath.trim()
    : '';
  return workspacePath ? path.resolve(workspacePath) : '';
}

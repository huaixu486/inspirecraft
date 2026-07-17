import type { IpcMain } from 'electron';
import { getIpcDefinitions } from './registry';
import { isProjectIpc } from './registerProjectIpc';
import { isFileIpc } from './registerFileIpc';
import { isDocumentIpc } from './registerDocumentIpc';
import { isWorkflowIpc } from './registerWorkflowIpc';
import { isAiIpc } from './registerAiIpc';
import { isKnowledgeIpc } from './registerKnowledgeIpc';
import { isCollaborationIpc } from './registerCollaborationIpc';
import { isSettingsIpc } from './registerSettingsIpc';
import { isRecycleBinIpc } from './registerRecycleBinIpc';
import { ipcFail } from './types';

export const IPC_DOMAIN_MATCHERS = [
  isProjectIpc,
  isFileIpc,
  isDocumentIpc,
  isWorkflowIpc,
  isAiIpc,
  isKnowledgeIpc,
  isCollaborationIpc,
  isSettingsIpc,
  isRecycleBinIpc,
] as const;

export const registerAllIpc = (ipcMain: IpcMain) => {
  const definitions = getIpcDefinitions();
  const unmatched = definitions.filter(definition => !IPC_DOMAIN_MATCHERS.some(matches => matches(definition.channel)));
  if (unmatched.length) throw new Error(`Unclassified IPC channels: ${unmatched.map(item => item.channel).join(', ')}`);
  for (const definition of definitions) {
    if (definition.kind === 'handle') ipcMain.handle(definition.channel, async (event, ...args) => {
      try {
        return await definition.listener(event, ...args);
      } catch (error) {
        return ipcFail(error, 'UNHANDLED_IPC_ERROR');
      }
    });
    else ipcMain.on(definition.channel, definition.listener);
  }
  return definitions.length;
};

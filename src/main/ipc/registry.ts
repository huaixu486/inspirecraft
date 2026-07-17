import type { IpcDefinition, IpcEventHandler, IpcInvokeHandler } from './types';

const definitions: IpcDefinition[] = [];

const assertUnique = (kind: IpcDefinition['kind'], channel: string) => {
  if (definitions.some(item => item.kind === kind && item.channel === channel)) throw new Error(`Duplicate IPC ${kind} channel: ${channel}`);
};

export const defineIpcHandler = (channel: string, listener: IpcInvokeHandler) => {
  assertUnique('handle', channel);
  definitions.push({ kind: 'handle', channel, listener });
};

export const defineIpcEvent = (channel: string, listener: IpcEventHandler) => {
  assertUnique('on', channel);
  definitions.push({ kind: 'on', channel, listener });
};

export const getIpcDefinitions = () => [...definitions];

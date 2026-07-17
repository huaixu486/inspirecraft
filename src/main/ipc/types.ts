import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

export type IpcInvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;
export type IpcEventHandler = (event: IpcMainEvent, ...args: any[]) => void;
export type IpcDefinition =
  | { kind: 'handle'; channel: string; listener: IpcInvokeHandler }
  | { kind: 'on'; channel: string; listener: IpcEventHandler };

export interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export const ipcOk = <T>(data?: T): IpcResult<T> => ({ success: true, ...(data === undefined ? {} : { data }) });
export const ipcFail = (error: unknown, code = 'IPC_ERROR'): IpcResult => ({ success: false, error: error instanceof Error ? error.message : String(error), code });

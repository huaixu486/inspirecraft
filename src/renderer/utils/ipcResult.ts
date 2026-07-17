export type IpcMutationResult = void | { success?: boolean; error?: string };

export const assertIpcMutationSucceeded = (
  result: IpcMutationResult,
  fallbackMessage: string,
) => {
  if (result && result.success === false) {
    throw new Error(result.error || fallbackMessage);
  }
};

const ipcErrorMessage = (value: unknown, fallbackMessage: string) => {
  if (value && typeof value === 'object' && 'error' in value) {
    return String((value as { error?: unknown }).error || fallbackMessage);
  }
  return fallbackMessage;
};

export const requireIpcArray = <T>(value: unknown, fallbackMessage: string): T[] => {
  if (!Array.isArray(value)) throw new Error(ipcErrorMessage(value, fallbackMessage));
  return value as T[];
};

export const requireIpcObject = <T extends object>(value: unknown, fallbackMessage: string): T => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ('success' in value && (value as { success?: unknown }).success === false)) {
    throw new Error(ipcErrorMessage(value, fallbackMessage));
  }
  return value as T;
};

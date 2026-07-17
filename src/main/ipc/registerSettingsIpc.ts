import { AppSettings } from '../types';
import { defineIpcHandler } from './registry';

export const isSettingsIpc = (channel: string) => /^(settings|system):/.test(channel);

export const defineSettingsIpc = (deps: { load: () => AppSettings; save: (settings: AppSettings) => void }) => {
  defineIpcHandler('settings:load', async () => deps.load());
  defineIpcHandler('settings:save', async (_event, settings: AppSettings) => deps.save(settings));
};

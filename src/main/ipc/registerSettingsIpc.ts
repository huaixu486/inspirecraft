import { AppSettings } from '../types';
import { defineIpcHandler } from './registry';

export const isSettingsIpc = (channel: string) => /^(settings|system):/.test(channel);

export const defineSettingsIpc = (deps: {
  load: () => AppSettings;
  save: (settings: AppSettings) => void;
  getAutoLaunch: () => unknown;
  setAutoLaunch: (enabled: boolean) => unknown;
}) => {
  defineIpcHandler('settings:load', async () => deps.load());
  defineIpcHandler('settings:save', async (_event, settings: AppSettings) => deps.save(settings));
  defineIpcHandler('system:getAutoLaunch', async () => deps.getAutoLaunch());
  defineIpcHandler('system:setAutoLaunch', async (_event, enabled: boolean) => deps.setAutoLaunch(enabled));
};

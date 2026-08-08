import type { AppKeyboardShortcuts, AppShortcutAction } from '../../shared/types';

export const DEFAULT_KEYBOARD_SHORTCUTS: AppKeyboardShortcuts = {
  globalSearch: 'Ctrl+K',
};

const modifierOrder = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const;
const modifierAliases: Record<string, typeof modifierOrder[number]> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

const keyAliases: Record<string, string> = {
  ' ': 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  ',': 'Comma',
  '.': 'Period',
};

const blockedShortcuts = new Set([
  'Ctrl+R',
  'Ctrl+Shift+R',
  'Ctrl+W',
  'Alt+F4',
  'Ctrl+Alt+Delete',
]);

export function normalizeKeyboardShortcut(value: string): string {
  const parts = String(value || '').split('+').map(part => part.trim()).filter(Boolean);
  const modifiers = new Set<typeof modifierOrder[number]>();
  let key = '';
  for (const part of parts) {
    const modifier = modifierAliases[part.toLowerCase()];
    if (modifier) modifiers.add(modifier);
    else key = keyAliases[part.toLowerCase()] || (part.length === 1 ? part.toUpperCase() : part);
  }
  if (!key) return '';
  return [...modifierOrder.filter(modifier => modifiers.has(modifier)), key].join('+');
}

export function normalizeKeyboardShortcuts(value?: Partial<AppKeyboardShortcuts>): AppKeyboardShortcuts {
  const globalSearch = normalizeKeyboardShortcut(value?.globalSearch || DEFAULT_KEYBOARD_SHORTCUTS.globalSearch);
  return {
    globalSearch: globalSearch || DEFAULT_KEYBOARD_SHORTCUTS.globalSearch,
  };
}

export type ShortcutKeyboardEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function keyboardEventToShortcut(event: ShortcutKeyboardEvent): string {
  const rawKey = event.key;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(rawKey)) return '';
  const key = keyAliases[rawKey.toLowerCase()] || (rawKey.length === 1 ? rawKey.toUpperCase() : rawKey);
  return normalizeKeyboardShortcut([
    event.ctrlKey ? 'Ctrl' : '',
    event.metaKey ? 'Meta' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ].filter(Boolean).join('+'));
}

export function validateKeyboardShortcut(value: string): string | null {
  const shortcut = normalizeKeyboardShortcut(value);
  if (!shortcut) return '请按下一个有效的组合键';
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1];
  const hasModifier = parts.length > 1;
  const isFunctionKey = /^F(?:[1-9]|1[0-2])$/.test(key);
  if (!hasModifier && !isFunctionKey) return '为避免影响正常输入，请至少包含 Ctrl、Alt、Shift 或 Meta';
  if (blockedShortcuts.has(shortcut)) return '该组合键属于系统或窗口保留快捷键，请使用其他组合';
  return null;
}

export function matchesKeyboardShortcut(event: ShortcutKeyboardEvent, value: string): boolean {
  return keyboardEventToShortcut(event) === normalizeKeyboardShortcut(value);
}

export const shortcutActionLabels: Record<AppShortcutAction, { title: string; description: string }> = {
  globalSearch: {
    title: '全局搜索',
    description: '搜索项目、项目文件、任务、模板、阶段记忆和常用命令。',
  },
};

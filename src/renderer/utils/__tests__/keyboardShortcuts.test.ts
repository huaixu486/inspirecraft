import assert from 'node:assert/strict';
import test from 'node:test';
import {
  keyboardEventToShortcut,
  matchesKeyboardShortcut,
  normalizeKeyboardShortcut,
  normalizeKeyboardShortcuts,
  validateKeyboardShortcut,
} from '../keyboardShortcuts';

test('shortcut strings are normalized into a stable modifier order', () => {
  assert.equal(normalizeKeyboardShortcut('shift + ctrl + k'), 'Ctrl+Shift+K');
  assert.equal(normalizeKeyboardShortcut('cmd+k'), 'Meta+K');
  assert.equal(normalizeKeyboardShortcuts({ globalSearch: '' }).globalSearch, 'Ctrl+K');
});

test('keyboard events match configured shortcuts', () => {
  const event = { key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
  assert.equal(keyboardEventToShortcut(event), 'Ctrl+Shift+K');
  assert.equal(matchesKeyboardShortcut(event, 'Ctrl+Shift+K'), true);
  assert.equal(matchesKeyboardShortcut(event, 'Ctrl+K'), false);
});

test('plain typing and reserved window shortcuts are rejected', () => {
  assert.match(validateKeyboardShortcut('K') || '', /正常输入/);
  assert.match(validateKeyboardShortcut('Ctrl+R') || '', /保留快捷键/);
  assert.equal(validateKeyboardShortcut('Ctrl+Shift+K'), null);
});

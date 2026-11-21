import { describe, it, expect } from 'vitest';
import { DEFAULT_PUSH_KEY, isModifierKey, pushKeyAllowed, pushKeyLabel, storedPushKey } from './pushKey';

describe('the push key', () => {
  it('is Space until the user picks another', () => {
    expect(DEFAULT_PUSH_KEY).toBe('Space');
    expect(storedPushKey(undefined)).toBe('Space');
    expect(storedPushKey('')).toBe('Space');
    expect(storedPushKey(42)).toBe('Space');
    expect(storedPushKey('F8')).toBe('F8');
  });

  it('takes any one key, a modifier on its own included', () => {
    for (const code of ['Space', 'F8', 'KeyT', 'Digit5', 'ControlRight', 'AltLeft', 'ShiftRight', 'Backquote', 'Numpad0', 'ArrowDown']) {
      expect(pushKeyAllowed(code), code).toBe(true);
    }
  });

  it('refuses the keys that close, move focus, lock a state or open a system menu', () => {
    for (const code of ['Escape', 'Tab', 'Enter', 'NumpadEnter', 'CapsLock', 'NumLock', 'ScrollLock', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'Fn', 'FnLock', 'Unidentified', '']) {
      expect(pushKeyAllowed(code), code).toBe(false);
    }
    // A refused key that was stored somehow falls back to Space.
    expect(storedPushKey('Escape')).toBe('Space');
  });

  it('is named in English, as keyboards print it, whatever the app language (owner 2026-11-22)', () => {
    expect(pushKeyLabel('Space', false)).toBe('Space');
    expect(pushKeyLabel('KeyT', false)).toBe('T');
    expect(pushKeyLabel('Digit5', false)).toBe('5');
    expect(pushKeyLabel('F8', false)).toBe('F8');
    expect(pushKeyLabel('Numpad0', false)).toBe('Numpad 0');
    expect(pushKeyLabel('NumpadAdd', false)).toBe('Numpad +');
    expect(pushKeyLabel('ArrowDown', false)).toBe('↓');
    expect(pushKeyLabel('Backquote', false)).toBe('`');
    expect(pushKeyLabel('PageDown', false)).toBe('Page Down');
    // The key beside left Shift on ISO keyboards is not the Backslash key, so it is not named like it.
    expect(pushKeyLabel('IntlBackslash', false)).not.toBe(pushKeyLabel('Backslash', false));
  });

  it('names a modifier by its side, and by the Mac name on a Mac', () => {
    expect(pushKeyLabel('ControlRight', false)).toBe('Right Ctrl');
    expect(pushKeyLabel('ControlLeft', true)).toBe('Left Control');
    expect(pushKeyLabel('AltRight', false)).toBe('Right Alt');
    expect(pushKeyLabel('AltRight', true)).toBe('Right Option');
    expect(pushKeyLabel('ShiftLeft', false)).toBe('Left Shift');
    // Cmd and the Windows key cannot be the push key, but a refusal still names them as the keyboard does.
    expect(pushKeyLabel('MetaLeft', false)).toBe('Left Windows');
    expect(pushKeyLabel('MetaRight', true)).toBe('Right Command');
    expect(pushKeyLabel('OSLeft', true)).toBe('Left Command');
  });

  it('tells a modifier from other keys', () => {
    expect(isModifierKey('ControlRight')).toBe(true);
    expect(isModifierKey('ShiftLeft')).toBe(true);
    expect(isModifierKey('AltRight')).toBe(true);
    expect(isModifierKey('MetaLeft')).toBe(true);
    expect(isModifierKey('OSRight')).toBe(true);
    expect(isModifierKey('KeyT')).toBe(false);
    expect(isModifierKey('Space')).toBe(false);
  });

  it('never names a key after a property every object has', () => {
    expect(pushKeyLabel('constructor', false)).toBe('constructor');
    expect(pushKeyLabel('toString', false)).toBe('toString');
  });

  it('shows a key it has no name for by its code', () => {
    expect(pushKeyLabel('IntlRo', false)).toBe('IntlRo');
  });
});

// src/lib/turn/pushKey.ts
//
// The key that holds a push-to-talk or push-to-translate turn (owner, 2026-11-21): one key on its own, a modifier on
// its own included, kept as its `KeyboardEvent.code` so that it means the same physical key in every keyboard layout.
// It works while the Sokuji window has focus, as Space always did. Its name is shown in English, as keyboards print it,
// whatever the app's language (owner, 2026-11-22): Space, Left Ctrl, Numpad 0.

export const DEFAULT_PUSH_KEY = 'Space';

/**
 * Keys a hold cannot take: Escape, Tab and Enter close dialogs and move focus; the lock keys change a state with every
 * press; the system keys open the operating system's own menus.
 */
const REFUSED: ReadonlySet<string> = new Set([
  'Escape', 'Tab', 'Enter', 'NumpadEnter', 'CapsLock', 'NumLock', 'ScrollLock',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'Fn', 'FnLock', 'Unidentified',
]);

/** Whether `code` can be the push key. */
export function pushKeyAllowed(code: string): boolean {
  return code !== '' && !REFUSED.has(code);
}

/** The stored push key, or Space when nothing usable is stored. */
export function storedPushKey(value: unknown): string {
  return typeof value === 'string' && pushKeyAllowed(value) ? value : DEFAULT_PUSH_KEY;
}

const SYMBOLS: Readonly<Record<string, string>> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlYen: '¥',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
const NUMPAD: Readonly<Record<string, string>> = { Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.', Equal: '=' };
/** Codes that read better with a space; any other code (Backspace, Home, …) is already its key's name. */
const NAMED: Readonly<Record<string, string>> = { PageUp: 'Page Up', PageDown: 'Page Down', PrintScreen: 'Print Screen' };

/** Each modifier's name on other systems, then on a Mac. `OS` is an older code for the Windows or Command key. */
const MODIFIER_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  Control: ['Ctrl', 'Control'], Alt: ['Alt', 'Option'], Shift: ['Shift', 'Shift'],
  Meta: ['Windows', 'Command'], OS: ['Windows', 'Command'],
};
const MODIFIER = /^(Control|Alt|Shift|Meta|OS)(Left|Right)$/;

/**
 * Whether `code` is a modifier key: Ctrl, Alt, Shift, or the Windows or Command key. A modifier pressed on its own is a
 * key choice (Ctrl, Alt and Shift can be the push key; the Windows and Command keys are refused); any other key pressed
 * while one is held is a shortcut, not a hold or a choice.
 */
export function isModifierKey(code: string): boolean {
  return MODIFIER.test(code);
}

/** `table[key]`, but only for the table's own keys, so a code like `constructor` is not named after Object's. */
function own(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** The push key as the keyboard shows it: a modifier by its side, and by its Mac name on a Mac. */
export function pushKeyLabel(code: string, mac: boolean): string {
  const letter = /^Key([A-Z])$/.exec(code) ?? /^Digit(\d)$/.exec(code) ?? /^(F\d{1,2})$/.exec(code);
  if (letter) return letter[1];
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Numpad ${own(NUMPAD, numpad[1]) ?? numpad[1]}`;
  const modifier = MODIFIER.exec(code);
  if (modifier) return `${modifier[2]} ${MODIFIER_NAMES[modifier[1]][mac ? 1 : 0]}`;
  return own(SYMBOLS, code) ?? own(NAMED, code) ?? code;
}

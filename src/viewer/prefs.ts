// src/viewer/prefs.ts
/** The viewer's own preferences, on its own device; the page works without storage (private mode, blocked storage). */
const PREFIX = 'sokuji.viewer.';

export function readPref<T>(name: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + name);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Storage unavailable: the preference lasts until the page closes.
  }
}

/**
 * The appearance setting, resolved to a scheme and applied to the documents
 * the app owns (spec 2026-10-22 §1).
 *
 * `settings.common.theme` is one of three settings; a scheme is one of two.
 * `system` follows the operating system through `prefers-color-scheme`, so
 * while it is the setting this module listens to the media query and
 * re-applies on change. Applying means one attribute on a document's root:
 * `data-theme="light"` for light, nothing for dark, which `theme.scss` reads.
 *
 * The settings store is the source of truth, and it loads over async IPC (or
 * `chrome.storage`), so nothing is applied until it reports loaded: before
 * that the boot script's cached scheme (`public/theme-boot.js`, reading the
 * key below) is what the page wears, and applying the store's default over it
 * would be the very flash the cache exists to prevent. Every apply refreshes
 * that cache.
 *
 * Child-window popovers are separate documents with the stylesheets copied
 * in; they register here and take the current scheme at once and on change.
 */

export type ThemeSetting = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

/** The picker's order. */
export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark'];

/** Where the resolved scheme is cached for the next boot's first paint. */
export const THEME_CACHE_KEY = 'sokuji.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (THEME_SETTINGS as readonly string[]).includes(value);
}

export function resolveScheme(setting: ThemeSetting, systemPrefersDark: boolean): Scheme {
  if (setting === 'system') return systemPrefersDark ? 'dark' : 'light';
  return setting;
}

export function applyScheme(doc: Document, scheme: Scheme): void {
  if (scheme === 'light') doc.documentElement.setAttribute('data-theme', 'light');
  else doc.documentElement.removeAttribute('data-theme');
}

export interface ThemeSource {
  getTheme(): ThemeSetting;
  isLoaded(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface ThemeDeps {
  source: ThemeSource;
  /** Defaults to `window.matchMedia`. */
  matchMedia?: (query: string) => MediaQueryList;
  /** Defaults to `localStorage`; `null` for none. Every write is guarded. */
  storage?: Pick<Storage, 'setItem'> | null;
  /** Called after every apply: the entry forwards the setting to Electron. */
  onApply?: (setting: ThemeSetting, scheme: Scheme) => void;
}

const documents = new Set<Document>();
let current: Scheme | null = null;

/** A child document follows the scheme until the returned function is called. */
export function registerThemeDocument(doc: Document): () => void {
  documents.add(doc);
  if (current) applyScheme(doc, current);
  return () => { documents.delete(doc); };
}

function defaultStorage(): Pick<Storage, 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function installTheme(deps: ThemeDeps): () => void {
  const matchMedia = deps.matchMedia ?? ((query: string) => window.matchMedia(query));
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const media = matchMedia(DARK_QUERY);

  let listening = false;
  const onMediaChange = () => apply();
  const listen = (on: boolean) => {
    if (on === listening) return;
    if (on) media.addEventListener('change', onMediaChange);
    else media.removeEventListener('change', onMediaChange);
    listening = on;
  };

  const apply = () => {
    if (!deps.source.isLoaded()) return;
    const setting = deps.source.getTheme();
    listen(setting === 'system');
    const scheme = resolveScheme(setting, media.matches);
    current = scheme;
    applyScheme(document, scheme);
    for (const doc of documents) applyScheme(doc, scheme);
    try {
      storage?.setItem(THEME_CACHE_KEY, scheme);
    } catch {
      // A private window or blocked site data: the next boot paints dark
      // until the store loads, which is the default anyway.
    }
    deps.onApply?.(setting, scheme);
  };

  const unsubscribe = deps.source.subscribe(apply);
  apply();

  return () => {
    unsubscribe();
    listen(false);
    current = null;
  };
}

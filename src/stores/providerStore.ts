/**
 * One store for every provider in the new registry: its settings, its
 * credentials and its language pair, loaded and saved generically from its
 * definition (spec: "Settings belong to the provider", "Credentials are not
 * settings", "Languages are two functions"). Values persist under today's
 * `settings.<key>.<field>` keys, so no saved value moves.
 */
import { create } from 'zustand';
import { normalizePair } from '../lib/provider/languages';
import type { AnyProvider, CredentialValues, LanguagePair } from '../lib/provider/types';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

/** One provider's saved state. */
export interface ProviderEntry {
  /** The provider's `S`; generic code never looks inside. */
  settings: unknown;
  /** Every key in `credentials.keys`; '' where nothing is saved. */
  credentials: CredentialValues;
  pair: LanguagePair;
}

export interface ProviderStore {
  /** Loaded providers, by id; a provider is absent until `load` resolves. */
  entries: Readonly<Record<string, ProviderEntry>>;
  load(p: AnyProvider): Promise<void>;
  updateSettings(p: AnyProvider, patch: Readonly<Record<string, unknown>>): void;
  setCredential(p: AnyProvider, key: string, value: string): void;
  setPair(p: AnyProvider, pair: LanguagePair): void;
}

/** The pair persists beside the settings, under the field names every slice uses today. */
const SOURCE = 'sourceLanguage';
const TARGET = 'targetLanguage';

function storageKey(p: AnyProvider, field: string): string {
  return `settings.${p.settings.key}.${field}`;
}

export const useProviderStore = create<ProviderStore>()((set, get) => {
  /** Writing to a provider before `load` resolves is a bug in the caller. */
  const loaded = (p: AnyProvider): ProviderEntry => {
    const entry = get().entries[p.id];
    if (!entry) throw new Error(`Provider "${p.id}" is not loaded`);
    return entry;
  };
  const put = (p: AnyProvider, entry: ProviderEntry) => set((st) => ({ entries: { ...st.entries, [p.id]: entry } }));
  const persistPair = (p: AnyProvider, before: LanguagePair, after: LanguagePair) => {
    if (after.source !== before.source) void persistSetting(storageKey(p, SOURCE), after.source);
    if (after.target !== before.target) void persistSetting(storageKey(p, TARGET), after.target);
  };

  return {
    entries: {},

    async load(p) {
      const service = ServiceFactory.getSettingsService();
      const defaults = p.settings.defaults as Record<string, unknown>;
      const fields = Object.keys(defaults);
      // Every value is read with a default of its own type: getSetting returns
      // a stored string untouched only when the default is a string, and
      // JSON-parses it otherwise — a key "123456" would come back a number.
      const [values, secrets, source, target] = await Promise.all([
        Promise.all(fields.map((f) => service.getSetting<unknown>(storageKey(p, f), defaults[f]))),
        Promise.all(p.credentials.keys.map((k) => service.getSetting(storageKey(p, k), ''))),
        service.getSetting(storageKey(p, SOURCE), ''),
        service.getSetting(storageKey(p, TARGET), ''),
      ]);
      // A second load racing the first (a remounted panel) must not undo an
      // edit made after the first one landed.
      if (get().entries[p.id]) return;
      const stored = Object.fromEntries(fields.map((f, i) => [f, values[i]]));
      const settings = p.settings.migrate ? p.settings.migrate(stored) : stored;
      put(p, {
        settings,
        credentials: Object.fromEntries(p.credentials.keys.map((k, i) => [k, secrets[i]])),
        pair: normalizePair(p, settings, { source: source || undefined, target: target || undefined }),
      });
    },

    updateSettings(p, patch) {
      const entry = loaded(p);
      const settings = { ...(entry.settings as Record<string, unknown>), ...patch };
      // New settings can change the languages on offer; the pair follows.
      const pair = normalizePair(p, settings, entry.pair);
      put(p, { ...entry, settings, pair });
      for (const [field, value] of Object.entries(patch)) void persistSetting(storageKey(p, field), value);
      persistPair(p, entry.pair, pair);
    },

    setCredential(p, key, value) {
      const entry = loaded(p);
      put(p, { ...entry, credentials: { ...entry.credentials, [key]: value } });
      void persistSetting(storageKey(p, key), value);
    },

    setPair(p, pair) {
      const entry = loaded(p);
      const next = normalizePair(p, entry.settings, pair);
      put(p, { ...entry, pair: next });
      persistPair(p, entry.pair, next);
    },
  };
});

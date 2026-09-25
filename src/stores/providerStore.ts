/**
 * One store for every provider in the new registry: its settings, its
 * credentials and its language pair, loaded and saved generically from its
 * definition (spec: "Settings belong to the provider", "Credentials are not
 * settings", "Languages are two functions"). Values persist under today's
 * `settings.<key>.<field>` keys, so no saved value moves.
 */
import { create } from 'zustand';
import type { LegName } from '../lib/conversation/types';
import { describeCause, reportError, reportWarning } from '../lib/diagnostics/report';
import { isMissing, readCredentials } from '../lib/provider/credentials';
import { normalizePair } from '../lib/provider/languages';
import type { AnyProvider, AuthContext, CredentialValues, LanguagePair, Readiness } from '../lib/provider/types';
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

export type { Readiness } from '../lib/provider/types';

export const UNKNOWN: Readiness = { state: 'unknown' };

/** What a readiness check reads: the live entry's by default, or a run's frozen shape. */
export interface ReadinessInputs {
  settings: unknown;
  credentials: Readonly<Record<string, string>>;
  pair: LanguagePair;
  /** The legs a run would open, speaker first. */
  legs: readonly LegName[];
}

export interface ProviderStore {
  /** Loaded providers, by id; a provider is absent until `load` resolves. */
  entries: Readonly<Record<string, ProviderEntry>>;
  /** One readiness per provider, by id; absent means unknown. */
  readiness: Readonly<Record<string, Readiness>>;
  load(p: AnyProvider): Promise<void>;
  updateSettings(p: AnyProvider, patch: Readonly<Record<string, unknown>>): void;
  setCredential(p: AnyProvider, key: string, value: string): void;
  setPair(p: AnyProvider, pair: LanguagePair): void;
  /**
   * Runs the provider's `check` on the live entry (with the store's `legs`),
   * or on a run's shape (`from`), and records the answer. A run's check
   * returns its own answer even when a newer check began meanwhile; that one
   * only keeps it out of the store. A check its `signal` cancelled answers
   * unknown and reports nothing.
   */
  refreshReadiness(p: AnyProvider, auth: AuthContext, from?: ReadinessInputs, signal?: AbortSignal): Promise<Readiness>;
  /** The legs a start would open now, speaker first (appShape's `watchLegsFromStores` keeps them); the speaker alone until then. */
  legs: readonly LegName[];
  /** Other legs change what a check answers: every loaded provider's readiness is forgotten. The same legs change nothing. */
  setLegs(legs: readonly LegName[]): void;
  /** The provider the panel shows and a run starts; in memory until plan 1e persists it under `settings.common.provider`. */
  selected: string | null;
  /** Refused, with a warning, while `selectionLocked`. */
  select(id: string): void;
  /** True while a run is not idle (the app session's `attach()` keeps it): the provider is fixed then. */
  selectionLocked: boolean;
  setSelectionLocked(locked: boolean): void;
}

/** The pair persists beside the settings, under the field names every slice uses today. */
const SOURCE = 'sourceLanguage';
const TARGET = 'targetLanguage';

function storageKey(p: AnyProvider, field: string): string {
  return `settings.${p.settings.key}.${field}`;
}

/** The latest check per provider: a check that finishes after a newer one began, or after its inputs changed, stays out of the store (a run's own check still gets its answer back). */
const checkSeq = new Map<string, number>();
/** The last answer per network provider, with the inputs it answered. */
const lastAnswer = new Map<string, { inputs: string; readiness: Readiness }>();

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
  const setReadiness = (p: Pick<AnyProvider, 'id'>, readiness: Readiness): Readiness => {
    set((st) => ({ readiness: { ...st.readiness, [p.id]: readiness } }));
    return readiness;
  };
  /** Starts a new check generation for `p`; whatever check is still running no longer counts. */
  const supersede = (p: Pick<AnyProvider, 'id'>): number => {
    const seq = (checkSeq.get(p.id) ?? 0) + 1;
    checkSeq.set(p.id, seq);
    return seq;
  };
  /** What `check` answered no longer describes these settings or credentials. */
  const forgetReadiness = (p: Pick<AnyProvider, 'id'>) => {
    supersede(p);
    setReadiness(p, UNKNOWN);
  };

  return {
    entries: {},
    readiness: {},
    selected: null,
    select(id) {
      if (get().selectionLocked) {
        // Spec, "What may change during a run": the provider is fixed while the phase is not idle.
        reportWarning('ProviderStore', `The provider cannot change during a session; "${id}" was not selected.`, { dedupeKey: 'select:locked' });
        return;
      }
      set({ selected: id });
    },
    selectionLocked: false,
    setSelectionLocked(locked) { set({ selectionLocked: locked }); },
    legs: ['speaker'],

    setLegs(legs) {
      const now = get().legs;
      if (legs.length === now.length && legs.every((leg, i) => leg === now[i])) return;
      set({ legs });
      for (const id of Object.keys(get().entries)) forgetReadiness({ id });
    },

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
      const initial = p.languages.initial?.(settings) ?? {};
      put(p, {
        settings,
        credentials: Object.fromEntries(p.credentials.keys.map((k, i) => [k, secrets[i]])),
        pair: normalizePair(p, settings, { source: source || initial.source, target: target || initial.target }),
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
      forgetReadiness(p);
    },

    setCredential(p, key, value) {
      const entry = loaded(p);
      if (!p.credentials.keys.includes(key)) throw new Error(`Provider "${p.id}" has no credential "${key}"`);
      put(p, { ...entry, credentials: { ...entry.credentials, [key]: value } });
      void persistSetting(storageKey(p, key), value);
      forgetReadiness(p);
    },

    setPair(p, pair) {
      const entry = loaded(p);
      const next = normalizePair(p, entry.settings, pair);
      put(p, { ...entry, pair: next });
      persistPair(p, entry.pair, next);
      forgetReadiness(p);
    },

    async refreshReadiness(p, auth, from, signal) {
      const inputs: ReadinessInputs = from ?? { ...loaded(p), legs: get().legs };
      // A run's check (`from`) asks about its own shape: it starts no new
      // generation, so a panel check or an edit meanwhile keeps its answer
      // out of the store, but never replaces the answer the run gets back.
      const seq = from ? (checkSeq.get(p.id) ?? 0) : supersede(p);
      const newest = () => (checkSeq.get(p.id) ?? 0) === seq;
      const credentials = readCredentials(p, inputs.settings, inputs.credentials, auth);
      // The runner's own code for the same gap, `RunNoticeCode`.
      if (isMissing(credentials)) return setReadiness(p, { state: 'not-ready', reason: credentials.missing, code: 'credentials_missing' });
      // The fields these settings show, for the cache key below.
      const values = Object.fromEntries(p.credentials.fields(inputs.settings).map((f) => [f.key, inputs.credentials[f.key] ?? '']));
      // A network check gives the same ready answer to the same inputs, so a
      // ready answer is kept; a refusal is asked again, and a local engine's
      // readiness changes as models download.
      const key = JSON.stringify([inputs.settings, values, auth.signedIn, inputs.pair, inputs.legs]);
      const kept = p.kind === 'local' ? undefined : lastAnswer.get(p.id);
      if (kept && kept.inputs === key) return setReadiness(p, kept.readiness);

      setReadiness(p, { state: 'checking' });
      // Cancelled (a Stop while checking): it found nothing out, whichever
      // way it settled — no report, nothing kept, and unknown again.
      const cancelled = (): Readiness => (newest() ? setReadiness(p, UNKNOWN) : UNKNOWN);
      let answer: Readiness;
      try {
        const result = await p.check(credentials, inputs.settings, { pair: inputs.pair, legs: inputs.legs, signal });
        if (signal?.aborted) return cancelled();
        answer = result.ok
          ? { state: 'ready', models: result.models ?? [] }
          : { state: 'not-ready', reason: result.reason, ...(result.code ? { code: result.code } : {}), ...(result.params ? { params: result.params } : {}) };
        if (p.kind !== 'local' && result.ok) lastAnswer.set(p.id, { inputs: key, readiness: answer });
      } catch (error) {
        if (signal?.aborted) return cancelled();
        // A check that threw did not find out; show it, never keep it.
        reportError('ProviderStore', `The readiness check for ${p.id} failed: ${describeCause(error)}`, {
          cause: error,
          dedupeKey: `readiness:${p.id}`,
        });
        answer = { state: 'not-ready', reason: describeCause(error) };
      }
      if (!newest()) return from ? answer : get().readiness[p.id] ?? UNKNOWN;
      return setReadiness(p, answer);
    },
  };
});

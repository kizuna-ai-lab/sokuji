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
import type { AnyProvider, AuthContext, CredentialValues, LanguagePair, ModelOption, Readiness } from '../lib/provider/types';
import { languageContext, type SpeechInputs } from '../lib/session/shape';
import { selectionToPersist } from '../lib/session/storedSettings';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

/** One provider's saved state. */
export interface ProviderEntry {
  /** The provider's `S`; generic code never looks inside. */
  settings: unknown;
  /** Every key in `credentials.keys`; '' where nothing is saved. */
  credentials: CredentialValues;
  /** The pair the surfaces show and a run starts: the stored pair, within what the store's language context offers. */
  pair: LanguagePair;
  /**
   * The pair as the user left it, while the language context narrows it
   * away (Stage 2 Volcengine AST2, choice 1): Doubao's text-only Korean
   * while a run would speak. Absent when it is `pair` — for every provider
   * whose languages ignore the context. It is what persists: a context
   * change derives `pair` from it again, and writes nothing.
   */
  stored?: LanguagePair;
}

export type { Readiness } from '../lib/provider/types';

export const UNKNOWN: Readiness = { state: 'unknown' };

export const NO_MODELS: readonly ModelOption[] = Object.freeze([]);

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
  /** The models the latest ready answer found, per provider (F2; choice 3): kept while a re-check runs and through a check that threw, so a model list does not empty on every edit or while offline; emptied when the provider said no or the credentials are missing. */
  models: Readonly<Record<string, readonly ModelOption[]>>;
  load(p: AnyProvider): Promise<void>;
  updateSettings(p: AnyProvider, patch: Readonly<Record<string, unknown>>): void;
  setCredential(p: AnyProvider, key: string, value: string): void;
  setPair(p: AnyProvider, pair: LanguagePair): void;
  /**
   * Writes again every value whose last write did not land, then waits for
   * every write started so far, those included. True when nothing it answers
   * for is left unsaved. With `p`, only `p`'s own settings and the selection
   * are written again and answered for; with `fields` too, only those of
   * `p`'s fields (`PAIR_FIELDS` for its pair) and the selection. A value this
   * caller did not write is not its to fail on.
   */
  flush(p?: AnyProvider, fields?: readonly string[]): Promise<boolean>;
  /**
   * Runs the provider's `check` on the live entry (with the store's `legs`),
   * or on a run's shape (`from`), and records the answer. A run's check
   * returns its own answer even when a newer check began meanwhile; that one
   * only keeps it out of the store. A check its `signal` cancelled answers
   * unknown and reports nothing.
   */
  refreshReadiness(p: AnyProvider, auth: AuthContext, from?: ReadinessInputs, signal?: AbortSignal): Promise<Readiness>;
  /** Forgets `p`'s readiness — a sign-in flip, for a managed provider: it is unknown, and a check still in flight no longer counts. The last ready answer, kept with its inputs, stays: a check for exactly those inputs is served from it. */
  forgetReadiness(p: Pick<AnyProvider, 'id'>): void;
  /** The legs a start would open now, speaker first (appShape's `watchLegsFromStores` keeps them); the speaker alone until then. */
  legs: readonly LegName[];
  /** Other legs change what a check answers: every loaded provider's readiness is forgotten, and each pair derived again for the new language context. The same legs change nothing. */
  setLegs(legs: readonly LegName[]): void;
  /** Whether a run would speak besides its legs (appShape's `watchSpeechFromStores` keeps it): with the legs, each provider's language context (Stage 2 Volcengine AST2, choice 1). Nothing speaks until it is kept. */
  speech: SpeechInputs;
  /** Every loaded entry's pair is derived again from its stored pair, nothing written; a provider whose pair moved forgets its readiness. The same inputs change nothing. */
  setSpeech(inputs: SpeechInputs): void;
  /** The provider the panel shows and a run starts. A person's pick persists (old enum spelling, `storedSettings.ts`); a load never writes (1e-3 ruling 2). */
  selected: string | null;
  /** Refused, with a warning, while `selectionLocked`. */
  select(id: string, how?: 'load' | 'pick'): void;
  /** True while a run is not idle (the app session's `attach()` keeps it): the provider is fixed then. */
  selectionLocked: boolean;
  setSelectionLocked(locked: boolean): void;
}

/** The pair persists beside the settings, under the field names every slice uses today. */
const SOURCE = 'sourceLanguage';
const TARGET = 'targetLanguage';
/** The fields a pair is stored under, for a caller that flushes what it wrote. */
export const PAIR_FIELDS = [SOURCE, TARGET] as const;

function storageKey(p: AnyProvider, field: string): string {
  return `settings.${p.settings.key}.${field}`;
}

/** A legacy key: a field under the provider's prefix, or — starting with `settings.` — a whole storage key, a global the provider now owns a copy of (Stage 2 Gemini, choice 1). */
function legacyStorageKey(p: AnyProvider, key: string): string {
  return key.startsWith('settings.') ? key : storageKey(p, key);
}

/** The latest check per provider: a check that finishes after a newer one began, or after its inputs changed, stays out of the store (a run's own check still gets its answer back). */
const checkSeq = new Map<string, number>();
/** The last answer per network provider, with the inputs it answered. */
const lastAnswer = new Map<string, { inputs: string; readiness: Readiness }>();
/** The definition each entry was loaded from: what a language context change derives its pair with. */
const loadedProviders = new Map<string, AnyProvider>();

export const useProviderStore = create<ProviderStore>()((set, get) => {
  /** Writing to a provider before `load` resolves is a bug in the caller. */
  const loaded = (p: AnyProvider): ProviderEntry => {
    const entry = get().entries[p.id];
    if (!entry) throw new Error(`Provider "${p.id}" is not loaded`);
    return entry;
  };
  const put = (p: AnyProvider, entry: ProviderEntry) => set((st) => ({ entries: { ...st.entries, [p.id]: entry } }));
  /** Writes in flight, and the last value per key whose write did not land (a later write of the key replaces it). */
  const writing = new Set<Promise<boolean>>();
  const unsaved = new Map<string, unknown>();
  const latest = new Map<string, number>();
  let writes = 0;
  /** Every write this store makes goes through here, so `flush` can wait for it. */
  const write = (key: string, value: unknown): void => {
    const mine = ++writes;
    latest.set(key, mine);
    unsaved.delete(key);
    // persistSetting never rejects; it reports a failure itself.
    const done = persistSetting(key, value).then((ok) => {
      if (!ok && latest.get(key) === mine) unsaved.set(key, value);
      return ok;
    });
    writing.add(done);
    void done.then(() => { writing.delete(done); });
  };
  const persistPair = (p: AnyProvider, before: LanguagePair, after: LanguagePair) => {
    if (after.source !== before.source) write(storageKey(p, SOURCE), after.source);
    if (after.target !== before.target) write(storageKey(p, TARGET), after.target);
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
  /**
   * An entry's pair from the pair the user left: within the languages the
   * store's context offers (Stage 2 Volcengine AST2, choice 1); `stored`
   * kept only where the two differ.
   */
  const derive = (p: AnyProvider, settings: unknown, stored: LanguagePair): Pick<ProviderEntry, 'pair' | 'stored'> => {
    const pair = normalizePair(p, settings, stored, languageContext(p, get().legs, get().speech));
    return pair.source === stored.source && pair.target === stored.target ? { pair } : { pair, stored };
  };
  /** The context moved: every loaded entry's pair derived again, nothing written. */
  const rederive = () => {
    for (const [id, entry] of Object.entries(get().entries)) {
      const p = loadedProviders.get(id);
      if (!p) continue;
      const next = derive(p, entry.settings, entry.stored ?? entry.pair);
      if (next.pair.source === entry.pair.source && next.pair.target === entry.pair.target) continue;
      put(p, { settings: entry.settings, credentials: entry.credentials, ...next });
      // The check reads the pair: its answer was about the other one.
      forgetReadiness(p);
    }
  };

  return {
    entries: {},
    readiness: {},
    models: {},
    selected: null,
    select(id, how = 'load') {
      if (get().selectionLocked) {
        // Spec, "What may change during a run": the provider is fixed while the phase is not idle.
        reportWarning('ProviderStore', `The provider cannot change during a session; "${id}" was not selected.`, { dedupeKey: 'select:locked' });
        return;
      }
      set({ selected: id });
      const value = selectionToPersist(id, how);
      if (value !== null) write('settings.common.provider', value);
    },
    selectionLocked: false,
    setSelectionLocked(locked) {
      // Called on every runner state change: an unchanged value notifies no one.
      if (get().selectionLocked === locked) return;
      set({ selectionLocked: locked });
    },
    legs: ['speaker'],

    setLegs(legs) {
      const now = get().legs;
      if (legs.length === now.length && legs.every((leg, i) => leg === now[i])) return;
      set({ legs });
      for (const id of Object.keys(get().entries)) forgetReadiness({ id });
      rederive();
    },
    speech: { textOnly: false, participantSpeech: false },
    setSpeech(inputs) {
      const now = get().speech;
      if (now.textOnly === inputs.textOnly && now.participantSpeech === inputs.participantSpeech) return;
      set({ speech: { textOnly: inputs.textOnly, participantSpeech: inputs.participantSpeech } });
      rederive();
    },

    async load(p) {
      const service = ServiceFactory.getSettingsService();
      const defaults = p.settings.defaults as Record<string, unknown>;
      const fields = Object.keys(defaults);
      const legacyKeys = p.settings.legacyKeys ?? [];
      // Every value is read with a default of its own type: getSetting returns
      // a stored string untouched only when the default is a string, and
      // JSON-parses it otherwise — a key "123456" would come back a number.
      const [values, secrets, legacyValues, source, target] = await Promise.all([
        Promise.all(fields.map((f) => service.getSetting<unknown>(storageKey(p, f), defaults[f]))),
        Promise.all(p.credentials.keys.map((k) => service.getSetting(storageKey(p, k), ''))),
        // No default: `undefined` tells "never stored" from "stored as the default" (F5).
        Promise.all(legacyKeys.map((k) => service.getSetting<unknown>(legacyStorageKey(p, k), undefined))),
        service.getSetting(storageKey(p, SOURCE), ''),
        service.getSetting(storageKey(p, TARGET), ''),
      ]);
      // A second load racing the first (a remounted panel) must not undo an
      // edit made after the first one landed.
      if (get().entries[p.id]) return;
      const stored = Object.fromEntries(fields.map((f, i) => [f, values[i]]));
      const credentials: CredentialValues = Object.fromEntries(p.credentials.keys.map((k, i) => [k, secrets[i]]));
      const legacy = Object.fromEntries(legacyKeys.map((k, i) => [k, legacyValues[i]]));
      const settings = p.settings.migrate ? p.settings.migrate(stored, { legacy, credentials }) : stored;
      const initial = p.languages.initial?.(settings) ?? {};
      const pair = { source, target };
      // Kept within the widest offer; what a run starts is derived from it for the context (choice 1). Nothing is written.
      const kept = normalizePair(p, settings, { source: pair.source || initial.source, target: pair.target || initial.target });
      loadedProviders.set(p.id, p);
      put(p, { settings, credentials, ...derive(p, settings, kept) });
    },

    updateSettings(p, patch) {
      const entry = loaded(p);
      const settings = { ...(entry.settings as Record<string, unknown>), ...patch };
      // New settings can change the languages on offer; the pair the user left follows them, and the run's pair is derived from it.
      const before = entry.stored ?? entry.pair;
      const kept = normalizePair(p, settings, before);
      const next = derive(p, settings, kept);
      put(p, { settings, credentials: entry.credentials, ...next });
      for (const [field, value] of Object.entries(patch)) write(storageKey(p, field), value);
      persistPair(p, before, kept);
      // The answer holds while the check would read the same inputs (ruling 9): no field it reads was edited, and the run's pair did not move.
      const touched = p.checkReads === undefined || Object.keys(patch).some((field) => p.checkReads!.includes(field));
      const moved = next.pair.source !== entry.pair.source || next.pair.target !== entry.pair.target;
      if (touched || moved) forgetReadiness(p);
    },

    setCredential(p, key, value) {
      const entry = loaded(p);
      if (!p.credentials.keys.includes(key)) throw new Error(`Provider "${p.id}" has no credential "${key}"`);
      put(p, { ...entry, credentials: { ...entry.credentials, [key]: value } });
      write(storageKey(p, key), value);
      forgetReadiness(p);
    },

    setPair(p, pair) {
      const entry = loaded(p);
      const before = entry.stored ?? entry.pair;
      // A pick is kept as picked, within the widest offer: one the context cannot run stays stored for the context that can (the wizard's text-only pick while a run would speak).
      const kept = normalizePair(p, entry.settings, pair);
      put(p, { settings: entry.settings, credentials: entry.credentials, ...derive(p, entry.settings, kept) });
      persistPair(p, before, kept);
      forgetReadiness(p);
    },

    async flush(p, fields) {
      const covers = (key: string) => !p || key === 'settings.common.provider'
        || (fields ? fields.some((field) => key === storageKey(p, field)) : key.startsWith(`settings.${p.settings.key}.`));
      for (const [key, value] of [...unsaved]) {
        if (covers(key)) write(key, value);
      }
      await Promise.all([...writing]);
      return ![...unsaved.keys()].some(covers);
    },

    async refreshReadiness(p, auth, from, signal) {
      const inputs: ReadinessInputs = from ?? { ...loaded(p), legs: get().legs };
      // A run's check (`from`) asks about its own shape: it starts no new
      // generation, so a panel check or an edit meanwhile keeps its answer
      // out of the store, but never replaces the answer the run gets back.
      const seq = from ? (checkSeq.get(p.id) ?? 0) : supersede(p);
      const newest = () => (checkSeq.get(p.id) ?? 0) === seq;
      /** Records an answer: its readiness, and the models it found — none when the provider said no; unchanged when the check could not find out (choice 3). */
      const answered = (readiness: Readiness, foundOut = true): Readiness => {
        if (foundOut && (readiness.state === 'ready' || readiness.state === 'not-ready')) {
          // One write: a subscriber never sees the models land while readiness is still unknown (the readiness driver would ask again).
          set((st) => ({
            models: { ...st.models, [p.id]: readiness.state === 'ready' ? readiness.models : NO_MODELS },
            readiness: { ...st.readiness, [p.id]: readiness },
          }));
          return readiness;
        }
        return setReadiness(p, readiness);
      };
      const credentials = readCredentials(p, inputs.settings, inputs.credentials, auth);
      // The provider's own code (a managed provider's `sign_in_required`), or the runner's own for the same gap.
      if (isMissing(credentials)) {
        return answered({
          state: 'not-ready', reason: credentials.missing, code: credentials.code ?? 'credentials_missing',
          ...(credentials.params ? { params: credentials.params } : {}),
        });
      }
      // The fields these settings show, for the cache key below.
      const values = Object.fromEntries(p.credentials.fields(inputs.settings).map((f) => [f.key, inputs.credentials[f.key] ?? '']));
      // A network check gives the same ready answer to the same inputs, so a
      // ready answer is kept; a refusal is asked again, and a local engine's
      // readiness changes as models download. Only a managed provider's
      // answer turns on the sign-in and the account; an own-key one checks its key.
      const account = p.kind === 'managed' ? [auth.signedIn, auth.userId ?? null] : [];
      // Only the fields the check reads key its answer (ruling 9), so a run started after an edit elsewhere is served from it.
      const read = p.checkReads === undefined
        ? inputs.settings
        : Object.fromEntries(p.checkReads.map((field) => [field, (inputs.settings as Record<string, unknown>)[field]]));
      const key = JSON.stringify([read, values, ...account, inputs.pair, inputs.legs]);
      const kept = p.kind === 'local' ? undefined : lastAnswer.get(p.id);
      if (kept && kept.inputs === key) return answered(kept.readiness);

      setReadiness(p, { state: 'checking' });
      // Cancelled (a Stop while checking): it found nothing out, whichever
      // way it settled — no report, nothing kept, and unknown again.
      const cancelled = (): Readiness => (newest() ? setReadiness(p, UNKNOWN) : UNKNOWN);
      let answer: Readiness;
      let threw = false;
      try {
        const result = await p.check(credentials, inputs.settings, { pair: inputs.pair, legs: inputs.legs, signal });
        if (signal?.aborted) return cancelled();
        answer = result.ok
          // No models found: the one shared empty list, so a component's `models` keeps its identity across answers.
          ? { state: 'ready', models: result.models?.length ? result.models : NO_MODELS }
          : { state: 'not-ready', reason: result.reason, ...(result.code ? { code: result.code } : {}), ...(result.params ? { params: result.params } : {}) };
        if (p.kind !== 'local' && result.ok) lastAnswer.set(p.id, { inputs: key, readiness: answer });
      } catch (error) {
        if (signal?.aborted) return cancelled();
        threw = true;
        // A check that threw did not find out; show it, never keep it.
        reportError('ProviderStore', `The readiness check for ${p.id} failed: ${describeCause(error)}`, {
          cause: error,
          dedupeKey: `readiness:${p.id}`,
        });
        answer = { state: 'not-ready', reason: describeCause(error) };
      }
      if (!newest()) return from ? answer : get().readiness[p.id] ?? UNKNOWN;
      return answered(answer, !threw);
    },

    forgetReadiness,
  };
});

// src/stores/lineUpStore.ts
//
// The line-up: which provider serves each stage. Stored as one value,
// `settings.lineup`, and what a session runs: the plan is composed from it
// (`src/lib/plan/fromStores.ts`). When none is stored it is worked out once
// from today's values and written (the one migration, owner 2026-11-15);
// until then the provider that ran before runs, alone (`unstoredProvider`).
//
// Stored as `{ version: 2, stages }`. Version 1 is still read: it was written
// by a version of the app that stored the provider before the line-up, so a
// version-1 line-up its stored provider does not run is worked out again from
// the provider, once, and written as version 2. A version-2 line-up is used as
// stored. An older version of the app does not accept version 2: it shows its
// own values and leaves the stored line-up alone.
import { useMemo } from 'react';
import { create } from 'zustand';
import { choose as chooseIn, type Choice } from '../lib/lineup/choose';
import { caps, hostDefaults, optionFor, runsByItself, soleHost } from '../lib/lineup/catalog';
import { localStagesOf, type LocalStages } from '../lib/lineup/localStages';
import { lineUpFromToday } from '../lib/lineup/migrate';
import type { LineUp, RunStage, StageName } from '../lib/lineup/types';
import type { AnalyticsEvents } from '../lib/analytics';
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import type { Selections } from '../lib/local-inference/selection/types';
import { choiceInput } from '../lib/plan/choice';
import { presentHosts } from '../lib/plan/present';
import { selectionFromStored } from '../lib/session/storedSettings';
import { guardAstCrossStage } from '../services/providers/astGuard';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';
import { useModelStore } from './modelStore';
import { useProviderStore } from './providerStore';

export const LINEUP_KEY = 'settings.lineup';
/**
 * The provider an older version of the app opens, and the one that runs until a line-up is stored. Read once, by
 * `load`; written after a choice or a replace has stored its line-up, with the provider that transcribes.
 */
const PROVIDER_KEY = 'settings.common.provider';

interface StoredLineUp { version: 1 | 2; stages: LineUp }

export interface LineUpStore {
  /**
   * What the settings show: the stored line-up; while none is stored, today's values for the provider that runs
   * (the local host's defaults until the local migration has written). Null before the load.
   */
  lineUp: LineUp | null;
  /** True once a line-up is in storage (read, migrated, or chosen): it is then what a session runs. */
  stored: boolean;
  /**
   * The provider that runs while no line-up is stored: the stored provider after today's fallback for an id that is
   * retired, unknown or not offered here (the first offered provider). Null before the load, and once a line-up is
   * stored: the line-up then says what runs.
   */
  unstoredProvider: string | null;
  /** True while a run is not idle (the app session's `attach()` keeps it): the line-up, and so what runs, is fixed then. */
  locked: boolean;
  setLocked(locked: boolean): void;
  load(): Promise<void>;
  /**
   * Refused (null, nothing written) during a run, or while no line-up is shown. The first choice on a line-up that
   * is shown but not stored yet stores it.
   */
  choose(stage: StageName, providerId: string | null): Promise<Choice | null>;
  /**
   * The setup wizard's whole line-up (Plan 6): the stored notes choice kept, the line-up then stored, so a local
   * migration still waiting on its scan writes nothing over it. False, and nothing kept, during a run (also one
   * that starts before the line-up is shown) or when the write did not land: the line-up of before is then put
   * back, once the run ends when one started on the new line-up meanwhile.
   */
  replace(stages: Pick<LineUp, RunStage>): Promise<boolean>;
}

const STAGE_NAMES: readonly StageName[] = ['transcription', 'translation', 'speech', 'summarisation'];

function isStoredLineUp(value: unknown): value is StoredLineUp {
  if (!value || typeof value !== 'object') return false;
  const v = value as { version?: unknown; stages?: Record<string, unknown> };
  if ((v.version !== 1 && v.version !== 2) || !v.stages || typeof v.stages !== 'object') return false;
  // Every run stage names a provider this build knows (the notes stage is not in the catalog yet).
  return STAGE_NAMES.every((s) => v.stages![s] === null || (typeof v.stages![s] === 'string' && (s === 'summarisation' || caps(v.stages![s] as string) !== undefined)));
}

async function write(lineUp: LineUp): Promise<boolean> {
  return persistSetting(LINEUP_KEY, { version: 2, stages: lineUp } satisfies StoredLineUp);
}

/**
 * After a choice or a replace has stored its line-up: the provider that transcribes is written beside it, so that an
 * older version of the app, which reads no version-2 line-up, opens that provider. Never written at launch: a
 * line-up worked out from the stored provider says nothing new about it. A write that does not land is reported by
 * `persistSetting` and changes nothing here: this version reads the line-up.
 */
async function writeProvider(lineUp: LineUp): Promise<void> {
  const host = lineUp.transcription === null ? undefined : caps(lineUp.transcription)?.host;
  if (host !== undefined) await persistSetting(PROVIDER_KEY, host);
}

/** The provider today's values name: the stored one when it is offered here, the default managed one for a retired managed id, else the first offered; null when none is offered. */
function providerFromToday(stored: unknown): string | null {
  // Only a provider that serves every stage by itself: the retired OpenAI Compatible's stored id is now a text model's.
  const offered = presentHosts().filter((p) => runsByItself(p.id));
  return selectionFromStored(stored, offered.map((p) => p.id), offered.find((p) => p.kind === 'managed')?.id ?? null)?.id ?? null;
}

/** What the settings show for a provider while no line-up is stored. */
function shownFor(provider: string): LineUp {
  return provider === 'local_inference' ? { ...hostDefaults('local_inference'), summarisation: null } : lineUpFromToday({ provider, local: null });
}

/**
 * What today's local choices resolve to, Bing and Edge included, in both directions of the current pair, as a
 * session resolves them (with the AST guard). One line-up serves both directions: where either direction uses
 * Bing or Edge today, the line-up keeps them, so both directions go on working (owner, 2026-11-15).
 */
function todayLocal(): { translation: string | null; tts: string | null } {
  const entry = useProviderStore.getState().entries.local_inference;
  const selections = ((entry?.settings as { selections?: Selections } | undefined)?.selections) ?? {};
  const pair = entry?.pair ?? { source: '', target: '' };
  const direction = (src: string, tgt: string) => {
    const resolve = (masked: Selections) => useModelStore.getState().resolve(src, tgt, masked);
    return guardAstCrossStage(src, tgt, selections, resolve(selections), resolve);
  };
  const results = [direction(pair.source, pair.target), direction(pair.target, pair.source)];
  const either = (pick: (r: (typeof results)[number]) => string | null | undefined, cloud: string) =>
    results.some((r) => pick(r) === cloud) ? cloud : (pick(results[0]) ?? null);
  return {
    translation: either((r) => r.translation?.modelId, 'bing-translator'),
    tts: either((r) => r.tts?.modelId, 'edge-tts'),
  };
}

/** Replaces in progress (the setup wizard's Finish): the local migration writes nothing while one runs. */
let replacing = 0;
/** The local migration's write while it is in flight: a replace waits for it, so its own write lands last. */
let migrationWrite: Promise<boolean> | null = null;

export const useLineUpStore = create<LineUpStore>()((set, get) => {
  /**
   * The one migration's write, of the line-up worked out for `provider`. A line-up stored meanwhile (the setup
   * wizard) stands: none is written over it, and one stored while this write is in flight is not replaced in
   * memory either (the wizard waits for this write, so its own lands last in storage). The same for another
   * provider that came to run meanwhile (`runUnstored`): the line-up was worked out for a provider that no longer
   * runs, and what runs now is left as it is.
   */
  const migrate = async (provider: string, lineUp: LineUp): Promise<void> => {
    const superseded = () => get().stored || replacing > 0 || get().unstoredProvider !== provider;
    if (superseded()) return;
    migrationWrite = write(lineUp);
    const landed = await migrationWrite;
    migrationWrite = null;
    if (superseded()) return;
    set(landed ? { lineUp, stored: true, unstoredProvider: null } : { lineUp, stored: false });
  };
  return {
  lineUp: null,
  stored: false,
  unstoredProvider: null,
  locked: false,
  setLocked(locked) {
    // Called on every runner state change: an unchanged value notifies no one.
    if (get().locked === locked) return;
    set({ locked });
  },

  async load() {
    const service = ServiceFactory.getSettingsService();
    const [value, storedProvider] = await Promise.all([
      service.getSetting<unknown>(LINEUP_KEY, null),
      service.getSetting<unknown>(PROVIDER_KEY, ''),
    ]);
    // The wizard stored a line-up while this was reading: what it read is older, and changes nothing.
    if (get().stored || replacing > 0) return;
    // A provider the page already runs in memory (the development preview's) stays: nothing stored is applied over
    // it, and nothing is written.
    const already = get().unstoredProvider;
    if (already !== null) {
      if (!get().lineUp) set({ lineUp: shownFor(already) });
      return;
    }
    const provider = providerFromToday(storedProvider);
    if (isStoredLineUp(value)) {
      // Version 2 is used as stored, whatever the stored provider says: a line-up that cannot run here is still the
      // user's, to be changed on the line-up page. Version 1 was written after its provider, so a save cut short by
      // a restart (or a provider changed in an older version of the app) leaves an older line-up beside a newer
      // provider: a line-up that provider does not run is worked out again from it, as on the first start.
      if (value.version === 2 || !provider || soleHost(value.stages) === provider) {
        set({ lineUp: value.stages, stored: true, unstoredProvider: null });
        return;
      }
    } else if (value !== null && value !== undefined) {
      if (!provider) return;
      // Stored, but not a line-up this build can read (another version, a provider it does not know): shown as
      // today's values, never overwritten by the migration; a session runs today's provider.
      set({ lineUp: shownFor(provider), stored: false, unstoredProvider: provider });
      return;
    }
    if (!provider) return;
    // A provider the catalog does not hold (a development build's fake) has no line-up to store: it runs as it
    // is, and the settings show what they showed before.
    if (!caps(provider)) {
      set({ lineUp: shownFor(provider), stored: false, unstoredProvider: provider });
      return;
    }
    set({ unstoredProvider: provider });
    if (provider !== 'local_inference') {
      await migrate(provider, lineUpFromToday({ provider, local: null }));
      return;
    }
    // The local provider: what today's automatic choices pick is known only after the scan of downloaded
    // models. Until then the settings show the local host's defaults and a session resolves as today.
    set({ lineUp: shownFor(provider), stored: false });
    void (async () => {
      await useModelStore.getState().initialize();
      // A failed scan reports no downloaded model: worked out now, every local choice would read as Bing and
      // Edge for good. Write nothing; the next start tries again, and until then a session resolves as today.
      if (!useModelStore.getState().initialized) return;
      // Today's choices are read from the local provider's own settings and pair: its entry is loaded first.
      const local = presentHosts().find((p) => p.id === provider);
      if (local && !useProviderStore.getState().entries[provider]) await useProviderStore.getState().load(local);
      // What runs may have changed during the waits above: `migrate` writes only for the provider this started for.
      await migrate(provider, lineUpFromToday({ provider, local: todayLocal() }));
    })().catch((error: unknown) => {
      // The scan or the local entry's load failed: as after a failed scan, nothing is written and the next start
      // tries again.
      reportWarning('LineUpStore', `Working out the line-up of this device failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'line-up:local-migration' });
    });
  },

  async replace(stages) {
    if (get().locked) return false;
    // Claimed at once, before any wait: a migration whose scan ends from here on writes nothing, and one already
    // writing is waited for, so this write lands last in storage.
    replacing += 1;
    try {
      if (migrationWrite) await migrationWrite;
      const value = await ServiceFactory.getSettingsService().getSetting<unknown>(LINEUP_KEY, null);
      // A run that started during the waits above froze the line-up as it stood: nothing is shown or written over it.
      if (get().locked) return false;
      const summarisation = isStoredLineUp(value) ? value.stages.summarisation : get().lineUp?.summarisation ?? null;
      const lineUp: LineUp = { ...stages, summarisation };
      const before = { lineUp: get().lineUp, stored: get().stored, unstoredProvider: get().unstoredProvider };
      set({ lineUp, stored: true, unstoredProvider: null });
      if (await write(lineUp)) {
        await writeProvider(lineUp);
        return true;
      }
      // Not stored: the line-up of before is put back, so what is shown is what is kept. A run that started
      // meanwhile froze the new line-up and locks it: it stays what the run started with until the run ends.
      const undo = () => {
        if (get().lineUp !== lineUp) return;
        set(before);
      };
      if (!get().locked) undo();
      else {
        const off = useLineUpStore.subscribe((s) => { if (!s.locked) { off(); undo(); } });
      }
      return false;
    } finally {
      replacing -= 1;
    }
  },

  choose(stage, providerId) {
    // One choice at a time: a second waits for the first's save, so each undo puts back what it replaced. With
    // none pending, a choice shows at once.
    const now = () => chooseNow(stage, providerId);
    const next = pending ? pending.then(now) : now();
    const settled = next.then(() => undefined, () => undefined);
    pending = settled;
    void settled.then(() => { if (pending === settled) pending = null; });
    return next;
  },
  };
});

/** The choices still being saved, settled: a new choice waits for them. */
let pending: Promise<void> | null = null;

async function chooseNow(stage: StageName, providerId: string | null): Promise<Choice | null> {
  const { getState: get, setState: set } = useLineUpStore;
  const { lineUp, stored, unstoredProvider } = get();
  if (get().locked || !lineUp) return null;
  const choice = chooseIn(lineUp, stage, providerId, choiceInput(presentHosts(), useProviderStore.getState().entries));
  // Shown before the save: a run starting while the line-up is being written runs the new one. A line-up shown but
  // not stored yet is stored by its first choice.
  set({ lineUp: choice.lineUp, stored: true, unstoredProvider: null });
  if (await write(choice.lineUp)) {
    await writeProvider(choice.lineUp);
    return choice;
  }
  // Not stored: the choice is undone, so what is shown is what is kept. A run that started meanwhile froze the new
  // line-up and locks it: it stays what the run started with until the run ends.
  const undo = () => {
    if (get().lineUp !== choice.lineUp) return;
    set({ lineUp, stored, unstoredProvider });
  };
  if (!get().locked) undo();
  else {
    const off = useLineUpStore.subscribe((s) => { if (!s.locked) { off(); undo(); } });
  }
  return null;
}

/**
 * For the development preview and its picker only: `providerId` runs alone with no line-up stored, in memory, as a
 * launch leaves a provider whose line-up is not written yet (the only way to run a provider the catalog does not
 * hold). A pick also writes the provider an older version of the app opens. The stored line-up is never touched: the
 * next launch runs it again when there is one. Refused (false) during a run.
 */
export function runUnstored(providerId: string, how: 'load' | 'pick' = 'load'): boolean {
  if (useLineUpStore.getState().locked) return false;
  useLineUpStore.setState({ lineUp: shownFor(providerId), stored: false, unstoredProvider: providerId });
  if (how === 'pick') void persistSetting(PROVIDER_KEY, providerId);
  return true;
}

/**
 * The id of the provider that serves `stage` as a line-up store state stands, by the catalog alone, so it is known
 * before that provider's entry has loaded and when the composer refuses the line-up: the host of the stored
 * line-up's option for the stage; while none is stored, the provider that runs meanwhile. Null before the load, and
 * for a stage the stored line-up leaves out. A surface that needs what the provider can do reads the plan instead.
 */
export function stageProviderIn(s: Pick<LineUpStore, 'lineUp' | 'stored' | 'unstoredProvider'>, stage: RunStage): string | null {
  if (!s.stored) return s.unstoredProvider;
  return (s.lineUp && optionFor(s.lineUp, stage)?.host) ?? null;
}

/** `stageProviderIn` over the store as it stands. */
export function stageProviderId(stage: RunStage): string | null {
  return stageProviderIn(useLineUpStore.getState(), stage);
}

/** `stageProviderId` for a component: it re-renders when the answer changes. */
export function useStageProviderId(stage: RunStage): string | null {
  return useLineUpStore((s) => stageProviderIn(s, stage));
}

/** The same, for a component: it re-renders when the stored line-up changes. */
export function useStoredLocalStages(): LocalStages | null {
  const lineUp = useLineUpStore((s) => s.lineUp);
  const stored = useLineUpStore((s) => s.stored);
  return useMemo(() => (stored ? localStagesOf(lineUp) : null), [lineUp, stored]);
}

/** The local stages of the stored line-up; null until one is stored, so the local provider resolves as today. */
export function storedLocalStages(): LocalStages | null {
  const { lineUp, stored } = useLineUpStore.getState();
  return stored ? localStagesOf(lineUp) : null;
}

/** The analytics event for a choice, sent by the screen that made it: provider ids per stage, never content. */
export function lineUpChangedEvent(stage: StageName, before: LineUp, choice: Choice): AnalyticsEvents['lineup_changed'] {
  return { stage, from: before[stage], to: choice.lineUp[stage], moved: choice.moved, during_session: false };
}

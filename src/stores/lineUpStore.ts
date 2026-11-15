// src/stores/lineUpStore.ts
//
// The line-up: which provider serves each stage. Stored as one value,
// `settings.lineup`; when it is absent it is worked out once from today's
// values and written (the one migration, owner 2026-11-15). The session still
// runs through the provider store's selected provider (phase 1): a choice here
// keeps that selection in step.
import { useMemo } from 'react';
import { create } from 'zustand';
import { choose as chooseIn, type Choice } from '../lib/lineup/choose';
import { caps, familyDefaults, runOf } from '../lib/lineup/catalog';
import { localStagesOf, type LocalStages } from '../lib/lineup/localStages';
import { lineUpFromToday } from '../lib/lineup/migrate';
import type { LineUp, RunStage, StageName } from '../lib/lineup/types';
import type { AnalyticsEvents } from '../lib/analytics';
import type { Selections } from '../lib/local-inference/selection/types';
import { guardAstCrossStage } from '../services/providers/astGuard';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';
import { useModelStore } from './modelStore';
import { useProviderStore } from './providerStore';

export const LINEUP_KEY = 'settings.lineup';

interface StoredLineUp { version: 1; stages: LineUp }

export interface LineUpStore {
  /** What the settings show: the stored line-up, or until the local migration has written, the local family's defaults. */
  lineUp: LineUp | null;
  /** True once a line-up is in storage (read, migrated, or chosen). */
  stored: boolean;
  load(): Promise<void>;
  /** Refused (null, nothing written) during a run or before the migration has written. */
  choose(stage: StageName, providerId: string | null): Promise<Choice | null>;
  /**
   * The setup wizard's whole line-up (Plan 6): the stored notes choice kept, the line-up then stored, so a local
   * migration still waiting on its scan writes nothing over it. False, and nothing kept, during a run or when the
   * write did not land.
   */
  replace(stages: Pick<LineUp, RunStage>): Promise<boolean>;
}

const STAGE_NAMES: readonly StageName[] = ['transcription', 'translation', 'speech', 'summarisation'];

function isStoredLineUp(value: unknown): value is StoredLineUp {
  if (!value || typeof value !== 'object') return false;
  const v = value as { version?: unknown; stages?: Record<string, unknown> };
  if (v.version !== 1 || !v.stages || typeof v.stages !== 'object') return false;
  // Every run stage names a provider this build knows (the notes stage is not in the catalog yet).
  return STAGE_NAMES.every((s) => v.stages![s] === null || (typeof v.stages![s] === 'string' && (s === 'summarisation' || caps(v.stages![s] as string) !== undefined)));
}

async function write(lineUp: LineUp): Promise<boolean> {
  return persistSetting(LINEUP_KEY, { version: 1, stages: lineUp } satisfies StoredLineUp);
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
   * The one migration's write. A line-up stored meanwhile (the setup wizard) stands: none is written over it, and
   * one stored while this write is in flight is not replaced in memory either (the wizard waits for this write, so
   * its own lands last in storage).
   */
  const migrate = async (lineUp: LineUp): Promise<void> => {
    if (get().stored || replacing > 0) return;
    migrationWrite = write(lineUp);
    const landed = await migrationWrite;
    migrationWrite = null;
    if (get().stored || replacing > 0) return;
    set({ lineUp, stored: landed });
  };
  return {
  lineUp: null,
  stored: false,

  async load() {
    const value = await ServiceFactory.getSettingsService().getSetting<unknown>(LINEUP_KEY, null);
    // The wizard stored a line-up while this was reading: what it read is older, and changes nothing.
    if (get().stored || replacing > 0) return;
    const selected = useProviderStore.getState().selected;
    if (isStoredLineUp(value)) {
      // The provider is stored before the line-up, so a save cut short by a restart leaves an older line-up
      // beside a newer provider (as does a provider changed in an older version of the app). The provider is the
      // newer choice: a line-up it does not run is worked out again from it, as on the first start.
      const run = runOf(value.stages);
      if (!selected || (run.ok && run.provider === selected)) {
        set({ lineUp: value.stages, stored: true });
        return;
      }
    } else if (value !== null && value !== undefined) {
      if (!selected) return;
      // Stored, but not something this build can use (another version, a provider it does not know): shown as
      // today's values, never overwritten by the migration; a session resolves as today.
      set({ lineUp: selected === 'local_inference' ? { ...familyDefaults('local_inference'), summarisation: null } : lineUpFromToday({ selected, local: null }), stored: false });
      return;
    }
    if (!selected) return;
    if (selected !== 'local_inference') {
      await migrate(lineUpFromToday({ selected, local: null }));
      return;
    }
    // The local provider: what today's automatic choices pick is known only after the scan of downloaded
    // models. Until then the settings show the family's defaults and a session resolves as today.
    set({ lineUp: { ...familyDefaults('local_inference'), summarisation: null }, stored: false });
    void (async () => {
      await useModelStore.getState().initialize();
      // A failed scan reports no downloaded model: worked out now, every local choice would read as Bing and
      // Edge for good. Write nothing; the next start tries again, and until then a session resolves as today.
      if (!useModelStore.getState().initialized) return;
      await migrate(lineUpFromToday({ selected, local: todayLocal() }));
    })();
  },

  async replace(stages) {
    if (useProviderStore.getState().selectionLocked) return false;
    // Claimed at once, before any wait: a migration whose scan ends from here on writes nothing, and one already
    // writing is waited for, so this write lands last in storage.
    replacing += 1;
    try {
      if (migrationWrite) await migrationWrite;
      const value = await ServiceFactory.getSettingsService().getSetting<unknown>(LINEUP_KEY, null);
      const summarisation = isStoredLineUp(value) ? value.stages.summarisation : get().lineUp?.summarisation ?? null;
      const lineUp: LineUp = { ...stages, summarisation };
      const before = { lineUp: get().lineUp, stored: get().stored };
      set({ lineUp, stored: true });
      if (await write(lineUp)) return true;
      set(before);
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
  const { lineUp, stored } = get();
  if (useProviderStore.getState().selectionLocked || !stored || !lineUp) return null;
  const choice = chooseIn(lineUp, stage, providerId);
  const run = runOf(choice.lineUp);
  const before = useProviderStore.getState().selected;
  const moves = run.ok && before !== run.provider;
  set({ lineUp: choice.lineUp });
  // The provider before the save: a run starting while the line-up is being written finds the two in step.
  if (moves) useProviderStore.getState().select(run.provider, 'pick');
  if (await write(choice.lineUp)) return choice;
  // Not stored: the choice is undone, the provider with it, so what is kept stays one line-up and its provider.
  // A run that started meanwhile locks the provider: both stay what it started with until it ends.
  const undo = () => {
    if (get().lineUp !== choice.lineUp) return;
    set({ lineUp });
    if (moves && before && useProviderStore.getState().selected === run.provider) useProviderStore.getState().select(before, 'pick');
  };
  if (!useProviderStore.getState().selectionLocked) undo();
  else {
    const off = useProviderStore.subscribe((s) => { if (!s.selectionLocked) { off(); undo(); } });
  }
  return null;
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

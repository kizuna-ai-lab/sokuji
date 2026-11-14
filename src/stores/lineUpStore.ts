// src/stores/lineUpStore.ts
//
// The line-up: which provider serves each stage. Stored as one value,
// `settings.lineup`; when it is absent it is worked out once from today's
// values and written (the one migration, owner 2026-11-15). The session still
// runs through the provider store's selected provider (phase 1): a choice here
// keeps that selection in step.
import { create } from 'zustand';
import { choose as chooseIn, type Choice } from '../lib/lineup/choose';
import { caps, familyDefaults, runOf } from '../lib/lineup/catalog';
import { localStagesOf, type LocalStages } from '../lib/lineup/localStages';
import { lineUpFromToday } from '../lib/lineup/migrate';
import type { LineUp, StageName } from '../lib/lineup/types';
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

export const useLineUpStore = create<LineUpStore>()((set, get) => ({
  lineUp: null,
  stored: false,

  async load() {
    const value = await ServiceFactory.getSettingsService().getSetting<unknown>(LINEUP_KEY, null);
    if (isStoredLineUp(value)) {
      set({ lineUp: value.stages, stored: true });
      return;
    }
    const selected = useProviderStore.getState().selected;
    if (!selected) return;
    if (value !== null && value !== undefined) {
      // Stored, but not something this build can use (another version, a provider it does not know): shown as
      // today's values, never overwritten by the migration; a session resolves as today.
      set({ lineUp: selected === 'local_inference' ? { ...familyDefaults('local_inference'), summarisation: null } : lineUpFromToday({ selected, local: null }), stored: false });
      return;
    }
    if (selected !== 'local_inference') {
      const lineUp = lineUpFromToday({ selected, local: null });
      set({ lineUp, stored: await write(lineUp) });
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
      if (get().stored) return; // a line-up was stored meanwhile (the setup wizard): it stands
      const lineUp = lineUpFromToday({ selected, local: todayLocal() });
      set({ lineUp, stored: await write(lineUp) });
    })();
  },

  async choose(stage, providerId) {
    const { lineUp, stored } = get();
    if (useProviderStore.getState().selectionLocked || !stored || !lineUp) return null;
    const choice = chooseIn(lineUp, stage, providerId);
    set({ lineUp: choice.lineUp });
    await write(choice.lineUp);
    const run = runOf(choice.lineUp);
    if (run.ok && useProviderStore.getState().selected !== run.provider) useProviderStore.getState().select(run.provider, 'pick');
    return choice;
  },
}));

/** The local stages of the stored line-up; null until one is stored, so the local provider resolves as today. */
export function storedLocalStages(): LocalStages | null {
  const { lineUp, stored } = useLineUpStore.getState();
  return stored ? localStagesOf(lineUp) : null;
}

/** The analytics event for a choice, sent by the screen that made it: provider ids per stage, never content. */
export function lineUpChangedEvent(stage: StageName, before: LineUp, choice: Choice): AnalyticsEvents['lineup_changed'] {
  return { stage, from: before[stage], to: choice.lineUp[stage], moved: choice.moved, during_session: false };
}

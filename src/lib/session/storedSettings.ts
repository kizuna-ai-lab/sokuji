/**
 * How the values an install already stored map onto the new session's stores
 * (1e-3 rulings 2 and 3; spec: "Persisted settings that move"). Pure: nothing
 * here reads or writes storage — plan 1e-3b applies it.
 */
import type { TurnMode } from './types';

/** The old `Provider` enum's spelling (`src/types/Provider.ts`) of every registered provider id that differs from it. */
export const LEGACY_PROVIDER_IDS: Readonly<Record<string, string>> = {
  local_inference: 'localInference',
};

/** A stored `settings.common.provider` value in the registry's spelling; null when nothing usable is stored. */
export function providerIdFromStored(stored: unknown): string | null {
  if (typeof stored !== 'string' || stored.trim() === '') return null;
  return LEGACY_PROVIDER_IDS[stored] ?? stored;
}

/**
 * What `settings.common.provider` holds for a provider: the old enum's
 * spelling where one exists — the value every install already has, and the
 * one the old settings store (still loaded until Stage 2 retires it) reads as
 * the provider it is instead of falling back to OpenAI.
 */
export function storedProviderValue(id: string): string {
  for (const [legacy, current] of Object.entries(LEGACY_PROVIDER_IDS)) if (current === id) return legacy;
  return id;
}

export interface StoredSelection {
  /** The provider to select, in memory. */
  id: string;
  /** False: nothing usable was stored, or it names a provider this build does not offer — this is the fallback, and it is never written back (ruling 2). */
  fromStorage: boolean;
}

/** The provider a load selects: the stored one when this build offers it, else the first offered (LocalInference: the registry puts it first). */
export function selectionFromStored(stored: unknown, offered: readonly string[]): StoredSelection | null {
  const id = providerIdFromStored(stored);
  if (id !== null && offered.includes(id)) return { id, fromStorage: true };
  return offered.length > 0 ? { id: offered[0], fromStorage: false } : null;
}

/**
 * What a selection writes under `settings.common.provider`: an explicit pick
 * writes its stored spelling; a load writes nothing — the stored value, even
 * one naming a provider this build lacks, stays for Stage 2 to find (ruling 2).
 */
export function selectionToPersist(id: string, how: 'load' | 'pick'): string | null {
  return how === 'pick' ? storedProviderValue(id) : null;
}

/** The slice each old `Provider` value kept its settings under (its descriptor's `settingsSliceKey`). */
export const LEGACY_SLICE_KEYS: Readonly<Record<string, string>> = {
  openai: 'openai',
  gemini: 'gemini',
  palabraai: 'palabraai',
  kizunaai_openai_translate: 'kizunaOpenaiTranslate',
  kizunaai_volcengine_ast2: 'kizunaVolcengineAst2',
  kizunaai_soniox: 'kizunaSoniox',
  openai_compatible: 'openaiCompatible',
  openai_translate: 'openaiTranslate',
  openai_live: 'openaiLive',
  volcengine_ast2: 'volcengineAST2',
  local_inference: 'localInference',
  local_native: 'localNative',
  soniox: 'soniox',
};

/** Where the stored provider kept its turn mode; null when the value names no old provider. */
export function legacyTurnModeKey(storedProvider: unknown): string | null {
  if (typeof storedProvider !== 'string') return null;
  const slice = LEGACY_SLICE_KEYS[storedProvider] ?? LEGACY_SLICE_KEYS[storedProviderValue(storedProvider)];
  return slice ? `settings.${slice}.turnDetectionMode` : null;
}

/** An old `turnDetectionMode` as the global mode: the two push modes map to themselves, everything else — `Normal`, `Semantic`, `Disabled`, `Auto`, nothing stored — to automatic. */
export function turnModeFromLegacy(mode: unknown): TurnMode {
  if (mode === 'Push-to-Talk') return 'push-to-talk';
  if (mode === 'Push-to-Translate') return 'push-to-translate';
  return 'auto';
}

const MODES: readonly TurnMode[] = ['auto', 'push-to-talk', 'push-to-translate'];

/**
 * The one-time migration (ruling 3). `common` is `settings.common.turnMode`
 * read with `''` as its default, so `''` (or nothing) means never written;
 * `legacy` is the value at `legacyTurnModeKey(storedProvider)`. Once the
 * global mode exists it wins — `loadTurnMode` (`src/app/loadStores.ts`) calls
 * this on every load and finds `common` already set — and nothing is
 * written again.
 */
export function migrateTurnMode(common: unknown, legacy: unknown): { turnMode: TurnMode; write: boolean } {
  if (common !== undefined && common !== null && common !== '') {
    return { turnMode: MODES.find((m) => m === common) ?? 'auto', write: false };
  }
  return { turnMode: turnModeFromLegacy(legacy), write: true };
}

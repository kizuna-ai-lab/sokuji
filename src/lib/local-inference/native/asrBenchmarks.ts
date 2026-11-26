// src/lib/local-inference/native/asrBenchmarks.ts
//
// What the speech-recognition list says about a model beyond its name: how accurate it is in each of the languages
// in play, how fast it is, whether it streams, and whether it is the pick (Recommended) or the quick one (Faster) for
// those languages. All of it comes from `@handy-computer/models` (MIT), the catalog Handy shows its list from: the
// published recognizers' measured error per language and speed, and the method that picks Best and Fast from them.
// Our recognition cards run the same published GGUFs, so a card is matched to its catalog model by Hugging Face repo.
// Only recognition has such measurements: translation and speech models have none and keep their lists as they were.
import { catalog, languageIdentity, speedMeterLevel, SPEED_METER_STEPS, type CatalogModel } from '@handy-computer/models';
import type { NativeModelInfo } from './nativeProtocol';

export { SPEED_METER_STEPS };

/** "handy-computer/Qwen3-ASR-0.6B-gguf[/file.gguf]" → "handy-computer/qwen3-asr-0.6b". */
const repoKey = (repo: string): string => {
  const [org = '', name = ''] = repo.split('/');
  return `${org}/${name}`.toLowerCase().replace(/-gguf$/, '');
};

const BY_REPO: ReadonlyMap<string, CatalogModel> = new Map(
  catalog.models.filter((m) => m.role === 'asr').map((m) => [repoKey(m.repository), m]),
);

/** The catalog model a recognition card runs, or undefined for one the catalog does not know. */
export const catalogModelFor = (info: Pick<NativeModelInfo, 'repo'>): CatalogModel | undefined => BY_REPO.get(repoKey(info.repo));

export type AsrRole = 'recommended' | 'faster';

export interface AsrFacts {
  /**
   * One grade per language asked for ("A-", "B", …) with the measured error rate (percent) it comes from; both
   * undefined where the model was not measured in it.
   */
  grades: ReadonlyArray<{ language: string; grade: string | undefined; error?: number }>;
  /** How many of the five time limits (1.5, 3, 5, 10, 20 s) a 30-second recording is processed within; undefined when unmeasured. */
  speed: number | undefined;
  /** The seconds the catalog's test computer took over its 30-second recording; undefined when unmeasured. */
  waitSeconds?: number;
  streaming: boolean;
}

/**
 * What each accuracy letter means, as the catalog grades (`accuracyGrade` in `@handy-computer/models`, which does not
 * export its bands): the error rate in percent from `from` up to, not including, `to`. F has no ceiling.
 */
export const GRADE_BANDS: ReadonlyArray<{ letter: 'A' | 'B' | 'C' | 'D' | 'F'; from: number; to: number | undefined }> = [
  { letter: 'A', from: 0, to: 5 },
  { letter: 'B', from: 5, to: 10 },
  { letter: 'C', from: 10, to: 20 },
  { letter: 'D', from: 20, to: 30 },
  { letter: 'F', from: 30, to: undefined },
];
/** The catalog splits A, B and C into +, plain and −: each step down multiplies the error by the cube root of 2. */
const SUB_GRADE_STEP = Math.cbrt(2);
/** A letter's edges: its floor, where + ends, where the plain letter ends, its ceiling (where − ends). */
export function subGradeEdges(letter: 'A' | 'B' | 'C'): [number, number, number, number] {
  const band = GRADE_BANDS.find((b) => b.letter === letter)!;
  const ceiling = band.to!;
  return [band.from, ceiling / SUB_GRADE_STEP ** 2, ceiling / SUB_GRADE_STEP, ceiling];
}
/**
 * The speed meter's time limits for the catalog's 30-second recording, fastest first (`speedMeterLevel`'s, which it
 * does not export): a model processing it within the first lights all five steps, within only the last, one.
 */
export const SPEED_LIMITS: readonly number[] = [1.5, 3, 5, 10, 20];

/** The facts for one recognition card across the languages in play, or undefined for a model without catalog data. */
export function asrFacts(info: Pick<NativeModelInfo, 'repo'>, languages: readonly string[]): AsrFacts | undefined {
  const model = catalogModelFor(info);
  if (!model) return undefined;
  const wait = catalog.modelWaitSeconds(model);
  return {
    grades: languages.map((language) => ({
      language,
      grade: catalog.languageAccuracyGrade(model, language)?.label,
      error: catalog.data.results[model.id]?.accuracy[languageIdentity(language)]?.error,
    })),
    speed: wait === undefined ? undefined : speedMeterLevel(wait),
    waitSeconds: wait,
    streaming: model.capabilities.streaming,
  };
}

/**
 * Which catalog models are the pick and the quick one for these languages (the catalog's own method, over the models
 * that speak all of them), keyed by catalog id. A model with both roles shows the stronger, Recommended.
 */
export function asrRoles(languages: readonly string[]): ReadonlyMap<string, AsrRole> {
  const roles = new Map<string, AsrRole>();
  if (languages.length === 0) return roles;
  for (const r of catalog.recommend(languages)) {
    if (r.roles.includes('best')) roles.set(r.model.id, 'recommended');
    else if (r.roles.includes('fast')) roles.set(r.model.id, 'faster');
  }
  return roles;
}

/** A card's role among those `asrRoles` found. */
export const roleOf = (info: Pick<NativeModelInfo, 'repo'>, roles: ReadonlyMap<string, AsrRole>): AsrRole | undefined => {
  const model = catalogModelFor(info);
  return model ? roles.get(model.id) : undefined;
};

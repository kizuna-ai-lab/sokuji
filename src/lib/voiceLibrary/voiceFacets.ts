/**
 * Narrowing a voice list down to what the user is looking for.
 *
 * Provider-neutral on purpose: VoiceLibrarySection renders for Soniox, native
 * cloning and Supertonic alike, so the picker filters on the opaque tag strings
 * in `VoiceEntry.meta.facets` rather than on any one vendor's vocabulary.
 *
 * The semantics mirror Soniox's `GET /v1/shared-voices`, the roster's source:
 * every given dimension must match, and a multi-valued dimension requires
 * EVERY selected tag, not any of them. Keeping the two identical means the
 * picker could be re-pointed at the live endpoint without the result set
 * changing under the user.
 */
import type { VoiceFacets, VoiceFacetCriteria } from '../../types/VoiceLibrary';

/** The shape this module needs from a voice entry — a label to search and an
 *  optional facet sidecar. Structural so both VoiceEntry and test fixtures fit. */
export interface FacetedVoice {
  label: string;
  meta?: { facets?: VoiceFacets };
}

export type { VoiceFacetCriteria };

const DIMENSIONS = ['gender', 'age', 'accent', 'useCase', 'style'] as const;
type Dimension = (typeof DIMENSIONS)[number];

const hasEvery = (have: string[] | undefined, want: string[] | undefined) =>
  !want?.length || want.every((tag) => have?.includes(tag));

export function matchesVoiceFacets(voice: FacetedVoice, criteria: VoiceFacetCriteria): boolean {
  const facets = voice.meta?.facets;
  // An unclassified voice (every cloned one) fails any facet it was not given.
  // Showing it under "female" would be the picker inventing a claim about it.
  if (criteria.gender && facets?.gender !== criteria.gender) return false;
  if (criteria.age && facets?.age !== criteria.age) return false;
  if (criteria.accent && facets?.accent !== criteria.accent) return false;
  if (!hasEvery(facets?.useCase, criteria.useCase)) return false;
  if (!hasEvery(facets?.style, criteria.style)) return false;

  return true;
}

/** True when any dimension is narrowed — used to decide whether to show the
 *  "clear filters" affordance and the empty-result copy. */
export function hasActiveFacets(criteria: VoiceFacetCriteria): boolean {
  return Boolean(
    criteria.gender ||
      criteria.age ||
      criteria.accent ||
      criteria.useCase?.length ||
      criteria.style?.length
  );
}

/**
 * The distinct values actually present, per dimension, sorted.
 *
 * Derived from the voices in hand rather than declared, so a roster refresh
 * that introduces an accent needs no code change — only a label, and the
 * humanized fallback covers even that until one is written.
 */
export function facetVocabulary(voices: FacetedVoice[]): Record<Dimension, string[]> {
  const seen: Record<Dimension, Set<string>> = {
    gender: new Set(),
    age: new Set(),
    accent: new Set(),
    useCase: new Set(),
    style: new Set(),
  };
  for (const voice of voices) {
    const facets = voice.meta?.facets;
    if (!facets) continue;
    if (facets.gender) seen.gender.add(facets.gender);
    if (facets.age) seen.age.add(facets.age);
    if (facets.accent) seen.accent.add(facets.accent);
    for (const tag of facets.useCase ?? []) seen.useCase.add(tag);
    for (const tag of facets.style ?? []) seen.style.add(tag);
  }
  return {
    gender: [...seen.gender].sort(),
    age: [...seen.age].sort(),
    accent: [...seen.accent].sort(),
    useCase: [...seen.useCase].sort(),
    style: [...seen.style].sort(),
  };
}

/**
 * Readable text for a tag that has no translation yet: `middle_aged` →
 * `Middle aged`. The picker prefers a locale string and falls back here, so a
 * newly-introduced Soniox tag reads as words rather than as a raw slug.
 */
export function humanizeFacetValue(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

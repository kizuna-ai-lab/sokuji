import { describe, it, expect } from 'vitest';
import { matchesVoiceFacets, facetVocabulary, hasActiveFacets } from './voiceFacets';
import type { VoiceFacets, VoiceFacetCriteria } from '../../types/VoiceLibrary';

/** Entry shape the picker holds: a label plus the provider's facet sidecar. */
const entry = (label: string, facets: VoiceFacets) => ({ label, meta: { facets } });

const SAKURA = entry('Sakura', {
  gender: 'female',
  age: 'middle_aged',
  accent: 'japanese',
  useCase: ['educational', 'narration'],
  style: ['bright', 'calm'],
  description: 'Bright instructor voice, well projected.',
});
const YUTO = entry('Yuto', {
  gender: 'male',
  age: 'young',
  accent: 'japanese',
  useCase: ['conversational'],
  style: ['bright', 'energetic'],
  description: 'Young speaker with an easy lift.',
});
const ADRIAN = entry('Adrian', {
  gender: 'male',
  age: 'middle_aged',
  accent: 'american',
  useCase: ['narration', 'educational'],
  style: ['deep', 'calm'],
  description: 'A deep, focused voice with crisp articulation.',
});
const ROSTER = [SAKURA, YUTO, ADRIAN];

const only = (criteria: VoiceFacetCriteria) =>
  ROSTER.filter((v) => matchesVoiceFacets(v, criteria)).map((v) => v.label);

describe('matchesVoiceFacets', () => {
  it('keeps every voice when nothing is selected', () => {
    expect(only({})).toEqual(['Sakura', 'Yuto', 'Adrian']);
  });

  it('filters by gender', () => {
    expect(only({ gender: 'female' })).toEqual(['Sakura']);
  });

  it('filters by age', () => {
    expect(only({ age: 'middle_aged' })).toEqual(['Sakura', 'Adrian']);
  });

  it('filters by accent', () => {
    expect(only({ accent: 'japanese' })).toEqual(['Sakura', 'Yuto']);
  });

  it('filters by a use-case tag the voice carries among others', () => {
    expect(only({ useCase: ['narration'] })).toEqual(['Sakura', 'Adrian']);
  });

  it('filters by a style tag the voice carries among others', () => {
    // Voices carry 3.67 style tags on average, so matching one of several is
    // the normal case, not an edge one.
    expect(only({ style: ['calm'] })).toEqual(['Sakura', 'Adrian']);
  });

  it('requires every tag when handed more than one', () => {
    // The picker offers one tag per dimension, but the criteria keep Soniox's
    // array shape and its AND semantics ("tagged with every listed style"), so
    // a caller that passes two — or a future multi-select — narrows rather
    // than widens.
    expect(only({ style: ['bright', 'calm'] })).toEqual(['Sakura']);
    expect(only({ useCase: ['narration', 'conversational'] })).toEqual([]);
  });

  it('combines different dimensions with AND', () => {
    expect(only({ accent: 'japanese', gender: 'male' })).toEqual(['Yuto']);
  });

  it('treats empty tag arrays as no filter', () => {
    expect(only({ useCase: [], style: [] })).toHaveLength(3);
  });

  it('returns nothing when the combination matches no voice', () => {
    expect(only({ accent: 'japanese', style: ['deep'] })).toEqual([]);
  });

  it('keeps an entry that carries no facets unless a facet is selected', () => {
    // Cloned voices have no metadata: Soniox publishes none for them. They
    // must drop out the moment a facet they cannot satisfy is chosen —
    // otherwise "female" would appear to claim something about a voice nobody
    // classified.
    const clone = { label: 'My voice', meta: undefined };
    expect(matchesVoiceFacets(clone, {})).toBe(true);
    expect(matchesVoiceFacets(clone, { gender: 'female' })).toBe(false);
  });
});

describe('hasActiveFacets', () => {
  it('is false for an untouched filter', () => {
    expect(hasActiveFacets({})).toBe(false);
    expect(hasActiveFacets({ useCase: [], style: [] })).toBe(false);
  });

  it('is true as soon as any dimension is narrowed', () => {
    expect(hasActiveFacets({ gender: 'female' })).toBe(true);
    expect(hasActiveFacets({ style: ['calm'] })).toBe(true);
  });
});

describe('facetVocabulary', () => {
  it('lists the distinct values present, sorted, per dimension', () => {
    expect(facetVocabulary(ROSTER)).toEqual({
      gender: ['female', 'male'],
      age: ['middle_aged', 'young'],
      accent: ['american', 'japanese'],
      useCase: ['conversational', 'educational', 'narration'],
      style: ['bright', 'calm', 'deep', 'energetic'],
    });
  });

  it('omits nothing when entries carry no facets', () => {
    expect(facetVocabulary([{ label: 'My voice' }])).toEqual({
      gender: [],
      age: [],
      accent: [],
      useCase: [],
      style: [],
    });
  });
});

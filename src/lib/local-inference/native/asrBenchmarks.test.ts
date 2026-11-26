import { describe, it, expect } from 'vitest';
import { asrFacts, asrRoles, catalogModelFor, roleOf } from './asrBenchmarks';

const PARAKEET = { repo: 'handy-computer/parakeet-unified-en-0.6b-gguf' };

describe('asrBenchmarks — what the recognition list says about a model', () => {
  it('matches a card to its catalog model by repo, with or without a file name and in any case', () => {
    expect(catalogModelFor(PARAKEET)?.id).toBe('parakeet-unified-en-0.6b');
    expect(catalogModelFor({ repo: 'Handy-Computer/Parakeet-Unified-EN-0.6B-GGUF/x-Q8_0.gguf' })?.id).toBe('parakeet-unified-en-0.6b');
    expect(catalogModelFor({ repo: 'someone/else-gguf' })).toBeUndefined();
  });

  it('grades the model in each language asked for, and says nothing where it was not measured', () => {
    const facts = asrFacts(PARAKEET, ['en', 'ja'])!;
    expect(facts.grades).toEqual([{ language: 'en', grade: 'A-' }, { language: 'ja', grade: undefined }]);
  });

  it('gives a fast model the full speed meter and carries its streaming capability', () => {
    const facts = asrFacts(PARAKEET, ['en'])!;
    expect(facts.speed).toBe(5);
    expect(facts.streaming).toBe(true);
  });

  it('has no facts for a model the catalog does not know', () => {
    expect(asrFacts({ repo: 'someone/else-gguf' }, ['en'])).toBeUndefined();
  });

  it('picks a Recommended model for English and names it on its card', () => {
    const roles = asrRoles(['en']);
    expect([...roles.values()]).toContain('recommended');
    const best = [...roles].find(([, r]) => r === 'recommended')![0];
    expect(roleOf({ repo: `handy-computer/${best}-gguf` }, roles)).toBe('recommended');
  });

  it('picks nothing when no languages are given', () => {
    expect(asrRoles([]).size).toBe(0);
  });
});

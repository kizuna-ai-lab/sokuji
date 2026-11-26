import { describe, it, expect } from 'vitest';
import { accuracyGrade, speedMeterLevel } from '@handy-computer/models';
import { asrFacts, asrRoles, catalogModelFor, GRADE_BANDS, roleOf, SPEED_LIMITS, subGradeEdges } from './asrBenchmarks';

const PARAKEET = { repo: 'handy-computer/parakeet-unified-en-0.6b-gguf' };

describe('asrBenchmarks — what the recognition list says about a model', () => {
  it('matches a card to its catalog model by repo, with or without a file name and in any case', () => {
    expect(catalogModelFor(PARAKEET)?.id).toBe('parakeet-unified-en-0.6b');
    expect(catalogModelFor({ repo: 'Handy-Computer/Parakeet-Unified-EN-0.6B-GGUF/x-Q8_0.gguf' })?.id).toBe('parakeet-unified-en-0.6b');
    expect(catalogModelFor({ repo: 'someone/else-gguf' })).toBeUndefined();
  });

  it('grades the model in each language asked for, and says nothing where it was not measured', () => {
    const facts = asrFacts(PARAKEET, ['en', 'ja'])!;
    expect(facts.grades.map(({ language, grade }) => ({ language, grade }))).toEqual([{ language: 'en', grade: 'A-' }, { language: 'ja', grade: undefined }]);
    // The measured error rate behind the grade, for the tooltip.
    expect(accuracyGrade(facts.grades[0].error!).label).toBe('A-');
    expect(facts.grades[1].error).toBeUndefined();
  });

  it('gives a fast model the full speed meter and carries its streaming capability', () => {
    const facts = asrFacts(PARAKEET, ['en'])!;
    expect(facts.speed).toBe(5);
    expect(speedMeterLevel(facts.waitSeconds!)).toBe(5);
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

  // The tooltips spell out what each letter and each step means (owner, 2026-11-27): the bands must be the catalog's.
  it("states the catalog's letter bands and sub-grade edges", () => {
    const e = 1e-6;
    expect(GRADE_BANDS.map((b) => [b.letter, b.from, b.to])).toEqual([['A', 0, 5], ['B', 5, 10], ['C', 10, 20], ['D', 20, 30], ['F', 30, undefined]]);
    for (const b of GRADE_BANDS) {
      expect(accuracyGrade(b.from + e).letter).toBe(b.letter);
      if (b.to !== undefined) expect(accuracyGrade(b.to - e).letter).toBe(b.letter);
    }
    for (const letter of ['A', 'B', 'C'] as const) {
      const [, plus, plain] = subGradeEdges(letter);
      expect(accuracyGrade(plus - e).label).toBe(`${letter}+`);
      expect(accuracyGrade(plus + e).label).toBe(letter);
      expect(accuracyGrade(plain - e).label).toBe(letter);
      expect(accuracyGrade(plain + e).label).toBe(`${letter}-`);
    }
  });

  it("states the catalog's speed limits, fastest first: n steps means within the n-th", () => {
    expect(SPEED_LIMITS).toEqual([1.5, 3, 5, 10, 20]);
    SPEED_LIMITS.forEach((limit, i) => {
      expect(speedMeterLevel(limit - 1e-6)).toBe(SPEED_LIMITS.length - i);
      expect(speedMeterLevel(limit + 1e-6)).toBe(SPEED_LIMITS.length - i - 1);
    });
  });
});

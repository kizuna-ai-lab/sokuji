import { describe, it, expect, vi } from 'vitest';

// Mock i18n (the client module imports it transitively via some paths).
vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));

// Dynamic import after mocks
const { buildCorpusFromConfig, VolcengineAST2Client } = await import('./VolcengineAST2Client');

const baseConfig = {
  provider: 'volcengine_ast2' as const,
  model: 'ast-v2-s2s',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto' as const,
};

describe('buildCorpusFromConfig', () => {
  it('returns undefined when all three IDs are absent', () => {
    expect(buildCorpusFromConfig({ ...baseConfig })).toBeUndefined();
  });

  it('returns undefined when all three IDs are empty strings', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: '',
      replacementTableId: '',
      glossaryTableId: '',
    })).toBeUndefined();
  });

  it('returns undefined when all three IDs are whitespace only', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: '   ',
      replacementTableId: '\t',
      glossaryTableId: '\n',
    })).toBeUndefined();
  });

  it('emits only the set fields and uses correct proto names', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: 'hot-1',
      replacementTableId: '',
      glossaryTableId: 'gloss-3',
    })).toEqual({
      boostingTableId: 'hot-1',
      glossaryTableId: 'gloss-3',
    });
  });

  it('emits all three when all are set', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: 'hot-1',
      replacementTableId: 'rep-2',
      glossaryTableId: 'gloss-3',
    })).toEqual({
      boostingTableId: 'hot-1',
      regexCorrectTableId: 'rep-2',
      glossaryTableId: 'gloss-3',
    });
  });

  it('trims whitespace from IDs', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: '  hot-1  ',
      replacementTableId: '\trep-2\t',
      glossaryTableId: ' gloss-3 ',
    })).toEqual({
      boostingTableId: 'hot-1',
      regexCorrectTableId: 'rep-2',
      glossaryTableId: 'gloss-3',
    });
  });
});

// Two client instances (e.g. the speaker + participant channels in "both"
// mode) must never mint the same item ID. The previous static
// `volcengine_ast2_<prefix>_<counter>` scheme collided because both counters
// started at 0; the per-instance `instanceId` prefix fixes it. A collision
// here would re-introduce the karaoke double-highlight bug (two conversation
// items keyed on the same item.id light up at once).
describe('VolcengineAST2Client — item IDs are unique across instances', () => {
  const genBatch = (client: any, prefix: string, n: number): string[] =>
    Array.from({ length: n }, () => client.generateItemId(prefix));

  it('two instances produce disjoint item IDs for the same prefix/counter', () => {
    const a = new VolcengineAST2Client('app', 'token');
    const b = new VolcengineAST2Client('app', 'token');

    const idsA = genBatch(a, 'translation', 5);
    const idsB = genBatch(b, 'translation', 5);

    // Within an instance the counter still makes them unique.
    expect(new Set(idsA).size).toBe(5);
    expect(new Set(idsB).size).toBe(5);

    // Across instances: no shared ID, even though both counters ran 1..5.
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);
  });
});

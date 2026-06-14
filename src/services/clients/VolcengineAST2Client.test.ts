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

describe("VolcengineAST2Client relay mode", () => {
  it("connects to the relay URL with sokuji-auth and no header injection", async () => {
    vi.useFakeTimers();
    const captured: { url?: string; protocols?: any } = {};
    const FakeWS: any = vi.fn(function (this: any, url: string, protocols?: any) {
      captured.url = url; captured.protocols = protocols;
      this.readyState = 0; this.binaryType = ""; this.send = vi.fn(); this.close = vi.fn();
      this.addEventListener = vi.fn(); this.removeEventListener = vi.fn();
    });
    FakeWS.OPEN = 1;
    const orig = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWS;
    try {
      const client = new VolcengineAST2Client("", "", undefined, { wsUrl: "wss://r.example/v1/ast/translate", sessionToken: "sess_TOKEN" });
      // The relay socket is constructed synchronously, so URL/subprotocol are
      // captured before any await. The fake socket never emits SessionStarted, so
      // drive the 30s connection timeout to completion and await the rejected
      // promise instead of leaving a pending timer alive past the test.
      const connectPromise = client
        .connect({ provider: "volcengine_ast2", model: "ast-v2-s2s", sourceLanguage: "zh", targetLanguage: "en" } as any)
        .catch(() => {});
      expect(captured.url).toBe("wss://r.example/v1/ast/translate");
      const protos = Array.isArray(captured.protocols) ? captured.protocols : [captured.protocols];
      expect(protos).toContain("sokuji-auth.sess_TOKEN");
      await vi.advanceTimersByTimeAsync(30001);
      await connectPromise;
    } finally {
      (globalThis as any).WebSocket = orig;
      vi.useRealTimers();
    }
  });
});

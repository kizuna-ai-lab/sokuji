import { describe, it, expect, vi, beforeEach } from 'vitest';

const japanese = {
  state: { phase: 'off' } as { phase: string },
  listeners: new Set<() => void>(),
  tokenize: vi.fn<(text: string) => Promise<unknown> | null>(),
};
vi.mock('./ja/runtime', () => ({
  getJapaneseState: () => japanese.state,
  subscribeJapanese: (l: () => void) => { japanese.listeners.add(l); return () => japanese.listeners.delete(l); },
  tokenizeJapanese: (text: string) => japanese.tokenize(text),
}));

const warn = vi.fn();
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportWarning: (...args: unknown[]) => warn(...args),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
let annotate: typeof import('./annotate');

beforeEach(async () => {
  vi.resetModules();
  japanese.state = { phase: 'off' };
  japanese.listeners.clear();
  japanese.tokenize.mockReset();
  warn.mockReset();
  annotate = await import('./annotate');
});

describe('annotate', () => {
  it('has nothing before an annotator loads, then the pieces, telling the waiting row', async () => {
    expect(annotate.peekReading('같이', 'ko')).toBeNull();
    const listener = vi.fn();
    annotate.subscribeReading('같이', 'ko', listener);
    annotate.requestReading('같이', 'ko');
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(annotate.peekReading('같이', 'ko')).toEqual([{ text: '같이', reading: 'gachi' }]);
  });

  it('returns the same pieces for the same text, so React sees no change', async () => {
    annotate.requestReading('一下', 'zh');
    await vi.waitFor(() => expect(annotate.peekReading('一下', 'zh')).not.toBeNull());
    expect(annotate.peekReading('一下', 'zh')).toBe(annotate.peekReading('一下', 'zh'));
  });

  it('evicts the least recently used past the limit, keeping what was just read', async () => {
    annotate.requestReading('да', 'ru');
    await vi.waitFor(() => expect(annotate.peekReading('да', 'ru')).not.toBeNull());
    const first = annotate.peekReading('слово0', 'ru');
    for (let k = 1; k < annotate.CACHE_LIMIT; k++) annotate.peekReading(`слово${k}`, 'ru');
    const kept = annotate.peekReading('да', 'ru'); // read again: now the newest
    for (let k = 0; k < annotate.CACHE_LIMIT - 1; k++) annotate.peekReading(`ещё${k}`, 'ru');
    expect(annotate.peekReading('да', 'ru')).toBe(kept);
    expect(annotate.peekReading('слово0', 'ru')).not.toBe(first);
  });

  it('asks the Japanese worker once per text and tells that row', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue([{ surface: '雨', reading: 'アメ', unknown: false }]);
    const listener = vi.fn();
    annotate.subscribeReading('雨', 'ja', listener);
    annotate.requestReading('雨', 'ja');
    annotate.requestReading('雨', 'ja');
    await flush();
    expect(japanese.tokenize).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
    expect(annotate.peekReading('雨', 'ja')).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('asks again for the Japanese rows that waited, once the worker is ready', async () => {
    japanese.tokenize.mockReturnValue(null);
    annotate.subscribeReading('雨', 'ja', () => {});
    annotate.requestReading('雨', 'ja');
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue([{ surface: '雨', reading: 'アメ', unknown: false }]);
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('asks, once the worker is ready, for every mounted Japanese row however many', async () => {
    japanese.tokenize.mockReturnValue(null);
    const n = 600;
    for (let i = 0; i < n; i++) {
      annotate.subscribeReading(`雨${i}`, 'ja', () => {});
      annotate.requestReading(`雨${i}`, 'ja');
    }
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockReset();
    japanese.tokenize.mockImplementation(async (text: string) => [{ surface: text, reading: null, unknown: true }]);
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(japanese.tokenize).toHaveBeenCalledTimes(n);
    expect(annotate.peekReading('雨0', 'ja')).toEqual([{ text: '雨0' }]);
  });

  it('does not ask, once the worker is ready, for a row that is gone', async () => {
    japanese.tokenize.mockReturnValue(null);
    const off = annotate.subscribeReading('雨', 'ja', () => {});
    annotate.requestReading('雨', 'ja');
    off();
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockReset();
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(japanese.tokenize).not.toHaveBeenCalled();
  });

  it('asks, once the worker is ready, for no row of another language', async () => {
    annotate.subscribeReading('같이', 'ko', () => {});
    japanese.state = { phase: 'ready' };
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(japanese.tokenize).not.toHaveBeenCalled();
  });

  it('keeps nothing from a worker that went away', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue(null);
    annotate.requestReading('雨', 'ja');
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toBeNull();
  });

  it('asks again, on the next ready, for a Japanese row whose answer came back empty', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValueOnce(null);
    annotate.subscribeReading('雨', 'ja', () => {});
    annotate.requestReading('雨', 'ja');
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toBeNull();
    japanese.tokenize.mockResolvedValue([{ surface: '雨', reading: 'アメ', unknown: false }]);
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('recovers a Japanese row whose tokenize rejected', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockRejectedValueOnce(new Error('gone'));
    annotate.subscribeReading('雨', 'ja', () => {});
    annotate.requestReading('雨', 'ja');
    await flush();
    japanese.tokenize.mockResolvedValue([{ surface: '雨', reading: 'アメ', unknown: false }]);
    japanese.listeners.forEach((l) => l());
    await flush();
    expect(annotate.peekReading('雨', 'ja')).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('keeps the whitespace the Japanese tokens leave out', async () => {
    japanese.state = { phase: 'ready' };
    japanese.tokenize.mockResolvedValue([
      { surface: '今日', reading: 'キョウ', unknown: false },
      { surface: 'は', reading: 'ハ', unknown: false },
      { surface: '雨', reading: 'アメ', unknown: false },
    ]);
    annotate.requestReading('今日は\n雨', 'ja');
    await flush();
    expect(annotate.peekReading('今日は\n雨', 'ja')).toEqual([
      { text: '今日', reading: 'きょう' }, { text: 'は\n' }, { text: '雨', reading: 'あめ' },
    ]);
  });

  it('shows the text plain when the pieces of an annotator do not join back to it, warning once', async () => {
    vi.doMock('./ko', () => ({ annotateKorean: (text: string) => [{ text: text.slice(1), reading: 'x' }] }));
    try {
      annotate.requestReading('같이', 'ko');
      await vi.waitFor(() => expect(annotate.peekReading('같이', 'ko')).not.toBeNull());
      expect(annotate.peekReading('같이', 'ko')).toEqual([{ text: '같이' }]);
      expect(annotate.peekReading('같이', 'ko')).toBe(annotate.peekReading('같이', 'ko'));
      expect(annotate.peekReading('같이가', 'ko')).toEqual([{ text: '같이가' }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe('Readings');
      expect(warn.mock.calls[0][2]).toMatchObject({ dedupeKey: 'reading.concat.ko' });
    } finally {
      vi.doUnmock('./ko');
    }
  });

  it('does not reload a language whose import failed, and warns once', async () => {
    vi.doMock('./ko', () => { throw new Error('chunk'); });
    try {
      annotate.requestReading('같이', 'ko');
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      annotate.requestReading('같이가', 'ko');
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][2]).toMatchObject({ dedupeKey: 'reading.load.ko' });
      expect(annotate.peekReading('같이', 'ko')).toBeNull();
    } finally {
      vi.doUnmock('./ko');
    }
  });
});

describe('holdLastReading', () => {
  it('drops the reading of the last annotated piece only', async () => {
    const { holdLastReading } = annotate;
    expect(holdLastReading([{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '明', reading: 'あきら' }, { text: '。' }]))
      .toEqual([{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '明' }, { text: '。' }]);
    expect(holdLastReading([{ text: 'abc' }])).toEqual([{ text: 'abc' }]);
  });
});

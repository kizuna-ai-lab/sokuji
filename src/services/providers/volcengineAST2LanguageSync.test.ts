import { describe, it, expect } from 'vitest';
import { resolveAST2LanguagePair } from './volcengineAST2LanguageSync';

describe('resolveAST2LanguagePair', () => {
  // R1: picking 'zhen' on source atomically syncs target to 'zhen'.
  it('R1: zh/en → source=zhen ⇒ zhen/zhen', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'source', value: 'zhen' },
      ),
    ).toEqual({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  it("R1': ja/zh → source=zhen ⇒ zhen/zhen", () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'ja', targetLanguage: 'zh' },
        { side: 'source', value: 'zhen' },
      ),
    ).toEqual({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  // R2: picking 'zhen' on target atomically syncs source to 'zhen'.
  it('R2: zh/en → target=zhen ⇒ zhen/zhen', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'target', value: 'zhen' },
      ),
    ).toEqual({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });

  // R3: leaving 'zhen' on the source resets target to the provider default 'en'.
  it('R3: zhen/zhen → source=ja ⇒ ja/en', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'source', value: 'ja' },
      ),
    ).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  // R3 degenerate same-language case — helper does not block; server will reject.
  it('R3 same-lang: zhen/zhen → source=en ⇒ en/en', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'source', value: 'en' },
      ),
    ).toEqual({ sourceLanguage: 'en', targetLanguage: 'en' });
  });

  // R4: leaving 'zhen' on the target resets source to the provider default 'zh'.
  it('R4: zhen/zhen → target=fr ⇒ zh/fr', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'target', value: 'fr' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'fr' });
  });

  // R4 degenerate same-language case.
  it('R4 same-lang: zhen/zhen → target=zh ⇒ zh/zh', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'zhen' },
        { side: 'target', value: 'zh' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'zh' });
  });

  // Normal (non-bidirectional → non-bidirectional) update: passes through
  // without touching the other side. Not in the spec's rule table, but the
  // helper must support being called for every change to be useful as the
  // single VOLCENGINE_AST2 update path in the UI.
  it('passthrough: zh/en → source=ja ⇒ ja/en (target unchanged)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'source', value: 'ja' },
      ),
    ).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('passthrough: zh/en → target=fr ⇒ zh/fr (source unchanged)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zh', targetLanguage: 'en' },
        { side: 'target', value: 'fr' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'fr' });
  });

  // Legacy persisted states: before this PR exposed 'zhen' on the target side,
  // users could end up with sourceLanguage='zhen' but a non-'zhen' target.
  // The helper must reset the orphaned 'zhen' side rather than emit it back
  // to the server, which would reject the mixed pair.
  it('legacy zhen/en → target=fr ⇒ zh/fr (orphan zhen source reset)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'en' },
        { side: 'target', value: 'fr' },
      ),
    ).toEqual({ sourceLanguage: 'zh', targetLanguage: 'fr' });
  });

  it('legacy zhen/en → source=ja ⇒ ja/en (target was not zhen, no reset)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'zhen', targetLanguage: 'en' },
        { side: 'source', value: 'ja' },
      ),
    ).toEqual({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('legacy en/zhen → source=de ⇒ de/en (orphan zhen target reset)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'en', targetLanguage: 'zhen' },
        { side: 'source', value: 'de' },
      ),
    ).toEqual({ sourceLanguage: 'de', targetLanguage: 'en' });
  });

  it('legacy en/zhen → target=ja ⇒ en/ja (source was not zhen, no reset)', () => {
    expect(
      resolveAST2LanguagePair(
        { sourceLanguage: 'en', targetLanguage: 'zhen' },
        { side: 'target', value: 'ja' },
      ),
    ).toEqual({ sourceLanguage: 'en', targetLanguage: 'ja' });
  });
});

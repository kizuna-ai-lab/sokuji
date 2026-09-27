import { describe, it, expect } from 'vitest';
import { normalizePair, reverseSupported, swapped } from '../../lib/provider/languages';
import type { AuthContext, LanguageContext } from '../../lib/provider/types';
import { LANGUAGE_OPTIONS } from '../../utils/languages';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, ast2Offers, migrateAst2Settings, ZHEN } from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const SPEAKING: LanguageContext = { speech: true };
const TEXT: LanguageContext = { speech: false };
const p = { languages: ast2Languages };
const values = (list: readonly { value: string }[]) => list.map((o) => o.value);
const SPOKEN = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr'];
const TEXT_ONLY = ['ko', 'tr', 'ms', 'nl', 'ro', 'pl', 'cs', 'ar', 'th', 'vi', 'ru', 'it'];
const DIALECTS = ['yue-CN', 'sh-CN'];

describe("Doubao AST 2.0's settings", () => {
  it('default to the legacy credentials and no library', () => {
    expect(AST2_DEFAULTS).toEqual({ authMode: 'app', hotWordTableId: '', replacementTableId: '', glossaryTableId: '' });
  });

  it('migrate the defaults into the defaults, read an old profile as the legacy mode, and drop what left the slice', () => {
    expect(migrateAst2Settings({ ...AST2_DEFAULTS })).toEqual(AST2_DEFAULTS);
    const old = migrateAst2Settings({ hotWordTableId: 'hot-1', appId: '123', accessToken: 't', sourceLanguage: 'zh', turnDetectionMode: 'Push-to-Talk' });
    expect(old).toEqual({ ...AST2_DEFAULTS, hotWordTableId: 'hot-1' });
  });

  it('read a wrong-typed field as its default, and keep the API key mode once chosen', () => {
    expect(migrateAst2Settings({ ...AST2_DEFAULTS, authMode: 'token', glossaryTableId: 7 })).toEqual(AST2_DEFAULTS);
    expect(migrateAst2Settings({ ...AST2_DEFAULTS, authMode: 'apiKey' }).authMode).toBe('apiKey');
  });
});

describe("Doubao AST 2.0's credentials (ruling 1)", () => {
  it('show the App ID and the Access Token in the legacy mode, the API key in the new one', () => {
    expect(ast2Credentials.keys).toEqual(['appId', 'accessToken', 'apiKey']);
    expect(ast2Credentials.fields(AST2_DEFAULTS)).toEqual([
      { key: 'appId', labelKey: 'setup.credentials.appId', secret: false, placeholderKey: 'providers.volcengine_ast2.appIdPlaceholder' },
      { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true, placeholderKey: 'providers.volcengine_ast2.accessTokenPlaceholder' },
    ]);
    expect(ast2Credentials.fields({ ...AST2_DEFAULTS, authMode: 'apiKey' })).toEqual([
      { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' },
    ]);
  });

  it('offer the two modes as a choice over authMode, legacy first', () => {
    expect(ast2Credentials.choice).toEqual({
      setting: 'authMode',
      options: [{ value: 'app', labelKey: 'providers.volcengine_ast2.authModeApp' }, { value: 'apiKey', labelKey: 'setup.credentials.apiKey' }],
    });
  });

  it("read the selected mode's values, trimmed, an App ID stored as a number as its text (`descriptorRegistry.test.ts:179`)", () => {
    expect(ast2Credentials.read({ appId: ' app-1 ', accessToken: 'tok ' }, signedOut)).toEqual({ kind: 'app', appKey: 'app-1', accessKey: 'tok' });
    expect(ast2Credentials.read({ appId: 123 as unknown as string, accessToken: 't' }, signedOut)).toEqual({ kind: 'app', appKey: '123', accessKey: 't' });
    expect(ast2Credentials.read({ apiKey: ' k-1 ' }, signedOut)).toEqual({ kind: 'apiKey', apiKey: 'k-1' });
  });

  it('read an empty field as missing, in either mode', () => {
    expect(ast2Credentials.read({ appId: 'a', accessToken: '' }, signedOut)).toEqual({ missing: 'Enter the App ID and the Access Token of your Doubao AST 2.0 app.' });
    expect(ast2Credentials.read({ appId: '  ', accessToken: 't' }, signedOut)).toHaveProperty('missing');
    expect(ast2Credentials.read({ apiKey: '' }, signedOut)).toEqual({ missing: 'Enter the API key of your Doubao AST 2.0 app.' });
  });
});

describe("Doubao AST 2.0's languages (ruling 3; choice 1)", () => {
  it('offer the eight spoken languages and zhen when the run speaks, all twenty, two dialects and zhen when it does not', () => {
    expect(values(ast2Languages.sources(AST2_DEFAULTS, SPEAKING))).toEqual([...SPOKEN, ZHEN]);
    expect(values(ast2Languages.sources(AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY, ...DIALECTS, ZHEN]);
    // Without a context: the widest offer, text only's.
    expect(ast2Languages.sources(AST2_DEFAULTS)).toBe(ast2Languages.sources(AST2_DEFAULTS, TEXT));
    expect(ast2Languages.initial?.(AST2_DEFAULTS)).toEqual({ source: 'zh', target: 'en' });
  });

  it("offer, when the run speaks, only what they offer when it does not, and text only's targets without a context", () => {
    // The registry's invariant, for the provider it was written for: a text-only speaker in a speaking run takes its pair from the speaking offer.
    const textSources = values(ast2Languages.sources(AST2_DEFAULTS, TEXT));
    for (const source of values(ast2Languages.sources(AST2_DEFAULTS, SPEAKING))) {
      expect(textSources, source).toContain(source);
      const textTargets = values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT));
      for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, SPEAKING))) expect(textTargets, `${source} → ${target}`).toContain(target);
    }
    for (const source of textSources) {
      expect(values(ast2Languages.targets(source, AST2_DEFAULTS)), source).toEqual(values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT)));
    }
  });

  it("name the twelve more and Cantonese as the shared registry does (choice 17)", () => {
    const named = new Map(ast2Languages.sources(AST2_DEFAULTS, TEXT).map((o) => [o.value, o.name]));
    for (const code of TEXT_ONLY.filter((c) => c !== 'ms')) expect(named.get(code), code).toBe(LANGUAGE_OPTIONS[code].name);
    expect(named.get('yue-CN')).toBe(LANGUAGE_OPTIONS.cantonese.name);
  });

  it('pair zhen only with itself', () => {
    for (const context of [SPEAKING, TEXT]) {
      expect(values(ast2Languages.targets(ZHEN, AST2_DEFAULTS, context))).toEqual([ZHEN]);
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context)).filter((v) => v !== ZHEN)) {
        expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).not.toContain(ZHEN);
      }
    }
  });

  it("put Chinese or English on one side: zh and en reach every other language of the mode, anything else reaches English or Chinese, English first", () => {
    expect(values(ast2Languages.targets('zh', AST2_DEFAULTS, SPEAKING))).toEqual(SPOKEN.filter((v) => v !== 'zh'));
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY].filter((v) => v !== 'en'));
    for (const source of ['ja', 'fr', 'ko', 'it', 'yue-CN', 'sh-CN']) {
      expect(values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT)), source).toEqual(['en', 'zh']);
    }
    expect(values(ast2Languages.targets('ja', AST2_DEFAULTS, SPEAKING))).toEqual(['en', 'zh']);
  });

  it('never offer a dialect as a target, nor a source as its own target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        const targets = values(ast2Languages.targets(source, AST2_DEFAULTS, context));
        for (const dialect of DIALECTS) expect(targets, source).not.toContain(dialect);
        if (source !== ZHEN) expect(targets, source).not.toContain(source);
      }
    }
  });

  it('reverse every offered pair in its own mode (D20), except a dialect source, which is never a target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, context))) {
          const pair = { source, target };
          expect(reverseSupported(p, AST2_DEFAULTS, pair, context), `${source} → ${target}`).toBe(!DIALECTS.includes(source));
        }
      }
    }
    expect(swapped(p, AST2_DEFAULTS, { source: ZHEN, target: ZHEN }, SPEAKING)).toBeNull();
  });

  it('keep what they can of a pair a mode switch leaves unoffered, by normalizePair (the spec\'s rule)', () => {
    // Text only's Korean → Chinese, once the run speaks: Korean is gone, so the first source; its first target.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ko', target: 'zh' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ko' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'yue-CN', target: 'en' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    // Every spoken pair runs as text too: the switch the other way changes nothing.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'zh' }, TEXT)).toEqual({ source: 'ja', target: 'zh' });
  });

  it("repair the old UI's pairs: zhen with anything becomes zhen/zhen, a pair with neither Chinese nor English gets English (the old rules R1, R3)", () => {
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZHEN, target: 'en' })).toEqual({ source: ZHEN, target: ZHEN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'en', target: ZHEN })).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'de' })).toEqual({ source: 'ja', target: 'en' });
    // R1: picking zhen as the source; R3: leaving it.
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZHEN, target: 'ja' }, SPEAKING)).toEqual({ source: ZHEN, target: ZHEN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'fr', target: ZHEN }, SPEAKING)).toEqual({ source: 'fr', target: 'en' });
  });

  it('say whether Doubao runs a direction in a mode: build\'s guard', () => {
    expect(ast2Offers({ source: 'ja', target: 'zh' }, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, SPEAKING)).toBe(false);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, TEXT)).toBe(true);
    expect(ast2Offers({ source: 'ja', target: 'de' }, TEXT)).toBe(false);
    expect(ast2Offers({ source: 'en', target: 'yue-CN' }, TEXT)).toBe(false);
  });
});

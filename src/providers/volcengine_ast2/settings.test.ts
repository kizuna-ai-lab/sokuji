import { describe, it, expect } from 'vitest';
import { readCredentials } from '../../lib/provider/credentials';
import { normalizePair, reverseSupported, swapped } from '../../lib/provider/languages';
import type { AuthContext, LanguageContext } from '../../lib/provider/types';
import { parseCode } from '../../lib/language/code';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, ast2Offers, migrateAst2Settings, ZH_EN } from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const SPEAKING: LanguageContext = { speech: true };
const TEXT: LanguageContext = { speech: false };
const p = { languages: ast2Languages };
const values = (list: readonly { value: string }[]) => list.map((o) => o.value);
const SPOKEN = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr'];
const TEXT_ONLY = ['ko', 'tr', 'ms', 'nl', 'ro', 'pl', 'cs', 'ar', 'th', 'vi', 'ru', 'it'];
const DIALECTS = ['yue', 'wuu'];

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

  it("read the chosen mode through the real caller, the other mode's saved values never leaking into it", () => {
    const saved = { appId: 'a', accessToken: 't', apiKey: 'k' };
    expect(readCredentials({ credentials: ast2Credentials }, AST2_DEFAULTS, saved, signedOut)).toEqual({ kind: 'app', appKey: 'a', accessKey: 't' });
    expect(readCredentials({ credentials: ast2Credentials }, { ...AST2_DEFAULTS, authMode: 'apiKey' }, saved, signedOut)).toEqual({ kind: 'apiKey', apiKey: 'k' });
  });

  it('read an empty field as missing, in either mode', () => {
    expect(ast2Credentials.read({ appId: 'a', accessToken: '' }, signedOut)).toEqual({ missing: 'Enter the App ID and the Access Token of your Doubao AST 2.0 app.' });
    expect(ast2Credentials.read({ appId: '  ', accessToken: 't' }, signedOut)).toHaveProperty('missing');
    expect(ast2Credentials.read({ apiKey: '' }, signedOut)).toEqual({ missing: 'Enter the API key of your Doubao AST 2.0 app.' });
  });
});

describe("Doubao AST 2.0's languages (ruling 3; choice 1)", () => {
  it('offer the eight spoken languages and zhen when the run speaks, all twenty, two dialects and zhen when it does not', () => {
    expect(values(ast2Languages.sources(AST2_DEFAULTS, SPEAKING))).toEqual([...SPOKEN, ZH_EN]);
    expect(values(ast2Languages.sources(AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY, ...DIALECTS, ZH_EN]);
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

  it('offers app codes; the bidirectional mode is zh+en, the dialects yue and wuu (unified language codes)', () => {
    const text = ast2Languages.sources(AST2_DEFAULTS, { speech: false }).map((o) => o.value);
    for (const v of text) expect(parseCode(v), v).not.toBeNull();
    expect(text).toEqual(expect.arrayContaining(['zh+en', 'yue', 'wuu']));
    expect(ast2Languages.targets('zh+en', AST2_DEFAULTS, { speech: true }).map((o) => o.value)).toEqual(['zh+en']);
    expect(ast2Languages.wire?.toWire('zh+en')).toBe('zhen');
    expect(ast2Languages.wire?.toWire('yue')).toBe('yue-CN');
    expect(ast2Languages.wire?.toWire('wuu')).toBe('sh-CN');
  });

  it('pair zhen only with itself', () => {
    for (const context of [SPEAKING, TEXT]) {
      expect(values(ast2Languages.targets(ZH_EN, AST2_DEFAULTS, context))).toEqual([ZH_EN]);
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context)).filter((v) => v !== ZH_EN)) {
        expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).not.toContain(ZH_EN);
      }
    }
  });

  it("put Chinese or English on one side: zh and en reach every other language of the mode, anything else reaches English or Chinese, English first", () => {
    expect(values(ast2Languages.targets('zh', AST2_DEFAULTS, SPEAKING))).toEqual(SPOKEN.filter((v) => v !== 'zh'));
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY].filter((v) => v !== 'en'));
    for (const source of ['ja', 'fr', 'ko', 'it', 'yue', 'wuu']) {
      expect(values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT)), source).toEqual(['en', 'zh']);
    }
    expect(values(ast2Languages.targets('ja', AST2_DEFAULTS, SPEAKING))).toEqual(['en', 'zh']);
  });

  it('never offer a dialect as a target, nor a source as its own target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        const targets = values(ast2Languages.targets(source, AST2_DEFAULTS, context));
        for (const dialect of DIALECTS) expect(targets, source).not.toContain(dialect);
        if (source !== ZH_EN) expect(targets, source).not.toContain(source);
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
    expect(swapped(p, AST2_DEFAULTS, { source: ZH_EN, target: ZH_EN }, SPEAKING)).toBeNull();
  });

  it('keep what they can of a pair a mode switch leaves unoffered, by normalizePair (the spec\'s rule)', () => {
    // Text only's Korean → Chinese, once the run speaks: Korean is gone, so the first source; its first target.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ko', target: 'zh' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ko' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'yue', target: 'en' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    // Every spoken pair runs as text too: the switch the other way changes nothing.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'zh' }, TEXT)).toEqual({ source: 'ja', target: 'zh' });
  });

  it("repair the old UI's pairs: zhen with anything becomes zhen/zhen, a pair with neither Chinese nor English gets English (the old rules R1, R3)", () => {
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZH_EN, target: 'en' })).toEqual({ source: ZH_EN, target: ZH_EN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'en', target: ZH_EN })).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'de' })).toEqual({ source: 'ja', target: 'en' });
    // R1: picking zhen as the source; R3: leaving it.
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZH_EN, target: 'ja' }, SPEAKING)).toEqual({ source: ZH_EN, target: ZH_EN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'fr', target: ZH_EN }, SPEAKING)).toEqual({ source: 'fr', target: 'en' });
  });

  it('say whether Doubao runs a direction in a mode: build\'s guard', () => {
    expect(ast2Offers({ source: 'ja', target: 'zh' }, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, SPEAKING)).toBe(false);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, TEXT)).toBe(true);
    expect(ast2Offers({ source: 'ja', target: 'de' }, TEXT)).toBe(false);
    expect(ast2Offers({ source: 'en', target: 'yue' }, TEXT)).toBe(false);
  });
});

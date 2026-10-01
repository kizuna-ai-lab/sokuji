import { describe, it, expect } from 'vitest';
import { readCredentials } from '../../lib/provider/credentials';
import { normalizePair, reverseSupported, swapped } from '../../lib/provider/languages';
import type { AuthContext, LanguageContext } from '../../lib/provider/types';
import { parseCode } from '../../lib/language/code';
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, ast2Offers, migrateAst2Settings, ZH_EN, type Ast2Settings } from './settings';

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
    expect(AST2_DEFAULTS).toEqual({ authMode: 'app', hotWordTableId: '', replacementTableId: '', glossaryTableId: '', voices: {} });
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

  it('keep the voices chosen per target, and drop a key, a value or a voice that does not hold (#577 catalog §2.4)', () => {
    const kept = { en: 'clone', ja: 'ja_female_bv024_uranus_bigtts', 'zh+en': 'zh_female_vv_uranus_bigtts' };
    expect(migrateAst2Settings({ ...AST2_DEFAULTS, voices: kept }).voices).toEqual(kept);
    // th is no fixed target; bv024 speaks Japanese, not English; a refresh removed nope; 3 is no voice.
    expect(migrateAst2Settings({ voices: { th: 'clone', en: 'ja_female_bv024_uranus_bigtts', ja: 'nope_bigtts', de: 3, ko: 'clone' } }).voices).toEqual({ ko: 'clone' });
  });

  it('read a voices value of the wrong type as no choice (Review Focus)', () => {
    for (const voices of ['{"en":"clone"}', ['clone'], 7, null]) expect(migrateAst2Settings({ voices }).voices, String(voices)).toEqual({});
    expect(migrateAst2Settings({ hotWordTableId: 'hot-1' }).voices).toEqual({});
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

const NINE = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr', 'ko'];
const ALL_SOURCES = [...SPOKEN, ...TEXT_ONLY, ...DIALECTS, ZH_EN];

describe("Doubao AST 2.0's languages (#577 catalog §2.1)", () => {
  it('offer the twenty languages, the two dialects and zh+en as sources whether or not the run speaks', () => {
    for (const context of [SPEAKING, TEXT, undefined]) expect(values(ast2Languages.sources(AST2_DEFAULTS, context))).toEqual(ALL_SOURCES);
    expect(ast2Languages.initial?.(AST2_DEFAULTS)).toEqual({ source: 'zh', target: 'en' });
  });

  it('speak from Chinese or English into the nine languages a voice speaks, Korean included', () => {
    expect(values(ast2Languages.targets('zh', AST2_DEFAULTS, SPEAKING))).toEqual(NINE.filter((v) => v !== 'zh'));
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, SPEAKING))).toEqual(NINE.filter((v) => v !== 'en'));
  });

  it('translate from Chinese or English into all twenty as text', () => {
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY].filter((v) => v !== 'en'));
    for (const source of values(ast2Languages.sources(AST2_DEFAULTS, TEXT))) {
      expect(values(ast2Languages.targets(source, AST2_DEFAULTS)), source).toEqual(values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT)));
    }
  });

  it('reach English or Chinese, English first, from any other source', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of ['ja', 'fr', 'ko', 'ru', 'it', 'yue', 'wuu']) expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).toEqual(['en', 'zh']);
    }
  });

  it('pair zh+en only with itself', () => {
    for (const context of [SPEAKING, TEXT]) {
      expect(values(ast2Languages.targets(ZH_EN, AST2_DEFAULTS, context))).toEqual([ZH_EN]);
      for (const source of ALL_SOURCES.filter((v) => v !== ZH_EN)) expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).not.toContain(ZH_EN);
    }
  });

  it('never offer a dialect as a target, nor a source as its own target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of ALL_SOURCES) {
        const targets = values(ast2Languages.targets(source, AST2_DEFAULTS, context));
        for (const dialect of DIALECTS) expect(targets, source).not.toContain(dialect);
        if (source !== ZH_EN) expect(targets, source).not.toContain(source);
      }
    }
  });

  it("keep the speaking offer within the text-only one (the registry's invariant)", () => {
    const textSources = values(ast2Languages.sources(AST2_DEFAULTS, TEXT));
    for (const source of values(ast2Languages.sources(AST2_DEFAULTS, SPEAKING))) {
      expect(textSources, source).toContain(source);
      const textTargets = values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT));
      for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, SPEAKING))) expect(textTargets, `${source} → ${target}`).toContain(target);
    }
  });

  it('offer every pair cloning runs when the run speaks, so no pair a user runs today disappears', () => {
    for (const source of SPOKEN) {
      for (const target of SPOKEN) {
        if (source === target || !(['zh', 'en'].includes(source) || ['zh', 'en'].includes(target))) continue;
        expect(ast2Offers({ source, target }, AST2_DEFAULTS, SPEAKING), `${source} → ${target}`).toBe(true);
      }
    }
    expect(ast2Offers({ source: ZH_EN, target: ZH_EN }, AST2_DEFAULTS, SPEAKING)).toBe(true);
  });

  it('do not depend on the voices chosen (R7)', () => {
    const chosen: Ast2Settings = { ...AST2_DEFAULTS, voices: { en: 'en_male_alex_uranus_bigtts', ja: 'clone' } };
    for (const context of [SPEAKING, TEXT]) {
      expect(ast2Languages.sources(chosen, context)).toEqual(ast2Languages.sources(AST2_DEFAULTS, context));
      for (const source of ALL_SOURCES) expect(ast2Languages.targets(source, chosen, context), source).toEqual(ast2Languages.targets(source, AST2_DEFAULTS, context));
    }
  });

  it('offer app codes; Doubao gets its own on the wire', () => {
    for (const v of ALL_SOURCES) expect(parseCode(v), v).not.toBeNull();
    expect(ast2Languages.wire?.toWire('zh+en')).toBe('zhen');
    expect(ast2Languages.wire?.toWire('yue')).toBe('yue-CN');
    expect(ast2Languages.wire?.toWire('wuu')).toBe('sh-CN');
    expect(ast2Languages.wire?.toWire('ko')).toBe('ko');
  });

  it('reverse an offered pair (D20) when its source is a target of the mode: never a dialect, and when speaking only the nine and zh+en', () => {
    for (const context of [SPEAKING, TEXT]) {
      const speakingTarget = (v: string) => v === ZH_EN || NINE.includes(v);
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, context))) {
          const expected = !DIALECTS.includes(source) && (context === TEXT || speakingTarget(source));
          expect(reverseSupported(p, AST2_DEFAULTS, { source, target }, context), `${source} → ${target}`).toBe(expected);
        }
      }
    }
    // ru → en speaks; en → ru does not: Russian is text only as a target.
    expect(reverseSupported(p, AST2_DEFAULTS, { source: 'ru', target: 'en' }, SPEAKING)).toBe(false);
    expect(swapped(p, AST2_DEFAULTS, { source: ZH_EN, target: ZH_EN }, SPEAKING)).toBeNull();
  });

  it("keep what they can of a pair, by normalizePair (the spec's rule)", () => {
    // Now spoken: Korean, the dialects, Korean as a target.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ko', target: 'zh' }, SPEAKING)).toEqual({ source: 'ko', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ko' }, SPEAKING)).toEqual({ source: 'zh', target: 'ko' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'yue', target: 'en' }, SPEAKING)).toEqual({ source: 'yue', target: 'en' });
    // Russian is text only as a target: the first target of the source.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ru' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ru' }, TEXT)).toEqual({ source: 'zh', target: 'ru' });
  });

  it("repair the old UI's pairs: zhen with anything becomes zhen/zhen, a pair with neither Chinese nor English gets English (the old rules R1, R3)", () => {
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZH_EN, target: 'en' })).toEqual({ source: ZH_EN, target: ZH_EN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'en', target: ZH_EN })).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'de' })).toEqual({ source: 'ja', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZH_EN, target: 'ja' }, SPEAKING)).toEqual({ source: ZH_EN, target: ZH_EN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'fr', target: ZH_EN }, SPEAKING)).toEqual({ source: 'fr', target: 'en' });
  });

  it("say whether Doubao runs a direction in a mode: build's guard", () => {
    expect(ast2Offers({ source: 'ja', target: 'zh' }, AST2_DEFAULTS, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, AST2_DEFAULTS, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'zh', target: 'ru' }, AST2_DEFAULTS, SPEAKING)).toBe(false);
    expect(ast2Offers({ source: 'zh', target: 'ru' }, AST2_DEFAULTS, TEXT)).toBe(true);
    expect(ast2Offers({ source: 'ja', target: 'de' }, AST2_DEFAULTS, TEXT)).toBe(false);
    expect(ast2Offers({ source: 'en', target: 'yue' }, AST2_DEFAULTS, TEXT)).toBe(false);
  });
});

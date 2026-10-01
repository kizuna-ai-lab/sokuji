import { describe, it, expect } from 'vitest';
import { parseCode } from '../../lib/language/code';
import { reverseSupported } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  SONIOX_DEFAULTS,
  SONIOX_KEY_FIELDS,
  migrateSonioxSettings,
  sonioxCredentials,
  sonioxKeyField,
  SONIOX_LANGUAGES,
  sonioxLanguages,
  sonioxVoiceField,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };

describe('SONIOX_DEFAULTS', () => {
  it('defaults to the US region, Adrian in every region, shared Both on, and Soniox\'s server defaults', () => {
    expect(SONIOX_DEFAULTS).toEqual({
      region: 'us',
      voice: 'Adrian',
      voiceEu: 'Adrian',
      voiceJp: 'Adrian',
      bothModeSharedSession: true,
      vocabularyTerms: '',
      vocabularyTranslations: '',
      contextText: '',
      endpointSensitivity: 0,
      endpointLatencyAdjustmentLevel: 0,
      endpointMaxDelayMs: 2000,
      ttsSpeed: 1,
    });
  });
});

describe('migrateSonioxSettings', () => {
  it('migrates the defaults, stored as they are, into the defaults; an unknown region to US; a wrong-typed field to its default', () => {
    // A literal, not a `SonioxSettings`: an interface type has no index signature, so it would not pass as a stored record.
    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS })).toEqual(SONIOX_DEFAULTS);

    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, region: 'mars' }).region).toBe('us');

    const wrongTyped = migrateSonioxSettings({
      ...SONIOX_DEFAULTS,
      endpointMaxDelayMs: 'x',
      voiceJp: 7,
      bothModeSharedSession: 'yes',
    });
    expect(wrongTyped.endpointMaxDelayMs).toBe(2000);
    expect(wrongTyped.voiceJp).toBe('Adrian');
    expect(wrongTyped.bothModeSharedSession).toBe(true);

    // An unlisted stored field is not carried into the result.
    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, model: 'stt-rt-v5' })).not.toHaveProperty('model');
  });
});

describe('sonioxCredentials.fields', () => {
  it("shows one secret field: the region's key, with Soniox's placeholder", () => {
    expect(sonioxCredentials.fields({ ...SONIOX_DEFAULTS, region: 'jp' })).toEqual([
      { key: 'apiKeyJp', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'providers.soniox.apiKeyPlaceholder' },
    ]);
    expect(sonioxCredentials.fields({ ...SONIOX_DEFAULTS, region: 'eu' })[0].key).toBe('apiKeyEu');
    expect(sonioxCredentials.fields({ ...SONIOX_DEFAULTS, region: 'nowhere' as never })[0].key).toBe('apiKey');
  });
});

describe('sonioxCredentials.keys', () => {
  it('lists all three region keys, so a region switch never waits on storage', () => {
    expect(sonioxCredentials.keys).toEqual(['apiKey', 'apiKeyEu', 'apiKeyJp']);
    expect(SONIOX_KEY_FIELDS).toEqual(['apiKey', 'apiKeyEu', 'apiKeyJp']);
  });
});

describe('sonioxCredentials.read', () => {
  it('reads the region from the field it was handed; one key serves both sockets; no client reference (ruling 7)', () => {
    expect(sonioxCredentials.read({ apiKeyEu: 'k' }, signedOut)).toEqual({ region: 'eu', stt: 'k', tts: 'k' });
    expect(sonioxCredentials.read({ apiKey: 'k' }, signedOut)).toEqual({ region: 'us', stt: 'k', tts: 'k' });
  });

  it("reads an empty key as missing, worded by the runner's own code", () => {
    const missing = sonioxCredentials.read({ apiKeyJp: '' }, signedOut);
    expect(missing).toEqual({ missing: 'Enter your Soniox API key for the JP region.' });
    expect(missing).not.toHaveProperty('code');
  });
});

describe('sonioxLanguages', () => {
  const p = { languages: sonioxLanguages };

  it('offers AUTO and the 60 languages as sources, the 60 as every source\'s targets, never AUTO, and starts auto → en', () => {
    const sources = sonioxLanguages.sources(SONIOX_DEFAULTS);
    expect(sources).toHaveLength(61);
    expect(sources[0]).toEqual({ value: 'auto' });

    const targets = sonioxLanguages.targets('ja', SONIOX_DEFAULTS);
    expect(targets).toHaveLength(60);
    expect(targets.some((l) => l.value === 'ja')).toBe(true);
    expect(targets.some((l) => l.value === 'auto')).toBe(false);

    expect(sonioxLanguages.initial?.(SONIOX_DEFAULTS)).toEqual({ source: 'auto', target: 'en' });
  });

  it('an auto source never reverses, so it refuses the participant leg (D20)', () => {
    expect(reverseSupported(p, SONIOX_DEFAULTS, { source: 'auto', target: 'en' })).toBe(false);
    expect(reverseSupported(p, SONIOX_DEFAULTS, { source: 'ja', target: 'en' })).toBe(true);
  });
});

describe('sonioxKeyField / sonioxVoiceField', () => {
  it("maps each region to its key and voice fields, US keeping the suffix-less names", () => {
    expect(sonioxKeyField('us')).toBe('apiKey');
    expect(sonioxKeyField('eu')).toBe('apiKeyEu');
    expect(sonioxKeyField('jp')).toBe('apiKeyJp');
    expect(sonioxVoiceField('us')).toBe('voice');
    expect(sonioxVoiceField('eu')).toBe('voiceEu');
    expect(sonioxVoiceField('jp')).toBe('voiceJp');
  });
});

it('offers app codes; Tagalog is fil here and tl at Soniox (unified language codes)', () => {
  const values = SONIOX_LANGUAGES.map((o) => o.value);
  for (const v of values) expect(parseCode(v), v).not.toBeNull();
  expect(values).toContain('fil');
  expect(values).not.toContain('tl');
  expect(sonioxLanguages.wire?.toWire('fil')).toBe('tl');
  expect(sonioxLanguages.wire?.fromWire('tl')).toBe('fil');
});

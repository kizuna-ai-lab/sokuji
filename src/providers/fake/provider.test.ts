import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { fakeProvider } from './provider';
import { FAKE_SCRIPT_NAMES, fakeScript } from './scripts';
import { FAKE_DEFAULTS, migrateFakeSettings, type FakeSettings } from './settings';

const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const shared: SharedSettings = { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } };
const noAuth = { signedIn: false, getToken: async () => null };
const settings = (patch: Partial<FakeSettings> = {}): FakeSettings => ({ ...FAKE_DEFAULTS, ...patch });

describe('the fake provider', () => {
  it('shows no credential field by default, and reads without one', () => {
    expect(fakeProvider.credentials.fields(settings())).toEqual([]);
    expect(fakeProvider.credentials.read({}, noAuth)).not.toHaveProperty('missing');
  });

  it('asks for a key when requireKey is on, and reports it missing while empty', () => {
    expect(fakeProvider.credentials.fields(settings({ requireKey: true }))).toEqual([
      { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
    ]);
    expect(fakeProvider.credentials.read({ apiKey: '' }, noAuth)).toHaveProperty('missing');
    expect(fakeProvider.credentials.read({ apiKey: 'anything' }, noAuth)).not.toHaveProperty('missing');
  });

  it('lists every field it can show among its credential keys', () => {
    const shown = fakeProvider.credentials.fields(settings({ requireKey: true })).map((f) => f.key);
    for (const key of shown) expect(fakeProvider.credentials.keys).toContain(key);
  });

  it('is ready unless checkFails is on', async () => {
    await expect(fakeProvider.check({}, settings())).resolves.toEqual({ ok: true });
    await expect(fakeProvider.check({}, settings({ checkFails: true }))).resolves.toMatchObject({ ok: false });
  });

  it('refuses to build when buildRefused is on', () => {
    expect(fakeProvider.build(context, settings({ buildRefused: true }), shared)).toHaveProperty('refused');
  });

  it('builds the chosen script and passes the fault knobs, leaving zero-valued ones unset', () => {
    expect(fakeProvider.build(context, settings({ script: 'cjk', startThrows: true, failAfterMs: 2000 }), shared)).toEqual({
      script: fakeScript('cjk'),
      faults: { startThrows: expect.any(String), startDelayMs: undefined, failAfterMs: 2000 },
    });
  });

  it('offers AUTO as a source, never as a target, and never a source as its own target', () => {
    const s = settings();
    expect(fakeProvider.languages.sources(s).map((o) => o.value)).toEqual([AUTO, 'en', 'ja', 'zh']);
    expect(fakeProvider.languages.targets(AUTO, s).map((o) => o.value)).toEqual(['en', 'ja', 'zh']);
    expect(fakeProvider.languages.targets('ja', s).map((o) => o.value)).toEqual(['en', 'zh']);
  });

  it('offers both turn modes and cuts at its own boundaries', () => {
    expect(fakeProvider.turns(settings())).toEqual(['auto', 'manual']);
    expect(fakeProvider.boundaries(settings())).toBe('provider');
  });

  it('plays what it built: the first source segment opens on the clock', async () => {
    const built = fakeProvider.build(context, settings(), shared);
    if ('refused' in built) throw new Error(built.refused);
    const clock = createVirtualClock();
    const { events, log } = recordEvents();
    await fakeProvider.start({ context, config: built, credentials: {}, clock, signal: new AbortController().signal }, events);
    expect(log).toEqual([]);
    clock.advance(500);
    expect(log[0]).toEqual({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'x1' } });
  });

  it('has a script for every name in the catalogue', () => {
    for (const name of FAKE_SCRIPT_NAMES) expect(fakeScript(name).blocks.length).toBeGreaterThan(0);
  });
});

describe('migrateFakeSettings', () => {
  it('keeps valid stored values', () => {
    // A literal, not a `FakeSettings`: an interface type has no index signature, so it would not pass as a stored record.
    const stored = { ...FAKE_DEFAULTS, script: 'long', checkFails: true, startDelayMs: 300 };
    expect(migrateFakeSettings(stored)).toEqual(stored);
  });

  it('replaces an unknown script, a non-boolean flag and a bad number with their defaults', () => {
    expect(migrateFakeSettings({ ...FAKE_DEFAULTS, script: 'gone', requireKey: 'yes', failAfterMs: -1, startDelayMs: Number.NaN }))
      .toEqual(FAKE_DEFAULTS);
  });
});

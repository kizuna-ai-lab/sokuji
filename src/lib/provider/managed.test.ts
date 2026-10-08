import { describe, it, expect, vi, afterEach } from 'vitest';
import { FlaskConical } from 'lucide-react';
import type { ComponentType } from 'react';
import type { AdapterEvents, StartRequest } from '../contract/adapter';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS, type FakeSettings } from '../../providers/fake/settings';
import type { FakeConfig, FakeCredentials } from '../../providers/fake/adapter';
import type { SessionHooks } from '../session/types';
import { managed, readSignIn, type ManagedOverrides } from './managed';
import type { AnyProvider, AuthContext, CredentialsMissing, Provider, SettingsProps } from './types';

/** What a provider's `read` answers, `missing` aside. */
type ReadOf<P extends AnyProvider> = Exclude<ReturnType<P['credentials']['read']>, CredentialsMissing>;

const TwinSettings: ComponentType<SettingsProps<FakeSettings>> = () => null;
const acquire: NonNullable<SessionHooks<FakeSettings, FakeCredentials, FakeConfig>['acquire']> = async () => ({ credentials: () => ({}), release: async () => {} });
const OVERRIDES: ManagedOverrides<FakeSettings, FakeCredentials, FakeConfig, 'twin'> = {
  id: 'twin', vendor: 'Vendor', icon: FlaskConical, settingsKey: 'twinSlice', Settings: TwinSettings,
  signedOut: 'Sign in to use the twin.', session: { acquire },
};
const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const signedIn: AuthContext = { signedIn: true, userId: 'u1', getToken: async () => 't' };

afterEach(() => vi.unstubAllGlobals());

describe('readSignIn', () => {
  it('answers the sign-in: pending while it loads, missing signed out, the sign-in once signed in', () => {
    expect(readSignIn({ ...signedIn, loaded: false }, 'x')).toEqual({ missing: 'The sign-in is still loading.', code: 'sign_in_pending' });
    expect(readSignIn(signedOut, 'Sign in first.')).toEqual({ missing: 'Sign in first.', code: 'sign_in_required' });
    expect(readSignIn(signedIn, 'x')).toEqual({ signedIn: true });
    // `loaded` absent reads as loaded.
    expect(readSignIn({ ...signedIn, loaded: true }, 'x')).toEqual({ signedIn: true });
  });
});

describe('managed', () => {
  it("is its own provider over the base's languages, capabilities, builder and adapter", () => {
    const twin = managed(fakeProvider, OVERRIDES);
    expect(twin).toMatchObject({ id: 'twin', kind: 'managed', vendor: 'Vendor', icon: FlaskConical, platforms: fakeProvider.platforms, Settings: TwinSettings });
    expect(twin.settings).toEqual({ key: 'twinSlice', defaults: fakeProvider.settings.defaults, migrate: fakeProvider.settings.migrate });
    for (const member of ['languages', 'speech', 'textInput', 'boundaries', 'turns', 'build', 'describe', 'start'] as const) {
      expect(twin[member], member).toBe(fakeProvider[member]);
    }
  });

  it('has no credential field, reads the sign-in, and checks nothing: a static answer that calls no one', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const twin = managed(fakeProvider, OVERRIDES);
    expect(twin.credentials.keys).toEqual([]);
    expect(twin.credentials.fields(FAKE_DEFAULTS)).toEqual([]);
    expect(twin.credentials.read({}, signedOut)).toEqual({ missing: 'Sign in to use the twin.', code: 'sign_in_required' });
    expect(twin.credentials.read({}, signedIn)).toEqual({ signedIn: true });
    await expect(twin.check({ signedIn: true }, FAKE_DEFAULTS, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] })).resolves.toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds its lease and hooks to the base's own, the base's startBoth kept", () => {
    const startBoth = vi.fn();
    const base = { ...fakeProvider, session: { startBoth } } as Provider<FakeSettings, FakeCredentials, FakeConfig>;
    const prepare = vi.fn();
    const minimumBalance = () => 100;
    const twin = managed(base, { ...OVERRIDES, session: { acquire, prepare, minimumBalance } });
    expect(twin.session).toEqual({ startBoth, acquire, prepare, minimumBalance });
  });

  it("leaves the base's guide, locale key and presence knobs behind", () => {
    const base = { ...fakeProvider, guideUrl: 'https://example.com/guide', flagged: true as const, testerSwitch: 'debug:fake' };
    const twin = managed(base, OVERRIDES);
    for (const member of ['guideUrl', 'flagged', 'testerSwitch'] as const) expect(twin, member).not.toHaveProperty(member);
  });

  it("takes no settings member or hook of the base it does not name: they are spelled out, not spread", () => {
    const admit = vi.fn();
    const basePrepare = vi.fn();
    const base = {
      ...fakeProvider,
      settings: { ...fakeProvider.settings, legacyKeys: ['oldKey'] },
      session: { admit, prepare: basePrepare },
    } as unknown as Provider<FakeSettings, FakeCredentials, FakeConfig>;
    const twin = managed(base, OVERRIDES);
    expect(twin.settings).not.toHaveProperty('legacyKeys');
    expect(twin.session).toEqual({ acquire });
  });

  it('carries the participant-speech flag as given, and nothing when none is', () => {
    expect(managed(fakeProvider, OVERRIDES)).not.toHaveProperty('participantSpeech');
    expect(managed(fakeProvider, { ...OVERRIDES, participantSpeech: false }).participantSpeech).toBe(false);
    expect(managed(fakeProvider, { ...OVERRIDES, participantSpeech: true }).participantSpeech).toBe(true);
  });

  it("keeps the base's own participant-speech flag when the twin gives none: a twin never speaks where its base cannot", () => {
    const silentBase = { ...fakeProvider, participantSpeech: false };
    expect(managed(silentBase, OVERRIDES).participantSpeech).toBe(false);
    // The twin's own flag, when given, is the one it carries.
    expect(managed(silentBase, { ...OVERRIDES, participantSpeech: true }).participantSpeech).toBe(true);
    expect(managed({ ...fakeProvider, participantSpeech: true }, { ...OVERRIDES, participantSpeech: false }).participantSpeech).toBe(false);
  });

  // Compile-time (choice 1): the typecheck gate enforces every `@ts-expect-error` here.
  it('types what read answers as R — the sign-in, never a key its lease mints', () => {
    const twin = managed(fakeProvider, OVERRIDES);
    const signIn: ReadOf<typeof twin> = { signedIn: true };
    // @ts-expect-error a managed read answers no key: `R` is the sign-in
    const key: ReadOf<typeof twin> = { apiKey: 'k' };
    // An own-key provider's `R` is its `K`, as before.
    const own: ReadOf<typeof fakeProvider> = {};
    // @ts-expect-error an own-key read answers its K, not the sign-in
    const notOwn: ReadOf<typeof fakeProvider> = { signedIn: true };
    // `check` takes what `read` answers; `start` still takes the lease's K.
    const request = {} as StartRequest<FakeConfig, FakeCredentials>;
    void twin.start(request, {} as AdapterEvents).catch(() => {});
    // @ts-expect-error a start never receives the sign-in
    void twin.start({ ...request, credentials: signIn }, {} as AdapterEvents).catch(() => {});
    // @ts-expect-error a twin must mint its keys: acquire is required
    managed(fakeProvider, { ...OVERRIDES, session: {} });
    expect([signIn, key, own, notOwn]).toHaveLength(4);
  });
});

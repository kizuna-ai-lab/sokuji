/**
 * The leased fake (D24; choice 1): the fake's scripts and faults behind the
 * session hooks a managed provider has — `prepare` (a voice claim that may
 * fall back), `acquire` (a lease: a key per leg, a budget and an end on the
 * run's clock, a refusal on a knob), `startBoth` (shared or split Both) and
 * `minimumBalance` (a start floor on a knob) — so the runner's hook paths,
 * a managed provider's readiness, presence and words run without a vendor.
 * Development builds only, like the fake; nothing here runs at module scope.
 */
import { KeyRound } from 'lucide-react';
import type { AdapterEvents, AdapterSession, StartRequest } from '../../lib/contract/adapter';
import { AdapterStartError, LegStartError } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import type { CredentialsMissing, Provider, ProviderRefusal } from '../../lib/provider/types';
import type { FakeConfig } from './adapter';
import { FakeLeasedSettingsView } from './FakeLeasedSettingsView';
import { buildFake, checkFake, describeFake, FAKE_LANGUAGES, startFake } from './provider';
import { FAKE_LEASED_DEFAULTS, migrateFakeLeasedSettings, type FakeLeasedSettings } from './settings';

/** The leased fake's config: the fake's, and whether `startBoth` ties the legs. */
export type FakeLeasedConfig = FakeConfig & { tieBoth: boolean };
/** What a leg's lease minted: which leg it is for. */
export type FakeLeasedCredentials = { leg?: LegName };

const isRefusal = (built: FakeConfig | ProviderRefusal): built is ProviderRefusal => typeof (built as ProviderRefusal).refused === 'string';

/** A session whose `stop` is `stop`: both legs of a shared session go together. */
function tied(session: AdapterSession, stop: () => Promise<void>): AdapterSession {
  // Delegate explicitly: a FakeSession's methods live on its prototype, which a spread drops.
  return {
    info: session.info,
    appendAudio: (pcm) => session.appendAudio(pcm),
    appendText: (text) => session.appendText(text),
    beginTurn: () => session.beginTurn(),
    endTurn: () => session.endTurn(),
    cancelTurn: () => session.cancelTurn(),
    stop,
  };
}

async function startBothLeased(
  requests: Record<LegName, StartRequest<FakeLeasedConfig, FakeLeasedCredentials>>,
  events: Record<LegName, AdapterEvents>,
): Promise<Record<LegName, AdapterSession>> {
  const legs: LegName[] = ['speaker', 'participant'];
  const settled = await Promise.allSettled(legs.map((leg) => startFake(requests[leg], events[leg])));
  const i = settled.findIndex((r) => r.status === 'rejected');
  if (i !== -1) {
    // Opens nothing on failure: a leg that did start is stopped before the
    // rejection. Settled, so a stop that fails too never replaces the start failure.
    await Promise.allSettled(settled.map((r) => (r.status === 'fulfilled' ? r.value.stop() : undefined)));
    throw new LegStartError(legs[i], (settled[i] as PromiseRejectedResult).reason);
  }
  const [speaker, participant] = settled.map((r) => (r as PromiseFulfilledResult<AdapterSession>).value);
  if (!requests.speaker.config.tieBoth) return { speaker, participant };
  // Shared Both (D23): one session under both legs — stopping either stops both.
  let stopping: Promise<void> | null = null;
  const stopBoth = () => (stopping ??= Promise.all([speaker.stop(), participant.stop()]).then(() => undefined));
  return { speaker: tied(speaker, stopBoth), participant: tied(participant, stopBoth) };
}

export const fakeLeasedProvider: Provider<FakeLeasedSettings, FakeLeasedCredentials, FakeLeasedConfig> & { id: 'fake_leased' } = {
  id: 'fake_leased',
  kind: 'managed',
  platforms: ['electron', 'extension', 'web'],
  icon: KeyRound,
  vendor: 'Sokuji',
  settings: { key: 'fakeLeased', defaults: FAKE_LEASED_DEFAULTS, migrate: migrateFakeLeasedSettings },
  Settings: FakeLeasedSettingsView,
  credentials: {
    keys: [],
    fields: () => [],
    // Annotated: an inferred return would widen `{}` to `{ missing?: undefined; … }`, which no weak `K` accepts.
    read: (_values, auth): FakeLeasedCredentials | CredentialsMissing =>
      (auth.signedIn ? {} : { missing: 'Sign in to use the leased fake.', code: 'sign_in_required' }),
  },
  check: (_k, s) => checkFake(_k, s),
  languages: FAKE_LANGUAGES,
  speech: 'optional',
  textInput: () => true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],
  build: (context, s, shared) => {
    const built = buildFake(context, s, shared);
    return isRefusal(built) ? built : { ...built, tieBoth: s.sharedBoth };
  },
  describe: describeFake,
  start: startFake,
  session: {
    async prepare(_shape, s, signal) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      return s.prepareFallback ? { notice: { code: 'voice_fallback', message: 'The leased fake used its fallback voice (knob).' } } : {};
    },
    async acquire(_shape, s, { signal, clock, end, frame }) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      if (s.acquireRefused) throw new AdapterStartError('The leased fake refused the lease (knob).', 'insufficient_balance');
      const cancel = s.leaseEndsAfterMs > 0
        ? clock.setTimeout(() => end({ code: 'budget_exhausted', message: 'Lease ended by the leased fake (knob).' }), s.leaseEndsAfterMs)
        : () => {};
      frame({ direction: 'in', type: 'lease.acquired', payload: { endsAfterMs: s.leaseEndsAfterMs } });
      let released = false;
      return {
        credentials: (leg) => ({ leg }),
        ...(s.leaseEndsAfterMs > 0 ? { budget: { totalMs: s.leaseEndsAfterMs, endsAt: clock.now() + s.leaseEndsAfterMs } } : {}),
        async release() {
          if (released) return;
          released = true;
          cancel();
        },
      };
    },
    startBoth: startBothLeased,
    minimumBalance: (shape, s) => (shape.legs.includes('speaker') && !shape.textOnly ? 2 : 1) * s.minimumBalanceMicroUsd,
  },
};

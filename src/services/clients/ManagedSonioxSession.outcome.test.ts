import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManagedSonioxSession, type ManagedSessionRequest } from './ManagedSonioxSession';
import type {
  SonioxSessionLeg,
  SonioxSessionOutcomeNotice,
} from './SonioxSessionOutcome';

/**
 * The session-level outcome routing, isolated from the client.
 *
 * Both endings under test belong to the SESSION: the balance running out and
 * Soniox dropping the session at its granted duration. Split Both runs two STT
 * streams under ONE `max_session_duration_seconds`, so both legs 403 within the
 * same second — the rule is that the sentence is said once, on the announcing
 * leg, and that EVERY leg is torn down regardless of which one noticed.
 */

const SESSION_TOKEN = 'better-auth-session-token-abc';

const SPEAKER_S2S: ManagedSessionRequest = { mode: 'speaker', textOnly: false, bothSplit: false };

function speechToSpeechResponse() {
  return {
    sttApiKey: 'soniox-stt-temp-key',
    ttsApiKey: 'soniox-tts-temp-key',
    expiresAt: '2026-07-25T00:01:00Z',
    maxSessionDurationSeconds: 900,
    budgetMicroUsd: 500_000,
    rateUsdPerHour: 0.6,
    sku: 'soniox:speech_to_speech',
    leaseId: 'lease-abc-123',
    clientReferenceId: 'sokuji1:acct-1:lease-abc-123',
  };
}

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Fake leg: everything a SonioxClient exposes to the session, and nothing
 * else. No sockets, no i18n bootstrap, no MainPanel — the routing rule is
 * what is under test, not the client.
 */
class FakeLeg implements SonioxSessionLeg {
  notices: SonioxSessionOutcomeNotice[] = [];
  endCalls = 0;

  constructor(readonly announcesSessionOutcome: boolean) {}

  announceSessionOutcome(notice: SonioxSessionOutcomeNotice) {
    this.notices.push(notice);
  }
  endForSessionOutcome() {
    this.endCalls++;
  }
}

/** A session with a real acquired grant — the only place startedAtMs and
 *  maxSessionDurationSeconds are set in production. */
async function acquiredSession(overrides: Record<string, unknown> = {}) {
  mockFetchOnce(200, { ...speechToSpeechResponse(), ...overrides });
  const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
  await session.acquire(SPEAKER_S2S);
  return session;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ManagedSonioxSession session-level outcomes', () => {
  let session: ManagedSonioxSession;
  let speaker: FakeLeg;
  let participant: FakeLeg;

  beforeEach(async () => {
    session = await acquiredSession();
    // The two legs of a split Both session, with the primacy bit MainPanel's
    // `managedSonioxArgFor` computes: the speaker announces, the participant
    // does not (its conversation items are never rendered).
    speaker = new FakeLeg(true);
    participant = new FakeLeg(false);
    session.attachLeg(speaker);
    session.attachLeg(participant);
  });

  it('attachLeg is idempotent — a re-attached leg is not torn down twice', () => {
    session.attachLeg(speaker);
    session.finishSession('duration_cutoff');
    expect(speaker.endCalls).toBe(1);
  });

  it('announces the cutoff on the ANNOUNCING leg even when the other leg reports it first', () => {
    // Only the announcing leg's conversation items are rendered:
    // MainPanel does setItems(speakerClientRef.current?.getConversationItems()).
    session.finishSession('duration_cutoff');

    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/this segment has ended/i);
    // A normal end-of-segment is not an api_error.
    expect(speaker.notices[0].analytics).toBeUndefined();
    // handleSttClose already emits session.duration_cutoff once PER LEG, so the
    // session must not emit a second one.
    expect(speaker.notices[0].realtimeEvent).toBeUndefined();
    expect(participant.notices).toHaveLength(0);
  });

  it('tears down EVERY leg, including the one that reported', () => {
    session.finishSession('duration_cutoff');
    expect(speaker.endCalls).toBe(1);
    expect(participant.endCalls).toBe(1);
  });

  it('the second leg 403ing in the same second announces nothing but is still torn down', () => {
    session.finishSession('duration_cutoff'); // speaker's close won the race
    session.finishSession('duration_cutoff'); // participant's close, ~same second

    expect(speaker.notices).toHaveLength(1);
    expect(participant.notices).toHaveLength(0);
    // The session calls unconditionally; idempotence is the LEG's own guard
    // (SonioxClient.sessionOutcomeEnded), so a fake leg counts both calls.
    expect(speaker.endCalls).toBe(2);
    expect(participant.endCalls).toBe(2);
  });

  it('exhaustion announces the balance message on the announcing leg WITH analytics', () => {
    session.finishSession('budget_exhausted');
    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/balance is used up/i);
    expect(speaker.notices[0].realtimeEvent).toBe('session.budget_exhausted');
    expect(speaker.notices[0].analytics).toEqual({
      code: 'budget_exhausted',
      rawMessage: 'Session budget exhausted',
    });
    expect(participant.notices).toHaveLength(0);
  });

  it('exhaustion tears down the OTHER leg too — it would otherwise keep streaming on an empty balance', () => {
    session.finishSession('budget_exhausted');
    expect(participant.endCalls).toBe(1);
  });

  it('a later duration cutoff never overwrites an already-announced exhaustion', () => {
    session.finishSession('budget_exhausted');
    session.finishSession('duration_cutoff');
    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/balance is used up/i);
  });

  it('a detached leg is neither announced to nor torn down', () => {
    // The participant can die mid-session while the speaker keeps streaming.
    session.detachLeg(participant);
    session.finishSession('duration_cutoff');
    expect(participant.endCalls).toBe(0);
    expect(speaker.notices).toHaveLength(1);
  });

  it('detaching the announcing leg leaves the survivor announcing rather than nobody', () => {
    session.detachLeg(speaker);
    session.finishSession('budget_exhausted');
    expect(speaker.notices).toHaveLength(0);
    expect(participant.notices).toHaveLength(1);
  });
});

describe('ManagedSonioxSession: exhaustion reaches the legs through finishSession', () => {
  it('the cost meter running out announces once and ends both legs', async () => {
    const session = await acquiredSession({ budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const speaker = new FakeLeg(true);
    const participant = new FakeLeg(false);
    session.attachLeg(speaker);
    session.attachLeg(participant);

    // The meter has no clock of its own; a stream's keepalive forwards this.
    session.tick(Date.now() + 5_000);
    session.tick(Date.now() + 10_000);

    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/balance is used up/i);
    expect(participant.notices).toHaveLength(0);
    expect(speaker.endCalls).toBeGreaterThanOrEqual(1);
    expect(participant.endCalls).toBeGreaterThanOrEqual(1);
  });

  it('honours a leg attached AFTER acquire — clients register at connect() time', async () => {
    const session = await acquiredSession({ budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const only = new FakeLeg(true);
    session.attachLeg(only);
    session.tick(Date.now() + 5_000);
    expect(only.notices).toHaveLength(1);
  });
});

describe('ManagedSonioxSession.isAtGrantedDurationEnd', () => {
  it('is true inside the margin and false early in the grant', async () => {
    const session = await acquiredSession(); // 900 s grant
    const startedAtMs = session.getBudgetSnapshot()!.startedAtMs;
    const grantEndMs = startedAtMs + 900_000;

    expect(session.isAtGrantedDurationEnd(grantEndMs)).toBe(true);
    expect(session.isAtGrantedDurationEnd(grantEndMs - ManagedSonioxSession.CUTOFF_MARGIN_MS)).toBe(true);
    expect(session.isAtGrantedDurationEnd(grantEndMs - ManagedSonioxSession.CUTOFF_MARGIN_MS - 1)).toBe(false);
    expect(session.isAtGrantedDurationEnd(startedAtMs + 10_000)).toBe(false);
  });

  it('stays true past the end of the grant — Soniox may report the cutoff late', async () => {
    const session = await acquiredSession();
    const startedAtMs = session.getBudgetSnapshot()!.startedAtMs;
    expect(session.isAtGrantedDurationEnd(startedAtMs + 900_000 + 60_000)).toBe(true);
  });

  it('stays true when the grant is unknown — the safer wrong answer', () => {
    const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
    // Nothing acquired yet: reading a 403 as the cutoff shows "this segment
    // has ended"; reading it as an outage shows "the connection was
    // interrupted". At a real cutoff the second is a lie that invites a
    // retry, so an unknown grant keeps today's behaviour.
    expect(session.isAtGrantedDurationEnd(1_000_000)).toBe(true);
  });

  it('stays true when the backend answered with no granted duration at all', async () => {
    const session = await acquiredSession({ maxSessionDurationSeconds: 0 });
    expect(session.isAtGrantedDurationEnd(session.getBudgetSnapshot()!.startedAtMs + 1_000)).toBe(true);
  });
});

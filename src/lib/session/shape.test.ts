import { describe, it, expect } from 'vitest';
import { AUTO } from '../provider/languages';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { formatUsdFloor } from '../../utils/formatters';
import { balanceRefusal, BALANCE_BELOW_FLOOR, contextsFor, gate, microphoneMissing, QUOTA_PENDING, QUOTA_UNKNOWN } from './shape';
import type { BalanceShape } from './types';
import type { RunShape } from './types';

const shape = (patch: Partial<RunShape> = {}): RunShape => ({
  provider: fakeProvider,
  settings: FAKE_DEFAULTS,
  credentials: { apiKey: '' },
  pair: { source: 'en', target: 'ja' },
  legs: ['speaker'],
  turnMode: 'auto',
  textOnly: false,
  participantSpeech: false,
  keepReplayAudio: true,
  shared: {
    instructions: () => '',
    pauses: { sourceSeconds: 1, translationSeconds: 1 },
    reversed: () => false,
    segmentation: { mode: 'off', sentencesPerRow: 0 },
  },
  auth: { signedIn: false, getToken: async () => null },
  ...patch,
});

describe('contextsFor', () => {
  it('gives the speaker the pair and the participant its reverse, always with automatic turns', () => {
    const contexts = contextsFor(shape({ legs: ['speaker', 'participant'], turnMode: 'push-to-talk' }));
    expect(contexts).toEqual({
      speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'manual' },
      participant: { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' },
    });
  });

  it('turns speech off for text-only, and the participant on only with the opt-in', () => {
    const contexts = contextsFor(shape({ legs: ['speaker', 'participant'], textOnly: true, participantSpeech: true }));
    expect(contexts.speaker?.speech).toBe(false);
    expect(contexts.participant?.speech).toBe(true);
  });

  it('follows a provider that always or never speaks, whatever the switches say', () => {
    expect(contextsFor(shape({ provider: { ...fakeProvider, speech: 'always' }, textOnly: true })).speaker?.speech).toBe(true);
    expect(contextsFor(shape({ provider: { ...fakeProvider, speech: 'never' } })).speaker?.speech).toBe(false);
  });

  it("gives the participant no speech while its provider's flag is off, whatever the opt-in; speech again once it is on", () => {
    const off = contextsFor(shape({ provider: { ...fakeProvider, participantSpeech: false }, legs: ['speaker', 'participant'], participantSpeech: true }));
    expect(off.participant?.speech).toBe(false);
    expect(off.speaker?.speech).toBe(true);
    const on = contextsFor(shape({ provider: { ...fakeProvider, participantSpeech: true }, legs: ['speaker', 'participant'], participantSpeech: true }));
    expect(on.participant?.speech).toBe(true);
    const flagOnSwitchOff = contextsFor(shape({ provider: { ...fakeProvider, participantSpeech: true }, legs: ['speaker', 'participant'], participantSpeech: false }));
    expect(flagOnSwitchOff.participant?.speech).toBe(false);
  });
});

describe('gate', () => {
  it('lets a supported shape through', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'] }), 'electron')).toBeNull();
  });

  it('refuses a shape with no legs', () => {
    expect(gate(shape({ legs: [] }), 'electron')).toMatchObject({ code: 'no_legs' });
  });

  it('refuses the participant leg where the provider cannot run the reversed pair (D20)', () => {
    expect(gate(shape({ legs: ['participant'], pair: { source: AUTO, target: 'en' } }), 'electron'))
      .toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
  });

  it('refuses the participant leg where the platform has no participant source', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'] }), 'web')).toMatchObject({ code: 'participant_source_unavailable', leg: 'participant' });
  });

  it('refuses a turn mode the provider does not offer', () => {
    const manualOnly = { ...fakeProvider, turns: () => ['manual' as const] };
    expect(gate(shape({ provider: manualOnly }), 'electron')).toMatchObject({ code: 'turn_mode_unsupported', leg: 'speaker' });
    expect(gate(shape({ provider: manualOnly, turnMode: 'push-to-talk', legs: ['speaker', 'participant'] }), 'electron'))
      .toMatchObject({ code: 'turn_mode_unsupported', leg: 'participant' });
  });

  it('gates the narrower input the stores give as well as a run\'s shape', () => {
    expect(gate({ provider: fakeProvider, settings: FAKE_DEFAULTS, pair: { source: 'en', target: 'ja' }, legs: ['participant'], turnMode: 'auto' }, 'web'))
      .toMatchObject({ code: 'participant_source_unavailable', leg: 'participant' });
  });
});

describe('microphoneMissing (1e-3 ruling 5)', () => {
  it('is missing only for the speaker leg with no chosen device', () => {
    expect(microphoneMissing(['speaker'], undefined)).toBe(true);
    expect(microphoneMissing(['speaker'], '')).toBe(true);
    expect(microphoneMissing(['speaker'], 'mic-1')).toBe(false);
    expect(microphoneMissing(['participant'], undefined)).toBe(false);
    expect(microphoneMissing(['speaker', 'participant'], undefined)).toBe(true);
  });
});

describe('balanceRefusal and the gate (Stage 2 Kizuna Soniox, rulings 5, 6)', () => {
  // A floor that rises with each speaking leg, as a lease's does.
  const leased = { ...fakeProvider, session: { minimumBalance: (s: BalanceShape) => 100 + (s.textOnly ? 0 : 100) + (s.participantSpeech ? 100 : 0) } } as unknown as RunShape['provider'];
  const known = (balanceMicroUsd: number, frozen = false) => ({ status: 'known' as const, balanceMicroUsd, frozen });
  const input = (patch: Partial<RunShape> = {}) => ({ provider: leased, settings: FAKE_DEFAULTS, legs: ['speaker'] as const, textOnly: false, participantSpeech: false, account: known(150), ...patch });

  it('gates nothing without an account (signed out, or none wired), or for a provider with no floor', () => {
    expect(balanceRefusal(input({ account: null }))).toBeNull();
    expect(balanceRefusal(input({ account: undefined }))).toBeNull();
    expect(balanceRefusal(input({ provider: fakeProvider, account: known(-1, true) }))).toBeNull();
    expect(balanceRefusal(input({ provider: fakeProvider, account: { status: 'unknown' } }))).toBeNull();
  });

  it('a wallet still loading answers quota_pending — "Checking...", no failure words', () => {
    expect(balanceRefusal(input({ account: { status: 'loading' } }))).toEqual({ code: QUOTA_PENDING, message: 'The wallet is still loading.' });
  });

  it('a wallet that failed to load refuses: quota_unknown, as the old gate did', () => {
    expect(balanceRefusal(input({ account: { status: 'unknown' } }))).toEqual({ code: QUOTA_UNKNOWN, message: 'The wallet could not be loaded.' });
  });

  it('refuses a frozen wallet before the floor', () => {
    expect(balanceRefusal(input({ account: known(10_000, true) }))).toEqual({ code: 'wallet_frozen', message: 'The wallet is frozen.' });
  });

  it('refuses a balance below the floor for these legs, with the balance floored in USD', () => {
    expect(balanceRefusal(input())).toEqual({
      code: BALANCE_BELOW_FLOOR,
      message: "The balance (150 µUSD) is below this start's floor (200 µUSD).",
      params: { balance: formatUsdFloor(150) },
    });
    expect(balanceRefusal(input({ textOnly: true }))).toBeNull();
    expect(balanceRefusal(input({ account: known(200) }))).toBeNull();
  });

  it('reads textOnly and participantSpeech as false when the input leaves them out', () => {
    expect(balanceRefusal({ ...input(), textOnly: undefined })?.code).toBe(BALANCE_BELOW_FLOOR);
    expect(balanceRefusal({ ...input({ textOnly: true }), participantSpeech: undefined })).toBeNull();
  });

  it("prices the participant's speech when the input says it speaks", () => {
    expect(balanceRefusal(input({ textOnly: true, participantSpeech: true }))?.code).toBe(BALANCE_BELOW_FLOOR);
    expect(balanceRefusal(input({ textOnly: true, participantSpeech: false }))).toBeNull();
  });

  it("is the gate's last refusal: the participant's comes first", () => {
    expect(gate(shape({ provider: leased, legs: ['participant'], pair: { source: AUTO, target: 'en' }, account: known(0) }), 'electron'))
      .toMatchObject({ code: 'participant_unsupported' });
    expect(gate(shape({ provider: leased, account: known(0) }), 'electron')).toMatchObject({ code: BALANCE_BELOW_FLOOR });
    expect(gate(shape({ provider: leased, account: { status: 'unknown' } }), 'electron')).toMatchObject({ code: QUOTA_UNKNOWN });
    expect(gate(shape({ provider: leased }), 'electron')).toBeNull();
  });
});

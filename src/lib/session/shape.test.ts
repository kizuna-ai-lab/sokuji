import { describe, it, expect } from 'vitest';
import { AUTO } from '../provider/languages';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { formatUsdFloor } from '../../utils/formatters';
import type { LegName } from '../conversation/types';
import type { LanguageContext } from '../provider/types';
import { balanceRefusal, BALANCE_BELOW_FLOOR, contextsFor, gate, languageContext, microphoneMissing, QUOTA_PENDING, QUOTA_UNKNOWN } from './shape';
import type { BalanceShape, RunShape } from './types';

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

  it("gives the participant the provider's own reverse where it states one (Stage 2 Palabra, ruling 9)", () => {
    // A reverse that is no plain swap: en → ja runs its participant zh → en.
    const provider = { ...fakeProvider, languages: { ...fakeProvider.languages, reverse: () => ({ source: 'zh', target: 'en' }) } };
    expect(contextsFor(shape({ provider, legs: ['speaker', 'participant'] })).participant?.direction).toEqual({ source: 'zh', target: 'en' });
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

describe('languageContext (Stage 2 Volcengine AST2, choice 1)', () => {
  const off = { textOnly: false, participantSpeech: false };

  it("speaks when any leg it opens speaks, by contextsFor's own rule", () => {
    expect(languageContext(fakeProvider, ['speaker'], off)).toEqual({ speech: true });
    expect(languageContext(fakeProvider, ['speaker'], { ...off, textOnly: true })).toEqual({ speech: false });
    expect(languageContext(fakeProvider, ['participant'], off)).toEqual({ speech: false });
    expect(languageContext(fakeProvider, ['participant'], { ...off, participantSpeech: true })).toEqual({ speech: true });
    expect(languageContext(fakeProvider, ['speaker', 'participant'], { textOnly: true, participantSpeech: true })).toEqual({ speech: true });
    expect(languageContext(fakeProvider, [], off)).toEqual({ speech: false });
  });

  it("follows the provider's speech and its participant flag", () => {
    expect(languageContext({ speech: 'always' }, ['speaker'], { ...off, textOnly: true })).toEqual({ speech: true });
    expect(languageContext({ speech: 'never' }, ['speaker'], off)).toEqual({ speech: false });
    expect(languageContext({ speech: 'optional', participantSpeech: false }, ['participant'], { ...off, participantSpeech: true })).toEqual({ speech: false });
  });

  it('agrees with contextsFor on every leg', () => {
    for (const textOnly of [false, true]) {
      for (const participantSpeech of [false, true]) {
        const contexts = contextsFor(shape({ legs: ['speaker', 'participant'], textOnly, participantSpeech }));
        expect(languageContext(fakeProvider, ['speaker'], { textOnly, participantSpeech }).speech).toBe(contexts.speaker?.speech);
        expect(languageContext(fakeProvider, ['participant'], { textOnly, participantSpeech }).speech).toBe(contexts.participant?.speech);
      }
    }
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

  it("reads the provider's own reverse: a pair it gives none refuses the participant leg, one it maps into the offer passes (Stage 2 Palabra, ruling 9)", () => {
    const none = { ...fakeProvider, languages: { ...fakeProvider.languages, reverse: () => null } };
    expect(gate(shape({ provider: none, legs: ['speaker', 'participant'] }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    // `en → ja` has a plain swap the fake offers; `en → en` has none, and the provider's own reverse maps it into the offer.
    const mapped = { ...fakeProvider, languages: { ...fakeProvider.languages, reverse: () => ({ source: 'zh', target: 'en' }) } };
    expect(gate(shape({ legs: ['speaker', 'participant'], pair: { source: 'en', target: 'en' } }), 'electron')).toMatchObject({ code: 'participant_unsupported' });
    expect(gate(shape({ provider: mapped, legs: ['speaker', 'participant'], pair: { source: 'en', target: 'en' } }), 'electron')).toBeNull();
  });

  it('refuses the participant leg where the platform has no participant source', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'] }), 'web')).toMatchObject({ code: 'participant_source_unavailable', leg: 'participant' });
  });

  it('lets face-to-face open the participant leg on the web: its source is silent (Review Focus 5)', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'], faceToFace: true }), 'web')).toBeNull();
    expect(gate(shape({ legs: ['speaker', 'participant'], faceToFace: false }), 'web')).toMatchObject({ code: 'participant_source_unavailable' });
  });

  it('refuses a turn mode the provider does not offer', () => {
    const manualOnly = { ...fakeProvider, turns: () => ['manual' as const] };
    expect(gate(shape({ provider: manualOnly }), 'electron')).toMatchObject({ code: 'turn_mode_unsupported', leg: 'speaker' });
    expect(gate(shape({ provider: manualOnly, turnMode: 'push-to-talk', legs: ['speaker', 'participant'] }), 'electron'))
      .toMatchObject({ code: 'turn_mode_unsupported', leg: 'participant' });
  });

  it("refuses the participant leg a pair whose reverse its own speech does not offer (Stage 2 Volcengine AST2, choice 1)", () => {
    const opt = (value: string) => ({ value });
    // Speaking offers en and ja; text also ko — Doubao AST 2.0's shape.
    const spoken = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
    const narrow = { ...fakeProvider, languages: { wire: fakeProvider.languages.wire, sources: (_s: unknown, context?: LanguageContext) => spoken(context), targets: (source: string, _s: unknown, context?: LanguageContext) => spoken(context).filter((o) => o.value !== source) } };
    const both = { provider: narrow, legs: ['speaker', 'participant'] as LegName[], pair: { source: 'en', target: 'ko' }, textOnly: true };
    expect(gate(shape({ ...both, participantSpeech: true }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(shape({ ...both, participantSpeech: false }), 'electron')).toBeNull();
    // The speaker speaks and the participant does not: the participant's own text offer holds ko,
    // though the run's, speaking because a leg does, would not.
    expect(gate(shape({ ...both, textOnly: false, participantSpeech: false }), 'electron')).toBeNull();
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

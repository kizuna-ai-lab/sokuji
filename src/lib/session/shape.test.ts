import { beforeEach, describe, it, expect } from 'vitest';
import { setUseOwnBalance } from './payerChoice';
import { AUTO } from '../provider/languages';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { formatUsdFloor } from '../../utils/formatters';
import type { LegName } from '../conversation/types';
import type { RunStage } from '../lineup/types';
import { planOf, shapeWith, stubProvider } from '../plan/testing';
import type { PlannedUnit } from '../plan/types';
import type { AnyProvider, LanguageContext } from '../provider/types';
import { balanceRefusal, BALANCE_BELOW_FLOOR, contextsFor, gate, languageContext, microphoneMissing, participantSpeechInput, planLanguages, QUOTA_PENDING, QUOTA_UNKNOWN, speakFor } from './shape';
import type { BalanceShape, RunShape } from './types';

/** A shape's fields as a test patches them: the provider it runs on alone, and that provider's settings and credentials. */
type Patch = Partial<Omit<RunShape, 'plan' | 'accounts'>> & { provider?: AnyProvider; settings?: unknown; credentials?: Record<string, string> };

const shape = ({ provider = fakeProvider, ...patch }: Patch = {}): RunShape => shapeWith(provider, {
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
    expect(gate({ plan: planOf(fakeProvider), accounts: { fake: { settings: FAKE_DEFAULTS, credentials: {} } }, pair: { source: 'en', target: 'ja' }, legs: ['participant'], turnMode: 'auto' }, 'web'))
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
  const leased = { ...fakeProvider, session: { minimumBalance: (s: BalanceShape) => 100 + (s.textOnly ? 0 : 100) + (s.participantSpeech ? 100 : 0) } } as unknown as AnyProvider;
  const known = (balanceMicroUsd: number, frozen = false) => ({ status: 'known' as const, balanceMicroUsd, frozen });
  const input = ({ provider = leased, ...patch }: Patch = {}) => ({ plan: planOf(provider), accounts: { [provider.id]: { settings: FAKE_DEFAULTS, credentials: {} } }, legs: ['speaker'] as const, textOnly: false, participantSpeech: false, account: known(150), ...patch });

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

  describe('a member pays from the wallet the switch chooses', () => {
    const memberAccount = (org: { availableMicroUsd: number; frozen?: boolean }, personal: { balanceMicroUsd: number; frozen?: boolean }) => ({
      status: 'known' as const,
      balanceMicroUsd: org.availableMicroUsd,
      frozen: org.frozen ?? false,
      organization: { name: 'Acme', availableMicroUsd: org.availableMicroUsd, frozen: org.frozen ?? false },
      personal: { balanceMicroUsd: personal.balanceMicroUsd, frozen: personal.frozen ?? false },
    });
    beforeEach(() => localStorage.clear());

    it('reads the organization below the floor with the switch off, and the personal wallet with it on: organization 0, personal 5 USD', () => {
      const account = memberAccount({ availableMicroUsd: 0 }, { balanceMicroUsd: 5_000_000 });
      expect(balanceRefusal(input({ account, payer: 'organization' }))?.code).toBe('org_insufficient_balance');
      expect(balanceRefusal(input({ account, payer: 'personal' }))).toBeNull();
    });

    it('does not refuse an organization payer below the floor at Start: the server tells held money from an empty organization', () => {
      const account = memberAccount({ availableMicroUsd: 0 }, { balanceMicroUsd: 5_000_000 });
      expect(gate(shape({ provider: leased, account, payer: 'organization' }), 'electron')).toBeNull();
    });

    it('leaves a personal payer with no known personal wallet to the server: no balance is invented', () => {
      const account = { ...memberAccount({ availableMicroUsd: 9_000_000 }, { balanceMicroUsd: 0 }), personal: undefined };
      expect(balanceRefusal(input({ account, payer: 'personal' }))).toBeNull();
      expect(gate(shape({ provider: leased, account, payer: 'personal' }), 'electron')).toBeNull();
    });

    it('still refuses a frozen organization at Start, and a personal payer below the floor before any request', () => {
      const frozen = memberAccount({ availableMicroUsd: 0, frozen: true }, { balanceMicroUsd: 5_000_000 });
      expect(gate(shape({ provider: leased, account: frozen, payer: 'organization' }), 'electron')).toMatchObject({ code: 'org_wallet_frozen' });
      const poor = memberAccount({ availableMicroUsd: 9_000_000 }, { balanceMicroUsd: 0 });
      expect(gate(shape({ provider: leased, account: poor, payer: 'personal' }), 'electron')).toMatchObject({ code: BALANCE_BELOW_FLOOR });
    });

    it('names the organization and the role in an organization refusal, and keeps the personal wording for the personal wallet', () => {
      const account = { ...memberAccount({ availableMicroUsd: 0 }, { balanceMicroUsd: 0 }), organization: { name: 'Acme', availableMicroUsd: 0, frozen: false, role: 'owner' as const } };
      expect(balanceRefusal(input({ account, payer: 'organization' }))).toMatchObject({ code: 'org_insufficient_balance', params: { organization: 'Acme', role: 'owner' } });
      expect(balanceRefusal(input({ account, payer: 'personal' }))?.code).toBe(BALANCE_BELOW_FLOOR);
    });

    it('refuses a frozen organization with the switch off: wallet_frozen', () => {
      const account = memberAccount({ availableMicroUsd: 10_000, frozen: true }, { balanceMicroUsd: 5_000_000 });
      expect(balanceRefusal(input({ account, payer: 'organization' }))).toMatchObject({ code: 'org_wallet_frozen', params: { organization: 'Acme' } });
      expect(balanceRefusal(input({ account, payer: 'personal' }))).toBeNull();
    });

    it('keeps the organization code when the name is empty: the code follows the payer, the params the name', () => {
      const base = memberAccount({ availableMicroUsd: 0 }, { balanceMicroUsd: 5_000_000 });
      const account = { ...base, organization: { name: '', availableMicroUsd: 0, frozen: false, role: 'owner' as const } };
      const refusal = balanceRefusal(input({ account, payer: 'organization' }));
      expect(refusal?.code).toBe('org_insufficient_balance');
      expect(refusal?.params).not.toHaveProperty('organization');
      const frozen = { ...base, organization: { name: '', availableMicroUsd: 0, frozen: true } };
      expect(balanceRefusal(input({ account: frozen, payer: 'organization' }))?.code).toBe('org_wallet_frozen');
    });

    it('refuses a frozen personal wallet only with the switch on', () => {
      const account = memberAccount({ availableMicroUsd: 10_000 }, { balanceMicroUsd: 5_000_000, frozen: true });
      expect(balanceRefusal(input({ account, payer: 'organization' }))).toBeNull();
      expect(balanceRefusal(input({ account, payer: 'personal' }))?.code).toBe('wallet_frozen');
    });

    it("reads the shape's payer, not the live switch: a run's later steps do not follow the stores", () => {
      const account = memberAccount({ availableMicroUsd: 0 }, { balanceMicroUsd: 5_000_000 });
      setUseOwnBalance(true);
      expect(gate(shape({ provider: leased, account, payer: 'organization' }), 'electron')).toBeNull();
      setUseOwnBalance(false);
      expect(gate(shape({ provider: leased, account, payer: 'personal' }), 'electron')).toBeNull();
      const poor = memberAccount({ availableMicroUsd: 5_000_000 }, { balanceMicroUsd: 0 });
      expect(gate(shape({ provider: leased, account: poor, payer: 'personal' }), 'electron')).toMatchObject({ code: BALANCE_BELOW_FLOOR });
    });
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

describe('speakFor — who hears what (spec 2026-10-10 §4)', () => {
  const optional = { speech: 'optional' as const };
  const base = { textOnly: false, participantSpeech: null, isMonitorMuted: false, legs: ['speaker'] as const, faceToFace: false, heard: true };

  it('Translation the other side hears is Text Only inverted, unless the provider always or never speaks', () => {
    expect(speakFor(optional, base).other).toBe(true);
    expect(speakFor(optional, { ...base, textOnly: true }).other).toBe(false);
    expect(speakFor({ speech: 'always' }, { ...base, textOnly: true }).other).toBe(true);
    expect(speakFor({ speech: 'never' }, base).other).toBe(false);
  });

  it('Translation I hear on auto: on in face-to-face, off in a meeting (ruling 1)', () => {
    expect(speakFor(optional, { ...base, faceToFace: true }).them).toBe(true);
    expect(speakFor(optional, base).them).toBe(false);
    expect(speakFor(optional, { ...base, participantSpeech: true }).them).toBe(true);
    expect(speakFor(optional, { ...base, faceToFace: true, participantSpeech: false }).them).toBe(false);
  });

  it("an always-speaking provider is still not recaptured: the gate is outside its policy", () => {
    const always = { speech: 'always' as const, participantSpeech: true };
    const both = { ...base, legs: ['speaker', 'participant'] as const };
    expect(speakFor(always, { ...both, heard: false })).toMatchObject({ other: true, them: false });
    expect(speakFor(always, { ...both, heard: true }).them).toBe(true);
  });

  it("a whole-system source keeps them off whatever the switch says (Review Focus 4)", () => {
    expect(speakFor(optional, { ...base, participantSpeech: true, heard: false }).them).toBe(false);
  });

  it("them follows the provider's participant flag and its speech", () => {
    expect(speakFor({ speech: 'optional', participantSpeech: false }, { ...base, participantSpeech: true }).them).toBe(false);
    expect(speakFor({ speech: 'always' }, base).them).toBe(true);
    expect(speakFor({ speech: 'never' }, { ...base, participantSpeech: true }).them).toBe(false);
  });

  it('I hear it too needs the monitor on and Translation the other side hears on, and is never face-to-face', () => {
    expect(speakFor(optional, base).me).toBe(true);
    expect(speakFor(optional, { ...base, isMonitorMuted: true }).me).toBe(false);
    expect(speakFor(optional, { ...base, textOnly: true }).me).toBe(false);
    expect(speakFor(optional, { ...base, faceToFace: true }).me).toBe(false);
  });

  it('I hear it too in Both is blocked by a source that would recapture it (D12)', () => {
    const both = ['speaker', 'participant'] as const;
    expect(speakFor(optional, { ...base, legs: both, heard: true }).me).toBe(true);
    expect(speakFor(optional, { ...base, legs: both, heard: false }).me).toBe(false);
    // In Me mode the participant source is not captured at all.
    expect(speakFor(optional, { ...base, legs: ['speaker'], heard: false }).me).toBe(true);
  });

  it('participantSpeechInput is the switch resolved and the recapture rule, without the provider', () => {
    expect(participantSpeechInput({ participantSpeech: null, faceToFace: true, heard: true })).toBe(true);
    expect(participantSpeechInput({ participantSpeech: null, faceToFace: false, heard: true })).toBe(false);
    expect(participantSpeechInput({ participantSpeech: true, faceToFace: false, heard: false })).toBe(false);
  });
});

// Task B1's table, over a plan built by hand (`compose` makes none in step 1): transcription on one provider,
// translation on a second, speech on a third. Each question is asked of the unit that answers it.
describe('a plan of several units: each question asked of the unit that answers it', () => {
  const opt = (value: string) => ({ value });
  const languages = (sources: string[], targets: string[]) => ({ wire: fakeProvider.languages.wire, sources: () => sources.map(opt), targets: () => targets.map(opt) });
  const floor = (microUsd: number) => ({ minimumBalance: () => microUsd });
  const heard = stubProvider('heard', { turns: () => ['auto'], languages: languages(['en', 'ja'], []), session: floor(100) });
  const voice = stubProvider('voice', { speech: 'never', session: floor(300) });
  const planned = (p: AnyProvider, stage: RunStage): PlannedUnit => ({ ...planOf(p).units[0], stages: [stage] });
  /** The shape over the three providers, translating into `targets`. */
  const several = (targets: string[], patch: Patch = {}): RunShape => {
    const translated = stubProvider('translated', { languages: languages([], targets) });
    const [a, b, c] = [planned(heard, 'transcription'), planned(translated, 'translation'), planned(voice, 'speech')];
    const accounts = Object.fromEntries([heard, translated, voice].map((p) => [p.id, { settings: undefined, credentials: {} }]));
    return { ...shape(patch), plan: { units: [a, b, c], byStage: { transcription: a, translation: b, speech: c } }, accounts };
  };

  it('asks the speech unit whether a leg speaks', () => {
    expect(contextsFor(several(['en'])).speaker?.speech).toBe(false);
  });

  it('asks the transcription unit for its turns, and names its provider', () => {
    expect(gate(several(['en'], { turnMode: 'push-to-talk' }), 'electron'))
      .toMatchObject({ code: 'turn_mode_unsupported', leg: 'speaker', message: 'heard does not offer manual turns with these settings.' });
  });

  it("reverses the pair in the transcription provider's sources and the translation provider's targets", () => {
    // The translation provider's targets refuse it: only the code and the leg are pinned, the words name the transcription provider.
    expect(gate(several(['ja'], { legs: ['speaker', 'participant'] }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(several(['en'], { legs: ['speaker', 'participant'] }), 'electron')).toBeNull();
  });

  // Each list is asked whether its own provider speaks: a provider read by another one's voice is asked its text
  // offer, though the leg is read aloud.
  describe('a provider whose lists are narrower when it speaks (the shape of Doubao AST 2.0)', () => {
    // Speaking offers en and ja; text also ko.
    const offer = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
    const asked: (LanguageContext | undefined)[] = [];
    const narrow = stubProvider('narrow', {
      speech: 'optional',
      languages: {
        wire: fakeProvider.languages.wire,
        sources: (_s: unknown, context?: LanguageContext) => { asked.push(context); return offer(context); },
        targets: (source: string, _s: unknown, context?: LanguageContext) => { asked.push(context); return offer(context).filter((o) => o.value !== source); },
      },
    });
    const reader = stubProvider('reader', { speech: 'optional' });
    // Both legs read aloud, into a pair whose reverse (ko → en) only the text offer holds.
    const run: Patch = { legs: ['speaker', 'participant'], pair: { source: 'en', target: 'ko' }, participantSpeech: true };
    /** `narrow` transcribes and translates; `voice` reads. */
    const readBy = (voice: AnyProvider): RunShape => {
      const text: PlannedUnit = { ...planOf(narrow).units[0], stages: ['transcription', 'translation'] };
      const speech = planned(voice, 'speech');
      const accounts = Object.fromEntries([narrow, voice].map((p) => [p.id, { settings: undefined, credentials: {} }]));
      return { ...shape(run), plan: { units: [text, speech], byStage: { transcription: text, translation: text, speech } }, accounts };
    };
    beforeEach(() => { asked.length = 0; });

    it("read by another provider's voice, it is asked its text offer: the reversed pair that offer holds is accepted", () => {
      const mixed = readBy(reader);
      expect(contextsFor(mixed).participant).toMatchObject({ direction: { source: 'ko', target: 'en' }, speech: true });
      expect(gate(mixed, 'electron')).toBeNull();
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((context) => context?.speech === false)).toBe(true);
    });

    it('serving all three stages, it is asked as before: the reversed pair its speaking offer lacks is refused', () => {
      expect(gate(shape({ ...run, provider: narrow }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
      expect(asked.some((context) => context?.speech === true)).toBe(true);
      // And a leg that is not read aloud is asked the text offer, on one provider as on two.
      expect(gate(shape({ ...run, provider: narrow, participantSpeech: false, textOnly: true }), 'electron')).toBeNull();
    });

    it('the plan\'s lists tell each provider whether it is the one that speaks, and pass no context on as none', () => {
      const mixed = planLanguages(readBy(reader)).languages;
      expect(mixed.sources(undefined, { speech: true }).map((o) => o.value)).toEqual(['en', 'ja', 'ko']);
      expect(mixed.targets('en', undefined, { speech: true }).map((o) => o.value)).toEqual(['ja', 'ko']);
      const alone = planLanguages(shape({ provider: narrow })).languages;
      expect(alone.sources(undefined, { speech: true }).map((o) => o.value)).toEqual(['en', 'ja']);
      expect(alone.targets('en', undefined, { speech: true }).map((o) => o.value)).toEqual(['ja']);
      expect(alone.sources(undefined, { speech: false }).map((o) => o.value)).toEqual(['en', 'ja', 'ko']);
      asked.length = 0;
      mixed.sources(undefined);
      alone.sources(undefined);
      expect(asked).toEqual([undefined, undefined]);
    });
  });

  describe('a voice that says which languages it speaks', () => {
    /** The plan of `several`, its speech unit speaking English only, under an optional-speech provider. */
    const withVoice = (patch: Patch = {}): RunShape => {
      const base = several(['en', 'ja'], patch);
      const speaker = stubProvider('speaker_only_english', { speech: 'optional' });
      const [whole] = planOf(speaker).units;
      const speech: PlannedUnit = { ...whole, unit: { ...whole.unit, capabilities: (s) => ({ ...whole.unit.capabilities(s), speaks: (language) => language === 'en' }) }, stages: ['speech'] };
      const [a, b] = base.plan.units;
      return { ...base, plan: { units: [a, b, speech], byStage: { transcription: a, translation: b, speech } }, accounts: { ...base.accounts, [speaker.id]: { settings: undefined, credentials: {} } } };
    };

    it('refuses a start whose speaker leg is read in a language the voice lacks, and names the option of the line-up', () => {
      expect(gate(withVoice({ pair: { source: 'en', target: 'ja' }, lineUp: { transcription: 'heard', translation: 'translated', speech: 'edge' } }), 'electron'))
        .toEqual({ code: 'lineup_language_not_spoken', message: 'edge has no voice for ja.', params: { stage: 'speech', provider: 'edge', language: 'ja' } });
    });
    it('starts when the leg is read in a language the voice has', () => {
      expect(gate(withVoice({ pair: { source: 'ja', target: 'en' } }), 'electron')).toBeNull();
    });
    it('starts a text-only session in any language: no leg is read aloud', () => {
      expect(gate(withVoice({ pair: { source: 'en', target: 'ja' }, textOnly: true }), 'electron')).toBeNull();
    });
    it("judges the participant leg by its own target, only when the other side's translation is spoken", () => {
      const both = { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] as LegName[] };
      expect(gate(withVoice({ ...both, participantSpeech: true }), 'electron')).toMatchObject({ code: 'lineup_language_not_spoken', params: { language: 'ja' } });
      expect(gate(withVoice({ ...both, participantSpeech: false }), 'electron')).toBeNull();
    });
    it('is said before the balance, and after the turns', () => {
      const low = { account: { status: 'known' as const, balanceMicroUsd: 0, frozen: false } };
      expect(gate(withVoice({ pair: { source: 'en', target: 'ja' }, ...low }), 'electron')).toMatchObject({ code: 'lineup_language_not_spoken' });
      expect(gate(withVoice({ pair: { source: 'en', target: 'ja' }, turnMode: 'push-to-talk' }), 'electron')).toMatchObject({ code: 'turn_mode_unsupported' });
    });
  });

  it("takes the highest floor among the plan's providers", () => {
    const below = balanceRefusal({ ...several(['en']), account: { status: 'known', balanceMicroUsd: 200, frozen: false } });
    expect(below).toMatchObject({ code: BALANCE_BELOW_FLOOR, message: "The balance (200 µUSD) is below this start's floor (300 µUSD)." });
  });
});

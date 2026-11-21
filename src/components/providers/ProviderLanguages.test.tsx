import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PIN_SEPARATOR } from '../../lib/language/order';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { LanguageContext } from '../../lib/provider/types';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
// What a run froze at Start: null while idle.
const run = vi.hoisted(() => ({ participantSpeech: null as boolean | null }));
vi.mock('../../app/useRun', () => ({ useRunParticipantSpeech: () => run.participantSpeech }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});
// A test's own provider, offered beside this build's, so the plan can run it.
const present = vi.hoisted(() => ({ extra: [] as unknown[] }));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => [...actual.presentProviders(), ...present.extra] };
});

import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { sonioxProvider } from '../../providers/soniox/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { ProviderLanguages } from './ProviderLanguages';

beforeEach(() => {
  trackEvent.mockClear();
  run.participantSpeech = null;
  present.extra = [];
  useLineUpStore.setState({ lineUp: null, stored: false });
  runsOn('fake');
  useProviderStore.setState({
    entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } },
    readiness: {},
    intent: { source: 'auto', target: 'en' },
  });
});

describe('ProviderLanguages', () => {
  it('changes the source language: setPair, and one language_changed for that side', () => {
    render(<ProviderLanguages providers={[fakeProvider]} />);
    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
    expect(trackEvent).toHaveBeenCalledWith('language_changed', { to_language: 'ja', language_type: 'source' });
    expect(trackEvent).not.toHaveBeenCalledWith('language_changed', expect.objectContaining({ language_type: 'target' }));
    expect(useProviderStore.getState().entries.fake?.pair).toEqual({ source: 'ja', target: 'en' });
  });

  it('changes the target language: setPair, and one language_changed for that side', () => {
    render(<ProviderLanguages providers={[fakeProvider]} />);
    fireEvent.change(screen.getByLabelText('settings.targetLanguage'), { target: { value: 'zh' } });
    expect(trackEvent).toHaveBeenCalledWith('language_changed', { to_language: 'zh', language_type: 'target' });
    expect(trackEvent).not.toHaveBeenCalledWith('language_changed', expect.objectContaining({ language_type: 'source' }));
    expect(useProviderStore.getState().entries.fake?.pair).toEqual({ source: 'auto', target: 'zh' });
  });

  it('a swap sends language_changed for both sides', () => {
    useProviderStore.setState((st) => ({ entries: { ...st.entries, fake: { ...st.entries.fake, pair: { source: 'en', target: 'ja' } } } }));
    render(<ProviderLanguages providers={[fakeProvider]} />);
    fireEvent.click(screen.getByTitle('simpleConfig.swapLanguages'));
    expect(trackEvent).toHaveBeenCalledWith('language_changed', { to_language: 'ja', language_type: 'source' });
    expect(trackEvent).toHaveBeenCalledWith('language_changed', { to_language: 'en', language_type: 'target' });
  });

  it('disables both selects and the swap', () => {
    useProviderStore.setState((st) => ({ entries: { ...st.entries, fake: { ...st.entries.fake, pair: { source: 'en', target: 'ja' } } } }));
    render(<ProviderLanguages providers={[fakeProvider]} disabled />);
    expect(screen.getByLabelText('settings.sourceLanguage')).toBeDisabled();
    expect(screen.getByLabelText('settings.targetLanguage')).toBeDisabled();
    expect(screen.getByTitle('simpleConfig.swapLanguages')).toBeDisabled();
  });
});

describe('ProviderLanguages — the language context (Stage 2 Volcengine AST2, choice 1)', () => {
  const opt = (value: string) => ({ value, name: value, englishName: value });
  const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
  const moody = {
    ...fakeProvider,
    id: 'moody',
    speech: 'optional',
    languages: {
      sources: (_s: unknown, context?: LanguageContext) => offered(context),
      targets: (source: string, _s: unknown, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
    },
  } as unknown as typeof fakeProvider;
  // The codes on offer: display order, pinned copies and the separator are not what this pins.
  const sources = () => [...new Set([...(screen.getByLabelText('settings.sourceLanguage') as HTMLSelectElement).options].map((o) => o.value).filter((v) => v !== PIN_SEPARATOR))].sort();

  it("offers the languages of the store's context: its legs, and whether they speak", () => {
    present.extra = [moody];
    runsOn('moody');
    useProviderStore.setState({
      entries: { moody: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      legs: ['speaker'],
      speech: { textOnly: false, participantSpeech: false },
    });
    render(<ProviderLanguages providers={[moody]} />);
    expect(sources()).toEqual(['en', 'ja']);
    act(() => { useProviderStore.setState({ speech: { textOnly: true, participantSpeech: false } }); });
    expect(sources()).toEqual(['en', 'ja', 'ko']);
    act(() => { useProviderStore.setState({ legs: ['speaker', 'participant'], speech: { textOnly: true, participantSpeech: true } }); });
    expect(sources()).toEqual(['en', 'ja']);
  });

  describe('with a sentence', () => {
    beforeEach(() => {
      useAudioStore.setState({ mode: 'participant' });
    });

    it("says I hear while the other side's translation is read to me, and I read when it is not", () => {
      useRoutingStore.setState({ participantSpeech: true });
      render(<ProviderLanguages providers={[fakeProvider]} sentence={{ mode: 'participant', textOnly: false }} />);
      expect(screen.getByText('settings.langSentence.iHear')).toBeTruthy();
      act(() => useRoutingStore.setState({ participantSpeech: false }));
      expect(screen.getByText('settings.langSentence.iRead')).toBeTruthy();
    });

    it('follows what a running session froze at Start over the stores', () => {
      useRoutingStore.setState({ participantSpeech: true });
      run.participantSpeech = false;
      render(<ProviderLanguages providers={[fakeProvider]} sentence={{ mode: 'participant', textOnly: false }} />);
      expect(screen.getByText('settings.langSentence.iRead')).toBeTruthy();
    });

    it('in a run that speaks the other side, follows Translation I hear live (#595)', () => {
      useRoutingStore.setState({ participantSpeech: true });
      run.participantSpeech = true;
      render(<ProviderLanguages providers={[fakeProvider]} sentence={{ mode: 'participant', textOnly: false }} />);
      expect(screen.getByText('settings.langSentence.iHear')).toBeTruthy();
      act(() => useRoutingStore.setState({ participantSpeech: false }));
      expect(screen.getByText('settings.langSentence.iRead')).toBeTruthy();
    });
  });
});

// A voice of its own beside another provider's text: the targets on offer are the ones that voice reads, on a leg
// that is read aloud. Edge has no Basque voice; Soniox translates into Basque.
describe("ProviderLanguages — another provider's voice", () => {
  const targets = () => [...new Set([...(screen.getByLabelText('settings.targetLanguage') as HTMLSelectElement).options].map((o) => o.value).filter((v) => v !== PIN_SEPARATOR))];
  const given = (speech: string, target = 'ja') => {
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech, summarisation: null }, stored: true });
    const pair = { source: 'en', target };
    useProviderStore.setState({
      entries: {
        soniox: { settings: sonioxProvider.settings.defaults, credentials: { apiKey: 'k' }, pair },
        local_inference: { settings: localInferenceProvider.settings.defaults, credentials: {}, pair },
      },
      intent: pair,
      legs: ['speaker'],
      speech: { textOnly: false, participantSpeech: false },
    });
  };

  it("Soniox read by Edge: a language Edge has no voice for is not offered while my leg is read aloud, and is when it is not", () => {
    given('edge');
    render(<ProviderLanguages providers={[sonioxProvider, localInferenceProvider]} />);
    expect(targets()).toContain('ja');
    expect(targets()).not.toContain('eu');
    act(() => { useProviderStore.setState({ speech: { textOnly: true, participantSpeech: false } }); });
    expect(targets()).toContain('eu');
  });

  it('a pair into a language the voice does not read is kept: shown unchosen, nothing written', () => {
    given('edge', 'eu');
    render(<ProviderLanguages providers={[sonioxProvider, localInferenceProvider]} />);
    const select = screen.getByLabelText('settings.targetLanguage') as HTMLSelectElement;
    expect(select).toHaveValue('eu');
    expect([...select.options].filter((o) => o.value === 'eu').map((o) => o.disabled)).toEqual([true]);
    expect(useProviderStore.getState().entries.soniox?.pair).toEqual({ source: 'en', target: 'eu' });
    expect(useProviderStore.getState().intent).toEqual({ source: 'en', target: 'eu' });
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('a text provider whose lists are narrower when it speaks is asked its text offer while another voice reads, and its speaking offer when it reads itself', () => {
    // Soniox made to offer no Korean when it speaks: the shape of a provider whose voice has fewer languages.
    const { sources: everySource, targets: everyTarget } = sonioxProvider.languages;
    const narrowed = <O extends { value: string }>(list: readonly O[], context?: LanguageContext) => (context?.speech ? list.filter((o) => o.value !== 'ko') : list);
    const sources = vi.spyOn(sonioxProvider.languages, 'sources').mockImplementation((s, context) => narrowed(everySource(s, context), context));
    const spied = vi.spyOn(sonioxProvider.languages, 'targets').mockImplementation((source, s, context) => narrowed(everyTarget(source, s, context), context));
    const sourceCodes = () => [...(screen.getByLabelText('settings.sourceLanguage') as HTMLSelectElement).options].map((o) => o.value);
    try {
      // Read by Edge, which has Korean voices: my leg is read aloud, and Soniox is asked what it offers as text.
      given('edge');
      const mixed = render(<ProviderLanguages providers={[sonioxProvider, localInferenceProvider]} />);
      expect(targets()).toContain('ko');
      expect(sourceCodes()).toContain('ko');
      mixed.unmount();
      // Reading its own translation: its speaking offer, as before.
      given('soniox');
      render(<ProviderLanguages providers={[sonioxProvider, localInferenceProvider]} />);
      expect(targets()).not.toContain('ko');
      expect(sourceCodes()).not.toContain('ko');
      expect(targets()).toContain('ja');
    } finally {
      sources.mockRestore();
      spied.mockRestore();
    }
  });

  it("Soniox on every stage: its own voice reads every language it translates into, so the list is its own", () => {
    given('soniox');
    render(<ProviderLanguages providers={[sonioxProvider, localInferenceProvider]} />);
    const offered = sonioxProvider.languages.targets('en', sonioxProvider.settings.defaults).map((o) => o.value);
    expect(targets().sort()).toEqual([...offered].sort());
    expect(offered).toContain('eu');
  });
});

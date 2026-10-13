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

import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { ProviderLanguages } from './ProviderLanguages';

beforeEach(() => {
  trackEvent.mockClear();
  run.participantSpeech = null;
  useProviderStore.setState({
    entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } },
    readiness: {},
    selected: 'fake',
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
    useProviderStore.setState({
      entries: { moody: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      selected: 'moody',
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
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';
import { ProviderLanguages } from './ProviderLanguages';

beforeEach(() => {
  trackEvent.mockClear();
  useProviderStore.setState({
    entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } },
    readiness: {},
    selected: 'fake',
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

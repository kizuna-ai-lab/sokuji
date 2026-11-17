// Over a service's limit and a model that cannot use the word list, said on the line-up (the session's make-up).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => false }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: () => <div id="languages-section" /> }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: () => <div id="turn-detection-section" /> }));
vi.mock('./EdgeVoices', () => ({ EdgeVoices: () => <div id="edge-voices-section" /> }));
vi.mock('./LocalVoices', () => ({ LocalVoices: () => <div id="local-voices-section" /> }));
vi.mock('../providers/ProviderOwnSettings', () => ({
  ProviderEngine: () => <div id="model-management-section" />,
  ProviderOwnSettings: () => <div id="provider-own-settings" />,
  ProviderTurnDetectionControls: () => <div id="turn-detection-tuning-section" />,
}));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: true, getToken: async () => null }) }));
vi.mock('../../lib/notes/notesPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notes/notesPricing')>()),
  useNotesPricing: () => null,
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: () => undefined }) }));

import i18n, { changeLanguageWithLoad } from '../../locales';
import { LineUpCategory } from './LineUpCategory';
import { useWordList } from '../../lib/words/list';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';

const all = (id: string) => ({ transcription: id, translation: id, speech: id, summarisation: null });
const words = (n: number) => Array.from({ length: n }, (_, i) => ({ written: `w${i}` }));

beforeEach(() => {
  useProviderStore.setState({ selected: 'soniox', selectionLocked: false, entries: {}, readiness: {} });
  useSettingsStore.setState({ settingsNavigationTarget: null });
});
afterEach(async () => {
  cleanup();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('over-limit and not-used hints', () => {
  it('says how many entries Doubao leaves out once the list is over its 1,000', () => {
    // Written forms only: one hot word each, so 1,000 entries fit and 1,005 leave 5 out.
    useWordList.setState({ entries: words(1005), background: '', loaded: true });
    useLineUpStore.setState({ lineUp: all('volcengine_ast2'), stored: true });
    const { unmount } = render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Word list: 5 entries over this service’s limit are left out.')).toHaveLength(1);
    unmount();
    useWordList.setState({ entries: words(1000), background: '', loaded: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  it('says it in Chinese: over the limit, and a Gemini model that cannot use it', async () => {
    await act(async () => { await changeLanguageWithLoad('zh_CN'); });
    useWordList.setState({ entries: words(1005), background: '', loaded: true });
    useLineUpStore.setState({ lineUp: all('volcengine_ast2'), stored: true });
    const doubao = render(<LineUpCategory locked={false} />);
    expect(screen.getByText('词表：超出这个服务上限的 5 条没有发送。')).toBeInTheDocument();
    doubao.unmount();

    useWordList.setState({ entries: words(3), background: '', loaded: true });
    useLineUpStore.setState({ lineUp: all('gemini'), stored: true });
    useProviderStore.setState({
      entries: { gemini: { settings: { model: 'gemini-3.1-flash-live-preview' }, credentials: { apiKey: 'k' }, pair: { source: 'ja', target: 'en' } } } as never,
    });
    render(<LineUpCategory locked={false} />);
    expect(screen.getByText('词表：这个型号用不上。')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../Display/DisplaySettingsPopover', () => ({
  default: ({ source, readingTargets, layout }: { source: string; readingTargets?: ReadonlySet<string>; layout?: string }) => <div data-testid={`popover-${source}`} data-layout={layout} data-readings={[...(readingTargets ?? [])].join(',')} />,
}));
vi.mock('../../utils/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/environment')>()), isElectron: () => true }));
vi.mock('../../lib/reading/useReadingTargets', () => ({ useReadingTargets: () => new Set(['ja']) }));
// Readings as the rows get them, marked with the language that asked, so a test can tell which text has them.
vi.mock('../../lib/reading/useReading', () => ({
  useReading: (text: string, lang: string | null) => (lang ? [{ text, reading: `(${lang})` }] : null),
}));

import { DisplayCategory } from './DisplayCategory';
import { CONVERSATION_SCHEME_COLOURS, useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useSubtitleStore } from '../../stores/subtitleStore';
import useSettingsStore from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';

beforeEach(() => {
  useConversationDisplayStore.setState({ fontSize: 14, compactMode: false });
  useSubtitleStore.setState({ fontSize: 24, compactMode: false });
});
afterEach(() => cleanup());

const preview = () => screen.getByTestId('display-preview');

describe('display with a preview', () => {
  it('changes the preview as a value changes', async () => {
    render(<DisplayCategory locked={false} />);
    expect(preview()).toHaveAttribute('data-font-size', '14');
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    await waitFor(() => expect(useConversationDisplayStore.getState().fontSize).toBe(16));
    expect(preview()).toHaveAttribute('data-font-size', '16');
  });

  it('keeps the two surfaces apart', async () => {
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(preview()).toHaveAttribute('data-font-size', '24');
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    await waitFor(() => expect(useSubtitleStore.getState().fontSize).toBe(26));
    expect(useConversationDisplayStore.getState().fontSize).toBe(14);
  });

  it("shows caption mode's own controls only there", () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByTestId('popover-conversation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByTestId('popover-subtitle')).toBeInTheDocument();
    expect(screen.queryByTestId('popover-conversation')).toBeNull();
  });
});

describe('display — readings', () => {
  it("offers the readings switch for the main window, and for caption mode on the desktop unless it is compact", () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByTestId('popover-conversation')).toHaveAttribute('data-readings', 'ja');
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByTestId('popover-subtitle')).toHaveAttribute('data-readings', 'ja');
    useSubtitleStore.setState({ compactMode: true });
    cleanup();
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByTestId('popover-subtitle')).toHaveAttribute('data-readings', '');
  });
});

// PR review: the preview draws what the conversation draws, unset text colours resolved against the background.
describe('display — the preview colours', () => {
  it('resolves unset text colours against a custom background, as the conversation does', () => {
    useConversationDisplayStore.setState({ bgColor: '#000000', sourceTextColor: null, translationTextColor: null } as never);
    try {
      render(<DisplayCategory locked={false} />);
      const drawn = preview().querySelector<HTMLElement>('.display-preview__surface')!.style.getPropertyValue('--conversation-source-color');
      expect(drawn).toBe(CONVERSATION_SCHEME_COLOURS.dark.sourceTextColor);
    } finally {
      useConversationDisplayStore.setState({ bgColor: null } as never);
    }
  });

  it('moves between the two displays with the arrow keys, as a radio group does', () => {
    render(<DisplayCategory locked={false} />);
    const main = screen.getByRole('radio', { name: 'Main window' });
    main.focus();
    fireEvent.keyDown(main, { key: 'ArrowRight' });
    const caption = screen.getByRole('radio', { name: 'Caption mode' });
    expect(caption).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(caption);
    fireEvent.keyDown(caption, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Main window' })).toHaveAttribute('aria-checked', 'true');
  });
});

// The mock's display page (v18): compact segmented choices, a switch, the colour rows inline, and a preview drawn as the conversation draws.
describe('display — the rows as the mock draws them', () => {
  beforeEach(() => {
    useSettingsStore.setState({ speakerDisplayMode: 'both', participantDisplayMode: 'both' } as never);
    useSubtitleStore.setState({ speakerDisplayMode: 'both', participantDisplayMode: 'both', newItemHighlightEnabled: true } as never);
  });

  it("offers each side's four choices side by side, in the mock's order", () => {
    render(<DisplayCategory locked={false} />);
    const mine = screen.getByRole('group', { name: 'What my side shows' });
    const choices = [...mine.querySelectorAll('button')];
    expect(choices.map((b) => b.textContent)).toEqual(['Original and translation', 'Translation only', 'Original only', 'Nothing']);
    expect(choices[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(choices[1]);
    expect(useSettingsStore.getState().speakerDisplayMode).toBe('translation');
    expect(screen.getByRole('group', { name: 'What the other side shows' })).toBeInTheDocument();
  });

  it('makes compact view a switch', async () => {
    render(<DisplayCategory locked={false} />);
    const compact = screen.getByRole('switch', { name: 'Compact view' });
    expect(compact).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(compact);
    await waitFor(() => expect(useConversationDisplayStore.getState().compactMode).toBe(true));
  });

  it('draws the text size buttons as A− and A+', () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByRole('button', { name: 'Smaller text' })).toHaveTextContent('A−');
    expect(screen.getByRole('button', { name: 'Larger text' })).toHaveTextContent('A+');
  });

  it('asks the colour rows for the page layout', () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByTestId('popover-conversation')).toHaveAttribute('data-layout', 'page');
  });

  it("names the preview and draws it with the conversation's own rows", () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByText('Preview: the conversation in the main window')).toBeInTheDocument();
    const rows = preview().querySelectorAll('.conversation-row');
    expect(rows.length).toBe(3);
    expect(preview().querySelectorAll('.row-header').length).toBe(3);
    expect(preview().querySelectorAll('.lang-badge').length).toBe(6);
  });

  it('drops the headers and the badges in compact view, as the conversation does', () => {
    useConversationDisplayStore.setState({ compactMode: true });
    render(<DisplayCategory locked={false} />);
    expect(preview().querySelectorAll('.row-header').length).toBe(0);
    expect(preview().querySelectorAll('.lang-badge').length).toBe(0);
    expect(preview().querySelectorAll('.row-role-dot').length).toBe(3);
  });

  it("follows each side's choice in the preview, and says so when nothing is left", () => {
    useSettingsStore.setState({ speakerDisplayMode: 'translation', participantDisplayMode: 'none' } as never);
    render(<DisplayCategory locked={false} />);
    expect(preview().querySelectorAll('.conversation-row').length).toBe(2);
    expect(preview().querySelectorAll('.row-text.src').length).toBe(0);
    cleanup();
    useSettingsStore.setState({ speakerDisplayMode: 'none', participantDisplayMode: 'none' } as never);
    render(<DisplayCategory locked={false} />);
    expect(preview()).toHaveTextContent('Nothing shows here now: both sides are set to “Nothing”.');
  });

  it('draws caption mode over another window, as bands when compact, the newest one lit', () => {
    // The sample speaks the pair (B-22): Chinese for me, Japanese for the other side.
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: { settings: {}, credentials: {}, pair: { source: 'zh', target: 'ja' } } } as never });
    useSubtitleStore.setState({ compactMode: true });
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByText('Preview: caption mode, over another window')).toBeInTheDocument();
    expect(preview().querySelectorAll('.subtitle-stream__line').length).toBe(4);
    // The newest exchange is mine: lit in my source band and my translation band.
    expect(preview().querySelectorAll('.subtitle-stream__item--lit').length).toBe(2);
    // Each band one short sentence, the side's latest, so it reads whole on one line at the default size.
    const lines = [...preview().querySelectorAll('.subtitle-stream__line')].map((l) => l.textContent?.trim());
    expect(lines).toEqual(['结果什么时候出来？', '結果はいつ出ますか？', '認証試験の結果次第です。', '要看认证测试的结果。']);
    useSubtitleStore.setState({ newItemHighlightEnabled: false } as never);
    cleanup();
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(preview().querySelectorAll('.subtitle-stream__item--lit').length).toBe(0);
    useProviderStore.setState({ selected: null, entries: {} });
  });
});

// B-22: the sample speaks the user's pair, not a fixed Chinese and Japanese.
describe('display — the preview speaks the pair', () => {
  const pairIs = (source: string, target: string) =>
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: { settings: {}, credentials: {}, pair: { source, target } } } as never });
  afterEach(() => useProviderStore.setState({ selected: null, entries: {} }));
  const badges = () => [...preview().querySelectorAll('.lang-badge')].map((b) => b.textContent);

  it('writes my lines in the language I speak and theirs in the language the other side hears', () => {
    pairIs('en', 'ko');
    render(<DisplayCategory locked={false} />);
    expect(preview()).toHaveTextContent('Can you deliver by next Wednesday?');
    expect(preview()).toHaveTextContent('다음 주 수요일까지 납품할 수 있나요?');
    expect(preview()).toHaveTextContent('인증 시험 결과에 따라 달라요.');
    expect(preview()).toHaveTextContent('It depends on the certification test results.');
    expect(preview()).not.toHaveTextContent('下周三之前能交货吗？');
    expect(badges()).toEqual(['EN', 'KO', 'KO', 'EN', 'EN', 'KO']);
  });

  it("follows a change of the pair", () => {
    pairIs('en', 'ko');
    render(<DisplayCategory locked={false} />);
    act(() => pairIs('de', 'fr'));
    expect(preview()).toHaveTextContent('Können Sie bis nächsten Mittwoch liefern?');
    expect(preview()).toHaveTextContent('Pouvez-vous livrer d’ici mercredi prochain ?');
    expect(badges()).toEqual(['DE', 'FR', 'FR', 'DE', 'DE', 'FR']);
  });

  it("speaks the pair in caption mode's compact bands too", () => {
    pairIs('es', 'it');
    useSubtitleStore.setState({ compactMode: true });
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(preview().querySelector('.subtitle-stream')).not.toBeNull();
    expect(preview()).toHaveTextContent('¿Cuándo salen los resultados?');
    expect(preview()).toHaveTextContent('Quando escono i risultati?');
    expect(preview()).not.toHaveTextContent('結果はいつ出ますか？');
  });

  it("gives readings, when they are on, to the text in the target's reading language only", () => {
    pairIs('en', 'ja');
    useConversationDisplayStore.setState({ showReadings: true });
    render(<DisplayCategory locked={false} />);
    const readings = [...preview().querySelectorAll('rt')].map((rt) => rt.textContent);
    expect(readings).toEqual(['(ja)', '(ja)', '(ja)']);
    expect(preview().querySelector('ruby')).toHaveTextContent('来週の水曜日までに納品できますか？');
  });

  it('draws no readings while they are off', () => {
    pairIs('en', 'ja');
    useConversationDisplayStore.setState({ showReadings: false });
    render(<DisplayCategory locked={false} />);
    expect(preview().querySelectorAll('rt')).toHaveLength(0);
    expect(preview()).toHaveTextContent('来週の水曜日までに納品できますか？');
  });
});

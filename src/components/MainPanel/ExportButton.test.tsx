import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import type { DisplayMode } from '../../stores/settingsStore';
import ExportButton from './ExportButton';

// i18n: return the default string passed to t(key, default), with {{x}}
// interpolation applied so aria-labels built from the toolbar's own words
// come out readable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, unknown>) => {
      let s = typeof def === 'string' ? def : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      }
      return s;
    },
  }),
}));

vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

// Only the two functions that touch the browser are stubbed; normalizeMessages
// and formatAsTxt run for real so assertions are made against the actual
// exported bytes.
const downloadFile = vi.fn<(content: string, filename: string, mime: string) => void>();
const copyToClipboard = vi.fn<(text: string) => Promise<boolean>>(async () => true);
vi.mock('../../utils/conversationExport', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  downloadFile: (content: string, filename: string, mime: string) =>
    downloadFile(content, filename, mime),
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

let nextTs = 1_700_000_000_000;
const msg = (
  source: 'speaker' | 'participant',
  role: 'user' | 'assistant',
  text: string,
): ConversationItem & { source: string } => ({
  id: `${source}-${role}-${text}`,
  role,
  type: 'message',
  status: 'completed',
  createdAt: (nextTs += 1000),
  formatted: { text },
  source,
} as ConversationItem & { source: string });

// One full exchange on each side: original + its translation.
const ITEMS = [
  msg('speaker', 'user', 'MY-ORIGINAL'),
  msg('speaker', 'assistant', 'MY-TRANSLATION'),
  msg('participant', 'user', 'THEIR-ORIGINAL'),
  msg('participant', 'assistant', 'THEIR-TRANSLATION'),
];

const button = () => screen.getByLabelText('Export conversation');

const tree = (over: { speakerMode?: DisplayMode; participantMode?: DisplayMode } = {}) => (
  <ExportButton
    combinedItems={ITEMS}
    provider="openai"
    currentProviderSettings={{}}
    localInferenceSettings={{}}
    sourceLanguage="EN"
    targetLanguage="JA"
    speakerMode={over.speakerMode ?? 'both'}
    participantMode={over.participantMode ?? 'both'}
  />
);

const renderMenu = (over: { speakerMode?: DisplayMode; participantMode?: DisplayMode } = {}) => {
  const result = render(tree(over));
  fireEvent.click(button());
  return result;
};

// Closing unmounts floating-ui's FloatingFocusManager, which restores focus
// asynchronously; flush that so it doesn't land outside act().
const closeMenu = async () => {
  fireEvent.click(button());
  await act(async () => {});
};

const box = (name: string) => screen.getByRole('menuitemcheckbox', { name });

beforeEach(() => {
  cleanup();
  downloadFile.mockClear();
  copyToClipboard.mockClear();
});

describe('ExportButton scope checkboxes', () => {
  it('starts with the checkboxes matching the toolbar display modes', () => {
    renderMenu({ speakerMode: 'source', participantMode: 'none' });

    expect(box('Me — Src')).toBeChecked();
    expect(box('Me — Trans')).not.toBeChecked();
    expect(box('Other — Src')).not.toBeChecked();
    expect(box('Other — Trans')).not.toBeChecked();
  });

  it('drops the lines whose checkbox is cleared from the downloaded file', () => {
    renderMenu();
    fireEvent.click(box('Me — Src'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

    const content = downloadFile.mock.calls[0][0] as string;
    expect(content).not.toContain('MY-ORIGINAL');
    expect(content).toContain('MY-TRANSLATION');
    expect(content).toContain('THEIR-ORIGINAL');
    expect(content).toContain('THEIR-TRANSLATION');
  });

  it('exports every line when all four are checked', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

    const content = downloadFile.mock.calls[0][0] as string;
    for (const text of ['MY-ORIGINAL', 'MY-TRANSLATION', 'THEIR-ORIGINAL', 'THEIR-TRANSLATION']) {
      expect(content).toContain(text);
    }
  });

  it('narrows the export when the toolbar filter already narrows the view', () => {
    renderMenu({ speakerMode: 'translation', participantMode: 'both' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

    const content = downloadFile.mock.calls[0][0] as string;
    expect(content).not.toContain('MY-ORIGINAL');
    expect(content).toContain('MY-TRANSLATION');
    expect(content).toContain('THEIR-ORIGINAL');
  });

  it('re-checking a box the toolbar had cleared puts those lines back', () => {
    renderMenu({ speakerMode: 'translation', participantMode: 'both' });
    fireEvent.click(box('Me — Src'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

    const content = downloadFile.mock.calls[0][0] as string;
    expect(content).toContain('MY-ORIGINAL');
    expect(content).toContain('MY-TRANSLATION');
  });

  it('leaves the export button usable when the toolbar hides both sides', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });

    // A conversation exists; the current scope selecting none of it is the
    // menu's business, not a reason to lock the user out of the menu.
    expect(screen.getByLabelText('Export conversation')).not.toBeDisabled();
  });

  it('disables the three actions while no line is selected', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });

    for (const name of ['Copy to clipboard', 'Download as .txt', 'Download as .json']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
  });

  it('says the scope is empty rather than leaving a dead menu', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });

    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });

  it('re-enables the actions as soon as one line is checked', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });
    fireEvent.click(box('Me — Trans'));

    expect(screen.getByRole('menuitem', { name: 'Download as .txt' })).not.toBeDisabled();
    expect(screen.queryByText('Nothing selected')).not.toBeInTheDocument();
  });

  it('forgets a one-off scope edit when the menu is reopened', async () => {
    renderMenu({ speakerMode: 'both', participantMode: 'both' });
    fireEvent.click(box('Me — Src'));
    expect(box('Me — Src')).not.toBeChecked();

    await closeMenu();
    fireEvent.click(button()); // reopen

    expect(box('Me — Src')).toBeChecked();
  });

  it('re-seeds from the toolbar when the filter changed since the last open', async () => {
    const { rerender } = renderMenu({ speakerMode: 'both' });
    expect(box('Me — Src')).toBeChecked();
    await closeMenu();

    rerender(tree({ speakerMode: 'translation' }));
    fireEvent.click(button()); // reopen

    expect(box('Me — Src')).not.toBeChecked();
    expect(box('Me — Trans')).toBeChecked();
  });

  it('marks a narrowed download as narrowed, in the file itself', () => {
    renderMenu();
    fireEvent.click(box('Me — Src'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

    expect(downloadFile.mock.calls[0][0] as string).toContain('some lines were left out');
  });

  it('says nothing about narrowing when the whole conversation was exported', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .txt' }));

    expect(downloadFile.mock.calls[0][0] as string).not.toContain('some lines were left out');
  });

  it('records the chosen scope in the json export', () => {
    renderMenu({ speakerMode: 'translation', participantMode: 'none' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as .json' }));

    const parsed = JSON.parse(downloadFile.mock.calls[0][0] as string);
    expect(parsed.session.scope).toEqual({ speaker: 'translation', participant: 'none' });
  });

  it('includes the scope checkboxes in the menu keyboard ring', () => {
    renderMenu();

    const ring = [
      box('Me — Src'), box('Me — Trans'), box('Other — Src'), box('Other — Trans'),
      ...['Copy to clipboard', 'Download as .txt', 'Download as .json']
        .map((name) => screen.getByRole('menuitem', { name })),
    ];

    // Arrow-key navigation is roving-tabindex driven: every stop carries one,
    // and exactly one stop is reachable by Tab at a time.
    for (const el of ring) expect(el).toHaveAttribute('tabindex');
    expect(ring.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('still disables the button when the conversation itself is empty', () => {
    render(
      <ExportButton
        combinedItems={[]}
        provider="openai"
        currentProviderSettings={{}}
        localInferenceSettings={{}}
        sourceLanguage="EN"
        targetLanguage="JA"
        speakerMode="both"
        participantMode="both"
      />,
    );

    expect(screen.getByLabelText('Export conversation')).toBeDisabled();
  });

  it('scopes the clipboard copy the same way as the download', async () => {
    renderMenu();
    fireEvent.click(box('Other — Src'));
    fireEvent.click(box('Other — Trans'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));

    const text = copyToClipboard.mock.calls[0][0] as unknown as string;
    expect(text).toContain('MY-ORIGINAL');
    expect(text).not.toContain('THEIR-ORIGINAL');
    expect(text).not.toContain('THEIR-TRANSLATION');
  });
});

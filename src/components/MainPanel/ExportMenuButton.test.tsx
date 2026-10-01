import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Exporter } from '../../lib/export/exporter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, unknown>) => {
      let s = typeof def === 'string' ? def : key;
      if (opts) for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../stores/settingsStore', () => ({
  useAutoSaveOnStop: () => false,
  useSetAutoSaveOnStop: () => vi.fn(),
}));
vi.mock('../../utils/environment', async (orig) => ({ ...(await orig<Record<string, unknown>>()), isElectron: () => true }));
const downloadFile = vi.fn<(content: string, filename: string, mime: string) => void>();
const copyToClipboard = vi.fn<(text: string) => Promise<boolean>>(async () => true);
vi.mock('../../utils/conversationExport', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  downloadFile: (content: string, filename: string, mime: string) => downloadFile(content, filename, mime),
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

const { ExportMenuButton } = await import('./ExportButton');

const fake = (over: Partial<Exporter> = {}): Exporter => ({
  hasContent: true,
  hasScopedContent: vi.fn(() => true),
  text: vi.fn((_scope, withHeader: boolean) => (withHeader ? 'FILE-TEXT' : 'CLIP-TEXT')),
  json: vi.fn(() => '{"groups":[]}'),
  ...over,
});
const open = () => fireEvent.click(screen.getByLabelText('Export conversation'));
const action = (name: string) => screen.getByRole('menuitem', { name });

beforeEach(() => {
  cleanup();
  downloadFile.mockClear();
  copyToClipboard.mockClear();
});

describe('ExportMenuButton', () => {
  it("copies the exporter's text without a header, under the scope seeded from the toolbar", async () => {
    const exporter = fake();
    render(<ExportMenuButton exporter={exporter} speakerMode="translation" participantMode="both" />);
    open();
    await act(async () => { fireEvent.click(action('Copy to clipboard')); });
    expect(exporter.text).toHaveBeenCalledWith({ speaker: 'translation', participant: 'both' }, false);
    expect(copyToClipboard).toHaveBeenCalledWith('CLIP-TEXT');
  });

  it("downloads the .txt with the header and the .json, under today's file names", () => {
    const exporter = fake();
    render(<ExportMenuButton exporter={exporter} speakerMode="both" participantMode="both" />);
    open();
    fireEvent.click(action('Download as .txt'));
    open();
    fireEvent.click(action('Download as .json'));
    expect(downloadFile.mock.calls[0]).toEqual(['FILE-TEXT', expect.stringMatching(/^sokuji-conversation-\d{8}-\d{6}\.txt$/), 'text/plain;charset=utf-8']);
    expect(downloadFile.mock.calls[1]).toEqual(['{"groups":[]}', expect.stringMatching(/^sokuji-conversation-\d{8}-\d{6}\.json$/), 'application/json']);
  });

  it('passes a cleared checkbox on as a narrower scope', () => {
    const exporter = fake();
    render(<ExportMenuButton exporter={exporter} speakerMode="both" participantMode="both" />);
    open();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Me — Src' }));
    fireEvent.click(action('Download as .txt'));
    expect(exporter.text).toHaveBeenCalledWith({ speaker: 'translation', participant: 'both' }, true);
  });

  it('disables the actions, and says so, when the scope selects nothing of a conversation that exists', () => {
    render(<ExportMenuButton exporter={fake({ hasScopedContent: () => false })} speakerMode="both" participantMode="both" />);
    open();
    expect(action('Download as .txt')).toBeDisabled();
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });
});

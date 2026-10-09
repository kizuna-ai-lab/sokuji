import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EarsBlock from './EarsBlock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, string>) => (def ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k) => opts?.[k] ?? ''),
  }),
}));

const f2f = { offered: true, active: true, swap: false, ears: { speaker: 'right', participant: 'left' }, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } };
vi.mock('../MainPanel/useFaceToFace', () => ({ useFaceToFace: () => f2f }));
const outlets = { setOutletChannel: vi.fn() };
vi.mock('../../stores/audioStore', () => ({
  useSetOutletChannel: () => outlets.setOutletChannel,
}));
const tone = vi.fn(async (_outlet: 'other' | 'me' | 'them') => {});
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: tone }) }));
const report = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError: report.error,
}));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => code.toUpperCase() }));

beforeEach(() => {
  Object.assign(f2f, { offered: true, active: true, swap: false, ears: { speaker: 'right', participant: 'left' }, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } });
  tone.mockReset();
  tone.mockImplementation(async () => {});
  report.error.mockReset();
  outlets.setOutletChannel.mockClear();
});

describe('EarsBlock', () => {
  it('puts me in the left ear by default', () => {
    render(<EarsBlock />);
    const [left, right] = Array.from(document.querySelectorAll('.ears-block__ear'));
    expect(left.className).toContain('--me');
    expect(right.className).toContain('--other');
    expect(screen.getByText('Me (JA)')).toBeInTheDocument();
    expect(screen.getByText('Other person (EN)')).toBeInTheDocument();
  });

  it('swapped: the left ear is the other person', () => {
    f2f.swap = true;
    f2f.ears = { speaker: 'left', participant: 'right' };
    render(<EarsBlock />);
    const [left, right] = Array.from(document.querySelectorAll('.ears-block__ear'));
    expect(left.className).toContain('--other');
    expect(right.className).toContain('--me');
  });

  it('previews each ear panned to its side', async () => {
    render(<EarsBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview the left ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('them'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview the right ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('other'));
  });

  it('the swap button writes each outlet the other one\'s channel', () => {
    render(<EarsBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Swap left and right' }));
    expect(outlets.setOutletChannel).toHaveBeenCalledWith('other', 'left');
    expect(outlets.setOutletChannel).toHaveBeenCalledWith('them', 'right');
  });

  it('a silent participant leg: my ear reads Off with no preview', () => {
    f2f.speaks = { speaker: true, participant: false };
    render(<EarsBlock />);
    const [left, right] = Array.from(document.querySelectorAll('.ears-block__ear'));
    expect(left.querySelector('.ears-block__ear-preview')).toBeNull();
    expect(left.querySelector('.ears-block__ear-off')?.textContent).toBe('Off');
    expect(screen.queryByRole('button', { name: 'Preview the left ear' })).toBeNull();
    expect(right.querySelector('.ears-block__ear-off')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview the right ear' })).toBeInTheDocument();
  });

  it('Text Only: nothing plays in either ear, so nothing renders', () => {
    f2f.speaks = { speaker: false, participant: false };
    const { container } = render(<EarsBlock />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when face-to-face is not active', () => {
    f2f.active = false;
    const { container } = render(<EarsBlock />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a preview that did not play', async () => {
    tone.mockRejectedValue(new Error('no output device'));
    render(<EarsBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview the left ear' }));
    await vi.waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
    const [source, message, options] = report.error.mock.calls[0];
    expect(source).toBe('EarsBlock');
    expect(message).toContain('no output device');
    expect(options?.cause).toBeInstanceOf(Error);
  });

  it('carries the headphones hint', () => {
    render(<EarsBlock />);
    expect(screen.getByText(/Use headphones, one side each/)).toBeInTheDocument();
  });
});

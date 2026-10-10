import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EarsBlock from './EarsBlock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, string>) => (def ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k) => opts?.[k] ?? ''),
  }),
}));

const f2f = { offered: true, active: true, swap: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } };
vi.mock('../MainPanel/useFaceToFace', () => ({ useFaceToFace: () => f2f }));
const routing = { setFaceToFaceSwap: vi.fn() };
vi.mock('../../stores/routingStore', () => ({
  useRoutingStore: (pick: (s: unknown) => unknown) => pick({ faceToFaceSwap: f2f.swap, setFaceToFaceSwap: routing.setFaceToFaceSwap }),
}));
const tone = vi.fn(async (_pan?: -1 | 1) => {});
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: tone }) }));
const report = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError: report.error,
}));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => code.toUpperCase() }));

beforeEach(() => {
  Object.assign(f2f, { offered: true, active: true, swap: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } });
  tone.mockReset();
  tone.mockImplementation(async () => {});
  report.error.mockReset();
  routing.setFaceToFaceSwap.mockClear();
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
    render(<EarsBlock />);
    const [left, right] = Array.from(document.querySelectorAll('.ears-block__ear'));
    expect(left.className).toContain('--other');
    expect(right.className).toContain('--me');
  });

  it('previews each ear panned to its side', async () => {
    render(<EarsBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview the left ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith(-1));
    fireEvent.click(screen.getByRole('button', { name: 'Preview the right ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith(1));
  });

  it('the swap button writes the opposite', () => {
    render(<EarsBlock />);
    fireEvent.click(screen.getByRole('button', { name: /Swap left and right/ }));
    expect(routing.setFaceToFaceSwap).toHaveBeenCalledWith(true);
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

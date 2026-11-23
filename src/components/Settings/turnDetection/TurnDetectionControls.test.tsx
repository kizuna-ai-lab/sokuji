import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const { persistSetting } = vi.hoisted(() => ({ persistSetting: vi.fn(async () => {}) }));
vi.mock('../../../services/persistSetting', () => ({ persistSetting }));

const { reportWarning } = vi.hoisted(() => ({ reportWarning: vi.fn() }));
vi.mock('../../../lib/diagnostics/report', async (orig) => ({ ...(await orig<typeof import('../../../lib/diagnostics/report')>()), reportWarning }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, unknown>) =>
      (fb ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => String(opts?.[n] ?? '')),
  }),
}));

let mockPhase = 'ready';
let mockBytes = 0;
let mockError: string | null = null;
const mockDownload = vi.fn();
const mockDismiss = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../../stores/smartTurnStore', () => {
  const state = () => ({ phase: mockPhase, downloadedBytes: mockBytes, error: mockError, refresh: vi.fn(), download: mockDownload, dismiss: mockDismiss, remove: mockRemove });
  return {
    useSmartTurnStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
    useSmartTurnPhase: () => mockPhase,
    SMART_TURN_TOTAL_BYTES: 32_411_198,
  };
});

import { useTurnDetectionStore } from '../../../stores/turnDetectionStore';
import { TURN_DETECTION_DEFAULTS, type TurnDetectionSettings } from '../../../lib/turn/turnDetectionSettings';
import type { TurnDetectionScope } from '../../../lib/turn/turnDetection';
import { EndOfTurnControl, TurnDetectionControls, TurnDetectionHelp, TurnDetectionSummary } from './TurnDetectionControls';

const SHOWN: TurnDetectionScope = { shown: true, smartOffered: false };
const SMART_SCOPE: TurnDetectionScope = { shown: true, smartOffered: true };
const set = (patch: Partial<TurnDetectionSettings>) => useTurnDetectionStore.setState({ settings: { ...TURN_DETECTION_DEFAULTS, ...patch } });
const sliderFor = (label: string) => screen.getByText(label).closest('.setting-item')!.querySelector('input[type="range"]') as HTMLInputElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  persistSetting.mockClear();
  reportWarning.mockClear();
  set({});
  mockPhase = 'ready';
  mockBytes = 0;
  mockError = null;
  mockDownload.mockReset().mockImplementation(async () => { mockPhase = 'ready'; });
  mockDismiss.mockReset();
  mockRemove.mockReset().mockResolvedValue(undefined);
});

describe('TurnDetectionControls', () => {
  const LABELS = ['Speech Threshold', 'Silence Threshold', 'Min Silence Duration', 'Min Speech Duration', 'Pre-Speech Padding', 'Max Speech Duration'];

  it('shows the same six sliders for a model that cuts its own turns as for a shared one', () => {
    for (const scope of [SHOWN, SMART_SCOPE]) {
      const { container, unmount } = render(<TurnDetectionControls scope={scope} />);
      expect(container.querySelectorAll('input[type="range"]')).toHaveLength(6);
      for (const label of LABELS) expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it('shows nothing for a streaming model (scope not shown)', () => {
    const { container } = render(<TurnDetectionControls scope={{ shown: false, smartOffered: false }} />);
    expect(container.innerHTML).toBe('');
  });

  it('offers Normal / Smart only when an automatic leg is on a shared model', () => {
    const { unmount } = render(<TurnDetectionControls scope={SHOWN} />);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
    unmount();
    render(<TurnDetectionControls scope={SMART_SCOPE} />);
    expect(button('Normal').className).toContain('active');
    expect(button('Smart')).toBeTruthy();
  });

  it('writes settings.turnDetection.*, never settings.localInference.*', () => {
    render(<TurnDetectionControls scope={SHOWN} />);
    fireEvent.change(sliderFor('Min Silence Duration'), { target: { value: '1.2' } });
    expect(persistSetting).toHaveBeenCalledTimes(1);
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.minSilence', 1.2);
  });

  it('reports max speech in whole seconds, from 10 to 40', () => {
    render(<TurnDetectionControls scope={SHOWN} />);
    const maxSpeech = sliderFor('Max Speech Duration');
    expect([maxSpeech.min, maxSpeech.max, maxSpeech.step]).toEqual(['10', '40', '5']);
    expect(screen.getByText('30s')).toBeTruthy();
    fireEvent.change(maxSpeech, { target: { value: '35' } });
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.maxSpeech', 35);
  });

  it('runs pre-speech padding from 0 to 2 s', () => {
    render(<TurnDetectionControls scope={SHOWN} />);
    const pad = sliderFor('Pre-Speech Padding');
    expect([pad.min, pad.max]).toEqual(['0', '2']);
    expect(screen.getByText('0.80s')).toBeTruthy();
  });

  it('shows the "VAD Settings" heading and disables every slider while a session runs', () => {
    const { container } = render(<TurnDetectionControls scope={SHOWN} disabled />);
    expect(container.querySelector('h2')?.textContent).toBe('VAD Settings');
    for (const slider of container.querySelectorAll('input[type="range"]')) expect(slider).toBeDisabled();
  });

  it('names the model limit under Max speech when it is below the setting', () => {
    const { rerender } = render(<TurnDetectionControls scope={SHOWN} />);
    expect(screen.queryByText(/splits utterances longer than/)).toBeNull();
    rerender(<TurnDetectionControls scope={{ ...SHOWN, limitSeconds: 28.2 }} />);
    const note = screen.getByText('This model splits utterances longer than 28.2 s.');
    expect(note.closest('.setting-item')).toBe(screen.getByText('Max Speech Duration').closest('.setting-item'));
  });

  describe('Smart', () => {
    it('shows the two Smart sliders above Speech Threshold, calls Min Silence "Max Wait" and holds it at 0.30 s or more', () => {
      set({ endOfTurn: 'smart' });
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(screen.getByText('Max Wait')).toBeTruthy();
      expect(screen.queryByText('Min Silence Duration')).toBeNull();
      expect(sliderFor('Max Wait').min).toBe('0.3');
      expect([sliderFor('Turn Check After').min, sliderFor('Turn Check After').max]).toEqual(['0.1', '0.5']);
      expect([sliderFor('Turn Threshold').min, sliderFor('Turn Threshold').max]).toEqual(['0.3', '0.9']);
      const order = screen.getByText('Turn Check After').compareDocumentPosition(screen.getByText('Speech Threshold'));
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('holds Turn Check After 0.2 s under Max Wait, showing what the session will use, and a dash when there is no room', () => {
      set({ endOfTurn: 'smart', minSilence: 0.4, smartTurnCheckAfter: 0.5 });
      const { unmount } = render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(sliderFor('Turn Check After').max).toBe('0.2');
      expect(screen.getByText('0.20s')).toBeTruthy();
      unmount();
      set({ endOfTurn: 'smart', minSilence: 0.25 });
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(screen.getByText('—')).toBeTruthy();
    });

    it('reads a stored Smart as Normal when no leg offers it, or the model is gone', () => {
      set({ endOfTurn: 'smart' });
      const { unmount } = render(<TurnDetectionControls scope={SHOWN} />);
      expect(screen.queryByText('Turn Check After')).toBeNull();
      unmount();
      mockPhase = 'missing';
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(button('Normal').className).toContain('active');
      expect(screen.getByText('Min Silence Duration')).toBeTruthy();
    });

    it('turning Smart on downloads the model first, and writes Smart only once it is ready', async () => {
      mockPhase = 'missing';
      let finish!: () => void;
      mockDownload.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { mockPhase = 'ready'; resolve(); }; }));
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Smart'));
      expect(mockDownload).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(persistSetting).not.toHaveBeenCalled();
      finish();
      await vi.waitFor(() => expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.endOfTurn', 'smart'));
      expect(persistSetting).toHaveBeenCalledTimes(1);
    });

    it('raises a Max Wait under 0.3 s to 0.3 s, reading it when the download ends', async () => {
      mockPhase = 'missing';
      set({ minSilence: 0.25 });
      mockDownload.mockImplementation(async () => { mockPhase = 'ready'; });
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Smart'));
      await vi.waitFor(() => expect(useTurnDetectionStore.getState().settings).toMatchObject({ endOfTurn: 'smart', minSilence: 0.3 }));
    });

    it('keeps a Max Wait raised while the model downloaded', async () => {
      mockPhase = 'missing';
      set({ minSilence: 0.25 });
      let finish!: () => void;
      mockDownload.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { mockPhase = 'ready'; resolve(); }; }));
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Smart'));
      useTurnDetectionStore.getState().update({ minSilence: 0.8 });
      finish();
      await vi.waitFor(() => expect(useTurnDetectionStore.getState().settings.endOfTurn).toBe('smart'));
      expect(useTurnDetectionStore.getState().settings.minSilence).toBe(0.8);
    });

    it('stays on Normal when the download fails', async () => {
      mockPhase = 'missing';
      mockDownload.mockImplementation(async () => { mockPhase = 'error'; mockError = 'offline'; });
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Smart'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useTurnDetectionStore.getState().settings.endOfTurn).toBe('normal');
    });

    it('writes Normal when Normal is chosen from Smart, and clears a failed download', () => {
      set({ endOfTurn: 'smart' });
      const { unmount } = render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Normal'));
      expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.endOfTurn', 'normal');
      unmount();
      mockPhase = 'error';
      mockError = 'offline';
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Normal'));
      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it('deletes the model only under Smart with the model ready', () => {
      set({ endOfTurn: 'smart' });
      const { unmount } = render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Delete'));
      expect(mockRemove).toHaveBeenCalledTimes(1);
      unmount();
      set({});
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('offers no Delete while the model downloads or is missing, even under a stored Smart', () => {
      set({ endOfTurn: 'smart' });
      for (const phase of ['downloading', 'missing']) {
        mockPhase = phase;
        const { unmount } = render(<TurnDetectionControls scope={SMART_SCOPE} />);
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        unmount();
      }
    });

    it('reports a failed delete as a deduped warning', async () => {
      set({ endOfTurn: 'smart' });
      mockRemove.mockRejectedValue(new Error('disk full'));
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      fireEvent.click(button('Delete'));
      await vi.waitFor(() => expect(reportWarning).toHaveBeenCalledTimes(1));
      expect(reportWarning).toHaveBeenCalledWith('SmartTurn', expect.stringContaining('disk full'), expect.objectContaining({ dedupeKey: 'smart-turn:delete' }));
    });
  });

  describe('Restore defaults', () => {
    const restore = () => screen.queryByRole('button', { name: 'Restore defaults' });

    it('is offered once a slider on show moves, and puts the eight sliders back while keeping Normal / Smart', () => {
      set({ endOfTurn: 'smart', threshold: 0.5, minSilence: 0.8, prePad: 0.4, smartTurnThreshold: 0.7 });
      const { container } = render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(restore()!.closest('h2')).toBe(container.querySelector('h2'));
      fireEvent.click(restore()!);
      expect(useTurnDetectionStore.getState().settings).toEqual({ ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' });
    });

    it('is not offered at the defaults, and counts the Smart sliders only under Smart', () => {
      const { unmount } = render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(restore()).toBeNull();
      unmount();
      set({ smartTurnCheckAfter: 0.2 });
      render(<TurnDetectionControls scope={SMART_SCOPE} />);
      expect(restore()).toBeNull();
    });

    it('is disabled while a session runs', () => {
      set({ threshold: 0.5 });
      render(<TurnDetectionControls scope={SHOWN} disabled />);
      expect(restore()).toBeDisabled();
    });
  });
});

describe('TurnDetectionSummary', () => {
  it('reads "VAD Settings · Min Silence Duration: 1.40s", and under Smart "VAD Settings · Smart · Max Wait 1.40s"', () => {
    const { container, rerender } = render(<TurnDetectionSummary scope={SMART_SCOPE} />);
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 1.40s');
    set({ endOfTurn: 'smart' });
    rerender(<TurnDetectionSummary scope={SMART_SCOPE} />);
    expect(container.textContent).toBe('VAD Settings · Smart · Max Wait 1.40s');
  });

  it('reads Normal when Max Wait leaves no room for Turn Check After', () => {
    set({ endOfTurn: 'smart', minSilence: 0.25 });
    const { container } = render(<TurnDetectionSummary scope={SMART_SCOPE} />);
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 0.25s');
  });

  it('is text only, and nothing when the scope is not shown', () => {
    const { container, rerender } = render(<TurnDetectionSummary scope={SHOWN} />);
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
    rerender(<TurnDetectionSummary scope={{ shown: false, smartOffered: false }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('TurnDetectionHelp', () => {
  it('renders the tooltip trigger, and nothing when the scope is not shown', () => {
    const { container, rerender } = render(<TurnDetectionHelp scope={SHOWN} />);
    expect(container.querySelector('.tooltip-trigger')).toBeTruthy();
    rerender(<TurnDetectionHelp scope={{ shown: false, smartOffered: false }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('EndOfTurnControl', () => {
  it('shows Normal and Smart, the value active, and reports a choice', () => {
    const onChange = vi.fn();
    render(<EndOfTurnControl value="smart" onChange={onChange} disabled={false} />);
    expect(button('Smart').className).toContain('active');
    fireEvent.click(button('Normal'));
    expect(onChange).toHaveBeenCalledWith('normal');
  });

  it("shows the download's progress and holds both buttons meanwhile", () => {
    const { container } = render(
      <EndOfTurnControl value="normal" onChange={() => {}} disabled={false} download={{ done: 16_205_599, total: 32_411_198 }} />,
    );
    expect(screen.getByText('Downloading the Smart Turn model: 15.5 MB of 30.9 MB')).toBeTruthy();
    expect((container.querySelector('.end-of-turn__progress-fill') as HTMLElement).style.width).toBe('50%');
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
  });

  it('shows a failed download with a retry', () => {
    const onRetry = vi.fn();
    render(<EndOfTurnControl value="normal" onChange={() => {}} disabled={false} error="offline" onRetry={onRetry} />);
    expect(screen.getByText('Smart Turn model download failed: offline')).toBeTruthy();
    fireEvent.click(button('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('disables everything while a session runs', () => {
    render(<EndOfTurnControl value="normal" onChange={() => {}} disabled error="offline" onRetry={() => {}} />);
    for (const name of ['Normal', 'Smart', 'Retry']) expect(button(name)).toBeDisabled();
  });

  it('shows the model on disk with its size and a Delete, only when told the model can go', () => {
    const onDelete = vi.fn();
    const { rerender } = render(<EndOfTurnControl value="smart" onChange={() => {}} disabled={false} deletable={{ bytes: 32_411_198, onDelete }} />);
    const line = screen.getByText('Smart Turn model: 30.9 MB').closest('.setting-item')!;
    fireEvent.click(within(line as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    rerender(<EndOfTurnControl value="smart" onChange={() => {}} disabled={false} />);
    expect(screen.queryByText(/Smart Turn model:/)).toBeNull();
  });
});

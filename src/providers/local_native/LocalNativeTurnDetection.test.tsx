import { describe, it, expect, vi, beforeEach } from 'vitest';

const { persistSetting } = vi.hoisted(() => ({ persistSetting: vi.fn(async () => {}) }));
vi.mock('../../services/persistSetting', () => ({ persistSetting }));
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, unknown>) =>
      (fb ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => String(opts?.[n] ?? '')),
  }),
}));

let mockPhase = 'ready';
const mockRefresh = vi.fn();
vi.mock('../../stores/smartTurnStore', () => {
  const state = () => ({ phase: mockPhase, downloadedBytes: 0, error: null, refresh: mockRefresh, download: vi.fn(), dismiss: vi.fn(), remove: vi.fn() });
  return {
    useSmartTurnStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
    useSmartTurnPhase: () => mockPhase,
    SMART_TURN_TOTAL_BYTES: 32_411_198,
  };
});

let mockTurnMode = 'auto';
let mockLegs: string[] = ['speaker'];
vi.mock('../../stores/turnModeStore', () => ({
  useTurnModeStore: (select: (s: { turnMode: string }) => unknown) => select({ turnMode: mockTurnMode }),
}));
vi.mock('../../stores/providerStore', () => ({
  useProviderStore: (select: (s: { legs: string[] }) => unknown) => select({ legs: mockLegs }),
}));

import { LocalNativeTurnDetectionControls, LocalNativeTurnDetectionHelp, LocalNativeTurnDetectionSummary } from './LocalNativeTurnDetection';
import { LOCAL_NATIVE_DEFAULTS } from './settings';
import { useTurnDetectionStore } from '../../stores/turnDetectionStore';
import { TURN_DETECTION_DEFAULTS } from '../../lib/turn/turnDetectionSettings';

const props = { settings: LOCAL_NATIVE_DEFAULTS, update: () => {} };

beforeEach(() => {
  persistSetting.mockClear();
  useTurnDetectionStore.setState({ settings: TURN_DETECTION_DEFAULTS });
  mockPhase = 'ready';
  mockRefresh.mockReset();
  mockTurnMode = 'auto';
  mockLegs = ['speaker'];
});

describe('LocalNativeTurnDetection is the app\'s turn detection', () => {
  it('the Summary follows the turn detection store', () => {
    useTurnDetectionStore.setState({ settings: { ...TURN_DETECTION_DEFAULTS, minSilence: 0.8 } });
    const { container } = render(<LocalNativeTurnDetectionSummary {...props} />);
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 0.80s');
  });

  it('the Controls are the shared ones: five sliders, no Pre-Speech Padding (the sidecar keeps its own pre-roll), and Normal / Smart for an automatic speaker', () => {
    const { container } = render(<LocalNativeTurnDetectionControls {...props} />);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(5);
    expect(screen.queryByText('Pre-Speech Padding')).toBeNull();
    expect(screen.getByRole('button', { name: 'Smart' })).toBeTruthy();
  });

  it('offers no Smart under manual turns with no participant leg', () => {
    mockTurnMode = 'push-to-talk';
    render(<LocalNativeTurnDetectionControls {...props} />);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
  });

  it('offers it through the participant leg, which is always automatic', () => {
    mockTurnMode = 'push-to-talk';
    mockLegs = ['speaker', 'participant'];
    render(<LocalNativeTurnDetectionControls {...props} />);
    expect(screen.getByRole('button', { name: 'Smart' })).toBeTruthy();
  });

  it('asks for the Smart Turn model\'s state once Smart is offered', () => {
    mockPhase = 'unknown';
    render(<LocalNativeTurnDetectionControls {...props} />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('notes the sidecar\'s 19 s cap under the 30 s Max speech setting, and no note at 15 s', () => {
    const { container, unmount } = render(<LocalNativeTurnDetectionControls {...props} />);
    expect(container.textContent).toContain('19');
    unmount();
    useTurnDetectionStore.setState({ settings: { ...TURN_DETECTION_DEFAULTS, maxSpeech: 15 } });
    const again = render(<LocalNativeTurnDetectionControls {...props} />);
    expect(again.container.textContent).not.toContain('19.0');
  });

  it('shows nothing when no leg runs', () => {
    mockLegs = [];
    const { container } = render(<LocalNativeTurnDetectionHelp {...props} />);
    expect(container.innerHTML).toBe('');
  });
});

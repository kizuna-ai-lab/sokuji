import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: false, getToken: async () => null }),
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});

import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { SessionEnginePage, SessionSettingsGeneral, SessionSettingsProvider } from './ProviderArea';

const entry = () => ({ settings: { ...LOCAL_INFERENCE_DEFAULTS }, credentials: {}, pair: { source: 'ja', target: 'en' } });

const SECTION_IDS = ['languages-section', 'turn-detection-section', 'output-section', 'sentence-segmentation-section', 'provider-section'];

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useProviderStore.setState({ selected: 'localInference', entries: { localInference: entry() }, readiness: {}, legs: ['speaker'] });
  useAudioStore.setState({ mode: 'speaker' } as Partial<ReturnType<typeof useAudioStore.getState>>);
  useSettingsStore.setState({ textOnly: false, engineSlotTarget: null } as Partial<ReturnType<typeof useSettingsStore.getState>>);
});

describe('SessionSettingsGeneral', () => {
  it('renders the blocks in order, with the engine chips inside the provider section, and the sentence labels', () => {
    const { container } = render(<SessionSettingsGeneral locked={false} layout="simple" onOpenSlot={vi.fn()} />);

    const elements = SECTION_IDS.map((id) => container.querySelector(`#${id}`));
    elements.forEach((el, i) => expect(el, `#${SECTION_IDS[i]} is present`).toBeTruthy());
    for (let i = 0; i < elements.length - 1; i++) {
      // eslint-disable-next-line no-bitwise
      expect(elements[i]!.compareDocumentPosition(elements[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const providerSection = elements[elements.length - 1]!;
    expect(providerSection.querySelector('[data-tour="engine-chips"]')).toBeTruthy();

    const labels = [...container.querySelectorAll('#languages-section .language-select-group label')].map((el) => el.textContent);
    expect(labels).toEqual(['I speak', 'they hear']);
  });

  it('a chip calls onOpenSlot with its slot', () => {
    const onOpenSlot = vi.fn();
    render(<SessionSettingsGeneral locked={false} layout="simple" onOpenSlot={onOpenSlot} />);
    const chip = screen.getByText('ASR');
    fireEvent.click(chip.closest('button')!);
    expect(onOpenSlot).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' });
  });

  it('locked disables the picker, the pair and the turn mode', () => {
    render(<SessionSettingsGeneral locked={true} layout="simple" onOpenSlot={vi.fn()} />);
    expect(screen.getByLabelText('simpleSettings.provider')).toBeDisabled();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    for (const button of [...screen.getAllByRole('button')].filter((b) => b.className.includes('option-button'))) {
      expect(button).toBeDisabled();
    }
  });

  // The layout reaches the Speech section: LocalInference's speech-detection
  // tuning, under Auto, is a summary line in Simple mode and a disclosure to
  // the full controls on Advanced's General tab.
  it("layout 'simple': the Speech section shows the tuning's summary line, with no disclosure", () => {
    useTurnModeStore.setState({ turnMode: 'auto' });
    const { container } = render(<SessionSettingsGeneral locked={false} layout="simple" onOpenSlot={vi.fn()} />);
    const speech = container.querySelector('#turn-detection-section')!;
    expect(speech.textContent).toContain('VAD Settings · Min Silence Duration: 1.40s');
    expect(speech.querySelector('button[aria-expanded]')).toBeNull();
  });

  it("layout 'advanced': the Speech section shows the tuning as a disclosure that opens onto the sliders", () => {
    useTurnModeStore.setState({ turnMode: 'auto' });
    const { container } = render(<SessionSettingsGeneral locked={false} layout="advanced" onOpenSlot={vi.fn()} />);
    const speech = container.querySelector('#turn-detection-section')!;
    const button = speech.querySelector('button[aria-expanded]')!;
    expect(button.textContent).toContain('VAD Settings · Min Silence Duration: 1.40s');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(speech.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(3);
  });
});

describe('SessionSettingsProvider', () => {
  it("renders the picker, then .engine-surface, then LocalInferenceSettingsView's Speech Speed control — today's order", () => {
    const { container } = render(<SessionSettingsProvider locked={false} />);
    const select = container.querySelector('select.provider-select');
    const surface = container.querySelector('.engine-surface');
    const speed = screen.getByText('Speech Speed');
    expect(select).toBeTruthy();
    expect(surface).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(select!.compareDocumentPosition(surface!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(surface!.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a set engineSlotTarget reaches the engine as its initialSlot and is cleared once consumed', () => {
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'asr' } });
    const { container } = render(<SessionSettingsProvider locked={false} />);
    // The engine's own flash proves the slot reached it as `initialSlot`.
    expect(container.querySelector('[data-slot="ja→en:asr"].highlight')).toBeTruthy();
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });
});

describe('SessionEnginePage', () => {
  it('renders the engine with initialSlot equal to its slot', () => {
    const { container } = render(<SessionEnginePage locked={false} slot={{ dir: 'ja→en', stage: 'tts' }} />);
    expect(container.querySelector('[data-slot="ja→en:tts"].highlight')).toBeTruthy();
  });
});

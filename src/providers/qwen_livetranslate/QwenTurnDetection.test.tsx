import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));

import type { SettingsProps } from '../../lib/provider/types';
import { QwenTurnDetectionControls, QwenTurnDetectionSummary } from './QwenTurnDetection';
import { QWEN_DEFAULTS, QWEN_PAUSE, type QwenSettings } from './settings';

const props = (patch: Partial<SettingsProps<QwenSettings>> = {}): SettingsProps<QwenSettings> => ({ settings: QWEN_DEFAULTS, update: vi.fn(), ...patch });

describe("Qwen LiveTranslate's turn detection", () => {
  it('sums up the pause in the words Gemini uses for its own', () => {
    const { container } = render(<QwenTurnDetectionSummary {...props({ settings: { ...QWEN_DEFAULTS, pauseMs: 1200 } })} />);
    expect(container.textContent).toBe('VAD Settings · Silence Duration: 1200ms');
  });

  it('tunes the pause on a slider from half a second to six, writing its own field', () => {
    const update = vi.fn();
    const { container } = render(<QwenTurnDetectionControls {...props({ update })} />);
    expect(container.querySelector('.settings-section > h2')?.textContent).toBe('VAD Settings');
    const slider = screen.getByLabelText('Silence Duration') as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual([String(QWEN_PAUSE.min), String(QWEN_PAUSE.max), String(QWEN_PAUSE.step), '2500']);
    expect(container.textContent).toContain('2500ms');
    fireEvent.change(slider, { target: { value: '1200' } });
    expect(update).toHaveBeenCalledWith({ pauseMs: 1200 });
  });

  it('locks the slider while a run is not idle', () => {
    render(<QwenTurnDetectionControls {...props({ disabled: true })} />);
    expect((screen.getByLabelText('Silence Duration') as HTMLInputElement).disabled).toBe(true);
  });
});

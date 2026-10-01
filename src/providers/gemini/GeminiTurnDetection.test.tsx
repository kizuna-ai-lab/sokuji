import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import type { SettingsProps } from '../../lib/provider/types';
import { GEMINI_DEFAULTS, type GeminiSettings } from './settings';
import { GeminiTurnDetectionSummary, GeminiTurnDetectionHelp, GeminiTurnDetectionControls } from './GeminiTurnDetection';

const props = (patch: Partial<SettingsProps<GeminiSettings>> = {}): SettingsProps<GeminiSettings> => ({
  settings: GEMINI_DEFAULTS,
  update: vi.fn(),
  ...patch,
});

describe('GeminiTurnDetectionSummary', () => {
  it('the summary is one line: the VAD heading and the silence duration (choice 23)', () => {
    const { container } = render(<GeminiTurnDetectionSummary {...props({ settings: { ...GEMINI_DEFAULTS, vadSilenceDurationMs: 800 } })} />);
    expect(container.textContent).toBe('VAD Settings · Silence Duration: 800ms');
  });
});

describe('GeminiTurnDetectionHelp', () => {
  it('its help is the VAD tooltip', () => {
    render(<GeminiTurnDetectionHelp {...props()} />);
    expect(tooltips).toContain(
      'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.'
    );
  });
});

describe('GeminiTurnDetectionControls', () => {
  it("the controls are the old four knobs under the VAD heading, writing Gemini's settings", () => {
    const update = vi.fn();
    const { container } = render(<GeminiTurnDetectionControls {...props({ update })} />);

    expect(container.querySelector('#gemini-vad-section')).not.toBeNull();
    expect(screen.getByText('VAD Settings')).toBeInTheDocument();

    const highButtons = screen.getAllByRole('button', { name: 'High' });
    const lowButtons = screen.getAllByRole('button', { name: 'Low' });
    fireEvent.click(highButtons[0]);
    expect(update).toHaveBeenCalledWith({ vadStartSensitivity: 'high' });
    fireEvent.click(lowButtons[1]);
    expect(update).toHaveBeenCalledWith({ vadEndSensitivity: 'low' });
    expect(lowButtons[0].className).toContain('active');
    expect(highButtons[1].className).toContain('active');

    const silence = screen.getByLabelText('Silence Duration') as HTMLInputElement;
    expect(silence.min).toBe('50');
    expect(silence.max).toBe('3000');
    expect(silence.step).toBe('50');
    expect(screen.getByText('500ms')).toBeInTheDocument();
    fireEvent.change(silence, { target: { value: '800' } });
    expect(update).toHaveBeenCalledWith({ vadSilenceDurationMs: 800 });

    const prefix = screen.getByLabelText('Prefix Padding') as HTMLInputElement;
    expect(prefix.min).toBe('0');
    expect(prefix.max).toBe('2000');
    expect(prefix.step).toBe('50');
    fireEvent.change(prefix, { target: { value: '100' } });
    expect(update).toHaveBeenCalledWith({ vadPrefixPaddingMs: 100 });

    expect(tooltips).toContain('settings.startOfSpeechSensitivityTooltip');
    expect(tooltips).toContain('settings.endOfSpeechSensitivityTooltip');
    expect(tooltips).toContain('settings.vadSilenceDurationTooltip');
    expect(tooltips).toContain('settings.vadPrefixPaddingTooltip');
  });

  it('the controls lock while disabled', () => {
    render(<GeminiTurnDetectionControls {...props({ disabled: true })} />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
    for (const s of screen.getAllByRole('slider')) expect(s).toBeDisabled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => (typeof fallback === 'string' ? fallback : key),
  }),
}));
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));

import type { SettingsProps } from '../../lib/provider/types';
import { RealtimeTurnDetectionControls, RealtimeTurnDetectionHelp, RealtimeTurnDetectionSummary } from './RealtimeTurnDetection';
import { REALTIME_DEFAULTS, type RealtimeSettings } from './settings';

const props = (patch: Partial<RealtimeSettings> = {}, update = vi.fn(), disabled = false): SettingsProps<RealtimeSettings> => ({
  settings: { ...REALTIME_DEFAULTS, ...patch },
  update,
  disabled,
});

describe("OpenAI Realtime's turn detection (choice 17; ruling 4)", () => {
  it('sums up the mechanism in one line of existing words', () => {
    const normal = render(<RealtimeTurnDetectionSummary {...props()} />);
    expect(normal.container.textContent).toBe('settings.normal · settings.threshold 0.49 · settings.silenceDuration 0.50s');
    normal.unmount();
    const semantic = render(<RealtimeTurnDetectionSummary {...props({ turnDetectionMode: 'Semantic', semanticEagerness: 'High' })} />);
    expect(semantic.container.textContent).toBe('settings.semantic · settings.eagerness settings.high');
  });

  it('its help is the old speech-mode tooltip, which tells Normal from Semantic', () => {
    render(<RealtimeTurnDetectionHelp {...props()} />);
    expect(tooltips).toContain('settings.turnDetectionTooltip');
  });

  it("the controls are the two mechanisms under the VAD heading; Normal's three knobs write the old fields, in their old ranges", () => {
    const update = vi.fn();
    const { container } = render(<RealtimeTurnDetectionControls {...props({}, update)} />);
    expect(container.querySelector('#openai-vad-section > h2')?.textContent).toBe('VAD Settings');
    expect(screen.getByRole('button', { name: 'settings.normal' }).className).toContain('active');
    fireEvent.click(screen.getByRole('button', { name: 'settings.semantic' }));
    expect(update).toHaveBeenCalledWith({ turnDetectionMode: 'Semantic' });
    const threshold = screen.getByLabelText('settings.threshold') as HTMLInputElement;
    expect([threshold.min, threshold.max, threshold.step, threshold.value]).toEqual(['0', '1', '0.01', '0.49']);
    fireEvent.change(threshold, { target: { value: '0.6' } });
    expect(update).toHaveBeenCalledWith({ threshold: 0.6 });
    const prefix = screen.getByLabelText('settings.prefixPadding') as HTMLInputElement;
    expect([prefix.min, prefix.max]).toEqual(['0', '2']);
    fireEvent.change(prefix, { target: { value: '0.3' } });
    expect(update).toHaveBeenCalledWith({ prefixPadding: 0.3 });
    fireEvent.change(screen.getByLabelText('settings.silenceDuration'), { target: { value: '1.2' } });
    expect(update).toHaveBeenCalledWith({ silenceDuration: 1.2 });
    expect(Array.from(container.querySelectorAll('.setting-value')).map((v) => v.textContent)).toEqual(['0.49', '0.50s', '0.50s']);
    expect(screen.queryByLabelText('settings.eagerness')).toBeNull();
    for (const tip of ['settings.turnDetectionTooltip', 'settings.thresholdTooltip', 'settings.prefixPaddingTooltip', 'settings.silenceDurationTooltip']) expect(tooltips).toContain(tip);
  });

  it("Semantic's knob is its eagerness, in the old four", () => {
    const update = vi.fn();
    render(<RealtimeTurnDetectionControls {...props({ turnDetectionMode: 'Semantic' }, update)} />);
    expect(screen.queryByLabelText('settings.threshold')).toBeNull();
    const eagerness = screen.getByLabelText('settings.eagerness') as HTMLSelectElement;
    expect(Array.from(eagerness.options).map((o) => [o.value, o.textContent])).toEqual([['Auto', 'settings.auto'], ['Low', 'settings.low'], ['Medium', 'settings.medium'], ['High', 'settings.high']]);
    fireEvent.change(eagerness, { target: { value: 'Low' } });
    expect(update).toHaveBeenCalledWith({ semanticEagerness: 'Low' });
    expect(tooltips).toContain('settings.semanticEagernessTooltip');
  });

  it('the controls lock while disabled', () => {
    render(<RealtimeTurnDetectionControls {...props({}, vi.fn(), true)} />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
    for (const s of screen.getAllByRole('slider')) expect(s).toBeDisabled();
  });
});

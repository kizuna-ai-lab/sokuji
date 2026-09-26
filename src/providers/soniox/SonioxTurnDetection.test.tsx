import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});

import { SONIOX_DEFAULTS } from './settings';
import { SonioxTurnDetectionControls, SonioxTurnDetectionSummary } from './SonioxTurnDetection';

describe('SonioxTurnDetectionSummary', () => {
  it("is one line: the tuning's heading and its max pause", () => {
    const { container } = render(
      <SonioxTurnDetectionSummary settings={{ ...SONIOX_DEFAULTS, endpointMaxDelayMs: 2500 }} update={() => {}} />
    );
    expect(container.textContent).toBe('Endpoint Detection Tuning · Max Pause Before Finalizing: 2500 ms');
  });
});

describe('SonioxTurnDetectionControls', () => {
  it('writes numbers: sensitivity, max pause and latency level', () => {
    const update = vi.fn();
    render(<SonioxTurnDetectionControls settings={SONIOX_DEFAULTS} update={update} />);

    const sensitivity = screen.getByLabelText('Endpoint Sensitivity') as HTMLInputElement;
    expect(sensitivity.min).toBe('-1');
    expect(sensitivity.max).toBe('1');
    expect(sensitivity.step).toBe('0.1');
    fireEvent.change(sensitivity, { target: { value: '0.3' } });
    expect(update).toHaveBeenCalledWith({ endpointSensitivity: 0.3 });

    const maxDelay = screen.getByLabelText('Max Pause Before Finalizing') as HTMLInputElement;
    expect(maxDelay.min).toBe('500');
    expect(maxDelay.max).toBe('3000');
    expect(maxDelay.step).toBe('100');
    fireEvent.change(maxDelay, { target: { value: '2800' } });
    expect(update).toHaveBeenCalledWith({ endpointMaxDelayMs: 2800 });

    const latency = screen.getByLabelText('Latency Reduction Level') as HTMLSelectElement;
    fireEvent.change(latency, { target: { value: '2' } });
    expect(update).toHaveBeenCalledWith({ endpointLatencyAdjustmentLevel: 2 });
    const options = Array.from(latency.options).map((o) => o.textContent);
    expect(options).toEqual([
      '0 — Default',
      '1 — Lower latency',
      '2 — Even lower latency',
      '3 — Most aggressive',
    ]);
  });

  it('locks while disabled', () => {
    render(<SonioxTurnDetectionControls settings={SONIOX_DEFAULTS} update={() => {}} disabled />);
    expect(screen.getByLabelText('Endpoint Sensitivity')).toBeDisabled();
    expect(screen.getByLabelText('Max Pause Before Finalizing')).toBeDisabled();
    expect(screen.getByLabelText('Latency Reduction Level')).toBeDisabled();
  });
});

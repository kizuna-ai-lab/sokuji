import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});

import { PalabraTurnDetectionControls, PalabraTurnDetectionSummary } from './PalabraTurnDetection';
import { PALABRA_DEFAULTS } from './settings';

describe('PalabraTurnDetectionSummary', () => {
  it('is one line of existing words: the VAD heading and the threshold a session sends', () => {
    const { container } = render(<PalabraTurnDetectionSummary settings={PALABRA_DEFAULTS} update={() => {}} />);
    expect(container.textContent).toBe('VAD Settings · Silence Threshold: 0.70s');
    // A stored 0.1, below the API's floor, reads as the 0.3 it is sent as (ruling 10).
    const { container: low } = render(<PalabraTurnDetectionSummary settings={{ ...PALABRA_DEFAULTS, segmentConfirmationSilenceThreshold: 0.1 }} update={() => {}} />);
    expect(low.textContent).toBe('VAD Settings · Silence Threshold: 0.30s');
  });
});

describe('PalabraTurnDetectionControls', () => {
  it('draws the threshold slider under the VAD heading, from 0.3 to 2.0 (ruling 10), writing a number', () => {
    const update = vi.fn();
    const { container } = render(<PalabraTurnDetectionControls settings={PALABRA_DEFAULTS} update={update} />);
    expect(container.querySelector('#palabra-vad-section h2')?.textContent).toBe('VAD Settings');
    const threshold = screen.getByLabelText('Silence Threshold') as HTMLInputElement;
    expect([threshold.min, threshold.max, threshold.step, threshold.value]).toEqual(['0.3', '2', '0.01', '0.7']);
    expect(screen.getByText('0.70s')).toBeInTheDocument();
    fireEvent.change(threshold, { target: { value: '1.25' } });
    expect(update).toHaveBeenCalledWith({ segmentConfirmationSilenceThreshold: 1.25 });
  });

  it('locks while disabled', () => {
    render(<PalabraTurnDetectionControls settings={PALABRA_DEFAULTS} update={() => {}} disabled />);
    expect(screen.getByLabelText('Silence Threshold')).toBeDisabled();
  });
});

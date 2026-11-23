import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LocalNativeTurnDetectionControls, LocalNativeTurnDetectionSummary } from './LocalNativeTurnDetection';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

describe('LocalNativeTurnDetection', () => {
  it('summarizes the minimum silence', () => {
    const { container } = render(<LocalNativeTurnDetectionSummary settings={{ ...LOCAL_NATIVE_DEFAULTS, vadMinSilenceDuration: 1.2 }} update={vi.fn()} />);
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 1.20s');
  });
  it('draws the three knobs the native VAD takes', () => {
    const { container } = render(<LocalNativeTurnDetectionControls settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} />);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(3);
  });
});

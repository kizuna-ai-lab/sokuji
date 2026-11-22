import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { EdgeVoiceSummary } from './EdgeVoiceSummary';

const named = (leg: 'speaker' | 'participant', voices: Record<string, string>) =>
  render(<EdgeVoiceSummary settings={{ voices, speed: 1 }} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} leg={leg} />).container.textContent;

describe('EdgeVoiceSummary', () => {
  it("names each leg's voice by its own name, from its direction", () => {
    const voices = { 'ja→en': 'en-US-AvaMultilingualNeural', 'en→ja': 'ja-JP-NanamiNeural' };
    expect(named('speaker', voices)).toBe('Ava Multilingual');
    expect(named('participant', voices)).toBe('Nanami');
  });
  it('says nothing while the direction has no voice', () => {
    expect(named('speaker', {})).toBe('');
  });
});

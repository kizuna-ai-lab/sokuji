import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('shows raw bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales to KB / MB / GB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(178300)).toBe('174.1 KB');
    expect(formatBytes(585768448)).toBe('558.6 MB');
    expect(formatBytes(2016339968)).toBe('1.9 GB');
  });
});

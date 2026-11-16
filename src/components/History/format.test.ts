// How History writes days, times, sizes and lengths.
import { describe, it, expect } from 'vitest';
import { dayLabel, formatBytes, formatLength, formatTime } from './format';

const at = (y: number, m: number, d: number, h = 10, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

describe('History formats', () => {
  it('names today and yesterday, and other days by their date and weekday', () => {
    const now = at(2026, 11, 16, 9);
    expect(dayLabel(at(2026, 11, 16, 8), now, 'en')).toBe('Today');
    expect(dayLabel(at(2026, 11, 15, 23), now, 'en')).toBe('Yesterday');
    expect(dayLabel(at(2026, 11, 12), now, 'en')).toBe(new Intl.DateTimeFormat('en', { weekday: 'short', month: 'long', day: 'numeric' }).format(at(2026, 11, 12)));
    expect(dayLabel(at(2025, 3, 2), now, 'en')).toBe(new Intl.DateTimeFormat('en', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }).format(at(2025, 3, 2)));
    expect(dayLabel(at(2026, 11, 16, 8), now, 'zh_CN')).toBe('今天');
  });

  it('writes a time of day, a size and a length', () => {
    expect(formatTime(at(2026, 11, 16, 9, 5), 'en')).toBe(new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(at(2026, 11, 16, 9, 5)));
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
    expect(formatLength(3_723_000)).toBe('1:02:03');
    expect(formatLength(65_000)).toBe('1:05');
  });
});

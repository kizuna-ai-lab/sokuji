import { describe, it, expect } from 'vitest';
import { selectMinWidth } from './selectWidth';

describe('a select as wide as its longest choice', () => {
  it('is the widest label plus what the select draws around it, rounded up', () => {
    const measure = (s: string) => s.length * 7.5;
    expect(selectMinWidth(['Chinese', 'Portuguese (Brazil)', 'Hindi'], measure, 46)).toBe(Math.ceil(19 * 7.5 + 46));
  });

  it('is nothing to say when there are no labels or nothing can be measured', () => {
    expect(selectMinWidth([], (s) => s.length, 46)).toBeNull();
    expect(selectMinWidth(['Chinese'], () => 0, 46)).toBeNull();
  });
});

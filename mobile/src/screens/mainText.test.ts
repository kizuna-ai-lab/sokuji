import { describe, expect, it } from 'vitest';
import { idleHint, nameWeight, pairArrow, pairLabel, pairLayout, statusLine, statusTone } from './mainText';

// A t() that shows which key and values were asked for.
const t = (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(',')})` : key);

describe('the main screen before a session', () => {
  it('says what Start will do, in the language the subtitles will be in', () => {
    expect(idleHint(t, 'Japanese')).toBe('mobile.main.idleHint(Japanese)');
  });

  it('points the arrow between the languages from what is heard to what is read', () => {
    expect(pairArrow(false)).toBe('→');
    // Right to left, the heard language is on the right: the arrow points left.
    expect(pairArrow(true)).toBe('←');
  });

  it('names the pair on one line for the history, the arrow the same way', () => {
    expect(pairLabel('Auto Detect', 'Japanese', false)).toBe('Auto Detect → Japanese');
    expect(pairLabel('اكتشاف تلقائي', 'اليابانية', true)).toBe('اكتشاف تلقائي ← اليابانية');
  });
});

describe('the bar at the bottom of the main screen', () => {
  it('keeps the pair beside Start until a name has to wrap, then gives the pair its own line, then stacks the sides', () => {
    expect(pairLayout(1, 0)).toBe('row');
    expect(pairLayout(1, 1)).toBe('stacked');
    expect(pairLayout(1, 2)).toBe('column');
    // Nothing further to give once the sides are stacked.
    expect(pairLayout(1, 5)).toBe('column');
  });

  it('stacks the sides outright at the accessibility text sizes', () => {
    expect(pairLayout(1.35, 0)).toBe('column');
    expect(pairLayout(1.3, 0)).toBe('row');
  });
});

describe('how the two sides of the pair share the width', () => {
  it('weighs a name by how wide its characters are: a Han or kana character about one em, a Latin letter about half', () => {
    expect(nameWeight('日本語')).toBe(3);
    expect(nameWeight('ab')).toBeCloseTo(1.1);
    expect(nameWeight('Auto Detect')).toBeCloseTo(6.05);
  });

  it('never weighs nothing', () => {
    expect(nameWeight('')).toBe(1);
  });
});

describe('the status line', () => {
  it('has nothing to say before the first Start', () => {
    expect(statusLine(t, 'idle', '')).toBe('');
  });

  it('says a Stop is under way until the session has ended', () => {
    expect(statusLine(t, 'stopping', '')).toBe('mobile.main.status.stopping');
  });

  it('names the known ends, and any other failure in words rather than the raw detail', () => {
    expect(statusLine(t, 'error', 'balance_exhausted')).toBe('mobile.main.status.balanceExhausted');
    expect(statusLine(t, 'error', 'socket closed 1006')).toBe('mobile.common.failed');
    expect(statusLine(t, 'leasing', '')).toBe('mobile.main.status.starting');
  });

  it('marks a failure as one, so it is not read like the other states', () => {
    expect(statusTone('error')).toBe('error');
    expect(statusTone('reconnecting')).toBe('warning');
    expect(statusTone('listening')).toBe('normal');
  });
});

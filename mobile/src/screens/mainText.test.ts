import { describe, expect, it } from 'vitest';
import { idleHint, pairLabel, statusLine, statusTone } from './mainText';

// A t() that shows which key and values were asked for.
const t = (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(',')})` : key);

describe('the main screen before a session', () => {
  it('says what Start will do, in the language the subtitles will be in', () => {
    expect(idleHint(t, 'Japanese')).toBe('mobile.main.idleHint(Japanese)');
  });

  it('names the pair, the arrow pointing from what is heard to what is read', () => {
    expect(pairLabel('Auto Detect', 'Japanese', false)).toBe('Auto Detect → Japanese');
    // Right to left, the heard language is on the right: the arrow points left.
    expect(pairLabel('اكتشاف تلقائي', 'اليابانية', true)).toBe('اكتشاف تلقائي ← اليابانية');
  });
});

describe('the status line', () => {
  it('has nothing to say before the first Start', () => {
    expect(statusLine(t, 'idle', '')).toBe('');
  });

  it('says a Stop is under way until the session has ended', () => {
    expect(statusLine(t, 'stopping', '')).toBe('mobile.main.status.stopping');
  });

  it('names the known ends and passes any other detail through', () => {
    expect(statusLine(t, 'error', 'balance_exhausted')).toBe('mobile.main.status.balanceExhausted');
    expect(statusLine(t, 'error', 'socket closed 1006')).toBe('socket closed 1006');
    expect(statusLine(t, 'leasing', '')).toBe('mobile.main.status.starting');
  });

  it('marks a failure as one, so it is not read like the other states', () => {
    expect(statusTone('error')).toBe('error');
    expect(statusTone('reconnecting')).toBe('warning');
    expect(statusTone('listening')).toBe('normal');
  });
});

import { describe, it, expect } from 'vitest';
import { createTranscript } from './transcript';

const tok = (text: string, status: 'original' | 'translation', is_final = true) => ({
  text,
  is_final,
  translation_status: status,
  language: status === 'original' ? 'en' : 'zh',
});

describe('createTranscript', () => {
  it('turns original and translation tokens into one exchange entry', () => {
    const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
    t.message([tok('Good ', 'original'), tok('morning.', 'original'), tok('<end>', 'original')]);
    t.message([tok('早上好。', 'translation'), tok('<end>', 'translation')]);
    const entries = t.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'exchange', leg: 'participant' });
    const e = entries[0];
    expect(e.kind === 'exchange' && e.source.map((r) => r.text).join('')).toBe('Good morning.');
    expect(e.kind === 'exchange' && e.translation.map((r) => r.text).join('')).toBe('早上好。');
  });

  it('keeps non-final text visible as the open row', () => {
    const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
    t.message([tok('Good ', 'original', false)]);
    expect(t.entries()).toHaveLength(1);
  });

  it('notifies subscribers once per message, not per token', () => {
    const t = createTranscript({ source: 'en', target: 'zh', sessionId: 's1' });
    let n = 0;
    t.subscribe(() => { n += 1; });
    t.message([tok('a', 'original'), tok('b', 'original'), tok('c', 'original')]);
    expect(n).toBe(1);
  });
});

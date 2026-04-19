import { describe, it, expect } from 'vitest';
import { buildDefaultLocalPrompt } from './prompts';

describe('buildDefaultLocalPrompt', () => {
  it('includes native and english target names plus language-specific fillers', () => {
    const p = buildDefaultLocalPrompt('ja', 'en');
    expect(p).toContain('Japanese');
    expect(p).toContain('English');
    // Filler list is computed from both ends of the language pair
    expect(p).toContain('um');
    expect(p).toContain('えーと');
    // Source-to-target direction stated
    expect(p).toContain('from Japanese to English');
    // Transcript-tag convention retained
    expect(p).toContain('<transcript>');
  });

  it('uses native-name decoration for target when available', () => {
    const p = buildDefaultLocalPrompt('en', 'zh');
    // tgt label like "中文 (Chinese)"
    expect(p).toContain('中文 (Chinese)');
  });

  it('falls back to raw codes and default fillers for unknown languages', () => {
    const p = buildDefaultLocalPrompt('xx', 'yy');
    expect(p).toContain('from xx to yy');
    expect(p).toContain('um');
    expect(p).toContain('uh');
  });

  it('handles same-language pairs without duplicating fillers', () => {
    const p = buildDefaultLocalPrompt('en', 'en');
    const umOccurrences = (p.match(/\bum\b/g) || []).length;
    expect(umOccurrences).toBe(1);
  });

  it('does not include /no_think (that is a worker-side Qwen3 switch)', () => {
    const p = buildDefaultLocalPrompt('ja', 'en');
    expect(p).not.toContain('/no_think');
  });
});

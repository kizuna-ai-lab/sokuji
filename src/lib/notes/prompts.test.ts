// The prompts of the post-meeting notes: the texts the tested scripts build, in the decided configuration.
import { describe, it, expect } from 'vitest';
import texts from './prompts.json';
import { finishPrompt, LIVE_PROMPT_VERSION, livePrompt, namesPrompt, NOTES_PROMPT_VERSION, partPrompt } from './prompts';

/** A short fingerprint of a text: an edit to a prompt is a deliberate change of NOTES_PROMPT_VERSION. */
const fingerprint = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
};

describe('the notes prompts', () => {
  it('are the extracted texts with the language filled in', () => {
    expect(partPrompt('Japanese', false)).toBe(texts.part_single.replace('__LANGUAGE__', 'Japanese'));
    expect(partPrompt('Japanese', true)).toBe(texts.part_multi.replace('__LANGUAGE__', 'Japanese'));
    expect(finishPrompt('Chinese (Simplified)')).toContain('Write every free-text value in Chinese (Simplified).');
    expect(namesPrompt()).toBe(texts.names);
  });

  it('anchor every point to a sentence number, never a time', () => {
    for (const p of [partPrompt('English', false), partPrompt('English', true), finishPrompt('English'), namesPrompt()]) {
      expect(p).not.toContain('start_ms');
      expect(p).not.toContain('__LANGUAGE__');
    }
    expect(partPrompt('English', false)).toContain('`sid`');
    expect(partPrompt('English', true)).toContain('`part` says which one');
    expect(partPrompt('English', false)).not.toContain('`part` says which one');
    expect(finishPrompt('English')).toContain('`drop`');
    expect(namesPrompt()).toContain('`heard`');
  });

  it('change only with their version', () => {
    expect(NOTES_PROMPT_VERSION).toBe(1);
    expect(Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, fingerprint(v)]))).toMatchInlineSnapshot(`
      {
        "finish": "9e6a4177",
        "live": "4e240150",
        "names": "7d863b8c",
        "part_multi": "cc29de31",
        "part_single": "c200fa53",
      }
    `);
  });

  it('include the live notes prompt, in its own version (stage 4)', () => {
    expect(livePrompt('__LANGUAGE__')).toBe((texts as Record<string, string>).live);
    expect(livePrompt('Japanese')).toContain('Write every free-text value in Japanese.');
    expect(livePrompt('Japanese')).not.toContain('start_ms');
    expect(livePrompt('Japanese')).toContain('`withdraw`');
    expect(LIVE_PROMPT_VERSION).toBe(1);
  });
});

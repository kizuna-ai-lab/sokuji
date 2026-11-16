// Subtitles from a record's cues: SRT and WebVTT.
import { describe, it, expect } from 'vitest';
import { renderSrt, renderVtt, type Cue } from './subtitles';

const cue = (s: number, e: number, ...lines: string[]): Cue => ({ startMs: s, endMs: e, lines });

describe('subtitles', () => {
  it('writes SRT with numbers, comma milliseconds and a blank line after each cue', () => {
    expect(renderSrt([cue(1500, 4000, '下周三之前能交货吗？', 'Can you ship by Wednesday?'), cue(3_723_004, 3_725_000, 'Yes.')])).toBe(
      '1\n00:00:01,500 --> 00:00:04,000\n下周三之前能交货吗？\nCan you ship by Wednesday?\n\n2\n01:02:03,004 --> 01:02:05,000\nYes.\n\n');
  });

  it('writes WebVTT with its header, dot milliseconds and escaped text', () => {
    expect(renderVtt([cue(0, 2000, 'a < b & c --> d')])).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\na &lt; b &amp; c -> d\n\n');
  });

  it('gives a cue at least a second unless the next one starts sooner', () => {
    expect(renderSrt([cue(1000, 1000, 'one'), cue(1400, 1400, 'two'), cue(9000, 9000, 'three')])).toContain('00:00:01,000 --> 00:00:01,400\none');
    expect(renderSrt([cue(9000, 9000, 'three')])).toContain('00:00:09,000 --> 00:00:10,000');
  });

  it('skips cues without text and keeps the numbering continuous', () => {
    expect(renderSrt([cue(0, 1000, '  '), cue(2000, 3000, 'kept')])).toBe('1\n00:00:02,000 --> 00:00:03,000\nkept\n\n');
  });

  it('writes hours past 99 as they are', () => {
    expect(renderSrt([cue(100 * 3_600_000, 100 * 3_600_000 + 1000, 'late')])).toContain('100:00:00,000 --> 100:00:01,000');
  });
});

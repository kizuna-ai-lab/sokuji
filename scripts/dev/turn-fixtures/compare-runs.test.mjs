// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { compareRuns, formatReport, judge, median, readRuns, spreadOf } from './compare-runs.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILES = ['umbrella', 'door', 'meeting', 'book'];

/** A run of four sentences; `over` changes a field of some (by file name) or all of them. */
const run = (model, { heard = 4, translated = 4, shift = 0, latency = 1000 } = {}) => ({
  model,
  sentences: FILES.map((file, i) => ({
    file,
    heard: i < heard,
    translated: i < translated,
    startMs: 1000 * i + shift,
    endMs: 1000 * i + 800 + shift,
    latencyMs: latency,
  })),
});
const metric = (result, model, name) => result.models.find((m) => m.model === model).metrics.find((m) => m.name === name);

describe('median and spread', () => {
  it('takes the middle, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('is max minus min', () => {
    expect(spreadOf([5, 9, 7])).toBe(4);
    expect(spreadOf([])).toBeNull();
  });
});

describe('judge: the after side may differ from the before side by the before side\'s spread', () => {
  it('higher-is-better passes at before - spread and fails below it', () => {
    expect(judge('heard', 'higher', [8, 7, 8], [7]).verdict).toBe('PASS'); // median 8, spread 1: 7 is allowed
    expect(judge('heard', 'higher', [8, 7, 8], [6]).verdict).toBe('FAIL');
  });
  it('lower-is-better passes at before + spread and fails above it', () => {
    expect(judge('latency', 'lower', [1000, 1100, 1200], [1300]).verdict).toBe('PASS'); // median 1100, spread 200
    expect(judge('latency', 'lower', [1000, 1100, 1200], [1301]).verdict).toBe('FAIL');
  });
  it('is n/a with no numbers on a side', () => {
    expect(judge('shift', 'lower', [], [3]).verdict).toBe('n/a');
  });
  it('fails when the before side measured it and the after side has nothing: evidence went missing', () => {
    expect(judge('latency', 'lower', [1000, 1100], []).verdict).toBe('FAIL');
  });
});

describe('compareRuns', () => {
  const before = [run('whisper', { heard: 4 }), run('whisper', { heard: 3 }), run('whisper', { heard: 4 })];

  it('passes when the after runs equal the before runs', () => {
    const result = compareRuns(before, before.map((r) => structuredClone(r)));
    expect(result.verdict).toBe('PASS');
    expect(result.models[0].metrics.map((m) => m.verdict)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });

  it('passes a heard count one below the before median when the before runs vary by one', () => {
    const after = [run('whisper', { heard: 3 }), run('whisper', { heard: 3 }), run('whisper', { heard: 3 })];
    expect(metric(compareRuns(before, after), 'whisper', 'heard').verdict).toBe('PASS'); // before median 4, spread 1
  });

  it('fails when fewer sentences are heard than the spread allows', () => {
    const stable = [run('whisper'), run('whisper'), run('whisper')]; // spread 0
    const after = [run('whisper', { heard: 3 }), run('whisper', { heard: 3 }), run('whisper', { heard: 3 })];
    const result = compareRuns(stable, after);
    expect(metric(result, 'whisper', 'heard').verdict).toBe('FAIL');
    expect(result.verdict).toBe('FAIL');
    expect(formatReport(result)).toContain('FAIL: heard');
  });

  it('fails when fewer sentences are translated', () => {
    const stable = [run('whisper'), run('whisper')];
    const result = compareRuns(stable, [run('whisper', { translated: 2 }), run('whisper', { translated: 2 })]);
    expect(metric(result, 'whisper', 'translated').verdict).toBe('FAIL');
  });

  it('measures the boundary shift against the before side\'s median, and fails a shift beyond its spread', () => {
    // The before runs sit 0, 20 and 40 ms from one another: the reference is the middle one, so they are 20, 0 and 20 ms
    // from it (median 20, spread 20).
    const noisy = [run('whisper', { shift: 0 }), run('whisper', { shift: 20 }), run('whisper', { shift: 40 })];
    const near = compareRuns(noisy, [run('whisper', { shift: 40 })]);
    expect(metric(near, 'whisper', 'shift').before).toBe(20);
    expect(metric(near, 'whisper', 'shift').spread).toBe(20);
    expect(metric(near, 'whisper', 'shift').after).toBe(20);
    expect(metric(near, 'whisper', 'shift').verdict).toBe('PASS'); // 20 <= 20 + 20
    const far = compareRuns(noisy, [run('whisper', { shift: 120 })]);
    expect(metric(far, 'whisper', 'shift').after).toBe(100);
    expect(metric(far, 'whisper', 'shift').verdict).toBe('FAIL');
  });

  it('fails the shift when an after run loses an end boundary the before runs have', () => {
    const before = [run('m'), run('m'), run('m')];
    const lost = run('m');
    lost.sentences.forEach((x) => { x.endMs = null; });
    const result = compareRuns(before, [lost, lost, lost]);
    expect(metric(result, 'm', 'shift').verdict).toBe('FAIL');
  });

  it('fails a latency beyond the before side\'s spread and passes one within it', () => {
    const base = [run('whisper', { latency: 900 }), run('whisper', { latency: 1000 }), run('whisper', { latency: 1100 })];
    expect(metric(compareRuns(base, [run('whisper', { latency: 1200 })]), 'whisper', 'latency').verdict).toBe('PASS'); // 1200 <= 1000 + 200
    expect(metric(compareRuns(base, [run('whisper', { latency: 1250 })]), 'whisper', 'latency').verdict).toBe('FAIL');
  });

  it('does not let a missing timing decide: shift and latency are n/a, the rest still judged', () => {
    const bare = (r) => ({ ...r, sentences: r.sentences.map(({ file, heard, translated }) => ({ file, heard, translated })) });
    const result = compareRuns([bare(run('sensevoice'))], [bare(run('sensevoice'))]);
    expect(metric(result, 'sensevoice', 'shift').verdict).toBe('n/a');
    expect(metric(result, 'sensevoice', 'latency').verdict).toBe('n/a');
    expect(result.verdict).toBe('PASS');
  });

  it('judges each model on its own and fails the whole when one fails', () => {
    const result = compareRuns(
      [run('whisper'), run('sensevoice')],
      [run('whisper'), run('sensevoice', { heard: 1 })],
    );
    expect(result.models.map((m) => [m.model, m.verdict])).toEqual([['sensevoice', 'FAIL'], ['whisper', 'PASS']]);
    expect(result.verdict).toBe('FAIL');
  });

  it('fails a model that has no runs on one side, and a comparison of nothing', () => {
    const result = compareRuns([run('whisper')], []);
    expect(result.models[0].verdict).toBe('FAIL');
    expect(result.models[0].note).toMatch(/after side/);
    expect(compareRuns([], []).verdict).toBe('FAIL');
  });
});

describe('readRuns', () => {
  it('refuses a run with no sentences', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-runs-'));
    try {
      fs.writeFileSync(path.join(dir, 'run-1.json'), JSON.stringify({ model: 'whisper', sentences: [] }));
      expect(() => readRuns(dir)).toThrow(/no sentences/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

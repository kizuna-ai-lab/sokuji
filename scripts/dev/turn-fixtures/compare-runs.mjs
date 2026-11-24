// Compares two sets of runs of e2e/specs/real-local-turns.spec.ts (a "before" build and an "after" build) and prints,
// per model, whether the after side is no worse than the before side's own run-to-run spread:
//
//   node scripts/dev/turn-fixtures/compare-runs.mjs <before-dir> <after-dir>
//
// A results folder holds one JSON file per run, as the spec writes them:
//   { build, model, adapter, sentences: [{ file, heard, translated, startMs, endMs, latencyMs }] }
// Files of several models may share a folder; runs are grouped by their `model`.
//
// Per run, four numbers:
//   heard       sentences whose words were heard
//   translated  sentences whose English carried the expected word
//   shift       mean |boundary shift| in ms: for each sentence's start and end, the distance from the before side's
//               median of that boundary (the reference, taken per sentence over the before runs). The before runs are
//               measured against the same reference, so their own shift is the noise the after side is allowed.
//   latency     mean ms from the end of the clip to the segment opening
// Per model, each is the median over its runs, and `spread` is the before side's max - min.
// PASS when after >= before - spread (heard, translated) and after <= before + spread (shift, latency).
// A number with no data on a side (a service that gives no timing) is "n/a" and does not decide the verdict; a model
// missing on one side, or with no runs, FAILs: nothing passes on missing evidence.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Which way is better, per metric. */
export const METRICS = [
  { name: 'heard', better: 'higher' },
  { name: 'translated', better: 'higher' },
  { name: 'shift', better: 'lower' },
  { name: 'latency', better: 'lower' },
];

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

/** The median of a list of numbers (the mean of the two middle ones for an even count); null for none. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const mean = (values) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

/** max - min of the numbers; null for none. */
export function spreadOf(values) {
  return values.length === 0 ? null : Math.max(...values) - Math.min(...values);
}

/** Per sentence file, the median start and end over the runs that have them. */
export function boundaryReference(runs) {
  const starts = new Map();
  const ends = new Map();
  for (const run of runs) {
    for (const s of run.sentences) {
      if (finite(s.startMs)) starts.set(s.file, [...(starts.get(s.file) ?? []), s.startMs]);
      if (finite(s.endMs)) ends.set(s.file, [...(ends.get(s.file) ?? []), s.endMs]);
    }
  }
  const reference = new Map();
  for (const file of new Set([...starts.keys(), ...ends.keys()])) {
    reference.set(file, { startMs: median(starts.get(file) ?? []), endMs: median(ends.get(file) ?? []) });
  }
  return reference;
}

/** One run's four numbers (null where the run has nothing to measure), the shift against `reference`. */
export function measureRun(run, reference) {
  const shifts = [];
  for (const s of run.sentences) {
    const ref = reference.get(s.file);
    if (!ref) continue;
    if (finite(s.startMs) && finite(ref.startMs)) shifts.push(Math.abs(s.startMs - ref.startMs));
    if (finite(s.endMs) && finite(ref.endMs)) shifts.push(Math.abs(s.endMs - ref.endMs));
  }
  return {
    heard: run.sentences.filter((s) => s.heard).length,
    translated: run.sentences.filter((s) => s.translated).length,
    shift: mean(shifts),
    latency: mean(run.sentences.map((s) => s.latencyMs).filter(finite)),
  };
}

/** One metric's verdict: median and spread of the before side, median of the after side, and PASS, FAIL or n/a. */
export function judge(name, better, beforeValues, afterValues) {
  const before = median(beforeValues);
  const after = median(afterValues);
  const spread = spreadOf(beforeValues);
  if (before === null) return { name, better, before, after, spread, verdict: 'n/a' }; // nothing to judge against
  // The before side measured it and the after side did not: the evidence went missing, which is not a pass.
  if (after === null) return { name, better, before, after, spread, verdict: 'FAIL' };
  const ok = better === 'higher' ? after >= before - spread : after <= before + spread;
  return { name, better, before, after, spread, verdict: ok ? 'PASS' : 'FAIL' };
}

/**
 * `before` and `after` are lists of runs (`{ model, sentences }`). The result lists every model found on either side,
 * with its metrics and a verdict; `verdict` is PASS only when every model passes.
 */
export function compareRuns(before, after) {
  const group = (runs) => {
    const byModel = new Map();
    for (const run of runs) byModel.set(run.model, [...(byModel.get(run.model) ?? []), run]);
    return byModel;
  };
  const b = group(before);
  const a = group(after);
  const models = [...new Set([...b.keys(), ...a.keys()])].sort().map((model) => {
    const beforeRuns = b.get(model) ?? [];
    const afterRuns = a.get(model) ?? [];
    if (beforeRuns.length === 0 || afterRuns.length === 0) {
      return { model, runs: { before: beforeRuns.length, after: afterRuns.length }, metrics: [], verdict: 'FAIL', note: `runs missing on the ${beforeRuns.length === 0 ? 'before' : 'after'} side` };
    }
    const reference = boundaryReference(beforeRuns);
    const beforeNumbers = beforeRuns.map((run) => measureRun(run, reference));
    const afterNumbers = afterRuns.map((run) => measureRun(run, reference));
    const metrics = METRICS.map(({ name, better }) => judge(
      name, better,
      beforeNumbers.map((n) => n[name]).filter(finite),
      afterNumbers.map((n) => n[name]).filter(finite),
    ));
    return { model, runs: { before: beforeRuns.length, after: afterRuns.length }, metrics, verdict: metrics.some((m) => m.verdict === 'FAIL') ? 'FAIL' : 'PASS' };
  });
  return { models, verdict: models.length > 0 && models.every((m) => m.verdict === 'PASS') ? 'PASS' : 'FAIL' };
}

const num = (x) => (x === null ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(1));

/** The comparison as a Markdown table, for a pull request's description. */
export function formatReport(result) {
  const lines = ['| model | metric | before median | before spread | after median | verdict |', '|---|---|---|---|---|---|'];
  for (const m of result.models) {
    if (m.metrics.length === 0) lines.push(`| ${m.model} | - | - | - | - | FAIL (${m.note}) |`);
    for (const x of m.metrics) {
      const unit = x.name === 'shift' || x.name === 'latency' ? ' ms' : '';
      lines.push(`| ${m.model} | ${x.name} (${x.better} is better) | ${num(x.before)}${x.before === null ? '' : unit} | ${num(x.spread)} | ${num(x.after)}${x.after === null ? '' : unit} | ${x.verdict === 'FAIL' ? `FAIL: ${x.name}` : x.verdict} |`);
    }
  }
  lines.push('', `Overall: ${result.verdict}${result.verdict === 'FAIL' ? ` (${result.models.filter((m) => m.verdict === 'FAIL').map((m) => m.model).join(', ') || 'no runs found'})` : ''}`);
  return lines.join('\n');
}

/** Every run in a results folder: the `.json` files in it, each `{ model, sentences }`. */
export function readRuns(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir}: not a directory`);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = path.join(dir, f);
    let run;
    try { run = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file}: ${error.message}`); }
    if (typeof run?.model !== 'string' || !Array.isArray(run.sentences)) throw new Error(`${file}: not a run (needs model and sentences)`);
    if (run.sentences.length === 0) throw new Error(`${file}: a run with no sentences is no evidence`);
    return run;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [beforeDir, afterDir] = process.argv.slice(2);
  if (!beforeDir || !afterDir) {
    console.error('usage: node scripts/dev/turn-fixtures/compare-runs.mjs <before-dir> <after-dir>');
    process.exit(2);
  }
  const result = compareRuns(readRuns(beforeDir), readRuns(afterDir));
  console.log(formatReport(result));
  process.exit(result.verdict === 'PASS' ? 0 : 1);
}

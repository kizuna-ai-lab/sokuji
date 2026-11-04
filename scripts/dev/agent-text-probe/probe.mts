/**
 * Agent-text probe (step 1 of the Soniox agent text input experiment): does
 * sending the translation being spoken as Soniox `agent_text` stop the
 * app's own speech, leaking into the microphone, from being recognised as a
 * line — and does it hurt a person talking over the playback? Face-to-face
 * (one shared two_way STT socket, both voices), no echo cancellation, the
 * echo mixed digitally into the STT input. See RUN.md for the runs and their
 * cost, run.ts for the timeline, score.ts for the measures.
 *
 *   SONIOX_API_KEY_FILE=path npx tsx scripts/dev/agent-text-probe/probe.mts <pair> --agent-text <condition> [options]
 *   npx tsx scripts/dev/agent-text-probe/probe.mts <pair> --agent-text <condition> --fake      (dry run: no key, no network)
 *   npx tsx scripts/dev/agent-text-probe/probe.mts --rescore <log.jsonl>
 *   npx tsx scripts/dev/agent-text-probe/probe.mts --compare <dir>
 *
 * pair: zh-ja | zh-en. condition: none | speak | enqueue | lead.
 * Options (defaults in brackets):
 *   --echo on|off [on]          mix the echo into the microphone
 *   --echo-delay-ms [120]       play time → microphone
 *   --echo-gain-db [-6]         the echo relative to the voices
 *   --voice-dbfs [-20]          every human clip's active level
 *   --tts-dbfs [-20]            the TTS level the echo gain assumes (the summary's levels report the real one)
 *   --rir-rt60 [0]              seconds; 0 = no room response. --rir-drr-db [10], --rir-seed [1]
 *   --lead-ms [700]             the `lead` condition's lead over playback
 *   --close-segments on|off [on]  send end_of_segment
 *   --region us|eu|jp [jp]      the key's region
 *   --turns N [all]             only the first N turns of the script
 *   --out DIR [.superpowers/agent-text-probe/<live|fake>]
 *
 * Writes <stamp>-<pair>-<condition>[-echo-off].jsonl (every event, token and
 * frame; the key never), .in.wav (what the microphone captured: the voices
 * plus the echo), .out.wav (what was played), .summary.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLE_RATE } from '../../../src/lib/contract/adapter';
import type { SonioxRegion } from '../../../src/lib/soniox/regions';
import { REPO, readWav, writeWav } from '../wire-probe/common.mts';
import { CONDITIONS, type Condition } from './agentText';
import { DEFAULTS, fakeEnv, liveEnv, runProbe, type ProbeOptions } from './run';
import { buildScript, PAIRS } from './script';
import { score, type LogLine, type Summary } from './score';

const VALUED = new Set(['agent-text', 'echo', 'echo-delay-ms', 'echo-gain-db', 'voice-dbfs', 'tts-dbfs', 'rir-rt60', 'rir-drr-db', 'rir-seed', 'lead-ms', 'close-segments', 'region', 'turns', 'out', 'rescore', 'compare']);
const FLAGS = new Set(['fake']);

function parse(argv: string[]): { positional: string[]; opts: Map<string, string>; flags: Set<string> } {
  const positional: string[] = [];
  const opts = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const name = a.slice(2);
    if (FLAGS.has(name)) { flags.add(name); continue; }
    if (!VALUED.has(name)) throw new Error(`unknown option --${name}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${name} needs a value`);
    opts.set(name, v);
  }
  return { positional, opts, flags };
}

const num = (opts: Map<string, string>, name: string, fallback: number): number => {
  const v = opts.get(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name}: not a number: ${v}`);
  return n;
};
const onOff = (opts: Map<string, string>, name: string, fallback: boolean): boolean => {
  const v = opts.get(name);
  if (v === undefined) return fallback;
  if (v !== 'on' && v !== 'off') throw new Error(`--${name} on|off`);
  return v === 'on';
};

const HEADER = '| run | echo lines | spoken back | merged lines | talk-over error rate (turns; D I) | clean error rate | agent texts/ends | chars | server lead p10/p50/p90 ms | errors |\n|---|---|---|---|---|---|---|---|---|---|';

function row(name: string, s: Summary): string {
  const g = (lang: string, k: 'talkOver' | 'clean') => {
    const x = s.humanWer.byLanguage[lang]?.[k];
    return x && x.turns ? `${x.rate} (${x.turns}; D${x.d} I${x.i})` : '-';
  };
  const langs = Object.keys(s.humanWer.byLanguage);
  const lead = s.agentText.serverLeadMs ? `${s.agentText.serverLeadMs.p10}/${s.agentText.serverLeadMs.p50}/${s.agentText.serverLeadMs.p90}` : '-';
  return `| ${name} | ${s.echoLineCount} | ${s.echoTranslatedBack} | ${s.mergedLineCount} | ${langs.map((l) => `${l}: ${g(l, 'talkOver')}`).join('; ')} | ${langs.map((l) => `${l}: ${g(l, 'clean')}`).join('; ')} | ${s.agentText.textFrames}/${s.agentText.endFrames} | ${s.agentText.chars} | ${lead} | ${s.sonioxErrors.length} |`;
}

const { positional, opts, flags } = parse(process.argv.slice(2));

if (opts.has('compare')) {
  const dir = opts.get('compare')!;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.summary.json')).sort();
  console.log(HEADER);
  for (const f of files) console.log(row(f.replace('.summary.json', ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Summary));
  process.exit(0);
}

if (opts.has('rescore')) {
  const log = opts.get('rescore')!;
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogLine);
  const summary = score(lines);
  const out = log.replace(/\.jsonl$/, '.summary.json');
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${HEADER}\n${row(path.basename(log, '.jsonl'), summary)}\n→ ${out}`);
  process.exit(0);
}

const pair = positional[0] ?? '';
if (!PAIRS[pair]) throw new Error(`pair one of: ${Object.keys(PAIRS).join(', ')}`);
const condition = opts.get('agent-text') as Condition | undefined;
if (!condition || !CONDITIONS.includes(condition)) throw new Error(`--agent-text ${CONDITIONS.join('|')}`);
const region = (opts.get('region') ?? DEFAULTS.region) as SonioxRegion;
if (!['us', 'eu', 'jp'].includes(region)) throw new Error('--region us|eu|jp');
const rt60 = num(opts, 'rir-rt60', 0);
const o: ProbeOptions = {
  ...DEFAULTS,
  pair,
  condition,
  echo: onOff(opts, 'echo', DEFAULTS.echo),
  echoDelayMs: num(opts, 'echo-delay-ms', DEFAULTS.echoDelayMs),
  echoGainDb: num(opts, 'echo-gain-db', DEFAULTS.echoGainDb),
  voiceDbfs: num(opts, 'voice-dbfs', DEFAULTS.voiceDbfs),
  ttsDbfs: num(opts, 'tts-dbfs', DEFAULTS.ttsDbfs),
  rir: rt60 > 0 ? { rt60, drrDb: num(opts, 'rir-drr-db', 10), seed: num(opts, 'rir-seed', 1) } : null,
  leadMs: num(opts, 'lead-ms', DEFAULTS.leadMs),
  closeSegments: onOff(opts, 'close-segments', DEFAULTS.closeSegments),
  region,
};
const turns = opts.has('turns') ? num(opts, 'turns', 0) : undefined;
const script = buildScript(pair, { rate: SAMPLE_RATE, voiceDbfs: o.voiceDbfs, ...(turns ? { turns } : {}) }, (file) => readWav(path.join(REPO, file), SAMPLE_RATE));

const fake = flags.has('fake');
let env;
if (fake) {
  env = fakeEnv(script, o).env;
} else {
  const keyFile = process.env.SONIOX_API_KEY_FILE;
  const key = (keyFile ? fs.readFileSync(keyFile, 'utf8') : process.env.SONIOX_API_KEY ?? '').trim();
  if (!key) throw new Error('SONIOX_API_KEY_FILE or SONIOX_API_KEY (or --fake for the dry run)');
  env = liveEnv(key, region);
}

const outDir = opts.get('out') ?? path.join(REPO, `.superpowers/agent-text-probe/${fake ? 'fake' : 'live'}`);
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = path.join(outDir, `${stamp}-${pair}-${condition}${o.echo ? '' : '-echo-off'}`);
console.log(`${fake ? 'dry run' : 'LIVE (billed)'}: ${pair}, agent text ${condition}, echo ${o.echo ? `${o.echoDelayMs} ms ${o.echoGainDb} dB${o.rir ? ` rt60 ${o.rir.rt60}s` : ''}` : 'off'}, ${script.turns.length} turns, ${(script.durationMs / 1000).toFixed(1)} s of script`);
const result = await runProbe(o, script, env);
fs.writeFileSync(`${base}.jsonl`, `${result.lines.join('\n')}\n`);
writeWav(`${base}.in.wav`, result.mic, SAMPLE_RATE);
writeWav(`${base}.out.wav`, result.out, SAMPLE_RATE);
fs.writeFileSync(`${base}.summary.json`, `${JSON.stringify(result.summary, null, 2)}\n`);
console.log(`${HEADER}\n${row(path.basename(base), result.summary)}`);
console.log(`→ ${base}.{jsonl,in.wav,out.wav,summary.json}`);
process.exit(0);

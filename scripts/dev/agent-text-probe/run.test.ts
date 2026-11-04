/**
 * The whole probe, dry: the app's adapter in face-to-face against
 * `FakeSoniox` on a virtual clock, three turns of the zh-ja script. What
 * is checked is the pipeline — the timeline, the echo, the agent text on
 * the wire, the summary — not Soniox (the stand-in's suppression is an
 * assumption).
 */
import { describe, expect, it } from 'vitest';
import { LegSpeech } from '../../../src/providers/soniox/speech';
import { SAMPLE_RATE } from '../../../src/lib/contract/adapter';
import type { FakeSocket } from '../../../src/lib/contract/testing/fakeSocket';
import type { Condition } from './agentText';
import { DEFAULTS, fakeEnv, runProbe } from './run';
import { buildScript } from './script';

const load = () => Int16Array.from({ length: SAMPLE_RATE * 10 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / SAMPLE_RATE))));
const script = buildScript('zh-ja', { rate: SAMPLE_RATE, voiceDbfs: -20, turns: 3 }, load);

async function dry(condition: Condition, echo = true) {
  const o = { ...DEFAULTS, pair: 'zh-ja', condition, echo, tailMaxMs: 20_000 };
  const { env, fake } = fakeEnv(script, o);
  const result = await runProbe(o, script, env);
  const lines = result.lines.map((l) => JSON.parse(l) as { t: number; kind: string; d?: any });
  const stt = fake.sockets.filter((s) => s.url.endsWith('/transcribe-websocket')) as FakeSocket[];
  const wire = stt.flatMap((s) => s.sent.filter((d): d is string => typeof d === 'string' && d !== '').map((d) => JSON.parse(d) as Record<string, unknown>));
  return { result, lines, fake, stt, wire, of: (kind: string) => lines.filter((l) => l.kind === kind) };
}

describe('the probe, dry', () => {
  it('none: no agent text anywhere; every 100-ms microphone frame reaches the one STT socket; the echo is in the microphone', async () => {
    const h = await dry('none');
    expect(h.stt).toHaveLength(1);
    expect(h.wire[0]).toMatchObject({ model: 'stt-rt-v6', translation: { type: 'two_way', language_a: 'zh', language_b: 'ja' }, enable_speaker_diarization: true });
    expect(h.wire[0]).not.toHaveProperty('enable_agent_text_input');
    expect(h.wire.filter((m) => m.type === 'agent_text')).toEqual([]);
    expect(h.of('agent')).toEqual([]);
    const end = h.of('end')[0].d;
    // Pushed one ahead of the ticks: the mixer never zero-fills, never backs up.
    expect(end.framesPushed).toBe(end.framesSent + 1);
    const binary = h.stt[0].sent.filter((d) => typeof d !== 'string') as Int16Array[];
    expect(binary).toHaveLength(end.framesSent);
    expect(binary.every((f) => f.length === SAMPLE_RATE / 10)).toBe(true);
    // The mixer's 0.5 gain, nothing else: what was sent is half the microphone.
    expect(binary[12][100]).toBe(Math.round(h.result.mic[12 * 2400 + 100] * 0.5));
    // Echo at -6 dB under the voices, and in the microphone where a clip's echo lands.
    expect(h.result.summary.levels).toMatchObject({ echoToVoiceDb: -6, clippedSamples: 0 });
    const clip = h.of('audio')[0].d;
    const at = Math.round((clip.micFrom * SAMPLE_RATE) / 1000);
    const human = script.pcm.subarray(at, at + 2400);
    const heard = h.result.mic.subarray(at, at + 2400);
    expect(heard.some((v, i) => v !== (human[i] ?? 0))).toBe(true);
    // The stand-in recognises every echo: the baseline has echo lines, translated and spoken back.
    expect(h.result.summary.echoLineCount + h.result.summary.mergedLineCount).toBeGreaterThan(0);
    expect(h.result.summary.humanWer.turns).toHaveLength(3);
    expect(h.result.summary.inputTextTokens).toBeNull();
    expect(h.result.summary.warnings).toEqual([]);
  });

  it('echo off: the microphone is the script alone', async () => {
    const h = await dry('none', false);
    const n = h.result.mic.length;
    expect(h.result.mic).toEqual(Int16Array.from({ length: n }, (_, i) => script.pcm[i] ?? 0));
    expect(h.fake.stats.echoesHeard).toBe(0);
    expect(h.result.summary.echoLineCount).toBe(0);
    expect(h.result.summary.humanWer.turns.every((t) => t.rate === 0)).toBe(true);
  });

  it('lead: agent text on, sent on the shared socket as logged, at most the lead (plus the pipeline) ahead of its echo', async () => {
    const h = await dry('lead');
    expect(h.wire[0]).toMatchObject({ enable_agent_text_input: true });
    const onWire = h.wire.filter((m) => m.type === 'agent_text');
    const logged = h.of('agent').filter((l) => l.d.sent).map((l) => ({ type: 'agent_text', text: l.d.text, end_of_segment: l.d.end }));
    expect(onWire).toEqual(logged);
    expect(onWire.length).toBeGreaterThan(2);
    expect(onWire.filter((m) => m.end_of_segment)).not.toHaveLength(0);
    const s = h.result.summary;
    expect(s.agentText.serverLeadMs!.max).toBeLessThanOrEqual(DEFAULTS.leadMs + DEFAULTS.echoDelayMs + 200);
    expect(s.agentText.chars).toBeGreaterThan(0);
    // The stand-in's assumption: covered echo is left out.
    expect(s.echoLineCount).toBe(0);
    expect(h.fake.stats.echoesSuppressed).toBeGreaterThan(0);
  });

  it('speak: the text handed to synthesis is the agent text, and the watch on LegSpeech is undone after the run', async () => {
    const speak = LegSpeech.prototype.speak;
    const h = await dry('speak');
    expect(LegSpeech.prototype.speak).toBe(speak);
    const spoken = h.of('speak').map((l) => l.d.text);
    const texts = h.wire.filter((m) => m.type === 'agent_text' && !m.end_of_segment).map((m) => m.text);
    expect(spoken.length).toBeGreaterThan(0);
    expect(texts).toEqual(spoken);
  });
});

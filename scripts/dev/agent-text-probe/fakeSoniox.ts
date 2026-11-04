/**
 * A stand-in for Soniox, for the probe's dry run: the whole pipeline with no
 * key and no network, on a virtual clock. It speaks the wire the app's
 * `sttStream.ts` / `ttsStream.ts` speak, over `FakeSocket`s.
 *
 * It does not recognise audio. It knows what the microphone holds — the
 * script's human turns, and every echo the probe places (`placeEcho`, the
 * played clip's text, which its own TTS made) — and, as the audio position
 * passes each sound plus an endpoint pause, it "recognises" it: final
 * original tokens with their times, a two_way translation (the text wrapped
 * in a marker: 「…」 Japanese, 【…】 Chinese, "…" English), `<end>`.
 *
 * Its agent-text behaviour is an assumption, there only so the scorer has
 * something to tell apart: an echo is left out when agent text covering it
 * (≥ 80 % of its units, in order) arrived no later than 200 ms after the
 * echo began. Like the real server, it ends the stream with an error on an
 * `agent_text` frame when the config did not enable agent text, and refuses
 * the flag on a model other than stt-rt-v6. None of this predicts Soniox.
 *
 * Its TTS answers each stream at `text_end` (the real one may start
 * earlier): speech-like noise (`echoSim.renderSpeech`) as long as the text
 * takes at the app's prior pace, 8192-sample chunks at twice real time
 * after 200 ms, then `terminated`.
 */
import { SAMPLE_RATE } from '../../../src/lib/contract/adapter';
import type { Clock } from '../../../src/lib/contract/clock';
import { priorSeconds } from '../../../src/lib/contract/ranges';
import { FakeSocket, type SocketData } from '../../../src/lib/contract/testing/fakeSocket';
import { makeRng, renderSpeech } from '../../../src/lib/modern-audio/echoSim';
import { countSkeleton } from '../../../src/lib/segmentation/sealCursor';
import { clampInt16, normalizeActive } from './audio';
import { byChars, coverage, units } from './text';

// Node 20 has no CloseEvent; FakeSocket fires one on every close.
if (typeof (globalThis as { CloseEvent?: unknown }).CloseEvent === 'undefined') {
  (globalThis as Record<string, unknown>).CloseEvent = class CloseEvent extends Event {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
    constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
      super(type);
      this.code = init.code ?? 0;
      this.reason = init.reason ?? '';
      this.wasClean = init.wasClean ?? false;
    }
  };
}

class ServerSocket extends FakeSocket {
  onClient: ((data: SocketData) => void) | null = null;
  send(data: SocketData): void {
    const open = this.readyState === FakeSocket.OPEN;
    super.send(data);
    if (open) this.onClient?.(data);
  }
}

export interface FakeHuman {
  fromMs: number;
  toMs: number;
  lang: string;
  text: string;
  side: string;
}

interface Sound {
  fromMs: number;
  toMs: number;
  lang: string;
  text: string;
  kind: 'human' | 'echo';
  speaker: string;
  decided?: boolean;
  suppressed?: boolean;
  emitted?: boolean;
}

export interface FakeSonioxOptions {
  clock: Pick<Clock, 'setTimeout'>;
  humans: readonly FakeHuman[];
  /** Silence after a sound before it is recognised. */
  endpointMs?: number;
  /** The level the TTS speaks at, dBFS. */
  ttsDbfs?: number;
}

export interface FakeSonioxStats {
  configs: unknown[];
  agentTexts: number;
  agentEnds: number;
  echoesHeard: number;
  echoesSuppressed: number;
  errors: string[];
}

const MARK: Record<string, [string, string]> = { ja: ['「', '」'], zh: ['【', '】'], en: ['"', '"'] };
export const fakeTranslate = (text: string, to: string): string => {
  const [a, b] = MARK[to] ?? ['<', '>'];
  return `${a}${text.trim()}${b}`;
};

/** FNV-1a over the samples: the echo's pcm is the TTS chunk's, decoded. */
function fingerprint(pcm: Int16Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < pcm.length; i++) {
    h ^= pcm[i] & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return `${pcm.length}:${(h >>> 0).toString(16)}`;
}

function pieces(text: string, lang: string): string[] {
  if (byChars(lang)) return [...text].reduce<string[]>((out, ch, i) => (i % 2 === 0 ? [...out, ch] : [...out.slice(0, -1), out[out.length - 1] + ch]), []);
  return text.split(/(?=\s)/).filter((p) => p !== '');
}

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class FakeSoniox {
  readonly sockets: FakeSocket[] = [];
  readonly stats: FakeSonioxStats = { configs: [], agentTexts: 0, agentEnds: 0, echoesHeard: 0, echoesSuppressed: 0, errors: [] };
  private readonly sounds: Sound[];
  private readonly chunks = new Map<string, { text: string; lang: string }>();
  private readonly endpointMs: number;

  constructor(private readonly o: FakeSonioxOptions) {
    this.endpointMs = o.endpointMs ?? 700;
    this.sounds = o.humans.map((h) => ({ fromMs: h.fromMs, toMs: h.toMs, lang: h.lang, text: h.text, kind: 'human', speaker: h.side === 'A' ? '1' : '2' }));
  }

  readonly openSocket = (url: string, protocols: string[]): WebSocket => {
    const socket = new ServerSocket(url, protocols);
    this.sockets.push(socket);
    if (url.endsWith('/transcribe-websocket')) this.stt(socket);
    else this.tts(socket);
    this.o.clock.setTimeout(() => { if (socket.readyState === FakeSocket.CONNECTING) socket.open(); }, 30);
    return socket as unknown as WebSocket;
  };

  /** The probe placed a played clip's echo on the microphone, `fromMs`–`toMs`. */
  placeEcho(pcm: Int16Array, fromMs: number, toMs: number): void {
    const known = this.chunks.get(fingerprint(pcm));
    // Punctuation alone is never recognised as a word.
    if (!known || units(known.text, known.lang).length === 0) return;
    this.stats.echoesHeard++;
    this.sounds.push({ fromMs, toMs, lang: known.lang, text: known.text, kind: 'echo', speaker: '3' });
  }

  private stt(socket: ServerSocket): void {
    let config: Record<string, unknown> | null = null;
    let pos = 0;
    const agent: Array<{ pos: number; text: string }> = [];
    const fail = (message: string) => {
      this.stats.errors.push(message);
      socket.receive(JSON.stringify({ error_code: 400, error_message: message }));
      socket.serverClose(1000, '');
    };
    socket.onClient = (data) => {
      if (socket.readyState !== FakeSocket.OPEN) return;
      if (typeof data !== 'string') {
        const view = data as ArrayBufferView;
        pos += (view.byteLength / 2 / SAMPLE_RATE) * 1000;
        this.recognise(socket, config, pos, agent);
        return;
      }
      if (data === '') {
        this.recognise(socket, config, Infinity, agent);
        socket.receive(JSON.stringify({ tokens: [], finished: true, final_audio_proc_ms: Math.round(pos) }));
        socket.serverClose(1000, '');
        return;
      }
      const m = JSON.parse(data) as Record<string, unknown>;
      if (!config) {
        config = m;
        this.stats.configs.push(m);
        if (m.enable_agent_text_input && m.model !== 'stt-rt-v6') fail('Agent text input is not supported by this model.');
        return;
      }
      if (m.type === 'agent_text') {
        if (!config.enable_agent_text_input) { fail('Agent text requires enable_agent_text_input in the start request.'); return; }
        if (m.end_of_segment) this.stats.agentEnds++;
        if (typeof m.text === 'string' && m.text) { this.stats.agentTexts++; agent.push({ pos, text: m.text }); }
      }
    };
  }

  /** Recognises what the audio position has passed by an endpoint pause; `pos` Infinity flushes. */
  private recognise(socket: ServerSocket, config: Record<string, unknown> | null, pos: number, agent: ReadonlyArray<{ pos: number; text: string }>): void {
    for (const s of this.sounds) {
      if (s.decided || s.toMs > pos) continue;
      s.decided = true;
      if (s.kind !== 'echo') continue;
      const before = agent.filter((a) => a.pos <= s.fromMs + 200 && a.pos >= s.fromMs - 15_000).map((a) => a.text).join('');
      s.suppressed = before !== '' && coverage(s.text, before, s.lang) >= 0.8;
      if (s.suppressed) this.stats.echoesSuppressed++;
    }
    // Per language (two voices and a person can overlap): sounds still being heard are in the list too, as one may yet join a group.
    const translation = config?.translation as { language_a?: string; language_b?: string } | undefined;
    const other = (lang: string) => (translation?.language_a === lang ? translation.language_b : translation?.language_a) ?? 'en';
    const ready: Sound[][] = [];
    const pending = this.sounds.filter((s) => !s.emitted && !s.suppressed && s.fromMs < pos);
    for (const lang of new Set(pending.map((s) => s.lang))) {
      const live = pending.filter((s) => s.lang === lang).sort((a, b) => a.fromMs - b.fromMs);
      while (live.length > 0) {
        const group = [live.shift()!];
        let to = group[0].toMs;
        while (live.length > 0 && live[0].fromMs - to < this.endpointMs) {
          const s = live.shift()!;
          group.push(s);
          to = Math.max(to, s.toMs);
        }
        if (to + this.endpointMs > pos) break;
        ready.push(group);
      }
    }
    for (const group of ready.sort((a, b) => a[0].fromMs - b[0].fromMs)) {
      for (const s of group) s.emitted = true;
      const lang = group[0].lang;
      const tokens: Array<Record<string, unknown>> = [];
      for (const s of group) {
        const ps = pieces(s.text, lang);
        ps.forEach((p, i) => tokens.push({
          text: p, is_final: true, translation_status: 'original', language: lang, speaker: s.speaker,
          start_ms: Math.round(s.fromMs + ((s.toMs - s.fromMs) * i) / ps.length), end_ms: Math.round(s.fromMs + ((s.toMs - s.fromMs) * (i + 1)) / ps.length),
        }));
      }
      const target = other(lang);
      const said = group.map((s) => s.text).join(lang === 'en' ? ' ' : '');
      for (const p of pieces(fakeTranslate(said, target), target)) tokens.push({ text: p, is_final: true, translation_status: 'translation', language: target, source_language: lang });
      tokens.push({ text: '<end>', is_final: true });
      socket.receive(JSON.stringify({ tokens }));
    }
  }

  private tts(socket: ServerSocket): void {
    const streams = new Map<string, { lang: string; text: string }>();
    socket.onClient = (data) => {
      if (typeof data !== 'string') return;
      const m = JSON.parse(data) as Record<string, unknown>;
      const id = m.stream_id as string | undefined;
      if (!id) return;
      if (m.voice !== undefined) { streams.set(id, { lang: String(m.language), text: '' }); return; }
      const s = streams.get(id);
      if (!s) return;
      if (typeof m.text === 'string') s.text += m.text;
      if (m.text_end) this.speak(socket, id, s.lang, s.text);
    };
  }

  private speak(socket: ServerSocket, id: string, lang: string, text: string): void {
    const seconds = Math.max(0.4, countSkeleton(text) * priorSeconds(text));
    const rng = makeRng([...id + text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261));
    const voice = normalizeActive(clampInt16(Array.from(renderSpeech([{ start: 0.05, end: seconds - 0.05 }], seconds, rng), (v) => v * 32767)).pcm, SAMPLE_RATE, this.o.ttsDbfs ?? -20);
    const size = 8192;
    const n = Math.ceil(voice.length / size);
    // Each chunk speaks its share of the text; outside CJK a share ends at a word's end.
    const cut = (i: number) => {
      const at = Math.floor((text.length * i) / n);
      if (i === n || byChars(lang)) return at;
      const space = text.indexOf(' ', at);
      return space < 0 ? text.length : space;
    };
    for (let i = 0; i < n; i++) {
      const pcm = voice.slice(i * size, (i + 1) * size);
      this.chunks.set(fingerprint(pcm), { text: text.slice(Math.min(cut(i), cut(i + 1)), cut(i + 1)), lang });
      this.o.clock.setTimeout(() => {
        if (socket.readyState === FakeSocket.OPEN) socket.receive(JSON.stringify({ stream_id: id, audio: toBase64(pcm), audio_end: i === n - 1 }));
      }, 200 + (i * size * 1000) / SAMPLE_RATE / 2);
    }
    this.o.clock.setTimeout(() => {
      if (socket.readyState === FakeSocket.OPEN) socket.receive(JSON.stringify({ stream_id: id, terminated: true }));
    }, 200 + (n * size * 1000) / SAMPLE_RATE / 2 + 10);
  }
}

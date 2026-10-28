import { sonioxHosts, type SonioxRegion } from '@shared/lib/soniox/regions';
import { SONIOX_REDUCE_SILENCE, SONIOX_TTS_MODEL } from '@shared/lib/soniox/ttsCatalog';
import { BACKEND_URL } from '../backend';
import { post } from './lease';
import { createVoicePreview, PreviewHttpError, type PreviewDeps, type PreviewState } from './preview';

// The desktop's preview request (src/providers/soniox/ttsRest.ts): one HTTPS
// call, raw 16-bit PCM at 24 kHz, paced like the live speech.
const SAMPLE_RATE = 24000;
const SYNTH_TIMEOUT_MS = 20000;

async function httpError(res: Response): Promise<PreviewHttpError> {
  let retryAfterMs: number | undefined;
  try {
    const body = (await res.json()) as { retryAfterMs?: unknown };
    if (typeof body?.retryAfterMs === 'number') retryAfterMs = body.retryAfterMs;
  } catch {
    // No JSON body: the status says enough.
  }
  return new PreviewHttpError(res.status, retryAfterMs);
}

/** The preview on this phone: the account's token, the chosen region, react-native-audio-api for playback. */
export function createNativeVoicePreview(o: {
  /** Read at each request, so a refreshed sign-in or a changed region is what the next preview uses. */
  token: () => string;
  region: () => SonioxRegion;
  onChange: (s: PreviewState) => void;
}) {
  // Loaded here, not at the top: the node tests never construct a context.
  const audio = require('react-native-audio-api') as typeof import('react-native-audio-api');
  let context: InstanceType<typeof audio.AudioContext> | null = null;

  const deps: PreviewDeps = {
    async mintKey(signal) {
      const region = o.region();
      const res = await post(fetch, `${BACKEND_URL}/api/soniox/session-key`, { mode: 'voice_preview', region }, { token: o.token(), signal }, 'preview session-key');
      if (res.status !== 200) throw await httpError(res);
      const body = (await res.json()) as { ttsApiKey?: unknown; region?: unknown };
      if (typeof body?.ttsApiKey !== 'string' || !body.ttsApiKey) throw new Error('preview key missing');
      return { apiKey: body.ttsApiKey, region: (typeof body.region === 'string' ? body.region : region) as SonioxRegion };
    },
    async done() {
      // 204 when billed, 404 when there was nothing to complete: both settle the account. Any
      // other answer leaves it held until the key expires (about 45 s): said in the log, since
      // the next preview or Start would then wait.
      const res = await post(fetch, `${BACKEND_URL}/api/soniox/preview-done`, {}, { token: o.token() }, 'preview-done');
      if (res.status !== 204 && res.status !== 404) console.warn(`preview-done ${res.status}`);
    },
    async synthesize({ apiKey, region, voice, language, text, speed, signal }) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, SYNTH_TIMEOUT_MS);
      try {
        const res = await fetch(`https://${sonioxHosts(region).ttsRt}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: SONIOX_TTS_MODEL,
            voice,
            language,
            text,
            audio_format: 'pcm_s16le',
            sample_rate: SAMPLE_RATE,
            reduce_silence: SONIOX_REDUCE_SILENCE,
            ...(speed !== 1 ? { speed } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw await httpError(res);
        const bytes = await res.arrayBuffer();
        // A zero-byte answer would play as silence: fail instead. An odd tail byte is dropped.
        if (bytes.byteLength < 2) throw new Error('preview empty audio');
        return new Int16Array(bytes.slice(0, bytes.byteLength - (bytes.byteLength % 2)));
      } catch (err) {
        if (timedOut) throw new Error('preview timeout');
        if (signal.aborted) throw new Error('aborted');
        throw err;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
    play(pcm, onEnded) {
      // A preview plays without a session: through whatever is connected, even with the ringer off.
      audio.AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default', iosOptions: [] });
      context ??= new audio.AudioContext({ sampleRate: SAMPLE_RATE });
      const samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
      const buffer = context.createBuffer(1, pcm.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onEnded = () => onEnded();
      source.start();
      return () => {
        try {
          source.stop();
        } catch {
          // Already ended.
        }
      };
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onChange: o.onChange,
    log: (line) => console.log(line),
  };

  const preview = createVoicePreview(deps);
  return {
    ...preview,
    /** Stops any preview and lets the audio go (leaving the screen). */
    async close() {
      preview.stop();
      await context?.close().catch(() => {});
      context = null;
    },
  };
}

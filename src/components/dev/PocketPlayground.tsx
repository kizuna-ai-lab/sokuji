import React, { useCallback, useRef, useState } from 'react';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import { PocketNativeClient } from '../../lib/local-inference/pocketNativeClient';
import { isElectron } from '../../utils/environment';
import './PocketPlayground.scss';

type Status = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

/** Decode any audio file → mono Float32 + its sample rate. */
async function decodeToMono(file: File): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.numberOfChannels;
    if (ch === 1) return { samples: new Float32Array(audio.getChannelData(0)), sampleRate: audio.sampleRate };
    const out = new Float32Array(audio.length);
    for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ch; }
    return { samples: out, sampleRate: audio.sampleRate };
  } finally { await ctx.close(); }
}

export const PocketPlayground: React.FC = () => {
  const engineRef = useRef<TtsEngine | PocketNativeClient | null>(null);
  const refDirty = useRef(true); // re-encode the reference voice only when it changes
  const [useNative, setUseNative] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [backend, setBackend] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState('');
  const [text, setText] = useState('Hello — this is a zero-shot cloned voice running fully in the browser.');
  const [ref, setRef] = useState<{ samples: Float32Array; sampleRate: number } | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [timing, setTiming] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = useCallback((m: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogs((prev) => [...prev, `${ts}  ${m}`]);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading'); setStatusMsg('Loading model…'); addLog('--- load ---');
    const native = useNative && isElectron();
    const engine = native ? new PocketNativeClient() : new TtsEngine();
    engine.onStatus = (m: string) => { setStatusMsg(m); addLog(m); };
    engine.onError = (e: string) => { setStatus('error'); setStatusMsg(e); addLog('ERROR ' + e); };
    engineRef.current = engine;
    try {
      const info = native
        ? await (engine as PocketNativeClient).init()
        : await (engine as TtsEngine).init('pocket-tts');
      setBackend(info.backend ?? 'wasm'); setStatus('ready'); setStatusMsg('Ready');
      addLog(`ready: backend=${info.backend} sampleRate=${info.sampleRate} loadMs=${info.loadTimeMs}`);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setStatus('error'); setStatusMsg(m); addLog('LOAD ERROR ' + m); }
  }, [addLog, useNative]);

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setRef(await decodeToMono(file)); refDirty.current = true; setStatusMsg(`Reference: ${file.name}`);
  }, []);

  const toggleRecord = useCallback(async () => {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      setRef(await decodeToMono(new File([blob], 'recording.webm'))); refDirty.current = true;
      setStatusMsg('Reference: recording captured');
    };
    recorderRef.current = rec; rec.start(); setRecording(true);
  }, [recording]);

  const generate = useCallback(async () => {
    const engine = engineRef.current; if (!engine || !ref) return;
    setStatus('generating'); setStatusMsg('Generating…'); addLog('--- generate ---');
    try {
      const start = performance.now();
      // Re-encode the reference only when it changed; otherwise reuse the cached voice
      // embedding in the worker (skips the Mimi encoder + flow-LM prefill).
      const sendRef = refDirty.current ? new Float32Array(ref.samples) : null;
      addLog(sendRef ? 'reference changed → encoding voice' : 'reusing cached voice (no re-encode)');
      const result = await engine.generateWithReference(text, sendRef, ref.sampleRate, speed);
      refDirty.current = false;
      const wall = Math.round(performance.now() - start);
      const audioSecs = result.samples.length / result.sampleRate;
      addLog(`gen done: samples=${result.samples.length} dur=${audioSecs.toFixed(2)}s wall=${wall}ms factor=${(audioSecs / (wall / 1000)).toFixed(2)}x`);
      // Guard: a runaway buffer would crash the WAV encoder / browser — cap playback.
      if (result.samples.length > 30 * result.sampleRate) {
        const m = `Output too large: ${result.samples.length} samples (≈${audioSecs.toFixed(0)}s) — skipping playback`;
        addLog('WARN ' + m); setTiming(m); setStatus('error'); setStatusMsg(m);
        return;
      }
      setTiming(`${wall} ms · ${(audioSecs / (wall / 1000)).toFixed(2)}× realtime`);
      setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(toWav(result.samples, result.sampleRate)); });
      setStatus('ready'); setStatusMsg('Done');
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setStatus('error'); setStatusMsg(m); addLog('GEN ERROR ' + m); }
  }, [text, ref, speed, addLog]);

  return (
    <div className="pocket-playground">
      <h1>Pocket TTS — Dev Playground</h1>
      <div className="status">{status === 'ready' || status === 'generating' ? `backend: ${backend} · ` : ''}{statusMsg}</div>
      {status === 'idle' && (
        <>
          {isElectron() && (
            <label className="native-toggle">
              <input type="checkbox" checked={useNative} onChange={(e) => setUseNative(e.target.checked)} />
              Native (Electron / onnxruntime-node)
            </label>
          )}
          <button onClick={load}>Load model (~int8 bundle)</button>
        </>
      )}
      {status !== 'idle' && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          <div className="ref-row">
            <label className="upload">Upload .wav<input type="file" accept="audio/*" hidden onChange={onUpload} /></label>
            <button onClick={toggleRecord}>{recording ? '■ Stop' : '● Record'}</button>
            <span>{ref ? `ref: ${(ref.samples.length / ref.sampleRate).toFixed(1)}s @ ${ref.sampleRate}Hz` : 'no reference yet'}</span>
          </div>
          <div className="gen-row">
            <label>Speed {speed.toFixed(1)}×<input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(+e.target.value)} /></label>
            <button disabled={!ref || status === 'generating'} onClick={generate}>▶ Generate</button>
          </div>
          {audioUrl && (
            <div className="out-row">
              <audio src={audioUrl} controls autoPlay />
              <a href={audioUrl} download="pocket-tts.wav">⬇ download</a>
              <span>{timing}</span>
            </div>
          )}
        </>
      )}
      <div className="logs">
        <div className="logs-head">
          <span>logs ({logs.length})</span>
          <button onClick={() => navigator.clipboard?.writeText(logs.join('\n'))}>Copy</button>
          <button onClick={() => setLogs([])}>Clear</button>
        </div>
        <pre>{logs.join('\n')}</pre>
      </div>
    </div>
  );
};

/** Float32 PCM → 16-bit mono WAV Blob. */
function toWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let off = 44; for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([buffer], { type: 'audio/wav' });
}

import React, { useCallback, useRef, useState } from 'react';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
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
  const engineRef = useRef<TtsEngine | null>(null);
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

  const load = useCallback(async () => {
    setStatus('loading'); setStatusMsg('Loading model…');
    const engine = new TtsEngine();
    engine.onStatus = (m) => setStatusMsg(m);
    engine.onError = (e) => { setStatus('error'); setStatusMsg(e); };
    engineRef.current = engine;
    try {
      const info = await engine.init('pocket-tts');
      setBackend(info.backend ?? 'wasm'); setStatus('ready'); setStatusMsg('Ready');
    } catch (e) { setStatus('error'); setStatusMsg(e instanceof Error ? e.message : String(e)); }
  }, []);

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setRef(await decodeToMono(file)); setStatusMsg(`Reference: ${file.name}`);
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
      setRef(await decodeToMono(new File([blob], 'recording.webm')));
      setStatusMsg('Reference: recording captured');
    };
    recorderRef.current = rec; rec.start(); setRecording(true);
  }, [recording]);

  const generate = useCallback(async () => {
    const engine = engineRef.current; if (!engine || !ref) return;
    setStatus('generating'); setStatusMsg('Generating…');
    try {
      const start = performance.now();
      // Send the reference (copy: postMessage transfers the buffer).
      const result = await engine.generateWithReference(text, new Float32Array(ref.samples), ref.sampleRate, speed);
      const wall = Math.round(performance.now() - start);
      const audioSecs = result.samples.length / result.sampleRate;
      setTiming(`${wall} ms · ${(audioSecs / (wall / 1000)).toFixed(2)}× realtime`);
      setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(toWav(result.samples, result.sampleRate)); });
      setStatus('ready'); setStatusMsg('Done');
    } catch (e) { setStatus('error'); setStatusMsg(e instanceof Error ? e.message : String(e)); }
  }, [text, ref, speed]);

  return (
    <div className="pocket-playground">
      <h1>Pocket TTS — Dev Playground</h1>
      <div className="status">{status === 'ready' || status === 'generating' ? `backend: ${backend} · ` : ''}{statusMsg}</div>
      {status === 'idle' && <button onClick={load}>Load model (~int8 bundle)</button>}
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

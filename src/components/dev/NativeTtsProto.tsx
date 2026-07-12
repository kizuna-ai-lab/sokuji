import React, { useRef, useState } from 'react';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';

export const NativeTtsProto: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const client = useRef<NativeTtsClient | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [text, setText] = useState('Hello from the native python sidecar.');
  const [ref, setRef] = useState<Float32Array | null>(null);
  const tclient = useRef<NativeTranslateClient | null>(null);
  const [srcText, setSrcText] = useState('Hola, ¿cómo estás?');
  const push = (m: string) => setLog((l) => [...l, m]);

  const onTranslate = async () => {
    if (!tclient.current) {
      tclient.current = new NativeTranslateClient();
      tclient.current.onStatus = push;
      tclient.current.onError = (e) => push('ERROR: ' + e);
      const r = await tclient.current.init('Spanish', 'English');
      push(`translate ready loadMs=${r.loadTimeMs}`);
    }
    const res = await tclient.current.translate(srcText);
    push(`translated: "${res.translatedText}" (${res.inferenceTimeMs}ms)`);
  };

  const aclient = useRef<NativeAsrClient | null>(null);
  const micStop = useRef<(() => void) | null>(null);

  const startAsr = async () => {
    if (micStop.current) { micStop.current(); micStop.current = null; push('asr stopped'); return; }
    aclient.current = new NativeAsrClient();
    aclient.current.onStatus = push;
    aclient.current.onError = (e) => push('ERROR: ' + e);
    aclient.current.onSpeechStart = () => push('· speech_start');
    aclient.current.onResult = (r) => push(`asr: "${r.text}" (${r.recognitionTimeMs}ms)`);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000 } });
    const ac = new AudioContext({ sampleRate: 24000 });
    // AudioContext may ignore the 24k hint (often 48k) — tell the sidecar the real rate.
    push(`mic AudioContext sampleRate=${ac.sampleRate}`);
    const r = await aclient.current.init('en', undefined, ac.sampleRate);
    push(`asr ready loadMs=${r.loadTimeMs}`);
    const sourceNode = ac.createMediaStreamSource(stream);
    const node = ac.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
      aclient.current?.feedAudio(i16, 24000);
    };
    sourceNode.connect(node); node.connect(ac.destination);
    micStop.current = () => {
      node.disconnect(); sourceNode.disconnect();
      stream.getTracks().forEach((t) => t.stop()); ac.close(); aclient.current?.flush();
    };
    push('asr listening… (click again to stop)');
  };

  const ensure = async () => {
    if (!client.current) {
      client.current = new NativeTtsClient();
      client.current.onStatus = push;
      client.current.onError = (e) => push('ERROR: ' + e);
      const r = await client.current.init();
      push(`ready sr=${r.sampleRate} loadMs=${r.loadTimeMs}`);
    }
    return client.current;
  };

  const onRef = async (f: File) => {
    const buf = await f.arrayBuffer();
    const ac = new AudioContext();
    const audio = await ac.decodeAudioData(buf);
    setRef(audio.getChannelData(0).slice());
    push(`reference loaded: ${audio.length} samples @ ${audio.sampleRate}Hz`);
    const c = await ensure();
    await c.setReferenceVoice(audio.getChannelData(0).slice(), audio.sampleRate);
    push('reference voice set');
  };

  const onGen = async () => {
    const c = await ensure();
    if (!ref) { push('load a reference clip first'); return; }
    const res = await c.generate(text);
    push(`generated ${res.samples.length} samples in ${res.generationTimeMs}ms`);
    const ac = new AudioContext();
    const buf = ac.createBuffer(1, res.samples.length, res.sampleRate);
    buf.copyToChannel(res.samples, 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1e1e1e', color: '#ddd', padding: 24, zIndex: 9999, overflow: 'auto' }}>
      <button onClick={onClose} style={{ float: 'right' }}>close</button>
      <h3>Native TTS Proto (python sidecar)</h3>
      <input type="file" accept="audio/*" onChange={(e) => e.target.files && onRef(e.target.files[0])} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', height: 60, marginTop: 8 }} />
      <button onClick={onGen} style={{ marginTop: 8 }}>generate + play</button>
      <hr style={{ margin: '16px 0', borderColor: '#444' }} />
      <h4>Translate</h4>
      <textarea value={srcText} onChange={(e) => setSrcText(e.target.value)} style={{ width: '100%', height: 40 }} />
      <button onClick={onTranslate} style={{ marginTop: 8 }}>translate</button>
      <hr style={{ margin: '16px 0', borderColor: '#444' }} />
      <h4>ASR (mic)</h4>
      <button onClick={startAsr}>start / stop mic ASR</button>
      <pre style={{ marginTop: 12, fontSize: 12 }}>{log.join('\n')}</pre>
    </div>
  );
};

import React, { useRef, useState } from 'react';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';

export const NativeTtsProto: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const client = useRef<NativeTtsClient | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [text, setText] = useState('Hello from the native python sidecar.');
  const [ref, setRef] = useState<Float32Array | null>(null);
  const push = (m: string) => setLog((l) => [...l, m]);

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
      <pre style={{ marginTop: 12, fontSize: 12 }}>{log.join('\n')}</pre>
    </div>
  );
};

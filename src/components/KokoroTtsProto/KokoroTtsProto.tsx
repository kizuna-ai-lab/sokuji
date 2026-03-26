import React, { useState, useRef, useCallback } from 'react';
import { X, Play, Loader, Volume2 } from 'lucide-react';
import './KokoroTtsProto.scss';

const LANG_MAP: Record<string, string> = {
  a: 'American English',
  b: 'British English',
  j: 'Japanese',
  z: 'Mandarin Chinese',
  e: 'Spanish',
  f: 'French',
  h: 'Hindi',
  i: 'Italian',
  p: 'Brazilian Portuguese',
};

// Full multilingual voice list from onnx-community/Kokoro-82M-v1.0-ONNX.
// kokoro-js@1.2.1 only has English voices hardcoded — we patch at runtime.
const MULTILINGUAL_VOICES: Record<string, { name: string; language: string; gender: string }> = {
  af_heart: { name: 'Heart', language: 'en-us', gender: 'Female' },
  af_alloy: { name: 'Alloy', language: 'en-us', gender: 'Female' },
  af_aoede: { name: 'Aoede', language: 'en-us', gender: 'Female' },
  af_bella: { name: 'Bella', language: 'en-us', gender: 'Female' },
  af_jessica: { name: 'Jessica', language: 'en-us', gender: 'Female' },
  af_kore: { name: 'Kore', language: 'en-us', gender: 'Female' },
  af_nicole: { name: 'Nicole', language: 'en-us', gender: 'Female' },
  af_nova: { name: 'Nova', language: 'en-us', gender: 'Female' },
  af_river: { name: 'River', language: 'en-us', gender: 'Female' },
  af_sarah: { name: 'Sarah', language: 'en-us', gender: 'Female' },
  af_sky: { name: 'Sky', language: 'en-us', gender: 'Female' },
  am_adam: { name: 'Adam', language: 'en-us', gender: 'Male' },
  am_echo: { name: 'Echo', language: 'en-us', gender: 'Male' },
  am_eric: { name: 'Eric', language: 'en-us', gender: 'Male' },
  am_fenrir: { name: 'Fenrir', language: 'en-us', gender: 'Male' },
  am_liam: { name: 'Liam', language: 'en-us', gender: 'Male' },
  am_michael: { name: 'Michael', language: 'en-us', gender: 'Male' },
  am_onyx: { name: 'Onyx', language: 'en-us', gender: 'Male' },
  am_puck: { name: 'Puck', language: 'en-us', gender: 'Male' },
  am_santa: { name: 'Santa', language: 'en-us', gender: 'Male' },
  bf_alice: { name: 'Alice', language: 'en-gb', gender: 'Female' },
  bf_emma: { name: 'Emma', language: 'en-gb', gender: 'Female' },
  bf_isabella: { name: 'Isabella', language: 'en-gb', gender: 'Female' },
  bf_lily: { name: 'Lily', language: 'en-gb', gender: 'Female' },
  bm_daniel: { name: 'Daniel', language: 'en-gb', gender: 'Male' },
  bm_fable: { name: 'Fable', language: 'en-gb', gender: 'Male' },
  bm_george: { name: 'George', language: 'en-gb', gender: 'Male' },
  bm_lewis: { name: 'Lewis', language: 'en-gb', gender: 'Male' },
  ef_dora: { name: 'Dora', language: 'es', gender: 'Female' },
  em_alex: { name: 'Alex', language: 'es', gender: 'Male' },
  em_santa: { name: 'Santa', language: 'es', gender: 'Male' },
  ff_siwis: { name: 'Siwis', language: 'fr', gender: 'Female' },
  hf_alpha: { name: 'Alpha', language: 'hi', gender: 'Female' },
  hf_beta: { name: 'Beta', language: 'hi', gender: 'Female' },
  hm_omega: { name: 'Omega', language: 'hi', gender: 'Male' },
  hm_psi: { name: 'Psi', language: 'hi', gender: 'Male' },
  if_sara: { name: 'Sara', language: 'it', gender: 'Female' },
  im_nicola: { name: 'Nicola', language: 'it', gender: 'Male' },
  jf_alpha: { name: 'Alpha', language: 'ja', gender: 'Female' },
  jf_gongitsune: { name: 'Gongitsune', language: 'ja', gender: 'Female' },
  jf_nezumi: { name: 'Nezumi', language: 'ja', gender: 'Female' },
  jf_tebukuro: { name: 'Tebukuro', language: 'ja', gender: 'Female' },
  jm_kumo: { name: 'Kumo', language: 'ja', gender: 'Male' },
  pf_dora: { name: 'Dora', language: 'pt-br', gender: 'Female' },
  pm_alex: { name: 'Alex', language: 'pt-br', gender: 'Male' },
  pm_santa: { name: 'Santa', language: 'pt-br', gender: 'Male' },
  zf_xiaobei: { name: 'Xiaobei', language: 'zh', gender: 'Female' },
  zf_xiaoni: { name: 'Xiaoni', language: 'zh', gender: 'Female' },
  zf_xiaoxiao: { name: 'Xiaoxiao', language: 'zh', gender: 'Female' },
  zf_xiaoyi: { name: 'Xiaoyi', language: 'zh', gender: 'Female' },
  zm_yunjian: { name: 'Yunjian', language: 'zh', gender: 'Male' },
  zm_yunxi: { name: 'Yunxi', language: 'zh', gender: 'Male' },
  zm_yunxia: { name: 'Yunxia', language: 'zh', gender: 'Male' },
  zm_yunyang: { name: 'Yunyang', language: 'zh', gender: 'Male' },
};

const ALL_VOICES = Object.keys(MULTILINGUAL_VOICES);

// Phonemizer support status:
//   EN: kokoro-js built-in eSpeak (good quality)
//   ZH: phonemize/zh toIPA with arrow tones (experimental)
//   JA: NO working phonemizer — phonemize/ja only handles romaji, not native text
//   Others: kokoro-js forces English eSpeak (wrong phonemes, may crash on WebGPU)
const SAMPLE_TEXTS: { lang: string; label: string; text: string; voice: string }[] = [
  { lang: 'en', label: 'EN', text: 'The quick brown fox jumps over the lazy dog.', voice: 'af_heart' },
  { lang: 'zh', label: 'ZH', text: '今天天气真不错，我们一起去公园散步吧。', voice: 'zf_xiaobei' },
  { lang: 'ja', label: 'JA (no G2P)', text: '本日はお忙しい中、お時間をいただきありがとうございます。', voice: 'jf_alpha' },
  { lang: 'es', label: 'ES (no G2P)', text: 'El rápido zorro marrón salta sobre el perro perezoso.', voice: 'ef_dora' },
  { lang: 'fr', label: 'FR (no G2P)', text: 'Le rapide renard brun saute par-dessus le chien paresseux.', voice: 'ff_siwis' },
];

type ModelStatus = 'idle' | 'loading' | 'ready' | 'error' | 'generating';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KokoroTTSInstance = any;

interface KokoroTtsProtoProps {
  onClose: () => void;
}

const KokoroTtsProto: React.FC<KokoroTtsProtoProps> = ({ onClose }) => {
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [statusText, setStatusText] = useState('Not loaded');
  const [progress, setProgress] = useState(0);
  const [dtype, setDtype] = useState('q8');
  const [device, setDevice] = useState(() => (typeof navigator !== 'undefined' && 'gpu' in navigator) ? 'webgpu' : 'wasm');
  const [speed, setSpeed] = useState(1.0);
  const [selectedVoice, setSelectedVoice] = useState('af_heart');
  const [langFilter, setLangFilter] = useState('all');
  const [inputText, setInputText] = useState('The quick brown fox jumps over the lazy dog.');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<string>('');
  const [logs, setLogs] = useState<{ msg: string; level: string }[]>([]);

  const ttsRef = useRef<KokoroTTSInstance>(null);
  const logAreaRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string, level = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { msg: `[${time}] ${msg}`, level }]);
    setTimeout(() => {
      logAreaRef.current?.scrollTo(0, logAreaRef.current.scrollHeight);
    }, 0);
    console.log(`[KokoroProto][${level}] ${msg}`);
  }, []);

  const loadModel = useCallback(async () => {
    setStatus('loading');
    setStatusText('Loading...');
    setProgress(5);
    addLog(`Loading model (dtype=${dtype}, device=${device})...`);

    try {
      const [{ KokoroTTS }, phonemizeModule] = await Promise.all([
        import('kokoro-js'),
        import('phonemize/zh'),  // loads English + Chinese G2P
      ]);
      const t0 = performance.now();

      const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: dtype as 'q8' | 'fp32' | 'fp16' | 'q4' | 'q4f16',
        device: device as 'wasm' | 'webgpu',
        progress_callback: (p: { status: string; loaded?: number; total?: number; file?: string }) => {
          if (p.status === 'progress' && p.total) {
            const pct = Math.round((p.loaded! / p.total) * 100);
            setProgress(pct);
            if (p.file) {
              const fileName = p.file.split('/').pop();
              setStatusText(`Downloading ${fileName}... ${pct}%`);
            }
          } else if (p.status === 'done' && p.file) {
            addLog(`Downloaded: ${p.file.split('/').pop()}`);
          }
        },
      });

      const loadTime = ((performance.now() - t0) / 1000).toFixed(2);

      // --- Patch kokoro-js for multilingual support ---

      // 1. Accept all 54 voices (kokoro-js only knows 28 English ones)
      tts._validate_voice = (voice: string) => {
        if (!MULTILINGUAL_VOICES[voice]) {
          throw new Error(`Voice "${voice}" not found. Should be one of: ${ALL_VOICES.join(', ')}`);
        }
        return voice[0];
      };

      // 2. Override generate() to use phonemize library for Chinese
      //    kokoro-js's built-in phonemizer is English-only (hardcoded "en"/"en-us")
      const origGenerate = tts.generate.bind(tts);
      const { toIPA } = phonemizeModule;

      tts.generate = async (text: string, opts: { voice?: string; speed?: number } = {}) => {
        const voice = opts.voice || 'af_heart';
        const langPrefix = voice[0];

        // Chinese: use phonemize library → toIPA → post-process → tokenize → generate_from_ids
        if (langPrefix === 'z') {
          let phonemes = toIPA(text, { toneFormat: 'arrow' });
          // Post-process to match misaki's output format:
          // 1. Third tone: phonemize outputs ↓↗, misaki uses just ↓
          phonemes = phonemes.replace(/↓↗/g, '↓');
          // 2. Neutral tone (0): remove the 0 marker (not in Kokoro vocab)
          phonemes = phonemes.replace(/0/g, '');
          // 3. Full-width punctuation → half-width (full-width not in vocab)
          phonemes = phonemes.replace(/，/g, ',').replace(/。/g, '.').replace(/！/g, '!').replace(/？/g, '?');
          console.log('[KokoroProto] ZH phonemes:', phonemes);
          const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
          return tts.generate_from_ids(input_ids, { voice, speed: opts.speed ?? 1 });
        }

        // Other languages: use kokoro-js built-in (works for English)
        return origGenerate(text, opts);
      };

      // 3. Override stream() for Chinese too
      const origStream = tts.stream.bind(tts);
      tts.stream = function* streamPatched(text: string, opts: { voice?: string; speed?: number; split_pattern?: RegExp } = {}) {
        const voice = opts.voice || 'af_heart';
        const langPrefix = voice[0];

        // For Chinese, we can't easily patch the async generator,
        // so delegate to the original stream (which calls generate internally)
        // The origStream will call tts.generate which is already patched
        // Actually stream calls generate_from_ids directly, so we need a different approach
        return origStream(text, opts);
      } as typeof tts.stream;
      // Note: stream() uses its own phonemize path internally.
      // For the proto, Generate button is the primary test; stream may still fail for Chinese.

      ttsRef.current = tts;

      setStatus('ready');
      setStatusText(`Ready (${loadTime}s)`);
      setProgress(100);
      addLog(`Model loaded in ${loadTime}s (${ALL_VOICES.length} voices, device=${device})`);
      addLog('Chinese phonemizer: phonemize/zh (toIPA with arrow tones)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setStatusText(`Error: ${msg}`);
      addLog(`Load error: ${msg}`, 'error');
    }
  }, [dtype, device, addLog]);

  const generateSpeech = useCallback(async () => {
    const tts = ttsRef.current;
    if (!tts || !inputText.trim()) return;

    setStatus('generating');
    setStatusText('Generating...');
    setMetrics('');
    addLog(`Generating: voice=${selectedVoice}, speed=${speed}`);

    try {
      const t0 = performance.now();

      const audio = await tts.generate(inputText, {
        voice: selectedVoice,
        speed,
      });

      const elapsed = performance.now() - t0;
      const samples: Float32Array = audio.audio;
      const sampleRate = 24000;
      const durationSec = samples.length / sampleRate;
      const rtf = durationSec / (elapsed / 1000);

      // Create WAV blob for playback
      const blob = float32ToWavBlob(samples, sampleRate);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      setMetrics(
        `Voice: ${selectedVoice} | Speed: ${speed}x\n` +
        `Generation: ${(elapsed / 1000).toFixed(2)}s | Audio: ${durationSec.toFixed(2)}s | RTF: ${rtf.toFixed(2)}x`
      );
      setStatus('ready');
      setStatusText('Ready');
      addLog(`Done: ${durationSec.toFixed(2)}s audio in ${(elapsed / 1000).toFixed(2)}s (RTF: ${rtf.toFixed(2)}x)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setStatusText(`Error: ${msg}`);
      addLog(`Generate error: ${msg}`, 'error');
    }
  }, [inputText, selectedVoice, speed, audioUrl, addLog]);

  const streamSpeech = useCallback(async () => {
    const tts = ttsRef.current;
    if (!tts || !inputText.trim()) return;

    setStatus('generating');
    setStatusText('Streaming...');
    setMetrics('');
    addLog(`Streaming: voice=${selectedVoice}, text length=${inputText.length} chars`);

    try {
      const t0 = performance.now();
      const stream = tts.stream(inputText, { voice: selectedVoice, speed });
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const chunks: Float32Array[] = [];
      let chunkCount = 0;
      let totalAudioSec = 0;

      for await (const chunk of stream) {
        chunkCount++;
        const samples: Float32Array = chunk.audio.audio;
        const chunkDur = samples.length / 24000;
        totalAudioSec += chunkDur;
        addLog(`  Chunk ${chunkCount}: "${(chunk.text as string).slice(0, 40)}..." (${chunkDur.toFixed(2)}s)`);

        // Play chunk immediately
        const buffer = audioContext.createBuffer(1, samples.length, 24000);
        buffer.getChannelData(0).set(samples);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
        chunks.push(samples);
      }

      const elapsed = performance.now() - t0;

      // Combine chunks for replay
      const totalLength = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const blob = float32ToWavBlob(combined, 24000);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(blob));

      const rtf = totalAudioSec / (elapsed / 1000);
      setMetrics(
        `Voice: ${selectedVoice} | Chunks: ${chunkCount}\n` +
        `Generation: ${(elapsed / 1000).toFixed(2)}s | Audio: ${totalAudioSec.toFixed(2)}s | RTF: ${rtf.toFixed(2)}x`
      );
      setStatus('ready');
      setStatusText('Ready');
      addLog(`Stream done: ${chunkCount} chunks, ${totalAudioSec.toFixed(2)}s audio in ${(elapsed / 1000).toFixed(2)}s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setStatusText(`Error: ${msg}`);
      addLog(`Stream error: ${msg}`, 'error');
    }
  }, [inputText, selectedVoice, speed, audioUrl, addLog]);

  const handleSampleClick = (sample: typeof SAMPLE_TEXTS[0]) => {
    setInputText(sample.text);
    setSelectedVoice(sample.voice);
  };

  const filteredVoices = langFilter === 'all'
    ? ALL_VOICES
    : ALL_VOICES.filter(v => v.startsWith(langFilter));

  const isReady = status === 'ready';
  const isLoading = status === 'loading';
  const isGenerating = status === 'generating';

  return (
    <div className="kokoro-proto-overlay">
      <div className="kokoro-proto-panel">
        <header className="kokoro-proto-header">
          <h2>Kokoro TTS Proto</h2>
          <span className="kokoro-proto-subtitle">kokoro-js 82M — Transformers.js ONNX</span>
          <button className="kokoro-proto-close" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="kokoro-proto-body">
          {/* Config */}
          <div className="kokoro-proto-config">
            <label>
              <span>Quantization</span>
              <select value={dtype} onChange={e => setDtype(e.target.value)} disabled={isLoading}>
                <option value="q8">q8 (~92 MB)</option>
                <option value="fp32">fp32 (~326 MB)</option>
                <option value="fp16">fp16 (~163 MB)</option>
                <option value="q4">q4 (~305 MB)</option>
                <option value="q4f16">q4f16 (~154 MB)</option>
              </select>
            </label>
            <label>
              <span>Device</span>
              <select value={device} onChange={e => setDevice(e.target.value)} disabled={isLoading}>
                <option value="wasm">WASM (CPU)</option>
                <option value="webgpu">WebGPU (GPU)</option>
              </select>
            </label>
            <label>
              <span>Speed</span>
              <input
                type="number" value={speed} min={0.5} max={2.0} step={0.1}
                onChange={e => setSpeed(parseFloat(e.target.value) || 1.0)}
                style={{ width: 70 }}
              />
            </label>
            <button
              className={`kokoro-btn ${isLoading ? 'loading' : 'load'}`}
              onClick={loadModel}
              disabled={isLoading || isGenerating}
            >
              {isLoading ? <><Loader size={14} className="spin" /> Loading...</> : 'Load Model'}
            </button>
            <span className={`kokoro-status ${status}`}>{statusText}</span>
          </div>

          {/* Progress bar */}
          {isLoading && (
            <div className="kokoro-progress">
              <div className="kokoro-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Voice selection */}
          {isReady && (
            <div className="kokoro-voices-section">
              <div className="kokoro-voices-header">
                <h3>Voices</h3>
                <select value={langFilter} onChange={e => setLangFilter(e.target.value)}>
                  <option value="all">All Languages</option>
                  {Object.entries(LANG_MAP).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="kokoro-voice-grid">
                {filteredVoices.map(voice => {
                  const gender = voice[1] === 'f' ? 'F' : 'M';
                  return (
                    <button
                      key={voice}
                      className={`kokoro-voice-chip ${voice === selectedVoice ? 'selected' : ''}`}
                      onClick={() => setSelectedVoice(voice)}
                    >
                      {voice} <span className="gender">({gender})</span>
                      <span className="lang-tag">{LANG_MAP[voice[0]] || voice[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Text input */}
          <div className="kokoro-input-section">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Enter text to synthesize..."
              rows={3}
            />
            <div className="kokoro-samples">
              {SAMPLE_TEXTS.map(s => (
                <button
                  key={s.lang}
                  className="kokoro-sample-btn"
                  onClick={() => handleSampleClick(s)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="kokoro-actions">
            <button
              className="kokoro-btn primary"
              onClick={generateSpeech}
              disabled={!isReady}
            >
              <Play size={14} /> Generate
            </button>
            <button
              className="kokoro-btn primary"
              onClick={streamSpeech}
              disabled={!isReady}
            >
              <Volume2 size={14} /> Stream
            </button>
          </div>

          {/* Audio player & metrics */}
          {audioUrl && (
            <div className="kokoro-result">
              <audio controls autoPlay src={audioUrl} />
              {metrics && <pre className="kokoro-metrics">{metrics}</pre>}
            </div>
          )}

          {/* Logs */}
          <div className="kokoro-logs" ref={logAreaRef}>
            {logs.map((log, i) => (
              <div key={i} className={`log-line ${log.level}`}>{log.msg}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// WAV encoder
function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bitsPerSample = 16;
  const byteRate = sampleRate * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, bitsPerSample / 8, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export default KokoroTtsProto;

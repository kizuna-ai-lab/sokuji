/**
 * Whisper WebGPU Prototype — Standalone test using @ricky0123/vad-web for VAD.
 *
 * Uses vad-web's MicVAD (Silero VAD v5, dual-threshold) for speech detection,
 * then runs Whisper via Transformers.js pipeline for transcription.
 * This serves as a reference to compare against the custom VAD in whisper-webgpu.worker.ts.
 *
 * Toggle with Ctrl+Shift+W in development mode.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { MicVAD } from '@ricky0123/vad-web';
import {
  pipeline,
  env,
  AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import { getManifestByType, type ModelManifestEntry } from './modelManifest';
import { ModelManager } from './ModelManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWhisperModels(): ModelManifestEntry[] {
  return getManifestByType('asr').filter(m => m.asrWorkerType === 'whisper-webgpu');
}

function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;
      const url = typeof request === 'string' ? request : request.url;
      const marker = '/resolve/main/';
      const idx = url.indexOf(marker);
      if (idx === -1) return undefined;
      const filename = url.slice(idx + marker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;
      return fetch(blobUrl);
    },
    async put() {},
  };
}

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TranscriptionResult {
  text: string;
  durationMs: number;
  recognitionTimeMs: number;
  rms: number;
  samples: number;
}

export function WhisperProto() {
  const whisperModels = getWhisperModels();
  const [modelId, setModelId] = useState(whisperModels[0]?.id ?? '');
  const [language, setLanguage] = useState('ja');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'recording' | 'error'>('idle');
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TranscriptionResult[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [inferring, setInferring] = useState(false);

  // VAD params (matching vad-web defaults)
  const [posThreshold, setPosThreshold] = useState(0.5);
  const [negThreshold, setNegThreshold] = useState(0.35);
  const [minSpeechMs, setMinSpeechMs] = useState(250);
  const [redemptionMs, setRedemptionMs] = useState(600);

  const transcriberRef = useRef<AutomaticSpeechRecognitionPipeline | null>(null);
  const vadRef = useRef<MicVAD | null>(null);
  const fileUrlsRef = useRef<Record<string, string> | null>(null);
  const languageRef = useRef(language);

  // Keep languageRef in sync
  useEffect(() => { languageRef.current = language; }, [language]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [...prev.slice(-99), `[${ts}] ${msg}`]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      vadRef.current?.destroy();
      transcriberRef.current = null;
    };
  }, []);

  // ─── Load Whisper Model ──────────────────────────────────────────────────

  const handleLoadModel = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setResults([]);
    setLoadTime(null);

    const model = whisperModels.find(m => m.id === modelId);
    if (!model) {
      setError(`Model not found: ${modelId}`);
      setStatus('error');
      return;
    }

    try {
      const startTime = performance.now();

      // Check model downloaded
      const manager = ModelManager.getInstance();
      if (!await manager.isModelReady(modelId)) {
        throw new Error(`Model "${modelId}" not downloaded. Download it via Model Management first.`);
      }

      // Get blob URLs
      const fileUrls = await manager.getModelBlobUrls(modelId);
      fileUrlsRef.current = fileUrls;

      // Check WebGPU
      const webgpu = await hasWebGPU();
      const device = webgpu ? 'webgpu' : 'wasm';
      setStatusMessage(`Loading Whisper on ${device}...`);
      addLog(`Loading ${model.name} on ${device}...`);

      // Configure Transformers.js
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      env.useCustomCache = true;
      env.customCache = createBlobUrlCache(fileUrls);

      const dtype = model.dtype ?? {
        encoder_model: webgpu ? 'fp32' : 'q8',
        decoder_model_merged: webgpu ? 'q4' : 'q8',
      };

      const transcriber = await pipeline('automatic-speech-recognition', model.hfModelId!, {
        device,
        dtype: dtype as any,
      }) as AutomaticSpeechRecognitionPipeline;

      transcriberRef.current = transcriber;

      // Warmup
      if (webgpu) {
        setStatusMessage('Warming up WebGPU shaders...');
        addLog('Warming up WebGPU...');
        try {
          const opts: Record<string, any> = { max_new_tokens: 1 };
          if (language) { opts.language = language; opts.task = 'transcribe'; }
          await transcriber(new Float32Array(16000), opts);
        } catch {
          addLog('Warmup failed (non-fatal)');
        }
      }

      const loadTimeMs = Math.round(performance.now() - startTime);
      setLoadTime(loadTimeMs);
      setStatus('ready');
      setStatusMessage('');
      addLog(`Model loaded in ${(loadTimeMs / 1000).toFixed(1)}s`);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      addLog(`Load failed: ${err.message}`);
    }
  }, [modelId, language, whisperModels, addLog]);

  // ─── Whisper Inference ───────────────────────────────────────────────────

  const runWhisper = useCallback(async (audio: Float32Array) => {
    const transcriber = transcriberRef.current;
    if (!transcriber) return;

    // Compute RMS
    let sumSq = 0;
    for (let i = 0; i < audio.length; i++) sumSq += audio[i] * audio[i];
    const rms = Math.sqrt(sumSq / audio.length);
    const durationMs = Math.round((audio.length / 16000) * 1000);

    addLog(`WHISPER_INPUT samples=${audio.length} dur=${durationMs}ms rms=${rms.toFixed(5)}`);
    setInferring(true);

    const startTime = performance.now();
    try {
      const options: Record<string, any> = {};
      const lang = languageRef.current;
      if (lang) { options.language = lang; options.task = 'transcribe'; }

      const result = await transcriber(audio, options);
      const recognitionTimeMs = Math.round(performance.now() - startTime);
      const text = (Array.isArray(result) ? result[0].text : result.text).trim();

      addLog(`WHISPER_OUTPUT text=${JSON.stringify(text)} dur=${durationMs}ms recog=${recognitionTimeMs}ms rms=${rms.toFixed(5)}`);

      if (text) {
        setResults(prev => [...prev, { text, durationMs, recognitionTimeMs, rms, samples: audio.length }]);
      }
    } catch (err: any) {
      addLog(`Whisper error: ${err.message}`);
    } finally {
      setInferring(false);
    }
  }, [addLog]);

  // ─── Start/Stop VAD Recording ────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (!transcriberRef.current) return;

    try {
      addLog(`Starting MicVAD (pos=${posThreshold} neg=${negThreshold} minSpeech=${minSpeechMs}ms redemption=${redemptionMs}ms)`);

      const vad = await MicVAD.new({
        model: 'v5',
        positiveSpeechThreshold: posThreshold,
        negativeSpeechThreshold: negThreshold,
        minSpeechMs,
        redemptionMs,
        startOnLoad: true,
        baseAssetPath: '/wasm/vad/',
        onnxWASMBasePath: '/wasm/ort/',
        processorType: 'ScriptProcessor',

        onSpeechStart: () => {
          addLog('VAD: speech_start');
        },

        onSpeechRealStart: () => {
          addLog('VAD: speech_real_start');
        },

        onSpeechEnd: (audio: Float32Array) => {
          const dur = Math.round((audio.length / 16000) * 1000);
          addLog(`VAD: speech_end dur=${dur}ms samples=${audio.length}`);
          runWhisper(audio);
        },

        onVADMisfire: () => {
          addLog('VAD: misfire (too short, discarded)');
        },

        onFrameProcessed: (probs) => {
          // Only log high probabilities to avoid spam
          if (probs.isSpeech > 0.3) {
            addLog(`VAD: frame prob=${probs.isSpeech.toFixed(3)}`);
          }
        },
      });

      vadRef.current = vad;
      setStatus('recording');
      addLog('Recording started');
    } catch (err: any) {
      setError(err.message);
      addLog(`VAD start failed: ${err.message}`);
    }
  }, [posThreshold, negThreshold, minSpeechMs, redemptionMs, runWhisper, addLog]);

  const stopRecording = useCallback(async () => {
    if (vadRef.current) {
      await vadRef.current.destroy();
      vadRef.current = null;
    }
    if (status === 'recording') {
      setStatus('ready');
      addLog('Recording stopped');
    }
  }, [status, addLog]);

  const handleDispose = useCallback(async () => {
    await stopRecording();
    if (fileUrlsRef.current) {
      const manager = ModelManager.getInstance();
      manager.revokeBlobUrls(fileUrlsRef.current);
      fileUrlsRef.current = null;
    }
    transcriberRef.current = null;
    setStatus('idle');
    setLoadTime(null);
    setStatusMessage('');
    addLog('Disposed');
  }, [stopRecording, addLog]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (whisperModels.length === 0) {
    return (
      <div style={{ padding: 16, fontFamily: 'monospace', color: '#e74c3c' }}>
        No Whisper WebGPU models found in manifest.
      </div>
    );
  }

  return (
    <div style={{
      padding: 16,
      fontFamily: 'monospace',
      fontSize: 13,
      background: '#1a1a2e',
      color: '#e0e0e0',
      borderRadius: 8,
      maxWidth: 650,
      minWidth: 400,
    }}>
      <h3 style={{ margin: '0 0 12px', color: '#9b59b6' }}>
        Whisper WebGPU Proto (vad-web VAD)
      </h3>

      {/* Model + Language */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Model:</label>
          <select
            value={modelId}
            onChange={e => setModelId(e.target.value)}
            disabled={status !== 'idle'}
            style={selectStyle}
          >
            {whisperModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Language:</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={status === 'recording'}
            style={selectStyle}
          >
            {['ja', 'en', 'zh', 'ko', 'de', 'fr', 'es', 'auto'].map(l => (
              <option key={l} value={l === 'auto' ? '' : l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* VAD Parameters */}
      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888', marginBottom: 8 }}>
          VAD Parameters (vad-web)
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 11 }}>
          <div>
            <label style={labelStyle}>positiveSpeechThreshold: {posThreshold.toFixed(2)}</label>
            <input type="range" min="0.1" max="0.95" step="0.05" value={posThreshold}
              onChange={e => setPosThreshold(parseFloat(e.target.value))}
              disabled={status === 'recording'} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>negativeSpeechThreshold: {negThreshold.toFixed(2)}</label>
            <input type="range" min="0.05" max="0.8" step="0.05" value={negThreshold}
              onChange={e => setNegThreshold(parseFloat(e.target.value))}
              disabled={status === 'recording'} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>minSpeechMs: {minSpeechMs}</label>
            <input type="range" min="50" max="1000" step="50" value={minSpeechMs}
              onChange={e => setMinSpeechMs(parseInt(e.target.value))}
              disabled={status === 'recording'} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>redemptionMs: {redemptionMs}</label>
            <input type="range" min="100" max="2000" step="100" value={redemptionMs}
              onChange={e => setRedemptionMs(parseInt(e.target.value))}
              disabled={status === 'recording'} style={{ width: '100%' }} />
          </div>
        </div>
      </details>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={handleLoadModel} disabled={status === 'loading' || status === 'recording'}
          style={btnStyle('#10a37f')}>
          {status === 'loading' ? 'Loading...' : 'Load Model'}
        </button>
        {status === 'recording' ? (
          <button onClick={stopRecording} style={btnStyle('#e74c3c')}>Stop</button>
        ) : (
          <button onClick={startRecording} disabled={status !== 'ready' || inferring}
            style={btnStyle('#3498db')}>
            {inferring ? 'Inferring...' : 'Start Recording'}
          </button>
        )}
        <button onClick={handleDispose} disabled={status === 'idle'} style={btnStyle('#7f8c8d')}>
          Dispose
        </button>
        <button onClick={() => { setResults([]); setLog([]); }} style={btnStyle('#555')}>
          Clear
        </button>
      </div>

      {/* Status */}
      {statusMessage && status === 'loading' && (
        <div style={{ fontSize: 11, marginBottom: 8, color: '#f39c12' }}>{statusMessage}</div>
      )}

      <div style={{ fontSize: 11, marginBottom: 12, color: '#888' }}>
        Status: <span style={{ color: statusColor(status) }}>{status}</span>
        {loadTime !== null && ` | Load: ${(loadTime / 1000).toFixed(1)}s`}
        {inferring && ' | Inferring...'}
        {` | Segments: ${results.length}`}
      </div>

      {/* Results */}
      <div style={{
        minHeight: 120, maxHeight: 300, overflow: 'auto',
        background: '#16213e', border: '1px solid #2a2a4a',
        padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap', marginBottom: 8,
      }}>
        {results.length === 0
          ? (status === 'recording' ? 'Listening...' : 'Transcription will appear here')
          : results.map((r, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: '#888', fontSize: 10 }}>
                [{r.durationMs}ms→{r.recognitionTimeMs}ms rms={r.rms.toFixed(4)}]
              </span>{' '}
              {r.text}
            </div>
          ))
        }
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: '#e74c3c', fontSize: 11, marginTop: 8 }}>Error: {error}</div>
      )}

      {/* Log */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#666' }}>
          Log ({log.length} entries)
        </summary>
        <pre style={{
          fontSize: 10, maxHeight: 250, overflow: 'auto',
          background: '#0f0f23', padding: 8, borderRadius: 4, margin: '4px 0 0',
        }}>
          {log.join('\n') || 'No log entries'}
        </pre>
      </details>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#888', display: 'block', marginBottom: 2,
};

const selectStyle: React.CSSProperties = {
  background: '#16213e', color: '#e0e0e0', border: '1px solid #2a2a4a',
  borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%',
};

const btnStyle = (color: string): React.CSSProperties => ({
  background: color, color: '#fff', border: 'none', borderRadius: 4,
  padding: '6px 12px', fontSize: 12, cursor: 'pointer',
});

function statusColor(status: string): string {
  switch (status) {
    case 'ready': return '#10a37f';
    case 'loading': return '#f39c12';
    case 'recording': return '#e74c3c';
    case 'error': return '#e74c3c';
    default: return '#888';
  }
}

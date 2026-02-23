/**
 * ASR Prototype — Standalone test component for sherpa-onnx WASM ASR.
 * Validates VAD + OfflineRecognizer with live microphone input.
 *
 * Usage: import { AsrProto } from '../lib/local-inference/AsrProto';
 *        Then render <AsrProto /> somewhere in the app.
 *        Or toggle with Ctrl+Shift+A in development mode.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { AsrEngine, AsrResult } from './engine/AsrEngine';
import { getManifestByType } from './modelManifest';

const RECORDING_SAMPLE_RATE = 16000; // Use 16kHz directly for simplicity in proto
const BUFFER_SIZE = 4096;

export function AsrProto() {
  const engineRef = useRef<AsrEngine | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const asrModels = getManifestByType('asr');
  const [modelId, setModelId] = useState(asrModels[0].id);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'recording' | 'error'>('idle');
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AsrResult[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [...prev.slice(-49), `[${ts}] ${msg}`]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      engineRef.current?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInit = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setResults([]);
    setLoadTime(null);
    setStatusMessage('');
    addLog(`Initializing model: ${modelId}...`);

    // Dispose previous engine
    if (engineRef.current) {
      engineRef.current.dispose();
      addLog('Previous engine disposed');
    }

    const engine = new AsrEngine();
    engineRef.current = engine;

    engine.onStatus = (msg) => {
      setStatusMessage(msg);
      addLog(`Status: ${msg}`);
    };

    engine.onResult = (result) => {
      setResults(prev => [...prev, result]);
      addLog(`ASR [${result.durationMs}ms audio → ${result.recognitionTimeMs}ms]: "${result.text}"`);
    };

    engine.onError = (err) => {
      setError(err);
      addLog(`Error: ${err}`);
    };

    try {
      const { loadTimeMs } = await engine.init(modelId);
      setLoadTime(loadTimeMs);
      setStatus('ready');
      addLog(`Model loaded in ${loadTimeMs}ms`);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      addLog(`Init failed: ${err.message}`);
    }
  }, [modelId, addLog]);

  const startRecording = useCallback(async () => {
    if (!engineRef.current?.ready) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: RECORDING_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // Create AudioContext at 16kHz to avoid resampling
      const audioCtx = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // Use ScriptProcessor for broad compatibility
      // (AudioWorklet would be better but adds complexity for a prototype)
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 for the worker
        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        engineRef.current?.feedAudio(int16, audioCtx.sampleRate);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setStatus('recording');
      addLog(`Recording started (${audioCtx.sampleRate}Hz)`);
    } catch (err: any) {
      setError(err.message);
      addLog(`Recording failed: ${err.message}`);
    }
  }, [addLog]);

  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (status === 'recording') {
      setStatus('ready');
      addLog('Recording stopped');
    }
  }, [status, addLog]);

  const handleDispose = useCallback(() => {
    stopRecording();
    engineRef.current?.dispose();
    engineRef.current = null;
    setStatus('idle');
    setLoadTime(null);
    setStatusMessage('');
    addLog('Engine disposed');
  }, [stopRecording, addLog]);

  const totalResults = results.length;
  const lastResult = results[results.length - 1];

  return (
    <div style={{
      padding: 16,
      fontFamily: 'monospace',
      fontSize: 13,
      background: '#1a1a2e',
      color: '#e0e0e0',
      borderRadius: 8,
      maxWidth: 600,
      minWidth: 400,
    }}>
      <h3 style={{ margin: '0 0 12px', color: '#e67e22' }}>
        ASR Prototype (sherpa-onnx WASM)
      </h3>

      {/* Model selection */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
          Model:
        </label>
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          disabled={status !== 'idle'}
          style={selectStyle}
        >
          {asrModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.name} (~{m.totalSizeMb}MB)
            </option>
          ))}
        </select>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={handleInit}
          disabled={status === 'loading' || status === 'recording'}
          style={btnStyle('#10a37f')}
        >
          {status === 'loading' ? 'Loading...' : 'Load Model'}
        </button>
        {status === 'recording' ? (
          <button onClick={stopRecording} style={btnStyle('#e74c3c')}>
            Stop Recording
          </button>
        ) : (
          <button
            onClick={startRecording}
            disabled={status !== 'ready'}
            style={btnStyle('#3498db')}
          >
            Start Recording
          </button>
        )}
        <button
          onClick={handleDispose}
          disabled={status === 'idle'}
          style={btnStyle('#7f8c8d')}
        >
          Dispose
        </button>
      </div>

      {/* Status / Progress */}
      {statusMessage && status === 'loading' && (
        <div style={{ fontSize: 11, marginBottom: 8, color: '#f39c12' }}>
          {statusMessage}
        </div>
      )}

      {/* Stats */}
      <div style={{ fontSize: 11, marginBottom: 12, color: '#888' }}>
        Status: <span style={{ color: statusColor(status) }}>{status}</span>
        {loadTime !== null && ` | Model load: ${(loadTime / 1000).toFixed(1)}s`}
        {status === 'recording' && ' | 🔴 Recording'}
        {lastResult && ` | Last: ${lastResult.recognitionTimeMs}ms`}
        {` | Segments: ${totalResults}`}
      </div>

      {/* Transcription results */}
      <div style={{
        ...textareaStyle,
        minHeight: 120,
        maxHeight: 300,
        overflow: 'auto',
        background: '#16213e',
        border: '1px solid #2a2a4a',
        padding: 8,
        whiteSpace: 'pre-wrap',
      }}>
        {results.length === 0
          ? (status === 'recording'
            ? 'Listening... speak into your microphone'
            : 'Transcription will appear here')
          : results.map((r, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: '#888', fontSize: 10 }}>
                [{r.durationMs}ms→{r.recognitionTimeMs}ms]
              </span>{' '}
              {r.text}
            </div>
          ))
        }
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: '#e74c3c', fontSize: 11, marginTop: 8 }}>
          Error: {error}
        </div>
      )}

      {/* Log */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#666' }}>
          Log ({log.length} entries)
        </summary>
        <pre style={{
          fontSize: 10,
          maxHeight: 200,
          overflow: 'auto',
          background: '#0f0f23',
          padding: 8,
          borderRadius: 4,
          margin: '4px 0 0',
        }}>
          {log.join('\n') || 'No log entries'}
        </pre>
      </details>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: '#16213e',
  color: '#e0e0e0',
  border: '1px solid #2a2a4a',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 13,
  width: '100%',
};

const btnStyle = (color: string): React.CSSProperties => ({
  background: color,
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  opacity: 1,
});

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: '#16213e',
  color: '#e0e0e0',
  border: '1px solid #2a2a4a',
  borderRadius: 4,
  padding: 8,
  fontSize: 13,
  fontFamily: 'monospace',
  marginBottom: 8,
  boxSizing: 'border-box',
};

function statusColor(status: string): string {
  switch (status) {
    case 'ready': return '#10a37f';
    case 'loading': return '#f39c12';
    case 'recording': return '#e74c3c';
    case 'error': return '#e74c3c';
    default: return '#888';
  }
}

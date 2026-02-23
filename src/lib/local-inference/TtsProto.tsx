/**
 * TTS Prototype — Standalone test component for sherpa-onnx WASM TTS.
 * Validates OfflineTts (VITS/Piper) with text-to-speech synthesis and playback.
 *
 * Usage: import { TtsProto } from '../lib/local-inference/TtsProto';
 *        Then render <TtsProto /> somewhere in the app.
 *        Or toggle with Ctrl+Shift+S in development mode.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { TtsEngine, TtsResult } from './engine/TtsEngine';
import { getManifestByType } from './modelManifest';

export function TtsProto() {
  const engineRef = useRef<TtsEngine | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ttsModels = getManifestByType('tts');
  const [modelId, setModelId] = useState(ttsModels[0].id);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'generating' | 'error'>('idle');
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [numSpeakers, setNumSpeakers] = useState(0);
  const [outputSampleRate, setOutputSampleRate] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Input controls
  const [text, setText] = useState('Hello, this is a test of the sherpa onnx text to speech engine.');
  const [speakerId, setSpeakerId] = useState(0);
  const [speed, setSpeed] = useState(1.0);

  // Results
  const [results, setResults] = useState<Array<TtsResult & { text: string }>>([]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [...prev.slice(-49), `[${ts}] ${msg}`]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const handleInit = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setResults([]);
    setLoadTime(null);
    setStatusMessage('');
    setNumSpeakers(0);
    setOutputSampleRate(0);
    addLog(`Initializing TTS model: ${modelId}...`);

    // Dispose previous engine
    if (engineRef.current) {
      engineRef.current.dispose();
      addLog('Previous engine disposed');
    }

    const engine = new TtsEngine();
    engineRef.current = engine;

    engine.onStatus = (msg) => {
      setStatusMessage(msg);
      addLog(`Status: ${msg}`);
    };

    engine.onError = (err) => {
      setError(err);
      addLog(`Error: ${err}`);
    };

    try {
      const info = await engine.init(modelId);
      setLoadTime(info.loadTimeMs);
      setNumSpeakers(info.numSpeakers);
      setOutputSampleRate(info.sampleRate);
      setStatus('ready');
      addLog(`Model loaded in ${info.loadTimeMs}ms (${info.numSpeakers} speakers, ${info.sampleRate}Hz)`);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      addLog(`Init failed: ${err.message}`);
    }
  }, [modelId, addLog]);

  const handleGenerate = useCallback(async () => {
    if (!engineRef.current?.ready || !text.trim()) return;

    setStatus('generating');
    setError(null);
    addLog(`Generating speech: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}" (sid=${speakerId}, speed=${speed})`);

    try {
      const result = await engineRef.current.generate(text, speakerId, speed);
      const durationMs = Math.round((result.samples.length / result.sampleRate) * 1000);
      addLog(`Generated ${durationMs}ms audio in ${result.generationTimeMs}ms (${result.sampleRate}Hz, ${result.samples.length} samples)`);

      setResults(prev => [...prev, { ...result, text }]);
      setStatus('ready');

      // Play audio immediately
      playAudio(result.samples, result.sampleRate);
    } catch (err: any) {
      setStatus('ready');
      setError(err.message);
      addLog(`Generation failed: ${err.message}`);
    }
  }, [text, speakerId, speed, addLog]);

  const playAudio = useCallback((samples: Float32Array, sampleRate: number) => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext({ sampleRate });
      }

      const audioCtx = audioCtxRef.current;
      const buffer = audioCtx.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start();
      addLog('Playing audio...');
    } catch (err: any) {
      addLog(`Playback error: ${err.message}`);
    }
  }, [addLog]);

  const handleDispose = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setStatus('idle');
    setLoadTime(null);
    setNumSpeakers(0);
    setOutputSampleRate(0);
    setStatusMessage('');
    addLog('Engine disposed');
  }, [addLog]);

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
      <h3 style={{ margin: '0 0 12px', color: '#9b59b6' }}>
        TTS Prototype (sherpa-onnx WASM)
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
          {ttsModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.name} (~{m.totalSizeMb}MB)
            </option>
          ))}
        </select>
      </div>

      {/* Load / Dispose controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={handleInit}
          disabled={status === 'loading' || status === 'generating'}
          style={btnStyle('#10a37f')}
        >
          {status === 'loading' ? 'Loading...' : 'Load Model'}
        </button>
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

      {/* Text input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
          Text to synthesize:
        </label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={status !== 'ready'}
          rows={3}
          style={{
            ...selectStyle,
            resize: 'vertical',
            minHeight: 60,
          }}
        />
      </div>

      {/* Speaker ID + Speed + Generate */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Speaker ID (0-{Math.max(0, numSpeakers - 1)}):
          </label>
          <input
            type="number"
            value={speakerId}
            onChange={e => setSpeakerId(Math.max(0, Math.min(numSpeakers - 1, parseInt(e.target.value) || 0)))}
            min={0}
            max={Math.max(0, numSpeakers - 1)}
            disabled={status !== 'ready'}
            style={{ ...selectStyle, width: '100%' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
            Speed: {speed.toFixed(1)}x
          </label>
          <input
            type="range"
            value={speed}
            onChange={e => setSpeed(parseFloat(e.target.value))}
            min={0.5}
            max={2.0}
            step={0.1}
            disabled={status !== 'ready'}
            style={{ width: '100%' }}
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={status !== 'ready' || !text.trim()}
          style={btnStyle('#3498db')}
        >
          {status === 'generating' ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ fontSize: 11, marginBottom: 12, color: '#888' }}>
        Status: <span style={{ color: statusColor(status) }}>{status}</span>
        {loadTime !== null && ` | Load: ${(loadTime / 1000).toFixed(1)}s`}
        {numSpeakers > 0 && ` | Speakers: ${numSpeakers}`}
        {outputSampleRate > 0 && ` | ${outputSampleRate}Hz`}
        {lastResult && ` | Last: ${lastResult.generationTimeMs}ms`}
        {` | Clips: ${results.length}`}
      </div>

      {/* Results */}
      <div style={{
        minHeight: 80,
        maxHeight: 200,
        overflow: 'auto',
        background: '#16213e',
        border: '1px solid #2a2a4a',
        borderRadius: 4,
        padding: 8,
        marginBottom: 8,
      }}>
        {results.length === 0
          ? (status === 'generating'
            ? 'Generating speech...'
            : 'Generated audio will appear here')
          : results.map((r, i) => {
            const durationMs = Math.round((r.samples.length / r.sampleRate) * 1000);
            return (
              <div key={i} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => playAudio(r.samples, r.sampleRate)}
                  style={{
                    ...btnStyle('#9b59b6'),
                    padding: '2px 8px',
                    fontSize: 11,
                    flexShrink: 0,
                  }}
                >
                  Play
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: '#888', fontSize: 10 }}>
                    [{durationMs}ms audio, {r.generationTimeMs}ms gen]
                  </span>{' '}
                  <span style={{ fontSize: 12 }}>
                    {r.text.length > 80 ? r.text.substring(0, 80) + '...' : r.text}
                  </span>
                </div>
              </div>
            );
          })
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
  fontFamily: 'monospace',
  boxSizing: 'border-box',
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

function statusColor(status: string): string {
  switch (status) {
    case 'ready': return '#10a37f';
    case 'loading': return '#f39c12';
    case 'generating': return '#3498db';
    case 'error': return '#e74c3c';
    default: return '#888';
  }
}

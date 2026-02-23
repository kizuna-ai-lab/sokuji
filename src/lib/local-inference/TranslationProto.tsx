/**
 * Translation Prototype — Standalone test component.
 * Drop this into the app to validate ONNX + Web Worker + Opus-MT works.
 *
 * Usage: import { TranslationProto } from '../lib/local-inference/TranslationProto';
 *        Then render <TranslationProto /> somewhere in the app.
 */

import { useState, useRef, useCallback } from 'react';
import { TranslationEngine, TranslationProgress } from './engine/TranslationEngine';

const LANG_PAIRS = TranslationEngine.getAvailableLanguagePairs();

export function TranslationProto() {
  const engineRef = useRef<TranslationEngine | null>(null);

  const [sourceLang, setSourceLang] = useState('ja');
  const [targetLang, setTargetLang] = useState('en');
  const [inputText, setInputText] = useState('こんにちは、世界。今日はいい天気ですね。');
  const [outputText, setOutputText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'translating' | 'error'>('idle');
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [inferenceTime, setInferenceTime] = useState<number | null>(null);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLog(prev => [...prev.slice(-19), `[${ts}] ${msg}`]);
  }, []);

  const handleInit = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setOutputText('');
    setInferenceTime(null);
    setProgress(null);
    addLog(`Initializing ${sourceLang} → ${targetLang}...`);

    // Dispose previous engine
    if (engineRef.current) {
      engineRef.current.dispose();
      addLog('Previous engine disposed');
    }

    const engine = new TranslationEngine();
    engineRef.current = engine;

    engine.onProgress = (p) => {
      setProgress(p);
      addLog(`Downloading ${p.file}: ${Math.round(p.progress)}%`);
    };

    engine.onError = (err) => {
      setError(err);
      addLog(`Error: ${err}`);
    };

    try {
      const { loadTimeMs } = await engine.init(sourceLang, targetLang);
      setLoadTime(loadTimeMs);
      setStatus('ready');
      addLog(`Model loaded in ${loadTimeMs}ms`);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      addLog(`Init failed: ${err.message}`);
    }
  }, [sourceLang, targetLang, addLog]);

  const handleTranslate = useCallback(async () => {
    if (!engineRef.current?.ready) return;

    setStatus('translating');
    setOutputText('');
    addLog(`Translating: "${inputText.slice(0, 50)}..."`);

    try {
      const result = await engineRef.current.translate(inputText);
      setOutputText(result.translatedText);
      setInferenceTime(result.inferenceTimeMs);
      setStatus('ready');
      addLog(`Translated in ${result.inferenceTimeMs}ms: "${result.translatedText.slice(0, 50)}..."`);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      addLog(`Translation failed: ${err.message}`);
    }
  }, [inputText, addLog]);

  const handleDispose = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setStatus('idle');
    setLoadTime(null);
    setInferenceTime(null);
    setProgress(null);
    addLog('Engine disposed');
  }, [addLog]);

  const pair = `${sourceLang}-${targetLang}`;
  const isPairSupported = LANG_PAIRS.includes(pair);

  return (
    <div style={{
      padding: 16,
      fontFamily: 'monospace',
      fontSize: 13,
      background: '#1a1a2e',
      color: '#e0e0e0',
      borderRadius: 8,
      maxWidth: 600,
    }}>
      <h3 style={{ margin: '0 0 12px', color: '#10a37f' }}>
        Translation Prototype (Opus-MT + ONNX WASM)
      </h3>

      {/* Language pair */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={sourceLang} onChange={e => setSourceLang(e.target.value)}
          style={selectStyle}>
          <option value="ja">Japanese</option>
          <option value="en">English</option>
          <option value="zh">Chinese</option>
          <option value="ko">Korean</option>
          <option value="de">German</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
        <span style={{ alignSelf: 'center' }}>→</span>
        <select value={targetLang} onChange={e => setTargetLang(e.target.value)}
          style={selectStyle}>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
          <option value="zh">Chinese</option>
          <option value="ko">Korean</option>
          <option value="de">German</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
        {!isPairSupported && (
          <span style={{ color: '#e74c3c', alignSelf: 'center', fontSize: 11 }}>
            Pair not available
          </span>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={handleInit}
          disabled={!isPairSupported || status === 'loading'}
          style={btnStyle('#10a37f')}>
          {status === 'loading' ? 'Loading...' : 'Load Model'}
        </button>
        <button onClick={handleTranslate}
          disabled={status !== 'ready'}
          style={btnStyle('#3498db')}>
          Translate
        </button>
        <button onClick={handleDispose}
          disabled={status === 'idle'}
          style={btnStyle('#e74c3c')}>
          Dispose
        </button>
      </div>

      {/* Progress */}
      {progress && status === 'loading' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>
            Downloading: {progress.file} ({Math.round(progress.progress)}%)
          </div>
          <div style={{ background: '#333', borderRadius: 4, height: 6 }}>
            <div style={{
              background: '#10a37f',
              borderRadius: 4,
              height: 6,
              width: `${progress.progress}%`,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ fontSize: 11, marginBottom: 12, color: '#888' }}>
        Status: <span style={{ color: statusColor(status) }}>{status}</span>
        {loadTime !== null && ` | Model load: ${loadTime}ms`}
        {inferenceTime !== null && ` | Inference: ${inferenceTime}ms`}
      </div>

      {/* Input */}
      <textarea
        value={inputText}
        onChange={e => setInputText(e.target.value)}
        placeholder="Enter text to translate..."
        rows={3}
        style={textareaStyle}
      />

      {/* Output */}
      <div style={{
        ...textareaStyle,
        minHeight: 60,
        background: '#16213e',
        border: '1px solid #2a2a4a',
        padding: 8,
        whiteSpace: 'pre-wrap',
      }}>
        {outputText || (status === 'translating' ? 'Translating...' : 'Output will appear here')}
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
  resize: 'vertical',
  marginBottom: 8,
  boxSizing: 'border-box',
};

function statusColor(status: string): string {
  switch (status) {
    case 'ready': return '#10a37f';
    case 'loading':
    case 'translating': return '#f39c12';
    case 'error': return '#e74c3c';
    default: return '#888';
  }
}

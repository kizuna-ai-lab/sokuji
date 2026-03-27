# Voxtral Mini 4B Realtime ASR Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate Voxtral Mini 4B Realtime as a WebGPU streaming ASR engine via a standalone prototype component.

**Architecture:** Single self-contained React component (`VoxtralAsrProto.tsx`) that loads the ONNX model via `@huggingface/transformers` v4 on the main thread, captures mic audio via AudioWorklet, and runs streaming inference with an async input features generator + token streamer. Toggled via `Ctrl+Shift+V` keyboard shortcut in `App.tsx`.

**Tech Stack:** React 18, TypeScript, `@huggingface/transformers` 4.0.0-next.7, WebGPU, AudioWorklet API

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Bump `@huggingface/transformers` to `4.0.0-next.7` |
| `src/lib/local-inference/VoxtralAsrProto.tsx` | Create | Standalone prototype component with model loading, audio capture, streaming ASR, and UI |
| `src/App.tsx` | Modify | Add `Ctrl+Shift+V` keyboard shortcut to toggle the prototype overlay |

---

### Task 1: Create Feature Branch and Bump Dependency

**Files:**
- Modify: `package.json:16` (`@huggingface/transformers` version)

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/voxtral-asr-prototype
```

- [ ] **Step 2: Bump `@huggingface/transformers` version in `package.json`**

In `package.json`, change line 16:

```diff
-    "@huggingface/transformers": "4.0.0-next.5",
+    "@huggingface/transformers": "4.0.0-next.7",
```

- [ ] **Step 3: Install updated dependency**

```bash
npm install
```

Expected: Clean install with no errors. The `VoxtralRealtimeForConditionalGeneration` and `VoxtralRealtimeProcessor` classes should now be available.

- [ ] **Step 4: Verify Voxtral exports exist**

```bash
node -e "import('@huggingface/transformers').then(m => console.log('VoxtralRealtimeForConditionalGeneration' in m, 'VoxtralRealtimeProcessor' in m, 'BaseStreamer' in m))"
```

Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump @huggingface/transformers to 4.0.0-next.7

Adds VoxtralRealtimeForConditionalGeneration and VoxtralRealtimeProcessor
exports needed for Voxtral ASR prototype.

Refs #125"
```

---

### Task 2: Create VoxtralAsrProto Component

**Files:**
- Create: `src/lib/local-inference/VoxtralAsrProto.tsx`

This is the core prototype component. It implements all five states (idle, loading, ready, recording, error), model loading with progress, mic capture via AudioWorklet, streaming transcription via async generator + BaseStreamer, and cleanup.

- [ ] **Step 1: Create the VoxtralAsrProto component**

Create `src/lib/local-inference/VoxtralAsrProto.tsx` with the following content:

```tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  BaseStreamer,
  VoxtralRealtimeForConditionalGeneration,
  VoxtralRealtimeProcessor,
  type ProgressInfo,
} from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX';
const SAMPLE_RATE = 16000;
const MODEL_FILE_COUNT = 3;
const CAPTURE_PROCESSOR_NAME = 'capture-processor';
const CAPTURE_WORKLET_SOURCE = `
  class CaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
      const input = inputs[0];
      if (input.length > 0 && input[0].length > 0) {
        this.port.postMessage(input[0]);
      }
      return true;
    }
  }
  registerProcessor("capture-processor", CaptureProcessor);
`;

type AppStatus = 'idle' | 'loading' | 'ready' | 'recording' | 'error';

function checkWebGPU(): boolean {
  return 'gpu' in navigator;
}

function waitUntil(condition: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (condition()) return resolve();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

interface VoxtralAsrProtoProps {
  onClose: () => void;
}

export const VoxtralAsrProto: React.FC<VoxtralAsrProtoProps> = ({ onClose }) => {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('Ready to load model');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const modelRef = useRef<any>(null);
  const processorRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioBufferRef = useRef<Float32Array>(new Float32Array(0));
  const isRecordingRef = useRef(false);
  const stopRequestedRef = useRef(false);

  const cleanupAudio = useCallback(() => {
    isRecordingRef.current = false;

    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const appendAudio = useCallback((newSamples: Float32Array) => {
    if (newSamples.length === 0) return;
    const prev = audioBufferRef.current;
    const merged = new Float32Array(prev.length + newSamples.length);
    merged.set(prev);
    merged.set(newSamples, prev.length);
    audioBufferRef.current = merged;
  }, []);

  const loadModel = useCallback(async () => {
    if (status === 'loading' || status === 'ready') return;

    if (!checkWebGPU()) {
      setError('WebGPU is not available in this browser. Please use Chrome 113+ or Edge 113+.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setLoadingProgress(0);
    setLoadingMessage('Preparing model download...');
    setError(null);

    try {
      const progressMap = new Map<string, number>();
      const progressCallback = (info: ProgressInfo) => {
        if (
          info.status !== 'progress' ||
          !info.file.endsWith('.onnx_data') ||
          info.total === 0
        ) {
          return;
        }
        progressMap.set(info.file, info.loaded / info.total);
        const totalProgress = Array.from(progressMap.values()).reduce(
          (sum, value) => sum + value,
          0,
        );
        setLoadingMessage('Downloading model...');
        setLoadingProgress(Math.min((totalProgress / MODEL_FILE_COUNT) * 100, 100));
      };

      const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
        MODEL_ID,
        {
          dtype: {
            audio_encoder: 'q4f16',
            embed_tokens: 'q4f16',
            decoder_model_merged: 'q4f16',
          },
          device: 'webgpu',
          progress_callback: progressCallback,
        },
      );

      setLoadingMessage('Loading processor...');
      const processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL_ID);

      modelRef.current = model;
      processorRef.current = processor;
      setLoadingProgress(100);
      setLoadingMessage('Model ready');
      setStatus('ready');
    } catch (err) {
      console.error('Failed to load model:', err);
      setError(err instanceof Error ? err.message : 'Failed to load model');
      setLoadingMessage('Initialization failed');
      setStatus('error');
    }
  }, [status]);

  const runTranscription = useCallback(
    async (model: any, processor: any) => {
      const audio = () => audioBufferRef.current;
      const numSamplesFirst = processor.num_samples_first_audio_chunk;

      await waitUntil(() => audio().length >= numSamplesFirst || stopRequestedRef.current);
      if (stopRequestedRef.current) {
        cleanupAudio();
        setStatus('ready');
        return;
      }

      const firstChunkInputs = await processor(
        audio().subarray(0, numSamplesFirst),
        { is_streaming: true, is_first_audio_chunk: true },
      );

      const featureExtractor = processor.feature_extractor;
      const { hop_length, n_fft } = featureExtractor.config;
      const winHalf = Math.floor(n_fft / 2);
      const samplesPerTok = processor.audio_length_per_tok * hop_length;

      async function* inputFeaturesGenerator() {
        yield firstChunkInputs.input_features;

        let melFrameIdx = processor.num_mel_frames_first_audio_chunk;
        let startIdx = melFrameIdx * hop_length - winHalf;

        while (!stopRequestedRef.current) {
          const endNeeded = startIdx + processor.num_samples_per_audio_chunk;

          await waitUntil(() => audio().length >= endNeeded || stopRequestedRef.current);
          if (stopRequestedRef.current) break;

          const availableSamples = audio().length;
          let batchEndSample = endNeeded;
          while (batchEndSample + samplesPerTok <= availableSamples) {
            batchEndSample += samplesPerTok;
          }

          const chunkInputs = await processor(
            audio().slice(startIdx, batchEndSample),
            { is_streaming: true, is_first_audio_chunk: false },
          );

          yield chunkInputs.input_features;

          melFrameIdx += chunkInputs.input_features.dims[2];
          startIdx = melFrameIdx * hop_length - winHalf;
        }
      }

      const tokenizer = processor.tokenizer;
      const specialIds = new Set(tokenizer.all_special_ids.map(BigInt));
      let tokenCache: bigint[] = [];
      let printLen = 0;
      let isPrompt = true;

      const flushDecodedText = () => {
        if (tokenCache.length === 0) return;
        const text = tokenizer.decode(tokenCache, { skip_special_tokens: true });
        const printableText = text.slice(printLen);
        printLen = text.length;
        if (printableText.length > 0) {
          setTranscript((prev) => prev + printableText);
        }
      };

      const streamer = new (class extends BaseStreamer {
        put(value: bigint[][]) {
          if (stopRequestedRef.current) return;
          if (isPrompt) {
            isPrompt = false;
            return;
          }
          const tokens = value[0];
          if (tokens.length === 1 && specialIds.has(tokens[0])) return;
          tokenCache = tokenCache.concat(tokens);
          flushDecodedText();
        }
        end() {
          if (stopRequestedRef.current) {
            tokenCache = [];
            printLen = 0;
            isPrompt = true;
            return;
          }
          flushDecodedText();
          tokenCache = [];
          printLen = 0;
          isPrompt = true;
        }
      })();

      try {
        await (model as any).generate({
          input_ids: firstChunkInputs.input_ids,
          input_features: inputFeaturesGenerator(),
          max_new_tokens: 4096,
          streamer: streamer as any,
        });
      } catch (err) {
        if (!stopRequestedRef.current) {
          console.error('Transcription error:', err);
          setError(err instanceof Error ? err.message : 'Transcription failed');
        }
      } finally {
        cleanupAudio();
        setStatus('ready');
      }
    },
    [cleanupAudio],
  );

  const startRecording = useCallback(async () => {
    const model = modelRef.current;
    const processor = processorRef.current;
    if (!model || !processor || isRecordingRef.current) return;

    setTranscript('');
    setError(null);
    audioBufferRef.current = new Float32Array(0);
    isRecordingRef.current = true;
    stopRequestedRef.current = false;
    setStatus('recording');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: SAMPLE_RATE },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;
      await audioContext.resume();

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0;

      const workletBlob = new Blob([CAPTURE_WORKLET_SOURCE], {
        type: 'application/javascript',
      });
      const workletUrl = URL.createObjectURL(workletBlob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const workletNode = new AudioWorkletNode(audioContext, CAPTURE_PROCESSOR_NAME);
      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (isRecordingRef.current) {
          appendAudio(new Float32Array(event.data));
        }
      };

      sourceNode.connect(workletNode);
      workletNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);
      workletNodeRef.current = workletNode;

      await runTranscription(model, processor);
    } catch (err) {
      console.error('Recording error:', err);
      setError(err instanceof Error ? err.message : 'Recording failed');
      cleanupAudio();
      setStatus('ready');
    }
  }, [appendAudio, cleanupAudio, runTranscription]);

  const stopRecording = useCallback(() => {
    stopRequestedRef.current = true;
    isRecordingRef.current = false;
    cleanupAudio();
  }, [cleanupAudio]);

  const resetSession = useCallback(() => {
    stopRequestedRef.current = false;
    audioBufferRef.current = new Float32Array(0);
    setTranscript('');
    setError(null);
    setStatus('ready');
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      backgroundColor: '#1e1e1e',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 20px',
        borderBottom: '1px solid #333',
      }}>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '0.2em', color: '#888', textTransform: 'uppercase' }}>
            Prototype
          </div>
          <div style={{ fontSize: '18px', fontWeight: 600 }}>
            Voxtral Mini 4B Realtime ASR
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Status badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '12px',
            border: `1px solid ${error ? '#e74c3c44' : status === 'recording' ? '#10a37f44' : '#555'}`,
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: error ? '#e74c3c' : status === 'recording' ? '#10a37f' : '#888',
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: error ? '#e74c3c' : status === 'recording' ? '#10a37f' : '#888',
              animation: status === 'recording' ? 'pulse 1.5s infinite' : 'none',
            }} />
            {error ? 'ERROR' : status === 'recording' ? 'LIVE' : status === 'loading' ? 'LOADING' : status === 'ready' ? 'READY' : 'IDLE'}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #555',
              color: '#ccc',
              padding: '4px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Close (Ctrl+Shift+V)
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: status === 'recording' && transcript ? 'flex-start' : 'center',
        padding: '24px',
        overflow: 'auto',
      }}>
        {/* Error display */}
        {error && (
          <div style={{
            backgroundColor: '#e74c3c15',
            border: '1px solid #e74c3c44',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            maxWidth: '600px',
            width: '100%',
            fontSize: '13px',
            color: '#e74c3c',
          }}>
            {error}
          </div>
        )}

        {/* Idle state */}
        {status === 'idle' && !error && (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={loadModel}
              style={{
                background: 'linear-gradient(135deg, #10a37f, #0d8a6a)',
                border: 'none',
                color: '#fff',
                padding: '14px 32px',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 8px 24px #10a37f30',
              }}
            >
              Load Model (~2GB)
            </button>
            <p style={{ color: '#888', fontSize: '13px', marginTop: '12px' }}>
              Requires WebGPU. Model will be cached in browser after first download.
            </p>
          </div>
        )}

        {/* Loading state */}
        {status === 'loading' && (
          <div style={{ textAlign: 'center', maxWidth: '400px', width: '100%' }}>
            <p style={{ color: '#ccc', fontSize: '14px', marginBottom: '12px' }}>{loadingMessage}</p>
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#333',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${loadingProgress}%`,
                height: '100%',
                backgroundColor: '#10a37f',
                borderRadius: '4px',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <p style={{ color: '#888', fontSize: '12px', marginTop: '8px' }}>
              {loadingProgress.toFixed(1)}%
            </p>
          </div>
        )}

        {/* Ready state */}
        {status === 'ready' && !error && !transcript && (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={startRecording}
              style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #10a37f, #0d8a6a)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 12px 32px #10a37f30',
              }}
            >
              {/* Mic icon */}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
            <p style={{ color: '#888', fontSize: '14px', marginTop: '16px' }}>
              Tap to start transcription
            </p>
          </div>
        )}

        {/* Recording state / transcript display */}
        {(status === 'recording' || (status === 'ready' && transcript)) && (
          <div style={{ maxWidth: '700px', width: '100%' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                Transcript
              </span>
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#555',
                backgroundColor: '#2a2a2a',
                padding: '2px 8px',
                borderRadius: '4px',
              }}>
                {transcript ? 'Live output' : 'Waiting for speech'}
              </span>
            </div>
            <div style={{
              minHeight: '200px',
              padding: '16px',
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              border: '1px solid #333',
            }}>
              {transcript ? (
                <p style={{
                  fontSize: '18px',
                  fontFamily: 'monospace',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                }}>
                  {transcript.trimStart()}
                  {status === 'recording' && (
                    <span style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '18px',
                      backgroundColor: '#10a37f',
                      marginLeft: '4px',
                      verticalAlign: 'middle',
                      animation: 'blink 1s step-end infinite',
                    }} />
                  )}
                </p>
              ) : (
                <p style={{ color: '#555', fontStyle: 'italic', fontSize: '14px', margin: 0 }}>
                  Listening for speech...
                </p>
              )}
            </div>
          </div>
        )}

        {/* Error retry state */}
        {status === 'error' && (
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button
              onClick={() => { setError(null); setStatus('idle'); }}
              style={{
                background: 'none',
                border: '1px solid #555',
                color: '#ccc',
                padding: '8px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Footer controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
        padding: '16px',
        borderTop: '1px solid #333',
      }}>
        {status === 'recording' && (
          <button
            onClick={stopRecording}
            style={{
              background: 'linear-gradient(135deg, #e74c3c, #c0392b)',
              border: 'none',
              color: '#fff',
              padding: '10px 24px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            Stop
          </button>
        )}
        {status === 'ready' && transcript && (
          <>
            <button
              onClick={resetSession}
              style={{
                background: 'none',
                border: '1px solid #555',
                color: '#ccc',
                padding: '10px 24px',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
            <button
              onClick={startRecording}
              style={{
                background: 'linear-gradient(135deg, #10a37f, #0d8a6a)',
                border: 'none',
                color: '#fff',
                padding: '10px 24px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Record Again
            </button>
          </>
        )}
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/lib/local-inference/VoxtralAsrProto.tsx 2>&1 | head -20
```

Expected: No type errors (or only errors from `any` usage on model/processor refs, which is acceptable for prototype).

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/VoxtralAsrProto.tsx
git commit -m "feat: add VoxtralAsrProto component for streaming ASR prototype

Standalone prototype for Voxtral Mini 4B Realtime ASR via WebGPU.
Implements model loading with progress, AudioWorklet mic capture,
streaming transcription with async input features generator,
and BaseStreamer token decoding.

Refs #125"
```

---

### Task 3: Register Keyboard Shortcut in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add keyboard shortcut and conditional rendering**

Replace the entire `src/App.tsx` with:

```tsx
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import './App.scss';
import './locales'; // Initialize i18n
import { RootLayout } from './layouts/RootLayout';
import { Home } from './routes/Home';
import { SignIn } from './routes/SignIn';
import { SignUp } from './routes/SignUp';
import { ForgotPassword } from './routes/ForgotPassword';

const VoxtralAsrProto = lazy(() =>
  import('./lib/local-inference/VoxtralAsrProto').then((m) => ({
    default: m.VoxtralAsrProto,
  })),
);

// Create the memory router for Chrome extension
// Memory router is recommended for Chrome extensions as they don't have a URL bar
const router = createMemoryRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: 'sign-in/*',
        element: <SignIn />,
      },
      {
        path: 'sign-up/*',
        element: <SignUp />,
      },
      {
        path: 'forgot-password',
        element: <ForgotPassword />,
      },
    ],
  },
]);

function App() {
  const [showVoxtralProto, setShowVoxtralProto] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+V: Toggle Voxtral ASR Prototype
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        setShowVoxtralProto((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="App">
      <RouterProvider router={router} />
      {showVoxtralProto && (
        <Suspense fallback={null}>
          <VoxtralAsrProto onClose={() => setShowVoxtralProto(false)} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
```

Key changes:
- Lazy-load `VoxtralAsrProto` so it doesn't bloat the main bundle
- `Ctrl+Shift+V` toggles the overlay on/off
- `onClose` callback lets the component's close button also dismiss it
- `Suspense` with `null` fallback — the overlay renders instantly once loaded

- [ ] **Step 2: Verify the app still starts**

```bash
npm run dev
```

Expected: Dev server starts on port 5173 with no errors. App loads normally. Pressing `Ctrl+Shift+V` shows the Voxtral prototype overlay.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register Ctrl+Shift+V shortcut for Voxtral ASR prototype

Lazy-loads VoxtralAsrProto as a full-screen overlay toggled via
Ctrl+Shift+V keyboard shortcut in development.

Refs #125"
```

---

### Task 4: Manual Smoke Test

This task validates the success criteria from the spec.

- [ ] **Step 1: Test WebGPU detection**

Open the app in a browser without WebGPU (e.g., Firefox). Press `Ctrl+Shift+V`. Click "Load Model".

Expected: Error message "WebGPU is not available in this browser."

- [ ] **Step 2: Test model loading**

Open the app in Chrome/Edge with WebGPU. Press `Ctrl+Shift+V`. Click "Load Model (~2GB)".

Expected: Progress bar advances as model downloads. Status shows "LOADING". After completion, status changes to "READY" and mic button appears.

- [ ] **Step 3: Test recording and transcription**

Click the mic button and speak a few sentences in English.

Expected: Status changes to "LIVE". After initial buffering (~480ms), transcript text appears progressively as you speak. Blinking cursor shows at the end.

- [ ] **Step 4: Test stop and reset**

Click "Stop" while recording.

Expected: Recording stops cleanly, status returns to "READY". Transcript remains visible. "Reset" and "Record Again" buttons appear. Click "Reset" — transcript clears.

- [ ] **Step 5: Test close shortcut**

Press `Ctrl+Shift+V` while prototype is open.

Expected: Overlay dismisses, normal app content is visible underneath.

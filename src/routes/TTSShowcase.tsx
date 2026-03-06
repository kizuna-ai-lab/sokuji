import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Languages, Play, Radio, RefreshCw, Save, SlidersHorizontal, Square, Upload, Waves, Sparkles, Users2 } from 'lucide-react';
import './TTSShowcase.scss';

const DEFAULT_WS_BASE = import.meta.env.VITE_TTS_WS_BASE || 'ws://127.0.0.1:8765';
const DEFAULT_TEXT = 'Hello from Eburon. This is a local VibeVoice websocket TTS demo.';
const DEFAULT_DIALOGUE = `A: Hey! I'm excited to test a natural two-speaker conversation.
B: Same here—let's keep it expressive, warm, and human sounding.`;

type NuanceStyle = 'neutral' | 'warm' | 'expressive' | 'podcast' | 'cinematic' | 'angry' | 'fast_talking' | 'grieve';

const LANGUAGE_LABELS = {
  auto: 'Auto Detect',
  ar: 'Arabic',
  bn: 'Bengali',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fa: 'Persian (Farsi)',
  fi: 'Finnish',
  fil: 'Filipino',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ms: 'Malay',
  nl: 'Dutch',
  pl: 'Polish',
  pt_BR: 'Portuguese (Brazil)',
  pt_PT: 'Portuguese (Portugal)',
  ru: 'Russian',
  sv: 'Swedish',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  zh_CN: 'Chinese (Simplified)',
  zh_TW: 'Chinese (Traditional)',
} as const;
type OutputLanguage = keyof typeof LANGUAGE_LABELS;

function normalizeWsBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function wsToHttpBase(wsBase: string): string {
  const normalized = normalizeWsBase(wsBase);
  if (normalized.startsWith('wss://')) {
    return `https://${normalized.slice('wss://'.length)}`;
  }
  if (normalized.startsWith('ws://')) {
    return `http://${normalized.slice('ws://'.length)}`;
  }
  return normalized;
}

function isValidWsBase(value: string): boolean {
  const normalized = normalizeWsBase(value);
  return normalized.startsWith('ws://') || normalized.startsWith('wss://');
}

function isValidHttpBase(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function applyNuanceStyle(text: string, style: NuanceStyle): string {
  const cleaned = text.trim();
  if (!cleaned || style === 'neutral') {
    return cleaned;
  }

  const marker = {
    warm: '(smiles softly)',
    expressive: '(laughs lightly)',
    podcast: '(friendly host tone)',
    cinematic: '(gentle dramatic pause)',
    angry: '(angry tone, sharp emphasis)',
    fast_talking: '(talking fast with energetic pacing)',
    grieve: '(grieving tone, emotionally heavy)',
  }[style];

  return `${marker} ${cleaned}`;
}

function applyLanguageHint(text: string, language: OutputLanguage): string {
  const cleaned = text.trim();
  if (!cleaned || language === 'auto') {
    return cleaned;
  }

  return `[Speak in ${LANGUAGE_LABELS[language]}] ${cleaned}`;
}

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);

  for (let i = 0; i < int16.length; i += 1) {
    float32[i] = int16[i] / 32768;
  }

  return float32;
}

export function TTSShowcase() {
  const navigate = useNavigate();
  const [wsBase, setWsBase] = useState(DEFAULT_WS_BASE);
  const [voice, setVoice] = useState('en-Carter_man');
  const [voices, setVoices] = useState<string[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [cfgScale, setCfgScale] = useState('1.5');
  const [text, setText] = useState(DEFAULT_TEXT);
  const [dialogueText, setDialogueText] = useState(DEFAULT_DIALOGUE);
  const [speakerAVoice, setSpeakerAVoice] = useState('');
  const [speakerBVoice, setSpeakerBVoice] = useState('');
  const [speakerCVoice, setSpeakerCVoice] = useState('');
  const [speakerDVoice, setSpeakerDVoice] = useState('');
  const [nuanceStyle, setNuanceStyle] = useState<NuanceStyle>('expressive');
  const [language, setLanguage] = useState<OutputLanguage>('auto');
  const [streamVolume, setStreamVolume] = useState(0.9);
  const [speakerPauseMs, setSpeakerPauseMs] = useState(120);
  const [saveName, setSaveName] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneMessage, setCloneMessage] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVoiceName, setUploadVoiceName] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState('');
  const [generatedAudioMeta, setGeneratedAudioMeta] = useState<{ file: string; duration: number } | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'done' | 'error'>('idle');
  const [lastError, setLastError] = useState<string>('');

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamSessionRef = useRef(0);
  const [hasPlayback, setHasPlayback] = useState(false);
  const isStreamingActive = status === 'connecting' || status === 'streaming';

  const loadVoices = useCallback(async () => {
    const apiBase = wsToHttpBase(wsBase);
    if (!isValidHttpBase(apiBase)) {
      setVoices([]);
      return;
    }

    setVoicesLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/voices`);
      if (!response.ok) {
        throw new Error('Unable to load voices from TTS server');
      }

      const payload = await response.json();
      const nextVoices = Array.isArray(payload.voices) ? payload.voices : [];
      setVoices(nextVoices);
      setLastError('');

      if (nextVoices.length > 0) {
        const defaultVoice = typeof payload.default === 'string' ? payload.default : nextVoices[0];
        setVoice((prev) => (nextVoices.includes(prev) ? prev : defaultVoice));
        setSpeakerAVoice((prev) => (nextVoices.includes(prev) ? prev : defaultVoice));
        setSpeakerBVoice((prev) => (nextVoices.includes(prev) ? prev : nextVoices[Math.min(1, nextVoices.length - 1)]));
        setSpeakerCVoice((prev) => (nextVoices.includes(prev) ? prev : nextVoices[Math.min(2, nextVoices.length - 1)]));
        setSpeakerDVoice((prev) => (nextVoices.includes(prev) ? prev : nextVoices[Math.min(3, nextVoices.length - 1)]));
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setVoicesLoading(false);
    }
  }, [wsBase]);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = streamVolume;
    }
  }, [streamVolume]);

  const stopPlayback = useCallback((updateState = true) => {
    if (playbackSourcesRef.current.size > 0) {
      playbackSourcesRef.current.forEach((source) => {
        try {
          source.stop(0);
        } catch {
          // Source may already be stopped
        }
        source.disconnect();
      });
      playbackSourcesRef.current.clear();
    }

    if (audioContextRef.current) {
      nextPlaybackTimeRef.current = audioContextRef.current.currentTime;
    } else {
      nextPlaybackTimeRef.current = 0;
    }

    if (updateState) {
      setHasPlayback(false);
    }
  }, []);

  const stopStreaming = useCallback((nextStatus: 'idle' | 'done' | 'error' = 'done') => {
    const activeSocket = socketRef.current;
    socketRef.current = null;
    streamSessionRef.current += 1;

    if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
      activeSocket.close();
    }

    stopPlayback();
    setStatus(nextStatus);
  }, [stopPlayback]);

  const playChunk = useCallback(async (arrayBuffer: ArrayBuffer, sessionId: number) => {
    if (sessionId !== streamSessionRef.current) {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }

    const ctx = audioContextRef.current;
    await ctx.resume();
    if (sessionId !== streamSessionRef.current) {
      return;
    }

    if (!gainNodeRef.current) {
      gainNodeRef.current = ctx.createGain();
      gainNodeRef.current.gain.value = streamVolume;
      gainNodeRef.current.connect(ctx.destination);
    }

    const channelData = pcm16ToFloat32(arrayBuffer);
    if (channelData.length === 0 || sessionId !== streamSessionRef.current) {
      return;
    }

    const audioBuffer = ctx.createBuffer(1, channelData.length, 24000);
    const monoChannel = audioBuffer.getChannelData(0);
    monoChannel.set(channelData);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNodeRef.current);
    source.onended = () => {
      playbackSourcesRef.current.delete(source);
      source.disconnect();
      if (playbackSourcesRef.current.size === 0) {
        setHasPlayback(false);
      }
    };

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlaybackTimeRef.current);
    source.start(startAt);
    playbackSourcesRef.current.add(source);
    setHasPlayback(true);

    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
  }, [streamVolume]);

  useEffect(() => {
    return () => {
      const activeSocket = socketRef.current;
      socketRef.current = null;
      streamSessionRef.current += 1;
      if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
        activeSocket.close();
      }

      stopPlayback(false);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
      gainNodeRef.current = null;
    };
  }, [stopPlayback]);

  const startStreaming = useCallback(async () => {
    setLastError('');

    const normalizedBase = normalizeWsBase(wsBase);
    if (!text.trim()) {
      setStatus('error');
      setLastError('Please enter text before starting TTS.');
      return;
    }

    if (!isValidWsBase(normalizedBase)) {
      setStatus('error');
      setLastError('WebSocket base URL must start with ws:// or wss://');
      return;
    }

    stopStreaming('idle');
    const sessionId = streamSessionRef.current;
    setStatus('connecting');

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      await audioContextRef.current.resume();
      nextPlaybackTimeRef.current = audioContextRef.current.currentTime;

      const nuancedText = applyLanguageHint(applyNuanceStyle(text, nuanceStyle), language);
      const parsedCfg = Number(cfgScale);
      const streamParams = new URLSearchParams({
        text: nuancedText,
        cfg: Number.isFinite(parsedCfg) && parsedCfg > 0 ? String(parsedCfg) : '1.5',
      });
      if (voice.trim()) {
        streamParams.set('voice', voice.trim());
      }
      if (language !== 'auto') {
        streamParams.set('language', language);
      }

      const socket = new WebSocket(`${normalizedBase}/ws/tts?${streamParams.toString()}`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket || sessionId !== streamSessionRef.current) {
          return;
        }
        setStatus('streaming');
      };

      socket.onmessage = async (event) => {
        if (socketRef.current !== socket || sessionId !== streamSessionRef.current) {
          return;
        }

        if (typeof event.data === 'string') {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'error') {
              setLastError(payload.message || 'TTS server returned an error');
              stopStreaming('error');
            }
          } catch {
            // Ignore non-JSON text frames
          }
          return;
        }

        if (event.data instanceof Blob) {
          const chunk = await event.data.arrayBuffer();
          await playChunk(chunk, sessionId);
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          await playChunk(event.data, sessionId);
        }
      };

      socket.onerror = () => {
        if (socketRef.current !== socket || sessionId !== streamSessionRef.current) {
          return;
        }
        setStatus('error');
        setLastError('WebSocket connection failed. Make sure vibevoice server is running on the configured host.');
      };

      socket.onclose = () => {
        if (socketRef.current !== socket || sessionId !== streamSessionRef.current) {
          return;
        }
        socketRef.current = null;
        setStatus((prev) => (prev === 'error' ? prev : 'done'));
      };
    } catch (err) {
      setStatus('error');
      setLastError(err instanceof Error ? err.message : 'Failed to start TTS stream');
    }
  }, [cfgScale, language, nuanceStyle, playChunk, stopStreaming, text, voice, wsBase]);

  const cloneSelectedVoice = useCallback(async () => {
    setCloneMessage('');
    setLastError('');

    if (!voice.trim()) {
      setLastError('Select a source voice before cloning.');
      return;
    }

    if (!cloneName.trim()) {
      setLastError('Enter a new clone voice name.');
      return;
    }

    const apiBase = wsToHttpBase(wsBase);
    if (!apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
      setLastError('WebSocket base URL is invalid for API calls.');
      return;
    }

    setCloneBusy(true);
    try {
      const response = await fetch(`${apiBase}/api/voices/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_voice: voice,
          new_voice: cloneName,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Voice cloning failed');
      }

      if (typeof payload.voice === 'string' && payload.voice) {
        setVoice(payload.voice);
      }

      setCloneMessage(`Clone created: ${payload.voice}`);
      setCloneName('');
      await loadVoices();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Failed to clone selected voice');
    } finally {
      setCloneBusy(false);
    }
  }, [cloneName, loadVoices, voice, wsBase]);

  const onUploadFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUploadFile(event.target.files?.[0] || null);
  }, []);

  const uploadAndCloneVoice = useCallback(async () => {
    setCloneMessage('');
    setLastError('');

    if (!uploadFile) {
      setLastError('Choose a .pt or audio file to upload.');
      return;
    }

    if (!uploadVoiceName.trim()) {
      setLastError('Enter a voice name for uploaded clone.');
      return;
    }

    const apiBase = wsToHttpBase(wsBase);
    if (!isValidHttpBase(apiBase)) {
      setLastError('WebSocket base URL is invalid for API calls.');
      return;
    }

    setUploadBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('new_voice', uploadVoiceName.trim());
      formData.append('source_voice', voice);

      const response = await fetch(`${apiBase}/api/voices/upload`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Upload clone failed');
      }

      if (payload.voice) {
        setVoice(payload.voice);
      }
      const note = payload.warning ? ` (${payload.warning})` : '';
      setCloneMessage(`Upload clone created: ${payload.voice}${note}`);
      setUploadVoiceName('');
      setUploadFile(null);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = '';
      }
      await loadVoices();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Upload clone failed');
    } finally {
      setUploadBusy(false);
    }
  }, [loadVoices, uploadFile, uploadVoiceName, voice, wsBase]);

  const saveGeneratedAudio = useCallback(async (dialogueMode: boolean) => {
    setLastError('');

    const trimmedText = text.trim();
    const trimmedDialogue = dialogueText.trim();
    if (!dialogueMode && !trimmedText) {
      setLastError('Enter text before generating audio.');
      return;
    }
    if (dialogueMode && !trimmedDialogue) {
      setLastError('Enter dialogue text before rendering two-speaker output.');
      return;
    }

    const apiBase = wsToHttpBase(wsBase);
    if (!isValidHttpBase(apiBase)) {
      setLastError('WebSocket base URL is invalid for API calls.');
      return;
    }

    setSaveBusy(true);
    try {
      const parsedCfg = Number(cfgScale);
      const payload = {
        text: dialogueMode ? trimmedDialogue : applyLanguageHint(trimmedText, language),
        voice,
        cfg: Number.isFinite(parsedCfg) && parsedCfg > 0 ? parsedCfg : 1.5,
        save_name: saveName.trim() || (dialogueMode ? 'two_speaker_dialogue' : 'single_speaker_tts'),
        dialogue_mode: dialogueMode,
        speaker_a_voice: speakerAVoice || voice,
        speaker_b_voice: speakerBVoice || speakerAVoice || voice,
        speaker_c_voice: speakerCVoice || speakerAVoice || voice,
        speaker_d_voice: speakerDVoice || speakerBVoice || speakerAVoice || voice,
        speaker_pause_ms: speakerPauseMs,
        nuance_style: nuanceStyle,
        language,
      };

      const response = await fetch(`${apiBase}/api/tts/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save generated audio');
      }

      const url = `${apiBase}${data.download_url}?v=${Date.now()}`;
      setGeneratedAudioUrl(url);
      setGeneratedAudioMeta({
        file: data.file,
        duration: Number(data.duration_sec || 0),
      });
      setCloneMessage(`Saved generated audio: ${data.file}`);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Failed to save generated audio');
    } finally {
      setSaveBusy(false);
    }
  }, [cfgScale, dialogueText, language, nuanceStyle, saveName, speakerAVoice, speakerBVoice, speakerCVoice, speakerDVoice, speakerPauseMs, text, voice, wsBase]);

  return (
    <div className="tts-showcase">
      <div className="tts-showcase__container">
        <button type="button" className="tts-showcase__back" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          Back to dashboard
        </button>

        <header className="tts-showcase__header">
          <h1>VibeVoice TTS Showcase</h1>
          <p>Modern local lab for real-time expressive TTS, clone uploads, two-speaker continuous style, and saved WAV exports.</p>
        </header>

        <section className="tts-showcase__panel">
          <h2><Waves size={18} /> Streaming TTS</h2>
          <label>
            WebSocket Base URL
            <input
              value={wsBase}
              onChange={(e) => setWsBase(e.target.value)}
              placeholder="ws://127.0.0.1:8765"
            />
          </label>

          <div className="tts-showcase__control-grid">
            <label>
              Voice Preset
              <select
                value={voices.length === 0 ? '' : voice}
                onChange={(e) => setVoice(e.target.value)}
                disabled={voicesLoading || voices.length === 0}
              >
                {voices.length === 0 ? (
                  <option value="">{voicesLoading ? 'Loading voices...' : 'No voices available'}</option>
                ) : (
                  voices.map((voiceKey) => (
                    <option key={voiceKey} value={voiceKey}>{voiceKey}</option>
                  ))
                )}
              </select>
            </label>
            <label>
              CFG Scale
              <input
                value={cfgScale}
                onChange={(e) => setCfgScale(e.target.value)}
                placeholder="1.5"
              />
            </label>
            <label>
              Output Language
              <select value={language} onChange={(e) => setLanguage(e.target.value as OutputLanguage)}>
                {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Stream Volume
              <input
                type="range"
                min="0"
                max="1.4"
                step="0.05"
                value={streamVolume}
                onChange={(e) => setStreamVolume(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="tts-showcase__row">
            <label>
              Nuance Style
              <select value={nuanceStyle} onChange={(e) => setNuanceStyle(e.target.value as NuanceStyle)}>
                <option value="neutral">Neutral</option>
                <option value="warm">Warm</option>
                <option value="expressive">Expressive (laughs, natural cues)</option>
                <option value="podcast">Podcast Host</option>
                <option value="cinematic">Cinematic</option>
                <option value="angry">Angry</option>
                <option value="fast_talking">Fast Talking</option>
                <option value="grieve">Grieve</option>
              </select>
            </label>
            <div className="tts-showcase__nuance-preview">
              <Sparkles size={14} />
              {applyNuanceStyle('Preview of your humanlike prompting output.', nuanceStyle)}
            </div>
          </div>

          <div className="tts-showcase__muted">Loaded voices: {voices.length}</div>

          <div className="tts-showcase__quick-controls">
            <button className="tts-showcase__btn" onClick={loadVoices} disabled={voicesLoading}>
              <RefreshCw size={16} />
              {voicesLoading ? 'Refreshing...' : 'Refresh Voices'}
            </button>
            <div className="tts-showcase__pill">
              <Languages size={14} />
              {LANGUAGE_LABELS[language]}
            </div>
            <div className="tts-showcase__pill">
              <SlidersHorizontal size={14} />
              Volume {Math.round(streamVolume * 100)}%
            </div>
          </div>

          <div className="tts-showcase__clone">
            <label>
              Clone selected voice as
              <input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="my_custom_voice"
              />
            </label>
            <button className="tts-showcase__btn" onClick={cloneSelectedVoice} disabled={cloneBusy || voices.length === 0}>
              {cloneBusy ? 'Cloning...' : 'Clone Voice'}
            </button>
          </div>

          {cloneMessage && <p className="tts-showcase__ok">{cloneMessage}</p>}

          <div className="tts-showcase__upload-card">
            <h3><Upload size={16} /> Upload voice/audio to clone</h3>
            <div className="tts-showcase__row">
              <label>
                Upload file (.pt, .wav, .mp3, .m4a, .flac)
                <input ref={uploadInputRef} type="file" accept=".pt,.wav,.mp3,.m4a,.flac,.ogg,.aac" onChange={onUploadFileChange} />
              </label>
              <label>
                New voice name
                <input
                  value={uploadVoiceName}
                  onChange={(e) => setUploadVoiceName(e.target.value)}
                  placeholder="studio_clone_voice"
                />
              </label>
            </div>
            <button className="tts-showcase__btn" onClick={uploadAndCloneVoice} disabled={uploadBusy || !uploadFile || !uploadVoiceName.trim()}>
              <Upload size={16} />
              {uploadBusy ? 'Uploading...' : 'Upload & Clone'}
            </button>
            {uploadFile && <div className="tts-showcase__muted">Selected file: {uploadFile.name}</div>}
          </div>

          <label>
            Text to synthesize
            <textarea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type text to stream speech..."
            />
          </label>
          <label>
            Save file name (optional)
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="single_speaker_tts"
            />
          </label>

          <div className="tts-showcase__actions">
            <button className="tts-showcase__btn tts-showcase__btn--primary" onClick={startStreaming} disabled={isStreamingActive || !text.trim()}>
              <Play size={16} />
              {status === 'connecting' ? 'Connecting...' : status === 'streaming' ? 'Streaming...' : 'Speak via WebSocket'}
            </button>
            <button className="tts-showcase__btn" onClick={() => stopStreaming('done')} disabled={!isStreamingActive && !hasPlayback}>
              <Square size={16} />
              Stop
            </button>
            <button className="tts-showcase__btn" onClick={() => saveGeneratedAudio(false)} disabled={saveBusy || !text.trim()}>
              <Save size={16} />
              {saveBusy ? 'Saving...' : 'Generate + Save WAV'}
            </button>
          </div>

          <div className={`tts-showcase__status tts-showcase__status--${status}`}>
            <Radio size={14} />
            Status: {status}
          </div>

          {lastError && <p className="tts-showcase__error">{lastError}</p>}
        </section>

        <section className="tts-showcase__panel">
          <h2><Users2 size={18} /> Two-speaker continuous style</h2>
          <div className="tts-showcase__row">
            <label>
              Speaker A voice
              <select value={voices.length === 0 ? '' : speakerAVoice} onChange={(e) => setSpeakerAVoice(e.target.value)} disabled={voices.length === 0}>
                {voices.length === 0 ? (
                  <option value="">No voices available</option>
                ) : (
                  voices.map((voiceKey) => (
                    <option key={`a-${voiceKey}`} value={voiceKey}>{voiceKey}</option>
                  ))
                )}
              </select>
            </label>
            <label>
              Speaker B voice
              <select value={voices.length === 0 ? '' : speakerBVoice} onChange={(e) => setSpeakerBVoice(e.target.value)} disabled={voices.length === 0}>
                {voices.length === 0 ? (
                  <option value="">No voices available</option>
                ) : (
                  voices.map((voiceKey) => (
                    <option key={`b-${voiceKey}`} value={voiceKey}>{voiceKey}</option>
                  ))
                )}
              </select>
            </label>
          </div>
          <div className="tts-showcase__row">
            <label>
              Speaker C voice
              <select value={voices.length === 0 ? '' : speakerCVoice} onChange={(e) => setSpeakerCVoice(e.target.value)} disabled={voices.length === 0}>
                {voices.length === 0 ? (
                  <option value="">No voices available</option>
                ) : (
                  voices.map((voiceKey) => (
                    <option key={`c-${voiceKey}`} value={voiceKey}>{voiceKey}</option>
                  ))
                )}
              </select>
            </label>
            <label>
              Speaker D voice
              <select value={voices.length === 0 ? '' : speakerDVoice} onChange={(e) => setSpeakerDVoice(e.target.value)} disabled={voices.length === 0}>
                {voices.length === 0 ? (
                  <option value="">No voices available</option>
                ) : (
                  voices.map((voiceKey) => (
                    <option key={`d-${voiceKey}`} value={voiceKey}>{voiceKey}</option>
                  ))
                )}
              </select>
            </label>
          </div>

          <label>
            Dialogue script (use <code>A:</code> / <code>B:</code> lines)
            <textarea
              rows={6}
              value={dialogueText}
              onChange={(e) => setDialogueText(e.target.value)}
              placeholder={DEFAULT_DIALOGUE}
            />
          </label>

          <div className="tts-showcase__control-grid">
            <label>
              Speaker Pause (ms)
              <input
                type="range"
                min="0"
                max="800"
                step="20"
                value={speakerPauseMs}
                onChange={(e) => setSpeakerPauseMs(Number(e.target.value))}
              />
            </label>
            <div className="tts-showcase__pill tts-showcase__pill--wide">
              <Sparkles size={14} />
              Soft touch transition: {speakerPauseMs}ms between turns
            </div>
          </div>

          <button className="tts-showcase__btn tts-showcase__btn--primary" onClick={() => saveGeneratedAudio(true)} disabled={saveBusy || !dialogueText.trim()}>
            <Users2 size={16} />
            {saveBusy ? 'Rendering...' : 'Render 2-Speaker Continuous + Save'}
          </button>
        </section>

        {generatedAudioUrl && generatedAudioMeta && (
          <section className="tts-showcase__panel">
            <h2><Download size={18} /> Saved output</h2>
            <p className="tts-showcase__muted">{generatedAudioMeta.file} • {generatedAudioMeta.duration.toFixed(2)}s</p>
            <audio controls src={generatedAudioUrl} className="tts-showcase__player" />
            <a className="tts-showcase__btn tts-showcase__btn--primary" href={generatedAudioUrl} download={generatedAudioMeta.file}>
              <Download size={16} />
              Download WAV
            </a>
          </section>
        )}

        <section className="tts-showcase__api">
          <h2>Exposed WebSocket API</h2>
          <p>Endpoint:</p>
          <code>{'{wsBase}'}/ws/tts?text=Hello&voice=en-Carter_man&cfg=1.5</code>
          <ul>
            <li><strong>text</strong>: text to synthesize</li>
            <li><strong>voice</strong>: voice preset key (optional)</li>
            <li><strong>cfg</strong>: generation guidance scale, default 1.5</li>
            <li><strong>language</strong>: optional language hint (full selector list in UI)</li>
            <li>Response stream: PCM16 binary chunks at 24kHz (mono)</li>
            <li><strong>POST /api/voices/clone</strong>: clone existing preset with <code>{'{ source_voice, new_voice }'}</code></li>
            <li><strong>POST /api/voices/upload</strong>: upload .pt or audio file and clone into selectable voice</li>
            <li><strong>POST /api/tts/save</strong>: synthesize and save WAV with <code>{'{ save_name, speaker_a_voice, speaker_b_voice, speaker_c_voice, speaker_d_voice, speaker_pause_ms, nuance_style, language }'}</code></li>
          </ul>
          <p className="tts-showcase__tip">
            Run the backend server with <code>python server.py --port 8765</code> in
            <code> /Users/master/sosoomo/playground/vibevoice</code>.
          </p>
        </section>
      </div>
    </div>
  );
}

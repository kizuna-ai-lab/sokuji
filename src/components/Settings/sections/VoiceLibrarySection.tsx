import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Play, Plus, Square, Upload } from 'lucide-react';
import './VoiceLibrarySection.scss';
import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';

/**
 * A single voice as presented to the user. `id` is OPAQUE — each provider
 * adapter defines its own scheme (e.g. Supertonic encodes sids as
 * `preset:<sid>` / `custom:<sid>`). The component never parses it.
 */
export interface VoiceEntry {
  id: string;
  label: string;
  group: 'builtin' | 'custom';
  /** Whether the entry can be renamed / deleted (i.e. user-owned). */
  removable: boolean;
  meta?: {
    gender?: 'M' | 'F';
    /** Curated builtins are always visible; non-curated ones hide behind the
     *  "show all" expander when `capability.curation` is on. */
    curated?: boolean;
    /** Flagged in the UI so users know the voice may be lower quality. */
    unstable?: boolean;
    language?: string;
  };
}

export interface VoiceLibrarySectionProps {
  /** All voices, normalized across providers. */
  voices: VoiceEntry[];
  /** Currently selected voice id (opaque). */
  selectedId: string;
  /** Called when the user picks a different voice. */
  onSelect: (id: string) => void;
  /** Called after a valid voice file is picked/dropped. Should throw on
   *  validation errors so the parent can surface them. Required when
   *  `importModes` includes `upload`. `transcript` is only ever passed when
   *  `capability.transcriptRequired` is set. */
  onImport?: (file: File, transcript?: string) => Promise<void>;
  /** Called after a microphone clip is captured. Required when `importModes`
   *  includes `record`. `transcript` is only ever passed when
   *  `capability.transcriptRequired` is set. */
  onRecord?: (clip: Float32Array, sampleRate: number, transcript?: string) => Promise<void>;
  /** Called when the user renames a removable voice. */
  onRename: (id: string, name: string) => Promise<void>;
  /** Called when the user confirms deletion of a removable voice. */
  onDelete: (id: string) => Promise<void>;
  /** Fetch a removable voice's stored clip so the user can play it back and
   *  check their recording is clear. Returns null when the voice has no
   *  playable clip. Preview controls only render when this is provided. */
  onPreview?: (id: string) => Promise<{ audio: Float32Array; sampleRate: number } | null>;
  /** Provider-declared capabilities driving which controls render. */
  capability: VoiceLibraryCapability;
  /** True while a session is active. Disables voice selection (the worker is
   *  already initialized) but leaves import / rename / delete available so
   *  users can stage voices for their next session. */
  isSessionActive?: boolean;
}

const VoiceLibrarySection: React.FC<VoiceLibrarySectionProps> = ({
  voices,
  selectedId,
  onSelect,
  onImport,
  onRecord,
  onRename,
  onDelete,
  onPreview,
  capability,
  isSessionActive = false,
}) => {
  const { t } = useTranslation();

  // ---- local playback (listen back to a recorded/imported clip) -----------
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopPreview = useCallback(() => {
    const src = sourceRef.current;
    if (src) {
      src.onended = null;
      try { src.stop(); } catch { /* already stopped/ended */ }
      sourceRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const togglePreview = useCallback(async (id: string) => {
    if (playingId === id) { stopPreview(); return; }
    stopPreview();
    if (!onPreview) return;
    let payload: { audio: Float32Array; sampleRate: number } | null = null;
    try { payload = await onPreview(id); } catch { payload = null; }
    if (!payload || payload.audio.length === 0) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AudioCtx());
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
    const buffer = ctx.createBuffer(1, payload.audio.length, payload.sampleRate);
    buffer.copyToChannel(payload.audio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => { if (sourceRef.current === src) { sourceRef.current = null; setPlayingId(null); } };
    sourceRef.current = src;
    setPlayingId(id);
    src.start();
  }, [playingId, onPreview, stopPreview]);

  // Stop playback + release the context on unmount.
  useEffect(() => () => {
    stopPreview();
    void audioCtxRef.current?.close().catch(() => {});
  }, [stopPreview]);

  const renderPreviewButton = (v: VoiceEntry) => (
    onPreview && v.removable ? (
      <button
        type="button"
        className="voice-row-btn"
        onClick={() => void togglePreview(v.id)}
        aria-label={playingId === v.id ? t('voiceLibrary.stopPreview', 'Stop') : t('voiceLibrary.play', 'Play')}
        title={playingId === v.id ? t('voiceLibrary.stopPreview', 'Stop') : t('voiceLibrary.play', 'Play')}
      >
        {playingId === v.id ? <Square size={12} /> : <Play size={12} />}
      </button>
    ) : null
  );

  const [isDragging, setIsDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const transcriptInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    chunks: Float32Array[];
  } | null>(null);

  const canUpload = capability.importModes.includes('upload');
  const canRecord = capability.importModes.includes('record');
  const isDropdown = capability.presentation === 'dropdown';
  // Capture (import/record) is gated behind a non-empty reference transcript
  // for models that require in-context-learning text (Task 12). Absent/false
  // → no gating, matching pre-Task-12 behavior exactly.
  const transcriptMissing = !!capability.transcriptRequired && transcript.trim().length === 0;

  const builtins = useMemo(() => voices.filter((v) => v.group === 'builtin'), [voices]);
  const customs = useMemo(() => voices.filter((v) => v.group === 'custom'), [voices]);
  // Manage list (dropdown mode) shows user-owned voices that can be renamed/deleted.
  const removableVoices = useMemo(() => voices.filter((v) => v.removable), [voices]);

  // Curation: when on, non-curated builtins hide behind the "show all" expander.
  const curatedBuiltins = useMemo(
    () => (capability.curation ? builtins.filter((v) => v.meta?.curated) : builtins),
    [builtins, capability.curation],
  );
  const hiddenBuiltins = useMemo(
    () => (capability.curation ? builtins.filter((v) => !v.meta?.curated) : []),
    [builtins, capability.curation],
  );

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!onImport || !files || files.length === 0) return;
    // Drop-zone gating mirrors the disabled Import button: while a required
    // transcript is empty, dropped files are ignored outright (no partial
    // import, no error surfaced — the user just hasn't filled in the field).
    if (transcriptMissing) return;
    let anySucceeded = false;
    for (const file of Array.from(files)) {
      try {
        // Only pass a second argument when the capability actually requires
        // one, so the non-gated path's call signature is byte-identical to
        // pre-Task-12 behavior (`onImport(file)`, not `onImport(file, undefined)`).
        if (capability.transcriptRequired) {
          await onImport(file, transcript.trim());
        } else {
          await onImport(file);
        }
        anySucceeded = true;
      } catch (err) {
        // Parent surfaces the error (e.g. toast). Console breadcrumb only.
        console.warn('Voice import failed:', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (anySucceeded && capability.transcriptRequired) setTranscript('');
  }, [onImport, transcriptMissing, capability.transcriptRequired, transcript]);

  const onDrop: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };
  const onDragOver: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const commitEdit = useCallback(async (id: string) => {
    const name = editName.trim();
    setEditingId(null);
    const row = customs.find((v) => v.id === id);
    if (name && row && name !== row.label) {
      try { await onRename(id, name); }
      catch (err) { console.warn('Rename failed:', err); }
    }
  }, [editName, customs, onRename]);

  const confirmAndDelete = useCallback(async (id: string, name: string) => {
    const prompt = t('voiceLibrary.deleteConfirm', `Delete voice "${name}"?`).replace('{name}', name);
    if (!window.confirm(prompt)) return;
    try { await onDelete(id); }
    catch (err) { console.warn('Delete failed:', err); }
  }, [onDelete, t]);

  // Release the microphone when the component's effects unmount — a real
  // unmount, or the settings panel hiding inside its <Activity> boundary.
  // The capture graph lives only in recRef, so without this the mic would
  // keep recording invisibly after a panel switch. Partial audio is
  // deliberately discarded rather than submitted as a half-finished clip.
  // The generation counter also invalidates a getUserMedia call still
  // pending at cleanup time, so a late-resolving stream is stopped instead
  // of resurrecting the capture graph.
  const recGenerationRef = useRef(0);
  useEffect(() => () => {
    recGenerationRef.current += 1;
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    rec.processor.disconnect();
    rec.source.disconnect();
    rec.stream.getTracks().forEach((track) => track.stop());
    void rec.ctx.close();
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!onRecord || !navigator.mediaDevices?.getUserMedia || transcriptMissing) return;
    try {
      const generation = recGenerationRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (e) => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      recRef.current = { ctx, stream, source, processor, chunks };
      setIsRecording(true);
    } catch (err) {
      console.warn('Recording failed to start:', err);
    }
  }, [onRecord, transcriptMissing]);

  const stopRecording = useCallback(async () => {
    const rec = recRef.current;
    recRef.current = null;
    setIsRecording(false);
    if (!rec) return;
    const { ctx, stream, source, processor, chunks } = rec;
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    const sampleRate = ctx.sampleRate;
    await ctx.close();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (!onRecord || total === 0) return;
    const clip = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { clip.set(c, offset); offset += c.length; }
    try {
      // Same call-signature rule as handleFiles: only widen to the 3-arg form
      // when the capability requires a transcript.
      if (capability.transcriptRequired) {
        await onRecord(clip, sampleRate, transcript.trim());
        setTranscript('');
      } else {
        await onRecord(clip, sampleRate);
      }
    } catch (err) { console.warn('Recording handler failed:', err); }
  }, [onRecord, capability.transcriptRequired, transcript]);

  const renderRow = (v: VoiceEntry) => {
    const isSelected = v.id === selectedId;
    const isEditing = editingId === v.id;
    return (
      <li key={v.id} className={`voice-manage-row${isSelected ? ' selected' : ''}`}>
        {isEditing ? (
          <input
            autoFocus
            className="voice-name-edit"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => void commitEdit(v.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit(v.id);
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="voice-select-btn"
            aria-pressed={isSelected}
            disabled={isSessionActive}
            onClick={() => onSelect(v.id)}
          >
            <span className="voice-name">
              {v.label}{v.meta?.gender ? ` (${v.meta.gender})` : ''}
            </span>
            {v.meta?.unstable && (
              <span className="voice-unstable-tag">{t('voiceLibrary.unstable', 'unstable')}</span>
            )}
          </button>
        )}
        {v.removable && !isEditing && (
          <>
            {renderPreviewButton(v)}
            <button
              type="button"
              className="voice-row-btn"
              onClick={() => startEdit(v.id, v.label)}
            >
              {t('voiceLibrary.rename', 'Rename')}
            </button>
            <button
              type="button"
              className="voice-row-btn voice-row-btn-danger"
              onClick={() => void confirmAndDelete(v.id, v.label)}
            >
              {t('voiceLibrary.delete', 'Delete')}
            </button>
          </>
        )}
      </li>
    );
  };

  // Manage-list row for dropdown mode: name + rename/delete only (selection
  // happens through the <select>, not these rows). Mirrors the original
  // Supertonic "Manage imported voices" rows.
  const renderManageRow = (v: VoiceEntry) => {
    const isEditing = editingId === v.id;
    return (
      <li key={v.id} className="voice-manage-row">
        {isEditing ? (
          <input
            autoFocus
            className="voice-name-edit"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => void commitEdit(v.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit(v.id);
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
        ) : (
          <span className="voice-name">{v.label}</span>
        )}
        {!isEditing && renderPreviewButton(v)}
        <button
          type="button"
          className="voice-row-btn"
          disabled={isEditing}
          onClick={() => startEdit(v.id, v.label)}
        >
          {t('voiceLibrary.rename', 'Rename')}
        </button>
        <button
          type="button"
          className="voice-row-btn voice-row-btn-danger"
          onClick={() => void confirmAndDelete(v.id, v.label)}
        >
          {t('voiceLibrary.delete', 'Delete')}
        </button>
      </li>
    );
  };

  // Shared import toolbar (upload / record affordances), reused by both
  // presentations so the dropdown path stays in sync with the list path.
  const importToolbar = (
    <div className="voice-library-manage-toolbar">
      {capability.transcriptRequired && (
        <div className="voice-transcript-field">
          <label htmlFor={transcriptInputId} className="voice-transcript-label">
            {t('voiceLibrary.transcript', 'Transcript')}
          </label>
          <input
            id={transcriptInputId}
            type="text"
            className="voice-transcript-input"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t('voiceLibrary.transcriptPlaceholder', 'Type exactly what the clip says…')}
          />
          <span className="voice-transcript-hint">
            {t('voiceLibrary.transcriptHint', 'Must match the words spoken in the clip.')}
          </span>
        </div>
      )}
      {canUpload && (
        <button
          type="button"
          className="voice-import-btn"
          disabled={transcriptMissing}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={14} />
          {t('voiceLibrary.importVoice', 'Import voice…')}
        </button>
      )}
      {canRecord && (
        <button
          type="button"
          className="voice-import-btn"
          // Never disable while a recording is in progress — the button also
          // serves as "Stop recording" and clearing the transcript field
          // mid-capture must not trap the user in an unstoppable recording.
          disabled={!isRecording && transcriptMissing}
          onClick={() => (isRecording ? void stopRecording() : void startRecording())}
        >
          <Mic size={14} />
          {isRecording
            ? t('voiceLibrary.stopRecording', 'Stop recording')
            : t('voiceLibrary.recordVoice', 'Record voice…')}
        </button>
      )}
      {canUpload && (
        <span className="voice-library-drop-hint">
          <Upload size={12} />
          {t('voiceLibrary.dropHint', 'or drop a voice file here')}
        </span>
      )}
      {canUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept={capability.accept ?? 'application/json,.json'}
          style={{ display: 'none' }}
          multiple
          onChange={(e) => void handleFiles(e.target.files)}
        />
      )}
    </div>
  );

  // Dropdown presentation: restore the original Supertonic <select> + optgroups
  // for selection and a collapsible "manage" list for imported voices.
  if (isDropdown) {
    return (
      <div className="voice-library-section">
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('voiceLibrary.voice', 'Voice')}</span>
          </div>
          <select
            className="select-dropdown"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            disabled={isSessionActive}
          >
            <optgroup label={t('voiceLibrary.presets', 'Presets')}>
              {builtins.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}{v.meta?.gender ? ` (${v.meta.gender})` : ''}
                </option>
              ))}
            </optgroup>
            {customs.length > 0 && (
              <optgroup label={t('voiceLibrary.myVoices', 'My Voices')}>
                {customs.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}{v.meta?.gender ? ` (${v.meta.gender})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {(canUpload || canRecord) && (
          <details className="voice-library-manage">
            <summary>
              {t('voiceLibrary.manageImported', 'Manage imported voices')}
              {removableVoices.length > 0 && (
                <span className="voice-library-manage-count"> ({removableVoices.length})</span>
              )}
            </summary>
            <div
              className={`voice-library-manage-body${isDragging ? ' dragging' : ''}`}
              onDrop={canUpload ? onDrop : undefined}
              onDragOver={canUpload ? onDragOver : undefined}
              onDragLeave={canUpload ? onDragLeave : undefined}
            >
              {importToolbar}
              {removableVoices.length === 0 ? (
                <div className="voice-library-empty">
                  {t('voiceLibrary.emptyHint', 'No imported voices yet.')}
                </div>
              ) : (
                <ul className="voice-manage-list">{removableVoices.map(renderManageRow)}</ul>
              )}
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="voice-library-section">
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('voiceLibrary.voice', 'Voice')}</span>
        </div>
      </div>

      {/* Built-in group */}
      {(curatedBuiltins.length > 0 || hiddenBuiltins.length > 0) && (
        <div className="voice-library-group">
          <div className="voice-library-group-label">{t('voiceLibrary.presets', 'Presets')}</div>
          <ul className="voice-manage-list">
            {curatedBuiltins.map(renderRow)}
            {capability.curation && showAll && hiddenBuiltins.map(renderRow)}
          </ul>
          {capability.curation && hiddenBuiltins.length > 0 && (
            <button
              type="button"
              className="voice-show-all-btn"
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll
                ? t('voiceLibrary.showFewer', 'Show fewer voices')
                : t('voiceLibrary.showAll', 'Show all voices')}
            </button>
          )}
        </div>
      )}

      {/* Custom group */}
      {customs.length > 0 && (
        <div className="voice-library-group">
          <div className="voice-library-group-label">{t('voiceLibrary.myVoices', 'My Voices')}</div>
          <ul className="voice-manage-list">{customs.map(renderRow)}</ul>
        </div>
      )}

      {/* Import controls */}
      {(canUpload || canRecord) && (
        <div
          className={`voice-library-manage-body${isDragging ? ' dragging' : ''}`}
          onDrop={canUpload ? onDrop : undefined}
          onDragOver={canUpload ? onDragOver : undefined}
          onDragLeave={canUpload ? onDragLeave : undefined}
        >
          {importToolbar}
        </div>
      )}
    </div>
  );
};

export default VoiceLibrarySection;

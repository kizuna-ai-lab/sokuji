import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Plus, Upload } from 'lucide-react';
import './VoiceLibrarySection.scss';

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

export interface VoiceLibraryCapability {
  /** Which import affordances to render. `upload` → file picker + drop zone;
   *  `record` → microphone Record button. */
  importModes: ('upload' | 'record')[];
  /** When true, only curated builtins are shown by default with a "show all"
   *  expander revealing the rest. When false, all builtins are shown. */
  curation: boolean;
  /** `accept` filter for the upload file input. Defaults to the JSON voice-card
   *  filter (Supertonic) when unset; native voice cloning passes an audio filter. */
  accept?: string;
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
   *  `importModes` includes `upload`. */
  onImport?: (file: File) => Promise<void>;
  /** Called after a microphone clip is captured. Required when `importModes`
   *  includes `record`. */
  onRecord?: (clip: Float32Array, sampleRate: number) => Promise<void>;
  /** Called when the user renames a removable voice. */
  onRename: (id: string, name: string) => Promise<void>;
  /** Called when the user confirms deletion of a removable voice. */
  onDelete: (id: string) => Promise<void>;
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
  capability,
  isSessionActive = false,
}) => {
  const { t } = useTranslation();

  const [isDragging, setIsDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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

  const builtins = useMemo(() => voices.filter((v) => v.group === 'builtin'), [voices]);
  const customs = useMemo(() => voices.filter((v) => v.group === 'custom'), [voices]);

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
    for (const file of Array.from(files)) {
      try {
        await onImport(file);
      } catch (err) {
        // Parent surfaces the error (e.g. toast). Console breadcrumb only.
        console.warn('Voice import failed:', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onImport]);

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

  const startRecording = useCallback(async () => {
    if (!onRecord || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
  }, [onRecord]);

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
    try { await onRecord(clip, sampleRate); }
    catch (err) { console.warn('Recording handler failed:', err); }
  }, [onRecord]);

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
          <div className="voice-library-manage-toolbar">
            {canUpload && (
              <button
                type="button"
                className="voice-import-btn"
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
        </div>
      )}
    </div>
  );
};

export default VoiceLibrarySection;

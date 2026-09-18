import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFloating, FloatingFocusManager } from '@floating-ui/react';
import { Plus, Mic, Square, X } from 'lucide-react';
import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';
import SonioxCloneReviewStep from './SonioxCloneReviewStep';
import './VoiceCreateModal.scss';

/** The post-acquisition confirmation phase, when the provider has one. Passing
 *  it non-null switches this dialog's body to the review step and hands every
 *  dismiss path to whoever staged the clip. Soniox cloning is the only
 *  provider that stages one; for everyone else a successful import finishes
 *  the flow, and this stays undefined. */
export interface VoiceCreateReview {
  /** Bumped by the caller for each newly staged clip, and used as the review
   *  step's React key — a fresh mount reseeds its name field empty and its
   *  consent checkbox unchecked. A confirm-error retry deliberately keeps the
   *  same value, so the name the user just typed survives the failure. The
   *  key goes on the STEP, not on this dialog: remounting the whole frame
   *  would throw away the acquire phase and reset focus management with it. */
  seq: number;
  audioBlob: Blob | null;
  error: string | null;
  busy: boolean;
  notice?: string;
  showName?: boolean;
  onConfirm: (name: string) => void;
  /** Discard the staged clip. Reached from Confirm's sibling Cancel, and —
   *  because the clip is the caller's, not this dialog's — from Escape, the
   *  backdrop and the × too. */
  onClose: () => void;
}

export interface VoiceCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a valid voice file is picked/dropped. Should throw on
   *  validation errors so the parent can surface them. Required when
   *  `capability.importModes` includes `upload`. `transcript` is only ever
   *  passed when `capability.transcriptRequired` is set. */
  onImport?: (file: File, transcript?: string) => Promise<void>;
  /** Called after a microphone clip is captured. Required when
   *  `capability.importModes` includes `record`. `transcript` is only ever
   *  passed when `capability.transcriptRequired` is set. */
  onRecord?: (clip: Float32Array, sampleRate: number, transcript?: string) => Promise<void>;
  capability: VoiceLibraryCapability;
  /** Provider-specific footnote (e.g. Soniox's preview spends the user's own
   *  TTS quota). Provider-agnostic component, provider-specific copy. */
  note?: React.ReactNode;
  /** Non-null once a clip is staged for confirmation — see
   *  {@link VoiceCreateReview}. The caller must also keep `isOpen` true while
   *  it is set; this component does not force itself open. */
  review?: VoiceCreateReview | null;
}

/**
 * Adding a voice: the import/record surface, in its own modal.
 *
 * It lives here rather than in the settings panel because the panel is 300px
 * wide and the picker is the only thing that belongs there permanently (design
 * 2026-09-16 §5). The capture code — the recording graph, the countdown, the
 * generation guard, the drop handling — moved here VERBATIM from
 * VoiceLibrarySection; every comment in it explains a behaviour that was paid
 * for once already.
 */
const VoiceCreateModal: React.FC<VoiceCreateModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onRecord,
  capability,
  note,
  review,
}) => {
  const { t } = useTranslation();

  const [isRecording, setIsRecording] = useState(false);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // The modal owns its own error surface. Both providers already build a
  // user-facing message and rethrow it (SonioxVoiceSection's `onImport`
  // rethrows after setting its banner, NativeVoiceSection's `handleImport` and
  // `handleRecord` do the same), so the message reaches the catch blocks below
  // — they used to `console.warn` it and rely on the parent's banner, which
  // this modal COVERS. A rejected clip therefore looked like nothing happened
  // at all. `SonioxCloneReviewStep` already had this exact seam (`error`
  // rendered as `.voice-capture-error` inside the dialog); this matches it.
  const [error, setError] = useState<string | null>(null);
  const transcriptInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    chunks: Float32Array[];
  } | null>(null);
  const recTimerRef = useRef<number | null>(null);
  // stopRecording is defined below startRecording; the countdown interval
  // reaches it through a ref so the auto-stop always calls the latest closure.
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const clearRecTimer = () => {
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
  };

  // Release the microphone when the component's effects unmount — a real
  // unmount, or the settings panel hiding inside its <Activity> boundary.
  // The capture graph lives only in recRef, so without this the mic would
  // keep recording invisibly after a panel switch. Partial audio is
  // deliberately discarded rather than submitted as a half-finished clip.
  // The generation counter also invalidates a getUserMedia call still
  // pending at cleanup time, so a late-resolving stream is stopped instead
  // of resurrecting the capture graph.
  //
  // Factored out (rather than inlined in the unmount effect, as it is in
  // VoiceLibrarySection) so close() below can share it: closing the modal
  // mid-recording must DISCARD the same way, never submit through
  // stopRecording — stopRecording is the only path that calls onRecord.
  //
  // Declared here — ahead of handleFiles/stopRecording below, which now both
  // call close() on their success path — rather than beside startRecording,
  // where it lived before that fix. useCallback's dependency array is
  // evaluated eagerly on every render, unlike the callback body it wraps, so
  // referencing close() from a dependency array before its declaration is a
  // real "used before assignment" error, not just a style nit — the plain
  // function-body reference below (inside handleFiles/stopRecording) would
  // have been safe either way, since neither runs until a later user action.
  const recGenerationRef = useRef(0);
  const releaseCapture = useCallback(() => {
    recGenerationRef.current += 1;
    clearRecTimer();
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    rec.processor.disconnect();
    rec.source.disconnect();
    rec.stream.getTracks().forEach((track) => track.stop());
    void rec.ctx.close();
    setIsRecording(false);
  }, []);
  useEffect(() => releaseCapture, [releaseCapture]);

  // Closing mid-recording DISCARDS the capture via releaseCapture — the same
  // teardown the unmount effect uses — rather than going through
  // stopRecording, which is the submitting path (it awaits onRecord). Review
  // finding 1 (Task 5): the previous version called stopRecordingRef here,
  // which uploaded a half-finished clip on Cancel/Escape/backdrop instead of
  // discarding it as the comment claimed.
  const close = useCallback(() => {
    // Clear on the way out, not on the way in: this component stays mounted
    // with `isOpen={false}`, so an error left behind here would be the first
    // thing visible the next time the modal opens.
    setError(null);
    releaseCapture();
    onClose();
  }, [releaseCapture, onClose]);

  // While the review phase is up, the thing on screen is the caller's staged
  // clip, so every way out of the dialog has to discard it — Escape, the
  // backdrop and the × included, not just the Cancel beside Confirm. Routing
  // them through `close()` instead would drop `creating` while the caller
  // still held a clip, leaving the dialog up with no way to dismiss it.
  //
  // Read from the current render's props, never from a closure captured
  // earlier: the clip is staged DURING `onImport`, so anything that latched
  // `review` before that await is already stale.
  const dismiss = review ? review.onClose : close;

  const canUpload = capability.importModes.includes('upload');
  const canRecord = capability.importModes.includes('record');
  // Capture (import/record) is gated behind a non-empty reference transcript
  // for models that require in-context-learning text (Task 12). Absent/false
  // → no gating, matching pre-Task-12 behavior exactly.
  const transcriptMissing = !!capability.transcriptRequired && transcript.trim().length === 0;

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!onImport || !files || files.length === 0) return;
    // Drop-zone gating mirrors the disabled Import button: while a required
    // transcript is empty, dropped files are ignored outright (no partial
    // import, no error surfaced — the user just hasn't filled in the field).
    if (transcriptMissing) return;
    // A new attempt clears the previous failure, or a retry that succeeds
    // would leave the old message sitting there claiming otherwise.
    setError(null);
    let anySucceeded = false;
    // Single-import adapters hold one staged clip at a time (see
    // VoiceLibraryCapability.multipleImport): a multi-file drop would
    // last-wins overwrite that slot on every iteration, so keep only the
    // first file rather than silently discarding all but the last.
    const selected = capability.multipleImport === false
      ? Array.from(files).slice(0, 1)
      : Array.from(files);
    for (const file of selected) {
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
        // Surface it HERE. The parent does set its own banner, but that banner
        // renders in the settings section this modal sits on top of, so it is
        // unreachable while the modal is open — a rejected clip (over the
        // 2-minute limit, silent, undecodable) looked like nothing happened.
        // The message is already user-facing: both providers build it with
        // `t('voiceLibrary.clipTooLong' | 'decodeFailed' | ...)` before
        // rethrowing.
        setError(err instanceof Error ? err.message : String(err));
        console.warn('Voice import failed:', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (anySucceeded && capability.transcriptRequired) setTranscript('');
    // Spec §6.3: calls onImport, then closes.
    if (anySucceeded) close();
  }, [onImport, transcriptMissing, capability.transcriptRequired, capability.multipleImport, transcript, close]);

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

  const startRecording = useCallback(async () => {
    if (!onRecord || !navigator.mediaDevices?.getUserMedia || transcriptMissing) return;
    // Same reason as handleFiles: starting a new capture clears the last one's
    // failure.
    setError(null);
    try {
      const generation = recGenerationRef.current;
      // Voice-cloning reference audio must be captured RAW: the cloning
      // model mimics everything in the clip, so browser echo-cancellation /
      // noise-suppression / AGC artifacts get baked into the cloned voice
      // (Soniox's docs note the model reproduces even background noise from
      // the reference — the same reasoning applies to the native cloners).
      // Mono is enough for a voice reference and keeps the encoded clip small.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
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
      // Countdown to the model's clip limit; auto-stop at 0 so the capture
      // can never exceed what the model can actually use.
      const limit = capability.maxClipSeconds ?? 20;
      setRecordSecondsLeft(limit);
      const startedAt = Date.now();
      recTimerRef.current = window.setInterval(() => {
        const left = limit - (Date.now() - startedAt) / 1000;
        setRecordSecondsLeft(Math.max(0, Math.ceil(left)));
        if (left <= 0) void stopRecordingRef.current?.();
      }, 250);
    } catch (err) {
      console.warn('Recording failed to start:', err);
    }
  }, [onRecord, transcriptMissing, capability.maxClipSeconds]);

  const stopRecording = useCallback(async () => {
    clearRecTimer();
    setRecordSecondsLeft(null);
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
      // Spec §6.3: calls onRecord, then closes. Safe to route through the
      // same `close()` the discard paths use, even though recording just
      // succeeded rather than being abandoned: by this point `recRef.current`
      // is already `null` and `isRecording` already `false` (both cleared
      // above, before `onRecord` was ever awaited), so `close`'s
      // `releaseCapture()` call finds nothing to tear down and no-ops — it
      // does not discard the clip this function just submitted.
      close();
    } catch (err) {
      // Same reason as handleFiles: the parent's banner is behind this modal.
      setError(err instanceof Error ? err.message : String(err));
      console.warn('Recording handler failed:', err);
    }
  }, [onRecord, capability.transcriptRequired, transcript, close]);
  // Keep the auto-stop ref pointing at the latest committed closure — written
  // in an effect, not the render body (renders can be replayed/discarded,
  // e.g. under an <Activity> boundary).
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // Reset per-attempt state on open. The modal never unmounts between opens
  // (isOpen only gates the render below), so without this a transcript typed
  // and then cancelled would reappear on the next open — and in the
  // transcriptRequired case, silently re-enable Import with text that
  // belonged to an abandoned clip.
  useEffect(() => {
    if (isOpen) {
      setTranscript('');
      setIsDragging(false);
    }
  }, [isOpen]);

  // Close on Escape (ModelImportModal does the same, on `window` — nothing
  // here goes through floating-ui).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dismiss]);

  // No reference element: this dialog is centred over the app, anchored to
  // nothing. `useFloating` is here only for its open-state context, which is
  // what the focus manager below hangs off — the same use AuthOverlay.tsx (the
  // repo's other non-anchored dialog) makes of it.
  const { refs, context } = useFloating({ open: isOpen });

  if (!isOpen) return null;

  return (
    <div className="voice-modal-overlay" onClick={dismiss}>
      {/* Spec §7: focus moves in on open and returns to the invoking control
          on close. `aria-modal="true"` below is a promise to a screen reader;
          this is what makes part of it true.

          `modal={false}`, not `modal`: the trap also marks every sibling
          `aria-hidden` (floating-ui's `markOthers`). The reason that used to
          be recorded here — that Soniox opened a SEQUENTIAL second modal once
          a clip was staged, which a trap would have hidden from assistive tech
          — no longer holds: that dialog is now the review PHASE of this one,
          so there is no second dialog to hide.

          Left as `modal={false}` regardless, deliberately. Turning the trap on
          is now possible but it is a behaviour change of its own, needing a
          real-browser keyboard walk (the `<audio>` element and the file input
          both live inside), and it is not what this change is for.
          `VoicePicker` uses the same `modal={false} returnFocus` shape. The
          popover that invokes this modal closes first, so the rows behind the
          overlay are not in the tab order either way.

          `closeOnFocusOut={false}` because this component's close paths are its
          own `window` Escape listener, the backdrop and Cancel: a focus-out —
          clicking the dialog's own static text, say — must not silently
          discard a half-filled form. */}
      <FloatingFocusManager context={context} modal={false} returnFocus closeOnFocusOut={false}>
      <div
        ref={refs.setFloating}
        className="voice-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('voiceLibrary.addVoiceTitle', 'Add a voice')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="voice-modal__head">
          <h3>{t('voiceLibrary.addVoiceTitle', 'Add a voice')}</h3>
          <button
            type="button"
            className="voice-modal__x"
            onClick={dismiss}
            aria-label={t('common.close', 'Close')}
          >
            <X size={17} />
          </button>
        </div>

        <div className="voice-modal__body">
          {/* Two phases, one dialog. `review` is non-null only once the
              caller has staged a clip for confirmation (Soniox cloning),
              which is the same scenario the user started in — it used to
              be a second modal opened on top of this one. */}
          {review ? (
            <SonioxCloneReviewStep
              key={review.seq}
              audioBlob={review.audioBlob}
              error={review.error}
              busy={review.busy}
              notice={review.notice}
              showName={review.showName}
              onConfirm={review.onConfirm}
              onClose={review.onClose}
            />
          ) : (
            <>
            {capability.transcriptRequired && (
              <div className="voice-create-modal__transcript-field">
                <label htmlFor={transcriptInputId} className="voice-create-modal__transcript-label">
                  {t('voiceLibrary.transcript', 'Transcript')}
                </label>
                <input
                  id={transcriptInputId}
                  type="text"
                  className="voice-create-modal__transcript-input"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder={t('voiceLibrary.transcriptPlaceholder', 'Type exactly what the clip says…')}
                />
                <span className="voice-create-modal__transcript-hint">
                  {t('voiceLibrary.transcriptHint', 'Must match the words spoken in the clip.')}
                </span>
              </div>
            )}

            {canUpload && (
              <button
                type="button"
                className="voice-create-modal__import-btn"
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
                className="voice-create-modal__import-btn"
                // Never disable while a recording is in progress — the button
                // also serves as "Stop recording" and clearing the transcript
                // field mid-capture must not trap the user in an unstoppable
                // recording.
                disabled={!isRecording && transcriptMissing}
                onClick={() => (isRecording ? void stopRecording() : void startRecording())}
              >
                {isRecording ? <Square size={14} /> : <Mic size={14} />}
                {isRecording
                  ? `${t('voiceLibrary.stopRecording', 'Stop recording')}${recordSecondsLeft !== null ? ` (${recordSecondsLeft}s)` : ''}`
                  : t('voiceLibrary.recordVoice', 'Record voice…')}
              </button>
            )}

            {canUpload && (
              <div
                className={`voice-create-modal__drop-zone${isDragging ? ' is-dragging' : ''}`}
                data-testid="voice-create-drop"
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
              >
                {t('voiceLibrary.dropHint', 'or drop a voice file here')}
              </div>
            )}

            {canUpload && (
              <input
                ref={fileInputRef}
                type="file"
                accept={capability.accept ?? 'application/json,.json'}
                style={{ display: 'none' }}
                multiple={capability.multipleImport !== false}
                onChange={(e) => void handleFiles(e.target.files)}
              />
            )}

            {/* Above the note, not below it: this is the thing the user needs to
                read after an action failed, and the note is standing advice. */}
            {error && <div className="voice-capture-error" role="alert">{error}</div>}

            {note && <div className="voice-create-modal__note">{note}</div>}
            </>
          )}
        </div>

        {/* The review step carries its own Cancel/Confirm pair, so this
            footer belongs to the acquire phase alone — two footers must
            never coexist. */}
        {!review && (
          <div className="voice-modal__foot">
            <button type="button" className="voice-modal__btn" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        )}
      </div>
      </FloatingFocusManager>
    </div>
  );
};

export default VoiceCreateModal;

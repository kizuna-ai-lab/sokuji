import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './VoiceLibrarySection.scss';
import type { VoiceLibraryCapability, VoiceFacets } from '../../../types/VoiceLibrary';
import VoicePicker from './VoicePicker';
import VoiceCreateModal, { type VoiceCreateReview } from './VoiceCreateModal';
import VoiceDeleteModal from './VoiceDeleteModal';

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
  /** Listed but not selectable (dropdown presentation renders it as a
   *  disabled option) — e.g. a cloned voice still processing or terminally
   *  failed, which a session could not synthesize with. */
  disabled?: boolean;
  /** Whether THIS entry can be auditioned. Absent = inherit the group default:
   *  a `custom` entry can (a clip or a cloned voice stands behind it), a
   *  `builtin` entry cannot. A provider whose presets are auditionable sets it
   *  true on those entries (Soniox, Local Native); one whose presets are not
   *  leaves it alone (Supertonic). Auditionability is a property of the VOICE,
   *  not of the provider: Local Native's clip-required families have clones
   *  that cannot speak yet, and a future Palabra roster mixes builtins that
   *  publish a sample URL with clones still processing. */
  previewable?: boolean;
  meta?: {
    gender?: 'M' | 'F';
    /** Drives curated-first ordering where a provider applies one (e.g.
     *  Local Native's curated-then-rest builtin list). */
    curated?: boolean;
    /** Flagged in the UI so users know the voice may be lower quality. */
    unstable?: boolean;
    language?: string;
    /** What the voice sounds like, when the provider publishes it. Drives the
     *  facet filter bar (`capability.facetFilter`) and the description shown
     *  beneath the name. Absent for cloned voices, which nobody classifies. */
    facets?: VoiceFacets;
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
  /** Called when the user renames a removable voice. Optional — when absent,
   *  removable voices cannot be renamed and no rename affordance renders
   *  (providers without a rename API, e.g. Soniox clones). */
  onRename?: (id: string, name: string) => Promise<void>;
  /** Called when the user confirms deletion of a removable voice. */
  onDelete: (id: string) => Promise<void>;
  /** Handed straight to VoiceCreateModal: non-null puts the add-a-voice
   *  dialog into its review phase, and keeps it open while it is set even
   *  though `creating` has already gone false (a successful `onImport` calls
   *  the modal's own close path). Only a provider that stages a clip for
   *  confirmation passes it — Soniox cloning today. */
  createReview?: VoiceCreateReview | null;
  /** Fetch a playable sample of a removable voice — either a stored reference
   *  clip (the native providers keep clips locally) or one synthesized on
   *  demand (Soniox stores nothing locally, so its sample is a TTS audition).
   *  Returns null when the voice has no playable sample. Preview controls only
   *  render when this is provided, the entry is removable, and the entry is not
   *  disabled. `signal` aborts when the user starts another preview or the
   *  component unmounts; implementations that cannot cancel may ignore it. */
  onPreview?: (id: string, signal?: AbortSignal) => Promise<{ audio: Float32Array; sampleRate: number } | null>;
  /** When set, the preview control renders DISABLED with this text as its
   *  label and tooltip, and `onPreview` is never called. Distinct from
   *  omitting `onPreview`, which renders no control at all: "you cannot
   *  preview right now, and here is why" is a different message from "this
   *  source cannot preview". Local Native uses it while a session holds the
   *  sidecar's TTS engine, and when no language the engine speaks has a
   *  sample sentence. */
  previewUnavailableReason?: string;
  /** Re-fetches a remotely-sourced custom-voice list (e.g. Soniox clones live
   *  server-side). When provided, a Refresh button renders next to the
   *  picker's own Presets group. */
  onRefresh?: () => void;
  /** True while the remote list fetch is in flight; disables the Refresh button. */
  refreshing?: boolean;
  /** Provider-specific footnote — e.g. Soniox's preview spends the user's own
   *  TTS quota, or an explanation of why creation is currently withdrawn
   *  (managed mode already has a healthy voice: delete it before recording a
   *  new one). Renders inside the Add-a-voice modal when that modal is
   *  reachable (`capability.importModes` non-empty), where the controls it
   *  describes live. When it is NOT reachable (no add row — `importModes` is
   *  empty), the modal can never open, so this renders inline in the section
   *  instead: the whole reason for the note is usually to explain that
   *  absence, and it must not become unreachable along with the controls it
   *  would otherwise sit beside. Never rendered in both places at once. Kept
   *  as a caller-supplied node because the copy is provider-specific and this
   *  component is provider-agnostic. */
  manageNote?: React.ReactNode;
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
  createReview,
  onPreview,
  previewUnavailableReason,
  onRefresh,
  refreshing = false,
  manageNote,
  capability,
  isSessionActive = false,
}) => {
  const { t } = useTranslation();

  // ---- local playback (listen back to a voice's sample) -------------------
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Non-null while an onPreview call is in flight for that row.
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Monotonic token: a toggle invalidates any earlier onPreview still in
  // flight, so a stale resolution can't start playback over a newer one.
  const previewTokenRef = useRef(0);
  // Cancels the in-flight onPreview itself, not just its result: a synthesized
  // sample costs the user money, so a superseded request should never reach
  // the network rather than being paid for and discarded.
  const previewAbortRef = useRef<AbortController | null>(null);

  const stopPreview = useCallback(() => {
    previewTokenRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setPreviewLoadingId(null);
    const src = sourceRef.current;
    if (src) {
      src.onended = null;
      try { src.stop(); } catch { /* already stopped/ended */ }
      sourceRef.current = null;
    }
    setPlayingId(null);
  }, []);

  // The return value exists only to satisfy VoicePicker's `onPreview` prop
  // type — the picker never reads what this resolves to (it only
  // `.catch()`es a rejection; see VoicePicker.tsx's preview button). But the
  // `signal` PARAMETER is honoured, not ignored: the picker aborts its own
  // controller on the next click and on its own unmount (VoicePicker.tsx),
  // and closing the popover must cancel too — a synthesized sample is
  // billed to the user (Soniox), so a request the user has abandoned must
  // never be left to resolve and start playback into a popover that is
  // already gone, with no reachable Stop control. `stopPreview` IS the
  // cancellation path `signal`'s abort listener uses below: it bumps the
  // token (invalidating `token`, so the superseded-check after the `await`
  // catches it too), aborts this SAME `controller` (reaching the underlying
  // `onPreview` call so the network request itself is cancelled, not just
  // its result discarded), and stops any playback already under way. A
  // second row's click still supersedes the first's in-flight request via
  // the unconditional `stopPreview()` call at the top of every invocation
  // (proven by this file's own "aborts an in-flight preview when the user
  // starts another one" case) — the listener below is what closes the gap
  // that left, the same cancellation reaching a preview the user dismissed
  // without starting another one.
  const togglePreview = useCallback(async (
    id: string,
    signal?: AbortSignal,
  ): Promise<{ audio: Float32Array; sampleRate: number } | null> => {
    if (playingId === id) { stopPreview(); return null; }
    stopPreview();
    if (!onPreview) return null;
    const token = previewTokenRef.current;
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoadingId(id);
    // Removed on every exit below — success, error, or the abort itself
    // (`{ once: true }`) — so no listener from a past call ever outlives it.
    // Precedent: `voiceLibrarySource.ts`'s `retryDelay`/`waitTurn`, whose own
    // comments spell out the same "every exit, not just the wait-wins path"
    // requirement for the same reason.
    signal?.addEventListener('abort', stopPreview, { once: true });
    let payload: { audio: Float32Array; sampleRate: number } | null = null;
    try {
      payload = await onPreview(id, controller.signal);
    } catch {
      payload = null;
    } finally {
      signal?.removeEventListener('abort', stopPreview);
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      // Only the newest request owns the spinner — a superseded one must not
      // clear a spinner that now belongs to another row.
      if (token === previewTokenRef.current) setPreviewLoadingId(null);
    }
    if (token !== previewTokenRef.current) return null; // superseded by a newer toggle
    if (!payload || payload.audio.length === 0) return null;
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
    return payload;
  }, [playingId, onPreview, stopPreview]);

  // Stop playback + release the context on unmount.
  useEffect(() => () => {
    stopPreview();
    void audioCtxRef.current?.close().catch(() => {});
  }, [stopPreview]);

  // ---- modal state ----------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // No rename wrapper here on purpose. There used to be one, catching the
  // rejection into a `console.warn` under a comment claiming that reporting a
  // failed commit was this composition root's job — but it had no surface to
  // report on, so a failed rename was silent to the user and visible only in
  // DevTools. The rename UI lives entirely in the picker (the input, commit
  // on blur/Enter), so by the single-owner-by-origin rule the picker both
  // catches the rejection and renders it, in the row under the input.
  // `onRename` is therefore handed straight down, unwrapped.

  // NOT optimistic any more. This used to close the modal before awaiting —
  // "matches the old window.confirm flow" — and swallow the rejection with a
  // console.warn. That reasoning died when deletion moved into a modal: the
  // only failure surface was this section's banner, which the modal covers,
  // and by the time the rejection arrived the modal was already unmounted, so
  // a failed delete was silent everywhere. The modal now owns the outcome: it
  // awaits, closes itself on success, and shows the reason on failure, so this
  // rethrows instead of reporting.
  const handleDeleteConfirm = useCallback(async (id: string) => {
    await onDelete(id);
  }, [onDelete]);

  const canCreate = capability.importModes.length > 0;
  const selectedDescription = voices.find((v) => v.id === selectedId)?.meta?.facets?.description;

  return (
    <div className="voice-library-section">
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('voiceLibrary.voice', 'Voice')}</span>
        </div>
        <VoicePicker
          voices={voices}
          selectedId={selectedId}
          onSelect={onSelect}
          onPreview={onPreview ? togglePreview : undefined}
          previewUnavailableReason={previewUnavailableReason}
          playingId={playingId}
          loadingId={previewLoadingId}
          onRename={onRename}
          onAskDelete={(id, label) => setDeleteTarget({ id, label })}
          onAddVoice={canCreate ? () => setCreating(true) : undefined}
          onRefresh={onRefresh}
          refreshing={refreshing}
          capability={capability}
          isSessionActive={isSessionActive}
        />
        {selectedDescription && (
          <div className="voice-selected-description">{selectedDescription}</div>
        )}
      </div>

      {/* manageNote's other home — see the prop's own doc comment. Only
          reachable here when the create path is NOT (no add row), so this
          and the modal's own rendering of the same node are mutually
          exclusive by construction, never both at once. */}
      {!canCreate && manageNote && (
        <div className="voice-library-info">{manageNote}</div>
      )}

      <VoiceCreateModal
        // `|| !!createReview`: a successful import runs the modal's own
        // close path, which drops `creating` — but for a provider that
        // staged the clip for confirmation the flow is not over, and the
        // review phase has to stay on screen. Deciding it here, from the
        // state that is already current, avoids the modal having to guess
        // mid-await whether a clip got staged during its own `onImport`.
        isOpen={creating || !!createReview}
        onClose={() => setCreating(false)}
        onImport={onImport}
        onRecord={onRecord}
        capability={capability}
        note={canCreate ? manageNote : undefined}
        review={createReview}
      />
      <VoiceDeleteModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
};

export default VoiceLibrarySection;

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Play, Square } from 'lucide-react';
import Modal from '../../Modal/Modal';

/** `m:ss` readout for the custom player's time display; guards against
 *  NaN/Infinity before a real duration is known (pre-`loadedmetadata`, or a
 *  blob URL jsdom/some browsers never resolve metadata for). */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface SonioxCloneConfirmModalProps {
  isOpen: boolean;
  /** The picked/recorded clip, played back so the user can check it before
   *  it's uploaded. Null only while the modal is closed. */
  audioBlob: Blob | null;
  /** Mapped `create()` failure message (e.g. voice_name_conflict) — set by
   *  the caller to keep the modal open for a rename-and-retry. */
  error: string | null;
  /** True while a create() request is in flight — disables the inputs and
   *  both actions so the request can't be double-submitted or orphaned by a
   *  cancel mid-flight. */
  busy: boolean;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

/**
 * Post-acquisition confirm step for Soniox voice cloning
 * (SonioxVoiceSection): opens once a clip has been picked/recorded and has
 * passed client-side validation, before it is uploaded. Built on the shared
 * Modal primitive. A usage-rights checkbox ("I confirm I have the right to
 * use this voice") gates the confirm button — unchecked, the upload cannot
 * be submitted.
 *
 * Purely presentational: the caller owns `pending` (modal open ⇔ non-null),
 * performs the actual `create()` call from `onConfirm`, and — on a mapped
 * create failure — keeps this open with `error` set so the user can rename
 * and retry without losing the clip.
 *
 * The name field deliberately starts EMPTY, showing only its placeholder —
 * the default name (stripped filename / "My Voice {{n}}") is applied by the
 * caller when the field is left blank, never displayed as a prefilled value.
 *
 * The caller mounts a fresh instance (via a changing `key`) for every newly
 * staged clip, so the name state reseeds empty per capture. A confirm-error
 * retry reuses the SAME instance (the caller doesn't change the key), which
 * is what keeps the user's just-typed name in place while they fix a
 * conflict and retry.
 */
const SonioxCloneConfirmModal: React.FC<SonioxCloneConfirmModalProps> = ({
  isOpen,
  audioBlob,
  error,
  busy,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  // Usage-rights consent, required per clip: the confirm button stays
  // disabled until checked. Seeds unchecked on every key-remount (each newly
  // staged clip re-asks); a confirm-error retry keeps it checked.
  const [consent, setConsent] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Custom player state (replaces native <audio controls>, which renders as
  // unstyled browser chrome outside .settings-section — see Settings.scss).
  // Driven entirely by the hidden <audio> element's own play/pause/timeupdate/
  // loadedmetadata/ended events rather than set eagerly on click, so it stays
  // in sync with what the element is actually doing (autoplay-policy
  // rejections, real seek completion, etc.).
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // One object URL per blob, revoked on change/unmount so repeated
  // record/import attempts never leak blob: URLs. Player state resets here
  // too — a fresh blob means playback position/duration from the previous
  // clip no longer apply.
  useEffect(() => {
    if (!audioBlob) { setAudioUrl(null); return; }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = fraction * duration;
    setCurrentTime(audio.currentTime);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.sonioxVoiceCloneTitle', 'Clone voice')}
    >
      <div className="soniox-clone-confirm-modal">
        <p>
          {t('settings.sonioxVoiceCloneReview', 'Listen to your clip and name the voice before uploading.')}
        </p>
        {audioUrl && (
          <div className="soniox-clone-confirm-modal__player">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a locally captured reference clip has no captions to provide */}
            <audio
              ref={audioRef}
              className="soniox-clone-confirm-modal__audio-el"
              src={audioUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />
            <button
              type="button"
              className="soniox-clone-confirm-modal__play-toggle"
              onClick={togglePlay}
              aria-label={isPlaying ? t('voiceLibrary.stopPreview', 'Stop') : t('voiceLibrary.play', 'Play')}
              title={isPlaying ? t('voiceLibrary.stopPreview', 'Stop') : t('voiceLibrary.play', 'Play')}
            >
              {isPlaying ? <Square size={14} /> : <Play size={14} />}
            </button>
            <div
              className="soniox-clone-confirm-modal__progress"
              ref={progressRef}
              onClick={handleSeek}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={duration || 0}
              aria-valuenow={currentTime}
            >
              <div
                className="soniox-clone-confirm-modal__progress-fill"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
            </div>
            <span className="soniox-clone-confirm-modal__time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        )}
        <input
          type="text"
          className="text-input"
          value={name}
          maxLength={128}
          placeholder={t('settings.sonioxVoiceNamePlaceholder', 'Name for a new cloned voice (optional)')}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <label className="soniox-clone-confirm-modal__consent">
          {/* Native input kept for semantics/a11y but visually replaced by the
              drawn box below — a raw OS checkbox clashes with the design
              system (the app's only other native checkbox is the tiny
              "Unlimited" annotation; every prominent boolean is custom-drawn). */}
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span className="soniox-clone-confirm-modal__consent-box" aria-hidden="true">
            {consent && <Check size={12} strokeWidth={3} />}
          </span>
          <span>{t('settings.sonioxVoiceConsent', 'I confirm I have the right to use this voice')}</span>
        </label>
        {error && (
          <div className="voice-capture-error" role="alert">{error}</div>
        )}
        <div className="soniox-clone-confirm-modal__actions">
          <button
            type="button"
            className="soniox-clone-confirm-modal__cancel"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="soniox-clone-confirm-modal__accept"
            onClick={() => onConfirm(name)}
            disabled={busy || !consent}
          >
            {busy && (
              <Loader2
                size={14}
                className="soniox-clone-confirm-modal__spinner"
                data-testid="soniox-clone-confirm-busy-spinner"
              />
            )}
            {t('settings.sonioxVoiceCloneTitle', 'Clone voice')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SonioxCloneConfirmModal;

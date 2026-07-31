import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../Modal/Modal';

export interface SonioxCloneConfirmModalProps {
  isOpen: boolean;
  /** Prefilled into the name field — the stripped upload filename, or the
   *  "My Voice {{n}}" default for a recording. */
  suggestedName: string;
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
 * passed client-side validation, before it is uploaded. Modeled on
 * LicenseConsentModal (shared Modal primitive, cancel + accept buttons) —
 * here the accept button IS the consent statement ("I confirm I have the
 * right to use this voice"), so there's no separate checkbox.
 *
 * Purely presentational: the caller owns `pending` (modal open ⇔ non-null),
 * performs the actual `create()` call from `onConfirm`, and — on a mapped
 * create failure — keeps this open with `error` set so the user can rename
 * and retry without losing the clip.
 *
 * The caller mounts a fresh instance (via a changing `key`) for every newly
 * staged clip, so `useState(suggestedName)` below only needs to seed once —
 * no effect-driven resync required, and no risk of a stale name flashing
 * before an effect catches up. A confirm-error retry reuses the SAME
 * instance (the caller doesn't change the key), which is what keeps the
 * user's just-typed name in place while they fix a conflict and retry.
 */
const SonioxCloneConfirmModal: React.FC<SonioxCloneConfirmModalProps> = ({
  isOpen,
  suggestedName,
  audioBlob,
  error,
  busy,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(suggestedName);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // One object URL per blob, revoked on change/unmount so repeated
  // record/import attempts never leak blob: URLs.
  useEffect(() => {
    if (!audioBlob) { setAudioUrl(null); return; }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

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
          // eslint-disable-next-line jsx-a11y/media-has-caption -- a locally captured reference clip has no captions to provide
          <audio className="soniox-clone-confirm-modal__audio" controls src={audioUrl} />
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
            disabled={busy}
          >
            {t('settings.sonioxVoiceConsent', 'I confirm I have the right to use this voice')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SonioxCloneConfirmModal;

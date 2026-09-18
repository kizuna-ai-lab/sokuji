import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFloating, FloatingFocusManager } from '@floating-ui/react';
import { X } from 'lucide-react';
import './VoiceCreateModal.scss';

/**
 * Deleting a voice, with the consequence spelled out.
 *
 * Replaces a `window.confirm`, which could not say that the on-device
 * reference recording goes with the voice, and looked nothing like the rest of
 * the app. Shares VoiceCreateModal's stylesheet: same overlay, same dialog
 * frame, one less body.
 */
export interface VoiceDeleteModalProps {
  /** The voice to delete, or null when the modal is closed. */
  target: { id: string; label: string } | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

const VoiceDeleteModal: React.FC<VoiceDeleteModalProps> = ({ target, onClose, onConfirm }) => {
  const { t } = useTranslation();
  // This dialog used to fire `void onConfirm(id)` and let the parent close it
  // immediately, "optimistic — matches the old window.confirm flow". That
  // reasoning stopped holding the moment deletion moved into a modal: the
  // parent's failure banner renders in the settings section BEHIND this
  // dialog, and the dialog was already gone by the time the rejection
  // arrived, so a failed delete said nothing anywhere. It now awaits the
  // result, closes only on success, and shows the failure in place — the same
  // seam `SonioxCloneReviewStep` has carried all along.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new target is a new question: never show the previous voice's failure.
  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [target?.id]);

  // Every way out of this dialog, refused while the delete is in flight.
  // Cancel and Delete carry `disabled={busy}`; Escape, the backdrop and the
  // header X had nothing, so the parent could clear `deleteTarget` mid-flight
  // and unmount the only surface the rejection has — the exact failure that
  // keeping this dialog open was meant to remove (review finding, PR #542).
  const dismiss = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, dismiss]);

  // Open-state context only — this dialog is centred over the app and anchored
  // to nothing. See VoiceCreateModal's own comment on the focus manager below
  // for why `modal={false}` and `closeOnFocusOut={false}`.
  const { refs, context } = useFloating({ open: target !== null });

  if (!target) return null;

  return (
    <div className="voice-modal-overlay" onClick={dismiss}>
      {/* Spec §7: focus moves in on open and returns to the invoking control
          on close. Initial focus lands on the first tabbable control, which is
          the header's Close button — deliberately not Delete, since the
          destructive action should never be one stray Enter away. */}
      <FloatingFocusManager context={context} modal={false} returnFocus closeOnFocusOut={false}>
      <div ref={refs.setFloating} className="voice-modal" role="dialog" aria-modal="true"
        aria-label={t('voiceLibrary.deleteTitle', 'Delete voice')}
        onClick={(e) => e.stopPropagation()}>
        <div className="voice-modal__head">
          <h3>{t('voiceLibrary.deleteTitle', 'Delete voice')}</h3>
          <button className="voice-modal__x" onClick={dismiss} aria-label={t('common.close', 'Close')}>
            <X size={17} />
          </button>
        </div>
        <div className="voice-modal__body">
          {t('voiceLibrary.deleteBody', 'Delete "{name}"? This also removes the reference recording stored on this device.')
            .replace('{name}', target.label)}
        </div>
        {error && (
          <div className="voice-capture-error" role="alert">{error}</div>
        )}
        <div className="voice-modal__foot">
          <button type="button" className="voice-modal__btn" onClick={onClose} disabled={busy}>
            {/* `common.cancel`, not a new `voiceLibrary.cancel`: the key
                already exists and both modal siblings in this directory
                render it this way (`ModelImportModal.tsx:343`,
                `SonioxCloneReviewStep.tsx`). */}
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="voice-modal__btn voice-modal__btn--danger"
            disabled={busy}
            onClick={() => {
              // Awaited, and the dialog closes only on success. A rejection
              // keeps it open with the reason in place: the parent's banner
              // sits in the settings section behind this overlay, so letting
              // the parent report it meant reporting it nowhere.
              setError(null);
              setBusy(true);
              void onConfirm(target.id)
                .then(() => { onClose(); })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => { setBusy(false); });
            }}>
            {t('voiceLibrary.delete', 'Delete')}
          </button>
        </div>
      </div>
      </FloatingFocusManager>
    </div>
  );
};

export default VoiceDeleteModal;

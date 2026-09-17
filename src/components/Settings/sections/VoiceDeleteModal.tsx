import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  return (
    <div className="voice-modal-overlay" onClick={onClose}>
      <div className="voice-modal" role="dialog" aria-modal="true"
        aria-label={t('voiceLibrary.deleteTitle', 'Delete voice')}
        onClick={(e) => e.stopPropagation()}>
        <div className="voice-modal__head">
          <h3>{t('voiceLibrary.deleteTitle', 'Delete voice')}</h3>
          <button className="voice-modal__x" onClick={onClose} aria-label={t('common.close', 'Close')}>
            <X size={17} />
          </button>
        </div>
        <div className="voice-modal__body">
          {t('voiceLibrary.deleteBody', 'Delete "{name}"? This also removes the reference recording stored on this device.')
            .replace('{name}', target.label)}
        </div>
        <div className="voice-modal__foot">
          <button type="button" className="voice-modal__btn" onClick={onClose}>
            {/* `common.cancel`, not a new `voiceLibrary.cancel`: the key
                already exists and both modal siblings in this directory
                render it this way (`ModelImportModal.tsx:343`,
                `SonioxCloneConfirmModal.tsx:223`). */}
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="voice-modal__btn voice-modal__btn--danger"
            onClick={() => { void onConfirm(target.id); }}>
            {t('voiceLibrary.delete', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceDeleteModal;

import React from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../Modal/Modal';
import { PACK_MODELS, PACK_TOTAL_BYTES } from '../../../stores/segmentationStore';
import { formatBytes } from '../../../lib/local-inference/formatBytes';

interface SegmentationDownloadModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The one question sentence segmentation ever asks. Turning the toggle on with
 * the pack absent opens this; nothing is downloaded and the setting is not
 * flipped until the confirm button is pressed (SentenceSegmentationSection
 * owns both, this is purely presentational).
 *
 * Built on the shared `Modal` primitive and laid out like
 * `LicenseConsentModal` — the other gate that stands between a user and a
 * download — down to the full-width Cancel/confirm pair, rather than a new
 * button pattern of its own.
 *
 * Every size is read from `PACK_MODELS` / `PACK_TOTAL_BYTES`, which derive
 * from the manifest: the number the user approves here is literally the same
 * number the download then spends.
 */
const SegmentationDownloadModal: React.FC<SegmentationDownloadModalProps> = ({
  isOpen,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();
  const total = formatBytes(PACK_TOTAL_BYTES);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settings.sentenceSegmentationDownloadTitle', 'Download segmentation models')}
    >
      <div className="segmentation-download-modal">
        <p>
          {t(
            'settings.sentenceSegmentationDownloadBody',
            'Sentence segmentation needs three models, one per language group. They download once and stay on this device.',
          )}
        </p>
        <ul className="segmentation-download-modal__models">
          {PACK_MODELS.map((model) => (
            <li key={model.manifestId} className="segmentation-download-modal__row">
              <span className="segmentation-download-modal__name">{model.name}</span>
              <span className="segmentation-download-modal__size">{formatBytes(model.sizeBytes)}</span>
            </li>
          ))}
        </ul>
        <div className="segmentation-download-modal__row segmentation-download-modal__row--total">
          <span className="segmentation-download-modal__name">
            {t('settings.sentenceSegmentationDownloadTotal', 'Total')}
          </span>
          <span className="segmentation-download-modal__size">{total}</span>
        </div>
        <div className="segmentation-download-modal__actions">
          <button type="button" className="segmentation-download-modal__cancel" onClick={onClose}>
            {t('settings.sentenceSegmentationDownloadCancel', 'Cancel')}
          </button>
          <button type="button" className="segmentation-download-modal__accept" onClick={onConfirm}>
            {t('settings.sentenceSegmentationDownloadConfirm', 'Download {{size}}', { size: total })}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SegmentationDownloadModal;

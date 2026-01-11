import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../Modal/Modal';
import { useTranslation } from 'react-i18next';
import { WarningType } from './hooks';

interface WarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: WarningType | null;
}

const WarningModal: React.FC<WarningModalProps> = ({ isOpen, onClose, type }) => {
  const { t } = useTranslation();

  if (!type) return null;

  const getWarningContent = () => {
    switch (type) {
      case 'virtual-mic':
        return {
          title: t('audioPanel.virtualMicrophoneNotice'),
          titleText: t('audioPanel.virtualMicWarningTitle'),
          paragraphs: [
            t('audioPanel.virtualMicWarningText1'),
            t('audioPanel.virtualMicWarningText2')
          ]
        };
      case 'virtual-speaker':
        return {
          title: t('audioPanel.virtualSpeakerNotice'),
          titleText: t('audioPanel.virtualSpeakerWarningTitle'),
          paragraphs: [
            t('audioPanel.virtualSpeakerWarningText1'),
            t('audioPanel.virtualSpeakerWarningText2'),
            t('audioPanel.virtualSpeakerWarningText3'),
            t('audioPanel.virtualSpeakerWarningText4')
          ]
        };
      case 'mutual-exclusivity-speaker':
        return {
          title: t('audioPanel.mutualExclusivityNotice', 'Audio Conflict'),
          titleText: t('audioPanel.mutualExclusivitySpeakerTitle', 'Cannot enable Speaker'),
          paragraphs: [
            t('audioPanel.mutualExclusivitySpeakerText', 'Please turn off Participant Audio before enabling Speaker.')
          ]
        };
      case 'mutual-exclusivity-participant':
        return {
          title: t('audioPanel.mutualExclusivityNotice', 'Audio Conflict'),
          titleText: t('audioPanel.mutualExclusivityParticipantTitle', 'Cannot enable Participant Audio'),
          paragraphs: [
            t('audioPanel.mutualExclusivityParticipantText', 'Please turn off Speaker before enabling Participant Audio.')
          ]
        };
      default:
        return null;
    }
  };

  const content = getWarningContent();
  if (!content) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={content.title}
    >
      <div className="warning-modal-content">
        <div className="warning-icon">
          <AlertTriangle size={24} color="#f0ad4e" />
        </div>
        <p>
          <strong>{content.titleText}</strong>
        </p>
        {content.paragraphs.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
        <button
          className="understand-button"
          onClick={onClose}
        >
          {t('audioPanel.iUnderstand')}
        </button>
      </div>
    </Modal>
  );
};

export default WarningModal;

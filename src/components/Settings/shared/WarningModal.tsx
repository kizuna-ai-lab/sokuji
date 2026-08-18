import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../Modal/Modal';
import { useTranslation } from 'react-i18next';
import { WarningType } from './hooks';

interface WarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: WarningType | null;
  /**
   * Extra sentence appended to the message. Used to point out that a denied
   * permission has a working alternative, rather than leaving the user with a
   * dead end.
   */
  note?: string | null;
}

const WarningModal: React.FC<WarningModalProps> = ({ isOpen, onClose, type, note }) => {
  const { t } = useTranslation();

  // macOS lists the process under the name of the bundle it launched. A
  // packaged build is "Sokuji", but `npm run dev` runs Electron's own bundle,
  // so telling a developer to look for "Sokuji" sends them hunting for an entry
  // that is not there.
  const [tccName, setTccName] = useState<string>('Sokuji');
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // The extension and web builds have no window.electron at all, and this
    // modal is shared with their virtual-device warnings.
    const pending = window.electron?.invoke?.('get-tcc-display-name');
    if (!pending?.then) return;
    pending
      .then((r: { name?: string }) => { if (!cancelled && r?.name) setTccName(r.name); })
      .catch(() => { /* keep the packaged-build default */ });
    return () => { cancelled = true; };
  }, [isOpen]);

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
      case 'loopback-mic':
        return {
          title: t('audioPanel.loopbackMicNotice', 'Loopback Input Notice'),
          titleText: t('audioPanel.loopbackMicWarningTitle', 'This input re-captures what this computer is playing.'),
          paragraphs: [
            t('audioPanel.loopbackMicWarningText1', 'Loopback inputs like "Stereo Mix" or a "Monitor of ..." device record the system\'s own audio output. During a session that includes Sokuji\'s translated speech, Sokuji would hear and translate itself in a loop.'),
            t('audioPanel.loopbackMicWarningText2', 'The device stays selected in case this routing is intentional, but for normal use please pick a physical microphone instead.')
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
      case 'screen-recording-denied':
        return {
          title: t('audioPanel.screenRecordingDeniedNotice', 'Permission Required'),
          titleText: t('audioPanel.screenRecordingDeniedTitle', 'Screen Recording Permission Denied'),
          paragraphs: [
            t('audioPanel.screenRecordingDeniedText1', 'Participant Audio requires Screen Recording permission to capture system audio.'),
            t('audioPanel.screenRecordingDeniedText2Named', 'Open System Settings > Privacy & Security > Screen Recording and enable "{{app}}".', { app: tccName }),
            t('audioPanel.screenRecordingDeniedText3', 'After enabling the permission, please restart the app.')
          ],
          // Capturing everything the machine plays goes through screen capture.
          privacyPane: 'screen-recording' as const,
        };
      case 'audio-capture-denied':
        return {
          title: t('audioPanel.audioCaptureDeniedNotice', 'Permission Required'),
          titleText: t('audioPanel.audioCaptureDeniedTitle', 'System Audio Recording Permission Needed'),
          paragraphs: [
            t('audioPanel.audioCaptureDeniedText1', 'Capturing one application needs the "System Audio Recording Only" permission. Without it macOS delivers silence instead of an error, so the session runs but nothing is translated.'),
            t('audioPanel.audioCaptureDeniedText2Named', 'Open System Settings > Privacy & Security > System Audio Recording Only and enable "{{app}}".', { app: tccName }),
            t('audioPanel.audioCaptureDeniedText3Named', '"{{app}}" only appears in that list after it has tried to capture once, which it just did. Restart the session after enabling it.', { app: tccName })
          ],
          // Per-application capture uses a Core Audio tap, not screen capture.
          privacyPane: 'audio-capture' as const,
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
        {note && <p className="warning-note">{note}</p>}
        {content.privacyPane && (
          <button
            className="open-settings-button"
            onClick={() => {
              // Deep-links straight to the pane rather than making the user
              // hunt through System Settings for it.
              window.electron?.invoke('open-privacy-settings', content.privacyPane);
            }}
          >
            {t('audioPanel.openSystemSettings', 'Open System Settings')}
          </button>
        )}
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

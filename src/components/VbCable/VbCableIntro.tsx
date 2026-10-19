// src/components/VbCable/VbCableIntro.tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../Modal/Modal';
import { useTour } from '../Tour/TourProvider';
import { faceToFaceFromStores, speechFromStores } from '../../lib/session/appShape';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTextOnly } from '../../stores/settingsStore';
import { useVbCablePresence, useVbCableStore } from '../../stores/vbCableStore';
import VbCableNotice from './VbCableNotice';

/**
 * The one-time introduction to VB-CABLE on Windows (spec 2026-10-17 §4). It
 * opens once the translation is spoken into a virtual microphone that is not
 * there, after the tour, and stays open through the install until closed.
 */
const VbCableIntro: React.FC = () => {
  const { t } = useTranslation();
  const { active: tourActive } = useTour();
  const presence = useVbCablePresence();
  const channel = useVbCableStore((s) => s.channel);
  const introSeen = useVbCableStore((s) => s.introSeen);
  const attempt = useVbCableStore((s) => s.attempt);
  const readyDismissed = useVbCableStore((s) => s.readyDismissed);
  const load = useVbCableStore((s) => s.load);
  const markIntroSeen = useVbCableStore((s) => s.markIntroSeen);
  const dismissReady = useVbCableStore((s) => s.dismissReady);
  // Subscribed: who hears what is read from these stores below.
  useTextOnly();
  useAudioStore((s) => s.mode);
  useAudioStore((s) => s.otherSide);
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  useRoutingStore((s) => s.participantSpeech);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (presence !== 'not-applicable') void load();
  }, [presence, load]);

  const wanted = presence === 'missing' && channel !== null && introSeen === false && !tourActive
    && speechFromStores().other && !faceToFaceFromStores();
  useEffect(() => {
    if (wanted) setOpen(true);
  }, [wanted]);

  // VB-CABLE turned up with nothing left to say (installed by hand, then Check
  // again): the notice draws nothing, so the dialog would stand empty.
  const nothingToShow = presence === 'present' && (attempt === 'none' || readyDismissed);
  useEffect(() => {
    if (open && nothingToShow) {
      setOpen(false);
      markIntroSeen();
    }
  }, [open, nothingToShow, markIntroSeen]);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    markIntroSeen();
    // A ready line the user has just read here need not wait for them in the settings.
    if (presence === 'present') dismissReady();
  };
  return (
    <Modal isOpen onClose={close} title={t('vbCable.title', 'Let the other side hear the translation')}>
      <VbCableNotice variant="modal" onNotNow={close} />
    </Modal>
  );
};

export default VbCableIntro;

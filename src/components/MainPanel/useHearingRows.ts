// src/components/MainPanel/useHearingRows.ts
//
// The state of the two rows of what I hear — "Translation I hear" and "I hear
// it too" — computed once for the speech section and the toolbar's headphones
// entry, so both follow the same rules (providers and stages design, ruling 19).
import { useRunParticipantSpeech } from '../../app/useRun';
import { heardFromStores, selectedFromStores } from '../../lib/session/appShape';
import { useAudioContext, useMode, useParticipantCaptureWidened, useSelectedParticipantSource } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTextOnly } from '../../stores/settingsStore';
import { useFaceToFace } from './useFaceToFace';

export function useHearingRows(isSessionActive: boolean) {
  const mode = useMode();
  const f2f = useFaceToFace();
  const faceToFace = f2f.active;
  // Subscribed so the provider's speech rules follow a switch of provider.
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  const provider = selectedFromStores()?.provider;
  const speech = provider?.speech ?? 'optional';
  const participantOffered = provider?.participantSpeech !== false;
  const textOnly = useTextOnly();
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const setParticipantSpeech = useRoutingStore((s) => s.setParticipantSpeech);
  const { isMonitorMuted, setMonitorMuted } = useAudioContext();
  // Subscribed so the blocked state follows a capture that widens mid-run, and the source `heardFromStores` reads.
  useParticipantCaptureWidened();
  useSelectedParticipantSource();
  const myLegRuns = mode !== 'participant';
  const theirLegRuns = mode !== 'speaker';
  const heard = heardFromStores(faceToFace);
  const recaptured = theirLegRuns && !faceToFace && !heard;
  const otherOn = speech === 'always' ? true : speech === 'never' ? false : !textOnly;
  const runSpeech = useRunParticipantSpeech();
  const themLocked = isSessionActive && runSpeech !== true;
  const themOn = runSpeech !== false && participantOffered && !recaptured && speech !== 'never' && (speech === 'always' || (participantSpeech ?? faceToFace));
  const meChecked = !isMonitorMuted && !(recaptured && mode === 'both');
  const meDisabled = recaptured && mode === 'both';
  return {
    mode, faceToFace, f2f, myLegRuns, theirLegRuns, recaptured, otherOn, speech, participantOffered,
    themOn, themLocked, meChecked, meDisabled,
    toggleThem: () => setParticipantSpeech(!(participantSpeech ?? faceToFace)),
    toggleMe: () => setMonitorMuted(!isMonitorMuted),
  };
}

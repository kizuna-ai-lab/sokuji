// src/lib/history/capture/facts.ts
//
// What a History record keeps about how its session was put together, read from the stores the run's shape was
// read from, once, when the record opens: where each leg's sound came from (by kind and by the name the interface
// showed), whether its translation is spoken, whether one connection serves both legs, and whether the session gives
// original text at all.
import { translatesSpeechDirectly } from '../../../providers/localInference/config';
import useAudioStore from '../../../stores/audioStore';
import { getAppVersion } from '../../../utils/conversationExport';
import { isExtension } from '../../../utils/environment';
import { planFromStores } from '../../plan/fromStores';
import { transcriptionAccount } from '../../plan/read';
import { faceToFaceFromStores, legsFor, speechFromStores } from '../../session/appShape';
import type { ConversationInfo } from '../../session/conversationSet';
import type { CaptureFacts, LegComposition } from './writer';

/** The participant source that is the whole system's sound, not one application's. */
const SYSTEM_LOOPBACK = 'desktop-audio-loopback';

export function captureFactsFromStores(o: { info: ConversationInfo | null; participantSpeech: boolean }): CaptureFacts {
  const audio = useAudioStore.getState();
  const faceToFace = faceToFaceFromStores();
  const mic = audio.selectedInputDevice;
  const speaker: LegComposition = { input: 'microphone', inputName: mic?.label ?? null, inputId: mic?.deviceId ?? null, spoken: speechFromStores().other };
  let participant: LegComposition;
  if (faceToFace) {
    participant = { ...speaker, spoken: o.participantSpeech };
  } else if (isExtension()) {
    participant = { input: 'tab', inputName: null, inputId: null, spoken: o.participantSpeech };
  } else {
    const source = audio.selectedParticipantSource;
    participant = {
      input: source?.deviceId === SYSTEM_LOOPBACK ? 'system' : 'app',
      inputName: source?.label ?? null, inputId: source?.deviceId ?? null, spoken: o.participantSpeech,
    };
  }
  // One connection for both legs: today the providers that offer it name it `bothModeSharedSession`; the plan's
  // transcription provider's settings say it.
  const found = planFromStores();
  const settings = (found.state === 'ready' ? transcriptionAccount(found).settings : undefined) as { bothModeSharedSession?: unknown } | undefined;
  const shared = !faceToFace && legsFor(audio.mode).length > 1 && settings?.bothModeSharedSession === true;
  const models = o.info?.models;
  const originalText = !(o.info?.provider === 'local_inference' && translatesSpeechDirectly(models?.asrModel, models?.translationModel));
  return { mode: faceToFace ? 'face-to-face' : audio.mode, legs: { speaker, participant }, shared, originalText, appVersion: getAppVersion() ?? '' };
}

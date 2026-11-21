import { useRunParticipantSpeech } from '../../app/useRun';
import { resolveOutlet } from '../../lib/audio/outlets';
import type { LegName } from '../../lib/conversation/types';
import { speechFromStores } from '../../lib/session/appShape';
import { useStageUnit } from '../../lib/plan/fromStores';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

/** One ear of a stereo device. */
export type Ear = 'left' | 'right';

export interface FaceToFaceView {
  /** The unit that transcribes can run face-to-face: the Both popover offers "beside me". */
  offered: boolean;
  /** Face-to-face is on: Both, beside me, under a provider that offers it (`faceToFaceFromStores`'s rule, live). */
  active: boolean;
  /**
   * "Beside me" is chosen in Both, and the line-up cannot run it because another service translates what this one
   * transcribes: Start is refused for it, so the choice stays on show for the user to put the other side back in a
   * meeting (the other way out is the line-up). False or absent wherever face-to-face is offered or was never chosen.
   */
  refused?: boolean;
  /** The ear each leg's translation plays in; absent when its outlet is centred. speaker → `other`, participant → `them`. */
  ears: Readonly<Partial<Record<LegName, Ear>>>;
  /** The resolved device label of each face-to-face outlet; null when none is known. */
  outletDevices: Readonly<Record<'other' | 'them', string | null>>;
  /** My language and theirs: the pair of the provider that transcribes. */
  me: string | null;
  other: string | null;
  /** Whether each leg's translation is voiced in a run started now: `speakFor`'s `other` and `them`. */
  speaks: Readonly<Record<LegName, boolean>>;
}

/** `faceToFaceFromStores`'s rule as a hook: over the plan's transcription unit, which offers face-to-face, its provider's pair, and the plan's speech unit. */
export function useFaceToFace(): FaceToFaceView {
  const transcription = useStageUnit('transcription');
  const translation = useStageUnit('translation');
  const speechUnit = useStageUnit('speech');
  const pair = useProviderStore((s) => (transcription ? s.entries[transcription.provider.id]?.pair ?? null : null));
  const mode = useAudioStore((s) => s.mode);
  const otherSide = useAudioStore((s) => s.otherSide);
  const outlets = useAudioStore((s) => s.outlets);
  const devices = useAudioStore((s) => s.audioMonitorDevices);
  const defaultDevice = useAudioStore((s) => s.selectedMonitorDevice);
  // The rest of what `speechFromStores` reads, subscribed so `speaks` follows the switches and the source.
  useSettingsStore((s) => s.textOnly);
  useRoutingStore((s) => s.participantSpeech);
  useAudioStore((s) => s.isMonitorMuted);
  useAudioStore((s) => s.selectedParticipantSource?.deviceId);
  useAudioStore((s) => s.participantCaptureWidened);
  const offered = transcription?.capabilities.faceToFace === true && pair !== null;
  const active = offered && mode === 'both' && otherSide === 'beside';
  // The gate's rule (`checkPlan`): asked for, the transcription unit cannot, and another unit translates.
  const refused = !offered && mode === 'both' && otherSide === 'beside' && transcription !== null && translation !== null
    && translation.unit !== transcription.unit && !transcription.capabilities.faceToFace;
  // The routing's own rule (`readRouting`): the same `present` set and default device, so a centred pick whose device is unplugged reads as auto here too.
  const present = new Set(devices.filter((d) => !d.isVirtual).map((d) => d.deviceId));
  const earOf = (name: 'other' | 'them'): Ear | undefined => {
    const { pan } = resolveOutlet(name, outlets[name], { defaultDevice: defaultDevice?.deviceId, present, faceToFace: active });
    return pan === -1 ? 'left' : pan === 1 ? 'right' : undefined;
  };
  const otherEar = earOf('other');
  const themEar = earOf('them');
  const ears: Partial<Record<LegName, Ear>> = {
    ...(otherEar ? { speaker: otherEar } : {}),
    ...(themEar ? { participant: themEar } : {}),
  };
  const labelOf = (name: 'other' | 'them'): string | null => {
    const own = outlets[name].device ? devices.find((d) => d.deviceId === outlets[name].device) : undefined;
    return own?.label ?? defaultDevice?.label ?? null;
  };
  // A run decided at Start whether the participant leg speaks; one that does follows the switch live (#595).
  const runSpeech = useRunParticipantSpeech();
  // Before the plan is ready, as an optional-speech provider would answer (`speechFromStores`'s own default).
  const speak = speechFromStores(speechUnit?.capabilities ?? { speech: 'optional' });
  return {
    offered,
    active,
    refused,
    me: pair?.source ?? null,
    other: pair?.target ?? null,
    speaks: { speaker: speak.other, participant: runSpeech !== false && speak.them },
    ears,
    outletDevices: { other: labelOf('other'), them: labelOf('them') },
  };
}

export interface EarsLegendEntry { who: 'me' | 'other'; lang: string; ear?: Ear; device: string | null }

/** The footer's ears strip: one entry per voiced leg — who, their language, the ear when the outlet has one, the device. The left ear first; otherwise me first. */
export function earsLegend(view: FaceToFaceView): EarsLegendEntry[] | null {
  if (!view.active || !view.me || !view.other) return null;
  const entries: EarsLegendEntry[] = [];
  // My ear is where the participant leg's translation (into my language) plays; theirs, the speaker leg's.
  if (view.speaks.participant) entries.push({ who: 'me', lang: view.me, ...(view.ears.participant ? { ear: view.ears.participant } : {}), device: view.outletDevices.them });
  if (view.speaks.speaker) entries.push({ who: 'other', lang: view.other, ...(view.ears.speaker ? { ear: view.ears.speaker } : {}), device: view.outletDevices.other });
  if (entries.length === 0) return null;
  const rank = (e: EarsLegendEntry) => (e.ear === 'left' ? 0 : e.ear === 'right' ? 2 : 1);
  return entries.sort((a, b) => rank(a) - rank(b));
}

/** The conversation's ear tags: every voiced leg has an entry, its ear when the outlet is panned and 'centre' when it is not; a silent leg has none. */
export function voicedEars(view: FaceToFaceView): Partial<Record<LegName, Ear | 'centre'>> | null {
  if (!view.active || (!view.speaks.speaker && !view.speaks.participant)) return null;
  return {
    ...(view.speaks.speaker ? { speaker: view.ears.speaker ?? 'centre' } : {}),
    ...(view.speaks.participant ? { participant: view.ears.participant ?? 'centre' } : {}),
  };
}

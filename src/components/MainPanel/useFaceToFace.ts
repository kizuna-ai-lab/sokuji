import { resolveOutlet } from '../../lib/audio/outlets';
import type { LegName } from '../../lib/conversation/types';
import { speechFromStores } from '../../lib/session/appShape';
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

/** One ear of a stereo device. */
export type Ear = 'left' | 'right';

export interface FaceToFaceView {
  /** The selected provider can run face-to-face: the Both popover offers "beside me". */
  offered: boolean;
  /** Face-to-face is on: Both, beside me, under a provider that offers it (`faceToFaceFromStores`'s rule, live). */
  active: boolean;
  /** The ear each leg's translation plays in; absent when its outlet is centred. speaker → `other`, participant → `them`. */
  ears: Readonly<Partial<Record<LegName, Ear>>>;
  /** The resolved device label of each face-to-face outlet; null when none is known. */
  outletDevices: Readonly<Record<'other' | 'them', string | null>>;
  /** My language and theirs: the selected entry's pair. */
  me: string | null;
  other: string | null;
  /** Whether each leg's translation is voiced in a run started now: `speakFor`'s `other` and `them`. */
  speaks: Readonly<Record<LegName, boolean>>;
}

/** `faceToFaceFromStores`'s rule as a hook: the same provider fallback and the same loaded-entry requirement as `selectedFromStores`. */
export function useFaceToFace(): FaceToFaceView {
  const selected = useProviderStore((s) => s.selected);
  const entries = useProviderStore((s) => s.entries);
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
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const pair = provider ? entries[provider.id]?.pair ?? null : null;
  const offered = provider?.faceToFace === true && pair !== null;
  const active = offered && mode === 'both' && otherSide === 'beside';
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
  const speak = speechFromStores(provider);
  return {
    offered,
    active,
    me: pair?.source ?? null,
    other: pair?.target ?? null,
    speaks: { speaker: speak.other, participant: speak.them },
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

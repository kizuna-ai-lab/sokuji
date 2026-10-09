import { resolveChannel } from '../../lib/audio/outlets';
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
  /** The other person's ear is the left one: their outlet's channel resolved (an auto channel puts them right). */
  swap: boolean;
  /** The ear each leg's translation plays in: mine on the `other` outlet, theirs on `them`. A centred outlet counts as the right ear here (face-to-face's auto never is). */
  ears: Record<LegName, Ear>;
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
  // The rest of what `speechFromStores` reads, subscribed so `speaks` follows the switches and the source.
  useSettingsStore((s) => s.textOnly);
  useRoutingStore((s) => s.participantSpeech);
  useAudioStore((s) => s.isMonitorMuted);
  useAudioStore((s) => s.selectedParticipantSource?.deviceId);
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const pair = provider ? entries[provider.id]?.pair ?? null : null;
  const offered = provider?.faceToFace === true && pair !== null;
  const active = offered && mode === 'both' && otherSide === 'beside';
  const earOf = (channel: 'both' | 'left' | 'right'): Ear => (channel === 'left' ? 'left' : 'right');
  const ears: Record<LegName, Ear> = {
    speaker: earOf(resolveChannel('other', outlets.other.channel, active)),
    participant: earOf(resolveChannel('them', outlets.them.channel, active)),
  };
  const speak = speechFromStores(provider);
  return {
    offered,
    active,
    swap: ears.participant === 'right',
    ears,
    me: pair?.source ?? null,
    other: pair?.target ?? null,
    speaks: { speaker: speak.other, participant: speak.them },
  };
}

/**
 * The footer's ears legend: which language plays in each ear, whether the left is mine, and the
 * ear nothing plays in when one leg is silent (Kizuna Soniox's participant today). Absent when
 * nothing plays in an ear: not face-to-face, or Text Only.
 */
export function earsLegend(view: FaceToFaceView): { leftLang: string; rightLang: string; leftIsMe: boolean; silent?: Ear } | null {
  if (!view.active || !view.me || !view.other) return null;
  if (!view.speaks.speaker && !view.speaks.participant) return null;
  const ears = view.ears;
  // My ear is where the participant leg's translation (into my language) plays.
  const leftIsMe = ears.participant === 'left';
  const silent = !view.speaks.participant ? ears.participant : !view.speaks.speaker ? ears.speaker : undefined;
  return {
    leftLang: leftIsMe ? view.me : view.other,
    rightLang: leftIsMe ? view.other : view.me,
    leftIsMe,
    ...(silent ? { silent } : {}),
  };
}

/** The conversation's ear tags: the ear each voiced leg's translation plays in. A silent leg has none. Absent outside face-to-face, or when no leg is voiced. */
export function voicedEars(view: FaceToFaceView): Partial<Record<LegName, Ear>> | null {
  if (!view.active || (!view.speaks.speaker && !view.speaks.participant)) return null;
  const ears = view.ears;
  return {
    ...(view.speaks.speaker ? { speaker: ears.speaker } : {}),
    ...(view.speaks.participant ? { participant: ears.participant } : {}),
  };
}

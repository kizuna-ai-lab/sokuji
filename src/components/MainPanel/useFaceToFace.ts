import { earsFor, type Ear } from '../../lib/audio/routes';
import type { LegName } from '../../lib/conversation/types';
import { participantSpeechFromStores } from '../../lib/session/appShape';
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

export interface FaceToFaceView {
  /** The selected provider can run face-to-face: the Both popover offers "beside me". */
  offered: boolean;
  /** Face-to-face is on: Both, beside me, under a provider that offers it (`faceToFaceFromStores`'s rule, live). */
  active: boolean;
  /** My translation goes right, theirs left. */
  swap: boolean;
  /** My language and theirs: the selected entry's pair. */
  me: string | null;
  other: string | null;
  /**
   * Whether each leg's translation is voiced in a run started now, in any
   * mode: the participant's by the run's own rule (`participantSpeechFromStores`:
   * its provider's flag, then Text Only face-to-face, its switch elsewhere),
   * mine unless Text Only. The replay slots, the ear tags, the strip and the
   * popover's ears all read it, so none offers an ear that plays nothing.
   */
  speaks: Readonly<Record<LegName, boolean>>;
}

/** `faceToFaceFromStores`'s rule as a hook: the same provider fallback and the same loaded-entry requirement as `selectedFromStores`. */
export function useFaceToFace(): FaceToFaceView {
  const selected = useProviderStore((s) => s.selected);
  const entries = useProviderStore((s) => s.entries);
  const mode = useAudioStore((s) => s.mode);
  const otherSide = useAudioStore((s) => s.otherSide);
  const swap = useRoutingStore((s) => s.faceToFaceSwap);
  const textOnly = useSettingsStore((s) => s.textOnly);
  // The rest of what `participantSpeechFromStores` reads, subscribed so `speaks` follows the switch and the source.
  useRoutingStore((s) => s.participantSpeech);
  useAudioStore((s) => s.selectedParticipantSource?.deviceId);
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const pair = provider ? entries[provider.id]?.pair ?? null : null;
  const offered = provider?.faceToFace === true && pair !== null;
  return {
    offered,
    active: offered && mode === 'both' && otherSide === 'beside',
    swap,
    me: pair?.source ?? null,
    other: pair?.target ?? null,
    speaks: { speaker: !textOnly, participant: provider ? participantSpeechFromStores(provider) : false },
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
  const ears = earsFor(view.swap);
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
  const ears = earsFor(view.swap);
  return {
    ...(view.speaks.speaker ? { speaker: ears.speaker } : {}),
    ...(view.speaks.participant ? { participant: ears.participant } : {}),
  };
}

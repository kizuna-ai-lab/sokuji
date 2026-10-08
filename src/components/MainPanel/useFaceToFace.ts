import { earsFor } from '../../lib/audio/routes';
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';

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
}

/** `faceToFaceFromStores`'s rule as a hook: the same provider fallback and the same loaded-entry requirement as `selectedFromStores`. */
export function useFaceToFace(): FaceToFaceView {
  const selected = useProviderStore((s) => s.selected);
  const entries = useProviderStore((s) => s.entries);
  const mode = useAudioStore((s) => s.mode);
  const otherSide = useAudioStore((s) => s.otherSide);
  const swap = useRoutingStore((s) => s.faceToFaceSwap);
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
  };
}

/** The footer's ears legend: which language plays in each ear, and whether the left is mine. Absent when nothing plays in an ear: not face-to-face, or Text Only. */
export function earsLegend(view: FaceToFaceView, textOnly: boolean): { leftLang: string; rightLang: string; leftIsMe: boolean } | null {
  if (!view.active || textOnly || !view.me || !view.other) return null;
  // My ear is where the participant leg's translation (into my language) plays.
  const leftIsMe = earsFor(view.swap).participant === 'left';
  return {
    leftLang: leftIsMe ? view.me : view.other,
    rightLang: leftIsMe ? view.other : view.me,
    leftIsMe,
  };
}

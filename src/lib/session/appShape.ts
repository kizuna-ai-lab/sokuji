/**
 * The one place a runner reads the stores (plan 1c-1 Global Constraints):
 * `readShapeFromStores` freezes a shape at start, and `persistIfUnchanged`
 * writes a `prepare` patch back without overwriting a change the user made
 * during the run.
 */
import type { Speak } from '../audio/outlets';
import type { LegName } from '../conversation/types';
import { participantSpeechHeard } from '../modern-audio/participantSource';
import { reversedPair } from '../provider/languages';
import type { AnyProvider, AuthContext, Platform, Readiness } from '../provider/types';
import { presentProviders } from '../../providers/registry';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore, { type AudioMode } from '../../stores/audioStore';
import { useProviderStore, type ProviderEntry } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useRoutingStore } from '../../stores/routingStore';
import { getEnvironment } from '../../utils/environment';
import { buildSharedSettings } from './shared';
import { gate, participantSpeechInput, speakFor, type Refusal, type SpeechInputs } from './shape';
import type { RunShape } from './types';

export function legsFor(mode: 'speaker' | 'participant' | 'both'): LegName[] {
  return mode === 'both' ? ['speaker', 'participant'] : [mode];
}

/** The provider a start would run and its loaded entry, as `readShapeFromStores` finds them; null until the entry has loaded. */
export function selectedFromStores(): { provider: AnyProvider; entry: ProviderEntry } | null {
  const { selected, entries } = useProviderStore.getState();
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const entry = provider ? entries[provider.id] : undefined;
  return provider && entry ? { provider, entry } : null;
}

/**
 * Face-to-face (spec 2026-10-08, slice 3): Both, the other side beside me,
 * under a provider that offers it. The one predicate the run's shape, the
 * capture, the routing and every surface read, so they never disagree; a
 * stored "beside me" under a provider without it is ordinary Both.
 */
export function faceToFaceFromStores(): boolean {
  const { mode, otherSide } = useAudioStore.getState();
  return isFaceToFace(selectedFromStores()?.provider, mode, otherSide);
}

/** `faceToFaceFromStores`' rule over given values, for a surface that subscribes to them. */
export function isFaceToFace(provider: { faceToFace?: boolean } | undefined, mode: AudioMode, otherSide: string): boolean {
  return provider?.faceToFace === true && mode === 'both' && otherSide === 'beside';
}

/**
 * `participantSpeechHeard` over the stores, and the capture's own word: the
 * other's translation, played to me, is not recaptured by the participant
 * source. An application capture that widened to the whole system mid-run
 * (`audioStore`'s `participantCaptureWidened`) recaptures it, whatever the
 * chosen source says.
 */
export function heardFromStores(faceToFace: boolean): boolean {
  const audio = useAudioStore.getState();
  return participantSpeechHeard(getEnvironment(), audio.selectedParticipantSource?.deviceId, faceToFace) && !audio.participantCaptureWidened;
}

/**
 * Who hears what, as the stores stand (spec 2026-10-10 §4): the selected
 * provider's flags over the switches, the mode, face-to-face and the
 * recapture rule. The run's shape, the live gate's floor, the account
 * button's floor, the routing and every surface read it, so they price
 * and play the same legs. Before a provider has loaded it answers as an
 * optional-speech provider would.
 */
export function speechFromStores(provider: Pick<AnyProvider, 'speech' | 'participantSpeech'> | undefined = selectedFromStores()?.provider): Speak {
  const audio = useAudioStore.getState();
  const faceToFace = faceToFaceFromStores();
  return speakFor(provider ?? { speech: 'optional' }, {
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: useRoutingStore.getState().participantSpeech,
    isMonitorMuted: audio.isMonitorMuted,
    legs: legsFor(audio.mode),
    faceToFace,
    heard: heardFromStores(faceToFace),
  });
}

/**
 * Whether a run would speak, besides its legs and its provider, as the
 * stores stand: the text-only switch and the participant's speech (the
 * provider's own flag is `languageContext`'s to apply). The provider store
 * keeps it for the language offer (Stage 2 Volcengine AST2, choice 1).
 */
export function speechInputsFromStores(): SpeechInputs {
  const faceToFace = faceToFaceFromStores();
  return {
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: participantSpeechInput({ participantSpeech: useRoutingStore.getState().participantSpeech, faceToFace, heard: heardFromStores(faceToFace) }),
  };
}

/** Keeps the provider store's speech inputs on the stores', now and on every change, so each provider's pair is one its run could start. Returns the unsubscribe. */
export function watchSpeechFromStores(): () => void {
  const apply = () => useProviderStore.getState().setSpeech(speechInputsFromStores());
  apply();
  // Whole-store listeners: `setSpeech` ignores inputs that did not change.
  // A provider change, or its entry landing after the pick, can turn
  // face-to-face on or off.
  const offs = [
    useSettingsStore.subscribe(apply),
    useRoutingStore.subscribe(apply),
    useAudioStore.subscribe(apply),
    useProviderStore.subscribe(apply),
  ];
  return () => { for (const off of offs) off(); };
}

export function readShapeFromStores(auth: AuthContext): RunShape | null {
  const selected = selectedFromStores();
  if (!selected) return null;
  const { provider, entry } = selected;
  const st = useSettingsStore.getState();
  const faceToFace = faceToFaceFromStores();
  return {
    provider,
    settings: entry.settings,
    credentials: entry.credentials,
    pair: entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: st.textOnly,
    participantSpeech: speechFromStores(provider).them,
    faceToFace,
    keepReplayAudio: st.keepReplayAudio,
    shared: buildSharedSettings(
      reversedPair(provider, entry.settings, entry.pair),
      { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
      { mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences },
      faceToFace,
    ),
    auth,
    account: useAccountStore.getState().account,
  };
}

/**
 * The start gate over the stores as they stand (F7): what a start would be
 * refused before anything is checked — no leg, a turn mode the provider
 * does not offer, the participant leg on the web or for a pair that does
 * not reverse (D20), and a managed provider's wallet still loading,
 * unknown, frozen or below its floor. The surfaces keep Start off and show
 * why; the runner still gates the frozen shape at start. Null when nothing
 * is refused, or before the provider's entry has loaded (`providerLoaded`
 * keeps Start off then).
 */
export function liveGate(platform: Platform = getEnvironment()): Refusal | null {
  const selected = selectedFromStores();
  if (!selected) return null;
  return gate({
    provider: selected.provider,
    settings: selected.entry.settings,
    pair: selected.entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: speechFromStores(selected.provider).them,
    faceToFace: faceToFaceFromStores(),
    account: useAccountStore.getState().account,
  }, platform);
}

/** The runner's `ensureReady` in the app: the shape's own inputs, through the provider store's cache. */
export function ensureReadyFromStores(shape: RunShape, signal: AbortSignal): Promise<Readiness> {
  return useProviderStore.getState().refreshReadiness(
    shape.provider, shape.auth,
    { settings: shape.settings, credentials: shape.credentials, pair: shape.pair, legs: shape.legs },
    signal,
  );
}

/** Keeps the provider store's `legs` on the audio mode's, now and on every change, so the panel's readiness is about the legs a start would open. Returns the unsubscribe. */
export function watchLegsFromStores(): () => void {
  const apply = (mode: AudioMode) => useProviderStore.getState().setLegs(legsFor(mode));
  apply(useAudioStore.getState().mode);
  return useAudioStore.subscribe((s) => s.mode, apply);
}

/** `keepReplayAudio`, live from the settings store: the runner's `replayAudio`. */
export const appReplayAudio = {
  get: () => useSettingsStore.getState().keepReplayAudio,
  subscribe: (listener: () => void) => useSettingsStore.subscribe((now, before) => {
    if (now.keepReplayAudio !== before.keepReplayAudio) listener();
  }),
};

export function persistIfUnchanged(p: AnyProvider, snapshot: unknown, patch: Readonly<Record<string, unknown>>): void {
  const entry = useProviderStore.getState().entries[p.id];
  if (!entry) return;
  const now = entry.settings as Record<string, unknown>;
  const then = snapshot as Record<string, unknown>;
  const unchanged = Object.fromEntries(Object.entries(patch).filter(([field]) => Object.is(now[field], then[field])));
  if (Object.keys(unchanged).length > 0) useProviderStore.getState().updateSettings(p, unchanged);
}

/**
 * The one place a runner reads the stores (plan 1c-1 Global Constraints):
 * `readShapeFromStores` freezes a shape at start, and `persistIfUnchanged`
 * writes a `prepare` patch back without overwriting a change the user made
 * during the run.
 */
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
import { gate, type Refusal, type SpeechInputs } from './shape';
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
 * Whether the participant leg would speak, as the stores stand: its
 * provider's flag on (Stage 2 Kizuna Soniox, ruling 2), its switch on,
 * and — 1e-3b-2 ruling 7, completed — its source not a whole-system
 * capture on Electron that would recapture it and translate it again as
 * Other: the same predicate `readRouting` and the switch itself use. The
 * run's shape, the live gate's floor and the account button's floor all
 * read it, so they price the same legs.
 */
export function participantSpeechFromStores(provider: Pick<AnyProvider, 'participantSpeech'>): boolean {
  return provider.participantSpeech !== false && participantSpeechSwitchFromStores();
}

/** The participant's speech before its provider's flag: its switch on, and a source that will not recapture it. */
export function participantSpeechSwitchFromStores(): boolean {
  return useRoutingStore.getState().participantSpeech
    && participantSpeechHeard(getEnvironment(), useAudioStore.getState().selectedParticipantSource?.deviceId);
}

/**
 * Whether a run would speak, besides its legs and its provider, as the
 * stores stand: the text-only switch and the participant's speech (the
 * provider's own flag is `languageContext`'s to apply). The provider store
 * keeps it for the language offer (Stage 2 Volcengine AST2, choice 1).
 */
export function speechInputsFromStores(): SpeechInputs {
  return { textOnly: useSettingsStore.getState().textOnly, transcriptionOnly: useSettingsStore.getState().transcriptionOnly, participantSpeech: participantSpeechSwitchFromStores() };
}

/** Keeps the provider store's speech inputs on the stores', now and on every change, so each provider's pair is one its run could start. Returns the unsubscribe. */
export function watchSpeechFromStores(): () => void {
  const apply = () => useProviderStore.getState().setSpeech(speechInputsFromStores());
  apply();
  // Whole-store listeners: `setSpeech` ignores inputs that did not change.
  const offs = [useSettingsStore.subscribe(apply), useRoutingStore.subscribe(apply), useAudioStore.subscribe(apply)];
  return () => { for (const off of offs) off(); };
}

export function readShapeFromStores(auth: AuthContext): RunShape | null {
  const selected = selectedFromStores();
  if (!selected) return null;
  const { provider, entry } = selected;
  const st = useSettingsStore.getState();
  return {
    provider,
    settings: entry.settings,
    credentials: entry.credentials,
    pair: entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: st.textOnly,
    transcriptionOnly: st.transcriptionOnly,
    participantSpeech: participantSpeechFromStores(provider),
    keepReplayAudio: st.keepReplayAudio,
    shared: buildSharedSettings(
      reversedPair(provider, entry.settings, entry.pair),
      { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
      { mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences },
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
    participantSpeech: participantSpeechFromStores(selected.provider),
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

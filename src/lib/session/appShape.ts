/**
 * The one place a runner reads the stores (plan 1c-1 Global Constraints):
 * `readShapeFromStores` freezes a shape at start, and `persistIfUnchanged`
 * writes a `prepare` patch back without overwriting a change the user made
 * during the run.
 */
import type { LegName } from '../conversation/types';
import { participantSpeechHeard } from '../modern-audio/participantSource';
import type { AnyProvider, AuthContext, Readiness } from '../provider/types';
import { presentProviders } from '../../providers/registry';
import useAudioStore, { type AudioMode } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useRoutingStore } from '../../stores/routingStore';
import { getEnvironment } from '../../utils/environment';
import { buildSharedSettings } from './shared';
import type { RunShape } from './types';

export function legsFor(mode: 'speaker' | 'participant' | 'both'): LegName[] {
  return mode === 'both' ? ['speaker', 'participant'] : [mode];
}

export function readShapeFromStores(auth: AuthContext): RunShape | null {
  const { selected, entries } = useProviderStore.getState();
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const entry = provider ? entries[provider.id] : undefined;
  if (!provider || !entry) return null;
  const st = useSettingsStore.getState();
  return {
    provider,
    settings: entry.settings,
    credentials: entry.credentials,
    pair: entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: st.textOnly,
    // 1e-3b-2 ruling 7, completed: the run must not ask the participant leg to
    // speak when the switch shows it off (a whole-system participant capture
    // on Electron would recapture it and translate it again as Other) — the
    // same predicate `readRouting` and the switch itself use.
    participantSpeech: useRoutingStore.getState().participantSpeech
      && participantSpeechHeard(getEnvironment(), useAudioStore.getState().selectedParticipantSource?.deviceId),
    keepReplayAudio: st.keepReplayAudio,
    shared: buildSharedSettings(
      provider,
      entry.settings,
      entry.pair,
      {
        useTemplateMode: st.useTemplateMode,
        templateSystemInstructions: st.templateSystemInstructions,
        systemInstructions: st.systemInstructions,
        participantSystemInstructions: st.participantSystemInstructions,
      },
      { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
      { mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences },
    ),
    auth,
  };
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

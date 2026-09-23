/**
 * The one place a runner reads the stores (plan 1c-1 Global Constraints):
 * `readShapeFromStores` freezes a shape at start, and `persistIfUnchanged`
 * writes a `prepare` patch back without overwriting a change the user made
 * during the run.
 */
import type { LegName } from '../conversation/types';
import type { AnyProvider, AuthContext } from '../provider/types';
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
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
    // The participant-TTS switch arrives with plan 1c-2's routing.
    participantSpeech: false,
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
    ),
    auth,
  };
}

export function persistIfUnchanged(p: AnyProvider, snapshot: unknown, patch: Readonly<Record<string, unknown>>): void {
  const entry = useProviderStore.getState().entries[p.id];
  if (!entry) return;
  const now = entry.settings as Record<string, unknown>;
  const then = snapshot as Record<string, unknown>;
  const unchanged = Object.fromEntries(Object.entries(patch).filter(([field]) => Object.is(now[field], then[field])));
  if (Object.keys(unchanged).length > 0) useProviderStore.getState().updateSettings(p, unchanged);
}

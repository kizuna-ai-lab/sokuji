/**
 * The app's subtitle session, live from the runner, the conversation view and
 * three stores (the selected provider's readiness and pair, the turn mode,
 * and the audio store's mode and chosen microphone for the microphone gate).
 * The only module under `src/lib/subtitle` that reads a store.
 */
import { describeCause, reportError } from '../diagnostics/report';
import { legsFor } from '../session/appShape';
import type { Runner } from '../session/runner';
import { microphoneMissing } from '../session/shape';
import type { ConversationViewState, Readable } from '../view/conversationView';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { sameSession, subtitleSession, type SubtitleSession } from './session';

export function appSubtitleSession(
  runner: Pick<Runner, 'state'>,
  view: Readable<ConversationViewState>,
  options: {
    /** Whether a start needs a chosen microphone: the app's capture does; a fake source does not. Default: never. */
    microphoneRequired?(): boolean;
  } = {},
): Readable<SubtitleSession> & { dispose(): void } {
  const read = (): SubtitleSession => {
    const providers = useProviderStore.getState();
    const id = providers.selected;
    const audio = useAudioStore.getState();
    // The display-mode buttons follow the audio mode's intent as well as the
    // conversation on screen: before the first run, and after the mode
    // changed (roadmap 1d-2 → 1e; today's `effectiveMode || items` rule).
    const intent = legsFor(audio.mode);
    const shown = view.get().legs.map((leg) => leg.leg);
    return subtitleSession({
      run: runner.state.getState(),
      readiness: id ? providers.readiness[id] : undefined,
      pair: id ? providers.entries[id]?.pair ?? null : null,
      turnMode: useTurnModeStore.getState().turnMode,
      legs: (['speaker', 'participant'] as const).filter((leg) => intent.includes(leg) || shown.includes(leg)),
      microphoneMissing: (options.microphoneRequired?.() ?? false) && microphoneMissing(intent, audio.selectedInputDevice?.deviceId),
      providerLoaded: !!(id && providers.entries[id]),
    });
  };
  let state = read();
  const listeners = new Set<() => void>();
  const update = () => {
    const next = read();
    if (sameSession(next, state)) return;
    state = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('SubtitleSession', `A session subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-session-subscriber' });
      }
    }
  };
  const offs = [runner.state.subscribe(update), useProviderStore.subscribe(update), useTurnModeStore.subscribe(update), useAudioStore.subscribe(update), view.subscribe(update)];
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      offs.forEach((off) => off());
      listeners.clear();
    },
  };
}

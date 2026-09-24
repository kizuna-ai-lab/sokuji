/**
 * The app's subtitle session, live from the runner, the conversation view and
 * two stores (the selected provider's readiness and pair, the turn mode). The
 * only module under `src/lib/subtitle` that reads a store.
 */
import { describeCause, reportError } from '../diagnostics/report';
import type { Runner } from '../session/runner';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { sameSession, subtitleSession, type SubtitleSession } from './session';

export function appSubtitleSession(
  runner: Pick<Runner, 'state'>,
  view: Readable<ConversationViewState>,
): Readable<SubtitleSession> & { dispose(): void } {
  const read = (): SubtitleSession => {
    const providers = useProviderStore.getState();
    const id = providers.selected;
    return subtitleSession({
      run: runner.state.getState(),
      readiness: id ? providers.readiness[id] : undefined,
      pair: id ? providers.entries[id]?.pair ?? null : null,
      turnMode: useTurnModeStore.getState().turnMode,
      legs: view.get().legs.map((leg) => leg.leg),
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
  const offs = [runner.state.subscribe(update), useProviderStore.subscribe(update), useTurnModeStore.subscribe(update), view.subscribe(update)];
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

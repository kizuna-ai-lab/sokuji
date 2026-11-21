/**
 * The app's subtitle session, live from the runner, the conversation view and
 * several stores (the plan's readiness and pair, the turn mode,
 * the audio store's mode and chosen microphone for the microphone gate, and
 * the account's wallet, the text-only switch and the participant-speech
 * switch, for the balance floor), and the start gate over them (F7).
 * The only module under `src/lib/subtitle` that reads a store.
 */
import { describeCause, reportError } from '../diagnostics/report';
import { planFromStores, subscribePlan } from '../plan/fromStores';
import { providersIn, transcriptionAccount, transcriptionProvider } from '../plan/read';
import { legsFor, liveGate } from '../session/appShape';
import type { Runner } from '../session/runner';
import { microphoneMissing } from '../session/shape';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { subscribeUseOwnBalance } from '../session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
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
    // The plan a start would run: ready once the line-up has loaded and every provider of the plan has its entry.
    // Its pair is the transcription provider's.
    const found = planFromStores();
    const id = found.state === 'ready' ? transcriptionProvider(found.plan).id : undefined;
    const pair = found.state === 'ready' ? transcriptionAccount(found).pair : null;
    // Start needs every provider of the plan ready: the readiness the gate reads is the first one not ready (its
    // reason shown before a check under way), else the transcription provider's.
    const all = useProviderStore.getState().readiness;
    const each = found.state === 'ready' ? providersIn(found.plan).map((p) => all[p.id]) : [];
    const readiness = each.find((r) => r?.state === 'not-ready') ?? each.find((r) => r?.state === 'checking') ?? (id ? all[id] : undefined);
    const audio = useAudioStore.getState();
    // The display-mode buttons follow the audio mode's intent as well as the
    // conversation on screen: before the first run, and after the mode
    // changed (roadmap 1d-2 → 1e; today's `effectiveMode || items` rule).
    const intent = legsFor(audio.mode);
    const shown = view.get().legs.map((leg) => leg.leg);
    return subtitleSession({
      run: runner.state.getState(),
      readiness,
      pair,
      turnMode: useTurnModeStore.getState().turnMode,
      legs: (['speaker', 'participant'] as const).filter((leg) => intent.includes(leg) || shown.includes(leg)),
      microphoneMissing: (options.microphoneRequired?.() ?? false) && microphoneMissing(intent, audio.selectedInputDevice?.deviceId),
      providerLoaded: found.state === 'ready',
      refusal: liveGate(),
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
  const offs = [
    runner.state.subscribe(update),
    // The plan's two stores: the line-up, and the provider store (its entries and their readiness).
    subscribePlan(update),
    useTurnModeStore.subscribe(update),
    useAudioStore.subscribe(update),
    view.subscribe(update),
    useAccountStore.subscribe(update),
    // The payer switch moves the wallet the gate checks.
    subscribeUseOwnBalance(update),
    useSettingsStore.subscribe((s) => s.textOnly, update),
    // A plain store (no subscribeWithSelector): fires on every change of it,
    // but `update` compares the computed session before it notifies its own
    // listeners, so an unrelated change here still costs nothing downstream.
    useRoutingStore.subscribe(update),
  ];
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

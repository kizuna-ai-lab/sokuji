// src/app/captionShare.ts
/**
 * The host side's controller for LAN caption sharing (spec 2026-10-04
 * §3.1, §7): starts and stops the main-process server, keeps the share
 * publisher alive while it runs, and folds the pushed status into the
 * store. Analytics are tracked by the panel, which can use React hooks.
 */
import type { Entry } from '../lib/projection/types';
import type { ConversationResetReason } from '../lib/session/conversationSet';
import type { RunState } from '../lib/session/types';
import type { Readable } from '../lib/view/conversationView';
import { describeCause, reportError } from '../lib/diagnostics/report';
import { startSharePublisher, type SharePort } from '../lib/share/publisher';
import type { ShareState, ShareStatus } from '../lib/share/types';
import { useCaptionShareStore, type ShareError, type WifiHintState } from '../stores/captionShareStore';
import { useProviderStore } from '../stores/providerStore';
import useSettingsStore from '../stores/settingsStore';
import { getAppSession } from './session';

export interface CaptionShareIpc {
  invoke(channel: string, data?: unknown): Promise<unknown>;
  receive?(channel: string, fn: (...args: unknown[]) => void): void;
}

export interface CaptionShareDeps {
  ipc: CaptionShareIpc;
  view: Readable<{ entries: readonly Entry[] }>;
  onReset(listener: (reason: ConversationResetReason) => void): () => void;
  runState: { getState(): RunState; subscribe(listener: () => void): () => void };
  pair: { get(): { source: string; target: string } | null; subscribe(listener: () => void): () => void };
  store: typeof useCaptionShareStore;
  /** Sokuji's UI language (a catalog id such as `zh_CN`): the present window's OS locale may differ. */
  uiLanguage(): string;
  now(): number;
}

export interface CaptionShareController {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  selectAddress(address: string): Promise<void>;
  setAllowSave(allow: boolean): void;
  setWifiHint(patch: Partial<WifiHintState>): void;
  openPresent(): Promise<void>;
}

type StartResult = ShareStatus | { error: ShareError['code']; reason?: string };

export function createCaptionShareController(deps: CaptionShareDeps): CaptionShareController {
  let stopPublisher: (() => void) | null = null;
  let listening = false;

  const shareState = (): ShareState => ({
    phase: deps.runState.getState().phase === 'running' ? 'live' : 'idle',
    pair: deps.pair.get() ?? { source: '', target: '' },
    allowSave: deps.store.getState().allowSave,
  });
  const stateSource: Readable<ShareState> = {
    get: shareState,
    subscribe(listener) {
      const offs = [deps.runState.subscribe(listener), deps.pair.subscribe(listener), deps.store.subscribe(listener)];
      return () => { for (const off of offs) off(); };
    },
  };
  const port: SharePort = {
    patch: (diff) => deps.ipc.invoke('caption-share:patch', diff),
    clear: (reason) => deps.ipc.invoke('caption-share:clear', { reason }),
    state: (state) => deps.ipc.invoke('caption-share:state', state),
  };

  const beginPublisher = () => {
    stopPublisher = startSharePublisher({ view: deps.view, state: stateSource, onReset: deps.onReset }, port);
  };
  const endPublisher = () => {
    stopPublisher?.();
    stopPublisher = null;
  };

  const listen = () => {
    if (listening || !deps.ipc.receive) return;
    listening = true;
    deps.ipc.receive('caption-share:status', (status) => {
      const next = status as ShareStatus;
      if (!next.running) {
        endPublisher();
        deps.store.getState().markStopped();
        return;
      }
      deps.store.getState().setStatus(next);
    });
  };

  const pushWifi = async () => {
    if (!deps.store.getState().status.running) return;
    const hint = deps.store.getState().wifiHint;
    const wifi = hint.enabled && hint.ssid.trim() !== '' ? { ssid: hint.ssid.trim(), password: hint.password } : null;
    try {
      await deps.ipc.invoke('caption-share:set-wifi', { wifi });
    } catch (error) {
      reportError('CaptionShare', `Updating the Wi-Fi hint failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:wifi' });
    }
  };

  return {
    async start() {
      const store = deps.store.getState();
      if (store.busy || store.status.running) return store.status.running;
      listen();
      store.setBusy(true);
      store.setError(null);
      try {
        const result = (await deps.ipc.invoke('caption-share:start', shareState())) as StartResult;
        if ('error' in result) {
          reportError('CaptionShare', `Caption sharing could not start: ${result.error}`, { dedupeKey: 'caption-share:start' });
          deps.store.getState().setError({ code: result.error, reason: result.reason ?? '' });
          return false;
        }
        deps.store.getState().markStarted(deps.now(), result);
        beginPublisher();
        await pushWifi();
        return true;
      } catch (error) {
        reportError('CaptionShare', `Starting caption sharing failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:start' });
        deps.store.getState().setError({ code: 'listen-failed', reason: describeCause(error) });
        return false;
      } finally {
        deps.store.getState().setBusy(false);
      }
    },
    async stop() {
      // No new lines leave once the host asks to stop.
      endPublisher();
      try {
        await deps.ipc.invoke('caption-share:stop');
      } catch (error) {
        // The server may still be serving: the panel keeps saying so (the host
        // can stop again), and viewers keep getting the conversation as it is.
        reportError('CaptionShare', `Stopping caption sharing failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:stop' });
        if (deps.store.getState().status.running) beginPublisher();
        return;
      }
      deps.store.getState().markStopped();
    },
    async selectAddress(address) {
      try {
        const status = (await deps.ipc.invoke('caption-share:select-address', { address })) as ShareStatus;
        if (status) deps.store.getState().setStatus(status);
      } catch (error) {
        reportError('CaptionShare', `Choosing the share address failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:select' });
      }
    },
    setAllowSave(allow) {
      deps.store.getState().setAllowSave(allow);
    },
    setWifiHint(patch) {
      deps.store.getState().setWifiHint(patch);
      void pushWifi();
    },
    async openPresent() {
      try {
        await deps.ipc.invoke('caption-share:present', { lang: deps.uiLanguage() });
      } catch (error) {
        reportError('CaptionShare', `Opening the projector page failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:present' });
      }
    },
  };
}

/**
 * The pair viewers are told about: the selected provider's, which the
 * surfaces show and a run starts with (as `appSubtitleSession` reads it), not
 * the raw pick (`intent`), which is null until the host picks and may name a
 * language the provider does not offer.
 */
export const sharedPair: CaptionShareDeps['pair'] = {
  get: () => {
    const providers = useProviderStore.getState();
    const id = providers.selected;
    return id ? providers.entries[id]?.pair ?? null : null;
  },
  subscribe: (listener) => useProviderStore.subscribe(() => listener()),
};

let controller: CaptionShareController | null = null;

/** The page's one controller, over the app session and window.electron (desktop only). */
export function getCaptionShareController(): CaptionShareController {
  if (!controller) {
    const session = getAppSession();
    controller = createCaptionShareController({
      ipc: window.electron,
      view: session.view,
      onReset: (listener) => session.runner.conversation.onReset(listener),
      runState: { getState: () => session.runner.state.getState(), subscribe: (listener) => session.runner.state.subscribe(() => listener()) },
      pair: sharedPair,
      store: useCaptionShareStore,
      uiLanguage: () => useSettingsStore.getState().uiLanguage,
      now: () => Date.now(),
    });
  }
  return controller;
}

import useSessionStore from './sessionStore';
import useSettingsStore from './settingsStore';
import { usePlaybackStore } from './playbackStore';

declare const chrome: any;

let port: any = null;
let exitHandlerInstalled = false;

interface InboundStateInit {
  type: 'state-init';
  payload: {
    items?: any[];
    participantItems?: any[];
    isSessionActive?: boolean;
    sessionStartTime?: number | null;
    provider?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    turnDetectionMode?: string;
    playback?: { i: string | null; c?: number | null; d?: number; b?: number } | null;
  };
}
interface InboundItems {
  type: 'items';
  items: any[];
  participantItems?: any[];
}
interface InboundSession {
  type: 'session';
  isSessionActive: boolean;
  sessionStartTime?: number | null;
}
interface InboundConfig {
  type: 'config';
  provider: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode?: string;
}
interface InboundPlayback {
  type: 'playback';
  i: string | null;
  c?: number | null;
  d?: number;
  b?: number;
}
type Inbound = InboundStateInit | InboundItems | InboundSession | InboundConfig | InboundPlayback;

/**
 * Installs the iframe-side mirror that forwards sessionStore state from the
 * side-panel surface over a chrome.runtime port. Idempotent — calling more
 * than once will re-open the port, but the requestClearConversation override
 * is installed only on the first call.
 */
export function installSessionPortMirror(): void {
  port = chrome.runtime.connect({ name: 'sokuji-subtitle' });
  port.onMessage.addListener(handle);
  port.onDisconnect.addListener(() => {
    port = null;
    // The side panel closed (or the extension reloaded), so the only way to
    // dismiss the overlay — posting subtitle:user-exit over this port — is
    // gone. Ask the parent content script to unmount the host so the user
    // isn't stuck with a frozen bar on the page.
    try {
      window.parent.postMessage({ type: 'sokuji-subtitle:sidepanel-gone' }, '*');
    } catch {
      /* iframe may already be detached from the meeting page */
    }
  });

  if (!exitHandlerInstalled) {
    // Override the iframe-side sessionStore's clear action to forward via
    // port. The side panel is the source of truth for session data; the
    // iframe asks the side panel to clear and waits for the resulting
    // items[] push to reflect the cleared state locally.
    useSessionStore.setState({
      requestClearConversation: () => {
        port?.postMessage({ type: 'subtitle:request-clear' });
      },
    } as any);
    exitHandlerInstalled = true;
  }
}

/**
 * Tells the side panel that the user explicitly requested exit from the
 * subtitle overlay (e.g. clicked the close button or pressed Esc). The side
 * panel will then call `exitSubtitleMode()` on its own settings store.
 */
export function postUserExit(): void {
  port?.postMessage({ type: 'subtitle:user-exit' });
}

// Provider enum values travel over the port as snake_case strings, but the
// settingsStore stores provider sub-objects under camelCase keys. Without
// this mapping, snake_case providers (openai_compatible / openai_translate /
// volcengine_st / volcengine_ast2 / local_inference) would be written to a
// junk top-level key while `getCurrentProviderSettings()` continued to read
// the *real* key — pinning SubtitleApp's language pair to the provider's
// hardcoded defaults (e.g., local_inference → JA → EN).
const PROVIDER_STATE_KEY: Record<string, string> = {
  openai: 'openai',
  gemini: 'gemini',
  palabraai: 'palabraai',
  kizunaai_openai_translate: 'kizunaOpenaiTranslate',
  kizunaai_volcengine_ast2: 'kizunaVolcengineAst2',
  openai_compatible: 'openaiCompatible',
  openai_translate: 'openaiTranslate',
  volcengine_st: 'volcengineST',
  volcengine_ast2: 'volcengineAST2',
  local_inference: 'localInference',
};

/**
 * Apply provider + language pair + turn detection mode into the iframe-side
 * settingsStore so that SubtitleApp's existing selectors
 * (useProvider / useGetCurrentProviderSettings / useCurrentTurnDetectionMode)
 * resolve to the side panel's actual session config. The side panel is the
 * source of truth — we only write a slim shape here, preserving any unrelated
 * fields the iframe's settingsStore may carry from its hydrate step.
 */
function applyConfig(provider: string, sourceLanguage: string, targetLanguage: string, turnDetectionMode?: string): void {
  useSettingsStore.setState((s: any) => {
    const providerKey = PROVIDER_STATE_KEY[provider] ?? provider;
    const currentProviderSettings = s[providerKey] ?? {};
    return {
      provider,
      [providerKey]: {
        ...currentProviderSettings,
        sourceLanguage,
        targetLanguage,
        turnDetectionMode:
          turnDetectionMode ?? (currentProviderSettings as any).turnDetectionMode,
      },
    } as any;
  });
}

function applyPlayback(msg: { i: string | null; c?: number | null; d?: number; b?: number }): void {
  const playback = usePlaybackStore.getState();
  if (msg.i === null) {
    playback.setPlayingItem(null);
    return;
  }
  playback.setPlayingItem(msg.i);
  if (msg.c === null || msg.c === undefined) {
    playback.setProgress(null);
    return;
  }
  playback.setProgress({
    currentTime: msg.c,
    duration: msg.d ?? 0,
    bufferedTime: msg.b ?? 0,
  });
}

function handle(msg: Inbound): void {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'state-init') {
    useSessionStore.setState({
      items: msg.payload.items ?? [],
      participantItems: msg.payload.participantItems ?? [],
      isSessionActive: msg.payload.isSessionActive ?? false,
      sessionStartTime: msg.payload.sessionStartTime ?? null,
    } as any);
    if (msg.payload.provider) {
      applyConfig(
        msg.payload.provider,
        msg.payload.sourceLanguage ?? 'en',
        msg.payload.targetLanguage ?? 'zh',
        msg.payload.turnDetectionMode,
      );
    }
    // `playback: null` is the explicit "nothing playing" signal — we must
    // clear stale state on port reconnect (a truthy-only check would skip it
    // and leave the iframe stuck on a prior playingItemId).
    if ('playback' in msg.payload) {
      if (msg.payload.playback === null) {
        usePlaybackStore.getState().setPlayingItem(null);
      } else if (msg.payload.playback) {
        applyPlayback(msg.payload.playback);
      }
    }
  } else if (msg.type === 'playback') {
    applyPlayback(msg);
  } else if (msg.type === 'items') {
    useSessionStore.setState({
      items: msg.items,
      participantItems: msg.participantItems ?? useSessionStore.getState().participantItems,
    } as any);
  } else if (msg.type === 'session') {
    useSessionStore.setState({
      isSessionActive: msg.isSessionActive,
      sessionStartTime: msg.sessionStartTime ?? null,
    } as any);
  } else if (msg.type === 'config') {
    applyConfig(msg.provider, msg.sourceLanguage, msg.targetLanguage, msg.turnDetectionMode);
  }
}

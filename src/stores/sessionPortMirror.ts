import useSessionStore from './sessionStore';

declare const chrome: any;

let port: any = null;
let exitHandlerInstalled = false;

interface InboundStateInit {
  type: 'state-init';
  payload: {
    items?: any[];
    systemAudioItems?: any[];
    isSessionActive?: boolean;
    sessionStartTime?: number | null;
    sourceLanguage?: string;
    targetLanguage?: string;
  };
}
interface InboundItems {
  type: 'items';
  items: any[];
  systemAudioItems?: any[];
}
interface InboundSession {
  type: 'session';
  isSessionActive: boolean;
  sessionStartTime?: number | null;
}
type Inbound = InboundStateInit | InboundItems | InboundSession;

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

function handle(msg: Inbound): void {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'state-init') {
    useSessionStore.setState({
      items: msg.payload.items ?? [],
      systemAudioItems: msg.payload.systemAudioItems ?? [],
      isSessionActive: msg.payload.isSessionActive ?? false,
      sessionStartTime: msg.payload.sessionStartTime ?? null,
    } as any);
  } else if (msg.type === 'items') {
    useSessionStore.setState({
      items: msg.items,
      systemAudioItems: msg.systemAudioItems ?? useSessionStore.getState().systemAudioItems,
    } as any);
  } else if (msg.type === 'session') {
    useSessionStore.setState({
      isSessionActive: msg.isSessionActive,
      sessionStartTime: msg.sessionStartTime ?? null,
    } as any);
  }
}

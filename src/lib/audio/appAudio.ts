/**
 * The page's playback — the one module in `src/lib/audio` that reads the
 * stores, as `session/appShape.ts` is for the runner. One graph per page, on
 * a 24 kHz context; `<audio>` elements as its outputs; the tap worklet from
 * the platform's URL; the virtual output per platform (Electron's virtual
 * speaker, the extension's tabs, nothing on the web); the routing settings
 * read live from `audioStore`, `routingStore` and `turnModeStore`.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import type { Platform } from '../provider/types';
import type { TurnMode } from '../session/types';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { getEnvironment } from '../../utils/environment';
import { createAudioGraph, type VirtualOutput } from './graph';
import { createPlayback, type Playback, type PreviewClip, type RoutingSource } from './playback';
import type { RoutingSettings } from './routes';
import { sendToTabs, targetTabIdFromSearch, toPcmDataMessage, type TabsApi } from './tabMicrophone';
import { loadTestTone } from './testTone';
import { findVirtualSpeaker } from './virtualSpeaker';

type AudioState = ReturnType<typeof useAudioStore.getState>;

export interface AppAudio {
  playback: Playback;
  /** Plays the bundled test tone on the real device: a fixed route, never into the meeting. */
  testTone(): Promise<void>;
}

export function readRouting(
  audio: Pick<AudioState, 'mode' | 'isMonitorMuted' | 'isRealVoicePassthroughEnabled' | 'realVoicePassthroughVolume' | 'selectedMonitorDevice' | 'audioMonitorDevices'>,
  switches: { meeting: boolean; participantSpeech: boolean },
  platform: Platform,
  turnMode: TurnMode,
): RoutingSettings {
  return {
    meeting: switches.meeting,
    // Today's rule: the monitor is heard only in speaker mode, so a
    // whole-system participant capture never hears it.
    monitor: audio.mode === 'speaker' && !audio.isMonitorMuted,
    participantSpeech: switches.participantSpeech,
    // 1e-3 ruling 4, today's rule (`isPassthroughActive`): under push-to-translate
    // the original voice is on at full level whenever the key is not held (the
    // route closes while held), whatever the passthrough toggle says.
    passthrough: turnMode === 'push-to-translate'
      ? { on: true, ratio: 1 }
      : { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume },
    sinks: {
      real: audio.selectedMonitorDevice?.deviceId,
      virtual: platform === 'electron' ? findVirtualSpeaker(audio.audioMonitorDevices) : undefined,
    },
  };
}

export function createAppRouting(platform: Platform): RoutingSource {
  return {
    get: () => readRouting(useAudioStore.getState(), useRoutingStore.getState(), platform, useTurnModeStore.getState().turnMode),
    subscribe(listener) {
      const offAudio = useAudioStore.subscribe(() => listener());
      const offSwitches = useRoutingStore.subscribe(() => listener());
      const offTurnMode = useTurnModeStore.subscribe(() => listener());
      return () => {
        offAudio();
        offSwitches();
        offTurnMode();
      };
    },
  };
}

interface ChromeLike {
  tabs?: Omit<TabsApi, 'lastError'>;
  runtime?: { lastError?: unknown; getURL?(path: string): string };
}

const chromeApi = (): ChromeLike | undefined => (globalThis as unknown as { chrome?: ChromeLike }).chrome;

/** The extension serves worklets from its own origin (its CSP forbids blob: and data: modules); elsewhere Vite resolves the file. */
function tapModuleUrl(platform: Platform): string {
  const getURL = chromeApi()?.runtime?.getURL;
  if (platform === 'extension' && getURL) return getURL('worklets/pcm-tap-processor.js');
  return new URL('./worklets/pcm-tap-processor.js', import.meta.url).href;
}

function virtualOutput(platform: Platform): VirtualOutput {
  if (platform === 'electron') return { kind: 'device' };
  const api = platform === 'extension' ? chromeApi() : undefined;
  const chromeTabs = api?.tabs;
  if (!chromeTabs) return { kind: 'none' };
  const tabs: TabsApi = {
    get: (tabId, callback) => chromeTabs.get(tabId, callback),
    query: (info, callback) => chromeTabs.query(info, callback),
    sendMessage: (tabId, message, callback) => chromeTabs.sendMessage(tabId, message, callback),
    lastError: () => api?.runtime?.lastError,
  };
  const target = targetTabIdFromSearch(window.location.search);
  return {
    kind: 'tabs',
    send(chunk) {
      const message = toPcmDataMessage(chunk, Date.now());
      if (message) sendToTabs(tabs, target, message);
    },
  };
}

async function build(): Promise<AppAudio> {
  const platform = getEnvironment();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  let graph;
  try {
    graph = await createAudioGraph({
      context,
      replaceContext: () => new AudioContext({ sampleRate: SAMPLE_RATE }),
      addTapModule: (ctx) => ctx.audioWorklet.addModule(tapModuleUrl(platform)),
      createTapNode: (ctx, chunk) => new AudioWorkletNode(ctx, 'pcm-tap-processor', { processorOptions: { chunk } }),
      createSink: (stream) => {
        const element = new Audio();
        element.srcObject = stream;
        return element;
      },
      virtual: virtualOutput(platform),
    });
  } catch (error) {
    // The worklet module failed to load: nothing else opened this context, so
    // nothing else will close it. Without this, every retry through
    // getAppAudio leaks another one.
    void context.close();
    throw error;
  }
  const playback = createPlayback(graph, createAppRouting(platform));
  let tone: Promise<PreviewClip> | null = null;
  return {
    playback,
    async testTone() {
      // Not on `context`: a rebuild (#246) may have closed it before the first
      // decode, and browsers have differed on decoding on a closed context. An
      // offline context of the same rate decodes to the same samples and is
      // never closed.
      tone ??= loadTestTone(new OfflineAudioContext(1, 1, SAMPLE_RATE)).catch((error: unknown) => {
        tone = null;
        throw error;
      });
      await playback.preview(await tone);
    },
  };
}

let appAudio: Promise<AppAudio> | null = null;

/** The page's one playback, built on first use; a failed build is retried on the next call. */
export function getAppAudio(): Promise<AppAudio> {
  appAudio ??= build().catch((error: unknown) => {
    appAudio = null;
    throw error;
  });
  return appAudio;
}

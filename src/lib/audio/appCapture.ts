/**
 * The page's capture — with `appAudio.ts`, the only modules in `src/lib/audio`
 * that read the stores. Opens each leg's source for the platform, feeds the
 * microphone into playback's passthrough route and both legs into the echo
 * watch, and reads the settings the sources follow, live, from `audioStore`.
 */
import type { LegName } from '../conversation/types';
import type { Platform } from '../provider/types';
import type { OpenSource, Source } from '../session/source';
import useAudioStore from '../../stores/audioStore';
import { getEnvironment } from '../../utils/environment';
import { createEchoWatch, type EchoWatch } from './capture/echoWatch';
import { openMic, type MicSettings } from './capture/mic';
import { openSystemAudio, type SystemAudioSettings } from './capture/systemAudio';
import { openTab, type TabSettings } from './capture/tab';
import { createLevelMeter, type LevelMeter } from './levelMeter';
import type { Playback } from './playback';
import { targetTabIdFromSearch } from './tabMicrophone';

export interface AppCapture {
  openSource: OpenSource;
  /** For the echo notice (plan 1d): `useEchoNotice`'s one-listener contract. */
  echo: EchoWatch;
  /** Each leg's input level, for the footer's waveform (plan 1e-3b-1 ruling 3). */
  levels: Readonly<Record<LegName, LevelMeter>>;
}

const audio = () => useAudioStore.getState();
const onAudioChange = (listener: () => void) => useAudioStore.subscribe(() => listener());

export function micSettings(): MicSettings {
  return {
    deviceId: () => audio().selectedInputDevice?.deviceId,
    noiseSuppression: () => audio().noiseSuppressionMode,
    muted: () => audio().isMicMuted,
    subscribe: onAudioChange,
  };
}

export function systemAudioSettings(): SystemAudioSettings {
  return {
    sourceId: () => audio().selectedParticipantSource?.deviceId ?? 'desktop-audio-loopback',
    muted: () => audio().isParticipantMuted,
    subscribe: onAudioChange,
    audioSeen: () => audio().markParticipantTapAudioSeen(),
  };
}

export function tabSettings(): TabSettings {
  return {
    tabId: () => targetTabIdFromSearch(window.location.search),
    outputDeviceId: () => audio().selectedMonitorDevice?.deviceId,
    muted: () => audio().isParticipantMuted,
  };
}

/** The source, with `cleanup` run once before it stops. */
function withCleanup(source: Source, cleanup: () => void): Source {
  let cleaned = false;
  return {
    onPcm: (listener) => source.onPcm(listener),
    onEnded: (listener) => source.onEnded(listener),
    onDegraded: (listener) => source.onDegraded(listener),
    get track() {
      return source.track;
    },
    async stop() {
      if (!cleaned) {
        cleaned = true;
        cleanup();
      }
      await source.stop();
    },
  };
}

export function createAppCapture(playback: Playback, platform: Platform = getEnvironment()): AppCapture {
  const echo = createEchoWatch(playback.ttsTap);
  const levels: Record<LegName, LevelMeter> = { speaker: createLevelMeter(), participant: createLevelMeter() };

  const open = (leg: LegName, signal: AbortSignal): Promise<Source> => {
    if (leg === 'speaker') return openMic(micSettings(), signal);
    if (platform === 'electron') return openSystemAudio(systemAudioSettings(), signal);
    if (platform === 'extension') return openTab(tabSettings(), signal);
    return Promise.reject(new Error('This build has no participant source.'));
  };

  return {
    echo,
    levels,
    async openSource(leg, signal) {
      const source = await open(leg, signal);
      // The processed microphone is the original voice under the translation.
      const offPassthrough = leg === 'speaker' ? source.onPcm((pcm) => playback.passthrough(pcm)) : () => {};
      const offLevel = source.onPcm((pcm) => levels[leg].push(pcm));
      const detach = echo.attach(leg, source);
      return withCleanup(source, () => {
        offPassthrough();
        offLevel();
        levels[leg].reset();
        detach();
      });
    },
  };
}

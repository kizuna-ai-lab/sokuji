/**
 * The extension's tab as the participant source (`startTabAudioRecording`
 * today). Chrome mutes a captured tab, so `TabAudioRecorder` plays the
 * capture back on the monitor device chosen when capture begins; that stays
 * inside this source (ruling 8), and a monitor change during the run does not
 * move it, as today.
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { TabAudioRecorder } from '../../modern-audio/TabAudioRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

/** The settings a tab source reads when it opens (and `muted` on every chunk). */
export interface TabSettings {
  /**
   * The meeting tab the side panel was opened for. Null refuses to open
   * rather than falling back to whichever tab happens to be active — that
   * fallback could stream an unrelated tab's audio to the provider.
   */
  tabId(): number | null;
  /** Where the captured tab is played back, since Chrome mutes it. */
  outputDeviceId(): string | undefined;
  muted(): boolean;
}

/** The part of `TabAudioRecorder` this source drives. */
export interface TabCapture {
  /** False when the tab cannot be captured (it logs why and cleans up after itself). */
  begin(options?: { tabId?: number; outputDeviceId?: string }): Promise<boolean>;
  record(callback: (data: { mono: Int16Array }) => void): Promise<boolean>;
  end(): Promise<void>;
  getStream(): MediaStream | null;
}

export async function openTab(
  settings: TabSettings,
  signal: AbortSignal,
  createRecorder: () => TabCapture = () => new TabAudioRecorder(SAMPLE_RATE),
): Promise<Source> {
  const tabId = settings.tabId();
  // Refused before any recorder is built: `TabAudioRecorder`'s own fallback to the
  // active tab must never be reached from here (ruling: keep today's refusal).
  if (tabId === null) throw new Error('No meeting tab is targeted, so audio capture was refused rather than capturing whichever tab is active.');

  const recorder = createRecorder();
  let unwatch = () => {};
  let open = false;
  const core = createSourceCore({
    muted: () => settings.muted(),
    track: () => recorder.getStream()?.getAudioTracks()[0],
    release: async () => {
      unwatch();
      if (!open) return;
      open = false;
      try {
        await recorder.end();
      } catch (error) {
        reportWarning('TabCapture', `Stopping the tab capture failed: ${describeCause(error)}`, { dedupeKey: 'tab:end' });
      }
    },
  });

  const begun = await recorder.begin({ tabId, outputDeviceId: settings.outputDeviceId() });
  if (!begun) throw new Error('The meeting tab could not be captured. Reload the tab and try again.');
  open = true;
  unwatch = core.watch(recorder.getStream());
  try {
    await recorder.record((data) => core.deliver(data.mono));
  } catch (error) {
    await core.stop();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }
  return core;
}

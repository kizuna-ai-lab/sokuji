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

/** Chrome's words when the icon was not clicked on the tab: only that click grants the capture, a reload does not. */
const NOT_INVOKED = 'has not been invoked';

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
  /** Whether the screen context shares this capture: the tab's video is taken from the same stream as its audio. */
  video(): boolean;
}

/** The part of `TabAudioRecorder` this source drives. */
export interface TabCapture {
  /** False when the tab cannot be captured (it logs why and cleans up after itself). */
  begin(options?: { tabId?: number; outputDeviceId?: string; video?: boolean }): Promise<boolean>;
  /** Why the last `begin` returned false. */
  beginFailure?: unknown;
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

  const begun = await recorder.begin({ tabId, outputDeviceId: settings.outputDeviceId(), video: settings.video() });
  if (!begun) {
    // The browser's own reason is the only clue to why, for the failure and its telemetry.
    const cause = recorder.beginFailure === undefined ? null : describeCause(recorder.beginFailure);
    const why = cause === null ? '' : ` (${cause})`;
    const remedy = cause?.includes(NOT_INVOKED)
      ? 'Click the Sokuji icon in the browser toolbar on the meeting tab, then start again.'
      : 'Reload the tab and try again.';
    throw new Error(`The meeting tab could not be captured${why}. ${remedy}`);
  }
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

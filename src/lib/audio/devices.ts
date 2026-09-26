/**
 * Device enumeration, moved out of the old `ModernBrowserAudioService`
 * (plan 1e-3c, controller ruling 3): plain functions, no store access, no
 * React. `audioStore.refreshDevices` is the only caller.
 */
import { ServiceFactory } from '../../services/ServiceFactory';
import { reportError, reportWarning, describeCause } from '../diagnostics/report';
import type { AudioDevice } from '../../stores/audioStore';
import { isVirtualMic, isVirtualSpeaker } from '../../utils/audioDevices';

// Declare chrome namespace for extension messaging (the permission toast's link).
declare const chrome: any;

// In-flight guard: collapse concurrent warm-up calls into a single run so we
// never open the microphone twice at once (which fails with NotReadableError
// on drivers that can't share a device). A module-level singleton, since this
// module has no instance to hang it on and the app only ever has one caller.
let permissionWarmupPromise: Promise<void> | null = null;

/**
 * Get available audio input and output devices.
 */
export async function listAudioDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  try {
    // Enumerate FIRST. Once microphone permission has been granted for this
    // origin (always the case in Electron after the first run), enumerate
    // returns fully-labeled devices WITHOUT needing an active stream — so the
    // getUserMedia({ audio: true }) warm-up is only needed to unlock labels
    // the very first time.
    //
    // Crucially, the warm-up opens the system DEFAULT input device. If that
    // default is broken — e.g. a stale/phantom "3- ZUM-2" left by a
    // replugged USB mic — getUserMedia hangs ~20s and then throws
    // NotReadableError, even though every real device enumerates fine and the
    // user's *selected* mic works. The old code let that warm-up failure
    // discard the entire (good) device list and return empty, so the UI
    // reported "no audio devices". We must never do that: enumerate is the
    // source of truth for the device list; the warm-up is best-effort.
    let devices = await navigator.mediaDevices.enumerateDevices();

    // The warm-up exists to unlock MICROPHONE (input) labels, so key the
    // decision on inputs only. A labeled audiooutput can otherwise mask
    // unlabeled inputs and skip a warm-up the mic picker still needs. If
    // there are no inputs at all, there is nothing to warm up.
    const needsMicrophoneWarmup = devices.some(
      d => d.kind === 'audioinput' && d.label === ''
    );

    if (needsMicrophoneWarmup) {
      // Input labels missing => mic permission not yet granted this session.
      // Warm up to unlock them, but if the warm-up fails (e.g. broken default
      // device), fall through with whatever enumerate already gave us instead
      // of wiping the list.
      try {
        await ensureMicrophonePermission();
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (permissionError: any) {
        reportWarning('AudioDevices', `Microphone permission warm-up failed; returning enumerated devices anyway: ${describeCause(permissionError)}`, { cause: permissionError });
        showPermissionError(permissionError);
      }
    }

    const inputs = devices
      .filter(device => device.kind === 'audioinput')
      .filter(device => device.deviceId !== 'default')
      .filter(device => device.deviceId !== 'communications')
      .map(device => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${device.deviceId.substring(0, 5)}...`,
        // Use the same detector as the Settings device pickers (hooks.ts) so a
        // device flagged virtual there is also excluded from default-selection
        // fallbacks here — e.g. Sokuji's own "Sokuji_Virtual_Mic" (the monitor of
        // its own virtual speaker, meant for other apps to consume, not for
        // Sokuji to listen to itself).
        isVirtual: device.label ? isVirtualMic(device) : false
      }));

    const outputs = devices
      .filter(device => device.kind === 'audiooutput')
      .filter(device => device.deviceId !== 'default')
      .filter(device => device.deviceId !== 'communications')
      .map(device => ({
        deviceId: device.deviceId,
        label: device.label || `Speaker ${device.deviceId.substring(0, 5)}...`,
        isVirtual: device.label ? isVirtualSpeaker(device) : false
      }));

    return { inputs, outputs };
  } catch (error) {
    reportError('AudioDevices', `Failed to get audio devices: ${describeCause(error)}`, { cause: error });
    return { inputs: [], outputs: [] };
  }
}

/**
 * Per-application audio sources: Electron only, `[]` elsewhere and on a
 * platform without system-audio capture.
 */
export async function listSystemAudioSources(): Promise<AudioDevice[]> {
  if (!ServiceFactory.isElectron() || !window.electron) {
    return [];
  }

  try {
    // Check if platform supports system audio capture
    const supported = await window.electron.invoke('supports-system-audio-capture');
    if (!supported) {
      console.info('[Sokuji] [AudioDevices] System audio capture not supported on this platform');
      return [];
    }

    // Get list of audio sinks from the main process
    const sources = await window.electron.invoke('list-system-audio-sources');
    console.info('[Sokuji] [AudioDevices] Found system audio sources:', sources?.length || 0);
    return sources || [];
  } catch (error) {
    reportWarning('AudioDevices', `Error getting system audio sources: ${describeCause(error)}`, { cause: error });
    return [];
  }
}

/**
 * Warm up microphone permission so enumerateDevices() returns labeled
 * devices, then release the stream immediately.
 *
 * Serialized via a shared in-flight promise: at startup listAudioDevices() is
 * called from several overlapping paths, each doubled by React StrictMode.
 * Without this guard they fire concurrent getUserMedia({ audio: true }) on
 * the same physical mic, and drivers that cannot open one device twice reject
 * the losers with "NotReadableError: Could not start audio source". Sharing
 * one warm-up collapses them into a single open. The stream is stopped right
 * away because enumerateDevices() only needs permission to have been
 * granted, not a live track (leaving it open would leak an audio source
 * that is only released on process teardown — abrupt on Windows and prone to
 * stranding the capture endpoint for the next launch).
 */
function ensureMicrophonePermission(): Promise<void> {
  if (!permissionWarmupPromise) {
    permissionWarmupPromise = (async () => {
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permStream.getTracks().forEach(track => track.stop());
    })().finally(() => {
      // Clear once settled so a later refresh can re-warm; concurrent callers
      // still share this single in-flight open.
      permissionWarmupPromise = null;
    });
  }
  return permissionWarmupPromise;
}

/**
 * Show permission error to user.
 */
function showPermissionError(permissionError: any): void {
  const errorType = permissionError.name || 'Error';
  let errorMessage = 'Unable to access your microphone. ';

  if (errorType === 'NotAllowedError' || errorType === 'PermissionDeniedError') {
    let permissionUrl = '';
    if (chrome && chrome.runtime && chrome.runtime.getURL) {
      permissionUrl = chrome.runtime.getURL('permission.html');
    }

    errorMessage += 'Please allow microphone access to use Sokuji. ';

    if (permissionUrl) {
      errorMessage += `<a href="${permissionUrl}" target="_blank" style="color: white; text-decoration: underline; font-weight: bold;">Click here</a> to grant microphone permission, or `;
    }

    errorMessage += 'click the camera/microphone icon in your browser address bar and grant permission.';
  } else if (errorType === 'NotFoundError') {
    errorMessage += 'No microphone was found on your device.';
  } else if (errorType === 'NotReadableError') {
    errorMessage += 'Your microphone is already in use by another application.';
  } else {
    errorMessage += `Error details: ${permissionError.message || errorType}`;
  }

  // Display error message to user
  if (typeof window !== 'undefined') {
    displayErrorNotification(errorMessage);
  }
}

/**
 * Display error notification.
 */
function displayErrorNotification(errorMessage: string): void {
  // Create or update error notification element
  let notification = document.getElementById('sokuji-mic-error');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'sokuji-mic-error';
    // z-index 1400 keeps this above ordinary content but BELOW the setup
    // wizard (1500) and the auth overlay (2000): on a fresh install the
    // permission toast used to paint over "Set up Sokuji / Step N of 6".
    notification.style.cssText = 'position:fixed; top:10px; left:50%; transform:translateX(-50%); '
      + 'background:#f44336; color:white; padding:12px 24px; border-radius:4px; z-index:1400; '
      + 'max-width:80%; text-align:center; box-shadow:0 2px 5px rgba(0,0,0,0.3); font-family:sans-serif;';

    document.body.appendChild(notification);
  }

  // Message FIRST: assigning innerHTML replaces every child, so a close
  // button appended before this line is discarded — which is why the button
  // used to be dead and only the 15 s timer could dismiss the toast.
  notification.innerHTML = `<div>${errorMessage}</div>`;

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.style.cssText = 'background:none; border:none; color:white; font-size:20px; '
    + 'position:absolute; right:5px; top:5px; cursor:pointer; padding:0 5px;';
  closeBtn.onclick = () => notification?.remove();
  notification.appendChild(closeBtn);

  // Auto-hide after 15 seconds
  setTimeout(() => notification?.remove(), 15000);
}

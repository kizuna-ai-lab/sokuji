/**
 * The output device a meeting app hears as a microphone (Electron), found by
 * label in this order: Linux's PulseAudio sink, macOS's driver, Windows'
 * VB-CABLE — the same order the old
 * `ModernBrowserAudioService.detectAndSetVirtualSpeaker` used (deleted in
 * plan 1e-3c); `appAudio.ts` now calls this function directly.
 */
export function findVirtualSpeaker(outputs: readonly { deviceId: string; label: string }[]): string | undefined {
  const match = outputs.find((d) => d.label.includes('Sokuji_Virtual_Speaker'))
    ?? outputs.find((d) => d.label.includes('SokujiVirtualAudio'))
    ?? outputs.find((d) => d.label.toUpperCase().includes('CABLE'));
  return match?.deviceId;
}

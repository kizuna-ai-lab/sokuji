import type { PreviewFailure } from '../session/preview';

/**
 * What one preview costs, shown as an estimate before the first: the backend
 * bills Soniox's cost × 2, about 1,356 µUSD for the short sample
 * (sokuji-backend services/pricing.ts, 2026-10-28).
 */
export const PREVIEW_ESTIMATE_USD = 0.0014;

/** Each failure's words: the desktop's preview messages, else the app's own. */
export function previewFailureKey(reason: PreviewFailure): string {
  switch (reason) {
    case 'balance':
      return 'voiceLibrary.previewNeedsBalance';
    case 'busy':
      return 'voiceLibrary.previewSessionRunning';
    case 'capacity':
      return 'mainPanel.sonioxServiceBusy';
    case 'rate':
      return 'settings.sonioxVoicePreviewQuotaError';
    case 'timeout':
      return 'settings.sonioxVoicePreviewTimeout';
    case 'sign_in':
      return 'mobile.main.status.signInRequired';
    default:
      return 'mobile.common.failed';
  }
}

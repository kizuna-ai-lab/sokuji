// src/components/Banner/useBanners.tsx
import { Download, RefreshCw, TriangleAlert, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAudioSystemDismiss, useAudioSystemDismissed, useAudioSystemReason, useAudioSystemRepair, useAudioSystemRepairFailed,
  useAudioSystemRepairing, useAudioSystemRetry, useAudioSystemRetrying, useAudioSystemStatus,
} from '../../stores/audioSystemStore';
import {
  useDismissBanner, useDownloadUpdate, useInstallUpdate, useOpenUpdateDialog, useUpdateBannerDismissed, useUpdateErrorFrom,
  useUpdateNewVersion, useUpdateProgressPercent, useUpdateStatus, useUpdateSupportsAutoUpdate,
} from '../../stores/updateStore';
import { Banner, type BannerProps } from './Banner';

/**
 * The app-level banners to draw, in order (spec 2026-10-05 §4): the audio
 * system (attention) above the update (brand). An update's failure is never a
 * banner of its own: a failed check is the Help link's, a failed download
 * draws `available` again (Download Now is the retry) and a failed install
 * keeps `downloaded` (Ruling 9).
 */
export function useBanners(): BannerProps[] {
  const { t } = useTranslation();
  const dismissLabel = t('common.dismiss', 'Dismiss');
  const banners: BannerProps[] = [];

  const audioStatus = useAudioSystemStatus();
  const reason = useAudioSystemReason();
  const audioDismissed = useAudioSystemDismissed();
  const retrying = useAudioSystemRetrying();
  const retry = useAudioSystemRetry();
  const repairing = useAudioSystemRepairing();
  const repairFailed = useAudioSystemRepairFailed();
  const repair = useAudioSystemRepair();
  const dismissAudio = useAudioSystemDismiss();
  if (audioStatus === 'unavailable' && !audioDismissed) {
    const pactlMissing = reason === 'pactl-missing';
    // macOS: the driver is installed but was never loaded; the fix is a re-sign behind macOS's administrator prompt, not another retry.
    const macDriver = reason === 'mac-driver-not-loaded';
    let body = t('audioSystem.unavailableBody');
    if (pactlMissing) body = t('audioSystem.pactlMissingBody');
    if (macDriver) body = repairFailed ? t('audioSystem.macRepairFailedBody') : t('audioSystem.macDriverNotLoadedBody');
    banners.push({
      id: 'audio-system',
      tone: 'attention',
      icon: <TriangleAlert size={14} aria-hidden="true" />,
      text: <><span>{body}</span>{pactlMissing && <code className="banner__code">{t('audioSystem.installCommand')}</code>}</>,
      action: macDriver
        ? { label: repairing ? t('audioSystem.repairing') : t('audioSystem.repair'), icon: <Wrench size={12} aria-hidden="true" className={repairing ? 'spinning' : ''} />, onClick: () => { void repair(t('audioSystem.macRepairPrompt')); }, busy: repairing }
        : { label: retrying ? t('audioSystem.retrying') : t('audioSystem.retry'), icon: <RefreshCw size={12} aria-hidden="true" className={retrying ? 'spinning' : ''} />, onClick: () => { void retry(); }, busy: retrying },
      onDismiss: dismissAudio,
      dismissLabel,
    });
  }

  const storeStatus = useUpdateStatus();
  const errorFrom = useUpdateErrorFrom();
  // A failed download is `available` again; a failed install stays `downloaded`; any other error draws nothing.
  const status = storeStatus !== 'error' ? storeStatus
    : errorFrom === 'downloading' ? 'available'
    : errorFrom === 'downloaded' ? 'downloaded'
    : storeStatus;
  const newVersion = useUpdateNewVersion();
  const percent = useUpdateProgressPercent();
  const bannerDismissed = useUpdateBannerDismissed();
  const supportsAutoUpdate = useUpdateSupportsAutoUpdate();
  const dismissBanner = useDismissBanner();
  const openDialog = useOpenUpdateDialog();
  const downloadUpdate = useDownloadUpdate();
  const installUpdate = useInstallUpdate();
  // Only `downloading` cannot be dismissed; the next `available` re-arms a dismissed banner (the store).
  const shown = !bannerDismissed || status === 'downloading';
  if (shown && status === 'available') {
    banners.push({
      id: 'update', tone: 'brand', icon: <Download size={14} aria-hidden="true" />,
      text: supportsAutoUpdate ? t('update.available', { version: newVersion }) : t('update.linuxMigrateTitle', { version: newVersion }),
      // Auto-update builds download here; the others open the dialog, which holds the AppImage/deb links.
      action: supportsAutoUpdate ? { label: t('update.downloadNow'), onClick: downloadUpdate } : { label: t('update.goToDownload'), onClick: openDialog },
      onDismiss: dismissBanner, dismissLabel,
    });
  } else if (shown && status === 'downloading') {
    banners.push({
      id: 'update', tone: 'brand', icon: <RefreshCw size={14} aria-hidden="true" className="spinning" />,
      text: t('update.downloading', { percent: Math.round(percent) }), progress: Math.min(100, Math.max(0, percent)), dismissLabel,
    });
  } else if (shown && status === 'downloaded') {
    banners.push({
      id: 'update', tone: 'brand', icon: <RefreshCw size={14} aria-hidden="true" />, text: t('update.downloaded'),
      action: { label: t('update.restartNow'), onClick: installUpdate }, onDismiss: dismissBanner, dismissLabel,
    });
  }
  return banners;
}

/** The banners at the top of the panel. */
export function Banners() {
  const banners = useBanners();
  return <>{banners.map((banner) => <Banner key={banner.id} {...banner} />)}</>;
}

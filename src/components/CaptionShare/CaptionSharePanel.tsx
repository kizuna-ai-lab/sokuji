// src/components/CaptionShare/CaptionSharePanel.tsx
/**
 * The host's caption-share popover (spec 2026-10-04 §7.2): built from the
 * settings' own ToggleSwitch, Button, FormInput and StatusMessage. A control
 * is drawn only when it can be used.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';
import Button from '../Settings/shared/Button';
import FormInput from '../Settings/shared/FormInput';
import StatusMessage from '../Settings/shared/StatusMessage';
import QrCode from './QrCode';
import { useCaptionShareStore } from '../../stores/captionShareStore';
import { getCaptionShareController } from '../../app/captionShare';
import { shareUrl } from '../../lib/share/url';
import { useAnalytics } from '../../lib/analytics';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import './CaptionSharePanel.scss';

export const NO_VIEWERS_WARNING_MS = 120_000;

const platform = (): string =>
  (window.electron as unknown as { osInfo?: { platform?: string } } | undefined)?.osInfo?.platform ?? '';

const CaptionSharePanel: React.FC = () => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const controller = getCaptionShareController();
  const status = useCaptionShareStore((s) => s.status);
  const busy = useCaptionShareStore((s) => s.busy);
  const error = useCaptionShareStore((s) => s.error);
  const allowSave = useCaptionShareStore((s) => s.allowSave);
  const wifiHint = useCaptionShareStore((s) => s.wifiHint);
  const firewallNoteSeen = useCaptionShareStore((s) => s.firewallNoteSeen);
  const startedAt = useCaptionShareStore((s) => s.startedAt);
  const everConnected = useCaptionShareStore((s) => s.everConnected);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const url = shareUrl(status);

  // One re-render when the no-viewer warning falls due.
  useEffect(() => {
    if (!status.running || startedAt === null || everConnected) return;
    const due = startedAt + NO_VIEWERS_WARNING_MS - Date.now();
    if (due <= 0) {
      setNow(Date.now());
      return;
    }
    const id = window.setTimeout(() => setNow(Date.now()), due);
    return () => window.clearTimeout(id);
  }, [status.running, startedAt, everConnected]);

  const start = async () => {
    if (await controller.start()) {
      const s = useCaptionShareStore.getState().status;
      const kind = s.addresses.find((a) => a.address === s.selected)?.kind ?? 'other';
      trackEvent('caption_share_started', { address_kind: kind });
    }
  };
  const stop = async () => {
    const s = useCaptionShareStore.getState();
    const endedAt = Date.now();
    await controller.stop();
    // A stop that did not go through leaves sharing on: no ending to count yet.
    if (s.startedAt !== null && !useCaptionShareStore.getState().status.running) {
      trackEvent('caption_share_ended', { duration_ms: endedAt - s.startedAt, peak_viewers: s.peakViewers });
    }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      reportWarning('CaptionShare', `Copying the share address failed: ${describeCause(e)}`, { cause: e });
    }
  };

  const noViewers = status.running && startedAt !== null && !everConnected && now - startedAt >= NO_VIEWERS_WARNING_MS;

  if (!status.running) {
    return (
      <div className="caption-share-panel">
        <p className="caption-share-panel__intro">{t('captionShare.intro', 'Let people on the same network read the captions and translations here on their phones or computers.')}</p>
        <ToggleSwitch checked={false} onChange={() => void start()} label={t('captionShare.enable', 'Share captions')} disabled={busy} />
        {platform() === 'win32' && !firewallNoteSeen && (
          <p className="caption-share-panel__note">{t('captionShare.firewallNote', 'Windows may ask whether Sokuji can use the network. Choose Private networks.')}</p>
        )}
        {error && (
          <StatusMessage variant="error">
            {error.code === 'ports-busy'
              ? t('captionShare.errorPortsBusy', 'Could not start sharing: ports 7788–7797 are all in use.')
              : t('captionShare.errorListen', { reason: error.reason, defaultValue: 'Could not start sharing: {{reason}}' })}
          </StatusMessage>
        )}
      </div>
    );
  }

  return (
    <div className="caption-share-panel">
      <ToggleSwitch checked onChange={() => void stop()} label={t('captionShare.enable', 'Share captions')} disabled={busy} />
      <div className="caption-share-panel__main">
        {url && <QrCode value={url} size={128} label={url} />}
        <div className="caption-share-panel__facts">
          <div className="caption-share-panel__fact">
            <span className="caption-share-panel__label">{t('captionShare.address', 'Address')}</span>
            <div className="caption-share-panel__address">
              <code>{url}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy()}>
                {copied ? t('captionShare.copied', 'Copied') : t('captionShare.copy', 'Copy')}
              </Button>
            </div>
          </div>
          {status.addresses.length > 1 && (
            <div className="caption-share-panel__fact">
              <label className="caption-share-panel__label" htmlFor="caption-share-network">{t('captionShare.network', 'Network')}</label>
              <select
                id="caption-share-network"
                className="select-dropdown"
                value={status.selected ?? ''}
                onChange={(e) => void controller.selectAddress(e.target.value)}
              >
                {status.addresses.map((a, i) => (
                  <option key={a.address} value={a.address}>
                    {`${t(`captionShare.kinds.${a.kind}`, a.kind)} · ${a.address}`}
                    {i === 0 ? ` (${t('captionShare.recommended', 'recommended')})` : ''}
                    {i !== 0 && a.kind === 'virtual' ? ` (${t('captionShare.usuallyUnreachable', 'usually unreachable')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="caption-share-panel__fact">
            <span className="caption-share-panel__label">{t('captionShare.watching', 'Watching')}</span>
            <span className="caption-share-panel__count">{t('captionShare.watchingCount', { count: status.viewers, defaultValue: '{{count}}' })}</span>
          </div>
        </div>
      </div>
      <div className="caption-share-panel__options">
        <ToggleSwitch checked={allowSave} onChange={() => controller.setAllowSave(!allowSave)} label={t('captionShare.allowSave', 'Let viewers save these captions')} />
        <ToggleSwitch checked={wifiHint.enabled} onChange={() => controller.setWifiHint({ enabled: !wifiHint.enabled })} label={t('captionShare.wifiHint', 'Add a Wi‑Fi hint to the projector page')} />
        {wifiHint.enabled && (
          <div className="caption-share-panel__wifi">
            <label className="caption-share-panel__label" htmlFor="caption-share-wifi-name">{t('captionShare.wifiName', 'Wi‑Fi name')}</label>
            <FormInput
              id="caption-share-wifi-name"
              value={wifiHint.ssid}
              onChange={(e) => controller.setWifiHint({ ssid: e.target.value })}
              placeholder={t('captionShare.wifiNamePlaceholder', 'e.g. Meetup-Guest')}
            />
            <label className="caption-share-panel__label" htmlFor="caption-share-wifi-password">{t('captionShare.wifiPassword', 'Password (optional)')}</label>
            <FormInput
              id="caption-share-wifi-password"
              value={wifiHint.password}
              onChange={(e) => controller.setWifiHint({ password: e.target.value })}
            />
          </div>
        )}
      </div>
      {status.addressChanged && url && (
        <StatusMessage variant="warning">{t('captionShare.warnAddressChanged', { address: url, defaultValue: 'The network changed. The address is now {{address}}: send the link again or reopen the projector page.' })}</StatusMessage>
      )}
      {noViewers && <StatusMessage variant="warning">{t('captionShare.warnNoViewers', 'Two minutes in and no device has connected.')}</StatusMessage>}
      <div className="caption-share-panel__actions">
        <Button variant="secondary" size="sm" onClick={() => void controller.openPresent()}>{t('captionShare.openPresent', 'Open projector page')}</Button>
        <Button variant="ghost" size="sm" onClick={() => void stop()}>{t('captionShare.stop', 'Stop sharing')}</Button>
      </div>
      <p className="caption-share-panel__note">{t('captionShare.stopNote', "Viewers' pages will show that sharing has ended.")}</p>
    </div>
  );
};

export default CaptionSharePanel;

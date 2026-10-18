// src/components/VbCable/VbCableNotice.tsx
import React, { useEffect } from 'react';
import { CheckCircle2, ExternalLink, Info, Loader2, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { VB_AUDIO_URL, VB_CABLE_SETUP_FILE } from '../../lib/audio/vbCable';
import { virtualMicrophoneName } from '../../lib/audio/virtualSpeaker';
import { useVbCablePresence, useVbCableStore } from '../../stores/vbCableStore';
import { openExternalUrl } from '../../utils/openExternalUrl';
import './VbCable.scss';

export interface VbCableNoticeProps {
  /** `row`: under "Translation the other side hears"; `modal`: the one-time introduction, whose dialog carries the title. */
  variant: 'row' | 'modal';
  /** The modal's "Not now". */
  onNotNow?: () => void;
}

function Notice({ title, showTitle, live, children }: { title: string; showTitle: boolean; live?: boolean; children: React.ReactNode }) {
  return (
    <div className="vbcable-notice" role={live ? 'status' : 'note'}>
      <Info size={16} aria-hidden="true" className="vbcable-notice__icon" />
      <div className="vbcable-notice__content">
        {showTitle && <div className="vbcable-notice__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/**
 * VB-CABLE's state on Windows, in one place (spec 2026-10-17 §4): the offer
 * while it is missing (an install in the website's build, a link in the
 * Store's), the install's progress or failure, and the ready line after an
 * install Sokuji started. Nothing otherwise.
 */
const VbCableNotice: React.FC<VbCableNoticeProps> = ({ variant, onNotNow }) => {
  const { t } = useTranslation();
  const presence = useVbCablePresence();
  const channel = useVbCableStore((s) => s.channel);
  const attempt = useVbCableStore((s) => s.attempt);
  const readyDismissed = useVbCableStore((s) => s.readyDismissed);
  const load = useVbCableStore((s) => s.load);
  const install = useVbCableStore((s) => s.install);
  const checkAgain = useVbCableStore((s) => s.checkAgain);
  const dismissReady = useVbCableStore((s) => s.dismissReady);
  useEffect(() => { void load(); }, [load]);

  const inModal = variant === 'modal';
  const primary = 'vbcable-notice__btn vbcable-notice__btn--primary';
  const secondary = 'vbcable-notice__btn vbcable-notice__btn--secondary';
  const notNow = inModal && onNotNow
    ? <button type="button" className={secondary} onClick={onNotNow}>{t('vbCable.notNow', 'Not now')}</button>
    : null;
  const link = (label: string, className = secondary) => (
    <button type="button" className={className} onClick={() => openExternalUrl(VB_AUDIO_URL)}>
      {label}<ExternalLink size={12} aria-hidden="true" />
    </button>
  );
  const checkAgainButton = <button type="button" className={secondary} onClick={() => { void checkAgain(); }}>{t('vbCable.checkAgain', 'Check again')}</button>;
  const promptTitle = t('vbCable.title', 'Let the other side hear the translation');
  const body = <p>{t('vbCable.body')}</p>;

  if (presence === 'present') {
    if (attempt === 'none' || readyDismissed) return null;
    return (
      <div className="vbcable-notice vbcable-notice--ready" role="status">
        <CheckCircle2 size={16} aria-hidden="true" className="vbcable-notice__icon" />
        <span className="vbcable-notice__content">
          <strong>{t('vbCable.readyTitle', 'VB-CABLE is ready.')}</strong>{' '}
          {t('vbCable.readyBody', { mic: virtualMicrophoneName(), defaultValue: 'In your meeting app, choose "{{mic}}" as the microphone.' })}
        </span>
        {!inModal && (
          <button type="button" className="vbcable-notice__close" aria-label={t('common.dismiss', 'Dismiss')} onClick={dismissReady}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
  if (presence !== 'missing' || channel === null) return null;

  if (channel === 'store') {
    return (
      <Notice title={promptTitle} showTitle={!inModal}>
        {body}
        <ol className="vbcable-notice__steps">
          <li>{t('vbCable.storeStep1')}</li>
          <li><Trans i18nKey="vbCable.storeStep2" values={{ file: VB_CABLE_SETUP_FILE }} components={{ code: <code /> }} /></li>
          <li>{t('vbCable.storeStep3')}</li>
        </ol>
        <div className="vbcable-notice__actions">
          {link(t('vbCable.openWebsite', 'Open VB-Audio website'), primary)}
          {checkAgainButton}
          {notNow}
        </div>
        <p className="vbcable-notice__foot">{t('vbCable.picksUp')}</p>
      </Notice>
    );
  }

  if (attempt === 'running' || attempt === 'succeeded') {
    return (
      <Notice title={t('vbCable.installingTitle', 'Installing VB-CABLE…')} showTitle live>
        <p>{t('vbCable.installingBody')}</p>
        <div className="vbcable-notice__actions">
          {attempt === 'running'
            ? (
              <button type="button" className={`${secondary} vbcable-notice__btn--busy`} disabled>
                <Loader2 size={12} aria-hidden="true" className="spinning" />{t('vbCable.installingBusy', 'Installing…')}
              </button>
            )
            : checkAgainButton}
          {notNow}
        </div>
      </Notice>
    );
  }

  if (attempt === 'failed') {
    return (
      <Notice title={t('vbCable.failedTitle', "VB-CABLE wasn't installed")} showTitle>
        <p>{t('vbCable.failedBody')}</p>
        <div className="vbcable-notice__actions">
          <button type="button" className={primary} onClick={() => { void install(); }}>{t('vbCable.retry', 'Try again')}</button>
          {link(t('vbCable.installYourself', 'Install it yourself'))}
          {notNow}
        </div>
      </Notice>
    );
  }

  return (
    <Notice title={promptTitle} showTitle={!inModal}>
      {body}
      <div className="vbcable-notice__actions">
        <button type="button" className={primary} onClick={() => { void install(); }}>{t('vbCable.install', 'Install VB-CABLE')}</button>
        {link(t('vbCable.about', 'About VB-CABLE'))}
        {notNow}
      </div>
      <p className="vbcable-notice__foot">{t('vbCable.adminOnce')}</p>
    </Notice>
  );
};

export default VbCableNotice;

/**
 * The screen-context source picker (spec 2026-10-22 §3.1): the modal that
 * opens before a run starts with Screen context on, and again from the chip's
 * Choose again. Presentational: `MainPanel` fetches the choices and answers the
 * session's pick with what is chosen here.
 *
 * Its states, one at a time: macOS refused Screen Recording (the setting that
 * fixes it, no list); the chosen area being checked for its first frame
 * (nothing to choose, Cancel off — the pick has been answered); the portal's one
 * button (Wayland, where the desktop shows its own chooser); or Sokuji's own
 * list, windows first, then whole screens. The privacy line sits above
 * whichever picker shows.
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader, ShieldAlert } from 'lucide-react';
import Modal from '../Modal/Modal';
import type { PickReason } from '../../app/screenContext';
import type { CaptureSourceInfo } from '../../lib/screen/desktopFrames';
import './SourcePicker.scss';

export interface SourcePickerProps {
  open: boolean;
  mode: 'list' | 'portal';
  /** macOS: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'; elsewhere 'granted'. */
  screenRecording: string;
  sources: CaptureSourceInfo[] | null;   // null while loading
  /** Shown again because the last pick yielded no frame: the `picker.nothingVisible` line above the list (`nothingVisibleRunning` while `running`). */
  reason?: PickReason;
  /** The pick is answered and its area is checked for a first frame: nothing to choose, and Cancel is off. */
  checking?: boolean;
  /** Opened by Choose again during a run: Cancel keeps the area already shared, so it says Cancel. */
  running?: boolean;
  onPick(source: CaptureSourceInfo): void;
  onPortal(): void;                       // 'portal' mode's one button
  onCancel(): void;
  onOpenPrivacy(): void;
}

export function SourcePicker(p: SourcePickerProps) {
  const { t } = useTranslation();
  const denied = p.screenRecording === 'denied' && !p.checking;
  const cancel = () => {
    if (!p.checking) p.onCancel();
  };

  return (
    <Modal isOpen={p.open} onClose={cancel} title={t('screenContext.picker.title', 'Choose what Qwen may see')}>
      <div className="source-picker">
        {denied ? (
          <div className="source-picker__denied">
            <ShieldAlert size={20} aria-hidden="true" />
            <div>
              <p className="source-picker__denied-title">{t('screenContext.picker.deniedTitle', 'Screen Recording permission needed')}</p>
              <p className="source-picker__text">
                {t('screenContext.picker.deniedText', 'macOS lets Sokuji see the screen only with Screen Recording permission. Grant it in System Settings, then restart Sokuji and start again.')}
              </p>
              <button type="button" className="source-picker__primary" onClick={p.onOpenPrivacy}>
                {t('screenContext.picker.openSettings', 'Open System Settings')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="source-picker__privacy">
              {t('screenContext.picker.privacy', "Everything inside the area you choose is sent to Alibaba Cloud's Qwen service, in the region of this session, as pictures — nothing else on your screen. Kizuna AI does not receive them.")}
            </p>
            {p.checking ? (
              <p className="source-picker__status" role="status">
                <Loader size={14} className="source-picker__spinner" aria-hidden="true" />
                {t('screenContext.picker.checking', 'Checking the picture…')}
              </p>
            ) : (
              <>
                {p.reason === 'nothingVisible' && (
                  <p className="source-picker__reason" role="status">
                    {/* During a run (Choose again) there is no start to go without: Cancel keeps the session as it is. */}
                    {p.running
                      ? t('screenContext.picker.nothingVisibleRunning', 'The area you chose shows nothing right now. Pick another, or keep the session as it is.')
                      : t('screenContext.picker.nothingVisible', 'The area you chose shows nothing right now. Pick another, or start without screen context.')}
                  </p>
                )}
                {p.mode === 'portal' ? (
                  <button type="button" className="source-picker__primary" onClick={p.onPortal}>
                    {t('screenContext.picker.portal', 'Choose a window or screen…')}
                  </button>
                ) : (
                  <SourceList sources={p.sources} onPick={p.onPick} />
                )}
              </>
            )}
          </>
        )}
        <div className="source-picker__footer">
          <button type="button" className="source-picker__cancel" onClick={cancel} disabled={p.checking}>
            {p.running ? t('common.cancel', 'Cancel') : t('screenContext.picker.cancel', 'Start without screen context')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Sokuji's own list: loading, nothing found, or the windows then the screens. */
function SourceList({ sources, onPick }: { sources: CaptureSourceInfo[] | null; onPick(source: CaptureSourceInfo): void }) {
  const { t } = useTranslation();
  if (sources === null) {
    return (
      <p className="source-picker__status" role="status">
        <Loader size={14} className="source-picker__spinner" aria-hidden="true" />
        {t('screenContext.picker.loading', 'Looking for windows…')}
      </p>
    );
  }
  if (sources.length === 0) {
    return <p className="source-picker__status">{t('screenContext.picker.none', 'No window or screen to share was found.')}</p>;
  }
  const windows = sources.filter((s) => s.kind === 'window');
  const screens = sources.filter((s) => s.kind === 'screen');
  return (
    <>
      {windows.length > 0 && <SourceGroup title={t('screenContext.picker.windows', 'Windows')} sources={windows} onPick={onPick} />}
      {screens.length > 0 && <SourceGroup title={t('screenContext.picker.screens', 'Screens')} sources={screens} onPick={onPick} />}
    </>
  );
}

function SourceGroup({ title, sources, onPick }: { title: string; sources: CaptureSourceInfo[]; onPick(source: CaptureSourceInfo): void }) {
  const id = useId();
  return (
    <div className="source-picker__group" role="group" aria-labelledby={id}>
      <h4 id={id} className="source-picker__group-title">{title}</h4>
      <div className="source-picker__grid">
        {sources.map((source) => (
          // Named by the title it shows; the picture inside a button is not read separately.
          <button key={source.id} type="button" className="source-picker__source" aria-label={source.name} onClick={() => onPick(source)}>
            <img className="source-picker__thumb" src={source.thumbnail} alt={source.name} />
            <span className="source-picker__name">
              {source.appIcon && <img className="source-picker__icon" src={source.appIcon} alt="" />}
              <span className="source-picker__title">{source.name}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

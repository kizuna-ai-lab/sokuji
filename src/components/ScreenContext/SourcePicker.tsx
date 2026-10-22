/**
 * The screen-context source picker (spec 2026-10-22 §3.1): the modal that
 * opens from the settings when the Screen context switch goes on (or Change),
 * at Start when nothing usable is held, and from the chip's Choose again.
 * Presentational: `MainPanel` fetches the choices and answers the asker with
 * what is chosen here.
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
import { Loader, RefreshCw, ShieldAlert } from 'lucide-react';
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
  /**
   * Why it is shown at Start, as a line above the list: the last pick yielded no frame (`picker.nothingVisible`;
   * `nothingVisibleRunning` for Choose again), or the window or screen picked cannot be captured (`picker.gone`).
   */
  reason?: PickReason;
  /** The pick is answered and its area is checked for a first frame: nothing to choose, and Cancel is off. */
  checking?: boolean;
  /**
   * Who asks: a Start (Cancel starts without screen context, so it says so), Choose again during a run (Cancel keeps
   * the area already shared) or the settings (Cancel leaves them as they were) — the last two say Cancel.
   */
  purpose: 'start' | 'choose-again' | 'settings';
  onPick(source: CaptureSourceInfo): void;
  onPortal(): void;                       // 'portal' mode's one button
  onCancel(): void;
  onOpenPrivacy(): void;
  /** Asks the desktop for its windows and screens again: the list is a snapshot, a window opened since is not on it. */
  onRefresh(): void;
  /** A Refresh is out: the list stays, the button turns until the answer lands. */
  refreshing?: boolean;
}

export function SourcePicker(p: SourcePickerProps) {
  const { t } = useTranslation();
  const denied = p.screenRecording === 'denied' && !p.checking;
  const cancel = () => {
    if (!p.checking) p.onCancel();
  };

  return (
    // At Start, closing is Start without screen context, which turns the switch off: the X and that button do it, a stray click beside the modal does not.
    <Modal isOpen={p.open} onClose={cancel} dismissOnBackdrop={p.purpose !== 'start'} title={t('screenContext.picker.title', 'Choose what the model can see')}>
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
                    {p.purpose === 'choose-again'
                      ? t('screenContext.picker.nothingVisibleRunning', 'The area you chose shows nothing right now. Pick another, or keep the session as it is.')
                      : t('screenContext.picker.nothingVisible', 'The area you chose shows nothing right now. Pick another, or start without screen context.')}
                  </p>
                )}
                {p.reason === 'gone' && (
                  <p className="source-picker__reason" role="status">
                    {t('screenContext.picker.gone', "The window or screen you chose can't be captured right now. Pick another, or start without screen context.")}
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
          {/* Only where Sokuji's own list shows: the portal and the denied state have no list to look at again. */}
          {!denied && !p.checking && p.mode === 'list' && (
            <button type="button" className="source-picker__refresh" onClick={p.onRefresh} disabled={p.sources === null || p.refreshing}>
              <RefreshCw size={14} className={p.refreshing ? 'source-picker__spinner' : undefined} aria-hidden="true" />
              {t('screenContext.picker.refresh', 'Refresh')}
            </button>
          )}
          <button type="button" className="source-picker__cancel" onClick={cancel} disabled={p.checking}>
            {p.purpose === 'start' ? t('screenContext.picker.cancel', 'Start without screen context') : t('common.cancel', 'Cancel')}
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
  // The desktop lists no minimized window (X11 and macOS leave them out; Windows lists them but captures them black): said under the list, where the Refresh is.
  const hint = <p className="source-picker__hint">{t('screenContext.picker.minimizedHint', "Minimized windows aren't listed: restore the window, then Refresh.")}</p>;
  if (sources.length === 0) {
    return (
      <>
        <p className="source-picker__status">{t('screenContext.picker.none', 'No window or screen to share was found.')}</p>
        {hint}
      </>
    );
  }
  const windows = sources.filter((s) => s.kind === 'window');
  const screens = sources.filter((s) => s.kind === 'screen');
  return (
    <>
      {windows.length > 0 && <SourceGroup title={t('screenContext.picker.windows', 'Windows')} sources={windows} onPick={onPick} />}
      {screens.length > 0 && <SourceGroup title={t('screenContext.picker.screens', 'Screens')} sources={screens} onPick={onPick} />}
      {hint}
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

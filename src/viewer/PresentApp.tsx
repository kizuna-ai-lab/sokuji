// src/viewer/PresentApp.tsx
/** The projector page (spec 2026-10-04 §6): opened by the host into its own window, from loopback only. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QrCode from '../components/CaptionShare/QrCode';
import { languageLabel } from '../lib/language/label';
import type { PresentInfo } from '../lib/share/types';
import { wifiQrText } from '../lib/share/wifiQr';
import { viewerT } from './strings';
import './present.scss';

// The host's window passes Sokuji's UI language as `?lang=`: this window's own
// navigator.languages is the OS locale, which may not be the language the host uses.
const languages = (): readonly string[] => {
  const ui = new URLSearchParams(window.location.search).get('lang');
  const browser = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return ui ? [ui, ...browser] : browser;
};

export default function PresentApp(): React.ReactElement {
  const { t, catalog } = useMemo(() => viewerT(languages()), []);
  const [info, setInfo] = useState<PresentInfo | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const source = new EventSource('/present/events');
    source.addEventListener('present', (event) => {
      try {
        setInfo(JSON.parse((event as MessageEvent<string>).data) as PresentInfo);
      } catch {
        // A frame that does not parse is skipped; the next one replaces it.
      }
    });
    source.addEventListener('ended', () => {
      setEnded(true);
      source.close();
    });
    return () => source.close();
  }, []);

  useEffect(() => { document.title = t('viewer.present.windowTitle'); }, [t]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Full screen refused: the window stays as it is.
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  if (ended) return <main className="present present--ended"><h1>{t('viewer.present.ended')}</h1></main>;
  if (!info) return <main className="present" />;

  const name = (code: string) => languageLabel(code, catalog, t('viewer.original'));
  return (
    <main className="present">
      <header className="present__head">
        <h1>{t('viewer.present.title')}</h1>
        {/* A host whose provider has not loaded sends two blank codes: no pair to name yet. */}
        <p>{info.pair.source && info.pair.target
          ? `${name(info.pair.source)} ⇄ ${name(info.pair.target)} · ${t('viewer.present.noInstall')}`
          : t('viewer.present.noInstall')}</p>
        <button type="button" className="present__fullscreen" onClick={() => void toggleFullscreen()}>{t('viewer.present.fullscreen')}</button>
      </header>
      <ol className={`present__steps ${info.wifi ? 'present__steps--wifi' : ''}`.trim()}>
        {info.wifi && (
          <li className="present__step">
            <span className="present__n">1</span>
            <QrCode value={wifiQrText(info.wifi.ssid, info.wifi.password)} label={info.wifi.ssid} size={220} />
            <b>{t('viewer.present.step1')}</b>
            <span className="present__mono">{info.wifi.ssid}</span>
            {info.wifi.password && <span className="present__mono">{t('viewer.present.password', { password: info.wifi.password })}</span>}
          </li>
        )}
        <li className="present__step">
          <span className="present__n">{info.wifi ? 2 : 1}</span>
          {info.url && <QrCode value={info.url} label={info.url} size={220} />}
          <b>{t('viewer.present.step2')}</b>
          <span className="present__address">{info.url}</span>
        </li>
        <li className="present__step present__step--text">
          <span className="present__n">{info.wifi ? 3 : 2}</span>
          <b className="present__big">{t('viewer.present.step3')}</b>
        </li>
      </ol>
      <footer className="present__foot">
        {/* Chrome on Android reaches a LAN address only with "Nearby devices"
            allowed, and the viewer page cannot load to say so (his live test 2026-10-05). */}
        <div className="present__notes">
          <span>{t('viewer.present.sameNetwork')}</span>
          <span>{t('viewer.present.androidChrome')}</span>
        </div>
        <span className="present__count">{t('viewer.present.watching', { count: info.viewers })}</span>
      </footer>
    </main>
  );
}

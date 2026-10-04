// src/viewer/ViewerApp.tsx
/**
 * The LAN caption viewer (spec 2026-10-04 §5): entering, the captions, the
 * layout by width, settings, and the states over the share stream.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { languageLabel } from '../lib/language/label';
import { downloadFile, exportFilename } from '../utils/conversationExport';
import CaptionList from './CaptionList';
import EntryScreen from './EntryScreen';
import { keepAwake } from './keepAwake';
import { defaultSize, layoutFor, SIZES, stepSize, THEMES, type Size, type Theme } from './layout';
import { legsOf, statusOf } from './model';
import { readPref, writePref } from './prefs';
import Segmented from './Segmented';
import SettingsPanel from './SettingsPanel';
import { viewerT } from './strings';
import { defaultChoice, validChoice, type Choice } from './text';
import { transcriptText } from './transcript';
import { useViewerStream } from './useViewerStream';
import { STATUS_KEYS, StatusLine, TopBar } from './ViewerBar';
import './viewer.scss';

const isSize = (v: unknown): v is Size => typeof v === 'string' && (SIZES as readonly string[]).includes(v);
const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isChoice = (v: unknown): v is Choice =>
  typeof v === 'object' && v !== null && typeof (v as Choice).code === 'string' && typeof (v as Choice).both === 'boolean';

const languages = (): readonly string[] => (navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]);

const ViewerApp: React.FC = () => {
  const { t, catalog } = useMemo(() => viewerT(languages()), []);
  const model = useViewerStream();
  const status = statusOf(model);
  // A host whose provider has not loaded sends two blank codes: no pair yet.
  const sent = model.state?.pair;
  const pair = sent && sent.source && sent.target ? sent : null;
  const [width, setWidth] = useState(() => window.innerWidth);
  const layout = layoutFor(width);
  const [entered, setEntered] = useState(false);
  const [stored, setStored] = useState<Choice | null>(() => readPref('choice', null as Choice | null, (v): v is Choice | null => v === null || isChoice(v)));
  const [size, setSize] = useState<Size>(() => readPref('size', defaultSize(layoutFor(window.innerWidth)), isSize));
  const [theme, setTheme] = useState<Theme>(() => readPref('theme', 'dark', isTheme));
  const [completeOnly, setCompleteOnly] = useState(() => readPref('completeOnly', false, isBool));
  const [awake, setAwake] = useState(() => readPref('keepAwake', true, isBool));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const name = useCallback((code: string) => languageLabel(code, catalog, t('viewer.original')), [catalog, t]);
  const choice: Choice = pair ? validChoice(stored ?? defaultChoice(pair, languages()), pair) : { code: '', both: true };
  const choose = (next: Choice) => { setStored(next); writePref('choice', next); };
  const changeSize = (next: Size) => { setSize(next); writePref('size', next); };

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  useEffect(() => {
    document.title = `${status === 'live' ? '● ' : ''}${t(STATUS_KEYS[status])} · ${t('viewer.title')}`;
  }, [status, t]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Not every browser lets a page go full screen (iPhone Safari): nothing to do.
    }
  }, []);

  useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') changeSize(stepSize(size, 1));
      else if (e.key === '-') changeSize(stepSize(size, -1));
      else if (e.key === 'b' || e.key === 'B') choose({ ...choice, both: !choice.both });
      else if (e.key === 'f' || e.key === 'F') void toggleFullscreen();
      else if (e.key === 'End') setFollowing(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The browser pauses the keep-awake video while the page is hidden; turn it
  // on again on the way back (spec §5.6). The video was first started by a tap.
  useEffect(() => {
    if (!entered || !awake) return undefined;
    const onVisibility = () => { if (document.visibilityState === 'visible') void keepAwake(true); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [entered, awake]);

  const start = () => {
    setEntered(true);
    if (awake) void keepAwake(true);
  };
  const changeAwake = (on: boolean) => {
    setAwake(on);
    writePref('keepAwake', on);
    void keepAwake(on);
  };
  const save = () => {
    const now = Date.now();
    downloadFile(transcriptText(model.entries, choice, t, now), exportFilename('txt', now), 'text/plain;charset=utf-8');
  };

  if (!entered) {
    return (
      <div className={`viewer viewer--${layout} viewer--${theme}`}>
        <EntryScreen t={t} name={name} pair={pair} choice={choice} onChoose={choose} onStart={start} />
      </div>
    );
  }

  const legs = legsOf(model.entries);
  const twoLegs = legs.speaker && legs.participant;
  // Both languages: the chosen code leads. Tapping the selected "both" again
  // swaps the order, and its label names the order shown (his ruling 2026-10-04).
  const other = pair && (choice.code === pair.source ? pair.target : pair.source);
  const onChoice = (v: string) => {
    if (!pair) return;
    if (v !== 'both') choose({ code: v, both: false });
    else if (choice.both && other) choose({ code: other, both: true });
    else choose({ code: choice.code || pair.target, both: true });
  };
  const choiceControl = pair ? (
    <Segmented
      label={t('viewer.settings.iRead')}
      value={choice.both ? 'both' : choice.code}
      onChange={onChoice}
      options={[
        { value: pair.source, label: name(pair.source) },
        { value: 'both', label: choice.both && other ? `${name(choice.code)} ⇄ ${name(other)}` : t('viewer.enter.both') },
        { value: pair.target, label: name(pair.target) },
      ]}
    />
  ) : null;
  const emptyText = t(STATUS_KEYS[status]);
  const classes = [
    'viewer', `viewer--${layout}`, `viewer--${theme}`, `viewer--size-${size}`,
    choice.both ? 'viewer--both' : '', twoLegs ? 'viewer--two-legs' : '', fullscreen ? 'viewer--fullscreen' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {layout === 'phone' ? (
        <StatusLine t={t} status={status} onSettings={() => setSettingsOpen(true)} />
      ) : !fullscreen && (
        <TopBar t={t} status={status} choice={choiceControl}
          onSmaller={() => changeSize(stepSize(size, -1))} onLarger={() => changeSize(stepSize(size, 1))} onMore={() => setSettingsOpen(true)} />
      )}
      <CaptionList t={t} entries={model.entries} choice={choice} completeOnly={completeOnly} layout={layout} twoLegs={twoLegs}
        notice={model.notice} emptyText={emptyText} following={following} onFollowingChange={setFollowing} />
      {layout === 'desktop' && !fullscreen && <footer className="viewer-footer"><span>{t('viewer.settings.aiNote')}</span><span>{t('viewer.shortcuts')}</span></footer>}
      {settingsOpen && (
        <SettingsPanel
          t={t} layout={layout} choiceControl={choiceControl}
          size={size} onSize={changeSize}
          theme={theme} onTheme={(v) => { setTheme(v); writePref('theme', v); }}
          completeOnly={completeOnly} onCompleteOnly={(v) => { setCompleteOnly(v); writePref('completeOnly', v); }}
          awake={awake} onAwake={changeAwake}
          allowSave={model.state?.allowSave === true} onSave={save}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default ViewerApp;

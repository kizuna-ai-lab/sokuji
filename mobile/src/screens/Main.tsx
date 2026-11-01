import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, ScrollView, useWindowDimensions, View, type HostInstance } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';
import { CircleAlert, History as HistoryIcon, Menu, Play, RefreshCw, Settings as SettingsIcon, Square, UserRound } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { refocus } from '@/components/focus';
import { LanguagePair } from '@/components/LanguagePair';
import { LanguagePicker } from '@/components/LanguagePicker';
import { useBusy } from '@/lib/useBusy';
import { useIconSize } from '@/lib/useIconSize';
import { cn } from '@/lib/utils';
import { languageName, sourceOptions, targetOptions } from '../i18n/languages';
import { headerLine, idleHint, PAIR_STACK_FROM_FONT_SCALE, pairArrow, pairLayout, statusTone } from './mainText';
import type { Entry } from '@shared/lib/projection/types';
import { startSession, type Status } from '../session/session';
import { endReason } from '../session/endReason';
import { createTranscript, type Transcript } from '../session/transcript';
import { createEntriesFeed } from '../session/entriesFeed';
import { useSettings } from '../store/useSettings';
import { sessionStore } from '../store/useSessionActive';
import { useApp } from '../navigation/context';
import type { AppNavigation } from '../navigation/routes';
import Subtitles from './Subtitles';
import type { StoredSession } from '../history/store';
import { capture, platform, sessionEndProperties, sessionStartProperties } from '../analytics';

const KEEP_AWAKE_TAG = 'sokuji-session';

// The history store writes the running session every minute (ticker time) and at its end.
const CHECKPOINT_MS = 60000;

// The main screen: the only one without the system's bar (its own one-line
// bar carries the status and the menu); the others are routes beside it.
export default function Main() {
  const { t, i18n } = useTranslation();
  const { token, email, history, onSignInRequired } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const [status, setStatus] = useState<Status | 'idle'>('idle');
  const [detail, setDetail] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [stopping, runStop] = useBusy();
  const menuButton = useRef<HostInstance>(null);
  // The language lists open from the main screen (owner, 2026-11-01): which
  // side the sheet is for outlives its closing, so it keeps its title and list
  // while it slides away, and focus goes back to that side.
  const [picking, setPicking] = useState(false);
  const [side, setSide] = useState<'source' | 'target'>('source');
  // A press on the locked pair: the reason stands in the status line for a moment.
  const [lockedNote, setLockedNote] = useState(false);
  const lockedNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceSide = useRef<HostInstance>(null);
  const targetSide = useRef<HostInstance>(null);
  const ui = i18n.language;
  const autoLabel = t('common.autoDetect');
  const sources = useMemo(() => sourceOptions(ui, autoLabel), [ui, autoLabel]);
  const targets = useMemo(() => targetOptions(ui), [ui]);
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const menuIcon = useIconSize(24);
  const actionIcon = useIconSize(18);
  // How many layouts a language name has wrapped in (see pairLayout): each
  // wrap gives the pair more room, and only new names, text size or width
  // start over, so the bar never flips back and forth.
  const [overflow, setOverflow] = useState(0);
  const source = languageName(settings.source, ui, autoLabel);
  const target = languageName(settings.target, ui);
  useEffect(() => { setOverflow(0); }, [source, target, fontScale, width]);
  const layout = pairLayout(fontScale, overflow);
  const level = layout === 'row' ? 0 : layout === 'stacked' ? 1 : 2;
  // A wrap in the current layout moves to the next one, once.
  const onWrap = () => setOverflow((o) => (o === level ? o + 1 : o));
  const session = useRef<{ stop(): Promise<void> } | null>(null);
  const feed = useRef<{ stop(): void } | null>(null);
  const transcript = useRef<Transcript | null>(null);
  const stored = useRef<StoredSession | null>(null);
  const errors = useRef(0);
  const started = useRef(false);
  const lastEvent = useRef<{ status: string; detail?: string } | null>(null);

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';
  // The other screens lock what a running session holds (see store/session.ts);
  // a Main that goes mid-session (the token dropped) takes the flag with it.
  useEffect(() => {
    sessionStore.getState().setActive(active);
    return () => { sessionStore.getState().setActive(false); };
  }, [active]);

  // Unmounted with a session running (the app dropped the token): nothing outlives the screen.
  useEffect(() => () => { void session.current?.stop(); }, []);
  useEffect(() => () => { if (lockedNoteTimer.current) clearTimeout(lockedNoteTimer.current); }, []);

  // The session has released everything it held (microphone, notification,
  // lease); the screen releases its part and draws the transcript's last state.
  function snapshot(lastStatus: string, endedAt: number | null): StoredSession | null {
    const base = stored.current;
    const tr = transcript.current;
    if (!base || !tr) return null;
    return { ...base, leg: tr.leg(), lastStatus, endedAt };
  }

  function ended(reason: string) {
    // Every open segment becomes final before the snapshot is saved.
    transcript.current?.end();
    const last = snapshot(reason, Date.now());
    if (last && last.leg.segments.length > 0) void history.save(last);
    if (started.current && stored.current) {
      capture('translation_session_end', sessionEndProperties({ sessionId: stored.current.id, durationMs: Date.now() - stored.current.startedAt, errorCount: errors.current }));
    }
    started.current = false;
    session.current = null;
    feed.current?.stop();
    feed.current = null;
    setEntries([...(transcript.current?.entries() ?? [])].reverse());
    deactivateKeepAwake(KEEP_AWAKE_TAG);
  }

  async function start() {
    // A second tap while the first is still starting would open a second
    // recorder and lease loop that nothing could stop: the handle is set
    // before the first await, and Start is Stop from the same render on.
    if (session.current) return;
    const { source, target, region } = settings;
    // One clock reading for the session: the transcript's id and the saved session's are the same.
    const startedAt = Date.now();
    const tr = createTranscript({ source, target, sessionId: `s-${startedAt}` });
    transcript.current = tr;
    const f = createEntriesFeed({
      transcript: tr,
      isActive: () => AppState.currentState === 'active',
      onActiveChange: (cb) => {
        const sub = AppState.addEventListener('change', (state) => cb(state === 'active'));
        return () => sub.remove();
      },
      now: Date.now,
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
    });
    f.subscribe(setEntries);
    feed.current = f;
    stored.current = { id: `s-${startedAt}`, startedAt, endedAt: null, source, target, leg: tr.leg(), lastStatus: 'leasing' };
    errors.current = 0;
    started.current = false;
    lastEvent.current = null;
    setEntries([]);
    // A note from the last session must not outlive it into this one's start.
    setLockedNote(false);
    if (lockedNoteTimer.current) clearTimeout(lockedNoteTimer.current);
    setStatus('leasing');
    setDetail('');
    session.current = startSession({
      token,
      region,
      source,
      target,
      transcript: tr,
      listen: settings.listen ? { voice: settings.voice, speed: settings.speed } : null,
      inputDeviceId: settings.inputDeviceId,
      checkpointMs: CHECKPOINT_MS,
      onCheckpoint: () => {
        const snap = snapshot('listening', null);
        if (snap && snap.leg.segments.length > 0) void history.save(snap);
      },
      onEvent: (e) => {
        if (e.type !== 'status') return;
        setStatus(e.status);
        setDetail(e.detail ?? '');
        // The desktop's two session events: at the first listening, and at the end.
        if (e.status === 'listening' && !started.current && stored.current) {
          started.current = true;
          // What the backend granted (a voice only with headphones in, and only if granted), not the setting.
          capture('translation_session_start', sessionStartProperties({ sessionId: stored.current.id, source, target, platform, participantSpeech: e.voice === true }));
        }
        // A failure counts once: the retry that follows repeats its detail on the status line.
        const prev = lastEvent.current;
        if (e.status === 'reconnecting' && e.detail && !(prev?.status === 'reconnecting' && prev.detail === e.detail)) errors.current += 1;
        lastEvent.current = e;
        if (e.status === 'error' || e.status === 'stopped') ended(endReason(e.status, e.detail));
        // The sign-in session is gone: the transcript is saved above; the app shows the sign-in screen.
        if (e.status === 'error' && e.detail === 'sign_in_required') onSignInRequired();
        // The balance ran out: the account screen says so and how to top up.
        if (e.status === 'error' && e.detail === 'balance_exhausted') navigation.navigate('Account');
      },
    });
    if (settings.keepAwake) {
      try {
        await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        // Ended before the keep-awake was granted: give it back.
        if (!session.current) deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch (err) {
        // The session runs either way; the screen may dim.
        console.warn(`keep awake: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async function stop() {
    await session.current?.stop();
  }

  const openPicker = (which: 'source' | 'target') => {
    setSide(which);
    setPicking(true);
  };
  const closePicker = () => {
    refocus(side === 'source' ? sourceSide : targetSide);
    setPicking(false);
  };

  const shown = stopping ? 'stopping' : status;
  const line = headerLine(t, shown, detail, lockedNote);
  const tone = statusTone(shown);
  const stacked = layout !== 'row';
  // The idle hint reads from the start only at the accessibility sizes (Sophie, iOS):
  // the bar's layout says nothing about the text size.
  const large = fontScale >= PAIR_STACK_FROM_FONT_SCALE;

  return (
    // Without the system's bar, the screen keeps off the status bar itself.
    <SafeAreaView className="bg-background w-full flex-1" edges={['top', 'bottom', 'left', 'right']}>
      <View className="border-border min-h-12 flex-row items-center gap-2 border-b pe-1 ps-4">
        <View className="flex-1 flex-row items-center gap-2" accessibilityLiveRegion="polite">
          {tone === 'error' ? <Icon as={CircleAlert} size={18} className="text-destructive" /> : null}
          {tone === 'warning' ? <Icon as={RefreshCw} size={18} className="text-foreground" /> : null}
          {line ? (
            <Text className={cn('flex-1 text-sm', tone === 'error' && 'text-destructive', tone === 'warning' && 'text-foreground font-medium', tone === 'normal' && 'text-muted-foreground')}>{line}</Text>
          ) : (
            <Text role="heading" className="flex-1 text-lg font-semibold">Sokuji</Text>
          )}
        </View>
        <DropdownMenu onOpenChange={(open) => { if (!open) refocus(menuButton); }}>
          <DropdownMenuTrigger asChild>
            <Button ref={menuButton} variant="ghost" size="icon" accessibilityLabel={t('mobile.main.menu')}>
              <Icon as={Menu} size={menuIcon} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" insets={{ top: insets.top, bottom: insets.bottom, left: 12, right: 12 }} className="max-w-[90%]">
            {email ? (
              <>
                <DropdownMenuLabel className="text-muted-foreground">{email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onPress={() => navigation.navigate('History')}>
              <Icon as={HistoryIcon} size={20} />
              <Text>{t('mobile.menu.history')}</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => navigation.navigate('Account')}>
              <Icon as={UserRound} size={20} />
              <Text>{t('mobile.menu.account')}</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => navigation.navigate('Settings')}>
              <Icon as={SettingsIcon} size={20} />
              <Text>{t('mobile.menu.settings')}</Text>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {/* Nothing to read yet (before the first Start, or after a session that heard nothing): what Start does. */}
      {!active && entries.length === 0 ? (
        // It scrolls, at the system's text size: at AX5 it was cut at the right and after
        // three lines (Sophie, iOS). Centred at normal sizes, from the start beyond.
        <ScrollView className="flex-1" contentContainerClassName="flex-grow justify-center px-8 py-4">
          <Text className={cn('text-muted-foreground text-lg', large ? 'text-left' : 'text-center')}>
            {idleHint(t, target)}
          </Text>
        </ScrollView>
      ) : (
        <Subtitles entries={entries} bilingual={settings.bilingual} textSize={settings.textSize} />
      )}
      {/* The bar: the pair, each side its own choice, and Start, all at least 48
          units tall (header, pair and Start at one height) with 8 above and below.
          When a name does not fit beside Start the pair takes its own line, then
          its sides stack; at the largest text sizes they stack outright. The bar
          grows with its text, which keeps the system size. */}
      <View className="border-border gap-2 border-t px-4 py-2">
        <View className={cn('gap-2', !stacked && 'flex-row items-stretch')}>
          <LanguagePair
            className={stacked ? 'self-stretch' : 'flex-1'}
            source={source}
            target={target}
            arrow={pairArrow(i18n.dir(ui) === 'rtl')}
            layout={layout === 'column' ? 'column' : 'row'}
            onWrap={onWrap}
            measureKey={`${layout}:${fontScale}:${width}`}
            hearLabel={t('mobile.main.hear')}
            readLabel={t('mobile.main.read')}
            hearHint={t('mobile.main.pickHear')}
            readHint={t('mobile.main.pickRead')}
            locked={active}
            lockedReason={t('mobile.settings.locked')}
            onPressSource={() => openPicker('source')}
            onPressTarget={() => openPicker('target')}
            onPressLocked={() => {
              // A screen reader does not activate a side it hears as disabled; said here for the ones that do.
              AccessibilityInfo.announceForAccessibility(t('mobile.settings.locked'));
              setLockedNote(true);
              if (lockedNoteTimer.current) clearTimeout(lockedNoteTimer.current);
              lockedNoteTimer.current = setTimeout(() => setLockedNote(false), 3000);
            }}
            sourceRef={sourceSide}
            targetRef={targetSide}
          />
          {active ? (
            <Button variant="destructive" className={cn(stacked && 'self-stretch')} disabled={stopping} onPress={() => { void runStop(stop); }}>
              <Icon as={Square} size={actionIcon} />
              <Text>{stopping ? t('mobile.main.status.stopping') : t('mobile.main.stop')}</Text>
            </Button>
          ) : (
            <Button className={cn(stacked && 'self-stretch')} onPress={() => { void start(); }}>
              <Icon as={Play} size={actionIcon} />
              <Text>{t('mobile.main.start')}</Text>
            </Button>
          )}
        </View>
      </View>
      <LanguagePicker
        visible={picking}
        title={side === 'target' ? t('mobile.main.read') : t('mobile.main.hear')}
        options={side === 'target' ? targets : sources}
        value={side === 'target' ? settings.target : settings.source}
        onPick={(code) => {
          set(side === 'target' ? { target: code } : { source: code });
          closePicker();
        }}
        onClose={closePicker}
      />
    </SafeAreaView>
  );
}

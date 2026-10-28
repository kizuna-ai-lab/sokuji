import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, useWindowDimensions, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';
import { CircleAlert, History as HistoryIcon, Menu, Play, Settings as SettingsIcon, Square, UserRound } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { refocus } from '@/components/focus';
import { useBusy } from '@/lib/useBusy';
import { cn } from '@/lib/utils';
import { languageName } from '../i18n/languages';
import { idleHint, pairLabel, statusLine, statusTone } from './mainText';
import type { Entry } from '@shared/lib/projection/types';
import { startSession, type Status } from '../session/session';
import { endReason } from '../session/endReason';
import { createTranscript, type Transcript } from '../session/transcript';
import { createEntriesFeed } from '../session/entriesFeed';
import { useSettings } from '../store/useSettings';
import Subtitles from './Subtitles';
import Account from './Account';
import Settings from './Settings';
import History from './History';
import Listen from './Listen';
import Devices from './Devices';
import { createHistoryStore, type StoredSession } from '../history/store';
import { documentFs } from '../history/fs';
import { capture, platform, sessionEndProperties, sessionStartProperties } from '../analytics';

const KEEP_AWAKE_TAG = 'sokuji-session';

// From about the first accessibility size the pair takes its own line above Start.
const STACK_FROM_FONT_SCALE = 1.35;

type Screen = 'main' | 'account' | 'settings' | 'history' | 'listen' | 'devices';

// The history store writes the running session every minute (ticker time) and at its end.
const CHECKPOINT_MS = 60000;
const history = createHistoryStore(documentFs);

export default function Main({ token, email, onSignOut, onAccountDeleted, onSignInRequired }: { token: string; email: string; onSignOut: () => void; onAccountDeleted: () => void;
  /** The sign-in session is gone (a 401 mid-session): the app drops the token and shows the sign-in screen. */
  onSignInRequired: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const [status, setStatus] = useState<Status | 'idle'>('idle');
  const [detail, setDetail] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [screen, setScreen] = useState<Screen>('main');
  const [stopping, runStop] = useBusy();
  const menuButton = useRef<HostInstance>(null);
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const session = useRef<{ stop(): Promise<void> } | null>(null);
  const feed = useRef<{ stop(): void } | null>(null);
  const transcript = useRef<Transcript | null>(null);
  const stored = useRef<StoredSession | null>(null);
  const errors = useRef(0);
  const started = useRef(false);
  const lastEvent = useRef<{ status: string; detail?: string } | null>(null);

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';

  // Android's Back: leave a sub-screen; on the main screen the system has it. An
  // open menu is closed by the menu itself, whose handler is registered later and runs first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'listen' || screen === 'devices') {
        setScreen('settings');
        return true;
      }
      if (screen !== 'main') {
        setScreen('main');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  // Unmounted with a session running (the app dropped the token): nothing outlives the screen.
  useEffect(() => () => { void session.current?.stop(); }, []);

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
    const tr = createTranscript({ source, target, sessionId: `s-${Date.now()}` });
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
    const startedAt = Date.now();
    stored.current = { id: `s-${startedAt}`, startedAt, endedAt: null, source, target, leg: tr.leg(), lastStatus: 'leasing' };
    errors.current = 0;
    started.current = false;
    lastEvent.current = null;
    setEntries([]);
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
          capture('translation_session_start', sessionStartProperties({ sessionId: stored.current.id, source, target, platform, participantSpeech: settings.listen }));
        }
        // A failure counts once: the retry that follows repeats its detail on the status line.
        const prev = lastEvent.current;
        if (e.status === 'reconnecting' && e.detail && !(prev?.status === 'reconnecting' && prev.detail === e.detail)) errors.current += 1;
        lastEvent.current = e;
        if (e.status === 'error' || e.status === 'stopped') ended(endReason(e.status, e.detail));
        // The sign-in session is gone: the transcript is saved above; the app shows the sign-in screen.
        if (e.status === 'error' && e.detail === 'sign_in_required') onSignInRequired();
        // The balance ran out: the account screen says so and how to top up.
        if (e.status === 'error' && e.detail === 'balance_exhausted') setScreen('account');
      },
    });
    if (settings.keepAwake) {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      // Ended before the keep-awake was granted: give it back.
      if (!session.current) deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }

  async function stop() {
    await session.current?.stop();
  }

  if (screen === 'account') {
    return <Account token={token} email={email} locked={active} onBack={() => setScreen('main')} onSignOut={onSignOut} onDeleted={onAccountDeleted} onSignInRequired={onSignInRequired} />;
  }
  if (screen === 'settings') return <Settings onBack={() => setScreen('main')} locked={active} onOpen={setScreen} />;
  if (screen === 'listen') return <Listen onBack={() => setScreen('settings')} />;
  if (screen === 'devices') return <Devices onBack={() => setScreen('settings')} />;
  if (screen === 'history') return <History store={history} onBack={() => setScreen('main')} />;

  const shown = stopping ? 'stopping' : status;
  const line = statusLine(t, shown, detail);
  const tone = statusTone(shown);
  const ui = i18n.language;
  const autoLabel = t('common.autoDetect');
  const target = languageName(settings.target, ui);
  const pair = pairLabel(languageName(settings.source, ui, autoLabel), target, i18n.dir(ui) === 'rtl');
  const stacked = fontScale >= STACK_FROM_FONT_SCALE;

  return (
    <View className="bg-background w-full flex-1">
      <View className="border-border min-h-14 flex-row items-center gap-2 border-b pe-1 ps-4">
        <View className="flex-1 flex-row items-center gap-2" accessibilityLiveRegion="polite">
          {tone === 'error' ? <Icon as={CircleAlert} size={18} className="text-destructive" /> : null}
          {line ? (
            <Text className={cn('flex-1 text-sm', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{line}</Text>
          ) : (
            <Text role="heading" className="flex-1 text-lg font-semibold">Sokuji</Text>
          )}
        </View>
        <DropdownMenu onOpenChange={(open) => { if (!open) refocus(menuButton); }}>
          <DropdownMenuTrigger asChild>
            <Button ref={menuButton} variant="ghost" size="icon" accessibilityLabel={t('mobile.main.menu')}>
              <Icon as={Menu} size={24} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" insets={{ top: insets.top, bottom: insets.bottom, left: 12, right: 12 }} className="max-w-[90%]">
            {email ? <DropdownMenuLabel className="text-muted-foreground">{email}</DropdownMenuLabel> : null}
            {email ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onPress={() => setScreen('history')}>
              <Icon as={HistoryIcon} size={20} />
              <Text>{t('mobile.menu.history')}</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => setScreen('account')}>
              <Icon as={UserRound} size={20} />
              <Text>{t('mobile.menu.account')}</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => setScreen('settings')}>
              <Icon as={SettingsIcon} size={20} />
              <Text>{t('mobile.menu.settings')}</Text>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {/* Nothing to read yet (before the first Start, or after a session that heard nothing): what Start does. */}
      {!active && entries.length === 0 ? (
        <View className="flex-1 justify-center px-8">
          <Text className="text-muted-foreground text-center text-lg">{idleHint(t, target)}</Text>
        </View>
      ) : (
        <Subtitles entries={entries} bilingual={settings.bilingual} textSize={settings.textSize} />
      )}
      <View className={cn('border-border gap-2 border-t px-4 py-3', !stacked && 'flex-row items-center')}>
        {/* Open in a session too: the settings say there why the languages are locked. */}
        <Button
          variant="outline"
          className={cn('justify-start', stacked ? 'self-stretch' : 'flex-1')}
          accessibilityHint={t('mobile.main.changeLanguages')}
          onPress={() => setScreen('settings')}
        >
          {/* text-left is the start side: React Native swaps left and right in a right-to-left layout. */}
          <Text className="shrink text-left">{pair}</Text>
        </Button>
        {active ? (
          <Button size="lg" variant="destructive" disabled={stopping} onPress={() => { void runStop(stop); }}>
            <Icon as={Square} size={18} />
            <Text>{stopping ? t('mobile.main.status.stopping') : t('mobile.main.stop')}</Text>
          </Button>
        ) : (
          <Button size="lg" onPress={() => { void start(); }}>
            <Icon as={Play} size={18} />
            <Text>{t('mobile.main.start')}</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

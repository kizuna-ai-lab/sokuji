import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, TriangleAlert, Wrench } from 'lucide-react';
import { changeLanguageWithLoad } from '../../locales';
import type { EchoCause, EchoNoticeState } from '../../lib/modern-audio/EchoMonitor';
import { BALANCE_BELOW_FLOOR, NO_MICROPHONE, QUOTA_PENDING } from '../../lib/session/shape';
import type { RunEnd, RunState } from '../../lib/session/types';
import type { DisplayItem, NoticeEntry } from '../../lib/view/filter';
import { actionForCode, actionLabel, type NoticeActionSpec } from '../../lib/view/noticeActions';
import { statusLine, type StatusLineInput } from '../../lib/view/statusLine';
import { Banner, type BannerProps } from '../Banner/Banner';
import { ConversationList } from '../Conversation/ConversationList';
import { PanelFooter } from '../MainPanel/panel/PanelFooter';
import { StatusLine } from '../MainPanel/StatusLine';
import { INTERFACE_LANGUAGES } from '../Settings/sections/interfaceLanguages';
import '../MainPanel/MainPanel.scss';

/**
 * Development builds only (`?preview=notices`, or Ctrl+Shift+L over the running
 * app): the three kinds of notice (spec 2026-10-05), every case of each, drawn
 * by the real components at a chosen width — event rows in the real
 * conversation list, every status line the selector can produce above the real
 * footer, every banner state. A page to look at, not a feature: nothing here
 * runs a session or touches a store, and the buttons do nothing.
 */

// ─── event: system rows ──────────────────────────────────────────────────────

export interface EventCase {
  /** What the case is, for the reader of the page (English, like every dev page). */
  label: string;
  notice: NoticeEntry;
  /** A panel note's own action; an L1 notice's comes from its code (`actionForCode`). */
  action?: NoticeActionSpec;
}

const notice = (id: string, severity: NoticeEntry['severity'], message: string, over: Partial<NoticeEntry> = {}): NoticeEntry =>
  ({ kind: 'notice', id, leg: 'speaker', severity, message, at: 0, ...over });

export const EVENT_CASES: readonly EventCase[] = [
  { label: 'error · budget_exhausted (the run ended; no action)', notice: notice('e1', 'error', 'The session budget is used up.', { code: 'budget_exhausted' }) },
  { label: 'error · leg_failed with the provider’s detail', notice: notice('e2', 'error', 'Invalid API key', { code: 'leg_failed' }) },
  { label: 'error · a provider’s own message, no code', notice: notice('e3', 'error', 'WebSocket closed before the session was confirmed (1006).') },
  { label: 'warning · voice_fallback → Settings (the run continues)', notice: notice('e4', 'warning', 'The chosen voice was unavailable, so another voice is used.', { code: 'voice_fallback' }) },
  { label: 'warning · mic_lost_using_other', notice: notice('e5', 'warning', 'The microphone went away, so another is being used instead.', { code: 'mic_lost_using_other', params: { lost: 'USB Mic', device: 'Built-in Microphone' } }) },
  { label: 'warning · silent_no_permission (a long one)', notice: notice('e6', 'warning', 'No audio has come through from the selected source yet.', { code: 'silent_no_permission' }) },
  { label: 'info · mic_now_using (transient, 8 s)', notice: notice('e7', 'info', 'Now using the microphone.', { code: 'mic_now_using', params: { device: 'USB Mic' }, lifetime: 'transient' }) },
  { label: 'panel note · export_copied (info, transient)', notice: notice('panel:1', 'info', 'Conversation copied to clipboard', { code: 'export_copied', lifetime: 'transient' }) },
  { label: 'panel note · export_copy_failed (warning, transient)', notice: notice('panel:2', 'warning', 'Failed to copy. Check browser permissions.', { code: 'export_copy_failed', lifetime: 'transient' }) },
  { label: 'panel note · autosave_saved → Show in folder', notice: notice('panel:3', 'info', 'Conversation saved', { code: 'autosave_saved', params: { filename: 'sokuji-2026-10-05-1112.txt' } }), action: { kind: 'show-in-folder', dir: '/home/me/Documents/Sokuji' } },
  { label: 'panel note · autosave_failed (warning)', notice: notice('panel:4', 'warning', "Couldn't auto-save the conversation.", { code: 'autosave_failed', params: { action: 'Download as .txt' } }) },
];

const SOURCE = 'Thanks for joining today. Shall we start with the schedule?';
const TRANSLATION = '感谢今天参加。我们先从日程开始，好吗？';

/** A bubble for the rows to sit under: one segment, its source and its translation. */
function bubble(segment: string): DisplayItem[] {
  const base = { leg: 'speaker' as const, languages: { source: 'en', target: 'zh-Hans' }, t: 0 };
  return [
    { kind: 'row', ...base, header: true, endsSegment: false, row: { key: `${segment}:0`, segmentId: segment, side: 'source', start: 0, end: SOURCE.length, text: SOURCE, final: true } },
    { kind: 'row', ...base, header: false, endsSegment: true, row: { key: `${segment}:1`, segmentId: segment, side: 'translation', start: 0, end: TRANSLATION.length, text: TRANSLATION, final: true } },
  ];
}

// ─── state: the status line ──────────────────────────────────────────────────

const IDLE: StatusLineInput = {
  run: { phase: 'idle' }, idle: { kind: 'ready' }, canStart: true, dismissedEnd: null,
  waitingForMicrophone: false, subtitleEntryHint: false, echo: null,
};

/** The live gate refuses: what the stores say now. */
function blocked(message: string, code?: string, params?: Record<string, string | number>): StatusLineInput {
  return { ...IDLE, canStart: false, idle: { kind: 'unready', message, ...(code ? { code } : {}), ...(params ? { params } : {}) } };
}

/** The last start was refused or failed, and the gate has cleared since. */
function ended(end: RunEnd): StatusLineInput {
  return { ...IDLE, run: { phase: 'idle', lastEnd: end } };
}

function running(over: Partial<StatusLineInput> = {}, legs: Extract<RunState, { phase: 'running' }>['legs'] = { speaker: 'live' }): StatusLineInput {
  return { ...IDLE, run: { phase: 'running', since: 0, legs }, ...over };
}

const echo = (cause: EchoCause): EchoNoticeState => ({ cause, lagMs: 120, rho: 0.8 });

export interface StatusCase {
  label: string;
  input: StatusLineInput;
}

export const STATUS_CASES: readonly StatusCase[] = [
  // 1a. Cannot start: the live gate.
  { label: 'cannot start · credentials_missing → Settings', input: blocked('Enter your API key in Settings before starting.', 'credentials_missing') },
  { label: 'cannot start · sign_in_required → Sign in', input: blocked('Sign in to use this provider.', 'sign_in_required') },
  { label: 'cannot start · balance_below_floor → Top up', input: blocked('The balance is below this start’s floor.', BALANCE_BELOW_FLOOR, { balance: '$0.12' }) },
  { label: 'cannot start · quota_pending (no action)', input: blocked('The wallet is still loading.', QUOTA_PENDING) },
  { label: 'cannot start · no_microphone → Settings (the picker’s ring stays)', input: blocked('Configure devices for this mode to start.', NO_MICROPHONE) },
  { label: 'cannot start · local_models_missing → Settings', input: blocked('Please download the required models in Settings to start.', 'local_models_missing') },
  { label: 'cannot start · turn_mode_unsupported → Settings', input: blocked("This provider doesn't offer the chosen talk mode.", 'turn_mode_unsupported') },
  { label: 'cannot start · participant_source_unavailable (no action)', input: blocked("Translating other participants isn't available here.", 'participant_source_unavailable') },
  { label: 'cannot start · loopback_denied → system settings', input: blocked("Other's audio requires Screen Recording permission to capture system audio.", 'loopback_denied') },
  { label: 'cannot start · a provider’s own message, no code', input: blocked('The selected model needs a newer app version.') },
  // 1b. Cannot start: the last start, until the next start or Clear.
  { label: 'last start failed · start_failed (no action)', input: ended({ reason: 'start-failed', notice: { code: 'start_failed', message: "The session didn't start: the provider closed the connection (1006).", params: { detail: 'the provider closed the connection (1006)' } } }) },
  { label: 'last start refused · insufficient_balance → Top up', input: ended({ reason: 'refused', notice: { code: 'insufficient_balance', message: 'Insufficient balance.' } }) },
  // 2–5. While running.
  { label: 'running · a leg is reconnecting (the dot turns amber)', input: running({}, { speaker: 'reconnecting' }) },
  { label: 'running · waiting for a microphone', input: running({ waitingForMicrophone: true }) },
  { label: 'running · the subtitle layer’s refresh hint (dismiss)', input: running({ subtitleEntryHint: true }) },
  { label: 'running · echo: tts-echo (dismiss)', input: running({ echo: echo('tts-echo') }) },
  { label: 'running · echo: meeting-echo (dismiss)', input: running({ echo: echo('meeting-echo') }) },
  { label: 'running · echo: far-end-echo (dismiss)', input: running({ echo: echo('far-end-echo') }) },
  { label: 'running · echo: self-capture (dismiss)', input: running({ echo: echo('self-capture') }) },
  { label: 'running · echo: routing-loop (dismiss)', input: running({ echo: echo('routing-loop') }) },
];

// ─── app: banners ────────────────────────────────────────────────────────────

/** One panel per label; `useBanners` is the source of each state's props (`Banner/useBanners.tsx`). */
export const BANNER_CASE_LABELS = [
  'audio · unavailable → Retry',
  'audio · retrying (busy)',
  'audio · pactl missing: the install command → Retry',
  'audio · macOS driver not loaded → Repair',
  'audio · macOS repairing (busy)',
  'audio · macOS repair failed → Repair',
  'update · available → Download Now',
  'update · available, no auto-update (Linux deb / AppImage) → Go to Download',
  'update · downloading 42% (no dismiss)',
  'update · downloaded → Restart and Update',
  'both · attention above brand',
] as const;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The same props `useBanners` builds from the stores, for each label above. */
function bannerCases(t: Translate): BannerProps[][] {
  const dismissLabel = t('common.dismiss');
  const noop = () => {};
  const audio = (body: string, action: BannerProps['action'], command = false): BannerProps => ({
    id: 'audio-system', tone: 'attention', icon: <TriangleAlert size={14} aria-hidden="true" />,
    text: <><span>{body}</span>{command && <code className="banner__code">{t('audioSystem.installCommand')}</code>}</>,
    action, onDismiss: noop, dismissLabel,
  });
  const retry = (busy: boolean): BannerProps['action'] => ({ label: busy ? t('audioSystem.retrying') : t('audioSystem.retry'), icon: <RefreshCw size={12} aria-hidden="true" className={busy ? 'spinning' : ''} />, onClick: noop, busy });
  const repair = (busy: boolean): BannerProps['action'] => ({ label: busy ? t('audioSystem.repairing') : t('audioSystem.repair'), icon: <Wrench size={12} aria-hidden="true" className={busy ? 'spinning' : ''} />, onClick: noop, busy });
  const version = '0.43.0';
  const available: BannerProps = { id: 'update', tone: 'brand', icon: <Download size={14} aria-hidden="true" />, text: t('update.available', { version }), action: { label: t('update.downloadNow'), onClick: noop }, onDismiss: noop, dismissLabel };
  const macDriver = audio(t('audioSystem.macDriverNotLoadedBody'), repair(false));
  return [
    [audio(t('audioSystem.unavailableBody'), retry(false))],
    [audio(t('audioSystem.unavailableBody'), retry(true))],
    [audio(t('audioSystem.pactlMissingBody'), retry(false), true)],
    [macDriver],
    [audio(t('audioSystem.macDriverNotLoadedBody'), repair(true))],
    [audio(t('audioSystem.macRepairFailedBody'), repair(false))],
    [available],
    [{ ...available, text: t('update.linuxMigrateTitle', { version }), action: { label: t('update.goToDownload'), onClick: noop } }],
    [{ id: 'update', tone: 'brand', icon: <RefreshCw size={14} aria-hidden="true" className="spinning" />, text: t('update.downloading', { percent: 42 }), progress: 42, dismissLabel }],
    [{ id: 'update', tone: 'brand', icon: <RefreshCw size={14} aria-hidden="true" />, text: t('update.downloaded'), action: { label: t('update.restartNow'), onClick: noop }, onDismiss: noop, dismissLabel }],
    [macDriver, available],
  ];
}

// ─── the page ────────────────────────────────────────────────────────────────

const WIDTHS = [300, 450, 720] as const;
const SITES = ['basic', 'advanced'] as const;

const page: CSSProperties = { padding: 16, background: '#141414', height: '100vh', overflowY: 'auto', boxSizing: 'border-box' };
const bar: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 16px', color: '#aaa', fontSize: 12, flexWrap: 'wrap' };
const heading: CSSProperties = { color: '#fff', fontSize: 14, fontWeight: 600, margin: '20px 0 10px' };
const caption: CSSProperties = { fontSize: 11, color: '#777', margin: '0 0 4px 2px' };
const stage: CSSProperties = { background: '#1f1f1f', border: '1px solid #333', borderRadius: 6, overflow: 'hidden', height: 'auto' };
const filler: CSSProperties = { flex: 'none', height: 28, padding: '6px 12px', color: '#555', fontSize: 12, boxSizing: 'border-box' };

const choice = (on: boolean): CSSProperties => ({
  font: 'inherit', padding: '2px 8px', borderRadius: 3, cursor: 'pointer', border: '1px solid #444',
  background: on ? '#10a37f' : 'transparent', color: on ? '#fff' : '#aaa',
});

const noop = () => {};
const NO_LIT: ReadonlyMap<string, number> = new Map();
const NO_LEGS: ReadonlySet<'speaker' | 'participant'> = new Set();

/** One case: its label, and the panel at the chosen width. */
function Case({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <div style={{ margin: '0 0 14px' }}>
      <div style={caption}>{label}</div>
      <div className="main-panel-wrapper" style={{ ...stage, width }}>
        <div className="main-panel" style={{ height: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

export function NoticesPreview() {
  const { t, i18n } = useTranslation();
  const [width, setWidth] = useState<number>(450);
  const [site, setSite] = useState<(typeof SITES)[number]>('basic');
  // `&lng=zh_CN` opens the page in that language (the catalogs load on demand,
  // and nothing on this page applies the stored interface language).
  useEffect(() => {
    const lng = new URLSearchParams(window.location.search).get('lng');
    if (lng) void changeLanguageWithLoad(lng);
  }, []);

  // A row's action, as MainPanel resolves it: a panel note's own, else its code's.
  const actions = new Map(EVENT_CASES.map((c) => [c.notice.id, c.action ?? actionForCode(c.notice.code)]));
  const noticeAction = (n: NoticeEntry) => {
    const spec = actions.get(n.id);
    if (!spec) return null;
    const { key, fallback } = actionLabel(spec);
    return { label: t(key, fallback), run: noop };
  };
  const list = (items: DisplayItem[]) => (
    <ConversationList
      items={items} lit={NO_LIT} replaying={null} replayLegs={NO_LEGS}
      canReplay={() => false} onReplay={noop} noticeAction={noticeAction}
      compact={false} fontSize={14} empty={null}
    />
  );
  const banners = bannerCases(t as unknown as Translate);

  return (
    <div style={page} data-testid="notices-preview">
      <div style={bar}>
        <strong style={{ color: '#fff' }}>Notices — every case</strong>
        <span>width</span>
        {WIDTHS.map((w) => (
          <button key={w} type="button" style={choice(width === w)} onClick={() => setWidth(w)}>{`${w}px`}</button>
        ))}
        <span>footer</span>
        {SITES.map((s) => (
          <button key={s} type="button" style={choice(site === s)} onClick={() => setSite(s)}>{s}</button>
        ))}
        <span>language</span>
        <select value={i18n.language} onChange={(e) => { void changeLanguageWithLoad(e.target.value); }} style={{ font: 'inherit', background: '#222', color: '#ddd', border: '1px solid #444', borderRadius: 3 }}>
          {INTERFACE_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto' }}>Ctrl+Shift+L toggles this page over the app</span>
      </div>

      <section data-section="event">
        <div style={heading}>Event — a system row in the conversation</div>
        {EVENT_CASES.map(({ label, notice: n }) => (
          <Case key={n.id} label={label} width={width}>
            {list([...bubble(`s:speaker:${n.id}`), { kind: 'notice', notice: n }])}
          </Case>
        ))}
        <Case label="all together, in sequence" width={width}>
          {list([...bubble('s:speaker:all'), ...EVENT_CASES.map(({ notice: n }): DisplayItem => ({ kind: 'notice', notice: n }))])}
        </Case>
      </section>

      <section data-section="state">
        <div style={heading}>State — the status line above the footer</div>
        {STATUS_CASES.map(({ label, input }) => {
          const entry = statusLine(input);
          const run = input.run;
          return (
            <Case key={label} label={`${label}${entry ? ` · ${entry.key}` : ' · (no line)'}`} width={width}>
              <div style={filler}>{t('mainPanel.conversation', 'Conversation')}</div>
              {entry && <StatusLine entry={entry} onAction={noop} onDismiss={noop} />}
              <PanelFooter
                site={site} run={run} mode="speaker"
                missingDevice={input.idle.kind === 'unready' && input.idle.code === NO_MICROPHONE ? 'speaker' : null}
                canStart={input.canStart} holdToTalk={false} held={false} micMuted={false}
                pair={{ source: 'en', target: 'zh-Hans' }} duration={run.phase === 'running' ? '00:42' : null}
                onStart={noop} onStop={noop} onPress={noop} onRelease={noop} onModeSegment={noop} onLanguages={noop}
              />
            </Case>
          );
        })}
      </section>

      <section data-section="app">
        <div style={heading}>App — the banner at the top of the panel</div>
        {BANNER_CASE_LABELS.map((label, i) => (
          <Case key={label} label={label} width={width}>
            {banners[i].map((props) => <Banner key={props.id} {...props} />)}
            <div style={filler}>{t('mainPanel.conversation', 'Conversation')}</div>
          </Case>
        ))}
      </section>
    </div>
  );
}

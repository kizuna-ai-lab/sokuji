// src/components/History/FileJobs.tsx
//
// Importing a file and transcribing a record again, on the History screens (desktop): the panel that asks before an
// import, the one that asks before a transcription again (both ask the same: the languages spoken and the language to
// translate into, with one set of fields), the line that follows the running job and says how it ended, and the
// choice between a record's transcripts. Each names the service; the stage of the line-up it belongs to
// is called transcription, as the line-up calls it (B-35). With the user's own key no price is shown (owner, 2026-11-16);
// through Kizuna AI an estimate is shown, and the running job says when cancelling it is still charged (owner, 2026-11-18).
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useStore } from 'zustand';
import type { FileJobBlock, FileJobCheck } from '../../lib/history/historyPageStore';
import { EACH_SIDE, eachSideOffered, fitOptions, importOptions, optionsFor, withMain, withOther, withoutOther } from '../../lib/history/file/options';
import type { FileTranscriptionOptions } from '../../lib/history/types';
import { orderLanguages, pinnedLanguages, PIN_SEPARATOR, type OrderContext } from '../../lib/language/order';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { usd } from '../../lib/notes/notesPricing';
import { NOT_ORG_MEMBER, ORG_BALANCE_HELD, ORG_INSUFFICIENT_BALANCE, ORG_WALLET_FROZEN, orgNoticeParams } from '../../lib/session/orgNotice';
import { useAccountPayer } from '../../lib/session/payerChoice';
import { noticeText } from '../../lib/view/noticeText';
import { useAccountStore } from '../../stores/accountStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useHistoryPageContext } from './historyContext';
import { formatDateTime } from './format';
import { providerTarget } from '../SettingsPage/accountRows';

const baseOf = (code: string) => code.split(/[-_]/)[0].toLowerCase();

/** The user's language now: the selected service's own side, else the interface's. */
export function myLanguageNow(ui: string): string {
  const { selected, entries } = useProviderStore.getState();
  const source = selected ? entries[selected]?.pair.source : undefined;
  return source && source !== 'auto' && !source.includes('+') ? baseOf(source) : baseOf(ui);
}

/** Where to write when a recording is longer than Kizuna AI transcribes at once; an address, never translated. */
const SUPPORT_ADDRESS = 'support@kizuna.ai';
/** The longest recording Kizuna AI transcribes at once as published today, in hours: said when its terms cannot be read. */
const HOSTED_HOURS = 4;
const HOUR_MS = 3_600_000;
/** The longest track the service takes, in hours, whole ones without decimals (4, not 4.00); the published four when not known. */
const hoursOf = (maxAudioMs: number | null) => (maxAudioMs === null ? HOSTED_HOURS : Number((maxAudioMs / HOUR_MS).toFixed(2)));

/** What to do about a reason: open the setting to change, or write to us. */
type Fix = { label: string; target: string } | { mail: string };

/**
 * The words of the file panels and the job's line. `hours` is the longest recording Kizuna AI transcribes at once,
 * said when one is longer (`hoursOf`).
 */
function useFileTexts(hours: number) {
  const { t } = useTranslation();
  // Who pays decides whose frozen wallet a block names; the organization's reasons name it.
  const account = useAccountStore((s) => s.account);
  const payer = useAccountPayer(account);
  return useMemo(() => {
    // The organization's reasons in the words a refused session start uses, naming it when the account does.
    const orgWords = (code: string) => {
      const params = orgNoticeParams(account);
      return noticeText(t, { code, message: code, ...(params ? { params } : {}) });
    };
    const ownWalletFrozen = t('history.file.blockedFrozen', 'Your Kizuna AI wallet is frozen.');
    const blocks: Record<FileJobBlock | 'no-recording', string> = {
      'no-file-service': t('history.file.blockedNotSoniox', 'Files are transcribed only by Soniox. Choose it for transcription in the line-up.'),
      'no-key': t('history.file.blockedNoKey', 'Your Soniox key is not filled in yet.'),
      'sign-in': t('history.file.blockedSignIn', 'Sign in to Kizuna AI to transcribe files with it.'),
      session: t('history.file.blockedSession', 'Available when no session is running.'),
      busy: t('history.file.blockedBusy', 'Another import or transcription is running.'),
      unchecked: t('history.file.blockedUnchecked', 'The transcription service could not be checked. Close this and try again.'),
      'no-balance': t('history.file.blockedNoBalance', 'Your Kizuna AI balance does not cover this transcription.'),
      'wallet-frozen': payer === 'organization' ? orgWords(ORG_WALLET_FROZEN) : ownWalletFrozen,
      // `count` too, so a catalog can give the hours their plural forms.
      'hosted-too-long': t('history.file.blockedHostedTooLong', 'This recording is longer than Kizuna AI transcribes at once ({{hours}} hours). Contact us and we will help:', { hours, count: hours }),
      'hosted-unavailable': t('history.file.blockedHostedUnavailable', 'Transcribing files with Kizuna AI is not available yet.'),
      'no-recording': t('history.file.blockedNoRecording', 'This record keeps no recording.'),
    };
    // What to change, as a link to it in Settings (owner, 2026-11-17; B-35): the line-up, the key, or the Kizuna AI
    // account; for a recording longer than Kizuna AI takes, our address (owner, 2026-11-18): never the user's own key.
    const open = (category: 'lineup' | 'accounts', fallback: string) =>
      t('history.file.openSettings', 'Open {{place}}', { place: t(`settingsPage.categories.${category}`, fallback) });
    // What the Kizuna AI account can change (its sign-in, its balance, its wallet, its organization): the account's row,
    // as the notes' failures lead there.
    const accountRow: Fix = { label: open('accounts', 'Accounts and keys'), target: 'user-account' };
    const contact: Fix = { mail: SUPPORT_ADDRESS };
    const fixes: Partial<Record<FileJobBlock, Fix>> = {
      'no-file-service': { label: open('lineup', 'Languages and line-up'), target: 'lineup' },
      // Soniox's own key: its row, not the row of the provider the session runs on.
      'no-key': { label: open('accounts', 'Accounts and keys'), target: providerTarget('soniox') },
      'sign-in': accountRow,
      'no-balance': accountRow,
      'wallet-frozen': accountRow,
      'hosted-too-long': contact,
    };
    const phases: Record<string, string> = {
      reading: t('history.file.phase.reading', 'Reading the file'),
      decoding: t('history.file.phase.decoding', 'Decoding the audio'),
      saving: t('history.file.phase.saving', 'Saving the recording'),
      uploading: t('history.file.phase.uploading', 'Sending the recording to Soniox'),
      queued: t('history.file.phase.queued', 'Waiting at Soniox'),
      processing: t('history.file.phase.processing', 'Soniox is transcribing'),
      fetching: t('history.file.phase.fetching', 'Fetching the transcript'),
      writing: t('history.file.phase.writing', 'Writing the transcript'),
    };
    const failures: Record<string, string> = {
      TOO_LONG: t('history.file.failure.TOO_LONG', 'The file is longer than five hours.'),
      RECORD_TOO_LONG: t('history.file.failure.RECORD_TOO_LONG', 'The recording is longer than five hours, more than Soniox transcribes at once.'),
      TOO_BIG: t('history.file.failure.TOO_BIG', 'The file is larger than 16 GB.'),
      UNSUPPORTED: t('history.file.failure.UNSUPPORTED', 'The audio of this file cannot be read. Convert it to AAC or MP3 and import it again.'),
      NO_AUDIO: t('history.file.failure.NO_AUDIO', 'The file holds no sound.'),
      NO_SPEECH: t('history.file.failure.NO_SPEECH', 'Soniox heard no speech in the recording.'),
      NO_KEY: t('history.file.failure.NO_KEY', 'Soniox did not accept the key. Check it in Settings.'),
      NO_CREDIT: t('history.file.failure.NO_CREDIT', 'The Soniox account has no credit left.'),
      BAD_AUDIO: t('history.file.failure.BAD_AUDIO', 'Soniox could not read the recording.'),
      NETWORK: t('history.file.failure.NETWORK', 'Soniox could not be reached. Check the connection and try again.'),
      CANCELLED: t('history.file.failure.CANCELLED', 'Cancelled.'),
      SERVICE: t('history.file.failure.SERVICE', 'Soniox could not transcribe the recording. Try again later.'),
      JOB_RUNNING: t('history.file.failure.JOB_RUNNING', 'Another file is being transcribed on this account. Try again when it has finished.'),
      // Kizuna AI's refusals once the job runs: a block's words where there is one (the frozen wallet is the user's own:
      // the organization's has its own code), and the organization's in the words a refused session start uses.
      SIGN_IN: blocks['sign-in'],
      NO_BALANCE: blocks['no-balance'],
      WALLET_FROZEN: ownWalletFrozen,
      HOSTED_TOO_LONG: blocks['hosted-too-long'],
      HOSTED_UNAVAILABLE: blocks['hosted-unavailable'],
      ORG_BALANCE_HELD: orgWords(ORG_BALANCE_HELD),
      ORG_NO_BALANCE: orgWords(ORG_INSUFFICIENT_BALANCE),
      ORG_WALLET_FROZEN: orgWords(ORG_WALLET_FROZEN),
      NOT_ORG_MEMBER: orgWords(NOT_ORG_MEMBER),
      // Anything else went wrong here (saving, encoding, the store), not at the service.
      LOCAL: t('history.file.failure.LOCAL', 'It could not be saved on this computer. Try again.'),
    };
    // A failure leads where its block does; the user's own key's failures stay as they were, with none.
    const failureFixes: Record<string, Fix> = {
      'sign-in': accountRow,
      SIGN_IN: accountRow,
      NO_BALANCE: accountRow,
      WALLET_FROZEN: accountRow,
      ORG_BALANCE_HELD: accountRow,
      ORG_NO_BALANCE: accountRow,
      ORG_WALLET_FROZEN: accountRow,
      NOT_ORG_MEMBER: accountRow,
      HOSTED_TOO_LONG: contact,
    };
    return {
      block: (b: FileJobBlock | 'no-recording') => blocks[b],
      fix: (b: FileJobBlock | 'no-recording' | null) => (b && b !== 'no-recording' ? fixes[b] ?? null : null),
      phase: (p: string) => phases[p] ?? p,
      failure: (code: string) => failures[code] ?? blocks[(code === 'NO_TRACK' ? 'no-recording' : code) as FileJobBlock] ?? failures.LOCAL,
      failureFix: (code: string): Fix | null => failureFixes[code] ?? null,
      service: t('history.file.service', 'Transcribed by Soniox, with your own key.'),
      // Who pays is said as it is: the organization's balance when it pays, else the user's own.
      serviceHosted: payer === 'organization'
        ? t('history.file.serviceHostedOrg', "Transcribed by Soniox through Kizuna AI, paid from your organization's balance.")
        : t('history.file.serviceHosted', 'Transcribed by Soniox through Kizuna AI, paid from your balance.'),
      // The price set apart from the sentence (first strong isolate … pop directional isolate), so in a right-to-left
      // language its dollar sign stays with its digits; left-to-right text looks the same.
      estimate: (amount: number) => t('history.file.estimate', 'About {{price}}.', { price: `\u2068${usd(amount)}\u2069` }),
      cancelCharged: t('history.file.cancelCharged', 'Soniox is already transcribing: cancelling now is still charged.'),
    };
  }, [t, account, payer, hours]);
}

type FileTexts = ReturnType<typeof useFileTexts>;

/** A panel that asks first: it takes the focus when it shows, and Escape closes it (not the page behind it). */
function usePanel(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return { ref, tabIndex: -1, onKeyDown };
}

/** The service line only when the service can do the job: not beside a reason it cannot (B-35). */
const serviceFine = (known: boolean, blocked: FileJobBlock | null) => known && (blocked === null || blocked === 'session' || blocked === 'busy');

/**
 * What to do about a reason, after it: the link to the setting to change, which closes the panel (when there is one)
 * and opens Settings there; or our address, which opens the mail app.
 */
const FixButton: React.FC<{ fix: Fix; onClose?(): void }> = ({ fix, onClose }) => (
  'mail' in fix ? (
    <button type="button" className="history-file__link" onClick={() => openExternalUrl(`mailto:${fix.mail}`)}>{fix.mail}</button>
  ) : (
    <button type="button" className="history-file__link" onClick={() => { onClose?.(); useSettingsStore.getState().navigateToSettings(fix.target); }}>
      {fix.label}
    </button>
  )
);

/** Why the job cannot start, and what to do about it. */
const Blocked: React.FC<{ text: string; fix: Fix | null; onClose(): void }> = ({ text, fix, onClose }) => (
  <p className="history-file__blocked" role="status">
    <span>{text}</span>
    {fix && (
      <>
        {' '}
        <FixButton fix={fix} onClose={onClose} />
      </>
    )}
  </p>
);

/** A check that could not be made: the panel says the service could not be checked, never waits for ever. */
const UNCHECKED: FileJobCheck = { blocked: 'unchecked', hosted: false, maxAudioMs: null };

/** Why the job cannot start, through which service, and the longest recording it takes: asked once as the panel shows. */
function useBlocked(kind: 'import' | 'transcribe'): { known: boolean } & FileJobCheck {
  const { store } = useHistoryPageContext();
  const [state, setState] = useState<{ known: boolean } & FileJobCheck>({ known: false, blocked: null, hosted: false, maxAudioMs: null });
  useEffect(() => {
    let live = true;
    void store.getState().fileJobCheck(kind)
      .catch(() => UNCHECKED)
      .then((check) => { if (live) setState({ known: true, ...check }); });
    return () => { live = false; };
  }, [store, kind]);
  return state;
}

/**
 * For a failure said after the fact: the longest recording Kizuna AI transcribes at once, in hours, from the terms it
 * publishes (asked only when `wanted`); the published four when they cannot be read.
 */
function useHostedHours(wanted: boolean): number {
  const { store } = useHistoryPageContext();
  const [hours, setHours] = useState(HOSTED_HOURS);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void store.getState().hostedTerms()
      .catch(() => null)
      .then((terms) => { if (live) setHours(hoursOf(terms?.maxAudioMs ?? null)); });
    return () => { live = false; };
  }, [store, wanted]);
  return hours;
}

/**
 * Which service transcribes the file and, through Kizuna AI, what the job is estimated to cost: asked again whenever
 * the options change (a translation is priced higher), shown when there is a figure (none for an import, whose length
 * is not known before it is read). A price asked for other choices is dropped as the new one is asked for, so it is
 * never shown beside these.
 */
const ServiceLine: React.FC<{ kind: 'import' | 'transcribe'; options: FileTranscriptionOptions; hosted: boolean; texts: FileTexts }> = ({ kind, options, hosted, texts }) => {
  const { store } = useHistoryPageContext();
  const record = useStore(store, (s) => s.open?.record);
  const [estimate, setEstimate] = useState<number | null>(null);
  // The options are made anew at each render: compared by what they say.
  const asked = JSON.stringify(options);
  useEffect(() => {
    setEstimate(null);
    if (!hosted) return;
    let live = true;
    void store.getState().fileEstimate(kind, options).then((amount) => { if (live) setEstimate(amount); });
    return () => { live = false; };
  }, [store, kind, asked, hosted, record]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p>{hosted ? texts.serviceHosted : texts.service}</p>
      {hosted && estimate !== null && <p>{texts.estimate(estimate)}</p>}
    </>
  );
};

/**
 * The languages the file service transcribes in and translates into, once known; `unchecked` when the service could
 * not be asked for them (the panel then says so, as when it could not be checked at all).
 */
function useFileLanguages(): { offered: readonly string[]; unchecked: boolean } {
  const { store } = useHistoryPageContext();
  const [languages, setLanguages] = useState<readonly string[] | null>([]);
  useEffect(() => {
    let live = true;
    void store.getState().fileLanguages().then((l) => { if (live) setLanguages(l); });
    return () => { live = false; };
  }, [store]);
  return { offered: languages ?? [], unchecked: languages === null };
}

const SEPARATOR = '──────────';

export interface FileOptionsFieldsProps {
  value: FileTranscriptionOptions;
  onChange(value: FileTranscriptionOptions): void;
  /** The languages the file service offers (none yet while they are asked for). */
  offered: readonly string[];
  /** A session with both sides kept: "each side into the other's language" is offered first. */
  eachSide?: boolean;
}

/**
 * What a file transcription is asked for, the same for an import and a transcription again: the main language spoken,
 * the others it may contain (each added on its own and taken out again), and the language to translate into. Each
 * list is drawn as the source and target lists are: the likely languages first (the ones chosen, the interface's),
 * a line, then every language in the app's order.
 */
export const FileOptionsFields: React.FC<FileOptionsFieldsProps> = ({ value, onChange, offered, eachSide = false }) => {
  const { t, i18n } = useTranslation();
  const labelOf = useLanguageLabel();
  const othersId = useId();
  const ui = i18n?.language ?? 'en';
  const browser = typeof navigator !== 'undefined' ? navigator.languages ?? [] : [];
  const browserKey = browser.join(',');
  const ctx: OrderContext = useMemo(() => ({ ui, browser }), [ui, browserKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [main = '', ...others] = value.languages;
  // The service's languages, and any chosen that it does not list (so a choice is never hidden).
  const all = useMemo(
    () => [...new Set([...offered, ...value.languages, value.translateTo])].filter((code) => code && code !== EACH_SIDE).map((code) => ({ value: code })),
    [offered, value],
  );
  const likelyPair = { source: main, target: value.translateTo };
  const choices = (options: readonly { value: string }[]) => {
    const pinned = pinnedLanguages(options, likelyPair, ctx);
    return (
      <>
        {pinned.map((o) => <option key={`pin:${o.value}`} value={o.value}>{labelOf(o.value)}</option>)}
        {pinned.length > 0 && <option key="pin-separator" value={PIN_SEPARATOR} disabled>{SEPARATOR}</option>}
        {orderLanguages(options, ctx).map((o) => <option key={o.value} value={o.value}>{labelOf(o.value)}</option>)}
      </>
    );
  };
  const add = t('history.file.addLanguage', 'Add another language');
  return (
    <>
      <label className="history-file__field">
        <span>{t('history.file.mainLanguage', 'Main language')}</span>
        <select className="select-dropdown" value={main} onChange={(e) => onChange(withMain(value, e.target.value))}>{choices(all)}</select>
      </label>
      <div className="history-file__field" role="group" aria-labelledby={othersId}>
        <span id={othersId}>{t('history.file.otherLanguages', 'Other languages it may contain')}</span>
        {others.length > 0 && (
          <ul className="history-file__languages">
            {others.map((code) => (
              <li key={code}>
                <span>{labelOf(code)}</span>
                <button
                  type="button"
                  className="history-file__remove"
                  aria-label={t('history.file.removeLanguage', 'Remove {{language}}', { language: labelOf(code) })}
                  onClick={() => onChange(withoutOther(value, code))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <select className="select-dropdown" aria-label={add} value="" onChange={(e) => { if (e.target.value) onChange(withOther(value, e.target.value)); }}>
          {/* The closed list's own words, not a choice in the open one. */}
          <option value="" className="history-file__placeholder" disabled hidden>{add}</option>
          {choices(all.filter((o) => !value.languages.includes(o.value)))}
        </select>
      </div>
      <label className="history-file__field">
        <span>{t('history.file.translateInto', 'Translate into')}</span>
        <select className="select-dropdown" value={value.translateTo} onChange={(e) => onChange({ ...value, translateTo: e.target.value })}>
          {eachSide && <option value={EACH_SIDE}>{t('history.file.eachSide', 'Each side into the other’s language')}</option>}
          {choices(all)}
        </select>
      </label>
    </>
  );
};

export interface ImportPanelProps {
  file: File;
  /** The user's language: preselected, and the notes' language. */
  myLanguage: string;
  onClose(): void;
}

export const ImportPanel: React.FC<ImportPanelProps> = ({ file, myLanguage, onClose }) => {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const checked = useBlocked('import');
  const panel = usePanel(onClose);
  const { offered, unchecked } = useFileLanguages();
  const { known, hosted } = checked;
  const blocked = checked.blocked ?? (unchecked ? 'unchecked' : null);
  const texts = useFileTexts(hoursOf(checked.maxAudioMs));
  const [chosen, setChosen] = useState(() => importOptions(myLanguage));
  // As the service can take them: "automatic" or a language it does not have is never sent.
  const options = fitOptions(chosen, offered, myLanguage, false);
  const title = t('history.file.importTitle', 'Import “{{name}}”', { name: file.name });
  const start = () => {
    void store.getState().importFile(file, { options, myLanguage });
    onClose();
  };
  return (
    <div className="history-confirm history-file" role="dialog" aria-label={title} {...panel}>
      <p className="history-file__title">{title}</p>
      <FileOptionsFields value={options} onChange={setChosen} offered={offered} />
      {serviceFine(known, blocked) && <ServiceLine kind="import" options={options} hosted={hosted} texts={texts} />}
      {blocked && <Blocked text={texts.block(blocked)} fix={texts.fix(blocked)} onClose={onClose} />}
      <div className="history-confirm__actions">
        <button type="button" className="history-button" disabled={!known || blocked !== null || offered.length === 0} onClick={start}>{t('history.file.start', 'Start')}</button>
        <button type="button" className="history-button history-button--quiet" onClick={onClose}>{t('history.cancel', 'Cancel')}</button>
      </div>
    </div>
  );
};

export const TranscribePanel: React.FC<{ onClose(): void }> = ({ onClose }) => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const checked = useBlocked('transcribe');
  const panel = usePanel(onClose);
  const { offered, unchecked } = useFileLanguages();
  const { known, hosted } = checked;
  const blocked = checked.blocked ?? (unchecked ? 'unchecked' : null);
  const texts = useFileTexts(hoursOf(checked.maxAudioMs));
  // Chosen here for the record open, or else what the record was last transcribed with (or its languages).
  const [chosen, setChosen] = useState<{ recordId: string; options: FileTranscriptionOptions } | null>(null);
  if (!open) return null;
  const record = open.record;
  // Only when the service translates into both sides' languages: else a side would go untranslated.
  const eachSide = eachSideOffered(record, offered);
  const asked = chosen?.recordId === record.id ? chosen.options : optionsFor(record);
  // As the service can take them: "automatic" or a language it does not have is never sent.
  const options = fitOptions(asked, offered, myLanguageNow(i18n?.language ?? 'en'), eachSide);
  const kept = record.tracks.filter((tr) => tr.goneAt === null);
  const title = record.transcripts.length > 0 ? t('history.file.transcribeAgain', 'Transcribe again') : t('history.file.transcribe', 'Transcribe');
  const why = kept.length === 0 ? texts.block('no-recording') : blocked ? texts.block(blocked) : null;
  const start = () => {
    void store.getState().transcribeOpen(options);
    onClose();
  };
  return (
    <div className="history-confirm history-file record-page__confirm" role="dialog" aria-label={title} {...panel}>
      <p className="history-file__title">{title}</p>
      <p>{t('history.file.transcribeNote', 'The saved recording is transcribed again. A new version is made; the transcripts already here stay.')}</p>
      <FileOptionsFields value={options} onChange={(o) => setChosen({ recordId: record.id, options: o })} offered={offered} eachSide={eachSide} />
      {serviceFine(known, blocked) && <ServiceLine kind="transcribe" options={options} hosted={hosted} texts={texts} />}
      {why && <Blocked text={why} fix={kept.length === 0 ? null : texts.fix(blocked)} onClose={onClose} />}
      <div className="history-confirm__actions">
        <button type="button" className="history-button" disabled={!known || why !== null || offered.length === 0} onClick={start}>{t('history.file.start', 'Start')}</button>
        <button type="button" className="history-button history-button--quiet" onClick={onClose}>{t('history.cancel', 'Cancel')}</button>
      </div>
    </div>
  );
};

/** The running import or transcription with a way to stop it; then, when it did not finish, why. */
export const FileJobLine: React.FC = () => {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const job = useStore(store, (s) => s.job);
  const failure = useStore(store, (s) => s.jobFailure);
  const kept = useStore(store, (s) => s.jobKept);
  const texts = useFileTexts(useHostedHours(failure === 'HOSTED_TOO_LONG'));
  if (job) {
    const phase = texts.phase(job.phase);
    return (
      <div className="history-notice history-file__line" role="status">
        <p>{job.kind === 'import'
          ? t('history.file.importing', 'Importing “{{name}}”: {{phase}}', { name: job.name ?? '', phase })
          : t('history.file.transcribing', 'Transcribing: {{phase}}', { phase })}</p>
        {/* Through Kizuna AI, a job Soniox is transcribing is charged even when cancelled (owner, 2026-11-18). */}
        {job.hosted && job.phase === 'processing' && <p>{texts.cancelCharged}</p>}
        {/* Writing the transcript is the last, short step, and cannot be stopped half way. */}
        {job.phase !== 'writing' && (
          <button type="button" className="history-button" onClick={() => store.getState().cancelJob()}>{t('history.cancel', 'Cancel')}</button>
        )}
      </div>
    );
  }
  if (!failure) return null;
  const fix = texts.failureFix(failure);
  return (
    <div className="history-notice history-file__line" role="alert">
      <p>
        <span>{texts.failure(failure)}</span>
        {fix && (
          <>
            {' '}
            <FixButton fix={fix} />
          </>
        )}
      </p>
      {kept && <p>{t('history.file.kept', 'The recording was kept. Open the record to transcribe it.')}</p>}
      <button type="button" className="history-button" onClick={() => store.getState().clearJobFailure()}>{t('history.gotIt', 'Got it')}</button>
    </div>
  );
};

/**
 * What the transcript shown was asked for, when it is a file transcript that kept its options: the main language and
 * the translation, each version its own (the other languages are in the "transcribe again" panel).
 */
export const TranscriptAsked: React.FC = () => {
  const { t } = useTranslation();
  const labelOf = useLanguageLabel();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const shown = open?.record.transcripts.find((tr) => tr.id === open.transcriptId);
  const asked = shown?.origin.kind === 'file' ? shown.origin.options : undefined;
  if (!asked || !Array.isArray(asked.languages) || !asked.languages[0] || !asked.translateTo) return null;
  const main = labelOf(asked.languages[0]);
  return (
    <p className="record-page__asked">
      {asked.translateTo === EACH_SIDE
        ? t('history.file.askedEachSide', 'Main language: {{main}} · Each side translated into the other’s language', { main })
        : t('history.file.asked', 'Main language: {{main}} · Translated into: {{target}}', { main, target: labelOf(asked.translateTo) })}
    </p>
  );
};

/** A record's transcripts, newest first, when it has more than one. */
export const TranscriptChooser: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  if (!open || open.record.transcripts.length < 2) return null;
  const byAge = [...open.record.transcripts].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  return (
    <label className="history-file__versions">
      <span>{t('history.file.versions', 'Transcript version')}</span>
      <select className="select-dropdown" value={open.transcriptId ?? ''} onChange={(e) => void store.getState().showTranscript(Number(e.target.value))}>
        {byAge.map((tr) => {
          const time = formatDateTime(tr.createdAt, i18n.language);
          return (
            <option key={tr.id} value={tr.id}>
              {tr.origin.kind === 'live'
                ? t('history.file.versionLive', 'Live · {{time}}', { time })
                : t('history.file.versionFile', 'Soniox file · {{time}}', { time })}
            </option>
          );
        })}
      </select>
    </label>
  );
};

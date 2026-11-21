import { ArrowLeftRight, Languages } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../Tooltip/Tooltip';
import { pairSentence } from '../SetupWizard/languageSentence';
import { AUTO, normalizePair, reverseSupported, reversedPair, swapped } from '../../lib/provider/languages';
import type { AnyProvider, LanguageContext, LanguageOption, LanguagePair } from '../../lib/provider/types';
import type { AudioMode } from '../../stores/audioStore';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { orderLanguages, pinnedLanguages, PIN_SEPARATOR, type OrderContext } from '../../lib/language/order';
import { effectiveTextOnly } from '../../utils/effectiveTextOnly';
import { aroundVerb, VERB_MARK } from './receiveWords';

const SEPARATOR = '──────────';

/** A select's options: the pinned ones above the separator, then the whole list. */
interface OptionLists { pinned: LanguageOption[]; ordered: LanguageOption[] }

/** The lists, only the options `keep` keeps. */
function only({ pinned, ordered }: OptionLists, keep: (option: LanguageOption) => boolean): OptionLists {
  return { pinned: pinned.filter(keep), ordered: ordered.filter(keep) };
}

/**
 * The provider with each answer of its language rules worked out once. The other side's row asks them for every choice,
 * and a provider's rules can be costly (the local engine's go through its model manifest each time).
 */
function answeringOnce(provider: AnyProvider): AnyProvider {
  const { languages } = provider;
  const known = new Map<string, readonly LanguageOption[]>();
  const once = (key: string, work: () => readonly LanguageOption[]) => {
    const kept = known.get(key);
    if (kept) return kept;
    const answer = work();
    known.set(key, answer);
    return answer;
  };
  const about = (context?: LanguageContext) => (context ? String(context.speech) : '');
  return {
    ...provider,
    languages: {
      ...languages,
      sources: (s: unknown, context?: LanguageContext) => once(`sources|${about(context)}`, () => languages.sources(s, context)),
      targets: (source: string, s: unknown, context?: LanguageContext) => once(`targets|${source}|${about(context)}`, () => languages.targets(source, s, context)),
    },
  } as AnyProvider;
}

/** The lists seen through `code`: each option under its code there, the first of each code kept. */
function viewThrough({ pinned, ordered }: OptionLists, code: (value: string) => string): OptionLists {
  const once = (list: LanguageOption[]) => {
    const seen = new Set<string>();
    return list.flatMap((o) => {
      const value = code(o.value);
      if (seen.has(value)) return [];
      seen.add(value);
      return [{ value }];
    });
  };
  return { pinned: once(pinned), ordered: once(ordered) };
}

/**
 * One side's way of getting the translation, chosen in the sentence (owner, 2026-11-18, design 1): heard (read aloud
 * too) or read. The caller wires it to the audio page's switch it stands for.
 */
export interface ReceiveChoice {
  hears: boolean;
  onChange(hears: boolean): void;
  /** Why it cannot be changed now, said beside it; null when it can. */
  blocked: string | null;
}

/** The sentence's two words as choices: the other side's (my leg) and mine (theirs), and the way to the audio settings. */
export interface ReceiveChoices {
  theirs?: ReceiveChoice;
  mine?: ReceiveChoice;
  /** Opens the audio settings at the switch behind that side's word. */
  onOpenAudio?(side: 'theirs' | 'mine'): void;
}

interface LanguagePairSectionProps {
  provider: AnyProvider;
  settings: unknown;
  pair: LanguagePair;
  onChange(pair: LanguagePair): void;
  disabled?: boolean;
  /**
   * Today's sentence (ruling 4): "I speak / they hear", or the mode-aware
   * labels `pairSentence` returns, plus the "both" mirror line. Absent: the
   * plain `settings.sourceLanguage` / `settings.targetLanguage` labels.
   * `participantSpeaks`: the other side's translation is read aloud to me ("I hear"); absent, it is not.
   */
  sentence?: { mode: AudioMode; textOnly: boolean; participantSpeaks?: boolean };
  /** Whether a run would speak (Stage 2 Volcengine AST2, choice 1): the lists are the offer for it. Absent: the provider's widest offer. */
  context?: LanguageContext;
  /**
   * The other side's leg's own context, which Start checks its reverse under (`gate`, D20): the choices of their row in
   * Both. Absent: `context`.
   */
  reverseContext?: LanguageContext;
  /** Absent or true: the section's own heading. False where the page names the languages already (the settings page). */
  heading?: boolean;
  /**
   * The sentence's "hear / read" words as choices (the line-up page): `theirs` the other side's (my leg, shown in the
   * Me and Both modes), `mine` my own (the other side's leg: the Other mode's first word, Both's second line).
   * `onOpenAudio` is the way to the audio settings a blocked choice offers. Absent: the words are plain labels.
   */
  receive?: ReceiveChoices;
  /** How the unit that speaks leaves speaking to the switch, for the sentence. Absent: the provider's own `speech`. */
  speech?: AnyProvider['speech'];
  /**
   * Per leg that is read aloud by a voice that says what it reads: whether it reads a language. Such a leg is
   * offered only the languages its voice reads; the pair as it stands is never changed for it, and a language it
   * holds that the voice does not read stays shown, unchosen. Absent, or a leg absent: every language.
   */
  spoken?: SpokenBy;
}

/** Whether a leg's voice reads a language, for the legs that are read aloud by a voice that says so. */
export interface SpokenBy {
  /** My leg: read aloud in the pair's target. */
  speaker?(language: string): boolean;
  /** The other side's leg: read aloud in what the pair's reverse translates into. */
  participant?(language: string): boolean;
}

/**
 * Any provider's language pair (spec: "Languages are two functions"): the
 * lists are its `sources` and `targets`, and the swap is the generic one,
 * allowed whenever the provider supports the reversed pair. Markup is
 * LanguageSection's translation-languages block.
 */
export function LanguagePairSection({ provider, settings, pair, onChange, disabled, sentence, context, reverseContext = context, heading = true, receive, speech = provider.speech, spoken }: LanguagePairSectionProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const label = useLanguageLabel();
  // The other side's leg runs the pair's reverse as the provider states it (`reversedPair`: Palabra's is its own codes,
  // not a swap).
  const leg = useCallback(
    (p: LanguagePair) => reversedPair(provider, settings, p) ?? { source: p.target, target: p.source },
    [provider, settings],
  );
  // The context by what it says, not by the object the caller built for this render.
  const speaks = context?.speech;
  const offerContext = useMemo((): LanguageContext | undefined => (speaks === undefined ? undefined : { speech: speaks }), [speaks]);
  const everySource = useMemo(() => provider.languages.sources(settings, offerContext), [provider, settings, offerContext]);
  const everyTarget = useMemo(() => provider.languages.targets(pair.source, settings, offerContext), [provider, settings, pair.source, offerContext]);
  // A leg that is read aloud is offered the languages its voice reads: my leg's are the targets, the other side's
  // what each source makes its reverse translate into. An automatic source has no reverse to read.
  const mySpoken = spoken?.speaker;
  const theirSpoken = spoken?.participant;
  /** Whether the other side's voice reads what a pair's reverse would have it read. */
  const theirsRead = useCallback(
    (p: LanguagePair) => !theirSpoken || p.source === AUTO || theirSpoken(leg(p).target),
    [theirSpoken, leg],
  );
  /** Whether both legs' voices read what a pair would have them read. */
  const read = useCallback((p: LanguagePair) => (!mySpoken || mySpoken(p.target)) && theirsRead(p), [mySpoken, theirsRead]);
  /**
   * The pair a new source makes, as `by` answers: the target kept where the provider offers it with that source,
   * else the first it does; where that one is not read by my leg's voice, the first that is, one both voices read
   * before one only mine does. Nothing else is changed for a voice: a pair one does not read is still the pair.
   */
  const pairWith = useCallback((source: string, by: AnyProvider): LanguagePair => {
    const next = normalizePair(by, settings, { source, target: pair.target }, offerContext);
    if (next.target === pair.target || !mySpoken || mySpoken(next.target)) return next;
    const mine = by.languages.targets(next.source, settings, offerContext).filter((o) => mySpoken(o.value));
    const target = (mine.find((o) => theirsRead({ source: next.source, target: o.value })) ?? mine[0])?.value;
    return target === undefined ? next : { source: next.source, target };
  }, [settings, pair.target, offerContext, mySpoken, theirsRead]);
  // A source is offered when the other side's voice reads the reverse of the pair choosing it makes: the target
  // can move with the source, and a provider's reverse can depend on the target.
  const sources = useMemo(() => {
    if (!theirSpoken) return everySource;
    const asked = answeringOnce(provider);
    return everySource.filter((o) => theirsRead(pairWith(o.value, asked)));
  }, [everySource, theirSpoken, theirsRead, pairWith, provider]);
  // A target is offered when my leg's voice reads it, and it does not take the pair's reverse away from the other
  // side's voice (a provider's reverse can depend on the target); a reverse that voice does not read as the pair
  // stands holds no target back.
  const targets = useMemo(() => {
    if (!mySpoken && !theirSpoken) return everyTarget;
    const theirsReadNow = theirsRead({ source: pair.source, target: pair.target });
    return everyTarget.filter((o) => (!mySpoken || mySpoken(o.value)) && (!theirsReadNow || theirsRead({ source: pair.source, target: o.value })));
  }, [everyTarget, mySpoken, theirSpoken, theirsRead, pair.source, pair.target]);
  const swappedPair = swapped(provider, settings, pair, context);
  const reversed = swappedPair && read(swappedPair) ? swappedPair : null;
  // The provider runs the swapped pair, but a voice does not read it: the button says so.
  const swapNotSpoken = Boolean(swappedPair) && !reversed;
  // Display only: the dropdowns use the app-wide order, while the provider's own
  // order still decides normalizePair's first option.
  const ui = i18n?.language ?? 'en';
  const browser = typeof navigator !== 'undefined' ? navigator.languages ?? [] : [];
  const browserKey = browser.join(',');
  const ctx: OrderContext = useMemo(() => ({ ui, browser }), [ui, browserKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceOptions = useMemo(
    () => ({ pinned: pinnedLanguages(sources, pair, ctx), ordered: orderLanguages(sources, ctx) }),
    [sources, pair, ctx],
  );
  const targetOptions = useMemo(
    () => ({ pinned: pinnedLanguages(targets, pair, ctx), ordered: orderLanguages(targets, ctx) }),
    [targets, pair, ctx],
  );
  const options = ({ pinned, ordered }: OptionLists) => (
    <>
      {pinned.map((o) => <option key={`pin:${o.value}`} value={o.value}>{label(o.value)}</option>)}
      {pinned.length > 0 && <option key="pin-separator" value={PIN_SEPARATOR} disabled>{SEPARATOR}</option>}
      {ordered.map((o) => <option key={o.value} value={o.value}>{label(o.value)}</option>)}
    </>
  );

  // The capability maps the speaking unit's `speech` onto the sentence's
  // text-only capability: a provider that always speaks is never text-only,
  // one that never speaks is always text-only, and 'optional' honours the toggle.
  const resolved = sentence && pairSentence({
    mode: sentence.mode,
    textOnly: effectiveTextOnly({ speakerLegRuns: sentence.mode !== 'participant', textOnly: sentence.textOnly }),
    capability: speech === 'always' ? 'never' : speech === 'never' ? 'always' : 'optional',
    participantSpeaks: sentence.participantSpeaks ?? false,
    source: pair.source,
    target: pair.target,
  });
  const sourceLabel = resolved ? t(resolved.my.key, resolved.my.fallback) : t('settings.sourceLanguage');
  const targetLabel = resolved ? t(resolved.their.key, resolved.their.fallback) : t('settings.targetLanguage');
  const sourceLanguageName = label(pair.source);
  const targetLanguageName = label(pair.target);

  // The choices this mode shows: the other side's on my leg, mine on theirs.
  const theirs = sentence && sentence.mode !== 'participant' ? receive?.theirs : undefined;
  const mine = sentence && sentence.mode !== 'speaker' ? receive?.mine : undefined;
  // Each side's word: the whole phrases name it to a screen reader; only the verb is the choice, set in its sentence as
  // the language orders it (owner, 2026-11-19: the subject is not part of the choice). Where the subject is in the verb
  // itself (Arabic), the whole word is. Each choice has its own sentence, for a subject that changes with the verb
  // (French: j'[entends], je [lis]; review, PR #797).
  const around = (key: string, fallback: string) => aroundVerb(t(key, fallback, { verb: VERB_MARK }));
  const words = {
    theirs: {
      named: [t('settings.langSentence.theyHear', 'they hear'), t('settings.langSentence.theyRead', 'they read')] as const,
      verbs: [t('settings.langSentence.theyHearVerb', 'hear'), t('settings.langSentence.theyReadVerb', 'read')] as const,
      around: { hear: around('settings.langSentence.theyReceiveHear', 'they {{verb}}'), read: around('settings.langSentence.theyReceiveRead', 'they {{verb}}') },
    },
    mine: {
      named: [t('settings.langSentence.iHear', 'I hear'), t('settings.langSentence.iRead', 'I read')] as const,
      verbs: [t('settings.langSentence.iHearVerb', 'hear'), t('settings.langSentence.iReadVerb', 'read')] as const,
      around: { hear: around('settings.langSentence.iReceiveHear', 'I {{verb}}'), read: around('settings.langSentence.iReceiveRead', 'I {{verb}}') },
    },
  };
  type Word = (typeof words)['theirs'];
  // A choice that cannot change still opens, the way it cannot go greyed, so the choice is seen to be there (owner,
  // 2026-11-18). Its own lock, not the section's: the session's lock is in `blocked` where it applies (Translation I
  // hear stays switchable during a run that speaks it, as on the Audio page).
  const receiveSelect = (side: 'theirs' | 'mine', choice: ReceiveChoice, { named: [hear, read], verbs, around: sentences }: Word) => {
    const locked = Boolean(choice.blocked);
    const [before, after] = choice.hears ? sentences.hear : sentences.read;
    return (
      <span className="language-receive-label">
        {before}
        <select
          className="language-receive"
          value={choice.hears ? 'hear' : 'read'}
          aria-label={`${hear} / ${read}`}
          title={choice.blocked ?? undefined}
          aria-describedby={locked ? `${id}-reason-${side}` : undefined}
          onChange={(e) => choice.onChange(e.target.value === 'hear')}
        >
          <option value="hear" disabled={locked && !choice.hears}>{verbs[0]}</option>
          <option value="read" disabled={locked && choice.hears}>{verbs[1]}</option>
        </select>
        {after}
      </span>
    );
  };
  // Why a side's word cannot change, under the row it belongs to; its link opens that side's switch.
  const reasonFor = (side: 'theirs' | 'mine') => {
    const text = (side === 'theirs' ? theirs : mine)?.blocked;
    if (!text) return null;
    return (
      <p className="language-receive-reason" id={`${id}-reason-${side}`} data-side={side}>
        <span>{text}</span>
        {receive?.onOpenAudio && (
          <button type="button" className="language-receive-reason__link" onClick={() => receive.onOpenAudio?.(side)}>
            {t('mainPanel.audioSettings', 'Audio settings')}
          </button>
        )}
      </p>
    );
  };
  // The Other mode: my word leads the first row.
  const mineLeads = Boolean(mine) && sentence?.mode === 'participant';
  // A new source makes the pair the lists were judged by (`pairWith`). The pick is kept even where a voice does
  // not read the pair it makes: the line-up says so, and nothing here says otherwise.
  const chooseSource = (source: string) => onChange(pairWith(source, provider));
  const chooseTarget = (target: string) => onChange({ source: pair.source, target });
  const sourceSelect = (selectId: string, ariaLabel?: string) => (
    <select
      id={selectId}
      className="language-select"
      aria-label={ariaLabel}
      value={pair.source}
      onChange={(e) => chooseSource(e.target.value)}
      disabled={disabled}
    >
      {/* What it is now when it is not offered (the voice does not read it, or the translation service does not take it): shown, unchosen. */}
      {!sources.some((o) => o.value === pair.source) && <option value={pair.source} disabled>{label(pair.source)}</option>}
      {options(sourceOptions)}
    </select>
  );
  const targetSelect = (selectId: string, ariaLabel?: string) => (
    <select
      id={selectId}
      className="language-select"
      aria-label={ariaLabel}
      value={pair.target}
      onChange={(e) => chooseTarget(e.target.value)}
      disabled={disabled}
    >
      {!targets.some((o) => o.value === pair.target) && <option value={pair.target} disabled>{label(pair.target)}</option>}
      {options(targetOptions)}
    </select>
  );
  // The other side's leg runs the pair's reverse (`leg`), so their row shows that leg's languages. Each stands for the choice of the pair it comes from, and a
  // change there is that choice: one pair either way, so a change in one row is the other's too. Only choices their
  // leg runs in are offered, checked as Start's gate checks it (review, PR #784: one that does not is a pair Start
  // refuses): `reverseSupported` under their leg's own context, on the pair the choice makes (a language I get can move
  // the target, as `chooseSource` does). A provider's reverse can be null, and an automatic source never reverses (D20):
  // with none to offer, the row shows what it is, unchosen.
  // Worked out only where the row is drawn, each language rule asked once (`answeringOnce`).
  const theirRow = Boolean(mine) && sentence?.mode === 'both';
  const theirChoices = (() => {
    if (!theirRow) return null;
    const asked = answeringOnce(provider);
    const runs = (p: LanguagePair) => reverseSupported(asked, settings, p, reverseContext);
    const withSource = (source: string) => pairWith(source, asked);
    return {
      theyCanSpeak: only(targetOptions, (o) => runs({ source: pair.source, target: o.value })),
      iCanGet: only(sourceOptions, (o) => runs(withSource(o.value))),
      iGet: (source: string) => leg(withSource(source)).target,
    };
  })();
  const legSelect = (selectId: string, lists: OptionLists, code: (value: string) => string, current: string, choose: (value: string) => void, ariaLabel?: string) => {
    const shown = viewThrough(lists, code);
    const value = code(current);
    const offered = shown.ordered.some((o) => o.value === value);
    return (
      <select
        id={selectId}
        className="language-select"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          const chosen = lists.ordered.find((o) => code(o.value) === e.target.value);
          if (chosen) choose(chosen.value);
        }}
        disabled={disabled}
      >
        {/* What it is now when that is not a choice here (an automatic source, a leg that would not run): shown, unchosen. */}
        {!offered && <option value={value} disabled>{label(value)}</option>}
        {options(shown)}
      </select>
    );
  };
  const swap = (
    <div className="language-arrow">
      <button
        type="button"
        className="language-swap-btn"
        onClick={() => reversed && onChange(reversed)}
        disabled={disabled || !reversed}
        aria-label={t('simpleConfig.swapLanguages')}
        title={swapNotSpoken ? t('simpleConfig.swapNotSpoken', 'The speech service does not read these languages the other way round.') : t('simpleConfig.swapLanguages')}
      >
        <ArrowLeftRight size={18} />
      </button>
    </div>
  );
  // Both, with my word a choice (`theirRow` above): the other side's leg is a row of its own, drawn as the first (owner,
  // 2026-11-18): two legs of equal weight, each language shown where it comes from and where it goes.
  const theySpeakLabel = t('settings.langSentence.theySpeak', 'they speak');

  return (
    <div className="config-section" id="languages-section">
      {heading && (
        <h3>
          <Languages size={18} />
          <span>{t('simpleConfig.translationLanguages')}</span>
          <Tooltip
            content={t('simpleConfig.translationLanguagesDesc')}
            position="top"
            icon="help"
          />
        </h3>
      )}
      <div className="language-pair-row">
        <div className="language-select-group">
          {mineLeads && mine
            ? receiveSelect('mine', mine, words.mine)
            : <label htmlFor={`${id}-source`}>{sourceLabel}</label>}
          {sourceSelect(`${id}-source`, mineLeads ? sourceLabel : undefined)}
        </div>
        {swap}
        <div className="language-select-group">
          {theirs
            ? receiveSelect('theirs', theirs, words.theirs)
            : <label htmlFor={`${id}-target`}>{targetLabel}</label>}
          {targetSelect(`${id}-target`, theirs ? targetLabel : undefined)}
        </div>
      </div>
      {/* Each reason under the row its word is in: theirs in the first; mine there in Other, under its own row in Both. */}
      {reasonFor('theirs')}
      {mineLeads && reasonFor('mine')}
      {theirChoices && mine && (
        <div className="language-pair-row" data-testid="language-their-row">
          <div className="language-select-group">
            <label htmlFor={`${id}-their-target`}>{theySpeakLabel}</label>
            {legSelect(`${id}-their-target`, theirChoices.theyCanSpeak, (target) => leg({ source: pair.source, target }).source, pair.target, chooseTarget)}
          </div>
          {swap}
          <div className="language-select-group">
            {receiveSelect('mine', mine, words.mine)}
            {legSelect(`${id}-their-source`, theirChoices.iCanGet, theirChoices.iGet, pair.source, chooseSource, t('settings.sourceLanguage', 'My Language'))}
          </div>
        </div>
      )}
      {theirRow && reasonFor('mine')}
      {!theirRow && resolved?.showMirror && (
        <div className="language-mirror-line" data-testid="language-mirror-line">
          {t(resolved.mirror.key, resolved.mirror.fallback, {
            their: targetLanguageName,
            mine: sourceLanguageName,
          })}
        </div>
      )}
    </div>
  );
}

import { ArrowLeftRight, Languages } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../Tooltip/Tooltip';
import { pairSentence } from '../SetupWizard/languageSentence';
import { normalizePair, reverseSupported, reversedPair, swapped } from '../../lib/provider/languages';
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
}

/**
 * Any provider's language pair (spec: "Languages are two functions"): the
 * lists are its `sources` and `targets`, and the swap is the generic one,
 * allowed whenever the provider supports the reversed pair. Markup is
 * LanguageSection's translation-languages block.
 */
export function LanguagePairSection({ provider, settings, pair, onChange, disabled, sentence, context, reverseContext = context, heading = true, receive }: LanguagePairSectionProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const label = useLanguageLabel();
  const sources = provider.languages.sources(settings, context);
  const targets = provider.languages.targets(pair.source, settings, context);
  const reversed = swapped(provider, settings, pair, context);
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

  // The capability maps the definition's `speech` onto the sentence's
  // text-only capability: a provider that always speaks is never text-only,
  // one that never speaks is always text-only, and 'optional' honours the toggle.
  const resolved = sentence && pairSentence({
    mode: sentence.mode,
    textOnly: effectiveTextOnly({ speakerLegRuns: sentence.mode !== 'participant', textOnly: sentence.textOnly }),
    capability: provider.speech === 'always' ? 'never' : provider.speech === 'never' ? 'always' : 'optional',
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
  // A new source keeps the target where the provider offers it with that source, else takes the first it does.
  const chooseSource = (source: string) => onChange(normalizePair(provider, settings, { source, target: pair.target }, context));
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
      {options(targetOptions)}
    </select>
  );
  // The other side's leg runs the pair's reverse as the provider states it (`reversedPair`: Palabra's is its own codes,
  // not a swap), so their row shows that leg's languages. Each stands for the choice of the pair it comes from, and a
  // change there is that choice: one pair either way, so a change in one row is the other's too. Only choices their
  // leg runs in are offered, checked as Start's gate checks it (review, PR #784: one that does not is a pair Start
  // refuses): `reverseSupported` under their leg's own context, on the pair the choice makes (a language I get can move
  // the target, as `chooseSource` does). A provider's reverse can be null, and an automatic source never reverses (D20):
  // with none to offer, the row shows what it is, unchosen.
  // Worked out only where the row is drawn, each language rule asked once (`answeringOnce`).
  const leg = (p: LanguagePair) => reversedPair(provider, settings, p) ?? { source: p.target, target: p.source };
  const theirRow = Boolean(mine) && sentence?.mode === 'both';
  const theirChoices = (() => {
    if (!theirRow) return null;
    const asked = answeringOnce(provider);
    const runs = (p: LanguagePair) => reverseSupported(asked, settings, p, reverseContext);
    const withSource = (source: string) => normalizePair(asked, settings, { source, target: pair.target }, context);
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
        title={t('simpleConfig.swapLanguages')}
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

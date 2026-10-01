import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../../stores/providerStore';
import { normalizePair } from '../../../lib/provider/languages';
import { useLanguageLabel } from '../../../lib/language/useLanguageLabel';
import { orderLanguages, pinnedLanguages, PIN_SEPARATOR, type OrderContext } from '../../../lib/language/order';
import { legsFor, participantSpeechSwitchFromStores } from '../../../lib/session/appShape';
import { languageContext } from '../../../lib/session/shape';
import { getScenario } from '../../../lib/setup/scenarios';
import { pairSentence } from '../languageSentence';
import { defaultLanguagePair } from '../languageDefaults';
import { textOnlyCapabilityOf, wizardProvider } from '../providerPaths';
import type { SetupAction, SetupDraft } from '../setupDraft';

const SEPARATOR = '──────────';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const StepLanguagePair: React.FC<Props> = ({ draft, dispatch }) => {
  // The language in effect (see StepLanguage), not settingsStore.uiLanguage:
  // the default pair should start from the language the user is reading.
  const { t, i18n } = useTranslation();
  const uiLanguage = i18n.language;
  const label = useLanguageLabel();
  const p = wizardProvider(draft.provider)!;
  const s = useProviderStore((st) => st.entries[p.id]?.settings) ?? p.settings.defaults;
  // The scenario's legs and text-only answer whether the run would speak, so the lists are the offer for it (Stage 2 Volcengine AST2, choice 1); the participant's own switch is the stores'.
  const preset = getScenario(draft.scenario!);
  const speech = languageContext(p, legsFor(preset.mode), { textOnly: preset.textOnly, participantSpeech: participantSpeechSwitchFromStores() }).speech;
  const sources = useMemo(() => [...p.languages.sources(s, { speech })], [p, s, speech]);
  const targetsFor = (src: string) => [...p.languages.targets(src, s, { speech })];

  // Seed once from the provider's lists (spec §1.2 step 4); Back/Next keeps the
  // user's picks because the draft already holds them.
  useEffect(() => {
    // !== null, not truthiness: when a source offers no targets at all `keep`
    // lands on '', and a truthiness guard would read that as unseeded and
    // re-seed on the next render, throwing away the source the user just picked.
    if (draft.sourceLanguage !== null && draft.targetLanguage !== null) return;
    // The provider store's entry, not the old slice: that is loaded once at
    // startup and no longer follows edits (plan 1e-3b-2's switch).
    const entry = useProviderStore.getState().entries[p.id];
    const pair = defaultLanguagePair({
      sources, targetsFor, uiLanguage,
      providerDefault: { source: entry?.pair.source ?? sources[0]?.value ?? 'en', target: entry?.pair.target ?? 'en' },
    });
    dispatch({ type: 'setLanguages', source: pair.source, target: pair.target });
  }, [p, sources, uiLanguage, draft.sourceLanguage, draft.targetLanguage, dispatch]);

  // A scenario changed on Back keeps the draft's pair (`setScenario` with
  // `keepProvider`); one its lists do not hold is normalized into them, by
  // the rule the provider store keeps (Stage 2 Volcengine AST2, choice 1).
  useEffect(() => {
    if (draft.sourceLanguage === null || draft.targetLanguage === null) return;
    const next = normalizePair(p, s, { source: draft.sourceLanguage, target: draft.targetLanguage }, { speech });
    if (next.source !== draft.sourceLanguage || next.target !== draft.targetLanguage) {
      dispatch({ type: 'setLanguages', source: next.source, target: next.target });
    }
  }, [p, s, speech, draft.sourceLanguage, draft.targetLanguage, dispatch]);

  const source = draft.sourceLanguage ?? '';
  const targets = source ? targetsFor(source) : [];

  // The same sentence Settings' language pair prints, over the same two fields:
  // whichever way round a provider runs the legs, the user should meet one
  // vocabulary for them.
  const sentence = pairSentence({
    mode: preset.mode,
    textOnly: preset.textOnly,
    capability: textOnlyCapabilityOf(p),
    source, target: draft.targetLanguage,
  });
  const myLabel = t(sentence.my.key, sentence.my.fallback);
  const theirLabel = t(sentence.their.key, sentence.their.fallback);
  const nameOf = (v: string) => label(v);

  // Display only: the dropdowns use the app-wide order; the seeding above keeps
  // reading the provider's own order.
  const browser = typeof navigator !== 'undefined' ? navigator.languages ?? [] : [];
  const ctx: OrderContext = { ui: uiLanguage ?? 'en', browser };
  const pair = { source, target: draft.targetLanguage ?? '' };
  const options = (list: typeof sources, name: (v: string) => string) => (
    <>
      {pinnedLanguages(list, pair, ctx).map((o) => <option key={`pin:${o.value}`} value={o.value}>{name(o.value)}</option>)}
      {pinnedLanguages(list, pair, ctx).length > 0 && <option key="pin-separator" value={PIN_SEPARATOR} disabled>{SEPARATOR}</option>}
      {orderLanguages(list, ctx).map((o) => <option key={o.value} value={o.value}>{name(o.value)}</option>)}
    </>
  );

  const setSource = (next: string) => {
    const nextTargets = targetsFor(next);
    const keep = nextTargets.some((o) => o.value === draft.targetLanguage) ? draft.targetLanguage! : (nextTargets[0]?.value ?? '');
    dispatch({ type: 'setLanguages', source: next, target: keep });
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.languagePair.title', 'Which languages?')}</h2>
      <p>{t('setup.steps.languagePair.desc', 'What you (or they) speak, and what it should become.')}</p>
      <label className="setup-field">
        <span>{myLabel}</span>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={myLabel}>
          {options(sources, nameOf)}
        </select>
      </label>
      <label className="setup-field">
        <span>{theirLabel}</span>
        <select value={draft.targetLanguage ?? ''} onChange={(e) => dispatch({ type: 'setLanguages', source, target: e.target.value })} aria-label={theirLabel}>
          {options(targets, label)}
        </select>
      </label>
      {/* Both mode runs a mirrored second leg off the same two fields. There
          are no controls for it — here or in Settings — so it is stated. */}
      {sentence.showMirror && (
        <p className="setup-mirror">
          {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', {
            their: nameOf(draft.targetLanguage ?? ''),
            mine: nameOf(source),
          })}
        </p>
      )}
    </section>
  );
};

export default StepLanguagePair;

import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../../stores/providerStore';
import { AUTO } from '../../../lib/provider/languages';
import { getScenario } from '../../../lib/setup/scenarios';
import { pairSentence } from '../languageSentence';
import { defaultLanguagePair } from '../languageDefaults';
import { textOnlyCapabilityOf, wizardProvider } from '../providerPaths';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const StepLanguagePair: React.FC<Props> = ({ draft, dispatch }) => {
  // The language in effect (see StepLanguage), not settingsStore.uiLanguage:
  // the default pair should start from the language the user is reading.
  const { t, i18n } = useTranslation();
  const uiLanguage = i18n.language;
  const p = wizardProvider(draft.provider)!;
  const s = useProviderStore((st) => st.entries[p.id]?.settings) ?? p.settings.defaults;
  const sources = useMemo(() => [...p.languages.sources(s)], [p, s]);
  const targetsFor = (src: string) => [...p.languages.targets(src, s)];

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

  const source = draft.sourceLanguage ?? '';
  const targets = source ? targetsFor(source) : [];

  // The same sentence Settings' language pair prints, over the same two fields:
  // whichever way round a provider runs the legs, the user should meet one
  // vocabulary for them.
  const preset = getScenario(draft.scenario!);
  const sentence = pairSentence({
    mode: preset.mode,
    textOnly: preset.textOnly,
    capability: textOnlyCapabilityOf(p),
    source, target: draft.targetLanguage,
  });
  const myLabel = t(sentence.my.key, sentence.my.fallback);
  const theirLabel = t(sentence.their.key, sentence.their.fallback);
  // A source list can start with AUTO (Soniox's does, `LanguagePairSection.tsx:38`'s rule): named by the catalogue key Settings uses, never the definition's raw "Auto".
  const nameOf = (list: { value: string; name: string }[], v: string) => (v === AUTO ? t('common.autoDetect') : list.find((o) => o.value === v)?.name ?? v);

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
          {sources.map((o) => <option key={o.value} value={o.value}>{nameOf(sources, o.value)}</option>)}
        </select>
      </label>
      <label className="setup-field">
        <span>{theirLabel}</span>
        <select value={draft.targetLanguage ?? ''} onChange={(e) => dispatch({ type: 'setLanguages', source, target: e.target.value })} aria-label={theirLabel}>
          {targets.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        </select>
      </label>
      {/* Both mode runs a mirrored second leg off the same two fields. There
          are no controls for it — here or in Settings — so it is stated. */}
      {sentence.showMirror && (
        <p className="setup-mirror">
          {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', {
            their: nameOf(targets, draft.targetLanguage ?? ''),
            mine: nameOf(sources, source),
          })}
        </p>
      )}
    </section>
  );
};

export default StepLanguagePair;

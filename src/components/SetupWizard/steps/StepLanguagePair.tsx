import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import { getScenario } from '../../../lib/setup/scenarios';
import { pairSentence } from '../languageSentence';
import { defaultLanguagePair } from '../languageDefaults';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const StepLanguagePair: React.FC<Props> = ({ draft, dispatch }) => {
  // The language in effect (see StepLanguage), not settingsStore.uiLanguage:
  // the default pair should start from the language the user is reading.
  const { t, i18n } = useTranslation();
  const uiLanguage = i18n.language;
  const descriptor = ProviderConfigFactory.getDescriptor(draft.provider!);
  const sources = useMemo(() => descriptor.resolveSourceLanguages(), [descriptor]);
  const targetsFor = (s: string) => descriptor.resolveTargetLanguages(s);

  // Seed once from the provider's lists (spec §1.2 step 4); Back/Next keeps the
  // user's picks because the draft already holds them.
  useEffect(() => {
    // !== null, not truthiness: when a source offers no targets at all `keep`
    // lands on '', and a truthiness guard would read that as unseeded and
    // re-seed on the next render, throwing away the source the user just picked.
    if (draft.sourceLanguage !== null && draft.targetLanguage !== null) return;
    const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore] as { sourceLanguage?: string; targetLanguage?: string };
    const pair = defaultLanguagePair({
      sources, targetsFor, uiLanguage,
      providerDefault: { source: slice?.sourceLanguage ?? sources[0]?.value ?? 'en', target: slice?.targetLanguage ?? 'en' },
    });
    dispatch({ type: 'setLanguages', source: pair.source, target: pair.target });
  }, [descriptor, sources, uiLanguage, draft.sourceLanguage, draft.targetLanguage, dispatch]);

  const source = draft.sourceLanguage ?? '';
  const targets = source ? targetsFor(source) : [];

  // The same sentence Settings' language pair prints, over the same two fields:
  // whichever way round a provider runs the legs, the user should meet one
  // vocabulary for them.
  const preset = getScenario(draft.scenario!);
  const sentence = pairSentence(
    preset.mode, preset.textOnly,
    ProviderConfigFactory.getConfig(draft.provider!).capabilities.textOnlyCapability,
  );
  const myLabel = t(sentence.my.key, sentence.my.fallback);
  const theirLabel = t(sentence.their.key, sentence.their.fallback);
  const nameOf = (list: { value: string; name: string }[], v: string) => list.find((o) => o.value === v)?.name ?? v;

  const setSource = (s: string) => {
    const nextTargets = targetsFor(s);
    const keep = nextTargets.some((o) => o.value === draft.targetLanguage) ? draft.targetLanguage! : (nextTargets[0]?.value ?? '');
    dispatch({ type: 'setLanguages', source: s, target: keep });
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.languagePair.title', 'Which languages?')}</h2>
      <p>{t('setup.steps.languagePair.desc', 'What you (or they) speak, and what it should become.')}</p>
      <label className="setup-field">
        <span>{myLabel}</span>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={myLabel}>
          {sources.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
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
      {sentence.showMirror && draft.targetLanguage && (
        <p className="setup-mirror">
          {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', {
            their: nameOf(targets, draft.targetLanguage),
            mine: nameOf(sources, source),
          })}
        </p>
      )}
    </section>
  );
};

export default StepLanguagePair;

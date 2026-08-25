import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import { getScenario } from '../../../lib/setup/scenarios';
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

  // The same sentence Settings' language pair prints (LanguageSection.tsx:484),
  // over the same two fields: whichever way round a provider runs the legs, the
  // user should meet one vocabulary for them. Mode and text-only come from the
  // scenario the wizard just applied, except where the provider overrules the
  // toggle — a provider that always speaks makes "they read" a lie.
  const preset = getScenario(draft.scenario!);
  const capability = ProviderConfigFactory.getConfig(draft.provider!).capabilities.textOnlyCapability;
  const speakerLegTextOnly = capability === 'always' ? true : capability === 'never' ? false : preset.textOnly;
  const myLabel = preset.mode === 'participant'
    ? t('settings.langSentence.iRead', 'I read')
    : t('settings.langSentence.iSpeak', 'I speak');
  const theirLabel = preset.mode === 'participant'
    ? t('settings.langSentence.theySpeak', 'they speak')
    : speakerLegTextOnly
      ? t('settings.langSentence.theyRead', 'they read')
      : t('settings.langSentence.theyHear', 'they hear');

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
    </section>
  );
};

export default StepLanguagePair;

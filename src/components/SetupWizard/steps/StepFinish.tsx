import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { getScenario } from '../../../lib/setup/scenarios';
import { pairSentence } from '../languageSentence';
import StatusMessage from '../../Settings/shared/StatusMessage';
import type { SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; isSignedIn: boolean; error: string | null }

const StepFinish: React.FC<Props> = ({ draft, isSignedIn, error }) => {
  const { t } = useTranslation();
  const preset = getScenario(draft.scenario!);
  const descriptor = ProviderConfigFactory.getDescriptor(draft.provider!);
  const providerName = t(`providers.${descriptor.i18nKey ?? draft.provider}.name`, ProviderConfigFactory.getConfig(draft.provider!).displayName);
  const nameOf = (list: { value: string; name: string }[], v: string | null) => list.find((o) => o.value === v)?.name ?? v ?? '';
  const sourceName = nameOf(descriptor.resolveSourceLanguages(), draft.sourceLanguage);
  const targetName = nameOf(descriptor.resolveTargetLanguages(draft.sourceLanguage ?? ''), draft.targetLanguage);
  // The pair reads as the sentence the pair step and Settings both print,
  // rather than as a bare arrow that says nothing about who hears what.
  const sentence = pairSentence(preset.mode, preset.textOnly, ProviderConfigFactory.getConfig(draft.provider!).capabilities.textOnlyCapability);
  const langLine = (label: { key: string; fallback: string }, name: string) =>
    t('setup.summary.langLine', '{{label}}: {{name}}', { label: t(label.key, label.fallback), name });
  // Same source as the scenario cards and the ModePicker itself.
  const modeLabel = preset.mode === 'speaker'
    ? t('modePicker.modeYou', 'Me')
    : preset.mode === 'participant' ? t('modePicker.modeParticipants', 'Other') : t('modePicker.modeBoth', 'Both');
  const output = preset.textOnly ? t('setup.output.subtitles', 'subtitles only') : t('setup.output.voice', 'voice and subtitles');

  // On the managed path sign-in state is the whole truth: a user who took
  // "Skip for now" and then signed in from the overlay is no longer pending,
  // and one who never signed in is — whatever the draft's flag says.
  const pending = draft.providerPath === 'managed' ? !isSignedIn : draft.credentialsPending;

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.finish.title', 'Ready')}</h2>
      <dl className="setup-summary">
        <dt>{t('setup.summary.scenario', 'Scenario')}</dt><dd>{t(`setup.scenarios.${preset.id}.title`, preset.id)}</dd>
        <dt>{t('setup.summary.mode', 'Mode')}</dt><dd>{modeLabel} · {output}</dd>
        <dt>{t('setup.summary.provider', 'Provider')}</dt><dd>{providerName}</dd>
        <dt>{t('setup.summary.languages', 'Languages')}</dt>
        <dd>
          {langLine(sentence.my, sourceName)} · {langLine(sentence.their, targetName)}
          {/* Both mode's mirrored leg has no controls anywhere; the pair step
              states it too, and the summary must not quietly drop half the
              session. */}
          {sentence.showMirror && (
            <div className="setup-summary__mirror">
              {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', { their: targetName, mine: sourceName })}
            </div>
          )}
        </dd>
      </dl>
      {pending && (
        <StatusMessage variant="warning">
          {draft.providerPath === 'managed'
            ? t('setup.summary.pendingSignIn', 'Not signed in — sign in from the account button before you start.')
            : t('setup.summary.pendingKey', 'No API key yet — add it in Settings → Provider before you start.')}
        </StatusMessage>
      )}
      {error && <StatusMessage variant="error">{error}</StatusMessage>}
    </section>
  );
};

export default StepFinish;

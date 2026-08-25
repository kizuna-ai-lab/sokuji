import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { getScenario } from '../../../lib/setup/scenarios';
import StatusMessage from '../../Settings/shared/StatusMessage';
import type { SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; isSignedIn: boolean; error: string | null }

const StepFinish: React.FC<Props> = ({ draft, isSignedIn, error }) => {
  const { t } = useTranslation();
  const preset = getScenario(draft.scenario!);
  const descriptor = ProviderConfigFactory.getDescriptor(draft.provider!);
  const providerName = t(`providers.${descriptor.i18nKey ?? draft.provider}.name`, ProviderConfigFactory.getConfig(draft.provider!).displayName);
  const nameOf = (list: { value: string; name: string }[], v: string | null) => list.find((o) => o.value === v)?.name ?? v ?? '';
  // Same source as the scenario cards and the ModePicker itself.
  const modeLabel = preset.mode === 'speaker'
    ? t('modePicker.modeYou', 'Me')
    : preset.mode === 'participant' ? t('modePicker.modeParticipants', 'Other') : t('modePicker.modeBoth', 'Both');
  const output = preset.textOnly ? t('setup.output.subtitles', 'subtitles') : t('setup.output.voice', 'spoken');

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
        <dd>{nameOf(descriptor.resolveSourceLanguages(), draft.sourceLanguage)} → {nameOf(descriptor.resolveTargetLanguages(draft.sourceLanguage ?? ''), draft.targetLanguage)}</dd>
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

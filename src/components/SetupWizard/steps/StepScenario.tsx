import React from 'react';
import { useTranslation } from 'react-i18next';
import { SCENARIOS } from '../../../lib/setup/scenarios';
import { providerFits } from '../providerPaths';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

// Titles double as the accessible names the tests use; keep the English
// defaults in sync with SetupWizard.test.tsx.
const TITLES: Record<string, string> = {
  'understand-others': 'Understand what others say',
  'be-heard': 'Be understood in a meeting',
  'subtitle-myself': 'Subtitle my own speech',
  'two-way-voice': 'Two-way online conversation',
  'two-way-text': 'Two-way online conversation, subtitles only',
};
const DESCS: Record<string, string> = {
  'understand-others': 'Online meetings, classes, talks, videos, streams — read a live translation of what you hear.',
  'be-heard': 'They hear your translated voice through a virtual microphone.',
  'subtitle-myself': 'Talks, streams, presentations — your audience reads translated subtitles; no audio is generated.',
  'two-way-voice': 'They hear your translated voice; you read their subtitles.',
  'two-way-text': 'Bilingual captions, meeting minutes — both sides as text, no synthetic voice.',
};

const StepScenario: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const modeLabel = (m: string) => t(`setup.modes.${m}`, m === 'speaker' ? 'Me' : m === 'participant' ? 'Others' : 'Both');
  const outputLabel = (textOnly: boolean) => (textOnly ? t('setup.output.subtitles', 'subtitles') : t('setup.output.voice', 'spoken'));

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.scenario.title', 'What do you want to do?')}</h2>
      <p>{t('setup.steps.scenario.desc', 'Pick the closest match. You can change any of this later.')}</p>
      <div className="setup-cards" role="radiogroup" aria-label={t('setup.steps.scenario.title', 'What do you want to do?')}>
        {SCENARIOS.map((s) => (
          <label key={s.id} className={`setup-card${draft.scenario === s.id ? ' is-selected' : ''}`}>
            <input
              type="radio" name="scenario" value={s.id} checked={draft.scenario === s.id}
              onChange={() => dispatch({
                type: 'setScenario', scenario: s.id,
                keepProvider: draft.provider ? providerFits(draft.provider, s.id) : true,
              })}
            />
            <span className="setup-card__title">{t(`setup.scenarios.${s.id}.title`, TITLES[s.id])}</span>
            <span className="setup-card__desc">{t(`setup.scenarios.${s.id}.desc`, DESCS[s.id])}</span>
            <span className="setup-card__sets">
              {t('setup.scenarios.sets', 'Sets: mode {{mode}} · {{output}}', { mode: modeLabel(s.mode), output: outputLabel(s.textOnly) })}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
};

export default StepScenario;

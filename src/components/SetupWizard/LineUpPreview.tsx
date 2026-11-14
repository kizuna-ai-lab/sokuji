// src/components/SetupWizard/LineUpPreview.tsx
//
// The line-up a wizard path sets up (Plan 6): one row per stage, each the
// provider's name and the description it already has (owner, 2026-11-15).
// On the provider step it sits in a dashed box with a title and a line saying
// where to change it later; the finish step draws the rows alone (`bare`).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RUN_STAGES, type RunStage } from '../../lib/lineup/types';
import { lineUpOf } from './providerPaths';

const STAGE_TITLES: Record<RunStage, string> = { transcription: 'Transcription', translation: 'Translation', speech: 'Speech' };

export function LineUpPreview({ provider, bare = false }: { provider: string; bare?: boolean }) {
  const { t } = useTranslation();
  const lineUp = lineUpOf(provider);
  const rows = (
    <dl className="lineup-preview__rows">
      {RUN_STAGES.map((stage) => {
        const id = lineUp[stage] ?? '';
        // Bing and Edge have no description, only their short note.
        const about = t(`providers.${id}.description`, { defaultValue: t(`providers.${id}.note`, '') });
        return (
          <React.Fragment key={stage}>
            <dt>{t(`settingsPage.lineup.stages.${stage}`, STAGE_TITLES[stage])}</dt>
            <dd>
              <span className="lineup-preview__name">{t(`providers.${id}.name`, id)}</span>
              {about && <span className="lineup-preview__about">{about}</span>}
            </dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
  if (bare) return rows;
  const title = t('setup.lineup.title', 'The line-up this sets up');
  return (
    <div className="lineup-preview" role="group" aria-label={title}>
      <div className="lineup-preview__title">{title}</div>
      {rows}
      <p className="lineup-preview__later">{t('setup.lineup.later', 'You can change each stage later in Settings → Languages and line-up.')}</p>
    </div>
  );
}

export default LineUpPreview;

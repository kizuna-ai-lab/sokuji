import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { Provider } from '../../../types/Provider';
import type { ProviderType } from '../../../types/Provider';
import type { ProviderPath } from '../../../lib/setup/types';
import { availablePaths, managedProvider, ownKeyOptions, offlineOptions } from '../providerPaths';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const PATH_COPY: Record<ProviderPath, { title: string; desc: string; cost: string }> = {
  managed: {
    title: 'Start right away',
    desc: 'Sokuji runs the translation for you.',
    cost: 'Needs a Kizuna AI account (email) with a balance. New accounts get a trial credit.',
  },
  'own-key': {
    title: 'I have my own API key',
    desc: 'Use OpenAI, Gemini, Soniox and others directly.',
    cost: 'You pay the provider for usage.',
  },
  offline: {
    title: 'Free, offline',
    desc: 'Runs on your own machine. Nothing leaves it.',
    cost: 'Downloads models onto your disk (gigabytes). Runs well with a GPU and enough VRAM; CPU-only is noticeably slower.',
  },
};

const StepProviderPath: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const scenario = draft.scenario!;
  const nameOf = (id: ProviderType) => {
    const key = ProviderConfigFactory.getDescriptor(id).i18nKey ?? id;
    return t(`providers.${key}.name`, ProviderConfigFactory.getConfig(id).displayName);
  };
  const reasonOf = (reason: 'cannot-speak' | 'cannot-be-text-only') => reason === 'cannot-speak'
    ? t('setup.fit.cannotSpeak', 'This provider cannot produce spoken translation.')
    : t('setup.fit.cannotBeTextOnly', 'This provider always speaks; it cannot run subtitles-only.');

  const choosePath = (path: ProviderPath) => {
    if (path === 'managed') dispatch({ type: 'setPath', path, provider: managedProvider() });
    else if (path === 'offline') dispatch({ type: 'setPath', path, provider: Provider.LOCAL_INFERENCE });
    else dispatch({ type: 'setPath', path, provider: null });
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.path.title', 'What do you have?')}</h2>
      <div className="setup-cards" role="radiogroup" aria-label={t('setup.steps.path.title', 'What do you have?')}>
        {availablePaths().map((path) => (
          <label key={path} className={`setup-card${draft.providerPath === path ? ' is-selected' : ''}`}>
            <input type="radio" name="path" value={path} checked={draft.providerPath === path} onChange={() => choosePath(path)} />
            <span className="setup-card__title">
              {t(`setup.paths.${path}.title`, PATH_COPY[path].title)}
              {path === 'managed' && <em className="setup-card__badge">{t('setup.paths.recommended', 'Recommended')}</em>}
            </span>
            <span className="setup-card__desc">{t(`setup.paths.${path}.desc`, PATH_COPY[path].desc)}</span>
            <span className="setup-card__cost">{t(`setup.paths.${path}.cost`, PATH_COPY[path].cost)}</span>
          </label>
        ))}
      </div>

      {draft.providerPath === 'own-key' && (
        <div className="setup-cards setup-cards--compact" role="radiogroup" aria-label={t('setup.paths.pickProvider', 'Which provider?')}>
          {ownKeyOptions(scenario).map(({ id, fit }) => (
            <label key={id} className={`setup-card${draft.provider === id ? ' is-selected' : ''}${fit.ok ? '' : ' is-disabled'}`}>
              <input type="radio" name="provider" value={id} checked={draft.provider === id} disabled={!fit.ok}
                onChange={() => dispatch({ type: 'setProvider', provider: id })} />
              <span className="setup-card__title">{nameOf(id)}</span>
              {!fit.ok && <span className="setup-card__reason">{reasonOf(fit.reason)}</span>}
            </label>
          ))}
        </div>
      )}

      {draft.providerPath === 'offline' && offlineOptions().length > 1 && (
        <div className="setup-cards setup-cards--compact" role="radiogroup" aria-label={t('setup.paths.offlineFlavor', 'Which engine?')}>
          {offlineOptions().map((id) => (
            <label key={id} className={`setup-card${draft.provider === id ? ' is-selected' : ''}`}>
              <input type="radio" name="provider" value={id} checked={draft.provider === id}
                onChange={() => dispatch({ type: 'setProvider', provider: id })} />
              <span className="setup-card__title">{nameOf(id)}</span>
              <span className="setup-card__desc">
                {id === Provider.LOCAL_NATIVE
                  ? t('setup.paths.offline.native', 'Native engine — faster, uses your GPU where available.')
                  : t('setup.paths.offline.wasm', 'In-app engine — works everywhere, slower.')}
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
};

export default StepProviderPath;

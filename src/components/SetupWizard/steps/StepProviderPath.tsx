import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { AI_PROVIDERS_DOCS_URL } from '../../../services/providers/tutorialUrls';
import { openExternalUrl } from '../../../utils/openExternalUrl';
import { Provider } from '../../../types/Provider';
import type { ProviderType } from '../../../types/Provider';
import type { ProviderPath } from '../../../lib/setup/types';
import { availablePaths, managedOptions, ownKeyOptions, offlineOptions, offlineFit, wizardProvider } from '../providerPaths';
import { LineUpPreview } from '../LineUpPreview';
import type { SetupAction, SetupDraft } from '../setupDraft';

interface Props { draft: SetupDraft; dispatch: React.Dispatch<SetupAction> }

const PATH_COPY: Record<ProviderPath, { title: string; desc: string; cost: string }> = {
  managed: {
    title: 'Start right away',
    desc: 'Kizuna AI runs the translation for you.',
    cost: 'Sign up with your email address and verify it — verified accounts get a trial credit. After that you top up your balance, and translation is billed by how much you use.',
  },
  'own-key': {
    title: 'I have my own API key',
    desc: 'Bring your own key from OpenAI, Gemini, Doubao (Volcengine) and others.',
    cost: 'Your key stays on this device and reaches the provider straight from it. You are their customer: you pay them for what you use, and nothing goes through Kizuna AI.',
  },
  offline: {
    title: 'No key needed',
    desc: 'Free. Recognition runs on this computer; translation uses Bing and speech uses Edge, which go online as Microsoft services.',
    cost: 'Recognition needs a model downloaded to disk first. Runs well with a GPU; noticeably slower on CPU only.',
  },
};

/** Each hosted service's strength, as the owner worded it (2026-11-15); nothing more on the cards. */
const HOSTED_COPY: Record<string, string> = {
  kizunaai_soniox: 'Real-time transcription, fast translation.',
  kizunaai_qwen: 'Can look at your screen; very accurate transcription and translation.',
};

const StepProviderPath: React.FC<Props> = ({ draft, dispatch }) => {
  const { t } = useTranslation();
  const scenario = draft.scenario!;
  const nameOf = (id: ProviderType) => {
    const p = wizardProvider(id);
    const key = p?.id ?? id;
    return t(`providers.${key}.name`, key);
  };
  const reasonOf = (reason: 'cannot-speak' | 'cannot-be-text-only' | 'cannot-face-to-face') => reason === 'cannot-speak'
    ? t('setup.fit.cannotSpeak', 'This provider cannot produce spoken translation.')
    : reason === 'cannot-face-to-face'
      ? t('setup.fit.cannotFaceToFace', 'This provider cannot translate two people at one microphone.')
      : t('setup.fit.cannotBeTextOnly', 'This provider always speaks; it cannot run subtitles-only.');

  // The managed path is greyed only when no hosted service fits the scenario; the offline path resolves to one
  // fixed provider, so its fitness is known before the user picks it.
  const hosted = managedOptions(scenario);
  const firstFitting = hosted.find((o) => o.fit.ok)?.id ?? null;
  const managedFit = hosted.length === 0 || firstFitting ? { ok: true as const } : hosted[0].fit;
  const offline = offlineFit(scenario);

  const choosePath = (path: ProviderPath) => {
    // Preselected with the first hosted service that fits: the recommended one unless the scenario rules it out.
    if (path === 'managed') dispatch({ type: 'setPath', path, provider: firstFitting });
    else if (path === 'offline') dispatch({ type: 'setPath', path, provider: Provider.LOCAL_INFERENCE });
    else dispatch({ type: 'setPath', path, provider: null });
  };

  return (
    <section className="setup-step">
      <h2>{t('setup.steps.path.title', 'Choose an AI service provider')}</h2>
      <div className="setup-cards" role="radiogroup" aria-label={t('setup.steps.path.title', 'Choose an AI service provider')}>
        {availablePaths().map((path) => {
          const unfit = path === 'managed' && !managedFit.ok ? managedFit : path === 'offline' && !offline.ok ? offline : null;
          return (
            <label key={path} className={`setup-card${draft.providerPath === path ? ' is-selected' : ''}${unfit ? ' is-disabled' : ''}`}>
              <input type="radio" name="path" value={path} checked={draft.providerPath === path} disabled={!!unfit}
                onChange={() => choosePath(path)} />
              <span className="setup-card__title">
                {t(`setup.paths.${path}.title`, PATH_COPY[path].title)}
                {path === 'managed' && !unfit && <em className="setup-card__badge">{t('setup.paths.recommended', 'Recommended')}</em>}
              </span>
              <span className="setup-card__desc">{t(`setup.paths.${path}.desc`, PATH_COPY[path].desc)}</span>
              <span className="setup-card__cost">{t(`setup.paths.${path}.cost`, PATH_COPY[path].cost)}</span>
              {unfit && <span className="setup-card__reason">{reasonOf(unfit.reason)}</span>}
            </label>
          );
        })}
      </div>

      {draft.providerPath === 'managed' && hosted.length > 0 && (
        <div className="setup-cards setup-cards--compact" role="radiogroup" aria-label={t('setup.paths.managedPick', 'Which hosted service?')}>
          {hosted.map(({ id, fit }, i) => (
            <label key={id} className={`setup-card${draft.provider === id ? ' is-selected' : ''}${fit.ok ? '' : ' is-disabled'}`}>
              <input type="radio" name="provider" value={id} checked={draft.provider === id} disabled={!fit.ok}
                onChange={() => dispatch({ type: 'setProvider', provider: id })} />
              <span className="setup-card__title">
                {wizardProvider(id)?.vendor ?? nameOf(id)}
                {i === 0 && fit.ok && <em className="setup-card__badge">{t('setup.paths.recommended', 'Recommended')}</em>}
              </span>
              <span className="setup-card__desc">{t(`setup.paths.managed.options.${id}`, HOSTED_COPY[id] ?? '')}</span>
              {!fit.ok && <span className="setup-card__reason">{reasonOf(fit.reason)}</span>}
            </label>
          ))}
        </div>
      )}

      {draft.providerPath === 'own-key' && (
        <>
        <p className="setup-step__note">
          {t('setup.paths.ownKeyNote', 'Pick the provider you have an account with. Each one issues its own key:')}
          {' '}
          <a
            className="setup-link"
            href={AI_PROVIDERS_DOCS_URL}
            onClick={(e) => { e.preventDefault(); openExternalUrl(AI_PROVIDERS_DOCS_URL); }}
          >
            <ExternalLink size={12} />
            {t('setup.paths.ownKeyGuides', 'guides for every provider')}
          </a>
        </p>
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
        </>
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
      {draft.providerPath && draft.provider && <LineUpPreview provider={draft.provider} />}
    </section>
  );
};

export default StepProviderPath;

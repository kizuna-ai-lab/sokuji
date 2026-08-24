// src/components/SetupWizard/SetupWizard.tsx
//
// First-run setup (spec §1). Six steps over one draft; nothing is written until
// Finish. `variant="first-run"` fills the window in place of MainLayout;
// `variant="rerun"` is an overlay Help opens over the running app.
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFloating, useDismiss, useRole, useInteractions, FloatingFocusManager } from '@floating-ui/react';
import { X } from 'lucide-react';
import { useAuth } from '../../lib/auth/hooks';
import { useAnalytics } from '../../lib/analytics';
import { useIsApiKeyValid } from '../../stores/settingsStore';
import { useSetupRecord } from '../../stores/setupStore';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import type { ProviderType } from '../../types/Provider';
import { initialDraft, draftFromRecord, setupReducer, canAdvance, LAST_STEP } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { useApplySetup } from './useApplySetup';
import StepLanguage from './steps/StepLanguage';
import StepScenario from './steps/StepScenario';
import StepProviderPath from './steps/StepProviderPath';
import StepCredentials from './steps/StepCredentials';
import StepLanguagePair from './steps/StepLanguagePair';
import StepFinish from './steps/StepFinish';
import Button from '../Settings/shared/Button';
import './SetupWizard.scss';

const STEP_IDS = ['language', 'scenario', 'path', 'credentials', 'language-pair', 'finish'] as const;

interface SetupWizardProps {
  variant: 'first-run' | 'rerun';
  onClose?: () => void;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ variant, onClose }) => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { trackEvent } = useAnalytics();
  const record = useSetupRecord();
  const apiKeyValid = useIsApiKeyValid();
  const apply = useApplySetup();

  const [draft, dispatch] = useReducer(setupReducer, undefined, (): SetupDraft =>
    variant === 'rerun' && record && record.provider && ProviderConfigFactory.isProviderSupported(record.provider as ProviderType)
      ? draftFromRecord(record, { credentialsAlreadyValid: apiKeyValid === true })
      : initialDraft());
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // trackEvent is a fresh closure every render (useAnalytics is not memoized),
  // so it cannot sit in an effect's dependency array without refiring on every
  // keystroke that re-renders the frame (e.g. typing a credential). Read the
  // latest one through a ref instead, keeping the step-tracking effect's own
  // deps down to the one thing that should actually retrigger it: the step.
  const trackRef = useRef(trackEvent);
  useEffect(() => { trackRef.current = trackEvent; });

  const lastStepRef = useRef(-1);
  useEffect(() => {
    if (lastStepRef.current === -1) {
      trackRef.current('setup_started', { variant });
    }
    if (draft.step !== lastStepRef.current) {
      trackRef.current('setup_step_viewed', { step: draft.step, step_id: STEP_IDS[draft.step] });
    }
    lastStepRef.current = draft.step;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.step]);

  const advance = canAdvance(draft, { isSignedIn });

  // Same rule as StepFinish's pending line: on the managed path the draft's
  // "Skip for now" flag is stale the moment the user signs in from the overlay.
  const credentialsPending = draft.providerPath === 'managed' ? !isSignedIn : draft.credentialsPending;

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await apply(draft);
      trackEvent('setup_completed', {
        scenario: draft.scenario ?? '', provider_path: draft.providerPath ?? '', provider: draft.provider ?? '',
        source_language: draft.sourceLanguage ?? '', target_language: draft.targetLanguage ?? '',
        credentials_pending: credentialsPending,
      });
      onClose?.();
    } catch (err) {
      console.error('[SetupWizard] Finish failed:', err);
      setFinishError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishing(false);
    }
  };

  const close = () => {
    // Finish is already writing settings and the record; abandoning halfway
    // would leave the app in a state neither the wizard nor the user chose.
    if (finishing) return;
    trackEvent('setup_abandoned', { step: draft.step });
    onClose?.();
  };

  // Only the rerun overlay is modal, and only it needs the machinery: it sits
  // over a running app, so Tab must not walk the app behind it and Escape has
  // to work before the user has tabbed in (a React onKeyDown on the card is
  // dead while focus is on <body>, which is where Help leaves it). Keeping
  // `open` false on first run also keeps useDismiss from turning a stray
  // Escape into a setup_abandoned event that closes nothing.
  const isModal = variant === 'rerun';
  const { refs, context } = useFloating({
    open: isModal,
    onOpenChange: (isOpen) => { if (!isOpen) close(); },
  });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const card = (
    <div
      ref={refs.setFloating}
      className="setup-wizard__card"
      role="dialog"
      aria-modal={isModal}
      aria-labelledby="setup-wizard-title"
      tabIndex={-1}
      {...(isModal ? getFloatingProps() : {})}
    >
      <header className="setup-wizard__header">
        <h1 id="setup-wizard-title">{t('setup.title', 'Set up Sokuji')}</h1>
        <span className="setup-wizard__progress" aria-live="polite">
          {t('setup.stepOf', 'Step {{current}} of {{total}}', { current: draft.step + 1, total: LAST_STEP + 1 })}
        </span>
        {onClose && (
          <button type="button" className="setup-wizard__close" onClick={close} aria-label={t('setup.close', 'Close')}>
            <X size={16} />
          </button>
        )}
      </header>

      <main className="setup-wizard__body">
        {draft.step === 0 && <StepLanguage />}
        {draft.step === 1 && <StepScenario draft={draft} dispatch={dispatch} />}
        {draft.step === 2 && <StepProviderPath draft={draft} dispatch={dispatch} />}
        {draft.step === 3 && <StepCredentials draft={draft} dispatch={dispatch} />}
        {draft.step === 4 && <StepLanguagePair draft={draft} dispatch={dispatch} />}
        {draft.step === 5 && <StepFinish draft={draft} isSignedIn={isSignedIn} error={finishError} />}
      </main>

      <footer className="setup-wizard__footer">
        {draft.step > 0 && (
          <Button variant="secondary" onClick={() => dispatch({ type: 'back' })} disabled={finishing}>
            {t('setup.back', 'Back')}
          </Button>
        )}
        <span className="setup-wizard__spacer" />
        {draft.step < LAST_STEP ? (
          <Button variant="primary" onClick={() => dispatch({ type: 'next' })} disabled={!advance}>
            {t('setup.next', 'Next')}
          </Button>
        ) : (
          <Button variant="primary" onClick={finish} loading={finishing} disabled={finishing}>
            {t('setup.finish', 'Finish')}
          </Button>
        )}
      </footer>
    </div>
  );

  return (
    <div className={`setup-wizard setup-wizard--${variant}`}>
      {isModal
        ? (
          <FloatingFocusManager context={context} modal returnFocus initialFocus={refs.floating}>
            {card}
          </FloatingFocusManager>
        )
        : card}
    </div>
  );
};

export default SetupWizard;

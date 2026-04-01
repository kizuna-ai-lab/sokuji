import React, { useCallback, useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, EVENTS, ACTIONS } from 'react-joyride';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useTranslation } from 'react-i18next';
import useSettingsStore from '../../stores/settingsStore';
import './Onboarding.scss';

// Map step targets to the settings tab/action needed to make them visible
// Map step targets to the navigateToSettings target for tab switching + scroll + highlight
const TARGET_NAVIGATION_MAP: Record<string, string | 'close-settings'> = {
  // Advanced mode (class selectors)
  '.provider-section': 'api-key',
  '.system-instructions-section': 'system-instructions',
  '.voice-settings-section': 'voice-settings',
  '.turn-detection-section': 'turn-detection',
  '.microphone-section': 'microphone',
  '.speaker-section': 'speaker',
  '.main-action-btn': 'close-settings',
  '.session-button': 'close-settings',
  // Basic mode (ID selectors)
  '#user-account-section': 'user-account',
  '#provider-section': 'provider',
  '#languages-section': 'languages',
  '#microphone-section': 'microphone',
  '#speaker-section': 'speaker',
};

const Onboarding: React.FC = () => {
  const { t } = useTranslation();
  const {
    isOnboardingActive,
    currentStepIndex,
    steps,
    nextStep,
    prevStep,
    skipOnboarding,
    markOnboardingComplete,
  } = useOnboarding();

  /**
   * Prepare the UI for a step: switch settings tabs, open/close settings panel.
   * Returns the delay (ms) needed before the step target is visible in the DOM.
   */
  const prepareForStep = useCallback((stepIndex: number): number => {
    const step = steps[stepIndex];
    if (!step) return 0;

    const target = step.target as string;
    const navTarget = TARGET_NAVIGATION_MAP[target];

    if (navTarget === 'close-settings') {
      // Close settings panel if it's open
      const settingsPanel = document.querySelector('.settings-panel, .simple-settings, .advanced-settings');
      if (settingsPanel) {
        const settingsButton = document.querySelector('.settings-button') as HTMLElement;
        if (settingsButton) settingsButton.click();
        return 300;
      }
      return 0;
    }

    if (navTarget) {
      // Ensure settings panel is open
      const settingsPanel = document.querySelector('.settings-panel, .simple-settings, .advanced-settings');
      if (!settingsPanel) {
        const settingsButton = document.querySelector('.settings-button') as HTMLElement;
        if (settingsButton) settingsButton.click();
      }
      // Navigate to the correct tab
      useSettingsStore.getState().navigateToSettings(navTarget);
      return 400;
    }

    return 0;
  }, [steps]);

  // Handle clicks on highlighted elements during onboarding
  useEffect(() => {
    if (!isOnboardingActive) return;

    const handleElementClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if we're on step 1 and user clicked the spotlight over settings button
      if (currentStepIndex === 1) {
        const isSpotlightClick = target.classList.contains('react-joyride__spotlight') ||
                                target.closest('.react-joyride__spotlight');
        const isSettingsButtonClick = target.closest('.settings-button');

        if (isSpotlightClick || isSettingsButtonClick) {
          // Find the actual settings button and click it
          const settingsButton = document.querySelector('.settings-button') as HTMLElement;
          if (settingsButton && !isSettingsButtonClick) {
            settingsButton.click();
          }
          const delay = prepareForStep(currentStepIndex + 1);
          setTimeout(() => {
            nextStep();
          }, delay || 400);
          return;
        }
      }

    };

    document.addEventListener('click', handleElementClick, true);

    return () => {
      document.removeEventListener('click', handleElementClick, true);
    };
  }, [isOnboardingActive, currentStepIndex, nextStep, prepareForStep]);

  const advanceToStep = useCallback((nextIndex: number) => {
    const delay = prepareForStep(nextIndex);
    if (delay > 0) {
      setTimeout(() => {
        nextStep();
      }, delay);
    } else {
      nextStep();
    }
  }, [prepareForStep, nextStep]);

  const retreatToStep = useCallback((prevIndex: number) => {
    const delay = prepareForStep(prevIndex);
    if (delay > 0) {
      setTimeout(() => {
        prevStep();
      }, delay);
    } else {
      prevStep();
    }
  }, [prepareForStep, prevStep]);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, type, action, index } = data;

    if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)) {
      markOnboardingComplete();
    } else if (type === EVENTS.STEP_AFTER) {
      if (action === ACTIONS.NEXT) {
        // Step 1: Auto-click settings button if user clicked Next
        if (currentStepIndex === 1) {
          const settingsButton = document.querySelector('.settings-button') as HTMLElement;
          if (settingsButton) {
            settingsButton.click();
          }
          const delay = prepareForStep(currentStepIndex + 1);
          setTimeout(() => {
            nextStep();
          }, delay || 400);
          return;
        }

        advanceToStep(currentStepIndex + 1);
      } else if (action === ACTIONS.PREV) {
        retreatToStep(currentStepIndex - 1);
      }
    } else if (type === EVENTS.TARGET_NOT_FOUND) {
      console.warn('[Onboarding] Target not found for step:', index, steps[index]?.target);
      // Always skip missing targets to prevent getting stuck
      advanceToStep(currentStepIndex + 1);
    }
  }, [nextStep, prevStep, markOnboardingComplete, currentStepIndex, steps, prepareForStep, advanceToStep, retreatToStep]);

  if (!isOnboardingActive) {
    return null;
  }

  return (
    <Joyride
      callback={handleJoyrideCallback}
      continuous={true}
      hideCloseButton={false}
      run={isOnboardingActive}
      scrollToFirstStep={true}
      showProgress={true}
      showSkipButton={true}
      stepIndex={currentStepIndex}
      steps={steps}
      disableOverlayClose={true}
      disableCloseOnEsc={false}
      disableScrolling={false}
      styles={{
        options: {
          primaryColor: '#007bff',
          backgroundColor: '#ffffff',
          textColor: '#333333',
          overlayColor: 'rgba(0, 0, 0, 0.4)',
          spotlightShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
          beaconSize: 36,
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: 8,
          fontSize: 14,
          padding: 20,
          maxWidth: 400,
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        tooltipTitle: {
          fontSize: 18,
          fontWeight: 'bold',
          marginBottom: 10,
          color: '#007bff',
        },
        tooltipContent: {
          lineHeight: 1.5,
          marginBottom: 15,
        },
        buttonNext: {
          backgroundColor: '#007bff',
          borderRadius: 4,
          color: '#ffffff',
          fontSize: 14,
          fontWeight: 'bold',
          padding: '8px 16px',
          border: 'none',
          cursor: 'pointer',
        },
        buttonBack: {
          backgroundColor: 'transparent',
          border: '1px solid #007bff',
          borderRadius: 4,
          color: '#007bff',
          fontSize: 14,
          fontWeight: 'bold',
          padding: '8px 16px',
          cursor: 'pointer',
          marginRight: 8,
        },
        buttonSkip: {
          backgroundColor: 'transparent',
          border: 'none',
          color: '#666666',
          fontSize: 14,
          padding: '8px 16px',
          cursor: 'pointer',
        },
        buttonClose: {
          backgroundColor: 'transparent',
          border: 'none',
          color: '#666666',
          fontSize: 18,
          padding: 4,
          cursor: 'pointer',
          position: 'absolute',
          right: 8,
          top: 8,
        },
        spotlight: {
          borderRadius: 4,
        },
        beacon: {
          backgroundColor: '#007bff',
          border: '2px solid #ffffff',
          borderRadius: '50%',
          boxShadow: '0 0 10px rgba(0, 123, 255, 0.5)',
        },
      }}
      locale={{
        back: t('onboarding.back', 'Back'),
        close: t('onboarding.close', 'Close'),
        last: t('onboarding.finish', 'Finish'),
        next: t('onboarding.next', 'Next'),
        nextLabelWithProgress: t('onboarding.nextWithProgress', 'Next ({step}/{steps})'),
        open: t('onboarding.open', 'Open the dialog'),
        skip: t('onboarding.skip', 'Skip tour'),
      }}
      floaterProps={{
        disableAnimation: true,
      }}
    />
  );
};

export default Onboarding; 
import React, { useCallback, useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, EVENTS, ACTIONS } from 'react-joyride';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useTranslation } from 'react-i18next';
import './Onboarding.scss';

// Debug function to check if target elements exist
const debugTargetElements = () => {
  const targets = [
    '.settings-button',
    '.api-key-section', 
    '.system-instructions-section',
    '.voice-settings-section',
    '.turn-detection-section',
    '.audio-button',
    '.microphone-section',
    '.speaker-section',
    '.session-button'
  ];
  
  console.log('[Onboarding Debug] Checking target elements:');
  targets.forEach(target => {
    const element = document.querySelector(target);
    console.log(`${target}: ${element ? 'FOUND' : 'NOT FOUND'}`, element);
  });
};

// Debug function to clear onboarding data (for testing)
const clearOnboardingData = () => {
  localStorage.removeItem('sokuji_onboarding_completed');
  console.log('[Onboarding Debug] Cleared onboarding data. Refresh the page to restart onboarding.');
};

// Make functions available globally for debugging
(window as any).debugTargetElements = debugTargetElements;
(window as any).clearOnboardingData = clearOnboardingData;

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

  // Handle clicks on highlighted elements during onboarding
  useEffect(() => {
    if (!isOnboardingActive) return;

    const handleElementClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      console.log('[Onboarding] Click detected on:', target, 'Current step:', currentStepIndex);
      
      // Check if we're on step 1 and user clicked the spotlight over settings button
      if (currentStepIndex === 1) {
        const isSpotlightClick = target.classList.contains('react-joyride__spotlight') || 
                                target.closest('.react-joyride__spotlight');
        const isSettingsButtonClick = target.closest('.settings-button');
        
        if (isSpotlightClick || isSettingsButtonClick) {
          console.log('[Onboarding] Settings area clicked, triggering settings button and advancing');
          
          // Find the actual settings button and click it
          const settingsButton = document.querySelector('.settings-button') as HTMLElement;
          if (settingsButton && !isSettingsButtonClick) {
            // If we clicked on spotlight, trigger the actual button click
            settingsButton.click();
          }
          
          // Small delay to let the panel open first
          setTimeout(() => {
            nextStep();
          }, 200);
          return;
        }
      }
      
      // Check if we're on step 6 and user clicked the spotlight over audio button
      if (currentStepIndex === 6) {
        const isSpotlightClick = target.classList.contains('react-joyride__spotlight') || 
                                target.closest('.react-joyride__spotlight');
        const isAudioButtonClick = target.closest('.audio-button');
        
        if (isSpotlightClick || isAudioButtonClick) {
          console.log('[Onboarding] Audio area clicked, triggering audio button and advancing');
          
          // Find the actual audio button and click it
          const audioButton = document.querySelector('.audio-button') as HTMLElement;
          if (audioButton && !isAudioButtonClick) {
            // If we clicked on spotlight, trigger the actual button click
            audioButton.click();
          }
          
          // Small delay to let the panel open first
          setTimeout(() => {
            nextStep();
          }, 200);
          return;
        }
      }
    };

    document.addEventListener('click', handleElementClick, true);
    
    return () => {
      document.removeEventListener('click', handleElementClick, true);
    };
  }, [isOnboardingActive, currentStepIndex, nextStep]);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, type, action, index } = data;

    console.log('[Onboarding] Callback:', { status, type, action, index, currentStepIndex });

    if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)) {
      // Need to set our running state to false, so we can restart if we click start again.
      markOnboardingComplete();
    } else if (type === EVENTS.STEP_AFTER) {
      // Handle special cases where we need to auto-click buttons when user clicks Next
      if (action === ACTIONS.NEXT) {
        // Step 1: Auto-click settings button if user clicked Next
        if (currentStepIndex === 1) {
          console.log('[Onboarding] Next clicked on Step 1, auto-clicking settings button');
          const settingsButton = document.querySelector('.settings-button') as HTMLElement;
          if (settingsButton) {
            settingsButton.click();
          }
          // Small delay to let the panel open before advancing
          setTimeout(() => {
            nextStep();
          }, 200);
          return;
        }
        
        // Step 6: Auto-click audio button if user clicked Next
        if (currentStepIndex === 6) {
          console.log('[Onboarding] Next clicked on Step 6, auto-clicking audio button');
          const audioButton = document.querySelector('.audio-button') as HTMLElement;
          if (audioButton) {
            audioButton.click();
          }
          // Small delay to let the panel open before advancing
          setTimeout(() => {
            nextStep();
          }, 200);
          return;
        }
        
        // For all other steps, advance normally
        nextStep();
      } else if (action === ACTIONS.PREV) {
        prevStep();
      }
    } else if (type === EVENTS.TARGET_NOT_FOUND) {
      console.warn('[Onboarding] Target not found for step:', index, steps[index]?.target);
      // Still advance if target not found to prevent getting stuck
      if (action === ACTIONS.NEXT) {
        nextStep();
      } else if (action === ACTIONS.PREV) {
        prevStep();
      }
    }
    // For other events like tooltip close or overlay click, do nothing
    // This prevents the tour from getting into an unresponsive state
  }, [nextStep, prevStep, markOnboardingComplete, currentStepIndex, steps]);

  // Debug: Check if all target elements exist
  useEffect(() => {
    if (isOnboardingActive) {
      setTimeout(debugTargetElements, 100);
    }
  }, [isOnboardingActive, currentStepIndex]);

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
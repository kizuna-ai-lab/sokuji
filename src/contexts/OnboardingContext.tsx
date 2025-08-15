import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../lib/analytics';

export interface OnboardingStep {
  target: string;
  content: string | ReactNode;
  title: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  disableBeacon?: boolean;
  spotlightClicks?: boolean;
  styles?: {
    options?: {
      primaryColor?: string;
      backgroundColor?: string;
      textColor?: string;
      overlayColor?: string;
      spotlightShadow?: string;
      beaconSize?: number;
    };
  };
}

interface OnboardingContextType {
  isOnboardingActive: boolean;
  currentStepIndex: number;
  steps: OnboardingStep[];
  startOnboarding: () => void;
  stopOnboarding: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipOnboarding: () => void;
  isFirstTimeUser: boolean;
  markOnboardingComplete: (sendAnalytics?: boolean) => void;
  userTypeSelected: boolean;
  setUserType: (type: 'regular' | 'experienced') => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const ONBOARDING_STORAGE_KEY = 'sokuji_onboarding_completed';
const USER_TYPE_STORAGE_KEY = 'sokuji_user_type';
const ONBOARDING_VERSION = '1.0.0';

// Basic mode onboarding steps - simplified for regular users
const createBasicOnboardingSteps = (t: any): OnboardingStep[] => [
  {
    target: 'body',
    content: t('onboarding.basic.steps.welcome.content', 'Welcome to Sokuji! This simple guide will help you start using real-time translation in just a few steps.'),
    title: t('onboarding.basic.steps.welcome.title', 'Welcome to Sokuji'),
    placement: 'center',
    disableBeacon: true,
    styles: {
      options: {
        primaryColor: '#10a37f',
      }
    }
  },
  {
    target: '.settings-button',
    content: t('onboarding.basic.steps.settings.content', 'Click here to open Settings where you can configure your languages and audio devices.'),
    title: t('onboarding.basic.steps.settings.title', 'Step 1: Open Settings'),
    placement: 'bottom',
  },
  {
    target: '#ui-mode-toggle',
    content: t('onboarding.basic.steps.uiModeToggle.content', 'You can switch between Basic and Advanced modes anytime using this button. Basic mode shows simplified options, while Advanced mode provides full control.'),
    title: t('onboarding.basic.steps.uiModeToggle.title', 'Step 2: UI Mode Toggle'),
    placement: 'bottom',
  },
  {
    target: '#user-account-section',
    content: t('onboarding.basic.steps.account.content', 'Sign in for a simple experience, or use your own API key without logging in. New users can sign up for kizuna.ai\'s API service.'),
    title: t('onboarding.basic.steps.account.title', 'Step 3: User Account'),
    placement: 'left',
  },
  {
    target: '#languages-section',
    content: t('onboarding.basic.steps.languages.content', 'Select your source language (what you speak) and target language (what you want to hear).'),
    title: t('onboarding.basic.steps.languages.title', 'Step 4: Choose Languages'),
    placement: 'left',
  },
  {
    target: '#microphone-section',
    content: t('onboarding.basic.steps.microphone.content', 'Select your microphone from the list. This is what will capture your voice.'),
    title: t('onboarding.basic.steps.microphone.title', 'Step 5: Select Microphone'),
    placement: 'left',
  },
  {
    target: '#speaker-section',
    content: t('onboarding.basic.steps.speaker.content', 'Choose your speakers or headphones to hear the translation. Headphones are recommended.'),
    title: t('onboarding.basic.steps.speaker.title', 'Step 6: Select Speaker'),
    placement: 'left',
  },
  {
    target: '.main-action-btn',
    content: t('onboarding.basic.steps.start.content', 'Click "Start" to begin translating! Just speak naturally and hear the translation in real-time.'),
    title: t('onboarding.basic.steps.start.title', 'Step 7: Start Translating'),
    placement: 'top',
  },
  {
    target: 'body',
    content: t('onboarding.basic.steps.complete.content', 'Perfect! You\'re ready to use Sokuji. Click Start and begin speaking to hear real-time translations.'),
    title: t('onboarding.basic.steps.complete.title', 'All Set!'),
    placement: 'center',
    disableBeacon: true,
  }
];

// Advanced mode onboarding steps - detailed for experienced users
const createAdvancedOnboardingSteps = (t: any): OnboardingStep[] => [
  {
    target: 'body',
    content: t('onboarding.steps.welcome.content', 'Welcome to Sokuji! This guide will help you set up the extension for live speech translation. Let\'s get started!'),
    title: t('onboarding.steps.welcome.title', 'Welcome to Sokuji'),
    placement: 'center',
    disableBeacon: true,
    styles: {
      options: {
        primaryColor: '#007bff',
      }
    }
  },
  {
    target: '.settings-button',
    content: t('onboarding.steps.settings.content', 'First, let\'s configure your settings. Click here to open the Settings panel where you can set up your OpenAI API key and customize system instructions.'),
    title: t('onboarding.steps.settings.title', 'Step 1: Open Settings'),
    placement: 'bottom',
  },
  {
    target: '.api-key-section',
    content: (
      <span>
        {t('onboarding.steps.apiKey.content', 'Enter your OpenAI API key here. You can get one from the')}{' '}
        <a 
          href="https://platform.openai.com/account/api-keys" 
          target="_blank" 
          rel="noopener noreferrer" 
          style={{ color: '#007bff', textDecoration: 'underline' }}
        >
          {t('onboarding.steps.apiKey.linkText', 'OpenAI page')}
        </a>
        . {t('onboarding.steps.apiKey.required', 'This is required for the speech translation to work.')}
      </span>
    ),
    title: t('onboarding.steps.apiKey.title', 'Step 2: Configure API Key'),
    placement: 'left',
  },
  {
    target: '.system-instructions-section',
    content: t('onboarding.steps.systemInstructions.content', 'Customize the system instructions to control how the AI responds. You can modify the translation behavior and add specific requirements here.'),
    title: t('onboarding.steps.systemInstructions.title', 'Step 3: System Instructions'),
    placement: 'left',
  },
  {
    target: '.voice-settings-section',
    content: t('onboarding.steps.voiceSettings.content', 'Configure the voice type that will be used for speech synthesis. Choose from different voice options to match your preference.'),
    title: t('onboarding.steps.voiceSettings.title', 'Step 4: Voice Settings'),
    placement: 'left',
  },
  {
    target: '.turn-detection-section',
    content: t('onboarding.steps.turnDetection.content', 'Configure automatic turn detection settings including detection mode, threshold, and audio parameters for optimal speech recognition performance.'),
    title: t('onboarding.steps.turnDetection.title', 'Step 5: Turn Detection'),
    placement: 'left',
  },
  {
    target: '.audio-button',
    content: t('onboarding.steps.audioSettings.content', 'Next, let\'s configure your audio settings. Click here to open the Audio panel and set up your microphone and speakers.'),
    title: t('onboarding.steps.audioSettings.title', 'Step 6: Audio Settings'),
    placement: 'bottom',
  },
  {
    target: '.microphone-section',
    content: t('onboarding.steps.microphoneSetup.content', 'Select your microphone device here. Make sure to choose the correct input device for the best audio quality.'),
    title: t('onboarding.steps.microphoneSetup.title', 'Step 7: Microphone Setup'),
    placement: 'left',
  },
  {
    target: '.speaker-section',
    content: t('onboarding.steps.speakerSetup.content', 'Select a monitoring device to listen to the translated audio and verify if it meets your requirements. It is recommended to use headphones for monitoring to avoid interference with microphone input. When you are satisfied with the translation settings, it is suggested to turn off monitoring so you can focus more on your expression without microphone interference.'),
    title: t('onboarding.steps.speakerSetup.title', 'Step 8: Speaker Setup'),
    placement: 'left',
  },
  {
    target: '.session-button',
    content: t('onboarding.steps.startSession.content', 'Click the "Start Session" button to begin using Sokuji. Once started, you can speak naturally for live translation. If Automatic turn detection is disabled, use "Push to Talk" (Space key) to speak.'),
    title: t('onboarding.steps.startSession.title', 'Step 9: Start Session'),
    placement: 'top',
  },
  {
    target: 'body',
    content: t('onboarding.steps.complete.content', 'Great! You\'re all set up. Remember to grant microphone permissions when prompted, and you can restart this guide anytime from the settings.'),
    title: t('onboarding.steps.complete.title', 'Setup Complete!'),
    placement: 'center',
    disableBeacon: true,
  }
];

interface OnboardingProviderProps {
  children: ReactNode;
}

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({ children }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isFirstTimeUser, setIsFirstTimeUser] = useState(false);
  const [onboardingStartTime, setOnboardingStartTime] = useState<number | null>(null);
  const [userTypeSelected, setUserTypeSelected] = useState(false);
  
  // Get user type from localStorage to determine which steps to use
  const getUserType = () => localStorage.getItem(USER_TYPE_STORAGE_KEY);
  
  // Select appropriate onboarding steps based on user type
  const onboardingSteps = getUserType() === 'regular' 
    ? createBasicOnboardingSteps(t)
    : createAdvancedOnboardingSteps(t);

  const startOnboarding = () => {
    const startTime = Date.now();
    setOnboardingStartTime(startTime);
    setCurrentStepIndex(0);
    setIsOnboardingActive(true);
    
    // Track onboarding started event
    trackEvent('onboarding_started', {
      is_first_time_user: isFirstTimeUser,
      onboarding_version: ONBOARDING_VERSION,
    });
    
    // Track first step viewed event
    const firstStep = onboardingSteps[0];
    trackEvent('onboarding_step_viewed', {
      step_index: 0,
      step_target: firstStep.target,
      step_title: typeof firstStep.title === 'string' ? firstStep.title : 'Step',
    });
  };

  useEffect(() => {
    // Check if user has selected their type
    const userType = localStorage.getItem(USER_TYPE_STORAGE_KEY);
    if (userType) {
      setUserTypeSelected(true);
    }
    
    // Check if user has completed onboarding
    const onboardingData = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!onboardingData) {
      setIsFirstTimeUser(true);
      // Don't auto-start onboarding anymore - let user select type first
    } else {
      try {
        const data = JSON.parse(onboardingData);
        // Check if onboarding version has changed
        if (data.version !== ONBOARDING_VERSION) {
          setIsFirstTimeUser(true);
        }
      } catch (error) {
        console.error('Error parsing onboarding data:', error);
        setIsFirstTimeUser(true);
      }
    }
  }, []);

  const stopOnboarding = () => {
    setIsOnboardingActive(false);
    setCurrentStepIndex(0);
  };

  const nextStep = () => {
    if (currentStepIndex < onboardingSteps.length - 1) {
      const newStepIndex = currentStepIndex + 1;
      setCurrentStepIndex(newStepIndex);
      
      // Track step viewed event
      const step = onboardingSteps[newStepIndex];
      trackEvent('onboarding_step_viewed', {
        step_index: newStepIndex,
        step_target: step.target,
        step_title: typeof step.title === 'string' ? step.title : 'Step',
      });
    } else {
      markOnboardingComplete();
    }
  };

  const prevStep = () => {
    if (currentStepIndex > 0) {
      const newStepIndex = currentStepIndex - 1;
      setCurrentStepIndex(newStepIndex);
      
      // Track step viewed event
      const step = onboardingSteps[newStepIndex];
      trackEvent('onboarding_step_viewed', {
        step_index: newStepIndex,
        step_target: step.target,
        step_title: typeof step.title === 'string' ? step.title : 'Step',
      });
    }
  };

  const skipOnboarding = () => {
    // Track onboarding completed event with skipped method
    const duration = onboardingStartTime ? Date.now() - onboardingStartTime : 0;
    trackEvent('onboarding_completed', {
      completion_method: 'skipped' as const,
      steps_completed: currentStepIndex,
      total_steps: onboardingSteps.length,
      duration_ms: duration,
      onboarding_version: ONBOARDING_VERSION,
    });
    
    markOnboardingComplete(false); // Don't send analytics again
  };

  const markOnboardingComplete = (sendAnalytics: boolean = true) => {
    const onboardingData = {
      completed: true,
      version: ONBOARDING_VERSION,
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(onboardingData));
    setIsOnboardingActive(false);
    setIsFirstTimeUser(false);
    setCurrentStepIndex(0);
    
    // Track onboarding completed event only if requested
    if (sendAnalytics) {
      const duration = onboardingStartTime ? Date.now() - onboardingStartTime : 0;
      trackEvent('onboarding_completed', {
        completion_method: 'finished' as const,
        steps_completed: currentStepIndex + 1,
        total_steps: onboardingSteps.length,
        duration_ms: duration,
        onboarding_version: ONBOARDING_VERSION,
      });
    }
  };

  const setUserType = (type: 'regular' | 'experienced') => {
    // Store user type selection
    localStorage.setItem(USER_TYPE_STORAGE_KEY, type);
    setUserTypeSelected(true);
    
    // Track user type selection
    trackEvent('user_type_selected', {
      user_type: type,
      is_first_time_user: isFirstTimeUser,
    });
    
    // Start onboarding after user type selection if first time user
    if (isFirstTimeUser) {
      setTimeout(() => {
        startOnboarding();
      }, 500);
    }
  };

  const contextValue: OnboardingContextType = {
    isOnboardingActive,
    currentStepIndex,
    steps: onboardingSteps,
    startOnboarding,
    stopOnboarding,
    nextStep,
    prevStep,
    skipOnboarding,
    isFirstTimeUser,
    markOnboardingComplete,
    userTypeSelected,
    setUserType,
  };

  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = (): OnboardingContextType => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};

export default OnboardingContext; 
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
  markOnboardingComplete: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const ONBOARDING_STORAGE_KEY = 'sokuji_onboarding_completed';
const ONBOARDING_VERSION = '1.0.0';

// Function to create onboarding steps with internationalization
const createOnboardingSteps = (t: any): OnboardingStep[] => [
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
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isFirstTimeUser, setIsFirstTimeUser] = useState(false);
  
  const onboardingSteps = createOnboardingSteps(t);

  const startOnboarding = () => {
    setCurrentStepIndex(0);
    setIsOnboardingActive(true);
  };

  useEffect(() => {
    // Check if user has completed onboarding
    const onboardingData = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!onboardingData) {
      setIsFirstTimeUser(true);
      // Auto-start onboarding for first-time users after a short delay
      setTimeout(() => {
        startOnboarding();
      }, 1000);
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
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      markOnboardingComplete();
    }
  };

  const prevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const skipOnboarding = () => {
    markOnboardingComplete();
  };

  const markOnboardingComplete = () => {
    const onboardingData = {
      completed: true,
      version: ONBOARDING_VERSION,
      completedAt: new Date().toISOString(),
    };
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(onboardingData));
    setIsOnboardingActive(false);
    setIsFirstTimeUser(false);
    setCurrentStepIndex(0);
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
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../lib/analytics';
import useSettingsStore, { useProvider } from '../stores/settingsStore';
import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
import { Provider } from '../types/Provider';

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
const ONBOARDING_VERSION = '1.1.0';

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
    target: '#user-account-section',
    content: t('onboarding.basic.steps.account.content', 'Sign in to use Sokuji\'s built-in translation service, or choose another provider and enter your own API key.'),
    title: t('onboarding.basic.steps.account.title', 'Step 2: User Account'),
    placement: 'left',
  },
  {
    target: '#languages-section',
    content: t('onboarding.basic.steps.languages.content', 'Select your source language (what you speak) and target language (what you want the other party to hear).'),
    title: t('onboarding.basic.steps.languages.title', 'Step 3: Choose Languages'),
    placement: 'left',
  },
  {
    target: '#provider-section',
    content: t('onboarding.basic.steps.provider.content', 'Choose your translation provider. Sokuji supports cloud services like OpenAI, Gemini, Volcengine (Doubao), and more. You can also use Local Inference — no API key needed, free and privacy-focused, just download models for fully offline translation.'),
    title: t('onboarding.basic.steps.provider.title', 'Step 4: Translation Provider'),
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
    content: t('onboarding.basic.steps.speaker.content', 'Choose a monitoring device to preview the translation. Translated audio is always output to the virtual microphone regardless of monitoring. Select Sokuji Virtual Microphone as the microphone input in your meeting app or website. Headphones are recommended for monitoring to avoid feedback.'),
    title: t('onboarding.basic.steps.speaker.title', 'Step 6: Select Speaker'),
    placement: 'left',
  },
  {
    target: '#system-audio-section',
    content: t('onboarding.basic.steps.systemAudio.content', 'Enable participant audio capture to translate other speakers\' voices in real-time. In the browser extension, this captures audio from the current tab, allowing you to translate other participants in web conferences like Google Meet, Teams, or Zoom. In the desktop app, this captures all audio your computer plays, so you can translate YouTube videos, Twitch streams, Netflix shows, or any other audio source. Participant audio is transcribed and translated to text only — no speech synthesis is applied. Sokuji translates what you say via the microphone, and translates what others say via this feature — together they enable full two-way translation.'),
    title: t('onboarding.basic.steps.systemAudio.title', 'Step 7: Participant Audio'),
    placement: 'left',
  },
  {
    target: '.main-action-btn',
    content: t('onboarding.basic.steps.start.content', 'Click "Start" to begin translating! Just speak naturally and hear the translation in real-time.'),
    title: t('onboarding.basic.steps.start.title', 'Step 8: Start Translating'),
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
// Steps are filtered based on current provider capabilities to avoid targeting non-existent DOM elements
const createAdvancedOnboardingSteps = (t: any, capabilities?: { hasTemplateMode: boolean; hasVoiceSettings: boolean; hasTurnDetection: boolean }): OnboardingStep[] => {
  const allSteps: (OnboardingStep | null)[] = [
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
      content: t('onboarding.steps.settings.content', 'First, let\'s configure your settings. Click here to open the Settings panel where you can choose your translation provider and customize settings.'),
      title: t('onboarding.steps.settings.title', 'Step 1: Open Settings'),
      placement: 'bottom',
    },
    {
      target: '.provider-section',
      content: t('onboarding.steps.apiKey.content', 'Choose your translation provider. Sokuji supports cloud services like OpenAI, Gemini, Volcengine (Doubao), and more. You can also use Local Inference — no API key needed, free and privacy-focused, just download models for fully offline translation.'),
      title: t('onboarding.steps.apiKey.title', 'Step 2: Translation Provider'),
      placement: 'left',
    },
    capabilities?.hasTemplateMode !== false ? {
      target: '.system-instructions-section',
      content: t('onboarding.steps.systemInstructions.content', 'Customize the system instructions to control how the AI responds. You can modify the translation behavior and add specific requirements here.'),
      title: t('onboarding.steps.systemInstructions.title', 'Step 3: System Instructions'),
      placement: 'left',
    } : null,
    capabilities?.hasVoiceSettings !== false ? {
      target: '.voice-settings-section',
      content: t('onboarding.steps.voiceSettings.content', 'Configure the voice type that will be used for speech synthesis. Choose from different voice options to match your preference.'),
      title: t('onboarding.steps.voiceSettings.title', 'Step 4: Voice Settings'),
      placement: 'left',
    } : null,
    capabilities?.hasTurnDetection !== false ? {
      target: '.turn-detection-section',
      content: t('onboarding.steps.turnDetection.content', 'Configure automatic turn detection settings including detection mode, threshold, and audio parameters for optimal speech recognition performance.'),
      title: t('onboarding.steps.turnDetection.title', 'Step 5: Turn Detection'),
      placement: 'left',
    } : null,
    {
      target: '.microphone-section',
      content: t('onboarding.steps.microphoneSetup.content', 'Select your microphone device here. Make sure to choose the correct input device for the best audio quality.'),
      title: t('onboarding.steps.microphoneSetup.title', 'Step 6: Microphone Setup'),
      placement: 'left',
    },
    {
      target: '.speaker-section',
      content: t('onboarding.steps.speakerSetup.content', 'Select a monitoring device to listen to the translated audio and verify if it meets your requirements. It is recommended to use headphones for monitoring to avoid interference with microphone input. When you are satisfied with the translation settings, it is suggested to turn off monitoring so you can focus more on your expression without microphone interference.'),
      title: t('onboarding.steps.speakerSetup.title', 'Step 7: Speaker Setup'),
      placement: 'left',
    },
    {
      target: '#system-audio-section',
      content: t('onboarding.steps.systemAudio.content', 'Enable participant audio capture to translate other speakers\' voices in real-time. In the browser extension, this captures audio from the current tab, allowing you to translate other participants in web conferences like Google Meet, Teams, or Zoom. In the desktop app, this captures all audio your computer plays, so you can translate YouTube videos, Twitch streams, Netflix shows, or any other audio source. Participant audio is transcribed and translated to text only — no speech synthesis is applied. Sokuji translates what you say via the microphone, and translates what others say via this feature — together they enable full two-way translation.'),
      title: t('onboarding.steps.systemAudio.title', 'Step 8: Participant Audio'),
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
      content: t('onboarding.steps.complete.content', 'Great! You\'re all set up. Remember to grant microphone permissions when prompted. You can restart this guide anytime from the settings.'),
      title: t('onboarding.steps.complete.title', 'Setup Complete!'),
      placement: 'center',
      disableBeacon: true,
    }
  ];

  // Filter out null steps (capabilities not available for current provider)
  // and renumber the step titles across all locales
  const filteredSteps = allSteps.filter((step): step is OnboardingStep => step !== null);
  let stepNumber = 0;
  return filteredSteps.map((step) => {
    // Match step numbering patterns across locales: "Step 3:", "步骤 3：", "Schritt 3:", etc.
    // Pattern: any prefix text, a digit, then a colon (regular or fullwidth)
    const stepMatch = step.title.match(/^(.+?)(\d+)([:：])/);
    if (stepMatch) {
      stepNumber++;
      return { ...step, title: `${stepMatch[1]}${stepNumber}${stepMatch[3]}${step.title.slice(stepMatch[0].length)}` };
    }
    return step;
  });
};

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

  // Get current provider capabilities for filtering advanced onboarding steps
  const provider = useProvider();
  const providerCapabilities = useMemo(() => {
    try {
      const config = ProviderConfigFactory.getConfig(provider || Provider.OPENAI);
      return config.capabilities;
    } catch {
      return undefined;
    }
  }, [provider]);

  // Select appropriate onboarding steps based on user type and provider capabilities
  // userTypeSelected is included to recompute when user selects their type
  const onboardingSteps = useMemo(() => {
    return getUserType() === 'regular'
      ? createBasicOnboardingSteps(t)
      : createAdvancedOnboardingSteps(t, providerCapabilities);
  }, [t, providerCapabilities, userTypeSelected]);


  const startOnboarding = () => {
    // Ensure UI mode matches user type so onboarding targets exist in the DOM
    const userType = getUserType();
    const expectedUIMode = userType === 'regular' ? 'basic' : 'advanced';
    const currentUIMode = useSettingsStore.getState().uiMode;
    if (currentUIMode !== expectedUIMode) {
      useSettingsStore.getState().setUIMode(expectedUIMode);
    }

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
          // If user type already selected, auto-start the updated onboarding
          if (userType) {
            setTimeout(() => {
              startOnboarding();
            }, 500);
          }
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

    // Ensure UI mode matches user type so onboarding targets exist in the DOM
    const expectedUIMode = type === 'regular' ? 'basic' : 'advanced';
    const currentUIMode = useSettingsStore.getState().uiMode;
    if (currentUIMode !== expectedUIMode) {
      useSettingsStore.getState().setUIMode(expectedUIMode);
    }

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
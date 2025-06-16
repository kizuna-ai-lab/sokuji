# Sokuji Onboarding Guide

## Overview

Sokuji now includes a comprehensive first-time user onboarding system, implemented using the `react-joyride` library. This feature helps new users understand and configure the extension's various settings.

## Features

### Automatic Triggering
- The tour starts automatically after the first installation.
- It begins after a 1-second delay to ensure the interface is fully loaded.

### Onboarding Steps

The tour covers the following key steps:

1.  **Welcome Screen** - Introduces the features of Sokuji.
2.  **Settings Panel** - Guides the user to open the settings.
3.  **API Key Configuration** - Instructs on how to set up the API key for the selected provider (OpenAI or Gemini).
4.  **System Instructions** - Explains how to customize system instructions.
5.  **Audio Settings** - Guides the user to open the audio panel.
6.  **Microphone Setup** - How to select an input device.
7.  **Speaker Setup** - How to select an output device.
8.  **Voice Configuration** - Configuring voice settings and detection parameters.
9.  **Main Interface Introduction** - Showcases the main functional areas.
10. **Completion** - Summary and next steps.

### User Control
- **Skip** - Users can skip the tour at any time.
- **Navigation** - Back and Next buttons.
- **Restart** - The tour can be restarted from the settings panel.

## Technical Implementation

### Core Components

#### OnboardingContext
```typescript
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
```

#### Onboarding Component
- Uses the `react-joyride` library.
- Custom styling and theming.
- Responsive design.
- Internationalization support.

### Data Persistence
- Uses `localStorage` to store the completion status.
- Version control allows re-triggering the tour after updates.
- Storage key: `sokuji_onboarding_completed`

### Style Customization
- Primary color: `#007bff`
- Custom tooltip styles.
- Animations and transitions.
- Responsive adjustments.

## Configuration Options

### Step Configuration
Each step includes:
- `target` - A CSS selector.
- `content` - Explanatory text.
- `title` - The title of the step.
- `placement` - Tooltip position.
- `spotlightClicks` - Whether clicks on the highlighted element are allowed.

### Style Configuration
```typescript
styles: {
  options: {
    primaryColor: '#007bff',
    backgroundColor: '#ffffff',
    textColor: '#333333',
    overlayColor: 'rgba(0, 0, 0, 0.4)',
    spotlightShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
    beaconSize: 36,
    zIndex: 10000,
  }
}
```

## Internationalization

Supported language keys:
- `onboarding.back` - Back button
- `onboarding.close` - Close button
- `onboarding.finish` - Finish button
- `onboarding.next` - Next button
- `onboarding.skip` - Skip button
- `onboarding.restartTour` - Restart Tour

## How to Use

### For Developers
1. The tour will start automatically on the first visit.
2. It can be manually started via the "Restart Tour" button in the settings panel.
3. The onboarding state is managed via the Context API.

### For End-Users
1. The tour will appear automatically after installing the extension.
2. Users can skip or complete the tour.
3. The tour can be revisited from the settings.

## Extension and Customization

### Adding New Steps
Add new steps to the `onboardingSteps` array in `OnboardingContext.tsx`:

```typescript
{
  target: '.new-element',
  content: 'Description of the new feature.',
  title: 'Step Title',
  placement: 'bottom',
}
```

### Modifying Styles
Add custom styles in `Onboarding.scss` or modify the `styles` configuration in `Onboarding.tsx`.

### Updating Text
Add new key-value pairs for translations in the corresponding language files.

## Best Practices

1.  **Be Concise** - Each step's explanation should be brief and easy to understand.
2.  **Logical Order** - Arrange steps according to the user's natural workflow.
3.  **Allow Skipping** - Always provide an option to skip the tour.
4.  **Be Responsive** - Ensure it works correctly on different screen sizes.
5.  **Use Versioning** - Update the version number on major updates to re-show the tour.

## Troubleshooting

### Common Issues

1.  **Tour does not appear**
    -   Check if it's already marked as completed in `localStorage`.
    -   Clear the `sokuji_onboarding_completed` key.

2.  **Target element not found**
    -   Ensure the CSS selector is correct.
    -   Check if the element has been rendered.

3.  **Styling issues**
    -   Check the `z-index` settings.
    -   Ensure there are no CSS conflicts.

### Debugging
Run the following in the browser console:
```javascript
localStorage.removeItem('sokuji_onboarding_completed');
```
Then refresh the page to re-trigger the tour. 
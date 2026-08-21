// src/components/Subtitle/SubtitleApp.rootStyle.test.tsx
//
// SubtitleApp.scss styles `.subtitle-app` with
//   color: var(--subtitle-source-color, #FFFFFF)
// but for most of the file's history nothing ever defined that variable at
// the root, so the declaration silently resolved to its #FFFFFF fallback.
// This pins the variable to the root style object so the rule means what it
// says. Every chrome element below the root (idle body, PTT hint, bar) sets
// its own colour and therefore overrides this, so the value only reaches
// elements that opt into inheritance.
//
// Mocks mirror SubtitleApp.handleStart.test.tsx: SubtitleApp's real import
// graph reaches the audio worklets, which vitest cannot resolve from a
// worktree, so every heavy dependency is stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  default: { getState: () => ({ __syncSubtitleFullscreen: vi.fn(), subtitleModeActive: false }) },
  useExitSubtitleMode: () => vi.fn(async () => {}),
  useProvider: () => 'openai',
  useCurrentProviderSettings: () => ({ sourceLanguage: 'en', targetLanguage: 'zh' }),
  useLocalInferenceSettings: () => ({}),
  useCurrentTurnDetectionMode: () => 'Disabled',
  useSubtitleFullscreen: () => false,
  useSetSubtitleFullscreen: () => vi.fn(async () => {}),
  useNavigateToSettings: () => vi.fn(),
}));

// A colour nothing else in the tree could produce, so the assertion cannot
// pass by coincidence with the #FFFFFF fallback.
const SOURCE_COLOR = '#FF00FF';

vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({
    bgColor: '#000000', bgOpacity: 80, fontSize: 24, compactMode: false,
    sourceTextColor: '#FF00FF', translationTextColor: '#00FF00',
  }),
  useSaveSubtitleWindowBounds: () => vi.fn(async () => {}),
  useSubtitlePositionLocked: () => false,
  useSubtitleSpeakerDisplayMode: () => 'both',
  useSubtitleParticipantDisplayMode: () => 'both',
  useSubtitleNewItemHighlightEnabled: () => false,
}));

vi.mock('../../stores/sessionStore', () => ({
  useIsSessionActive: () => false,
  useSessionStartTime: () => null,
  useItems: () => [],
  useParticipantItems: () => [],
  useRequestClearConversation: () => vi.fn(),
  useLockedMode: () => null,
  useStartGate: () => ({ canStart: true, reason: null }),
  useSessionIsInitializing: () => false,
  useInitProgress: () => null,
  useRequestSessionStart: () => vi.fn(),
  useRequestSessionStop: () => vi.fn(),
}));

vi.mock('../../stores/audioStore', () => ({
  useMode: () => 'speaker',
}));

vi.mock('./useOverlayDragResize', () => ({
  useOverlayDragResize: () => ({ resizeHandleProps: {} }),
}));

vi.mock('./SubtitleBar', () => ({ default: () => null }));
vi.mock('./SubtitleStream', () => ({ default: () => null }));
vi.mock('./SubtitleIdle', () => ({ default: () => null }));

vi.mock('../../services/providers/speechMode', () => ({
  isPushGatedMode: (_provider: string, mode: string) =>
    mode === 'Push-to-Talk' || mode === 'Push-to-Translate' || mode === 'Disabled',
}));

const { default: SubtitleApp } = await import('./SubtitleApp');

beforeEach(() => {
  cleanup();
});

describe('SubtitleApp root style', () => {
  it('defines --subtitle-source-color on the root the stylesheet reads it from', () => {
    const { container } = render(<SubtitleApp />);
    const root = container.querySelector('.subtitle-app') as HTMLElement;
    expect(root.style.getPropertyValue('--subtitle-source-color')).toBe(SOURCE_COLOR);
  });

  it('still defines the background and highlight-overlay vars it always had', () => {
    const { container } = render(<SubtitleApp />);
    const root = container.querySelector('.subtitle-app') as HTMLElement;
    expect(root.style.background).not.toBe('');
    expect(root.style.getPropertyValue('--subtitle-highlight-overlay')).not.toBe('');
  });
});

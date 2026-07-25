// src/components/Subtitle/SubtitleApp.handleStart.test.tsx
//
// Regression coverage for the third layer of Fix 3 (issue #324 follow-up):
// unlike MainPanel, nothing downstream of a subtitle-window start request
// re-checks the gate, so SubtitleApp.handleStart itself must refuse to fire
// requestSessionStart() when the gate is closed (Retry after the mic was
// unplugged following an earlier failure, etc). Every other SubtitleApp
// dependency is stubbed so this test isolates just that guard.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { StartGate } from '../MainPanel/sessionStartGate';

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

vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({
    bgColor: '#000000', bgOpacity: 80, fontSize: 24, compactMode: false,
    sourceTextColor: '#ffffff', translationTextColor: '#ffffff',
  }),
  useSaveSubtitleWindowBounds: () => vi.fn(async () => {}),
  useSubtitlePositionLocked: () => false,
  useSubtitleSpeakerDisplayMode: () => 'both',
  useSubtitleParticipantDisplayMode: () => 'both',
  useSubtitleNewItemHighlightEnabled: () => false,
}));

let startGate: StartGate = { canStart: false, reason: 'missing-device', deviceScope: 'speaker' };
const requestSessionStart = vi.fn();
vi.mock('../../stores/sessionStore', () => ({
  useIsSessionActive: () => false,
  useSessionStartTime: () => null,
  useItems: () => [],
  useParticipantItems: () => [],
  useRequestClearConversation: () => vi.fn(),
  useLockedMode: () => null,
  useStartGate: () => startGate,
  useSessionIsInitializing: () => false,
  useInitProgress: () => null,
  useRequestSessionStart: () => requestSessionStart,
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

// Stub SubtitleIdle down to just the piece under test: a button that invokes
// whatever onStart SubtitleApp wired up, so this test exercises the real
// handleStart closure without pulling in SubtitleIdle's own rendering logic
// (that's covered separately in SubtitleIdle.test.tsx).
vi.mock('./SubtitleIdle', () => ({
  default: (props: { onStart: () => void }) => {
    const React = require('react');
    return React.createElement(
      'button',
      { onClick: props.onStart },
      'start-stub',
    );
  },
}));

const { default: SubtitleApp } = await import('./SubtitleApp');

beforeEach(() => {
  cleanup();
  requestSessionStart.mockClear();
});

describe('SubtitleApp handleStart gating', () => {
  it('does not request a session start while the gate is closed', () => {
    startGate = { canStart: false, reason: 'missing-device', deviceScope: 'speaker' };
    render(<SubtitleApp />);
    fireEvent.click(screen.getByText('start-stub'));
    expect(requestSessionStart).not.toHaveBeenCalled();
  });

  it('requests a session start once the gate is open', () => {
    startGate = { canStart: true, reason: null };
    render(<SubtitleApp />);
    fireEvent.click(screen.getByText('start-stub'));
    expect(requestSessionStart).toHaveBeenCalledTimes(1);
  });
});

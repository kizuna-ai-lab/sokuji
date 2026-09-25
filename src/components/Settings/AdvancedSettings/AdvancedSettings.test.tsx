/**
 * AdvancedSettings' General-tab engine chip (review Minor 5): a chip's
 * `onOpenSlot` (`AdvancedSettings.tsx:36-39`, today's `ProviderSection.tsx`'s
 * `openSlot`) sets the one-shot `engineSlotTarget` and switches Settings to
 * the Provider tab via `navigateToSettings('provider')`. Real settingsStore;
 * the provider/section blocks stubbed to markers, since this is about the
 * chip's wiring, not any block's content.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

const run = vi.hoisted(() => ({ locked: false }));
vi.mock('../../../app/useRun', () => ({ useSessionLocked: () => run.locked }));

vi.mock('../shared/WarningModal', () => ({ default: () => null }));

const blocks = vi.hoisted(() => ({
  general: [] as Array<{ locked: boolean; onOpenSlot(slot: { dir: string; stage: string }): void }>,
}));
vi.mock('../ProviderArea', () => ({
  SessionSettingsGeneral: (props: { locked: boolean; onOpenSlot(slot: { dir: string; stage: string }): void }) => {
    blocks.general.push(props);
    return (
      <button type="button" onClick={() => props.onOpenSlot({ dir: 'ja→en', stage: 'asr' })}>
        open chip
      </button>
    );
  },
  SessionSettingsProvider: () => <div data-testid="session-settings-provider" />,
}));

vi.mock('../sections', () => ({
  AudioDeviceSection: () => <div data-testid="audio-device-section" />,
  SystemAudioSection: () => <div data-testid="system-audio-section" />,
  VoicePassthroughSection: () => <div data-testid="voice-passthrough-section" />,
  HelpSection: () => <div data-testid="help-section" />,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { default: AdvancedSettings } = await import('./AdvancedSettings');

beforeEach(() => {
  run.locked = false;
  blocks.general.length = 0;
  useSettingsStore.setState({ engineSlotTarget: null, settingsNavigationTarget: null });
});

describe("AdvancedSettings — the General tab's chip deep-links to the Provider tab", () => {
  it("a chip's onOpenSlot sets engineSlotTarget and navigates to 'provider'", () => {
    render(<AdvancedSettings activeTab="general" />);

    fireEvent.click(screen.getByText('open chip'));

    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'asr' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
  });

  it("hands SessionSettingsGeneral the run's lock", () => {
    run.locked = true;
    render(<AdvancedSettings activeTab="general" />);
    expect(blocks.general[blocks.general.length - 1].locked).toBe(true);
  });
});

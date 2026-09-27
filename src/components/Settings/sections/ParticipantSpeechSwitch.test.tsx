import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const electron = vi.hoisted(() => ({ value: false }));
vi.mock('../../../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/environment')>();
  return { ...actual, isElectron: () => electron.value };
});
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});
const tooltipContents: unknown[] = [];
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ content }: { content: unknown }) => {
    tooltipContents.push(content);
    return null;
  },
}));
vi.mock('../../../providers/registry', () => ({ getProvider: (id: string) => (id === 'not-yet' ? { participantSpeech: false } : id === 'speaking' ? { participantSpeech: true } : {}) }));

import useAudioStore from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { ParticipantSpeechSwitch } from './ParticipantSpeechSwitch';

beforeEach(() => {
  electron.value = false;
  tooltipContents.length = 0;
  useRoutingStore.setState({ participantSpeech: false });
  useAudioStore.setState({ selectedParticipantSource: null } as Partial<ReturnType<typeof useAudioStore.getState>>);
  useProviderStore.setState({ selected: null });
});

describe('ParticipantSpeechSwitch', () => {
  it('reads and writes participantSpeech, labelled with its tooltip', () => {
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.textContent).toContain('audioPanel.participantSpeech');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(tooltipContents).toContain('audioPanel.participantSpeechDesc');
    fireEvent.click(sw);
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
  });

  it('locked disables it', () => {
    render(<ParticipantSpeechSwitch locked={true} />);
    expect(screen.getByRole('switch').getAttribute('aria-disabled')).toBe('true');
  });

  it('on Electron, a whole-system participant source shows it off and disabled, keeping the stored value', () => {
    electron.value = true;
    useRoutingStore.setState({ participantSpeech: true });
    useAudioStore.setState({
      selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' },
    } as Partial<ReturnType<typeof useAudioStore.getState>>);
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(tooltipContents).toContain('audioPanel.participantSpeechBlockedWholeSystem');
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
  });

  it('on Electron, an application participant source leaves it checked and enabled', () => {
    electron.value = true;
    useRoutingStore.setState({ participantSpeech: true });
    useAudioStore.setState({
      selectedParticipantSource: { deviceId: 'app:42', label: 'App' },
    } as Partial<ReturnType<typeof useAudioStore.getState>>);
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).toBe('false');
  });

  it('is unaffected by a whole-system source off Electron', () => {
    electron.value = false;
    useRoutingStore.setState({ participantSpeech: true });
    useAudioStore.setState({
      selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' },
    } as Partial<ReturnType<typeof useAudioStore.getState>>);
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).toBe('false');
  });

  it("shows it off and disabled while the provider's flag is off, keeping the stored value", () => {
    useRoutingStore.setState({ participantSpeech: true });
    useProviderStore.setState({ selected: 'not-yet' });
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(tooltipContents).toContain('audioPanel.participantSpeechNotYetAvailable');
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
  });

  it('names the provider before the whole-system rule', () => {
    electron.value = true;
    useRoutingStore.setState({ participantSpeech: true });
    useAudioStore.setState({
      selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' },
    } as Partial<ReturnType<typeof useAudioStore.getState>>);
    useProviderStore.setState({ selected: 'not-yet' });
    render(<ParticipantSpeechSwitch locked={false} />);
    expect(tooltipContents).toContain('audioPanel.participantSpeechNotYetAvailable');
    expect(tooltipContents).not.toContain('audioPanel.participantSpeechBlockedWholeSystem');
  });

  it('a provider whose flag is on, or that has none, leaves the switch as before', () => {
    for (const id of ['speaking', 'plain']) {
      tooltipContents.length = 0;
      useRoutingStore.setState({ participantSpeech: true });
      useProviderStore.setState({ selected: id });
      const { unmount } = render(<ParticipantSpeechSwitch locked={false} />);
      const sw = screen.getByRole('switch');
      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(sw.getAttribute('aria-disabled')).toBe('false');
      expect(tooltipContents).toContain('audioPanel.participantSpeechDesc');
      unmount();
    }
  });
});

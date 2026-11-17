// Audio — the mode switch and the "where the sound goes" drawing, together on the page.
// The real mode switch and speech section (which draws the flow); the microphone and the other side's sections stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, def?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const o = typeof def === 'object' ? def : opts;
      const d = typeof def === 'string' ? def : (o?.defaultValue as string | undefined) ?? key;
      return d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? ''));
    },
  }),
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../app/useRun', () => ({ useRunParticipantSpeech: () => null }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  getEnvironment: () => 'electron', isElectron: () => true, isExtension: () => false,
  isMacOS: () => true, isWindows: () => false, isLinux: () => false,
}));
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: async () => {} }) }));
vi.mock('../VbCable/VbCableNotice', () => ({ default: () => null }));
vi.mock('../Settings/sections/AudioDeviceSection', () => ({ default: () => <div /> }));
vi.mock('../Settings/sections/SystemAudioSection', () => ({ default: () => <div /> }));

import { AudioCategory } from './DeviceCategories';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';

const ZOOM = { deviceId: 'app:pid:7', label: 'Zoom' };

beforeEach(() => {
  useProviderStore.setState({
    selected: 'soniox',
    entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  } as never);
  useAudioStore.setState({
    mode: 'both', otherSide: 'meeting',
    audioMonitorDevices: [{ deviceId: 'mbp', label: 'MacBook Pro Speakers' }], selectedMonitorDevice: null,
    isMonitorMuted: true, isRealVoicePassthroughEnabled: true, realVoicePassthroughVolume: 0.2,
    // An application's audio, so that "Translation I hear" can be switched (a whole-system source blocks it).
    participantSources: [ZOOM], selectedParticipantSource: ZOOM, participantCaptureWidened: false,
    outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } },
  } as never);
  useRoutingStore.setState({ participantSpeech: true });
  useSettingsStore.setState({ textOnly: false, keepReplayAudio: false });
  useTurnModeStore.setState({ turnMode: 'auto' });
});
afterEach(() => cleanup());

const side = (name: 'mine' | 'theirs') => document.querySelector(`.sound-flow [data-side="${name}"]`)!;
const leg = (name: string) => document.querySelector(`.sound-flow [data-leg="${name}"]`)!;

describe('audio: the mode and where the sound goes', () => {
  it('the mode switch takes effect on the drawing at once: the side the mode does not use is greyed', () => {
    render(<AudioCategory locked={false} />);
    expect(side('mine')).not.toHaveClass('is-unused');
    expect(side('theirs')).not.toHaveClass('is-unused');
    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    expect(useAudioStore.getState().mode).toBe('speaker');
    expect(side('theirs')).toHaveClass('is-unused');
    expect(side('mine')).not.toHaveClass('is-unused');
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(side('mine')).toHaveClass('is-unused');
    expect(side('theirs')).not.toHaveClass('is-unused');
  });

  it('turning off the speech the other side hears dashes its lines; the translation is still made', () => {
    render(<AudioCategory locked={false} />);
    expect(leg('mineSpeech')).toHaveClass('is-on');
    fireEvent.click(screen.getByRole('switch', { name: 'Translation the other side hears' }));
    expect(leg('mineSpeech')).toHaveClass('is-off');
    expect(leg('otherHears')).toHaveClass('is-off');
    // The voice still goes into its translation: that line stays lit.
    expect(side('mine').querySelector('.sound-flow__leg:not([data-leg])')).toHaveClass('is-on');
    expect([...side('mine').querySelectorAll('.sound-flow__box')].map((b) => b.textContent)).toContain('Translate');
  });

  it('turning off the translation I hear dashes its lines only', () => {
    render(<AudioCategory locked={false} />);
    expect(leg('iHear')).toHaveClass('is-on');
    fireEvent.click(screen.getByRole('switch', { name: 'Translation I hear' }));
    expect(leg('iHear')).toHaveClass('is-off');
    expect(leg('theirSpeech')).toHaveClass('is-off');
    expect(leg('otherHears')).toHaveClass('is-on');
  });

  it('draws a line that is off as a dashed line (compiled SettingsPage.scss)', () => {
    const { css } = compile(resolve(__dirname, './SettingsPage.scss'));
    expect(css).toMatch(/\.sound-flow__leg\.is-off path \{[^}]*stroke-dasharray:/);
    expect(css).not.toMatch(/\.sound-flow__leg\.is-on path \{[^}]*stroke-dasharray:/);
  });
});

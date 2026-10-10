// src/components/Settings/sections/SpeechOutputSection.test.tsx
/**
 * The 语音 block (spec 2026-10-10 §1.1–1.2): six two-line rows named by who
 * hears what, each with its own device and channel, greyed / blocked /
 * hidden per mode as the table says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

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
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const shapeOverride = vi.hoisted(() => ({ provider: null as null | { id: string; speech: 'always' | 'optional' | 'never'; participantSpeech?: boolean } }));
vi.mock('../../../lib/session/appShape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/session/appShape')>();
  return {
    ...actual,
    selectedFromStores: () => (shapeOverride.provider
      ? { provider: shapeOverride.provider, entry: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } }
      : actual.selectedFromStores()),
  };
});
const env = vi.hoisted(() => ({ platform: 'electron' as 'electron' | 'extension' | 'web', os: 'mac' as 'mac' | 'win' | 'linux' }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  getEnvironment: () => env.platform,
  isElectron: () => env.platform === 'electron',
  isExtension: () => env.platform === 'extension',
  isMacOS: () => env.os === 'mac',
  isWindows: () => env.os === 'win',
  isLinux: () => env.os === 'linux',
}));
// Each row's help text, as the section hands it to the tooltip.
const tooltips = vi.hoisted(() => [] as unknown[]);
vi.mock('../../Tooltip/Tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../Tooltip/Tooltip')>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: React.ComponentProps<typeof Real>) => {
      tooltips.push(props.content);
      return Real(props);
    },
  };
});
const preview = vi.hoisted(() => vi.fn(async (_outlet: string) => {}));
vi.mock('../../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: preview }) }));

import useAudioStore from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { SONIOX_DEFAULTS } from '../../../providers/soniox/settings';
import { outletSelectValue } from '../../../lib/audio/outletOptions';
import SpeechOutputSection from './SpeechOutputSection';

const AIRPODS = { deviceId: 'airpods', label: 'AirPods Pro' };
const MBP = { deviceId: 'mbp', label: 'MacBook Pro Speakers' };
const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
const ZOOM = { deviceId: 'app:pid:7', label: 'Zoom' };

const pick = (id: string) => useProviderStore.setState({
  selected: id,
  entries: { [id]: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
} as never);

beforeEach(() => {
  shapeOverride.provider = null;
  tooltips.length = 0;
  env.platform = 'electron';
  env.os = 'mac';
  preview.mockClear();
  pick('soniox');
  useAudioStore.setState({
    mode: 'speaker', otherSide: 'meeting',
    audioMonitorDevices: [AIRPODS, MBP], selectedMonitorDevice: AIRPODS,
    isMonitorMuted: true, isRealVoicePassthroughEnabled: true, realVoicePassthroughVolume: 0.2,
    participantSources: [SYSTEM, ZOOM], selectedParticipantSource: SYSTEM, participantCaptureWidened: false,
    outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } },
  });
  useRoutingStore.setState({ participantSpeech: null });
  useSettingsStore.setState({ textOnly: false, keepReplayAudio: false });
  useTurnModeStore.setState({ turnMode: 'auto' });
});

const mount = (isSessionActive = false) => render(<SpeechOutputSection isSessionActive={isSessionActive} />);
const row = (label: string) => screen.getByText(label).closest('.setting-row') as HTMLElement;
const sw = (label: string) => screen.getByRole('switch', { name: label });
const greyed = (label: string) => row(label).classList.contains('setting-row--greyed');

describe('SpeechOutputSection — the rows', () => {
  it('is the speech section, with the six rows in order, under the 语音 heading', () => {
    mount();
    expect(document.getElementById('speech-section')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Speech/ })).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll('.setting-row__label')).map((el) => el.textContent);
    expect(labels).toEqual(['Default playback device', 'Translation the other side hears', 'I hear it too', 'Passthrough', 'Translation I hear', 'Keep spoken translations for replay']);
    expect(document.querySelectorAll('.setting-row__head .tooltip-trigger')).toHaveLength(6);
  });

  it('refreshes the device lists from the heading button, once per click', () => {
    const refreshDevices = vi.fn(async () => ({ defaultInputDevice: null, defaultMonitorDevice: null }));
    useAudioStore.setState({ refreshDevices, isLoading: false } as never);
    mount();
    fireEvent.click(screen.getByTitle('audioPanel.refreshDevices'));
    expect(refreshDevices).toHaveBeenCalledTimes(1);
  });

  it('默认播放设备 is a select over the devices, writing the monitor device', () => {
    mount();
    const select = within(row('Default playback device')).getByRole('combobox');
    expect((select as HTMLSelectElement).value).toBe('airpods');
    fireEvent.change(select, { target: { value: 'mbp' } });
    expect(useAudioStore.getState().selectedMonitorDevice).toEqual(MBP);
  });

  it('对方听到的翻译 is Text Only inverted, and shows the virtual microphone\'s name as a read-only field', () => {
    mount();
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'true');
    const field = row('Translation the other side hears').querySelector('.setting-row__field') as HTMLElement;
    expect(field.textContent).toBe('Virtual microphone · SokujiVirtualAudio');
    expect(field.getAttribute('title')).toBe(field.textContent);
    fireEvent.click(sw('Translation the other side hears'));
    expect(useSettingsStore.getState().textOnly).toBe(true);
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'false');
  });

  it('names the virtual microphone per platform: Linux, Windows, the extension\'s tab', () => {
    env.os = 'linux';
    const { unmount } = mount();
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · Sokuji_Virtual_Mic');
    unmount();
    env.os = 'win';
    const second = mount();
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · CABLE Output (VB-Audio Virtual Cable)');
    second.unmount();
    env.platform = 'extension';
    mount();
    expect(row('Translation the other side hears').querySelector('.setting-row__field')?.textContent).toBe('Virtual microphone · the meeting tab');
  });

  it('我也听 is the monitor inverted, with its own device select; the select lists follow-default and each device three ways', () => {
    mount();
    expect(sw('I hear it too')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw('I hear it too'));
    expect(useAudioStore.getState().isMonitorMuted).toBe(false);
    const select = within(row('I hear it too')).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Follow default (AirPods Pro)', 'Follow default · left channel', 'Follow default · right channel',
      'AirPods Pro', 'AirPods Pro · left channel', 'AirPods Pro · right channel',
      'MacBook Pro Speakers', 'MacBook Pro Speakers · left channel', 'MacBook Pro Speakers · right channel',
    ]);
    fireEvent.change(select, { target: { value: 'mbp#left' } });
    expect(useAudioStore.getState().outlets.me).toEqual({ device: 'mbp', channel: 'left' });
    fireEvent.change(select, { target: { value: '#auto' } });
    expect(useAudioStore.getState().outlets.me).toEqual({ device: null, channel: 'auto' });
  });

  it('greys 我也听 when 对方听到的翻译 is off, keeping its value; 原声直通 stays live under Text Only', () => {
    useSettingsStore.setState({ textOnly: true });
    mount();
    expect(greyed('I hear it too')).toBe(true);
    expect(greyed('Passthrough')).toBe(false);
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Passthrough')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    expect(within(row('Passthrough')).getByRole('slider')).not.toBeDisabled();
    expect(useAudioStore.getState().isRealVoicePassthroughEnabled).toBe(true);
    expect(useAudioStore.getState().isMonitorMuted).toBe(true);
  });

  it('原声直通: its switch, a slider labelled Volume N%, and the push-to-translate lock', () => {
    mount();
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    const slider = within(row('Passthrough')).getByRole('slider') as HTMLInputElement;
    expect(slider.max).toBe('0.6');
    expect(within(row('Passthrough')).getByText('Volume 20%')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(useAudioStore.getState().realVoicePassthroughVolume).toBeCloseTo(0.4);
    fireEvent.click(sw('Passthrough'));
    expect(useAudioStore.getState().isRealVoicePassthroughEnabled).toBe(false);
    act(() => { useTurnModeStore.setState({ turnMode: 'push-to-translate' }); });
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Passthrough')).toHaveAttribute('aria-disabled', 'true');
    expect(within(row('Passthrough')).queryByRole('slider')).toBeNull();
  });

  it('我听到的翻译 is greyed in Me mode (the other side\'s leg does not run)', () => {
    mount();
    expect(greyed('Translation I hear')).toBe(true);
    expect(row('Translation I hear').getAttribute('title')).toBe('Not in "Me" mode.');
  });

  it('保留译音以便回放 toggles the setting and is never locked', () => {
    mount(true);
    fireEvent.click(sw('Keep spoken translations for replay'));
    expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
  });
});

describe('SpeechOutputSection — per mode (spec §1.2)', () => {
  it('对方: 对方听到的翻译 and its sub-rows greyed; 我听到的翻译 blocked on a whole-system source with the reason line (Review Focus 4)', () => {
    useAudioStore.setState({ mode: 'participant' });
    mount();
    expect(greyed('Translation the other side hears')).toBe(true);
    expect(greyed('I hear it too')).toBe(true);
    expect(greyed('Passthrough')).toBe(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/All system sound is being captured/)).toBeInTheDocument();
    act(() => { useAudioStore.setState({ selectedParticipantSource: ZOOM }); });
    expect(sw('Translation I hear')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/All system sound is being captured/)).toBeNull();
  });

  it('两者 · 在线会议 · 整个系统: 我也听 and 我听到的翻译 blocked, one reason line; 原声直通 free', () => {
    useAudioStore.setState({ mode: 'both' });
    mount();
    expect(sw('I hear it too')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Passthrough')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText(/All system sound is being captured/)).toHaveLength(1);
  });

  it('a blocked switch shows off whatever is stored, wired to the one reason line', () => {
    useAudioStore.setState({ mode: 'both' });
    useRoutingStore.setState({ participantSpeech: true });
    useAudioStore.setState({ isMonitorMuted: false });
    mount();
    for (const label of ['I hear it too', 'Translation I hear']) {
      expect(sw(label)).toHaveAttribute('aria-checked', 'false');
      expect(sw(label)).toHaveAttribute('aria-disabled', 'true');
    }
    const reason = screen.getByText(/All system sound is being captured/).closest('.setting-row__reason') as HTMLElement;
    expect(sw('Translation I hear')).toHaveAttribute('aria-describedby', reason.id);
    expect(sw('I hear it too')).toHaveAttribute('aria-describedby', reason.id);
    expect(screen.getAllByText(/All system sound is being captured/)).toHaveLength(1);
  });

  it('an application capture that widens mid-run blocks 我听到的翻译 live, and unblocks when it narrows', () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'meeting', selectedParticipantSource: ZOOM });
    useRoutingStore.setState({ participantSpeech: true });
    mount();
    expect(sw('Translation I hear')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
    act(() => { useAudioStore.setState({ participantCaptureWidened: true }); });
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByText(/All system sound is being captured/)).toHaveLength(1);
    act(() => { useAudioStore.setState({ participantCaptureWidened: false }); });
    expect(screen.queryByText(/All system sound is being captured/)).toBeNull();
    expect(sw('Translation I hear')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
  });

  it('extension, 对方, whole-system source: nothing is blocked', () => {
    env.platform = 'extension';
    useAudioStore.setState({ mode: 'participant' });
    mount();
    expect(screen.queryByText(/All system sound is being captured/)).toBeNull();
    expect(sw('Translation I hear')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('a stored device that is no longer listed shows the follow-default entry', () => {
    useAudioStore.setState({ outlets: { other: { device: null, channel: 'auto' }, me: { device: 'gone', channel: 'both' }, them: { device: null, channel: 'auto' } } });
    mount();
    const select = within(row('I hear it too')).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe(outletSelectValue('me', { device: null, channel: 'auto' }, false));
  });

  it('两者 · 在线会议 · 应用: nothing blocked; 我听到的翻译 off until switched, then on', () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    mount();
    expect(sw('I hear it too')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw('Translation I hear'));
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
  });

  it('两者 · 就在身边: device·channel selects with previews on both rows, no 我也听, no 原声直通, the headphones hint; 我听到的翻译 on by auto', () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    mount();
    expect(screen.queryByText('I hear it too')).toBeNull();
    expect(screen.queryByText('Passthrough')).toBeNull();
    const other = within(row('Translation the other side hears')).getByRole('combobox') as HTMLSelectElement;
    expect(other.value).toBe('#right');
    const them = within(row('Translation I hear')).getByRole('combobox') as HTMLSelectElement;
    expect(them.value).toBe('#left');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Use headphones, one side each/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Preview/ })).toHaveLength(2);
  });

  it('the preview plays on the row\'s outlet whatever its switch (Review Focus 3)', async () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: false });
    mount();
    fireEvent.click(within(row('Translation I hear')).getByRole('button', { name: /Preview/ }));
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('them'));
    fireEvent.click(within(row('Translation the other side hears')).getByRole('button', { name: /Preview/ }));
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('other'));
  });

  it('a run locks 对方听到的翻译 and 我听到的翻译, with the reason, and leaves the selects live', () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    mount(true);
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear').closest('.toggle-switch-component')?.getAttribute('title')).toBe('Fixed for this session; stop it to change.');
    expect(within(row('I hear it too')).getByRole('combobox')).not.toBeDisabled();
    // Only the two spoken-translation switches lock (spec §1.2).
    expect(sw('I hear it too')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Passthrough')).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(row('Passthrough')).getByRole('slider')).not.toBeDisabled();
    expect(within(row('Default playback device')).getByRole('combobox')).not.toBeDisabled();
    expect(within(row('Translation I hear')).getByRole('combobox')).not.toBeDisabled();
  });

  it("a provider that always speaks shows 对方听到的翻译 on and disabled; one whose participant never speaks disables 我听到的翻译", () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    shapeOverride.provider = { id: 'x', speech: 'always', participantSpeech: true };
    const first = mount();
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-disabled', 'true');
    first.unmount();
    shapeOverride.provider = { id: 'x', speech: 'optional', participantSpeech: false };
    mount();
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
  });

  it("on the whole-system source a provider that does not speak for the participant still names itself: the tooltip is the not-offered text, beside the one reason line (the section's precedence)", () => {
    useAudioStore.setState({ mode: 'participant' }); // the whole-system source is the beforeEach's
    shapeOverride.provider = { id: 'x', speech: 'optional', participantSpeech: false };
    mount();
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
    expect(tooltips).toContain("This service does not speak the other side's translation.");
    expect(tooltips).not.toContain('What the other side says, translated and read aloud to me.');
    expect(screen.getAllByText(/All system sound is being captured/)).toHaveLength(1);
  });
});

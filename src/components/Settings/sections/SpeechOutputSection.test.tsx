// src/components/Settings/sections/SpeechOutputSection.test.tsx
/**
 * The Speech block (spec 2026-10-10 §1.1–1.2): six two-line rows named by who
 * hears what, each with its own device and channel, greyed / blocked /
 * hidden per mode as the table says.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const runSpeech = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock('../../../app/useRun', () => ({ useRunParticipantSpeech: () => runSpeech.value }));
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
// Each row's help text, as the page writes it under the row's label (mock v18).
const tooltips = () => Array.from(document.querySelectorAll('.setting-row__desc')).map((el) => el.textContent);
const preview = vi.hoisted(() => vi.fn(async (_outlet: string) => {}));
vi.mock('../../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: preview }) }));
vi.mock('../../VbCable/VbCableNotice', () => ({ default: ({ variant }: { variant: string }) => <div data-testid={`vbcable-${variant}`} /> }));

import useAudioStore from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { SONIOX_DEFAULTS } from '../../../providers/soniox/settings';
import { LOCAL_INFERENCE_DEFAULTS } from '../../../providers/localInference/settings';
import { useModelStore } from '../../../stores/modelStore';
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
  runSpeech.value = null;
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
// The row named so (the drawing above the rows repeats some names).
const row = (label: string) => screen.getByText(label, { selector: '.setting-row__label' }).closest('.setting-row') as HTMLElement;
const sw = (label: string) => screen.getByRole('switch', { name: label });
const greyed = (label: string) => row(label).classList.contains('setting-row--greyed');

describe('SpeechOutputSection — the rows', () => {
  it('is the speech section, with the six rows in order, under the Speech heading', () => {
    mount();
    expect(document.getElementById('speech-section')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Speech/ })).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll('.setting-row__label')).map((el) => el.textContent);
    expect(labels).toEqual(['Default playback device', 'Translation the other side hears', 'I hear it too', 'Passthrough', 'Translation I hear', 'Keep spoken translations for replay']);
    expect(document.querySelectorAll('.setting-row--inline .setting-row__desc')).toHaveLength(6);
    expect(document.querySelectorAll('.tooltip-trigger')).toHaveLength(0);
  });

  it('refreshes the device lists from the heading button, once per click', () => {
    const refreshDevices = vi.fn(async () => ({ defaultInputDevice: null, defaultMonitorDevice: null }));
    useAudioStore.setState({ refreshDevices, isLoading: false } as never);
    mount();
    fireEvent.click(screen.getByTitle('audioPanel.refreshDevices'));
    expect(refreshDevices).toHaveBeenCalledTimes(1);
  });

  it('Default playback device is a select over the devices, writing the monitor device', () => {
    mount();
    const select = within(row('Default playback device')).getByRole('combobox');
    expect((select as HTMLSelectElement).value).toBe('airpods');
    fireEvent.change(select, { target: { value: 'mbp' } });
    expect(useAudioStore.getState().selectedMonitorDevice).toEqual(MBP);
  });

  it('Translation the other side hears is Text Only inverted, and shows the virtual microphone\'s name as a read-only field', () => {
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

  it('I hear it too is the monitor inverted, with its own device select; the select lists follow-default and each device three ways', () => {
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

  it('greys I hear it too and Passthrough when Translation the other side hears is off, keeping their values', () => {
    useSettingsStore.setState({ textOnly: true });
    mount();
    expect(greyed('I hear it too')).toBe(true);
    expect(greyed('Passthrough')).toBe(true);
    expect(sw('Translation the other side hears')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Passthrough')).toHaveAttribute('aria-disabled', 'true');
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'false');
    expect(within(row('Passthrough')).getByRole('slider')).toBeDisabled();
    expect(useAudioStore.getState().isRealVoicePassthroughEnabled).toBe(true);
    expect(useAudioStore.getState().isMonitorMuted).toBe(true);
  });

  it('Passthrough is live again with Text Only off', () => {
    useSettingsStore.setState({ textOnly: false });
    mount();
    expect(greyed('Passthrough')).toBe(false);
    expect(within(row('Passthrough')).getByRole('slider')).not.toBeDisabled();
  });

  it('greys Keep spoken translations for replay when no leg is spoken (Me mode, Text Only), keeping its value', () => {
    useSettingsStore.setState({ textOnly: true, keepReplayAudio: true });
    mount();
    expect(greyed('Keep spoken translations for replay')).toBe(true);
    expect(sw('Keep spoken translations for replay')).toHaveAttribute('aria-checked', 'false');
    expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
  });

  it('keeps Keep spoken translations for replay live under Text Only while the other side is still spoken to me', () => {
    useSettingsStore.setState({ textOnly: true });
    useAudioStore.setState({ mode: 'both', otherSide: 'meeting', selectedParticipantSource: ZOOM });
    useRoutingStore.setState({ participantSpeech: true });
    mount();
    expect(greyed('Keep spoken translations for replay')).toBe(false);
  });

  it('Passthrough: its switch, a slider with its percent, and the push-to-translate lock', () => {
    mount();
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    const slider = within(row('Passthrough')).getByRole('slider') as HTMLInputElement;
    expect(slider.max).toBe('0.6');
    // The slider as Display's background opacity draws it (owner 2026-11-15): the native track, the percent on its right.
    expect(slider).not.toHaveClass('slider');
    expect(within(row('Passthrough')).getByText('20%')).toHaveClass('setting-value');
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(useAudioStore.getState().realVoicePassthroughVolume).toBeCloseTo(0.4);
    fireEvent.click(sw('Passthrough'));
    expect(useAudioStore.getState().isRealVoicePassthroughEnabled).toBe(false);
    act(() => { useTurnModeStore.setState({ turnMode: 'push-to-translate' }); });
    expect(sw('Passthrough')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Passthrough')).toHaveAttribute('aria-disabled', 'true');
    expect(within(row('Passthrough')).queryByRole('slider')).toBeNull();
  });

  it('Translation I hear is greyed in Me mode (the other side\'s leg does not run)', () => {
    mount();
    expect(greyed('Translation I hear')).toBe(true);
    expect(row('Translation I hear').getAttribute('title')).toBe('Not in "Me" mode. Your setting is kept.');
  });

  it('Keep spoken translations for replay toggles the setting and is never locked', () => {
    mount(true);
    fireEvent.click(sw('Keep spoken translations for replay'));
    expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
  });
});

describe("SpeechOutputSection — the run's frozen Translation I hear", () => {
  it('shows the run\'s value while it runs, whatever the stores say now', () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    useRoutingStore.setState({ participantSpeech: true });
    const { unmount } = mount(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
    unmount();
    runSpeech.value = false;
    mount(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Translation I hear')).toHaveAttribute('aria-disabled', 'true');
  });

  it("stays live in a run that speaks it: shows the switch as it stands and flips it (#595)", () => {
    useAudioStore.setState({ mode: 'participant', selectedParticipantSource: ZOOM });
    useRoutingStore.setState({ participantSpeech: true });
    runSpeech.value = true;
    mount(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Translation I hear')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear').closest('.toggle-switch-component')?.getAttribute('title')).not.toBe('Fixed for this session; stop it to change.');
    fireEvent.click(sw('Translation I hear'));
    expect(useRoutingStore.getState().participantSpeech).toBe(false);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw('Translation I hear'));
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
  });
});

describe('SpeechOutputSection — per mode (spec §1.2)', () => {
  it('Other: Translation the other side hears and its sub-rows greyed; Translation I hear blocked on a whole-system source with the reason line (Review Focus 4)', () => {
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

  it('Both · in a meeting · whole system: I hear it too and Translation I hear blocked, one reason line; Passthrough free', () => {
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

  it('an application capture that widens mid-run blocks Translation I hear live, and unblocks when it narrows', () => {
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

  it('extension, Other, whole-system source: nothing is blocked', () => {
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

  it('Both · in a meeting · application: nothing blocked; Translation I hear off until switched, then on', () => {
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: ZOOM });
    mount();
    expect(sw('I hear it too')).not.toHaveAttribute('aria-disabled', 'true');
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw('Translation I hear'));
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
    expect(sw('Translation I hear')).toHaveAttribute('aria-checked', 'true');
  });

  it('Both · beside me: device·channel selects with previews on both rows, no I hear it too, no Passthrough, the headphones hint; Japanese translation plays on on by auto', () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    mount();
    expect(screen.queryByText('I hear it too')).toBeNull();
    expect(screen.queryByText('Passthrough')).toBeNull();
    const other = within(row('English translation plays on')).getByRole('combobox') as HTMLSelectElement;
    expect(other.value).toBe('#right');
    const them = within(row('Japanese translation plays on')).getByRole('combobox') as HTMLSelectElement;
    expect(them.value).toBe('#left');
    expect(sw('Japanese translation plays on')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Use headphones, one side each/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Preview/ })).toHaveLength(2);
    // Each row's help says where that language's translation plays, not what the row is in a meeting.
    expect(tooltips()).toContain('The English translation plays here: choose the device and side (left or right) the English listener wears.');
    expect(tooltips()).toContain('The Japanese translation plays here: choose the device and side (left or right) the Japanese listener wears.');
  });

  it('Both · beside me: an auto source keeps the generic name and tooltip, since it names no language', () => {
    useProviderStore.setState({ selected: 'soniox', entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } } } as never);
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    mount();
    expect(row('English translation plays on')).toBeInTheDocument();
    expect(row('Translation I hear')).toBeInTheDocument();
    expect(tooltips()).toContain('What the other side says, translated and read aloud to me.');
  });

  it('the preview plays on the row\'s outlet whatever its switch (Review Focus 3)', async () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: false });
    mount();
    fireEvent.click(within(row('Japanese translation plays on')).getByRole('button', { name: /Preview/ }));
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('them'));
    fireEvent.click(within(row('English translation plays on')).getByRole('button', { name: /Preview/ }));
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('other'));
  });

  it('a run locks Translation the other side hears and Translation I hear, with the reason, and leaves the selects live', () => {
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

  it("a provider that always speaks shows Translation the other side hears on and disabled; one whose participant never speaks disables Translation I hear", () => {
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
    expect(tooltips()).toContain("This service does not speak the other side's translation.");
    expect(tooltips()).not.toContain('What the other side says, translated and read aloud to me.');
    expect(screen.getAllByText(/All system sound is being captured/)).toHaveLength(1);
  });
});

describe('SpeechOutputSection — the voice each spoken row reads in', () => {
  const initialModelState = useModelStore.getState();
  afterEach(() => useModelStore.setState(initialModelState, true));
  const voiceLine = (label: string) => row(label).querySelector('.setting-row__voice');

  it("names the voice under each spoken row: mine, and the other party's", () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    mount();
    const named = (label: string) => {
      const line = voiceLine(label) as HTMLElement;
      expect(line.firstElementChild).toHaveTextContent('Voice');
      return within(line).getByRole('button').textContent;
    };
    expect(named('English translation plays on')).toBe('Adrian');
    expect(named('Japanese translation plays on')).toBe('Grace');
  });

  it('draws no line under a row that is off or not in this mode', () => {
    mount();
    expect(voiceLine('Translation the other side hears')).not.toBeNull();
    expect(voiceLine('Translation I hear')).toBeNull();
    act(() => useSettingsStore.setState({ textOnly: true }));
    expect(voiceLine('Translation the other side hears')).toBeNull();
  });

  it("draws no line under a row whose leg does not run in this mode, whatever its switch says (#621 review)", () => {
    useAudioStore.setState({ mode: 'participant' });
    mount();
    // Other only: my leg does not run, though Translation the other side hears is on.
    expect(voiceLine('Translation the other side hears')).toBeNull();
    act(() => { useAudioStore.setState({ mode: 'speaker' }); useRoutingStore.setState({ participantSpeech: true }); });
    // Me only: the other side's leg does not run, though Translation I hear was left on.
    expect(voiceLine('Translation I hear')).toBeNull();
  });

  it('the name opens the voice settings and no longer switches the settings layout; a run leaves it usable', () => {
    useSettingsStore.setState({ uiMode: 'basic', settingsNavigationTarget: null });
    mount(true);
    fireEvent.click(within(voiceLine('Translation the other side hears') as HTMLElement).getByRole('button', { name: 'Adrian' }));
    expect(useSettingsStore.getState().uiMode).toBe('basic');
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('voice-settings');
  });

  it('a provider with no voice summary draws no line', () => {
    pick('openai_translate');
    mount();
    expect(document.querySelector('.setting-row__voice')).toBeNull();
  });

  it("for a provider whose voices sit with its engine, the name opens its voices in the line-up's speech card (B-20)", () => {
    useProviderStore.setState({
      selected: 'local_inference',
      entries: { local_inference: { settings: { ...LOCAL_INFERENCE_DEFAULTS, voices: { 'ja→en': { edge: 'en-US-AvaNeural' } } }, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    } as never);
    useModelStore.setState({ resolve: () => ({ asr: null, translation: null, tts: { modelId: 'edge-tts', source: 'auto' }, notes: [], prunes: [] }) } as never);
    useSettingsStore.setState({ uiMode: 'basic', settingsNavigationTarget: null, engineSlotTarget: null });
    mount();
    fireEvent.click(within(voiceLine('Translation the other side hears') as HTMLElement).getByRole('button', { name: 'Ava' }));
    expect(useSettingsStore.getState().uiMode).toBe('basic');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('local-voices');
  });
});

describe('SpeechOutputSection — VB-CABLE on Windows (spec 2026-10-17 §4)', () => {
  const SPEAKERS = { deviceId: 'spk', label: 'Speakers (Realtek(R) Audio)' };
  const CABLE = { deviceId: 'cable', label: 'CABLE Input (VB-Audio Virtual Cable)' };
  const field = () => row('Translation the other side hears').querySelector('.setting-row__field');

  beforeEach(() => { env.os = 'win'; useAudioStore.setState({ outputLabelsKnown: true }); });
  afterEach(() => { useAudioStore.setState({ devicesLoaded: false, outputLabelsKnown: false }); });

  it('missing: no virtual-microphone field, no Passthrough, the notice under the row', () => {
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(field()).toBeNull();
    expect(screen.queryByText('Passthrough')).toBeNull();
    expect(within(row('Translation the other side hears')).getByTestId('vbcable-row')).toBeInTheDocument();
  });

  it('present: the field and Passthrough are back, and the notice stays mounted for the ready line', () => {
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS, CABLE], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(field()?.textContent).toBe('Virtual microphone · CABLE Output (VB-Audio Virtual Cable)');
    expect(screen.getByText('Passthrough')).toBeInTheDocument();
    expect(screen.getByTestId('vbcable-row')).toBeInTheDocument();
  });

  it('not before the device list is known: the field as before, no notice content decided yet', () => {
    useAudioStore.setState({ devicesLoaded: false, audioMonitorDevices: [] });
    mount();
    expect(field()).not.toBeNull();
  });

  it('not while the outputs carry only placeholder names: the field and Passthrough stay', () => {
    const placeholder = { deviceId: 'abcdef01', label: 'Speaker abcde...' };
    useAudioStore.setState({ devicesLoaded: true, outputLabelsKnown: false, audioMonitorDevices: [placeholder], selectedMonitorDevice: placeholder });
    mount();
    expect(field()).not.toBeNull();
    expect(screen.getByText('Passthrough')).toBeInTheDocument();
  });

  it('nothing in Other mode, where no translation goes into the virtual microphone and the row is greyed', () => {
    useAudioStore.setState({ mode: 'participant', devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(greyed('Translation the other side hears')).toBe(true);
    expect(screen.queryByTestId('vbcable-row')).toBeNull();
  });

  it('nothing while the translation is not spoken', () => {
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    useSettingsStore.setState({ textOnly: true });
    mount();
    expect(screen.queryByTestId('vbcable-row')).toBeNull();
  });

  it('not on macOS, where the virtual microphone is Sokuji\'s own', () => {
    env.os = 'mac';
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(screen.queryByTestId('vbcable-row')).toBeNull();
  });
});

describe('SpeechOutputSection — the aids (providers and stages design, section 8)', () => {
  it('names the two groups of speech rows and explains the default playback device', () => {
    mount();
    const mine = screen.getByText('What I say, as speech');
    const theirs = screen.getByText('What the other side says, as speech');
    const otherRow = row('Translation the other side hears');
    const themRow = row('Translation I hear');
    expect(mine.compareDocumentPosition(otherRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(theirs.compareDocumentPosition(themRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(otherRow.compareDocumentPosition(theirs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Sounds on my side play here unless a row names its own device/)).toBeInTheDocument();
  });
});


// The mock's audio page (v18): a plain heading with its hint; the rows in one card, under the mock's captions.
describe('SpeechOutputSection — as the mock draws it', () => {
  it('heads the section with its name and hint, no icon or help mark', () => {
    mount();
    const heading = screen.getByRole('heading', { name: /Speech/ });
    expect(heading).toHaveTextContent('Which translations are spoken, to whom, and on which device.');
    expect(heading.querySelector('svg:not(.lucide-refresh-cw)')).toBeNull();
  });

  it('puts the rows in one card, under the captions for my speech, the other side\'s and replay', () => {
    mount();
    const card = document.querySelector('.speech-card')!;
    expect(card.querySelectorAll('.setting-row')).toHaveLength(6);
    expect(Array.from(card.querySelectorAll('.speech-section__caption')).map((c) => c.textContent))
      .toEqual(['What I say, as speech', 'What the other side says, as speech', 'Replay']);
  });

  it('says what the default playback device is for under its name', () => {
    mount();
    expect(within(row('Default playback device')).getByText(/Sounds on my side play here unless a row names its own device/)).toHaveClass('setting-row__desc');
  });
});

// The owner chose the mock's "where the sound goes" drawing for wide windows (2026-11-15): above the rows, following them.
describe('SpeechOutputSection — where the sound goes', () => {
  it('draws it above the rows, its lines following the switches', () => {
    mount();
    const flow = document.querySelector('.sound-flow')!;
    expect(flow).not.toBeNull();
    expect(flow.compareDocumentPosition(document.querySelector('.speech-card')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flow.querySelector('[data-leg="otherHears"]')).toHaveClass('is-on');
    expect(flow.textContent).toContain('Passthrough 20%');
  });

  it('is not drawn face to face, where there is no virtual microphone', () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    mount();
    expect(document.querySelector('.sound-flow')).toBeNull();
  });

  // B-28: the drawing names passthrough's volume while it is off, as its row's slider shows it.
  it("names passthrough's volume while it is off", () => {
    useAudioStore.setState({ isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.35 });
    mount();
    const flow = document.querySelector('.sound-flow')!;
    expect(flow.querySelector('[data-leg="passthrough"]')).toHaveClass('is-off');
    expect(flow.textContent).toContain('Passthrough 35%');
  });

  // B-27: each part of the drawing with a row below takes you to that row; the page scrolls to `#<target>-section`.
  it('takes each part to its setting: the microphone, the other side\'s voice, and the four rows by their own anchors', () => {
    useAudioStore.setState({ mode: 'both' });
    useSettingsStore.setState({ settingsNavigationTarget: null });
    mount();
    const go = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Go to the “${name}” setting` }));
      return useSettingsStore.getState().settingsNavigationTarget;
    };
    expect(go('My microphone')).toBe('microphone');
    expect(go("The other side's voice")).toBe('participant');
    expect(go('Translation the other side hears')).toBe('speech-other-hears');
    expect(go('I hear it too')).toBe('speech-me-too');
    expect(go('Passthrough')).toBe('speech-passthrough');
    expect(go('Translation I hear')).toBe('speech-i-hear');
    expect(document.getElementById('speech-other-hears-section')).toBe(row('Translation the other side hears'));
    expect(document.getElementById('speech-me-too-section')).toBe(row('I hear it too'));
    expect(document.getElementById('speech-passthrough-section')).toBe(row('Passthrough'));
    expect(document.getElementById('speech-i-hear-section')).toBe(row('Translation I hear'));
  });
});

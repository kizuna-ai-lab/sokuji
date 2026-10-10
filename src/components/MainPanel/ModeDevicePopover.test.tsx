/**
 * Participant row of the mode/device popover (issue #335).
 *
 * The row used to be device-less and showed a fixed "All system audio"
 * subtitle. Once participant capture can be scoped to one application that
 * subtitle becomes a lie, so the row gains a real picker when - and only when -
 * a per-application helper actually reported sources.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useProviderStore as useProviderStoreMock } from '../../stores/providerStore';
import ModeDevicePopover from './ModeDevicePopover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, a?: string | Record<string, unknown>, b?: Record<string, unknown>) => {
      const def = typeof a === 'string' ? a : (a?.defaultValue as string | undefined) ?? key;
      const vars = (typeof a === 'object' ? a : b) ?? {};
      return def.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''));
    },
  }),
}));

const env = { extension: false };
const widened = vi.hoisted(() => ({ value: false }));
vi.mock('../../utils/environment', () => ({
  isExtension: () => env.extension,
  isElectron: () => !env.extension,
  getEnvironment: () => (env.extension ? 'extension' : 'electron'),
}));

const settings = { textOnly: false, navigate: vi.fn() };
vi.mock('../../stores/settingsStore', () => ({
  useNavigateToSettings: () => settings.navigate,
  useSettingsStore: (pick: (s: unknown) => unknown) => pick({ textOnly: settings.textOnly }),
}));

const store = {
  otherSide: 'meeting' as 'meeting' | 'beside',
  setOtherSide: vi.fn(),
  sources: [] as Array<{ deviceId: string; label: string }>,
  selected: null as { deviceId: string; label: string } | null,
  select: vi.fn(),
  setParticipantMuted: vi.fn(),
  setMicMuted: vi.fn(),
  monitor: { deviceId: 'out-1', label: 'AirPods Pro' } as { deviceId: string; label: string } | null,
};
const monitor = { setMuted: vi.fn() };
const routing = { participantSpeech: null as boolean | null, setParticipantSpeech: vi.fn() };
vi.mock('../../stores/routingStore', () => ({ useRoutingStore: (pick: (s: unknown) => unknown) => pick({ participantSpeech: routing.participantSpeech, setParticipantSpeech: routing.setParticipantSpeech }) }));
const freshOutlets = () => ({ other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } }) as Record<'other' | 'me' | 'them', { device: string | null; channel: 'auto' | 'both' | 'left' | 'right' }>;
const outletsState = { outlets: freshOutlets(), setDevice: vi.fn(), setChannel: vi.fn() };

vi.mock('../../stores/audioStore', () => ({
  useAudioContext: () => ({
    audioInputDevices: [],
    audioMonitorDevices: [{ deviceId: 'out-1', label: 'AirPods Pro' }, { deviceId: 'out-2', label: 'MacBook Pro Speakers' }],
    selectedInputDevice: null,
    selectedMonitorDevice: store.monitor,
    selectInputDevice: vi.fn(),
    selectMonitorDevice: vi.fn(),
  }),
  useIsMicMuted: () => false,
  useIsMonitorMuted: () => false,
  useIsParticipantMuted: () => false,
  useSetMicMuted: () => store.setMicMuted,
  useSetMonitorMuted: () => monitor.setMuted,
  useSetParticipantMuted: () => store.setParticipantMuted,
  useOutlets: () => outletsState.outlets,
  useSetOutletDevice: () => outletsState.setDevice,
  useSetOutletChannel: () => outletsState.setChannel,
  useSelectedMonitorDevice: () => store.monitor,
  useParticipantSources: () => store.sources,
  useParticipantCaptureWidened: () => widened.value,
  useSelectedParticipantSource: () => store.selected,
  useSelectParticipantSource: () => store.select,
  useOtherSide: () => store.otherSide,
  useSetOtherSide: () => store.setOtherSide,
}));

const f2f = { offered: true, active: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: {}, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } };
vi.mock('./useFaceToFace', () => ({ useFaceToFace: () => f2f }));
const tone = vi.fn(async (_outlet: string) => {});
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: tone }) }));
const report = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError: report.error,
}));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => code.toUpperCase() }));

vi.mock('../../stores/providerStore', async () => {
  const { create: make } = await import('zustand');
  return { useProviderStore: make(() => ({ selected: 'p', entries: {} as Record<string, unknown> })) };
});
const runSpeech = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock('../../app/useRun', () => ({ useRunParticipantSpeech: () => runSpeech.value }));
const providerState = { participantSpeech: undefined as boolean | undefined };
vi.mock('../../lib/session/appShape', () => ({ heardFromStores: (faceToFace: boolean) => (faceToFace || env.extension || (store.selected?.deviceId ?? '').startsWith('app:')) && !widened.value, selectedFromStores: () => ({ provider: { speech: 'optional', participantSpeech: providerState.participantSpeech } }) }));

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
const CHROMIUM = { deviceId: 'app:pid:205', label: 'Chromium' };

beforeEach(() => {
  env.extension = false;
  widened.value = false;
  store.sources = [SYSTEM, CHROMIUM];
  store.selected = CHROMIUM;
  store.otherSide = 'meeting';
  Object.assign(f2f, { offered: true, active: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: {}, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } });
  providerState.participantSpeech = undefined;
  runSpeech.value = null;
  settings.textOnly = false;
  settings.navigate.mockReset();
  routing.participantSpeech = null;
  routing.setParticipantSpeech.mockReset();
  monitor.setMuted.mockReset();
  outletsState.outlets = freshOutlets();
  outletsState.setDevice.mockReset();
  outletsState.setChannel.mockReset();
  store.monitor = { deviceId: 'out-1', label: 'AirPods Pro' };
  tone.mockReset();
  tone.mockImplementation(async () => {});
  report.error.mockReset();
  store.setOtherSide.mockReset();
  store.select.mockReset();
  store.setParticipantMuted.mockReset();
  store.setMicMuted.mockReset();
});

// The popover renders against an anchor element; a detached div is enough.
const mount = () => {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  return render(
    <ModeDevicePopover mode="participant" open={true} anchorEl={anchor} onClose={vi.fn()} locked={false} />
  );
};

describe('ModeDevicePopover participant row', () => {
  it('offers the application sources when a helper reported them', () => {
    mount();
    expect(screen.getByText('Chromium')).toBeInTheDocument();
  });

  it('drops the stale "All system audio" subtitle once a picker exists', () => {
    mount();
    // Saying "All system audio" while a single application is selected is wrong.
    expect(screen.queryByText('All system audio')).toBeNull();
  });

  it('expands to reveal the other sources and selecting one updates the store', () => {
    mount();
    // The row was previously hardcoded as non-expandable for participant.
    fireEvent.click(screen.getByText("Other's audio").closest('button')!);
    fireEvent.click(screen.getByText('System Audio (All Applications)'));

    expect(store.select).toHaveBeenCalledWith(SYSTEM);
    expect(store.setParticipantMuted).toHaveBeenCalledWith(false);
  });

  it('is not expandable when there is nothing to pick', () => {
    store.sources = [SYSTEM];
    store.selected = SYSTEM;
    mount();
    expect(screen.getByText("Other's audio").closest('button')!.hasAttribute('aria-expanded')).toBe(false);
  });

  it('keeps the subtitle when no per-application helper reported sources', () => {
    store.sources = [SYSTEM];
    store.selected = SYSTEM;
    mount();
    expect(screen.getByText('All system audio')).toBeInTheDocument();
  });

  it('keeps the extension subtitle and offers no picker', () => {
    // Tab capture is already scoped to one tab.
    env.extension = true;
    mount();
    expect(screen.getByText('Plays via system default')).toBeInTheDocument();
    expect(screen.queryByText('Chromium')).toBeNull();
  });
});

describe('ModeDevicePopover — Both, the other side', () => {
  const mountBoth = (locked = false) => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    return render(<ModeDevicePopover mode="both" open={true} anchorEl={anchor} onClose={vi.fn()} locked={locked} />);
  };

  it('offers "In a meeting" and "Beside me" and stores the choice', () => {
    mountBoth();
    fireEvent.click(screen.getByRole('radio', { name: /Beside me/ }));
    expect(store.setOtherSide).toHaveBeenCalledWith('beside');
  });

  // The run's shape and capture are frozen at Start; the routing reads the choice live.
  it("locks the choice during a run, with the mode picker's own words, and frees it when idle", () => {
    const { unmount } = mountBoth(true);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).toBeDisabled();
      expect(radio.closest('label')?.getAttribute('title')).toBe('Mode is locked during a session.');
    }
    fireEvent.click(screen.getByRole('radio', { name: /In a meeting/ }));
    expect(store.setOtherSide).not.toHaveBeenCalled();
    unmount();

    mountBoth(false);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeEnabled();
      expect(radio.closest('label')?.hasAttribute('title')).toBe(false);
    }
  });

  const order = () => Array.from(document.querySelectorAll('.mode-device-popover__row .mode-device-popover__row-label, [role="radiogroup"]'))
    .map((el) => (el.getAttribute('role') === 'radiogroup' ? 'choice' : el.textContent));

  it('in a meeting: the microphone, the choice, then the system-audio row', () => {
    mountBoth();
    expect(order()).toEqual(['Microphone', 'choice', "Other's audio"]);
  });

  it('beside me: the microphone, the choice, then the two translation rows with previews, and no ears block or swap', async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    expect(order()).toEqual(['Microphone', 'choice', 'Translation the other side hears', 'Translation I hear']);
    expect(document.querySelector('.mode-device-popover__ears')).toBeNull();
    expect(screen.queryByRole('button', { name: /Swap/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Translation the other side hears' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('other'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview Translation I hear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('them'));
  });

  it('beside me: the translation rows list follow-default and each device three ways, summarise the resolved entry, and a pick writes the outlet without touching a switch', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    const rows = Array.from(document.querySelectorAll('.mode-device-popover__row'));
    const them = rows.find((r) => r.textContent?.includes('Translation I hear'))!;
    expect(them.querySelector('.mode-device-popover__summary')?.textContent).toBe('Follow default · left channel');
    fireEvent.click(them.querySelector('.mode-device-popover__row-main')!);
    const options = Array.from(document.querySelectorAll('.mode-device-popover__device-row')).map((el) => el.textContent);
    expect(options).toEqual([
      'Follow default (AirPods Pro)', 'Follow default · left channel', 'Follow default · right channel',
      'AirPods Pro', 'AirPods Pro · left channel', 'AirPods Pro · right channel',
      'MacBook Pro Speakers', 'MacBook Pro Speakers · left channel', 'MacBook Pro Speakers · right channel',
    ]);
    fireEvent.click(screen.getByText('MacBook Pro Speakers · right channel'));
    expect(outletsState.setDevice).toHaveBeenCalledWith('them', 'out-2');
    expect(outletsState.setChannel).toHaveBeenCalledWith('them', 'right');
    expect(routing.setParticipantSpeech).not.toHaveBeenCalled();
  });

  it('an absent device shows the default in the summary (Review Focus 4)', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    outletsState.outlets = { ...outletsState.outlets, other: { device: 'usb-gone', channel: 'right' } };
    mountBoth();
    const other = Array.from(document.querySelectorAll('.mode-device-popover__row')).find((r) => r.textContent?.includes('Translation the other side hears'))!;
    expect(other.querySelector('.mode-device-popover__summary')?.textContent).toBe('Follow default · right channel');
  });

  it("records a preview that did not play, as the panel's test tone does", async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    tone.mockRejectedValue(new Error('no output device'));
    mountBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Translation I hear' }));
    await vi.waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
    const [source, message, options] = report.error.mock.calls[0];
    expect(source).toBe('ModeDevicePopover');
    expect(message).toContain('no output device');
    expect(options?.cause).toBeInstanceOf(Error);
  });

  it('labels the choice by its visible heading, not by a second copy of the words', () => {
    mountBoth();
    const group = screen.getByRole('radiogroup', { name: 'Other side' });
    expect(group.hasAttribute('aria-label')).toBe(false);
    const heading = document.getElementById(group.getAttribute('aria-labelledby')!);
    expect(heading?.textContent).toBe('Other side');
    expect(heading?.closest('[role="radiogroup"]')).toBeNull();
  });

  it('hides the choice under a provider without face-to-face', () => {
    f2f.offered = false;
    mountBoth();
    expect(screen.queryByRole('radio', { name: /Beside me/ })).toBeNull();
  });
});

describe('ModeDevicePopover — the speech rows in Me and Other', () => {
  const mount = (mode: 'speaker' | 'participant') => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    return render(<ModeDevicePopover mode={mode} open={true} anchorEl={anchor} onClose={vi.fn()} locked={false} />);
  };

  it('Me: the microphone, then I hear it too with the monitor switch and its device', () => {
    mount('speaker');
    const labels = Array.from(document.querySelectorAll('.mode-device-popover__row-label')).map((el) => el.textContent);
    expect(labels).toEqual(['Microphone', 'I hear it too']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off I hear it too' }));
    expect(monitor.setMuted).toHaveBeenCalledWith(true);
  });

  it('Me: under Text Only I hear it too is off and disabled with the page\'s reason', () => {
    settings.textOnly = true;
    mount('speaker');
    const button = screen.getByRole('button', { name: 'Turn on I hear it too' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('title')).toBe('Nothing to hear while the translation is not spoken. Your setting is kept.');
  });

  it("the footer link lands on the speech rows in every mode", () => {
    for (const mode of ['speaker', 'participant'] as const) {
      settings.navigate.mockReset();
      const { unmount } = mount(mode);
      fireEvent.click(screen.getByText('Full settings →'));
      expect(settings.navigate).toHaveBeenCalledWith('speech');
      unmount();
    }
  });

  it("Other: the system-audio row, then Translation I hear whose switch writes participantSpeech", () => {
    store.selected = CHROMIUM;
    mount('participant');
    const labels = Array.from(document.querySelectorAll('.mode-device-popover__row-label')).map((el) => el.textContent);
    expect(labels).toEqual(["Other's audio", 'Translation I hear']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Translation I hear' }));
    expect(routing.setParticipantSpeech).toHaveBeenCalledWith(true);
  });

  it('a pick in I hear it too writes the outlet and leaves the monitor switch alone', () => {
    mount('speaker');
    fireEvent.click(screen.getByText('I hear it too').closest('button')!);
    fireEvent.click(screen.getByText('MacBook Pro Speakers · left channel'));
    expect(outletsState.setDevice).toHaveBeenCalledWith('me', 'out-2');
    expect(outletsState.setChannel).toHaveBeenCalledWith('me', 'left');
    expect(monitor.setMuted).not.toHaveBeenCalled();
  });

  it('a pick in Translation I hear leaves participantSpeech alone', () => {
    store.selected = CHROMIUM;
    mount('participant');
    fireEvent.click(screen.getByText('Translation I hear').closest('button')!);
    fireEvent.click(screen.getByText('AirPods Pro · right channel'));
    expect(outletsState.setDevice).toHaveBeenCalledWith('them', 'out-1');
    expect(routing.setParticipantSpeech).not.toHaveBeenCalled();
  });

  it('locked during a run: the switch is disabled with the run-lock title', () => {
    store.selected = CHROMIUM;
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    render(<ModeDevicePopover mode="participant" open={true} anchorEl={anchor} onClose={vi.fn()} locked={true} />);
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toBe('Fixed for this session; stop it to change.');
  });

  it("while a run is live the row shows the run's frozen value, not the stores'", () => {
    routing.participantSpeech = true;
    runSpeech.value = false;
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    render(<ModeDevicePopover mode="participant" open={true} anchorEl={anchor} onClose={vi.fn()} locked={true} />);
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('a provider that does not speak the other side: disabled and not checked', () => {
    store.selected = CHROMIUM;
    providerState.participantSpeech = false;
    routing.participantSpeech = true;
    mount('participant');
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/does not speak/);
  });

  it('a provider change while the popover stays mounted updates the switch', () => {
    store.selected = CHROMIUM;
    providerState.participantSpeech = true;
    mount('participant');
    expect(screen.getByRole('button', { name: 'Turn on Translation I hear' })).toBeEnabled();
    providerState.participantSpeech = false;
    act(() => useProviderStoreMock.setState({ entries: { ...useProviderStoreMock.getState().entries } }));
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/does not speak/);
  });

  it('blocked: an application capture that widened to the whole system disables the switch with the reason, live', () => {
    store.selected = { deviceId: 'app:7', label: 'Zoom' };
    widened.value = true;
    mount('participant');
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/All system sound is being captured/);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('blocked: on a whole-system source the power button is disabled with the reason (Review Focus 2)', () => {
    store.selected = SYSTEM;
    mount('participant');
    const button = screen.getByRole('button', { name: 'Turn on Translation I hear' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/All system sound is being captured/);
  });
});

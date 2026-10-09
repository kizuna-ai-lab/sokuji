/**
 * Participant row of the mode/device popover (issue #335).
 *
 * The row used to be device-less and showed a fixed "All system audio"
 * subtitle. Once participant capture can be scoped to one application that
 * subtitle becomes a lie, so the row gains a real picker when - and only when -
 * a per-application helper actually reported sources.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModeDevicePopover from './ModeDevicePopover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

const env = { extension: false };
vi.mock('../../utils/environment', () => ({
  isExtension: () => env.extension,
  isElectron: () => !env.extension,
}));

vi.mock('../../stores/settingsStore', () => ({
  useNavigateToSettings: () => vi.fn(),
}));

const store = {
  otherSide: 'meeting' as 'meeting' | 'beside',
  setOtherSide: vi.fn(),
  sources: [] as Array<{ deviceId: string; label: string }>,
  selected: null as { deviceId: string; label: string } | null,
  select: vi.fn(),
  setParticipantMuted: vi.fn(),
  setOutletChannel: vi.fn(),
};

vi.mock('../../stores/audioStore', () => ({
  useAudioContext: () => ({
    audioInputDevices: [],
    audioMonitorDevices: [],
    selectedInputDevice: null,
    selectedMonitorDevice: null,
    selectInputDevice: vi.fn(),
    selectMonitorDevice: vi.fn(),
  }),
  useIsMicMuted: () => false,
  useIsMonitorMuted: () => false,
  useIsParticipantMuted: () => false,
  useSetMicMuted: () => vi.fn(),
  useSetMonitorMuted: () => vi.fn(),
  useSetParticipantMuted: () => store.setParticipantMuted,
  useSetOutletChannel: () => store.setOutletChannel,
  useParticipantSources: () => store.sources,
  useSelectedParticipantSource: () => store.selected,
  useSelectParticipantSource: () => store.select,
  useOtherSide: () => store.otherSide,
  useSetOtherSide: () => store.setOtherSide,
}));

const f2f = { offered: true, active: false, swap: false, ears: { speaker: 'right', participant: 'left' }, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } };
vi.mock('./useFaceToFace', () => ({ useFaceToFace: () => f2f }));
const tone = vi.fn(async (_outlet: 'other' | 'me' | 'them') => {});
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ earPreview: tone }) }));
const report = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError: report.error,
}));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => code.toUpperCase() }));

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
const CHROMIUM = { deviceId: 'app:pid:205', label: 'Chromium' };

beforeEach(() => {
  env.extension = false;
  store.sources = [SYSTEM, CHROMIUM];
  store.selected = CHROMIUM;
  store.otherSide = 'meeting';
  Object.assign(f2f, { offered: true, active: false, swap: false, ears: { speaker: 'right', participant: 'left' }, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } });
  tone.mockReset();
  tone.mockImplementation(async () => {});
  report.error.mockReset();
  store.setOutletChannel.mockClear();
  store.setOtherSide.mockReset();
  store.select.mockReset();
  store.setParticipantMuted.mockReset();
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
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByText('System Audio (All Applications)'));

    expect(store.select).toHaveBeenCalledWith(SYSTEM);
    expect(store.setParticipantMuted).toHaveBeenCalledWith(false);
  });

  it('is not expandable when there is nothing to pick', () => {
    store.sources = [SYSTEM];
    store.selected = SYSTEM;
    mount();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
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

  it('keeps the swap live during a run: it is read live everywhere', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth(true);
    const swap = screen.getByRole('button', { name: /Swap left and right/ });
    expect(swap).toBeEnabled();
    fireEvent.click(swap);
    expect(store.setOutletChannel).toHaveBeenCalledWith('other', 'left');
    expect(store.setOutletChannel).toHaveBeenCalledWith('them', 'right');
  });

  // Board 1's order: the microphone, the choice under its own heading, then the row the choice decides.
  const order = () => Array.from(document.querySelectorAll('.mode-device-popover__row .mode-device-popover__row-label, [role="radiogroup"], .mode-device-popover__ears'))
    .map((el) => (el.getAttribute('role') === 'radiogroup' ? 'choice' : el.classList.contains('mode-device-popover__ears') ? 'ears' : el.textContent));

  it('in a meeting: the microphone, the choice, then the system-audio row', () => {
    mountBoth();
    expect(order()).toEqual(['Microphone', 'choice', "Other's audio"]);
  });

  it('beside me: the microphone, the choice, the output, then the ears', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    expect(order()).toEqual(['Microphone', 'choice', 'Output', 'ears']);
  });

  it('labels the choice by its visible heading, not by a second copy of the words', () => {
    mountBoth();
    const group = screen.getByRole('radiogroup', { name: 'Other side' });
    expect(group.hasAttribute('aria-label')).toBe(false);
    const heading = document.getElementById(group.getAttribute('aria-labelledby')!);
    expect(heading?.textContent).toBe('Other side');
    expect(heading?.closest('[role="radiogroup"]')).toBeNull();
  });

  it('beside me: the headphones row has no switch, but keeps its column so the summary lines up with the microphone row', () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    const rows = Array.from(document.querySelectorAll('.mode-device-popover__row'));
    const phones = rows.find((r) => r.textContent?.includes('Output'))!;
    expect(phones.querySelector('.mode-device-popover__mute-btn')).toBeNull();
    const slot = phones.querySelector('.mode-device-popover__mute-slot');
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    expect(slot).toBe(phones.lastElementChild);
    // The microphone row keeps its real switch, and no placeholder.
    const mic = rows.find((r) => r.textContent?.includes('Microphone'))!;
    expect(mic.querySelector('.mode-device-popover__mute-btn')).not.toBeNull();
    expect(mic.querySelector('.mode-device-popover__mute-slot')).toBeNull();
  });

  it('hides the choice under a provider without face-to-face', () => {
    f2f.offered = false;
    mountBoth();
    expect(screen.queryByRole('radio', { name: /Beside me/ })).toBeNull();
  });

  it('beside me: no system-audio row, a headphones row, the two ears with previews and the swap', async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    expect(screen.queryByText("Other's audio")).toBeNull();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('Left ear')).toBeInTheDocument();
    expect(screen.getByText('Right ear')).toBeInTheDocument();
    // The left ear's preview plays the chime panned left.
    fireEvent.click(screen.getAllByRole('button', { name: /Preview the/ })[0]);
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('them'));
    fireEvent.click(screen.getByRole('button', { name: /Swap left and right/ }));
    expect(store.setOutletChannel).toHaveBeenCalledWith('other', 'left');
  });

  it('the right ear previews panned right', async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Preview the right ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('other'));
  });

  it('swapped: the left ear is the other person, the right is me, and the swap button turns it back', async () => {
    f2f.active = true;
    f2f.swap = true;
    f2f.ears = { speaker: 'left', participant: 'right' };
    store.otherSide = 'beside';
    mountBoth();
    const ears = Array.from(document.querySelectorAll('.ears-block__ear'));
    expect(ears[0].className).toContain('--other');
    expect(ears[1].className).toContain('--me');
    fireEvent.click(screen.getByRole('button', { name: 'Preview the right ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith('them'));
    fireEvent.click(screen.getByRole('button', { name: /Swap left and right/ }));
    expect(store.setOutletChannel).toHaveBeenCalledWith('other', 'right');
    expect(store.setOutletChannel).toHaveBeenCalledWith('them', 'left');
  });

  // Kizuna Soniox today: the participant's leg is silent, so my ear (where their translation would play) plays nothing.
  it("a silent participant leg: my ear has no preview and reads Off; the other person's ear keeps its preview", () => {
    f2f.active = true;
    f2f.speaks = { speaker: true, participant: false };
    store.otherSide = 'beside';
    mountBoth();
    const [left, right] = Array.from(document.querySelectorAll('.ears-block__ear'));
    expect(left.className).toContain('--me');
    expect(left.querySelector('.ears-block__ear-preview')).toBeNull();
    expect(left.querySelector('.ears-block__ear-off')?.textContent).toBe('Off');
    expect(screen.queryByRole('button', { name: 'Preview the left ear' })).toBeNull();
    expect(right.querySelector('.ears-block__ear-off')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview the right ear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Swap left and right/ })).toBeInTheDocument();
  });

  it('Text Only: no ears block, no previews and no swap: nothing plays in either ear', () => {
    f2f.active = true;
    f2f.speaks = { speaker: false, participant: false };
    store.otherSide = 'beside';
    mountBoth();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(document.querySelector('.mode-device-popover__ears')).toBeNull();
    expect(screen.queryByRole('button', { name: /Preview the/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Swap left and right/ })).toBeNull();
  });

  it("records a preview that did not play, as the panel's test tone does", async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    tone.mockRejectedValue(new Error('no output device'));
    mountBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Preview the left ear' }));
    await vi.waitFor(() => expect(report.error).toHaveBeenCalledTimes(1));
    const [source, message, options] = report.error.mock.calls[0];
    expect(source).toBe('EarsBlock');
    expect(message).toContain('no output device');
    expect(options?.cause).toBeInstanceOf(Error);
  });
});

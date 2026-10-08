/**
 * Participant row of the mode/device popover (issue #335).
 *
 * The row used to be device-less and showed a fixed "All system audio"
 * subtitle. Once participant capture can be scoped to one application that
 * subtitle becomes a lie, so the row gains a real picker when - and only when -
 * a per-application helper actually reported sources.
 */
import React from 'react';
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
  useParticipantSources: () => store.sources,
  useSelectedParticipantSource: () => store.selected,
  useSelectParticipantSource: () => store.select,
  useOtherSide: () => store.otherSide,
  useSetOtherSide: () => store.setOtherSide,
}));

const f2f = { offered: true, active: false, swap: false, me: 'ja', other: 'en' };
vi.mock('./useFaceToFace', () => ({ useFaceToFace: () => f2f }));
const routing = { setFaceToFaceSwap: vi.fn() };
vi.mock('../../stores/routingStore', () => ({ useRoutingStore: (pick: (s: unknown) => unknown) => pick({ faceToFaceSwap: f2f.swap, setFaceToFaceSwap: routing.setFaceToFaceSwap }) }));
const tone = vi.fn(async () => {});
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ testTone: tone }) }));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => code.toUpperCase() }));

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
const CHROMIUM = { deviceId: 'app:pid:205', label: 'Chromium' };

beforeEach(() => {
  env.extension = false;
  store.sources = [SYSTEM, CHROMIUM];
  store.selected = CHROMIUM;
  store.otherSide = 'meeting';
  Object.assign(f2f, { offered: true, active: false, swap: false, me: 'ja', other: 'en' });
  tone.mockClear();
  routing.setFaceToFaceSwap.mockClear();
  store.setOtherSide.mockReset();
  store.select.mockReset();
  store.setParticipantMuted.mockReset();
});

// The popover renders against an anchor element; a detached div is enough.
const mount = () => {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  return render(
    <ModeDevicePopover mode="participant" open={true} anchorEl={anchor} onClose={vi.fn()} />
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
  const mountBoth = () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    return render(<ModeDevicePopover mode="both" open={true} anchorEl={anchor} onClose={vi.fn()} />);
  };

  it('offers "In a meeting" and "Beside me" and stores the choice', () => {
    mountBoth();
    fireEvent.click(screen.getByRole('radio', { name: /Beside me/ }));
    expect(store.setOtherSide).toHaveBeenCalledWith('beside');
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
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    expect(screen.getByText('Left ear')).toBeInTheDocument();
    expect(screen.getByText('Right ear')).toBeInTheDocument();
    // The left ear's preview plays the tone panned left.
    fireEvent.click(screen.getAllByRole('button', { name: /Preview the/ })[0]);
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith(undefined, -1));
    fireEvent.click(screen.getByRole('button', { name: /Swap left and right/ }));
    expect(routing.setFaceToFaceSwap).toHaveBeenCalledWith(true);
  });

  it('the right ear previews panned right', async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Preview the right ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith(undefined, 1));
  });

  it('swapped: the left ear is the other person, the right is me, and the swap button turns it back', async () => {
    f2f.active = true;
    f2f.swap = true;
    store.otherSide = 'beside';
    mountBoth();
    const ears = Array.from(document.querySelectorAll('.mode-device-popover__ear'));
    expect(ears[0].className).toContain('--other');
    expect(ears[1].className).toContain('--me');
    fireEvent.click(screen.getByRole('button', { name: 'Preview the right ear' }));
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith(undefined, 1));
    fireEvent.click(screen.getByRole('button', { name: /Swap left and right/ }));
    expect(routing.setFaceToFaceSwap).toHaveBeenCalledWith(false);
  });
});

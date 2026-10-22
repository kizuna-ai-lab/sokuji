import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../locales/en/translation.json';
import type { CaptureSourceInfo } from '../../lib/screen/desktopFrames';
import { SourcePicker, type SourcePickerProps } from './SourcePicker';

// The real English catalog, so every assertion below is the copy a user reads, looked up by its key.
beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    showSupportNotice: false,
  });
});

afterEach(() => {
  cleanup();
});

const SLIDES: CaptureSourceInfo = { id: 'window:1', name: 'Slides', kind: 'window', thumbnail: 'data:image/png;base64,AAAA', appIcon: 'data:image/png;base64,BBBB' };
const DESKTOP: CaptureSourceInfo = { id: 'screen:0', name: 'Entire screen', kind: 'screen', thumbnail: 'data:image/png;base64,CCCC', appIcon: null };
const NOTES: CaptureSourceInfo = { id: 'window:2', name: 'Notes', kind: 'window', thumbnail: 'data:image/png;base64,DDDD', appIcon: null };

const props = (over: Partial<SourcePickerProps> = {}): SourcePickerProps => ({
  open: true,
  mode: 'list',
  screenRecording: 'granted',
  // Listed out of order: the picker groups them itself.
  sources: [SLIDES, DESKTOP, NOTES],
  purpose: 'start',
  onPick: vi.fn(),
  onPortal: vi.fn(),
  onCancel: vi.fn(),
  onOpenPrivacy: vi.fn(),
  onReask: vi.fn(),
  onRestart: vi.fn(),
  onRefresh: vi.fn(),
  ...over,
});

const dialog = () => screen.getByRole('dialog', { name: 'Choose what the model can see' });
const sourceButtons = () => within(dialog()).queryAllByRole('button', { name: /^(Slides|Notes|Entire screen)$/ });

describe('SourcePicker', () => {
  it('shows the privacy line and lists windows before screens, picking one', () => {
    const p = props();
    render(<SourcePicker {...p} />);
    expect(dialog().textContent).toContain(
      "Everything inside the area you choose is sent to Alibaba Cloud's Qwen service, in the region of this session, as pictures — nothing else on your screen. Kizuna AI does not receive them.",
    );
    expect(sourceButtons().map((b) => b.getAttribute('aria-label'))).toEqual(['Slides', 'Notes', 'Entire screen']);
    expect(within(screen.getByRole('group', { name: 'Windows' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Slides', 'Notes']);
    expect(within(screen.getByRole('group', { name: 'Screens' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Entire screen']);
    // Each choice shows its picture.
    expect(within(sourceButtons()[0]).getByRole('img', { name: 'Slides' })).toHaveAttribute('src', SLIDES.thumbnail);

    fireEvent.click(sourceButtons()[0]);
    expect(p.onPick).toHaveBeenCalledWith(SLIDES);
  });

  it('offers Refresh under the list to look again, off while the list loads, and not where there is no list', () => {
    const p = props();
    const { rerender } = render(<SourcePicker {...p} />);
    const refresh = () => within(dialog()).queryByRole('button', { name: 'Refresh' });
    expect(refresh()).not.toBeNull();
    fireEvent.click(refresh()!);
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
    rerender(<SourcePicker {...props({ sources: null })} />);
    expect(refresh()).toBeDisabled();
    // While the desktop answers a refresh the list stays as it was; the button is off and its icon turns.
    rerender(<SourcePicker {...props({ refreshing: true })} />);
    expect(refresh()).toBeDisabled();
    expect(refresh()!.querySelector('.source-picker__spinner')).not.toBeNull();
    expect(sourceButtons()).toHaveLength(3);
    // No desktop shares a minimized window (X11 and macOS leave it out, Windows lists it but captures it black): the
    // list says so in words true on all three, not "aren't listed", which Windows contradicts.
    expect(dialog().textContent).toContain("A minimized window can't be shared: restore it, then Refresh.");
    expect(dialog().textContent).not.toContain("aren't listed");
    rerender(<SourcePicker {...props({ mode: 'portal', sources: [] })} />);
    expect(refresh()).toBeNull();
    expect(dialog().textContent).not.toContain('minimized window');
    rerender(<SourcePicker {...props({ checking: true })} />);
    expect(refresh()).toBeNull();
    rerender(<SourcePicker {...props({ screenRecording: 'denied', sources: [] })} />);
    expect(refresh()).toBeNull();
  });

  it('on a denied macOS offers to ask macOS again and the settings, and no list; once asked, the restart a new grant needs', () => {
    const p = props({ screenRecording: 'denied' });
    const { rerender } = render(<SourcePicker {...p} />);
    expect(dialog().textContent).toContain('Screen Recording permission needed');
    // Switched on in System Settings for an older version reads denied too, and the words say so.
    expect(dialog().textContent).toContain('given to an older version');
    expect(screen.queryAllByRole('img')).toEqual([]);
    expect(sourceButtons()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Restart Sokuji' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask macOS again' }));
    expect(p.onReask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    expect(p.onOpenPrivacy).toHaveBeenCalledTimes(1);

    // Asked: macOS applies a new grant only after a restart, so Restart Sokuji takes Ask macOS again's place.
    rerender(<SourcePicker {...p} asked />);
    expect(dialog().textContent).toContain('only after Sokuji restarts');
    expect(screen.queryByRole('button', { name: 'Ask macOS again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restart Sokuji' }));
    expect(p.onRestart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Open System Settings' })).toBeTruthy();
  });

  it('Ask macOS again is off while an ask is out, and Restart Sokuji once the restart is asked for', () => {
    const { rerender } = render(<SourcePicker {...props({ screenRecording: 'denied', reasking: true })} />);
    expect(screen.getByRole('button', { name: 'Ask macOS again' })).toBeDisabled();
    rerender(<SourcePicker {...props({ screenRecording: 'denied', asked: true, restarting: true })} />);
    expect(screen.getByRole('button', { name: 'Restart Sokuji' })).toBeDisabled();
    rerender(<SourcePicker {...props({ screenRecording: 'denied', asked: true })} />);
    expect(screen.getByRole('button', { name: 'Restart Sokuji' })).not.toBeDisabled();
  });

  it('in portal mode shows one button that asks the desktop to choose', () => {
    const p = props({ mode: 'portal', sources: [] });
    render(<SourcePicker {...p} />);
    expect(dialog().textContent).toContain('Alibaba Cloud');
    expect(sourceButtons()).toEqual([]);
    const choose = screen.getAllByRole('button', { name: 'Choose a window or screen…' });
    expect(choose).toHaveLength(1);
    fireEvent.click(choose[0]);
    expect(p.onPortal).toHaveBeenCalledTimes(1);
  });

  it('says why it is back when the last pick showed nothing', () => {
    const line = 'The area you chose shows nothing right now. Pick another, or start without screen context.';
    const { rerender } = render(<SourcePicker {...props()} />);
    expect(dialog().textContent).not.toContain(line);
    rerender(<SourcePicker {...props({ reason: 'nothingVisible' })} />);
    expect(dialog().textContent).toContain(line);
  });

  it('back during a run (Choose again) says the session stays as it is, never to start without', () => {
    render(<SourcePicker {...props({ reason: 'nothingVisible', purpose: 'choose-again' })} />);
    expect(dialog().textContent).toContain('The area you chose shows nothing right now. Pick another, or keep the session as it is.');
    expect(dialog().textContent).not.toContain('start without screen context');
  });

  it('says the window chosen before is gone when Start could not open it', () => {
    const line = "The window or screen you chose can't be captured right now. Pick another, or start without screen context.";
    const { rerender } = render(<SourcePicker {...props()} />);
    expect(dialog().textContent).not.toContain(line);
    rerender(<SourcePicker {...props({ reason: 'gone' })} />);
    expect(dialog().textContent).toContain(line);
    expect(dialog().textContent).not.toContain('shows nothing right now');
    expect(screen.getByRole('button', { name: 'Start without screen context' })).toBeInTheDocument();
  });

  it('cancel starts without screen context', () => {
    const p = props();
    render(<SourcePicker {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start without screen context' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('says so while the list loads, and when nothing was found', () => {
    const { rerender } = render(<SourcePicker {...props({ sources: null })} />);
    expect(dialog().textContent).toContain('Looking for windows…');
    expect(sourceButtons()).toEqual([]);
    rerender(<SourcePicker {...props({ sources: [] })} />);
    expect(dialog().textContent).toContain('No window or screen to share was found.');
  });

  it('while the pick is checked offers nothing to choose, and Cancel is off', () => {
    const p = props({ checking: true });
    render(<SourcePicker {...p} />);
    expect(dialog().textContent).toContain('Checking the picture…');
    expect(sourceButtons()).toEqual([]);
    const cancel = screen.getByRole('button', { name: 'Start without screen context' });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(p.onCancel).not.toHaveBeenCalled();
  });

  it('opened during a run, Cancel keeps what is shared', () => {
    const p = props({ purpose: 'choose-again' });
    render(<SourcePicker {...p} />);
    expect(screen.queryByRole('button', { name: 'Start without screen context' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('opened from the settings, Cancel says Cancel: there is no start to go without', () => {
    const p = props({ purpose: 'settings' });
    render(<SourcePicker {...p} />);
    expect(screen.queryByRole('button', { name: 'Start without screen context' })).toBeNull();
    expect(dialog().textContent).not.toContain('start without screen context');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it("at Start a click beside the modal does not dismiss it: only its X and Start without do (both turn the switch off)", () => {
    const p = props();
    render(<SourcePicker {...p} />);
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(p.onCancel).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(document.querySelector('.modal-header .close-button')!);
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('from the settings or Choose again, a click beside the modal is a Cancel', () => {
    for (const purpose of ['settings', 'choose-again'] as const) {
      const p = props({ purpose });
      const { unmount } = render(<SourcePicker {...p} />);
      fireEvent.click(document.querySelector('.modal-overlay')!);
      expect(p.onCancel).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('draws nothing while closed', () => {
    render(<SourcePicker {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

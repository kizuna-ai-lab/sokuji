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
  onPick: vi.fn(),
  onPortal: vi.fn(),
  onCancel: vi.fn(),
  onOpenPrivacy: vi.fn(),
  ...over,
});

const dialog = () => screen.getByRole('dialog', { name: 'Choose what Qwen may see' });
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

  it('on a denied macOS shows the settings button and no list', () => {
    const p = props({ screenRecording: 'denied' });
    render(<SourcePicker {...p} />);
    expect(dialog().textContent).toContain('Screen Recording permission needed');
    expect(dialog().textContent).toContain('then restart Sokuji and start again');
    expect(screen.queryAllByRole('img')).toEqual([]);
    expect(sourceButtons()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    expect(p.onOpenPrivacy).toHaveBeenCalledTimes(1);
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
    render(<SourcePicker {...props({ reason: 'nothingVisible', running: true })} />);
    expect(dialog().textContent).toContain('The area you chose shows nothing right now. Pick another, or keep the session as it is.');
    expect(dialog().textContent).not.toContain('start without screen context');
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
    const p = props({ running: true });
    render(<SourcePicker {...p} />);
    expect(screen.queryByRole('button', { name: 'Start without screen context' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('draws nothing while closed', () => {
    render(<SourcePicker {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

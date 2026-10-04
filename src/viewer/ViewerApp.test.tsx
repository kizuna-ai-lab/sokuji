// src/viewer/ViewerApp.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ViewerModel } from './model';
import type { ViewerEntry } from '../lib/share/types';

const model = vi.hoisted(() => ({ current: null as unknown as ViewerModel }));
vi.mock('./useViewerStream', () => ({ useViewerStream: () => model.current }));
vi.mock('./keepAwake', () => ({ keepAwake: vi.fn(async () => true) }));
vi.mock('../utils/conversationExport', async (orig) => ({ ...(await orig<typeof import('../utils/conversationExport')>()), downloadFile: vi.fn() }));
import { downloadFile } from '../utils/conversationExport';
import { keepAwake } from './keepAwake';
import ViewerApp from './ViewerApp';

const entry = (id: string, leg: 'speaker' | 'participant', src: string, tr: string, t = 1): ViewerEntry => ({
  id, leg, t, languages: leg === 'speaker' ? { source: 'ja', target: 'zh-CN' } : { source: 'zh-CN', target: 'ja' },
  source: [{ key: `${id}:1:0`, text: src, final: true }], translation: [{ key: `${id}:2:0`, text: tr, final: true }],
});
const live = (over: Partial<ViewerModel> = {}): ViewerModel => ({
  connection: 'open',
  state: { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false },
  entries: [entry('a', 'speaker', '今日は', '今天')],
  notice: null,
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  model.current = live();
});
afterEach(cleanup);

const enter = () => fireEvent.click(screen.getByRole('button', { name: 'Start reading' }));

describe('ViewerApp', () => {
  it('enters with source, both and target to choose from, in that order', () => {
    render(<ViewerApp />);
    const options = [...document.querySelectorAll('.viewer-option')];
    expect(options.map((b) => b.textContent)).toEqual(['Japanese', expect.stringContaining('Both languages'), 'Chinese (China)']);
    enter();
    expect(screen.getByText('今天')).toBeTruthy();
  });

  // His ruling 2026-10-04: the phone's bottom dock repeated the settings sheet
  // twice ("View" and "More") and took two or three lines of captions; one
  // button in the status line opens the sheet instead.
  it('opens the display settings from the status line on a phone, with no bottom dock', () => {
    render(<ViewerApp />);
    enter();
    expect(document.querySelector('.viewer-dock')).toBeNull();
    const button = screen.getByRole('button', { name: 'Display' });
    expect(button.closest('.viewer-statusline')).not.toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Display' })).toBeTruthy();
  });

  it('wears the chosen colour scheme on the entry screen too', () => {
    window.localStorage.setItem('sokuji.viewer.theme', JSON.stringify('light'));
    const { container } = render(<ViewerApp />);
    expect(container.querySelector('.viewer')?.classList.contains('viewer--light')).toBe(true);
  });

  it('shows no save action unless the host allows it', () => {
    render(<ViewerApp />);
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    expect(screen.queryByText('Save these captions')).toBeNull();
    cleanup();
    model.current = live({ state: { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: true } });
    render(<ViewerApp />);
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(downloadFile).toHaveBeenCalled();
  });

  // Who is speaking: a tag on the line where the side changes, once both sides
  // have spoken (his ruling 2026-10-04: stripe + tag at each change, no legend).
  it('tags the side at each change of speaker, only once both sides have spoken', () => {
    render(<ViewerApp />);
    enter();
    expect(screen.queryByText('On site')).toBeNull();
    cleanup();
    model.current = live({ entries: [
      entry('a', 'speaker', '今日は', '今天', 1), entry('b', 'speaker', 'では', '那么', 2),
      entry('c', 'participant', '谢谢', 'ありがとう', 3), entry('d', 'speaker', 'はい', '好', 4),
    ] });
    render(<ViewerApp />);
    enter();
    const tags = (text: string) => screen.getAllByText(text).map((el) => el.closest('.viewer-entry')?.getAttribute('data-id'));
    expect(tags('On site')).toEqual(['a', 'd']);
    expect(tags('Remote')).toEqual(['c']);
  });

  // His ruling 2026-10-04: tapping the selected "both" again swaps which
  // language leads; the button names the order it shows.
  it('swaps the order of both languages when the selected both is tapped again', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    render(<ViewerApp />);
    enter();
    const primary = () => document.querySelector('.viewer-entry__primary')?.textContent;
    expect(primary()).toContain('今天');
    fireEvent.click(screen.getByRole('button', { name: 'Chinese (China) ⇄ Japanese' }));
    expect(screen.getByRole('button', { name: 'Japanese ⇄ Chinese (China)' })).toBeTruthy();
    expect(primary()).toContain('今日は');
  });

  it('reads each side in the chosen language', () => {
    model.current = live({ entries: [entry('a', 'speaker', '今日は', '今天'), entry('b', 'participant', '谢谢', 'ありがとう', 2)] });
    render(<ViewerApp />);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Chinese (China)')!);
    enter();
    expect(screen.getByText('今天')).toBeTruthy();
    expect(screen.getByText('谢谢')).toBeTruthy();
    expect(screen.queryByText('ありがとう')).toBeNull();
  });

  it('names each state, and the reason the list emptied', () => {
    model.current = live({ connection: 'reconnecting' });
    const { rerender } = render(<ViewerApp />);
    enter();
    expect(screen.getAllByText('Reconnecting…').length).toBeGreaterThan(0);
    model.current = live({ entries: [], notice: 'restart' });
    rerender(<ViewerApp />);
    expect(screen.getByText('The speaker started a new round')).toBeTruthy();
    model.current = live({ connection: 'ended' });
    rerender(<ViewerApp />);
    expect(screen.getAllByText('Sharing has ended').length).toBeGreaterThan(0);
    expect(document.title).toContain('Sharing has ended');
  });

  it('falls back to both languages when the pair changes under the choice', () => {
    render(<ViewerApp />);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === 'Japanese')!);
    enter();
    expect(screen.queryByText('今天')).toBeNull();
    model.current = live({ state: { phase: 'live', pair: { source: 'ko', target: 'zh-CN' }, allowSave: false } });
    act(() => { fireEvent(window, new Event('resize')); });
    cleanup();
    render(<ViewerApp />);
    enter();
    expect(screen.getByText('今天')).toBeTruthy();
  });

  // A host whose provider has not loaded yet sends a pair of two blank codes:
  // that is no pair yet, not two languages without names.
  it('waits for a pair with two languages before offering a choice', () => {
    model.current = live({ state: { phase: 'live', pair: { source: '', target: '' }, allowSave: false } });
    render(<ViewerApp />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start reading' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Spec §5.6: the browser pauses the keep-awake video while the page is
  // hidden (another app, the lock screen); coming back must turn it on again,
  // or the screen sleeps mid-talk.
  it('turns keep-awake on again when the page comes back into view', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    render(<ViewerApp />);
    enter();
    vi.mocked(keepAwake).mockClear();
    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(keepAwake).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(keepAwake).toHaveBeenCalledWith(true);
    visibility.mockRestore();
  });

  it('leaves keep-awake off on return when the viewer turned it off', () => {
    window.localStorage.setItem('sokuji.viewer.keepAwake', 'false');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<ViewerApp />);
    enter();
    vi.mocked(keepAwake).mockClear();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(keepAwake).not.toHaveBeenCalled();
    visibility.mockRestore();
  });
});

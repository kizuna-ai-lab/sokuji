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

  it('shows no save action unless the host allows it', () => {
    render(<ViewerApp />);
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByText('Save these captions')).toBeNull();
    cleanup();
    model.current = live({ state: { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: true } });
    render(<ViewerApp />);
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(downloadFile).toHaveBeenCalled();
  });

  it('shows the legend only once both sides have spoken', () => {
    render(<ViewerApp />);
    enter();
    expect(screen.queryByText('On site')).toBeNull();
    cleanup();
    model.current = live({ entries: [entry('a', 'speaker', '今日は', '今天'), entry('b', 'participant', '谢谢', 'ありがとう', 2)] });
    render(<ViewerApp />);
    enter();
    expect(screen.getByText('On site')).toBeTruthy();
    expect(screen.getByText('Remote')).toBeTruthy();
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
});

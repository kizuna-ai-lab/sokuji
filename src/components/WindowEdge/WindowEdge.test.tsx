import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'sass';
import { WindowEdge } from './WindowEdge';
import { useSettingsStore } from '../../stores/settingsStore';

type State = { maximized: boolean; fullScreen: boolean };
const NORMAL: State = { maximized: false, fullScreen: false };

/** The desktop app on `platform`, whose main process answers `now` and lets the test push later states. */
function desktop(platform: string, now: State | null = NORMAL) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  vi.stubGlobal('electronAPI', {});
  let listener: ((s: State) => void) | null = null;
  const api = {
    invoke: vi.fn(async (channel: string) => (channel === 'window:get-state' ? now : undefined)),
    receive: vi.fn((channel: string, fn: (s: State) => void) => { if (channel === 'window:state') listener = fn; }),
    removeListener: vi.fn(),
  };
  vi.stubGlobal('electron', api);
  return { api, push: (s: State) => act(() => listener?.(s)), listener: () => listener };
}

/** The edge is portalled onto the body, above the overlays that portal there too. */
const edge = (_container: HTMLElement) => document.body.querySelector(':scope > .window-edge');

describe('WindowEdge: the line around the desktop window (no system frame draws one)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ subtitleModeActive: false });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws the edge around a window that is neither maximized nor full screen, hidden from screen readers', async () => {
    desktop('Linux x86_64');
    const { container } = render(<WindowEdge />);
    await act(async () => {});
    expect(edge(container)).not.toBeNull();
    expect(edge(container)!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws nothing while the window is maximized or full screen, and draws it again once restored', async () => {
    const { push } = desktop('Win32', { maximized: true, fullScreen: false });
    const { container } = render(<WindowEdge />);
    await act(async () => {});
    expect(edge(container)).toBeNull();
    push(NORMAL);
    expect(edge(container)).not.toBeNull();
    push({ maximized: false, fullScreen: true });
    expect(edge(container)).toBeNull();
    push(NORMAL);
    expect(edge(container)).not.toBeNull();
  });

  it('keeps a state pushed before the first answer arrives', async () => {
    let answer: (s: State) => void = () => {};
    const { api, push } = desktop('Linux x86_64');
    api.invoke.mockImplementation(() => new Promise((resolve) => { answer = resolve as (s: State) => void; }));
    const { container } = render(<WindowEdge />);
    push({ maximized: true, fullScreen: false });
    await act(async () => { answer(NORMAL); });
    expect(edge(container)).toBeNull();
  });

  it('draws nothing in subtitle mode', async () => {
    desktop('Linux x86_64');
    useSettingsStore.setState({ subtitleModeActive: true });
    const { container } = render(<WindowEdge />);
    await act(async () => {});
    expect(edge(container)).toBeNull();
  });

  it('draws nothing on macOS, whose system draws the window a shadow, and does not ask', async () => {
    const { api } = desktop('MacIntel');
    const { container } = render(<WindowEdge />);
    await act(async () => {});
    expect(edge(container)).toBeNull();
    expect(api.invoke).not.toHaveBeenCalled();
  });

  it('draws nothing outside the desktop app', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    const { container } = render(<WindowEdge />);
    await act(async () => {});
    expect(edge(container)).toBeNull();
  });

  it('stops listening when it goes away', async () => {
    const { api, listener } = desktop('Linux x86_64');
    const { unmount } = render(<WindowEdge />);
    await act(async () => {});
    const fn = listener();
    unmount();
    expect(api.removeListener).toHaveBeenCalledWith('window:state', fn);
  });

  it('is two 1px lines inside the window, above everything, letting every click through', () => {
    const css = compile(resolve(__dirname, 'WindowEdge.scss')).css;
    const rule = css.match(/\.window-edge\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).toMatch(/z-index:\s*2147483647/);
    expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--sk-window-edge\),\s*inset 0 0 0 2px var\(--sk-window-edge-inner\)/);
    expect(readFileSync(resolve(__dirname, 'WindowEdge.scss'), 'utf8')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

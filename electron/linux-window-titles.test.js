import { describe, it, expect, vi } from 'vitest';
import {
  listWindowTitles,
  titleForPid,
  parentPidOf,
  parseClientList,
  parseWindowPid,
  parseWindowName,
} from './linux-window-titles.js';

// Real xprop output shapes, captured on X11.
const CLIENT_LIST = '_NET_CLIENT_LIST(WINDOW): window id # 0x439a404, 0x42ed744, 0x4a00054\n';

describe('xprop parsing', () => {
  it('extracts window ids from _NET_CLIENT_LIST', () => {
    expect(parseClientList(CLIENT_LIST)).toEqual(['0x439a404', '0x42ed744', '0x4a00054']);
  });

  it('returns no ids when the property is absent', () => {
    expect(parseClientList('_NET_CLIENT_LIST: not found.')).toEqual([]);
  });

  it('extracts the pid', () => {
    expect(parseWindowPid('_NET_WM_PID(CARDINAL) = 2708760')).toBe(2708760);
    expect(parseWindowPid('_NET_WM_PID: not found.')).toBeNull();
  });

  it('extracts the title, including quotes and non-ASCII', () => {
    expect(parseWindowName('_NET_WM_NAME(UTF8_STRING) = "(6) 物理教授 - YouTube - Chromium"'))
      .toBe('(6) 物理教授 - YouTube - Chromium');
    expect(parseWindowName('_NET_WM_NAME: not found.')).toBeNull();
  });
});

describe('parentPidOf', () => {
  // /proc/<pid>/stat: "PID (comm) STATE PPID ..." - comm is parenthesised and
  // may itself contain spaces or parens, so naive splitting breaks.
  it('reads the ppid', () => {
    const readFileSync = () => '2709347 (chrome) S 2708760 2708760 0 0 -1 4194304';
    expect(parentPidOf(2709347, { readFileSync })).toBe(2708760);
  });

  it('survives a comm containing spaces and parens', () => {
    const readFileSync = () => '42 (weird (name) here) S 7 7 0 0';
    expect(parentPidOf(42, { readFileSync })).toBe(7);
  });

  it('returns null when the process is gone', () => {
    const readFileSync = () => { throw new Error('ENOENT'); };
    expect(parentPidOf(1234, { readFileSync })).toBeNull();
  });
});

describe('titleForPid', () => {
  const titles = new Map([[2708760, 'YouTube - Chromium']]);

  it('finds the title on the process itself', () => {
    expect(titleForPid(2708760, titles, { readFileSync: () => '' })).toBe('YouTube - Chromium');
  });

  it('walks up to the parent that owns the window', () => {
    // The PipeWire stream belongs to Chromium's audio service child, while the
    // window belongs to the browser process one hop up.
    const readFileSync = (path) =>
      path.includes('2709347') ? '2709347 (chrome) S 2708760 x' : '2708760 (chrome) S 1 x';
    expect(titleForPid(2709347, titles, { readFileSync })).toBe('YouTube - Chromium');
  });

  it('returns null when no ancestor owns a window', () => {
    const readFileSync = () => '99 (paplay) S 1 x';
    expect(titleForPid(99, titles, { readFileSync })).toBeNull();
  });

  it('stops rather than looping forever on a cyclic chain', () => {
    // A self-parenting pid would spin without the hop cap.
    const readFileSync = () => '5 (x) S 5 x';
    expect(titleForPid(5, new Map(), { readFileSync })).toBeNull();
  });
});

describe('listWindowTitles', () => {
  const run = vi.fn(async (_cmd, args) => {
    if (args.includes('_NET_CLIENT_LIST')) return { stdout: CLIENT_LIST };
    const id = args[args.indexOf('-id') + 1];
    if (args.includes('_NET_WM_PID')) {
      return { stdout: `_NET_WM_PID(CARDINAL) = ${id === '0x439a404' ? 111 : 222}` };
    }
    return { stdout: `_NET_WM_NAME(UTF8_STRING) = "win ${id}"` };
  });

  it('builds a pid -> title map', async () => {
    const titles = await listWindowTitles({ run, display: ':1' });
    expect(titles.get(111)).toBe('win 0x439a404');
    expect(titles.get(222)).toBe('win 0x42ed744'); // first window of the pid wins
  });

  it('returns an empty map with no DISPLAY (Wayland or headless)', async () => {
    // An explicit empty display must not fall through to the real environment.
    expect((await listWindowTitles({ run, display: '' })).size).toBe(0);
    expect((await listWindowTitles({ run, display: null })).size).toBe(0);
  });

  it('returns an empty map when xprop is missing', async () => {
    const failing = async () => { throw new Error('ENOENT'); };
    expect((await listWindowTitles({ run: failing, display: ':1' })).size).toBe(0);
  });

  it('skips a window that vanishes mid-enumeration', async () => {
    const flaky = vi.fn(async (_cmd, args) => {
      if (args.includes('_NET_CLIENT_LIST')) return { stdout: CLIENT_LIST };
      throw new Error('BadWindow');
    });
    expect((await listWindowTitles({ run: flaky, display: ':1' })).size).toBe(0);
  });
});

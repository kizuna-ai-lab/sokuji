// In the browser extension a long word list (hundreds of rows) is saved whole and is still there after
// the extension reloads; chrome.storage.sync's 8 KB an item would have refused it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsService } from '../../services/SettingsService';

const current = vi.hoisted(() => ({ service: null as unknown }));
vi.mock('../../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: () => current.service } }));

import { BACKGROUND_KEY, WORDS_KEY, useWordList, type WordEntry } from './list';

const QUOTA_BYTES_PER_ITEM = 8192;
type Area = Record<string, unknown>;

/** chrome.storage as the extension sees it: sync refuses an item over 8 KB (key + JSON value), local takes it. */
function fakeChrome() {
  const areas: Record<'sync' | 'local', Area> = { sync: {}, local: {} };
  const runtime: { lastError: { message: string } | undefined } = { lastError: undefined };
  const area = (name: 'sync' | 'local') => ({
    set(items: Area, cb: () => void) {
      const tooBig = name === 'sync' && Object.entries(items).some(([k, v]) => k.length + JSON.stringify(v).length > QUOTA_BYTES_PER_ITEM);
      if (tooBig) runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
      else Object.assign(areas[name], structuredClone(items));
      cb();
      runtime.lastError = undefined;
    },
    get(key: string, cb: (r: Area) => void) { cb(key in areas[name] ? { [key]: structuredClone(areas[name][key]) } : {}); },
  });
  (globalThis as Record<string, unknown>).chrome = { storage: { sync: area('sync'), local: area('local') }, runtime };
  return areas;
}

const LONG: WordEntry[] = Array.from({ length: 600 }, (_, i) => ({
  written: `Product name ${i}`, translation: `製品名 ${i}`, heardAs: `product nam ${i}, prodact name ${i}`,
}));

beforeEach(() => { useWordList.setState({ entries: [], background: '', loaded: false }); });
afterEach(() => { delete (globalThis as Record<string, unknown>).chrome; });

describe('long word list still saves in the extension', () => {
  it('saves several hundred rows whole in chrome.storage.local and reads every one back after a reload', async () => {
    const areas = fakeChrome();
    current.service = new SettingsService();
    expect(JSON.stringify({ version: 1, entries: LONG }).length).toBeGreaterThan(QUOTA_BYTES_PER_ITEM * 5);
    expect(await useWordList.getState().setEntries(LONG)).toBe(true);
    expect(await useWordList.getState().setBackground('Agenda. '.repeat(2000))).toBe(true);
    expect(Object.keys(areas.local).sort()).toEqual([BACKGROUND_KEY, WORDS_KEY].sort());
    expect(areas.sync).toEqual({});

    // Reload: a new page, a new settings service, the store empty until it loads.
    useWordList.setState({ entries: [], background: '', loaded: false });
    current.service = new SettingsService();
    await useWordList.getState().load();
    expect(useWordList.getState().entries).toHaveLength(600);
    expect(useWordList.getState().entries).toEqual(LONG);
    expect(useWordList.getState().background).toBe('Agenda. '.repeat(2000));
  });
});

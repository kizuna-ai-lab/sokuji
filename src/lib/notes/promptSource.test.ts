// The notes prompts an own key uses: the newest of the built-in copy and the last good answer of the backend.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getApiUrl } from '../../utils/environment';
import {
  activePrompts, BUILT_IN_PROMPTS, loadStoredPrompts, PROMPTS_SETTING, readPromptSets, refreshPrompts, resetPromptSource,
} from './promptSource';
import { finishPrompt, livePrompt, namesPrompt, partPrompt } from './prompts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const notesAt = (version: number, mark = 'v') => ({
  version,
  prompts: {
    'whole-meeting': `${mark}${version} whole in __LANGUAGE__`,
    'meeting-part': `${mark}${version} part in __LANGUAGE__`,
    'combine-parts': `${mark}${version} combine in __LANGUAGE__`,
    'check-names': `${mark}${version} names`,
  },
});
const liveAt = (version: number) => ({ version, prompts: { 'live-update': `v${version} live in __LANGUAGE__` } });

beforeEach(() => resetPromptSource());

describe('the notes prompts', () => {
  it('are the built-in copy, at the built-in versions, until the backend answers', () => {
    expect(activePrompts()).toEqual(BUILT_IN_PROMPTS);
    expect(BUILT_IN_PROMPTS.notes.version).toBe(2);
    expect(BUILT_IN_PROMPTS.live.version).toBe(2);
    // The built-in copy is itself a valid answer: the same checks hold for it.
    expect(readPromptSets(BUILT_IN_PROMPTS)).toEqual(BUILT_IN_PROMPTS);
  });

  it('stay the built-in copy when the backend cannot be read, and nothing is stored', async () => {
    const save = vi.fn(async () => true);
    await refreshPrompts({ fetch: vi.fn(async () => { throw new TypeError('offline'); }), save });
    await refreshPrompts({ fetch: vi.fn(async () => json({}, 503)), save });
    expect(activePrompts()).toEqual(BUILT_IN_PROMPTS);
    expect(save).not.toHaveBeenCalled();
  });

  it('keep the built-in copy over an older stored answer', async () => {
    await loadStoredPrompts({ read: async () => ({ notes: notesAt(1), live: liveAt(1) }) });
    expect(activePrompts()).toEqual(BUILT_IN_PROMPTS);
  });

  it('use a newer answer, family by family, and store it as the last good one', async () => {
    const save = vi.fn(async (_key: string, _value: unknown) => true);
    const fetch = vi.fn(async () => json({ notes: notesAt(3), live: BUILT_IN_PROMPTS.live }));
    await refreshPrompts({ fetch, save });
    expect(fetch).toHaveBeenCalledWith(`${getApiUrl()}/notes/prompts`, expect.anything());
    expect(activePrompts()).toEqual({ notes: notesAt(3), live: BUILT_IN_PROMPTS.live });
    expect(save).toHaveBeenCalledWith(PROMPTS_SETTING, { notes: notesAt(3), live: BUILT_IN_PROMPTS.live });
    // The next launch starts from what was stored.
    resetPromptSource();
    await loadStoredPrompts({ read: async () => save.mock.calls[0][1] });
    expect(activePrompts().notes).toEqual(notesAt(3));
  });

  it('keep the last good answer when a later one is broken, and refuse a prompt that lost its language mark', async () => {
    const save = vi.fn(async () => true);
    await refreshPrompts({ fetch: vi.fn(async () => json({ notes: notesAt(3), live: liveAt(3) })), save });
    const broken = notesAt(4);
    delete (broken.prompts as Record<string, string>)['check-names'];
    const unmarked = { ...liveAt(4), prompts: { 'live-update': 'v4 live, no language' } };
    await refreshPrompts({ fetch: vi.fn(async () => json({ notes: broken, live: unmarked })), save });
    expect(activePrompts()).toEqual({ notes: notesAt(3), live: liveAt(3) });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keep a newer stored family when an older answer comes (a cached one): the server never takes a version back', async () => {
    const save = vi.fn(async (_key: string, _value: unknown) => true);
    await refreshPrompts({ fetch: vi.fn(async () => json({ notes: notesAt(4), live: liveAt(4) })), save });
    await refreshPrompts({ fetch: vi.fn(async () => json({ notes: notesAt(3), live: liveAt(5) })), save });
    expect(activePrompts()).toEqual({ notes: notesAt(4), live: liveAt(5) });
    expect(save).toHaveBeenLastCalledWith(PROMPTS_SETTING, { notes: notesAt(4), live: liveAt(5) });
  });

  it('are what the prompt builders write, in the language asked for', async () => {
    await refreshPrompts({ fetch: vi.fn(async () => json({ notes: notesAt(3), live: liveAt(3) })), save: async () => true });
    expect(partPrompt('Japanese', false)).toBe('v3 whole in Japanese');
    expect(partPrompt('Japanese', true)).toBe('v3 part in Japanese');
    expect(finishPrompt('Japanese')).toBe('v3 combine in Japanese');
    expect(namesPrompt()).toBe('v3 names');
    expect(livePrompt('Japanese')).toBe('v3 live in Japanese');
  });
});

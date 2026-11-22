// The Notes card's readiness (text models, part C): the provider's own check, asked about the notes alone, kept apart
// from the run's readiness. The check here is a stand-in: nothing reaches a service.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import type { AnyProvider, AuthContext, CheckResult } from '../../lib/provider/types';
import { TEXT_MODEL_DEFAULTS } from '../../lib/textModel/unit';
import { openaiCompatibleProvider } from '../../providers/openai_compatible/provider';
import { openaiTextProvider } from '../../providers/openai_text/provider';
import { useProviderStore } from '../../stores/providerStore';
import { checkNotes, fingerprint, NOTES_CHECK_DELAY_MS, useNotesAnswers, useNotesReadiness } from './notesReadiness';

/** Not a key of any service. */
const KEY = 'test-key-0000';
const AUTH: AuthContext = { signedIn: false, getToken: async () => null };
const PAIR = { source: 'en', target: 'ja' };

function provider(answer: () => CheckResult | Promise<CheckResult>) {
  const check = vi.fn(async () => answer());
  return { p: { ...openaiTextProvider, check } as unknown as AnyProvider, check };
}
const keyed = (settings: Record<string, unknown> = {}) => useProviderStore.setState({
  entries: { openai_text: { settings: { ...TEXT_MODEL_DEFAULTS, ...settings }, credentials: { apiKey: KEY }, pair: PAIR } },
  readiness: {},
} as never);

function Shown({ p, locked = false }: { p: AnyProvider; locked?: boolean }) {
  const r = useNotesReadiness(p, AUTH, locked);
  return <span data-testid="state">{r.state === 'not-ready' ? `not-ready:${r.code ?? ''}` : r.state}</span>;
}
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  useNotesAnswers.getState().reset();
  keyed();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the Notes card's readiness", () => {
  it("asks the provider's own check about the notes alone, and shows its answer", async () => {
    const { p, check } = provider(() => ({ ok: true, models: [{ id: 'gpt-6-luna' }] }));
    render(<Shown p={p} />);
    await waitFor(() => expect(state()).toBe('ready'));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({ apiKey: KEY }, expect.objectContaining({ notesReasoning: { level: 'medium', typed: '' } }), expect.objectContaining({ stages: [], notes: true, pair: PAIR }));
  });

  it("leaves the run's readiness alone: a refusal of the notes' model is the card's", async () => {
    const { p } = provider(() => ({ ok: false, code: 'model_missing', reason: 'The model `gpt-gone` does not exist.' }));
    render(<Shown p={p} />);
    await waitFor(() => expect(state()).toBe('not-ready:model_missing'));
    expect(useProviderStore.getState().readiness).toEqual({});
  });

  it('keeps an answer for the inputs it was asked with; one that could not reach the service is asked again', async () => {
    const ready = provider(() => ({ ok: true, models: [] }));
    const first = render(<Shown p={ready.p} />);
    await waitFor(() => expect(state()).toBe('ready'));
    first.unmount();
    render(<Shown p={ready.p} />);
    expect(state()).toBe('ready');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(ready.check).toHaveBeenCalledTimes(1);
    cleanup();
    useNotesAnswers.getState().reset();
    const offline = provider(() => ({ ok: false, code: 'network', reason: 'offline' }));
    const again = render(<Shown p={offline.p} />);
    await waitFor(() => expect(state()).toBe('not-ready:network'));
    again.unmount();
    render(<Shown p={offline.p} />);
    await waitFor(() => expect(offline.check).toHaveBeenCalledTimes(2));
    // A service busy for now (429, 5xx) is no lasting answer either: shown again, the card asks again.
    for (const code of ['rate_limit', 'server']) {
      cleanup();
      useNotesAnswers.getState().reset();
      const busy = provider(() => ({ ok: false, code, reason: 'try later' }));
      const once = render(<Shown p={busy.p} />);
      await waitFor(() => expect(state()).toBe(`not-ready:${code}`));
      once.unmount();
      render(<Shown p={busy.p} />);
      await waitFor(() => expect(busy.check).toHaveBeenCalledTimes(2));
    }
  });

  it("asks again after a pause once the notes' model or reasoning changes", async () => {
    const { p, check } = provider(() => ({ ok: true, models: [] }));
    render(<Shown p={p} />);
    await waitFor(() => expect(state()).toBe('ready'));
    vi.useFakeTimers();
    act(() => keyed({ notesReasoning: { level: 'high', typed: '' } }));
    expect(state()).toBe('unknown');
    await act(async () => { await vi.advanceTimersByTimeAsync(NOTES_CHECK_DELAY_MS - 1); });
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenLastCalledWith({ apiKey: KEY }, expect.objectContaining({ notesReasoning: { level: 'high', typed: '' } }), expect.anything());
  });

  it('asks nothing during a session', async () => {
    const { p, check } = provider(() => ({ ok: true, models: [] }));
    render(<Shown p={p} locked />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(check).not.toHaveBeenCalled();
    expect(state()).toBe('unknown');
  });

  // Review: the inputs an answer is kept with once held the key itself, a second copy of it in memory.
  it('keeps no key in what it stores: only a fingerprint of the credentials, which still tells a new key', async () => {
    const { p, check } = provider(() => ({ ok: true, models: [] }));
    render(<Shown p={p} />);
    await waitFor(() => expect(state()).toBe('ready'));
    expect(JSON.stringify(useNotesAnswers.getState().byProvider)).not.toContain(KEY);
    act(() => useProviderStore.setState({
      entries: { openai_text: { settings: TEXT_MODEL_DEFAULTS, credentials: { apiKey: 'test-key-0001' }, pair: PAIR } },
    } as never));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(JSON.stringify(useNotesAnswers.getState().byProvider)).not.toContain('test-key-0001');
  });

  it('a fingerprint is short, the same for the same values, and another for others', () => {
    expect(fingerprint([KEY])).toBe(fingerprint([KEY]));
    expect(fingerprint([KEY])).not.toBe(fingerprint(['test-key-0001']));
    expect(fingerprint(['a', 'bc'])).not.toBe(fingerprint(['ab', 'c']));
    expect(fingerprint([KEY])).not.toContain(KEY);
    expect(fingerprint([KEY]).length).toBeLessThanOrEqual(16);
  });

  // Review: the check is given the sign-in, yet a sign-in change does not ask it again. Nothing it reads changes with
  // it: the card gives this hook only the services with the user's own key (Kizuna AI's state is the sign-in itself),
  // whose credentials are read without the sign-in, and a text model's check is told none.
  it('asks nothing again on a sign-in change: nothing the check of an own-key service reads changes with it', async () => {
    const { p, check } = provider(() => ({ ok: true, models: [] }));
    function SignedIn({ signedIn }: { signedIn: boolean }) {
      const r = useNotesReadiness(p, { ...AUTH, signedIn }, false);
      return <span data-testid="state">{r.state}</span>;
    }
    const view = render(<SignedIn signedIn={false} />);
    await waitFor(() => expect(state()).toBe('ready'));
    view.rerender(<SignedIn signedIn />);
    await act(async () => { await new Promise((r) => setTimeout(r, NOTES_CHECK_DELAY_MS + 100)); });
    expect(check).toHaveBeenCalledTimes(1);
    expect(openaiTextProvider.credentials.read.length).toBe(1);
  });

  it('a compatible service with no address is not asked: the address is what it lacks', async () => {
    const check = vi.fn();
    const entry = { settings: TEXT_MODEL_DEFAULTS, credentials: { baseUrl: '', apiKey: '' }, pair: PAIR };
    await expect(checkNotes({ ...openaiCompatibleProvider, check } as unknown as AnyProvider, entry, AUTH, new AbortController().signal))
      .resolves.toMatchObject({ state: 'not-ready', code: 'address_missing' });
    expect(check).not.toHaveBeenCalled();
  });
});

/**
 * A text model's options on the Translation card (owner, 2026-11-22): the service's own text models with
 * "Automatic" first, a model's name that wins when typed, the reasoning levels, and a reasoning value that wins when
 * typed; each wired to the provider's settings for the translation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const lists = vi.hoisted(() => ({ calls: [] as unknown[], again: [] as boolean[], answer: { ok: true, ids: [] as string[] } as unknown }));
vi.mock('../../lib/textModel/modelList', () => ({
  textModelList: (q: unknown, again = false) => { lists.calls.push(q); lists.again.push(again); return Promise.resolve(lists.answer); },
}));

import '../../locales';
import type { ProviderAccount } from '../../lib/provider/types';
import { TEXT_MODEL_DEFAULTS, type TextModelSettings } from '../../lib/textModel/unit';
import { TextModelSettingsView } from './TextModelSettings';

const account = (credentials: Record<string, string>): ProviderAccount => ({ credentials, auth: { signedIn: false, getToken: async () => null } });

function draw(o: { service?: 'openai' | 'gemini' | 'compatible'; settings?: Partial<TextModelSettings>; credentials?: Record<string, string>; disabled?: boolean; stage?: 'translation' | 'notes' } = {}) {
  const update = vi.fn();
  const settings = { ...TEXT_MODEL_DEFAULTS, ...o.settings };
  render(<TextModelSettingsView service={o.service ?? 'openai'} settings={settings} update={update} disabled={o.disabled} account={account(o.credentials ?? { apiKey: 'test-key-0000' })} {...(o.stage ? { stage: o.stage } : {})} />);
  return { update, settings };
}

beforeEach(() => {
  lists.calls = [];
  lists.again = [];
  lists.answer = { ok: true, ids: ['gpt-5-mini', 'gpt-5.4', 'gpt-4.1-mini'] };
});
afterEach(() => cleanup());

describe("a text model's options", () => {
  it("lists the service's text models, Automatic first naming the one it stands for; a choice is stored as the listed model", async () => {
    const { update } = draw();
    const select = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('gpt-5.4'));
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Automatic (gpt-5-mini)', 'gpt-5-mini', 'gpt-5.4', 'gpt-4.1-mini']);
    expect(lists.calls).toEqual([{ service: 'openai', apiKey: 'test-key-0000' }]);
    fireEvent.change(select, { target: { value: 'gpt-5.4' } });
    expect(update).toHaveBeenCalledWith({ translationModel: { listed: 'gpt-5.4', typed: '' } });
  });

  // Review of #853: a model the service added since is offered without a restart; a key changed meanwhile is asked with once.
  it('asks the list afresh each time the card opens, and by what it keeps for a key changed while it is open', async () => {
    const first = render(<TextModelSettingsView service="openai" settings={TEXT_MODEL_DEFAULTS} update={vi.fn()} account={account({ apiKey: 'test-key-0000' })} />);
    await waitFor(() => expect(lists.calls).toHaveLength(1));
    first.rerender(<TextModelSettingsView service="openai" settings={TEXT_MODEL_DEFAULTS} update={vi.fn()} account={account({ apiKey: 'test-key-0001' })} />);
    await waitFor(() => expect(lists.calls).toHaveLength(2));
    first.unmount();
    draw();
    await waitFor(() => expect(lists.calls).toHaveLength(3));
    expect(lists.again).toEqual([true, false, true]);
  });

  // Review of #853: the last ready check's models are the credentials' it was made with, not another key's.
  it("while the list is on its way, offers the last ready check's models only when they are the current key's", async () => {
    lists.answer = new Promise(() => {});
    const before = [{ id: 'gpt-4.1-mini' }];
    const view = (apiKey: string, models: readonly { id: string }[]) => (
      <TextModelSettingsView service="openai" settings={TEXT_MODEL_DEFAULTS} update={vi.fn()} models={models} account={account({ apiKey })} />
    );
    const options = () => [...screen.getByRole('combobox', { name: 'Model' }).querySelectorAll('option')].map((o) => o.textContent);
    const { rerender } = render(view('test-key-0000', before));
    expect(options()).toEqual(['Automatic (gpt-4.1-mini)', 'gpt-4.1-mini']);
    // Another key: its list is on its way, and the models found with the key before are not its.
    rerender(view('test-key-0001', before));
    expect(screen.getByText('Finding models…')).toBeInTheDocument();
    expect(options()).toEqual(['Automatic']);
    // A check made with this key found these.
    rerender(view('test-key-0001', [{ id: 'gpt-5-mini' }]));
    expect(options()).toEqual(['Automatic (gpt-5-mini)', 'gpt-5-mini']);
    expect(screen.queryByText('Finding models…')).toBeNull();
  });

  it("a model's name typed wins: the list is set aside while it is filled", async () => {
    const { update } = draw({ settings: { translationModel: { listed: 'gpt-5.4', typed: 'ft:gpt-5.4:org' } } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled());
    fireEvent.change(screen.getByRole('textbox', { name: 'Or type a model name' }), { target: { value: '' } });
    expect(update).toHaveBeenCalledWith({ translationModel: { listed: 'gpt-5.4', typed: '' } });
  });

  it('a model chosen before that the list no longer holds stays shown and chosen', async () => {
    draw({ settings: { translationModel: { listed: 'gpt-gone', typed: '' } } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-gone'));
  });

  it('the reasoning: Off, Lowest, Low, Medium and High, Lowest by default; a value typed wins and is sent as it is', () => {
    const { update } = draw();
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    expect([...select.querySelectorAll('option')].map((o) => [o.getAttribute('value'), o.textContent])).toEqual([
      ['off', 'Off'], ['lowest', 'Lowest'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'],
    ]);
    expect(select).toHaveValue('lowest');
    fireEvent.change(select, { target: { value: 'off' } });
    expect(update).toHaveBeenLastCalledWith({ translationReasoning: { level: 'off', typed: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Or type a value, sent as it is' }), { target: { value: 'xhigh' } });
    expect(update).toHaveBeenLastCalledWith({ translationReasoning: { level: 'lowest', typed: 'xhigh' } });
  });

  it('a compatible service: its address and key are asked with; it has no Automatic, and with no list only the name shows', async () => {
    lists.answer = { ok: true, ids: ['deepseek-chat'] };
    draw({ service: 'compatible', credentials: { baseUrl: 'https://api.example.com/v1', apiKey: '' } });
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('deepseek-chat'));
    expect(lists.calls).toEqual([{ service: 'compatible', baseUrl: 'https://api.example.com/v1', apiKey: '' }]);
    expect([...screen.getByRole('combobox', { name: 'Model' }).querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose a model', 'deepseek-chat']);
    cleanup();
    lists.answer = { ok: true, ids: [] };
    draw({ service: 'compatible', credentials: { baseUrl: 'http://localhost:11434/v1', apiKey: '' } });
    await screen.findByText("This service lists no models: type the model's name.");
    expect(screen.queryByRole('combobox', { name: 'Model' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Or type a model name' })).toBeInTheDocument();
  });

  // Review of #853: a model chosen from a list the service no longer gives stays visible, and can be set back.
  it('a service that lists nothing now, with a model chosen from its list before: the choice stays shown and can be undone', async () => {
    lists.answer = { ok: true, ids: [] };
    const { update } = draw({ service: 'compatible', credentials: { baseUrl: 'http://localhost:11434/v1', apiKey: '' }, settings: { translationModel: { listed: 'deepseek-chat', typed: '' } } });
    await screen.findByText("This service lists no models: type the model's name.");
    const select = screen.getByRole('combobox', { name: 'Model' });
    expect(select).toHaveValue('deepseek-chat');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose a model', 'deepseek-chat']);
    fireEvent.change(select, { target: { value: '' } });
    expect(update).toHaveBeenCalledWith({ translationModel: { listed: '', typed: '' } });
  });

  it("a list the service refused is said in its words; nothing is asked without a key or an address", async () => {
    lists.answer = { ok: false, failure: { code: 'auth', status: 401, message: 'Incorrect API key provided.' } };
    draw();
    await screen.findByText('The provider did not accept the credentials: Incorrect API key provided.');
    cleanup();
    lists.calls = [];
    draw({ credentials: { apiKey: '' } });
    draw({ service: 'compatible', credentials: { baseUrl: '', apiKey: '' } });
    expect(lists.calls).toEqual([]);
  });

  it('locked during a session', () => {
    draw({ disabled: true });
    for (const box of screen.getAllByRole('combobox')) expect(box).toBeDisabled();
    for (const box of screen.getAllByRole('textbox')) expect(box).toBeDisabled();
  });
});

// Text models, part C: the same controls on the Notes card, for the notes' own model and reasoning.
describe("a text model's options for the notes", () => {
  it("Automatic names the notes' own preference; a choice is stored as the notes' model", async () => {
    lists.answer = { ok: true, ids: ['gpt-5-mini', 'gpt-6-luna'] };
    const { update } = draw({ stage: 'notes' });
    const select = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Automatic (gpt-6-luna)', 'gpt-5-mini', 'gpt-6-luna']));
    fireEvent.change(select, { target: { value: 'gpt-5-mini' } });
    expect(update).toHaveBeenCalledWith({ notesModel: { listed: 'gpt-5-mini', typed: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Or type a model name' }), { target: { value: 'gpt-6-sol' } });
    expect(update).toHaveBeenLastCalledWith({ notesModel: { listed: '', typed: 'gpt-6-sol' } });
  });

  it("the reasoning: Medium by default, with words of its own; the translation's untouched", () => {
    const { update } = draw({ stage: 'notes', settings: { translationReasoning: { level: 'high', typed: '' } } });
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    expect(select).toHaveValue('medium');
    fireEvent.change(select, { target: { value: 'off' } });
    expect(update).toHaveBeenLastCalledWith({ notesReasoning: { level: 'off', typed: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Or type a value, sent as it is' }), { target: { value: 'medium' } });
    expect(update).toHaveBeenLastCalledWith({ notesReasoning: { level: 'medium', typed: 'medium' } });
    expect(update.mock.calls.some(([patch]) => 'translationReasoning' in patch || 'translationModel' in patch)).toBe(false);
  });

  it('stands beside the translation\'s for the same provider: its fields are its own', () => {
    const update = vi.fn();
    render(
      <>
        <TextModelSettingsView service="openai" settings={TEXT_MODEL_DEFAULTS} update={update} account={account({ apiKey: 'test-key-0000' })} />
        <TextModelSettingsView service="openai" stage="notes" settings={TEXT_MODEL_DEFAULTS} update={update} account={account({ apiKey: 'test-key-0000' })} />
      </>,
    );
    const ids = [...document.querySelectorAll('input')].map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

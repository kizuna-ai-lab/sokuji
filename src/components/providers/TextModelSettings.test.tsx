/**
 * A text model's options on the Translation card (owner, 2026-11-22): the service's own text models with
 * "Automatic" first, a model's name that wins when typed, the reasoning levels, and a reasoning value that wins when
 * typed; each wired to the provider's settings for the translation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const lists = vi.hoisted(() => ({ calls: [] as unknown[], answer: { ok: true, ids: [] as string[] } as unknown }));
vi.mock('../../lib/textModel/modelList', () => ({
  textModelList: (q: unknown) => { lists.calls.push(q); return Promise.resolve(lists.answer); },
}));

import '../../locales';
import type { ProviderAccount } from '../../lib/provider/types';
import { TEXT_MODEL_DEFAULTS, type TextModelSettings } from '../../lib/textModel/unit';
import { TextModelSettingsView } from './TextModelSettings';

const account = (credentials: Record<string, string>): ProviderAccount => ({ credentials, auth: { signedIn: false, getToken: async () => null } });

function draw(o: { service?: 'openai' | 'gemini' | 'compatible'; settings?: Partial<TextModelSettings>; credentials?: Record<string, string>; disabled?: boolean } = {}) {
  const update = vi.fn();
  const settings = { ...TEXT_MODEL_DEFAULTS, ...o.settings };
  render(<TextModelSettingsView service={o.service ?? 'openai'} settings={settings} update={update} disabled={o.disabled} account={account(o.credentials ?? { apiKey: 'test-key-0000' })} />);
  return { update, settings };
}

beforeEach(() => {
  lists.calls = [];
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

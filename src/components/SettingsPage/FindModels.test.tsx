/**
 * "Find models" on a compatible service's row: asks the service at the address entered, with the key entered, and
 * says what it found, that it lists none, or why not, in the service's words.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '../../locales';
import type { TextModelRequestInit, TextModelTransport } from '../../lib/textModel/client';
import { forgetTextModelLists } from '../../lib/textModel/modelList';
import { FindModels } from './FindModels';

function service(status: number, body: unknown) {
  const sent: Array<{ url: string; init: TextModelRequestInit }> = [];
  const transport: TextModelTransport = async (url, init) => {
    sent.push({ url, init });
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { transport, sent };
}

beforeEach(() => forgetTextModelLists());
afterEach(() => cleanup());

describe('finding a compatible service\'s models', () => {
  it('asks its /models at the address entered, with the key entered, and names what it found', async () => {
    const s = service(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] });
    render(<FindModels service="compatible" credentials={{ baseUrl: 'https://api.example.com/v1', apiKey: 'test-key-0000' }} transport={s.transport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 models available: deepseek-chat, deepseek-reasoner');
    expect(s.sent.map((r) => [r.url, r.init.headers.Authorization])).toEqual([['https://api.example.com/v1/models', 'Bearer test-key-0000']]);
  });

  it('a service with no list says the model is typed; a refusal is said in its words', async () => {
    const none = service(404, '404 page not found');
    render(<FindModels service="compatible" credentials={{ baseUrl: 'http://localhost:11434/v1', apiKey: '' }} transport={none.transport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    expect(await screen.findByRole('status')).toHaveTextContent("This service lists no models: type the model's name.");
    expect(none.sent[0].init.headers).not.toHaveProperty('Authorization');
    cleanup();
    const refused = service(401, { error: { message: 'Invalid API key.' } });
    render(<FindModels service="compatible" credentials={{ baseUrl: 'https://api.example.com/v1', apiKey: 'test-key-0000' }} transport={refused.transport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The provider did not accept the credentials: Invalid API key.');
  });

  // Review of #853: what was found is the address's and the key's it was asked with.
  it('another address or key lets what was found go; asked again, it is found anew', async () => {
    const s = service(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] });
    const view = (baseUrl: string, apiKey: string) => <FindModels service="compatible" credentials={{ baseUrl, apiKey }} transport={s.transport} />;
    const { rerender } = render(view('https://api.example.com/v1', 'test-key-0000'));
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 models available');
    rerender(view('https://api.example.org/v1', 'test-key-0000'));
    expect(screen.queryByRole('status')).toBeNull();
    // Back to the address before: what was found then is not shown again unasked.
    rerender(view('https://api.example.com/v1', 'test-key-0000'));
    expect(screen.queryByRole('status')).toBeNull();
    rerender(view('https://api.example.com/v1', 'test-key-0001'));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 models available');
    expect(s.sent.map((r) => r.init.headers.Authorization)).toEqual(['Bearer test-key-0000', 'Bearer test-key-0001']);
  });

  it('an answer for the address before, come after the one asked since, is not shown', async () => {
    const waiting = new Map<string, () => void>();
    const transport: TextModelTransport = (url) => new Promise((resolve) => {
      const ids = url.includes('example.com') ? ['old-model'] : ['new-model'];
      waiting.set(url, () => resolve({ status: 200, text: async () => JSON.stringify({ data: ids.map((id) => ({ id })) }) }));
    });
    const view = (baseUrl: string) => <FindModels service="compatible" credentials={{ baseUrl, apiKey: '' }} transport={transport} />;
    const { rerender } = render(view('https://api.example.com/v1'));
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    rerender(view('https://api.example.org/v1'));
    // The address changed while the first was on its way: it can be asked at once.
    fireEvent.click(screen.getByRole('button', { name: 'Find models' }));
    await act(async () => { waiting.get('https://api.example.org/v1/models')!(); });
    expect(await screen.findByRole('status')).toHaveTextContent('1 models available: new-model');
    await act(async () => { waiting.get('https://api.example.com/v1/models')!(); });
    expect(screen.getByRole('status')).toHaveTextContent('1 models available: new-model');
  });

  it('cannot be asked without an address, or during a session', () => {
    render(<FindModels service="compatible" credentials={{ baseUrl: '', apiKey: '' }} />);
    expect(screen.getByRole('button', { name: 'Find models' })).toBeDisabled();
    cleanup();
    render(<FindModels service="compatible" credentials={{ baseUrl: 'https://api.example.com/v1', apiKey: '' }} disabled />);
    expect(screen.getByRole('button', { name: 'Find models' })).toBeDisabled();
  });
});

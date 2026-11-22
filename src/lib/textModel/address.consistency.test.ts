// The page and the desktop app's main process hold one rule of what a compatible service's address may be, and of
// which endpoints are sent to it: the page refuses before asking, the main process refuses whatever it is handed.
// Each keeps its own copy (the main process does not load the page's modules); this keeps the two the same.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { compatibleAddressProblem, normaliseBaseUrl, TEXT_MODEL_PATHS } from './address';
import { TEXT_MODEL_CANCEL_CHANNEL, TEXT_MODEL_REQUEST_CHANNEL } from './desktopTransport';
import { INVOKE_CHANNELS } from '../../../electron/ipc-channels.js';

const nodeRequire = createRequire(import.meta.url);
const main = nodeRequire('../../../electron/text-model-request.js') as {
  textModelAddressProblem(url: string): string | null;
  checkTextModelRequest(payload: unknown): { ok: boolean; url?: string };
  TEXT_MODEL_PATHS: Record<string, string>;
};

const ADDRESSES = [
  'https://openrouter.ai/api/v1', 'https://api.deepseek.com', 'https://api.example.com/v1/', 'http://localhost:11434/v1',
  'http://127.0.0.1:1234/v1', 'http://[::1]:8080', 'http://localhost', 'HTTPS://API.EXAMPLE.COM/V1',
  'http://example.com/v1', 'http://192.168.1.10:11434/v1', 'http://localhost.example.com', 'http://127.0.0.2/v1',
  'http://[::2]/v1', 'ftp://example.com', 'file:///etc', 'ws://localhost:1234', 'https://user:pw@example.com/v1',
  'https://:pw@example.com', 'https://example.com/v1?x=1', 'https://example.com/v1#frag', 'not an address', '',
  'localhost:11434/v1', '//example.com/v1', 'https://api.example.com/v1#/models', 'https://api.example.com/v1?/chat/completions',
];

describe('the address rule, in the page and in the main process', () => {
  it('finds the same problem with every address, or none', () => {
    for (const address of ADDRESSES) {
      expect(main.textModelAddressProblem(normaliseBaseUrl(address)), address).toBe(compatibleAddressProblem(address));
    }
  });

  it('sends to the same endpoints, and the main process takes what the page sends', () => {
    expect(Object.keys(main.TEXT_MODEL_PATHS).sort()).toEqual([...TEXT_MODEL_PATHS].sort());
    for (const address of ADDRESSES.filter((a) => compatibleAddressProblem(a) === null)) {
      const checked = main.checkTextModelRequest({ id: 'text-model-1', baseUrl: normaliseBaseUrl(address), path: '/models', method: 'GET', headers: { Authorization: 'Bearer x' } });
      expect(checked.ok, address).toBe(true);
      expect(checked.url, address).toBe(`${new URL(normaliseBaseUrl(address)).href.replace(/\/$/, '')}/models`);
    }
  });

  it("the page's channels are the ones the bridge lets through", () => {
    expect(INVOKE_CHANNELS).toEqual(expect.arrayContaining([TEXT_MODEL_REQUEST_CHANNEL, TEXT_MODEL_CANCEL_CHANNEL]));
  });
});

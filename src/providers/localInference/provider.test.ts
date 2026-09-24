import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheck = vi.fn();
vi.mock('./check', () => ({ checkLocalInference: (...args: unknown[]) => mockCheck(...args) }));

const mockBuild = vi.fn();
const mockDescribe = vi.fn();
const mockAdmit = vi.fn();
vi.mock('./config', () => ({
  buildLocalInference: (...args: unknown[]) => mockBuild(...args),
  describeLocalInference: (...args: unknown[]) => mockDescribe(...args),
  admitLocalInference: (...args: unknown[]) => mockAdmit(...args),
}));

import { localInferenceProvider } from './provider';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';
import { PROVIDERS } from '../registry';

const noAuth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  mockCheck.mockReset();
  mockBuild.mockReset();
  mockDescribe.mockReset();
  mockAdmit.mockReset();
});

describe('localInferenceProvider', () => {
  it('identifies itself: local, on every platform, with no credentials to fill or read', () => {
    expect(localInferenceProvider.id).toBe('localInference');
    expect(localInferenceProvider.kind).toBe('local');
    expect(localInferenceProvider.platforms).toEqual(['electron', 'extension', 'web']);
    expect(localInferenceProvider.settings.key).toBe('localInference');
    expect(localInferenceProvider.settings.defaults).toBe(LOCAL_INFERENCE_DEFAULTS);
    expect(localInferenceProvider.credentials.keys).toEqual([]);
    expect(localInferenceProvider.credentials.fields(LOCAL_INFERENCE_DEFAULTS)).toEqual([]);
    expect(localInferenceProvider.credentials.read({}, noAuth)).toEqual({});
  });

  it('offers optional speech, text input, provider-cut boundaries, and both turn modes', () => {
    expect(localInferenceProvider.speech).toBe('optional');
    expect(localInferenceProvider.textInput).toBe(true);
    expect(localInferenceProvider.boundaries(LOCAL_INFERENCE_DEFAULTS)).toBe('provider');
    expect(localInferenceProvider.turns(LOCAL_INFERENCE_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('has an admit hook, the memory budget', () => {
    expect(localInferenceProvider.session?.admit).toBeDefined();
    mockAdmit.mockReturnValue(true);
    expect(localInferenceProvider.session?.admit?.({})).toBe(true);
    expect(mockAdmit).toHaveBeenCalledWith({});
  });

  it('delegates build() to buildLocalInference', () => {
    const context = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' } as any;
    const shared = {} as any;
    mockBuild.mockReturnValue({ refused: 'no' });
    const result = localInferenceProvider.build(context, LOCAL_INFERENCE_DEFAULTS, shared);
    expect(mockBuild).toHaveBeenCalledWith(context, LOCAL_INFERENCE_DEFAULTS, shared);
    expect(result).toEqual({ refused: 'no' });
  });

  it('delegates describe() to describeLocalInference', () => {
    const config = { asr: { modelId: 'x', streaming: false } } as any;
    mockDescribe.mockReturnValue({ asrModel: 'x' });
    const result = localInferenceProvider.describe(config);
    expect(mockDescribe).toHaveBeenCalledWith(config);
    expect(result).toEqual({ asrModel: 'x' });
  });

  it("check answers from checkLocalInference, given the provider's settings and context", async () => {
    const ctx = { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] as const };
    mockCheck.mockResolvedValue({ ok: true });
    const result = await localInferenceProvider.check({}, LOCAL_INFERENCE_DEFAULTS, ctx);
    expect(mockCheck).toHaveBeenCalledWith(LOCAL_INFERENCE_DEFAULTS, ctx);
    expect(result).toEqual({ ok: true });
  });

  it('is first in the registry, in UI order', () => {
    expect(PROVIDERS[0]).toBe(localInferenceProvider);
  });
});

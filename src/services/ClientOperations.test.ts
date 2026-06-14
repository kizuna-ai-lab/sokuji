import { describe, it, expect } from 'vitest';
import { ClientOperations } from './ClientOperations';
import { Provider } from '../types/Provider';

describe('ClientOperations — kizuna relay twins do not throw', () => {
  it('validateApiKeyAndFetchModels resolves valid for the translate twin', async () => {
    const r = await ClientOperations.validateApiKeyAndFetchModels(
      'sess_TOKEN',
      Provider.KIZUNA_AI_OPENAI_TRANSLATE
    );
    expect(r.validation.valid).toBe(true);
    expect(r.validation.validating).toBe(false);
    expect(r.models.length).toBeGreaterThan(0);
  });

  it('validateApiKeyAndFetchModels resolves valid for the doubao (AST2) twin', async () => {
    const r = await ClientOperations.validateApiKeyAndFetchModels(
      'sess_TOKEN',
      Provider.KIZUNA_AI_VOLCENGINE_AST2
    );
    expect(r.validation.valid).toBe(true);
    expect(r.validation.validating).toBe(false);
    expect(r.models.length).toBeGreaterThan(0);
  });

  it('getLatestRealtimeModel returns a model string for both twins', () => {
    expect(
      ClientOperations.getLatestRealtimeModel([], Provider.KIZUNA_AI_OPENAI_TRANSLATE)
    ).toBe('gpt-realtime-translate');
    expect(
      ClientOperations.getLatestRealtimeModel([], Provider.KIZUNA_AI_VOLCENGINE_AST2)
    ).toBe('ast-v2-s2s');
  });
});

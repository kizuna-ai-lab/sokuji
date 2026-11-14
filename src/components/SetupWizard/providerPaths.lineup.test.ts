// Plan 6, Task 1: both hosted providers on offer, and the line-up each path sets up.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true,
}));
// Every released provider offered, as a signed-in user of a release sees them.
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});

const { managedOptions, managedOption, lineUpOf, pathOf, offersRecord } = await import('./providerPaths');

describe('the hosted providers and the line-up of each path', () => {
  it('offers both hosted providers, Soniox first', () => {
    expect(managedOptions('two-way-voice').map((o) => o.id)).toEqual(['kizunaai_soniox', 'kizunaai_qwen']);
    expect(managedOption('two-way-voice')?.id).toBe('kizunaai_soniox');
  });

  it('greys Qwen face to face but keeps the Kizuna AI path', () => {
    expect(managedOptions('face-to-face-voice').find((o) => (o.id as string) === 'kizunaai_qwen')!.fit).toEqual({ ok: false, reason: 'cannot-face-to-face' });
    expect(managedOptions('face-to-face-voice')[0].fit.ok).toBe(true);
  });

  it('gives each path its line-up', () => {
    expect(lineUpOf('kizunaai_qwen')).toEqual({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    expect(lineUpOf('openai_live')).toEqual({ transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live' });
    expect(lineUpOf('local_inference')).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
  });

  it('names the path of each provider the wizard offers', () => {
    expect(pathOf('kizunaai_qwen')).toBe('managed');
    expect(pathOf('openai_live')).toBe('own-key');
    expect(pathOf('local_inference')).toBe('offline');
    expect(pathOf('bing')).toBeNull();
    expect(pathOf('not-a-provider')).toBeNull();
  });

  it('accepts a Qwen record on a re-run', () => {
    expect(offersRecord({ scenario: 'two-way-voice', providerPath: 'managed', provider: 'kizunaai_qwen' })).toBe(true);
  });
});

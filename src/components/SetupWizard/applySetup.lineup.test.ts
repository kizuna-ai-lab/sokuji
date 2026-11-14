// Plan 6, Task 4: Finish writes the line-up, after the provider and before the record.
import { describe, it, expect, vi } from 'vitest';
import { applySetupDraft, type ApplySetupDeps } from './applySetup';
import { initialDraft, type SetupDraft } from './setupDraft';
import { Provider } from '../../types/Provider';

function deps(overrides: Partial<ApplySetupDeps> = {}): ApplySetupDeps {
  return {
    setMode: vi.fn(), setOtherSide: vi.fn(), setBothPopoverSeen: vi.fn(), setTextOnly: vi.fn(), setParticipantSpeech: vi.fn(),
    applyProvider: vi.fn(async () => {}), applyLineUp: vi.fn(async () => {}), completeSetup: vi.fn(async () => {}),
    ...overrides,
  };
}
const draft = (over: Partial<SetupDraft>): SetupDraft => ({
  ...initialDraft(), step: 5, scenario: 'two-way-voice', providerPath: 'managed', provider: 'kizunaai_qwen' as never,
  sourceLanguage: 'ja', targetLanguage: 'en', ...over,
});

describe('Finish writes the line-up', () => {
  it('writes the provider, then the line-up, then the record', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);
    expect(d.applyLineUp).toHaveBeenCalledWith({ transcription: 'kizunaai_qwen', translation: 'kizunaai_qwen', speech: 'kizunaai_qwen' });
    const order = [d.applyProvider, d.applyLineUp, d.completeSetup].map((f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('writes the free set on the no-key path', async () => {
    const d = deps();
    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE }), d);
    expect(d.applyLineUp).toHaveBeenCalledWith({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
  });

  it('does not write the record when the line-up did not land', async () => {
    const d = deps({ applyLineUp: vi.fn(async () => { throw new Error('not stored'); }) });
    await expect(applySetupDraft(draft({}), d)).rejects.toThrow('not stored');
    expect(d.completeSetup).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import { getManifestByType, getManifestEntry, getModelDownloadUrl, getModelSizeMb } from './modelManifest';
import { SMART_TURN_MODEL_ID } from '../turn/smartTurn';

describe('the Smart Turn manifest entry', () => {
  it('is the only turn model', () => {
    expect(getManifestByType('turn').map((m) => m.id)).toEqual([SMART_TURN_MODEL_ID]);
  });

  it('is the upstream fp32 file at a pinned commit', () => {
    const entry = getManifestEntry(SMART_TURN_MODEL_ID)!;
    expect(entry).toMatchObject({
      type: 'turn',
      hfModelId: 'pipecat-ai/smart-turn-v3',
      hfRevision: 'f766f81d3cfdf7737ac64aad813d91bbfd56bf93',
    });
    expect(entry.cdnPath).toBeUndefined();
    expect(entry.requiredDevice).toBeUndefined();
    expect(entry.variants).toEqual({
      default: { dtype: 'default', files: [{ filename: 'smart-turn-v3.2-gpu.onnx', sizeBytes: 32_411_198 }] },
    });
  });

  it('downloads from the pinned revision', () => {
    expect(getModelDownloadUrl(getManifestEntry(SMART_TURN_MODEL_ID)!, 'smart-turn-v3.2-gpu.onnx')).toBe(
      'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-gpu.onnx',
    );
  });

  it('is 31 MB', () => {
    expect(getModelSizeMb(getManifestEntry(SMART_TURN_MODEL_ID)!)).toBe(31);
  });

  it('stays out of every resolver pool', () => {
    const entry = getManifestEntry(SMART_TURN_MODEL_ID)!;
    expect(entry.asrEngine).toBeUndefined();
    expect(entry.engine).toBeUndefined();
    expect(entry.translationWorkerType).toBeUndefined();
  });
});

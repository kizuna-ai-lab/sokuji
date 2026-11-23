/**
 * What the composer makes of Local Native's four units under the released catalog: a line-up all on Local Native
 * runs its whole session; any other stage of it combines with another provider's (#578 ruling 17).
 */
import { describe, expect, it } from 'vitest';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';
import { compose, type ComposeInput } from '../../lib/plan/compose';
import { isRefusal, type RunPlan } from '../../lib/plan/types';
import type { AnyProvider } from '../../lib/provider/types';
import { bingProvider } from '../bing/provider';
import { edgeProvider } from '../edge/provider';
import { localInferenceProvider } from '../localInference/provider';
import { sonioxProvider } from '../soniox/provider';
import { SONIOX_TRANSCRIPTION_UNIT } from '../soniox/units';
import { localNativeProvider } from './provider';

registerReleasedCatalog();

const offered: ComposeInput = {
  providers: [localNativeProvider, localInferenceProvider, bingProvider, edgeProvider, sonioxProvider] as readonly AnyProvider[],
  settings: () => undefined,
};

describe("what Local Native's units compose into", () => {
  it.each([
    // line-up (TR, TL, SP)                                  → provider:unit per planned unit, in plan order
    [['local_native', 'local_native', 'local_native'], ['local_native:whole']],
    [['local_native', 'local_native', 'edge'], ['local_native:whole', 'edge:speech']],
    [['local_native', 'bing', 'edge'], ['local_native:transcription', 'bing:translation', 'edge:speech']],
    [['local_native', 'local_inference', 'local_inference'], ['local_native:transcription', 'local_inference:translation', 'local_inference:speech']],
    [['local_inference', 'local_native', 'local_native'], ['local_inference:transcription', 'local_native:translation', 'local_native:speech']],
    [['soniox', 'soniox', 'local_native'], ['soniox:stt', 'local_native:speech']],
    [['soniox', 'local_native', 'edge'], [`soniox:${SONIOX_TRANSCRIPTION_UNIT}`, 'local_native:translation', 'edge:speech']],
  ] as const)('composes %j', (stages, expected) => {
    const [transcription, translation, speech] = stages;
    const plan = compose({ transcription, translation, speech }, offered) as RunPlan;
    expect(isRefusal(plan)).toBe(false);
    expect(plan.units.map((u) => `${u.provider.id}:${u.unit.id}`)).toEqual(expected);
  });
});

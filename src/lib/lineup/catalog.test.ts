import { describe, expect, it } from 'vitest';
import { RELEASED } from '../../providers/registry';
import { CAPS, hostDefaults } from './catalog';

describe('the line-up catalog', () => {
  it('every option names a provider definition as its host', () => {
    for (const c of CAPS) expect(c.host === c.id || (c.host === 'local_inference' && ['bing', 'edge'].includes(c.id))).toBe(true);
  });

  it('hostDefaults answers what familyDefaults answered', () => {
    expect(hostDefaults('local_inference')).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(hostDefaults('soniox')).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' });
  });

  it('covers every released provider, plus Bing and Edge', () => {
    expect(new Set(CAPS.map((c) => c.id))).toEqual(new Set([...RELEASED.map((p) => p.id), 'bing', 'edge']));
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { LegName } from '../../lib/conversation/types';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { createSonioxVoiceSummary } from './SonioxVoiceSummary';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

const ByokSummary = createSonioxVoiceSummary({ managed: false });
const ManagedSummary = createSonioxVoiceSummary({ managed: true });
const text = (Summary: typeof ByokSummary, settings: Partial<SonioxSettings>, leg: LegName) =>
  render(<Summary settings={{ ...SONIOX_DEFAULTS, ...settings }} update={() => {}} leg={leg} />).container.textContent;

describe('createSonioxVoiceSummary', () => {
  it("names my voice by the active region's field, the default when none is stored", () => {
    expect(text(ByokSummary, { region: 'eu', voice: 'Nina', voiceEu: 'Daniel' }, 'speaker')).toBe('Daniel');
    expect(text(ByokSummary, { region: 'us', voice: '' }, 'speaker')).toBe('Adrian');
  });

  it("names the other party's voice a run speaks: the choice, or the other default when it is mine", () => {
    expect(text(ByokSummary, { voice: 'Adrian', participantVoice: 'Kenji' }, 'participant')).toBe('Kenji');
    expect(text(ByokSummary, { voice: 'Grace', participantVoice: 'Grace' }, 'participant')).toBe('Adrian');
  });

  it("a cloned voice reads as the managed account's own voice, or a custom voice on an own key", () => {
    expect(text(ManagedSummary, { voice: '6b1f0c2e-clone' }, 'speaker')).toBe('My voice');
    expect(text(ByokSummary, { voice: '6b1f0c2e-clone' }, 'speaker')).toBe('Custom voice');
  });
});

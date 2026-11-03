import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { LegName } from '../../lib/conversation/types';
import { PALABRA_DEFAULTS, type PalabraSettings } from './settings';
import { PalabraVoiceSummary } from './PalabraVoiceSummary';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

const text = (settings: Partial<PalabraSettings>, leg: LegName) =>
  render(<PalabraVoiceSummary settings={{ ...PALABRA_DEFAULTS, ...settings }} update={() => {}} leg={leg} />).container.textContent;

describe('PalabraVoiceSummary', () => {
  it('names a default by its own name', () => {
    expect(text({ voiceId: 'default_low' }, 'speaker')).toBe('Default Low');
  });

  it('names any other voice by the name stored with it', () => {
    expect(text({ voiceId: '94d9130d-d4bb-4e35-9baf-fca490506a85', voiceName: 'Hungarian Male' }, 'speaker')).toBe('Hungarian Male');
  });

  it('calls a voice with no stored name a custom voice', () => {
    expect(text({ voiceId: 'b532f7e9-ad28-4c51-a83e-2676860a6e9f', voiceName: '' }, 'speaker')).toBe('Custom voice');
  });

  it("names the other party's voice a run speaks, by its own stored name", () => {
    expect(text({ voiceId: 'default_low', participantVoiceId: '11111111-2222', participantVoiceName: 'Japanese Female' }, 'participant')).toBe('Japanese Female');
    // The same as mine: the run reads the default I am not using, named as such.
    expect(text({ voiceId: '11111111-2222', voiceName: 'Japanese Female', participantVoiceId: '11111111-2222', participantVoiceName: 'Japanese Female' }, 'participant')).toBe('Default High');
  });
});

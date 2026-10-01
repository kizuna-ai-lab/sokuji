import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { LanguageContext } from '../../../lib/provider/types';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key), i18n: { language: 'en' } }),
}));

const opt = (value: string) => ({ value, name: value, englishName: value });
/** Speaking offers en and ja; text also ko — Doubao AST 2.0's shape. */
const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
const moody = {
  id: 'moody',
  speech: 'optional',
  settings: { key: 'moody', defaults: {} },
  languages: {
    sources: (_s: unknown, context?: LanguageContext) => offered(context),
    targets: (source: string, _s: unknown, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
  },
};
vi.mock('../providerPaths', () => ({ wizardProvider: () => moody, textOnlyCapabilityOf: () => 'optional' }));
// The registry's import graph stays out: the step reads only these two from the app shape.
const participant = vi.hoisted(() => ({ speech: false }));
vi.mock('../../../lib/session/appShape', () => ({
  legsFor: (mode: string) => (mode === 'both' ? ['speaker', 'participant'] : [mode]),
  participantSpeechSwitchFromStores: () => participant.speech,
}));

import StepLanguagePair from './StepLanguagePair';
import { initialDraft, type SetupDraft } from '../setupDraft';
import type { ScenarioId } from '../../../lib/setup/types';
import { Provider } from '../../../types/Provider';

const draw = (scenario: ScenarioId, pair = { source: 'en', target: 'ja' }, dispatch = vi.fn()) => {
  // Any stored spelling: `wizardProvider` is the stub above.
  const draft: SetupDraft = { ...initialDraft(), provider: Provider.VOLCENGINE_AST2, scenario, sourceLanguage: pair.source, targetLanguage: pair.target };
  render(<StepLanguagePair draft={draft} dispatch={dispatch} />);
  // The codes on offer: the display order, the pinned copies and the separator are not what these cases pin.
  const codes = [...(screen.getAllByRole('combobox')[0] as HTMLSelectElement).options].map((o) => o.value).filter((v) => v !== '');
  return [...new Set(codes)].sort();
};

beforeEach(() => { participant.speech = false; });

describe('StepLanguagePair — the scenario decides whether the run speaks (Stage 2 Volcengine AST2, choice 1)', () => {
  it("offers a speaking scenario the languages it speaks", () => {
    expect(draw('be-heard')).toEqual(['en', 'ja']);
  });

  it('offers every language to a subtitles-only scenario', () => {
    expect(draw('subtitle-myself')).toEqual(['en', 'ja', 'ko']);
  });

  it("reads the participant's own speech switch for a scenario that listens to others", () => {
    expect(draw('understand-others')).toEqual(['en', 'ja', 'ko']);
    participant.speech = true;
    cleanup();
    expect(draw('understand-others')).toEqual(['en', 'ja']);
  });

  it("normalizes a pair kept from another scenario into this one's lists, and leaves an offered pair alone", () => {
    // Picked under subtitle-myself, then Back to a scenario that speaks: ko is not on its list.
    const dispatch = vi.fn();
    draw('be-heard', { source: 'ko', target: 'ja' }, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: 'setLanguages', source: 'en', target: 'ja' });
    cleanup();
    const quiet = vi.fn();
    draw('subtitle-myself', { source: 'ko', target: 'ja' }, quiet);
    expect(quiet).not.toHaveBeenCalled();
  });
});

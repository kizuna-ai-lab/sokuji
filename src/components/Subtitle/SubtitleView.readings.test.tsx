import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Entry } from '../../lib/projection/types';
import type { SubtitleSession } from '../../lib/subtitle/session';
import type { ReadingLanguage } from '../../lib/reading/types';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));
vi.mock('./useSubtitleChrome', () => ({
  useSubtitleChrome: () => ({
    rootRef: { current: null },
    rootProps: { className: 'subtitle-app', style: {}, onMouseEnter() {}, onMouseMove() {}, onMouseLeave() {} },
    resizeHandles: null,
  }),
}));
vi.mock('./SubtitleBar', () => ({ default: () => null }));
const seen = vi.hoisted(() => ({ readings: 'unset' as unknown }));
vi.mock('../Conversation/ConversationList', () => ({
  ConversationList: (p: { readings?: unknown }) => { seen.readings = p.readings; return null; },
}));

const { SubtitleView } = await import('./SubtitleView');
const { useSubtitleStore } = await import('../../stores/subtitleStore');

const entry: Entry = {
  kind: 'exchange', id: 'a', leg: 'speaker', languages: { source: 'en', target: 'ja' }, pairing: 'stated', t: 0,
  source: [{ key: 's1:0', segmentId: 's1', side: 'source', start: 0, end: 6, text: 'Hello.', final: true }],
  translation: [],
};
const session = (): SubtitleSession => ({
  phase: 'running', since: 0, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: false, canStart: false, idle: { kind: 'ended' },
});
const controls = () => ({ exit: vi.fn(), clear: vi.fn(), press: vi.fn(), release: vi.fn(), start: vi.fn(), stop: vi.fn(), openSettings: vi.fn() });
const JA: ReadonlySet<ReadingLanguage> = new Set(['ja']);

beforeEach(() => {
  cleanup();
  seen.readings = 'unset';
  useSubtitleStore.setState({ showReadings: true, compactMode: false });
});

describe('SubtitleView readings', () => {
  it('passes the host\'s reading targets to the list on the Electron surface', () => {
    render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} readingTargets={JA} />);
    expect(seen.readings).toBe(JA);
  });

  it('passes none on the overlay, whatever it is given', () => {
    render(<SubtitleView surface="extension-overlay" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} readingTargets={JA} />);
    expect(seen.readings).toBeUndefined();
  });
});

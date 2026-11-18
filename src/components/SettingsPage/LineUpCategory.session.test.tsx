// The line-up's lock during a session, and its four cards.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => false }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: ({ disabled }: { disabled?: boolean }) => <div id="languages-section" data-disabled={String(disabled)} /> }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: ({ locked }: { locked?: boolean }) => <div id="turn-detection-section" data-locked={String(locked)} /> }));
vi.mock('./EdgeVoices', () => ({ EdgeVoices: () => <div /> }));
vi.mock('./LocalVoices', () => ({ LocalVoices: () => <div /> }));
vi.mock('../providers/ProviderOwnSettings', () => ({
  ProviderEngine: () => <div />,
  ProviderOwnSettings: () => <div />,
  ProviderTurnDetectionControls: () => <div />,
}));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});
const authState = vi.hoisted(() => ({ signedIn: true }));
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: authState.signedIn, getToken: async () => null }) }));
vi.mock('../../lib/notes/notesPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notes/notesPricing')>()),
  useNotesPricing: () => null,
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: () => {} }) }));

import { LineUpCategory } from './LineUpCategory';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' };
const STAGE_SELECTS = ['Transcription and translation', 'Speech', 'Notes'];
const cardOf = (combobox: string) => screen.getByRole('combobox', { name: combobox }).closest('.lineup-stage') as HTMLElement;
const states = (card: HTMLElement) => [...card.querySelectorAll('.lineup-stage__state')].map((s) => s.textContent);

beforeEach(() => {
  authState.signedIn = true;
  useProviderStore.setState({ selected: 'soniox', selectionLocked: false, entries: {}, readiness: {} });
  useLineUpStore.setState({ lineUp: soniox, stored: true });
  useSettingsStore.setState({ settingsNavigationTarget: null });
});
afterEach(() => cleanup());

describe('the line-up during a session and after it', () => {
  it('locks the language pair, the speech mode and every card while the session runs; unlocks them with the same choices after', () => {
    const { rerender } = render(<LineUpCategory locked />);
    expect(document.getElementById('languages-section')).toHaveAttribute('data-disabled', 'true');
    expect(document.getElementById('turn-detection-section')).toHaveAttribute('data-locked', 'true');
    const before = STAGE_SELECTS.map((name) => (screen.getByRole('combobox', { name }) as HTMLSelectElement).value);
    for (const name of STAGE_SELECTS) expect(screen.getByRole('combobox', { name })).toBeDisabled();

    rerender(<LineUpCategory locked={false} />);
    expect(document.getElementById('languages-section')).toHaveAttribute('data-disabled', 'false');
    expect(document.getElementById('turn-detection-section')).toHaveAttribute('data-locked', 'false');
    for (const name of STAGE_SELECTS) expect(screen.getByRole('combobox', { name })).toBeEnabled();
    // Nothing was lost: the same choices, the same line-up in the store.
    expect(STAGE_SELECTS.map((name) => (screen.getByRole('combobox', { name }) as HTMLSelectElement).value)).toEqual(before);
    expect(before).toEqual(['soniox', 'soniox', 'openai']);
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
  });

  it('refuses a line-up change while the provider is locked by a running session', async () => {
    useProviderStore.setState({ selectionLocked: true });
    expect(await useLineUpStore.getState().choose('speech', 'edge')).toBeNull();
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
  });
});

describe('languages and line-up: the four cards', () => {
  it('draws a card for each of the four stages on the desktop; the stages one provider binds share one', () => {
    render(<LineUpCategory locked={false} />);
    // Soniox binds transcription and translation: one joint card, then speech, then notes.
    expect(document.querySelectorAll('.lineup-section > .lineup-stage')).toHaveLength(3);
    // With a different provider on each stage: four cards.
    cleanup();
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(document.querySelectorAll('.lineup-section > .lineup-stage')).toHaveLength(4);
  });

  it('an explicit Kizuna AI choice while signed out says on its card that a sign-in is needed', () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox', summarisation: 'kizunaai_openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    const card = document.querySelector<HTMLElement>('.lineup-stage.is-joint')!;
    expect(within(card).getByRole('combobox')).toHaveValue('kizunaai_soniox');
    expect(states(card).every((s) => s === 'Needs a sign-in')).toBe(true);
    expect(states(cardOf('Notes'))).toEqual(['Needs a sign-in']);
  });

  it('"Needs a sign-in" takes you to the Kizuna AI sign-in, on a stage card and on the notes card', () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: 'kizunaai_soniox', summarisation: 'kizunaai_openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    const card = document.querySelector<HTMLElement>('.lineup-stage.is-joint')!;
    fireEvent.click(within(card).getAllByRole('button', { name: 'Needs a sign-in' })[0]);
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider:kizunaai_soniox');
    fireEvent.click(within(cardOf('Notes')).getByRole('button', { name: 'Needs a sign-in' }));
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('user-account');
  });

  it('a Kizuna AI service not chosen is offered as needing a sign-in while signed out', () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    const options = within(screen.getByRole('combobox', { name: 'Translation' })).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.filter((o) => o.startsWith('KizunaAI')).every((o) => o.includes('needs a sign-in'))).toBe(true);
  });

  it('frames the joint card with the primary colour in the stylesheet', () => {
    // jsdom computes no colours: the rule itself is pinned. That it reads as green is a visual check (E2E).
    const scss = readFileSync(join(process.cwd(), 'src/components/SettingsPage/SettingsPage.scss'), 'utf8');
    expect(scss).toMatch(/&\.is-joint \{ border-color: vars\.\$color-primary; \}/);
  });

  it("after a service change the cards' hints follow: states, the joint line and what moved", async () => {
    useProviderStore.setState({ entries: { soniox: { settings: { region: 'us' }, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Needs a key').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Transcription and translation go over one connection; they change together.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Speech' }), { target: { value: 'edge' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }));
    expect(await screen.findByText(/Transcription and translation moved/)).toBeInTheDocument();
    // The Soniox hints are gone with Soniox; each stage now has its own card and says Ready.
    expect(screen.queryByText('Transcription and translation go over one connection; they change together.')).toBeNull();
    expect(document.querySelector('.lineup-stage.is-joint')).toBeNull();
    for (const name of ['Transcription', 'Translation', 'Speech']) expect(states(cardOf(name))).toEqual(['Ready']);
  });
});

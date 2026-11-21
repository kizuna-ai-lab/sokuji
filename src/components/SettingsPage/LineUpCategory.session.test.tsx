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
import { runsOn } from '../../stores/lineUpStore.testing';
import useSettingsStore from '../../stores/settingsStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' };
const STAGE_SELECTS = ['Transcription and translation', 'Speech', 'Notes'];
const cardOf = (combobox: string) => screen.getByRole('combobox', { name: combobox }).closest('.lineup-stage') as HTMLElement;
const states = (card: HTMLElement) => [...card.querySelectorAll('.lineup-stage__state')].map((s) => s.textContent);

beforeEach(() => {
  authState.signedIn = true;
  runsOn('soniox');
  useLineUpStore.setState({ locked: false });
  useProviderStore.setState({ entries: {}, readiness: {} });
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
    useLineUpStore.setState({ locked: true });
    expect(await useLineUpStore.getState().choose('speech', 'edge')).toBeNull();
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
  });
});

/** The line on the card Soniox's transcription and translation share: one connection, and the translation can be given away. */
const PARTABLE = 'Transcription and translation go over one connection. Another service can do the translation: choose it below.';

describe('languages and line-up: the four cards', () => {
  it('draws a card for each of the four stages on the desktop; the stages one provider holds jointly share one', () => {
    render(<LineUpCategory locked={false} />);
    // Soniox holds transcription and translation jointly: one joint card, then speech, then notes.
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
    expect(within(card).getByRole('combobox', { name: 'Transcription and translation' })).toHaveValue('kizunaai_soniox');
    // Its translation can be given to another service: a choice of its own, in the same card.
    expect(within(card).getByRole('combobox', { name: 'Translation' })).toHaveValue('kizunaai_soniox');
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

  it("after a service change the cards' hints follow: states and the joint line, and no other stage moves", async () => {
    useProviderStore.setState({ entries: { soniox: { settings: { region: 'us' }, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Needs a key').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(PARTABLE)).toBeInTheDocument();

    // A voice of another service: Soniox keeps transcription and translation, and its card its hints.
    fireEvent.change(screen.getByRole('combobox', { name: 'Speech' }), { target: { value: 'edge' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'soniox', translation: 'soniox', speech: 'edge' }));
    expect(screen.getByText(PARTABLE)).toBeInTheDocument();
    expect(screen.queryByText(/moved/)).toBeNull();
    await waitFor(() => expect(states(cardOf('Speech'))).toEqual(['Ready']));

    // Transcription to this device: Soniox's translation goes with it, over the one connection they shared.
    fireEvent.change(screen.getByRole('combobox', { name: 'Transcription and translation' }), { target: { value: 'local_inference' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }));
    // The Soniox hints are gone with Soniox; each stage now has its own card and says Ready.
    await waitFor(() => expect(screen.queryByText(PARTABLE)).toBeNull());
    expect(document.querySelector('.lineup-stage.is-joint')).toBeNull();
    for (const name of ['Transcription', 'Translation', 'Speech']) expect(states(cardOf(name))).toEqual(['Ready']);
  });

  it("Bing chosen for translation in Soniox's shared card keeps Soniox transcribing: a card each, and nothing says they go together", async () => {
    useProviderStore.setState({ entries: { soniox: { settings: { region: 'us' }, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<LineUpCategory locked={false} />);
    const shared = document.querySelector<HTMLElement>('.lineup-stage.is-joint')!;
    fireEvent.change(within(shared).getByRole('combobox', { name: 'Translation' }), { target: { value: 'bing' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'soniox', translation: 'bing', speech: 'soniox' }));
    await waitFor(() => expect(document.querySelector('.lineup-stage.is-joint')).toBeNull());
    expect(screen.queryByText(PARTABLE)).toBeNull();
    expect(screen.queryByText(/over one connection/)).toBeNull();
    // Each card says its own service's state: Soniox's key on transcription and speech, Bing ready between them.
    expect(states(cardOf('Transcription'))).toEqual(['Needs a key']);
    expect(states(cardOf('Translation'))).toEqual(['Ready']);
    expect(states(cardOf('Speech'))).toEqual(['Needs a key']);

    // Soniox chosen for translation again: it already transcribes, and the two share a card again.
    fireEvent.change(screen.getByRole('combobox', { name: 'Translation' }), { target: { value: 'soniox' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' }));
    await waitFor(() => expect(screen.getByText(PARTABLE)).toBeInTheDocument());
  });

  it('Soniox chosen for translation where this device transcribes takes the transcription too', async () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({ entries: { soniox: { settings: { region: 'us' }, credentials: { apiKey: 'k' }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<LineUpCategory locked={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Translation' }), { target: { value: 'soniox' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'soniox', translation: 'soniox', speech: 'edge' }));
    // And Soniox chosen for transcription alone keeps Bing translating.
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Transcription' })).toHaveValue('local_inference'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Transcription' }), { target: { value: 'soniox' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'soniox', translation: 'bing', speech: 'edge' }));
  });

});

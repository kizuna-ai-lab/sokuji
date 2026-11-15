// Plan 6, Task 2: the provider step asks which hosted service, describes the
// no-key path as it is, and shows the line-up each choice sets up.
import { useReducer } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<typeof import('../../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});

import StepProviderPath from './StepProviderPath';
import { initialDraft, setupReducer, type SetupDraft } from '../setupDraft';
import type { ScenarioId } from '../../../lib/setup/types';

function Harness({ scenario, patch = {} }: { scenario: ScenarioId; patch?: Partial<SetupDraft> }) {
  const [draft, dispatch] = useReducer(setupReducer, { ...initialDraft(), step: 2, scenario, ...patch });
  return <StepProviderPath draft={draft} dispatch={dispatch} />;
}
const card = (name: RegExp) => screen.getByRole('radio', { name }).closest('label')!;
const preview = () => screen.getByRole('group', { name: 'The line-up this sets up' });

afterEach(() => cleanup());

describe('the provider step', () => {
  it('asks which hosted service, Soniox first and recommended, with their strengths', () => {
    render(<Harness scenario="two-way-voice" />);
    fireEvent.click(screen.getByRole('radio', { name: /Start right away/ }));
    const group = screen.getByRole('radiogroup', { name: 'Which hosted service?' });
    const options = within(group).getAllByRole('radio');
    expect(options).toHaveLength(2);
    expect(card(/^Soniox/)).toHaveTextContent('Recommended');
    expect(card(/^Soniox/)).toHaveTextContent('Real-time transcription, fast translation.');
    expect(card(/^Qwen/)).toHaveTextContent('Can look at your screen; very accurate transcription and translation.');
    // Preselected with the first fitting option, and its line-up shown.
    expect(screen.getByRole('radio', { name: /^Soniox/ })).toBeChecked();
    expect(within(preview()).getAllByText('KizunaAI')).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: /^Qwen/ }));
    expect(screen.getByRole('radio', { name: /^Qwen/ })).toBeChecked();
  });

  it("greys Qwen face to face with today's reason", () => {
    render(<Harness scenario="face-to-face-voice" />);
    fireEvent.click(screen.getByRole('radio', { name: /Start right away/ }));
    expect(screen.getByRole('radio', { name: /^Qwen/ })).toBeDisabled();
    expect(card(/^Qwen/)).toHaveTextContent('This provider cannot translate two people at one microphone.');
    expect(screen.getByRole('radio', { name: /^Soniox/ })).toBeChecked();
  });

  it('describes the no-key path as it is and shows its line-up', () => {
    render(<Harness scenario="two-way-voice" />);
    const noKey = screen.getByRole('radio', { name: /No key needed/ });
    expect(card(/No key needed/)).toHaveTextContent('translation uses Bing and speech uses Edge, which go online as Microsoft services.');
    fireEvent.click(noKey);
    const rows = within(preview());
    expect(rows.getByText('This device')).toBeInTheDocument();
    expect(rows.getByText('Bing')).toBeInTheDocument();
    expect(rows.getByText('Edge')).toBeInTheDocument();
    expect(rows.getByText('You can change each stage later in Settings → Languages and line-up.')).toBeInTheDocument();
  });

  it('shows the line-up of the chosen own-key provider', () => {
    render(<Harness scenario="two-way-voice" />);
    fireEvent.click(screen.getByRole('radio', { name: /I have my own API key/ }));
    expect(screen.queryByRole('group', { name: 'The line-up this sets up' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^OpenAI Live/ }));
    expect(within(preview()).getAllByText('OpenAI Live')).toHaveLength(3);
  });
});

// Plan 6, Task 3: the finish step shows the line-up instead of the provider.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<typeof import('../../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});

import StepFinish from './StepFinish';
import { initialDraft, type SetupDraft } from '../setupDraft';
import { Provider } from '../../../types/Provider';

const draft = (patch: Partial<SetupDraft>): SetupDraft => ({
  ...initialDraft(), step: 5, scenario: 'two-way-voice', sourceLanguage: 'ja', targetLanguage: 'en', ...patch,
});
afterEach(() => cleanup());

describe('the finish step', () => {
  it('shows the line-up on the finish step instead of the provider', () => {
    const { container } = render(<StepFinish draft={draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX })} isSignedIn error={null} />);
    const summary = container.querySelector('.setup-summary') as HTMLElement;
    expect(within(summary).queryByText('Provider')).toBeNull();
    expect(within(summary).getByText('Line-up')).toBeInTheDocument();
    for (const stage of ['Transcription', 'Translation', 'Speech']) expect(within(summary).getByText(stage)).toBeInTheDocument();
    expect(within(summary).getAllByText('KizunaAI')).toHaveLength(3);
    // The rows alone: no box title, no line about changing it later.
    expect(screen.queryByText('The line-up this sets up')).toBeNull();
  });

  it('sends a key left for later to Accounts and keys', () => {
    render(<StepFinish draft={draft({ providerPath: 'own-key', provider: Provider.SONIOX, credentialsPending: true })} isSignedIn={false} error={null} />);
    expect(screen.getByText(/add it in Settings → Accounts and keys/)).toBeInTheDocument();
  });
});

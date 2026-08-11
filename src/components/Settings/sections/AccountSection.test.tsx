/**
 * The user account section is scoped to the Kizuna-managed providers.
 *
 * Everything the section offers - balance, 30-day usage, sign-in - only means
 * something when the relay is billing the user's wallet. On a bring-your-own-key
 * provider (OpenAI, Gemini, a local engine) the account panel is noise: it shows
 * a balance nothing draws from and a sign-in prompt for a service the user is
 * not about to call. So it renders on `isKizunaManagedProvider(provider)`, not
 * merely on the Kizuna feature flag being compiled in.
 *
 * Both conditions have to hold: the flag alone was the previous behaviour, and
 * the provider alone would render a dead section in builds where the Kizuna
 * twins are never registered with ProviderConfigFactory.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountSection from './AccountSection';
import { Provider } from '../../../types/Provider';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../Tooltip/Tooltip', () => ({
  default: () => <span data-testid="tooltip" />,
}));

vi.mock('../../Auth/UserAccountInfo', () => ({
  UserAccountInfo: () => <div data-testid="user-account-info" />,
}));

vi.mock('../../Auth/AuthGuard', () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
}));

const env = { kizunaEnabled: true };
vi.mock('../../../utils/environment', () => ({
  isKizunaAIEnabled: () => env.kizunaEnabled,
}));

const store = { provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE as string };
vi.mock('../../../stores/settingsStore', () => ({
  useProvider: () => store.provider,
}));

beforeEach(() => {
  env.kizunaEnabled = true;
  store.provider = Provider.KIZUNA_AI_OPENAI_TRANSLATE;
});

const section = () => document.getElementById('user-account-section');

describe('AccountSection provider scoping', () => {
  it.each([
    Provider.KIZUNA_AI_OPENAI_TRANSLATE,
    Provider.KIZUNA_AI_VOLCENGINE_AST2,
    Provider.KIZUNA_AI_SONIOX,
  ])('renders for the Kizuna-managed provider %s', (provider) => {
    store.provider = provider;
    render(<AccountSection />);
    expect(section()).not.toBeNull();
    expect(screen.getByTestId('user-account-info')).toBeTruthy();
  });

  it.each([
    Provider.OPENAI,
    Provider.GEMINI,
    Provider.OPENAI_TRANSLATE,
    Provider.VOLCENGINE_AST2,
    Provider.SONIOX,
    Provider.LOCAL_INFERENCE,
  ])('stays hidden on the bring-your-own-key provider %s', (provider) => {
    store.provider = provider;
    render(<AccountSection />);
    expect(section()).toBeNull();
  });

  it('stays hidden when the Kizuna feature flag is off, even on a Kizuna provider', () => {
    // A persisted setting can name a Kizuna provider in a build that never
    // registered it; the flag is what says the section has a backend at all.
    env.kizunaEnabled = false;
    store.provider = Provider.KIZUNA_AI_OPENAI_TRANSLATE;
    render(<AccountSection />);
    expect(section()).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UserAccountInfo } from './UserAccountInfo';

// The message is styled success-or-error. It used to decide that by testing
// whether the rendered English contained the substring "sent", so every
// translation that did not happen to carry that ASCII word fell through to
// error styling. This suite renders the message in Chinese for exactly that
// reason: it cannot pass by accident of vocabulary.
const zh: Record<string, string> = {
  'auth.checkYourEmail': '验证邮件已发送。请在邮箱中完成验证后回到 Sokuji，状态会自动更新。',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => zh[k] ?? d ?? k }),
}));

// 59s ago, not 5s: the component starts a resend cooldown of (60 - age)
// seconds and ticks it once per second, and vitest waits that chain out. A
// 5-second-old account means a 55-second test. One second is enough to put
// the message on screen, which is all this asserts.
const justCreated = new Date(Date.now() - 59_000);
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({
    user: { emailVerified: false, createdAt: justCreated },
    refetch: vi.fn(),
  }),
}));
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({
    user: { email: 'you@example.com', firstName: 'J' },
    quota: { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' },
    isLoading: false,
    refetchAll: vi.fn(),
  }),
}));
vi.mock('../../lib/auth-client', () => ({
  authClient: {
    oneTimeToken: { generate: async () => ({ data: null, error: 'x' }) },
    getSession: async () => ({ data: { user: { emailVerified: false } } }),
  },
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

beforeEach(cleanup);

describe('verification message tone', () => {
  it('styles a freshly-sent notice as success even when it is not in English', () => {
    const { container } = render(<UserAccountInfo />);
    const msg = container.querySelector('.verification-message');
    expect(msg).not.toBeNull();
    expect(msg!.className).toContain('success');
    expect(msg!.className).not.toContain('error');
  });
});

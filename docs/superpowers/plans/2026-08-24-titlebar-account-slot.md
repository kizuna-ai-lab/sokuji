# Title Bar Account Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the account entry out of the provider-scoped settings section into the
title bar, so signing up no longer requires having already selected the managed
provider.

**Architecture:** A self-contained `AccountButton` lives in the title bar next to
`SubtitleEnterButton`, reading its own stores so `TitleBar` stays props-only. It owns
a popover built on the same `@floating-ui` shell as `ModeDevicePopover`. The logs
button moves behind advanced mode, which buys back the width the account slot costs.
`AccountSection` is then deleted, and its contents live in the popover.

**Tech Stack:** React 19, TypeScript (strict), Zustand, `@floating-ui/react`,
react-i18next, lucide-react, Vitest + @testing-library/react, SASS.

**Spec:** `docs/superpowers/specs/2026-08-24-titlebar-account-slot-design.md`

## Global Constraints

- **Baseline**: `9d81aeca` (v0.38.0). The main checkout is one release behind; never
  read line numbers from it.
- **Language**: all code, comments, and commit messages in English. Conventional
  commits (`feat(titlebar): …`, `fix(auth): …`, `test(...)`, `docs(...)`, `i18n(...)`).
- **TDD, strictly**: write the failing test, run it, watch it fail, then implement.
- **All 30 locales together**: `src/locales/locales.consistency.test.ts` flattens every
  catalogue and diffs against `en`. A key added to `en` alone fails the suite. Never
  defer translations to a follow-up.
- **Status dot precedence**: red (blocking) outranks amber (reminder).
- **Top-up label**: "Top up" (en), 「充值」(zh_CN).
- **Do not `git push` and do not open a PR.** Commit locally only; jiangzhuo triggers
  anything outward-facing.
- **Baseline test noise**: a full vitest run in a worktree fails ~12 files on a clean
  base. A/B against HEAD before blaming your change.
- **Working directory**: every command in this plan runs from the worktree root
  `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/feat+titlebar-account-slot`.
  Never `cd` to the repository root — it is a release behind and its line numbers differ.
- **Confirm the base before starting**: `git merge-base --is-ancestor 9d81aeca HEAD`
  must exit 0. If it does not, stop and report rather than working on the wrong tree.
- **Type-check your own files before every commit.** `npx vitest run` does NOT
  type-check and `npm run build` is a plain esbuild transpile, so without this step
  nothing in the plan catches a type error. The baseline is dirty — 467 pre-existing
  errors on clean HEAD — so "tsc is clean" is not achievable and is not the bar. The
  bar is: **the files YOU touched report zero errors**:

  ```bash
  npx tsc --noEmit 2>&1 | grep -E "<path/you/touched>" || echo "CLEAN"
  ```

  `tsconfig.json` sets `noUnusedLocals`, so an unused constant or import is a hard
  error. This is not hypothetical: the first draft of Task 1's code shipped a dead
  constant that vitest waved straight through.
- **Locale policy — read this before any task that adds a translation key.** Each task
  adds its new keys to `src/locales/en/translation.json` **only**. Task 15 propagates
  every key to the other 29 catalogues in one pass. Consequences, both deliberate:
  seven tasks stop competing for the same 30 files, and
  `src/locales/locales.consistency.test.ts` is **expected to fail from Task 2 until
  Task 15 closes it**. Every other test must be green at every task boundary. Do not
  "fix" that suite by hand-filling catalogues inside another task. When you add a key,
  **state its full nested path in your report** — Task 15 has to mirror the same shape
  into 29 files, and nothing in the test suite enforces key placement.

---

## Slices

Four slices, each ending in a working, committed state:

| Slice | Tasks | Deliverable |
|---|---|---|
| A | 1–3 | `AccountButton` renders both states and the status dot; not yet mounted |
| B | 4–6 | `AccountPopover` complete in both states; top-up button live |
| C | 7–10 | Popover connected, mounted in `TitleBar`, logs behind advanced, `AccountSection` gone, settings reordered |
| D | 11–14 | Onboarding, the provider sign-in line, and the two defects |

---

## Task 1: Compact balance label

The title bar renders a compact balance, not `formatUsdFloor`'s full precision:
`$0.001552` costs 265px of safe width (600px vs 335px measured). Truncation direction
is unchanged — the compact form never overstates the balance.

**Files:**
- Create: `src/components/TitleBar/compactBalance.ts`
- Test: `src/components/TitleBar/compactBalance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `compactBalanceLabel(microUsd: number | null | undefined): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/TitleBar/compactBalance.test.ts
import { describe, it, expect } from 'vitest';
import { compactBalanceLabel } from './compactBalance';

describe('compactBalanceLabel', () => {
  it('renders whole cents floored, never rounded up', () => {
    expect(compactBalanceLabel(12_340_000)).toBe('$12.34');
    // 4.999 must not become $5.00 — the wallet does not hold $5.00.
    expect(compactBalanceLabel(4_999_000)).toBe('$4.99');
  });

  it('collapses anything under a cent to a bound, not a long decimal', () => {
    // The whole point: $0.001552 is 265px wider than $12.34 in the title bar.
    expect(compactBalanceLabel(1_552)).toBe('< $0.01');
    expect(compactBalanceLabel(9_999)).toBe('< $0.01');
  });

  it('shows exactly zero as zero, not as "less than a cent"', () => {
    expect(compactBalanceLabel(0)).toBe('$0.00');
  });

  it('keeps a negative balance negative and floored away from zero', () => {
    // Charging is post-paid, so a session can overrun the balance.
    expect(compactBalanceLabel(-30_000)).toBe('-$0.03');
    expect(compactBalanceLabel(-1_552)).toBe('-$0.01');
  });

  it('falls back to zero for absent or non-finite input', () => {
    expect(compactBalanceLabel(null)).toBe('$0.00');
    expect(compactBalanceLabel(undefined)).toBe('$0.00');
    expect(compactBalanceLabel(NaN)).toBe('$0.00');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/TitleBar/compactBalance.test.ts`
Expected: FAIL — `Failed to resolve import "./compactBalance"`.

- [ ] **Step 3: Implement**

```ts
// src/components/TitleBar/compactBalance.ts
//
// The title bar shows a GLANCE at the balance; the popover shows the exact
// floored value. Measured: rendering `$0.001552` here pushes the Electron
// Win/Linux safe width from 335px to 600px, because the label sits in the
// same flex row as three window buttons. Collapsing sub-cent amounts to a
// bound costs nothing a user reads at this size and buys back 265px.
//
// Truncation direction matches formatUsdFloor: never claim more money than
// the wallet holds. `< $0.01` understates, and a negative balance floors
// AWAY from zero so a debt is never shown as smaller than it is.

const MICRO_USD_PER_CENT = 10_000;
const CENTS_PER_USD = 100;

export function compactBalanceLabel(microUsd: number | null | undefined): string {
  if (typeof microUsd !== 'number' || !Number.isFinite(microUsd)) return '$0.00';
  if (microUsd === 0) return '$0.00';

  if (microUsd > 0 && microUsd < MICRO_USD_PER_CENT) return '< $0.01';

  // Math.floor on the cent count moves negatives away from zero, which is the
  // conservative direction for a debt as well as for a credit.
  const cents = Math.floor(microUsd / MICRO_USD_PER_CENT);
  const dollars = Math.abs(cents) / CENTS_PER_USD;
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${dollars.toFixed(2)}`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/components/TitleBar/compactBalance.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/TitleBar/compactBalance.ts src/components/TitleBar/compactBalance.test.ts
git commit -m "feat(titlebar): compact balance label for the account slot"
```

---

## Task 2: AccountButton — the two marks

Signed out is a 14px lucide `User`, identical in weight to its siblings. Signed in is
a 20px outlined circle with the initial: a filled disc outweighs the row of
monochrome line icons around it (settled by rendering the candidates).

`betterAuthUser.image` is deliberately not consulted — the backend registers
`emailAndPassword` only, so it is always `null` today.

**Files:**
- Create: `src/components/TitleBar/AccountButton.tsx`, `src/components/TitleBar/AccountButton.scss`
- Test: `src/components/TitleBar/AccountButton.test.tsx`

**Interfaces:**
- Consumes: `compactBalanceLabel` (Task 1); `useAuth()`/`useUser()` from
  `src/lib/auth/hooks`; `useUserProfile()` from `src/contexts/UserProfileContext`.
- Produces: default-exported `AccountButton: React.FC`, rendering a
  `button.title-bar__action.account-button`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/TitleBar/AccountButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AccountButton from './AccountButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let signedIn = false;
let authUser: any = null;
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
  useUser: () => ({ isLoaded: true, user: authUser, refetch: vi.fn() }),
}));

let quota: any = null;
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ quota, refetchAll: vi.fn() }),
}));

// This mock is inert in Task 2 — the component does not import the store until
// Task 3 adds the status dot. Leave it; deleting it only means re-adding it.
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => 'openai',
  useTextOnly: () => false,
}));

beforeEach(() => {
  cleanup();
  signedIn = false;
  authUser = null;
  quota = null;
});

describe('AccountButton', () => {
  it('shows a generic person mark and no initial when signed out', () => {
    render(<AccountButton />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.querySelector('.account-button__initial')).toBeNull();
  });

  it('shows the uppercased initial of the name when signed in', () => {
    signedIn = true;
    authUser = { name: 'jiang zhuo', email: 'you@example.com', emailVerified: true };
    render(<AccountButton />);
    expect(screen.getByText('J')).toBeTruthy();
  });

  it('falls back to the e-mail when the account has no name', () => {
    signedIn = true;
    authUser = { name: null, email: 'zed@example.com', emailVerified: true };
    render(<AccountButton />);
    expect(screen.getByText('Z')).toBeTruthy();
  });

  it('renders the balance compactly, not at full precision', () => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
    quota = { balance: 1_552 };
    render(<AccountButton />);
    expect(screen.getByText('< $0.01')).toBeTruthy();
  });

  it('renders no balance label at all when signed out', () => {
    render(<AccountButton />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: FAIL — cannot resolve `./AccountButton`.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/TitleBar/AccountButton.tsx
//
// Self-contained the way SubtitleEnterButton is: it reads its own stores so
// TitleBar stays a props-only component.
//
// The entry renders while SIGNED OUT too. That is the whole point of moving
// it here — an entry that only appeared after signing in would contribute
// nothing to registration.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { useAuth, useUser } from '../../lib/auth/hooks';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { compactBalanceLabel } from './compactBalance';
import './AccountButton.scss';

const AccountButton: React.FC = () => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { quota } = useUserProfile();

  const accountLabel = t('titleBar.account.label', 'Account');

  if (!isSignedIn || !user) {
    return (
      <button
        type="button"
        className="title-bar__action account-button"
        title={accountLabel}
        aria-label={accountLabel}
      >
        <User size={14} />
      </button>
    );
  }

  const initial = (user.name?.[0] ?? user.email[0] ?? '?').toUpperCase();
  const balance = quota?.balance ?? quota?.remaining;

  return (
    <button
      type="button"
      className="title-bar__action account-button"
      title={accountLabel}
      aria-label={accountLabel}
    >
      <span className="account-button__initial" aria-hidden="true">{initial}</span>
      <span className="title-bar__action-label">{compactBalanceLabel(balance)}</span>
    </button>
  );
};

export default AccountButton;
```

- [ ] **Step 4: Add the stylesheet**

```scss
// src/components/TitleBar/AccountButton.scss
//
// The outlined circle, not a filled disc: rendered side by side, a filled
// #10a37f disc outweighs every 14px line icon beside it in the title bar.
// The outline keeps the avatar's circular semantics inside the bar's
// existing wireframe language. When OAuth lands and a real photograph is
// available, the circle becomes a filled photo — a photograph earns the
// weight a flat colour does not.
.account-button {
  position: relative;

  &__initial {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: transparent;
    border: 1.5px solid currentColor;
    color: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}
```

- [ ] **Step 5: Add the two locale keys to `en` only**

Add **one** key — `titleBar.account.label` = `Account` — to
`src/locales/en/translation.json`, nested inside the existing `titleBar` object
alongside `minimize`/`maximize`/`close`. Both states name the same thing to the user,
so a key per state would only give a translator two chances to render it differently.
Task 15 mirrors this exact nesting into the other 29; see the locale policy in Global
Constraints.

- [ ] **Step 6: Run the tests and the locale consistency suite**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: PASS, 5 component tests. (The consistency suite is expected to be red until Task 15 — see Global Constraints.)

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.scss \
        src/components/TitleBar/AccountButton.test.tsx src/locales/en
git commit -m "feat(titlebar): account button with signed-out and signed-in marks"
```

---

## Task 3: AccountButton — the status dot

Two conditions with deliberately different scopes. The low-balance dot is scoped to
managed providers because a BYOK user's wallet funds nothing — warning them would be
the same "balance nothing draws from" noise that justified `AccountSection`'s original
provider scoping. E-mail verification is account-level and shows regardless.

**Known, deliberate imprecision:** the floor is computed with `bothSplit = false`.
The exact value the Start button uses is derived in `MainPanel.tsx:649` from
`planBothMode(...)`, which needs `effectiveMode`, `activeProviderBothModeShared` and
`activeProviderSourceLanguage` — extracting that would mean touching MainPanel's hot
path. Using the lower floor can only ever **under**-report (no dot while Start is
disabled), never the reverse (a dot while Start works). Under-reporting is the safe
direction. If strict parity is wanted later, extract `useSonioxBothSplit()` and use it
in both places — a separate, independently verifiable change.

**Files:**
- Modify: `src/components/TitleBar/AccountButton.tsx`, `AccountButton.scss`
- Test: `src/components/TitleBar/AccountButton.test.tsx`

**Interfaces:**
- Consumes: `sonioxManagedMinBalanceMicroUsd(textOnly, bothSplit?)` from
  `src/services/providers/sonioxManagedMinBalance`; `isKizunaManagedProvider` from
  `src/types/Provider`; `useProvider()`, `useTextOnly()` from `settingsStore`.
- Produces: a `span.account-button__dot` carrying `data-tone="low" | "unverified"`.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

```tsx
describe('AccountButton status dot', () => {
  const signIn = (over: Partial<{ emailVerified: boolean }> = {}) => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true, ...over };
  };

  it('shows nothing while signed out, even with no verified e-mail', () => {
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });

  it('shows an amber dot for an unverified e-mail on any provider', () => {
    signIn({ emailVerified: false });
    quota = { balance: 12_340_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('unverified');
  });

  it('does NOT warn about a low balance under a BYOK provider', () => {
    // The wallet funds nothing here, so the balance is not the user's problem.
    signIn();
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });

  it('shows a red dot for a low balance under a managed provider', () => {
    providerId = 'kizunaai_soniox';
    signIn();
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('lets red outrank amber when both apply', () => {
    providerId = 'kizunaai_soniox';
    signIn({ emailVerified: false });
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('shows no dot when verified and funded', () => {
    providerId = 'kizunaai_soniox';
    signIn();
    quota = { balance: 12_340_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });
});
```

Also make the provider mockable — replace the fixed `useProvider` mock with:

```tsx
let providerId = 'openai';
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => providerId,
  useTextOnly: () => false,
  useAccountPopoverRequested: () => false,
  useSetAccountPopoverRequested: () => vi.fn(),
}));
```

and reset `providerId = 'openai'` in `beforeEach`.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: FAIL — no `.account-button__dot` in the tree.

- [ ] **Step 3: Implement**

Add to `AccountButton.tsx`, inside the signed-in branch:

```tsx
import { isKizunaManagedProvider } from '../../types/Provider';
import { useProvider, useTextOnly } from '../../stores/settingsStore';
import { sonioxManagedMinBalanceMicroUsd } from '../../services/providers/sonioxManagedMinBalance';

// …inside the component, before the signed-out early return:
const provider = useProvider();
const textOnly = useTextOnly();

// …inside the signed-in branch:
// bothSplit is deliberately omitted — see the plan's note. The lower floor
// can only under-report, never show a dot while Start actually works.
const floor = sonioxManagedMinBalanceMicroUsd(Boolean(textOnly));
const lowBalance =
  isKizunaManagedProvider(provider) && typeof balance === 'number' && balance < floor;
const unverified = user.emailVerified === false;
// Red outranks amber: one blocks a session, the other is a reminder.
const tone = lowBalance ? 'low' : unverified ? 'unverified' : null;
```

and render it inside the button:

```tsx
{tone && <span className="account-button__dot" data-tone={tone} aria-hidden="true" />}
```

- [ ] **Step 4: Style it**

```scss
// inside .account-button
&__dot {
  position: absolute;
  right: 6px;
  top: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  // The ring is the bar's own background, so the dot reads as a badge
  // rather than as a smudge on the icon beneath it.
  box-shadow: 0 0 0 1.5px #1a1a1a;

  &[data-tone='low'] { background: #e0665c; }
  &[data-tone='unverified'] { background: #d99231; }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.scss \
        src/components/TitleBar/AccountButton.test.tsx
git commit -m "feat(titlebar): status dot for low balance and unverified e-mail"
```

---

## Task 4: Top-up button in UserAccountInfo

The app currently has **no top-up entry at all** — the only route to money is the
`UserCog` icon opening `/dashboard`, leaving the user to find Billing themselves.
`/dashboard/billing` is canonical (`sokuji-backend/web/src/App.tsx:127` redirects
`/dashboard/wallet` to it).

**Files:**
- Modify: `src/components/Auth/UserAccountInfo.tsx`, `src/components/Auth/UserAccountInfo.scss`
- Modify: all `src/locales/*/translation.json`
- Test: `src/components/Auth/UserAccountInfo.topUp.test.tsx`

**Interfaces:**
- Consumes: the component-local `openExternalWithAuth(targetPath: string)`
  (`UserAccountInfo.tsx:223`). It stays local — after Task 8 this component has
  exactly one consumer, so extracting it would buy nothing.
- Produces: a `button.top-up-button` inside `.quota-status-section`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Auth/UserAccountInfo.topUp.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { UserAccountInfo } from './UserAccountInfo';

const invoke = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { emailVerified: true, createdAt: new Date(0) }, refetch: vi.fn() }),
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
  authClient: { oneTimeToken: { generate: async () => ({ data: null, error: 'x' }) } },
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

beforeEach(() => { cleanup(); invoke.mockClear(); });

describe('UserAccountInfo top-up', () => {
  it('offers a top-up button that opens the billing page', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(screen.getByRole('button', { name: /top up/i }));
    expect(open).toHaveBeenCalled();
    expect(String(open.mock.calls[0][0])).toContain('/dashboard/billing');
    open.mockRestore();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/Auth/UserAccountInfo.topUp.test.tsx`
Expected: FAIL — no button named "Top up".

- [ ] **Step 3: Implement**

In `UserAccountInfo.tsx`, beside `handleManageAccount`:

```tsx
  // The only route to money used to be the dashboard's front page, leaving
  // the user to find Billing themselves. /dashboard/billing is canonical —
  // /dashboard/wallet redirects to it.
  const handleTopUp = () => {
    trackEvent('top_up_clicked', {});
    openExternalWithAuth('/dashboard/billing');
  };
```

and inside `.quota-status-section`, after `.quota-compact-line`:

```tsx
            <button className="top-up-button" onClick={handleTopUp}>
              {t('common.topUp', 'Top up')}
            </button>
```

- [ ] **Step 4: Style it**

```scss
// src/components/Auth/UserAccountInfo.scss — inside .quota-status-section
.top-up-button {
  width: 100%;
  height: 32px;
  margin-top: 10px;
  border: none;
  border-radius: 5px;
  background: #10a37f;
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover { background: #0e9070; }
  &:focus-visible { outline: 2px solid #10a37f; outline-offset: 2px; }
}
```

- [ ] **Step 5: Add `common.topUp` to `en` only**

`en`: `Top up`. Task 15 translates it — 「充值」 is the settled zh_CN rendering and the
one the label was chosen to match, so pass that to Task 15 as a fixed anchor rather
than letting it be re-derived.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/Auth/UserAccountInfo.topUp.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Auth/UserAccountInfo.tsx src/components/Auth/UserAccountInfo.scss \
        src/components/Auth/UserAccountInfo.topUp.test.tsx src/locales/en
git commit -m "feat(account): give the wallet a top-up button"
```

---

## Task 5: AccountPopover — signed-in state

Shell copied from `ModeDevicePopover` (`FloatingPortal`, `useDismiss`,
`offset`/`flip`/`shift`/`size`, `autoUpdate`) and styled with that component's own
values: `#2a2a2a`, `1px solid #444`, radius `8px`, width `320px`, `font-size 12px`,
`box-shadow 0 4px 16px rgba(0,0,0,.5)` (`ModeDevicePopover.scss:4-13`).

**Files:**
- Create: `src/components/TitleBar/AccountPopover.tsx`, `AccountPopover.scss`
- Test: `src/components/TitleBar/AccountPopover.test.tsx`

**Interfaces:**
- Consumes: `UserAccountInfo` (Task 4).
- Produces: `AccountPopover: React.FC<{ open: boolean; anchorEl: HTMLElement | null; onClose: () => void }>`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/TitleBar/AccountPopover.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AccountPopover from './AccountPopover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
let signedIn = true;
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
}));
vi.mock('../Auth/UserAccountInfo', () => ({
  UserAccountInfo: () => <div data-testid="account-info" />,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

beforeEach(() => { cleanup(); signedIn = true; });

describe('AccountPopover signed in', () => {
  it('renders nothing while closed', () => {
    render(<AccountPopover open={false} anchorEl={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('account-info')).toBeNull();
  });

  it('renders the account panel when open', () => {
    render(<AccountPopover open anchorEl={document.body} onClose={vi.fn()} />);
    expect(screen.getByTestId('account-info')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/TitleBar/AccountPopover.test.tsx`
Expected: FAIL — cannot resolve `./AccountPopover`.

- [ ] **Step 3: Implement**

```tsx
// src/components/TitleBar/AccountPopover.tsx
//
// A popover rather than a third side panel. Settings and Logs are mutually
// exclusive panels, so making the account a third one would CLOSE the
// settings panel to show a balance — interrupting exactly the path this
// work exists to smooth. The product already splits the two languages:
// panels for sustained configuration, popovers for a glance.
import React from 'react';
import {
  useFloating, useDismiss, useInteractions, FloatingPortal,
  offset, flip, shift, size, autoUpdate,
} from '@floating-ui/react';
import { useAuth } from '../../lib/auth/hooks';
import { UserAccountInfo } from '../Auth/UserAccountInfo';
import './AccountPopover.scss';

interface AccountPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const AccountPopover: React.FC<AccountPopoverProps> = ({ open, anchorEl, onClose }) => {
  const { isSignedIn } = useAuth();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'bottom-end',
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${availableHeight}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  React.useEffect(() => {
    refs.setReference(anchorEl);
  }, [anchorEl, refs]);

  if (!open) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="account-popover"
        {...getFloatingProps()}
      >
        {isSignedIn && <UserAccountInfo />}
      </div>
    </FloatingPortal>
  );
};

export default AccountPopover;
```

- [ ] **Step 4: Style it with the sibling popover's values**

```scss
// src/components/TitleBar/AccountPopover.scss
// Values copied from ModeDevicePopover.scss so the two popovers are one
// control in two places rather than two lookalikes that drift.
.account-popover {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 8px;
  width: 320px;
  font-size: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  color: #ccc;
  z-index: 1000;
  overflow: hidden;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/TitleBar/AccountPopover.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/TitleBar/AccountPopover.tsx src/components/TitleBar/AccountPopover.scss \
        src/components/TitleBar/AccountPopover.test.tsx
git commit -m "feat(titlebar): account popover for the signed-in state"
```

---

## Task 6: AccountPopover — signed-out state and the rewritten copy

A returning user on a new device has an account, so this must not drop them on a
registration form. Both routes are button-weight; sign-in is not demoted to a text
link.

The copy is rewritten because the current line opens by telling the reader they do
not need to log in and describes registering as a purchase — on the one control whose
job is to produce registrations.

**Files:**
- Modify: `src/components/TitleBar/AccountPopover.tsx`, `AccountPopover.scss`
- Modify: all `src/locales/*/translation.json` (`simpleConfig.signInRequired`)
- Test: `src/components/TitleBar/AccountPopover.test.tsx`

- [ ] **Step 1: Write the failing test (append)**

```tsx
describe('AccountPopover signed out', () => {
  it('offers both routes, so a returning user is not stranded on sign-up', () => {
    signedIn = false;
    render(<AccountPopover open anchorEl={document.body} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sign up/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('navigates to the right route from each button', () => {
    signedIn = false;
    const nav = vi.fn();
    navigateImpl = nav;
    render(<AccountPopover open anchorEl={document.body} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(nav).toHaveBeenCalledWith('/sign-up');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(nav).toHaveBeenCalledWith('/sign-in');
  });
});
```

Change the router mock to a mutable one and import `fireEvent`:

```tsx
let navigateImpl = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateImpl }));
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/TitleBar/AccountPopover.test.tsx`
Expected: FAIL — no Sign Up / Sign In buttons.

- [ ] **Step 3: Implement**

Replace the popover body with:

```tsx
        {isSignedIn ? (
          <UserAccountInfo />
        ) : (
          <>
            <p className="account-popover__msg">
              {t('simpleConfig.signInRequired',
                 "Sign up to use Sokuji's built-in translation service — no API key needed. You can also keep using your own provider and key.")}
            </p>
            <div className="account-popover__btns">
              <button
                type="button"
                className="account-popover__btn account-popover__btn--primary"
                onClick={() => { navigate('/sign-up'); onClose(); }}
              >
                {t('common.signUp', 'Sign Up')}
              </button>
              <button
                type="button"
                className="account-popover__btn account-popover__btn--ghost"
                onClick={() => { navigate('/sign-in'); onClose(); }}
              >
                {t('common.signIn', 'Sign In')}
              </button>
            </div>
          </>
        )}
```

with `const { t } = useTranslation();` and `const navigate = useNavigate();` added.

- [ ] **Step 4: Style it**

```scss
// inside .account-popover
&__msg { padding: 13px 14px 4px; font-size: 12px; line-height: 1.55; color: #bdbdbd; }
&__btns { display: flex; gap: 8px; padding: 11px 14px 14px; }
&__btn {
  flex: 1; height: 32px; border-radius: 5px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; font-family: inherit;

  &--primary { background: #10a37f; color: #fff; &:hover { background: #0e9070; } }
  &--ghost {
    background: transparent; color: #ccc; border-color: #555;
    &:hover { background: rgba(255, 255, 255, 0.07); border-color: #6a6a6a; }
  }
}
```

- [ ] **Step 5: Rewrite `simpleConfig.signInRequired` in `en` only**

- en: `Sign up to use Sokuji's built-in translation service — no API key needed. You can also keep using your own provider and key.`
- zh_CN: `注册后即可使用 Sokuji 自带的翻译服务，无需申请任何 API key。也可以继续使用你自己的服务商和密钥。`
Only `en` here. Task 15 carries the rule for the other 29: same two-sentence shape —
what signing up gives first, bring-your-own-key as the fallback, no mention of
purchase in the first sentence — reusing each catalogue's existing rendering of
"API key". zh_CN is fixed at
`注册后即可使用 Sokuji 自带的翻译服务，无需申请任何 API key。也可以继续使用你自己的服务商和密钥。`

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/TitleBar/AccountPopover.test.tsx`
Expected: PASS, 4 popover tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar/AccountPopover.tsx src/components/TitleBar/AccountPopover.scss \
        src/components/TitleBar/AccountPopover.test.tsx src/locales/en
git commit -m "feat(titlebar): signed-out account popover with both routes"
```

---

## Task 7: Connect the popover to the button

Tasks 2–3 built the button and Tasks 5–6 built the popover, but nothing opens one
from the other yet. `AccountButton` owns the open state and the anchor, because the
popover anchors to the button's own element — no anchor travels between components.

**Files:**
- Modify: `src/components/TitleBar/AccountButton.tsx`
- Test: `src/components/TitleBar/AccountButton.test.tsx`

**Interfaces:**
- Consumes: `AccountPopover` (Tasks 5–6).
- Produces: clicking `button.account-button` toggles the popover.

- [ ] **Step 1: Write the failing test (append)**

```tsx
describe('AccountButton popover', () => {
  it('opens the popover on click and closes it on a second click', () => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
    render(<AccountButton />);
    const btn = screen.getByRole('button');
    expect(screen.queryByTestId('account-popover')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId('account-popover')).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId('account-popover')).toBeNull();
  });

  it('opens the popover while signed out too — that is the registration entry', () => {
    render(<AccountButton />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('account-popover')).toBeTruthy();
  });
});
```

Add to the mocks at the top of the file, and import `fireEvent`:

```tsx
vi.mock('./AccountPopover', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="account-popover" /> : null,
}));
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: FAIL — clicking renders no popover.

- [ ] **Step 3: Implement**

Both branches of `AccountButton` render the same wrapper, so the popover is mounted
once regardless of sign-in state:

```tsx
import AccountPopover from './AccountPopover';

const [open, setOpen] = useState(false);
const btnRef = useRef<HTMLButtonElement | null>(null);
```

Give both `<button>` elements `ref={btnRef}`, `onClick={() => setOpen((v) => !v)}` and
`aria-expanded={open}`, then render after each button:

```tsx
<AccountPopover open={open} anchorEl={btnRef.current} onClose={() => setOpen(false)} />
```

Restructure so the two branches differ only in their inner content and share one
wrapping fragment — duplicating the popover in both branches would mount it twice.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/TitleBar/AccountButton.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.test.tsx
git commit -m "feat(titlebar): open the account popover from the account button"
```

---

## Task 8: Wire into TitleBar; logs behind advanced mode

Removing the logs button is what pays for the account slot: measured, Electron
Win/Linux goes from "safe only above 685px" to "safe above 335px", and the Tamil
overflow that exists in today's build at 580–590px disappears with it.

**Files:**
- Modify: `src/components/TitleBar/TitleBar.tsx`
- Modify: `src/components/MainLayout/MainLayout.tsx`
- Test: `src/components/TitleBar/TitleBar.test.tsx` (create),
  `src/components/MainLayout/MainLayout.logsMode.test.tsx` (create)

**Interfaces:**
- Consumes: `AccountButton` (Tasks 2–3), `AccountPopover` (Tasks 5–6).
- Produces: `TitleBarProps` gains `showLogsButton: boolean`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/TitleBar/TitleBar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import TitleBar from './TitleBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('../../utils/environment', () => ({ isElectron: () => true, isMacOS: () => false }));
vi.mock('../Subtitle/SubtitleEnterButton', () => ({ default: () => <button>subtitle</button> }));
vi.mock('./AccountButton', () => ({ default: () => <button className="account-button" /> }));

const props = {
  showSettings: false, showLogs: false,
  onToggleSettings: vi.fn(), onToggleLogs: vi.fn(),
};

beforeEach(cleanup);

describe('TitleBar', () => {
  it('hides the logs button in basic mode', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={false} />);
    expect(container.querySelector('.logs-button')).toBeNull();
  });

  it('shows the logs button in advanced mode', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={true} />);
    expect(container.querySelector('.logs-button')).toBeTruthy();
  });

  it('places the account slot before the subtitle button', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={true} />);
    const actions = container.querySelector('.title-bar__actions')!;
    expect(actions.firstElementChild!.classList.contains('account-button')).toBe(true);
  });
});
```

```tsx
// src/components/MainLayout/MainLayout.logsMode.test.tsx
// A logs panel opened in advanced mode must not survive a switch to basic:
// the button that closes it is gone, stranding the panel open.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCloseLogsOutsideAdvanced } from './useCloseLogsOutsideAdvanced';

beforeEach(() => { sessionStorage.clear(); });

describe('useCloseLogsOutsideAdvanced', () => {
  it('closes an open logs panel when the mode becomes basic', () => {
    const setShowLogs = vi.fn();
    sessionStorage.setItem('panelState.showLogs', 'true');
    renderHook(({ mode }) => useCloseLogsOutsideAdvanced(mode, true, setShowLogs), {
      initialProps: { mode: 'basic' as const },
    });
    expect(setShowLogs).toHaveBeenCalledWith(false);
    expect(sessionStorage.getItem('panelState.showLogs')).toBe('false');
  });

  it('leaves the panel alone in advanced mode', () => {
    const setShowLogs = vi.fn();
    renderHook(() => useCloseLogsOutsideAdvanced('advanced', true, setShowLogs));
    expect(setShowLogs).not.toHaveBeenCalled();
  });

  it('does nothing when the panel is already closed', () => {
    const setShowLogs = vi.fn();
    renderHook(() => useCloseLogsOutsideAdvanced('basic', false, setShowLogs));
    expect(setShowLogs).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/TitleBar/TitleBar.test.tsx src/components/MainLayout/MainLayout.logsMode.test.tsx`
Expected: FAIL — `showLogsButton` is not a prop; `useCloseLogsOutsideAdvanced` does not exist.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/MainLayout/useCloseLogsOutsideAdvanced.ts
//
// showLogs is persisted in sessionStorage, and the logs button only exists
// in advanced mode. Without this, a user who opens logs in advanced and
// switches to basic is left with an open panel and nothing to close it with.
// The panel is CLOSED, not suspended: switching back to advanced does not
// reopen it, which is the predictable reading of a cleared flag.
import { useEffect } from 'react';

export function useCloseLogsOutsideAdvanced(
  uiMode: string,
  showLogs: boolean,
  setShowLogs: (next: boolean) => void,
): void {
  useEffect(() => {
    if (uiMode !== 'advanced' && showLogs) {
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
    }
  }, [uiMode, showLogs, setShowLogs]);
}
```

- [ ] **Step 4: Change TitleBar**

Add `showLogsButton: boolean` to `TitleBarProps`, render `<AccountButton />` as the
first child of `.title-bar__actions` (before `<SubtitleEnterButton />`), and wrap the
logs `<button>` in `{showLogsButton && ( … )}`.

- [ ] **Step 5: Change MainLayout**

Call the hook and pass the prop:

```tsx
useCloseLogsOutsideAdvanced(uiMode, showLogs, setShowLogs);
// …
<TitleBar
  showSettings={showSettings}
  showLogs={showLogs}
  showLogsButton={uiMode === 'advanced'}
  onToggleSettings={toggleSettings}
  onToggleLogs={toggleLogs}
/>
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/TitleBar src/components/MainLayout`
Expected: PASS. `MainLayout.keepAlive.test.tsx` may need its `TitleBar` mock updated.

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar src/components/MainLayout
git commit -m "feat(titlebar): mount the account slot and gate logs to advanced mode"
```

---

## Task 9: Remove AccountSection

Every item has a destination: header, balance, actions and the verify button move to
the popover; the signed-out buttons and prompt become the popover's signed-out state;
the heading tooltip's claim is already made by the rewritten `signInRequired`.

**Files:**
- Delete: `src/components/Settings/sections/AccountSection.tsx`, `AccountSection.test.tsx`
- Modify: `src/components/Settings/sections/index.ts:1`
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx:15,170` (import + usage)
- Modify: `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx:19,116` (import + usage)
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.engine.test.tsx:42`
  (drop the `AccountSection` entry from the `../sections` mock — it will otherwise
  stub a module export that no longer exists)

**Advanced mode is affected too, and that is correct.** `AccountSection` renders in
BOTH surfaces: `SimpleSettings` and the `general` tab of `AdvancedSettings`. The
earlier design discussion only ever named the simple panel, so this is stated
explicitly rather than discovered during execution: advanced users lose the settings
block as well and use the title-bar entry, which is present in both modes. Nothing
about the account is mode-specific, so one entry serving both is the consistent
outcome.

- [ ] **Step 1: Write the failing test**

Create `src/components/Settings/SimpleSettings/SimpleSettings.account.test.tsx`,
copying the mock preamble from the neighbouring `SimpleSettings.engine.test.tsx`.

```tsx
it('renders no account section, whatever the provider', () => {
  const { container } = render(<SimpleSettings />);
  expect(container.querySelector('#user-account-section')).toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — the section still renders under a managed provider.

- [ ] **Step 3: Delete and unwire**

```bash
git rm src/components/Settings/sections/AccountSection.tsx \
       src/components/Settings/sections/AccountSection.test.tsx
```

Remove the `AccountSection` export from `sections/index.ts` and both its import and
its `<AccountSection />` usage from `SimpleSettings.tsx`. Keep `UserAccountInfo` — the
popover renders it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/Settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Settings
git commit -m "refactor(settings): drop AccountSection now the title bar carries the account"
```

---

## Task 10: Move interface language above HelpSection

It is set once and never revisited, yet sits second — first whenever the account
section was hidden — directly next to *Translation* languages, two adjacent sections
both named "language". Moving it makes translation languages the first thing in the
panel, which is what the panel is for.

**Files:**
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx:173-178`
- Test: `src/components/Settings/SimpleSettings/SimpleSettings.order.test.tsx` (create)

**Deliberately NOT changed: `AdvancedSettings`.** Its `general` tab also renders an
interface-language section (`AdvancedSettings.tsx:118-123`, the full 35-language list
rather than the simplified 12). It is left where it is: advanced mode is tabbed, so
`general` is already the miscellany drawer rather than the first thing between a user
and a translation, and the complaint that motivated this move — the setting occupying
the top of the panel a new user meets — does not apply there. If it should move too,
that is a separate decision, not an oversight here.

- [ ] **Step 1: Write the failing test**

```tsx
it('puts translation languages first and interface language last, before help', () => {
  const { container } = render(<SimpleSettings />);
  const ids = Array.from(container.querySelectorAll('.config-section'))
    .map((el) => el.id || el.className);
  const translation = ids.findIndex((x) => x.includes('languages-section'));
  const help = ids.findIndex((x) => x.includes('help'));
  const iface = ids.findIndex((x) => x.includes('interface-language'));
  expect(translation).toBeLessThan(iface);
  expect(iface).toBeLessThan(help);
});
```

This needs the interface instance to be identifiable, so give it
`id="interface-language-section"` when moving it — it currently has no `id`
(`LanguageSection.tsx:617`), which is also why onboarding is unaffected.

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — interface language currently precedes translation languages.

- [ ] **Step 3: Move it**

Cut the first `<LanguageSection showInterfaceLanguage={true} …/>` block and paste it
immediately before `<HelpSection />`. Add the `id` prop plumbed through to the
section's root div in `LanguageSection.tsx`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/Settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings
git commit -m "refactor(settings): move interface language to the bottom of the list"
```

---

## Task 11: Onboarding — delete basic step 2, fold it into step 4

Step 2 targets `#user-account-section`, which Task 8 deletes. Re-pointing it at
`#provider-section` is not viable: step 4 already targets that element, and two
consecutive steps spotlighting one element reads as a bug.

**Files:**
- Modify: `src/contexts/OnboardingContext.tsx:71-73` (delete the step), `:83-85` (copy),
  and the stale comment at `:43` explaining why the account step exists
- Modify: `src/components/Onboarding/Onboarding.tsx:23` — delete the
  `'#user-account-section': 'user-account'` entry from `TARGET_NAVIGATION_MAP`. It maps
  a step target that will no longer exist to a settings tab that will no longer exist.
- Modify: all `src/locales/*/translation.json` (`onboarding.basic.steps.*`)
- Test: `src/contexts/OnboardingContext.steps.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createBasicOnboardingSteps } from './OnboardingContext';

const t = (_k: string, d?: string) => d ?? _k;

describe('basic onboarding steps', () => {
  it('no longer targets the deleted account section', () => {
    const targets = createBasicOnboardingSteps(t as any).map((s) => s.target);
    expect(targets).not.toContain('#user-account-section');
  });

  it('spotlights each element at most once', () => {
    const targets = createBasicOnboardingSteps(t as any).map((s) => s.target);
    const elementTargets = targets.filter((x) => x !== 'body');
    expect(new Set(elementTargets).size).toBe(elementTargets.length);
  });

  it('has eight steps', () => {
    expect(createBasicOnboardingSteps(t as any)).toHaveLength(8);
  });
});
```

`createBasicOnboardingSteps` must be exported if it is not already.

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — nine steps, one targeting `#user-account-section`.

- [ ] **Step 3: Delete the step and extend step 4's copy**

Remove the step object at `:70-74`. Extend the provider step's copy so the built-in
service is still introduced — English default:

`Choose your translation provider. Sokuji has its own built-in service — sign up from the account button in the title bar and it works with no API key. You can also use OpenAI, Gemini, Volcengine (Doubao), or Local Inference, which needs no key at all.`

- [ ] **Step 4: Renumber "Step N" prefixes in `en` only**

`onboarding.basic.steps.{languages,provider,microphone,speaker,systemAudio,start}.title`
each shift down by one (Step 3→2, 4→3, …, 8→7) — in `en` only. This one is mechanical
in every locale, so Task 15 can do the other 29 by the same shift.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/contexts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/OnboardingContext.tsx src/contexts/OnboardingContext.steps.test.ts src/locales/en
git commit -m "fix(onboarding): drop the step pointing at the removed account section"
```

---

## Task 12: Make the provider sign-in line an entry point

`ProviderSection.tsx:963` states a restriction with nothing to act on. Clicking opens
the title-bar popover rather than navigating: the sign-in affordance is then
maintained in one place, and watching the popover open teaches the user where the
account entry lives.

**Files:**
- Modify: `src/stores/settingsStore.ts` (new state + setter + selectors)
- Modify: `src/components/TitleBar/AccountButton.tsx` (consume the flag)
- Modify: `src/components/Settings/sections/ProviderSection.tsx:961-964`
- Modify: all `src/locales/*/translation.json` (`common.signInRequired`)
- Test: `src/components/Settings/sections/ProviderSection.signIn.test.tsx` (create)

**Interfaces:**
- Produces: `accountPopoverRequested: boolean`,
  `setAccountPopoverRequested(next: boolean): void`,
  `useAccountPopoverRequested()`, `useSetAccountPopoverRequested()` — mirroring the
  existing `settingsNavigationTarget` handshake.

- [ ] **Step 1: Write the failing test**

```tsx
it('turns the sign-in notice into a control that opens the account popover', () => {
  const setRequested = vi.fn();
  setRequestedImpl = setRequested;
  signedIn = false;
  providerId = 'kizunaai_soniox';
  render(<ProviderSection isSessionActive={false} />);
  fireEvent.click(screen.getByRole('button', { name: /sign in or sign up/i }));
  expect(setRequested).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — the notice is a `<span>`, not a control.

- [ ] **Step 3: Add the store handshake**

```ts
// settingsStore.ts — beside settingsNavigationTarget
accountPopoverRequested: false,
setAccountPopoverRequested: (next: boolean) => set({ accountPopoverRequested: next }),
```

plus the two selector exports.

- [ ] **Step 4: Render the notice with a link**

```tsx
import { Trans } from 'react-i18next';
// …
<div className="api-key-warning">
  <AlertCircle size={16} className="warning-icon" />
  <span>
    <Trans
      i18nKey="common.signInRequired"
      components={{
        signInLink: (
          <button
            type="button"
            className="sign-in-link"
            onClick={() => setAccountPopoverRequested(true)}
          />
        ),
      }}
    />
  </span>
</div>
```

en copy: `<signInLink>Sign in or sign up</signInLink> to use Kizuna AI — no API key needed.`

- [ ] **Step 5: Have AccountButton honour the flag**

```tsx
const requested = useAccountPopoverRequested();
const setRequested = useSetAccountPopoverRequested();
useEffect(() => {
  if (requested) { setOpen(true); setRequested(false); }
}, [requested, setRequested]);
```

- [ ] **Step 6: Update `common.signInRequired` in `en` only**

`en` only, keeping the `<signInLink>` markers — Task 15 must preserve them in every
translation or `<Trans>` renders no link at all. zh_CN is fixed at
`<signInLink>登录或注册</signInLink>即可使用 Kizuna AI，无需 API key。`

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/Settings/sections src/components/TitleBar`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/stores/settingsStore.ts src/components/Settings/sections src/components/TitleBar src/locales/en
git commit -m "feat(settings): make the provider sign-in notice open the account popover"
```

---

## Task 13: Stop showing raw engineering strings to signed-out users

**Reproduced — this is deterministic, not a race.** The chain, verified by reading it:

1. `SettingsInitializer.tsx:101-110` has a branch whose own comment says it exists for
   the signed-out case ("Kizuna twin selected but auth is missing (signed out or hook
   not ready)"). It calls `await validateApiKey(getToken)`.
2. `getToken` comes from `useAuth()` (`src/lib/auth/hooks.ts:22-26`) and is **always a
   function**, signed in or not. Signed out it resolves to `null`; it is never
   undefined. So `validateApiKey`'s `getAuthToken ? … : false` always takes the
   truthy branch.
3. `settingsStore.ts:897` then calls `ensureKizunaApiKey(getAuthToken, true)`. The
   literal `true` skips the guard at `:1051-1055` that exists for exactly this case
   and would have set `'User not signed in'`.
4. `await getToken()` returns `null`, so `:1069` stores `'Failed to get auth session'`,
   and `ProviderSection.tsx:952` renders it verbatim.

So a signed-out user who selects a Kizuna-managed provider **always** sees that
string. The irony is worth noting in the commit message: the branch was written to
handle being signed out, and produces a message about a session failure instead.

**Files:**
- Modify: `src/stores/settingsStore.ts:896-899`, `:1041-1080`
- Modify: `src/components/Settings/sections/ProviderSection.tsx:952`
- Test: `src/stores/settingsStore.kizunaAuth.test.ts` (create)

- [ ] **Step 1: Write the failing test**

The failing test reproduces step 2 above — a `getToken` that is present but resolves
to `null`, which is exactly what a signed-out `useAuth()` hands over:

```ts
it('does not store a raw engineering string when the user is signed out', async () => {
  useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
  await useSettingsStore.getState().validateApiKey(async () => null);
  expect(useSettingsStore.getState().kizunaKeyError).not.toBe('Failed to get auth session');
});

it('stores a code the UI can translate, never English prose', async () => {
  useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
  await useSettingsStore.getState().validateApiKey(async () => null);
  const err = useSettingsStore.getState().kizunaKeyError;
  expect(err).toMatch(/^auth\./);   // e.g. 'auth.signedOut'
});
```

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL — the store holds `'Failed to get auth session'`.

- [ ] **Step 3: Pass the real signed-in state**

`settingsStore.ts:897` — replace the hardcoded `true`:

```ts
        // Was hardcoded `true`, which made ensureKizunaApiKey's own
        // signed-out guard unreachable from this call site: every failure
        // fell through to the generic "Failed to get auth session" branch,
        // including an expired session.
        const hasKey = getAuthToken
          ? await state.ensureKizunaApiKey(getAuthToken, isSignedIn)
          : false;
```

`validateApiKey` must take the signed-in state; thread it from the call sites.

- [ ] **Step 4: Store codes, log the prose**

Change every `set({kizunaKeyError: …})` to store a key (`'auth.signedOut'`,
`'auth.sessionUnavailable'`, `'auth.unknown'`) and `console.warn` the raw text.
At `ProviderSection.tsx:952` render `t(kizunaKeyError)` instead of the raw value, and
add those three keys to `en` only; Task 15 translates them.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/stores src/components/Settings/sections`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stores/settingsStore.ts src/components/Settings/sections src/locales \
        src/stores/settingsStore.kizunaAuth.test.ts
git commit -m "fix(auth): stop surfacing untranslated auth errors to signed-out users"
```

---

## Task 14: Close the e-mail verification loop

Verification is polled only while the 60-second resend cooldown runs
(`UserAccountInfo.tsx:108-152`). Clicking a link in an e-mail almost always takes
longer, so the user returns to an app that shows no change and says nothing. Task 8
makes it worse: that polling now only exists while the popover is open.

**Files:**
- Modify: `src/components/TitleBar/AccountButton.tsx`
- Create: `src/components/TitleBar/useVerificationRefresh.ts`
- Modify: all `src/locales/*/translation.json` (`auth.checkYourEmail`)
- Test: `src/components/TitleBar/useVerificationRefresh.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVerificationRefresh } from './useVerificationRefresh';

beforeEach(() => { vi.useFakeTimers(); });

describe('useVerificationRefresh', () => {
  it('refetches when the window regains focus while unverified', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(true, false, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch once the e-mail is verified', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(true, true, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('does not refetch while signed out', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(false, false, refetch));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('throttles a burst of focus events to one call per 10s', () => {
    const refetch = vi.fn();
    renderHook(() => useVerificationRefresh(true, false, refetch));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(10_001); window.dispatchEvent(new Event('focus')); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/components/TitleBar/useVerificationRefresh.ts
//
// The user finishes verifying in a BROWSER and switches back to Sokuji.
// Nothing else notices: the old polling ran only during the 60-second resend
// cooldown, and it lived in a component that is now mounted only while the
// popover is open. AccountButton is always mounted, so the listener lives here.
import { useEffect, useRef } from 'react';

const THROTTLE_MS = 10_000;

export function useVerificationRefresh(
  isSignedIn: boolean,
  emailVerified: boolean,
  refetch: () => void,
): void {
  const lastRef = useRef(0);

  useEffect(() => {
    if (!isSignedIn || emailVerified) return;

    const maybeRefetch = () => {
      const now = Date.now();
      if (now - lastRef.current < THROTTLE_MS) return;
      lastRef.current = now;
      refetch();
    };
    const onVisible = () => { if (!document.hidden) maybeRefetch(); };

    window.addEventListener('focus', maybeRefetch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', maybeRefetch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isSignedIn, emailVerified, refetch]);
}
```

- [ ] **Step 4: Use it in AccountButton and toast the transition**

`AccountButton` does not import the toast yet — add
`import { useToast } from '../Toast';` and `const { showToast } = useToast();`,
matching `SubtitleEnterButton`'s usage. Its test file needs
`vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));`.

```tsx
const { user, refetch } = useUser();
useVerificationRefresh(isSignedIn, user?.emailVerified === true, refetch);

// Confirm it happened — otherwise the only feedback is a warning disappearing,
// which is not feedback.
const wasVerified = useRef(user?.emailVerified === true);
useEffect(() => {
  const now = user?.emailVerified === true;
  if (!wasVerified.current && now) {
    showToast(t('auth.emailVerifiedToast', 'E-mail verified'), { variant: 'success' });
  }
  wasVerified.current = now;
}, [user?.emailVerified, showToast, t]);
```

- [ ] **Step 5: Update the message copy in `en` only**

`en` only. `auth.checkYourEmail` becomes
`Verification e-mail sent to {{email}}. Finish it in your inbox and come back — Sokuji picks it up automatically.`
and `auth.emailVerifiedToast` = `E-mail verified`. Task 15 must keep the `{{email}}`
interpolation intact in every translation.

The "automatically" is only honest because of Step 3 — do not ship this copy without it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/TitleBar`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar src/locales/en
git commit -m "fix(auth): pick up e-mail verification when the user returns to the app"
```

---

## Task 15: Propagate every new key to the other 29 locales

Tasks 2–14 each added their keys to `en` alone, which is why
`src/locales/locales.consistency.test.ts` has been red since Task 2. This task closes
it in one pass and is the last thing to land.

Doing it here rather than seven times over is deliberate: it keeps seven earlier tasks
from competing for the same 30 files, and it puts all the translation judgement in one
place where it can be reviewed as a unit.

**Files:**
- Modify: all of `src/locales/*/translation.json` **except** `en`
- Test: `src/locales/locales.consistency.test.ts` (existing — it does the checking)

**Interfaces:**
- Consumes: every key added to `en` by Tasks 2, 4, 6, 11, 12, 13 and 14.
- Produces: nothing new; it closes an intentionally open gap.

**Keys to translate** (read the current `en` value for each — do not retype it from
here, it may have been refined during implementation):

| Key | Note |
|---|---|
| `titleBar.account.label` | The word for a user account, nested inside each catalogue's existing `titleBar` object. Several catalogues already have this word under `simpleConfig.userAccount` — reuse it rather than inventing a synonym. |
| `common.topUp` | **zh_CN is fixed at 「充值」** — the English label was chosen to match it. Other locales use their own established wording for adding money to a balance. |
| `simpleConfig.signInRequired` | Two sentences: what signing up gives first, bring-your-own-key as the fallback. **Do not mention purchase in the first sentence** — the whole point of the rewrite. **zh_CN is fixed at** `注册后即可使用 Sokuji 自带的翻译服务，无需申请任何 API key。也可以继续使用你自己的服务商和密钥。` |
| `common.signInRequired` | **Must keep the `<signInLink>…</signInLink>` markers.** Without them `<Trans>` renders no link and the control silently stops working. **zh_CN is fixed at** `<signInLink>登录或注册</signInLink>即可使用 Kizuna AI，无需 API key。` |
| `auth.checkYourEmail` | **Must keep the `{{email}}` interpolation.** Promises automatic pickup — that promise is true because of Task 14, so do not soften it to "click refresh". |
| `auth.emailVerifiedToast` | Short toast text. |
| `auth.signedOut`, `auth.sessionUnavailable`, `auth.unknown` | User-facing renderings of the three auth error codes from Task 13. Plain language, not engineering language: these replace strings like "Failed to get auth session". |
| `onboarding.basic.steps.{languages,provider,microphone,speaker,systemAudio,start}.title` | Mechanical: the "Step N" number shifts down by one in each. Keep each locale's own word for "Step" and its own digit convention — **fa and bn use native digits**; copy the shape already in that catalogue rather than writing ASCII numerals into it. |
| `onboarding.basic.steps.provider.content` | Extended in Task 11 to introduce the built-in service. |

**Rules that matter more than fluency:**

- Never drop or rename an interpolation (`{{email}}`) or a `<Trans>` component marker
  (`<signInLink>`). A dropped marker does not fail any test — it silently removes a
  control from the UI.
- Reuse the catalogue's own existing terminology. Each of these files already renders
  "API key", "sign in", "account" in a settled way; matching it beats a fresh
  translation that reads correctly but differently from the screen around it.
- `onboarding.basic.steps.account.*` keys are **deleted**, not translated — Task 11
  removed that step.

- [ ] **Step 1: Confirm the gap is exactly what you think it is**

```bash
npx vitest run src/locales/locales.consistency.test.ts
```

Expected: FAIL, listing the missing keys per locale. That list is your worklist — work
from it, not from the table above, which can drift from what actually shipped.

- [ ] **Step 2: Translate**

Edit each of the 29 non-`en` catalogues. Keep each file's existing key order and
formatting; add nothing beyond the keys the failure list names.

- [ ] **Step 3: Confirm the suite closes**

```bash
npx vitest run src/locales/locales.consistency.test.ts
```

Expected: PASS.

- [ ] **Step 4: Confirm no marker was lost**

```bash
grep -L "signInLink" src/locales/*/translation.json   # must print nothing
grep -L "{{email}}" src/locales/*/translation.json    # must print nothing
```

Both must print nothing. A file listed here has lost its marker and will render a
broken control.

- [ ] **Step 5: Run the whole suite and compare against baseline**

```bash
npx vitest run
```

Expected: only the ~12 pre-existing baseline failures.

- [ ] **Step 6: Commit**

```bash
git add src/locales
git commit -m "i18n: translate the account slot's new keys into the remaining locales"
```

---

## Final verification

- [ ] `npx tsc --noEmit` reports **no errors in any file this work created or
      modified**. It will still report the 467 pre-existing errors elsewhere; that is
      the baseline, not a regression, and chasing it is out of scope.
- [ ] `npx vitest run` — compare failures against the pre-change baseline; ~12 files
      fail on a clean worktree, so only NEW failures count
- [ ] `npx vitest run` green (Task 15 closes
      the gap this plan deliberately opens at Task 2)
- [ ] Launch the app and check by eye: signed-out mark, signed-in circle, both dot
      states, popover in both states, logs button absent in basic mode and present in
      advanced, settings order, onboarding runs to completion
- [ ] Re-measure the title bar at 335px and 600px on Electron with the account slot
      mounted, confirming the predicted safe widths
- [ ] Report to jiangzhuo. **Do not push and do not open a PR.**

# Authentication as an Overlay — Design

**Date**: 2026-08-24
**Status**: Drafted for review by jiangzhuo. `file:line` references verified against
`worktree-feat-auth-overlay` at `c854c368` (main, with #437 merged).

## Problem

Signing in or out rebuilds the entire application.

It is worse than the phrase suggests, and it does not start where it appears to. The
visible symptom is that signing out calls `window.location.reload()`
(`UserAccountInfo.tsx:367`). The invisible half is signing *in*: `SignIn`, `SignUp` and
`ForgotPassword` are **siblings of `Home`** in the router (`App.tsx:20-34`), so the
moment a user clicks "Sign In" and the app navigates to `/sign-in`, the whole `Home`
tree unmounts — `UserProfileProvider`, `OnboardingProvider`, `SettingsInitializer`,
`MainLayout`, `MainPanel`. A live translation session dies with it. Signing in
successfully then navigates back to `/` and mounts all of it again from scratch,
re-initialising the audio service and reloading settings.

So the interruption happens when the user *reaches* for the account, not when they
finish with it.

## What the investigation turned up

Three things that change the shape of the work:

**`AuthLayout` is already the right component, in the wrong place.** It has a
container, a close button, and an `onClose` — the anatomy of a modal
(`AuthLayout.tsx:17-31`). What makes it a page rather than an overlay is its stylesheet:
`min-height: 100vh` over an opaque `#0d0d0d` (`AuthLayout.scss:1-8`). This is a CSS
change plus a mount-point change, not a rewrite. The `Modal` component is not needed.

**One of the four entry points is dead.** `guards.tsx:51`'s
`navigate('/sign-in', { replace: true })` lives in `RedirectToSignIn`, which is used
only by `AuthGuard`, which **nothing mounts anywhere in the app**. The live entries are
just three: two buttons in `AccountPopover` (`:93`, `:100`) and the return path from
`ForgotPasswordForm:188`.

**Sign-out needs the reload for one specific reason, and it is fixable.**
`UserProfileContext`'s fetch effect reads
`if (isSignedIn && userId) fetchQuota()` (`:172-176`). `fetchQuota` itself clears the
quota when signed out (`:96-99`) — but that branch is unreachable, because the effect
only *calls* it while signed in. So on sign-out the stale balance simply stays. The
reload is a sledgehammer for a missing `else`. The Kizuna store state does not have
this problem: `SettingsInitializer:101-110` already re-validates on sign-out and clears
`isApiKeyValid`/`availableModels`.

## Design

**Authentication renders above `Home`, never instead of it.**

1. **Router.** Delete the `sign-in/*`, `sign-up/*` and `forgot-password` routes from
   `App.tsx`. `Home` becomes the only child of `RootLayout` and stops unmounting.

2. **Mount point.** A new `AuthOverlay` renders inside `Home`, as a sibling of
   `MainLayout`, showing `SignInForm` / `SignUpForm` / `ForgotPasswordForm` inside the
   existing `AuthLayout` shell.

3. **State.** `settingsStore` gains `authOverlay: 'sign-in' | 'sign-up' | 'forgot-password' | null`
   plus a setter, mirroring the `accountPopoverRequested` handshake that #437 already
   established. The three live entry points set it instead of navigating; closing sets
   it to `null`.

4. **Styling.** `AuthLayout` becomes `position: fixed; inset: 0` with a scrim. The form
   card needs its own solid background, which it does not have today — it inherits the
   page's.

5. **Sign-out.** Replace `window.location.reload()` with the missing `else`:
   `UserProfileContext` clears the quota when signed out. `authClient.signOut()` already
   clears the session and `SettingsInitializer` already re-validates.

### The one open visual decision

**How opaque is the scrim?** A translucent scrim keeps the user's context visible —
they can see the provider they were configuring behind the form, which is the main
reason to do this at all. But the form currently has no background of its own, so
"translucent" is only legible once the card gets one.

This is a decision to make by rendering, not by argument. Implementation renders both
against the real app and settles it there.

## Not in scope

- **`AuthGuard` and `RedirectToSignIn` are dead code** — nothing mounts them. Deleting
  them is correct and unrelated; it belongs in its own change so this one stays about
  the overlay.
- Deep-linking to `/sign-in`. Nothing links there today (the app is a desktop window
  and a side panel, not a website), and the routes being deleted are the only thing
  that made it possible.

## Risks

**A session surviving sign-in is the whole point, and no test can prove it.** The
failure mode is "the tree unmounted", which unit tests do not observe — they mount the
component under test directly. Verification is: start a translation session, sign in,
confirm the session is still running. This must be done in the real app.

**Focus and Escape.** A full-page route got these free from the browser. An overlay
does not: focus has to move into the form when it opens and return to the opener when
it closes, and Escape should close it. `AccountPopover` already solves the same problem
with `FloatingFocusManager`; this needs the equivalent.

## Verification

- Unit: the store handshake, each entry point setting the right overlay, the close path
  clearing it, and `UserProfileContext` clearing the quota on sign-out.
- By hand, in the running app: a live session survives sign-in; sign-out leaves no
  stale balance; Escape closes; focus lands in the form and returns to the opener.
- Type check A/B and the full suite against baseline, per the house rules in the #437
  plan.

// src/components/Tour/steps.ts
//
// Chapter 1 of the tour (spec §2.2): one catalogue, each step gated by a
// predicate over TourCtx. No store imports — `prepare` receives the actions
// it may take, so this file stays pure and its predicate table is testable
// as data.
import type { Placement } from '@floating-ui/react';
import type { TourCtx } from './tourContext';

export interface TourActions {
  /** Open the settings panel and scroll/highlight `target` (a navigateToSettings key). */
  openSettings: (target: string | null) => void;
  closeSettings: () => void;
}

export interface TourStep {
  /** Also the i18n key root: tour.steps.<id>.{title,content[,content_<variant>]} */
  id: string;
  /** data-tour value; absent = centred card over a full scrim. */
  anchor?: string;
  when?: (ctx: TourCtx) => boolean;
  prepare?: (ctx: TourCtx, actions: TourActions) => void;
  placement?: Placement;
  copyVariant?: (ctx: TourCtx) => string | null;
}

const speaks = (c: TourCtx) => c.mode !== 'participant' && !c.textOnly;
const hasMic = (c: TourCtx) => c.mode !== 'participant';
const hasParticipant = (c: TourCtx) => c.mode !== 'speaker';

export const BASICS_STEPS: readonly TourStep[] = [
  { id: 'welcome' },
  { id: 'mode-picker', anchor: 'mode-picker', placement: 'top' },
  { id: 'microphone', anchor: 'microphone-section', when: hasMic, prepare: (_c, a) => a.openSettings('microphone'), placement: 'left' },
  { id: 'monitor', anchor: 'speaker-section', when: (c) => c.mode === 'speaker' && !c.textOnly, prepare: (_c, a) => a.openSettings('speaker'), placement: 'left' },
  {
    id: 'output-routing', when: speaks,
    // Electron is the only platform whose routing depends on the OS; web reads
    // the extension wording rather than a desktop's.
    copyVariant: (c) => (c.platform !== 'electron' ? 'extension' : c.os === 'linux' ? 'electronLinux' : 'electronOther'),
  },
  {
    id: 'participant-source', anchor: 'participant-section', when: hasParticipant,
    prepare: (_c, a) => a.openSettings('participant'), placement: 'left',
    // Only two copies exist; web takes the extension one.
    copyVariant: (c) => (c.platform === 'electron' ? 'electron' : 'extension'),
  },
  // SubtitleEnterButton renders on Electron and in the extension only, and an
  // absent anchor costs the step its full timeout before it skips itself.
  { id: 'subtitle', anchor: 'subtitle-enter', when: (c) => c.platform !== 'web', prepare: (_c, a) => a.closeSettings(), placement: 'bottom' },
  {
    id: 'account', anchor: 'account-button', when: (c) => c.providerPath === 'managed', placement: 'bottom',
    copyVariant: (c) => (c.isSignedIn ? null : 'signedOut'),
  },
  {
    id: 'provider-settings', anchor: 'provider-section', when: (c) => c.providerPath === 'own-key',
    prepare: (_c, a) => a.openSettings('provider'), placement: 'left',
    copyVariant: (c) => (c.apiKeyValid === true ? null : 'pending'),
  },
  { id: 'models', anchor: 'engine-chips', when: (c) => c.providerPath === 'offline', prepare: (_c, a) => a.openSettings('provider'), placement: 'left' },
  {
    id: 'start', anchor: 'main-action', prepare: (_c, a) => a.closeSettings(), placement: 'top',
    copyVariant: (c) =>
      c.providerPath === 'offline' ? 'offline'
      : c.providerPath === 'managed' && !c.isSignedIn ? 'signedOut'
      : c.providerPath === 'own-key' && c.apiKeyValid !== true ? 'pendingKey'
      : null,
  },
  { id: 'done' },
];

export function visibleSteps(ctx: TourCtx, catalogue: readonly TourStep[] = BASICS_STEPS): TourStep[] {
  return catalogue.filter((s) => !s.when || s.when(ctx));
}

export function titleKey(step: TourStep): string {
  return `tour.steps.${step.id}.title`;
}

export function contentKey(step: TourStep, ctx: TourCtx): string {
  const variant = step.copyVariant?.(ctx) ?? null;
  return `tour.steps.${step.id}.content${variant ? `_${variant}` : ''}`;
}

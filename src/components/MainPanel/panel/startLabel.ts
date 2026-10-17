import type { TFunction } from 'i18next';
import type { RunState } from '../../../lib/session/types';

/**
 * The main action button's "starting" label (1e-3 ruling 16): `Loading
 * (n/m)…` from the runner's own progress; a generic connecting/initializing
 * word otherwise, per site — today's keys (`initPhaseLabel`, `MainPanel.tsx:256-269`).
 */
export function startLabel(t: TFunction, run: RunState, site: 'basic' | 'advanced'): string | null {
  if (run.phase !== 'starting') return null;
  if (run.loading) {
    return site === 'basic'
      ? t('simplePanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: run.loading.done, total: run.loading.total })
      : t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: run.loading.done, total: run.loading.total });
  }
  // A managed lease waiting out the account's previous session (an ended one being charged, or keys it never used):
  // a word no wider than the voice claim's, the reason in the button's hover text (`PanelFooter`).
  if (run.step === 'waiting') {
    return site === 'basic'
      ? t('simplePanel.waitingForPreviousSession', 'Waiting…')
      : t('mainPanel.waitingForPreviousSession', 'Waiting…');
  }
  // The provider's `prepare` (Kizuna Soniox's voice claim): today's "Preparing your voice…" (`initPhaseLabel`), for any provider's prepare (choice 16).
  if (run.step === 'preparing') {
    return site === 'basic'
      ? t('simplePanel.preparingVoice', 'Preparing your voice…')
      : t('mainPanel.preparingVoice', 'Preparing your voice…');
  }
  return site === 'basic'
    ? t('simplePanel.connecting', 'Connecting...')
    : t('mainPanel.initializing', 'Initializing...');
}

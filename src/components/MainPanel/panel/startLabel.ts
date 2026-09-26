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
  return site === 'basic'
    ? t('simplePanel.connecting', 'Connecting...')
    : t('mainPanel.initializing', 'Initializing...');
}

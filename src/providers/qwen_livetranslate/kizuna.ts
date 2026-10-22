import { kizunaHostedIcon, QwenMonoIcon, QWEN_PLATE } from '../../components/Icons/ProviderIcons';
import { managed } from '../../lib/provider/managed';
import { kizunaQwenMinimumBalance } from './kizunaBudget';
import { createQwenLease } from './lease';
import { qwenLiveTranslateProvider } from './provider';
import { KizunaQwenSettingsView, QwenVoiceSummary } from './QwenSettings';

/**
 * Kizuna AI's managed Qwen LiveTranslate (spec 2026-10-17-kizuna-managed-qwen):
 * Qwen's languages, builder and adapter under its own id and slice; the
 * sign-in in place of a key; the lease that buys the run's token and ends
 * the run with its grant; the balance floor. Unflagged by the owner on
 * 2026-10-22: a release offers it wherever the Kizuna umbrella is on.
 */
export const kizunaQwenProvider = managed(qwenLiveTranslateProvider, {
  id: 'kizunaai_qwen',
  vendor: 'Qwen',
  // Qwen's colour mark is transparent, so the Kizuna mark's white strokes show
  // through it; on a white plate it would twin Kizuna Soniox's badge.
  icon: kizunaHostedIcon(QwenMonoIcon, { plate: QWEN_PLATE, inset: 0.82, color: '#fff' }),
  settingsKey: 'kizunaQwen',
  // The shared view under a Region dropdown: the region is the managed session's, an own key has none.
  Settings: KizunaQwenSettingsView,
  VoiceSummary: QwenVoiceSummary,
  signedOut: 'Sign in to use Kizuna AI Qwen.',
  session: { acquire: createQwenLease(), minimumBalance: kizunaQwenMinimumBalance },
});

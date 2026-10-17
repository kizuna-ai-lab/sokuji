import { kizunaHostedIcon, QwenMonoIcon, QWEN_PLATE } from '../../components/Icons/ProviderIcons';
import { managed } from '../../lib/provider/managed';
import { kizunaQwenMinimumBalance } from './kizunaBudget';
import { createQwenLease } from './lease';
import { qwenLiveTranslateProvider } from './provider';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';

/**
 * Kizuna AI's managed Qwen LiveTranslate (spec 2026-10-17-kizuna-managed-qwen):
 * Qwen's languages, builder and adapter under its own id and slice; the
 * sign-in in place of a key; the lease that buys the run's token and ends
 * the run with its grant; the balance floor. Flagged: a release offers it
 * only when `VITE_ENABLED_PROVIDERS` names it.
 */
export const kizunaQwenProvider = managed(qwenLiveTranslateProvider, {
  id: 'kizunaai_qwen',
  vendor: 'Qwen',
  // Qwen's colour mark is transparent, so the Kizuna mark's white strokes show
  // through it; on a white plate it would twin Kizuna Soniox's badge.
  icon: kizunaHostedIcon(QwenMonoIcon, { plate: QWEN_PLATE, inset: 0.82, color: '#fff' }),
  settingsKey: 'kizunaQwen',
  Settings: QwenSettingsView,
  VoiceSummary: QwenVoiceSummary,
  signedOut: 'Sign in to use Kizuna AI Qwen.',
  flagged: true,
  session: { acquire: createQwenLease(), minimumBalance: kizunaQwenMinimumBalance },
});

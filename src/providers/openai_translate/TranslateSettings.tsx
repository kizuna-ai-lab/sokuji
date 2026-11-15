import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NoiseReductionField } from '../../components/providers/fields/NoiseReductionField';
import type { SettingsProps } from '../../lib/provider/types';
import { NOISE_REDUCTIONS, type TranslateSettings } from './settings';
import { TR } from '../../lib/lineup/types';
import { StagePart } from '../../components/providers/stageParts';

/**
 * OpenAI Translate's own settings (D18): what the old tab showed for it once
 * the pair, the key and the speech mode have their generic homes — the info
 * banner, first, as it was (`ProviderSpecificSettings.tsx:2173-2183`), and
 * the noise reduction (choice 13). The model and the transcript model are
 * constants (rulings 7, 8); there is no transport to show (WebSocket only,
 * 2026-09-29); there are no turn-detection knobs.
 */
export function TranslateSettingsView({ settings, update, disabled = false }: SettingsProps<TranslateSettings>) {
  const { t } = useTranslation();
  return (
    <>
      <StagePart stages={TR}>
      <div className="settings-section translate-info-banner">
        <div className="info-banner">
          <Info size={14} />
          <span>{t('settings.translateInfoBanner')}</span>
        </div>
      </div>
      </StagePart>
      <StagePart stages={TR}>
      <NoiseReductionField value={settings.noiseReduction} options={NOISE_REDUCTIONS} onChange={(noiseReduction) => update({ noiseReduction })} disabled={disabled} />
      </StagePart>
    </>
  );
}

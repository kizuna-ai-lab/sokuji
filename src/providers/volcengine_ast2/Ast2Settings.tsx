import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/providers/fields/TextField';
import type { SettingsProps } from '../../lib/provider/types';
import type { Ast2Settings as S } from './settings';

/** The console's library pages (`ProviderSpecificSettings.tsx:1606-1694`). */
const CONSOLE = 'https://console.volcengine.com/speech';

/**
 * Doubao AST 2.0's own settings (D18; choice 16): the old UI's Custom
 * Vocabulary and info blocks (`ProviderSpecificSettings.tsx:1603-1716`), the
 * library ids in the shared `TextField`. The pair is the generic section's,
 * the speech mode the Speech section's, the credentials and their mode the
 * credential form's; there are no turn-detection knobs.
 */
export function Ast2SettingsView({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-section">
        <h2>{t('settings.volcengineAST2CustomVocabulary', 'Custom Vocabulary')}</h2>
        <TextField
          id="volcengine-ast2-hot-words"
          label={t('settings.volcengineAST2HotWordLibraryId', 'Hot Words Library ID')}
          tooltip={t('settings.volcengineAST2HotWordLibraryTooltip', 'Boost recognition of specific terms.')}
          link={{ href: `${CONSOLE}/hotword`, label: t('settings.volcengineAST2HotWordManage', 'Manage hot words') }}
          value={settings.hotWordTableId}
          onChange={(hotWordTableId) => update({ hotWordTableId })}
          disabled={disabled}
        />
        <TextField
          id="volcengine-ast2-replacement"
          label={t('settings.volcengineAST2ReplacementLibraryId', 'Replacement Library ID')}
          tooltip={t('settings.volcengineAST2ReplacementLibraryTooltip', 'Post-transcription regex text substitution. The referenced library must be a regex word list, not a standard replacement list.')}
          link={{ href: `${CONSOLE}/correctword`, label: t('settings.volcengineAST2ReplacementManage', 'Manage replacement') }}
          value={settings.replacementTableId}
          onChange={(replacementTableId) => update({ replacementTableId })}
          disabled={disabled}
        />
        <TextField
          id="volcengine-ast2-glossary"
          label={t('settings.volcengineAST2GlossaryLibraryId', 'Glossary Library ID')}
          tooltip={t('settings.volcengineAST2GlossaryLibraryTooltip', 'Source→target bilingual term pairs.')}
          link={{ href: `${CONSOLE}/glossary`, label: t('settings.volcengineAST2GlossaryManage', 'Manage glossary') }}
          value={settings.glossaryTableId}
          onChange={(glossaryTableId) => update({ glossaryTableId })}
          disabled={disabled}
        />
        <div className="setting-item" style={{ fontSize: '12px', color: '#888' }}>
          {t('settings.volcengineAST2CustomVocabularyFooter', "Invalid or empty library IDs are silently ignored — the session runs as if the field weren't set. Library changes made in the Volcengine console can take a few minutes to take effect.")}
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('settings.volcengineAST2Info', 'Doubao AST 2.0 Info')}</h2>
        <div className="setting-item">
          <div
            className="volcengine-info-notice"
            style={{ padding: '12px', backgroundColor: 'rgba(16, 163, 127, 0.1)', border: '1px solid rgba(16, 163, 127, 0.3)', borderRadius: '8px', fontSize: '13px', color: '#aaa' }}
          >
            <Info size={14} style={{ marginRight: '8px', verticalAlign: 'middle', color: '#10a37f' }} />
            {t('settings.volcengineAST2InfoText', "Doubao AST 2.0 provides speech-to-speech translation with automatic voice cloning. The translated audio preserves the original speaker's voice characteristics.")}
          </div>
        </div>
      </div>
    </>
  );
}

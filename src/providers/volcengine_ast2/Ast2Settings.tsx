import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/providers/fields/TextField';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import VoiceLibrarySection, { type VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import type { SettingsProps } from '../../lib/provider/types';
import type { VoiceLibraryCapability } from '../../types/VoiceLibrary';
import { voicesFor } from './catalog';
import { previewVoice } from './preview';
import type { Ast2Settings as S } from './settings';
import { CLONE, clonable, effectiveVoice } from './voice';

/** The console's library pages (`ProviderSpecificSettings.tsx:1606-1694`). */
const CONSOLE = 'https://console.volcengine.com/speech';

/** Doubao has no voice of the user's own to add, rename or delete; 500 voices need the facet bar (R3: gender, age and, since 2026-10-02, the categories; the target fixes the language, R4). */
const CAPABILITY: VoiceLibraryCapability = { importModes: [], facetFilter: true };
const NO_DELETE = async () => {};

/**
 * Doubao AST 2.0's own settings (D18; choice 16): the old UI's Custom
 * Vocabulary and info blocks (`ProviderSpecificSettings.tsx:1603-1716`), the
 * library ids in the shared `TextField`. The pair is the generic section's,
 * the speech mode the Speech section's, the credentials and their mode the
 * credential form's; there are no turn-detection knobs. The voice (#577
 * catalog §3) is the shared voice library, listing the run's target's
 * voices; picking one writes that target's slot only.
 */
export function Ast2SettingsView({ settings, update, disabled = false, pair, preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  // Every host passes the shown pair; only a component's own test omits it.
  const shown = pair ?? { source: 'zh', target: 'en' };
  const voices: VoiceEntry[] = [
    ...(clonable(shown) ? [{ id: CLONE, label: t('providers.volcengine_ast2.voiceClone', "Clone the speaker's voice"), group: 'builtin' as const, removable: false }] : []),
    ...voicesFor(shown.target).map((v): VoiceEntry => ({
      id: v.id,
      label: v.name,
      group: 'builtin',
      removable: false,
      previewable: true,
      meta: {
        gender: v.gender === 'male' ? 'M' : 'F',
        // Categories go in the use-case facet as they are, in Chinese; the description shows under the picker once chosen.
        facets: { gender: v.gender, age: v.age, useCase: [...v.categories], ...(v.description ? { description: v.description } : {}) },
      },
    })),
  ];
  return (
    <>
      {/* A text-only target no voice speaks and cloning cannot run (zh → ru) has nothing to pick: no section, not an empty one. */}
      {voices.length > 0 && <VoicePreviewContext.Provider value={preview ?? null}>
        <div className="settings-section" id="volcengine-ast2-voice-section">
          <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
          <VoiceLibrarySection
            voices={voices}
            selectedId={effectiveVoice(shown, settings) ?? ''}
            onSelect={(id) => update({ voices: { ...settings.voices, [shown.target]: id } })}
            onDelete={NO_DELETE}
            onPreview={(id, signal) => previewVoice(id, shown.target, signal)}
            capability={CAPABILITY}
            isSessionActive={disabled}
          />
        </div>
      </VoicePreviewContext.Provider>}
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
            {t('settings.volcengineAST2InfoText', "Doubao AST 2.0 provides speech-to-speech simultaneous interpretation. The translation can be spoken in the speaker's own cloned voice, or in a voice picked from its voice library.")}
          </div>
        </div>
      </div>
    </>
  );
}

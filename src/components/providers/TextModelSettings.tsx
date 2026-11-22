// src/components/providers/TextModelSettings.tsx
//
// A text-model provider's options on the line-up's Translation card (owner, 2026-11-22), and the same on its Notes
// card (text models, part C, `stage: 'notes'`): the model, chosen from the service's own list of text models
// ("Automatic" is the service's preferred one for the stage) or typed by name, which wins when filled; and the
// reasoning, Off, Lowest, Low, Medium or High, or a value typed by hand, sent as it is. A service that lists no model
// (a compatible one may not) shows only the name. Every one of these is the provider's own setting, per stage
// (`translationModel`, `translationReasoning`; `notesModel`, `notesReasoning`); its readiness check tries what is
// chosen.
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../Tooltip/Tooltip';
import { TL } from '../../lib/lineup/types';
import type { SettingsProps } from '../../lib/provider/types';
import { automaticModel, REASONING_LEVELS, type ModelChoice, type ReasoningChoice, type ReasoningLevel } from '../../lib/textModel/choice';
import type { TextModelService } from '../../lib/textModel/client';
import { failureNoticeCode } from '../../lib/textModel/check';
import { fingerprint } from '../../lib/textModel/fingerprint';
import type { TextModelStage } from '../../lib/textModel/models';
import { textModelList, type ModelListResult } from '../../lib/textModel/modelList';
import type { TextModelSettings } from '../../lib/textModel/unit';
import { noticeText } from '../../lib/view/noticeText';
import { TextField } from './fields/TextField';
import { StagePart } from './stageParts';

/** The level's words: three the reasoning select of OpenAI Realtime already has, two of their own. */
const LEVEL_WORDS: Readonly<Record<ReasoningLevel, { key: string; fallback: string }>> = {
  off: { key: 'settingsPage.textModel.off', fallback: 'Off' },
  lowest: { key: 'settingsPage.textModel.lowest', fallback: 'Lowest' },
  low: { key: 'settings.low', fallback: 'Low' },
  medium: { key: 'settings.medium', fallback: 'Medium' },
  high: { key: 'settings.high', fallback: 'High' },
};

/**
 * The service's text models, from the page's list (asked afresh when the card opens, then once per key and address),
 * or, while the list is on its way, from the provider's last ready check when it was made with this key and address.
 * 'none': there is nothing to ask with (no key, no address); 'loading': asked.
 */
/** How long the key and address must stay unchanged before the model list is asked for. */
export const MODEL_LIST_DELAY_MS = 500;

function useModelList(service: TextModelService, credentials: Readonly<Record<string, string>> | undefined, checked: readonly string[]): ModelListResult | 'none' | 'loading' {
  const baseUrl = service === 'compatible' ? credentials?.baseUrl ?? '' : undefined;
  const apiKey = credentials?.apiKey ?? '';
  const [answer, setAnswer] = useState<{ key: string; result: ModelListResult } | undefined>(undefined);
  // Which key and address: by a digest, never the key.
  const key = JSON.stringify([service, baseUrl ?? null, fingerprint([apiKey])]);
  // The key and address the last ready check's models are of: those in place when they came, or when the card opened.
  const found = JSON.stringify(checked);
  const [checkedFor, setCheckedFor] = useState({ found, key });
  if (checkedFor.found !== found) setCheckedFor({ found, key });
  const checkedNow = checkedFor.found !== found || checkedFor.key === key;
  // Nothing to ask with: no key for a service that needs one, or no address for a compatible one.
  const askable = service === 'compatible' ? (baseUrl ?? '').trim() !== '' : apiKey.trim() !== '';
  // The card's first list is asked afresh: a model the service added since the page last asked is offered.
  const fresh = useRef(true);
  useEffect(() => {
    if (!askable) return;
    let live = true;
    // After the key or address has stopped changing: a half-typed key is never sent to a half-typed address.
    const timer = setTimeout(() => {
      const again = fresh.current;
      fresh.current = false;
      void textModelList({ service, ...(baseUrl === undefined ? {} : { baseUrl }), apiKey }, again).then((result) => {
        if (live) setAnswer({ key, result });
      }, (error: unknown) => {
        // A list that could not be had says so, rather than "Finding models…" for ever.
        if (live) setAnswer({ key, result: { ok: false, failure: { code: 'network', message: error instanceof Error ? error.message : String(error) } } });
      });
    }, MODEL_LIST_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [askable, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!askable) return 'none';
  if (answer?.key === key) return answer.result;
  // Models found with another key or address are not this one's: its own list is awaited.
  return checkedNow && checked.length > 0 ? { ok: true, ids: [...checked] } : 'loading';
}

export interface TextModelSettingsViewProps extends SettingsProps<TextModelSettings> {
  service: TextModelService;
  /** Which stage's model and reasoning: the translation's (the Translation card's), by default, or the notes'. */
  stage?: TextModelStage;
}

/** The settings fields of each stage. */
const FIELDS = {
  translation: { model: 'translationModel', reasoning: 'translationReasoning' },
  notes: { model: 'notesModel', reasoning: 'notesReasoning' },
} as const;

/** The Translation card's options of a text-model provider, or the Notes card's. */
export function TextModelSettingsView({ service, settings, update, disabled = false, models = [], account, stage = 'translation' }: TextModelSettingsViewProps) {
  const { t } = useTranslation();
  const list = useModelList(service, account?.credentials, models.map((m) => m.id));
  const ids = typeof list === 'object' && list.ok ? list.ids : [];
  const fields = FIELDS[stage];
  const model: ModelChoice = settings[fields.model];
  const reasoning: ReasoningChoice = settings[fields.reasoning];
  const automatic = automaticModel(service, ids, stage);
  const setModel = (patch: Partial<ModelChoice>) => update({ [fields.model]: { ...model, ...patch } });
  const setReasoning = (patch: Partial<ReasoningChoice>) => update({ [fields.reasoning]: { ...reasoning, ...patch } });
  // A model chosen before that this list does not hold stays shown, chosen: the check says whether it still works.
  const listed = model.listed !== '' && !ids.includes(model.listed) ? [model.listed, ...ids] : ids;
  const typedModel = model.typed.trim() !== '';
  const typedReasoning = reasoning.typed.trim() !== '';
  // A compatible service that lists nothing has nothing to choose from: only the name. A model chosen from its list
  // before stays shown, with the way back to none.
  const listsNone = typeof list === 'object' && list.ok && ids.length === 0;
  const noList = listsNone && model.listed === '';
  // The Notes card's fields stand beside the Translation card's for the same provider: ids of their own.
  const idPrefix = stage === 'notes' ? `text-model-${service}-notes` : `text-model-${service}`;
  // A value typed wins over the list above it, which is disabled while it is filled.
  const overrides = t('settingsPage.textModel.typedOverrides', 'Overrides the selection above. Clear to use the list again.');
  const tooltip = stage === 'notes'
    ? t('settingsPage.textModel.notesReasoningTooltip', 'Medium, the default, asks each step of the notes for the reasoning it was tested with: Low for each part and for the live notes, Medium to finish them, and less where the model takes less. Any other choice, or a value typed, is sent exactly as it is with every request: if the model refuses it, the Notes card says so.')
    : t('settingsPage.textModel.reasoningTooltip', 'Lowest asks for the least reasoning the model takes, which is fastest. Any other choice is sent exactly as it is; if the model refuses it, the line-up says so before you start.');
  const body = (
    <div className="settings-section text-model-settings">
      {!noList && (
        <div className="setting-item">
          <div className="setting-label"><span>{t('settings.model', 'Model')}</span></div>
          <select className="select-dropdown" aria-label={t('settings.model', 'Model')} value={model.listed} disabled={disabled || typedModel}
            onChange={(e) => setModel({ listed: e.target.value })}>
            {service === 'compatible'
              ? <option value="">{t('settingsPage.textModel.chooseModel', 'Choose a model')}</option>
              : <option value="">{automatic ? t('settingsPage.textModel.automaticModel', 'Automatic ({{model}})', { model: automatic }) : t('settingsPage.textModel.automatic', 'Automatic')}</option>}
            {listed.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
      )}
      {list === 'loading' && <div className="models-info">{t('settingsPage.textModel.listing', 'Finding models…')}</div>}
      {typeof list === 'object' && !list.ok && (
        <div className="models-info">{noticeText(t, { code: failureNoticeCode(list.failure.code), message: list.failure.message })}</div>
      )}
      {listsNone && <div className="models-info">{t('settingsPage.textModel.listEmpty', "This service lists no models: type the model's name.")}</div>}
      <TextField id={`${idPrefix}-model-name`} label={t('settingsPage.textModel.modelName', 'Or type a model name')} value={model.typed}
        onChange={(typed) => setModel({ typed })} disabled={disabled} note={overrides} />
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('settings.reasoningEffort', 'Reasoning effort')}</span>
          <Tooltip content={tooltip} position="top">
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </div>
        <select className="select-dropdown" aria-label={t('settings.reasoningEffort', 'Reasoning effort')} value={reasoning.level} disabled={disabled || typedReasoning}
          onChange={(e) => setReasoning({ level: e.target.value as ReasoningLevel })}>
          {REASONING_LEVELS.map((level) => <option key={level} value={level}>{t(LEVEL_WORDS[level].key, LEVEL_WORDS[level].fallback)}</option>)}
        </select>
      </div>
      <TextField id={`${idPrefix}-reasoning-value`} label={t('settingsPage.textModel.reasoningValue', 'Or type a value, sent as it is')} value={reasoning.typed}
        onChange={(typed) => setReasoning({ typed })} disabled={disabled} note={overrides} />
    </div>
  );
  // The notes are no run stage: their card holds these options itself.
  return stage === 'notes' ? body : <StagePart stages={TL}>{body}</StagePart>;
}

/** A provider's `Settings`: the view, told which service it is. */
export function textModelSettingsView(service: TextModelService): ComponentType<SettingsProps<TextModelSettings>> {
  const View = (props: SettingsProps<TextModelSettings>) => <TextModelSettingsView service={service} {...props} />;
  View.displayName = `TextModelSettings(${service})`;
  return View;
}

// src/components/SettingsPage/FindModels.tsx
//
// "Find models" on a compatible service's row in Accounts and keys (spec 2026-11-22 §7): asks the service at the
// address entered, with the key entered, for its models, and says what it found: how many, and which; that it lists
// none (the model is then typed on the line-up's Translation card); or why it could not, in the service's words.
// What it finds is also what the Translation card offers. What it says is the address's and the key's it was asked
// with: another address or key lets it go, and an answer for any but the last ask is not shown.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CredentialValues } from '../../lib/provider/types';
import { failureNoticeCode } from '../../lib/textModel/check';
import type { TextModelService, TextModelTransport } from '../../lib/textModel/client';
import { fingerprint } from '../../lib/textModel/fingerprint';
import { textModelList, type ModelListResult } from '../../lib/textModel/modelList';
import { noticeText } from '../../lib/view/noticeText';

/** How many found models are named: the rest are counted, and offered on the Translation card. */
const NAMED = 12;

export interface FindModelsProps {
  service: TextModelService;
  credentials: CredentialValues;
  disabled?: boolean;
  /** Absent: the client's own way to the service. A test's fake. */
  transport?: TextModelTransport;
}

export function FindModels({ service, credentials, disabled = false, transport }: FindModelsProps) {
  const { t } = useTranslation();
  const baseUrl = credentials.baseUrl ?? '';
  const apiKey = credentials.apiKey ?? '';
  // What is asked with: the service, the address and the key, by a digest, never the key.
  const query = JSON.stringify([service, baseUrl.trim(), fingerprint([apiKey.trim()])]);
  const [found, setFound] = useState<{ query: string; state: 'finding' | ModelListResult } | undefined>(undefined);
  // Each ask, and each change of what is asked with, makes every answer still on its way one not to show.
  const asks = useRef(0);
  useEffect(() => {
    asks.current += 1;
    setFound(undefined);
  }, [query]);
  const state = found?.query === query ? found.state : 'idle';
  const find = () => {
    const ask = ++asks.current;
    const show = (result: ModelListResult) => { if (asks.current === ask) setFound({ query, state: result }); };
    setFound({ query, state: 'finding' });
    void textModelList({ service, baseUrl, apiKey, ...(transport ? { transport } : {}) }, true)
      .then(show, (error: unknown) => show({ ok: false, failure: { code: 'network', message: error instanceof Error ? error.message : String(error) } }));
  };
  return (
    <div className="find-models">
      <button type="button" className="find-models__button" onClick={find} disabled={disabled || state === 'finding' || (service === 'compatible' && baseUrl.trim() === '')}>
        {state === 'finding' ? <span className="spinner" /> : t('settingsPage.accounts.findModels', 'Find models')}
      </button>
      {typeof state === 'object' && state.ok && state.ids.length > 0 && (
        <div className="models-info find-models__found" role="status">
          {t('settings.modelsFound', '{{count}} models available', { count: state.ids.length })}
          {': '}
          {state.ids.slice(0, NAMED).join(', ')}
          {state.ids.length > NAMED ? ', …' : ''}
        </div>
      )}
      {typeof state === 'object' && state.ok && state.ids.length === 0 && (
        <div className="models-info find-models__found" role="status">{t('settingsPage.textModel.listEmpty', "This service lists no models: type the model's name.")}</div>
      )}
      {typeof state === 'object' && !state.ok && (
        <div className="validation-message error" role="status">{noticeText(t, { code: failureNoticeCode(state.failure.code), message: state.failure.message })}</div>
      )}
    </div>
  );
}

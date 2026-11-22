// src/lib/textModel/modelList.ts
//
// A service's text models, as the page shows them to choose from: the line-up's model select and the compatible
// service's "Find models". Asked once per service, address and key while the page is open, and asked again only on
// demand: the readiness check answers its models only when the chosen model works, and the list must still be there
// to choose another one. Never a key in a log line or an error; the key is only part of the cache's key, in memory.

import { listModels, textModelTimeout, type ListModelsResult, type TextModelService, type TextModelTransport } from './client';
import { textModelIds } from './models';

/** How long a list may take. */
export const LIST_TIMEOUT_MS = 15_000;

export interface ModelListQuery {
  service: TextModelService;
  baseUrl?: string;
  apiKey?: string;
  /** Absent: the client's own transport for the service. */
  transport?: TextModelTransport;
}

/** The text models a service lists, in its order; or why there are none. */
export type ModelListResult = ListModelsResult;

const lists = new Map<string, Promise<ModelListResult>>();

const keyOf = (q: ModelListQuery) => JSON.stringify([q.service, q.baseUrl?.trim() ?? '', q.apiKey?.trim() ?? '']);

/** The service's text models; asked once per service, address and key, unless `again`. A failure is not kept. */
export function textModelList(q: ModelListQuery, again = false): Promise<ModelListResult> {
  const key = keyOf(q);
  const kept = lists.get(key);
  if (kept && !again) return kept;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(textModelTimeout('The service did not answer the model list in time.')), LIST_TIMEOUT_MS);
  const apiKey = q.apiKey?.trim() || undefined;
  const asked = listModels({
    service: q.service,
    ...(q.baseUrl === undefined ? {} : { baseUrl: q.baseUrl }),
    ...(apiKey === undefined ? {} : { apiKey }),
    signal: controller.signal,
    ...(q.transport ? { transport: q.transport } : {}),
  })
    .then((result): ModelListResult => (result.ok ? { ok: true, ids: textModelIds(q.service, result.ids) } : result))
    .finally(() => clearTimeout(timer));
  lists.set(key, asked);
  void asked.then((result) => {
    if (!result.ok && lists.get(key) === asked) lists.delete(key);
  }, () => {
    if (lists.get(key) === asked) lists.delete(key);
  });
  return asked;
}

/** Forgets every list asked: a test starts from none. */
export function forgetTextModelLists(): void {
  lists.clear();
}

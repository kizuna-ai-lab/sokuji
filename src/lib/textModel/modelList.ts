// src/lib/textModel/modelList.ts
//
// A service's text models, as the page shows them to choose from: the line-up's model select and the compatible
// service's "Find models". The readiness check answers its models only when the chosen model works, and the list must
// still be there to choose another one. One list is kept per service and address, for the key it was asked with,
// known by a digest of it (`fingerprint`), never the key itself; a list asked with another key at that address takes
// its place, and a failure is not kept. It is asked again on demand: "Find models", and the Translation card each time
// it opens, so a model the service added since is offered without a restart. A list on its way is shared, never
// asked twice. Never a key in a log line or an error.

import { listModels, textModelTimeout, type ListModelsResult, type TextModelService, type TextModelTransport } from './client';
import { fingerprint } from './fingerprint';
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

/** A list asked: the digest of the key it was asked with, and whether it has come. */
interface Kept {
  key: string;
  asked: Promise<ModelListResult>;
  settled: boolean;
}

/** By service and address: one list each. */
const lists = new Map<string, Kept>();

/**
 * The service's text models; asked once per service, address and key, unless `again`, and shared while on its way
 * even then. Another key at the same address lets the list of the one before go. A failure is not kept.
 */
export function textModelList(q: ModelListQuery, again = false): Promise<ModelListResult> {
  const place = JSON.stringify([q.service, q.baseUrl?.trim() ?? '']);
  const apiKey = q.apiKey?.trim() || undefined;
  const key = fingerprint([apiKey ?? '']);
  const kept = lists.get(place);
  if (kept && kept.key === key && (!again || !kept.settled)) return kept.asked;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(textModelTimeout('The service did not answer the model list in time.')), LIST_TIMEOUT_MS);
  const asked = listModels({
    service: q.service,
    ...(q.baseUrl === undefined ? {} : { baseUrl: q.baseUrl }),
    ...(apiKey === undefined ? {} : { apiKey }),
    signal: controller.signal,
    ...(q.transport ? { transport: q.transport } : {}),
  })
    .then((result): ModelListResult => (result.ok ? { ok: true, ids: textModelIds(q.service, result.ids) } : result))
    .finally(() => clearTimeout(timer));
  const entry: Kept = { key, asked, settled: false };
  lists.set(place, entry);
  const settle = (keep: boolean) => {
    entry.settled = true;
    if (!keep && lists.get(place) === entry) lists.delete(place);
  };
  void asked.then((result) => settle(result.ok), () => settle(false));
  return asked;
}

/** Forgets every list asked: a test starts from none. */
export function forgetTextModelLists(): void {
  lists.clear();
}

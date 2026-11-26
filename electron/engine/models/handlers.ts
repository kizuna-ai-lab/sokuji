/**
 * The model-management messages (port of native_models.py's handlers): model_status, model_download (a background
 * task, so the connection stays free for model_cancel; it ends with model_download_done or an error tagged with the
 * model), model_cancel and model_delete.
 */
import type { Conn } from '../conn';
import { register as registerHandler, type EngineState, type Handler } from '../server';
import { downloadModel } from './download';
import { deleteModel } from './remove';
import { modelStatus } from './status';

/** What the handlers call, patched by tests. */
const DEFAULTS = { downloadModel, deleteModel, modelStatus };
export const handlerSeams = { ...DEFAULTS };
export function restoreHandlerSeams(): void {
  Object.assign(handlerSeams, DEFAULTS);
}

interface Download {
  readonly controller: AbortController;
  readonly conn: Conn;
  task: Promise<void>;
}

/** The downloads in flight, by model id. */
export function downloadsOf(state: EngineState): Map<string, Download> {
  let downloads = state.downloads as Map<string, Download> | undefined;
  if (!downloads) {
    downloads = new Map();
    state.downloads = downloads;
  }
  return downloads;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export const modelStatusHandler: Handler = async (_state, msg) => {
  const repos = (msg.repos && typeof msg.repos === 'object' ? msg.repos : {}) as Record<string, unknown>;
  const models = Array.isArray(msg.models) ? (msg.models as unknown[]) : [];
  const statuses: Record<string, string> = {};
  for (const m of models) statuses[String(m)] = handlerSeams.modelStatus(String(m), str(repos[String(m)]));
  return [{ type: 'model_status_result', id: msg.id, statuses }, null];
};

async function runDownload(state: EngineState, model: string, conn: Conn, repo: string | null, entry: Download): Promise<void> {
  // A download follows its connection: the client that asked for it is gone, so nobody is left to watch or cancel it.
  void conn.waitClosed().then(() => entry.controller.abort());
  try {
    const status = await handlerSeams.downloadModel(model, (m) => conn.send(m), { repo, signal: entry.controller.signal });
    await conn.send({ type: 'model_download_done', model, status });
  } catch (e) {
    await conn.send({ type: 'error', model, message: e instanceof Error ? e.message : String(e) });
  } finally {
    const downloads = downloadsOf(state);
    if (downloads.get(model) === entry) downloads.delete(model);
  }
}

export const modelDownloadHandler: Handler = async (state, msg, _binary, conn) => {
  if (!conn) return [{ type: 'error', id: msg.id, message: 'no connection' }, null];
  const model = String(msg.model ?? '');
  const downloads = downloadsOf(state);
  // Two writers on one .incomplete blob corrupt it: a live download is refused; one whose connection has gone is
  // stopped and waited for before the new one starts. Looked up again after each wait: another request may have taken
  // the slot while this one was waiting.
  for (let running = downloads.get(model); running; running = downloads.get(model)) {
    if (!running.conn.closed) return [{ type: 'error', id: msg.id, model, message: `${model} is already downloading` }, null];
    running.controller.abort();
    await running.task;
    if (downloads.get(model) === running) downloads.delete(model);
  }
  const entry: Download = { controller: new AbortController(), conn, task: Promise.resolve() };
  downloads.set(model, entry);
  entry.task = runDownload(state, model, conn, str(msg.repo), entry).catch(() => {});   // a failed send has nowhere to report
  return [null, null];
};

export const modelCancelHandler: Handler = async (state, msg) => {
  downloadsOf(state).get(String(msg.model ?? ''))?.controller.abort();
  return [{ type: 'ok', id: msg.id }, null];
};

export const modelDeleteHandler: Handler = async (_state, msg) => {
  const model = String(msg.model ?? '');
  const freed = await handlerSeams.deleteModel(model, str(msg.repo));
  return [{ type: 'model_delete_result', id: msg.id, model, freed }, null];
};

export function register(state: EngineState): void {
  registerHandler(state, 'model_status', modelStatusHandler);
  registerHandler(state, 'model_download', modelDownloadHandler);
  registerHandler(state, 'model_cancel', modelCancelHandler);
  registerHandler(state, 'model_delete', modelDeleteHandler);
}

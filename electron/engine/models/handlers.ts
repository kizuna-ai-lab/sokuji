/**
 * The model-management messages (port of native_models.py's handlers): model_status, model_download (a background
 * task, so the connection stays free for model_cancel; it ends with model_download_done or an error tagged with the
 * model), model_cancel and model_delete.
 */
import type { Conn } from '../conn';
import { register as registerHandler, type EngineState, type Handler } from '../server';
import { downloadModel } from './download';
import { importModel, ImportError } from './import';
import { knownFile } from './import';
import { downloadSpecs } from './specs';
import { deleteModel } from './remove';
import { modelStatus } from './status';

/** What the handlers call, patched by tests. */
const DEFAULTS = { downloadModel, deleteModel, modelStatus, importModel };
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

/**
 * Takes a model's slot for a download or an import, or answers why not. Two writers on one model's files corrupt them:
 * a live download or import is refused; one whose connection has gone is stopped and waited for before the new one
 * starts. Looked up again after each wait: another request may have taken the slot while this one was waiting.
 */
async function takeSlot(state: EngineState, msg: Record<string, unknown>, model: string, conn: Conn): Promise<Download | Record<string, unknown>> {
  const downloads = downloadsOf(state);
  for (let running = downloads.get(model); running; running = downloads.get(model)) {
    if (!running.conn.closed) return { type: 'error', id: msg.id, model, message: `${model} is already downloading` };
    running.controller.abort();
    await running.task;
    if (downloads.get(model) === running) downloads.delete(model);
  }
  const entry: Download = { controller: new AbortController(), conn, task: Promise.resolve() };
  downloads.set(model, entry);
  return entry;
}

export const modelDownloadHandler: Handler = async (state, msg, _binary, conn) => {
  if (!conn) return [{ type: 'error', id: msg.id, message: 'no connection' }, null];
  const model = String(msg.model ?? '');
  const entry = await takeSlot(state, msg, model, conn);
  if (!('controller' in entry)) return [entry, null];
  entry.task = runDownload(state, model, conn, str(msg.repo), entry as Download).catch(() => {});   // a failed send has nowhere to report
  return [null, null];
};

async function runImport(state: EngineState, model: string, conn: Conn, paths: string[], repo: string | null, entry: Download): Promise<void> {
  void conn.waitClosed().then(() => entry.controller.abort());
  try {
    const status = await handlerSeams.importModel(model, paths, (m) => conn.send(m), { repo, signal: entry.controller.signal });
    await conn.send({ type: 'model_download_done', model, status });
  } catch (e) {
    // An ImportError is worded for the person; anything else is the engine's own message.
    if (e instanceof ImportError) await conn.send({ type: 'error', model, message: e.message, code: e.code, params: e.params });
    else await conn.send({ type: 'error', model, message: e instanceof Error ? e.message : String(e) });
  } finally {
    const downloads = downloadsOf(state);
    if (downloads.get(model) === entry) downloads.delete(model);
  }
}

/** model_import: the files the person chose, put into the cache like a download (same slot, same progress and end messages). */
export const modelImportHandler: Handler = async (state, msg, _binary, conn) => {
  if (!conn) return [{ type: 'error', id: msg.id, message: 'no connection' }, null];
  const model = String(msg.model ?? '');
  const paths = (Array.isArray(msg.paths) ? msg.paths : []).filter((p): p is string => typeof p === 'string' && p !== '');
  if (paths.length === 0) return [{ type: 'error', id: msg.id, model, message: 'no files were chosen' }, null];
  const entry = await takeSlot(state, msg, model, conn);
  if (!('controller' in entry)) return [entry, null];
  entry.task = runImport(state, model, conn, paths, str(msg.repo), entry as Download).catch(() => {});
  return [null, null];
};

/** model_files: the files a card is made of, where each is published — what a person downloading it by hand needs to know. */
export const modelFilesHandler: Handler = async (_state, msg) => {
  const model = String(msg.model ?? '');
  const specs = downloadSpecs(model, str(msg.repo));
  const files = (specs.files ?? []).map(([repo, file]) => ({ repo, file, url: `https://huggingface.co/${repo}/resolve/main/${file}`, size: knownFile(repo, file)?.size }));
  return [{ type: 'model_files_result', id: msg.id, model, files }, null];
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
  registerHandler(state, 'model_files', modelFilesHandler);
  registerHandler(state, 'model_import', modelImportHandler);
  registerHandler(state, 'model_cancel', modelCancelHandler);
  registerHandler(state, 'model_delete', modelDeleteHandler);
}

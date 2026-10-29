import type { Leg } from '@shared/lib/conversation/types';

// A session kept on the device: what the history list shows, and the leg the
// exporters render. One directory per session (a later version puts the
// recording beside the JSON); every session stays until the user deletes it.
export interface StoredSession {
  id: string;
  title?: string;
  startedAt: number;
  endedAt: number | null;
  source: string;
  target: string;
  leg: Leg;
  lastStatus: string;
}

export type SessionSummary = Pick<StoredSession, 'id' | 'title' | 'startedAt' | 'endedAt' | 'source' | 'target'>;

export interface HistoryFs {
  read(path: string): Promise<string | null>;
  write(path: string, body: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  listDirs(path: string): Promise<string[]>;
}

const ROOT = 'sessions';
const file = (id: string) => `${ROOT}/${id}/session.json`;

export function createHistoryStore(fs: HistoryFs) {
  // One unreadable or truncated file must not take the whole list down.
  async function load(id: string): Promise<StoredSession | null> {
    try {
      const body = await fs.read(file(id));
      if (!body) return null;
      const s = JSON.parse(body) as Partial<StoredSession> | null;
      return s && typeof s.id === 'string' && typeof s.startedAt === 'number' && Array.isArray(s.leg?.segments) ? (s as StoredSession) : null;
    } catch {
      return null;
    }
  }
  // A failed write (a full disk, say) is logged, never thrown into the screen
  // that called it from a checkpoint; the next checkpoint tries again.
  async function save(session: StoredSession): Promise<boolean> {
    // No audio is kept in the first version; a segment's speech entries would
    // not survive JSON anyway (typed arrays), so they are dropped on the way out.
    const leg: Leg = { ...session.leg, segments: session.leg.segments.map((s) => ({ ...s, speech: [] })) };
    try {
      await fs.write(file(session.id), JSON.stringify({ ...session, leg }));
      return true;
    } catch (err) {
      console.warn(`history: save ${session.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  return {
    save,
    load,
    async list(): Promise<SessionSummary[]> {
      const ids = await fs.listDirs(ROOT);
      const sessions = (await Promise.all(ids.map(load))).filter((s): s is StoredSession => s !== null);
      return sessions
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(({ id, title, startedAt, endedAt, source, target }) => ({ id, title, startedAt, endedAt, source, target }));
    },
    async rename(id: string, title: string): Promise<void> {
      const session = await load(id);
      if (session) await save({ ...session, title });
    },
    async delete(id: string): Promise<void> {
      await fs.removeDir(`${ROOT}/${id}`);
    },
  };
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

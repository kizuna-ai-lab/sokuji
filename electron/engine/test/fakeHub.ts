/**
 * A local stand-in for the Hugging Face hub (node:http): the resolve endpoint with the hub's headers (an LFS file
 * redirects to a CDN path with x-linked-etag = its sha256, a plain file answers with its git blob id), Range requests,
 * the tree listing, and two faults: drop the connection after N bytes, and serve bytes that do not match the etag.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface Entry {
  readonly content: Buffer;
  readonly lfs: boolean;
  /** The size HEAD reports, when the test declares one without serving that many bytes. */
  readonly declaredSize?: number;
  corrupt: boolean;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const gitBlobId = (b: Buffer) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');

export class FakeHub {
  url = '';
  readonly commit = createHash('sha1').update('fake-hub-commit').digest('hex');
  /** The Range header of the last content GET (null when it had none). */
  lastRange: string | null = null;
  readonly requests: Array<{ method: string; path: string; range: string | null }> = [];
  private readonly repos = new Map<string, Map<string, Entry>>();
  private drop: number | null = null;
  private readonly server = http.createServer((req, res) => this.handle(req, res));

  static async start(): Promise<FakeHub> {
    const hub = new FakeHub();
    await new Promise<void>((resolve) => hub.server.listen(0, '127.0.0.1', resolve));
    hub.url = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
    return hub;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  addFile(repo: string, file: string, content: Buffer | string, opts: { lfs?: boolean; size?: number } = {}): void {
    const files = this.repos.get(repo) ?? new Map<string, Entry>();
    files.set(file, { content: Buffer.from(content), lfs: opts.lfs ?? true, declaredSize: opts.size, corrupt: false });
    this.repos.set(repo, files);
  }

  /** The sha256 of a file's real content (the first repo holding `file`, unless `repo` is given). */
  sha256(file: string, repo?: string): string {
    return sha256(this.entry(file, repo).content);
  }

  /** The etag the hub names a file's blob by. */
  etag(file: string, repo?: string): string {
    const e = this.entry(file, repo);
    return e.lfs ? sha256(e.content) : gitBlobId(e.content);
  }

  /** Cut every content response once it has sent `n` bytes of the file (null: never). */
  dropAfter(n: number | null): void {
    this.drop = n;
  }

  /** Serve the file with one byte flipped, under its true etag. */
  corrupt(file: string, repo?: string): void {
    this.entry(file, repo).corrupt = true;
  }

  private entry(file: string, repo?: string): Entry {
    for (const [r, files] of this.repos) {
      if (repo !== undefined && r !== repo) continue;
      const e = files.get(file);
      if (e) return e;
    }
    throw new Error(`fake hub: no ${file}`);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', this.url);
    const parts = url.pathname.split('/').slice(1).map(decodeURIComponent);
    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    this.requests.push({ method: req.method ?? 'GET', path: url.pathname, range });
    if (parts[0] === 'api' && parts[1] === 'models' && parts[4] === 'tree') return this.tree(`${parts[2]}/${parts[3]}`, res);
    if (parts[0] === 'cdn') return this.body(req, res, parts[1], parts.slice(2).join('/'));
    if (parts[2] === 'resolve' && parts[3] === 'main') return this.resolve(req, res, `${parts[0]}/${parts[1]}`, parts.slice(4).join('/'));
    res.writeHead(404).end();
  }

  private tree(repo: string, res: http.ServerResponse): void {
    const files = this.repos.get(repo);
    if (!files) {
      res.writeHead(404, { 'x-error-code': 'RepoNotFound' }).end();
      return;
    }
    const entries = [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, e]) => {
      const size = e.declaredSize ?? e.content.length;
      return e.lfs ? { type: 'file', path: p, size, lfs: { oid: sha256(e.content), size } } : { type: 'file', path: p, size };
    });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(entries));
  }

  private resolve(req: http.IncomingMessage, res: http.ServerResponse, repo: string, file: string): void {
    const e = this.repos.get(repo)?.get(file);
    if (!e) {
      res.writeHead(404, { 'x-error-code': this.repos.has(repo) ? 'EntryNotFound' : 'RepoNotFound' }).end();
      return;
    }
    const size = String(e.declaredSize ?? e.content.length);
    if (e.lfs) {
      const cdn = `${this.url}/cdn/${encodeURIComponent(repo)}/${file.split('/').map(encodeURIComponent).join('/')}`;
      res.writeHead(302, { location: cdn, 'x-repo-commit': this.commit, 'x-linked-etag': `"${sha256(e.content)}"`, 'x-linked-size': size, etag: `"${gitBlobId(Buffer.from('pointer'))}"` }).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'x-repo-commit': this.commit, etag: `"${gitBlobId(e.content)}"`, 'content-length': size }).end();
      return;
    }
    this.body(req, res, repo, file);
  }

  private body(req: http.IncomingMessage, res: http.ServerResponse, repo: string, file: string): void {
    const e = this.repos.get(repo)?.get(file);
    if (!e) {
      res.writeHead(404).end();
      return;
    }
    let content = e.content;
    if (e.corrupt) {
      content = Buffer.from(content);
      content[0] ^= 0xff;
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    this.lastRange = range;
    let start = 0;
    const m = range?.match(/^bytes=(\d+)-$/);
    if (m) {
      start = Number(m[1]);
      if (start >= content.length) {
        res.writeHead(416, { 'content-range': `bytes */${content.length}` }).end();
        return;
      }
    }
    const slice = content.subarray(start);
    const headers: Record<string, string> = { 'content-length': String(slice.length), 'x-repo-commit': this.commit };
    if (m) headers['content-range'] = `bytes ${start}-${content.length - 1}/${content.length}`;
    res.writeHead(m ? 206 : 200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    if (this.drop !== null && start + slice.length > this.drop) {
      const part = slice.subarray(0, Math.max(0, this.drop - start));
      // Cut only once the client has had time to read what was sent: a response that errors discards the chunks its
      // reader has not taken yet, and the test wants the cut at exactly n bytes.
      res.write(part, () => setTimeout(() => res.socket?.destroy(), 100));
      return;
    }
    res.end(slice);
  }
}

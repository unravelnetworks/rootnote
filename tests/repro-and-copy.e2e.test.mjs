// A1 and A2 in the app: "+ Reproduction prompts" inserts a prompt block that Check & export
// lists until filled, and "Copy as text" shows the finding as Markdown or plain text, copies it
// or downloads it, with no network request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findingText } from '../src/app/finding-text.js';
import { countPrompts } from '../src/app/starter-library.js';

const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = here('../release-template/sample-project.rootnote.json');
const snap = 'window.__fieldnote.snapshot()';
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;

for (const [engine, port] of [['chrome', 9596], ['firefox', 9696]]) test(`reproduction prompts and copy as text in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const dir = here(`./out/copy-${engine}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const b = await launch(engine, port, { downloadDir: dir });
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate("document.querySelectorAll('.navitem')[[...document.querySelectorAll('.navitem')].findIndex((e) => e.textContent.includes('Password reset token'))].click()");
    assert.ok(await b.waitFor("!!document.querySelector('[data-testid=add-repro]')"));

    await t.test('+ Reproduction prompts inserts one plain text block of prompts at that place', async () => {
      const before = (await b.evaluate(snap)).findings[0].details.length;
      await b.evaluate("document.querySelector('[data-testid=add-repro]').click()");
      const d = (await b.evaluate(snap)).findings[0].details;
      assert.equal(d.length, before + 1);
      assert.equal(d[0].type, 'text');
      assert.equal(d[0].format, 'plain');
      assert.match(d[0].text, /^Conditions: \[\[/);
      assert.match(d[0].text, /Expected: \[\[[^\]]+\]\]\nObserved: \[\[/);
      assert.equal(countPrompts(d[0].text), 6);
      await b.evaluate(nav('Check'));
      assert.match(await b.evaluate("document.querySelector('[data-testid=warnings]').textContent"), /6 unfilled \[\[…\]\] prompt/);
    });

    await t.test('Copy as text shows exactly the shared Markdown and plain text', async () => {
      await b.evaluate("document.querySelectorAll('.navitem')[[...document.querySelectorAll('.navitem')].findIndex((e) => e.textContent.includes('Password reset token'))].click()");
      await b.evaluate("document.querySelector('[data-testid=copy-finding]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=copy-dialog][open]')"));
      const project = await b.evaluate(snap);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=copy-text]').value"), findingText(project, 0));
      await b.evaluate("document.querySelector('[data-testid=copy-dialog] input[value=text]').click()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=copy-text]').value"), findingText(project, 0, { markdown: false }));
    });

    await t.test('Copy either copies or explains the keyboard fallback; Download saves the text', async () => {
      await b.evaluate("document.querySelector('[data-testid=copy-now]').click()");
      assert.ok(await b.waitFor("document.querySelector('[data-testid=copy-note]').textContent !== ''"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=copy-note]').textContent"), /^(Copied\.|The browser did not allow copying\. The text is selected)/);
      await b.evaluate("document.querySelector('[data-testid=copy-download]').click()");
      const file = await waitForFile(dir, /\.txt$/);
      assert.equal(readFileSync(file, 'utf8'), await b.evaluate("document.querySelector('[data-testid=copy-text]').value"));
      await b.evaluate("document.querySelector('[data-testid=copy-dialog] button.secondary').click()");
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=copy-dialog]')"));
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

// a textarea turns CR and CRLF into LF; the downloaded text keeps code exactly.
for (const [engine, port] of [['chrome', 9594], ['firefox', 9694]]) test(`Download keeps CR and CRLF inside code in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async () => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const dir = here(`./out/copy-cr-${engine}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const p = JSON.parse(readFileSync(sample, 'utf8'));
  const code = 'GET / HTTP/1.1\r\nHost: a.example\r\n\r\nold-mac\rline';
  p.findings[0].details.unshift({ id: 'BLK-CR01', type: 'text', text: code, format: 'code' });
  const file = join(dir, 'cr.rootnote.json');
  writeFileSync(file, JSON.stringify(p));
  const b = await launch(engine, port, { downloadDir: dir });
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    assert.equal(await b.evaluate(`${snap}.findings[0].details[0].text`), code);
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset token')).click()");
    await b.evaluate("document.querySelector('[data-testid=copy-finding]').click()");
    assert.ok(await b.waitFor("!!document.querySelector('[data-testid=copy-dialog][open]')"));
    await b.evaluate("document.querySelector('[data-testid=copy-download]').click()");
    const got = readFileSync(await waitForFile(dir, /\.md$/), 'utf8');
    assert.equal(got, findingText(await b.evaluate(snap), 0));
    assert.ok(got.includes(code), 'code bytes kept');
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

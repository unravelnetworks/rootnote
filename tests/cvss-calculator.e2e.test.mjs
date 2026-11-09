// CVSS calculator: eight Base metric menus produce the canonical vector and
// score from src/scoring; typing a vector updates the menus; clearing resets them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');
const snap = 'window.__fieldnote.snapshot()';
const pick = (key, value) => `(() => { const s = document.querySelector('[data-testid=cvss-${key}]'); s.value = '${value}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`;

for (const [engine, port] of [['chrome', 9595], ['firefox', 9695]]) test(`CVSS calculator in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
    await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[0].click()");

    await t.test('choosing all eight metrics stores the canonical vector and shows the score', async () => {
      const metrics = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'N' };
      for (const [k, v] of Object.entries(metrics).slice(0, 7)) await b.evaluate(pick(k, v));
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), null, 'nothing stored until all eight are chosen');
      await b.evaluate(pick('A', 'N'));
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss]').value"), 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N');
      assert.match(await b.evaluate("document.querySelector('[data-testid=cvss-note]').textContent"), /Score 9\.1/);
    });

    await t.test('changing one metric rescores', async () => {
      await b.evaluate(pick('S', 'C'));
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N');
      assert.match(await b.evaluate("document.querySelector('[data-testid=cvss-note]').textContent"), /Score 10\.0/);
    });

    await t.test('a typed vector (any order) updates the menus; clearing resets them', async () => {
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = 'CVSS:3.1/C:L/AV:A/AC:H/PR:L/UI:R/S:U/I:N/A:N'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), 'CVSS:3.1/AV:A/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-AV]').value"), 'A');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-UI]').value"), 'R');
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), null);
      assert.equal(await b.evaluate("[...document.querySelectorAll('[data-testid^=cvss-]')].filter((s) => s.tagName === 'SELECT').every((s) => s.value === '')"), true);
    });

    await t.test('blanking a menu keeps the stored vector and says the calculator is incomplete', async () => {
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate(pick('AV', ''));
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N');
      const note = await b.evaluate("document.querySelector('[data-testid=cvss-note]').textContent");
      assert.match(note, /Calculator incomplete/);
      assert.match(note, /Still stored: Score 9\.1/);
      await b.evaluate(pick('AV', 'N'));
      assert.doesNotMatch(await b.evaluate("document.querySelector('[data-testid=cvss-note]').textContent"), /incomplete/);
    });

    await t.test('invalid typed text stays flagged through partial menu edits until replaced', async () => {
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = 'CVSS:3.1/AV:X'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-note]').dataset.kind"), 'error');
      await b.evaluate(pick('AC', ''));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-note]').dataset.kind"), 'error', 'error kept while invalid text remains');
      await b.evaluate(pick('AC', 'H'));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-note]').dataset.kind"), '', 'complete calculator replaced the invalid text');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss]').value"), await b.evaluate(`${snap}.findings[0].cvss`));
      assert.equal(await b.evaluate(`${snap}.findings[0].cvss`), 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N');
    });

    await t.test('side-list dot follows the shown score: CVSS band in CVSS-only reports, hidden rating ignored', async () => {
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=rating]'); s.value = 'Low'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      const dot = () => b.evaluate("(() => { const d = document.querySelector('.nav [data-testid=rating-dot]'); return { title: d.title, bg: d.style.background, rated: d.dataset.rated ?? null }; })()");
      assert.match((await dot()).title, /^Severity: Low$/);
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent === 'Sections & scoring').click()");
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=scoring-mode]'); s.value = 'cvss'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      let d = await dot();
      assert.equal(d.title, 'CVSS 3.1 Base: 9.8');
      assert.equal(d.bg, 'rgb(123, 31, 162)', 'Critical band colour, not the hidden Low rating');
      assert.equal(await b.evaluate(`${snap}.findings[0].rating`), 'Low', 'hidden rating preserved');
      // A finding without a vector is Unscored, with no colour.
      d = await b.evaluate("(() => { const d = document.querySelectorAll('.nav [data-testid=rating-dot]')[1]; return { title: d.title, rated: d.dataset.rated ?? null }; })()");
      assert.equal(d.title, 'CVSS 3.1 Base: Unscored');
      assert.equal(d.rated, null);
    });
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

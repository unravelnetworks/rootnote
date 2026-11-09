// Block tools from the agreed finding mockup: copy and a ⋯ menu on each block (format, move,
// remove), formatting help once in a popover, and the live page marking what is being edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = here('../release-template/sample-project.rootnote.json');
const snap = 'window.__fieldnote.snapshot()';
const firstText = "document.querySelector('[data-testid=details-blocks] .block-text[data-block]')";

for (const [engine, port] of [['chrome', 9589], ['firefox', 9689]]) test(`block tools in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset')).click()");

    await t.test('each text block has a copy button and a ⋯ menu instead of visible format, arrows and Remove', async () => {
      assert.ok(await b.evaluate(`!!${firstText}.querySelector('[data-testid=block-copy]')`));
      assert.ok(await b.evaluate(`!!${firstText}.querySelector('details[data-testid=block-menu]')`));
      assert.equal(await b.evaluate(`${firstText}.querySelector('select.format')`), null);
      const items = await b.evaluate(`[...${firstText}.querySelectorAll('.menu-item')].map((x) => x.textContent)`);
      assert.ok(items.includes('Remove') && items.some((x) => /Change to code/.test(x)), items.join('|'));
    });

    await t.test('the menu changes the format; Move down moves the block', async () => {
      const id = await b.evaluate(`${firstText}.dataset.block`);
      await b.evaluate(`${firstText}.querySelector('[data-testid=block-format]').click()`);
      assert.equal((await b.evaluate(snap)).findings[0].details.find((x) => x.id === id).format, 'code');
      await b.evaluate(`document.querySelector('[data-block="${id}"] [data-testid=block-format]').click()`);
      assert.equal((await b.evaluate(snap)).findings[0].details.find((x) => x.id === id).format, 'plain');
      const before = (await b.evaluate(snap)).findings[0].details.findIndex((x) => x.id === id);
      await b.evaluate(`document.querySelector('[data-block="${id}"] [aria-label="Move text block down"]').click()`);
      assert.equal((await b.evaluate(snap)).findings[0].details.findIndex((x) => x.id === id), before + 1);
    });

    await t.test('formatting help is one popover, closed by Escape', async () => {
      assert.equal(await b.evaluate("document.querySelectorAll('.format-help').length"), 0, 'no help line on the page');
      await b.evaluate("document.querySelector('[data-testid=format-help] summary').click()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=format-help]').open"), true);
      assert.match(await b.evaluate("document.querySelector('[data-testid=format-help]').textContent"), /blank line starts a new paragraph/);
      await b.evaluate("document.querySelector('[data-testid=format-help]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=format-help]').open"), false);
    });

    await t.test('the live page marks the block being edited', async () => {
      assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=live-pane] .pv-page:not([hidden])').length > 0", 20000));
      const id = await b.evaluate(`${firstText}.dataset.block`);
      // An automated window may not have focus, so focusin is sent as a real user's focus would.
      const focus = (sel) => b.evaluate(`(() => { const el = ${sel}; el.focus(); el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); })()`);
      await focus(`${firstText}.querySelector('textarea')`);
      assert.ok(await b.waitFor(`!!document.querySelector('[data-testid=live-pane] .pv-hl[data-block="${id}"]')`, 5000));
      await focus("document.querySelector('[data-testid=description]')");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=live-pane] .pv-hl[data-section=description]')", 5000));
      assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=live-pane] .pv-hl[data-block="${id}"]')`), false, 'only one thing marked');
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

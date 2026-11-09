// Undo for one removal.
// Each removal followed by Undo gives back exactly the project before it; the offer lasts until
// the next successful project edit, a replacement, Undo or Dismiss, never by time, and status
// messages, navigation and Save do not consume it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = here('../release-template/sample-project.rootnote.json');
const snap = 'window.__fieldnote.snapshot()';
const open = (t) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(t)})).click()`;
const FIRST = 'Password reset token';
const offered = "!document.querySelector('[data-testid=undo-bar]').hidden";
const noDialog = "!document.querySelector('dialog.confirm')";
const removeIn = (sel) => `[...document.querySelector(${JSON.stringify(sel)}).querySelectorAll('button')].find((x) => x.textContent === 'Remove').click()`;

for (const [engine, port] of [['chrome', 9590], ['firefox', 9690]]) test(`undo in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 240000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const dir = here(`./out/undo-${engine}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const b = await launch(engine, port, { downloadDir: dir });
  const undo = async () => { await b.evaluate("document.querySelector('[data-testid=undo]').click()"); };
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate(open(FIRST));
    const textBlock = async () => (await b.evaluate(snap)).findings[0].details.find((x) => x.type === 'text' && x.text.trim()).id;

    await t.test('a text block with text: removed at once, Undo restores exactly and focuses it', async () => {
      const before = await b.evaluate(snap);
      const id = await textBlock();
      await b.evaluate(removeIn(`[data-block="${id}"]`));
      assert.ok(await b.evaluate(noDialog), 'no question');
      assert.ok(await b.waitFor(offered));
      assert.match(await b.evaluate("document.querySelector('[data-testid=undo-text]').textContent"), /^Removed a text block from /);
      assert.equal((await b.evaluate(snap)).findings[0].details.some((x) => x.id === id), false);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
      assert.equal(await b.evaluate(offered), false);
      assert.equal(await b.evaluate(`document.activeElement === document.querySelector('[data-block="${id}"] textarea')`), true);
    });

    await t.test('a screenshot in Additional details: the image record and its block come back in place', async () => {
      const before = await b.evaluate(snap);
      const block = before.findings[0].details.find((x) => x.type === 'image');
      await b.evaluate(removeIn(`[data-block="${block.id}"]`));
      assert.ok(await b.evaluate(noDialog));
      assert.equal((await b.evaluate(snap)).images.some((im) => im.id === block.imageId), false);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before, 'images order, bytes and counters as before');
    });

    await t.test('a screenshot in Evidence comes back in place too', async () => {
      const image = (await b.evaluate(snap)).findings[0].details.find((x) => x.type === 'image').imageId;
      await b.evaluate(`document.querySelector('[data-block] [data-testid=move-section]').click()`);
      assert.ok(await b.waitFor(`${snap}.findings[0].evidence.includes('${image}')`));
      const before = await b.evaluate(snap);
      await b.evaluate(removeIn(`[data-section=evidence] [data-image="${image}"]`));
      assert.equal((await b.evaluate(snap)).findings[0].evidence.includes(image), false);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
      // Put it back where it was for the next tests.
      await b.evaluate(`document.querySelector('[data-section=evidence] [data-image="${image}"] [data-testid=move-section]').click()`);
    });

    await t.test('a reference with an empty address and a custom engagement row', async () => {
      let before = await b.evaluate(snap);
      await b.evaluate("document.querySelector('[data-testid=references] button[aria-label=\"Remove reference 1\"]').click()");
      assert.ok(await b.evaluate(noDialog));
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
      await b.evaluate(open('Details & cover'));
      await b.evaluate("document.querySelector('[data-testid=engagement-customize]').click()");
      before = await b.evaluate(snap);
      const k = before.project.engagement.rows.findIndex((r) => r.source === 'custom' && r.value.trim());
      await b.evaluate(`document.querySelector('[data-testid=engagement] button[aria-label="Remove row ${k + 1}"]').click()`);
      assert.ok(await b.evaluate(noDialog));
      assert.ok(await b.waitFor(offered));
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
      await b.evaluate("document.querySelector('[data-testid=engagement-customize]').click()");
    });

    await t.test('navigation, status messages and time do not end the offer; Undo returns to the finding', async () => {
      await b.evaluate(open(FIRST));
      const before = await b.evaluate(snap);
      const id = await textBlock();
      await b.evaluate(removeIn(`[data-block="${id}"]`));
      await b.evaluate(open('Check'));
      await b.evaluate(open('Preview'));
      await new Promise((r) => setTimeout(r, 11000));
      assert.ok(await b.evaluate(offered), 'still offered after 11 s and other views');
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
      assert.ok(await b.evaluate(`!!document.querySelector('[data-block="${id}"]')`), 'back on the finding');
    });

    await t.test('the offer is on screen when scrolled to the bottom, and reachable by keyboard', async () => {
      const id = await textBlock();
      await b.evaluate(removeIn(`[data-block="${id}"]`));
      await b.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      const r = await b.evaluate("(() => { const x = document.querySelector('[data-testid=undo]').getBoundingClientRect(); return { top: x.top, bottom: x.bottom, h: innerHeight }; })()");
      assert.ok(r.top >= 0 && r.bottom <= r.h, JSON.stringify(r));
      await b.evaluate("document.querySelector('[data-testid=undo]').focus()");
      assert.equal(await b.evaluate("document.activeElement.dataset.testid"), 'undo');
      await undo();
    });

    await t.test('a 300-character reference title keeps Undo and Dismiss on screen', async () => {
      await b.evaluate(`(() => { document.querySelector('[data-testid=new-reference-title]').value = ${JSON.stringify('W'.repeat(300))}; document.querySelector('[data-testid=add-reference]').click(); })()`);
      const n = (await b.evaluate(snap)).findings[0].references.length;
      await b.evaluate(`document.querySelector('[data-testid=references] button[aria-label="Remove reference ${n}"]').click()`);
      assert.ok(await b.waitFor(offered));
      for (const id of ['undo', 'undo-dismiss']) {
        const r = await b.evaluate(`(() => { const x = document.querySelector('[data-testid=${id}]').getBoundingClientRect(); return { l: x.left, r: x.right, w: innerWidth }; })()`);
        assert.ok(r.l >= 0 && r.r <= r.w, `${id} ${JSON.stringify(r)}`);
      }
      // And at 320 px wide, both buttons are fully on screen.
      await b.setViewport({ width: 320, height: 640 });
      for (const id of ['undo', 'undo-dismiss']) {
        const r = await b.evaluate(`(() => { const x = document.querySelector('[data-testid=${id}]').getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom, w: innerWidth, h: innerHeight }; })()`);
        assert.ok(r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h, `320px ${id} ${JSON.stringify(r)}`);
      }
      const stack = await b.evaluate("(() => { const t = document.querySelector('[data-testid=undo-text]').getBoundingClientRect(); const u = document.querySelector('[data-testid=undo]').getBoundingClientRect(); return t.bottom <= u.top + 1; })()");
      assert.equal(stack, true, 'at 320 px the message sits above the buttons');
      await b.setViewport({ width: 1280, height: 900 });
      await b.evaluate("document.querySelector('[data-testid=undo-dismiss]').click()");
    });

    await t.test('another edit ends the offer; a second removal replaces the first', async () => {
      const before = await b.evaluate(snap);
      const texts = before.findings[0].details.filter((x) => x.type === 'text' && x.text.trim()).map((x) => x.id);
      await b.evaluate(removeIn(`[data-block="${texts[0]}"]`));
      await b.evaluate("(() => { const a = document.querySelector('[data-testid=impact]'); a.value += ' edit'; a.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.equal(await b.evaluate(offered), false, 'an edit ends it');
      const mid = await b.evaluate(snap);
      await b.evaluate(removeIn(`[data-block="${texts[1]}"]`));
      await b.evaluate(removeIn(`[data-block="${texts[2]}"]`));
      await undo();
      const after = await b.evaluate(snap);
      assert.equal(after.findings[0].details.some((x) => x.id === texts[1]), false, 'the earlier removal is not restorable');
      assert.equal(after.findings[0].details.some((x) => x.id === texts[2]), true);
      assert.equal(after.findings[0].details.length, mid.findings[0].details.length - 1);
      assert.equal(await b.evaluate("!!document.querySelector('[data-testid=undo-bar]:not([hidden])')"), false, 'Undo cannot run twice');
    });

    await t.test('Save while offered writes the project without the item; Undo restores it as unsaved work', async () => {
      const id = await textBlock();
      const before = await b.evaluate(snap);
      await b.evaluate(removeIn(`[data-block="${id}"]`));
      await b.evaluate("(document.querySelector('[data-testid=download-project]') || document.querySelector('[data-testid=save]')).click()");
      const saved = JSON.parse(readFileSync(await waitForFile(dir, /\.rootnote\.json$/), 'utf8'));
      assert.equal(saved.findings[0].details.some((x) => x.id === id), false);
      assert.ok(await b.evaluate(offered), 'Save and its status message do not end the offer');
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
      await undo();
      const now = await b.evaluate(snap);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true);
      const { savedAt, appVersion, ...content } = now;
      const { savedAt: s0, appVersion: a0, ...was } = before;
      assert.deepEqual(content, was, 'content, ids, order and counters restored');
    });

    await t.test('Dismiss ends it; New ends it', async () => {
      const id = await textBlock();
      await b.evaluate(removeIn(`[data-block="${id}"]`));
      await b.evaluate("document.querySelector('[data-testid=undo-dismiss]').click()");
      assert.equal(await b.evaluate(offered), false);
      const id2 = await textBlock();
      await b.evaluate(removeIn(`[data-block="${id2}"]`));
      assert.ok(await b.evaluate(offered));
      await b.evaluate("document.querySelector('[data-testid=new-project]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=new-dialog]')"));
      await b.evaluate("[...document.querySelectorAll('dialog button')].find((x) => x.textContent === 'Blank project').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 0`));
      assert.equal(await b.evaluate(offered), false);
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

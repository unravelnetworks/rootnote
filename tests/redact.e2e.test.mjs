// Screenshot editing: black out, pixelate, box, arrow and crop. The edit replaces
// the pixels (checked by reading them back), keeps the id, caption and layout, is checked
// like any new screenshot, can be undone once, and Cancel (asked once when there are edits) changes nothing.
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
const IMG = 'IMG-0003';
const card = `document.querySelector('[data-testid=details-blocks] [data-image="${IMG}"]')`;
// Drags on the editor canvas from (x1, y1) to (x2, y2), given as fractions of its size.
const drag = (x1, y1, x2, y2) => `(() => {
  const c = document.querySelector('[data-testid=redact-canvas]'); const r = c.getBoundingClientRect();
  const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId: 1, bubbles: true });
  c.dispatchEvent(new PointerEvent('pointerdown', at(${x1}, ${y1})));
  c.dispatchEvent(new PointerEvent('pointermove', at(${x2}, ${y2})));
  c.dispatchEvent(new PointerEvent('pointerup', at(${x2}, ${y2})));
})()`;
// Mean brightness of a region of the stored screenshot (0 black .. 255 white), read from its data.
const brightness = (fx, fy, fw, fh) => `(async () => {
  const im = window.__fieldnote.snapshot().images.find((x) => x.id === '${IMG}');
  const img = new Image(); img.src = im.dataUrl; await img.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(Math.round(im.width * ${fx}), Math.round(im.height * ${fy}), Math.max(1, Math.round(im.width * ${fw})), Math.max(1, Math.round(im.height * ${fh}))).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return s / (d.length / 4);
})()`;

for (const [engine, port] of [['chrome', 9588], ['firefox', 9688]]) test(`screenshot editing in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset')).click()");
    const before = (await b.evaluate(snap)).images.find((x) => x.id === IMG);

    await t.test('Cancel changes nothing', async () => {
      await b.evaluate(`${card}.querySelector('[data-testid=edit-screenshot]').click()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog.redact')", 10000));
      await b.evaluate(drag(0.1, 0.1, 0.4, 0.4));
      // With edits made, the first Cancel asks; the second discards.
      await b.evaluate("document.querySelector('[data-testid=redact-cancel]').click()");
      assert.ok(await b.evaluate("!!document.querySelector('dialog.redact')"));
      assert.match(await b.evaluate("document.querySelector('dialog.redact .redact-note').textContent"), /Discard 1 edit\?/);
      await b.evaluate("document.querySelector('[data-testid=redact-cancel]').click()");
      assert.ok(await b.waitFor("!document.querySelector('dialog.redact')"));
      assert.equal((await b.evaluate(snap)).images.find((x) => x.id === IMG).sha256, before.sha256);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    });

    await t.test('Black out replaces the pixels; id, caption and layout stay; the card says what was done', async () => {
      const light = await b.evaluate(brightness(0.55, 0.55, 0.2, 0.2));
      await b.evaluate(`${card}.querySelector('[data-testid=edit-screenshot]').click()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog.redact')", 10000));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=redact-save]').disabled"), true, 'nothing to save yet');
      await b.evaluate(drag(0.5, 0.5, 0.8, 0.8));
      await b.evaluate("document.querySelector('[data-testid=redact-save]').click()");
      assert.ok(await b.waitFor(`${snap}.images.find((x) => x.id === '${IMG}').sha256 !== '${before.sha256}'`, 15000));
      const after = (await b.evaluate(snap)).images.find((x) => x.id === IMG);
      assert.deepEqual([after.width, after.height, after.caption, after.tallMode, after.mime], [before.width, before.height, before.caption, before.tallMode, before.mime]);
      assert.ok(await b.evaluate(brightness(0.55, 0.55, 0.2, 0.2)) < 5, 'the area is black in the stored image');
      assert.ok(light > 5, 'it was not black before');
      assert.match(await b.evaluate(`${card}.querySelector('[data-testid=edit-note]').textContent`), /1 area blacked out/);
      assert.match(await b.evaluate("document.querySelector('[data-testid=undo-text]').textContent"), /Edited screenshot IMG-0003/);
    });

    await t.test('Undo brings the original back', async () => {
      await b.evaluate("document.querySelector('[data-testid=undo]').click()");
      assert.ok(await b.waitFor(`${snap}.images.find((x) => x.id === '${IMG}').sha256 === '${before.sha256}'`));
    });

    await t.test('Crop changes the size; the edit can be stepped back inside the editor', async () => {
      await b.evaluate(`${card}.querySelector('[data-testid=edit-screenshot]').click()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog.redact')", 10000));
      await b.evaluate("document.querySelector('[data-testid=redact-box]').click()");
      await b.evaluate(drag(0.2, 0.2, 0.3, 0.3));
      await b.evaluate("document.querySelector('[data-testid=redact-undo]').click()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=redact-save]').disabled"), true);
      await b.evaluate("document.querySelector('[data-testid=redact-crop]').click()");
      await b.evaluate(drag(0, 0, 0.5, 0.5));
      await b.evaluate("document.querySelector('[data-testid=redact-save]').click()");
      assert.ok(await b.waitFor(`${snap}.images.find((x) => x.id === '${IMG}').width < ${before.width}`, 15000));
      const after = (await b.evaluate(snap)).images.find((x) => x.id === IMG);
      assert.ok(Math.abs(after.width - before.width / 2) <= 2 && Math.abs(after.height - before.height / 2) <= 2, `${after.width}x${after.height}`);
      const { validateProjectFile } = await import('../src/app/project.js');
      const raw = JSON.stringify(await b.evaluate(snap));
      assert.ok((await validateProjectFile(raw, Buffer.byteLength(raw))).ok, 'the edited project is a valid file');
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

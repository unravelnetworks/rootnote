// Opening reads the file as UTF-8 text: a real U+FFFD, astral characters and a byte order mark
// open unchanged; invalid UTF-8 anywhere in the file (also a sequence cut off at the end) is
// refused and the current work stays as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const out = here('./out/encoding');
const status = "document.querySelector('.status').textContent";
const snap = 'window.__fieldnote.snapshot()';

const sample = JSON.parse(readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8'));
const TITLE = 'Replacement � kept, astral 𝄞 and 😀 too';
const text = JSON.stringify({ ...sample, project: { ...sample.project, title: TITLE } });
const files = {
  'fffd.rootnote.json': Buffer.from(text, 'utf8'),
  'bom.rootnote.json': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]),
  // 0xff never appears in UTF-8; placed inside the title string.
  'invalid.rootnote.json': Buffer.from(text.replace('Replacement', 'Replacement\u0001'), 'utf8').map((v) => (v === 1 ? 0xff : v)),
  // The file ends in the middle of a three-byte sequence.
  'cut.rootnote.json': Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0xe2, 0x82])]),
};

for (const [engine, port] of [['chrome', 9584], ['firefox', 9684]]) test(`opening text encodings in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(out, name), bytes);
  const b = await launch(engine, port);
  const open = async (name) => {
    await b.setFile('[data-testid=open-input]', join(out, name));
    assert.ok(await b.waitFor(`/^(Opened|Could not open|"${name.replace('.', '\\\\.')}")/.test(${status})`, 30000), await b.evaluate(status));
  };
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));

    await t.test('a real U+FFFD and astral characters are kept', async () => {
      await open('fffd.rootnote.json');
      assert.match(await b.evaluate(status), /^Opened/);
      assert.equal(await b.evaluate(`${snap}.project.title`), TITLE);
    });

    await t.test('a byte order mark is accepted', async () => {
      await open('bom.rootnote.json');
      assert.match(await b.evaluate(status), /^Opened/);
      assert.equal(await b.evaluate(`${snap}.project.title`), TITLE);
    });

    for (const name of ['invalid.rootnote.json', 'cut.rootnote.json']) {
      await t.test(`invalid UTF-8 is refused (${name})`, async () => {
        await b.evaluate("(() => { const i = document.querySelector('[data-testid=title]'); if (i) { i.value = 'Kept'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()");
        const before = await b.evaluate(`${snap}.project.title`);
        await b.setFile('[data-testid=open-input]', join(out, name));
        if (await b.waitFor("!!document.querySelector('dialog.confirm')", 3000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
        assert.ok(await b.waitFor(`/is not a UTF-8 text file/.test(${status})`, 30000), await b.evaluate(status));
        assert.equal(await b.evaluate(`${snap}.project.title`), before, 'current work unchanged');
      });
    }
    assert.deepEqual(b.errors, [], 'page errors');
  } finally {
    await b.close();
  }
});

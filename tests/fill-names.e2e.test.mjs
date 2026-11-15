// {client} and {application} in library entries: the fill-in dialog on Add to report (prefill,
// remembered application name, full preview, empty boxes keep the token, refusals that add
// nothing, the entry unchanged), Check & export warnings, and the reverse offer on Save to library
// (context, ticks, Keep as written, the finding unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const { createEmptyLibrary, entryFromFinding, serializeLibrary } = await import('../src/app/library.js');
const { resolveFindingPrefix } = await import('../src/app/project.js');

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = JSON.parse(readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8'));
const CLIENT = sample.project.client;
const snap = 'window.__fieldnote.snapshot()';
const status = "document.querySelector('.status').textContent";
const nav = (t) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(t)})).click()`;
const dir = here('./out/fill-names');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// A library with one entry using both names, one using none.
const base = sample.findings[1];
const withNames = entryFromFinding({ ...base, title: 'Customers of {client} can read invoices in {application}',
  description: 'In {application}, any {client} customer can read another customer\'s invoices.', impact: 'Data of {client} customers is exposed.',
  affectedAssets: ['{application} invoice API'], details: [{ id: 'B-1', type: 'text', text: 'GET /api/invoices/20981 HTTP/1.1\r\n\tHost: {application}\n', format: 'code' }],
  references: [{ title: '{client} ticket', url: 'https://example.test/{client}' }] }, { id: 'L-' + 'a'.repeat(32), name: 'IDOR with names' }).entry;
const plain = entryFromFinding(base, { id: 'L-' + 'b'.repeat(32), name: 'IDOR plain' }).entry;
const libPath = join(dir, 'names.rootnote-library.json');
writeFileSync(libPath, serializeLibrary({ ...createEmptyLibrary(), entries: [withNames, plain] }, { appVersion: '0.4.0' }));
const samplePath = join(dir, 'sample.rootnote.json');
writeFileSync(samplePath, JSON.stringify(sample));
const disp = (n) => `${resolveFindingPrefix(sample.project)}-${n}`;

for (const [engine, port] of [['chrome', 9597], ['firefox', 9697]]) test(`fill names from the library in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 240000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  const ids = { 'IDOR with names': withNames.id, 'IDOR plain': plain.id };
  const insert = (name) => b.evaluate(`document.querySelector('[data-entry="${ids[name]}"] [data-testid=library-insert]').click()`);
  const dialogOpen = "!!document.querySelector('dialog [data-testid=fill-add]')";
  const type = (sel, v) => b.evaluate(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', samplePath);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate(nav('Finding library'));
    await b.setFile('[data-testid=library-input]', libPath);
    assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=library-insert]').length >= 2", 30000), await b.evaluate(status));

    await t.test('an entry without names is added at once, as before', async () => {
      await insert('IDOR plain');
      assert.ok(await b.waitFor(`${snap}.findings.length === 9`));
      assert.equal(await b.evaluate("!!document.querySelector('dialog')"), false);
      await b.evaluate(nav('Finding library'));
    });

    await t.test('Cancel adds nothing; the client is prefilled and the preview shows every changed field', async () => {
      const before = await b.evaluate(snap);
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=fill-client]').value"), CLIENT);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=fill-application]').value"), '', 'no application name yet');
      const preview = await b.evaluate("document.querySelector('[data-testid=fill-preview]').textContent");
      assert.ok(preview.includes(`Customers of ${CLIENT} can read invoices in {application}`));
      assert.ok(preview.includes('{client} ticket') === false && preview.includes(`${CLIENT} ticket`), 'reference title previewed');
      assert.match(await b.evaluate("document.querySelector('[data-testid=fill-counts]').textContent"), /^Fills \{client\} 4 times\. \{application\} stays as written/);
      await b.evaluate("[...document.querySelectorAll('dialog button')].find((x) => x.textContent === 'Cancel').click()");
      assert.ok(await b.waitFor("!document.querySelector('dialog')"));
      assert.deepEqual(await b.evaluate(snap), before);
    });

    let added;
    await t.test('Add fills both names literally everywhere they appear; the entry keeps its tokens', async () => {
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      await type('[data-testid=fill-application]', '  Portal $& {client}  ');
      assert.match(await b.evaluate("document.querySelector('[data-testid=fill-counts]').textContent"), /^Fills \{client\} 4 times and \{application\} 4 times\.$/);
      await b.evaluate("document.querySelector('[data-testid=fill-add]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 10`));
      added = (await b.evaluate(snap)).findings[9];
      assert.equal(added.title, `Customers of ${CLIENT} can read invoices in Portal $& {client}`, 'trimmed, literal, never filled twice');
      assert.equal(added.details[0].text, 'GET /api/invoices/20981 HTTP/1.1\r\n\tHost: Portal $& {client}\n', 'code kept exactly');
      assert.equal(added.affectedAssets[0], 'Portal $& {client} invoice API');
      assert.equal(added.references[0].url, 'https://example.test/{client}', 'addresses not filled');
      assert.match(await b.evaluate(status), new RegExp(`^Added ${disp(10)} from "IDOR with names", with the client and application names filled in\\.`));
      // The master entry is unchanged: adding it again asks again, with the remembered application.
      await b.evaluate(nav('Finding library'));
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=fill-application]').value"), 'Portal $& {client}', 'remembered for this report');
      assert.match(await b.evaluate("document.querySelector('[data-testid=fill-counts]').textContent"), /4 times and \{application\} 4 times/);
      await b.evaluate("[...document.querySelectorAll('dialog button')].find((x) => x.textContent === 'Cancel').click()");
    });

    await t.test('a name too long for a field, or holding a line break, is refused and nothing is added', async () => {
      const before = await b.evaluate(snap);
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      await type('[data-testid=fill-client]', 'C'.repeat(290));
      assert.match(await b.evaluate("document.querySelector('[data-testid=fill-problem]').textContent"), /Not added: Title would be longer than 300 characters/);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=fill-add]').disabled"), true);
      await type('[data-testid=fill-client]', 'Acme\u0001');
      assert.match(await b.evaluate("document.querySelector('[data-testid=fill-problem]').textContent"), /character a report cannot hold/);
      await b.evaluate("[...document.querySelectorAll('dialog button')].find((x) => x.textContent === 'Cancel').click()");
      assert.deepEqual(await b.evaluate(snap), before);
    });

    await t.test('empty boxes keep the tokens, and Check & export lists them by field and counts them', async () => {
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      await type('[data-testid=fill-client]', '');
      await type('[data-testid=fill-application]', '');
      assert.match(await b.evaluate("document.querySelector('[data-testid=fill-counts]').textContent"), /^Nothing is filled\. \{client\} and \{application\} stay as written/);
      await b.evaluate("document.querySelector('[data-testid=fill-add]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 11`));
      assert.equal((await b.evaluate(snap)).findings[10].title, withNames.title);
      await b.evaluate(nav('Check & export'));
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=warnings]')"));
      const list = await b.evaluate("document.querySelector('[data-testid=warnings]').textContent");
      assert.ok(list.includes(`${disp(11)} ${withNames.title}: Unfilled {client} in Title, Description, Impact and References; {application} in Title, Affected assets, Description and Additional details.`), list.slice(0, 600));
      assert.ok(list.includes(`${disp(10)}`) && /Unfilled \{client\} in Title/.test(list), 'the literal {client} from the application value is flagged too');
      assert.match(await b.evaluate("document.querySelector('.sub').textContent"), /2 areas still have an unfilled \{client\} or \{application\}\./);
      assert.equal(await b.evaluate("!!document.querySelector('[data-testid=export]')?.disabled"), false, 'export still possible');
    });

    await t.test('the project changing while the dialog is open: nothing is added', async () => {
      await b.evaluate(nav('Finding library'));
      const n = (await b.evaluate(snap)).findings.length;
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      await b.evaluate(`(() => { const doc = window.__fieldnote; })()`);
      await b.evaluate("document.querySelector('[data-testid=fill-add]').closest('dialog').close('add')");
      assert.ok(await b.waitFor(`${snap}.findings.length === ${n + 1}`), 'control: closing with add adds');
      await b.evaluate(nav('Finding library'));
      await insert('IDOR with names');
      assert.ok(await b.waitFor(dialogOpen));
      await b.evaluate(`(() => { const ta = [...document.querySelectorAll('main input')].find((x) => x.dataset.testid === 'library-name'); ta.value = ta.value + ' x'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await b.evaluate("document.querySelector('[data-testid=fill-add]').click()");
      assert.ok(await b.waitFor(`/changed while the dialog was open/.test(${status})`), await b.evaluate(status));
      assert.equal((await b.evaluate(snap)).findings.length, n + 1);
    });

    await t.test('Save to library offers {client} where the name appears; the finding is not changed', async () => {
      await b.evaluate(nav(sample.findings[0].title.slice(0, 20)));
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=finding-title]')"));
      await type('[data-testid=finding-title]', `${CLIENT} reset tokens disclosed`);
      const before = await b.evaluate(snap);
      await b.evaluate("document.querySelector('[data-testid=save-to-library]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=reverse-list]')"));
      const text = await b.evaluate("document.querySelector('dialog').textContent");
      assert.ok(text.includes('Your finding is not changed.') && text.includes('It does not remove other client details from the entry.'));
      const ticks = await b.evaluate("[...document.querySelectorAll('[data-testid=reverse-match]')].map((x) => x.checked)");
      assert.equal(ticks[0], true, 'whole-word title match starts ticked');
      await b.evaluate("document.querySelector('[data-testid=reverse-keep]').click()");
      assert.deepEqual(await b.evaluate("[...document.querySelectorAll('[data-testid=reverse-match]')].map((x) => x.checked)"), ticks.map(() => false), 'Keep as written unticks all');
      await b.evaluate("document.querySelector('[data-testid=reverse-match]').click(); document.querySelector('[data-testid=reverse-save]').click()");
      assert.ok(await b.waitFor(`/in the finding library/.test(${status})`), await b.evaluate(status));
      assert.deepEqual(await b.evaluate(snap), before, 'the finding and project are not changed');
      await b.evaluate(nav('Finding library'));
      const names = await b.evaluate("[...document.querySelectorAll('[data-testid=library-list] > *')].map((r) => r.textContent).join('\\n')");
      assert.ok(names.includes('{client} reset tokens disclosed'), names.slice(0, 400));
    });
    assert.deepEqual(b.errors, [], 'page errors');
  } finally {
    await b.close();
  }
});

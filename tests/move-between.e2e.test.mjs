// Moving a screenshot or text block to another finding: every path (gallery and Additional
// details, both ways), Undo restoring the exact project, refusals that change nothing,
// block ids that clash between findings, a destination without Additional details, a stale
// dialog, the hidden-section note, save and reopen, and the outputs (Word plan figure numbers,
// Markdown, CSV) following the screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { TEST_BUDGET_DIST, TEST_FILE_BYTES } from './harness/test-budget.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const { validateProjectFile, resolveFindingPrefix, savedSize } = await import('../src/app/project.js');
const { APP_VERSION } = await import('../src/app/version.js');
const { findingsCsv } = await import('../src/app/csv.js');
const { reportMarkdown } = await import('../src/app/report-markdown.js');
const { createReportPlan } = await import('../src/export-docx/plan.js');

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = JSON.parse(readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8'));
const snap = 'window.__fieldnote.snapshot()';
const status = "document.querySelector('.status').textContent";
const undoText = "document.querySelector('[data-testid=undo-text]').textContent";
const offered = "!document.querySelector('[data-testid=undo-bar]').hidden";
const disp = (i) => `${resolveFindingPrefix(sample.project)}-${i + 1}`;
const nav = (t) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(t)})).click()`;

// Fixture: the sample, plus Evidence screenshots and the cases the rules need.
const fx = structuredClone(sample);
fx.project.sections.finding.find((s) => s.key === 'evidence').enabled = true;
const [f1, f2, f3] = fx.findings;
// F-003's screenshot goes to its gallery, so there is gallery evidence to move.
const f3img = f3.details.find((b) => b.type === 'image');
f3.details = f3.details.filter((b) => b !== f3img);
f3.evidence = [f3img.imageId];
// A block id used in two findings (valid: ids are unique per finding).
f2.details[0].id = f1.details[0].id;
// F-004 has no Additional details at all (its screenshots go to its gallery).
fx.findings[3].evidence = fx.findings[3].details.filter((x) => x.type === 'image').map((x) => x.imageId);
delete fx.findings[3].details;
const fxDir = here('./out/move-between');
rmSync(fxDir, { recursive: true, force: true });
mkdirSync(fxDir, { recursive: true });
const fxPath = join(fxDir, 'fixture.rootnote.json');
writeFileSync(fxPath, JSON.stringify(fx));

const valid = async (doc) => { const raw = JSON.stringify(doc); const r = await validateProjectFile(raw, Buffer.byteLength(raw)); assert.equal(r.ok, true, JSON.stringify(r.errors)); };
/** imageId -> [finding index, figure number] from the Word plan. */
const figures = (doc) => {
  const out = {};
  const walk = (x, fi) => {
    if (Array.isArray(x)) return x.forEach((y) => walk(y, fi));
    if (!x || typeof x !== 'object') return;
    if (typeof x.imageId === 'string' && Number.isInteger(x.figure)) out[x.imageId] = [fi, x.figure];
    for (const v of Object.values(x)) walk(v, fi);
  };
  createReportPlan(doc).findings.forEach((f, i) => walk(f, i));
  return out;
};

for (const [engine, port] of [['chrome', 9593], ['firefox', 9693]]) test(`move to another finding in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 300000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const dir = join(fxDir, engine);
  mkdirSync(dir, { recursive: true });
  const b = await launch(engine, port, { downloadDir: dir });
  const openFinding = (i) => b.evaluate(`document.querySelectorAll('.navitem.finding, [data-testid=finding-nav] .navitem')[${i}]?.click() ?? ${nav(fx.findings[i].title.slice(0, 20))}`);
  /** Opens the move dialog for a card, picks a finding and place, confirms. */
  const move = async (cardSel, fid, where, { confirm = true } = {}) => {
    await b.evaluate(`document.querySelector(${JSON.stringify(cardSel)}).querySelector('[data-testid=move-finding-open]').click()`);
    assert.ok(await b.waitFor("!!document.querySelector('dialog [data-testid=move-finding]')"), 'dialog opened');
    await b.evaluate(`(() => { const s = document.querySelector('[data-testid=move-finding]'); s.value = ${JSON.stringify(fid)}; ${where ? `document.querySelector('[data-testid=move-to-${where}]').checked = true;` : ''} })()`);
    if (confirm) await b.evaluate("document.querySelector('[data-testid=move-confirm]').click()");
    else await b.evaluate("[...document.querySelectorAll('dialog button')].find((x) => x.textContent === 'Cancel').click()");
    assert.ok(await b.waitFor("!document.querySelector('dialog')"), 'dialog closed');
  };
  const undo = () => b.evaluate("document.querySelector('[data-testid=undo]').click()");
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fxPath);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate(nav(f1.title.slice(0, 20)));
    assert.ok(await b.waitFor("!!document.querySelector('[data-testid=move-finding-open]')"));

    await t.test('a text block goes to the end of the other finding; Undo restores the exact project', async () => {
      const before = await b.evaluate(snap);
      const blk = before.findings[0].details[1];
      await move(`[data-block="${blk.id}"]`, f3.id);
      const after = await b.evaluate(snap);
      assert.equal(after.findings[0].details.some((x) => x.id === blk.id), false, 'gone from the source');
      assert.deepEqual(after.findings[2].details.at(-1), blk, 'same block, same id, at the end');
      assert.equal(after.findings[0].details.length, before.findings[0].details.length - 1);
      assert.equal(await b.evaluate(undoText), `Moved text block to ${disp(2)} ${f3.title}, in Additional details.`);
      await valid(after);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before, 'exact project back');
      assert.equal(await b.evaluate(status), `Moved text block back to ${disp(0)} ${f1.title}, in Additional details.`);
    });

    await t.test('a block id already used in the destination gets a new id; Undo gives the original back', async () => {
      const before = await b.evaluate(snap);
      const blk = before.findings[0].details[0];
      assert.equal(before.findings[1].details[0].id, blk.id, 'fixture: same id in F-002');
      await move(`[data-block="${blk.id}"]`, f2.id);
      const after = await b.evaluate(snap);
      const moved = after.findings[1].details.at(-1);
      assert.notEqual(moved.id, blk.id);
      assert.deepEqual({ ...moved, id: blk.id }, blk, 'text and format unchanged');
      await valid(after);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
    });

    await t.test('a destination without Additional details gets one, and loses it again on Undo', async () => {
      const before = await b.evaluate(snap);
      assert.equal('details' in before.findings[3], false, 'fixture: F-004 has no details');
      const blk = before.findings[0].details[2];
      await move(`[data-block="${blk.id}"]`, fx.findings[3].id);
      const after = await b.evaluate(snap);
      assert.deepEqual(after.findings[3].details, [blk]);
      await valid(after);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before, 'details absent again');
    });

    await t.test('screenshots: details to gallery, gallery to gallery, gallery to details, details to details', async () => {
      const start = await b.evaluate(snap);
      const imgBlock = start.findings[0].details.find((x) => x.type === 'image');
      const id = imgBlock.imageId;
      const record = start.images.find((im) => im.id === id);
      const fig0 = figures(start);
      // details (F-001) -> gallery (F-002)
      await move(`[data-block="${imgBlock.id}"]`, f2.id, 'evidence');
      let s = await b.evaluate(snap);
      assert.deepEqual(s.findings[1].evidence.at(-1), id);
      assert.equal(s.findings[0].details.some((x) => x.id === imgBlock.id), false);
      assert.deepEqual(s.images.find((im) => im.id === id), record, 'same image record');
      assert.equal(s.images.length, start.images.length);
      assert.equal(figures(s)[id][0], 1, 'Word plan: under F-002');
      await valid(s);
      // gallery (F-002) -> gallery (F-003)
      await b.evaluate(nav(f2.title.slice(0, 20)));
      assert.ok(await b.waitFor(`!!document.querySelector('[data-section=evidence] [data-image="${id}"]')`));
      await move(`[data-section=evidence] [data-image="${id}"]`, f3.id, 'evidence');
      s = await b.evaluate(snap);
      assert.equal(s.findings[1].evidence.includes(id), false);
      assert.equal(s.findings[2].evidence.at(-1), id);
      // gallery (F-003) -> details (F-001): a new wrapper block
      await b.evaluate(nav(f3.title.slice(0, 20)));
      assert.ok(await b.waitFor(`!!document.querySelector('[data-section=evidence] [data-image="${id}"]')`));
      await move(`[data-section=evidence] [data-image="${id}"]`, f1.id, 'details');
      s = await b.evaluate(snap);
      const wrap = s.findings[0].details.at(-1);
      assert.equal(wrap.type, 'image');
      assert.equal(wrap.imageId, id);
      assert.equal(s.findings[2].evidence.includes(id), false);
      await valid(s);
      // details (F-001) -> details (F-002)
      await b.evaluate(nav(f1.title.slice(0, 20)));
      assert.ok(await b.waitFor(`!!document.querySelector('[data-block="${wrap.id}"]')`));
      const beforeLast = await b.evaluate(snap);
      await move(`[data-block="${wrap.id}"]`, f2.id, 'details');
      s = await b.evaluate(snap);
      assert.equal(s.findings[1].details.at(-1).imageId, id);
      await valid(s);
      // Outputs follow: the figure lives under F-002, numbers stay sequential, CSV and Markdown agree.
      const fig = figures(s);
      assert.equal(fig[id][0], 1);
      const nums = Object.values(fig).map(([, n]) => n).sort((a, z) => a - z);
      assert.deepEqual(nums, nums.map((_, k) => k + 1), 'figure numbers 1..n without gaps');
      assert.deepEqual(Object.keys(fig).sort(), Object.keys(fig0).sort(), 'same screenshots in the report');
      // Records start with the quoted finding ID; cells can hold line breaks.
      const csv = findingsCsv(s);
      const rowOf = (i) => { const a = csv.indexOf(`\n"${disp(i)}",`); const z = csv.indexOf(`\n"${disp(i + 1)}",`); return a < 0 ? '' : csv.slice(a, z < 0 ? undefined : z); };
      assert.ok(rowOf(1).includes(`Screenshot ${id}`), 'CSV: in the second finding row');
      assert.equal(rowOf(0).includes(`Screenshot ${id}`), false, 'CSV: not in the first finding row');
      const md = reportMarkdown(s);
      const at = md.indexOf(`: ${record.caption}`); // Markdown shows "[Figure N: caption]"
      const head = (i) => md.lastIndexOf(disp(i)); // the finding heading comes after the summary table
      assert.ok(at > head(1) && at < head(2), "Markdown: placeholder under the second finding");
      // Undo the last move: back in F-001 at the end.
      await undo();
      assert.deepEqual(await b.evaluate(snap), beforeLast);
    });

    await t.test('a hidden destination section is named in the dialog and in the message', async () => {
      const p = join(dir, 'sample.rootnote.json');
      writeFileSync(p, JSON.stringify(sample)); // Evidence is hidden in the released sample
      await b.setFile('[data-testid=open-input]', p);
      if (await b.waitFor("!!document.querySelector('dialog.confirm [data-confirm]')", 3000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.project.sections.finding.find((s) => s.key === 'evidence').enabled === false`, 60000));
      await b.evaluate(nav(f2.title.slice(0, 20)));
      const before = await b.evaluate(snap);
      const blk = sample.findings[1].details.find((x) => x.type === 'image');
      assert.ok(await b.waitFor(`!!document.querySelector('[data-block="${blk.id}"] [data-testid=move-finding-open]')`));
      await b.evaluate(`document.querySelector('[data-block="${blk.id}"] [data-testid=move-finding-open]').click()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-testid=move-to-evidence]')"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=move-to-evidence]').closest('label').textContent"), /Evidence \(hidden in the report\)/);
      await b.evaluate(`document.querySelector('[data-testid=move-finding]').value = ${JSON.stringify(f3.id)}; document.querySelector('[data-testid=move-to-evidence]').checked = true; document.querySelector('[data-testid=move-confirm]').click()`);
      assert.ok(await b.waitFor(offered));
      assert.match(await b.evaluate(undoText), /in Evidence\. Evidence is hidden in the report\.$/);
      await undo();
      assert.deepEqual(await b.evaluate(snap), before);
      // Back to the fixture for the next tests.
      await b.setFile('[data-testid=open-input]', fxPath);
      if (await b.waitFor("!!document.querySelector('dialog.confirm [data-confirm]')", 3000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.project.sections.finding.find((s) => s.key === 'evidence').enabled === true`, 60000));
    });

    await t.test('Cancel moves nothing; a refused move changes nothing and keeps the earlier Undo', async () => {
      await b.evaluate(nav(f1.title.slice(0, 20)));
      let before = await b.evaluate(snap);
      await move(`[data-block="${before.findings[0].details[0].id}"]`, f3.id, null, { confirm: false });
      assert.deepEqual(await b.evaluate(snap), before);
      // Fill F-004 to 100 blocks, then remove a block from F-001 to have an Undo offer.
      await b.evaluate(`(() => { const doc = window.__fieldnote.snapshot(); return doc; })()`);
      const full = structuredClone(before);
      full.findings[3].details = Array.from({ length: 100 }, (_, k) => ({ id: `B-full-${k}`, type: 'text', text: '', format: 'plain' }));
      const fullPath = join(dir, 'full.rootnote.json');
      writeFileSync(fullPath, JSON.stringify(full));
      await b.setFile('[data-testid=open-input]', fullPath);
      if (await b.waitFor("!!document.querySelector('dialog.confirm [data-confirm]')", 3000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.findings[3].details?.length === 100`, 60000));
      await b.evaluate(nav(f1.title.slice(0, 20)));
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=move-finding-open]')"));
      const removable = (await b.evaluate(snap)).findings[0].details.find((x) => x.type === 'text' && x.text.trim());
      await b.evaluate(`[...document.querySelector('[data-block="${removable.id}"]').querySelectorAll('button')].find((x) => x.textContent === 'Remove').click()`);
      assert.ok(await b.waitFor(offered));
      const offer = await b.evaluate(undoText);
      before = await b.evaluate(snap);
      await move(`[data-block="${before.findings[0].details[0].id}"]`, fx.findings[3].id);
      assert.match(await b.evaluate(status), /already holds 100 blocks in Additional details.*Nothing has been moved/);
      assert.deepEqual(await b.evaluate(snap), before, 'nothing changed');
      assert.equal(await b.evaluate(undoText), offer, 'the earlier Undo is still offered');
    });

    await t.test('the project changing while the dialog is open: nothing is moved', async () => {
      const before = await b.evaluate(snap);
      const blk = before.findings[0].details[0];
      await b.evaluate(`document.querySelector('[data-block="${blk.id}"] [data-testid=move-finding-open]').click()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-testid=move-finding]')"));
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=finding-title]'); i.value = i.value + ' (edited)'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate(`document.querySelector('[data-testid=move-finding]').value = ${JSON.stringify(f3.id)}; document.querySelector('[data-testid=move-confirm]').click()`);
      assert.ok(await b.waitFor(`/changed while the dialog was open, so nothing was moved/.test(${status})`));
      const after = await b.evaluate(snap);
      assert.deepEqual(after.findings.map((f) => f.details), before.findings.map((f) => f.details));
    });

    await t.test('saved and reopened, the screenshot stays where it was moved', async () => {
      const s = await b.evaluate(snap);
      const imgBlock = s.findings[0].details.find((x) => x.type === 'image');
      await move(`[data-block="${imgBlock.id}"]`, f3.id, 'details');
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      const file = await waitForFile(dir, /\.rootnote\.json$/, 60000);
      const raw = readFileSync(file, 'utf8');
      assert.equal((await validateProjectFile(raw, Buffer.byteLength(raw))).ok, true);
      const saved = JSON.parse(raw);
      assert.equal(saved.findings[2].details.at(-1).imageId, imgBlock.imageId);
      assert.equal(saved.findings[0].details.some((x) => x.imageId === imgBlock.imageId), false);
    });

    await t.test('with one finding there is no move to another finding', async () => {
      const one = structuredClone(sample);
      one.findings = one.findings.slice(0, 1);
      const used = new Set(one.findings[0].details.filter((x) => x.type === 'image').map((x) => x.imageId));
      for (const v of Object.values(one.project.branding ?? {})) if (v?.imageId) used.add(v.imageId);
      one.images = one.images.filter((im) => used.has(im.id));
      const p = join(dir, 'one.rootnote.json');
      writeFileSync(p, JSON.stringify(one));
      await b.setFile('[data-testid=open-input]', p);
      if (await b.waitFor("!!document.querySelector('dialog.confirm [data-confirm]')", 3000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 1`, 60000));
      await b.evaluate(nav(f1.title.slice(0, 20)));
      assert.ok(await b.waitFor('!!document.querySelector("[data-block]")'));
      assert.equal(await b.evaluate("document.querySelectorAll('[data-testid=move-finding-open]').length"), 0);
    });
    assert.deepEqual(b.errors, [], 'page errors');
  } finally {
    await b.close();
  }
});

// Near the limit of the test-budget build (25 MB): a large gallery screenshot and a padded
// executive summary leave 20 bytes. A gallery screenshot moved into Additional details gets a
// block wrapper (more bytes) and is refused; moved gallery to gallery it fits.
function crc32(buf) {
  let crc = 0xffffffff;
  for (const x of buf) { crc ^= x; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function noisyPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = randomBytes((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
function nearCap() {
  const doc = structuredClone(fx);
  doc.project.executiveSummary = '';
  const size = () => savedSize({ ...doc, appVersion: APP_VERSION });
  const target = TEST_FILE_BYTES - 20;
  const record = (id, png, caption) => ({ id, mime: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: png.readUInt32BE(16),
    height: png.readUInt32BE(20), bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), caption, tallMode: 'auto', originalName: `${id}.png` });
  // Fillers (each under the 2 MB screenshot limit) in F-004's gallery, while the room left is large.
  let n = 0;
  while (target - size() > 4_000_000) {
    const id = `IMG-${8001 + n++}`;
    doc.images.push(record(id, noisyPng(800, 780), 'Filler screenshot'));
    doc.findings[3].evidence.push(id);
  }
  // The screenshot to move, sized so a padded executive summary closes the last gap.
  doc.findings[2].evidence.push('IMG-9001');
  doc.project.nextImageNumber = Math.max(doc.project.nextImageNumber, 9002);
  let w = 1000;
  for (let tries = 0; tries < 400; tries++) {
    doc.images = doc.images.filter((x) => x.id !== 'IMG-9001').concat(record('IMG-9001', noisyPng(w, 600), 'Large gallery screenshot'));
    const gap = target - size();
    if (gap >= 0 && gap < 19000) { doc.project.executiveSummary = 'x'.repeat(gap); break; }
    w += gap < 0 ? -2 : Math.max(2, Math.floor(gap / 2400) * 2);
  }
  assert.equal(size(), target);
  return doc;
}

for (const [engine, port] of [['chrome', 9594], ['firefox', 9694]]) test(`a move that would go over the limit in ${engine}`, { skip: (!installed(engine) && `${engine} not installed`) || (!existsSync(TEST_BUDGET_DIST) && 'run node scripts/build-test-budget.mjs first'), timeout: 240000 }, async () => {
  const doc = nearCap();
  const p = join(fxDir, `near-cap-${engine}.rootnote.json`);
  writeFileSync(p, JSON.stringify(doc));
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(TEST_BUDGET_DIST).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', p);
    assert.ok(await b.waitFor(`${snap}.images.some((im) => im.id === 'IMG-9001')`, 120000), await b.evaluate(status));
    await b.evaluate(nav(f3.title.slice(0, 20)));
    const card = '[data-section=evidence] [data-image="IMG-9001"]';
    assert.ok(await b.waitFor(`!!document.querySelector('${card} [data-testid=move-finding-open]')`, 60000));
    const pick = async (where) => {
      await b.evaluate(`document.querySelector('${card} [data-testid=move-finding-open]').click()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-testid=move-finding]')"));
      await b.evaluate(`document.querySelector('[data-testid=move-finding]').value = ${JSON.stringify(f1.id)}; document.querySelector('[data-testid=move-to-${where}]').checked = true; document.querySelector('[data-testid=move-confirm]').click()`);
      assert.ok(await b.waitFor("!document.querySelector('dialog')"));
    };
    const before = await b.evaluate(snap);
    await pick('details');
    assert.match(await b.evaluate(status), /^Moving this would take the project over 25 MB\. Putting a screenshot in Additional details wraps it in a block.*Nothing has been moved\. Put it in Evidence instead/);
    assert.deepEqual(await b.evaluate(snap), before, 'nothing changed');
    assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    await pick('evidence');
    assert.ok(await b.waitFor(offered));
    const after = await b.evaluate(snap);
    assert.equal(after.findings[0].evidence.at(-1), 'IMG-9001');
    assert.equal(after.findings[2].evidence.includes('IMG-9001'), false);
    assert.deepEqual(b.errors, [], 'page errors');
  } finally {
    await b.close();
  }
});

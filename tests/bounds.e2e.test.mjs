// Supported-bounds fixture (20 findings, 30 screenshots) through the real UI:
// open, export A4 and Letter in Chrome and Edge, check every finding id, every
// figure caption, and that split parts match the shared report plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { migrateV1toV2 } from '../src/app/project.js';
import { createReportPlan } from '../src/export-docx/plan.js';

const require = createRequire(import.meta.url);
// The shared helper waits for a complete download (Firefox fills the final name from a .part file).
const { launch, installed, ENGINES, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixturePath = here('./fixtures/bounds.json');
const bounds = JSON.parse(readFileSync(fixturePath, 'utf8'));
let port = 9580;

const PAPER = { A4: 'w:w="11906" w:h="16838"', Letter: 'w:w="12240" w:h="15840"' };

for (const name of Object.keys(ENGINES)) {
  test(`bounds fixture exports through the UI in ${name}`, { skip: !installed(name) && 'browser not installed', timeout: 180000 }, async () => {
    assert.ok(existsSync(dist), 'run npm run build first');
    const b = await launch(name, port++);
    // The driver records every request other than the pages the test opens itself.
    const requests = b.requests;
    try {
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.setFile('[data-testid=open-input]', fixturePath);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 20', 60000), 'bounds fixture did not open');
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check')).click()");

      for (const paper of ['A4', 'Letter']) {
        const out = here(`./out/bounds-${name}-${paper}`);
        rmSync(out, { recursive: true, force: true });
        mkdirSync(out, { recursive: true });
        await b.allowDownloads(out);
        await b.evaluate(`(() => { const el = document.querySelector('[data-testid=export-paper]'); el.value = '${paper}'; })()`);
        await b.evaluate("document.querySelector('[data-testid=export]').click()");
        const docx = await waitForFile(out, /\.docx$/, 60000);
        const zip = await JSZip.loadAsync(readFileSync(docx));
        const xml = await zip.file('word/document.xml').async('string');
        assert.ok(xml.includes(PAPER[paper]), `${paper} page size missing`);
        // Visible IDs are <prefix>-<position>; the converted fixture has no engagement ID, so F.
        bounds.findings.forEach((f, i) => assert.ok(xml.includes(`>F-${i + 1} `), `F-${i + 1} missing`));
        assert.equal((xml.match(/SEQ Figure \\\* ARABIC/g) || []).length, 30, 'one numbered caption per screenshot');
        const ids = [...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
        assert.equal(new Set(ids).size, ids.length, 'drawing ids must be unique');
        // Split parts: every "part n of m" group must exist in full.
        const parts = [...xml.matchAll(/\(part (\d+) of (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        for (const [n, m] of parts) assert.ok(n >= 1 && n <= m);
        const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'));
        assert.ok(media.length >= 30, `only ${media.length} media files`);
        for (const rels of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
          assert.doesNotMatch(await zip.file(rels).async('string'), /TargetMode="External"/);
        }
      }

      // Same project with the four 1280x3400 screenshots set to split.
      const variant = structuredClone(bounds);
      for (const im of variant.images) if (im.height === 3400) im.tallMode = 'split';
      const variantPath = here(`./out/bounds-split-${name}.json`);
      writeFileSync(variantPath, JSON.stringify(variant));
      await b.setFile('[data-testid=open-input]', variantPath);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.startsWith('Opened \"bounds-split')", 60000), 'split variant did not open');
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check')).click()");
      const out = here(`./out/bounds-${name}-split`);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      await b.allowDownloads(out);
      await b.evaluate("document.querySelector('[data-testid=export]').click()");
      const zip = await JSZip.loadAsync(readFileSync(await waitForFile(out, /\.docx$/, 60000)));
      const xml = await zip.file('word/document.xml').async('string');
      // Caption text only; the same suffix also appears in each image's alt text.
      const parts = [...xml.matchAll(/<w:t[^>]*>[^<]*\(part (\d+) of (\d+)\)/g)].map((m) => m[1] + '/' + m[2]);
      // Expected parts come from the same plan the exporter and the preview use, not a
      // hard-coded count: the split depends on paper, header/footer reserves and captions.
      const plan = createReportPlan(migrateV1toV2(variant), { paperSize: variant.project.paperSize });
      const planned = plan.findings.flatMap((f) => f.sections.filter((s) => s.kind === 'evidence').flatMap((s) => s.images));
      const expected = planned.flatMap((ev) => ev.parts.filter((p) => p.count > 1).map((p) => p.index + '/' + p.count));
      const totalParts = planned.reduce((n, ev) => n + ev.parts.length, 0);
      assert.equal(planned.filter((ev) => ev.parts.length > 1).length, 4, 'the four tall screenshots split');
      assert.deepEqual(parts, expected);
      assert.equal((xml.match(/<a:blip /g) || []).length, totalParts);
      assert.equal((xml.match(/SEQ Figure \\\* ARABIC/g) || []).length, 30, 'parts keep one figure number');
      assert.equal((xml.match(/SEQ Figure \\c/g) || []).length, totalParts - 30, 'continuation parts repeat the number');

      assert.deepEqual(requests, []);
    } finally {
      await b.close();
    }
  });
}

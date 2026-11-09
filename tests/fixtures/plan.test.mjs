import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { migrateV1toV2, resolveFindingPrefix as sharedPrefix, validateProjectFile } from '../../src/app/project.js';
import { createReportPlan, resolveFindingPrefix, getDisplayFindingId, resolveEngagementValue } from '../../src/export-docx/plan.js';
const load = async () => migrateV1toV2(JSON.parse(await fs.readFile(new URL('./small.json', import.meta.url), 'utf8')));

test('plan shares the authoritative prefix function and derives order-based IDs without mutation', async () => {
  assert.equal(resolveFindingPrefix, sharedPrefix);
  const p = await load(); p.project.engagementId = 'ACME'; p.findings.reverse();
  const before = structuredClone(p), plan = createReportPlan(p);
  assert.equal(plan.findings[0].id, 'F-003'); assert.equal(plan.findings[0].displayId, 'ACME-1');
  assert.equal(getDisplayFindingId(p, 2), 'ACME-3'); assert.deepEqual(p, before);
  plan.imageAssets[0].caption = 'changed plan copy'; assert.notEqual(p.images[0].caption, 'changed plan copy');
});

test('all score modes present manual ratings independently from computed CVSS', async () => {
  const p = await load(); p.findings[0].rating = 'Low'; p.findings[0].cvss = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  for (const [mode, keys] of [['severity', ['id','title','rating']], ['risk', ['id','title','rating']],
    ['cvss', ['id','title','cvss']], ['severity+cvss', ['id','title','rating','cvss']], ['risk+cvss', ['id','title','rating','cvss']]]) {
    p.project.scoring.mode = mode; const plan = createReportPlan(p);
    assert.deepEqual(plan.summary.columns.map(c => c.key), keys);
    if (mode.includes('cvss')) assert.equal(plan.summary.rows[0].values.cvss, '9.8');
    if (mode !== 'cvss') assert.equal(plan.summary.rows[0].values.rating, 'Low');
  }
  p.findings[0].cvss = null; assert.equal(createReportPlan(p).summary.rows[0].values.cvss, 'Unscored');
});

test('configuration controls section order, omission, renamed headings and safe summary anchors', async () => {
  const p = await load(); p.project.backToSummaryLinks = true;
  const details = p.project.sections.finding.find(s => s.key === 'details'); details.label = 'Literal evidence';
  p.project.sections.finding.reverse();
  let plan = createReportPlan(p); assert.equal(plan.findings[0].sections[0].key, 'evidence');
  assert.equal(plan.findings[0].sections.find(s => s.key === 'details').format, 'code');
  assert.equal(plan.findings[0].backToSummary, true);
  p.project.sections.report.find(s => s.key === 'findingsSummary').enabled = false;
  p.project.sections.finding.find(s => s.key === 'evidence').enabled = false;
  plan = createReportPlan(p); assert.equal(plan.findings[0].backToSummary, false);
  assert.ok(!plan.reportSections.some(s => s.kind === 'summary'));
  assert.ok(plan.findings.every(f => !f.sections.some(s => s.kind === 'evidence')));
  assert.ok(plan.findings.every(f => /^finding_F_\d{3}$/.test(f.anchor)));
});

test('split geometry covers all original rows exactly once and shares caption reserves in A4/Letter', async () => {
  const p = await load(); const tall = p.images.find(im => im.height > 3000); tall.tallMode = 'auto';
  for (const paperSize of ['A4', 'Letter']) {
    const plan = createReportPlan(p, {paperSize}); const evidence = plan.findings.flatMap(f => f.sections.filter(s => s.kind === 'evidence').flatMap(s => s.images)).find(im => im.imageId === tall.id);
    assert.ok(evidence.parts.length >= 2); let y = 0;
    for (const part of evidence.parts) { assert.equal(part.y, y); y += part.sourceHeight; assert.ok(part.width <= plan.geometry.contentWidth); assert.ok(part.height < plan.geometry.contentHeight); }
    assert.equal(y, tall.height); assert.equal(evidence.parts[0].sequence, 'increment');
    const heights=evidence.parts.map(p=>p.sourceHeight);assert.ok(Math.max(...heights)-Math.min(...heights)<=1,'balanced cuts avoid a tiny remainder part');
    assert.ok(evidence.parts.slice(1).every(p => p.sequence === 'repeat'));
  }
  tall.tallMode = 'fit'; assert.equal(createReportPlan(p).findings.flatMap(f => f.sections.filter(s => s.kind === 'evidence').flatMap(s => s.images)).find(im => im.imageId === tall.id).parts.length, 1);
});

test('bound engagement rows use source values, single dates and spaced en dash', async () => {
  const p = await load(); p.project.sections.report.find(s => s.key === 'engagement').enabled = true;
  assert.equal(resolveEngagementValue({source:'testingPeriod'}, {startDate:'2026-01-01',endDate:'2026-01-02'}), '2026-01-01 \u2013 2026-01-02');
  assert.equal(resolveEngagementValue({source:'testingPeriod'}, {endDate:'2026-01-02'}), '2026-01-02');
  const plan = createReportPlan(p); assert.ok(plan.reportSections.find(s => s.kind === 'engagement').rows.length > 0);
  assert.ok(plan.reportSections.find(s => s.kind === 'engagement').rows.every(r => r.value.trim()));
  const raw = JSON.stringify(p); assert.equal((await validateProjectFile(raw, Buffer.byteLength(raw))).ok, true);
});

// Findings CSV: spreadsheet-safe cells, Excel-friendly encoding, the report's
// own column words, and a round trip through a strict CSV reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvCell, findingsCsv } from '../src/app/csv.js';

const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../release-template/sample-project.rootnote.json', import.meta.url)), 'utf8'));

/** A strict RFC 4180 reader: quoted fields, doubled quotes, CRLF between records. */
function parse(text) {
  assert.ok(text.startsWith('﻿'), 'byte-order mark');
  const rows = [];
  let row = [], field = '', i = 1, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
    throw new Error(`unquoted character ${JSON.stringify(c)} at ${i}`);
  }
  assert.equal(field, '', 'ends with CRLF');
  return rows;
}

test('a cell that a spreadsheet would run as a formula starts with an apostrophe', () => {
  for (const bad of ['=HYPERLINK("http://x","a")', '+1+2', '-2+3', '@SUM(A1)', '\tx', '\rx', '=cmd|\' /C calc\'!A0',
    ' =after a space', '​=after a zero-width space', '﻿=after a BOM', '＝full-width equals', ' ＋full-width plus']) {
    assert.ok(csvCell(bad).startsWith(`"'`), bad);
  }
  for (const ok of ['Critical', 'CWE-79', 'a = b', '9.1', '', ' text']) assert.ok(!csvCell(ok).startsWith(`"'`), ok);
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '""');
});

test('the sample exports one row per finding, in order, with the report\'s words and every field', () => {
  const rows = parse(findingsCsv(sample));
  assert.equal(rows.length, 1 + sample.findings.length);
  const [head, first] = rows;
  assert.deepEqual(head.slice(0, 8), ['ID', 'Title', 'Severity', 'CVSS Base score', 'CVSS Base vector', 'Status', 'Vulnerability type', 'CWE']);
  assert.ok(rows.every((r) => r.length === head.length), 'same number of columns in every row');
  assert.equal(first[0], 'UNR-2026-014-1');
  assert.equal(first[1], sample.findings[0].title);
  assert.equal(first[2], 'Critical');
  assert.equal(first[3], '9.1');
  assert.equal(first[6], 'Weak password recovery');
  assert.equal(first[7], 'CWE-640');
  assert.match(first[10], /\[Screenshot IMG-\d{4}: /, 'screenshots appear as placeholders with captions');
  assert.ok(first.join('\n').includes('\n'), 'multi-line text stays inside its quoted cell');
  // A bullet list in the text starts with "-", so it is neutralised, not lost.
  const bullets = rows.flat().filter((c) => c.startsWith("'-"));
  for (const c of bullets) assert.ok(c.slice(1).startsWith('-'));
});

test('an unscored finding says Unscored and leaves the CVSS cells empty', () => {
  const doc = structuredClone(sample);
  doc.findings[0].rating = null;
  doc.findings[0].cvss = null;
  const [, first] = parse(findingsCsv(doc));
  assert.deepEqual(first.slice(2, 5), ['Unscored', '', '']);
});

test('a finding text that is a formula is exported as text', () => {
  const doc = structuredClone(sample);
  doc.findings[0].title = '=HYPERLINK("http://evil.example","click")';
  const [, first] = parse(findingsCsv(doc));
  assert.equal(first[1], `'=HYPERLINK("http://evil.example","click")`);
});

test('direction marks, soft hyphens, the minus sign and small-form look-alikes are neutralised', () => {
  for (const c of ['‎=1', '‏+1', '‪-1', '⁦@x', '­=1', '᠎=1', '⁡=1', '− 1', '﹢x', '﹣x', '﹦x', '﹫x']) {
    assert.equal(csvCell(c), `"'${c}"`, JSON.stringify(c));
  }
  assert.equal(csvCell('a−b'), '"a−b"');
});

test('hidden report sections stay empty, CVSS-only reports have no rating, and a missing status says so', () => {
  const doc = structuredClone(sample);
  for (const s of doc.project.sections.finding) if (['impact', 'evidence', 'details'].includes(s.key)) s.enabled = false;
  doc.project.scoring.mode = 'cvss';
  delete doc.findings[0].status;
  const rows = parse(findingsCsv(doc));
  const col = (name) => rows[0].indexOf(doc.project.sections.finding.find((s) => s.key === name).label);
  for (const r of rows.slice(1)) {
    assert.equal(r[col('impact')], '');
    assert.equal(r[col('details')], '');
    assert.equal(r[2], '', 'no rating in CVSS-only mode');
  }
  assert.notEqual(rows[1][col('description')], '', 'shown sections keep their text');
  assert.equal(rows[1][5], doc.project.labels.statusNotSet);
});

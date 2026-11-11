// CVSS 4.0 Base: every possible Base vector scored by our port and by the untouched FIRST
// reference calculator (tests/fixtures/cvss4-reference, pinned commit c5b0d409, BSD-2-Clause),
// run in its own context so it shares no code or tables with the port. Plus FIRST examples,
// boundaries and the strict parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseCvss40, CVSS40_ORDER, CVSS40_VALUES } from '../src/scoring/cvss40.js';

function reference() {
  const ctx = vm.createContext({});
  for (const f of ['cvss_lookup.js', 'max_composed.js', 'max_severity.js', 'cvss_score.js']) {
    vm.runInContext(readFileSync(new URL(`./fixtures/cvss4-reference/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  }
  // As the reference app does: every Threat, Environmental and Supplemental metric Not Defined.
  const notDefined = Object.fromEntries(['E', 'CR', 'IR', 'AR', 'MAV', 'MAC', 'MAT', 'MPR', 'MUI', 'MVC', 'MVI', 'MVA', 'MSC', 'MSI', 'MSA', 'S', 'AU', 'R', 'V', 'RE', 'U'].map((k) => [k, 'X']));
  return (metrics) => {
    ctx.selected = { ...metrics, ...notDefined };
    return vm.runInContext('cvss_score(selected, cvssLookup_global, maxSeverity, macroVector(selected))', ctx);
  };
}

function* everyVector() {
  const keys = CVSS40_ORDER;
  const walk = function* (i, acc) {
    if (i === keys.length) { yield acc; return; }
    for (const v of CVSS40_VALUES[keys[i]]) yield* walk(i + 1, { ...acc, [keys[i]]: v });
  };
  yield* walk(0, {});
}
const vectorOf = (metrics) => 'CVSS:4.0/' + CVSS40_ORDER.map((k) => `${k}:${metrics[k]}`).join('/');

test('all 104,976 CVSS 4.0 Base vectors score exactly as the FIRST reference calculator', () => {
  const ref = reference();
  let count = 0, mismatches = 0;
  const first = [];
  for (const metrics of everyVector()) {
    count++;
    const vector = vectorOf(metrics);
    const ours = parseCvss40(vector);
    const theirs = ref(metrics);
    assert.equal(ours.vector, vector);
    if (ours.score !== theirs) { mismatches++; if (first.length < 5) first.push(`${vector}: ${ours.score} vs ${theirs}`); }
    assert.ok(Number.isFinite(ours.score) && ours.score >= 0 && ours.score <= 10 && Math.round(ours.score * 10) === ours.score * 10);
  }
  assert.equal(count, 104976);
  assert.equal(mismatches, 0, first.join('\n'));
});

test('scoring the same vectors again, in reverse, gives the same results and leaves input alone', () => {
  const all = [...everyVector()].filter((_, i) => i % 97 === 0).map(vectorOf);
  const forward = all.map((v) => parseCvss40(v).score);
  const input = all.slice();
  const backward = all.slice().reverse().map((v) => parseCvss40(v).score).reverse();
  assert.deepEqual(backward, forward);
  assert.deepEqual(all, input);
});

test('FIRST examples and boundaries', () => {
  const s = (v) => parseCvss40(v).score;
  // Examples from the FIRST CVSS v4.0 specification and calculator.
  assert.equal(s('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H'), 10);
  assert.equal(s('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'), 9.3);
  assert.equal(s('CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'), 8.5);
  // No impact anywhere is 0 (None), not unscored.
  assert.equal(s('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N'), 0);
  // The lowest scoring vector with any impact.
  assert.equal(s('CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:N/VI:N/VA:N/SC:L/SI:N/SA:N') > 0, true);
});

test('metrics in any order give the canonical vector; nothing else is accepted', () => {
  const canonical = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
  assert.equal(parseCvss40('CVSS:4.0/SA:N/SI:N/SC:N/VA:H/VI:H/VC:H/UI:N/PR:N/AT:N/AC:L/AV:N').vector, canonical);
  for (const bad of [
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N',                // missing SA
    canonical + '/E:A', canonical + '/E:X', canonical + '/CR:H', canonical + '/S:N', // threat, env, supplemental
    'CVSS:4.0/AV:N/AV:N/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',           // duplicate
    'CVSS:4.0/AV:X/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',           // invalid value
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:S/SA:N',           // S is MSI only
    canonical.toLowerCase(), ' ' + canonical, canonical + ' ', canonical + '/',
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 'CVSS:4.0/', '', null, 42,
  ]) assert.throws(() => parseCvss40(bad), undefined, String(bad));
});

test('every CVSS 3.1 Base vector scores as before through the shared parser', async () => {
  const { parseCvss, parseCvss31, cvssVersion } = await import('../src/scoring/index.js');
  const values = { AV: 'NALP', AC: 'LH', PR: 'NLH', UI: 'NR', S: 'UC', C: 'NLH', I: 'NLH', A: 'NLH' };
  let vectors = [''];
  for (const [k, vs] of Object.entries(values)) vectors = vectors.flatMap((v) => [...vs].map((x) => `${v}/${k}:${x}`));
  assert.equal(vectors.length, 2592);
  for (const tail of vectors) {
    const v = 'CVSS:3.1' + tail;
    const a = parseCvss(v), b = parseCvss31(v);
    assert.equal(a.version, '3.1');
    assert.equal(a.score, b.score);
    assert.equal(a.vector, b.vector);
  }
  assert.equal(cvssVersion(null), null);
  assert.equal(cvssVersion('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'), '4.0');
  assert.throws(() => cvssVersion('CVSS:3.0/AV:N'));
  assert.throws(() => parseCvss31('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'), 'the 3.1-only parser stays strict');
});

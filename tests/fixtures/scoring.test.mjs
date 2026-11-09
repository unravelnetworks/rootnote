import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCvss31, scoreCvss31 } from '../../src/scoring/index.js';

// Published FIRST v3.1 examples: MySQL CVE-2013-0375, POODLE CVE-2014-3566,
// Cisco CVE-2012-0384, Shellshock CVE-2014-6271. Primary document checked 2026-11-01:
// https://www.first.org/cvss/v3.1/examples
test('CVSS 3.1 Base agrees with independent FIRST example scores', () => {
  for (const [vector, expected] of [
    ['AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N', 6.4],
    ['AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N', 3.1],
    ['AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H', 7.2],
    ['AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10],
    ['AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0],
    ['AV:N/AC:L/PR:N/UI:N/S:C/C:N/I:N/A:N', 0],
  ]) assert.equal(scoreCvss31('CVSS:3.1/' + vector), expected, vector);
});

test('entry canonicalizes metric order but never drops malformed or extended metrics', () => {
  const vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  assert.equal(parseCvss31('CVSS:3.1/A:H/I:H/C:H/S:U/UI:N/PR:N/AC:L/AV:N').vector, vector);
  for (const invalid of [null, '', vector + '\n', ' ' + vector, vector + '/E:X',
    vector.replace('/A:H', '/C:H'), vector.replace('AV:N', 'AV:NN'), vector.replace('3.1', '4.0'),
    vector.replace('/A:H', ''), vector.replace('/A:H', '/A:Z'), vector.replace('PR:N', '__proto__:N')]) {
    assert.throws(() => parseCvss31(invalid), undefined, String(invalid));
  }
});

test('all 2592 Base vectors yield bounded tenths, stable normalization and zero for no impact', () => {
  let count = 0;
  const walk = (entries, parts = []) => {
    if (!entries.length) {
      const result = parseCvss31('CVSS:3.1/' + parts.join('/'));
      assert.ok(result.score >= 0 && result.score <= 10);
      assert.ok(Math.abs(result.score * 10 - Math.round(result.score * 10)) < 1e-8);
      assert.deepEqual(parseCvss31(result.vector), result);
      if (parts.slice(-3).every(p => p.endsWith(':N'))) assert.equal(result.score, 0);
      count++; return;
    }
    const [[key, values], ...rest] = entries;
    for (const value of values) walk(rest, [...parts, key + ':' + value]);
  };
  walk(Object.entries({ AV: 'NALP', AC: 'LH', PR: 'NLH', UI: 'NR', S: 'UC', C: 'NLH', I: 'NLH', A: 'NLH' }));
  assert.equal(count, 2592);
});

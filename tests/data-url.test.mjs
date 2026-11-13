// Screenshot data URLs are checked with a prefix match and a character scan instead of one
// pattern (faster on large projects). They must accept and reject exactly what the pattern
// did, and the decoder must give the same bytes as atob.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageDataUrl, base64ToBytes } from '../src/app/project.js';

const OLD = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const atobBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

test('accepts and rejects exactly what the old pattern did', () => {
  const cases = [
    'data:image/png;base64,QUJD', 'data:image/png;base64,QUI=', 'data:image/png;base64,QQ==', 'data:image/jpeg;base64,QQ',
    'data:image/png;base64,QQ===', 'data:image/png;base64,', 'data:image/png;base64,=', 'data:image/png;base64,==',
    'data:image/png;base64,QU JD', 'data:image/png;base64,QUJD\n', 'data:image/png;base64,\nQUJD', 'data:image/png;base64,QU\tJD',
    'data:image/jpeg;base64,QU=JD', 'data:image/gif;base64,QUJD', 'data:image/png;base64,QUJD-', 'data:image/png;base64,QUJD_',
    'data:image/png;base64,QUJDé', 'DATA:image/png;base64,QUJD', 'data:image/png;charset=utf-8;base64,QUJD',
    ' data:image/png;base64,QUJD', 'data:image/svg+xml;base64,QUJD', 'data:image/png;base64,Q=Q=', 'data:image/png;base64,QUJD==\n',
  ];
  for (const c of cases) {
    const o = OLD.exec(c), n = parseImageDataUrl(c);
    assert.deepEqual(n, o ? [o[1], o[2]] : null, JSON.stringify(c));
  }
});

test('a long valid data URL is accepted', () => {
  const b64 = Buffer.alloc(300000, 7).toString('base64');
  assert.deepEqual(parseImageDataUrl(`data:image/png;base64,${b64}`), ['png', b64]);
});

test('the decoder gives the same bytes as atob, and fails where atob fails', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 1000, 65537]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 131 + 7) & 255);
    const b64 = Buffer.from(bytes).toString('base64');
    assert.deepEqual(base64ToBytes(b64), atobBytes(b64));
    assert.deepEqual(base64ToBytes(b64.replace(/=+$/, '')), atobBytes(b64.replace(/=+$/, '')), 'without padding');
  }
  for (const bad of ['Q', 'QUJDQ', 'QU=JD', 'Q===']) assert.throws(() => base64ToBytes(bad), undefined, bad);
});

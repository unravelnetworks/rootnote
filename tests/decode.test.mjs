// Runs decodeImageInBrowser in headless Chrome: a real PNG decodes, a structurally
// plausible but undecodable PNG (corrupt IDAT) is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { launch, BROWSERS } = require('./harness/cdp.cjs');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, idat) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('browser decode accepts real PNG and refuses corrupt pixel data', { skip: !existsSync(BROWSERS.chrome) && 'chrome not installed', timeout: 60000 }, async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/app/project.js', import.meta.url))],
    bundle: true, format: 'iife', globalName: 'P', write: false,
  });
  const good = png(5, 4, deflateSync(Buffer.alloc((5 * 3 + 1) * 4))).toString('base64');
  const bad = png(5, 4, Buffer.from('not zlib data at all')).toString('base64');
  const b = await launch('chrome', 9440);
  try {
    await b.evaluate(bundle.outputFiles[0].text + ';0');
    const run = (b64) => b.evaluate(`(async () => {
      const bytes = P.base64ToBytes('${b64}');
      if (!P.sniffImage(bytes)) return 'structural-reject';
      try { return JSON.stringify(await P.decodeImageInBrowser(bytes, 'image/png')); } catch (e) { return 'decode-reject'; }
    })()`);
    assert.equal(await run(good), '{"width":5,"height":4}');
    assert.equal(await run(bad), 'decode-reject');
  } finally {
    await b.close();
  }
});

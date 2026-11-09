// The offline guide.html shipped in the release (scripts/guide.mjs, docs/guide/): every topic is
// present, every in-page link resolves, nothing runs scripts, and its own CSP allows its style.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { offlineGuide, topics, topicSource, markdown } from '../scripts/guide.mjs';

const html = await offlineGuide({ version: '9.9.9', commit: '0123456789abcdef' });

test('every topic is a section with a heading', () => {
  for (const t of topics()) assert.match(html, new RegExp(`<section id="topic-${t.slug || 'overview'}"><h1>`), t.title);
});

test('every in-page link reaches an id, and ids are unique', () => {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  const missing = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.includes(id));
  assert.deepEqual(missing, []);
});

test('links leave only to the Rootnote site or mailto, never relative or scripted', () => {
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(href.startsWith('#') || href.startsWith('https://rootnote.unravelnetworks.com/') || href.startsWith('https://') || href.startsWith('mailto:'), href);
  }
  assert.doesNotMatch(html, /<script|\son[a-z]+=|javascript:/i);
});

test('the version, commit and images are embedded; no tokens are left', () => {
  assert.match(html, /for version 9\.9\.9 \(commit 0123456\)/);
  assert.doesNotMatch(html, /__[A-Z_]+__/);
  assert.doesNotMatch(html, /<img src="(?!data:image\/png;base64,)/);
});

test('its CSP pins the one stylesheet and allows only data: images', () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /img-src data:;/);
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(style).digest('base64')}'`));
});

test('Markdown never turns a scripted URL into a link', () => {
  const { html: out } = markdown('[x](javascript:alert(1)) [y](data:text/html,1) [z](../ok/)');
  assert.doesNotMatch(out, /href="(javascript|data):/);
  assert.match(out, /href="\.\.\/ok\/"/);
});

test('every topic resolves all its tokens (topicSource throws on any left)', async () => {
  for (const t of topics().filter((x) => x.file)) await assert.doesNotReject(topicSource(t, { version: '1', image: (f) => f }), t.file);
});

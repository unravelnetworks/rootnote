// {client} and {application}: one-pass literal filling, the fields that hold tokens, and the
// reverse offer (a name in a library entry replaced by {client} only where ticked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countNameTokens, fillEntry, fillText, nameFields, tokensIn, findName, defaultTicks, replaceMatches } from '../src/app/name-tokens.js';

const entry = () => ({
  id: 'L-1', name: 'IDOR {client}', title: 'Customers of {client} can read invoices in {application}', rating: null, cvss: null,
  affectedAssets: ['{application} API', 'https://{client}.example/api'],
  description: 'In {application}, {client} users {client}.', impact: '', threat: '{client}', recommendation: 'Fix {application}.',
  formats: { description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'code' },
  details: [{ type: 'text', text: 'GET /x HTTP/1.1\r\n\tHost: {client}\n', format: 'code' }, { type: 'text', text: 'SSTI payload {{client}} and {{ application }}', format: 'plain' }],
  references: [{ title: '{client} advisory', url: 'https://example.test/{client}' }],
});

test('counts every token in the fields that can hold them, not in the name or addresses', () => {
  assert.deepEqual(countNameTokens(entry()), { client: 7, application: 4 });
  const keys = nameFields(entry()).map((f) => f.key);
  assert.deepEqual(keys, ['title', 'affectedAssets.0', 'affectedAssets.1', 'description', 'impact', 'threat', 'recommendation', 'details.0', 'details.1', 'references.0']);
});

test('fills in one pass, literally, and leaves the entry unchanged', () => {
  const e = entry();
  const before = structuredClone(e);
  const out = fillEntry(e, { client: '$& {application} [[x]]', application: 'Portal' });
  assert.deepEqual(e, before, 'entry not changed');
  assert.equal(out.title, 'Customers of $& {application} [[x]] can read invoices in Portal');
  assert.equal(out.details[0].text, 'GET /x HTTP/1.1\r\n\tHost: $& {application} [[x]]\n', 'code whitespace and line endings kept');
  assert.equal(out.details[1].text, 'SSTI payload {{client}} and {{ application }}', 'tokens inside {{ }} left alone');
  assert.equal(out.references[0].url, 'https://example.test/{client}', 'addresses never filled');
  assert.equal(out.name, 'IDOR {client}', 'the entry name is not report text');
});

test('an empty value leaves its token; case variants and unknown names stay literal', () => {
  assert.equal(fillText('{client} {application} {Client} {app}', { client: '', application: 'A' }), '{client} A {Client} {app}');
  assert.deepEqual(tokensIn('{client}{client} {{client}} {application}'), { client: 2, application: 1 });
  assert.equal(fillText('ש {client} 😀', { client: 'שלום 𝄞' }), 'ש שלום 𝄞 😀');
});

test('the reverse offer: whole words in prose only, with context; code, assets and references never', () => {
  const e = { title: 'Acme portal leaks data', affectedAssets: ['Acme API'], description: 'Acme users and Acmeville staff', impact: '', threat: '', recommendation: 'Ask Acme.',
    formats: { recommendation: 'code' }, details: [{ type: 'text', text: 'Host: Acme', format: 'code' }, { type: 'text', text: 'Acme confirmed.', format: 'plain' }],
    references: [{ title: 'Acme advisory', url: 'https://acme.example/Acme' }] };
  const found = findName(e, 'Acme');
  assert.deepEqual(found.matches.map((x) => x.key), ['title', 'description', 'details.1']);
  assert.equal(found.partial, true, 'Acmeville is a longer word: not offered, and noted');
  assert.deepEqual(defaultTicks(found), [false, false, false], 'nothing ticked when the name is also inside a longer word');
  const clean = findName({ ...e, description: 'Acme users' }, 'Acme');
  assert.equal(clean.partial, false);
  assert.deepEqual(defaultTicks(clean), [true, true, true]);
  const out = replaceMatches({ ...e, description: 'Acme users' }, clean.matches, [true, false, true]);
  assert.equal(out.title, '{client} portal leaks data');
  assert.equal(out.description, 'Acme users', 'unticked: unchanged');
  assert.equal(out.details[1].text, '{client} confirmed.');
  assert.equal(out.details[0].text, 'Host: Acme');
  assert.equal(out.affectedAssets[0], 'Acme API');
  assert.equal(e.title, 'Acme portal leaks data', 'input not changed');
});

test('the reverse offer: no names under three characters, a bounded list, whole characters at the edges', () => {
  assert.deepEqual(findName({ title: 'IT team', description: 'A'.repeat(20000) }, 'IT').matches, []);
  assert.deepEqual(findName({ title: 'A', description: 'A '.repeat(1000) }, 'A').matches, []);
  const many = findName({ title: 'x', description: 'Acme '.repeat(150) }, 'Acme');
  assert.equal(many.matches.length, 100);
  assert.equal(many.more, 50, 'the rest are counted, not listed, and not changed');
  // Letters outside the basic range, combining marks and RTL letters count as part of a word.
  assert.equal(findName({ title: '\u{10400}Acme\u{10400}' }, 'Acme').matches.length, 0);
  assert.equal(findName({ title: 'Acmé x' }, 'Acme').matches.length, 0);
  assert.equal(findName({ title: 'שAcme' }, 'Acme').matches.length, 0);
  assert.equal(findName({ title: 'Acme_x 1Acme' }, 'Acme').matches.length, 0);
  assert.equal(findName({ title: '(Acme), "Acme". 😀Acme' }, 'Acme').matches.length, 3, 'punctuation and emoji are boundaries');
});

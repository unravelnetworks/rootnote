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

test('the reverse offer: exact matches with context, ticks only for whole words in prose', () => {
  const e = { title: 'Acme portal leaks data', affectedAssets: ['acme.example', 'Acme API'], description: 'Acme users and Acmeville staff', impact: '', threat: '', recommendation: '',
    formats: {}, details: [{ type: 'text', text: 'Host: Acme', format: 'code' }], references: [{ title: 'Acme advisory', url: 'https://acme.example/Acme' }] };
  const m = findName(e, 'Acme');
  assert.deepEqual(m.map((x) => x.key), ['title', 'affectedAssets.1', 'description', 'description', 'details.0', 'references.0']);
  assert.equal(m[3].whole, false, 'Acmeville is a longer word');
  assert.deepEqual(defaultTicks(m, 'Acme'), m.map(() => false), 'one subword match: nothing ticked');
  const clean = { ...e, description: 'Acme users' };
  const m2 = findName(clean, 'Acme');
  assert.deepEqual(defaultTicks(m2, 'Acme'), [true, false, true, false, false], 'title and prose only; not assets, code or references');
  assert.deepEqual(defaultTicks(findName({ ...clean, title: 'IT team' }, 'IT'), 'IT'), [false], 'names under three characters: nothing ticked');
  const out = replaceMatches(clean, m2, [true, true, true, false, false]);
  assert.equal(out.title, '{client} portal leaks data');
  assert.equal(out.affectedAssets[1], '{client} API');
  assert.equal(out.description, '{client} users');
  assert.equal(out.details[0].text, 'Host: Acme', 'unticked: unchanged');
  assert.equal(out.references[0].url, 'https://acme.example/Acme');
  assert.equal(clean.title, 'Acme portal leaks data', 'input not changed');
});

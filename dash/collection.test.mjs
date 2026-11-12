// node dash/collection.test.mjs  (no dependencies)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callOrigin, collectionOf, coverageRows, collectionTotals, totalsSentence } from './drawer.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const feed = JSON.parse(readFileSync(new URL('../dashboard.fixture.json', import.meta.url), 'utf8'));
const rows = feed.funders;

t('callOrigin: crawler, research run, unknown', () => {
  assert.equal(callOrigin({ source_adapter: 'grants_gov' }), 'Found by the crawler');
  assert.equal(callOrigin({ source_adapter: null }), 'Added by a research run');
  assert.equal(callOrigin({}), null);
  assert.equal(callOrigin(null), null);
});
t('collectionOf: missing collection is a working watched page', () => {
  assert.deepEqual(collectionOf({}), { mode: 'page', health: 'ok', open_calls: 0, note: null });
  assert.equal(collectionOf({ collection: { mode: 'calls', health: 'failing', open_calls: 2 } }).health, 'failing');
});
t('coverageRows: unhealthy first, then page/none, then name; input untouched', () => {
  const before = rows.map((r) => r.id).join();
  const o = coverageRows(rows), key = (r) => { const c = collectionOf(r); return [c.health === 'ok' ? 1 : 0, c.mode === 'page' || c.mode === 'none' ? 0 : 1]; };
  assert.equal(o.length, rows.length);
  for (let i = 1; i < o.length; i++) {
    const a = key(o[i - 1]), b = key(o[i]);
    assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && String(o[i - 1].name).localeCompare(String(o[i].name)) <= 0))), `order at ${i}`);
  }
  assert.notEqual(collectionOf(o[0]).health, 'ok');
  assert.equal(rows.map((r) => r.id).join(), before);
});
t('coverageRows: small hand-made case', () => {
  const r = (name, mode, health) => ({ name, collection: { mode, health } });
  assert.deepEqual(coverageRows([r('B', 'calls', 'ok'), r('A', 'calls', 'ok'), r('C', 'page', 'ok'), r('D', 'calls', 'stale')]).map((x) => x.name), ['D', 'C', 'A', 'B']);
});
t('totals from the feed summary', () => {
  const tot = collectionTotals(feed, rows);
  assert.deepEqual(tot, { listed: 15, auto: 10, open: 5, attention: 4 });
  assert.equal(totalsSentence(tot), '10 of 15 sources are collected automatically, 5 open calls found, 4 need attention.');
});
t('totals counted from funders when feed.collection is missing', () => {
  const tot = collectionTotals({}, rows);
  assert.equal(tot.listed, 15);
  assert.equal(tot.auto, 10);
  assert.equal(tot.attention, 4);
  assert.equal(tot.open, rows.reduce((s, r) => s + r.collection.open_calls, 0));
});
t('feed with no collection fields at all', () => {
  const old = rows.map(({ collection, ...r }) => r), tot = collectionTotals({}, old);
  assert.deepEqual(tot, { listed: 15, auto: 0, open: 0, attention: 0 });
  assert.equal(coverageRows(old).length, 15);
  assert.equal(totalsSentence(tot), '0 of 15 sources are collected automatically, 0 open calls found, none need attention.');
  assert.equal(callOrigin({ id: 'x' }), null);
  assert.deepEqual(collectionTotals(undefined, undefined), { listed: 0, auto: 0, open: 0, attention: 0 });
});
t('sentence singulars', () => assert.equal(totalsSentence({ listed: 1, auto: 1, open: 1, attention: 1 }), '1 of 1 source is collected automatically, 1 open call found, 1 needs attention.'));
console.log(`${n} tests passed`);

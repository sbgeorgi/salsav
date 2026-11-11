// Run: node dashboard.test.mjs
import assert from 'node:assert/strict';
import * as D from './dashboard.js';

const NOW = new Date('2026-11-11T20:00:00Z'); // 13:00 in Phoenix, 2026-11-11
let n = 0;
const t = (name, fn) => { fn(); n++; };
const plus = (d) => D.isoFromDayNum(D.dayNum('2026-11-11') + d);
const row = (o = {}) => ({ id: o.id || 'x', name: 'F', bucket: 'us_federal', cycle: 'fixed_deadline', deadline: plus(30), ua_eligibility: 'eligible', themes: [], geography: [], partner_needed: [], team: {}, ...o });
const rows = (arr, feed = {}) => D.normalize({ min_days: 14, funders: arr, ...feed }, NOW);

t('today is the Phoenix date', () => assert.equal(D.todayISO(new Date('2026-11-12T03:00:00Z')), '2026-11-11'));
t('14 days qualifies, 13 does not, 0 and -1 expired', () => {
  const s = (d) => D.deadlineState({ deadline: plus(d), cycle: 'fixed_deadline' }, NOW, 14);
  assert.equal(s(14), 'ok'); assert.equal(s(13), 'too_soon'); assert.equal(s(0), 'too_soon'); assert.equal(s(-1), 'expired');
});
t('null deadline maps by cycle', () => {
  assert.equal(D.deadlineState({ deadline: null, cycle: 'rolling' }, NOW), 'rolling');
  assert.equal(D.deadlineState({ deadline: null, cycle: 'invite_only' }, NOW), 'invite');
  assert.equal(D.deadlineState({ deadline: null, cycle: 'closed_unknown' }, NOW), 'unknown');
});
t('countdown + money', () => {
  assert.equal(D.countdown(23), '23 days left'); assert.equal(D.countdown(1), '1 day left'); assert.equal(D.countdown(-2), 'closed 2 days ago');
  assert.equal(D.money(1500000), '$1.5M'); assert.equal(D.money(250000), '$250k'); assert.equal(D.money(null), 'n/a');
});
t('relTime and staleness (null last_run is not stale)', () => {
  assert.equal(D.relTime('2026-11-11T17:00:00Z', NOW), '3 h ago'); assert.equal(D.relTime(null, NOW), 'never');
  assert.equal(D.isStale(null, NOW), false); assert.equal(D.isStale('2026-11-10T00:00:00Z', NOW), true);
});
t('amount bands', () => {
  const b = (v) => D.amountBand({ award_max_usd: v });
  assert.deepEqual([b(null), b(499999), b(500000), b(1e6), b(5e6)], ['unverified', 'lt500', '500k1m', '1m5m', '5m']);
});
t('geo groups', () => {
  assert.deepEqual([...D.geoGroups({ geography: ['US', 'AZ'] })].sort(), ['sw', 'us']);
  assert.ok(D.geoGroups({ geography: ['Sub-Saharan Africa'] }).has('intl')); assert.ok(D.geoGroups({ geography: ['Global'] }).has('global'));
});
t('disqualified hidden by default, shown with dq; skipped collapse', () => {
  const R = rows([row({ id: 'a', deadline: plus(13) }), row({ id: 'b', deadline: plus(14) }), row({ id: 'c', deadline: plus(-3) }), row({ id: 'd', team: { state: 'skip' } })]);
  const F = D.defaultFilters();
  assert.deepEqual(D.applyFilters(R, F).map((r) => r.id), ['b']);
  assert.deepEqual(D.applyFilters(R, { ...F, dq: true }).map((r) => r.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(D.applyFilters(R, { ...F, skip: true }).map((r) => r.id).sort(), ['b', 'd']);
});
t('filters: text, window, fit, loi, changed', () => {
  const R = rows([row({ id: 'a', name: 'Solar Fund', fit_score: 80, requirements: { loi: 'Required' }, deadline: plus(40), last_changed_at: '2026-11-11T10:00:00Z' }),
    row({ id: 'b', name: 'Other', fit_score: 40, requirements: { loi: 'No' }, deadline: plus(100) }), row({ id: 'c', deadline: null, cycle: 'rolling' })]);
  const f = (o) => D.applyFilters(R, { ...D.defaultFilters(), ...o }, { since: Date.parse('2026-11-11T00:00:00Z') }).map((r) => r.id);
  assert.deepEqual(f({ q: 'solar' }), ['a']); assert.deepEqual(f({ window: '60' }), ['a']); assert.deepEqual(f({ window: 'rolling' }), ['c']);
  assert.deepEqual(f({ fit: 50 }), ['a']); assert.deepEqual(f({ loi: true }), ['a']); assert.deepEqual(f({ changed: true }), ['a']);
});
t('sort: soonest first, nulls last, disqualified last', () => {
  const R = rows([row({ id: 'n', deadline: null, cycle: 'rolling' }), row({ id: 'late', deadline: plus(90) }), row({ id: 'dq', deadline: plus(5) }), row({ id: 'soon', deadline: plus(20) })]);
  assert.deepEqual(D.sortRows(R, 'deadline').map((r) => r.id), ['soon', 'late', 'n', 'dq']);
});
t('KPIs count qualified non-skipped only', () => {
  const R = rows([row({ id: 'a', award_max_usd: 1e6, open_now: true, deadline: plus(20), vetted_at: '2026-11-10T00:00:00Z' }),
    row({ id: 'b', award_max_usd: null, deadline: plus(100) }), row({ id: 'c', award_max_usd: 9e6, deadline: plus(3) }), row({ id: 'd', award_max_usd: 9e6, team: { state: 'skip' } })]);
  const k = D.kpis(R);
  assert.equal(k.total, 2); assert.equal(k.open, 1); assert.equal(k.closing30, 1); assert.equal(k.addressable, 1e6); assert.equal(k.unverified, 1); assert.equal(k.newWeek, 1);
  assert.equal(k.sinceVisit, null);
});
t('hash codec round-trips and has no secrets', () => {
  const F = { ...D.defaultFilters(), q: 'solar water', bucket: ['us_federal', 'tracker'], fit: 60, loi: true, window: '90' };
  const h = D.encodeHash(F, 'cards', 'fit'); const back = D.decodeHash('#' + h);
  assert.deepEqual(back.F, F); assert.equal(back.view, 'cards'); assert.equal(back.sort, 'fit');
  assert.equal(D.encodeHash(D.defaultFilters()), ''); assert.equal(D.decodeHash('#view=zzz&sort=bad').view, 'table');
});
t('CSV quoting, BOM, formula guard', () => {
  assert.equal(D.csvCell('a,"b"'), '"a,""b"""'); assert.equal(D.csvCell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(D.csvCell(['x', 'y']), 'x; y');
  assert.equal(D.csvCell(null), ''); assert.equal(D.csvCell('line\nbreak'), '"line\nbreak"');
  const csv = D.toCsv(rows([row({ name: 'Acme, Inc' })]));
  assert.ok(csv.startsWith('﻿Funder,')); assert.ok(csv.includes('"Acme, Inc"')); assert.equal(csv.split('\r\n').length, 2);
});
t('safeUrl and same-origin feed hook', () => {
  assert.equal(D.safeUrl('javascript:alert(1)'), null); assert.ok(D.safeUrl('https://a.org/x')); assert.equal(D.safeUrl('/rel'), null);
  const base = 'http://localhost:8765/dashboard.html';
  assert.equal(D.sameOriginFeed('mock/feed.json', base), 'http://localhost:8765/mock/feed.json');
  for (const bad of ['//evil.com/x', 'https://evil.com/x', 'http://localhost:8765/x', 'javascript:1', '\\\\evil']) assert.equal(D.sameOriginFeed(bad, base), null, bad);
});
console.log(`ok ${n} tests`);

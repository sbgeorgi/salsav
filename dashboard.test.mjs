// Run: node dashboard.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as D from './dashboard.js';

const NOW = new Date('2026-11-11T20:00:00Z'); // 13:00 in Phoenix, 2026-11-11
let n = 0;
const t = (name, fn) => { fn(); n++; };
const plus = (d) => D.isoFromDayNum(D.dayNum('2026-11-11') + d);
const row = (o = {}) => ({ id: o.id || 'x', name: 'F', bucket: 'us_federal', cycle: 'fixed_deadline', deadline: plus(30), ua_eligibility: 'eligible', themes: [], geography: [], partner_needed: [], team: {}, ...o });
const rows = (arr, feed = {}) => D.normalize({ min_days: 14, funders: arr.map(({ team, ...f }) => f), ...feed }, NOW, Object.fromEntries(arr.map((f) => [f.id, f.team || {}])));

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
  assert.equal(D.csvCell(null), ''); assert.equal(D.csvCell(-3), '-3'); assert.equal(D.csvCell(3), '3'); assert.equal(D.csvCell(' =1+1'), "' =1+1"); assert.equal(D.csvCell('line\nbreak'), '"line\nbreak"');
  const csv = D.toCsv(rows([row({ name: 'Acme, Inc' })]));
  assert.ok(csv.startsWith('﻿Funder,')); assert.ok(csv.includes('"Acme, Inc"')); assert.equal(csv.split('\r\n').length, 2);
});
t('safeUrl and same-origin feed hook', () => {
  assert.equal(D.safeUrl('javascript:alert(1)'), null); assert.ok(D.safeUrl('https://a.org/x')); assert.equal(D.safeUrl('/rel'), null);
  const base = 'http://localhost:8765/dashboard.html';
  assert.equal(D.sameOriginFeed('mock/feed.json', base), 'http://localhost:8765/mock/feed.json');
  for (const bad of ['//evil.com/x', 'https://evil.com/x', 'http://localhost:8765/x', 'javascript:1', '\\\\evil']) assert.equal(D.sameOriginFeed(bad, base), null, bad);
});
/* ---- radar v2 ---- */
const FEED = JSON.parse(readFileSync(new URL('./dashboard.fixture.json', import.meta.url), 'utf8'));
const FR = D.normalize({ ...FEED, funders: FEED.funders.map(({ team, ...f }) => f) }, NOW, Object.fromEntries(FEED.funders.map((f) => [f.id, f.team || {}]))); // team state comes from the team map, as in the app
const byName = (s) => FR.find((r) => r.name.startsWith(s));
const RUB = FEED.rubric;

t('STATES and LANES constants', () => {
  assert.deepEqual(D.STATES, ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip']);
  assert.deepEqual(D.LANES, { apply_now: 'Apply now', rolling: 'Rolling', prepare: 'Prepare', cultivate: 'Cultivate', watch: 'Watch' });
});
t('lane(): 14 days is apply_now, 13 is not; cycle decides the rest', () => {
  const L = (o, min) => D.lane({ cycle: 'fixed_deadline', ua_eligibility: 'eligible', deadline: null, ...o }, NOW, min);
  assert.equal(L({ deadline: plus(14) }), 'apply_now'); assert.equal(L({ deadline: plus(13) }), 'watch');
  assert.equal(L({ deadline: plus(13) }, 10), 'apply_now'); assert.equal(L({ deadline: plus(-1) }), 'watch');
  assert.equal(L({ deadline: plus(13), cycle: 'rolling' }), 'rolling'); assert.equal(L({ cycle: 'open_ended' }), 'rolling');
  assert.equal(L({ cycle: 'annual_recurring' }), 'prepare'); assert.equal(L({ cycle: 'closed_unknown' }), 'watch');
  assert.equal(L({ cycle: 'invite_only', deadline: plus(40) }), 'cultivate'); assert.equal(L({ ua_eligibility: 'invitation_only', deadline: plus(40) }), 'cultivate');
});
t('lane() on the fixture matches the feed lane (legacy rows have none)', () => {
  for (const r of FR) if (r.lane) assert.equal(r._lane, r.lane, r.name);
  assert.deepEqual([...new Set(FR.map((r) => r._lane))].sort(), Object.keys(D.LANES).sort());
});
t('fitTier(): cut-offs 75/60/45, custom rubric, null-safe', () => {
  const k = (s, r) => D.fitTier(s, r)?.key;
  assert.deepEqual([75, 74, 60, 59, 45, 44, 0].map((s) => k(s)), ['prime', 'strong', 'strong', 'possible', 'possible', 'long_shot', 'long_shot']);
  assert.equal(D.fitTier(75).label, 'Prime'); assert.equal(D.fitTier(null, RUB), null); assert.equal(D.fitTier(undefined), null);
  assert.equal(k(80, { tiers: [{ key: 'a', min: 90, label: 'A' }, { key: 'b', min: 0, label: 'B' }] }), 'b');
  assert.equal(k(60, RUB), 'strong');
});
t('explainFit(): null for legacy rows or without a rubric', () => {
  assert.equal(D.explainFit(byName('Rio Grande'), RUB), null); assert.equal(D.explainFit(byName('Southwest'), null), null); assert.equal(D.explainFit({}, RUB), null);
});
t('explainFit(): dims, levels, evidence flags and next level', () => {
  const x = D.explainFit(byName('Pan-American'), RUB);
  assert.equal(x.total, 75); assert.equal(x.tier.key, 'prime'); assert.deepEqual(x.dims.map((d) => d.key), ['mission', 'activity', 'geography', 'eligibility', 'award', 'precedent']);
  assert.equal(x.dims.reduce((s, d) => s + d.points, 0), x.total);
  const el = x.dims.find((d) => d.key === 'eligibility'), aw = x.dims.find((d) => d.key === 'award'), mi = x.dims.find((d) => d.key === 'mission');
  assert.equal(el.levelLabel, 'With a partner'); assert.equal(el.next.key, 'eligible'); assert.equal(el.next.gain, 7); assert.ok(el.rule && el.question);
  assert.equal(aw.max, 10); assert.equal(aw.next, null); assert.equal(aw.ok, false); // award quote not found on the page
  assert.equal(mi.ok, true); assert.ok(mi.quote); assert.equal(mi.next.key, 'core');
});
t('explainFit(): headroom = three largest gains, eligibility and award first when tied', () => {
  const x = D.explainFit(byName('Kenya'), RUB);
  assert.deepEqual(x.headroom.map((h) => [h.key, h.gain]), [['mission', 8], ['eligibility', 7], ['activity', 5]]);
  const mk = (pts) => ({ fit_breakdown: { total: 50, dims: Object.entries(pts).map(([key, [level, points]]) => ({ key, level, points })) }, evidence_ok: {} });
  const y = D.explainFit(mk({ mission: ['weak', 12], activity: ['capacity', 10], eligibility: ['unknown', 7], award: ['unknown', 4] }), RUB);
  assert.deepEqual(y.headroom.map((h) => h.key), ['eligibility', 'mission', 'activity']); // eligibility gain 6 ties mission 6 and wins
  assert.equal(D.explainFit(byName('Southwest'), RUB).dims.find((d) => d.key === 'mission').next, null);
  assert.equal(D.explainFit(byName('Southwest'), RUB).headroom.length, 1); // only precedent can still grow
});
t('evidenceLevel(): four items, facts_verified wins, legacy and recompute', () => {
  const a = D.evidenceLevel(byName('Southwest')), b = D.evidenceLevel(byName('Sonoran'));
  assert.equal(a.n, 4); assert.equal(a.of, 4); assert.deepEqual(a.items.map((i) => i.key), ['mission', 'eligibility', 'award', 'deadline']); assert.ok(a.items.every((i) => i.ok));
  assert.equal(b.n, 0); assert.ok(b.items.every((i) => !i.ok));
  assert.equal(D.evidenceLevel(byName('Rio Grande')).n, 0); assert.equal(D.evidenceLevel(null).n, 0);
  const c = D.evidenceLevel({ evidence: { award: { quote: 'q' }, deadline: { quote: 'q' } }, evidence_ok: { deadline: false } });
  assert.equal(c.n, 1); assert.equal(D.evidenceLevel({ facts_verified: 3 }).n, 3);
});
t('recommend(): scoring bands, bonuses and tie-breaks', () => {
  const sc = (o) => D.recommend(rows([row({ id: 'a', fit_score: 50, ua_eligibility: 'unknown', ...o })]), NOW)[0]?.score;
  assert.equal(sc({ deadline: plus(14) }), 62); assert.equal(sc({ deadline: plus(45) }), 62); assert.equal(sc({ deadline: plus(46) }), 65); assert.equal(sc({ deadline: plus(90) }), 65);
  assert.equal(sc({ deadline: plus(91) }), 58); assert.equal(sc({ deadline: plus(180) }), 58); assert.equal(sc({ deadline: plus(181) }), 50);
  assert.equal(sc({ deadline: null, cycle: 'rolling' }), 54); assert.equal(sc({ deadline: null, cycle: 'annual_recurring' }), 52);
  assert.equal(sc({ deadline: plus(30), ua_eligibility: 'eligible' }), 67);
  assert.equal(sc({ deadline: plus(30), facts_verified: 3 }), 65); assert.equal(sc({ deadline: plus(30), facts_verified: 2 }), 62);
  const R = rows([row({ id: 'z', name: 'Zed', fit_score: 60 }), row({ id: 'b', name: 'Bee', fit_score: 60 }), row({ id: 's', name: 'Soon', fit_score: 60, deadline: plus(20) }), row({ id: 'h', name: 'High', fit_score: 90 })]);
  assert.deepEqual(D.recommend(R, NOW).map((x) => x.row.id), ['h', 's', 'b', 'z']); assert.equal(D.recommend(R, NOW, 2).length, 2);
});
t('recommend(): a funder the agent has not scored yet is never a pick', () => {
  const R = rows([row({ id: 'u', name: 'Unscored', fit_score: null, deadline: plus(30) }), row({ id: 's', name: 'Scored', fit_score: 40, deadline: plus(30) }),
    row({ id: 'r', name: 'Rolling unscored', fit_score: null, cycle: 'rolling', deadline: null })]);
  assert.deepEqual(D.recommend(R, NOW).map((x) => x.row.id), ['s']);
  assert.deepEqual(D.recommend(rows([row({ id: 'u', fit_score: null, deadline: plus(30) })]), NOW), []);
});
t('recommend(): exclusions and reasons', () => {
  const rec = D.recommend(FR, NOW, 20), names = rec.map((x) => x.row.name);
  assert.deepEqual(names.slice(0, 2), ['Southwest Agricultural Energy Program', 'Dryland Food Systems Fund']);
  for (const bad of ['Pan-American', 'Arizona Clean', 'Mediterranean', 'National Rural', 'Federal Dual', 'Border Region', 'Cooperative', 'Midwest']) assert.ok(!names.some((n) => n.startsWith(bad)), bad);
  assert.ok(rec.every((x) => ['apply_now', 'rolling', 'prepare'].includes(x.row._lane) && ['new', 'reviewing'].includes(x.row.team.state) && !x.row._dq));
  const top = rec[0]; assert.equal(top.score, 118);
  assert.deepEqual(top.reasons, ['Closes in 41 days', 'Fit 98, Prime', 'UA applies directly', '4 of 4 facts quoted', 'Nobody owns it yet']);
  assert.ok(!rec[1].reasons.includes('Nobody owns it yet')); // Dryland has an owner
  assert.deepEqual(D.recommend([], NOW), []);
});
t('normalize: a locked viewer gets state, owner and ask from the feed row but never notes, and the team map wins', () => {
  const f = { ...row({ id: 'pub' }), team: { state: 'reviewing', owner: 'Ana', ask_usd: 5e4, notes: 'private' } };
  const [a] = D.normalize({ funders: [f] }, NOW, {});
  assert.equal(a.team.state, 'reviewing'); assert.equal(a.team.owner, 'Ana'); assert.equal(a.team.ask_usd, 5e4); assert.equal(a.team.notes, '');
  const [b] = D.normalize({ funders: [f] }, NOW, { pub: { state: 'applying', owner: '', notes: 'n' } });
  assert.equal(b.team.state, 'applying'); assert.equal(b.team.owner, ''); assert.equal(b.team.ask_usd, 5e4); assert.equal(b.team.notes, 'n');
  const [c] = D.normalize({ funders: [row({ id: 'bare', team: undefined })] }, NOW, {});
  assert.deepEqual(c.team, { state: 'new', owner: '', ask_usd: null, notes: '' });
});

t('normalize adds _lane, _tier, _evid and team.ask_usd', () => {
  const r = byName('Pan-American');
  assert.equal(r._lane, 'prepare'); assert.equal(r._tier.key, 'prime'); assert.equal(r._evid.n, 2); assert.equal(r.team.ask_usd, 1800000);
  assert.equal(byName('Southwest').team.ask_usd, null); assert.equal(rows([row()])[0].team.ask_usd, null);
  assert.equal(D.normalize({ funders: [row({ fit_score: 80 })] }, NOW)[0]._tier.key, 'prime'); // no rubric: default cut-offs
});
t('filters: lane, tier, evid; sorts: recommended', () => {
  const F = D.defaultFilters(); assert.deepEqual([F.lane, F.tier, F.evid], ['', [], false]);
  const f = (o) => D.applyFilters(FR, { ...F, ...o }).map((r) => r.name.split(' ')[0]);
  assert.deepEqual(f({ lane: 'cultivate' }), ['Mediterranean']); assert.equal(f({ lane: 'apply_now' }).length, 6);
  assert.deepEqual(f({ tier: ['long_shot'] }), ['Horizon']);
  assert.equal(f({ tier: ['prime', 'strong'] }).length, 8);
  assert.ok(D.applyFilters(FR, { ...F, evid: true }).every((r) => r._evid.n >= 3)); assert.ok(!f({ evid: true }).includes('Sonoran'));
  assert.ok('recommended' in D.SORTS);
  const s = D.sortRows(FR.filter((r) => !r._dq), 'recommended').map((r) => r.name.split(' ')[0]);
  assert.deepEqual(s.slice(0, 3), ['Southwest', 'Cooperative', 'Dryland']); // the sort ranks every row by score, the picks list filters by state
  assert.equal(D.sortRows(FR, 'recommended').at(-1)._dq, true);
});
t('kpis(): new keys, pipeline usd uses ask_usd before award_max_usd', () => {
  const k = D.kpis(FR);
  assert.equal(k.total, 12); assert.equal(k.applyNow, 6); assert.equal(k.rollingOpen, 2); assert.equal(k.byLane.cultivate, 1); assert.equal(k.byLane.watch, 0);
  assert.equal(k.applyNowUsd, 1500000 + 750000 + 450000 + 1200000); assert.equal(k.primeStrong, k.byTier.prime + k.byTier.strong);
  assert.equal(k.itemized, 11); assert.equal(typeof k.avgFit, 'number'); assert.equal(k.evidencePct, Math.round(100 * FR.filter((r) => !r._dq && !r._skip && r._evid.n >= 3).length / k.total));
  assert.deepEqual(k.pipeline.byState.applying, { n: 1, usd: 1800000 }); // ask 1.8M, not award_max 2.4M
  assert.deepEqual(k.pipeline.byState.reviewing, { n: 1, usd: 750000 }); // no ask: falls back to award_max
  assert.deepEqual(k.pipeline.byState.submitted, { n: 1, usd: 300000 }); assert.deepEqual(k.pipeline.byState.awarded, { n: 1, usd: 450000 });
  assert.equal(k.pipeline.n, 4); assert.equal(k.pipeline.usd, 3300000);
  const z = D.kpis(rows([row({ team: { state: 'applying', ask_usd: 0 }, award_max_usd: 5e5 }), row({ id: 'y', team: { state: 'applying' }, award_max_usd: null })]));
  assert.equal(z.pipeline.byState.applying.usd, 0); // an explicit 0 ask is kept; unknown award counts as 0
  assert.equal(D.kpis([]).avgFit, null);
});
t('insights(): shapes on the fixture', () => {
  const i = D.insights(FR, FEED, NOW);
  assert.deepEqual(Object.keys(i).sort(), ['anatomy', 'collect', 'coverage', 'discovery', 'fitHist', 'funnel', 'health', 'quality', 'scatter', 'trend', 'undated'].sort());
  assert.ok(i.scatter.length > 0 && i.scatter.every((p) => Number.isInteger(p.days) && p.fit != null && p.id && p.bucket && p.lane));
  assert.ok(i.undated.length > 0 && i.undated.every((p) => !('days' in p))); assert.ok(i.scatter.some((p) => p.award == null) || i.undated.some((p) => p.award == null));
  assert.deepEqual(i.fitHist.map((h) => h.tier), ['prime', 'strong', 'possible', 'long_shot']); assert.equal(i.fitHist.reduce((s, h) => s + h.n, 0), i.scatter.length + i.undated.length);
  assert.deepEqual(i.anatomy.map((a) => a.key), ['mission', 'activity', 'geography', 'eligibility', 'award', 'precedent']); assert.ok(i.anatomy.every((a) => a.avg > 0 && a.avg <= a.max));
  assert.deepEqual(i.coverage.map((c) => [c.bucket, c.min]), [['us_federal', 12], ['intl_dev', 12], ['state_regional', 8], ['private_sector', 8], ['foundation_ngo', 12]]);
  assert.ok(i.coverage.every((c) => c.label && c.vetted >= 0 && c.screened >= 0 && c.pending >= 0)); assert.equal(i.coverage.find((c) => c.bucket === 'us_federal').pending, 4);
  assert.deepEqual(i.funnel.map((f) => f.state), ['new', 'reviewing', 'applying', 'submitted', 'awarded']); assert.equal(i.funnel[2].usd, 1800000);
  assert.deepEqual(i.quality.map((q) => q.key), ['award_published', 'deadline_known', 'eligibility_confirmed', 'evidence3']); assert.ok(i.quality.every((q) => q.pct >= 0 && q.pct <= 100));
  assert.deepEqual(i.health, { total: 15, checked24h: 14, failing: 1, manual: 1 });
  assert.equal(i.trend.days.length, 30); assert.deepEqual(Object.keys(i.trend), ['days', 'vetted', 'applyNow', 'evidence3']); assert.ok(Object.values(i.trend).every((a) => a.length === 30));
  assert.equal(i.discovery.runs.length, 3); assert.equal(i.discovery.totals.examined, 80);
});
t('insights(): empty feed, no rubric, no metrics', () => {
  const i = D.insights([], {}, NOW);
  assert.deepEqual([i.scatter, i.undated, i.fitHist.map((h) => h.n), i.anatomy, i.coverage, i.discovery], [[], [], [0, 0, 0, 0], [], [], null]); assert.deepEqual(i.trend.days, []);
});
t('fixture: >=12 funders, every lane, tier and state, legacy, 8 screened, rubric verbatim', () => {
  assert.ok(FEED.funders.length >= 12); assert.deepEqual(new Set(FR.map((r) => r.team.state)), new Set(D.STATES));
  assert.deepEqual(new Set(FR.map((r) => r._tier?.key).filter(Boolean)), new Set(['prime', 'strong', 'possible', 'long_shot']));
  assert.deepEqual(new Set(FR.map((r) => r.bucket)), new Set(['us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo']));
  assert.equal(FEED.screened.length, 8); assert.equal(FEED.discovery.runs.length, 3); assert.equal(FEED.metrics.length, 30); assert.equal(FEED.targets.next.length, 5);
  assert.deepEqual(RUB, JSON.parse(readFileSync(new URL('./supabase/grants/rubric_v2.json', import.meta.url), 'utf8')));
  assert.equal(FR.filter((r) => r._dq).length, 2); assert.equal(byName('Federal Dual')._state, 'too_soon'); assert.equal(byName('Border Region')._state, 'expired');
  assert.ok(FR.filter((r) => r._evid.n === 4).length >= 2); assert.ok(FR.filter((r) => r._evid.n === 0).length >= 2);
  const legacy = FEED.funders.find((f) => f.name.startsWith('Rio Grande')); assert.ok(!legacy.fit_breakdown && !legacy.evidence && !legacy.lane);
});
t('legacy row: renders everywhere without throwing', () => {
  const R = D.normalize({ funders: [{ id: 'old', name: 'Old', bucket: 'tracker', cycle: 'fixed_deadline', deadline: plus(30), ua_eligibility: 'eligible', fit_score: 55 }] }, NOW);
  const r = R[0];
  assert.equal(r._lane, 'apply_now'); assert.equal(r._tier.key, 'possible'); assert.equal(r._evid.n, 0); assert.equal(D.explainFit(r, RUB), null);
  assert.equal(D.recommend(R, NOW).length, 1); assert.equal(D.kpis(R).itemized, 0); assert.equal(D.insights(R, { rubric: RUB }, NOW).anatomy[0].avg, 0);
  const csv = D.toCsv(R).split('\r\n'); assert.equal(csv.length, 2); assert.equal(csv[0].split(',').length, csv[1].split(',').length);
});
t('hash codec: new filters and views round trip', () => {
  const F = { ...D.defaultFilters(), lane: 'apply_now', tier: ['prime', 'strong'], evid: true, team: ['new'], fit: 70 };
  for (const view of ['table', 'cards', 'timeline', 'board', 'database', 'galaxy', 'insights', 'method']) {
    const back = D.decodeHash('#' + D.encodeHash(F, view, 'recommended'));
    assert.deepEqual(back.F, F); assert.equal(back.view, view); assert.equal(back.sort, 'recommended');
  }
  assert.equal(D.encodeHash({ ...D.defaultFilters(), evid: true }), 'evid=1'); assert.equal(D.decodeHash('#lane=watch&tier=prime').F.tier[0], 'prime');
  assert.equal(D.decodeHash('#view=insights').view, 'insights'); assert.equal(D.decodeHash('#view=bogus&sort=nope').sort, 'deadline');
});
t('CSV gains Lane, Fit tier, one column per rubric dimension, Evidence and Ask USD', () => {
  const [head, line] = D.toCsv(FR.filter((r) => r.name.startsWith('Pan-American'))).replace('﻿', '').split('\r\n');
  const h = head.split(',');
  for (const c of ['Lane', 'Fit tier', 'Evidence (n of 4)', 'Ask USD']) assert.ok(h.includes(c), c);
  assert.equal(h.filter((c) => /^Fit: .* pts$/.test(c)).length, 6);
  assert.ok(line.includes('Prepare') && line.includes('Prime') && line.includes('1800000'));
});

const co = (mode, health, open_calls = 0) => ({ collection: { mode, health, open_calls } });
t('Has open calls filter: matches, hash round trip, old links still decode', () => {
  const R = rows([row({ id: 'a', ...co('calls', 'ok', 2) }), row({ id: 'b', ...co('page', 'ok', 0) }), row({ id: 'c' })]);
  assert.deepEqual(D.applyFilters(R, { ...D.defaultFilters(), calls: true }).map((r) => r.id), ['a']);
  assert.equal(D.applyFilters(R, D.defaultFilters()).length, 3);
  const F = { ...D.defaultFilters(), calls: true, lane: 'apply_now' };
  assert.equal(D.encodeHash({ ...D.defaultFilters(), calls: true }), 'calls=1');
  assert.deepEqual(D.decodeHash('#' + D.encodeHash(F, 'cards', 'fit')).F, F);
  assert.equal(D.decodeHash('#lane=watch&evid=1').F.calls, false);
});
t('collectionOf defaults an older feed to a watched page with no open calls', () => {
  assert.deepEqual(D.collectionOf({}), { mode: 'page', health: 'ok', open_calls: 0 });
  assert.equal(D.collectionOf({ collection: { mode: 'calls', health: 'failing', open_calls: 3 } }).open_calls, 3);
});
t('kpis().collect counts auto sources, open calls and sources needing attention (qualified, non-skipped)', () => {
  const R = rows([row({ id: 'a', ...co('calls', 'ok', 2) }), row({ id: 'b', ...co('cycle', 'stale', 0) }), row({ id: 'c', ...co('page', 'failing', 1) }), row({ id: 'd', ...co('none', 'off', 0) }),
    row({ id: 'e' }), row({ id: 'f', deadline: plus(3), ...co('calls', 'ok', 9) }), row({ id: 'g', team: { state: 'skip' }, ...co('calls', 'ok', 9) })]);
  assert.deepEqual(D.kpis(R).collect, { total: 5, auto: 2, openCalls: 3, attention: 2 });
  assert.deepEqual(D.kpis([]).collect, { total: 0, auto: 0, openCalls: 0, attention: 0 });
  assert.deepEqual(D.kpis(D.applyFilters(R, { ...D.defaultFilters(), calls: true })).collect, { total: 2, auto: 1, openCalls: 3, attention: 1 });
});
t('insights().collect: share per day, days without collection skipped, feed without the field is safe', () => {
  const c = (listed, auto) => ({ listed, auto, open_calls: 4 });
  const feed = { collection: c(10, 5), metrics: [{ day: '2026-11-09', m: {} }, { day: '2026-11-10', m: { collection: c(10, 4) } }, { day: '2026-11-11', m: { collection: c(10, 5) } }] };
  const I = D.insights(rows([row()]), feed, NOW).collect;
  assert.deepEqual(I.days, [{ day: '2026-11-10', pct: 40 }, { day: '2026-11-11', pct: 50 }]); assert.deepEqual(I.now, { auto: 5, listed: 10, openCalls: 4 });
  const old = D.insights(rows([row()]), {}, NOW).collect; assert.equal(old.now, null); assert.deepEqual(old.days, []);
});
t('CSV gains collection_mode and open_calls (defaults for older feeds)', () => {
  const [head, a, b] = D.toCsv(rows([row({ id: 'a', ...co('calls', 'ok', 2) }), row({ id: 'b' })])).replace('﻿', '').split('\r\n');
  const h = head.split(','), i = h.indexOf('collection_mode'), j = h.indexOf('open_calls');
  assert.ok(i > 0 && j > 0); assert.equal(a.split(',').at(i - h.length), 'calls'); assert.equal(a.split(',').at(j - h.length), '2');
  assert.equal(b.split(',').at(i - h.length), 'page'); assert.equal(b.split(',').at(j - h.length), '0');
});

/* ---- dashboard v3 foundation: labels, progress flag, search suggestions ---- */
t('UA has the unlikely label and STATE_LABELS names every pipeline state', () => {
  assert.equal(D.UA.unlikely, 'Unlikely');
  assert.deepEqual(Object.keys(D.STATE_LABELS).sort(), [...D.STATES].sort()); assert.equal(D.STATE_LABELS.new, 'Not started'); assert.equal(D.STATE_LABELS.skip, 'Skipped');
});
t('isProgressed: any team state past new, except skip; missing state is not progressed', () => {
  assert.deepEqual(['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip', '', undefined].map((s) => D.isProgressed(s)),
    [false, true, true, true, true, true, false, false, false]);
});
t('normalize sets _prog, _status, _human and keeps the team note search text', () => {
  const [a] = rows([row({ id: 'a', deadline: plus(5), team: { state: 'applying' } })]);
  assert.equal(a._prog, true); assert.equal(a._dq, true); assert.equal(a._status, 'vetted'); assert.equal(a._human, null);
  const [b] = rows([row({ id: 'b', status: 'rejected', human: { lock: 'demoted', by: 'Ana' } })]);
  assert.equal(b._status, 'rejected'); assert.equal(b._prog, false); assert.equal(b._human.lock, 'demoted');
  const [c] = D.normalize({ min_days: 14, funders: [row({ id: 'c', name: 'Gulf Water', bucket: 'foundation_ngo', geography: ['Sonoran desert'] })] }, NOW, { c: { notes: 'call Tuesday' } });
  assert.ok(c._hay.includes('foundation') && c._hay.includes('sonoran') && c._hay.includes('call tuesday'));
});
t('matches keeps a progressed funder inside the 14-day window; hides unprogressed and skipped ones', () => {
  const R = rows([row({ id: 'p', deadline: plus(5), team: { state: 'submitted' } }), row({ id: 'n', deadline: plus(5) }), row({ id: 's', deadline: plus(5), team: { state: 'skip' } })]);
  assert.deepEqual(D.applyFilters(R, D.defaultFilters()).map((r) => r.id), ['p']);
  assert.deepEqual(D.applyFilters(R, { ...D.defaultFilters(), dq: true }).map((r) => r.id).sort(), ['n', 'p']);
});
t('isDisqualified: only an unprogressed funder the 14-day rule hides', () => {
  const R = rows([row({ id: 'e', deadline: plus(-3) }), row({ id: 'ep', deadline: plus(-3), team: { state: 'applying' } }), row({ id: 'ok', deadline: plus(30) })]);
  const by = Object.fromEntries(R.map((r) => [r.id, r]));
  assert.equal(D.isDisqualified(by.e), true); assert.equal(D.isDisqualified(by.ep), false); assert.equal(D.isDisqualified(by.ok), false);
});
t('closedWord: Closed for expired, Under 14 days for too soon, empty when open', () => {
  const R = rows([row({ id: 'e', deadline: plus(-3) }), row({ id: 's', deadline: plus(5) }), row({ id: 'o', deadline: plus(30) })]);
  const by = Object.fromEntries(R.map((r) => [r.id, r]));
  assert.equal(D.closedWord(by.e), 'Closed'); assert.equal(D.closedWord(by.s), 'Under 14 days'); assert.equal(D.closedWord(by.o), '');
});
t('matches: an expired progressed funder stays on the radar with its flag data; an expired one without progress is hidden', () => {
  const R = rows([row({ id: 'ep', deadline: plus(-3), team: { state: 'submitted' } }), row({ id: 'e', deadline: plus(-3) }), row({ id: 'ok', deadline: plus(30) })]);
  assert.deepEqual(D.applyFilters(R, D.defaultFilters()).map((r) => r.id).sort(), ['ep', 'ok']);
  const ep = R.find((r) => r.id === 'ep');
  assert.equal(ep._prog, true); assert.equal(ep.team.state, 'submitted'); assert.equal(D.closedWord(ep), 'Closed');
});
t('pageOf: first 60 rows and how many are left out; never negative', () => {
  const list = Array.from({ length: 150 }, (_, i) => i);
  assert.equal(D.PAGE, 60);
  const a = D.pageOf(list); assert.equal(a.rows.length, 60); assert.equal(a.rows[0], 0); assert.equal(a.more, 90);
  const b = D.pageOf(list.slice(0, 10)); assert.equal(b.rows.length, 10); assert.equal(b.more, 0);
  const c = D.pageOf(list, 0); assert.deepEqual(c.rows, []); assert.equal(c.more, 150);
  assert.equal(D.pageOf(list, -5).more, 150);
  assert.equal(D.pageOf([]).rows.length, 0);
});
const SREG = { funders: [
  { id: 'f1', name: 'Solar Harvest Fund', program: 'Clean energy', bucket: 'us_federal', status: 'vetted', themes: ['solar', 'water'] },
  { id: 'f2', name: 'Sun Belt Water Trust', program: 'Water', bucket: 'state_regional', status: 'rejected', reject_reason: 'Fit below 40', themes: ['water'] },
  { id: 'f3', name: 'Mesa Sunrise Grants', program: 'Solar', bucket: 'foundation_ngo', status: 'candidate', themes: ['solar'] }],
  leads: [{ id: 'l1', org: 'Solar Ridge Alliance', program_hint: 'Solar', bucket: 'private_sector', status: 'pending' }],
  calls: [{ id: 'c1', funder_id: 'f1', title: 'Solar pilot call 2027', status: 'open', vet_status: 'vetted' }] };
const SROWS = [{ id: 'f1', name: 'Solar Harvest Fund', program: 'Clean energy', themes: ['solar'], team: { owner: 'Ana Ruiz' } }, { id: 'x', name: 'Other Co', team: { owner: 'Ben Okafor' } }];
t('suggest(): empty query gives nothing; items follow the fixed group order', () => {
  assert.deepEqual(D.suggest('  ', { rows: SROWS, registry: SREG }), []);
  assert.deepEqual(D.suggest('sol', { rows: SROWS, registry: SREG, limit: 10 }).map((x) => x.type), ['funder', 'lead', 'call', 'theme']);
  assert.deepEqual(D.suggest('sol', { rows: SROWS, registry: SREG, limit: 10 }).map((x) => x.label), ['Solar Harvest Fund', 'Solar Ridge Alliance', 'Solar pilot call 2027', 'solar']);
});
t('suggest(): prefix beats word start beats substring; screened and candidates are their own type', () => {
  const sun = D.suggest('sun', { rows: [], registry: SREG }).filter((x) => x.type === 'screened').map((x) => x.label);
  assert.deepEqual(sun, ['Sun Belt Water Trust', 'Mesa Sunrise Grants']);
  assert.deepEqual(D.suggest('sunrise', { rows: [], registry: SREG }).map((x) => [x.type, x.id]), [['screened', 'f3']]);
  assert.deepEqual(D.suggest('belt', { rows: [], registry: SREG }).map((x) => x.sub), ['Fit below 40']);
  const subs = D.suggest('a', { rows: [], registry: SREG, limit: 9 }).filter((x) => x.type === 'screened').map((x) => x.sub);
  assert.deepEqual(subs, ['Fit below 40', 'Candidate']);
});
t('suggest(): carries the ids and values each choice needs', () => {
  const [call] = D.suggest('pilot', { rows: SROWS, registry: SREG });
  assert.deepEqual([call.type, call.id, call.value, call.sub], ['call', 'f1', 'c1', 'Solar Harvest Fund']);
  const [lead] = D.suggest('ridge', { rows: SROWS, registry: SREG });
  assert.deepEqual([lead.type, lead.id], ['lead', 'l1']);
  assert.deepEqual(D.suggest('ana', { rows: SROWS, registry: SREG }).map((x) => [x.type, x.value]), [['owner', 'Ana Ruiz']]);
  assert.deepEqual(D.suggest('fed', { rows: SROWS, registry: SREG }).map((x) => [x.type, x.value, x.label]), [['category', 'us_federal', 'US federal']]);
});
t('suggest(): dedupes a funder seen in both the registry and the rows; works with no registry; limit caps each group', () => {
  assert.equal(D.suggest('solar harvest', { rows: SROWS, registry: SREG }).filter((x) => x.type === 'funder').length, 1);
  assert.deepEqual(D.suggest('solar', { rows: SROWS, registry: null }).map((x) => x.type), ['funder', 'theme']);
  assert.deepEqual(D.suggest('solar', { rows: [], registry: null }), []);
  assert.equal(D.suggest('sun', { rows: [], registry: SREG, limit: 1 }).length, 1);
  assert.deepEqual(D.suggest('zzz', { rows: SROWS, registry: SREG }), []);
});
t('suggest(): tolerates an empty registry and missing arguments', () => {
  assert.deepEqual(D.suggest('x', { rows: [], registry: {} }), []);
  assert.deepEqual(D.suggest('x', {}), []);
});
t('UNSCORED, SORT_DIR and LOCKED_MSG: shared copy and sort directions', () => {
  assert.equal(D.UNSCORED, 'Not scored yet');
  assert.deepEqual(D.SORT_DIR, { name: 'asc', deadline: 'asc', fit: 'desc', amount: 'desc', changed: 'desc' });
  assert.equal(D.LOCKED_MSG, 'Too many wrong passcodes. Wait a few minutes.');
});
t('authMsg(): wrong passcode, lockout, and every other error', () => {
  assert.equal(D.authMsg({ code: '28000' }), 'That passcode is not right.');
  assert.equal(D.authMsg({ code: 'P0001', message: 'locked' }), D.LOCKED_MSG);
  assert.equal(D.authMsg({ code: 'P0001', message: 'Amount must be positive' }), null, 'other P0001 messages are validation errors');
  assert.equal(D.authMsg({ code: '42501' }), null);
  assert.equal(D.authMsg(null), null);
  assert.equal(D.authMsg(undefined), null);
});
t('changeEvent(): only changed keys, each with its old value', () => {
  const at = '2026-11-17T10:00:00Z';
  assert.deepEqual(D.changeEvent('f1', { state: 'submitted' }, { state: 'open' }, 'Ana', at),
    { funder_id: 'f1', at, actor: 'Ana', kind: 'update', payload: { state: 'submitted', from: { state: 'open' } } });
  assert.equal(D.changeEvent('f1', { state: 'open' }, { state: 'open' }, 'Ana', at), null, 'the same value logs nothing');
  assert.equal(D.changeEvent('f1', {}, {}, 'Ana', at), null);
  assert.deepEqual(D.changeEvent('f1', { owner: 'Ana' }, { owner: '' }, 'Ana', at).payload, { owner: 'Ana', from: { owner: '' } }, 'an empty owner is kept as the old value');
  assert.deepEqual(D.changeEvent('f1', { notes: 'New' }, { notes: 'Old' }, 'Ana', at).payload, { notes_changed: true }, 'notes log a flag, not the text');
  assert.deepEqual(D.changeEvent('f1', { ask_usd: 5000 }, {}, '', at).payload, { ask_usd: 5000, from: { ask_usd: null } }, 'a missing old value is null');
});

// mock projection: dash/mock.js returns only the contract keys, and its write errors carry the live codes
{
  const realFetch = globalThis.fetch, text = readFileSync(new URL('./dash/mock.json', import.meta.url), 'utf8');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(text) });
  try {
    const M = await import('./dash/mock.js');
    await M.load('dash/mock.json');
    const reg = await M.rpc('grants_registry', {}), team = await M.rpc('grants_team_notes', { p_pass: 'x' });
    assert.ok(!('deadline' in reg.funders[0]) && !('team' in reg.funders[0]), 'registry funder carries only contract keys');
    assert.ok(team.notes.every((x) => !('deleted_at' in x) && !('deleted_by' in x)), 'notes carry only contract keys');
    const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };
    const id = reg.funders[0].id;
    assert.equal(await code(M.rpc('grants_set_state', { p_funder: id, p_patch: { state: 'reviewing' } })), '28000');
    assert.equal(await code(M.rpc('grants_set_state', { p_funder: id, p_pass: 'x', p_patch: { state: 'nope' } })), 'P0001');
    const note = await M.rpc('grants_note', { p_funder: id, p_pass: 'x', p_patch: { body: 'check', actor: 'A' } });
    assert.deepEqual(await M.rpc('grants_note', { p_funder: id, p_pass: 'x', p_patch: { remove: note.id, actor: 'B' } }), { removed: note.id }, 'any passcode holder may remove a note (023 note_remove)');
    // access tiers (023 section 8): no passcode withholds team identity; a valid passcode shows it
    const pub = await M.rpc('grants_registry', {}), team2 = await M.rpc('grants_registry', { p_pass: 'x' });
    assert.equal(pub.access, 'public'); assert.equal(team2.access, 'team');
    const promoted = team2.funders.find((f) => f.human?.lock === 'promoted' && f.fit_score === null);
    assert.ok(promoted && promoted.fit_score === null, 'mock has a promoted funder that is not scored yet');
    assert.equal(pub.funders.find((f) => f.id === promoted.id).human.by, null, 'public tier hides the promoting team member');
    assert.equal(pub.funders.find((f) => f.id === promoted.id).human.lock, 'promoted', 'the lock itself stays visible');
    assert.equal(await M.rpc('grants_check_pass', { p_pass: 'x' }), true, 'check_pass returns a boolean');
    const unlisted = team2.funders.find((f) => f.status === 'rejected');
    const pubDetail = await M.rpc('grants_funder', { p_id: unlisted.id });
    assert.equal(pubDetail.access, 'public');
    assert.ok(!('collection' in pubDetail.funder) && !('notes' in pubDetail.funder), 'an unlisted funder has no feed-style keys in the public tier');
    assert.deepEqual(Object.keys(pubDetail.funder.team), ['state'], 'an unlisted funder shows the team state only');
    // unlist cascade: demoting a tracked funder moves its vetted calls to candidate (023 funders_unlist_cascade)
    const tracked = team2.funders.find((f) => f.status === 'vetted' && f.id !== promoted.id && team2.calls.some((c) => c.funder_id === f.id && c.vet_status === 'vetted'));
    await M.rpc('grants_set_funder', { p_pass: 'x', p_funder: tracked.id, p_patch: { action: 'demote', reason: 'Not a fit this cycle', actor: 'A' } });
    const after = await M.rpc('grants_registry', { p_pass: 'x' });
    assert.ok(after.calls.filter((c) => c.funder_id === tracked.id).every((c) => c.vet_status !== 'vetted'), 'vetted calls leave the tracked list with the funder');
    n++;
  } finally { globalThis.fetch = realFetch; }
}

// syncUnlock: the primary-style toggle and syncMe() must be real statements, not swallowed by a // comment (that bug hid the signed-in name).
t('syncUnlock runs the primary toggle and syncMe() as code, not inside a // comment', () => {
  const html = readFileSync(new URL('./dashboard.html', import.meta.url), 'utf8');
  const lines = html.slice(html.indexOf('function syncUnlock()'), html.indexOf('function openUnlock()')).split('\n');
  const toggle = lines.find((l) => l.includes("classList.toggle('btn--primary', unlocked())"));
  assert.ok(toggle && !toggle.includes('//'), 'btn--primary toggle sits inside a // comment');
  assert.ok(lines.some((l) => /(^|[\s;])syncMe\(\);/.test(l) && !l.includes('//')), 'syncMe() is not run');
});
console.log(`ok ${n} tests`);

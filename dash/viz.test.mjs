// node dash/viz.test.mjs  (no dependencies)
import assert from 'node:assert/strict';
import { fitBar, ring, spark, hbars, scatter, funnel, meter, stackedBars, esc } from './viz.js';
import { horizonLayout, unverifiedPoints, EMPTY } from './horizon.js';
import { readFileSync } from 'node:fs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const BAD = '<script>alert(1)</script>';

// Well-formed: one root <svg role=img> with a label, balanced tags, no NaN/undefined, no raw "<script", no unescaped quote in attributes.
function wellFormed(s) {
  assert.equal(typeof s, 'string');
  assert.match(s, /^<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+"[^>]*role="img"[^>]*aria-label="[^"]+"/);
  assert.ok(s.endsWith('</svg>'));
  assert.ok(!/NaN|undefined|Infinity|null/.test(s), 'bad value in markup: ' + s.match(/.{20}(NaN|undefined|Infinity|null).{20}/)?.[0]);
  assert.ok(!s.includes('<script'), 'raw <script in markup');
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], 'unbalanced ' + m[2]);
    else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, 'unclosed tags: ' + stack);
  for (const m of s.matchAll(/="([^"]*)"/g)) assert.ok(!/[<>]/.test(m[1]), 'unescaped < or > in attribute');
  return s;
}
const hasEsc = (s) => { assert.ok(s.includes('&lt;script&gt;'), 'label not escaped'); wellFormed(s); };

const DIMS = [
  { key: 'mission', label: 'Mission', points: 28, max: 35 }, { key: 'activity', label: 'Activity', points: 15, max: 15 },
  { key: 'geography', label: 'Geography', points: 6, max: 15 }, { key: 'eligibility', label: 'Eligibility', points: 20, max: 20 },
  { key: 'award', label: 'Award', points: 0, max: 10 }, { key: 'precedent', label: 'Precedent', points: 3, max: 5 },
];

t('esc handles all five characters and null', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

t('fitBar: six segments, widths proportional to max, fill = points/max, 2px gap', () => {
  const s = wellFormed(fitBar(DIMS, { w: 202 }));
  assert.equal((s.match(/class="viz-seg"/g) || []).length, 6);
  const tracks = [...s.matchAll(/class="viz-track" x="([\d.]+)" y="0" width="([\d.]+)"/g)].map((m) => [+m[1], +m[2]]);
  assert.equal(tracks.length, 6);
  const avail = 202 - 10, sumMax = 100;
  DIMS.forEach((d, i) => assert.ok(Math.abs(tracks[i][1] - (avail * d.max) / sumMax) < 0.02, `width ${i}`));
  for (let i = 1; i < 6; i++) assert.ok(Math.abs(tracks[i][0] - (tracks[i - 1][0] + tracks[i - 1][1] + 2)) < 0.03, 'gap 2');
  const fills = [...s.matchAll(/class="viz-fill(?: viz-full)?" x="[\d.]+" y="0" width="([\d.]+)"/g)].map((m) => +m[1]);
  assert.equal(fills.length, 5, 'zero-point segment has no fill');
  assert.ok(Math.abs(fills[0] - tracks[0][1] * (28 / 35)) < 0.02);
  assert.equal((s.match(/viz-full/g) || []).length, 2, 'full segments marked');
  assert.match(s, /aria-label="Fit 72 of 100: Mission 28 of 35/);
  assert.match(s, /data-id="mission"/);
});
t('fitBar: empty, extreme, values row, escaping', () => {
  assert.match(wellFormed(fitBar([])), /not itemized/);
  assert.match(wellFormed(fitBar(undefined)), /not itemized/);
  const x = wellFormed(fitBar([{ key: 'a', points: 9999, max: 10 }, { key: 'b', points: -4, max: 0 }], { w: 100 }));
  assert.ok(!/width="-/.test(x));
  assert.match(wellFormed(fitBar(DIMS, { values: true })), /viz-num/);
  hasEsc(fitBar([{ key: BAD, label: BAD, points: 1, max: 2 }]));
});

t('ring: arc length proportional, number centred and in the label', () => {
  const s = wellFormed(ring(75, { size: 100 }));
  const [arc, c] = s.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert.ok(Math.abs(arc / c - 0.75) < 0.005);
  assert.match(s, /text-anchor="middle"[^>]*>75</);
  assert.match(s, /aria-label="Fit 75 of 100"/);
  assert.match(ring(60, { tier: 'strong' }), /viz-t-strong/);
});
t('ring: empty, extremes, escaping', () => {
  assert.match(wellFormed(ring(null)), /not itemized yet/);
  assert.ok(!ring(undefined).includes('viz-ring-arc'));
  assert.match(wellFormed(ring(0)), /Fit 0 of 100/);
  const hi = wellFormed(ring(100000));
  const [arc, c] = hi.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert.equal(arc, c, 'clamped to full ring');
  hasEsc(ring(50, { label: BAD }));
});

t('spark: polyline, last-point dot, label states range', () => {
  const s = wellFormed(spark([1, 3, 2, 8]));
  assert.match(s, /<polyline/);
  assert.match(s, /4 points, from 1 to 8, low 1, high 8/);
  assert.equal((s.match(/<circle/g) || []).length, 1);
});
t('spark: empty, single, flat, extreme, escaping', () => {
  assert.match(wellFormed(spark([])), /no data yet/);
  assert.match(wellFormed(spark(['x', null])), /no data yet/);
  assert.ok(!spark([5]).includes('<polyline'));
  wellFormed(spark([5, 5, 5]));
  wellFormed(spark([0, 1e12, -1e12]));
  hasEsc(spark([1, 2], { label: BAD }));
});

t('hbars: one row per item, data-id, values printed, bucket class', () => {
  const s = wellFormed(hbars([{ id: 'a', label: 'Alpha', value: 10, bucket: 'us_federal' }, { id: 'b', label: 'Beta', value: 5 }], { w: 320 }));
  assert.equal((s.match(/class="viz-row"/g) || []).length, 2);
  assert.match(s, /data-id="a"/);
  assert.match(s, /viz-b-us_federal/);
  assert.match(s, /aria-label="Bars: Alpha 10, Beta 5"/);
});
t('hbars: empty, zero, extreme, escaping', () => {
  assert.match(wellFormed(hbars([])), /no data yet/);
  const z = wellFormed(hbars([{ label: 'Z', value: 0 }]));
  assert.ok(!z.includes('class="viz-fill'));
  const x = wellFormed(hbars([{ label: 'Big', value: 1e15 }, { label: 'Neg', value: -3 }]));
  assert.ok(!/width="-/.test(x));
  hasEsc(hbars([{ id: BAD, label: BAD, value: 3, note: BAD }]));
});

const PTS = [
  { id: 'f1', name: 'One', days: 20, fit: 80, award: 500000, bucket: 'us_federal', lane: 'apply_now' },
  { id: 'f2', name: 'Two', days: 120, fit: 55, award: 25000, bucket: 'private_sector' },
  { id: 'f3', name: 'Three', days: 60, fit: 30, award: 0, bucket: 'tracker' },
];
t('scatter: a mark per point with data-id, labelled top points, number in label', () => {
  const s = wellFormed(scatter(PTS));
  assert.equal((s.match(/class="viz-mark /g) || []).length, 3);
  assert.match(s, /data-id="f1" data-lane="apply_now"/);
  assert.match(s, /Scatter of 3 funders.*Highest fit 80/);
  assert.match(s, />One</);
  assert.match(s, /viz-hollow/, 'tracker uses a distinct shape');
});
t('scatter: empty, undated, extreme, escaping', () => {
  assert.match(wellFormed(scatter([])), /no dated funders yet/);
  assert.match(wellFormed(scatter([{ id: 'u', fit: 50, bucket: 'tracker' }])), /no dated funders yet/);
  const x = wellFormed(scatter([{ id: 'e', name: 'E', days: 1e9, fit: 1e6, award: 1e12, bucket: 'nope' }]));
  assert.ok(!/NaN/.test(x));
  hasEsc(scatter([{ id: BAD, name: BAD, days: 5, fit: 50, bucket: BAD }], { xLabel: BAD }));
});

t('funnel: rows with counts and dollars, narrower for smaller counts', () => {
  const s = wellFormed(funnel([{ state: 'reviewing', label: 'Reviewing', n: 8, usd: 900000 }, { state: 'applying', n: 4, usd: 300000 }, { state: 'awarded', n: 0 }]));
  assert.equal((s.match(/class="viz-row"/g) || []).length, 3);
  assert.match(s, /Reviewing 8 \(\$900k\)/);
  const w = [...s.matchAll(/class="viz-fill viz-f\d" x="[\d.]+" y="[\d.]+" width="([\d.]+)"/g)].map((m) => +m[1]);
  assert.equal(w.length, 2);
  assert.ok(w[1] < w[0]);
});
t('funnel: empty, all zero, extreme, escaping', () => {
  assert.match(wellFormed(funnel([])), /no data yet/);
  wellFormed(funnel([{ state: 'a', n: 0 }]));
  wellFormed(funnel([{ state: 'a', n: 1e9, usd: 5e12 }]));
  hasEsc(funnel([{ state: BAD, label: BAD, n: 2 }]));
});

t('meter: percent printed and in the label', () => {
  const s = wellFormed(meter(42, { label: 'Evidence' }));
  assert.match(s, /aria-label="Evidence 42 percent"/);
  assert.match(s, />42%</);
});
t('meter: empty, extremes, escaping', () => {
  assert.match(wellFormed(meter(null)), /no data yet/);
  assert.match(wellFormed(meter(0)), /0 percent/);
  assert.match(wellFormed(meter(9999)), /100 percent/);
  assert.match(wellFormed(meter(-5)), /0 percent/);
  hasEsc(meter(10, { label: BAD }));
});

t('stackedBars: segments carry data-id, counts, totals, legend', () => {
  const s = wellFormed(stackedBars([
    { id: 'us', label: 'Federal', parts: [{ key: 'vetted', label: 'Vetted', value: 6 }, { key: 'pending', label: 'Pending', value: 2 }] },
    { id: 'pv', label: 'Private', parts: [{ key: 'vetted', value: 3 }] },
  ]));
  assert.match(s, /data-id="us:vetted"/);
  assert.match(s, /Federal 8 \(Vetted 6, Pending 2\)/);
  assert.match(s, /class="viz-leg /);
  assert.equal((s.match(/class="viz-seg /g) || []).length, 3);
});
t('stackedBars: empty, zero parts, extreme, escaping', () => {
  assert.match(wellFormed(stackedBars([])), /no data yet/);
  wellFormed(stackedBars([{ label: 'Z', parts: [] }]));
  wellFormed(stackedBars([{ label: 'X', parts: [{ key: 'a', value: 1e12 }, { key: 'b', value: 1 }] }], { legend: false, normalize: true }));
  hasEsc(stackedBars([{ id: BAD, label: BAD, parts: [{ key: BAD, label: BAD, value: 4 }] }]));
});

t('no chart outputs colour literals (colours come from viz.css only)', () => {
  const all = [fitBar(DIMS), ring(50), spark([1, 2]), hbars([{ label: 'a', value: 1, bucket: 'tracker' }]), scatter(PTS), funnel([{ state: 'a', n: 1 }]), meter(5), stackedBars([{ label: 'a', parts: [{ key: 'k', value: 1 }] }])].join('');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(all));
});

t('horizon layout: only dated funders in range, compact height, crowded days spill instead of growing', () => {
  const R = (d, i) => ({ id: 'r' + i, name: 'F' + i, bucket: 'tracker', _days: d });
  assert.equal(horizonLayout([]).items.length, 0); assert.match(EMPTY, /^No dated deadlines in this selection$/);
  const L = horizonLayout([R(null, 0), R(-30, 1), R(400, 2), R(-5, 3), R(10, 4), R(365, 5)], { w: 600 });
  assert.deepEqual(L.items.map((r) => r.id), ['r3', 'r4', 'r5']); assert.ok(L.H >= 120 && L.H <= 170);
  const crowd = horizonLayout(Array.from({ length: 60 }, (_, i) => R(30, i)), { w: 360 });
  assert.ok(crowd.H >= 120 && crowd.H <= 170); assert.ok(crowd.pts.every((p) => p.n < 9)); assert.equal(crowd.pts.length, 60);
});
t('horizon: unverified calls of listed funders become their own points, skipping dupes of the funder date', () => {
  const now = new Date('2026-11-12T12:00:00Z'), rows = [{ id: 'a', name: 'A', bucket: 'federal', deadline: '2026-12-01' }, { id: 'b', name: 'B', bucket: 'private', deadline: null }];
  const opps = [
    { funder_id: 'a', vet_status: 'candidate', title: 'same day', deadline: '2026-12-01' },
    { funder_id: 'a', vet_status: 'candidate', title: 'A2', deadline: '2026-12-20' },
    { funder_id: 'b', vet_status: 'candidate', title: 'B1', deadline: '2026-11-29' },
    { funder_id: 'b', vet_status: 'vetted', title: 'ok', deadline: '2026-11-30' },
    { funder_id: 'b', vet_status: 'candidate', title: 'undated', deadline: null },
    { funder_id: 'gone', vet_status: 'candidate', title: 'filtered out', deadline: '2026-12-05' }];
  const u = unverifiedPoints(rows, opps, now);
  assert.deepEqual(u.map((p) => [p.id, p.title, p._days, p.bucket, p._uv]), [['a', 'A2', 38, 'federal', true], ['b', 'B1', 17, 'private', true]]);
  assert.equal(horizonLayout([...rows.map((r) => ({ ...r, _days: r.deadline ? 19 : null })), ...u]).items.length, 3);
  assert.deepEqual(unverifiedPoints(rows, undefined, now), []);
});

t('horizon.js carries no colour literals', () => {
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(readFileSync(new URL('./horizon.js', import.meta.url), 'utf8')));
});

console.log(`\n${n} tests, all ok`);

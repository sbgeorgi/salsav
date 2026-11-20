// node dash/galaxy.test.mjs: galaxy model, grouping, filters and the deterministic layout (no DOM).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, marksIndex } from '../dashboard.js';
import { GROUPS, galaxyItems, galaxyLayout, galaxyFilter, groupOf, nodeRadius, themeCounts, totals, defaultGalaxy, filterCount, moreActive, nodeCaps, hitRadius, placeTaps } from './galaxy.js';

const NOW = new Date('2026-11-11T20:00:00Z'); // fixed clock, same as dashboard.test.mjs
let n = 0;
const t = (name, fn) => { fn(); n++; };
const MOCK = JSON.parse(readFileSync(new URL('./mock.json', import.meta.url), 'utf8'));
const rows = normalize(MOCK.feed, NOW, {});
const registry = MOCK.registry;
const items = galaxyItems(rows, registry, { rubric: MOCK.feed.rubric || null });
const MODES = GROUPS.map(([k]) => k);

// synthetic funders for the size and shape tests: deterministic, no Math.random
const THEMES = ['water', 'soil', 'energy', 'food', 'climate', 'workforce', 'research', 'housing', 'rural', 'youth', 'health', 'trade'];
const BUCKETS = ['us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo', 'tracker'];
const synth = (count) => Array.from({ length: count }, (_, i) => ({
  id: `s${String(i).padStart(4, '0')}`, name: `Funder ${i}`, program: '', bucket: BUCKETS[i % BUCKETS.length],
  status: i % 7 === 0 ? 'rejected' : 'vetted', tracked: i % 7 !== 0, stage: ['new', 'reviewing', 'applying', 'screened'][i % 4],
  inPipeline: i % 5 === 0, themes: [THEMES[i % THEMES.length], THEMES[(i * 7) % THEMES.length]].filter((x, k, a) => a.indexOf(x) === k),
  geos: [['us', 'intl', 'sw', 'global'][i % 4]], band: ['unverified', 'lt500', '500k1m', '1m5m', '5m'][i % 5],
  award_max_usd: i % 9 === 0 ? null : 1e5 * (1 + (i % 50)), tier: ['prime', 'strong', 'possible', 'long_shot', 'none'][i % 5],
  ua_eligibility: ['eligible', 'unknown', 'unlikely'][i % 3], open_calls: i % 3 === 0, deadline: null, hay: `funder ${i}`,
}));
const W = 960, H = 600;
const circleGap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r);

t('model: mock feed and registry produce one item per funder id', () => {
  const ids = [...rows.map((r) => r.id), ...registry.funders.map((f) => f.id)];
  assert.equal(items.length, new Set(ids).size);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

t('model: tracked feed rows win over registry copies and are marked tracked', () => {
  for (const r of rows) {
    const it = items.find((x) => x.id === r.id);
    assert.equal(it.tracked, true);
    assert.equal(it.status, 'vetted');
  }
});

t('model: registry rejected funders are screened out and listed', () => {
  const rej = registry.funders.filter((f) => f.status === 'rejected' && !rows.some((r) => r.id === f.id));
  assert.ok(rej.length > 0, 'mock has screened-out funders not on the radar');
  for (const f of rej) {
    const it = items.find((x) => x.id === f.id);
    assert.ok(it, `missing ${f.id}`);
    assert.equal(it.status, 'rejected');
    assert.equal(it.tracked, false);
    assert.equal(it.stage, 'screened');
  }
});

t('model: candidates keep the candidate status and stage', () => {
  const cands = registry.funders.filter((f) => f.status === 'candidate');
  for (const f of cands) {
    const it = items.find((x) => x.id === f.id);
    assert.equal(it.status, 'candidate');
    assert.equal(it.stage, 'candidate');
  }
});

t('model: no registry gives tracked funders only', () => {
  const only = galaxyItems(rows, null);
  assert.equal(only.length, rows.length);
  assert.ok(only.every((i) => i.tracked));
});

t('model: pipeline marker only for progressed tracked funders', () => {
  for (const it of items) {
    if (!it.tracked) assert.equal(it.inPipeline, false);
  }
  const prog = rows.filter((r) => r.team?.state && !['new', 'skip'].includes(r.team.state));
  for (const r of prog) assert.equal(items.find((x) => x.id === r.id).inPipeline, true);
});

t('model: keyword themes are lowercase and trimmed; themeCounts sorts by count', () => {
  const counts = themeCounts(items);
  assert.ok(counts.length > 0);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1].n >= counts[i].n);
  for (const c of counts) assert.equal(c.key, c.key.trim().toLowerCase());
});

t('radius: unknown award gets the floor; larger award is never smaller', () => {
  assert.equal(nodeRadius(null), nodeRadius(0));
  assert.equal(nodeRadius(undefined), nodeRadius(-5));
  let prev = nodeRadius(null);
  for (const v of [1e4, 5e5, 1e6, 5e6, 5e7, 1e9]) {
    const r = nodeRadius(v);
    assert.ok(r >= prev, `radius fell at ${v}`);
    prev = r;
  }
  assert.ok(nodeRadius(1e9) <= 13.01, 'radius capped');
});

t('group-by: every mode yields a label and key for an item', () => {
  for (const mode of MODES) {
    for (const it of items) {
      const g = groupOf(it, mode);
      assert.equal(typeof g.key, 'string');
      assert.ok(g.label.length > 0, `${mode} label for ${it.id}`);
    }
  }
});

t('layout: determinism, same input gives an identical result', () => {
  for (const mode of MODES) {
    const a = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    const b = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    assert.deepEqual(a, b, mode);
  }
});

t('layout: input order does not change the result', () => {
  const shuffled = [...items].reverse();
  for (const mode of MODES) {
    assert.deepEqual(
      galaxyLayout(shuffled, { groupBy: mode, width: W, height: H }),
      galaxyLayout(items, { groupBy: mode, width: W, height: H }), mode);
  }
});

t('layout: every item is placed once in a cluster, for every group-by mode', () => {
  for (const mode of MODES) {
    const L = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    assert.equal(L.nodes.length, items.length, mode);
    assert.equal(new Set(L.nodes.map((x) => x.id)).size, items.length, mode);
    const keys = new Set(L.clusters.map((c) => c.key));
    for (const nd of L.nodes) assert.ok(keys.has(nd.cluster), `${mode} node ${nd.id} has no cluster`);
    assert.equal(L.clusters.reduce((s, c) => s + c.count, 0), items.length, mode);
  }
});

t('layout: nodes and clusters sit inside the canvas', () => {
  for (const mode of MODES) {
    const L = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    for (const c of L.clusters) {
      assert.ok(c.x - c.r >= 0 && c.x + c.r <= W && c.y - c.r >= 0 && c.y + c.r <= H, `${mode} cluster ${c.key}`);
    }
    for (const nd of L.nodes) {
      assert.ok(nd.x - nd.r >= 0 && nd.x + nd.r <= W && nd.y - nd.r >= 0 && nd.y + nd.r <= H, `${mode} node ${nd.id}`);
    }
  }
});

t('layout: clusters do not overlap beyond a 2px tolerance', () => {
  for (const mode of MODES) {
    const L = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    for (let i = 0; i < L.clusters.length; i++) for (let j = i + 1; j < L.clusters.length; j++) {
      assert.ok(circleGap(L.clusters[i], L.clusters[j]) >= -2, `${mode} clusters ${i} and ${j} overlap`);
    }
  }
});

const labelBox = (c) => {
  const w = Math.ceil(c.name.length * 7.4) + 8;
  return { x0: c.lx - w / 2, x1: c.lx + w / 2, y0: c.ly, y1: c.ly + 18 };
};
const boxesCross = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

t('layout: cluster labels stay inside the canvas', () => {
  for (const mode of MODES) {
    const L = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    for (const c of L.clusters) {
      const b = labelBox(c);
      assert.ok(b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H, `${mode} label ${c.key}`);
    }
  }
});

t('layout: cluster labels do not collide with each other, on the mock and 300 funders at phone width', () => {
  const cases = [...MODES.map((m) => [items, m, W, H]), ...MODES.map((m) => [synth(300), m, 328, 380])];
  for (const [set, mode, w, h] of cases) {
    const L = galaxyLayout(set, { groupBy: mode, width: w, height: h });
    const boxes = L.clusters.map(labelBox);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!boxesCross(boxes[i], boxes[j]), `${mode} ${w}x${h}: labels of ${L.clusters[i].key} and ${L.clusters[j].key} collide`);
    }
  }
});

// shortcut: at phone width with 60+ funders in few clusters a label can still cover a node (measured 8 to 64 covers), upgrade: leader lines or a label declutter pass
t('layout: cluster labels do not cover nodes, on the mock at both widths and 300 funders on desktop', () => {
  const cases = [...MODES.map((m) => [items, m, W, H]), ...MODES.map((m) => [items, m, 328, 380]), ...MODES.map((m) => [synth(300), m, W, H])];
  for (const [set, mode, w, h] of cases) {
    const L = galaxyLayout(set, { groupBy: mode, width: w, height: h });
    for (const c of L.clusters) {
      const b = labelBox(c);
      for (const p of L.nodes) {
        const nx = Math.min(Math.max(p.x, b.x0), b.x1), ny = Math.min(Math.max(p.y, b.y0), b.y1);
        assert.ok((p.x - nx) ** 2 + (p.y - ny) ** 2 >= (p.r + 2) ** 2 - 1e-6, `${mode} ${w}x${h}: label ${c.key} covers node ${p.id}`);
      }
    }
  }
});

t('layout: 300 funders in one group at phone width do not overlap', () => {
  const same = synth(300).map((it) => ({ ...it, themes: ['one theme'] }));
  const L = galaxyLayout(same, { groupBy: 'concept', width: 328, height: 380 });
  for (const nd of L.nodes) assert.ok(nd.x - nd.r >= 0 && nd.x + nd.r <= 328 && nd.y - nd.r >= 0 && nd.y + nd.r <= 380);
  for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
    assert.ok(circleGap(L.nodes[i], L.nodes[j]) >= -2, `nodes ${i} and ${j} overlap`);
  }
});

t('layout: nodes in one cluster do not overlap beyond a 2px tolerance', () => {
  for (const mode of MODES) {
    const L = galaxyLayout(items, { groupBy: mode, width: W, height: H });
    for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
      const a = L.nodes[i], b = L.nodes[j];
      if (a.cluster !== b.cluster) continue;
      assert.ok(circleGap(a, b) >= -2, `${mode} nodes ${a.id} and ${b.id} overlap`);
    }
  }
});

t('layout: concept mode folds single-funder concepts into one cluster when there are many', () => {
  const many = synth(120).map((it, i) => ({ ...it, themes: [`theme${i}`] }));
  const L = galaxyLayout(many, { groupBy: 'concept', width: W, height: H });
  assert.ok(L.clusters.some((c) => c.key === 'c:other'), 'an Other cluster exists');
  assert.ok(L.clusters.length <= 9, `kept ${L.clusters.length} clusters`);
});

t('layout: a small concept joins the named concept whose members share its theme, not Other', () => {
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`] }));
  // water is named (4 funders); drought has 2 funders, below the minimum, and co-occurs with water through item 0
  const link = [['water', 'drought'], ['water'], ['water'], ['water'], ['drought']];
  const items = many.map((it, i) => (i < 5 ? { ...it, themes: link[i] } : it));
  const L = galaxyLayout(items, { groupBy: 'concept', width: W, height: H });
  assert.equal(L.clusters.find((c) => c.key === 'c:water')?.count, 5, 'the drought funder folds into the water cluster');
  assert.equal(L.clusters.find((c) => c.key === 'c:other')?.count, 55, 'unlinked single concepts stay in Other');
});

t('layout: a funder that shares only name or programme words with a cluster stays in Other', () => {
  // water has 4 funders (named), all with programme "Solar pilot". Items 10 and 11 share "solar" and "pilot" in their programme
  // but no theme with any of them, so the shared words join nothing.
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`], program: '' }));
  const items = many.map((it, i) => (i < 4 ? { ...it, themes: ['water'], program: 'Solar pilot' } : i === 10 || i === 11 ? { ...it, program: 'Solar pilot' } : it));
  const L = galaxyLayout(items, { groupBy: 'concept', width: W, height: H });
  assert.equal(L.clusters.find((c) => c.key === 'c:water')?.count, 4, 'the water cluster keeps its own four funders');
  assert.equal(L.nodes.find((n) => n.id === items[10].id)?.cluster, 'c:other', 'a shared programme word alone does not join water');
  assert.equal(L.nodes.find((n) => n.id === items[11].id)?.cluster, 'c:other', 'a shared name word alone does not join water');
});

t('layout: guard: an unplaced funder that shares a theme (not a word) with a cluster member joins that cluster', () => {
  // water has 4 funders (named). Item 0 also carries the rare theme "tidal"; item 10 has only "tidal" and no name overlap.
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`], program: '' }));
  const items = many.map((it, i) => (i < 4 ? { ...it, themes: i === 0 ? ['water', 'tidal'] : ['water'] } : i === 10 ? { ...it, themes: ['tidal'] } : it));
  const L = galaxyLayout(items, { groupBy: 'concept', width: W, height: H });
  assert.equal(L.nodes.find((n) => n.id === items[10].id)?.cluster, 'c:water', 'the tidal funder joins the water cluster');
  assert.equal(L.clusters.find((c) => c.key === 'c:water')?.count, 5, 'water now holds its four and the tidal funder');
});

t('layout: an unplaced funder joins the concept its theme spells out; a theme that lists three concepts places nothing', () => {
  // water (4), solar (3) and food security (3) are named. "watershed restoration" starts with water's name word, "food systems"
  // with one of food security's. A theme listing water, solar and food is an aggregator's catch-all and names no single topic.
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`], program: '' }));
  const items = many.map((it, i) => {
    if (i < 4) return { ...it, themes: ['water'] };
    if (i < 7) return { ...it, themes: ['solar'] };
    if (i < 10) return { ...it, themes: ['food security'] };
    if (i === 10) return { ...it, themes: ['soil health', 'watershed restoration'] };
    if (i === 11) return { ...it, themes: ['food systems'] };
    if (i === 12) return { ...it, themes: ['all grants (water, solar, food)'] };
    return it;
  });
  const at = (i) => galaxyLayout(items, { groupBy: 'concept', width: W, height: H }).nodes.find((n) => n.id === items[i].id)?.cluster;
  assert.equal(at(10), 'c:water', 'the second theme names water');
  assert.equal(at(11), 'c:food security', 'food systems names food security');
  assert.equal(at(12), 'c:other', 'a list of three concepts is not a topic');
});

t('layout: a funder that reaches a cluster only through a chain of other funders\' themes stays in Other', () => {
  // water has 4 funders (named). Item 10 shares the theme "x" with item 0, so it joins water. Item 11 has only "y", which
  // item 10 links to "x" and so to water. A chain of links does not place it; only a shared theme does.
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`], program: '' }));
  const items = many.map((it, i) => (i < 4 ? { ...it, themes: i === 0 ? ['water', 'x'] : ['water'] } : i === 10 ? { ...it, themes: ['x', 'y'] } : i === 11 ? { ...it, themes: ['y'] } : it));
  const L = galaxyLayout(items, { groupBy: 'concept', width: W, height: H });
  assert.equal(L.nodes.find((n) => n.id === items[11].id)?.cluster, 'c:other', 'the y funder shares no theme with water');
  assert.equal(L.clusters.find((c) => c.key === 'c:water')?.count, 5, 'water holds its four and item 10, which shares "x"');
});

t('layout: second pass counts shared themes only: one shared theme with water beats two name or programme words shared with solar', () => {
  // water (4 funders) and solar (3 funders) are named. Item 1 adds "tidal", so water's members share it. Item 10 is unplaced: its
  // primary "pond" is unshared, its second theme "tidal" is water's, and its programme words "Solar pilot" match solar's. Words join
  // nothing, so it goes to water. (A primary that co-occurs with water would fold the funder there in the first pass.)
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`], program: '' }));
  const items = many.map((it, i) => {
    if (i < 4) return { ...it, themes: i === 1 ? ['water', 'tidal'] : ['water'] };
    if (i < 7) return { ...it, themes: ['solar'], program: 'Solar pilot' };
    if (i === 10) return { ...it, themes: ['pond', 'tidal'], program: 'Solar pilot' };
    return it;
  });
  const L = galaxyLayout(items, { groupBy: 'concept', width: W, height: H });
  assert.equal(L.nodes.find((n) => n.id === items[10].id)?.cluster, 'c:water', 'the tidal funder joins water, not solar');
  assert.equal(L.clusters.find((c) => c.key === 'c:water')?.count, 5, 'water holds its four and the tidal funder');
  assert.equal(L.clusters.find((c) => c.key === 'c:solar')?.count, 3, 'solar keeps its three');
});

t('layout: generic research and partnership words never name a cluster or join one', () => {
  // four funders carry only generic words. Under the old rule "research" became a cluster of its own; now none of them is a topic.
  const many = synth(60).map((it, i) => ({ ...it, themes: [`theme${i}`], program: '' }));
  const items = many.map((it, i) => (i < 4 ? { ...it, themes: ['research', 'international partnerships'] } : it));
  const L = galaxyLayout(items, { groupBy: 'concept', width: W, height: H });
  assert.ok(!L.clusters.some((c) => c.key === 'c:research' || c.key === 'c:international partnerships'), 'no cluster named for a generic word');
  for (const it of items.slice(0, 4)) assert.equal(L.nodes.find((n) => n.id === it.id)?.cluster, 'c:other', `${it.name} stays in Other`);
});

t('layout: links connect clusters that share a second concept', () => {
  const L = galaxyLayout(synth(60), { groupBy: 'concept', width: W, height: H });
  for (const l of L.links) {
    assert.ok(L.clusters.some((c) => c.key === l.a) && L.clusters.some((c) => c.key === l.b));
    assert.ok(l.a < l.b && l.w >= 1);
  }
});

t('layout: empty input gives an empty map', () => {
  for (const mode of MODES) {
    const L = galaxyLayout([], { groupBy: mode, width: W, height: H });
    assert.deepEqual(L.clusters, []);
    assert.deepEqual(L.nodes, []);
  }
  assert.deepEqual(galaxyLayout(undefined).nodes, []);
});

t('layout: one item gives one cluster and one node inside the canvas', () => {
  const one = [synth(1)[0]];
  for (const mode of MODES) {
    const L = galaxyLayout(one, { groupBy: mode, width: 360, height: 360 });
    assert.equal(L.clusters.length, 1);
    assert.equal(L.nodes.length, 1);
    const nd = L.nodes[0];
    assert.ok(nd.x - nd.r >= 0 && nd.x + nd.r <= 360 && nd.y - nd.r >= 0 && nd.y + nd.r <= 360);
  }
});

t('layout: a 300-funder map is laid out in under 50 ms', () => {
  const big = synth(300);
  galaxyLayout(big, { groupBy: 'concept', width: W, height: H }); // warm up
  const t0 = performance.now();
  const L = galaxyLayout(big, { groupBy: 'concept', width: W, height: H });
  const ms = performance.now() - t0;
  assert.equal(L.nodes.length, 300);
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
});

t('layout: worst case, 300 funders in one group, cold, under 50 ms and without node overlaps', () => {
  const same = synth(300).map((it) => ({ ...it, themes: ['one theme'] }));
  const t0 = performance.now();
  const L = galaxyLayout(same, { groupBy: 'concept', width: W, height: H });
  const ms = performance.now() - t0;
  assert.equal(L.clusters.length, 1);
  assert.equal(L.nodes.length, 300);
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
  for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
    assert.ok(circleGap(L.nodes[i], L.nodes[j]) >= -2, `nodes ${i} and ${j} overlap`);
  }
});

t('layout: narrow phone width still fits every node in the canvas', () => {
  const L = galaxyLayout(items, { groupBy: 'concept', width: 328, height: 380 });
  for (const nd of L.nodes) assert.ok(nd.x - nd.r >= 0 && nd.x + nd.r <= 328 && nd.y - nd.r >= 0 && nd.y + nd.r <= 380);
});

t('filter: default state keeps everything', () => {
  assert.equal(galaxyFilter(items, defaultGalaxy()).length, items.length);
});

t('filter: screened out is hidden when the toggle is off', () => {
  const kept = galaxyFilter(items, { ...defaultGalaxy(), screened: false });
  assert.ok(kept.length < items.length);
  assert.ok(kept.every((i) => i.status !== 'rejected'));
});

t('filter: open calls only, size band, type, fit tier and eligibility each narrow the set', () => {
  const base = galaxyFilter(items, defaultGalaxy()).length;
  assert.ok(galaxyFilter(items, { ...defaultGalaxy(), openOnly: true }).every((i) => i.open_calls));
  const band = galaxyFilter(items, { ...defaultGalaxy(), bands: ['5m'] });
  assert.ok(band.length < base && band.every((i) => i.band === '5m'));
  const type = galaxyFilter(items, { ...defaultGalaxy(), types: ['foundation_ngo'] });
  assert.ok(type.every((i) => i.bucket === 'foundation_ngo'));
  const ua = galaxyFilter(items, { ...defaultGalaxy(), ua: ['eligible'] });
  assert.ok(ua.every((i) => i.ua_eligibility === 'eligible'));
  const tier = galaxyFilter(items, { ...defaultGalaxy(), tiers: ['none'] });
  assert.ok(tier.every((i) => i.tier === 'none'));
});

t('filter: keywords match any selected theme (multi-select is OR)', () => {
  const pick = themeCounts(items)[0].key;
  const one = galaxyFilter(items, { ...defaultGalaxy(), themes: [pick] });
  assert.ok(one.length > 0 && one.every((i) => i.themes.includes(pick)));
  const two = galaxyFilter(items, { ...defaultGalaxy(), themes: [pick, 'no-such-theme'] });
  assert.deepEqual(two.map((i) => i.id), one.map((i) => i.id));
});

t('filter: the filters combine (AND across groups)', () => {
  const f = galaxyFilter(items, { ...defaultGalaxy(), openOnly: true, bands: ['5m', '1m5m', '500k1m', 'lt500', 'unverified'], types: ['us_federal'] });
  assert.ok(f.every((i) => i.open_calls && i.bucket === 'us_federal'));
});

t('filter: an empty result is an empty array, not an error', () => {
  assert.deepEqual(galaxyFilter(items, { ...defaultGalaxy(), themes: ['no-such-theme'] }), []);
  assert.deepEqual(galaxyFilter([], defaultGalaxy()), []);
});

t('filter: the Fit and eligibility count ignores the visible quick filters (type, size, keywords)', () => {
  assert.equal(moreActive(defaultGalaxy()), 0);
  assert.equal(moreActive({ ...defaultGalaxy(), types: ['us_federal'], bands: ['5m'], themes: ['water'] }), 0);
  assert.equal(moreActive({ ...defaultGalaxy(), tiers: ['none'], ua: ['eligible', 'unknown'] }), 3);
  assert.equal(moreActive({}), 0);
});

t('fit: a funder with no fit score is in the none tier and reads "Not scored yet", never null', () => {
  const unscored = items.filter((i) => i.fit_score == null);
  assert.ok(unscored.length > 0, 'the mock has funders with no fit score');
  for (const it of unscored) {
    assert.equal(it.tier, 'none');
    assert.equal(it.tierLabel, 'Not scored yet');
  }
  assert.ok(items.every((i) => !/null|undefined|NaN/.test(i.tierLabel)));
});

t('queued: a funder waiting for the discovery agent is marked, from the registry queue or the feed row', () => {
  const [fromRegistry] = galaxyItems([], { funders: [{ id: 'q1', name: 'Queued', status: 'vetted', queue: 'pending' }] });
  assert.equal(fromRegistry.queued, true);
  const [fromRow] = galaxyItems([{ id: 'q2', name: 'Feed row', _queue: 'pending' }], null);
  assert.equal(fromRow.queued, true);
  const [done] = galaxyItems([{ id: 'q3', name: 'Done', _queue: 'done' }], null);
  assert.equal(done.queued, false);
});

t('bookmarks: galaxyItems stamps the def on a tracked and on a screened funder; without marks every mark is null', () => {
  const tracked = items.find((i) => i.tracked), screened = items.find((i) => !i.tracked && i.status === 'rejected');
  assert.ok(tracked && screened);
  const marks = marksIndex({ team: true, defs: [{ id: 'd1', label: 'Call first', hue: 3, effect: 'hide', sort: 1 }], items: [{ kind: 'funder', id: tracked.id, mark: 'd1' }, { kind: 'funder', id: screened.id, mark: 'd1' }] });
  const marked = galaxyItems(rows, registry, { rubric: MOCK.feed.rubric || null, marks });
  const by = new Map(marked.map((i) => [i.id, i]));
  assert.equal(by.get(tracked.id).mark.label, 'Call first');
  assert.equal(by.get(screened.id).mark.hue, 3);
  assert.equal(marked.filter((i) => i.mark).length, 2);
  assert.ok(items.every((i) => i.mark === null));
});

t('bookmarks: the view draws the ribbon, the legend entry, the card control and the row chip; source cuts hold', () => {
  const src = readFileSync(new URL('./galaxy.js', import.meta.url), 'utf8');
  assert.ok(/class: 'gx-mk'/.test(src) && /`gx-mk mk-\$\{it\.mark\.hue\}`/.test(src));
  assert.ok(src.includes("item('Bookmarked'") && src.includes("const mk = st.app.markChip('funder', it.id)") && src.includes("h('dd', {}, mk)") && src.includes("st.app.markChip('funder', it.id)));"));
  assert.ok(!src.includes('markControl'), 'the inert selection card shows a read-only chip, not a menu control');
  assert.ok(src.includes('app.S.marks') && !/^function sv\(/m.test(src) && !/galaxyRadius|^export const (TIERS|STAGE_LABEL|capLabel)/m.test(src));
});

t('totals: counts and published award sum for the visible set', () => {
  const tt = totals(items);
  assert.equal(tt.n, items.length);
  assert.equal(tt.award, items.reduce((s, i) => s + Math.max(0, +i.award_max_usd || 0), 0));
  assert.deepEqual(totals([]), { n: 0, award: 0 });
});

t('hit target: a node may grow only up to the next node ring; a lone node has no neighbour cap', () => {
  const caps = nodeCaps([{ id: 'a', x: 0, y: 0, r: 4 }, { id: 'b', x: 20, y: 0, r: 4 }, { id: 'c', x: 300, y: 0, r: 4 }]);
  assert.equal(caps.get('a'), 20 - 4 - 5.5); // b's dot plus its 4.5 ring and a 1px gap
  assert.equal(caps.get('b'), 20 - 4 - 5.5);
  assert.equal(caps.get('c'), 280 - 4 - 5.5); // nearest neighbour is b, 280 away
  assert.equal(nodeCaps([{ id: 'solo', x: 0, y: 0, r: 4 }]).get('solo'), Infinity);
});

t('hit target: at desktop zoom 1 a node hit is 16px as before; zooming in never grows it past 1.5 x 16 screen px or below the dot', () => {
  assert.equal(hitRadius(4, 1, 16), 16); // dot radius 4: the 16px screen floor wins, as before
  assert.equal(hitRadius(13, 1, 16), 17); // a large dot keeps its own ring plus 4
  assert.equal(hitRadius(4.5, 4, 16) * 4, 24, 'at zoom 4 a 4.5-radius dot gets a 24px hit, not the 34 the old rule gave');
  assert.equal(hitRadius(4, 0.25, 16) * 0.25, 16, 'zoomed out, the hit stays 16 screen px');
  assert.equal(hitRadius(4.5, 4, 16, 6), 6, 'a neighbour cap still applies');
  assert.equal(hitRadius(13, 4, 16), 13, 'a large dot at zoom 4 keeps a hit as big as the dot itself, not the 6 the cap alone gives');
  assert.equal(hitRadius(13, 4, 16, 5), 5, 'a neighbour closer than the dot still wins over the dot floor');
});

t('taps: a cluster label tap is 46px tall when clear, and falls back to the label height when a mark is in the way', () => {
  const tap = () => ({ a: {}, setAttribute(n, v) { this.a[n] = v; } });
  const label = (lx, ly, t) => ({ lx, ly, name: { getBBox: () => ({ x: -50, y: -7, width: 100, height: 14 }) }, tap: t });
  const run = (nodes) => { const t = tap(), st = { k: 1, tapPx: 46, layout: { nodes }, clusterEls: new Map([['c', label(0, 0, t)]]) }; placeTaps(st); return t.a.height; };
  assert.equal(run([{ id: 'far', x: 500, y: 0, r: 4.5 }]), 46, 'no mark near: the tap is the full 46px');
  assert.equal(run([{ id: 'under', x: 0, y: 10, r: 4.5 }]), 14, 'a mark 10px below the label line: the tap is the 14px label height, never zero');
  assert.equal(run([{ id: 'on', x: 0, y: 0, r: 4.5 }]), 14, 'a mark on the label line: the tap keeps the label height');
});

t('filterCount counts chips and the Show toggles moved off default; filters start closed', () => {
  assert.equal(filterCount(defaultGalaxy()), 0);
  assert.equal(defaultGalaxy().filtersOpen, false);
  assert.equal(filterCount({ ...defaultGalaxy(), types: ['a', 'b'], themes: ['x'], tiers: ['prime'], openOnly: true, screened: false }), 6);
});

console.log(`ok ${n} tests`);

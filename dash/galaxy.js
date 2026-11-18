/* Galaxy view: a calm map of the funder landscape (tracked, screened out, candidates).
   The model, grouping, filter and layout are pure (no DOM at import) and covered by dash/galaxy.test.mjs.
   The view builds SVG with createElementNS and text nodes only; funder text never reaches innerHTML. */
import { BUCKETS, BANDS, GEOS, UA, UNSCORED, STATE_LABELS, amountBand, amountRange, geoGroups, fitTier, isProgressed, collectionOf, daysLeft, countdown, fmtDate, money } from '../dashboard.js';
import { bucketDot, statusChip, stateChip } from './ui.js';

/* ---------- constants ---------- */
export const GROUPS = [['concept', 'Concept'], ['type', 'Organization type'], ['size', 'Funding size'], ['region', 'Region'], ['stage', 'Pipeline stage']];
export { nodeRadius as galaxyRadius, groupOf as galaxyKey };
export const TIERS = [['prime', 'Prime fit'], ['strong', 'Strong fit'], ['possible', 'Possible'], ['long_shot', 'Long shot'], ['none', UNSCORED]];
export const STAGE_LABEL = { ...STATE_LABELS, candidate: 'Candidate', screened: 'Screened out' };
const BAND_LABEL = Object.fromEntries(BANDS);
const TIER_LABEL = Object.fromEntries(TIERS);
const GEO_ORDER = ['sw', 'us', 'intl', 'global'];
const UA_KEYS = ['eligible', 'eligible_with_partner', 'invitation_only', 'unlikely', 'unknown'];
const OTHER = 'c:other';
const MAX_CONCEPTS = 8;
const MIN_GROUP = 3; // a concept needs this many funders to stand as its own cluster once the map is crowded
const KW_TOP = 10;
const ROWS_FIRST = 8;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const R_MIN = 4.5, R_MAX = 13, LOG_LO = 4.5, LOG_HI = 7.5;

const cmp = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const arr = (v) => (Array.isArray(v) ? v : []);
const bucketOf = (b) => (b && Object.prototype.hasOwnProperty.call(BUCKETS, b) ? b : 'tracker');
const themeKey = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
const awardOf = (it) => (it.award_max_usd == null || !Number.isFinite(+it.award_max_usd) ? -1 : +it.award_max_usd);
const byAward = (a, b) => awardOf(b) - awardOf(a) || cmp(a.id, b.id);
const pairKey = (a, b) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
const STOP_WORDS = new Set(['fund', 'funds', 'funding', 'program', 'programme', 'grant', 'grants', 'award', 'awards', 'foundation', 'initiative', 'call', 'open', 'annual', 'the', 'and', 'for', 'with', 'from']);
const wordsOf = (it) => [...new Set(`${it.name} ${it.program}`.toLowerCase().match(/[a-z]{4,}/g) || [])].filter((w) => !STOP_WORDS.has(w)); // name and programme words: keyword overlap
export const capLabel = (s) => { const t = String(s || '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };

/* node radius: log scale of the published maximum award, floor for unknown amounts */
export function nodeRadius(award) {
  if (award == null || !Number.isFinite(+award) || +award <= 0) return R_MIN;
  const t = clamp((Math.log10(+award) - LOG_LO) / (LOG_HI - LOG_LO), 0, 1);
  return r2(R_MIN + (R_MAX - R_MIN) * t);
}

/* ---------- model: one item per funder, tracked (feed rows) or screened/candidate (registry) ---------- */
function toItem(f, tracked, rubric) {
  const themes = [...new Set(arr(f.themes).map(themeKey).filter(Boolean))];
  const gs = geoGroups({ geography: arr(f.geography) });
  const geos = GEO_ORDER.filter((g) => gs.has(g));
  const tier = fitTier(f.fit_score, rubric);
  const status = tracked ? 'vetted' : f.status === 'candidate' ? 'candidate' : 'rejected';
  const teamState = f.team?.state ?? f.team_state ?? null;
  const stage = tracked ? (teamState || 'new') : status === 'candidate' ? 'candidate' : 'screened';
  const calls = Number(f.calls_open ?? collectionOf(f).open_calls ?? 0);
  const deadline = f.next_deadline ?? f.deadline ?? null;
  const name = String(f.name || 'Unnamed funder');
  const bucket = bucketOf(f.bucket);
  const ua = f.ua_eligibility || 'unknown';
  const hay = [name, f.program, themes.join(' '), arr(f.geography).join(' '), BUCKETS[bucket], STAGE_LABEL[stage], UA[ua]].filter(Boolean).join(' ').toLowerCase();
  return {
    id: f.id, name, program: String(f.program || ''), bucket, status, tracked: !!tracked, stage,
    inPipeline: !!tracked && isProgressed(teamState), themes, geos, geography: arr(f.geography).map(String),
    award_min_usd: f.award_min_usd ?? null, award_max_usd: f.award_max_usd ?? null, band: amountBand(f),
    fit_score: f.fit_score ?? null, tier: tier ? tier.key : 'none', tierLabel: tier ? tier.label : UNSCORED,
    ua_eligibility: ua, open_calls: calls > 0, deadline, cycle: f.cycle || null, hay,
    queued: (f.queue ?? f._queue) === 'pending', // a promoted funder waiting for the discovery agent (registry queue, or the shell's _queue on a tracked row)
  };
}

/* rows: normalized feed rows (tracked). registry: grants_registry() (screened, candidates, and any vetted id the feed lacks). */
export function galaxyItems(rows = [], registry = null, { rubric = null } = {}) {
  const out = [], seen = new Set();
  const add = (f, tracked) => {
    if (!f || f.id == null || seen.has(f.id)) return;
    seen.add(f.id); out.push(toItem(f, tracked, rubric));
  };
  for (const r of rows || []) add(r, true);
  for (const f of registry?.funders || []) add(f, f.status === 'vetted');
  return out;
}

/* ---------- grouping: the key and label of an item for one group-by mode ---------- */
export function groupOf(it, mode) {
  if (mode === 'type') return { key: `t:${it.bucket}`, label: BUCKETS[it.bucket] || 'Trackers', also: [] };
  if (mode === 'size') return { key: `s:${it.band}`, label: BAND_LABEL[it.band] || 'Unverified', also: [] };
  if (mode === 'region') {
    const g = GEO_ORDER.find((k) => it.geos.includes(k));
    return g ? { key: `r:${g}`, label: GEOS[g], also: [] } : { key: 'r:none', label: 'Region not stated', also: [] };
  }
  if (mode === 'stage') return { key: `p:${it.stage}`, label: STAGE_LABEL[it.stage] || capLabel(it.stage), also: [] };
  const [first, ...rest] = it.themes || [];
  if (!first) return { key: 'c:none', label: 'Unthemed', also: [] };
  return { key: `c:${first}`, label: capLabel(first), also: rest.map((t) => `c:${t}`) };
}

/* ---------- layout: deterministic, pure. Clusters are packed and relaxed; nodes sit in their cluster by a sunflower spiral. ---------- */
export function galaxyLayout(items = [], { groupBy = 'concept', width = 960, height = 600 } = {}) {
  const W = Math.max(160, Number(width) || 960), H = Math.max(160, Number(height) || 600);
  const MT = 34, MB = 14, ML = 14, MR = 14, GAP = 22; // GAP: room between halos for their labels
  const list = (items || []).filter((it) => it && it.id != null).sort((a, b) => cmp(a.id, b.id));
  const keyed = list.map((it) => ({ it, g: groupOf(it, groupBy) }));
  const df = new Map(); // in how many funders each word appears; a word most funders share says nothing about one of them
  for (const it of list) for (const w of wordsOf(it)) df.set(w, (df.get(w) || 0) + 1);
  const distinct = (it) => wordsOf(it).filter((w) => df.get(w) <= Math.max(2, list.length / 10));

  // many concepts: a concept with fewer than MIN_GROUP funders folds into the nearest named concept, reached over keyword
  // co-occurrence (a funder's keywords link each other); "Other concepts" keeps only what no named concept reaches
  const counts = new Map(), labelOf = new Map(), adj = new Map();
  const edge = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const { g } of keyed) {
    counts.set(g.key, (counts.get(g.key) || 0) + 1); labelOf.set(g.key, g.label);
    for (const raw of g.also) { edge(g.key, raw); edge(raw, g.key); }
  }
  const crowded = groupBy === 'concept' && counts.size > MAX_CONCEPTS;
  const named = (k) => counts.get(k) >= MIN_GROUP && k !== 'c:none';
  const near = new Map(), queue = [...counts.keys()].filter(named).sort(cmp);
  for (const k of queue) near.set(k, k);
  for (let i = 0; i < queue.length; i++) {
    for (const nb of [...(adj.get(queue[i]) || [])].sort(cmp)) if (!near.has(nb)) { near.set(nb, near.get(queue[i])); queue.push(nb); }
  }
  const home = (k) => (!crowded || named(k) ? k : near.get(k) || null); // null: no named concept reaches it
  const keyOf = (g) => (home(g.key) === g.key ? g.key : g.also.find(named) || home(g.key));
  // first pass: a funder that a named concept reaches keeps that cluster. Second pass: a funder no named concept reaches
  // joins the cluster whose members share the most themes and name or programme words with it (tie: the cluster where its
  // organisation class is most common). A funder that shares no theme and fewer than two such words stays in Other.
  const seeds = new Map(), unplaced = [];
  for (const { it, g } of keyed) {
    const k = keyOf(g);
    if (k) { if (!seeds.has(k)) seeds.set(k, []); seeds.get(k).push(it); } else unplaced.push(it);
  }
  const profile = new Map([...seeds].sort(([a], [b]) => cmp(a, b)).map(([k, members]) => [k, {
    themes: new Set(members.flatMap((m) => m.themes)), words: new Set(members.flatMap(distinct)),
    bucket: members.reduce((c, m) => c.set(m.bucket, (c.get(m.bucket) || 0) + 1), new Map()),
  }]));
  const bestFor = (it) => {
    let best = OTHER, score = 0, cls = 0;
    const own = distinct(it);
    for (const [k, p] of profile) {
      const th = it.themes.filter((t) => p.themes.has(t)).length, wd = own.filter((w) => p.words.has(w)).length;
      if (!th && wd < 2) continue; // one shared name word ("pilot", "global") is not a topical match
      const s = th + wd, c = p.bucket.get(it.bucket) || 0;
      if (s > score || (s === score && s > 0 && c > cls)) { best = k; score = s; cls = c; }
    }
    return best;
  };

  const byKey = new Map();
  const put = (k, it) => {
    if (!byKey.has(k)) byKey.set(k, { key: k, label: k === OTHER ? 'Other concepts' : labelOf.get(k), items: [] });
    byKey.get(k).items.push(it);
  };
  for (const [k, members] of seeds) for (const it of members) put(k, it);
  for (const it of unplaced) put(bestFor(it), it);
  const clusters = [...byKey.values()].map((c) => ({
    key: c.key, label: c.label, items: c.items.slice().sort(byAward), n: c.items.length,
    total: c.items.reduce((s, it) => s + Math.max(0, +it.award_max_usd || 0), 0),
  })).sort((a, b) => b.n - a.n || b.total - a.total || cmp(a.key, b.key));
  const n = clusters.length;
  if (!n) return { width: W, height: H, clusters: [], nodes: [], links: [] };

  // related clusters: items that carry a second concept link their clusters
  const index = new Map(clusters.map((c, i) => [c.key, i]));
  const alsoOf = new Map(), linkMap = new Map();
  for (const { it, g } of keyed) {
    const a = keyOf(g), out = [];
    for (const raw of g.also) { const k = home(raw); if (k !== a && index.has(k) && !out.includes(k)) out.push(k); }
    alsoOf.set(it.id, out);
    for (const b of out) {
      const p = pairKey(a, b);
      const e = linkMap.get(p) || { a: a < b ? a : b, b: a < b ? b : a, w: 0 };
      e.w += 1; linkMap.set(p, e);
    }
  }

  // cluster radius from its size; if the total area would crowd the canvas, shrink all clusters evenly
  let R = clusters.map((c) => 20 + 11 * Math.sqrt(c.n));
  const used = R.reduce((s, r) => s + Math.PI * r * r, 0), budget = 0.5 * W * H;
  if (used > budget) { const k = Math.sqrt(budget / used); R = R.map((r) => Math.max(16, r * k)); }
  const rMax = Math.max(...R);
  const cx = W / 2, cy = (MT + H - MB) / 2;
  const meanR = R.reduce((s, r) => s + r, 0) / n, step = 2 * meanR + GAP;
  const P = clusters.map((_, i) => (i === 0 ? { x: cx, y: cy } : { x: cx + step * Math.sqrt(i) * Math.cos(i * GOLDEN), y: cy + step * Math.sqrt(i) * Math.sin(i * GOLDEN) }));
  const place = (i) => {
    const r = R[i], x0 = ML + r, x1 = W - MR - r, y0 = MT + r, y1 = H - MB - r;
    P[i].x = x0 <= x1 ? clamp(P[i].x, x0, x1) : cx;
    P[i].y = y0 <= y1 ? clamp(P[i].y, y0, y1) : cy;
  };
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j, linkMap.get(pairKey(clusters[i].key, clusters[j].key))?.w || 0]);
  // one relaxation step: push overlapping clusters apart (mass = area); with attract, linked clusters pull together and all drift to the centre (large ones more)
  const relax = (attract) => {
    let worst = 0;
    for (const [i, j, w] of pairs) {
      const a = P[i], b = P[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 1e-9) { dx = 1; dy = 0; d = 1; }
      const ux = dx / d, uy = dy / d, min = R[i] + R[j] + GAP;
      if (d < min) {
        const over = min - d; worst = Math.max(worst, over);
        const mi = R[i] * R[i], mj = R[j] * R[j], si = over * mj / (mi + mj), sj = over * mi / (mi + mj);
        a.x -= ux * si; a.y -= uy * si; b.x += ux * sj; b.y += uy * sj;
      } else if (attract && w) {
        const f = Math.min(0.2, 0.03 * w) * (d - min) * 0.5;
        a.x += ux * f; a.y += uy * f; b.x -= ux * f; b.y -= uy * f;
      }
    }
    for (let i = 0; i < n; i++) {
      if (attract) { const g = 0.02 * (R[i] / rMax); P[i].x += (cx - P[i].x) * g; P[i].y += (cy - P[i].y) * g; }
      place(i);
    }
    return worst;
  };
  for (let t = 0; t < 260; t++) relax(true);
  for (let t = 0; t < 600; t++) if (relax(false) <= 0.2) break;

  // nodes: largest award at the centre of its cluster, spiral outwards, then a short overlap pass inside the cluster
  const outNodes = [];
  clusters.forEach((c, i) => {
    const m = c.items.length, Rc = R[i];
    // a very large group: its nodes shrink together so they cover at most half the cluster disc (relative sizes kept)
    const rad0 = c.items.map((it) => nodeRadius(it.award_max_usd));
    const S2 = rad0.reduce((s, r) => s + r * r, 0), cap = 0.5 * Rc * Rc;
    const rad = S2 > cap ? rad0.map((r) => Math.max(2.5, r2(r * Math.sqrt(cap / S2)))) : rad0;
    const rmax = Math.max(0, ...rad);
    const s = m > 1 ? Math.max(0, Rc - rmax - 6) / Math.sqrt(m - 1) : 0;
    const loc = c.items.map((_, k) => ({ x: s * Math.sqrt(k) * Math.cos(k * GOLDEN), y: s * Math.sqrt(k) * Math.sin(k * GOLDEN) }));
    const reach = 2 * rmax + 3; // nodes farther apart in x than this cannot overlap, so sweep by x instead of all pairs
    const ord = loc.map((_, k) => k);
    for (let t = 0; t < 60; t++) {
      let worst = 0;
      ord.sort((a, b) => loc[a].x - loc[b].x || a - b); // nearly sorted from the last pass, so this is cheap
      for (let u = 0; u < m; u++) for (let v = u + 1; v < m && loc[ord[v]].x - loc[ord[u]].x < reach; v++) {
        const p = ord[u], q = ord[v];
        let dx = loc[q].x - loc[p].x, dy = loc[q].y - loc[p].y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) { dx = 1; dy = 0; d = 1; }
        const over = rad[p] + rad[q] + 3 - d;
        if (over > 0) {
          worst = Math.max(worst, over);
          const ox = (dx / d) * over / 2, oy = (dy / d) * over / 2;
          loc[p].x -= ox; loc[p].y -= oy; loc[q].x += ox; loc[q].y += oy;
        }
      }
      for (let k = 0; k < m; k++) {
        const lim = Math.max(0, Rc - rad[k] - 4), dd = Math.sqrt(loc[k].x * loc[k].x + loc[k].y * loc[k].y);
        if (dd > lim) { const f = dd > 0 ? lim / dd : 0; loc[k].x *= f; loc[k].y *= f; }
      }
      if (worst < 0.2) break;
    }
    c.items.forEach((it, k) => outNodes.push({ id: it.id, x: r2(P[i].x + loc[k].x), y: r2(P[i].y + loc[k].y), r: rad[k], cluster: c.key, also: alsoOf.get(it.id) || [] }));
  });

  const cl = clusters.map((c, i) => ({
    key: c.key, label: c.label, name: `${trimName(c.label)} · ${c.n}`,
    meta: `${c.n} ${c.n === 1 ? 'funder' : 'funders'}${c.total ? ` · ${money(c.total)}` : ''}`,
    x: r2(P[i].x), y: r2(P[i].y), r: r2(R[i]), count: c.n, total_usd: c.total,
  }));
  placeLabels(cl, W, H, outNodes);
  return {
    width: W, height: H,
    clusters: cl,
    nodes: outNodes,
    links: [...linkMap.values()].sort((p, q) => cmp(p.a, q.a) || cmp(p.b, q.b)),
  };
}

/* cluster labels: above the halo, or below it when that spot is taken. Greedy in cluster order (largest first); sets lx, ly (top-left of the block, lx is the centre). */
const LABEL_H = 18; // one line: name and count
const trimName = (s) => (s.length > 26 ? `${s.slice(0, 25)}…` : s);
export function placeLabels(cs, W, H, nodes = []) {
  const boxes = [];
  for (const c of cs) {
    const w = Math.ceil(c.name.length * 7.4) + 8;
    const cx = c.x - w / 2, cy = c.y - LABEL_H / 2;
    // above, below, right, left of the halo, then further out and shifted up or down; the first spot with no clash wins, else the least clashing one
    const spots = [];
    for (const g of [6, 16]) spots.push([cx, c.y - c.r - g - LABEL_H], [cx, c.y + c.r + g], [c.x + c.r + g, cy], [c.x - c.r - g - w, cy]);
    for (const d of [-LABEL_H, LABEL_H]) spots.push([c.x + c.r + 6, cy + d], [c.x - c.r - 6 - w, cy + d]);
    const cands = spots.map(([x, y]) => ({ x0: clamp(x, 2, W - w - 2), y0: clamp(y, 2, H - LABEL_H - 2) }));
    // a label on another label counts 100, a node under the text 1: labels never stack if any spot is free
    const clash = (o) => 100 * boxes.filter((b) => o.x0 < b.x1 + 2 && b.x0 < o.x0 + w + 2 && o.y0 < b.y1 + 2 && b.y0 < o.y0 + LABEL_H + 2).length
      + nodes.filter((p) => {
        const nx = clamp(p.x, o.x0, o.x0 + w), ny = clamp(p.y, o.y0, o.y0 + LABEL_H);
        return (p.x - nx) ** 2 + (p.y - ny) ** 2 < (p.r + 2) ** 2;
      }).length;
    let best = cands[0], bestN = Infinity;
    for (const o of cands) { const n = clash(o); if (n < bestN) { best = o; bestN = n; if (!n) break; } }
    c.lx = r2(best.x0 + w / 2); c.ly = r2(best.y0);
    boxes.push({ x0: best.x0, x1: best.x0 + w, y0: best.y0, y1: best.y0 + LABEL_H });
  }
  return cs;
}

/* ---------- filters (the state lives in app.ui_state('galaxy')) ---------- */
export const defaultGalaxy = () => ({ groupBy: 'concept', bands: [], themes: [], types: [], ua: [], tiers: [], openOnly: false, screened: true, moreThemes: false });
// Filters inside the closed "Fit and eligibility" details. Type, size and keywords are always visible.
export const moreActive = (ui = {}) => (ui.tiers?.length || 0) + (ui.ua?.length || 0);
export function galaxyFilter(items = [], f = {}) {
  const F = { ...defaultGalaxy(), ...f };
  return (items || []).filter((it) => {
    if (!F.screened && it.status === 'rejected') return false;
    if (F.bands.length && !F.bands.includes(it.band)) return false;
    if (F.types.length && !F.types.includes(it.bucket)) return false;
    if (F.ua.length && !F.ua.includes(it.ua_eligibility)) return false;
    if (F.tiers.length && !F.tiers.includes(it.tier)) return false;
    if (F.themes.length && !it.themes.some((t) => F.themes.includes(t))) return false;
    if (F.openOnly && !it.open_calls) return false;
    return true;
  });
}
export function themeCounts(items = []) {
  const m = new Map();
  for (const it of items) for (const t of it.themes) m.set(t, (m.get(t) || 0) + 1);
  return [...m].map(([key, n]) => ({ key, label: capLabel(key), n })).sort((a, b) => b.n - a.n || cmp(a.key, b.key));
}
export function totals(items = []) {
  return { n: items.length, award: items.reduce((s, it) => s + Math.max(0, +it.award_max_usd || 0), 0) };
}

/* =====================================================================
   View (browser only). render(root, app) is idempotent; onQuery updates search classes only.
   ===================================================================== */
const NS = 'http://www.w3.org/2000/svg';
const STATE = new WeakMap();
const CHIP = {
  type: { ui: 'types', keys: () => Object.keys(BUCKETS), of: (it) => [it.bucket], label: (k) => BUCKETS[k] || k, bucket: true },
  size: { ui: 'bands', keys: () => BANDS.map(([k]) => k), of: (it) => [it.band], label: (k) => BAND_LABEL[k] || k },
  fit: { ui: 'tiers', keys: () => TIERS.map(([k]) => k), of: (it) => [it.tier], label: (k) => TIER_LABEL[k] || k },
  ua: { ui: 'ua', keys: () => UA_KEYS, of: (it) => [it.ua_eligibility], label: (k) => UA[k] || k },
};

function h(t, a = {}, ...kids) {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = String(v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}
function sv(t, a = {}, ...kids) {
  const e = document.createElementNS(NS, t);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = String(v); else e.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const uiOf = (app) => {
  const u = app.ui_state('galaxy', defaultGalaxy());
  for (const k of ['bands', 'themes', 'types', 'ua', 'tiers']) if (!Array.isArray(u[k])) u[k] = [];
  if (!GROUPS.some(([k]) => k === u.groupBy)) u.groupBy = 'concept';
  u.openOnly = !!u.openOnly; u.screened = u.screened !== false; u.moreThemes = !!u.moreThemes;
  return u;
};
const statusText = (it) => (it.tracked ? `Tracked · ${STAGE_LABEL[it.stage] || it.stage}` : it.status === 'candidate' ? 'Candidate' : 'Screened out');

export function render(root, app) {
  let st = STATE.get(root);
  if (!st || !root.querySelector('.gx')) { st = build(root); STATE.set(root, st); }
  st.app = app;
  if (!app.reg() && st.regState === 'ready') st.regState = 'idle'; // the shell dropped the cached registry (lock or unlock): load it again
  if (!app.reg() && st.regState === 'idle') loadRegistry(st, false);
  update(st);
}
export function onQuery(root, app) {
  const st = STATE.get(root);
  if (!st || !root.querySelector('.gx') || !st.layout) return render(root, app);
  st.app = app;
  applySearch(st);
}

/* ---------- build: the static skeleton; everything dynamic is updated in place ---------- */
function build(root) {
  const old = STATE.get(root);
  if (old?.ro) old.ro.disconnect();
  root.replaceChildren();
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const st = {
    root, app: null, src: {}, items: [], byId: new Map(), filtered: [], hits: null,
    regState: 'idle', regPromise: null, layout: null, nodeLayout: new Map(), clusterLayout: new Map(),
    nodeEls: new Map(), clusterEls: new Map(), rowEls: new Map(), chipEls: new Map(), kwSig: '', kwCounts: new Map(),
    openCl: new Set(), seenCl: new Set(), more: new Set(), hover: null, focused: null, focusId: null, iso: null,
    k: 1, tx: 0, ty: 0, canvasW: 0, canvasH: 0, raf: 0, hitPx: coarse ? 22 : 16, ro: null,
  };
  st.groupSeg = h('div', { class: 'seg gx-seg', role: 'group', 'aria-label': 'Group funders by' },
    GROUPS.map(([k, label]) => h('button', { type: 'button', 'data-group': k, 'aria-pressed': 'false', onclick: () => { uiOf(st.app).groupBy = k; update(st); } }, label)));
  st.count = h('p', { class: 'gx-count', role: 'status' });
  const top = h('div', { class: 'gx-top' }, st.groupSeg, st.count);

  const chipRow = (group, label, bucket) => {
    const cfg = CHIP[group], map = new Map();
    st.chipEls.set(group, map);
    return h('div', { class: `gx-fg${bucket ? ' gx-legend' : ''}`, role: 'group', 'aria-label': label },
      h('span', { class: 'gx-fl', 'aria-hidden': 'true', text: label }),
      h('div', { class: 'gx-chips' }, cfg.keys().map((k) => {
        const n = h('b', { class: 'gx-n', text: '0' });
        const btn = h('button', { type: 'button', class: `gx-chip${cfg.bucket ? ` b-${k}` : ''}`, 'aria-pressed': 'false', 'data-key': k, onclick: () => toggleFilter(st, group, k) },
          cfg.bucket ? bucketDot(k) : null, h('span', { text: cfg.label(k) }), n);
        map.set(k, { el: btn, n });
        return btn;
      })));
  };
  const typeRow = chipRow('type', 'Organization type', true);
  const sizeRow = chipRow('size', 'Funding size');
  const fitRow = chipRow('fit', 'Fit');
  const uaRow = chipRow('ua', 'Eligibility');
  const toggle = (label, prop) => h('button', { type: 'button', class: 'gx-chip gx-toggle', 'aria-pressed': 'false', onclick: () => { const u = uiOf(st.app); u[prop] = !u[prop]; update(st); } }, h('span', { text: label }));
  st.toggles = { openOnly: toggle('Open calls only', 'openOnly'), screened: toggle('Include screened out', 'screened') };
  const toggles = h('div', { class: 'gx-fg', role: 'group', 'aria-label': 'Show' }, st.toggles.openOnly, st.toggles.screened);
  st.kw = h('div', { class: 'gx-chips' });
  st.kwMore = h('button', { type: 'button', class: 'linkbtn gx-kwmore', hidden: true, onclick: () => { const u = uiOf(st.app); u.moreThemes = !u.moreThemes; update(st); } });
  st.kwCount = h('span', { class: 'gx-fcount', hidden: true }); // selected keywords, so a selection past the phone rail's edge still shows
  const kwRow = h('div', { class: 'gx-fg gx-kwrow', role: 'group', 'aria-label': 'Keywords' }, h('span', { class: 'gx-fl', 'aria-hidden': 'true' }, h('span', { text: 'Keywords' }), st.kwCount), st.kw, st.kwMore);
  st.note = h('div', { class: 'gx-note', role: 'status', hidden: true });

  st.svg = sv('svg', { class: 'gx-svg', role: 'group', 'aria-label': 'Funder map. The list below holds the same funders as text.' });
  st.svg.append(sv('defs', {}, sv('pattern', { id: 'gx-dots', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }, sv('circle', { class: 'gx-dot-bg', cx: 1, cy: 1, r: 0.9 }))));
  st.svg.append(sv('rect', { class: 'gx-bg', x: 0, y: 0, width: '100%', height: '100%', fill: 'url(#gx-dots)' }));
  st.world = sv('g', { class: 'gx-world' });
  st.layers = { orbit: sv('g', { class: 'gx-orbits' }), halo: sv('g', { class: 'gx-halos' }), links: sv('g', { class: 'gx-links' }), nodes: sv('g', { class: 'gx-nodes' }), labels: sv('g', { class: 'gx-labels' }) };
  st.world.append(st.layers.orbit, st.layers.halo, st.layers.links, st.layers.nodes, st.layers.labels);
  st.svg.append(st.world);
  st.card = h('div', { class: 'gx-card', 'aria-hidden': 'true', hidden: true });
  st.reset = h('button', { type: 'button', class: 'btn btn--sm gx-reset', hidden: true, onclick: () => resetView(st) }, 'Show all groups');
  const zoomOut = h('button', { type: 'button', class: 'gx-zbtn', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => zoomBy(st, 1 / 1.3) }, '−');
  const zoomIn = h('button', { type: 'button', class: 'gx-zbtn', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => zoomBy(st, 1.3) }, '+');
  const tools = h('div', { class: 'gx-tools' }, st.reset, h('div', { class: 'gx-zoom', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomIn));
  st.empty = h('div', { class: 'gx-empty', hidden: true });
  st.canvas = h('div', { class: 'gx-canvas' }, st.svg, st.card, tools, st.empty);
  st.alt = h('div', { class: 'gx-alt' });

  st.fcount = h('span', { class: 'gx-fcount', hidden: true });
  const line = h('div', { class: 'gx-line' }, typeRow, toggles); // one row on desktop, wraps on phone
  const quick = h('div', { class: 'gx-quick' }, sizeRow, kwRow); // the visible quick filters
  const more = h('details', { class: 'gx-moref' },
    h('summary', {}, h('span', { text: 'Fit and eligibility' }), st.fcount),
    h('div', { class: 'gx-filters' }, fitRow, uaRow));
  root.append(h('section', { class: 'gx', 'data-gx': '' }, top, line, quick, more, st.note, st.canvas, keyLegend(), st.alt));

  svgListeners(st);
  if (typeof ResizeObserver === 'function') {
    st.ro = new ResizeObserver(() => { if (st.raf) return; st.raf = requestAnimationFrame(() => { st.raf = 0; relayout(st); }); });
    st.ro.observe(st.canvas);
  }
  return st;
}

function keyLegend() {
  const item = (label, ...kids) => h('span', { class: 'gx-kitem' }, sv('svg', { class: 'gx-kg', viewBox: '-16 -12 32 24', 'aria-hidden': 'true' }, ...kids), h('span', { text: label }));
  const node = (cls, ...kids) => sv('g', { class: `gx-node ${cls}` }, ...kids);
  return h('div', { class: 'gx-key', 'aria-label': 'How to read the map' },
    item('Tracked', node('', sv('circle', { class: 'gx-dot', r: 6 }))),
    item('Screened out', node('is-screened', sv('circle', { class: 'gx-dot', r: 6 }))),
    item('Candidate', node('is-candidate', sv('circle', { class: 'gx-dot', r: 6 }))),
    item('In pipeline', node('is-pipe', sv('circle', { class: 'gx-dot', r: 5 }), sv('path', { class: 'gx-pipe', d: 'M7,-10 L10,-7 L7,-4 L4,-7 Z' }))),
    item('Prime fit', node('', sv('circle', { class: 'gx-dot', r: 5 }), sv('circle', { class: 'gx-ring ring-prime', r: 9 }))),
    item('Strong fit', node('', sv('circle', { class: 'gx-dot', r: 5 }), sv('circle', { class: 'gx-ring ring-strong', r: 9 }))),
    item('Size: published award, log scale (smallest if none)', node('', sv('circle', { class: 'gx-dot', cx: -10, r: R_MIN }), sv('circle', { class: 'gx-dot', cx: 0, r: 8 }), sv('circle', { class: 'gx-dot', cx: 10, r: R_MAX - 2 }))));
}

/* ---------- state plumbing ---------- */
function loadRegistry(st, force) {
  if (st.regPromise) return;
  st.regState = 'loading';
  st.regPromise = Promise.resolve().then(() => st.app.loadRegistry(force)).then(
    () => { st.regState = st.app.reg() ? 'ready' : 'failed'; },
    () => { st.regState = 'failed'; },
  ).then(() => {
    st.regPromise = null;
    if (STATE.get(st.root) === st && st.app) update(st);
  });
  update(st);
}
function toggleFilter(st, group, key) {
  const list = uiOf(st.app)[group === 'kw' ? 'themes' : CHIP[group].ui];
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1); else list.push(key);
  update(st);
}
function clearFilters(st) {
  const u = uiOf(st.app);
  Object.assign(u, { bands: [], themes: [], types: [], ua: [], tiers: [], openOnly: false, screened: true });
  update(st);
}

function update(st) {
  const app = st.app;
  if (!app) return;
  const ui = uiOf(app);
  const reg = app.reg();
  if (st.src.rows !== app.S.rows || st.src.reg !== (reg || null) || st.src.rub !== app.rubric()) {
    st.src = { rows: app.S.rows, reg: reg || null, rub: app.rubric() };
    st.items = galaxyItems(app.S.rows, reg, { rubric: app.rubric() });
    st.byId = new Map(st.items.map((it) => [it.id, it]));
  }
  if (reg) st.regState = 'ready';
  st.filtered = galaxyFilter(st.items, ui);
  paintControls(st, ui);
  paintNote(st);
  const w = st.canvas.clientWidth, hgt = st.canvas.clientHeight;
  if (w >= 40 && hgt >= 40) layoutAndDraw(st, ui, w, hgt);
  renderList(st);
  applySearch(st);
  const none = !st.filtered.length;
  st.empty.hidden = !none;
  if (none) {
    st.empty.replaceChildren(
      h('p', { text: st.items.length ? 'No funders match these filters.' : 'No funders to map yet.' }),
      st.items.length ? h('button', { type: 'button', class: 'btn btn--sm', onclick: () => clearFilters(st) }, 'Clear filters') : null);
  }
}

function relayout(st) {
  if (!st.app || !st.canvas.isConnected) { if (st.ro) st.ro.disconnect(); return; }
  const w = st.canvas.clientWidth, hgt = st.canvas.clientHeight;
  if (w < 40 || hgt < 40 || (w === st.canvasW && hgt === st.canvasH)) return;
  layoutAndDraw(st, uiOf(st.app), w, hgt);
  applySearch(st);
}

function layoutAndDraw(st, ui, w, hgt) {
  st.layout = galaxyLayout(st.filtered, { groupBy: ui.groupBy, width: w, height: hgt });
  st.canvasW = w; st.canvasH = hgt;
  st.nodeLayout = new Map(st.layout.nodes.map((n) => [n.id, n]));
  st.clusterLayout = new Map(st.layout.clusters.map((c) => [c.key, c]));
  if (st.iso && !st.clusterLayout.has(st.iso)) { st.iso = null; st.k = 1; st.tx = 0; st.ty = 0; }
  if (st.iso) focusView(st, st.iso);
  drawMap(st);
  applyTransform(st);
  refreshSel(st);
}

/* ---------- drawing ---------- */
function drawMap(st) {
  const L = st.layout;
  st.svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
  st.svg.setAttribute('width', L.width); st.svg.setAttribute('height', L.height);
  if (!st.orbits) {
    st.orbits = [sv('circle', { class: 'gx-orbit', 'data-f': 0.34 }), sv('circle', { class: 'gx-orbit', 'data-f': 0.6 })];
    st.layers.orbit.append(...st.orbits);
  }
  const m = Math.min(L.width, L.height);
  for (const o of st.orbits) { o.setAttribute('cx', L.width / 2); o.setAttribute('cy', L.height / 2); o.setAttribute('r', r2(m * Number(o.dataset.f))); }

  const keepC = new Set();
  for (const c of L.clusters) {
    keepC.add(c.key);
    let e = st.clusterEls.get(c.key);
    if (!e) { e = makeCluster(st, c.key); st.clusterEls.set(c.key, e); }
    e.halo.style.transform = `translate(${c.x}px, ${c.y}px)`;
    e.circle.setAttribute('r', c.r);
    e.at = `translate(${c.lx}px, ${c.ly}px)`;
    e.name.textContent = c.name;
    e.label.setAttribute('aria-label', `${c.label}: ${c.meta}. Focus this group`);
  }
  for (const [key, e] of st.clusterEls) if (!keepC.has(key)) { e.halo.remove(); e.label.remove(); st.clusterEls.delete(key); }

  const keepN = new Set();
  L.nodes.forEach((n, idx) => {
    keepN.add(n.id);
    const it = st.byId.get(n.id);
    if (!it) return;
    let e = st.nodeEls.get(n.id);
    if (!e) {
      e = makeNode(st, it);
      e.g.style.setProperty('--d', `${Math.min(idx, 40) * 14}ms`);
      st.nodeEls.set(n.id, e);
      st.layers.nodes.append(e.g);
    }
    e.g.style.transform = `translate(${n.x}px, ${n.y}px)`;
    e.ring.setAttribute('class', `gx-ring ring-${it.tier}`);
    e.ring.setAttribute('r', r2(n.r + 4.5));
    e.dot.setAttribute('r', n.r);
    e.focus.setAttribute('r', r2(n.r + 7));
    const pc = r2(n.r * 0.7 + 3), s = 3.4;
    e.pipe.setAttribute('d', `M${pc},${r2(-pc - s)} L${r2(pc + s)},${-pc} L${pc},${r2(-pc + s)} L${r2(pc - s)},${-pc} Z`);
    e.g.classList.toggle('is-pipe', it.inPipeline);
    e.g.setAttribute('aria-label', nodeLabel(st, it));
  });
  for (const [id, e] of st.nodeEls) {
    if (keepN.has(id)) continue;
    e.g.remove(); st.nodeEls.delete(id);
    if (st.focused === id) st.focused = null;
    if (st.hover === id) st.hover = null;
  }
  if (st.focusId == null || !st.nodeLayout.has(st.focusId)) st.focusId = L.nodes[0]?.id ?? null;
  for (const [id, e] of st.nodeEls) e.g.setAttribute('tabindex', id === st.focusId ? '0' : '-1');
}

function nodeLabel(st, it) {
  const fit = it.fit_score != null ? `fit ${it.fit_score}, ${it.tierLabel}` : UNSCORED.toLowerCase();
  const award = it.award_max_usd != null || it.award_min_usd != null ? amountRange(it) : 'no published amount';
  return `${it.name}. ${BUCKETS[it.bucket]}. ${award}. ${fit}. ${statusText(it)}${it.queued ? '. In agent queue' : ''}.`;
}

function makeCluster(st, key) {
  const circle = sv('circle', { class: 'gx-halo', r: 0 });
  const halo = sv('g', { class: 'gx-cluster', 'data-key': key }, circle);
  const name = sv('text', { class: 'gx-lname', 'text-anchor': 'middle', y: 13 });
  const label = sv('g', { class: 'gx-label', role: 'button', tabindex: '0', 'data-key': key }, name);
  label.addEventListener('click', () => isolate(st, key));
  label.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); isolate(st, key); } });
  st.layers.halo.append(halo);
  st.layers.labels.append(label);
  return { halo, circle, label, name };
}

function makeNode(st, it) {
  const hit = sv('circle', { class: 'gx-hit', r: 10 });
  const ring = sv('circle', { class: 'gx-ring' });
  const dot = sv('circle', { class: 'gx-dot', r: 5 });
  const pipe = sv('path', { class: 'gx-pipe', d: 'M0,0' });
  const focus = sv('circle', { class: 'gx-focus', r: 10 });
  const g = sv('g', { class: `gx-node b-${it.bucket}${it.status === 'rejected' ? ' is-screened' : ''}${it.status === 'candidate' ? ' is-candidate' : ''}`, role: 'button', tabindex: '-1', 'data-id': it.id }, hit, ring, dot, pipe, focus);
  g.classList.add('is-new');
  g.addEventListener('animationend', () => g.classList.remove('is-new'), { once: true });
  g.addEventListener('pointerenter', () => { st.hover = it.id; refreshSel(st); });
  g.addEventListener('pointerleave', () => { if (st.hover === it.id) st.hover = null; refreshSel(st); });
  g.addEventListener('focus', () => { st.focused = it.id; st.focusId = it.id; refreshSel(st); });
  g.addEventListener('blur', () => { if (st.focused === it.id) st.focused = null; refreshSel(st); });
  g.addEventListener('click', () => { st.app.openDrawer(it.id); });
  g.addEventListener('keydown', (ev) => nodeKey(st, it.id, ev));
  return { g, hit, ring, dot, pipe, focus, id: it.id };
}

function svgListeners(st) {
  // nothing global: each node and cluster label handles its own events
  st.svg.addEventListener('pointerleave', () => { st.hover = null; refreshSel(st); });
}

/* ---------- selection: the card, and faint links from a node to the other concepts it carries ---------- */
function refreshSel(st) {
  const id = st.hover ?? st.focused ?? null;
  const n = id != null ? st.nodeLayout.get(id) : null;
  const it = n ? st.byId.get(id) : null;
  st.layers.links.replaceChildren();
  if (!it) { st.card.hidden = true; return; }
  if (n.also?.length) {
    for (const k of n.also) {
      const c = st.clusterLayout.get(k);
      if (!c) continue;
      st.layers.links.append(sv('line', { class: 'gx-link', x1: n.x, y1: n.y, x2: c.x, y2: c.y }), sv('circle', { class: 'gx-sat', cx: c.x, cy: c.y, r: 4 }));
    }
  }
  const now = st.app.S.now || new Date();
  const dl = it.deadline ? fmtDate(it.deadline) : '';
  const cd = it.deadline ? countdown(daysLeft(it.deadline, now)) : '';
  st.card.replaceChildren(
    h('p', { class: 'gx-card-name', text: it.name }),
    it.program ? h('p', { class: 'gx-card-sub', text: it.program }) : null,
    h('dl', { class: 'gx-dl' },
      h('dt', { text: 'Type' }), h('dd', { text: BUCKETS[it.bucket] }),
      h('dt', { text: 'Award' }), h('dd', { text: amountRange(it) }),
      h('dt', { text: 'Fit' }), h('dd', { text: it.fit_score != null ? `${it.fit_score} · ${it.tierLabel}` : UNSCORED }),
      h('dt', { text: 'Deadline' }), h('dd', { text: dl ? (cd ? `${dl} · ${cd}` : dl) : (it.cycle ? 'Rolling or no fixed date' : 'None listed') }),
      h('dt', { text: 'Status' }), h('dd', {}, statusText(it), it.queued ? statusChip('queue') : null)));
  st.card.hidden = false;
  const cw = st.card.offsetWidth, ch = st.card.offsetHeight, cwid = st.canvas.clientWidth;
  const px = st.tx + n.x * st.k, py = st.ty + n.y * st.k, pr = n.r * st.k;
  const left = clamp(px - cw / 2, 8, cwid - cw - 8);
  let top = py - pr - 12 - ch;
  if (top < 8) top = py + pr + 12;
  st.card.style.left = `${Math.round(left)}px`;
  st.card.style.top = `${Math.round(top)}px`;
}

/* ---------- search: dims the rest, never rebuilds the layout ---------- */
function applySearch(st) {
  const app = st.app;
  const active = app.q().length > 0;
  let hits = 0;
  for (const [id, e] of st.nodeEls) {
    const hit = active && app.matchQ(st.byId.get(id)?.hay || '');
    if (hit) hits++;
    e.g.classList.toggle('is-hit', hit);
    e.g.classList.toggle('is-dim', active && !hit);
  }
  for (const [id, li] of st.rowEls) li.classList.toggle('is-dim', active && !app.matchQ(st.byId.get(id)?.hay || ''));
  st.hits = active ? hits : null;
  paintCount(st);
}

function paintCount(st) {
  const t = totals(st.filtered);
  const parts = [`${t.n} of ${st.items.length} funders`, t.award ? `${money(t.award)} in published awards` : 'no published awards in view'];
  if (st.hits != null) parts.push(`${st.hits} match "${String(st.app.S.F?.q || '').trim()}"`);
  st.count.textContent = parts.join(' · ');
}

/* ---------- controls ---------- */
function paintControls(st, ui) {
  st.groupSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.group === ui.groupBy)));
  const active = moreActive(ui);
  st.fcount.hidden = !active;
  st.fcount.textContent = `${active} active`;
  const tally = new Map();
  for (const it of st.items) for (const g of ['type', 'size', 'fit', 'ua']) {
    const m = tally.get(g) || new Map(); tally.set(g, m);
    for (const k of CHIP[g].of(it)) m.set(k, (m.get(k) || 0) + 1);
  }
  for (const g of ['type', 'size', 'fit', 'ua']) {
    const sel = ui[CHIP[g].ui];
    for (const [k, c] of st.chipEls.get(g) || []) {
      c.el.setAttribute('aria-pressed', String(sel.includes(k)));
      c.n.textContent = String(tally.get(g)?.get(k) || 0);
    }
  }
  syncKeywords(st, ui);
  st.toggles.openOnly.setAttribute('aria-pressed', String(ui.openOnly));
  st.toggles.screened.setAttribute('aria-pressed', String(ui.screened));
}

function syncKeywords(st, ui) {
  const counts = themeCounts(st.items);
  st.kwCounts = new Map(counts.map((t) => [t.key, t.n]));
  ui.themes = ui.themes.filter((t) => st.kwCounts.has(t));
  const shown = new Set((ui.moreThemes ? counts : counts.slice(0, KW_TOP)).map((t) => t.key));
  for (const t of ui.themes) shown.add(t);
  const list = counts.filter((t) => shown.has(t.key));
  const sig = list.map((t) => t.key).join('|');
  if (sig !== st.kwSig) {
    st.kwSig = sig;
    st.chipEls.set('kw', new Map());
    st.kw.replaceChildren(...list.map((t) => {
      const n = h('b', { class: 'gx-n', text: String(t.n) });
      const btn = h('button', { type: 'button', class: 'gx-chip', 'aria-pressed': 'false', 'data-key': t.key, onclick: () => toggleFilter(st, 'kw', t.key) }, h('span', { text: t.label }), n);
      st.chipEls.get('kw').set(t.key, { el: btn, n });
      return btn;
    }));
  }
  for (const [k, c] of st.chipEls.get('kw') || []) c.el.setAttribute('aria-pressed', String(ui.themes.includes(k)));
  st.kwMore.hidden = counts.length <= KW_TOP;
  st.kwMore.textContent = ui.moreThemes ? 'Fewer keywords' : `All ${counts.length} keywords`;
  st.kwMore.setAttribute('aria-expanded', String(!!ui.moreThemes));
  st.kw.classList.toggle('is-all', !!ui.moreThemes); // on phones the short keyword list is a scrolling rail; the full list wraps
  st.kwCount.hidden = !ui.themes.length;
  st.kwCount.textContent = `${ui.themes.length} active`;
}

function paintNote(st) {
  const s = st.regState;
  st.note.hidden = s !== 'loading' && s !== 'failed';
  st.note.replaceChildren();
  if (s === 'loading') st.note.append(h('span', { text: 'Loading screened-out and candidate funders.' }));
  if (s === 'failed') st.note.append(
    h('span', { text: 'Screened-out and candidate funders could not be loaded. Showing tracked funders only. ' }),
    h('button', { type: 'button', class: 'linkbtn', onclick: () => loadRegistry(st, true) }, 'Try again'));
}

/* ---------- zoom and isolate ---------- */
function focusView(st, key) {
  const c = st.clusterLayout.get(key);
  if (!c) return;
  const W = st.layout.width, H = st.layout.height;
  st.k = clamp((0.42 * Math.min(W, H)) / c.r, 1, 3.6);
  st.tx = W / 2 - c.x * st.k;
  st.ty = H / 2 - c.y * st.k;
}
function isolate(st, key) {
  if (st.iso === key) { resetView(st); return; }
  if (!st.clusterLayout.has(key)) return;
  st.iso = key;
  st.hover = null;
  focusView(st, key);
  applyTransform(st);
  refreshSel(st);
}
function zoomBy(st, f) {
  if (!st.layout) return;
  const W = st.layout.width, H = st.layout.height;
  const nk = clamp(st.k * f, 0.8, 3.6), r = nk / st.k;
  st.tx = W / 2 - (W / 2 - st.tx) * r;
  st.ty = H / 2 - (H / 2 - st.ty) * r;
  st.k = nk;
  applyTransform(st);
  refreshSel(st);
}
function resetView(st) {
  st.iso = null; st.k = 1; st.tx = 0; st.ty = 0;
  applyTransform(st);
  refreshSel(st);
}
function applyTransform(st) {
  if (!st.layout) return;
  st.world.style.transform = `translate(${r2(st.tx)}px, ${r2(st.ty)}px) scale(${r2(st.k)})`;
  for (const [id, e] of st.nodeEls) {
    const n = st.nodeLayout.get(id);
    if (!n) continue;
    e.hit.setAttribute('r', r2(Math.max(n.r + 4, st.hitPx / st.k)));
    e.g.classList.toggle('is-away', !!st.iso && n.cluster !== st.iso);
  }
  for (const [key, e] of st.clusterEls) {
    const away = !!st.iso && key !== st.iso;
    e.halo.classList.toggle('is-away', away);
    e.label.classList.toggle('is-away', away);
    // labels keep their screen size when the map zooms
    e.label.style.transform = `${e.at} scale(${r2(1 / st.k)})`;
  }
  st.reset.hidden = !(st.iso || Math.abs(st.k - 1) > 0.01 || st.tx || st.ty);
}

/* ---------- keyboard: arrows move between nodes, Enter opens the drawer ---------- */
function nodeKey(st, id, ev) {
  const k = ev.key;
  if (k === 'Enter' || k === ' ') { ev.preventDefault(); st.app.openDrawer(id); return; }
  if (k === 'Escape') {
    ev.preventDefault();
    if (st.iso || st.k !== 1) resetView(st); else st.nodeEls.get(id)?.g.blur();
    return;
  }
  if (k === 'Home' || k === 'End') {
    ev.preventDefault();
    const ns = st.layout?.nodes || [];
    focusNode(st, (k === 'Home' ? ns[0] : ns[ns.length - 1])?.id);
    return;
  }
  if (/^Arrow(Up|Down|Left|Right)$/.test(k)) {
    ev.preventDefault();
    moveFocus(st, id, k);
  }
}
function moveFocus(st, fromId, key) {
  const cur = st.nodeLayout.get(fromId);
  if (!cur) return;
  let best = null, score = Infinity;
  for (const n of st.layout.nodes) {
    if (n.id === fromId) continue;
    const dx = n.x - cur.x, dy = n.y - cur.y;
    const along = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
    const across = key === 'ArrowRight' || key === 'ArrowLeft' ? dy : dx;
    if (along <= 0) continue;
    const s = along + 2 * Math.abs(across);
    if (s < score) { score = s; best = n; }
  }
  if (best) focusNode(st, best.id);
}
function focusNode(st, id) {
  if (id == null) return;
  st.focusId = id;
  for (const [nid, e] of st.nodeEls) e.g.setAttribute('tabindex', nid === id ? '0' : '-1');
  st.nodeEls.get(id)?.g.focus({ preventScroll: true });
  panToNode(st, id);
}
// zoomed in and the focused node is off-screen: centre the map on it, so arrow keys never land out of view
function panToNode(st, id) {
  const n = st.nodeLayout.get(id);
  if (!n || st.k <= 1) return;
  const x = st.tx + n.x * st.k, y = st.ty + n.y * st.k, m = 40;
  if (x >= m && x <= st.canvasW - m && y >= m && y <= st.canvasH - m) return;
  st.tx = st.canvasW / 2 - n.x * st.k;
  st.ty = st.canvasH / 2 - n.y * st.k;
  applyTransform(st);
}

/* ---------- text alternative: the same funders per group, with progressive disclosure ---------- */
function renderList(st) {
  const L = st.layout;
  st.rowEls = new Map();
  if (!L) { st.alt.replaceChildren(); return; }
  const byCl = new Map();
  for (const n of L.nodes) (byCl.get(n.cluster) || byCl.set(n.cluster, []).get(n.cluster)).push(n);
  const blocks = L.clusters.map((c) => {
    if (!st.seenCl.has(c.key)) { st.seenCl.add(c.key); if (c.count <= 5) st.openCl.add(c.key); }
    const items = (byCl.get(c.key) || []).map((n) => st.byId.get(n.id)).filter(Boolean);
    const expanded = st.more.has(c.key);
    const shown = expanded ? items : items.slice(0, ROWS_FIRST);
    const det = h('details', { class: 'gx-cl', open: st.openCl.has(c.key) },
      h('summary', {}, h('span', { class: 'gx-cl-name', text: c.label }),
        h('span', { class: 'gx-cl-meta', text: `${c.count} · ${c.total_usd ? money(c.total_usd) : 'no published awards'}` })),
      h('ul', { class: 'gx-rows' }, shown.map((it) => rowEl(st, it))),
      items.length > ROWS_FIRST ? h('button', { type: 'button', class: 'linkbtn gx-more', onclick: () => { if (expanded) st.more.delete(c.key); else st.more.add(c.key); renderList(st); applySearch(st); } },
        expanded ? 'Show fewer' : `Show ${items.length - ROWS_FIRST} more`) : null);
    det.addEventListener('toggle', () => { if (det.open) st.openCl.add(c.key); else st.openCl.delete(c.key); });
    return det;
  });
  st.alt.replaceChildren(h('h2', { class: 'gx-h', text: 'The same funders as text' }),
    ...(blocks.length ? blocks : [h('p', { class: 'sub', text: 'No funders match these filters.' })]));
}
function rowEl(st, it) {
  const li = h('li', { class: 'gx-row' },
    h('button', { type: 'button', class: 'linkbtn gx-rn', onclick: () => st.app.openDrawer(it.id) }, it.name),
    h('span', { class: 'gx-rt' }, bucketDot(it.bucket), h('span', { text: BUCKETS[it.bucket] })),
    h('span', { class: 'gx-ra', text: amountRange(it) }),
    h('span', { class: 'gx-rf', text: it.fit_score != null ? `Fit ${it.fit_score} · ${it.tierLabel}` : UNSCORED }),
    h('span', { class: 'gx-rs' }, statusChip(it.status), it.queued ? statusChip('queue') : null, it.tracked && it.stage !== 'new' ? stateChip(it.stage, STAGE_LABEL[it.stage]) : null));
  st.rowEls.set(it.id, li);
  return li;
}

// Deadline horizon: one dot per dated funder on a time axis, shaded band = closes before the minimum lead time.
// Shared by the Radar page and the Insights view. Feed text only reaches the page through setAttribute/textContent.
import { dayNum, todayISO, countdown, fmtDate, daysLeft, BUCKETS } from '../dashboard.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a = {}, ...k) => { const e = document.createElementNS(NS, t); for (const [n, v] of Object.entries(a)) if (v != null && v !== false) e.setAttribute(n, v === true ? '' : v); for (const c of k.flat()) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c); return e; };
export const EMPTY = 'No dated deadlines in this selection';
const D0 = -21, D1 = 365, P = 12, STEP = 11, MIN_ROWS = 7, MAX_ROWS = 9; // 7 to 9 dot rows keep the chart 127 to 149px tall

// Pure geometry (runs in node). rows carry _days (the page recomputes it from the feed every render).
export function horizonLayout(rows, { w = 600, minDays = 14 } = {}) {
  const items = rows.filter((r) => r._days != null && r._days >= D0 && r._days <= D1).sort((a, b) => a._days - b._days);
  const xs = (d) => P + ((d - D0) / (D1 - D0)) * (w - 2 * P), cols = new Map();
  // shortcut: a column fuller than MAX_ROWS spills right by one column (about 5 days off); upgrade to a density strip if feeds grow far past 100 dated funders
  const pts = items.map((r) => { let c = Math.round(xs(r._days) / STEP); while ((cols.get(c) || 0) >= MAX_ROWS) c++; const n = cols.get(c) || 0; cols.set(c, n + 1); return { r, x: c * STEP, n }; });
  const rowsN = Math.min(MAX_ROWS, Math.max(MIN_ROWS, ...pts.map((p) => p.n + 1))), ay = 24 + rowsN * STEP;
  return { items, pts, xs, ay, H: ay + 26, minDays };
}

// Dated unverified calls (feed opportunities with vet_status candidate) of the funders in view, as extra hollow points.
// The funder's own deadline ignores them until a discovery pass confirms them; a call on the funder's own date adds no dot.
export function unverifiedPoints(rows, opps, now = new Date()) {
  const by = new Map((rows || []).map((r) => [r.id, r]));
  return (opps || []).filter((o) => o.vet_status === 'candidate' && o.deadline && by.has(o.funder_id) && by.get(o.funder_id).deadline !== o.deadline)
    .map((o) => { const r = by.get(o.funder_id); return { id: r.id, name: r.name, title: o.title, bucket: r.bucket, deadline: o.deadline, _days: daysLeft(o.deadline, now), _uv: true }; });
}

const monthStarts = (now) => { const out = [], t0 = dayNum(todayISO(now)), d = new Date(t0 * 864e5); let y = d.getUTCFullYear(), m = d.getUTCMonth(); for (let i = 0; i < 14; i++, m++) { const n = Date.UTC(y, m, 1) / 864e5 - t0; if (n >= D0 && n <= D1) out.push([n, new Date(Date.UTC(y, m, 1))]); } return out; };

// rows: normalized funders. Returns an element (svg, or a one-line empty note). onOpen(id) opens the funder's details.
export function horizon(rows, { w = 600, now = new Date(), minDays = 14, onOpen = () => {} } = {}) {
  const { items, pts, xs, ay, H } = horizonLayout(rows, { w, minDays });
  if (!items.length) { const p = document.createElement('p'); p.className = 'hz-empty'; p.textContent = EMPTY; return p; }
  const next = items.find((r) => r._days >= 0), nu = items.filter((r) => r._uv).length, nf = items.length - nu;
  const svg = sv('svg', { class: 'viz hz', viewBox: `0 0 ${w} ${H}`, width: w, role: 'group', 'aria-label': `Deadlines over the next 12 months: ${nf} ${nf === 1 ? 'funder' : 'funders'}${nu ? `, ${nu} unverified ${nu === 1 ? 'call' : 'calls'}` : ''}${next ? `, first ${next.name}, ${countdown(next._days)}` : ''}.` });
  svg.append(sv('rect', { class: 'cut', x: xs(0), y: 14, width: xs(minDays) - xs(0), height: ay - 14 }), sv('line', { class: 'axis', x1: P, x2: w - P, y1: ay, y2: ay }));
  monthStarts(now).forEach(([d, dt], i) => svg.append(sv('line', { class: 'axis', x1: xs(d), x2: xs(d), y1: ay, y2: ay + 5 }), i % (w < 600 ? 3 : 1) === 0 && xs(d) + 24 < w ? sv('text', { x: xs(d) + 2, y: ay + 18 }, dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }) + (dt.getUTCMonth() === 0 ? ` '${String(dt.getUTCFullYear()).slice(2)}` : '')) : null));
  svg.append(sv('line', { class: 'today', x1: xs(0), x2: xs(0), y1: 14, y2: ay }), sv('text', { class: 'ink', x: xs(0) + 4, y: 10 }, 'Today', sv('tspan', { class: 'mu' }, `  ${minDays}-day cutoff`)));
  for (const p of pts) {
    const r = p.r, when = r.deadline ? `${fmtDate(r.deadline)}, ${countdown(r._days)}` : countdown(r._days), what = r._uv ? `${r.name}, unverified call: ${r.title}` : r.name;
    const c = sv('circle', { class: 'dot' + (r._uv ? ' uv' : r._dq ? ' dq' : ''), cx: p.x, cy: ay - 8 - p.n * STEP, r: 4.6, style: `--c:var(--b-${r.bucket in BUCKETS ? r.bucket : 'tracker'})`, 'data-id': r.id, tabindex: 0, role: 'button', 'aria-label': `${what}, ${when}. Press Enter for details.` }, sv('title', {}, `${what}\n${when}`));
    c.addEventListener('click', () => onOpen(r.id)); c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.id); } });
    svg.append(c);
  }
  return svg;
}

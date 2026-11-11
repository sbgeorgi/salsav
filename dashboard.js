/* SALSAV Funding radar - pure logic (no DOM at import; every date function takes `now`). */
export const TZ = 'America/Phoenix';
export const BUCKETS = {
  us_federal: 'US federal', intl_dev: 'International development', state_regional: 'State & regional',
  private_sector: 'Private sector', foundation_ngo: 'Foundations & NGOs', tracker: 'Trackers',
};
export const UA = { eligible: 'Direct', eligible_with_partner: 'Needs partner', invitation_only: 'Invitation only', unknown: 'Unknown' };
export const STATES = ['new', 'reviewing', 'applying', 'submitted', 'skip'];
export const BANDS = [['unverified', 'Unverified'], ['lt500', 'Up to $500k'], ['500k1m', '$0.5-1M'], ['1m5m', '$1-5M'], ['5m', '$5M+']];
export const GEOS = { us: 'US federal', intl: 'Americas + SSA', sw: 'AZ NM CO NV CA', global: 'Global' };
export const CYCLES = {
  fixed_deadline: 'One fixed deadline', annual_recurring: 'Recurs every year', rolling: 'Rolling: apply any time',
  open_ended: 'Open-ended', invite_only: 'By invitation only', closed_unknown: 'Closed or unknown',
};

/* ---- dates: date-only strings are handled as Y/M/D against a Phoenix "today" (never Date-parsed) ---- */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dayNum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null;
}
export const isoFromDayNum = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
export function daysLeft(deadline, now = new Date()) {
  const d = dayNum(deadline);
  return d == null ? null : d - dayNum(todayISO(now));
}
/* Recomputed client-side so a stale feed/mock never lies. 14 days qualifies, 13 does not. */
export function deadlineState(f, now = new Date(), minDays = 14) {
  const d = daysLeft(f.deadline, now);
  if (d == null) return f.cycle === 'rolling' || f.cycle === 'open_ended' ? 'rolling' : f.cycle === 'invite_only' ? 'invite' : 'unknown';
  return d < 0 ? 'expired' : d < minDays ? 'too_soon' : 'ok';
}
export function countdown(days) {
  if (days == null) return '';
  if (days < 0) return `closed ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'closes today';
  if (days === 1) return '1 day left';
  if (days < 90) return `${days} days left`;
  return `${Math.round(days / 30.4)} months left`;
}
export function relTime(ts, now = new Date()) {
  const t = Date.parse(ts || '');
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
export const isStale = (ts, now = new Date(), hours = 30) => Number.isFinite(Date.parse(ts || '')) && now - Date.parse(ts) > hours * 36e5;
export function fmtDate(iso) {
  const d = dayNum(iso);
  if (d == null) return '';
  return new Date(d * 864e5).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---- money / bands / geography ---- */
export function money(n) {
  if (n == null || !Number.isFinite(+n)) return 'n/a';
  n = +n;
  const f = (v, s) => `$${+v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}${s}`;
  return n >= 1e9 ? f(n / 1e9, 'B') : n >= 1e6 ? f(n / 1e6, 'M') : n >= 1e3 ? f(n / 1e3, 'k') : `$${Math.round(n)}`;
}
export function amountRange(f) {
  const { award_min_usd: a, award_max_usd: b } = f;
  if (a == null && b == null) return 'Not published';
  if (a == null || a === b) return `Up to ${money(b ?? a)}`;
  return b == null ? `From ${money(a)}` : `${money(a)} to ${money(b)}`;
}
export function amountBand(f) {
  const v = f.award_max_usd;
  return v == null ? 'unverified' : v < 5e5 ? 'lt500' : v < 1e6 ? '500k1m' : v < 5e6 ? '1m5m' : '5m';
}
export function geoGroups(f) {
  const out = new Set();
  for (const g of f.geography || []) {
    const s = String(g).toLowerCase();
    if (/global|worldwide|international/.test(s)) out.add('global');
    if (/(^|\W)(us|usa|u\.s\.?|united states|national)(\W|$)/.test(s)) out.add('us');
    if (/africa|ssa|latin|americas|caribbean|mexico|brazil|andean|central america|south america/.test(s)) out.add('intl');
    if (/(^|\W)(az|nm|co|nv|ca)(\W|$)|arizona|new mexico|colorado|nevada|california|southwest|sonoran/.test(s)) out.add('sw');
  }
  return out;
}
const truthyReq = (v) => !!v && !/^(no|none|false|not required|n\/a|0)\b/i.test(String(v));
export const needsLoi = (f) => truthyReq(f.requirements?.loi);
export const needsCostShare = (f) => truthyReq(f.requirements?.cost_share);

/* ---- normalise feed rows ---- */
export function normalize(feed, now = new Date(), team = {}) {
  const minDays = feed?.min_days ?? 14;
  const changes = feed?.changes || [];
  const by = new Map();
  for (const c of changes) (by.get(c.funder_id) || by.set(c.funder_id, []).get(c.funder_id)).push(c);
  const week = now.getTime() - 7 * 864e5;
  return (feed?.funders || []).map((f) => {
    const t = { state: f.team?.state || 'new', owner: f.team?.owner || '', notes: '', ...(team[f.id] || {}) };
    const days = daysLeft(f.deadline, now);
    const state = deadlineState(f, now, minDays);
    const ch = by.get(f.id) || [];
    const vetted = Date.parse(f.vetted_at || '');
    const isNew = (Number.isFinite(vetted) && vetted > week) || ch.some((c) => c.kind === 'initial' && Date.parse(c.at) > week);
    const changedAt = Math.max(Date.parse(f.last_changed_at || '') || 0, ...ch.filter((c) => c.kind !== 'initial').map((c) => Date.parse(c.at) || 0));
    return {
      ...f, team: t, _days: days, _state: state, _dq: state === 'expired' || state === 'too_soon',
      _skip: t.state === 'skip', _band: amountBand(f), _geo: geoGroups(f), _new: isNew, _changedAt: changedAt, _changes: ch,
      _unverified: f.award_max_usd == null || f.amount_flag === 'unverified',
      _manual: f.fetchability === 'bot_protected' || f.fetchability === 'blocked' || (f.consecutive_failures || 0) > 0,
      _hay: [f.name, f.program, (f.themes || []).join(' '), f.notes, f.eligibility_note, t.notes, t.owner].join(' ').toLowerCase(),
    };
  });
}

/* ---- filters ---- */
export const defaultFilters = () => ({
  q: '', bucket: [], ua: [], geo: [], themes: [], window: '', band: [], fit: 0, partner: [], loi: false, cost: false,
  team: [], changed: false, dq: false, skip: false,
});
const has = (arr, v) => !arr.length || arr.includes(v);
export function matches(r, F, ctx = {}) {
  if (r._dq && !F.dq) return false;
  if (r._skip && !F.skip && !F.team.includes('skip')) return false;
  if (F.q) for (const w of F.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!r._hay.includes(w)) return false;
  if (!has(F.bucket, r.bucket) || !has(F.ua, r.ua_eligibility) || !has(F.band, r._band) || !has(F.team, r.team.state)) return false;
  if (F.geo.length && !F.geo.some((g) => r._geo.has(g))) return false;
  if (F.themes.length && !F.themes.every((t) => (r.themes || []).includes(t))) return false;
  if (F.partner.length && !F.partner.some((p) => (r.partner_needed || []).includes(p))) return false;
  if (F.fit && (r.fit_score ?? 0) < F.fit) return false;
  if (F.loi && !needsLoi(r)) return false;
  if (F.cost && !needsCostShare(r)) return false;
  if (F.changed && !(ctx.since && r._changedAt > ctx.since)) return false;
  const w = F.window;
  if (w === 'rolling') return r._state === 'rolling';
  if (w === 'none') return r._days == null && r._state !== 'rolling' && r._state !== 'invite';
  if (w) return r._days != null && r._days <= +w;
  return true;
}
export const applyFilters = (rows, F, ctx) => rows.filter((r) => matches(r, F, ctx));

export const SORTS = { deadline: 'Soonest deadline', fit: 'Fit score', amount: 'Award size', changed: 'Recently changed', name: 'Name' };
export function sortRows(rows, key = 'deadline') {
  const num = (v, dir) => (v == null || Number.isNaN(v) ? Infinity : dir * v); // nulls last
  const k = {
    deadline: (r) => num(r._days, 1), fit: (r) => num(r.fit_score, -1), amount: (r) => num(r.award_max_usd, -1),
    changed: (r) => -(r._changedAt || 0),
  }[key];
  return [...rows].sort((a, b) =>
    (a._dq - b._dq) || (k ? k(a) - k(b) || 0 : 0) || (key === 'deadline' ? (b.fit_score ?? 0) - (a.fit_score ?? 0) : 0) ||
    String(a.name).localeCompare(String(b.name)));
}

/* ---- KPIs: qualified, non-skipped rows only ---- */
export function kpis(rows, ctx = {}) {
  const q = rows.filter((r) => !r._dq && !r._skip);
  const known = q.filter((r) => r.award_max_usd != null);
  const byBucket = {};
  for (const r of q) byBucket[r.bucket] = (byBucket[r.bucket] || 0) + 1;
  return {
    total: q.length, open: q.filter((r) => r.open_now).length,
    closing30: q.filter((r) => r._state === 'ok' && r._days < 30).length,
    addressable: known.reduce((s, r) => s + r.award_max_usd, 0), unverified: q.length - known.length,
    newWeek: q.filter((r) => r._new).length,
    sinceVisit: ctx.since ? q.filter((r) => r._changedAt > ctx.since).length : null,
    byBucket,
  };
}

/* ---- URL hash codec (never contains the passcode) ---- */
const ARR = ['bucket', 'ua', 'geo', 'themes', 'band', 'partner', 'team'];
export function encodeHash(F, view = 'table', sort = 'deadline') {
  const d = defaultFilters(), p = new URLSearchParams();
  for (const k of Object.keys(d)) {
    const v = F[k];
    if (ARR.includes(k) ? v.length : v !== d[k]) p.set(k, ARR.includes(k) ? v.join(',') : v === true ? '1' : v);
  }
  if (view !== 'table') p.set('view', view);
  if (sort !== 'deadline') p.set('sort', sort);
  return p.toString();
}
export function decodeHash(h) {
  const p = new URLSearchParams(String(h || '').replace(/^#/, '')), F = defaultFilters();
  for (const k of Object.keys(F)) {
    if (!p.has(k)) continue;
    const v = p.get(k);
    F[k] = ARR.includes(k) ? v.split(',').filter(Boolean) : typeof F[k] === 'boolean' ? v === '1' : typeof F[k] === 'number' ? Math.max(0, Math.min(100, +v || 0)) : v;
  }
  const view = ['table', 'cards', 'timeline'].includes(p.get('view')) ? p.get('view') : 'table';
  return { F, view, sort: Object.hasOwn(SORTS, p.get('sort') || '') ? p.get('sort') : 'deadline' };
}
export const PRESETS = {
  'Closing soon': { ...defaultFilters(), window: '60' },
  'Direct eligible, $500k+': { ...defaultFilters(), ua: ['eligible'], band: ['500k1m', '1m5m', '5m'] },
  'Needs partner': { ...defaultFilters(), ua: ['eligible_with_partner'] },
};

/* ---- CSV (quoted, formula-injection safe) ---- */
export function csvCell(v) {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const CSV_COLS = [
  ['Funder', (r) => r.name], ['Program', (r) => r.program], ['Bucket', (r) => BUCKETS[r.bucket] || r.bucket],
  ['Deadline', (r) => r.deadline], ['Days left', (r) => r._days], ['Deadline status', (r) => r._state], ['Cycle', (r) => r.cycle],
  ['Award min USD', (r) => r.award_min_usd], ['Award max USD', (r) => r.award_max_usd], ['Amount confidence', (r) => r.amount_confidence],
  ['UA eligibility', (r) => UA[r.ua_eligibility] || r.ua_eligibility], ['Partner needed', (r) => r.partner_needed],
  ['Fit score', (r) => r.fit_score], ['LOI', (r) => r.requirements?.loi], ['Cost share', (r) => r.requirements?.cost_share],
  ['Indirect cap', (r) => r.requirements?.indirect_cap], ['Geography', (r) => r.geography], ['Themes', (r) => r.themes],
  ['Team state', (r) => r.team.state], ['Owner', (r) => r.team.owner], ['Notes', (r) => r.team.notes],
  ['Call page', (r) => r.url], ['Apply page', (r) => r.apply_url], ['Last checked', (r) => r.last_checked_at],
];
export const toCsv = (rows) =>
  '﻿' + [CSV_COLS.map((c) => csvCell(c[0])).join(','), ...rows.map((r) => CSV_COLS.map((c) => csvCell(c[1](r))).join(','))].join('\r\n');

/* ---- safety ---- */
export function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; }
}
/* dev hook: ?feed=<same-origin path>; rejects schemes and //host */
export function sameOriginFeed(p, base) {
  if (!p || /^\s*(\/\/|\\)/.test(p) || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
  try { const u = new URL(p, base); return u.origin === new URL(base).origin ? u.href : null; } catch { return null; }
}

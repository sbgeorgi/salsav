/* SALSAV Funding radar - pure logic (no DOM at import; every date function takes `now`). */
export const TZ = 'America/Phoenix';
export const BUCKETS = {
  us_federal: 'US federal', intl_dev: 'International development', state_regional: 'State & regional',
  private_sector: 'Private sector', foundation_ngo: 'Foundations & NGOs', tracker: 'Trackers',
};
export const UA = { eligible: 'Direct', eligible_with_partner: 'Needs partner', invitation_only: 'Invitation only', unknown: 'Unknown' };
export const STATES = ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip'];
export const LANES = { apply_now: 'Apply now', rolling: 'Rolling', prepare: 'Prepare', cultivate: 'Cultivate', watch: 'Watch' };
// How the crawler collects a source (feed: funder.collection.mode / .health), in plain words.
export const COLLECT_MODES = { calls: 'Calls collected automatically', cycle: 'Deadline read automatically', page: 'Page watched for changes', none: 'Not monitored' };
export const COLLECT_HEALTH = { ok: 'Working', failing: 'Source failing', stale: 'Not checked recently', thin: 'Too little text on the page', off: 'Off' };
// An older feed has no funder.collection: treat it as a watched page that works and has no open calls.
export const collectionOf = (f) => ({ mode: 'page', health: 'ok', open_calls: 0, ...(f?.collection || {}) });
const DEFAULT_TIERS = [{ key: 'prime', min: 75, label: 'Prime' }, { key: 'strong', min: 60, label: 'Strong' }, { key: 'possible', min: 45, label: 'Possible' }, { key: 'long_shot', min: 0, label: 'Long shot' }];
const DIM_KEYS = ['mission', 'activity', 'geography', 'eligibility', 'award', 'precedent'];
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

/* ---- lanes, fit tiers, itemized score, evidence, recommendations ---- */
export function lane(f, now = new Date(), minDays = 14) {
  if (f.cycle === 'invite_only' || f.ua_eligibility === 'invitation_only') return 'cultivate';
  const d = daysLeft(f.deadline, now);
  if (d != null && d >= minDays) return 'apply_now';
  if (f.cycle === 'rolling' || f.cycle === 'open_ended') return 'rolling';
  return f.cycle === 'annual_recurring' ? 'prepare' : 'watch';
}
export function fitTier(score, rubric) {
  if (score == null || !Number.isFinite(+score)) return null;
  const tiers = [...(rubric?.tiers?.length ? rubric.tiers : DEFAULT_TIERS)].sort((a, b) => b.min - a.min);
  const t = tiers.find((x) => +score >= x.min) || tiers[tiers.length - 1];
  return { key: t.key, label: t.label };
}
export function explainFit(f, rubric) {
  const fb = f?.fit_breakdown;
  if (!fb || !rubric?.dims) return null;
  const dims = (fb.dims || []).map((d) => {
    const rd = rubric.dims.find((x) => x.key === d.key) || {}, lv = [...(rd.levels || [])].sort((a, b) => a.points - b.points);
    const cur = lv.find((l) => l.key === d.level), nx = lv.find((l) => l.points > d.points);
    return {
      key: d.key, label: rd.label || d.key, question: rd.question || '', points: d.points, max: d.max ?? rd.max, level: d.level,
      levelLabel: cur?.label || d.level, rule: cur?.rule || '', why: d.why || '', quote: d.quote || '', url: d.url || '',
      ok: f.evidence_ok?.[d.key] === true,
      next: nx ? { key: nx.key, label: nx.label, points: nx.points, gain: nx.points - d.points, rule: nx.rule } : null,
    };
  });
  const rank = (k) => (k === 'eligibility' || k === 'award' ? 0 : 1);
  const headroom = dims.filter((d) => d.next).map((d) => ({ key: d.key, label: d.label, gain: d.next.gain, toLabel: d.next.label, rule: d.next.rule }))
    .sort((a, b) => b.gain - a.gain || rank(a.key) - rank(b.key)).slice(0, 3);
  return { total: fb.total ?? f.fit_score, tier: fitTier(fb.total ?? f.fit_score, rubric), dims, headroom };
}
const EVID = [['mission', 'Mission quote'], ['eligibility', 'Eligibility'], ['award', 'Award size'], ['deadline', 'Deadline']];
export function evidenceLevel(f) {
  const ev = f?.evidence || {}, ok = f?.evidence_ok || {};
  const mq = f?.fit_breakdown?.dims?.find((d) => d.key === 'mission')?.quote;
  const items = EVID.map(([key, label]) => ({ key, label, ok: !!(key === 'mission' ? mq : ev[key]?.quote) && ok[key] !== false }));
  return { n: Number.isInteger(f?.facts_verified) ? f.facts_verified : items.filter((i) => i.ok).length, of: 4, items };
}
function recScore(r, days, ln) {
  const urgency = ln === 'apply_now' ? (days <= 45 ? 12 : days <= 90 ? 15 : days <= 180 ? 8 : 0) : ln === 'rolling' ? 4 : ln === 'prepare' ? 2 : 0;
  return (r.fit_score ?? 0) + urgency + (r.ua_eligibility === 'eligible' ? 5 : 0) + ((r._evid || evidenceLevel(r)).n >= 3 ? 3 : 0);
}
export function recommend(rows, now = new Date(), n = 5) {
  const out = [];
  for (const r of rows) {
    const ln = r._lane || lane(r, now), st = deadlineState(r, now), dq = r._dq ?? (st === 'expired' || st === 'too_soon'), ts = r.team?.state || 'new';
    if (!['apply_now', 'rolling', 'prepare'].includes(ln) || dq || (ts !== 'new' && ts !== 'reviewing')) continue;
    const days = daysLeft(r.deadline, now), tier = r._tier || fitTier(r.fit_score), ev = r._evid || evidenceLevel(r);
    out.push({
      row: r, score: recScore(r, days, ln), days,
      reasons: [ln === 'apply_now' ? `Closes in ${days} days` : ln === 'rolling' ? 'Rolling: apply any time' : 'Recurs every year',
        r.fit_score != null ? `Fit ${r.fit_score}${tier ? `, ${tier.label}` : ''}` : null, r.ua_eligibility === 'eligible' ? 'UA applies directly' : null,
        ev.n >= 3 ? `${ev.n} of 4 facts quoted` : null, r.team?.owner ? null : 'Nobody owns it yet'].filter(Boolean),
    });
  }
  out.sort((a, b) => b.score - a.score || (a.days ?? Infinity) - (b.days ?? Infinity) || String(a.row.name).localeCompare(String(b.row.name)));
  return out.slice(0, n).map(({ days, ...x }) => x);
}

/* ---- normalise feed rows ---- */
export function normalize(feed, now = new Date(), team = {}) {
  const minDays = feed?.min_days ?? 14;
  const changes = feed?.changes || [];
  const by = new Map();
  for (const c of changes) (by.get(c.funder_id) || by.set(c.funder_id, []).get(c.funder_id)).push(c);
  const week = now.getTime() - 7 * 864e5;
  return (feed?.funders || []).map((f) => {
    const t = { state: f.team?.state || 'new', owner: f.team?.owner || '', ask_usd: f.team?.ask_usd ?? null, notes: '', ...(team[f.id] || {}) };
    const days = daysLeft(f.deadline, now);
    const state = deadlineState(f, now, minDays);
    const ch = by.get(f.id) || [];
    const vetted = Date.parse(f.vetted_at || '');
    const isNew = (Number.isFinite(vetted) && vetted > week) || ch.some((c) => c.kind === 'initial' && Date.parse(c.at) > week);
    const changedAt = Math.max(Date.parse(f.last_changed_at || '') || 0, ...ch.filter((c) => c.kind !== 'initial').map((c) => Date.parse(c.at) || 0));
    return {
      ...f, team: t, _days: days, _state: state, _dq: state === 'expired' || state === 'too_soon',
      _skip: t.state === 'skip', _lane: lane(f, now, minDays), _tier: fitTier(f.fit_score, feed?.rubric), _evid: evidenceLevel(f), _band: amountBand(f), _geo: geoGroups(f), _new: isNew, _changedAt: changedAt, _changes: ch,
      _unverified: f.award_max_usd == null || f.amount_flag === 'unverified',
      _manual: f.fetchability === 'bot_protected' || f.fetchability === 'blocked' || (f.consecutive_failures || 0) > 0,
      _hay: [f.name, f.program, (f.themes || []).join(' '), f.notes, f.eligibility_note, t.notes, t.owner].join(' ').toLowerCase(),
    };
  });
}

/* ---- filters ---- */
export const defaultFilters = () => ({
  q: '', bucket: [], ua: [], geo: [], themes: [], window: '', band: [], fit: 0, partner: [], loi: false, cost: false,
  team: [], changed: false, dq: false, skip: false, lane: '', tier: [], evid: false, calls: false,
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
  if (F.lane && r._lane !== F.lane) return false;
  if (F.tier.length && !F.tier.includes(r._tier?.key)) return false;
  if (F.evid && !(r._evid && r._evid.n >= 3)) return false;
  if (F.calls && !(collectionOf(r).open_calls > 0)) return false;
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

export const SORTS = { deadline: 'Soonest deadline', fit: 'Fit score', amount: 'Award size', changed: 'Recently changed', recommended: 'Recommended', name: 'Name' };
export function sortRows(rows, key = 'deadline') {
  const num = (v, dir) => (v == null || Number.isNaN(v) ? Infinity : dir * v); // nulls last
  const k = {
    deadline: (r) => num(r._days, 1), fit: (r) => num(r.fit_score, -1), amount: (r) => num(r.award_max_usd, -1),
    changed: (r) => -(r._changedAt || 0), recommended: (r) => -recScore(r, r._days, r._lane),
  }[key];
  return [...rows].sort((a, b) =>
    (a._dq - b._dq) || (k ? k(a) - k(b) || 0 : 0) || (key === 'deadline' ? (b.fit_score ?? 0) - (a.fit_score ?? 0) : 0) || (key === 'recommended' ? num(a._days, 1) - num(b._days, 1) || 0 : 0) ||
    String(a.name).localeCompare(String(b.name)));
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const askUsd = (r) => { const a = r.team?.ask_usd; return a != null && a !== '' && Number.isFinite(+a) ? +a : r.award_max_usd ?? 0; };
/* in-flight pipeline counts every non-skipped row, even one whose deadline has passed (a submitted bid stays a bid) */
function pipeline(rows) {
  const byState = Object.fromEntries(['reviewing', 'applying', 'submitted', 'awarded'].map((s) => [s, { n: 0, usd: 0 }]));
  for (const r of rows) if (byState[r.team?.state]) { byState[r.team.state].n++; byState[r.team.state].usd += askUsd(r); }
  const all = Object.values(byState);
  return { n: all.reduce((s, x) => s + x.n, 0), usd: all.reduce((s, x) => s + x.usd, 0), byState };
}

/* how many funders the crawler collects by itself (calls or cycle), open calls found, sources that need a look */
export function collectSummary(rows) {
  const c = rows.map(collectionOf);
  return { total: rows.length, auto: c.filter((x) => x.mode === 'calls' || x.mode === 'cycle').length, openCalls: c.reduce((s, x) => s + (Number(x.open_calls) || 0), 0),
    attention: c.filter((x) => x.mode !== 'none' && x.health !== 'ok').length };
}

/* ---- KPIs: qualified, non-skipped rows only ---- */
export function kpis(rows, ctx = {}) {
  const q = rows.filter((r) => !r._dq && !r._skip);
  const known = q.filter((r) => r.award_max_usd != null);
  const byBucket = {};
  for (const r of q) byBucket[r.bucket] = (byBucket[r.bucket] || 0) + 1;
  const scored = q.filter((r) => r.fit_score != null), pipe = pipeline(rows);
  return {
    total: q.length, open: q.filter((r) => r.open_now).length,
    closing30: q.filter((r) => r._state === 'ok' && r._days < 30).length,
    addressable: known.reduce((s, r) => s + r.award_max_usd, 0), unverified: q.length - known.length,
    newWeek: q.filter((r) => r._new).length,
    sinceVisit: ctx.since ? q.filter((r) => r._changedAt > ctx.since).length : null,
    byBucket,
    applyNow: q.filter((r) => r._lane === 'apply_now').length,
    applyNowUsd: q.filter((r) => r._lane === 'apply_now').reduce((s, r) => s + (r.award_max_usd ?? 0), 0),
    rollingOpen: q.filter((r) => r._lane === 'rolling').length,
    primeStrong: q.filter((r) => r._tier && (r._tier.key === 'prime' || r._tier.key === 'strong')).length,
    avgFit: scored.length ? Math.round(scored.reduce((s, r) => s + r.fit_score, 0) / scored.length * 10) / 10 : null,
    itemized: q.filter((r) => r.fit_breakdown).length,
    pipeline: pipe,
    collect: collectSummary(q),
    evidencePct: pct(q.filter((r) => r._evid && r._evid.n >= 3).length, q.length),
    byLane: Object.fromEntries(Object.keys(LANES).map((k) => [k, q.filter((r) => r._lane === k).length])),
    byTier: Object.fromEntries(DEFAULT_TIERS.map((t) => [t.key, q.filter((r) => r._tier?.key === t.key).length])),
  };
}

/* ---- insights for the Insights view ---- */
const QUALITY = [['award_published', 'Award size published', (r) => r.amount_confidence === 'published'], ['deadline_known', 'Deadline known', (r) => r.deadline != null],
  ['eligibility_confirmed', 'UA eligibility confirmed', (r) => r.ua_eligibility && r.ua_eligibility !== 'unknown'], ['evidence3', 'Three or more facts quoted', (r) => r._evid && r._evid.n >= 3]];
export function insights(rows, feed, now = new Date()) {
  const q = rows.filter((r) => !r._dq && !r._skip), rubric = feed?.rubric, tiers = rubric?.tiers?.length ? rubric.tiers : DEFAULT_TIERS;
  const pt = (r) => ({ id: r.id, name: r.name, fit: r.fit_score, award: r.award_max_usd ?? null, bucket: r.bucket, lane: r._lane });
  const scored = q.filter((r) => r.fit_score != null);
  const anatomy = (rubric?.dims || []).map((d) => {
    const v = q.map((r) => r.fit_breakdown?.dims?.find((x) => x.key === d.key)?.points).filter((x) => x != null);
    return { key: d.key, label: d.label, avg: v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : 0, max: d.max };
  });
  const scr = feed?.screened || [], pend = new Map((feed?.targets?.by_bucket || []).map((b) => [b.bucket, b.pending]));
  const dayMs = now.getTime() - 864e5, mx = feed?.metrics || [];
  return {
    scatter: scored.filter((r) => r._days != null).map((r) => ({ ...pt(r), days: r._days })),
    undated: scored.filter((r) => r._days == null).map(pt),
    fitHist: tiers.map((t) => ({ tier: t.key, label: t.label, n: scored.filter((r) => r._tier?.key === t.key).length })),
    anatomy,
    coverage: Object.entries(feed?.coverage_min || {}).map(([bucket, min]) => ({ bucket, label: BUCKETS[bucket] || bucket, vetted: rows.filter((r) => r.bucket === bucket).length,
      min, screened: scr.filter((s) => s.bucket === bucket).length, pending: pend.get(bucket) ?? 0 })),
    funnel: ['new', 'reviewing', 'applying', 'submitted', 'awarded'].map((state) => {
      const rs = rows.filter((r) => r.team?.state === state && (state !== 'new' || !r._dq));
      return { state, n: rs.length, usd: rs.reduce((s, r) => s + askUsd(r), 0) };
    }),
    quality: QUALITY.map(([key, label, fn]) => ({ key, label, pct: pct(q.filter(fn).length, q.length) })),
    health: { total: rows.length, checked24h: rows.filter((r) => Date.parse(r.last_checked_at || '') > dayMs).length,
      failing: rows.filter((r) => (r.consecutive_failures || 0) > 0).length, manual: rows.filter((r) => r._manual).length },
    trend: { days: mx.map((x) => x.day), vetted: mx.map((x) => x.m?.vetted ?? 0), applyNow: mx.map((x) => x.m?.by_lane?.apply_now ?? 0), evidence3: mx.map((x) => x.m?.quality?.evidence3 ?? 0) },
    discovery: feed?.discovery || null,
    collect: { now: feed?.collection?.listed > 0 ? { auto: feed.collection.auto, listed: feed.collection.listed, openCalls: feed.collection.open_calls ?? 0 } : null, days: mx.filter((x) => x.m?.collection?.listed > 0).map((x) => ({ day: x.day, pct: Math.round(x.m.collection.auto / x.m.collection.listed * 100) })) },
  };
}

/* ---- URL hash codec (never contains the passcode) ---- */
const ARR = ['bucket', 'ua', 'geo', 'themes', 'band', 'partner', 'team', 'tier'];
const VIEWS = ['table', 'cards', 'timeline', 'board', 'insights', 'method'];
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
  const view = VIEWS.includes(p.get('view')) ? p.get('view') : 'table';
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
  ['Lane', (r) => LANES[r._lane] || r._lane], ['Fit score', (r) => r.fit_score], ['Fit tier', (r) => r._tier?.label],
  ...DIM_KEYS.map((k) => [`Fit: ${k} pts`, (r) => r.fit_breakdown?.dims?.find((d) => d.key === k)?.points]),
  ['Evidence (n of 4)', (r) => r._evid && r._evid.n], ['LOI', (r) => r.requirements?.loi], ['Cost share', (r) => r.requirements?.cost_share],
  ['Indirect cap', (r) => r.requirements?.indirect_cap], ['Geography', (r) => r.geography], ['Themes', (r) => r.themes],
  ['Team state', (r) => r.team.state], ['Ask USD', (r) => r.team.ask_usd], ['Owner', (r) => r.team.owner], ['Notes', (r) => r.team.notes],
  ['Call page', (r) => r.url], ['Apply page', (r) => r.apply_url], ['Last checked', (r) => r.last_checked_at], ['collection_mode', (r) => collectionOf(r).mode], ['open_calls', (r) => collectionOf(r).open_calls],
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

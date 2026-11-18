/* Database view: every funder the team evaluated (tracked, screened out, candidates), the reason and threshold checks behind each
   decision, the team's overrides, and the calls and leads the discovery agent produced. The pure logic is exported and tested in
   database.test.mjs; the view only builds DOM with the shell's el() and text nodes. Colours come from tokens in dashboard.css. */
import * as D from '../dashboard.js';
import { statusChip, stateChip, bucketDot, bucketChip, gateChips, avatar, timeAgo, menu, AGENT_HOUR, agentDaysText, agentRunLabel, STATUS_LABEL } from './ui.js';
/* the discovery agent's schedule lives in ui.js; re-exported here for the Database tests */
export { AGENT_DAYS, AGENT_HOUR, agentDaysText, agentRunLabel, nextAgentRun } from './ui.js';

export const PAGE = 50;
const STATUS_RANK = { vetted: 0, candidate: 1, rejected: 2 };
const UA_RANK = ['eligible', 'eligible_with_partner', 'invitation_only', 'unknown', 'unlikely'];
const STATE_RANK = ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip'];
const DIR_DEFAULT = { name: 'asc', status: 'asc', ua: 'asc', pipeline: 'asc', fit: 'desc', award: 'desc', evaluated: 'desc', calls: 'desc' };
export const CRITERIA = [
  { key: 'fit', label: 'Fit below threshold', hint: 'Scored, and the fit score is under the minimum' },
  { key: 'ua', label: 'UA unlikely', hint: 'The UA eligibility check failed' },
  { key: 'award', label: 'Award under minimum', hint: 'The largest published award is under the minimum' },
  { key: 'unscored', label: 'Not scored yet', hint: 'No fit score yet' },
  { key: 'judgment', label: 'Judgment call', hint: 'Every gate passed, but the funder was screened out' },
];
export const LEAD_STATUS = [['pending', 'Pending'], ['deferred', 'Deferred'], ['covered', 'Covered'], ['rejected', 'Dismissed']];
export const CALL_FEED = { vetted: 'In the feed', rejected: 'Hidden from the feed', candidate: 'Candidate, not in the feed' };
const CALL_BODY = { demote: 'It leaves the open calls and moves to Demoted calls, where anyone can restore it.', restore: 'It returns to the open calls.' }; // same explanation as the drawer
export const CALL_STATES = [['all', 'All calls'], ['feed', 'In the feed'], ['hidden', 'Hidden'], ['candidate', 'Candidate'], ['decided', 'Decided by the team']];
const CALL_EMPTY = {
  all: 'No calls yet. The discovery agent adds them when it reads a funder page.', feed: 'No calls are in the feed.',
  hidden: 'No calls are hidden from the feed.', candidate: 'No candidate calls.', decided: 'No calls have a team decision.',
};

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const ms = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const toggleIn = (arr, k) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
/* team identity arrives only when unlocked; a missing name renders as nothing, never "null" or "undefined" */
const who = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const VERB = {
  funder: { promoted: 'promoted this funder', demoted: 'screened this funder out' },
  call: { promoted: 'put this call in the feed', demoted: 'hid this call from the feed' },
};
/* the parts of "Ana Ruiz promoted this funder": the name ('' when the read has none), the verb, and the sentence start without a name */
export function decisionParts(h, kind = 'funder') {
  const by = who(h?.by), verb = VERB[kind]?.[h?.lock] || 'made a decision';
  return { by, verb, start: cap(verb) };
}

/* ---- criteria: which threshold gates a funder fails, and the judgment call (screened out although every gate passes) ---- */
export function criteriaOf(f) {
  const g = f?.gates || {}, out = [];
  if (g.scored === false) out.push('unscored');
  else if (g.fit === false) out.push('fit');
  if (g.ua === false) out.push('ua');
  if (g.award === false) out.push('award');
  if (f?.status === 'rejected' && g.pass === true) out.push('judgment');
  return out;
}
/* one row per threshold check for the expanded row: pass is true, false, or null when the check cannot run yet */
export function criterionRows(f, thresholds = {}) {
  const g = f?.gates || {}, t = thresholds || {}, scored = g.scored !== false;
  const flag = (v) => (typeof v === 'boolean' ? v : null);
  return [
    { key: 'fit', label: 'Fit score', pass: scored ? flag(g.fit) : null,
      actual: scored && num(f?.fit_score) != null ? `${f.fit_score} of 100` : D.UNSCORED,
      threshold: num(t.fit_min) != null ? `minimum ${t.fit_min}` : '' },
    { key: 'ua', label: 'UA eligibility', pass: flag(g.ua), actual: D.UA[f?.ua_eligibility] || f?.ua_eligibility || 'Not set', threshold: '' },
    { key: 'award', label: 'Award size', pass: flag(g.award), actual: D.amountRange(f || {}),
      threshold: num(t.award_min_usd) != null ? `minimum ${D.money(t.award_min_usd)}` : '' },
  ];
}
export const orgKeyOf = (f) => (f?.category ? String(f.category) : 'none');
export const orgLabel = (k) => (k === 'none' ? 'Not set' : cap(String(k).replace(/_/g, ' ')));
export function orgOptions(rows) {
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.orgKey)) seen.set(r.orgKey, orgLabel(r.orgKey));
  return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
}

/* an aggregator (Grants.gov and similar) is a search source, not a funder: tracked here, kept off the Radar (004_feed_no_aggregators.sql) */
const AGGREGATOR_NOTE = 'Searched for calls. Not listed on the Radar as a funder.';
const isAggregator = (f) => f?.category === 'aggregator' || /^aggregator\b/i.test(f?.vet_note || '');
/* ---- rows: one per registry funder, every status ---- */
export function buildRows(reg, { notes = () => null } = {}) {
  const t = reg?.thresholds || {};
  return (reg?.funders || []).map((f) => {
    const criteria = criteriaOf(f);
    const crawler = f.status === 'vetted' ? f.vet_note || '' : f.reject_reason || f.vet_note || '';
    const by = who(f.human?.by); // a name arrives only when unlocked (hideHuman), so the reason reads "by" only then
    // a human lock states the reason; the crawler reason stays as a second line. Locked viewers get the marker without the note
    const team = f.human?.note ? `Team decision${by ? ` by ${by}` : ''}: ${f.human.note}` : f.human?.lock ? 'Team decision. Unlock to read the reason.' : '';
    const reason = team || crawler;
    const row = {
      id: f.id, f, name: f.name || 'Unnamed funder', program: f.program || '', bucket: f.bucket || 'tracker', status: f.status,
      orgKey: orgKeyOf(f), fit: num(f.fit_score), fitMin: num(t.fit_min), award: num(f.award_max_usd ?? f.award_min_usd),
      awardText: D.amountRange(f), band: D.amountBand(f), ua: f.ua_eligibility || '',
      uaLabel: D.UA[f.ua_eligibility] || f.ua_eligibility || 'Not set',
      criteria, judgment: criteria.includes('judgment'), aggregator: isAggregator(f), reason,crawler: team ? crawler : '', vetNote: f.vet_note || '', rejectReason: f.reject_reason || '',
      evaluated: f.evaluated_at || null, evalMs: ms(f.evaluated_at), pipeline: f.team_state || null,
      callsOpen: num(f.calls_open) ?? 0, callsTotal: num(f.calls_total) ?? 0, human: f.human || null, queue: f.queue || null,
      notes: notes(f.id),
    };
    const themes = Array.isArray(f.themes) ? f.themes : [];
    row.search = [row.name, row.program, reason, crawler, f.vet_note, f.reject_reason, ...themes, D.BUCKETS[row.bucket], orgLabel(row.orgKey)]
      .filter(Boolean).join(' ').toLowerCase();
    return row;
  });
}

/* ---- filter: F = {status, buckets[], criterion, org, band, human, queue, openCalls}; words = lower-cased search words ---- */
export function filterRows(rows, F = {}, words = []) {
  const buckets = F.buckets || [];
  return rows.filter((r) =>
    (!F.status || F.status === 'all' || r.status === F.status) &&
    (!buckets.length || buckets.includes(r.bucket)) &&
    (!F.criterion || r.criteria.includes(F.criterion)) &&
    (!F.org || r.orgKey === F.org) &&
    (!F.band || r.band === F.band) &&
    (!F.human || !!r.human) &&
    (!F.queue || r.queue === 'pending') &&
    (!F.openCalls || r.callsOpen > 0) &&
    words.every((w) => r.search.includes(w)));
}

/* ---- sort: nulls always last; judgmentFirst puts judgment calls ahead (the screened-out view's default) ---- */
const SORT_VALUE = {
  name: (r) => r.name.toLowerCase(),
  status: (r) => STATUS_RANK[r.status] ?? null,
  fit: (r) => r.fit,
  award: (r) => r.award,
  ua: (r) => (UA_RANK.includes(r.ua) ? UA_RANK.indexOf(r.ua) : null),
  evaluated: (r) => r.evalMs,
  pipeline: (r) => (r.pipeline && STATE_RANK.includes(r.pipeline) ? STATE_RANK.indexOf(r.pipeline) : null),
  calls: (r) => r.callsOpen,
};
export function sortRows(rows, sort = {}) {
  const get = SORT_VALUE[sort.key] || SORT_VALUE.evaluated;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    if (sort.judgmentFirst && a.judgment !== b.judgment) return a.judgment ? -1 : 1;
    const x = get(a), y = get(b);
    const xn = x == null || Number.isNaN(x), yn = y == null || Number.isNaN(y);
    if (xn || yn) return xn === yn ? cmp(a.name, b.name) : xn ? 1 : -1;
    if (x !== y) return cmp(x, y) * dir;
    return cmp(a.name.toLowerCase(), b.name.toLowerCase());
  });
}
export const defaultSort = (F = {}) => ({ key: 'evaluated', dir: 'desc', judgmentFirst: F.status === 'rejected' });
/* a header click: the same column flips, a new column starts in its natural direction */
export function nextSort(cur, key) {
  if (cur && cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: DIR_DEFAULT[key] || 'asc' };
}

/* ---- counts for the summary strip (always over every row, so the numbers do not move with the filters) ---- */
export function summarize(rows, reg) {
  const n = (fn) => rows.filter(fn).length;
  return {
    tracked: n((r) => r.status === 'vetted'),
    screened: n((r) => r.status === 'rejected'),
    candidates: n((r) => r.status === 'candidate'),
    leads: (reg?.leads || []).filter((l) => l.status === 'pending' || l.status === 'deferred').length,
    queue: n((r) => r.queue === 'pending'),
    human: n((r) => !!r.human),
  };
}

/* ---- agent queue: promoted funders waiting for the next run, oldest promotion first ---- */
export function agentQueue(funders = []) {
  return funders.filter((f) => f.queue === 'pending').sort((a, b) => {
    const x = ms(a.human?.at), y = ms(b.human?.at);
    if (x !== y) return x == null ? 1 : y == null ? -1 : x - y;
    return cmp(String(a.name).toLowerCase(), String(b.name).toLowerCase());
  });
}
/* the agent queue line: who promoted the funder and when; a missing name is left out */
export function queueLine(f, now = new Date()) {
  const by = who(f?.human?.by), when = timeAgo(f?.human?.at, now);
  return `${by ? `Promoted by ${by}` : 'Promoted'}, ${when || 'time not recorded'}`;
}
/* ---- leads and calls ---- */
export function leadGroups(leads = []) {
  return LEAD_STATUS.map(([status, label]) => ({
    status, label,
    items: leads.filter((l) => l.status === status).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || cmp(String(a.org), String(b.org))),
  }));
}
export const leadActions = (l) => ({ queue: l.status === 'deferred' || l.status === 'rejected', dismiss: l.status === 'pending' || l.status === 'deferred' });
/* one call against a state: all | feed (in the feed) | hidden (rejected) | candidate | decided (a person decided it) */
/* the feed rule of grants.feed: a vetted call that is still open or forecasted */
export const inFeed = (c) => c.vet_status === 'vetted' && (c.status === 'open' || c.status === 'forecasted');
export function callMatches(c, state = 'all') {
  if (state === 'feed') return inFeed(c);
  if (state === 'hidden') return c.vet_status === 'rejected';
  if (state === 'candidate') return c.vet_status === 'candidate';
  if (state === 'decided') return !!c.human;
  return true;
}
/* F = {state, funder}: the calls in one state, optionally of one funder */
export const callRows = (calls = [], F = {}) => calls.filter((c) => callMatches(c, F.state || 'all') && (!F.funder || c.funder_id === F.funder));
export function callCounts(calls = []) {
  const n = (state) => calls.filter((c) => callMatches(c, state)).length;
  return { all: n('all'), feed: n('feed'), hidden: n('hidden'), candidate: n('candidate'), decided: n('decided') };
}
/* soonest deadline first, calls without one last, then by title */
export function sortCalls(calls = []) {
  return calls.slice().sort((a, b) => {
    const x = ms(a.deadline), y = ms(b.deadline);
    if (x !== y) return x == null ? 1 : y == null ? -1 : x - y;
    return cmp(String(a.title || '').toLowerCase(), String(b.title || '').toLowerCase());
  });
}
/* Demote takes an in-feed or candidate call out; Restore puts a hidden call back */
export const callAction = (c) => (c.vet_status === 'rejected' ? 'restore' : 'demote');

/* ---- export: every registry field, CSV with the dashboard's CSV rules (D.csvCell) and JSON ---- */
const joinList = (v) => (Array.isArray(v) ? v.join('; ') : v);
const gate = (k) => (f) => (f.gates || {})[k];
export const EXPORT_COLS = [
  ['Funder id', (f) => f.id], ['Funder', (f) => f.name], ['Program', (f) => f.program], ['Organization type', (f) => orgLabel(orgKeyOf(f))],
  ['Bucket', (f) => D.BUCKETS[f.bucket] || f.bucket], ['Status', (f) => STATUS_LABEL[f.status] || f.status], ['URL', (f) => f.url],
  ['Geography', (f) => joinList(f.geography)], ['Themes', (f) => joinList(f.themes)],
  ['Award min USD', (f) => f.award_min_usd], ['Award max USD', (f) => f.award_max_usd], ['Amount confidence', (f) => f.amount_confidence],
  ['UA eligibility', (f) => D.UA[f.ua_eligibility] || f.ua_eligibility], ['Cycle', (f) => f.cycle], ['Next deadline', (f) => f.next_deadline],
  ['Fit score', (f) => f.fit_score], ['Fit breakdown (JSON)', (f) => (f.fit_breakdown ? JSON.stringify(f.fit_breakdown) : '')],
  ['Fit reasons', (f) => joinList(f.fit_reasons)], ['Vet note', (f) => f.vet_note], ['Reject reason', (f) => f.reject_reason],
  ['Gate: scored', gate('scored')], ['Gate: fit', gate('fit')], ['Gate: UA', gate('ua')], ['Gate: award', gate('award')], ['Gate: pass', gate('pass')],
  ['Criteria flagged', (f) => criteriaOf(f).join('; ')],
  ['Evaluated at', (f) => f.evaluated_at], ['Vetted at', (f) => f.vetted_at], ['Verified at', (f) => f.verified_at], ['Created at', (f) => f.created_at],
  ['Discovered via', (f) => f.discovered_via], ['Adapter', (f) => f.adapter], ['Fetchability', (f) => f.fetchability], ['Last ok at', (f) => f.last_ok_at],
  ['Calls open', (f) => f.calls_open], ['Calls total', (f) => f.calls_total], ['Team state', (f) => f.team_state],
  ['Human lock', (f) => f.human?.lock], ['Human by', (f) => f.human?.by], ['Human at', (f) => f.human?.at], ['Human note', (f) => f.human?.note],
  ['Queue', (f) => f.queue],
];
export function registryCsv(funders = []) {
  return '﻿' + [EXPORT_COLS.map((c) => D.csvCell(c[0])).join(','),
    ...funders.map((f) => EXPORT_COLS.map((c) => D.csvCell(c[1](f))).join(','))].join('\r\n');
}
export function registryJson(funders = [], now = new Date()) {
  return JSON.stringify({ exported_at: now.toISOString(), count: funders.length, funders }, null, 2);
}

/* ---- actions: the dialog explains what a promotion or demotion does, then the shell's act() saves it ---- */
function promoteBody(now = new Date()) {
  return `It is tracked now and shows on the Radar. The crawler checks it at the next window. The discovery agent scores it and builds its collection at its next run, ${agentRunLabel(now)}.`;
}
async function promote(app, r) {
  if (!app.requireUnlock()) return;
  const reason = await app.ask({ title: `Promote ${r.name}`, body: promoteBody(), label: 'Reason', placeholder: 'Why should we track this funder?',
    confirm: 'Promote to tracked', required: true, minLength: 3, maxLength: 500 });
  if (reason == null) return;
  await app.act('funder', r.id, 'promote', { reason });
}
async function demote(app, r) {
  if (!app.requireUnlock()) return;
  const reason = await app.ask({ title: `Screen out ${r.name}`, body: 'It leaves the Radar and moves to Screened out. A human decision is a lock: automated vetting cannot track it again until someone releases the decision.',
    label: 'Reason', placeholder: 'Why is this funder out of scope?', confirm: 'Screen out', danger: true, required: true, minLength: 3, maxLength: 500 });
  if (reason == null) return;
  await app.act('funder', r.id, 'demote', { reason });
}
async function release(app, r) {
  if (!app.requireUnlock()) return;
  const reason = await app.ask({ title: `Release the decision on ${r.name}`, body: 'Clears the human lock. The status stays as it is, and automated vetting can change it at its next run.',
    label: 'Reason (optional)', placeholder: 'Optional', confirm: 'Release the decision', required: false, maxLength: 500 });
  if (reason == null) return;
  await app.act('funder', r.id, 'release', { reason });
}

function exportFile(app, kind, funders) {
  const name = `salsav-funders-${D.todayISO(new Date())}.${kind}`;
  const body = kind === 'csv' ? registryCsv(funders) : registryJson(funders, new Date());
  const type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  app.toast(`Exported ${funders.length} funder${funders.length === 1 ? '' : 's'} as ${kind.toUpperCase()}`);
}

/* ---- view ---- */
let seq = 0;
const DEFAULTS = () => ({ tab: 'funders', status: 'all', buckets: [], criterion: '', org: '', band: '', human: false, queue: false,
  openCalls: false, sort: null, limit: PAGE, open: [], queueOpen: false, callState: 'all', callFunder: '', callLimit: PAGE });

export async function render(root, app) {
  const mine = ++seq;
  if (!app.reg()) {
    root.replaceChildren(app.el('div', { class: 'db', 'aria-busy': 'true', 'aria-label': 'Loading the database' },
      app.el('div', { class: 'skel t' }), app.el('div', { class: 'skel c' })));
    let err = null;
    try { await app.loadRegistry(); } catch (e) { err = e; }
    if (mine !== seq || app.S.view !== 'database') return;
    if (!app.reg()) { root.replaceChildren(loadFailed(root, app, err)); return; }
  }
  paint(root, app, app.ui_state('database', DEFAULTS()));
}
export function onQuery(root, app) {
  if (app.reg()) paint(root, app, app.ui_state('database', DEFAULTS()));
  else render(root, app);
}
function loadFailed(root, app, e) {
  const { el, ico } = app;
  return el('div', { class: 'db-state' }, el('h2', { text: 'The database did not load' }),
    el('p', { text: `The registry request failed${e?.message ? `: ${e.message}` : ''}. Check the connection, then try again.` }),
    el('button', { class: 'btn btn--primary', type: 'button', 'data-k': 'retry', onclick: () => render(root, app) }, 'Try again'));
}

function paint(root, app, U) {
  const { S, el, ico } = app;
  const reg = app.reg();
  const unlocked = app.unlocked();
  const words = app.q();
  const now = new Date();
  const thresholds = reg.thresholds || {};
  const calls = reg.calls || [];
  const leads = reg.leads || [];
  const hit = (text) => words.every((w) => String(text || '').toLowerCase().includes(w));
  const focusKey = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
  const rows = buildRows(reg, { notes: (id) => (unlocked ? app.notesFor(id).length : null) });
  const F = { status: U.status, buckets: U.buckets, criterion: U.criterion, org: U.org, band: U.band, human: U.human, queue: U.queue, openCalls: U.openCalls };
  const sortUsed = U.sort ? { ...U.sort, judgmentFirst: false } : defaultSort(F);
  const list = sortRows(filterRows(rows, F, words), sortUsed);
  const shown = list.slice(0, U.limit);
  const sum = summarize(rows, reg);
  const queued = agentQueue(reg.funders || []);
  const hasFilter = U.status !== 'all' || U.buckets.length > 0 || !!U.criterion || !!U.org || !!U.band || U.human || U.queue || U.openCalls;
  const put = (patch) => { Object.assign(U, patch); paint(root, app, U); };
  const filt = (patch) => put({ ...patch, limit: PAGE });
  const callFilt = (patch) => put({ ...patch, callLimit: PAGE });
  const clearAll = () => filt({ status: 'all', buckets: [], criterion: '', org: '', band: '', human: false, queue: false, openCalls: false });
  /* "Ana Ruiz promoted this funder, 2 days ago"; the name is left out when the read did not carry one */
  const decisionLine = (h, kind) => {
    const d = decisionParts(h, kind);
    return el('p', {}, d.by ? el('b', { text: d.by }) : null, el('span', { text: d.by ? ` ${d.verb} ` : `${d.start} ` }),
      el('time', { class: 'sub', datetime: h?.at || '', text: timeAgo(h?.at, now) }));
  };

  /* header and export */
  const exportBtn = el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'export', 'aria-haspopup': 'menu', disabled: !list.length }, ico('doc'), 'Export');
  el('span', { class: 'db-export' }, exportBtn);
  menu(exportBtn, [
    { label: `Download CSV, ${list.length} funders`, onSelect: () => exportFile(app, 'csv', list.map((r) => r.f)) },
    { label: `Download JSON, ${list.length} funders`, onSelect: () => exportFile(app, 'json', list.map((r) => r.f)) },
  ]);

  /* view only notice: the actions stay visible, each one asks to unlock */
  const lockNote = unlocked ? null : el('div', { class: 'db-lock panel' },
    el('p', { text: 'View only. Unlock editing to promote or screen out funders, queue or dismiss leads, demote calls and add notes.' }),
    el('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-k': 'unlock', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing'));

  /* summary strip: each count is also a filter */
  const stat = (k, label, n, on, onSelect) => el('button', { class: 'db-stat', type: 'button', 'data-k': 'stat-' + k, 'aria-pressed': on, onclick: onSelect },
    el('span', { class: 'big num', text: String(n) }), el('span', { class: 'l', text: label }));
  const toggleStatus = (k) => filt({ status: U.status === k ? 'all' : k, tab: 'funders' });
  const strip = el('div', { class: 'db-strip', role: 'group', 'aria-label': 'Counts. Select one to filter the list.' },
    stat('tracked', 'Tracked', sum.tracked, U.status === 'vetted', () => toggleStatus('vetted')),
    stat('screened', 'Screened out', sum.screened, U.status === 'rejected', () => toggleStatus('rejected')),
    stat('candidates', 'Candidates', sum.candidates, U.status === 'candidate', () => toggleStatus('candidate')),
    stat('leads', 'Open leads', sum.leads, U.tab === 'leads', () => filt({ tab: 'leads' })),
    stat('queue', 'In agent queue', sum.queue, U.queue, () => filt({ queue: !U.queue, tab: 'funders' })),
    stat('human', 'Human decisions', sum.human, U.human, () => filt({ human: !U.human, tab: 'funders' })));

  /* agent queue: one line, the list on demand */
  const queueList = el('ol', { class: 'db-queue-list', 'aria-label': 'Funders waiting for the agent' }, queued.map((f) => el('li', {},
    decisionParts(f.human).by ? avatar(f.human.by, { size: 'sm' }) : null,
    el('div', { class: 'db-line-w' }, el('button', { class: 'linkbtn', type: 'button', 'data-k': 'qo-' + f.id, onclick: () => app.openDrawer(f.id) }, f.name),
      f.human?.note ? el('p', { class: 'sub', text: f.human.note }) : null),
    el('time', { class: 'sub', datetime: f.human?.at || '', text: queueLine(f, now) }))));
  const queueBar = el('section', { class: 'db-queue', 'aria-label': 'Agent queue' },
    el('p', { class: 'db-queue-text' },
      el('b', { text: queued.length ? `Agent queue: ${queued.length} waiting.` : 'Agent queue: nothing waiting.' }),
      ` The agent runs on ${agentDaysText()} at ${String(AGENT_HOUR).padStart(2, '0')}:00 local time. Next run: ${agentRunLabel(now)}.`),
    queued.length ? el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'queue-toggle', 'aria-expanded': String(!!U.queueOpen),
      onclick: () => put({ queueOpen: !U.queueOpen }) }, U.queueOpen ? 'Hide the queue' : 'Show the queue') : null,
    U.queueOpen && queued.length ? queueList : null);

  /* tabs: aria-pressed segments, every one reachable with Tab */
  const TABS = [['funders', 'Funders', rows.length], ['calls', 'Calls', calls.length], ['leads', 'Leads', leads.length]];
  const tabs = el('div', { class: 'seg db-tabs', role: 'group', 'aria-label': 'Database sections' }, TABS.map(([k, l, n]) =>
    el('button', { type: 'button', 'data-k': 'tab-' + k, 'aria-pressed': U.tab === k, onclick: () => put({ tab: k }) }, `${l} `, el('span', { class: 'db-cn num', text: String(n) }))));

  /* funders: filters, result line, table */
  const statusSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Status' }, [['all', 'All'], ['vetted', 'Tracked'], ['rejected', 'Screened out'], ['candidate', 'Candidates']]
    .map(([k, l]) => el('button', { type: 'button', 'data-k': 'st-' + k, 'aria-pressed': U.status === k, onclick: () => filt({ status: k }) }, l)));
  const bucketChips = Object.keys(D.BUCKETS).map((k) => el('button', { class: `bchip b-${k}`, type: 'button', 'data-k': 'bk-' + k,
    'aria-pressed': U.buckets.includes(k), onclick: () => filt({ buckets: toggleIn(U.buckets, k) }) },
    D.BUCKETS[k], el('b', { class: 'num', text: String(rows.filter((r) => r.bucket === k).length) })));
  const critChips = CRITERIA.map((c) => el('button', { class: 'fchip', type: 'button', 'data-k': 'cr-' + c.key, 'aria-pressed': U.criterion === c.key,
    title: c.hint, onclick: () => filt({ criterion: U.criterion === c.key ? '' : c.key }) },
    c.label, el('span', { class: 'db-cn num', text: String(rows.filter((r) => r.criteria.includes(c.key)).length) })));
  const orgSel = el('select', { 'data-k': 'org', 'aria-label': 'Organization type', onchange: (e) => filt({ org: e.target.value }) },
    el('option', { value: '', text: 'Any type' }), orgOptions(rows).map(([k, l]) => el('option', { value: k, text: l })));
  orgSel.value = U.org;
  const bandSel = el('select', { 'data-k': 'band', 'aria-label': 'Funding size', onchange: (e) => filt({ band: e.target.value }) },
    el('option', { value: '', text: 'Any size' }), D.BANDS.map(([k, l]) => el('option', { value: k, text: l })));
  bandSel.value = U.band;
  const filters = el('div', { class: 'db-filters' },
    el('div', { class: 'db-frow' }, el('span', { class: 'db-lbl', text: 'Status' }), statusSeg, el('span', { class: 'db-lbl', text: 'Category' }), bucketChips),
    el('div', { class: 'db-frow' }, el('span', { class: 'db-lbl', text: 'Failed' }), critChips,
      el('label', { class: 'field db-sel' }, el('span', { class: 'db-lbl', text: 'Type' }), orgSel),
      el('label', { class: 'field db-sel' }, el('span', { class: 'db-lbl', text: 'Size' }), bandSel),
      el('button', { class: 'fchip', type: 'button', 'data-k': 'human', 'aria-pressed': U.human, onclick: () => filt({ human: !U.human }) }, 'Human decisions'),
      el('button', { class: 'fchip', type: 'button', 'data-k': 'opencalls', 'aria-pressed': U.openCalls, onclick: () => filt({ openCalls: !U.openCalls }) }, 'Has open calls')));
  const result = el('div', { class: 'db-result' }, el('p', { class: 'sub', 'aria-live': 'polite', text: `${list.length} of ${rows.length} funders` }),
    hasFilter ? el('button', { class: 'linkbtn', type: 'button', 'data-k': 'clear', onclick: clearAll }, 'Clear filters') : null,
    exportBtn.parentElement);

  /* one row: the funder's category colour is the left rule (--bc from the bucket class) */
  const COLS = [
    { key: 'name', label: 'Funder', cls: 'c-name' }, { key: 'status', label: 'Status', cls: 'c-status' }, { key: 'fit', label: 'Fit', cls: 'c-fit' },
    { key: 'award', label: 'Award', cls: 'c-award' }, { key: 'ua', label: 'UA', cls: 'c-ua' }, { label: 'Why', cls: 'c-why' },
    { key: 'evaluated', label: 'Evaluated', cls: 'c-eval' }, { key: 'pipeline', label: 'Pipeline', cls: 'c-pipe' }, { label: 'Actions', cls: 'c-act' },
  ];
  const thead = el('thead', {}, el('tr', {}, COLS.map((c) => {
    const on = !!c.key && sortUsed.key === c.key;
    return el('th', { class: c.cls, scope: 'col', 'aria-sort': c.key ? (on ? (sortUsed.dir === 'asc' ? 'ascending' : 'descending') : 'none') : null },
      c.key ? el('button', { class: 'db-sort', type: 'button', 'data-k': 'so-' + c.key, onclick: () => filt({ sort: nextSort(sortUsed, c.key) }) }, c.label) : c.label);
  })));

  const fitCell = (r) => {
    if (r.fit == null) return el('span', { class: 'sub', text: D.UNSCORED });
    const i = el('i');
    i.style.width = `${Math.max(0, Math.min(100, r.fit))}%`;
    const bar = el('span', { class: 'db-fitbar', 'aria-hidden': 'true' }, i);
    if (r.fitMin != null) { bar.classList.add('has-tick'); bar.style.setProperty('--tick', `${Math.max(0, Math.min(100, r.fitMin))}%`); }
    if (r.fitMin != null && r.fit < r.fitMin) i.classList.add('is-low');
    return el('span', { class: 'db-fit', title: `Fit ${r.fit} of 100${r.fitMin != null ? `, minimum ${r.fitMin}` : ''}` },
      el('span', { class: 'db-fitn num', text: String(r.fit) }), bar);
  };
  const rowActions = (r) => {
    const items = [{ label: 'Open full details', onSelect: () => app.openDrawer(r.id) }];
    items.push(r.status === 'vetted' ? { label: 'Screen out', danger: true, onSelect: () => demote(app, r) } : { label: 'Promote to tracked', onSelect: () => promote(app, r) });
    if (r.human) items.push({ label: 'Release the decision', onSelect: () => release(app, r) });
    const btn = el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'act-' + r.id, 'aria-label': `Actions for ${r.name}` }, 'Actions', ico('chev'));
    el('span', {}, btn);
    menu(btn, items);
    return btn.parentElement;
  };
  const detailPanel = (r) => {
    const f = r.f, rb = app.rubric();
    const labelOf = (k) => rb?.dims?.find((d) => d.key === k)?.label || String(k).replace(/_/g, ' ');
    const dims = Array.isArray(f.fit_breakdown?.dims) ? f.fit_breakdown.dims : [];
    const reasonRows = [];
    if (r.rejectReason) reasonRows.push(el('dt', { text: 'Screened out because' }), el('dd', { text: r.rejectReason }));
    if (r.vetNote) reasonRows.push(el('dt', { text: 'Vet note' }), el('dd', { text: r.vetNote }));
    const crit = criterionRows(f, thresholds).map((c) => el('li', {},
      el('span', { class: `flag ${c.pass === true ? 'flag--ok' : c.pass === false ? 'flag--bad' : 'flag--muted'}`, text: c.pass === true ? 'Pass' : c.pass === false ? 'Fail' : 'Not checked' }),
      el('span', { class: 'db-cl' }, el('b', { text: c.label }), el('span', { class: 'sub', text: ` ${c.actual}${c.threshold ? `, ${c.threshold}` : ''}` }))));
    const dimRows = dims.map((d) => {
      const pct = d.max > 0 ? Math.max(0, Math.min(100, Math.round((d.points / d.max) * 100))) : 0;
      const bar = el('i');
      bar.style.width = `${pct}%`;
      return el('div', { class: 'db-dim' }, el('span', { text: labelOf(d.key) }), el('span', { class: 'db-bar' }, bar),
        el('span', { class: 'num', text: `${d.points} of ${d.max}` }), d.why ? el('p', { class: 'sub db-dw', text: d.why }) : null);
    });
    const reasons = Array.isArray(f.fit_reasons) ? f.fit_reasons.filter(Boolean) : [];
    const h = r.human;
    const hasBy = !!decisionParts(h).by;
    const notes = unlocked ? app.notesFor(r.id).slice(0, 2) : [];
    const action = r.status === 'vetted'
      ? el('button', { class: 'btn btn--sm btn--danger', type: 'button', 'data-k': 'dm-' + r.id, onclick: () => demote(app, r) }, 'Screen out')
      : el('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-k': 'pr-' + r.id, onclick: () => promote(app, r) }, 'Promote to tracked');
    const facts = [
      ['Geography', Array.isArray(f.geography) && f.geography.length ? f.geography.join(', ') : 'Not recorded'],
      ['Themes', Array.isArray(f.themes) && f.themes.length ? f.themes.join(', ') : 'Not recorded'],
      ['Cycle', D.CYCLES[f.cycle] || f.cycle || 'Not recorded'],
      ['Next deadline', f.next_deadline ? D.fmtDate(f.next_deadline) : 'None listed'],
      ['Amount', D.amountRange(f)],
      ['Amount confidence', f.amount_confidence || 'Not recorded'],
      ['UA eligibility', r.uaLabel],
      ['Calls', `${r.callsOpen} open, ${r.callsTotal} in total`],
      ['Discovered via', f.discovered_via || 'Not recorded'],
      ['Last verified', f.verified_at ? D.fmtDate(f.verified_at) : 'Not yet'],
    ];
    return el('div', { class: 'db-open' },
      el('div', { class: 'db-col' },
        el('section', { class: 'db-section' }, el('h3', { text: 'Reason' }),
          reasonRows.length ? el('dl', { class: 'db-dl' }, reasonRows) : el('p', { class: 'sub', text: 'No reason recorded.' })),
        r.judgment ? el('p', { class: 'db-callout', text: 'Passed every gate and was still screened out. Check the reason before leaving it that way.' }) : null,
        el('section', { class: 'db-section' }, el('h3', { text: 'Threshold checks' }), el('ul', { class: 'db-crit' }, crit)),
        el('section', { class: 'db-section' }, el('h3', { text: 'Team decision' }),
          h ? el('div', { class: 'db-human' }, hasBy ? avatar(h.by, { size: 'sm' }) : null, el('div', {},
            decisionLine(h, 'funder'),
            h.note ? el('p', { class: 'db-note', text: h.note }) : null))
            : el('p', { class: 'sub', text: 'No team decision. Automated vetting decides.' }),
          r.queue === 'pending' ? el('p', { class: 'sub', text: `Waiting for the discovery agent. Next run: ${agentRunLabel(now)}.` }) : null,
          el('div', { class: 'db-acts' }, action,
            r.human ? el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'rl-' + r.id, onclick: () => release(app, r) }, 'Release the decision') : null,
            el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'full-' + r.id, onclick: () => app.openDrawer(r.id) }, 'Open full details')))),
      el('div', { class: 'db-col' },
        el('section', { class: 'db-section' }, el('h3', { text: 'Fit breakdown' }),
          dimRows.length ? el('div', { class: 'db-dims' }, dimRows) : el('p', { class: 'sub', text: r.fit == null ? 'Not scored yet, so there is no breakdown.' : 'No breakdown recorded.' }),
          reasons.length ? el('ul', { class: 'db-reasons' }, reasons.map((x) => el('li', { text: x }))) : null),
        el('section', { class: 'db-section' }, el('h3', { text: 'Facts' }),
          el('dl', { class: 'db-dl' }, facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]),
            D.safeUrl(f.url) ? [el('dt', { text: 'Funder page' }), el('dd', {}, app.link(f.url, 'Open the page', 'linkbtn'))] : null),
          r.callsTotal ? el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'fc-' + r.id,
            onclick: () => put({ tab: 'calls', callFunder: r.id, callState: 'all', callLimit: PAGE }) },
          r.callsTotal === 1 ? 'See the call' : `See ${r.callsTotal} calls`) : null),
        el('section', { class: 'db-section' }, el('h3', { text: 'Notes' }),
          !unlocked ? el('p', { class: 'sub', text: 'Unlock to see the team notes.' })
            : notes.length ? el('ul', { class: 'db-notes' }, notes.map((n) => el('li', {},
              el('p', {}, n.actor ? el('b', { text: n.actor }) : null, el('span', { class: 'sub', text: ` ${timeAgo(n.at, now)}` })),
              el('p', { text: n.body }))))
              : el('p', { class: 'sub', text: 'No notes yet.' }))));
  };
  const rowParts = (r) => {
    const open = U.open.includes(r.id);
    const cells = [
      el('td', { class: 'c-name', 'data-label': 'Funder' }, el('button', { class: 'db-tog', type: 'button', 'data-k': 'tw-' + r.id,
        'aria-expanded': String(open), onclick: () => put({ open: toggleIn(U.open, r.id) }) },
        el('span', { class: 'db-nm-line' }, ico('chev'), el('span', { class: 'db-nm', text: r.name })),
        el('span', { class: 'db-pg' }, el('span', { class: 'db-bk' }, bucketDot(r.bucket), D.BUCKETS[r.bucket] || ''),
          r.program ? el('span', { text: r.program }) : null,
          unlocked && r.notes ? el('span', { text: `${r.notes} ${r.notes === 1 ? 'note' : 'notes'}` }) : null,
          el('span', { class: 'db-eval-inline', text: `Evaluated ${r.evaluated ? D.fmtDate(r.evaluated) : 'not recorded'}` })))),
      el('td', { class: 'c-status', 'data-label': 'Status' }, statusChip(r.status), r.queue === 'pending' ? statusChip('queue') : null, el('span', { class: 'db-pipe-inline' }, r.pipeline ? stateChip(r.pipeline) : null)),
      el('td', { class: 'c-fit', 'data-label': 'Fit' }, fitCell(r)),
      el('td', { class: 'c-award', 'data-label': 'Award' }, el('span', { class: 'num', text: r.awardText }),
        el('span', { class: `db-ua-inline${r.ua === 'unlikely' ? ' is-bad' : ''}`, text: r.uaLabel })),
      el('td', { class: `c-ua${r.ua === 'unlikely' ? ' is-bad' : ''}`, 'data-label': 'UA' }, el('span', { text: r.uaLabel })),
      el('td', { class: 'c-why', 'data-label': 'Why' },
        el('div', { class: 'db-why' }, gateChips(r.f.gates, thresholds),
          r.judgment ? el('span', { class: 'flag flag--warn', title: CRITERIA[4].hint, text: 'Judgment call' }) : null),
        el('p', { class: r.reason ? 'db-reason' : 'db-reason sub', text: r.reason || 'No reason recorded' }),
        r.aggregator ? el('p', { class: 'sub', text: AGGREGATOR_NOTE }) : null,
        r.crawler ? el('p', { class: 'sub', text: `Automated: ${r.crawler}` }) : null),
      el('td', { class: 'c-eval', 'data-label': 'Evaluated' }, el('span', { class: 'num', text: r.evaluated ? D.fmtDate(r.evaluated) : 'Not recorded' })),
      el('td', { class: 'c-pipe', 'data-label': 'Pipeline' }, r.pipeline ? stateChip(r.pipeline) : el('span', { class: 'sub', text: 'Not in pipeline' })),
      el('td', { class: 'c-act' }, rowActions(r)),
    ];
    const tr = el('tr', { class: `db-row b-${r.bucket}${open ? ' is-open' : ''}` }, cells);
    return open ? [tr, el('tr', { class: 'db-detail' }, el('td', { colspan: String(COLS.length) }, detailPanel(r)))] : [tr];
  };
  const more = list.length > shown.length
    ? el('div', { class: 'db-more' }, el('button', { class: 'btn', type: 'button', 'data-k': 'more', onclick: () => put({ limit: U.limit + PAGE }) },
      `Show ${Math.min(PAGE, list.length - shown.length)} more`))
    : null;
  const table = list.length
    ? el('div', { class: 'db-wrap' }, el('table', { class: 'db-table', 'aria-label': 'Funders' }, thead, el('tbody', {}, shown.flatMap(rowParts))))
    : el('div', { class: 'db-empty' }, el('p', { text: hasFilter || words.length ? 'No funders match these filters and search.' : 'No funders yet.' }),
      hasFilter ? el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'clear2', onclick: clearAll }, 'Clear filters') : null);

  /* calls: every call of every funder, one state at a time, optionally scoped to one funder */
  const scoped = U.callFunder ? calls.filter((c) => c.funder_id === U.callFunder) : calls;
  const callState = CALL_STATES.some(([k]) => k === U.callState) ? U.callState : 'all';
  const callCnt = callCounts(scoped);
  const callList = sortCalls(callRows(scoped, { state: callState })).filter((c) => hit(`${c.title} ${app.funderName(c.funder_id)}`));
  const callShown = callList.slice(0, U.callLimit || PAGE);
  const callsIntro = el('p', { class: 'sub db-intro', text: 'Every call the discovery agent found, for every funder. Demote takes a call out of the feed; Restore puts a hidden call back.' });
  const callChips = el('div', { class: 'db-frow', role: 'group', 'aria-label': 'Calls by state' }, CALL_STATES.map(([k, l]) =>
    el('button', { class: 'fchip', type: 'button', 'data-k': 'cs-' + k, 'aria-pressed': callState === k, onclick: () => callFilt({ callState: k }) },
      l, el('span', { class: 'db-cn num', text: String(callCnt[k]) }))));
  const callScope = U.callFunder ? el('p', { class: 'sub' }, `Only calls of ${app.funderName(U.callFunder) || 'one funder'}. `,
    el('button', { class: 'linkbtn', type: 'button', 'data-k': 'call-all', onclick: () => callFilt({ callFunder: '' }) }, 'Show every funder')) : null;
  const callResult = el('div', { class: 'db-result' }, el('p', { class: 'sub', 'aria-live': 'polite', text: `${callList.length} of ${scoped.length} calls` }));
  const callItem = (c) => {
    const u = D.safeUrl(c.url), act = callAction(c), restore = act === 'restore';
    return el('li', { class: 'db-item' },
      el('div', { class: 'db-item-main' },
        el('p', { class: 'db-item-t' }, u ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: c.title || 'Untitled call' }) : el('span', { text: c.title || 'Untitled call' })),
        el('p', { class: 'sub db-line' }, el('button', { class: 'linkbtn', type: 'button', 'data-k': 'cf-' + c.id, onclick: () => app.openDrawer(c.funder_id) }, app.funderName(c.funder_id) || 'Unknown funder'),
          el('span', { text: c.deadline ? `Due ${D.fmtDate(c.deadline)}` : 'No deadline listed' }))),
      el('div', { class: 'db-item-side' },
        el('p', {}, el('span', { class: `flag ${c.vet_status === 'vetted' ? 'flag--ok' : c.vet_status === 'rejected' ? 'flag--bad' : 'flag--warn'}`, text: c.vet_status === 'vetted' && !inFeed(c) ? 'Vetted, closed' : CALL_FEED[c.vet_status] || c.vet_status })),
        el('p', { class: 'sub', text: c.status ? `Status: ${c.status}` : 'Status not recorded' })),
      el('div', { class: 'db-item-dec' }, c.human ? decisionLine(c.human, 'call') : el('p', { class: 'sub', text: 'Automated decision' }),
        c.human?.note ? el('p', { class: 'sub db-note', text: c.human.note }) : null,
        !c.human && c.vet_status === 'rejected' ? el('p', { class: 'sub', text: 'No reason recorded.' }) : null), // calls carry no crawler reason yet
      el('div', { class: 'db-item-act' }, el('button', { class: `btn btn--sm${restore ? '' : ' btn--danger'}`, type: 'button', 'data-k': 'ca-' + c.id,
        title: restore ? 'Put this call back in the feed' : 'Take this call out of the feed',
        'aria-label': `${restore ? 'Restore' : 'Demote'} call: ${c.title || 'untitled'}`,
        onclick: () => app.act('call', c.id, act, { body: CALL_BODY[act] }) }, restore ? 'Restore' : 'Demote')));
  };
  const callsBody = callShown.length
    ? [el('ul', { class: 'db-list' }, callShown.map((c) => callItem(c))),
      callList.length > callShown.length ? el('div', { class: 'db-more' }, el('button', { class: 'btn', type: 'button', 'data-k': 'calls-more',
        onclick: () => put({ callLimit: (U.callLimit || PAGE) + PAGE }) }, `Show ${Math.min(PAGE, callList.length - callShown.length)} more`)) : null]
    : el('p', { class: 'db-empty', text: words.length ? 'No calls match the search.' : U.callFunder ? 'This funder has no calls in this group.' : CALL_EMPTY[callState] });

  /* leads, grouped by status */
  const leadGroupsShown = leadGroups(leads).map((g) => ({ ...g, items: g.items.filter((l) => hit(`${l.org} ${l.program_hint} ${l.why} ${l.note}`)) })).filter((g) => g.items.length);
  const leadItem = (l) => {
    const a = leadActions(l), buttons = [];
    if (a.queue) buttons.push(el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'lq-' + l.id, onclick: () => app.act('lead', l.id, 'queue') }, 'Queue for the agent'));
    if (a.dismiss) buttons.push(el('button', { class: 'btn btn--sm btn--danger', type: 'button', 'data-k': 'ld-' + l.id, onclick: () => app.act('lead', l.id, 'dismiss') }, 'Dismiss'));
    return el('li', { class: 'db-item' },
      el('div', { class: 'db-item-main' }, el('p', { class: 'db-item-t', text: l.org || 'Unnamed lead' }), el('p', { class: 'sub', text: l.program_hint || '' }), el('p', {}, bucketChip(l.bucket))),
      el('div', { class: 'db-item-side' }, el('p', { text: l.why || 'No reason recorded' }), l.note ? el('p', { class: 'sub', text: l.note }) : null,
        l.funder_id ? el('p', { class: 'sub' }, 'Covered by ', el('button', { class: 'linkbtn', type: 'button', 'data-k': 'lf-' + l.id, onclick: () => app.openDrawer(l.funder_id) }, app.funderName(l.funder_id) || 'a tracked funder')) : null),
      el('div', { class: 'db-item-dec' }, el('p', { class: 'sub', text: `Priority ${l.priority ?? 'not set'}` }), el('p', { class: 'sub', text: `Updated ${timeAgo(l.updated_at, now) || 'not recorded'}` }),
        l.source ? el('p', { class: 'sub', text: `Source: ${l.source}` }) : null),
      el('div', { class: 'db-item-act' }, buttons));
  };
  const leadsBody = leadGroupsShown.length
    ? leadGroupsShown.map((g) => el('section', { class: 'db-group' }, el('h3', { text: g.label }), el('span', { class: 'db-cn num', text: String(g.items.length) }),
      el('ul', { class: 'db-list' }, g.items.map(leadItem))))
    : el('p', { class: 'db-empty', text: words.length ? 'No leads match the search.' : 'No leads yet. The discovery agent adds leads for funders outside the current list.' });

  const body = U.tab === 'calls' ? [callsIntro, callChips, callScope, callResult, callsBody]
    : U.tab === 'leads' ? [el('p', { class: 'sub db-intro', text: 'Leads are funders the discovery agent found outside the list. Queue one to have the agent check it at its next run; dismiss it to drop it.' }), leadsBody]
      : [filters, result, table, more];

  root.replaceChildren(el('div', { class: 'db' }, lockNote, strip, queueBar, tabs, el('section', { id: 'db-panel', class: 'db-panel', 'aria-label': 'Database' }, body.flat())));
  if (focusKey) root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

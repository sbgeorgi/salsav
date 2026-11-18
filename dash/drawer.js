// Funder drawer. The shell owns the <dialog> (open, close, backdrop); this module fills it and owns the drawer's keys.
// Reading order: what this is and where it stands (hero with the team strip, then quick notes), why it is here when it is
// screened out or only a candidate (banner), why the score is what it is, the facts, the calls, the team's working summary,
// and one timeline of what changed. Feed text goes through el()/textContent; links through app.link (D.safeUrl).
import { ring, fitBar } from './viz.js';
import { STATUS_LABEL } from './ui.js';

const svgEl = (s) => { const t = document.createElement('template'); t.innerHTML = s; return t.content.firstElementChild; }; // viz escapes every string it receives
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const HIST_PAGE = 8;
const SECTIONS = [['ov', 'Overview'], ['qnotes', 'Notes'], ['fit', 'Score'], ['facts', 'Facts'], ['calls', 'Calls'], ['team', 'Team'], ['history', 'History']];
const OPEN_STATUS = new Set(['open', 'forecasted', 'rolling']);
const drafts = new Map(); // funder id -> quick-note text not yet sent, kept across re-renders
if (typeof window !== 'undefined') window.addEventListener('dash:lock', () => drafts.clear()); // a lock drops every unsent note at once (Node tests import this module with no window)

/* ---------- pure helpers (no DOM): tested in dash/drawer.test.mjs ---------- */
export const isTracked = (r) => (r?._status || 'vetted') === 'vetted';
const humanOf = (r) => r?._human ?? r?.human ?? null;
const noNulls = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null));
const isDemoted = (c) => c?.vet_status === 'rejected' || c?.human?.lock === 'demoted';
const human = (k) => { const s = String(k).replace(/_usd$/, '').replace(/_/g, ' '); return s[0].toUpperCase() + s.slice(1); };
const fmtVal = (k, v, money) => (v == null || v === '' ? 'none' : /_usd$/.test(k) && Number.isFinite(+v) ? money(+v) : Array.isArray(v) ? v.join(', ') : String(v));
export function diffOf(changes, money = String) {
  return Object.entries(changes || {}).filter(([, p]) => Array.isArray(p)).map(([k, p]) => `${human(k)}: ${fmtVal(k, p[0], money)} → ${fmtVal(k, p[1], money)}`).join('; ');
}

/* calls of one funder: the open ones (feed rows, grants_funder rows, registry rows merged by id) and the demoted ones.
   A demoted call is one whose registry row says rejected or whose human lock is demoted. */
export function splitCalls({ feed = [], registry = [], detail = [] } = {}) {
  const merged = new Map();
  for (const src of [feed, detail, registry]) for (const c of src || []) if (c?.id != null) merged.set(c.id, { ...(merged.get(c.id) || {}), ...noNulls(c) });
  const open = [], demoted = [];
  for (const c of merged.values()) {
    if (isDemoted(c)) demoted.push(c);
    else if (!c.status || OPEN_STATUS.has(c.status)) open.push(c);
  }
  open.sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  demoted.sort((a, b) => (Date.parse(b.human?.at || '') || 0) - (Date.parse(a.human?.at || '') || 0));
  return { open, demoted };
}

/* one team event as a heading, a from-to line and a reason; `label` maps a pipeline state, `statusLabel` a registry status */
export function teamChange(ev, { label = (s) => s, money = String, statusLabel = STATUS_LABEL } = {}) {
  const p = ev?.payload || {}, from = p.from || {}, none = (v) => v || 'no owner', amt = (v) => (v == null ? 'none' : money(v));
  switch (ev?.kind) {
    case 'update':
      if ('state' in p) return { head: `Status set to ${label(p.state)}`, diff: from.state ? `${label(from.state)} → ${label(p.state)}` : '', note: '' };
      if ('owner' in p) return { head: p.owner ? `Owner set to ${p.owner}` : 'Owner cleared', diff: 'owner' in from ? `${none(from.owner)} → ${none(p.owner)}` : '', note: '' };
      if ('ask_usd' in p) return { head: p.ask_usd == null ? 'Ask cleared' : `Ask set to ${money(p.ask_usd)}`, diff: 'ask_usd' in from ? `${amt(from.ask_usd)} → ${amt(p.ask_usd)}` : '', note: '' };
      return { head: p.notes_changed ? 'Working summary edited' : 'Team fields updated', diff: '', note: '' };
    case 'promote': return { head: 'Promoted to tracked', diff: p.from_status ? `${statusLabel[p.from_status] || p.from_status} → Tracked` : '', note: p.reason || '' };
    case 'demote': return { head: 'Screened out', diff: 'Tracked → Screened out', note: p.reason || '' };
    case 'release': return { head: 'Human lock released', diff: '', note: p.reason || '' };
    case 'call_demote': return { head: `Demoted a call: ${p.title || 'untitled'}`, diff: '', note: p.reason || '' };
    case 'call_restore': return { head: `Restored a call: ${p.title || 'untitled'}`, diff: '', note: '' };
    case 'lead_queue': return { head: 'Lead queued for the agent', diff: p.org || '', note: p.reason || '' };
    case 'lead_dismiss': return { head: 'Lead dismissed', diff: p.org || '', note: p.reason || '' };
    default: return { head: String(ev?.kind || 'Changed'), diff: '', note: '' };
  }
}

/* who did a change: a name when the server gives one; "A team member" when a person did it but the name is withheld (locked
   viewers get human.by and the vetting actor as null); otherwise "Automated" */
export const whoOf = (actor, human) => actor || (human ? 'A team member' : 'Automated');
/* the line for a call a person screened out, or null when no person did (the vetting run did) */
export function callDemotedBy(h, ago = () => '') {
  if (h?.lock !== 'demoted') return null;
  const when = h.at ? ago(h.at) : '';
  const who = h.by ? `${h.by} demoted it` : 'Demoted by a team member';
  return when ? `${who}, ${when}` : who;
}
/* the fit button's accessible name and its small line: an unscored funder says so, never a dash or "null" */
export function fitAria(score, tierLabel) {
  const tail = '. Jump to the explanation';
  if (score == null) return `Fit not scored yet${tail}`;
  return `Fit ${score}${tierLabel ? ', ' + tierLabel : ''}${tail}`;
}
export function fitNote(score, hasDims, tierLabel) {
  if (score == null) return 'Not scored yet';
  return hasDims ? (tierLabel || '') : 'Not itemized yet';
}
const VET = { registered: 'Added to the radar', rescored: 'Re-scored', verified: 'Facts re-checked', updated: 'Updated', promoted: 'Promoted to tracked', demoted: 'Screened out', released: 'Human lock released' };
const CHANGE = { initial: 'First seen', deadline: 'Deadline changed', content: 'Page changed', docs: 'New documents' };
/* one timeline, newest first. src: { team (team events), notes, vetting, changes (page changes), health, callTitles, skipHuman }.
   skipHuman drops vetting rows a person made, because the team log already has them (only when unlocked). */
export function historyItems(src = {}, opt = {}) {
  const money = opt.money || String, fmt = opt.fmtDate || String, out = [];
  for (const e of src.team || []) out.push({ ...teamChange(e, opt), kind: 'team', at: e.at, actor: e.actor || '', who: whoOf(e.actor, true) });
  for (const n of src.notes || []) out.push({ kind: 'team', at: n.at, actor: n.actor || '', who: whoOf(n.actor, true), head: n.opportunity_id ? `Note on ${src.callTitles?.[n.opportunity_id] || 'a call'}` : 'Quick note', diff: '', note: n.body || '' });
  for (const v of src.vetting || []) {
    if (src.skipHuman && (v.run_label === 'human' || v.actor)) continue;
    out.push({ kind: 'vetting', at: v.at, actor: v.actor || '', who: whoOf(v.actor, v.run_label === 'human'), head: VET[v.kind] || v.kind, diff: diffOf(v.changes, money), note: v.note || '' });
  }
  for (const c of src.changes || []) out.push({ kind: 'vetting', at: c.at, actor: '', who: whoOf('', false), head: CHANGE[c.kind] || c.kind, diff: Array.isArray(c.deadline) ? `Deadline: ${c.deadline.map((y) => (y ? fmt(y) : 'none')).join(' → ')}` : '', note: c.summary || '' });
  if (src.health) out.push({ kind: 'vetting', at: src.health.at, actor: '', who: whoOf('', false), head: 'Source checked', diff: '', note: src.health.note || '', bad: !!src.health.bad });
  return out.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}
export const historyFilter = (items, f) => (f === 'all' ? items : items.filter((x) => x.kind === f));

/* ---------- source collection: pure helpers, also used by the Method view and tested in collection.test.mjs ---------- */
export const COLLECT_SAYS = {
  calls: 'The crawler adds new calls from this source on its regular schedule, with no manual step.',
  cycle: 'The crawler reads the next deadline from the program page on its regular schedule.',
  page: 'The crawler watches this page for changes. Calls are added by research runs.',
  none: 'This source is not monitored.',
};
/* a cadence sentence from the feed when it states one (feed.collection.cadence); otherwise the sentence alone, with no number that can go stale */
export function collectSays(mode, feed) {
  const base = COLLECT_SAYS[mode] || '', cad = feed?.collection?.cadence;
  return typeof cad === 'string' && cad.trim() ? `${base} ${cad.trim()}` : base;
}
/* an older feed has no collection: treat the source as a watched page that works */
export function collectionOf(f) {
  const c = f?.collection || {};
  return { ...c, mode: c.mode || 'page', health: c.health || 'ok', open_calls: Number(c.open_calls) || 0, note: c.note || null };
}
/* null when the feed does not say (old feed), so no label is shown */
export const callOrigin = (o) => (typeof o?.source_adapter === 'string' && o.source_adapter ? 'Found by the crawler' : o?.source_adapter === null ? 'Added by a research run' : null);
/* sources that need a look first, then watched/unmonitored pages, then by name */
export function coverageRows(rows) {
  const k = (r) => { const c = collectionOf(r); return [c.health === 'ok' ? 1 : 0, c.mode === 'page' || c.mode === 'none' ? 0 : 1]; };
  return [...(rows || [])].sort((a, b) => { const x = k(a), y = k(b); return x[0] - y[0] || x[1] - y[1] || String(a.name || '').localeCompare(String(b.name || '')); });
}
/* feed.collection when present, else counted from the funders */
export function collectionTotals(feed, rows) {
  const c = feed?.collection, rs = rows || [], cs = rs.map(collectionOf), n = (k) => cs.filter((x) => x.mode === k).length;
  const listed = Number.isFinite(c?.listed) ? c.listed : rs.length;
  const auto = Number.isFinite(c?.auto) ? c.auto : n('calls') + n('cycle');
  const open = Number.isFinite(c?.open_calls) ? c.open_calls : cs.reduce((s, x) => s + x.open_calls, 0);
  const attention = Number.isFinite(c?.healthy) ? Math.max(0, listed - c.healthy) : cs.filter((x) => x.health !== 'ok').length;
  return { listed, auto, open, attention };
}
export function totalsSentence(t) {
  const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `${t.auto} of ${s(t.listed, 'source is', 'sources are')} collected automatically, ${s(t.open, 'open call', 'open calls')} found, ${t.attention ? `${t.attention} need${t.attention === 1 ? 's' : ''} attention` : 'none need attention'}.`;
}
const TONE = { ok: 'ok', failing: 'bad', stale: 'warn', thin: 'warn', off: 'line' };
export const statusEl = (app, health) => app.el('span', { class: 'chip chip--' + (TONE[health] || 'line') }, app.D.COLLECT_HEALTH[health] || health);

/* ---------- small helpers ---------- */
const liveRow = (app, r) => app.S.rows?.find((x) => x.id === r.id) || r; // the shell's row (team edits land there first)
const sec = (el, title, id, ...k) => el('section', { class: 'sec', id, 'aria-labelledby': id ? id + '-h' : null, 'data-slot': id || null }, el('h3', { id: id ? id + '-h' : null, text: title }), ...k);
const mark = (el, kind, text, title) => el('span', { class: 'mk mk--' + kind, text, title });
const cap = (el, t) => el('span', { class: 'tcap', text: t });

function dlText(r, D) {
  return r.deadline ? [D.fmtDate(r.deadline), D.countdown(r._days)] : [{ rolling: 'Rolling', invite: 'By invitation', unknown: 'No date yet' }[r._state] || 'No date yet', D.CYCLES[r.cycle] || ''];
}
const CONF = { published: ['ok', '✓ Published'], estimated: ['warn', '~ Estimated'], unknown: ['line', '? Not published'] };

/* quote with its proof state: true = found on the page, false = checked and not found, undefined = never checked */
function quote(app, q, st, url) {
  const { el, link } = app;
  const cap2 = st === true ? mark(el, 'ok', "✓ Matched on the funder's page") : st === false ? mark(el, 'warn', 'Not on the monitored page', 'The quote was not found in the page text the crawler stores. It may sit in a linked document.') : mark(el, 'line', 'Quoted by the reviewer, not auto-checked');
  return el('figure', { class: 'quote' + (st === true ? ' quote--ok' : '') }, el('blockquote', { text: q }), el('figcaption', {}, cap2, link(url, 'Open page', 'qsrc')));
}

/* ---------- keys and focus: wired once per dialog ---------- */
function step(d, dir) {
  const { S } = d._app, L = S.list || [], i = L.findIndex((x) => x.id === d.dataset.id), n = L[i + dir];
  if (i >= 0 && n) d._app.openDrawer(n.id);
}
function wire(d) {
  if (d._wired) return; d._wired = true;
  d.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') { // keep Tab inside the sheet
      const f = [...d.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !d.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !d.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      return;
    }
    if ((e.key === 'j' || e.key === 'k') && !e.target.matches?.('input,textarea,select,[contenteditable]')) { e.preventDefault(); step(d, e.key === 'j' ? 1 : -1); }
  });
  d.addEventListener('close', () => {
    d._flush?.();
    const { S } = d._app, sel = S.sel, o = d._opener;
    setTimeout(() => { // the shell re-renders the lists on close; find the same funder's row again
      let t = o && o !== document.body && o.isConnected && d._openId === sel ? o : document.querySelector(`[data-id="${CSS.escape(sel || '')}"]`);
      if (t && !t.matches('button,a[href],input,select,[tabindex]')) t = t.querySelector('button,a[href]');
      t?.focus?.({ preventScroll: true });
    }, 80);
  });
}

/* ---------- entry point ---------- */
export function renderDrawer(d, r, app) {
  const { S, el, ico } = app;
  d._flush?.(); // push the unsaved working summary before its section is rebuilt
  d._flush = null;
  if (!d.open) { d._opener = document.activeElement; d._openId = r.id; }
  const keepScroll = d.dataset.id === r.id ? d.querySelector('.dbody')?.scrollTop || 0 : 0;
  d.dataset.id = r.id; d._app = app; wire(d);

  const L = S.list || [], i = L.findIndex((x) => x.id === r.id);
  const body = el('div', { class: 'dbody' }, hero(r, app, d), notesBlock(r, app), fitSection(r, app), factsSection(r, app),
    callsSection(r, app, d), teamSection(r, app, d), historySection(r, app, d));
  d.replaceChildren(
    el('div', { class: 'dhead' }, el('span', { class: 'eyebrow', text: i >= 0 ? `Funder ${i + 1} of ${L.length}` : 'Funder details' }),
      el('span', { class: 'dstat', role: 'status', 'aria-live': 'polite' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Close details', onclick: () => d.close() }, ico('x'))),
    navBar(d, app),
    body,
    el('div', { class: 'dfoot' },
      el('button', { class: 'btn btn--sm', type: 'button', disabled: i <= 0, onclick: () => step(d, -1), 'aria-label': 'Previous funder' }, ico('chev'), 'Previous', el('kbd', { text: 'k', 'aria-hidden': 'true' })),
      el('button', { class: 'btn btn--sm', type: 'button', disabled: i < 0 || i >= L.length - 1, onclick: () => step(d, 1), 'aria-label': 'Next funder' }, 'Next', el('kbd', { text: 'j', 'aria-hidden': 'true' }), ico('chev'))));
  d.setAttribute('aria-labelledby', 'dTitle');
  if (keepScroll) body.scrollTop = keepScroll;
  trackSections(d, body);
  if (!app.reg()) app.loadRegistry().then(() => repaint(d, r, app, ['banner', 'calls']), () => {}); // thresholds and demoted calls need the registry
}

/* ---------- sticky section nav (outside the scroller, so it stays put) ---------- */
function navBar(d, app) {
  const { el } = app, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = (id) => {
    const body = d.querySelector('.dbody'); if (!body) return;
    if (id === 'ov') return body.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    body.querySelector('#' + id)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };
  return el('nav', { class: 'dnav', 'aria-label': 'Sections of this funder' }, SECTIONS.map(([id, label]) => el('button', { type: 'button', class: 'dnav-b', 'data-nav': id, onclick: () => go(id) }, label)));
}
function trackSections(d, body) {
  const mark2 = () => {
    const top = body.getBoundingClientRect().top + 48; let cur = 'ov';
    for (const [id] of SECTIONS) { const s = body.querySelector('#' + id); if (s && s.getBoundingClientRect().top <= top) cur = id; }
    d.querySelectorAll('.dnav-b').forEach((b) => b.setAttribute('aria-current', String(b.dataset.nav === cur)));
  };
  body.addEventListener('scroll', mark2, { passive: true });
  requestAnimationFrame(mark2); // the dialog opens after renderDrawer, so the section positions are only real on the next frame
}

/* ---------- repaint: rebuild named slots in place, so a change shows at once without re-rendering the whole drawer ---------- */
const SLOT = {
  strip: (r, app, d) => teamStrip(r, app, d),
  banner: (r, app, d) => bannerEl(r, app, d),
  calls: (r, app, d) => callsSection(r, app, d),
  team: (r, app, d) => teamSection(r, app, d),
  history: (r, app, d) => historySection(r, app, d),
};
function repaint(d, r, app, names) {
  if (!d.open || d.dataset.id !== r.id) return;
  if (names.includes('team')) d._flush?.(); // the working summary may hold unsent text
  const act = document.activeElement, key = act && d.contains(act) ? act.dataset.k || act.dataset.f || null : null;
  for (const n of names) { const old = d.querySelector(`[data-slot="${n}"]`); if (old) old.replaceWith(SLOT[n](r, app, d)); }
  if (key && act && !act.isConnected) d.querySelector(`[data-k="${CSS.escape(key)}"],[data-f="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
function setStat(d, text, kind) {
  const s = d.querySelector('.dstat'); if (!s) return;
  s.textContent = text; s.className = 'dstat' + (kind ? ' is-' + kind : '');
  clearTimeout(d._statT);
  if (kind === 'ok') d._statT = setTimeout(() => { if (s.isConnected) { s.textContent = ''; s.className = 'dstat'; } }, 1800);
}
/* one team write: the row changes at once (saveTeam mutates it), the affected slots repaint, the log records the change when it lands */
function commit(d, r, app, patch, names = ['strip', 'team', 'history']) {
  const p = app.saveTeam(r.id, patch);
  repaint(d, r, app, names);
  return p.then((done) => {
    if (done) { repaint(d, r, app, ['strip', 'history']); setStat(d, 'Saved', 'ok'); } // the shell's saveTeam has already logged the change in S.events, so the strip's last-change line can read it
    return done;
  });
}

/* ---------- banner: why this funder is here, and the decisions that change it ---------- */
function bannerEl(r, app, d) {
  const { S, el, ui, ico } = app, rr = liveRow(app, r), hm = humanOf(rr), st = rr._status || 'vetted', unlocked = app.unlocked();
  const slot = (kids) => el('div', { class: 'dban-slot', 'data-slot': 'banner', hidden: !kids }, kids);
  const queueOn = (rr._queue ?? S.regById?.get?.(rr.id)?.queue) === 'pending';
  if (st === 'vetted' && !hm && !queueOn) return slot(null);
  const next = ui.agentRunLabel(S.now);
  const th = app.reg()?.thresholds || {};
  const when = hm?.at ? ui.timeAgo(hm.at, S.now) : '';
  const who = hm ? `${hm.by || 'A team member'} ${hm.lock === 'demoted' ? 'screened it out' : 'promoted it'}${when ? ', ' + when : ''}` : '';
  const actions = [];
  if (!unlocked) actions.push(el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing'));
  else {
    if (st !== 'vetted') actions.push(el('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-k': 'promote', onclick: () => promote(rr, app) }, 'Promote to tracked'));
    if (hm) actions.push(el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'release', onclick: () => release(rr, app) }, 'Hand back to automated vetting'));
  }
  const title = st === 'rejected' ? 'Screened out' : st === 'candidate' ? 'Candidate, not yet vetted' : 'Tracked by hand';
  const reason = st === 'rejected' ? (rr.reject_reason || 'No reason recorded.') : st === 'candidate' ? (rr.vet_note || 'Not scored yet.') : '';
  const failing = st !== 'vetted' && rr.gates && rr.gates.pass !== true;
  return slot(el('section', { class: `dban dban--${st === 'rejected' ? 'bad' : st === 'candidate' ? 'warn' : 'pipe'}`, 'aria-labelledby': 'dbanT' },
    el('b', { id: 'dbanT', text: title }),
    who && el('p', { class: 'dban-p', text: hm?.note ? `${who}. "${hm.note}"` : who }), // the team decision leads; the automated reason follows
    reason && el('p', { class: hm ? 'dban-p sub' : 'dban-p', text: hm ? `Automated: ${reason}` : reason }),
    queueOn && el('div', { class: 'dban-g' }, ui.statusChip('queue'), next && el('span', { class: 'sub', text: `Next agent run: ${next}` })),
    failing && el('div', { class: 'dban-g' }, el('span', { class: 'sub', text: 'Failed criteria' }), ui.gateChips(rr.gates, th)),
    actions.length ? el('div', { class: 'dban-a' }, actions) : null));
}
async function promote(rr, app) { if (!app.requireUnlock()) return; if (await app.act('funder', rr.id, 'promote')) app.openDrawer(rr.id, true); }
async function release(rr, app) { if (!app.requireUnlock()) return; if (await app.act('funder', rr.id, 'release')) app.openDrawer(rr.id, true); }
async function stopTracking(rr, app) {
  if (!app.requireUnlock()) return;
  const reason = await app.ask({ title: 'Stop tracking this funder', body: 'It leaves the radar and the pipeline and moves to Screened out. It stays in the database.', label: 'Reason', placeholder: 'Why? One sentence is enough.', confirm: 'Stop tracking', danger: true, required: true, minLength: 3 });
  if (reason === null) return;
  if (await app.act('funder', rr.id, 'demote', { reason })) app.openDrawer(rr.id, true);
}
async function callAction(rr, app, o, action) {
  if (!app.requireUnlock()) return;
  const reason = await app.ask(action === 'demote'
    ? { title: 'Demote this call', body: 'It leaves the open calls and moves to Demoted calls, where anyone can restore it.', label: 'Reason', placeholder: 'Why? One sentence is enough.', confirm: 'Demote call', danger: true, required: true, minLength: 3 }
    : { title: 'Restore this call', body: 'It returns to the open calls.', label: 'Reason (optional)', placeholder: 'Why restore it? Optional.', confirm: 'Restore call' });
  if (reason === null) return;
  if (await app.act('call', o.id, action, { reason })) app.openDrawer(rr.id, true);
}

/* ---------- 1. hero: what it is, where it stands, the facts that decide ---------- */
function hero(r, app, d) {
  const { S, D, el, ui, link } = app, rr = liveRow(app, r), md = S.feed.min_days ?? 14;
  const flags = [!!S.since && rr._changedAt > S.since && el('span', { class: 'flag flag--warn', text: 'Changed' }),
    rr._manual && el('span', { class: 'flag flag--muted', title: 'This page cannot be checked automatically; verify it by hand.', text: 'Check by hand' })];
  const [dMain, dSub] = dlText(rr, D), conf = CONF[rr.amount_confidence] || CONF.unknown;
  const soon = rr._state === 'ok' && rr._days < 30;
  const fitDims = (rr.fit_breakdown?.dims || []).map((x) => ({ ...x, label: app.rubric()?.dims?.find((y) => y.key === x.key)?.label || x.key }));
  return el('header', { class: 'dhero b-' + rr.bucket, id: 'ov' },
    el('div', { class: 'dchips' },
      ui.bucketChip(rr.bucket, S.bucketLabel[rr.bucket] || rr.bucket),
      rr._lane && ui.laneChip(rr._lane, D.LANES[rr._lane]),
      !isTracked(rr) && ui.statusChip(rr._status),
      flags),
    el('h2', { id: 'dTitle', tabindex: '-1', text: rr.name }),
    rr.program && el('p', { class: 'dprog', text: rr.program }),
    tagRow(rr, el),
    bannerEl(r, app, d),
    teamStrip(r, app, d),
    rr._dq && el('div', { class: 'alert alert--bad', role: 'status', text: rr._state === 'expired' ? 'This call has closed, so it is disqualified.' : `Closes in ${rr._days} day${rr._days === 1 ? '' : 's'}. SALSAV needs at least ${md} days, so this is disqualified.` }),
    el('dl', { class: 'dkey' },
      el('div', {}, el('dt', { text: 'Deadline' }), el('dd', { class: 'num' + (rr._dq ? ' is-bad' : soon ? ' is-soon' : '') }, el('b', { text: dMain }), el('small', { text: dSub }))),
      el('div', {}, el('dt', { text: 'Award' }), el('dd', { class: 'num' }, el('b', { text: D.amountRange(rr) }), el('small', {}, mark(el, conf[0], conf[1])))),
      el('div', {}, el('dt', { text: 'Fit' }), el('dd', { class: 'num' }, el('button', { class: 'dfit', type: 'button', 'aria-label': fitAria(rr.fit_score, fitDims.length ? rr._tier?.label : ''), onclick: () => d.querySelector('#fit')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) },
        el('b', { text: rr.fit_score ?? '–' }), el('small', { text: fitNote(rr.fit_score, fitDims.length > 0, rr._tier?.label) }), fitDims.length ? svgEl(fitBar(fitDims, { w: 84, h: 4 })) : null)))),
    el('div', { class: 'dact' }, link(rr.apply_url, 'Apply', 'btn btn--primary'), link(rr.url, 'Call page', 'btn'), isTracked(rr) && moreMenu(rr, app)),
    (rr.vet_note && rr._status !== 'candidate' && el('p', { class: 'dlede', text: rr.vet_note })));
}
function tagRow(rr, el) {
  const tags = [...(rr.geography || []).map((g) => [g, 'chip chip--line']), ...(rr.themes || []).map((t) => [t, 'chip'])];
  if (!tags.length) return null;
  const shown = tags.slice(0, 8), rest = tags.slice(8);
  return el('div', { class: 'row dtags', 'aria-label': 'Geography and themes' },
    shown.map(([t, c]) => el('span', { class: c, text: t })),
    rest.length ? el('span', { class: 'chip chip--line', text: `+${rest.length}`, title: rest.map(([t]) => t).join(', ') }) : null);
}
/* "Stop tracking" sits in a More menu: findable, not prominent */
function moreMenu(rr, app) {
  const { el } = app;
  const btn = el('button', { class: 'btn btn--sm', type: 'button', 'aria-label': 'More actions for this funder' }, 'More');
  const anchor = el('span', { class: 'umenu-anchor' }, btn);
  app.ui.menu(btn, [{ label: 'Stop tracking this funder', danger: true, onSelect: () => stopTracking(rr, app) }]);
  return anchor;
}

/* the team strip: status, owner and ask, and who changed it last. A control when unlocked, read-only when locked */
function teamStrip(r, app, d) {
  const { S, D, el, ui } = app, rr = liveRow(app, r);
  if (!isTracked(rr)) return el('div', { class: 'tstrip tstrip--off', 'data-slot': 'strip', role: 'group', 'aria-label': 'Pipeline' },
    el('p', { class: 'tnote', text: rr._status === 'candidate' ? 'Not in the pipeline until it is promoted.' : 'Not in the pipeline while it is screened out.' }));
  const t = rr.team || {}, state = t.state || 'new', owner = t.owner || '', me = app.me(), ro = !app.unlocked();
  const stateCell = el('div', { class: 'tcell' }, cap(el, 'Status'), ro ? ui.stateChip(state, S.stateLabel[state]) :
    el('select', { class: `schip s-${state} tstate`, 'data-k': 'state', 'aria-label': 'Pipeline status', onchange: (e) => commit(d, r, app, { state: e.target.value }) },
      D.STATES.map((s) => el('option', { value: s, selected: s === state, text: S.stateLabel[s] || s }))));
  const ownerCell = el('div', { class: 'tcell tcell--owner' }, cap(el, 'Owner'),
    el('div', { class: 'tperson' }, ui.avatar(owner, { size: 'md', title: owner || 'Unassigned' }),
      ro ? el('span', { class: 'tname', text: owner || 'No owner yet' })
        : el('input', { type: 'text', class: 'tin', 'data-k': 'owner', maxlength: 80, value: owner, placeholder: 'Assign someone', 'aria-label': 'Owner', onchange: (e) => commit(d, r, app, { owner: e.target.value.trim() }) }),
      !ro && me && owner !== me && el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'assign-me', onclick: () => commit(d, r, app, { owner: me }) }, 'Assign to me')));
  const askCell = el('div', { class: 'tcell' }, cap(el, 'Ask'), ro ? el('span', { class: 'tval num', text: t.ask_usd != null ? D.money(t.ask_usd) : 'No ask yet' })
    : el('span', { class: 'tin-usd' }, el('i', { text: '$' }), el('input', { type: 'number', class: 'tin', 'data-k': 'ask', min: 0, step: 1000, inputmode: 'numeric', value: t.ask_usd ?? '', placeholder: rr.award_max_usd != null ? Math.round(rr.award_max_usd).toLocaleString('en-US') : 'Amount', 'aria-label': 'Ask in USD',
      onchange: (e) => commit(d, r, app, { ask_usd: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) }) })));
  return el('div', { class: 'tstrip', 'data-slot': 'strip', role: 'group', 'aria-label': 'Pipeline' },
    el('div', { class: 'tgrid' }, stateCell, ownerCell, askCell),
    lastLine(app, r, ro));
}
function lastLine(app, r, ro) {
  const { S, el, ui } = app;
  if (ro) return el('p', { class: 'tlast sub', text: 'Unlock editing to see who changed this and when.' });
  const ev = app.eventsFor(r.id)[0];
  if (!ev) return el('p', { class: 'tlast sub', text: 'No changes recorded yet.' });
  const v = ui.describeEvent(ev, S.stateLabel);
  return el('p', { class: 'tlast' }, ui.avatar(ev.actor || '', { size: 'sm', title: whoOf(ev.actor, true) }),
    el('span', {}, el('b', { text: whoOf(ev.actor, true) }), ` ${v.verb}`, v.detail ? el('span', { class: 'sub', text: ` (${v.detail})` }) : null,
      el('time', { class: 'sub', datetime: ev.at || '', text: ` · ${ui.timeAgo(ev.at, S.now)}` })));
}

/* quick notes: short attributed notes, shared with the team. The draft survives a re-render */
function notesBlock(r, app) {
  const { S, el, ico, ui } = app;
  const head = el('h3', { id: 'qn-h', text: 'Quick notes' });
  if (!app.unlocked()) drafts.clear(); // locked: unsent team note text is not kept in memory
  if (!app.unlocked()) return el('section', { id: 'qnotes', class: 'sec qnotes', 'aria-labelledby': 'qn-h' }, head,
    el('div', { class: 'invite' }, el('p', { class: 'sub', text: 'Quick notes are shared with the team. Unlock editing to read them and add your own.' }),
      el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing')));
  const onAdd = async (body) => { drafts.set(r.id, ''); const ok = await app.addNote(r.id, body); if (!ok) drafts.set(r.id, body); return ok; };
  const thread = ui.noteThread({ notes: app.notesFor(r.id).filter((n) => !n.opportunity_id), me: app.me(), canWrite: true, onAdd,
    onRemove: (n) => app.removeNote(n), now: S.now, placeholder: 'Quick note, for example "Called the program officer"' });
  const ta = thread.querySelector('.note-compose textarea');
  if (ta) { ta.value = drafts.get(r.id) || ''; ta.addEventListener('input', () => drafts.set(r.id, ta.value)); }
  return el('section', { id: 'qnotes', class: 'sec qnotes', 'aria-labelledby': 'qn-h' }, head, thread);
}

/* ---------- 2. why this score ---------- */
function fitSection(r, app) {
  const { D, el } = app, ex = D.explainFit(r, app.rubric());
  if (!ex) {
    const scored = r.fit_score != null, ringEl = svgEl(ring(r.fit_score, { size: 76, tier: r._tier?.key || '' }));
    if (!scored) { ringEl.setAttribute('aria-label', 'Fit not scored yet'); ringEl.querySelector('title')?.replaceChildren('Fit not scored yet'); } // viz words a null score as "not itemized"
    return sec(el, 'Why this score', 'fit', el('div', { class: 'fithead' }, ringEl,
      el('div', {}, el('b', { class: 'fitnote', text: scored ? 'Not itemized yet' : 'Not scored yet' }), el('p', { class: 'sub', text: scored ? 'This score comes from the earlier method, so it has no breakdown or quotes. It will be itemized at the next review.' : 'No score yet. The score and its breakdown appear once a discovery run scores this funder.' }))),
      r.fit_reasons?.length ? el('ul', { class: 'plain' }, r.fit_reasons.map((x) => el('li', { text: x }))) : null);
  }
  const by = Object.fromEntries(ex.dims.map((x) => [x.key, x]));
  const rows = ex.dims.map((x) => el('li', { class: 'fd' },
    el('div', { class: 'fd-h' }, el('b', { text: x.label }), el('span', { class: 'num fd-pts' }, String(x.points), el('i', { text: ` of ${x.max}` }))),
    el('div', { class: 'fd-bar', role: 'img', 'aria-label': `${x.points} of ${x.max} points` }, el('i', { style: `width:${x.max ? Math.min(100, (100 * x.points) / x.max) : 0}%` })),
    el('p', { class: 'fd-lv' }, el('span', { class: 'lv', text: x.levelLabel }), x.rule && el('span', { class: 'rule', text: ' ' + x.rule })),
    x.why && el('p', { class: 'fd-why', text: x.why }),
    x.quote && quote(app, x.quote, r.evidence_ok?.[x.key], x.url)));
  const need = ex.headroom.map((h) => {
    const cur = by[h.key]?.level, txt = h.key === 'eligibility' && cur === 'unknown' ? 'Confirm UA eligibility on the call page' : h.key === 'award' && cur === 'unknown' ? 'Confirm the largest single award on the call page'
      : `Show evidence for "${h.toLabel}" under ${h.label.toLowerCase()}`;
    return el('li', {}, el('span', { class: 'need-t' }, `${txt}: `, el('b', { class: 'num', text: `up to +${h.gain}` })), h.rule && el('small', { class: 'sub', text: h.rule }));
  });
  return sec(el, 'Why this score', 'fit',
    el('div', { class: 'fithead' }, svgEl(ring(ex.total, { size: 84, tier: ex.tier?.key || '' })),
      el('div', { class: 'grow' }, el('b', { class: 'fittier', text: ex.tier?.label || '' }), el('p', { class: 'sub', text: `${ex.total} of 100 points across six parts. Each part follows the rule for its level; the Method view lists every level.` }), svgEl(fitBar(ex.dims, { w: 280, h: 6 })))),
    el('ol', { class: 'fds' }, rows),
    need.length ? el('div', { class: 'need' }, el('h4', { text: 'What would raise this score' }), el('ul', { class: 'plain' }, need)) : el('p', { class: 'sub', style: 'margin-top:.6rem', text: 'Every part is already at its highest level.' }));
}

/* ---------- 3. key facts with evidence, then how the source is collected ---------- */
function factsSection(r, app) {
  const { D, el, link } = app, ev = D.evidenceLevel(r), q = r.requirements || {};
  const [dMain, dSub] = dlText(r, D);
  const reqs = [['Letter of intent', q.loi === true ? 'Required' : q.loi], ['Cost share', q.cost_share === true ? 'Required' : q.cost_share], ['Indirect cap', q.indirect_cap], ['Page limit', q.page_limit], ['Notes', q.notes]].filter((x) => x[1] && x[1] !== 'none');
  const fact = (label, key, value, extra) => {
    const e = key && r.evidence?.[key]?.quote ? r.evidence[key] : null;
    return el('div', { class: 'fact' }, el('dt', {}, label, !e && mark(el, 'line', 'Unverified')),
      el('dd', {}, value, extra, e && quote(app, e.quote, r.evidence_ok?.[key], e.url)));
  };
  const reqEl = reqs.length || q.registrations?.length ? el('ul', { class: 'plain plain--tight' }, reqs.map(([k, v]) => el('li', {}, el('b', { text: k + ': ' }), String(v))),
    q.registrations?.length ? el('li', {}, el('b', { text: 'Registrations: ' }), q.registrations.join(', ')) : null) : el('span', { class: 'sub', text: 'None listed yet' });
  const docs = (r.doc_links || []).filter((x) => D.safeUrl(x.url));
  const more = [r.requirements_text && el('p', { class: 'prose', text: r.requirements_text }), r.notes && el('p', { class: 'prose', text: r.notes })];
  return sec(el, 'Key facts', 'facts',
    el('div', { class: 'emeter', role: 'group', 'aria-label': `${ev.n} of ${ev.of} key facts backed by a quote` },
      el('p', { class: 'sub' }, el('b', { class: 'num', text: `${ev.n} of ${ev.of}` }), ' key facts are backed by a quote from the funder'),
      el('ol', {}, ev.items.map((x, j) => el('li', { class: x.ok ? 'on' : '', 'data-step': j + 1 }, el('i'), el('span', {}, x.label, el('span', { class: 'sr', text: x.ok ? ': quoted' : ': not quoted' })))))),
    el('dl', { class: 'facts' },
      fact('Deadline', 'deadline', el('span', { class: 'num' }, el('b', { text: dMain }), dSub ? ` · ${dSub}` : ''), r.deadline_note && el('p', { class: 'sub', text: r.deadline_note })),
      fact('Award', 'award', el('span', { class: 'num' }, el('b', { text: D.amountRange(r) }), ` · ${(CONF[r.amount_confidence] || CONF.unknown)[1].replace(/^\S+ /, '')}`), r.award_note && el('p', { class: 'sub', text: r.award_note })),
      fact('Can UA apply?', 'eligibility', el('b', { text: D.UA[r.ua_eligibility] || 'Unknown' }), r.eligibility_note && el('p', { class: 'sub', text: r.eligibility_note })),
      fact('Cycle', null, D.CYCLES[r.cycle] || r.cycle || 'Unknown'),
      fact('To apply', null, reqEl),
      fact('Partners needed', null, (r.partner_needed || []).length ? el('span', { class: 'row' }, r.partner_needed.map((p) => el('span', { class: 'chip chip--warn', text: p }))) : 'None named')),
    docs.length ? el('ul', { class: 'docs' }, docs.map((x) => el('li', {}, el('a', { href: D.safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'grow', text: x.label || x.url }), el('span', { class: 'chip chip--line', text: ({ pdf: 'PDF', rfp: 'RFP', nofo: 'NOFO' })[String(x.type).toLowerCase()] || 'Web' }))))) : null,
    ...more, link(r.feed_url, 'Feed', 'btn btn--sm'), collectBlock(r, app));
}
function collectBlock(r, app) {
  const { S, D, el } = app, c = collectionOf(r);
  return el('div', { class: 'subblock' }, el('h4', { text: 'How this source is collected' }),
    el('p', { class: 'ccol-h' }, el('b', { text: D.COLLECT_MODES[c.mode] || c.mode }), c.source && el('span', { class: 'sub', text: ` via ${c.source}` })),
    el('p', { class: 'ccol-s' }, statusEl(app, c.health), el('span', { class: 'sub', text: ` checked ${D.relTime(c.checked_at, S.now)}` })),
    el('p', { class: 'prose-s', text: collectSays(c.mode, S.feed) }),
    c.note && el('p', { class: 'sub', text: c.note }),
    c.verified_at && el('p', { class: 'sub', text: `Config tested ${D.fmtDate(String(c.verified_at).slice(0, 10))}` }));
}

/* ---------- 4. calls: open ones with Demote; demoted ones collapsed with who, why and Restore ---------- */
function callsSection(r, app, d) {
  const { S, D, el, ui } = app, rr = liveRow(app, r), reg = app.reg(), unlocked = app.unlocked();
  const { open, demoted } = splitCalls({
    feed: (S.feed?.opportunities || []).filter((o) => o.funder_id === r.id),
    registry: (reg?.calls || []).filter((c) => c.funder_id === r.id),
    detail: rr._detail?.opportunities || [],
  });
  const row = (o) => {
    const u = D.safeUrl(o.url) || D.safeUrl(o.apply_url), days = D.daysLeft(o.deadline, S.now), seen = o.first_seen_at && D.fmtDate(String(o.first_seen_at).slice(0, 10));
    return el('li', { class: 'call' },
      el('div', { class: 'call-main' },
        el('div', { class: 'call-t' }, u ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: o.title || 'Untitled call' }) : el('b', { text: o.title || 'Untitled call' }),
          o.status === 'forecasted' && el('span', { class: 'chip chip--line', text: 'Forecast' }),
          o.status && !OPEN_STATUS.has(o.status) && el('span', { class: 'chip chip--line', text: o.status }),
          o.vet_status === 'candidate' && el('span', { class: 'chip chip--warn', title: 'Collected automatically; the next discovery pass checks the call page and confirms or removes it', text: 'Unverified' }),
          o.human?.lock === 'promoted' && el('span', { class: 'chip chip--ok', title: 'A person kept this call', text: 'Kept by hand' })),
        el('div', { class: 'sub num' }, o.deadline ? `${D.fmtDate(o.deadline)} · ${D.countdown(days)}` : o.deadline_text || 'No date', (o.award_min_usd != null || o.award_max_usd != null) && ` · ${D.amountRange(o)}`),
        o.description && el('p', { class: 'call-d', text: o.description }),
        el('p', { class: 'sub call-o', text: [callOrigin(o), seen && `First seen ${seen}`].filter(Boolean).join(' · ') })),
      unlocked && el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'demote-' + o.id, onclick: () => callAction(rr, app, o, 'demote') }, 'Demote'));
  };
  const off = (o) => el('li', { class: 'call call--off' },
    el('div', { class: 'call-main' },
      el('div', { class: 'call-t' }, el('span', { text: o.title || 'Untitled call' })),
      el('p', { class: 'sub', text: callDemotedBy(o.human, (t) => ui.timeAgo(t, S.now)) || 'Screened out by the vetting run' }),
      o.human?.note && el('p', { class: 'call-d', text: `"${o.human.note}"` })),
    unlocked && el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'restore-' + o.id, onclick: () => callAction(rr, app, o, 'restore') }, 'Restore'));
  return sec(el, 'Open calls', 'calls',
    open.length ? el('ul', { class: 'calls' }, open.map(row)) : el('p', { class: 'sub', text: 'No open calls right now.' }),
    !unlocked && (open.length || demoted.length) ? el('p', { class: 'sub', text: 'Unlock editing to demote or restore a call.' }) : null,
    demoted.length ? el('details', { class: 'cdemoted' }, el('summary', { text: `Demoted calls (${demoted.length})` }), el('ul', { class: 'calls' }, demoted.map(off))) : null);
}

/* ---------- 5. team: the working summary and "I'm applying". Status, owner and ask live in the strip above ---------- */
function teamSection(r, app, d) {
  const { el, ico } = app, rr = liveRow(app, r);
  d._flush = null;
  if (!isTracked(rr)) return sec(el, 'Team', 'team',
    el('p', { class: 'sub', text: 'Screened-out funders have no pipeline. Promote the funder to tracked to start one.' }),
    rr.team?.notes ? el('div', { class: 'subblock' }, el('h4', { text: 'Working summary, kept from when it was tracked' }), el('p', { class: 'prose', text: rr.team.notes })) : null);
  if (!app.unlocked()) return sec(el, 'Team', 'team',
    el('div', { class: 'invite' }, el('p', { class: 'sub', text: 'Unlock editing to set the status, owner and ask, and to keep a working summary.' }),
      el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing')));
  const t = rr.team || {}, state = t.state || 'new', busy = ['applying', 'submitted', 'awarded'].includes(state);
  const ta = el('textarea', { id: 'tNotes', maxlength: 4000, placeholder: 'Contacts, angle, what you learned', 'aria-describedby': 'tNotesHint' });
  ta.value = t.notes || '';
  let timer, saved = ta.value;
  const saveNotes = () => { clearTimeout(timer); if (ta.value !== saved) { saved = ta.value; commit(d, r, app, { notes: ta.value }, ['history']); } };
  d._flush = saveNotes;
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(saveNotes, 900); });
  ta.addEventListener('blur', saveNotes);
  const mine = () => { if (!app.requireUnlock()) return; d._flush?.(); commit(d, r, app, { state: 'applying', ...(app.me() ? { owner: app.me() } : {}) }); };
  return sec(el, 'Team', 'team',
    el('label', { class: 'field' }, el('span', { class: 'field-l', text: 'Working summary' }), ta),
    el('p', { class: 'sub', id: 'tNotesHint', text: 'Shared with the team. Saves a moment after you stop typing.' }),
    !busy && el('div', { class: 'row' }, el('button', { class: 'btn btn--sm btn--primary', type: 'button', 'data-k': 'applying', onclick: mine }, "I'm applying")));
}

/* ---------- 6. history: one timeline, newest first, filtered by Team or Vetting ---------- */
function historySection(r, app, d) {
  const { S, D, el, ui } = app, rr = liveRow(app, r), unlocked = app.unlocked();
  const st = app.ui_state('drawerHistory', { filter: 'all', shown: HIST_PAGE }), reg = app.reg(), titles = {};
  for (const c of [...(S.feed?.opportunities || []), ...(reg?.calls || []), ...(rr._detail?.opportunities || [])]) if (c?.id != null) titles[c.id] = c.title;
  const fails = rr.consecutive_failures || 0;
  const health = rr.last_checked_at ? { at: rr.last_checked_at, bad: fails > 0 || !!rr._manual,
    note: [fails ? `${fails} failed check${fails === 1 ? '' : 's'} in a row` : 'No fetch problems', fails && rr.last_ok_at ? `last good read ${ui.timeAgo(rr.last_ok_at, S.now)}` : '', rr._manual ? 'cannot be checked automatically, so verify the deadline and documents by hand' : ''].filter(Boolean).join('; ') } : null;
  const items = historyItems({
    team: app.eventsFor(r.id), notes: app.notesFor(r.id), skipHuman: unlocked, callTitles: titles, health,
    vetting: rr._detail?.vetting || (S.feed?.vetting || []).filter((v) => v.funder_id === r.id),
    changes: rr._changes || [],
  }, { label: (s) => S.stateLabel[s] || s, money: D.money, fmtDate: D.fmtDate, statusLabel: STATUS_LABEL });
  const list = historyFilter(items, st.filter), shown = list.slice(0, st.shown), more = list.length - shown.length;
  const tab = (k, text) => el('button', { type: 'button', class: 'tf', 'data-f': k, 'aria-pressed': String(st.filter === k), onclick: () => { st.filter = k; st.shown = HIST_PAGE; repaint(d, r, app, ['history']); } },
    text, el('span', { class: 'tf-n num', text: String(historyFilter(items, k).length) }));
  return sec(el, 'History', 'history',
    el('div', { class: 'tfilter', role: 'group', 'aria-label': 'Show' }, tab('all', 'All'), tab('team', 'Team'), tab('vetting', 'Vetting')),
    shown.length ? el('ol', { class: 'tl' }, shown.map((x) => itemEl(x, app))) : el('p', { class: 'sub', text: 'Nothing recorded here yet.' }),
    more > 0 && el('button', { class: 'btn btn--sm', type: 'button', 'data-k': 'older', onclick: () => { st.shown += HIST_PAGE; repaint(d, r, app, ['history']); } }, `Show ${Math.min(more, HIST_PAGE)} older`));
}
function itemEl(x, app) {
  const { el, ui, D, S } = app;
  const who = x.actor ? ui.avatar(x.actor, { size: 'sm' }) : el('span', { class: 'av av--sm av--none', title: x.who, 'aria-label': x.who });
  return el('li', { class: 'tli' + (x.bad ? ' is-bad' : '') }, who,
    el('div', { class: 'tli-b' },
      el('p', { class: 'tli-h', text: x.head }),
      x.diff && el('p', { class: 'tli-d num', text: x.diff }),
      x.note && el('p', { class: 'tli-n', text: x.note }),
      el('p', { class: 'sub tli-m' }, el('span', { text: x.who || 'Automated' }), ' · ',
        el('time', { datetime: x.at || '', title: x.at ? D.fmtDate(String(x.at).slice(0, 10)) : '', text: ui.timeAgo(x.at, S.now) }))));
}

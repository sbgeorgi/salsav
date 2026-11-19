// Pipeline view. Pure helpers are exported for node tests (dash/board.test.mjs); render() is the only DOM code.
// Moves go through app.saveTeam (optimistic, the shell rolls back on error). Two ways to move: the "Move to" menu
// (keyboard, touch, screen readers) and pointer drag for unlocked users (mouse or pen from the card body, touch from the grip).
// Text from users and the crawler goes into text nodes through app.el only.
import { BUCKETS, STATE_LABELS, TZ, fmtDate, money } from '../dashboard.js';
import { describeEvent, timeAgo, bucketKey } from './ui.js';

export const COLS = ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined'];
const HINT = { new: 'Best 12 by recommendation first', reviewing: 'Deciding whether to apply', applying: 'Proposal in progress', submitted: 'Waiting to hear back', awarded: 'Funded', declined: 'Not funded' };
export const CAP = { new: 12 }; // only Not started is capped; the other columns show every funder
export const UNASSIGNED = '__unassigned__', MINE = '__me__';
export const KINDS = [['all', 'All'], ['move', 'Moves'], ['owner', 'Assignments'], ['ask', 'Asks'], ['note', 'Notes'], ['decision', 'Decisions']];
const LIVE = ['new', 'reviewing', 'applying'];
const DECISION = new Set(['promote', 'demote', 'release', 'call_demote', 'call_restore', 'lead_queue', 'lead_dismiss']);
const TIME = (ts) => (ts instanceof Date ? ts.getTime() : Date.parse(ts || '') || 0);
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }); // en-CA prints YYYY-MM-DD
const clamp = (x) => Math.max(0, Math.min(100, Math.round(+x || 0)));
const cmpFit = (a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1) || String(a.name).localeCompare(String(b.name));
const dlRank = (r) => (r._days == null ? [1, 0] : r._days < 0 ? [2, -r._days] : [0, r._days]); // open soonest, undated, closed last

/* ---- owners ---- */
export const ownerKey = (name) => String(name || '').trim().toLowerCase();
export const ownerOf = (r) => String(r?.team?.owner || '').trim();
export function ownerPass(r, owner = '', me = '') {
  if (!owner) return true;
  if (owner === UNASSIGNED) return !ownerOf(r);
  if (owner === MINE) return !!ownerKey(me) && ownerKey(ownerOf(r)) === ownerKey(me);
  return !!ownerKey(ownerOf(r)) && ownerKey(ownerOf(r)) === ownerKey(owner);
}
/* people with their funder counts (most first) and how many are unassigned */
export function ownerGroups(rows) {
  const by = new Map();
  let unassigned = 0;
  for (const r of rows) {
    const o = ownerOf(r);
    if (!o) { unassigned++; continue; }
    const k = ownerKey(o), g = by.get(k) || { name: o, n: 0 };
    g.n++; by.set(k, g);
  }
  const people = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { people, unassigned };
}

/* ---- search, filters and columns ---- */
export function searchText(r, notes = []) {
  return [r.name, r.program, ownerOf(r), BUCKETS[r.bucket], ...(r.themes || []), r.team?.notes, ...notes.map((n) => `${n.actor || ''} ${n.body || ''}`)].filter(Boolean).join(' ');
}
/* searched: every row the global search keeps; pool: searched and owned by the owner filter */
export function pipelineRows(rows, { owner = '', me = '', match = () => true, notesFor = () => [] } = {}) {
  const searched = rows.filter((r) => match(searchText(r, notesFor(r.id))));
  return { searched, pool: searched.filter((r) => ownerPass(r, owner, me)) };
}
export function orderColumn(rows, state, recIds = []) {
  const rank = new Map(recIds.map((id, i) => [id, i]));
  const rk = (r) => (rank.has(r.id) ? rank.get(r.id) : Infinity);
  const cmp = (a, b) => {
    if (state === 'new') {
      const ra = rk(a), rb = rk(b);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return (a._dq ? 1 : 0) - (b._dq ? 1 : 0) || cmpFit(a, b);
    }
    if (state === 'reviewing' || state === 'applying') {
      const da = dlRank(a), db = dlRank(b);
      return da[0] - db[0] || da[1] - db[1] || cmpFit(a, b);
    }
    return cmpFit(a, b);
  };
  return [...rows].sort(cmp);
}
export function capColumn(list, state, showAll = false) {
  const cap = CAP[state] ?? Infinity;
  return showAll ? { shown: list, hidden: 0, cap } : { shown: list.slice(0, cap), hidden: Math.max(0, list.length - cap), cap };
}
export const usdOf = (r) => r?.team?.ask_usd ?? r?.award_max_usd ?? 0;
export function totals(list) { return { n: list.length, usd: list.reduce((t, r) => t + usdOf(r), 0) }; }
export function summarize(cols) {
  return {
    play: totals(['reviewing', 'applying', 'submitted'].flatMap((s) => cols[s] || [])),
    awarded: totals(cols.awarded || []),
    fresh: totals(cols.new || []),
  };
}
export function moneyLine(r) {
  if (r.team?.ask_usd != null) return `Ask ${money(r.team.ask_usd)}`;
  if (r.award_max_usd != null) return `Up to ${money(r.award_max_usd)}`;
  return 'Amount unknown';
}
export const shortDate = (iso) => fmtDate(iso).replace(/, \d{4}$/, '');
export function shortCountdown(days) {
  if (days == null) return '';
  if (days < 0) return 'closed';
  if (days === 0) return 'today';
  return `${days} d left`;
}

/* ---- time ---- */
export function shortAgo(ts, now = new Date()) {
  const t = TIME(ts);
  if (!t) return '';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 14 * 86400) return `${Math.round(s / 86400)} d ago`;
  return timeAgo(ts, now);
}
export function dayKey(ts) { const t = TIME(ts); return t ? DAY.format(new Date(t)) : ''; }
export function dayLabel(key, now = new Date()) {
  if (!key) return 'Earlier';
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(new Date(now.getTime() - 864e5))) return 'Yesterday';
  return fmtDate(key);
}

/* ---- team activity: team events and quick notes in one stream ---- */
export function eventKind(ev) {
  const p = ev?.payload || {};
  if (ev?.kind === 'update') {
    if ('state' in p) return 'move';
    if ('owner' in p) return 'owner';
    if ('ask_usd' in p) return 'ask';
    if (p.notes_changed) return 'note';
    return 'other';
  }
  return DECISION.has(ev?.kind) ? 'decision' : 'other';
}
export const personKey = (it) => ownerKey(it.actor) || 'automated';
export function activityItems({ events = [], notes = [] } = {}) {
  const out = [];
  for (const ev of events) out.push({ key: `ev:${ev.id ?? out.length}`, kind: eventKind(ev), at: ev.at || '', actor: ev.actor || '', funder_id: ev.funder_id, ev, body: '' });
  for (const n of notes) out.push({ key: `note:${n.id}`, kind: 'note', at: n.at || '', actor: n.actor || '', funder_id: n.funder_id, ev: null, body: n.body || '' });
  return out.sort((a, b) => TIME(b.at) - TIME(a.at) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}
export function activityPeople(items) {
  const by = new Map();
  for (const it of items) {
    const k = personKey(it), g = by.get(k) || { key: k, name: it.actor || 'Automated', n: 0 };
    g.n++; by.set(k, g);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function filterActivity(items, { kind = 'all', person = '' } = {}) {
  return items.filter((it) => (kind === 'all' || it.kind === kind) && (!person || personKey(it) === person));
}
export function groupByDay(items, now = new Date()) {
  const groups = [];
  for (const it of items) {
    const k = dayKey(it.at), g = groups[groups.length - 1];
    if (g && g.key === k) g.items.push(it);
    else groups.push({ key: k, label: dayLabel(k, now), items: [it] });
  }
  return groups;
}
export function latestEvent(events = []) {
  let best = null;
  for (const ev of events) if (!best || TIME(ev.at) > TIME(best.at)) best = ev;
  return best;
}
/* card line: "Christine → Applying" for a move, otherwise the plain verb ("Ana set owner to Ben Okafor") */
export function actionText(ev) {
  if (!ev) return '';
  const who = ev.actor || 'Automated';
  if (eventKind(ev) === 'move') return `${who} → ${STATE_LABELS[ev.payload?.state] || ev.payload?.state}`;
  return `${who} ${describeEvent(ev, STATE_LABELS).verb}`;
}
/* the funder an activity row links to; a lead event with no funder (funder_id null) has no drawer, so it reads as plain text */
export const rowTarget = (it, name = '') => (it?.funder_id ? { id: it.funder_id, name: name || 'a funder' } : null);
/* a funder with no fit score yet shows "Not scored yet" (a team-promoted funder can have none) */
export const isScored = (r) => r?.fit_score != null && Number.isFinite(+r.fit_score);

/* ---- render ---- */
const mod = { ctl: [], focus: null, at: 0, keep: null, justDragged: false };
/* the right edge fades while more columns lie beyond it: the only cue that the row scrolls sideways */
function cueMore(b) { if (b.scrollLeft + b.clientWidth < b.scrollWidth - 4) b.dataset.more = 'right'; else delete b.dataset.more; }
if (typeof window !== 'undefined') window.addEventListener('resize', () => { const b = document.querySelector('.board'); if (b) cueMore(b); }); // Node tests import this module with no window
const ROOTS = new WeakSet();
const syncRoom = (root) => root.querySelector('.board')?.classList.toggle('has-menu', !!root.querySelector('.umenu:not([hidden])'));
function onRootClick(e) {
  const root = e.currentTarget;
  if (mod.justDragged) { mod.justDragged = false; e.stopPropagation(); e.preventDefault(); return; } // the click that ends a drag
  // ui.menu only closes on clicks outside its own wrap; a click on another card's Move button stops propagation, so close the rest here
  if (e.target.closest?.('.bmove')) for (const m of mod.ctl) if (!m.wrap.contains(e.target) && m.wrap.querySelector('.umenu:not([hidden])')) m.close();
  setTimeout(() => syncRoom(root), 0);
}
function onRootKey(e) { const root = e.currentTarget; setTimeout(() => syncRoom(root), 0); }

export function render(root, app) {
  const { S, D, ui: UI } = app, el = app.el, ico = app.ico;
  const st = app.ui_state('board', { owner: '', kind: 'all', person: '', all: [], actOpen: false, limit: 25 });
  st.all ||= []; st.limit ||= 25;
  const unlocked = app.unlocked(), me = app.me(), now = S.now || new Date();
  const again = (keep) => { mod.keep = keep || null; render(root, app); };
  const L = (s) => S.stateLabel?.[s] || STATE_LABELS[s] || s; // one map: the shell's stateLabel is the same STATE_LABELS
  const menuLabel = (s) => (s === 'skip' ? 'Skip it' : L(s));
  const keep = root.querySelector('.board')?.scrollLeft || 0;
  if (!ROOTS.has(root)) { ROOTS.add(root); root.addEventListener('click', onRootClick, true); root.addEventListener('keydown', onRootKey, true); }
  mod.ctl = [];
  const live = root.querySelector(':scope > .bannounce') || el('p', { class: 'bannounce', role: 'status', 'aria-live': 'polite' });
  const announce = (msg) => { live.textContent = msg; };

  const rows = S.rows.filter((r) => !r._skip);
  const skipped = S.rows.length - rows.length;
  const { searched, pool } = pipelineRows(rows, { owner: st.owner, me, match: (t) => app.matchQ(t), notesFor: (id) => app.notesFor(id) });
  const fresh = pool.filter((r) => r.team.state === 'new' && !r._dq);
  const recIds = D.recommend(fresh, now, fresh.length).map((x) => x.row.id);
  const cols = Object.fromEntries(COLS.map((s) => [s, orderColumn(pool.filter((r) => r.team.state === s), s, recIds)]));
  const sm = summarize(cols);
  const groups = ownerGroups(searched);

  // saveTeam (dashboard.html) adds the team event to S.events before it resolves, so the overview already shows it; the board writes none
  const settled = (msg) => {
    announce(msg); app.toast(msg);
    if (root.dataset.v === 'board') again(); // the user may have left the Pipeline while the save was in flight
  };
  const move = (r, to, opts = {}) => {
    if (to === r.team.state) { mod.focus = r.id; mod.at = Date.now(); return again(`move:${r.id}`); }
    if (!app.requireUnlock()) return;
    if (opts.focus !== false) { mod.focus = r.id; mod.at = Date.now(); }
    app.saveTeam(r.id, { state: to }).then((ok) => { if (ok) settled(`${r.name} moved to ${L(to)}`); });
  };
  const assign = (r) => {
    if (!app.requireUnlock()) return;
    if (!me) return app.toast('Add your name before you take a funder', 'bad');
    mod.focus = r.id; mod.at = Date.now();
    app.saveTeam(r.id, { owner: me }).then((ok) => { if (ok) settled(`${r.name} assigned to ${me}`); });
  };
  const setOwner = (v, key) => { st.owner = st.owner === v ? '' : v; again(`owner:${key}`); };

  /* pointer drag: starts after 6px, the ghost follows the pointer, the column under it takes a placeholder, Escape or pointercancel drops nothing */
  const beginDrag = (e, r, li) => {
    if (e.button !== 0 || !app.unlocked()) return;
    const onGrip = !!e.target.closest?.('.bgrip');
    if (e.pointerType === 'touch' ? !onGrip : (!onGrip && e.target.closest?.('button, a, input, select, textarea, label, .umenu, .bnotes'))) return;
    let go = false, ghost = null, over = null, ph = null, raf = 0, dir = 0;
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
    const board = () => root.querySelector('.board');
    const colAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.bcol') || null;
    const setOver = (col) => {
      if (col === over) return;
      over?.classList.remove('over'); ph?.remove(); ph = null; over = null;
      if (col && col.dataset.state !== r.team.state) {
        over = col; col.classList.add('over');
        ph = el('li', { class: 'bplace', 'aria-hidden': 'true', text: `Drop in ${L(col.dataset.state)}` });
        col.querySelector('.bcol-list')?.append(ph);
      }
    };
    const edgeDir = (x) => { const b = board(); if (!b) return 0; const rc = b.getBoundingClientRect(); return x < rc.left + 48 ? -1 : x > rc.right - 48 ? 1 : 0; };
    const step = () => { const b = board(); if (b && dir) b.scrollLeft += dir * 12; raf = dir ? requestAnimationFrame(step) : 0; };
    const start = () => {
      mod.justDragged = true;
      window.getSelection?.()?.removeAllRanges();
      ghost = el('div', { class: 'bghost', 'aria-hidden': 'true' }, el('b', { text: r.name }), el('span', { text: 'Drop in another column' }));
      document.body.append(ghost);
      li.classList.add('is-dragging'); board()?.classList.add('is-dragging');
    };
    const end = (drop) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel); window.removeEventListener('keydown', onKey, true);
      const target = drop && go && over ? over.dataset.state : null;
      dir = 0; cancelAnimationFrame(raf); raf = 0;
      ghost?.remove(); ph?.remove(); over?.classList.remove('over'); li.classList.remove('is-dragging'); board()?.classList.remove('is-dragging');
      if (go) setTimeout(() => { mod.justDragged = false; }, 300);
      if (target) move(r, target, { focus: false });
    };
    const onMove = (ev) => {
      if (ev.pointerId !== id) return;
      if (!go) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return; go = true; start(); }
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
      setOver(colAt(ev.clientX, ev.clientY));
      const d = edgeDir(ev.clientX);
      if (d !== dir) { dir = d; if (dir && !raf) raf = requestAnimationFrame(step); }
    };
    const onUp = (ev) => { if (ev.pointerId === id) end(true); };
    const onCancel = (ev) => { if (ev.pointerId === id) end(false); };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  };

  const whenEl = (r, s) => {
    if (!r.deadline) return el('span', { class: 'bwhen', text: D.CYCLES?.[r.cycle] || 'No date yet' });
    const live = LIVE.includes(s);
    const urgent = live && r._days != null && r._days >= 0 && r._days < 30, closed = live && r._dq;
    return el('span', { class: `bwhen num${urgent ? ' urgent' : ''}${closed ? ' closed' : ''}`, title: D.countdown(r._days) },
      el('span', { text: shortDate(r.deadline) }), live ? el('small', { text: shortCountdown(r._days) }) : null);
  };

  const card = (r, s) => {
    const owner = ownerOf(r), bk = bucketKey(r.bucket);
    const notes = app.notesFor(r.id).slice().sort((a, b) => TIME(b.at) - TIME(a.at));
    const last = latestEvent(app.eventsFor(r.id));
    const btn = el('button', { class: 'btn btn--sm bmove', type: 'button', 'aria-label': `Move to: ${r.name}`, 'data-keep': `move:${r.id}` }, 'Move to', ico('chev'));
    const wrap = el('div', { class: 'bmove-wrap' }, btn);
    const menu = UI.menu(btn, D.STATES.map((x) => ({ label: x === r.team.state ? `${menuLabel(x)} (now)` : menuLabel(x), onSelect: () => move(r, x) })));
    mod.ctl.push({ wrap, close: menu.close });
    const li = el('li', { class: `bcard b-${bk}${r._dq ? ' is-closed' : ''}`, 'data-id': r.id, 'data-state': s },
      el('div', { class: 'bcard-top' },
        el('span', { class: 'bcat' }, UI.bucketDot(r.bucket), el('span', { text: S.bucketLabel?.[bk] || bk })),
        whenEl(r, s),
        unlocked ? el('span', { class: 'bgrip', 'aria-hidden': 'true', title: 'Drag to another column' }) : null),
      el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(r.id), text: r.name }),
      r.program ? el('p', { class: 'bprog', text: r.program, title: r.program }) : null,
      el('div', { class: 'bfit' },
        isScored(r) ? el('span', { class: 'bscore num', text: String(r.fit_score) }) : UI.gateChips({ scored: false }),
        isScored(r) && r._tier ? el('span', { class: 'btier', text: r._tier.label }) : null,
        isScored(r) ? el('span', { class: 'bfitbar', 'aria-hidden': 'true' }, el('i', { style: `width:${clamp(r.fit_score)}%` })) : null,
        el('span', { class: 'bmoney num', text: moneyLine(r) })),
      el('div', { class: 'bown' }, UI.ownerBadge(owner, { size: 'sm' }), r._queue === 'pending' ? UI.statusChip('queue') : null,
        unlocked && me && !owner ? el('button', { class: 'linkbtn bassign', type: 'button', onclick: () => assign(r) }, 'Assign to me') : null),
      notes.length ? el('button', { class: 'bnotes', type: 'button', 'aria-label': `${notes.length} quick notes. Open ${r.name}`, onclick: () => app.openDrawer(r.id) },
        el('b', { class: 'num', text: `${notes.length} note${notes.length === 1 ? '' : 's'}` }),
        el('span', { class: 'bnotes-text', text: `${notes[0].actor || 'Unknown'}: ${notes[0].body}` })) : null,
      el('div', { class: 'bfoot' },
        el('span', { class: 'blast', text: last ? `${actionText(last)}, ${shortAgo(last.at, now)}` : '' }),
        wrap));
    if (unlocked) li.addEventListener('pointerdown', (e) => beginDrag(e, r, li));
    return li;
  };

  const colEl = (s) => {
    const list = cols[s], showAll = st.all.includes(s), cap = capColumn(list, s, showAll), tot = totals(list);
    const toggle = () => { st.all = showAll ? st.all.filter((x) => x !== s) : [...st.all, s]; again(`more:${s}`); };
    return el('section', { class: `bcol bcol--${s}`, 'data-state': s, 'aria-label': `${L(s)}, ${list.length} funders` },
      el('header', { class: 'bcol-head' },
        el('h2', { class: 'bcol-h' }, UI.stateChip(s, L(s))),
        el('span', { class: 'bn num', text: String(list.length) }),
        el('span', { class: 'bsum num', title: 'Ask where the team set one, otherwise the largest award', text: tot.usd ? money(tot.usd) : '' })),
      el('p', { class: 'bhint', text: HINT[s] }),
      el('ul', { class: 'bcol-list' },
        cap.shown.map((r) => card(r, s)),
        list.length ? null : el('li', { class: 'bempty', text: unlocked ? 'Nothing here. Drag a funder in or use Move to.' : 'Nothing here yet.' })),
      cap.hidden > 0 || (showAll && list.length > cap.cap)
        ? el('button', { class: 'btn btn--sm bmore', type: 'button', 'data-keep': `more:${s}`, onclick: toggle }, showAll ? 'Show fewer' : `Show all ${list.length}`) : null);
  };

  const chip = (key, label, n, value, avatarEl) => el('button', { type: 'button', class: `bowner${avatarEl ? '' : ' bowner--text'}`, 'aria-pressed': st.owner === value, 'data-keep': `owner:${key}`, onclick: () => setOwner(value, key) },
    avatarEl ? el('span', { 'aria-hidden': 'true' }, avatarEl) : null,
    el('span', { class: 'bowner-name', text: label }),
    el('span', { class: 'bowner-n num', text: String(n) }));
  const chips = [chip('all', 'All', searched.length, '', null)];
  if (me) chips.push(chip('mine', 'Mine', searched.filter((r) => ownerPass(r, MINE, me)).length, MINE, UI.avatar(me, { size: 'sm' })));
  groups.people.forEach((p, i) => chips.push(chip(`p${i}`, p.name, p.n, p.name, UI.avatar(p.name, { size: 'sm' }))));
  if (groups.unassigned || st.owner === UNASSIGNED) chips.push(chip('none', 'Unassigned', groups.unassigned, UNASSIGNED, UI.avatar('', { size: 'sm' })));

  const stat = (n, label, sub) => el('div', { class: 'bstat' }, el('span', { class: 'bstat-n num', text: String(n) }), el('span', { class: 'bstat-l', text: label }), el('span', { class: 'bstat-s num', text: sub }));
  const summary = el('div', { class: 'bstats' },
    stat(sm.play.n, sm.play.n === 1 ? 'bid in play' : 'bids in play', sm.play.usd ? `${money(sm.play.usd)} asked or possible` : 'No amounts yet'),
    stat(sm.awarded.n, 'awarded', sm.awarded.usd ? `${money(sm.awarded.usd)} in total` : 'No amounts yet'),
    stat(sm.fresh.n, L('new').toLowerCase(), sm.fresh.n ? 'Recommended first' : 'Nothing waiting'));
  const toolbar = el('div', { class: 'bfilters' },
    el('div', { class: 'bowners', role: 'group', 'aria-label': 'Filter by owner' }, chips),
    el('div', { class: 'bbar-end' },
      el('span', { class: 'bcount num', text: pool.length === rows.length ? `${rows.length} funders` : `${pool.length} of ${rows.length} shown` }),
      skipped ? el('span', { class: 'bcount', text: `${skipped} skipped, hidden` }) : null,
      unlocked ? null : el('button', { class: 'btn btn--sm', type: 'button', 'data-keep': 'unlock', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock to move funders'),
      el('button', { class: 'btn btn--sm', type: 'button', onclick: () => { st.actOpen = true; again('act-toggle'); root.querySelector('#bact')?.scrollIntoView({ block: 'start' }); } }, 'Activity')));

  /* activity: side by side on wide screens, a disclosure below the board on narrow ones (CSS decides) */
  const actItem = (it) => {
    const who = it.actor || 'Automated', tg = rowTarget(it, app.funderName(it.funder_id));
    const target = tg ? el('button', { class: 'linkbtn', type: 'button', onclick: () => app.openDrawer(tg.id), text: tg.name }) : null;
    const time = el('time', { class: 'sub', datetime: it.at, text: shortAgo(it.at, now) });
    if (it.kind === 'note') return el('li', { class: 'act' }, UI.avatar(it.actor, { size: 'sm', title: who }),
      el('div', { class: 'act-body' }, el('p', {}, el('b', { text: who }), ' added a note', target ? [', ', target] : null), el('p', { class: 'act-quote', text: it.body }), time));
    const d = describeEvent(it.ev, STATE_LABELS);
    return el('li', { class: 'act' }, UI.avatar(it.actor, { size: 'sm', title: who }),
      el('div', { class: 'act-body' }, el('p', {}, el('b', { text: who }), ` ${d.verb}`, target ? [', ', target] : null, d.detail ? el('span', { class: 'act-detail', text: ` (${d.detail})` }) : null), time));
  };
  const activity = () => {
    const open = !!st.actOpen;
    const items = unlocked ? activityItems({ events: S.events || [], notes: S.notes || [] }) : [];
    const shown = filterActivity(items, { kind: st.kind, person: st.person });
    const page = shown.slice(0, st.limit), days = groupByDay(page, now);
    const filtered = st.kind !== 'all' || !!st.person;
    const reset = () => { st.kind = 'all'; st.person = ''; st.limit = 25; again('kind:all'); };
    const body = !unlocked
      ? el('div', { class: 'bact-lock' }, el('p', { text: 'Team activity shows once you unlock editing. Moves, owners, asks, notes and decisions from everyone on the team appear here.' }),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing'))
      : el('div', { class: 'bact-grid' },
        el('aside', { class: 'bact-tools', 'aria-label': 'Activity filters' },
          el('div', { class: 'seg', role: 'group', 'aria-label': 'Kind of activity' }, KINDS.map(([k, label]) => el('button', { type: 'button', 'aria-pressed': st.kind === k, 'data-keep': `kind:${k}`, onclick: () => { st.kind = k; st.limit = 25; again(`kind:${k}`); } }, label))),
          el('label', { class: 'field bfield' }, el('span', { class: 'sub', text: 'Person' }),
            el('select', { class: 'bselect', 'data-keep': 'person', onchange: (e) => { st.person = e.target.value; st.limit = 25; again('person'); } },
              el('option', { value: '', text: 'Everyone' }),
              activityPeople(items).map((p) => el('option', { value: p.key, selected: p.key === st.person, text: `${p.name} (${p.n})` }))))),
        el('div', { class: 'bact-main' },
          shown.length ? days.map((g) => el('section', { class: 'bact-day' }, el('h3', { class: 'bday', text: g.label }), el('ol', { class: 'bact-ol' }, g.items.map(actItem))))
            : el('p', { class: 'bact-empty', text: items.length && filtered ? 'No activity matches these filters.' : 'Nothing has happened yet. Moves, owners, asks, notes and decisions show here as the team works.' },
              filtered ? el('button', { class: 'linkbtn', type: 'button', onclick: reset }, ' Show all activity') : null),
          shown.length > st.limit ? el('button', { class: 'btn btn--sm bmore', type: 'button', 'data-keep': 'act-more', onclick: () => { st.limit += 25; again('act-more'); } }, `Show more (${shown.length - st.limit} left)`) : null));
    return el('section', { class: 'bact', id: 'bact', 'aria-labelledby': 'bact-h', 'data-open': open ? '' : null },
      el('header', { class: 'bact-head' },
        el('h2', { id: 'bact-h', text: 'Activity' }),
        unlocked ? el('span', { class: 'bact-n num', text: String(shown.length) }) : null,
        el('button', { class: 'btn btn--sm bact-toggle', type: 'button', 'aria-expanded': open, 'aria-controls': 'bact-body', 'data-keep': 'act-toggle', onclick: () => { st.actOpen = !open; again('act-toggle'); } }, open ? 'Hide activity' : 'Show activity', ico('chev'))),
      el('div', { class: 'bact-body', id: 'bact-body' }, body));
  };

  const boardEl = el('div', { class: 'board', role: 'group', 'aria-label': 'Funders by team status' }, COLS.map(colEl));
  root.replaceChildren(live, el('div', { class: 'bpage' }, summary, toolbar, boardEl, activity()));
  const b = root.querySelector('.board');
  if (b) { b.scrollLeft = keep; cueMore(b); b.addEventListener('scroll', () => cueMore(b), { passive: true }); }
  if (mod.keep) { root.querySelector(`[data-keep="${String(mod.keep).replace(/"/g, '\\"')}"]`)?.focus({ preventScroll: true }); mod.keep = null; }
  // a move keeps focus on the moved card's Move button for 1.5s, so keyboard users land where they were
  if (mod.focus && Date.now() - mod.at < 1500) root.querySelector(`[data-id="${String(mod.focus).replace(/"/g, '\\"')}"] .bmove`)?.focus({ preventScroll: true });
  else mod.focus = null;
  syncRoom(root);
}

/* Shared UI parts for the dashboard. Pure helpers plus DOM builders. Nothing touches the document at import time,
   so node can load this file for the tests. Text from users and the crawler always goes into text nodes. */
import { BUCKETS, STATE_LABELS, LANES, UNSCORED, money, fmtDate } from '../dashboard.js';

export const bucketKey = (b) => (b in BUCKETS ? b : 'tracker');
const el = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(a)) {
    // aria states need the literal "true"/"false" (CSS and screen readers read [aria-pressed="true"])
    if (typeof v === 'boolean' && n.startsWith('aria-')) { e.setAttribute(n, String(v)); continue; }
    if (v == null || v === false) continue;
    if (n === 'class') e.className = v; else if (n === 'text') e.textContent = v;
    else if (n.startsWith('on')) e.addEventListener(n.slice(2), v); else e.setAttribute(n, v === true ? '' : v);
  }
  for (const c of k.flat()) if (c != null && c !== false) e.append(c);
  return e;
};

/* ---- identity ---- */
export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  const first = Array.from(w[0])[0] || '';
  const last = w.length > 1 ? Array.from(w[w.length - 1])[0] || '' : Array.from(w[0])[1] || '';
  return (first + last).toUpperCase();
}
/* a stable hue slot 0..7 per name, so one person keeps one colour everywhere */
export function ownerHue(name) {
  let h = 0;
  for (const c of String(name || '').trim().toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % 8;
}
export function avatar(name, { size = 'md', title } = {}) {
  const n = String(name || '').trim(), label = title || n || 'Unassigned';
  return el('span', { class: `av av--${size} ${n ? `av-${ownerHue(n)}` : 'av--none'}`, role: 'img', title: label, 'aria-label': label }, n ? initials(n) : '?');
}

/* ---- chips and flags ---- */
export function bucketDot(bucket) { return el('i', { class: `bdot b-${bucketKey(bucket)}`, 'aria-hidden': true }); }
export function bucketChip(bucket, label) { const k = bucketKey(bucket); return el('span', { class: `bchip bchip--static b-${k}` }, label || BUCKETS[k]); }
export function stateChip(state, label) { return el('span', { class: `schip s-${state}` }, label || STATE_LABELS[state] || state); }
export const STATUS_LABEL = { vetted: 'Tracked', rejected: 'Screened out', candidate: 'Candidate', lead: 'Lead', queue: 'In agent queue' };
export function statusChip(status) { return el('span', { class: `rchip r-${status}` }, STATUS_LABEL[status] || status); }
/* one flag per criterion a funder fails; `gates` comes from the registry, `thresholds` is registry.thresholds */
export function gateChips(gates, thresholds = {}) {
  const g = gates || {}, t = thresholds || {}, out = [];
  if (g.scored === false) out.push(el('span', { class: 'flag flag--muted' }, UNSCORED));
  else {
    if (g.fit === false) out.push(el('span', { class: 'flag flag--bad' }, t.fit_min != null ? `Fit below ${t.fit_min}` : 'Fit too low'));
    if (g.ua === false) out.push(el('span', { class: 'flag flag--bad' }, 'UA unlikely'));
    if (g.award === false) out.push(el('span', { class: 'flag flag--bad' }, t.award_min_usd != null ? `Award under ${money(t.award_min_usd)}` : 'Award too small'));
  }
  return el('span', { class: 'gates' }, out);
}

/* a funder the team has progressed stays on the Radar with this flag, styled as progress and not as a rejection */
export function pipeLabel(state, labels = STATE_LABELS) { return `In pipeline: ${labels[state] || state}`; }
export function pipeFlag(state) { return el('span', { class: 'flag flag--pipe', text: pipeLabel(state) }); }
export function promotedFlag(by) { return el('span', { class: 'flag flag--promoted', text: `Promoted by ${String(by || '').trim() || 'the team'}` }); }
export function notesLabel(n) { const c = Number(n) || 0; return c === 1 ? '1 note' : `${c} notes`; }
/* the count of team notes on a funder; nothing when there are none */
export function notesBadge(n) { const c = Number(n) || 0; return c ? el('span', { class: 'nbadge', title: notesLabel(c), text: notesLabel(c) }) : null; }
export function ownerBadge(name, { size = 'sm' } = {}) {
  const n = String(name || '').trim();
  return el('span', { class: n ? 'owner' : 'owner owner--none' }, avatar(n, { size }), el('span', { class: 'owner-name', text: n || 'Unassigned' }));
}
export function laneChip(lane, label) { const k = LANES[lane] ? lane : ''; return el('span', { class: k ? `lchip l-${k}` : 'lchip', text: label || LANES[lane] || String(lane || '') }); }

/* ---- time ---- */
export function timeAgo(ts, now = new Date()) {
  const t = Date.parse(ts || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(new Date(t).toISOString().slice(0, 10));
}

/* the discovery agent's schedule: Tuesdays and Fridays at 07:00 local time (Date#getDay, Sunday = 0); database.js shows the same text */
export const AGENT_DAYS = [2, 5];
export const AGENT_HOUR = 7;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* the next Tuesday or Friday at 07:00 local time that is strictly after `now` */
export function nextAgentRun(now = new Date()) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, AGENT_HOUR, 0, 0, 0);
    if (AGENT_DAYS.includes(d.getDay()) && d.getTime() > now.getTime()) return d;
  }
  return null;
}
export const agentDaysText = () => AGENT_DAYS.map((d) => `${DAY_NAMES[d]}s`).join(' and ');
export function agentRunLabel(now = new Date()) {
  const d = nextAgentRun(now);
  return d ? `${DAY_NAMES[d.getDay()]}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${String(AGENT_HOUR).padStart(2, '0')}:00` : 'not scheduled';
}

/* ---- team events: a plain verb and detail per kind ---- */
export function describeEvent(ev, labels = STATE_LABELS) {
  const p = ev?.payload || {}, from = p.from || {}, lab = (s) => labels[s] || s;
  switch (ev?.kind) {
    case 'update':
      if (p.state) return { verb: `moved to ${lab(p.state)}`, detail: from.state ? `from ${lab(from.state)}` : '' };
      if ('owner' in p) return { verb: p.owner ? `set owner to ${p.owner}` : 'cleared the owner', detail: from.owner ? `from ${from.owner}` : '' };
      if ('ask_usd' in p) return { verb: p.ask_usd == null ? 'cleared the ask' : `set the ask to ${money(p.ask_usd)}`, detail: from.ask_usd != null ? `from ${money(from.ask_usd)}` : '' };
      return { verb: p.notes_changed ? 'edited the notes' : 'updated the team fields', detail: '' };
    case 'promote': return { verb: 'promoted to tracked', detail: p.reason || '' };
    case 'demote': return { verb: 'screened out', detail: p.reason || '' };
    case 'release': return { verb: 'released the human lock', detail: p.reason || '' };
    case 'call_demote': return { verb: 'demoted a call', detail: [p.title, p.reason].filter(Boolean).join(': ') };
    case 'call_restore': return { verb: 'restored a call', detail: p.title || '' };
    case 'lead_queue': return { verb: 'queued a lead', detail: p.org || '' };
    case 'lead_dismiss': return { verb: 'dismissed a lead', detail: [p.org, p.reason].filter(Boolean).join(': ') };
    default: return { verb: String(ev?.kind || 'changed'), detail: '' };
  }
}
/* ---- notes: composer (Enter saves, Shift+Enter newline) and the list ---- */
export function noteThread({ notes = [], me = '', canWrite = false, onAdd, onRemove, now = new Date(), placeholder = 'Add a note' } = {}) {
  const ta = el('textarea', { rows: 2, maxlength: 2000, placeholder, 'aria-label': 'Note', disabled: !canWrite });
  const save = async () => {
    const body = ta.value.trim();
    if (!body || !canWrite || !onAdd) return;
    const ok = await onAdd(body);
    if (ok !== false) ta.value = '';
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } });
  const composer = el('div', { class: 'note-compose' }, ta,
    el('div', { class: 'note-actions' }, el('button', { class: 'btn btn--sm', type: 'button', disabled: !canWrite, onclick: save }, 'Save note')),
    canWrite ? null : el('p', { class: 'sub', text: 'Unlock to add notes.' }));
  const items = notes.map((n) => el('li', { class: 'note' }, avatar(n.actor, { size: 'sm' }),
    el('div', { class: 'note-body' },
      el('p', { class: 'note-meta' }, el('b', { text: n.actor || 'Unknown' }), el('time', { class: 'sub', datetime: n.at || '', text: ` ${timeAgo(n.at, now)}` })),
      el('p', { class: 'note-text', text: n.body }),
      canWrite && onRemove && n.actor === me ? el('button', { class: 'linkbtn', type: 'button', 'aria-label': `Remove note from ${n.actor || 'unknown'}`, onclick: () => onRemove(n) }, 'Remove') : null)));
  return el('div', { class: 'notes' }, composer, notes.length ? el('ol', { class: 'note-list' }, items) : el('p', { class: 'sub', text: 'No notes yet.' }));
}

/* ---- popover menu: button opens a list of actions; Escape and outside clicks close it ---- */
export function menu(button, items = []) {
  const wrap = button.parentElement;
  wrap.classList.add('umenu-wrap');
  const list = el('ul', { class: 'umenu', role: 'menu', hidden: true });
  for (const it of items) {
    list.append(el('li', { role: 'none' }, el('button', { class: `umenu-item${it.danger ? ' is-danger' : ''}`, type: 'button', role: 'menuitem', tabindex: '-1', onclick: () => { close(false); it.onSelect?.(); } }, it.label)));
  }
  wrap.append(list);
  const entries = () => [...list.querySelectorAll('[role="menuitem"]')];
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  function open() {
    list.hidden = false; button.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', outside);
    (entries()[0] || list).focus();
  }
  function close(refocus = true) {
    if (list.hidden) return;
    list.hidden = true; button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside);
    if (refocus) button.focus();
  }
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (e) => { e.stopPropagation(); if (list.hidden) open(); else close(); });
  wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) close(false); }); // Tab out of the menu closes it
  list.addEventListener('keydown', (e) => {
    const xs = entries(), i = xs.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); xs[(i + (e.key === 'ArrowDown' ? 1 : -1) + xs.length) % xs.length]?.focus(); }
  });
  return { open, close: () => close() };
}

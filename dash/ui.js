/* Shared UI parts for the dashboard. Pure helpers plus DOM builders. Nothing touches the document at import time,
   so node can load this file for the tests. Text from users and the crawler always goes into text nodes. */
import { BUCKETS, STATE_LABELS, LANES, UNSCORED, money, fmtDate } from '../dashboard.js';

export const bucketKey = (b) => (b in BUCKETS ? b : 'tracker');
export const el = (t, a = {}, ...k) => {
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
const SVG_NS = 'http://www.w3.org/2000/svg';
/* the one SVG builder: strings become text nodes, null children are dropped */
export const sv = (t, a = {}, ...k) => { const e = document.createElementNS(SVG_NS, t); for (const [n, v] of Object.entries(a)) if (v != null && v !== false) e.setAttribute(n, v === true ? '' : v); for (const c of k.flat()) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c); return e; };

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
    case 'mark_set': return { verb: `bookmarked as ${p.label || 'a bookmark'}`, detail: [p.item_kind === 'funder' ? '' : p.name, p.note].filter(Boolean).join(': ') };
    case 'mark_clear': return { verb: 'removed the bookmark', detail: p.item_kind === 'funder' ? '' : p.name || '' };
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

/* ---- popover menu: button opens a list of actions; Escape and outside clicks close it ----
   item: { label, onSelect, danger?, checked? (radio), icon? (Node), hint?, sep? }. fixed: position the list in the viewport (placeBox),
   for rows inside an overflow:clip table wrap */
export function placeBox(a, w, h, vw, vh, gap = 6, pad = 8) {
  let top = a.bottom + gap;
  if (top + h > vh - pad && a.top - gap - h >= pad) top = a.top - gap - h;
  return { left: Math.max(pad, Math.min(a.left, vw - w - pad)), top };
}
export function menu(button, items = [], { fixed = false } = {}) {
  const wrap = button.parentElement;
  wrap.classList.add('umenu-wrap');
  const list = el('ul', { class: fixed ? 'umenu umenu--fixed' : 'umenu', role: 'menu', hidden: true, 'aria-label': button.getAttribute('aria-label') || button.textContent.trim() || 'Menu' });
  for (const it of items) {
    if (it.sep) { list.append(el('li', { role: 'separator', class: 'umenu-sep' })); continue; }
    const rich = it.icon || it.hint, radio = it.checked !== undefined;
    list.append(el('li', { role: 'none' }, el('button', {
      class: `umenu-item${it.danger ? ' is-danger' : ''}${rich ? ' umenu-item--rich' : ''}`, type: 'button', role: radio ? 'menuitemradio' : 'menuitem',
      'aria-checked': radio ? !!it.checked : null, tabindex: '-1', onclick: () => { close(true); it.onSelect?.(); },
    }, it.icon, rich ? el('span', { class: 'umenu-label', text: it.label }) : it.label, it.hint ? el('small', { class: 'umenu-hint', text: it.hint }) : null)));
  }
  wrap.append(list);
  const entries = () => [...list.querySelectorAll('[role^="menuitem"]')];
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  const place = () => { const p = placeBox(button.getBoundingClientRect(), list.offsetWidth, list.offsetHeight, innerWidth, innerHeight); list.style.left = `${p.left}px`; list.style.top = `${p.top}px`; };
  const onResize = () => close(false);
  function open() {
    list.hidden = false; button.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', outside, true); // capture: controls that stop propagation (mk-wrap, other menus) still close it
    if (fixed) { place(); addEventListener('scroll', place, true); addEventListener('resize', onResize); }
    (entries().find((x) => x.getAttribute('aria-checked') === 'true') || entries()[0] || list).focus();
  }
  function close(refocus = true) {
    if (list.hidden) return;
    list.hidden = true; button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside, true);
    if (fixed) { removeEventListener('scroll', place, true); removeEventListener('resize', onResize); }
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
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); xs[e.key === 'Home' ? 0 : xs.length - 1]?.focus(); }
  });
  return { open, close: () => close() };
}

/* ---- bookmarks: one ribbon control for funders, calls and leads. The shell owns the state; these builders are stateless ---- */
export const MARK_EFFECTS = { none: 'Label only', follow: 'Agent keeps following', hide: 'Hidden, agent ignores' };
export const MARK_PATH = 'M6 3h12v18l-6-4-6 4z';
const hueOf = (d) => Math.min(7, Math.max(0, Math.trunc(Number(d?.hue)) || 0));
/* colour sits on the svg (mk-<hue> sets --mk); the .dash button rule would override it on a button */
export function markGlyph(def, size = 16) {
  return sv('svg', { class: `mk-ico${def ? ` mk-${hueOf(def)} is-set` : ''}${def?.effect === 'hide' ? ' is-hide' : ''}`, viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' }, sv('path', { d: MARK_PATH }));
}
export function markChip(def, note = '') {
  return def ? el('span', { class: `mchip mk-${hueOf(def)}`, title: note || null }, markGlyph(def, 12), el('span', { text: def.label })) : null;
}
export function markAria(name, def, team) {
  if (!team) return def ? `Bookmarked ${def.label}. Unlock to change.` : `Bookmark ${name}. Unlock to change.`;
  return def ? `Bookmark ${name}: ${def.label}` : `Bookmark ${name}`;
}
export function markItems({ def, defs = [], note = '', onPick, onNote, onManage } = {}) {
  const out = defs.map((d) => ({ label: d.label, icon: markGlyph(d), hint: d.effect === 'none' ? null : MARK_EFFECTS[d.effect], checked: d.id === def?.id, onSelect: () => { if (d.id !== def?.id) onPick?.(d.id); } }));
  const sep = () => { if (out.length) out.push({ sep: true }); };
  if (def) { sep(); out.push({ label: note ? 'Edit note...' : 'Add a note...', onSelect: () => onNote?.() }, { label: 'Remove bookmark', danger: true, onSelect: () => onPick?.(null) }); }
  sep(); out.push({ label: 'Manage bookmarks...', onSelect: () => onManage?.() });
  return out;
}
/* label: true = text always ('Bookmark' when unset); 'set' = text only when set; false = glyph alone */
export function markButton({ key, def, defs = [], team = false, name = '', note = '', label = false, busy = false, onPick, onNote, onManage, onLocked } = {}) {
  // always drawn: a locked viewer sees where bookmarks go, and the click asks for the unlock (owner, 2026-11-20)
  const text = label === true ? (def ? def.label : 'Bookmark') : label === 'set' && def ? def.label : '';
  const btn = el('button', {
    class: ['mk-btn', def && 'is-set', busy && 'is-busy', text && 'mk-btn--label', !team && 'is-ro'].filter(Boolean).join(' '), type: 'button', 'data-mark': key,
    'aria-label': markAria(name, def, team), 'aria-busy': busy ? 'true' : null, title: def ? [def.label, note].filter(Boolean).join(': ') : 'Bookmark',
  }, markGlyph(def), text ? el('span', { class: 'mk-text', text }) : null);
  // rows and cards open the drawer on click: nothing inside the control may bubble
  const wrap = el('span', { class: 'mk-wrap', onclick: (e) => e.stopPropagation() }, btn);
  if (team) menu(btn, markItems({ def, defs, note, onPick, onNote, onManage }), { fixed: true });
  else btn.addEventListener('click', (e) => { e.stopPropagation(); onLocked?.(); });
  return wrap;
}
/* filter chips, one per active definition; same look as .fchip with the ribbon colour when on */
export function markFilter({ defs = [], selected = [], counts, onToggle } = {}) {
  if (!defs.length) return null;
  return el('div', { class: 'mk-filter' }, defs.map((d) => el('button', {
    class: `fchip mk-fchip mk-${hueOf(d)}`, type: 'button', 'aria-pressed': selected.includes(d.id), onclick: () => onToggle?.(d.id),
  }, markGlyph(d, 12), el('span', { text: d.label }), counts?.get?.(d.id) != null ? el('b', { text: String(counts.get(d.id)) }) : null)));
}

/* ---- bookmark header popover and manage dialog (stateless like the rest: the shell passes the index and the callbacks) ---- */
/* -> [{ def, items }]: only definitions that have items, in definition order, items by name */
export function markGroups(index) {
  const by = new Map();
  for (const i of index?.items?.values?.() || []) (by.get(i.mark) || by.set(i.mark, []).get(i.mark)).push(i);
  const name = (i) => String(i.name || i.id);
  return (index?.defs || []).filter((d) => by.has(d.id)).map((def) => ({ def, items: by.get(def.id).sort((a, b) => name(a).localeCompare(name(b))) }));
}
export const canAddMark = (all, max = 12) => (all || []).filter((d) => !d.retired).length < max;
const MARK_KIND = { call: 'Call', lead: 'Lead' };
const MARK_SHOW = 8;
export function markList({ index, team = true, onOpen, onFilter, onManage } = {}) {
  const groups = markGroups(index);
  const row = (i) => el('li', {}, el('button', { class: 'mk-open', type: 'button', 'data-kind': i.kind, onclick: () => onOpen?.(i) },
    el('span', { class: 'mk-open-name', text: i.name || i.id }), MARK_KIND[i.kind] ? el('span', { class: 'flag flag--muted', text: MARK_KIND[i.kind] }) : null));
  const group = ({ def, items }) => {
    const list = el('ul', { class: 'mk-items' }, items.slice(0, MARK_SHOW).map(row));
    const more = items.length > MARK_SHOW ? el('button', { class: 'linkbtn mk-more', type: 'button', onclick: (e) => { list.append(...items.slice(MARK_SHOW).map(row)); list.children[MARK_SHOW]?.querySelector('.mk-open')?.focus(); e.currentTarget.hidden = true; } }, `Show all ${items.length}`) : null;
    return el('section', { class: `mk-grp mk-${hueOf(def)}`, 'aria-label': def.label },
      el('div', { class: 'mk-grp-head' }, markGlyph(def, 14), el('span', { class: 'mk-grp-name', text: def.label }), el('span', { class: 'mk-grp-n', text: String(items.length) }),
        el('button', { class: 'linkbtn', type: 'button', 'aria-label': `Filter Radar by ${def.label}`, onclick: () => onFilter?.(def.id) }, 'Filter Radar')), list, more);
  };
  return el('div', { class: 'mk-list' },
    groups.length ? groups.map(group) : el('p', { class: 'mk-empty', text: `No bookmarks yet. ${team ? 'Use' : 'Unlock editing, then use'} the ribbon on any funder, call or lead.` }),
    el('div', { class: 'mk-foot' }, el('button', { class: 'btn btn--sm', type: 'button', onclick: () => onManage?.() }, 'Manage bookmarks...')));
}

/* eight hue chips as one radio group (arrow keys move the choice) */
function hueGroup(value, label, onPick) {
  let cur = value;
  const btns = Array.from({ length: 8 }, (_, h) => el('button', { class: `mk-sw mk-${h}`, type: 'button', role: 'radio', 'aria-label': `Colour ${h + 1}`, 'aria-checked': h === cur, tabindex: h === cur ? '0' : '-1', onclick: () => pick(h) }));
  function pick(h) { cur = h; btns.forEach((b, i) => { b.setAttribute('aria-checked', String(i === h)); b.setAttribute('tabindex', i === h ? '0' : '-1'); }); onPick(h); }
  return el('div', { class: 'mk-sws', role: 'radiogroup', 'aria-label': label, onkeydown: (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d) { e.preventDefault(); const h = (cur + d + 8) % 8; pick(h); btns[h].focus(); }
  } }, btns);
}
/* name input, hue chips and effect select around one editable {hue, label, effect}; onChange fires after every edit */
function markFields(init, name, onChange) {
  const s = { ...init };
  const input = el('input', { class: 'mk-name', type: 'text', maxlength: 32, value: s.label, 'aria-label': `${name} name`, oninput: (e) => { s.label = e.target.value; onChange(s); } });
  const eff = el('select', { class: 'mk-eff', 'aria-label': `${name} effect`, onchange: (e) => { s.effect = e.target.value; onChange(s); } },
    Object.entries(MARK_EFFECTS).map(([v, t]) => el('option', { value: v, selected: v === s.effect, text: t })));
  return { s, input, eff, sw: hueGroup(s.hue, `${name} colour`, (h) => { s.hue = h; onChange(s); }) };
}
/* a callback that returns a promise: lock the buttons while it runs, then let the caller re-derive their state */
const guarded = async (btns, fn, after) => { btns.forEach((b) => { b.disabled = true; }); try { return await fn(); } finally { btns.forEach((b) => { b.disabled = false; }); after?.(); } };
export function markManager({ all = [], counts, max = 12, onDefine, onRetire, onRestore } = {}) {
  const active = all.filter((d) => !d.retired), retired = all.filter((d) => d.retired), room = canAddMark(all, max);
  const countText = (d) => { const c = counts?.get?.(d.id) || 0; return `${c} ${c === 1 ? 'item' : 'items'}`; };
  const activeRow = (d) => {
    let base = { hue: hueOf(d), label: d.label, effect: d.effect };
    const save = el('button', { class: 'btn btn--sm', type: 'button', disabled: true, 'aria-label': `Save ${d.label}`, text: 'Save' });
    const retire = el('button', { class: 'btn btn--sm', type: 'button', 'aria-label': `Retire ${d.label}`, text: 'Retire' });
    const dirty = () => { const l = f.s.label.trim(); save.disabled = !l || (l === base.label && f.s.hue === base.hue && f.s.effect === base.effect); };
    const f = markFields(base, d.label, dirty);
    save.addEventListener('click', () => guarded([save, retire], async () => { const s = { ...f.s, label: f.s.label.trim() }; if (await onDefine?.({ id: d.id, ...s })) { base = s; save.setAttribute('aria-label', `Save ${s.label}`); retire.setAttribute('aria-label', `Retire ${s.label}`); } }, dirty));
    retire.addEventListener('click', () => guarded([save, retire], () => onRetire?.(d.id), dirty));
    return el('li', { class: 'mk-row', 'data-mark-def': d.id }, f.sw, f.input, f.eff, el('span', { class: 'mk-cnt', text: countText(d) }), el('span', { class: 'mk-acts' }, save, retire));
  };
  const retiredRow = (d) => {
    const back = el('button', { class: 'btn btn--sm', type: 'button', disabled: !room, title: room ? null : `${max} of ${max} in use`, 'aria-label': `Restore ${d.label}`, text: 'Restore' });
    back.addEventListener('click', () => guarded([back], () => onRestore?.(d.id), () => { back.disabled = !room; }));
    return el('li', { class: 'mk-row is-retired', 'data-mark-def': d.id }, markGlyph(d), el('span', { class: 'mk-name', text: d.label }), el('span', { class: 'mk-acts' }, back));
  };
  const used = new Set(active.map(hueOf));
  const add = el('button', { class: 'btn btn--sm', type: 'button', disabled: true, text: 'Add bookmark' });
  const nf = markFields({ hue: [0, 1, 2, 3, 4, 5, 6, 7].find((h) => !used.has(h)) ?? 0, label: '', effect: 'none' }, 'New bookmark', () => ready());
  const ready = () => { add.disabled = !room || !nf.s.label.trim(); };
  add.addEventListener('click', () => guarded([add], async () => { if (await onDefine?.({ label: nf.s.label.trim(), hue: nf.s.hue, effect: nf.s.effect })) { nf.s.label = ''; nf.input.value = ''; } }, ready));
  if (!room) { nf.input.disabled = true; nf.eff.disabled = true; for (const b of nf.sw.children) b.disabled = true; }
  return el('div', { class: 'mk-mgr' },
    el('ul', { class: 'mk-rows' }, active.map(activeRow)),
    retired.length ? el('h3', { class: 'mk-sub', text: 'Retired' }) : null, retired.length ? el('ul', { class: 'mk-rows' }, retired.map(retiredRow)) : null,
    el('h3', { class: 'mk-sub', text: 'New bookmark' }),
    el('div', { class: 'mk-row mk-new' }, nf.sw, nf.input, nf.eff, el('span', { class: room ? 'mk-cnt' : 'mk-cnt mk-cap', text: room ? `${active.length} of ${max} in use` : `${max} of ${max} in use` }), el('span', { class: 'mk-acts' }, add)));
}

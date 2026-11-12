// Pipeline view: funders by team state. Moves go through app.saveTeam (the shell updates optimistically and rolls back with a message).
// Card menu ("Move to") is the keyboard and touch path; native drag and drop is the desktop shortcut. Feed text goes through el() only.
import { fitBar } from './viz.js';

const COLS = ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined'];
const LABEL = { new: 'Not started' };
const HINT = { new: 'Best bets first', reviewing: 'Deciding whether to apply', applying: 'Proposal in progress', submitted: 'Waiting to hear back', awarded: 'Funded', declined: 'Not funded' };
const NEW_CAP = 5, CAP = 12;
const ui = { menu: null, all: new Set(), focus: null, at: 0, drag: null };
const svgEl = (s) => { const t = document.createElement('template'); t.innerHTML = s; return t.content.firstElementChild; }; // viz.js escapes every string it receives

export function render(root, app) {
  const { S, D, el, ico } = app, unlocked = app.unlocked(), rb = app.rubric();
  const L = (s) => LABEL[s] || S.stateLabel[s] || s;
  const usd = (r) => r.team.ask_usd ?? r.award_max_usd ?? 0;
  const dims = (r) => (r.fit_breakdown?.dims || []).map((x) => ({ ...x, label: rb?.dims?.find((d) => d.key === x.key)?.label || x.key }));
  const keep = root.querySelector('.board')?.scrollLeft || 0;
  const rows = S.rows.filter((r) => !r._skip);

  // Not started: recommended first, then the rest by fit. Closed or too-soon calls stay out of it.
  const fresh = rows.filter((r) => r.team.state === 'new' && !r._dq);
  const rec = D.recommend(fresh, S.now, fresh.length).map((x) => x.row), seen = new Set(rec);
  const rest = fresh.filter((r) => !seen.has(r)).sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1) || String(a.name).localeCompare(String(b.name)));
  const byState = (s) => s === 'new' ? [...rec, ...rest]
    : rows.filter((r) => r.team.state === s).sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1) || String(a.name).localeCompare(String(b.name)));
  const cols = Object.fromEntries(COLS.map((s) => [s, byState(s)]));
  const sum = (s) => cols[s].reduce((t, r) => t + usd(r), 0);
  const redraw = (focus) => { ui.focus = focus || null; ui.at = Date.now(); render(root, app); };

  const move = (r, to) => {
    ui.menu = null; ui.focus = r.id; ui.at = Date.now();
    if (to === r.team.state) return redraw(r.id);
    if (!app.requireUnlock()) return redraw(r.id);
    app.saveTeam(r.id, { state: to }).then((ok) => { if (ok) app.toast(`${r.name} moved to ${L(to)}`); });
  };

  const when = (r) => {
    const live = ['new', 'reviewing', 'applying'].includes(r.team.state);
    if (r.deadline) return el('span', { class: 'bwhen num' + (live && r._days != null && r._days >= 0 && r._days < 30 ? ' urgent' : '') + (r._dq && live ? ' closed' : ''), text: live ? `${D.fmtDate(r.deadline)} · ${D.countdown(r._days)}` : D.fmtDate(r.deadline) });
    return el('span', { class: 'bwhen', text: D.CYCLES[r.cycle] || 'No date yet' });
  };

  const menu = (r) => el('ul', { class: 'bmenu', id: 'mv-' + r.id, 'aria-label': `Move ${r.name} to` },
    D.STATES.map((s) => el('li', {}, el('button', { type: 'button', class: s === r.team.state ? 'cur' : '', 'aria-current': s === r.team.state ? 'true' : null, onclick: () => move(r, s) },
      s === 'skip' ? 'Skip it' : L(s), s === r.team.state && el('small', { text: ' (now)' })))));

  const card = (r) => {
    const open = ui.menu === r.id;
    const li = el('li', { class: 'bcard' + (r._dq ? ' dq' : '') + (open ? ' open' : ''), 'data-id': r.id, draggable: unlocked ? 'true' : null },
      el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(r.id) }, r.name),
      el('div', { class: 'bline' }, when(r)),
      el('div', { class: 'bfit' }, el('span', { class: 'bscore num', text: r.fit_score ?? '–' }),
        r.fit_breakdown ? [svgEl(fitBar(dims(r), { w: 120, h: 6, total: r.fit_score })), r._tier && el('small', { text: r._tier.label })] : el('small', { text: 'Not itemized yet' })),
      el('div', { class: 'bown' }, el('span', { text: r.team.owner || 'No owner' }), el('span', { class: 'num', text: r.team.ask_usd != null ? `Ask ${D.money(r.team.ask_usd)}` : r.award_max_usd != null ? `Up to ${D.money(r.award_max_usd)}` : 'Amount unknown' })),
      el('button', { class: 'btn btn--sm bmove', type: 'button', 'aria-expanded': open, 'aria-controls': open ? 'mv-' + r.id : null, onclick: () => { ui.menu = open ? null : r.id; redraw(r.id); } }, 'Move to', ico('chev')),
      open && menu(r));
    li.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.menu === r.id) { e.stopPropagation(); ui.menu = null; redraw(r.id); } });
    if (unlocked) {
      li.addEventListener('dragstart', (e) => { ui.drag = r.id; li.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); });
      li.addEventListener('dragend', () => { ui.drag = null; li.classList.remove('drag'); root.querySelectorAll('.over').forEach((n) => n.classList.remove('over')); });
    }
    return li;
  };

  const col = (s) => {
    const rs = cols[s], cap = s === 'new' ? NEW_CAP : CAP, all = ui.all.has(s), shown = all ? rs : rs.slice(0, cap);
    const sec = el('section', { class: `bcol bcol--${s}`, 'aria-labelledby': 'bc-' + s, 'data-state': s },
      el('header', {}, el('h2', { id: 'bc-' + s, text: L(s) }), el('span', { class: 'bn num', text: rs.length }),
        el('span', { class: 'bsum num', title: 'Ask where the team set one, otherwise the largest award', text: sum(s) ? D.money(sum(s)) : '' })),
      el('p', { class: 'bhint', text: HINT[s] }),
      rs.length ? el('ul', {}, shown.map(card)) : el('p', { class: 'bempty', text: unlocked ? 'Drop a funder here or use Move to.' : 'Nothing here yet.' }),
      rs.length > cap && el('button', { class: 'btn btn--sm bmore', type: 'button', 'aria-expanded': all, onclick: () => { all ? ui.all.delete(s) : ui.all.add(s); redraw(); } },
        all ? 'Show fewer' : `Show all ${rs.length}`));
    if (unlocked) {
      sec.addEventListener('dragover', (e) => { if (ui.drag) { e.preventDefault(); sec.classList.add('over'); } });
      sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('over'); });
      sec.addEventListener('drop', (e) => { e.preventDefault(); sec.classList.remove('over'); const r = S.rows.find((x) => x.id === ui.drag); ui.drag = null; if (r) move(r, s); });
    }
    return sec;
  };

  const play = ['reviewing', 'applying', 'submitted'], playN = play.reduce((t, s) => t + cols[s].length, 0);
  root.replaceChildren(...[
    el('div', { class: 'bsummary' },
      el('div', {}, el('span', { class: 'big', text: playN }), el('span', { class: 'bl', text: playN === 1 ? 'bid in play' : 'bids in play' }), el('small', { class: 'num', text: play.reduce((t, s) => t + sum(s), 0) ? `${D.money(play.reduce((t, s) => t + sum(s), 0))} asked or possible` : 'No amounts yet' })),
      el('div', {}, el('span', { class: 'big', text: cols.awarded.length }), el('span', { class: 'bl', text: 'awarded' }), el('small', { class: 'num', text: sum('awarded') ? D.money(sum('awarded')) : 'No amounts yet' })),
      el('div', {}, el('span', { class: 'big', text: cols.new.length }), el('span', { class: 'bl', text: 'not started' }), el('small', { text: 'Qualified and open to start' }))),
    unlocked ? null : el('div', { class: 'bnote' }, el('p', { text: 'You are viewing only. Unlock editing to move funders between columns; moves are saved for the whole team.' }), el('button', { class: 'btn btn--sm', type: 'button', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing')),
    el('div', { class: 'board', role: 'group', 'aria-label': 'Funders by team status' }, COLS.map(col))].filter(Boolean));
  const b = root.querySelector('.board'); b.scrollLeft = keep;
  // the shell can render twice per move, so the focus request stays valid for a moment instead of one render
  if (ui.focus && Date.now() - ui.at < 1500) root.querySelector(`[data-id="${CSS.escape(ui.focus)}"] .bmove`)?.focus({ preventScroll: true }); else ui.focus = null;
}

// Funder detail drawer. The shell owns the <dialog> (open, close, backdrop); this module fills it and owns the drawer's keys.
// The drawer answers three questions in order: should we go for it, why is the score what it is, what do we do next.
// All feed text goes through el()/textContent; links through app.link (D.safeUrl).
import { ring, fitBar } from './viz.js';

const svgEl = (s) => { const t = document.createElement('template'); t.innerHTML = s; return t.content.firstElementChild; }; // viz escapes every string it receives
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const HIST_SHOWN = 8;
let failed = null; // {id}: the last team save that did not land, shown again if the shell re-renders the drawer

export function renderDrawer(d, r, app) {
  const { S, D, el, ico } = app;
  if (d.dataset.id && d.dataset.id !== r.id) d._flush?.(); // push unsaved notes of the funder we are leaving
  if (failed && failed.id !== r.id) failed = null;
  const keepScroll = d.dataset.id === r.id ? d.querySelector('.dbody')?.scrollTop || 0 : 0;
  if (!d.open) { d._opener = document.activeElement; d._openId = r.id; }
  d.dataset.id = r.id; d._app = app; wire(d);

  const L = S.list || [], i = L.findIndex((x) => x.id === r.id);
  const body = el('div', { class: 'dbody' }, hero(r, app), fitSection(r, app), factsSection(r, app), collectSection(r, app), callsSection(r, app), teamSection(r, app, d), historySection(r, app));
  d.replaceChildren(
    el('div', { class: 'dhead' }, el('span', { class: 'eyebrow', text: i >= 0 ? `Funder ${i + 1} of ${L.length}` : 'Funder details' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Close details', onclick: () => d.close() }, ico('x'))),
    body,
    el('div', { class: 'dfoot' },
      el('button', { class: 'btn btn--sm', type: 'button', disabled: i <= 0, onclick: () => step(d, -1) }, ico('chev'), 'Previous', el('kbd', { text: 'k' })),
      el('button', { class: 'btn btn--sm', type: 'button', disabled: i < 0 || i >= L.length - 1, onclick: () => step(d, 1) }, 'Next', el('kbd', { text: 'j' }), ico('chev'))));
  d.setAttribute('aria-labelledby', 'dTitle');
  if (keepScroll) body.scrollTop = keepScroll;
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

/* ---------- small helpers ---------- */
const sec = (el, title, id, ...k) => el('section', { class: 'sec', id, 'aria-labelledby': id ? id + '-h' : null }, el('h3', { id: id ? id + '-h' : null, text: title }), ...k);
const mark = (el, kind, text, title) => el('span', { class: 'mk mk--' + kind, text, title });
const human = (k) => { const s = String(k).replace(/_usd$/, '').replace(/_/g, ' '); return s[0].toUpperCase() + s.slice(1); };

function dlText(r, D) {
  return r.deadline ? [D.fmtDate(r.deadline), D.countdown(r._days)] : [{ rolling: 'Rolling', invite: 'By invitation', unknown: 'No date yet' }[r._state] || 'No date yet', D.CYCLES[r.cycle] || ''];
}
const CONF = { published: ['ok', '✓ Published'], estimated: ['warn', '~ Estimated'], unknown: ['line', '? Not published'] };

/* quote with its proof state: true = found on the page, false = checked and not found, undefined = never checked */
function quote(app, q, st, url) {
  const { el, link } = app;
  const cap = st === true ? mark(el, 'ok', "✓ Matched on the funder's page") : st === false ? mark(el, 'warn', 'Not on the monitored page', 'The quote was not found in the page text the crawler stores. It may sit in a linked document.') : mark(el, 'line', 'Quoted by the reviewer, not auto-checked');
  return el('figure', { class: 'quote' + (st === true ? ' quote--ok' : '') }, el('blockquote', { text: q }), el('figcaption', {}, cap, link(url, 'Open page', 'qsrc')));
}

/* ---------- 1. header: should we go for it ---------- */
function hero(r, app) {
  const { S, D, el, ico, link } = app, md = S.feed.min_days ?? 14;
  const bucket = el('span', { class: 'chip chip--line', style: `--c:var(--b-${r.bucket in D.BUCKETS ? r.bucket : 'tracker'})` }, el('i', { class: 'dot' }), S.bucketLabel[r.bucket] || r.bucket);
  const lane = el('span', { class: 'chip chip--lane lane-' + r._lane, text: D.LANES[r._lane] || r._lane });
  const flags = [!!S.since && r._changedAt > S.since && el('span', { class: 'chip chip--warn', text: 'Changed' }), r._manual && el('span', { class: 'chip chip--line', title: 'This page cannot be checked automatically; verify it by hand.', text: 'Check by hand' })];
  const [dMain, dSub] = dlText(r, D), conf = CONF[r.amount_confidence] || CONF.unknown;
  const soon = r._state === 'ok' && r._days < 30;
  const fitDims = (r.fit_breakdown?.dims || []).map((x) => ({ ...x, label: app.rubric()?.dims?.find((y) => y.key === x.key)?.label || x.key }));
  return el('header', { class: 'dhero' },
    el('div', { class: 'row' }, bucket, lane, flags),
    el('h2', { id: 'dTitle', tabindex: '-1', text: r.name }),
    r.program && el('p', { class: 'dprog', text: r.program }),
    r._dq && el('div', { class: 'alert alert--bad', role: 'status', text: r._state === 'expired' ? 'This call has closed, so it is disqualified.' : `Closes in ${r._days} day${r._days === 1 ? '' : 's'}. SALSAV needs at least ${md} days, so this is disqualified.` }),
    el('dl', { class: 'dkey' },
      el('div', {}, el('dt', { text: 'Deadline' }), el('dd', { class: 'num' + (r._dq ? ' is-bad' : soon ? ' is-soon' : '') }, el('b', { text: dMain }), el('small', { text: dSub }))),
      el('div', {}, el('dt', { text: 'Award' }), el('dd', { class: 'num' }, el('b', { text: D.amountRange(r) }), el('small', {}, mark(el, conf[0], conf[1])))),
      el('div', {}, el('dt', { text: 'Fit' }), el('dd', { class: 'num' }, el('button', { class: 'dfit', type: 'button', 'aria-label': 'Fit score, jump to the explanation', onclick: () => document.getElementById('fit')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) },
        el('b', { text: r.fit_score ?? '–' }), el('small', { text: fitDims.length ? (r._tier?.label || '') : 'Not itemized yet' }), fitDims.length ? svgEl(fitBar(fitDims, { w: 84, h: 4 })) : null)))),
    el('div', { class: 'dact' }, link(r.apply_url, 'Apply', 'btn btn--primary'), link(r.url, 'Call page', 'btn')),
    r.vet_note && el('p', { class: 'dlede', text: r.vet_note }));
}

/* ---------- 2. why this score ---------- */
function fitSection(r, app) {
  const { D, el } = app, ex = D.explainFit(r, app.rubric());
  if (!ex) {
    return sec(el, 'Why this score', 'fit', el('div', { class: 'fithead' }, svgEl(ring(r.fit_score, { size: 76, tier: r._tier?.key || '' })),
      el('div', {}, el('b', { class: 'fitnote', text: 'Not itemized yet' }), el('p', { class: 'sub', text: 'This score comes from the earlier method, so it has no breakdown or quotes. It will be itemized at the next review.' }))),
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

/* ---------- 3. key facts with evidence ---------- */
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
    q.registrations?.length && el('li', {}, el('b', { text: 'Registrations: ' }), q.registrations.join(', '))) : el('span', { class: 'sub', text: 'None listed yet' });
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
    (r.themes?.length || r.geography?.length) ? el('div', { class: 'row dtags' }, (r.geography || []).map((g) => el('span', { class: 'chip chip--line', text: g })), (r.themes || []).map((t) => el('span', { class: 'chip', text: t }))) : null,
    docs.length ? el('ul', { class: 'docs' }, docs.map((x) => el('li', {}, el('a', { href: D.safeUrl(x.url), target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'grow', text: x.label || x.url }), el('span', { class: 'chip chip--line', text: ({ pdf: 'PDF', rfp: 'RFP', nofo: 'NOFO' })[String(x.type).toLowerCase()] || 'Web' }))))) : null,
    ...more, link(r.feed_url, 'Feed', 'btn btn--sm'));
}


/* ---------- how a source is collected: pure helpers, also used by the Method view and tested in collection.test.mjs ---------- */
export const COLLECT_SAYS = {
  calls: 'New calls from this source are added by the crawler twice a day, with no manual step.',
  cycle: 'The crawler reads the next deadline from the program page twice a day.',
  page: 'The crawler watches this page for changes. Calls are added by research runs.',
  none: 'This source is not monitored.',
};
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
const HEALTHY = { ok: 'ok', failing: 'bad', stale: 'warn', thin: 'warn', off: 'off' };
export const statusEl = (app, health) => app.el('span', { class: 'cstat cstat--' + (HEALTHY[health] || 'off') }, app.el('i', { class: 'cdot', 'aria-hidden': 'true' }), app.D.COLLECT_HEALTH[health] || health);

/* ---------- 3b. how this source is collected ---------- */
function collectSection(r, app) {
  const { S, D, el } = app, c = collectionOf(r);
  return sec(el, 'How this source is collected', 'collect',
    el('p', { class: 'ccol-h' }, el('b', { text: D.COLLECT_MODES[c.mode] || c.mode }), c.source && el('span', { class: 'sub', text: ` Via ${c.source}` })),
    el('p', { class: 'ccol-s' }, statusEl(app, c.health), el('span', { class: 'sub', text: ` Checked ${D.relTime(c.checked_at, S.now)}` })),
    el('p', { text: COLLECT_SAYS[c.mode] || '' }),
    c.note && el('p', { class: 'sub', text: c.note }),
    c.verified_at && el('p', { class: 'sub', text: `Config tested ${D.fmtDate(String(c.verified_at).slice(0, 10))}` }));
}

/* ---------- 4. open calls ---------- */
function callsSection(r, app) {
  const { S, D, el } = app, c = collectionOf(r);
  const calls = (S.feed.opportunities || []).filter((o) => o.funder_id === r.id).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  if (!calls.length && c.mode !== 'calls' && c.mode !== 'cycle') return null;
  return sec(el, 'Open calls', 'calls', calls.length ? el('ul', { class: 'calls' }, calls.map((o) => {
    const days = D.daysLeft(o.deadline, S.now), u = D.safeUrl(o.url) || D.safeUrl(o.apply_url), seen = o.first_seen_at && D.fmtDate(String(o.first_seen_at).slice(0, 10));
    return el('li', {}, el('div', { class: 'call-t' }, u ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: o.title }) : el('b', { text: o.title }),
      o.status === 'forecasted' ? el('span', { class: 'chip chip--line', text: 'Forecast' }) : o.status && o.status !== 'open' && el('span', { class: 'chip chip--line', text: o.status }),
      o.vet_status === 'candidate' && el('span', { class: 'chip chip--warn', title: 'Collected automatically; the next discovery pass checks the call page and confirms or removes it', text: 'Unverified' })),
      el('div', { class: 'sub num' }, o.deadline ? `${D.fmtDate(o.deadline)} · ${D.countdown(days)}` : o.deadline_text || 'No date', (o.award_min_usd != null || o.award_max_usd != null) && ` · ${D.amountRange(o)}`),
      o.description && el('p', { class: 'call-d', text: o.description }),
      el('p', { class: 'sub call-o', text: [callOrigin(o), seen && `First seen ${seen}`].filter(Boolean).join(' · ') }));
  })) : el('p', { class: 'sub', text: 'No open calls right now' }));
}

/* ---------- 5. what we do next: team ---------- */
function teamSection(r, app, d) {
  const { S, D, el, ico } = app, T = S.stateLabel;
  if (!app.unlocked()) {
    return sec(el, 'Team', 'team', el('div', { class: 'team team--locked' },
      el('div', { class: 'row' }, el('span', { class: 'chip ' + (['applying', 'submitted', 'awarded'].includes(r.team.state) ? 'chip--ok' : 'chip--line'), text: T[r.team.state] || r.team.state }), r.team.owner && el('span', { class: 'sub', text: r.team.owner }), r.team.ask_usd != null && el('span', { class: 'sub num', text: `Ask ${D.money(r.team.ask_usd)}` })),
      el('p', { class: 'sub', text: 'Unlock editing to take this funder, set a status and an ask, or add notes.' }),
      el('button', { class: 'btn btn--primary', type: 'button', onclick: () => app.requireUnlock() }, ico('lock'), 'Unlock editing')));
  }
  const stat = el('span', { class: 'tstat', role: 'status', 'aria-live': 'polite' });
  const say = (t, kind) => { const n = d.querySelector('.tstat') || stat; n.textContent = t; n.className = 'tstat' + (t ? ' on ' + kind : ''); };
  if (failed?.id === r.id) say('Could not save', 'bad');
  let seq = 0;
  const save = (patch) => { failed = null; const k = ++seq; say('Saving', 'busy');
    return app.saveTeam(r.id, patch).then((done) => { if (!done) failed = { id: r.id }; if (k === seq || !done) { say(done ? 'Saved' : 'Could not save', done ? 'ok' : 'bad'); if (done) setTimeout(() => k === seq && say(''), 2200); } return done; }); };
  const st = el('select', { id: 'tState' }, D.STATES.map((s) => el('option', { value: s, selected: s === r.team.state, text: T[s] })));
  const ow = el('input', { id: 'tOwner', type: 'text', maxlength: 80, value: r.team.owner || '', placeholder: 'Who is writing this?' });
  const ask = el('input', { id: 'tAsk', type: 'number', min: 0, step: 1000, inputmode: 'numeric', value: r.team.ask_usd ?? '', placeholder: r.award_max_usd != null ? String(r.award_max_usd) : 'Amount you will request' });
  const nt = el('textarea', { id: 'tNotes', maxlength: 4000, placeholder: 'Contacts, angle, what you learned' }); nt.value = r.team.notes || '';
  let timer, saved = nt.value;
  const saveNotes = () => { clearTimeout(timer); if (nt.value !== saved) { saved = nt.value; save({ notes: nt.value }); } };
  d._flush = saveNotes;
  st.addEventListener('change', () => save({ state: st.value }));
  ow.addEventListener('change', () => save({ owner: ow.value.trim() }));
  ask.addEventListener('change', () => save({ ask_usd: ask.value === '' ? null : Math.max(0, Math.round(Number(ask.value))) }));
  nt.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(saveNotes, 900); }); nt.addEventListener('blur', saveNotes);
  const mine = () => { st.value = 'applying'; const patch = { state: 'applying' }; if (S.me) { patch.owner = S.me; ow.value = S.me; } save(patch); };
  return sec(el, 'Team', 'team', el('div', { class: 'team' },
    el('div', { class: 'team-h' }, el('span', { class: 'sub', text: 'Changes save on their own.' }), stat),
    el('div', { class: 'team-g' }, el('label', {}, 'Status', st), el('label', {}, 'Owner', ow)),
    el('label', {}, 'Ask in USD', el('span', { class: 'usd' }, el('i', { text: '$' }), ask), el('small', { text: r.award_max_usd != null ? `Left empty, the pipeline counts the largest award, ${D.money(r.award_max_usd)}.` : 'Left empty, the pipeline counts nothing for this funder.' })),
    el('label', {}, 'Notes', nt),
    !['applying', 'submitted', 'awarded'].includes(r.team.state) && el('button', { class: 'btn btn--primary', type: 'button', onclick: mine }, "I'm applying")));
}

/* ---------- 6. history: page changes, vetting, source health in one timeline ---------- */
const CHANGE = { initial: 'First seen', deadline: 'Deadline changed', content: 'Page changed', docs: 'New documents' };
const VET = { registered: 'Added to the radar', rescored: 'Re-scored', verified: 'Facts re-checked', updated: 'Updated', demoted: 'Moved down', promoted: 'Moved up' };
function historySection(r, app) {
  const { S, D, el } = app, ts = (x) => Date.parse(x) || 0;
  const val = (k, v) => (v == null || v === '' ? 'none' : /_usd$/.test(k) && Number.isFinite(+v) ? D.money(+v) : Array.isArray(v) ? v.join(', ') : String(v));
  const ev = [];
  for (const c of r._changes || []) ev.push({ at: c.at, tag: 'Page', head: CHANGE[c.kind] || c.kind, note: c.summary, diff: Array.isArray(c.deadline) ? [['Deadline', c.deadline.map((y) => (y ? D.fmtDate(y) : 'none'))]] : [] });
  for (const v of (S.feed.vetting || []).filter((x) => x.funder_id === r.id)) ev.push({ at: v.at, tag: 'Review', head: VET[v.kind] || v.kind, note: v.note, diff: Object.entries(v.changes || {}).filter(([, p]) => Array.isArray(p)).map(([k, p]) => [human(k), p.map((y) => val(k, y))]) });
  ev.sort((a, b) => ts(b.at) - ts(a.at));
  const fails = r.consecutive_failures || 0;
  const health = { at: r.last_checked_at, tag: 'Source', bad: fails > 0 || r._manual, head: `Checked ${D.relTime(r.last_checked_at, S.now)}`, note: [fails ? `${fails} failed check${fails === 1 ? '' : 's'} in a row` : 'No fetch problems', r.last_ok_at && fails ? `last good read ${D.relTime(r.last_ok_at, S.now)}` : '', r._manual ? 'cannot be checked automatically, so verify the deadline and documents by hand' : ''].filter(Boolean).join('; ') };
  const all = [health, ...ev], shown = all.slice(0, HIST_SHOWN);
  const item = (x) => el('li', { class: x.bad ? 'bad' : '' }, el('div', { class: 'ev-h' }, el('b', { text: x.head }), el('span', { class: 'sub num', text: `${x.tag} · ${x.at ? D.fmtDate(String(x.at).slice(0, 10)) : ''}` })),
    x.note && el('p', { class: 'ev-n', text: x.note }), x.diff?.map(([k, p]) => el('p', { class: 'ev-d num' }, el('span', { text: k + ': ' }), p[0], ' → ', el('b', { text: p[1] }))));
  const ul = el('ul', { class: 'ev' }, shown.map(item));
  return sec(el, 'History', 'history', ul, all.length > shown.length && el('button', { class: 'btn btn--sm', type: 'button', style: 'margin-top:.6rem', onclick: (e) => { ul.replaceChildren(...all.map(item)); e.currentTarget.remove(); } }, `Show all ${all.length}`));
}

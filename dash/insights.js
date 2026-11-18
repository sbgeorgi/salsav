// Insights view: nine sections. Each opens with a one-sentence takeaway computed from the data, then the chart.
// Numbers come from D.insights(rows, feed, now) and the evaluated-funder registry. Charts are SVG strings from dash/viz.js,
// parsed with DOMParser (never innerHTML). Feed text reaches the page only through el() text nodes or viz.js, which escapes.
// Search: the funder sections follow app.q(); coverage, source health, trends and discovery always cover the whole feed.
import * as V from './viz.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY = 864e5, WINDOW = 30;
const SECTIONS = [['map', 'Opportunity map'], ['fit', 'Fit'], ['cov', 'Coverage'], ['eval', 'Evaluated funders'], ['pipe', 'Pipeline'], ['team', 'Team activity'], ['time', 'Awards and mix'], ['conf', 'Data confidence'], ['trend', 'Trends and discovery']];
const TITLES = { map: 'Fit against time left', fit: 'How well the funders match', cov: 'Are we looking in enough places', eval: 'What the evaluation kept and ruled out', pipe: 'Where each bid stands', team: 'Who moved the pipeline', time: 'How big the awards are and who gives', conf: 'How much of this can be trusted', trend: 'Is the radar improving' };
// Marker shapes per bucket, in the order viz.js gives its scatter marks (its BUCKETS list), so this legend matches the chart.
const GLYPH = { us_federal: '●', intl_dev: '■', state_regional: '◆', private_sector: '▲', foundation_ngo: '+', tracker: '○' };
const STAGES_ACTIVE = ['reviewing', 'applying', 'submitted'];
const sv = (t, a = {}, ...k) => { const e = document.createElementNS(NS, t); for (const [n, v] of Object.entries(a)) if (v != null && v !== false) e.setAttribute(n, v === true ? '' : v); for (const c of k.flat()) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c); return e; };
const parse = (str) => document.importNode(new DOMParser().parseFromString(str.replace('<svg ', `<svg xmlns="${NS}" `), 'image/svg+xml').documentElement, true);
const RH = () => (innerWidth <= 760 ? 44 : 24); // phone-sized rows give chart bars a 44px tap target
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const num = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
const shortDay = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''; };

/* ---- pure helpers (node-tested in dash/mods.test.mjs) ---- */

// What the team did in the window. Events and notes count as actions; events without an actor are automated and only counted apart.
// Moves are update events that set a stage. Owners come from the funder rows, unassigned last.
export function teamActivity({ events = [], notes = [], rows = [], states = [], now = new Date(), days = WINDOW } = {}) {
  const since = now.getTime() - days * DAY;
  const inWin = (at) => { const t = Date.parse(at || ''); return Number.isFinite(t) && t >= since; };
  const people = new Map(), moves = new Map(), owners = new Map();
  let total = 0, automated = 0;
  const person = (name) => { let p = people.get(name); if (!p) people.set(name, (p = { name, actions: 0, moves: 0, notes: 0 })); return p; };
  for (const e of events) {
    if (!inWin(e.at)) continue;
    if (!e.actor) { automated++; continue; }
    const p = person(e.actor); p.actions++; total++;
    if (e.kind === 'update' && e.payload?.state) { p.moves++; moves.set(e.payload.state, (moves.get(e.payload.state) || 0) + 1); }
  }
  for (const n of notes) {
    if (!n.actor || !inWin(n.at)) continue;
    const p = person(n.actor); p.notes++; p.actions++; total++;
  }
  for (const r of rows) {
    const name = r.team?.owner || '', state = r.team?.state || 'new';
    let o = owners.get(name); if (!o) owners.set(name, (o = { name, total: 0, byState: {} }));
    o.total++; o.byState[state] = (o.byState[state] || 0) + 1;
  }
  return {
    total, automated,
    people: [...people.values()].sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name)),
    moves: states.filter((s) => moves.get(s)).map((s) => ({ state: s, n: moves.get(s) })),
    owners: [...owners.values()].sort((a, b) => (a.name === '') - (b.name === '') || b.total - a.total || a.name.localeCompare(b.name)),
  };
}

// Screened-out funders (registry status rejected), by the criterion that failed, in the same reading as ui.gateChips:
// a funder with scored false is "not scored" only; a demoted-by-hand funder counts as team; the rest count by each failed rule.
// One funder can fail several rules, so fit + ua + award can exceed anyFail. team + notScored + anyFail + none === total.
export function screenedCriteria(reg) {
  const out = { total: 0, team: 0, notScored: 0, anyFail: 0, fit: 0, ua: 0, award: 0, none: 0 };
  for (const f of reg?.funders || []) {
    if (f.status !== 'rejected') continue;
    out.total++;
    if (f.human?.lock === 'demoted') { out.team++; continue; }
    const g = f.gates || {};
    if (g.scored === false) { out.notScored++; continue; }
    const fails = [g.fit === false && 'fit', g.ua === false && 'ua', g.award === false && 'award'].filter(Boolean);
    if (!fails.length) { out.none++; continue; }
    out.anyFail++;
    for (const k of fails) out[k]++;
  }
  return out;
}

// Loads the registry once per view. The shell caches a success; a failure is remembered in `st` so a view never retries in a loop.
// `again` runs after the load settles, and the caller checks that its view is still on screen before it paints.
export function loadRegistryOnce(app, st, again) {
  if (app.reg() || st.asked) return;
  st.asked = true; st.loading = true; st.failed = false;
  app.loadRegistry().then(() => { st.loading = false; again(); }, () => { st.loading = false; st.failed = true; again(); });
}

export function render(root, app) {
  const { S, D, el, ico, ui } = app, feed = S.feed || {}, all = S.rows || [], qText = (S.F.q || '').trim(), searching = app.q().length > 0;
  const blabel = (b) => S.bucketLabel?.[b] || D.BUCKETS[b] || b, slabel = (s) => S.stateLabel?.[s] || s;
  const hayOf = (f) => [f.name, f.program, (f.themes || []).join(' '), (f.geography || []).join(' '), D.BUCKETS[f.bucket], blabel(f.bucket), f.notes, f.eligibility_note, f.vet_note, f.reject_reason, f.team?.notes, f.team?.owner, f.human?.note].join(' ');
  const hit = (f) => !searching || app.matchQ(hayOf(f));
  const rows = searching ? all.filter(hit) : all;
  const st = app.ui_state('insights', { asked: false, loading: false, failed: false });
  const again = () => { if (S.view === 'insights' && root.querySelector('.ins')) render(root, app); };
  loadRegistryOnce(app, st, again);
  const reg = app.reg(), regRows = reg ? (reg.funders || []).filter(hit) : null;
  // Feed-level numbers (coverage, health, trend, discovery, collect) always use the whole list; the rest follow the search.
  const Ia = D.insights(all, feed, S.now), I = searching ? { ...D.insights(rows, feed, S.now), coverage: Ia.coverage, health: Ia.health, trend: Ia.trend, discovery: Ia.discovery, collect: Ia.collect } : Ia;
  const live = rows.filter((r) => !r._dq && !r._skip);
  const draws = [];
  const W = (host, min = 240) => Math.max(min, Math.floor(host.clientWidth || root.clientWidth || 320));
  const pick = (group, k) => { const a = S.F[group] || []; app.setFilters({ [group]: a.includes(k) ? a.filter((x) => x !== k) : [...a, k] }); app.go('table'); };
  const empty = (text) => el('p', { class: 'ins-empty', text });
  const chart = (host, fn) => { const run = () => host.replaceChildren(...[].concat(fn(W(host)))); draws.push(run); return host; };
  // Marks inside an svg need role group (children of role img are hidden from screen readers); each mark becomes a keyboard button.
  function wire(svg, sel, act, name) {
    svg.setAttribute('role', 'group');
    svg.querySelectorAll(sel).forEach((g) => {
      const id = g.getAttribute('data-id'), t = g.querySelector('title')?.textContent || name?.(id) || id;
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', `${t}. Press Enter for details.`);
      g.addEventListener('click', () => act(id)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(id); } });
    });
    return svg;
  }
  const section = (id, take, tag, ...body) => {
    const i = SECTIONS.findIndex(([k]) => k === id);
    return el('section', { class: 'ins-sec', id: 'ins-' + id, 'aria-labelledby': 'ins-h-' + id },
      el('div', { class: 'ins-head' }, el('p', { class: 'eyebrow', text: `${i + 1} ${SECTIONS[i][1]}` }), el('h2', { id: 'ins-h-' + id, text: TITLES[id] }), el('p', { class: 'ins-take', text: take }),
        searching && tag ? el('span', { class: 'chip chip--line ins-tag', text: tag }) : null),
      el('div', { class: 'ins-body' }, ...body));
  };
  const sub = (title, note) => el('div', { class: 'ins-sub' }, el('h3', { text: title }), note ? el('p', { class: 'sub', text: note }) : null);
  const bar = (pct, cls = '') => el('span', { class: 'bar ' + cls, 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }));
  const stat = (n, l, bad) => el('div', { class: 'ins-stat' + (bad ? ' bad' : '') }, el('span', { class: 'big num', text: String(n) }), el('span', { class: 'l', text: l }));

  /* 1. Opportunity map */
  const dated = I.scatter.filter((p) => p.days >= 0 && p.days <= 365), outside = I.scatter.length - dated.length;
  const hot = dated.filter((p) => p.fit >= 60 && p.days <= 90);
  const mapTake = dated.length || I.undated.length ? (hot.length ? `${plural(hot.length, 'strong-fit funder closes', 'strong-fit funders close')} within 90 days.` : 'No strong-fit funder closes within 90 days.') : 'No scored funders yet.';
  const mapHost = chart(el('div', { class: 'ins-map' }), (w) => {
    if (!dated.length) return empty('No funder has a scored fit and a deadline in the next 12 months.');
    const h = Math.round(Math.min(340, Math.max(240, w * 0.5))), s = parse(V.scatter(dated, { w, h, xMax: 365, yMax: 100, xLabel: 'Days to deadline', yLabel: 'Fit score', labelTop: w < 500 ? 2 : 4 }));
    const L = 34, T = 8, pw = w - L - 10, ph = h - T - 24, zw = pw * 90 / 365, zh = ph * 0.4; // mirrors the plot box inside viz.scatter
    s.querySelector('title').after(sv('rect', { class: 'ins-zone', x: L, y: T, width: zw, height: zh }), ...(zw > 80 ? [sv('text', { class: 'ins-zone-t', x: L + zw - 4, y: T + zh - 5, 'text-anchor': 'end' }, 'Act now')] : []));
    [...s.querySelectorAll('text')].find((t) => t.textContent === 'Fit score')?.remove(); // the caption names the axes; the label collided with top marks
    [...s.querySelectorAll('text')].find((t) => t.textContent === 'Days to deadline')?.setAttribute('y', h + 12); // clear of the 365 tick label
    return wire(s, '.viz-mark', app.openDrawer);
  });
  const legend = el('ul', { class: 'ins-legend', 'aria-label': 'Funder buckets' }, Object.keys(D.BUCKETS).filter((b) => dated.some((p) => p.bucket === b)).map((b) => el('li', {}, el('span', { class: `gl b-${b}`, 'aria-hidden': 'true', text: GLYPH[b] }), blabel(b))),
    el('li', { class: 'sub', text: 'Bigger mark = larger award. Shaded: fit 60+ closing within 90 days.' }));
  const queuedIn = (id) => S.regById?.get?.(id)?.queue === 'pending'; // the agent queue lives on the registry, not the feed row
  const lanes = Object.entries(D.LANES).map(([k, l]) => [k, l, I.undated.filter((p) => p.lane === k).sort((a, b) => b.fit - a.fit)]).filter(([, , a]) => a.length);
  const strip = el('aside', { class: 'ins-undated', 'aria-label': 'Funders without a fixed date', tabindex: '0' }, el('h3', { text: `No fixed date (${I.undated.length})` }),
    lanes.length ? lanes.map(([k, l, a]) => el('div', { class: 'ins-lane' }, el('h4', {}, ui.laneChip(k, `${l} ${a.length}`)), el('ul', {}, a.map((p) => el('li', {}, el('button', { type: 'button', class: 'ins-link', title: p.name, onclick: () => app.openDrawer(p.id), 'aria-label': `${p.name}, fit ${p.fit}${queuedIn(p.id) ? ', in agent queue' : ''}` },
      ui.bucketDot(p.bucket), el('span', { class: 'nm', text: p.name }), queuedIn(p.id) ? ui.statusChip('queue') : null, el('span', { class: 'sc', text: String(p.fit) }))))))) : empty('Every scored funder has a date.'));
  const s1 = section('map', mapTake, 'Follows search',
    el('p', { class: 'sub', text: `Height is fit score, distance from the left is days to the deadline. ${dated.length} dated${outside ? `, ${outside} outside the next 12 months` : ''}, ${I.undated.length} without a fixed date. Click a mark for details.` }),
    el('div', { class: 'ins-split' }, el('div', {}, mapHost, dated.length ? legend : null), strip));

  /* 2. Fit */
  const scoredN = I.fitHist.reduce((a, t) => a + t.n, 0), topN = I.fitHist.filter((t) => t.tier === 'prime' || t.tier === 'strong').reduce((a, t) => a + t.n, 0);
  const itemized = live.filter((r) => r.fit_breakdown).length, anat = I.anatomy, weak = itemized ? [...anat].sort((a, b) => a.avg / (a.max || 1) - b.avg / (b.max || 1))[0] : null;
  const fitTake = !scoredN ? 'No funder has a fit score yet.' : `${topN} of ${scoredN} scored funders are prime or strong.${weak ? ` The weakest part is ${weak.label.toLowerCase()}, averaging ${weak.avg} of ${weak.max}.` : ' Scores are not itemized yet, so only the tier spread is shown.'}`;
  const tierHost = chart(el('div', { class: 'ins-tier' }), (w) => scoredN ? wire(parse(V.hbars(I.fitHist.map((t) => ({ id: t.tier, label: t.label, value: t.n })), { w, rowH: RH(), labelW: 84, valueW: 32 })), '.viz-row', (k) => pick('tier', k)) : empty('Nothing to count yet.'));
  const anatBox = el('div', { class: 'ins-rows' }, anat.length && itemized ? anat.map((d) => el('div', { class: 'ins-r' + (weak && d.key === weak.key ? ' weak' : '') }, el('span', { class: 'lab', text: d.label }), bar(d.max ? d.avg / d.max * 100 : 0),
    el('span', { class: 'val num' }, `${d.avg} of ${d.max}`, weak && d.key === weak.key ? el('em', { text: ' weakest' }) : null))) : empty('Appears once funders are scored on the six parts of the fit score.'));
  const s2 = section('fit', fitTake, 'Follows search',
    el('div', { class: 'ins-two' }, el('div', {}, sub('Funders by tier', 'Click a bar to filter the Radar.'), tierHost), el('div', {}, sub('Score anatomy', `Average points per part against its maximum, over ${plural(itemized, 'itemized funder', 'itemized funders')}.`), anatBox)));

  /* 3. Coverage and targeting (always the whole feed) */
  const gaps = I.coverage.filter((c) => c.vetted < c.min).sort((a, b) => (b.min - b.vetted) - (a.min - a.vetted));
  const covTake = !I.coverage.length ? 'This feed sets no coverage targets.' : gaps.length ? `${blabel(gaps[0].bucket)} is the biggest gap: ${gaps[0].vetted} of ${gaps[0].min} vetted, ${gaps[0].pending ? plural(gaps[0].pending, 'target', 'targets') + ' queued' : 'no targets queued'}. ${gaps.length > 1 ? `${gaps.length} of ${I.coverage.length} buckets are short.` : 'Every other bucket has reached its target.'}` : 'Every bucket has reached its vetted target.';
  const s3 = section('cov', covTake, 'Whole feed',
    el('div', { class: 'ins-rows ins-cov' }, I.coverage.length ? I.coverage.map((c) => { const top = Math.max(c.min, c.vetted), short = c.min - c.vetted;
      return el('div', { class: 'cov-r' + (short > 0 ? ' short' : '') }, el('button', { type: 'button', class: 'ins-link lab', onclick: () => pick('bucket', c.bucket) }, ui.bucketDot(c.bucket), blabel(c.bucket)),
        el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${c.vetted / top * 100}%` }), el('b', { style: `left:${c.min / top * 100}%` })),
        el('span', { class: 'val num' }, `${c.vetted} of ${c.min}`, el('em', { text: short > 0 ? ` ${short} short` : ' target met' })),
        el('span', { class: 'facts sub', text: `${c.screened} screened out, ${plural(c.pending, 'target', 'targets')} queued` }));
    }) : empty('No coverage targets in this feed.')));

  /* 4. Evaluated funders: every funder the registry holds, with the criterion that screened it out. Falls back to the feed until the registry loads. */
  const thr = reg?.thresholds || {}, fitMin = thr.fit_min ?? app.rubric()?.min_fit ?? 40, awardMin = thr.award_min_usd ?? feed.min_award ?? 200000;
  const crit = reg ? screenedCriteria({ funders: regRows }) : null;
  const scrFeed = (Array.isArray(feed.screened) ? feed.screened : []).filter((x) => !searching || app.matchQ([x.name, x.program, x.reason, D.BUCKETS[x.bucket]].join(' ')));
  const tracked = regRows ? regRows.filter((f) => f.status === 'vetted').length : rows.length;
  const candidates = regRows ? regRows.filter((f) => f.status === 'candidate').length : null;
  const screenedN = crit ? crit.total : scrFeed.length;
  const reasons = crit ? [['fit', `a fit score under ${fitMin}`], ['ua', 'UA eligibility'], ['award', `an award under ${D.money(awardMin)}`], ['notScored', 'no fit score yet']] : [];
  const topReason = reasons.slice().sort((a, b) => crit[b[0]] - crit[a[0]])[0];
  const evalTake = crit ? (screenedN ? `${tracked} tracked and ${screenedN} screened out.${topReason && crit[topReason[0]] ? ` The most common reason is ${topReason[1]}.` : ''}` : `${tracked} tracked, none screened out.`)
    : `${tracked} tracked and ${scrFeed.length} screened out in the Radar feed. The full list, with the criterion behind each decision, loads from the database.`;
  const critRows = crit ? [[`Fit below ${fitMin}`, crit.fit], ['UA unlikely', crit.ua], [`Award under ${D.money(awardMin)}`, crit.award], [D.UNSCORED, crit.notScored], ['Screened out by the team', crit.team], ['No criterion recorded', crit.none]] : [];
  const evalBody = crit ? [
    el('div', { class: 'ins-stats ins-stats--row' }, stat(tracked, 'tracked'), stat(screenedN, 'screened out', false), stat(candidates ?? '–', 'candidates waiting')),
    sub('Screened out, by criterion', 'Share of the screened-out funders that failed each criterion.'),
    el('div', { class: 'ins-rows ins-crit' }, critRows.map(([l, n]) => el('div', { class: 'ins-r' }, el('span', { class: 'lab', text: l }), bar(screenedN ? n / screenedN * 100 : 0), el('span', { class: 'val num', text: `${n} of ${screenedN}` })))),
    el('p', { class: 'sub', text: 'One funder can fail more than one criterion, so the rows can add up to more than the screened total.' }),
  ] : [
    el('div', { class: 'ins-stats ins-stats--row' }, stat(tracked, 'tracked'), stat(scrFeed.length, 'screened out in the feed')),
    st.failed ? el('div', { class: 'ins-lock' }, el('p', { class: 'sub', text: 'The full list is not available yet, so the criterion breakdown is missing.' }),
      el('button', { class: 'btn btn--sm', type: 'button', onclick: () => { st.asked = false; render(root, app); } }, 'Try again'))
      : el('p', { class: 'sub', role: 'status', text: st.loading ? 'Loading the full list of evaluated funders.' : 'The criterion breakdown appears once the full list loads.' }),
  ];
  const s4 = section('eval', evalTake, 'Follows search', ...evalBody,
    el('div', { class: 'ins-actions' }, el('button', { class: 'btn btn--sm', type: 'button', onclick: () => app.go('database') }, 'Open Database', ico('chev'))));

  /* 5. Pipeline */
  const askOf = (r) => r.team?.ask_usd ?? r.award_max_usd ?? 0, dec = rows.filter((r) => r.team?.state === 'declined');
  const stages = [...I.funnel.filter((x) => x.state !== 'new').map((x) => ({ ...x, label: slabel(x.state) })), { state: 'declined', label: slabel('declined'), n: dec.length, usd: dec.reduce((a, r) => a + askOf(r), 0) }];
  const by = Object.fromEntries(stages.map((x) => [x.state, x])), prog = STAGES_ACTIVE.reduce((a, k) => ({ n: a.n + (by[k]?.n || 0), usd: a.usd + (by[k]?.usd || 0) }), { n: 0, usd: 0 });
  const pipeTake = stages.every((x) => !x.n) ? 'Nothing is in the pipeline yet. Move a funder to Reviewing to start.' : `${plural(prog.n, 'funder is', 'funders are')} in progress${prog.usd ? `, ${D.money(prog.usd)} at stake` : ''}; ${by.awarded?.n || 0} awarded, ${by.declined?.n || 0} declined.`;
  const s5 = section('pipe', pipeTake, 'Follows search',
    chart(el('div', { class: 'ins-pipe' }), (w) => stages.every((x) => !x.n) ? empty('No funder has a team status beyond New.') : wire(parse(V.funnel(stages, { w, rowH: RH(), labelW: 84, valueW: 96 })), '.viz-row', (k) => pick('team', k))),
    stages.some((x) => x.n) ? el('p', { class: 'sub', text: 'Dollars use the team ask when set, else the largest published award. Click a row to filter the Radar.' }) : null);

  /* 6. Team activity: unlocked team members only. Follows the search through the funders each action touches. */
  const open = app.unlocked();
  const scopeIds = searching ? new Set([...rows.map((r) => r.id), ...(regRows || []).map((f) => f.id)]) : null;
  const inScope = (id) => !scopeIds || scopeIds.has(id);
  const events = open ? (S.events || []).filter((e) => inScope(e.funder_id)) : [];
  const notes = open ? (S.notes || []).filter((n) => inScope(n.funder_id)) : [];
  const TA = teamActivity({ events, notes, rows, states: D.STATES, now: S.now, days: WINDOW });
  const topMove = TA.moves.slice().sort((a, b) => b.n - a.n)[0];
  const teamTake = !open ? 'Unlock the team view to see who moved each funder and who owns the pipeline.'
    : !TA.total ? `No team action in the last ${WINDOW} days.`
    : `${plural(TA.total, 'action', 'actions')} by ${plural(TA.people.length, 'person', 'people')} in the last ${WINDOW} days.${topMove ? ` The busiest stage was ${slabel(topMove.state)}.` : ''}`;
  const maxA = Math.max(1, ...TA.people.map((p) => p.actions)), maxM = Math.max(1, ...TA.moves.map((m) => m.n));
  const stageLine = (byState) => D.STATES.filter((s) => byState[s]).map((s) => `${slabel(s)} ${byState[s]}`).join(' · ');
  const teamFoot = open ? [TA.automated ? `${plural(TA.automated, 'automated change is', 'automated changes are')} not counted here.` : '', (S.events || []).length >= 500 ? 'Only the latest 500 events are loaded.' : ''].filter(Boolean).join(' ') : '';
  const teamBody = !open ? el('div', { class: 'ins-lock' }, el('p', { class: 'sub', text: 'Actions, notes and owners are shown to unlocked team members only. Unlocking asks for the team passcode and your name.' }),
    el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => app.requireUnlock() }, 'Unlock team view')) : [
    el('div', { class: 'ins-three' },
      el('div', {}, sub('People', `Changes and notes in the last ${WINDOW} days.`), TA.people.length ? el('ul', { class: 'ins-people' }, TA.people.map((p) => el('li', {}, ui.avatar(p.name, { size: 'md' }),
        el('div', { class: 'ins-pbody' }, el('div', { class: 'ins-ptop' }, el('b', { text: p.name }), el('span', { class: 'num', text: plural(p.actions, 'action', 'actions') })), bar(p.actions / maxA * 100),
          el('p', { class: 'sub', text: `${plural(p.moves, 'move', 'moves')}, ${plural(p.notes, 'note', 'notes')}` }))))) : empty(`Nobody has acted in the last ${WINDOW} days.`)),
      el('div', {}, sub('Moves by stage', 'Times a funder was moved to each stage.'), TA.moves.length ? el('ul', { class: 'ins-moves' }, TA.moves.map((m) => el('li', {}, ui.stateChip(m.state, slabel(m.state)), bar(m.n / maxM * 100), el('span', { class: 'val num', text: String(m.n) })))) : empty(`No funder was moved in the last ${WINDOW} days.`)),
      el('div', {}, sub('Pipeline by owner', 'Funders per owner, by stage.'), TA.owners.length ? el('ul', { class: 'ins-owners' }, TA.owners.map((o) => el('li', {}, ui.avatar(o.name, { size: 'md', title: o.name || 'Unassigned' }),
        el('div', { class: 'ins-obody' }, el('b', { text: o.name || 'Unassigned' }), el('p', { class: 'sub', text: stageLine(o.byState) })), el('span', { class: 'num ins-ototal', text: String(o.total) })))) : empty('No funders in this view.'))),
    teamFoot ? el('p', { class: 'sub', text: teamFoot }) : null];
  const s6 = section('team', teamTake, 'Follows search', teamBody);

  /* 7. Awards and mix */
  const cnt = (f) => live.filter(f).length, mix = Object.keys(D.BUCKETS).map((b) => ({ id: b, label: blabel(b), value: cnt((r) => r.bucket === b), bucket: b })), band = D.BANDS.map(([b, l]) => ({ id: b, label: l, value: cnt((r) => r._band === b) }));
  const bigMix = [...mix].sort((a, b) => b.value - a.value)[0], unver = band.find((b) => b.id === 'unverified');
  const awardTake = live.length ? `${bigMix.label} is the largest group, ${bigMix.value} of ${live.length}. ${plural(unver.value, 'funder has', 'funders have')} no published award.` : 'No live funders yet.';
  const s7 = section('time', awardTake, 'Follows search',
    el('div', { class: 'ins-two' },
      el('div', {}, sub('Funder mix', live.length ? `${bigMix.label} is the largest group, ${bigMix.value} of ${live.length}.` : ''), chart(el('div', {}), (w) => live.length ? wire(parse(V.hbars(mix, { w, rowH: RH(), labelW: Math.min(150, w * .45), valueW: 32 })), '.viz-row', (k) => pick('bucket', k)) : empty('No live funders.'))),
      el('div', {}, sub('Award size', live.length ? `${plural(unver.value, 'funder has', 'funders have')} no published award.` : ''), chart(el('div', { class: 'ins-band' }), (w) => live.length ? wire(parse(V.hbars(band, { w, rowH: RH(), labelW: 96, valueW: 32 })), '.viz-row', (k) => pick('band', k)) : empty('No live funders.')))));

  /* 8. Data confidence: facts follow the search, source health and collection always cover the whole feed */
  const thin = [...I.quality].sort((a, b) => a.pct - b.pct)[0], H = I.health;
  const confTake = !live.length ? 'No live funders to check yet.' : `${thin.label} is the thinnest fact: ${thin.pct}% of funders.${H.total ? ` ${H.checked24h} of ${H.total} sources were checked in the last 24 hours.` : ''}`;
  // Share of listed sources the crawler reads by itself, per daily snapshot; one point shows today's number only.
  const C = I.collect, cd = C.days, cpct = C.now ? Math.round(C.now.auto / C.now.listed * 100) : cd.length ? cd[cd.length - 1].pct : null;
  const collBlock = el('div', { class: 'ins-trend', id: 'ins-collect' }, el('span', { class: 'l', text: 'Automatic collection' }), el('span', { class: 'big num', text: cpct == null ? '–' : cpct + '%' }),
    el('span', { class: 'sub num', text: C.now ? `${C.now.auto} of ${C.now.listed} listed sources collected automatically, ${plural(C.now.openCalls, 'open call', 'open calls')} found` : 'Not reported yet' }),
    cd.length > 1 ? chart(el('div', { class: 'sp' }), (w) => parse(V.spark(cd.map((x) => x.pct), { w, h: 34, label: 'Share of sources collected automatically' }))) : null);
  const s8 = section('conf', confTake, 'Facts follow search',
    el('div', { class: 'ins-two' },
      el('div', {}, sub('Facts known', 'Share of live funders where each fact is on file.'), chart(el('div', { class: 'ins-meters' }), (w) => live.length ? I.quality.map((q) => el('div', { class: 'ins-m' }, el('span', { class: 'lab', text: q.label }), parse(V.meter(q.pct, { w: Math.max(120, w), label: q.label })))) : empty('No live funders.'))),
      el('div', {}, sub('Source health', 'Whole feed, always. A manual check means a blocked page or repeated fetch failures.'), H.total ? el('div', { class: 'ins-stats' }, stat(H.checked24h, `of ${H.total} checked in the last 24 hours`), stat(H.failing, 'failing their last check', H.failing > 0), stat(H.manual, 'need a manual check', H.manual > 0)) : empty('No sources yet.'))),
    el('div', { class: 'ins-trends' }, collBlock));

  /* 9. Trends and discovery (always the whole feed) */
  const T = I.trend, n = T.days.length, d = I.discovery, runs = [...(d?.runs || [])].sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')).slice(0, 6), lens = [...(d?.by_lens || [])].filter((l) => l.examined > 0).map((l) => ({ ...l, y: l.vetted / l.examined * 100 })).sort((a, b) => b.y - a.y).slice(0, 8);
  const tot = d?.totals, bestLens = lens[0];
  const trTake = [n > 1 ? `Vetted sources went from ${T.vetted[0]} to ${T.vetted[n - 1]} since ${shortDay(T.days[0])}.` : 'Trends appear after the second daily snapshot.',
    tot?.examined ? `Of ${tot.examined} sources examined, ${tot.vetted} made the list (${Math.round(tot.vetted / tot.examined * 100)}%)${bestLens && bestLens.vetted ? `; ${bestLens.lens} yields best` : ''}.` : 'No discovery runs recorded yet.'].join(' ');
  const cell = (label, vals) => { const last = vals[n - 1], dl = last - vals[0]; return el('div', { class: 'ins-trend' }, el('span', { class: 'l', text: label }), el('span', { class: 'big num', text: n ? String(last) : '–' }),
    el('span', { class: 'sub num', text: n > 1 ? `${dl > 0 ? '+' : ''}${dl} since ${shortDay(T.days[0])}` : 'No history yet' }), chart(el('div', { class: 'sp' }), (w) => parse(V.spark(vals, { w, h: 34, label }))));  };
  const s9 = section('trend', trTake, null,
    el('div', { class: 'ins-trends' }, cell('Vetted sources', T.vetted), cell('Apply now', T.applyNow), cell('Three or more facts quoted', T.evidence3)),
    el('div', { class: 'ins-two' },
      el('div', {}, sub('Discovery runs', 'Sources examined per run, split by what happened to them.'), chart(el('div', { class: 'ins-runs' }), (w) => runs.length ? parse(V.stackedBars(runs.map((r) => ({ id: r.run_label, label: shortDay(r.started_at) || r.run_label, parts: [{ key: 'listed', label: 'Listed', value: r.vetted }, { key: 'screened', label: 'Screened out', value: r.rejected }, { key: 'known', label: 'Already known', value: r.duplicate }] })), { w, labelW: 56, totalW: 28 })) : empty('No discovery runs recorded yet.'))),
      // Lens bars have no funder category, so they take one neutral colour instead of the bucket hues the viz palette reuses.
      el('div', {}, sub('Yield per lens', 'Share of examined sources that were listed.'), chart(el('div', { class: 'ins-lens' }), (w) => lens.length ? parse(V.hbars(lens.map((l) => ({ id: l.lens, label: l.lens, value: l.y, note: `${l.vetted} listed of ${l.examined} examined` })), { w, labelW: Math.min(140, w * .5), valueW: 40, fmt: (v) => Math.round(v) + '%', max: 100 })) : empty('No lens data yet.')))));

  const scopeNote = el('p', { class: 'ins-scope', role: 'status', text: searching ? `Search “${qText}”: ${rows.length} of ${all.length} tracked funders${regRows ? ` and ${regRows.filter((f) => f.status === 'rejected').length} of ${(reg.funders || []).filter((f) => f.status === 'rejected').length} screened-out funders` : ''} match. Sections tagged Follows search use the matches. Coverage, source health, trends and discovery cover the whole feed.`
    : `Showing all ${all.length} tracked funders. Search narrows the sections tagged Follows search.` });
  const jump = el('nav', { class: 'ins-jump', 'aria-label': 'Jump to a section' }, SECTIONS.map(([id, l]) => el('button', { type: 'button', onclick: () => document.getElementById('ins-' + id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), text: l })));
  root.replaceChildren(el('div', { class: 'ins' }, scopeNote, jump, s1, s2, s3, s4, s5, s6, s7, s8, s9));
  const drawAll = () => draws.forEach((f) => f());
  drawAll();
  // Redraw on width change (text stays at its real size instead of shrinking with the viewBox). Disconnect once the view is gone.
  root._insRO?.disconnect(); let last = root.clientWidth;
  root._insRO = new ResizeObserver(() => { if (!root.querySelector('.ins')) return root._insRO.disconnect(); if (root.hidden) return; if (Math.abs(root.clientWidth - last) > 24) { last = root.clientWidth; drawAll(); } });
  root._insRO.observe(root);
}

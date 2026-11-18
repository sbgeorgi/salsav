// Method view: how the radar works, written from the feed and the evaluated-funder registry, so it cannot drift from the database.
// Feed text goes through el() text nodes only. Jump links are buttons, not #anchors: the shell owns location.hash.
// Search: the screened-out list and the next-up list follow app.q(); onQuery redraws only those two lists.
import { fitBar } from './viz.js';
import { COLLECT_SAYS, collectionOf, coverageRows, collectionTotals, totalsSentence, statusEl } from './drawer.js';
import { screenedCriteria, loadRegistryOnce } from './insights.js';

const NS = 'http://www.w3.org/2000/svg';
// viz.js returns an SVG string and escapes every data string it gets; parse it as SVG, never as HTML (no innerHTML).
const svgEl = (s) => document.importNode(new DOMParser().parseFromString(s.replace('<svg ', `<svg xmlns="${NS}" `), 'image/svg+xml').documentElement, true);
const LIST_CAP = 5;
// Points added on top of the fit score for next best moves. Mirrors recScore in dashboard.js; the parity test in dash/mods.test.mjs
// runs D.recommend() on fixed rows and fails if these numbers and the scoring drift apart.
export const RANK_WEIGHTS = { soon45: 12, sweet90: 15, late180: 8, rolling: 4, prepare: 2, ua: 5, facts: 3 };
const num = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
const pl = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const SECS = [['listed', 'How a source gets listed'], ['fit', 'How fit is scored'], ['rank', 'How next best moves are ranked'], ['screened', 'Screened out'], ['queue', 'Queued for vetting'], ['runs', 'Discovery runs'], ['collection', 'How calls are collected']];

export function render(root, app) {
  const { S, D, el, ico, ui } = app, feed = S.feed || {}, rb = app.rubric();
  const minAward = D.money(feed.min_award ?? 200000), minDays = feed.min_days ?? 14, minFit = rb?.min_fit ?? 40;
  const st = app.ui_state('method', { asked: false, loading: false, failed: false, all: false });
  const again = () => { if (S.view === 'method' && root.querySelector('.method')) render(root, app); };
  loadRegistryOnce(app, st, again);
  const reg = app.reg();
  const bucket = (b) => ui.bucketChip(b, S.bucketLabel[b] || D.BUCKETS[b] || String(b || 'Other'));
  const day = (ts) => D.fmtDate(String(ts || '').slice(0, 10)) || 'n/a';
  const none = (t) => el('p', { class: 'mnone', text: t });
  // Title and intro sit in a side rail (a left column on wide screens); everything else is the body.
  const sec = (id, title, lede, ...body) => {
    if (!lede && body[0]?.classList?.contains('mlede')) lede = body.shift();
    return el('section', { class: 'msec', id: 'm-' + id, 'aria-labelledby': 'mh-' + id },
      el('div', { class: 'mside' }, el('header', {}, el('span', { class: 'mnum', 'aria-hidden': 'true', text: String(SECS.findIndex(([k]) => k === id) + 1) }), el('h2', { id: 'mh-' + id, text: title })),
        typeof lede === 'string' ? el('p', { class: 'mlede', text: lede }) : lede),
      el('div', { class: 'mbody' }, ...body));
  };
  const th = (t, cls) => el('th', { scope: 'col', class: cls, text: t });
  const retry = () => el('button', { class: 'btn btn--sm', type: 'button', onclick: () => { st.asked = false; render(root, app); } }, 'Try again');

  /* 1. how a source gets listed */
  const steps = [
    ['Found', 'Search lenses, trackers and tips surface a possible funder.'],
    ['Official page read', 'We read the funder’s own page, not a summary of it.'],
    ['Hard checks', `UA can apply. At least ${minAward} per award, or the amount is not published. At least ${minDays} days left, or the call recurs.`],
    ['Fit of ' + minFit + ' or more', 'Scored with the tables below. Lower scores are screened out.'],
    ['Evidence quoted', 'Award, deadline and eligibility each carry a quote copied from the page.'],
    ['Re-checked', 'Pages are read again on a rolling basis, and changes show up on the Radar.'],
  ];
  const flow = el('ol', { class: 'mflow' }, steps.map(([h, p], i) => el('li', {}, el('span', { class: 'mstep num', text: i + 1 }), el('b', { text: h }), el('span', { class: 'sub', text: p }))));

  /* 2. how fit is scored */
  const total = rb?.dims?.reduce((s, d) => s + d.max, 0);
  const levelRow = (d, l) => el('tr', {}, el('th', { scope: 'row', text: l.label }),
    el('td', { class: 'num pts' }, el('span', { class: 'pbar', 'aria-hidden': 'true' }, el('i', { style: `width:${d.max ? Math.round((100 * l.points) / d.max) : 0}%` })), el('b', { text: l.points })),
    el('td', { text: l.rule }));
  const dimBlock = (d) => el('div', { class: 'mdim' },
    el('header', {}, el('h3', { text: d.label }), el('span', { class: 'mmax num', text: `${d.max} points` }), el('span', { class: 'chip chip--line', text: d.source === 'judged' ? 'Judged from the page' : 'Worked out from the data' })),
    el('p', { class: 'sub', text: d.question }),
    el('table', { class: 'mtbl' }, el('thead', {}, el('tr', {}, th('Level'), th('Points', 'pts'), th('When it applies'))),
      el('tbody', {}, [...d.levels].sort((a, b) => b.points - a.points).map((l) => levelRow(d, l)))));
  const tiers = [...(rb?.tiers || [])].sort((a, b) => b.min - a.min);
  const tierRow = el('div', { class: 'mtiers' }, tiers.map((t, i) => el('div', { class: 'mtier mtier--' + t.key },
    el('span', { class: 'big num', text: t.min ? `${t.min}+` : `Under ${tiers[i - 1]?.min ?? ''}` }), el('span', { text: t.label }))));

  // worked example: the real funder with the most quoted facts, then the highest fit
  const pool = S.rows.filter((r) => r.fit_breakdown && D.explainFit(r, rb)).sort((a, b) => (b._evid?.n ?? 0) - (a._evid?.n ?? 0) || b.fit_score - a.fit_score || String(a.name).localeCompare(String(b.name)));
  const ex = pool[0] && D.explainFit(pool[0], rb);
  const example = ex ? el('div', { class: 'mex' },
    el('header', {}, el('h3', { text: 'A worked example' }), el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(pool[0].id) }, pool[0].name), el('span', { class: 'chip chip--line num', text: `${ex.total} points${ex.tier ? ', ' + ex.tier.label : ''}` })),
    svgEl(fitBar(ex.dims.map((d) => ({ key: d.key, label: d.label, max: d.max, points: d.points })), { w: 420, h: 8, values: true, total: ex.total })),
    el('ol', { class: 'mexl' }, ex.dims.map((d) => el('li', {},
      el('div', { class: 'mexh' }, el('b', { text: d.label }), el('span', { class: 'num', text: `${d.points} of ${d.max}` }), el('span', { class: 'sub', text: d.levelLabel })),
      d.why && el('p', { text: d.why }),
      d.quote && el('blockquote', {}, d.quote, el('small', { class: d.ok ? 'ok' : '', text: d.ok ? ' Found on the funder’s page.' : ' Not on the monitored page.', title: d.ok ? null : 'The quote was not found in the page text the crawler stores. It may sit in a linked document.' }))))),
    el('p', { class: 'sub', text: `Add the ${ex.dims.length} parts: ${ex.total} of ${total}. Judged parts come from reading the page; eligibility and award are worked out from the data.` })) : null;

  const fit = rb?.dims?.length ? [
    el('p', { class: 'mlede', text: `A funder scores up to ${total} points across ${rb.dims.length} questions. Under ${minFit} points it is not listed. The score is the plain sum of the parts, and every part follows one written rule.` }),
    tierRow, el('div', { class: 'mdims' }, rb.dims.map(dimBlock)), example] : [el('div', { class: 'state' }, el('h2', { text: 'The scoring rules are not published yet' }), el('p', { text: 'This feed does not carry the fit scoring rules. Once the database publishes it, every rule and point value shows here.' }))];

  /* 3. how next best moves are ranked (the weights mirror recScore in dashboard.js) */
  const W = RANK_WEIGHTS, pts = (n) => `+${n}`;
  const parts = [['Fit score', 'Up to 100', 'Start from the fit score.'], [`Deadline ${minDays} to 45 days away`, pts(W.soon45), 'Soon, but still enough time.'], ['Deadline 46 to 90 days away', pts(W.sweet90), 'The sweet spot for a proposal.'], ['Deadline 91 to 180 days away', pts(W.late180), 'Plenty of time, less pressure.'],
    ['Rolling call', pts(W.rolling), 'No date, so no rush.'], ['Recurs every year', pts(W.prepare), 'Prepare for the next round.'], ['UA can apply directly', pts(W.ua), 'No partner needed.'], ['3 or 4 key facts quoted', pts(W.facts), 'Award, deadline, eligibility and mission are backed by the page.']];
  const top = D.recommend(S.rows, S.now, 5);
  const lanes = { apply_now: 'A deadline is at least ' + minDays + ' days away.', rolling: 'Open all year; apply any time.', prepare: 'Recurs every year; the next date is not set yet.', cultivate: 'By invitation, so build the relationship first.', watch: 'Not actionable yet.' };
  const rank = [
    el('p', { class: 'mlede', text: 'The Next best moves strip on the Radar suggests what to work on this week. It only considers funders that are open to us: in the Apply now, Rolling or Prepare lane, not closed or too soon, and not yet started or still being reviewed. Each gets points, and the highest total comes first. If two tie, the sooner deadline wins, then the name.' }),
    el('div', { class: 'mpair' }, el('div', {},
    el('table', { class: 'mtbl mrank' }, el('thead', {}, el('tr', {}, th('Adds points for'), th('Points', 'pts'), th('Why'))),
      el('tbody', {}, parts.map(([a, b, c]) => el('tr', {}, el('th', { scope: 'row', text: a }), el('td', { class: 'num pts', text: b }), el('td', { text: c }))))),
    el('p', { class: 'sub', text: 'A deadline closer than ' + minDays + ' days is not suggested, and a deadline beyond 180 days gets no urgency points.' }),
  ), el('div', {},
    el('dl', { class: 'mlanes' }, Object.entries(D.LANES).flatMap(([k, v]) => [el('dt', { text: v }), el('dd', { text: lanes[k] })])),
    top.length ? el('div', { class: 'mtop' }, el('h3', { text: 'At the top right now' }), el('ol', {}, top.map((x) => el('li', {}, el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(x.row.id) }, x.row.name), el('span', { class: 'big num', text: x.score }), el('small', { text: [...x.reasons, x.row.fit_score == null ? D.UNSCORED : null].filter(Boolean).join(' · ') }))))) : null))];

  /* 4. screened out: a summary, the criterion counts when the registry loads, a link to Database, and a short list that follows the search */
  const scr = Array.isArray(feed.screened) ? feed.screened : [];
  const regOut = reg ? (reg.funders || []).filter((f) => f.status === 'rejected') : null;
  // Search matches the long and the short bucket label, as the Radar does, plus the same text fields the Radar searches.
  const labels = (b) => [D.BUCKETS[b], S.bucketLabel[b]].join(' ');
  const outRows = regOut ? regOut.map((f) => ({ id: f.id, name: f.name, program: f.program, reason: f.reject_reason || f.vet_note, bucket: f.bucket, at: f.evaluated_at || f.vetted_at || f.created_at,
    hay: [f.name, f.program, (f.themes || []).join(' '), (f.geography || []).join(' '), labels(f.bucket), f.notes, f.eligibility_note, f.vet_note, f.reject_reason].join(' ') }))
    : scr.map((x) => ({ id: null, name: x.name, program: x.program, reason: x.reason, bucket: x.bucket, at: x.at, hay: [x.name, x.program, x.reason, labels(x.bucket)].join(' ') }));
  outRows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const screenedN = outRows.length, crit = reg ? screenedCriteria(reg) : null, thr = reg?.thresholds || {};
  const critRow = (label, n) => el('li', { class: 'mcrit-r' }, el('span', { class: 'mcrit-l', text: label }), el('span', { class: 'pbar', 'aria-hidden': 'true' }, el('i', { style: `width:${screenedN ? Math.round(100 * n / screenedN) : 0}%` })), el('b', { class: 'num', text: num(n) }));
  const critBlock = crit ? [el('ul', { class: 'mcrit' }, critRow(`Fit below ${thr.fit_min ?? minFit}`, crit.fit), critRow('UA unlikely', crit.ua), critRow(`Award under ${D.money(thr.award_min_usd ?? feed.min_award ?? 200000)}`, crit.award),
    critRow(D.UNSCORED, crit.notScored), critRow('Screened out by the team', crit.team), critRow('No criterion recorded', crit.none)),
  el('p', { class: 'sub', text: 'One funder can fail more than one criterion, so the counts can add up to more than the total.' })]
    : [st.failed ? el('div', { class: 'mretry' }, el('p', { class: 'sub', text: 'The criterion for each funder is not available yet. The count above comes from the Radar feed.' }), retry())
      : el('p', { class: 'sub', role: 'status', text: st.loading ? 'Loading the criterion for each funder.' : 'The criterion for each funder appears once the full list loads.' })];
  const summary = el('div', { class: 'mscr-sum' },
    el('p', { class: 'mscr-big' }, el('span', { class: 'big num', text: num(screenedN) }), el('span', { class: 'sub', text: screenedN === 1 ? 'funder screened out, with a reason' : 'funders screened out, each with a reason' })),
    ...critBlock);
  const rule = el('div', { class: 'mrule' }, el('h3', { text: 'When a person decides' }),
    el('p', { text: 'A team member can promote a screened funder or demote a tracked one, with a short reason. That decision is a lock: automated vetting does not undo it. A promoted funder is scored and collected by the next agent run.' }));
  const dbLink = el('div', { class: 'mrow' }, el('button', { class: 'btn btn--sm', type: 'button', onclick: () => app.go('database') }, 'See every evaluated funder in Database', ico('chev')));
  const count = el('p', { class: 'sub mcount', role: 'status' }), list = el('ul', { class: 'mscr' });
  const more = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => { st.all = !st.all; drawScr(); } });
  function drawScr() {
    const searching = app.q().length > 0, hits = outRows.filter((x) => !searching || app.matchQ(x.hay));
    const shown = searching || st.all ? hits : hits.slice(0, LIST_CAP);
    list.replaceChildren(...shown.map((x) => el('li', { class: 'mscr-i' },
      el('div', { class: 'mscr-h' }, x.id ? el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(x.id) }, x.name) : el('b', { text: x.name || 'Unnamed funder' }), x.program ? el('span', { class: 'sub', text: x.program }) : null),
      el('p', { text: x.reason || 'No reason recorded' }),
      el('div', { class: 'row' }, bucket(x.bucket), el('span', { class: 'sub num', text: day(x.at) })))));
    count.textContent = !screenedN ? '' : searching ? `${hits.length} of ${screenedN} match “${(S.F.q || '').trim()}”` : `Showing the latest ${shown.length} of ${screenedN}`;
    if (!hits.length) list.replaceChildren(el('li', { class: 'mnone', text: screenedN ? 'Nothing matches that search.' : 'Nothing has been screened out yet.' }));
    more.hidden = searching || screenedN <= LIST_CAP; more.textContent = st.all ? 'Show fewer' : `Show all ${screenedN}`;
  }
  drawScr();

  /* 5. queued for vetting */
  const tg = feed.targets || {}, have = {}, cov = feed.coverage_min || {};
  for (const r of S.rows) have[r.bucket] = (have[r.bucket] || 0) + 1;
  const nextCount = el('p', { class: 'sub mcount', role: 'status' }), nextBox = el('div', { class: 'mnext-box' });
  function drawNext() {
    const all = tg.next || [], searching = app.q().length > 0;
    const hits = all.filter((t) => !searching || app.matchQ([t.org, t.program_hint, t.why, labels(t.bucket)].join(' ')));
    nextCount.textContent = searching && all.length ? `${hits.length} of ${all.length} match “${(S.F.q || '').trim()}”` : '';
    nextBox.replaceChildren(...(hits.length ? [el('ol', {}, hits.map((t) => el('li', {},
      el('div', {}, el('b', { text: t.org }), t.program_hint && el('span', { class: 'sub', text: ' ' + t.program_hint })), el('p', { text: t.why }),
      el('div', { class: 'row' }, bucket(t.bucket), el('span', { class: 'chip chip--line num', text: 'Priority ' + t.priority })))))]
      : [el('p', { class: 'mnone', text: 'Nothing in the next ones matches that search.' })]));
  }
  drawNext();
  const queue = tg.by_bucket?.length || tg.next?.length ? [
    el('p', { class: 'mlede', text: 'Beyond open searching, we keep a list of named funders to check one by one, so every kind of funder has enough coverage.' }),
    el('div', { class: 'mpair' },
    tg.by_bucket?.length ? el('table', { class: 'mtbl mcov' }, el('thead', {}, el('tr', {}, th('Type of funder'), th('Listed now', 'pts'), th('Waiting', 'pts'), th('Done', 'pts'), th('Ruled out', 'pts'), th('Put off', 'pts'))),
      el('tbody', {}, tg.by_bucket.map((b) => el('tr', {}, el('th', { scope: 'row' }, bucket(b.bucket)),
        el('td', { class: 'num pts', 'data-l': 'Listed now' }, String(have[b.bucket] || 0), cov[b.bucket] ? el('small', { class: 'sub', text: ` of ${cov[b.bucket]} wanted` }) : null),
        ...['pending', 'covered', 'rejected', 'deferred'].map((k) => el('td', { class: 'num pts', 'data-l': { pending: 'Waiting', covered: 'Done', rejected: 'Ruled out', deferred: 'Put off' }[k], text: b[k] ?? 0 })))))) : null,
    tg.next?.length ? el('div', { class: 'mnext' }, el('h3', { text: 'Next ones up' }), nextCount, nextBox) : null)] : [none('No named funders are queued right now.')];

  /* 6. discovery runs: the cadence comes from the last recorded check, not from a fixed schedule */
  const dc = feed.discovery, runs = dc?.runs || [], tot = dc?.totals, lr = feed.last_run, r24 = feed.runs_24h;
  const lastStamp = lr?.finished_at || lr?.started_at;
  const lastCheck = lastStamp ? `The last check ${D.relTime(lastStamp, S.now)} read ${pl(lr.fetched, 'page', 'pages')}; ${num(lr.changed)} changed.` : 'No check has been recorded yet.';
  const disc = [
    r24 ? el('p', { class: 'sub', text: `In the last 24 hours: ${pl(r24.runs, 'check', 'checks')}, ${pl(r24.fetched, 'page', 'pages')} read, ${num(r24.changed)} changed, ${pl(r24.errors, 'error', 'errors')}.` }) : null,
    tot ? el('div', { class: 'mtot' }, [['Examined', tot.examined], ['Listed', tot.vetted], ['Screened out', tot.rejected], ['Waiting on a check', tot.candidate]].map(([l, n]) => el('div', {}, el('span', { class: 'big num', text: n ?? 0 }), el('span', { class: 'sub', text: l })))) : null,
    runs.length ? el('table', { class: 'mtbl mruns' }, el('thead', {}, el('tr', {}, th('Run'), th('Examined', 'pts'), th('Listed', 'pts'), th('Screened out', 'pts'), th('Duplicates', 'pts'), th('What happened'))),
      el('tbody', {}, runs.map((r) => el('tr', {}, el('th', { scope: 'row' }, el('span', { class: 'num', text: day(r.started_at) }), el('small', { class: 'sub', text: r.run_label })),
        ...['examined', 'vetted', 'rejected', 'duplicate'].map((k, i) => el('td', { class: 'num pts', 'data-l': ['Examined', 'Listed', 'Screened out', 'Duplicates'][i], text: r[k] ?? 0 })), el('td', { text: r.summary || 'No summary recorded' }))))) : none('No discovery runs are recorded yet.'),
    dc?.by_lens?.length ? el('p', { class: 'sub mlens' }, 'By search lens: ', dc.by_lens.map((l) => `${l.lens} (${l.examined} examined, ${l.vetted} listed)`).join('; ')) : null];

  /* 7. how calls are collected */
  const cRows = coverageRows(S.rows), cMode = (m) => cRows.filter((r) => collectionOf(r).mode === m).length;
  const collect = [
    el('ul', { class: 'mcol-modes' }, Object.keys(COLLECT_SAYS).map((m) => el('li', {}, el('b', { text: D.COLLECT_MODES[m] }), el('span', { text: COLLECT_SAYS[m] }), el('span', { class: 'sub num', text: ` (${cMode(m)})` })))),
    el('p', { class: 'mcol-tot', role: 'status', text: totalsSentence(collectionTotals(feed, S.rows)) }),
    cRows.length ? el('div', { class: 'mwrap', tabindex: '0', role: 'region', 'aria-label': 'Sources and how they are collected' }, el('table', { class: 'mtbl mcol' }, el('thead', {}, el('tr', {}, th('Source'), th('How'), th('Via'), th('Status'), th('Open calls', 'pts'), th('Last checked'), th('Note'))),
      el('tbody', {}, cRows.map((r) => { const c = collectionOf(r); return el('tr', {}, el('th', { scope: 'row' }, el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(r.id) }, r.name), r.program && el('small', { class: 'sub', text: r.program })),
        el('td', { 'data-l': 'How', text: D.COLLECT_MODES[c.mode] || c.mode }), el('td', { 'data-l': 'Via', text: c.source || '' }), el('td', { 'data-l': 'Status' }, statusEl(app, c.health)),
        el('td', { class: 'num pts', 'data-l': 'Open calls', text: c.open_calls }), el('td', { 'data-l': 'Last checked', text: D.relTime(c.checked_at, S.now) }), el('td', { 'data-l': 'Note', text: c.note || '' })); })))) : none('No sources are listed yet.')];

  const jump = (id) => document.getElementById('m-' + id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  root.replaceChildren(el('div', { class: 'method' },
    el('nav', { class: 'mjump', 'aria-label': 'On this page' }, SECS.map(([id, t]) => el('button', { type: 'button', onclick: () => jump(id) }, t))),
    sec('listed', SECS[0][1], 'Nothing reaches the list on a hunch. Each funder goes through the same six steps, and any step can end it.', flow),
    sec('fit', SECS[1][1], null, ...fit),
    sec('rank', SECS[2][1], null, ...rank),
    sec('screened', SECS[3][1], 'Read, then ruled out. Each one has a reason, and the criterion it failed is counted here.', el('div', { class: 'mpair' }, el('div', {}, summary, rule, dbLink), el('div', { class: 'mscr-list' }, count, list, more))),
    sec('queue', SECS[4][1], null, ...queue),
    sec('runs', SECS[5][1], `Pages already on the list are re-read on a rolling schedule, so changes show up on the Radar. ${lastCheck}`, ...disc),
    sec('collection', SECS[6][1], null, ...collect)));
  root._mdraw = () => { drawScr(); drawNext(); };
}

// The search lives in the top bar; the module only redraws the two lists that follow it.
export function onQuery(root) { root._mdraw?.(); }

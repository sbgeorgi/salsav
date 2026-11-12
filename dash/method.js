// Method view: how the radar works, written from the feed itself (rubric, screened, targets, discovery) so it cannot drift from the database.
// Feed text goes through el()/textContent only. Jump links are buttons, not #anchors: the shell owns location.hash.
import { fitBar } from './viz.js';
import { COLLECT_SAYS, collectionOf, coverageRows, collectionTotals, totalsSentence, statusEl } from './drawer.js';

const svgEl = (s) => { const t = document.createElement('template'); t.innerHTML = s; return t.content.firstElementChild; }; // viz.js escapes every string it receives
const ui = { q: '' };

export function render(root, app) {
  const { S, D, el, ico } = app, feed = S.feed || {}, rb = app.rubric();
  const minAward = D.money(feed.min_award ?? 200000), minDays = feed.min_days ?? 14, minFit = rb?.min_fit ?? 40;
  const bucket = (b) => el('span', { class: 'chip chip--line', style: `--c:var(--b-${b in D.BUCKETS ? b : 'tracker'})` }, el('i', { class: 'dot' }), S.bucketLabel[b] || b);
  const day = (ts) => D.fmtDate(String(ts || '').slice(0, 10)) || 'n/a';
  const none = (t) => el('p', { class: 'mnone', text: t });
  const sec = (id, n, title, lede, ...body) => el('section', { class: 'msec', id: 'm-' + id, 'aria-labelledby': 'mh-' + id },
    el('header', {}, el('span', { class: 'mnum', 'aria-hidden': 'true', text: n }), el('h2', { id: 'mh-' + id, text: title })), lede && el('p', { class: 'mlede', text: lede }), ...body);
  const th = (t, cls) => el('th', { scope: 'col', class: cls, text: t });

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
    el('header', {}, el('h3', { text: 'A worked example' }), el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(pool[0].id) }, pool[0].name), el('span', { class: 'chip chip--line num', text: `${ex.total} points, ${ex.tier.label}` })),
    svgEl(fitBar(ex.dims.map((d) => ({ key: d.key, label: d.label, max: d.max, points: d.points })), { w: 420, h: 8, values: true, total: ex.total })),
    el('ol', { class: 'mexl' }, ex.dims.map((d) => el('li', {},
      el('div', { class: 'mexh' }, el('b', { text: d.label }), el('span', { class: 'num', text: `${d.points} of ${d.max}` }), el('span', { class: 'sub', text: d.levelLabel })),
      d.why && el('p', { text: d.why }),
      d.quote && el('blockquote', {}, d.quote, el('small', { class: d.ok ? 'ok' : '', text: d.ok ? ' Found on the funder’s page.' : ' Not on the monitored page.', title: d.ok ? null : 'The quote was not found in the page text the crawler stores. It may sit in a linked document.' }))))),
    el('p', { class: 'sub', text: `Add the six lines: ${ex.total} of ${total}. Judged parts come from reading the page; eligibility and award are worked out from the data.` })) : null;

  const fit = rb?.dims?.length ? [
    el('p', { class: 'mlede', text: `A funder scores up to ${total} points across ${rb.dims.length} questions. Under ${minFit} points it is not listed. The score is the plain sum of the six parts, and every part follows one written rule.` }),
    tierRow, rb.dims.map(dimBlock), example] : [el('div', { class: 'state' }, el('h2', { text: 'The scoring rules are not published yet' }), el('p', { text: 'This feed does not carry the fit scoring rules. Once the database publishes it, every rule and point value shows here.' }))];

  /* 3. how next best moves are ranked */
  const parts = [['Fit score', 'Up to 100', 'Start from the fit score.'], ['Deadline 14 to 45 days away', '+12', 'Soon, but still enough time.'], ['Deadline 46 to 90 days away', '+15', 'The sweet spot for a proposal.'], ['Deadline 91 to 180 days away', '+8', 'Plenty of time, less pressure.'],
    ['Rolling call', '+4', 'No date, so no rush.'], ['Recurs every year', '+2', 'Prepare for the next round.'], ['UA can apply directly', '+5', 'No partner needed.'], ['3 or 4 key facts quoted', '+3', 'Award, deadline, eligibility and mission are backed by the page.']];
  const top = D.recommend(S.rows, S.now, 5);
  const lanes = { apply_now: 'A deadline is at least ' + minDays + ' days away.', rolling: 'Open all year; apply any time.', prepare: 'Recurs every year; the next date is not set yet.', cultivate: 'By invitation, so build the relationship first.', watch: 'Not actionable yet.' };
  const rank = [
    el('p', { class: 'mlede', text: 'The Next best moves strip on the Radar suggests what to work on this week. It only considers funders that are open to us: in the Apply now, Rolling or Prepare lane, not closed or too soon, and not yet started or still being reviewed. Each gets points, and the highest total comes first. If two tie, the sooner deadline wins, then the name.' }),
    el('table', { class: 'mtbl mrank' }, el('thead', {}, el('tr', {}, th('Adds points for'), th('Points', 'pts'), th('Why'))),
      el('tbody', {}, parts.map(([a, b, c]) => el('tr', {}, el('th', { scope: 'row', text: a }), el('td', { class: 'num pts', text: b }), el('td', { text: c }))))),
    el('p', { class: 'sub', text: 'A deadline closer than ' + minDays + ' days is not suggested, and a deadline beyond 180 days gets no urgency points.' }),
    el('dl', { class: 'mlanes' }, Object.entries(D.LANES).flatMap(([k, v]) => [el('dt', { text: v }), el('dd', { text: lanes[k] })])),
    top.length ? el('div', { class: 'mtop' }, el('h3', { text: 'At the top right now' }), el('ol', {}, top.map((x) => el('li', {}, el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(x.row.id) }, x.row.name), el('span', { class: 'big num', text: x.score }), el('small', { text: x.reasons.join(' · ') }))))) : null];

  /* 4. screened out */
  const scr = Array.isArray(feed.screened) ? feed.screened : [];
  const list = el('ul', { class: 'mscr' }), count = el('p', { class: 'sub', role: 'status' });
  const drawScr = () => {
    const q = ui.q.trim().toLowerCase();
    const hit = q ? scr.filter((x) => [x.name, x.program, x.reason, S.bucketLabel[x.bucket]].some((v) => String(v || '').toLowerCase().includes(q))) : scr;
    list.replaceChildren(...hit.map((x) => el('li', {}, el('div', {}, el('b', { text: x.name }), x.program && el('span', { class: 'sub', text: ' ' + x.program })), el('p', { text: x.reason || 'No reason recorded' }), el('div', { class: 'row' }, bucket(x.bucket), el('span', { class: 'sub num', text: day(x.at) })))));
    count.textContent = q ? `${hit.length} of ${scr.length} match` : `Showing the latest ${scr.length}`;
    if (!hit.length) list.replaceChildren(el('li', { class: 'mnone', text: scr.length ? 'Nothing matches that search.' : 'Nothing has been screened out yet.' }));
  };
  drawScr();
  const search = el('input', { type: 'search', 'aria-label': 'Search screened-out sources', placeholder: 'Search name, reason or type', value: ui.q, oninput: (e) => { ui.q = e.target.value; drawScr(); } });
  const screened = el('details', { class: 'mscreen' }, el('summary', {}, el('span', { text: 'Screened out' }), el('span', { class: 'chip num', text: scr.length }), el('span', { class: 'sub', text: 'Read, then ruled out. Each has a reason.' })),
    scr.length ? [el('label', { class: 'field field--grow' }, search), count, list] : none('Nothing has been screened out yet.'));

  /* 5. queued for vetting */
  const tg = feed.targets || {}, have = {}, cov = feed.coverage_min || {};
  for (const r of S.rows) have[r.bucket] = (have[r.bucket] || 0) + 1;
  const queue = tg.by_bucket?.length || tg.next?.length ? [
    el('p', { class: 'mlede', text: 'Beyond open searching, we keep a list of named funders to check one by one, so every kind of funder has enough coverage.' }),
    tg.by_bucket?.length ? el('table', { class: 'mtbl mcov' }, el('thead', {}, el('tr', {}, th('Type of funder'), th('Listed now', 'pts'), th('Waiting', 'pts'), th('Done', 'pts'), th('Ruled out', 'pts'), th('Put off', 'pts'))),
      el('tbody', {}, tg.by_bucket.map((b) => el('tr', {}, el('th', { scope: 'row' }, bucket(b.bucket)),
        el('td', { class: 'num pts', 'data-l': 'Listed now' }, String(have[b.bucket] || 0), cov[b.bucket] ? el('small', { class: 'sub', text: ` of ${cov[b.bucket]} wanted` }) : null),
        ...['pending', 'covered', 'rejected', 'deferred'].map((k) => el('td', { class: 'num pts', 'data-l': { pending: 'Waiting', covered: 'Done', rejected: 'Ruled out', deferred: 'Put off' }[k], text: b[k] ?? 0 })))))) : null,
    tg.next?.length ? el('div', { class: 'mnext' }, el('h3', { text: 'Next ones up' }), el('ol', {}, tg.next.map((t) => el('li', {},
      el('div', {}, el('b', { text: t.org }), t.program_hint && el('span', { class: 'sub', text: ' ' + t.program_hint })), el('p', { text: t.why }),
      el('div', { class: 'row' }, bucket(t.bucket), el('span', { class: 'chip chip--line num', text: 'Priority ' + t.priority })))))) : null] : [none('No named funders are queued right now.')];

  /* 6. discovery runs */
  const dc = feed.discovery, runs = dc?.runs || [], tot = dc?.totals;
  const disc = [
    el('p', { class: 'mlede', text: 'Pages already on the list are re-read twice a day. A search for new funders runs every Tuesday and Friday. Each run examines possible sources and keeps only the ones that pass the checks above.' }),
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
    cRows.length ? el('table', { class: 'mtbl mcol' }, el('thead', {}, el('tr', {}, th('Source'), th('How'), th('Via'), th('Status'), th('Open calls', 'pts'), th('Last checked'), th('Note'))),
      el('tbody', {}, cRows.map((r) => { const c = collectionOf(r); return el('tr', {}, el('th', { scope: 'row' }, el('button', { class: 'rl', type: 'button', onclick: () => app.openDrawer(r.id) }, r.name), r.program && el('small', { class: 'sub', text: r.program })),
        el('td', { 'data-l': 'How', text: D.COLLECT_MODES[c.mode] || c.mode }), el('td', { 'data-l': 'Via', text: c.source || '' }), el('td', { 'data-l': 'Status' }, statusEl(app, c.health)),
        el('td', { class: 'num pts', 'data-l': 'Open calls', text: c.open_calls }), el('td', { 'data-l': 'Last checked', text: D.relTime(c.checked_at, S.now) }), el('td', { 'data-l': 'Note', text: c.note || '' })); }))) : none('No sources are listed yet.')];

  const SECS = [['listed', 'How a source gets listed'], ['fit', 'How fit is scored'], ['rank', 'How next best moves are ranked'], ['screened', 'Screened out'], ['queue', 'Queued for vetting'], ['runs', 'Discovery runs'], ['collection', 'How calls are collected']];
  const jump = (id) => document.getElementById('m-' + id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  root.replaceChildren(el('div', { class: 'method' },
    el('nav', { class: 'mjump', 'aria-label': 'On this page' }, SECS.map(([id, t]) => el('button', { type: 'button', onclick: () => jump(id) }, t))),
    sec('listed', '1', SECS[0][1], 'Nothing reaches the list on a hunch. Each funder goes through the same six steps, and any step can end it.', flow),
    sec('fit', '2', SECS[1][1], null, ...fit),
    sec('rank', '3', SECS[2][1], null, ...rank),
    sec('screened', '4', SECS[3][1], null, screened),
    sec('queue', '5', SECS[4][1], null, ...queue),
    sec('runs', '6', SECS[5][1], null, ...disc),
    sec('collection', '7', SECS[6][1], null, ...collect)));
}

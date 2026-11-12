// Insights view: seven sections, each opens with a one-sentence takeaway computed from the data, then the chart.
// Numbers come from D.insights(rows, feed, now); charts are SVG strings from dash/viz.js, parsed with DOMParser (never innerHTML),
// Feed text only reaches the page through el()/textContent or viz.js (which escapes).
import * as V from './viz.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a = {}, ...k) => { const e = document.createElementNS(NS, t); for (const [n, v] of Object.entries(a)) if (v != null && v !== false) e.setAttribute(n, v === true ? '' : v); for (const c of k.flat()) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c); return e; };
const parse = (str) => document.importNode(new DOMParser().parseFromString(str.replace('<svg ', `<svg xmlns="${NS}" `), 'image/svg+xml').documentElement, true);
const RH = () => (innerWidth <= 760 ? 44 : 24); // phone-sized rows give chart bars a 44px tap target
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const GLYPH = { us_federal: '●', intl_dev: '■', state_regional: '◆', private_sector: '▲', foundation_ngo: '+', tracker: '○' };
const shortDay = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''; };

export function render(root, app) {
  const { S, D, el } = app, feed = S.feed || {}, rows = S.rows || [];
  const I = D.insights(rows, feed, S.now), live = rows.filter((r) => !r._dq && !r._skip);
  const blabel = (b) => S.bucketLabel?.[b] || D.BUCKETS[b] || b, slabel = (s) => S.stateLabel?.[s] || s;
  const bcolor = (b) => `var(--b-${b in D.BUCKETS ? b : 'tracker'})`;
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
  const section = (id, n, title, take, ...body) => el('section', { class: 'ins-sec', id: 'ins-' + id, 'aria-labelledby': 'ins-h-' + id },
    el('div', { class: 'ins-head' }, el('p', { class: 'eyebrow', text: n }), el('h2', { id: 'ins-h-' + id, text: title }), el('p', { class: 'ins-take', text: take })), el('div', { class: 'ins-body' }, ...body));
  const sub = (title, note) => el('div', { class: 'ins-sub' }, el('h3', { text: title }), note ? el('p', { class: 'sub', text: note }) : null);

  /* 1. Opportunity map */
  const dated = I.scatter.filter((p) => p.days >= 0 && p.days <= 365), outside = I.scatter.length - dated.length;
  const hot = dated.filter((p) => p.fit >= 60 && p.days <= 90);
  const mapTake = dated.length || I.undated.length ? (hot.length ? `${plural(hot.length, 'strong-fit funder closes', 'strong-fit funders close')} within 90 days.` : 'No strong-fit funder closes within 90 days.') : 'No scored funders yet.';
  const mapHost = chart(el('div', { class: 'ins-map' }), (w) => {
    if (!dated.length) return empty('No funder has a scored fit and a deadline in the next 12 months.');
    const h = Math.round(Math.min(340, Math.max(240, w * 0.5))), s = parse(V.scatter(dated, { w, h, xMax: 365, yMax: 100, xLabel: 'Days to deadline', yLabel: 'Fit score', labelTop: w < 500 ? 2 : 4 }));
    const L = 34, T = 8, pw = w - L - 10, ph = h - T - 24, zw = pw * 90 / 365, zh = ph * 0.4; // mirrors the plot box inside viz.scatter
    s.querySelector('title').after(sv('rect', { class: 'ins-zone', x: L, y: T, width: zw, height: zh }), zw > 80 ? sv('text', { class: 'ins-zone-t', x: L + zw - 4, y: T + zh - 5, 'text-anchor': 'end' }, 'Act now') : null);
    [...s.querySelectorAll('text')].find((t) => t.textContent === 'Fit score')?.remove(); // the caption names the axes; the label collided with top marks
    [...s.querySelectorAll('text')].find((t) => t.textContent === 'Days to deadline')?.setAttribute('y', h + 12); // clear of the 365 tick label
    return wire(s, '.viz-mark', app.openDrawer);
  });
  const legend = el('ul', { class: 'ins-legend', 'aria-label': 'Funder buckets' }, Object.keys(D.BUCKETS).filter((b) => dated.some((p) => p.bucket === b)).map((b) => el('li', {}, el('span', { class: 'gl', style: `color:${bcolor(b)}`, 'aria-hidden': 'true', text: GLYPH[b] }), blabel(b))),
    el('li', { class: 'sub', text: 'Bigger mark = larger award. Shaded: fit 60+ closing within 90 days.' }));
  const lanes = Object.entries(D.LANES).map(([k, l]) => [l, I.undated.filter((p) => p.lane === k).sort((a, b) => b.fit - a.fit)]).filter(([, a]) => a.length);
  const strip = el('aside', { class: 'ins-undated', 'aria-label': 'Funders without a fixed date', tabindex: '0' }, el('h3', { text: `No fixed date (${I.undated.length})` }),
    lanes.length ? lanes.map(([l, a]) => el('div', { class: 'ins-lane' }, el('h4', { text: `${l} ${a.length}` }), el('ul', {}, a.map((p) => el('li', {}, el('button', { type: 'button', class: 'ins-link', title: p.name, onclick: () => app.openDrawer(p.id), 'aria-label': `${p.name}, fit ${p.fit}` },
      el('span', { class: 'mk', style: `background:${bcolor(p.bucket)}`, 'aria-hidden': 'true' }), el('span', { class: 'nm', text: p.name }), el('span', { class: 'sc', text: String(p.fit) }))))))) : empty('Every scored funder has a date.'));
  const s1 = section('map', '1 Opportunity map', 'Fit against time left', mapTake,
    el('p', { class: 'sub', text: `Height is fit score, distance from the left is days to the deadline. ${dated.length} dated${outside ? `, ${outside} outside the next 12 months` : ''}, ${I.undated.length} without a fixed date. Click a mark for details.` }),
    el('div', { class: 'ins-split' }, el('div', {}, mapHost, dated.length ? legend : null), strip));

  /* 2. Fit */
  const scoredN = I.fitHist.reduce((a, t) => a + t.n, 0), topN = I.fitHist.filter((t) => t.tier === 'prime' || t.tier === 'strong').reduce((a, t) => a + t.n, 0);
  const itemized = live.filter((r) => r.fit_breakdown).length, anat = I.anatomy, weak = itemized ? [...anat].sort((a, b) => a.avg / (a.max || 1) - b.avg / (b.max || 1))[0] : null;
  const fitTake = !scoredN ? 'No funder has a fit score yet.' : `${topN} of ${scoredN} scored funders are prime or strong.${weak ? ` The weakest part is ${weak.label.toLowerCase()}, averaging ${weak.avg} of ${weak.max}.` : ' Scores are not itemized yet, so only the tier spread is shown.'}`;
  const tierHost = chart(el('div', { class: 'ins-tier' }), (w) => scoredN ? wire(parse(V.hbars(I.fitHist.map((t) => ({ id: t.tier, label: t.label, value: t.n })), { w, rowH: RH(), labelW: 84, valueW: 32 })), '.viz-row', (k) => pick('tier', k)) : empty('Nothing to count yet.'));
  const bar = (pct, cls = '') => el('span', { class: 'bar ' + cls, 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }));
  const anatBox = el('div', { class: 'ins-rows' }, anat.length && itemized ? anat.map((d) => el('div', { class: 'ins-r' + (weak && d.key === weak.key ? ' weak' : '') }, el('span', { class: 'lab', text: d.label }), bar(d.max ? d.avg / d.max * 100 : 0),
    el('span', { class: 'val num' }, `${d.avg} of ${d.max}`, weak && d.key === weak.key ? el('em', { text: ' weakest' }) : null))) : empty('Appears once funders are scored on the six parts of the fit score.'));
  const s2 = section('fit', '2 Fit', 'How well the funders match', fitTake,
    el('div', { class: 'ins-two' }, el('div', {}, sub('Funders by tier', 'Click a bar to filter the Radar.'), tierHost), el('div', {}, sub('Score anatomy', `Average points per part against its maximum, over ${plural(itemized, 'itemized funder', 'itemized funders')}.`), anatBox)));

  /* 3. Coverage and targeting */
  const gaps = I.coverage.filter((c) => c.vetted < c.min).sort((a, b) => (b.min - b.vetted) - (a.min - a.vetted));
  const covTake = !I.coverage.length ? 'This feed sets no coverage targets.' : gaps.length ? `${blabel(gaps[0].bucket)} is the biggest gap: ${gaps[0].vetted} of ${gaps[0].min} vetted, ${gaps[0].pending ? plural(gaps[0].pending, 'target', 'targets') + ' queued' : 'no targets queued'}. ${gaps.length > 1 ? `${gaps.length} of ${I.coverage.length} buckets are short.` : 'Every other bucket has reached its target.'}` : 'Every bucket has reached its vetted target.';
  const s3 = section('cov', '3 Coverage and targeting', 'Are we looking in enough places', covTake,
    el('div', { class: 'ins-rows ins-cov' }, I.coverage.length ? I.coverage.map((c) => { const top = Math.max(c.min, c.vetted), short = c.min - c.vetted;
      return el('div', { class: 'cov-r' + (short > 0 ? ' short' : '') }, el('button', { type: 'button', class: 'ins-link lab', onclick: () => pick('bucket', c.bucket) }, el('span', { class: 'mk', style: `background:${bcolor(c.bucket)}`, 'aria-hidden': 'true' }), blabel(c.bucket)),
        el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${c.vetted / top * 100}%` }), el('b', { style: `left:${c.min / top * 100}%` })),
        el('span', { class: 'val num' }, `${c.vetted} of ${c.min}`, el('em', { text: short > 0 ? ` ${short} short` : ' target met' })),
        el('span', { class: 'facts sub', text: `${c.screened} screened out, ${plural(c.pending, 'target', 'targets')} queued` }));
    }) : empty('No coverage targets in this feed.')));

  /* 4. Pipeline */
  const askOf = (r) => r.team?.ask_usd ?? r.award_max_usd ?? 0, dec = rows.filter((r) => r.team?.state === 'declined');
  const stages = [...I.funnel.filter((x) => x.state !== 'new').map((x) => ({ ...x, label: slabel(x.state) })), { state: 'declined', label: slabel('declined'), n: dec.length, usd: dec.reduce((a, r) => a + askOf(r), 0) }];
  const by = Object.fromEntries(stages.map((x) => [x.state, x])), prog = ['reviewing', 'applying', 'submitted'].reduce((a, k) => ({ n: a.n + by[k].n, usd: a.usd + by[k].usd }), { n: 0, usd: 0 });
  const pipeTake = stages.every((x) => !x.n) ? 'Nothing is in the pipeline yet. Move a funder to Reviewing to start.' : `${plural(prog.n, 'funder is', 'funders are')} in progress${prog.usd ? `, ${D.money(prog.usd)} at stake` : ''}; ${by.awarded.n} awarded, ${by.declined.n} declined.`;
  const s4 = section('pipe', '4 Pipeline', 'Where each bid stands', pipeTake,
    chart(el('div', { class: 'ins-pipe' }), (w) => stages.every((x) => !x.n) ? empty('No funder has a team status beyond New.') : wire(parse(V.funnel(stages, { w, rowH: RH(), labelW: 84, valueW: 96 })), '.viz-row', (k) => pick('team', k))),
    stages.some((x) => x.n) ? el('p', { class: 'sub', text: 'Dollars use the team ask when set, else the largest published award. Click a row to filter the Radar.' }) : null);

  /* 5. Awards and funder mix (the deadline horizon now lives on the Radar page) */
  const cnt = (f) => live.filter(f).length, mix = Object.keys(D.BUCKETS).map((b) => ({ id: b, label: blabel(b), value: cnt((r) => r.bucket === b), bucket: b })), band = D.BANDS.map(([b, l]) => ({ id: b, label: l, value: cnt((r) => r._band === b) }));
  const bigMix = [...mix].sort((a, b) => b.value - a.value)[0], unver = band.find((b) => b.id === 'unverified');
  const awardTake = live.length ? `${bigMix.label} is the largest group, ${bigMix.value} of ${live.length}. ${plural(unver.value, 'funder has', 'funders have')} no published award.` : 'No live funders yet.';
  const s5 = section('time', '5 Awards and mix', 'How big the awards are and who gives', awardTake,
    el('div', { class: 'ins-two' },
      el('div', {}, sub('Funder mix', live.length ? `${bigMix.label} is the largest group, ${bigMix.value} of ${live.length}.` : ''), chart(el('div', {}), (w) => live.length ? wire(parse(V.hbars(mix, { w, rowH: RH(), labelW: Math.min(150, w * .45), valueW: 32 })), '.viz-row', (k) => pick('bucket', k)) : empty('No live funders.'))),
      el('div', {}, sub('Award size', live.length ? `${plural(unver.value, 'funder has', 'funders have')} no published award.` : ''), chart(el('div', { class: 'ins-band' }), (w) => live.length ? wire(parse(V.hbars(band, { w, rowH: RH(), labelW: 96, valueW: 32 })), '.viz-row', (k) => pick('band', k)) : empty('No live funders.')))));

  /* 6. Data confidence */
  const thin = [...I.quality].sort((a, b) => a.pct - b.pct)[0], H = I.health;
  const confTake = !live.length ? 'No live funders to check yet.' : `${thin.label} is the thinnest fact: ${thin.pct}% of funders.${H.total ? ` ${H.checked24h} of ${H.total} sources were checked in the last 24 hours.` : ''}`;
  const stat = (n, l, bad) => el('div', { class: 'ins-stat' + (bad ? ' bad' : '') }, el('span', { class: 'big num', text: String(n) }), el('span', { class: 'l', text: l }));
  // Share of listed sources the crawler reads by itself, per daily snapshot; one point shows today's number only.
  const C = I.collect, cd = C.days, cpct = C.now ? Math.round(C.now.auto / C.now.listed * 100) : cd.length ? cd[cd.length - 1].pct : null;
  const collBlock = el('div', { class: 'ins-trend', id: 'ins-collect' }, el('span', { class: 'l', text: 'Automatic collection' }), el('span', { class: 'big num', text: cpct == null ? '–' : cpct + '%' }),
    el('span', { class: 'sub num', text: C.now ? `${C.now.auto} of ${C.now.listed} listed sources collected automatically, ${plural(C.now.openCalls, 'open call', 'open calls')} found` : 'Not reported yet' }),
    cd.length > 1 ? chart(el('div', { class: 'sp' }), (w) => parse(V.spark(cd.map((x) => x.pct), { w, h: 34, label: 'Share of sources collected automatically' }))) : null);
  const s6 = section('conf', '6 Data confidence', 'How much of this can be trusted', confTake,
    el('div', { class: 'ins-two' },
      el('div', {}, sub('Facts known', 'Share of live funders where each fact is on file.'), chart(el('div', { class: 'ins-meters' }), (w) => live.length ? I.quality.map((q) => el('div', { class: 'ins-m' }, el('span', { class: 'lab', text: q.label }), parse(V.meter(q.pct, { w: Math.max(120, w), label: q.label })))) : empty('No live funders.'))),
      el('div', {}, sub('Source health', 'A manual check means a blocked page or repeated fetch failures.'), H.total ? el('div', { class: 'ins-stats' }, stat(H.checked24h, `of ${H.total} checked in the last 24 hours`), stat(H.failing, 'failing their last check', H.failing > 0), stat(H.manual, 'need a manual check', H.manual > 0)) : empty('No sources yet.'))),
    el('div', { class: 'ins-trends' }, collBlock));

  /* 7. Trends and discovery */
  const T = I.trend, n = T.days.length, d = I.discovery, runs = [...(d?.runs || [])].sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')).slice(0, 6), lens = [...(d?.by_lens || [])].filter((l) => l.examined > 0).map((l) => ({ ...l, y: l.vetted / l.examined * 100 })).sort((a, b) => b.y - a.y).slice(0, 8);
  const tot = d?.totals, bestLens = lens[0];
  const trTake = [n > 1 ? `Vetted sources went from ${T.vetted[0]} to ${T.vetted[n - 1]} since ${shortDay(T.days[0])}.` : 'Trends appear after the second daily snapshot.',
    tot?.examined ? `Of ${tot.examined} sources examined, ${tot.vetted} made the list (${Math.round(tot.vetted / tot.examined * 100)}%)${bestLens && bestLens.vetted ? `; ${bestLens.lens} yields best` : ''}.` : 'No discovery runs recorded yet.'].join(' ');
  const cell = (label, vals) => { const last = vals[n - 1], dl = last - vals[0]; return el('div', { class: 'ins-trend' }, el('span', { class: 'l', text: label }), el('span', { class: 'big num', text: n ? String(last) : '–' }),
    el('span', { class: 'sub num', text: n > 1 ? `${dl > 0 ? '+' : ''}${dl} since ${shortDay(T.days[0])}` : 'No history yet' }), chart(el('div', { class: 'sp' }), (w) => parse(V.spark(vals, { w, h: 34, label }))));  };
  const s7 = section('trend', '7 Trends and discovery', 'Is the radar improving', trTake,
    el('div', { class: 'ins-trends' }, cell('Vetted sources', T.vetted), cell('Apply now', T.applyNow), cell('Three or more facts quoted', T.evidence3)),
    el('div', { class: 'ins-two' },
      el('div', {}, sub('Discovery runs', 'Sources examined per run, split by what happened to them.'), chart(el('div', { class: 'ins-runs' }), (w) => runs.length ? parse(V.stackedBars(runs.map((r) => ({ id: r.run_label, label: shortDay(r.started_at) || r.run_label, parts: [{ key: 'listed', label: 'Listed', value: r.vetted }, { key: 'screened', label: 'Screened out', value: r.rejected }, { key: 'known', label: 'Already known', value: r.duplicate }] })), { w, labelW: 56, totalW: 28 })) : empty('No discovery runs recorded yet.'))),
      el('div', {}, sub('Yield per lens', 'Share of examined sources that were listed.'), chart(el('div', {}), (w) => lens.length ? parse(V.hbars(lens.map((l) => ({ id: l.lens, label: l.lens, value: l.y, note: `${l.vetted} listed of ${l.examined} examined` })), { w, labelW: Math.min(140, w * .5), valueW: 40, fmt: (v) => Math.round(v) + '%', max: 100 })) : empty('No lens data yet.')))));

  const sections = [['map', 'Opportunity map'], ['fit', 'Fit'], ['cov', 'Coverage'], ['pipe', 'Pipeline'], ['time', 'Awards and mix'], ['conf', 'Confidence'], ['trend', 'Trends']];
  const jump = el('nav', { class: 'ins-jump', 'aria-label': 'Jump to a section' }, sections.map(([id, l]) => el('button', { type: 'button', onclick: () => document.getElementById('ins-' + id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), text: l })));
  root.replaceChildren(el('div', { class: 'ins' }, jump, s1, s2, s3, s4, s5, s6, s7));
  const drawAll = () => draws.forEach((f) => f());
  drawAll();
  // Redraw on width change (text stays at its real size instead of shrinking with the viewBox). Disconnect once the view is gone.
  root._insRO?.disconnect(); let last = root.clientWidth;
  root._insRO = new ResizeObserver(() => { if (!root.querySelector('.ins')) return root._insRO.disconnect(); if (root.hidden) return; if (Math.abs(root.clientWidth - last) > 24) { last = root.clientWidth; drawAll(); } });
  root._insRO.observe(root);
}

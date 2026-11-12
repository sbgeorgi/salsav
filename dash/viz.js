// Pure SVG-string chart primitives for the funding radar. No DOM access, so they run in node.
// Colours come only from classes defined in dash/viz.css. Every caller-supplied string is escaped here.
// Marks the caller may wire up carry data-id (rows, segments, points).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : d; };
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cls = (s) => String(s ?? '').replace(/[^a-z0-9_-]/gi, '');
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
const usd = (v) => { v = num(v); return v >= 1e6 ? '$' + r2(v / 1e6) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v); };
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const BUCKETS = ['us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo', 'tracker'];
const bucketCls = (k, i = 0) => (BUCKETS.includes(k) ? 'viz-b-' + k : 'viz-s' + (i % 6));

const svg = (w, h, label, body, extra = '') =>
  `<svg class="viz ${extra}" viewBox="0 0 ${r2(w)} ${r2(h)}" width="${r2(w)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMinYMid meet"><title>${esc(label)}</title>${body}</svg>`;

const empty = (w, h, label, extra) =>
  svg(w, h, label, `<text class="viz-t viz-muted" x="0" y="${h / 2}" dominant-baseline="central">No data yet</text>`, extra);

// Six-segment (or n-segment) fit bar. dims: [{key,label,points,max}]. Segment widths are proportional to max.
export function fitBar(dims, { w = 240, h = 8, values = false, total } = {}) {
  const d = (Array.isArray(dims) ? dims : []).map((x) => ({ key: x?.key, label: x?.label ?? x?.key, max: Math.max(0, num(x?.max)), points: Math.max(0, num(x?.points)) }));
  const vh = values ? h + 14 : h;
  if (!d.length) return svg(w, vh, 'Fit score not itemized yet', `<rect class="viz-track viz-dash" x="0" y="0" width="${w}" height="${h}" rx="${h / 2}"/>`, 'viz-fitbar');
  const gap = 2, sum = d.reduce((a, x) => a + x.max, 0), avail = w - gap * (d.length - 1);
  let x0 = 0, body = '';
  for (const x of d) {
    const sw = r2(sum > 0 ? (avail * x.max) / sum : avail / d.length);
    const fw = r2(x.max > 0 ? sw * clamp(x.points / x.max, 0, 1) : 0);
    body += `<g class="viz-seg" data-id="${esc(x.key)}"><title>${esc(`${x.label}: ${r2(x.points)} of ${r2(x.max)}`)}</title><rect class="viz-track" x="${r2(x0)}" y="0" width="${sw}" height="${h}" rx="1.5"/>` +
      (fw > 0 ? `<rect class="viz-fill${x.points >= x.max ? ' viz-full' : ''}" x="${r2(x0)}" y="0" width="${fw}" height="${h}" rx="1.5"/>` : '') +
      (values ? `<text class="viz-t viz-sm viz-num" x="${r2(x0 + sw / 2)}" y="${h + 11}" text-anchor="middle">${r2(x.points)}</text>` : '') + '</g>';
    x0 += sw + gap;
  }
  const tot = total ?? d.reduce((a, x) => a + Math.min(x.points, x.max), 0);
  const label = `Fit ${r2(num(tot))} of ${r2(sum)}: ` + d.map((x) => `${x.label} ${r2(x.points)} of ${r2(x.max)}`).join(', ');
  return svg(w, vh, label, body, 'viz-fitbar');
}

// Score ring: arc proportional to score/max, number centred. tier (optional) picks the arc colour class.
export function ring(score, { size = 64, label = 'Fit', max = 100, tier = '' } = {}) {
  const sw = r2(size * 0.11), r = r2((size - sw) / 2), c = r2(2 * Math.PI * r), cx = size / 2;
  const has = isNum(score), mx = num(max, 100) || 100;
  const arc = has ? r2(c * (clamp(num(score), 0, mx) / mx)) : 0;
  const aria = has ? `${label} ${r2(num(score))} of ${r2(mx)}` : `${label} not itemized yet`;
  const body = `<circle class="viz-track viz-ring-track" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${sw}"/>` +
    (arc > 0 ? `<circle class="viz-ring-arc${tier ? ' viz-t-' + cls(tier) : ''}" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${arc} ${c}" transform="rotate(-90 ${cx} ${cx})"/>` : '') +
    `<text class="viz-t viz-num viz-big" x="${cx}" y="${cx}" text-anchor="middle" dominant-baseline="central" font-size="${r2(size * (has ? 0.34 : 0.3))}">${has ? Math.round(num(score)) : '–'}</text>`;
  return svg(size, size, aria, body, 'viz-ring');
}

// Sparkline. values: numbers (non-numeric entries are skipped).
export function spark(values, { w = 120, h = 28, label = 'Trend' } = {}) {
  const v = (Array.isArray(values) ? values : []).filter(isNum).map(Number);
  const pad = 3;
  if (!v.length) return svg(w, h, `${label}: no data yet`, `<line class="viz-axis viz-dash" x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}"/>`, 'viz-spark');
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, last = v.length - 1;
  const X = (i) => r2(v.length === 1 ? w - pad : pad + ((w - 2 * pad) * i) / last);
  const Y = (y) => r2(hi === lo ? h / 2 : h - pad - ((h - 2 * pad) * (y - lo)) / span);
  const body = (v.length > 1 ? `<polyline class="viz-line" fill="none" points="${v.map((y, i) => `${X(i)},${Y(y)}`).join(' ')}"/>` : '') +
    `<circle class="viz-dot" cx="${X(last)}" cy="${Y(v[last])}" r="2.5"/>`;
  return svg(w, h, `${label}: ${v.length} points, from ${r2(v[0])} to ${r2(v[last])}, low ${r2(lo)}, high ${r2(hi)}`, body, 'viz-spark');
}

// Horizontal bars with direct labels. items: [{id,label,value,bucket?,note?}]. fmt formats the value text.
export function hbars(items, { w = 320, rowH = 24, labelW = 112, valueW = 44, fmt = (v) => String(r2(v)), max } = {}) {
  const it = (Array.isArray(items) ? items : []).map((x, i) => ({ id: x?.id ?? x?.label ?? i, label: x?.label ?? x?.id ?? '', value: Math.max(0, num(x?.value)), bucket: x?.bucket, note: x?.note }));
  if (!it.length) return empty(w, rowH, 'Bars: no data yet', 'viz-hbars');
  const m = num(max) || Math.max(1, ...it.map((x) => x.value));
  const bw = w - labelW - valueW, bh = Math.min(10, rowH - 10);
  const label = 'Bars: ' + it.map((x) => `${x.label} ${fmt(x.value)}`).join(', ');
  const body = it.map((x, i) => {
    const fw = x.value > 0 ? Math.max(2, r2(bw * clamp(x.value / m, 0, 1))) : 0, cy = i * rowH + rowH / 2;
    return `<g class="viz-row" data-id="${esc(x.id)}"><title>${esc(`${x.label}: ${fmt(x.value)}${x.note ? ', ' + x.note : ''}`)}</title>` +
      `<rect class="viz-hit" x="0" y="${i * rowH}" width="${w}" height="${rowH}"/>` +
      `<text class="viz-t" x="0" y="${cy}" dominant-baseline="central">${esc(clip(x.label, Math.floor(labelW / 6)))}</text>` +
      `<rect class="viz-track" x="${labelW}" y="${cy - bh / 2}" width="${bw}" height="${bh}" rx="2"/>` +
      (fw ? `<rect class="viz-fill ${bucketCls(x.bucket, i)}" x="${labelW}" y="${cy - bh / 2}" width="${fw}" height="${bh}" rx="2"/>` : '') +
      `<text class="viz-t viz-num viz-strong" x="${w}" y="${cy}" text-anchor="end" dominant-baseline="central">${esc(fmt(x.value))}</text></g>`;
  }).join('');
  return svg(w, it.length * rowH, label, body, 'viz-hbars');
}

// Mark shapes differ by bucket so colour is never the only cue.
function mark(shape, x, y, r) {
  const f = r2;
  switch (shape) {
    case 1: return `<rect x="${f(x - r)}" y="${f(y - r)}" width="${f(2 * r)}" height="${f(2 * r)}" rx="1"/>`;
    case 2: return `<path d="M${f(x)} ${f(y - r * 1.25)}L${f(x + r * 1.25)} ${f(y)}L${f(x)} ${f(y + r * 1.25)}L${f(x - r * 1.25)} ${f(y)}Z"/>`;
    case 3: return `<path d="M${f(x)} ${f(y - r * 1.2)}L${f(x + r * 1.15)} ${f(y + r * 0.9)}L${f(x - r * 1.15)} ${f(y + r * 0.9)}Z"/>`;
    case 4: return `<path class="viz-plus" d="M${f(x - r)} ${f(y)}H${f(x + r)}M${f(x)} ${f(y - r)}V${f(y + r)}"/>`;
    case 5: return `<circle class="viz-hollow" cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.8)}"/>`;
    default: return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
  }
}

// Scatter. points: [{id,name,bucket,lane?,[x],[y],[r]}]; key defaults match insights().scatter (days, fit, award).
export function scatter(points, { w = 360, h = 220, x = 'days', y = 'fit', r = 'award', xLabel = 'Days to deadline', yLabel = 'Fit score', xMax, yMax = 100, labelTop = 3 } = {}) {
  const P = (Array.isArray(points) ? points : []).filter((p) => p && isNum(p[x]) && isNum(p[y]));
  const L = 34, B = 24, T = 8, Rm = 10, pw = w - L - Rm, ph = h - T - B;
  const xm = num(xMax) || Math.max(30, ...P.map((p) => num(p[x]))), ym = num(yMax, 100) || 100;
  const X = (v) => r2(L + pw * clamp(num(v) / xm, 0, 1)), Y = (v) => r2(T + ph * (1 - clamp(num(v) / ym, 0, 1)));
  const ra = P.map((p) => Math.max(0, num(p[r]))), rmax = Math.max(1, ...ra);
  let body = `<line class="viz-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}"/><line class="viz-axis" x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}"/>`;
  for (let i = 0; i <= 4; i++) {
    const yv = (ym * i) / 4, xv = (xm * i) / 4;
    body += `<line class="viz-axis" x1="${L - 3}" y1="${Y(yv)}" x2="${L}" y2="${Y(yv)}"/><text class="viz-t viz-sm viz-muted viz-num" x="${L - 6}" y="${Y(yv)}" text-anchor="end" dominant-baseline="central">${Math.round(yv)}</text>` +
      `<line class="viz-axis" x1="${X(xv)}" y1="${T + ph}" x2="${X(xv)}" y2="${T + ph + 3}"/><text class="viz-t viz-sm viz-muted viz-num" x="${X(xv)}" y="${T + ph + 14}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${Math.round(xv)}</text>`;
  }
  body += `<text class="viz-t viz-sm viz-muted" x="${L + pw}" y="${h - 1}" text-anchor="end">${esc(xLabel)}</text><text class="viz-t viz-sm viz-muted" x="${L + 4}" y="${T + 7}">${esc(yLabel)}</text>`;
  const keys = [...new Set(P.map((p) => p.bucket))];
  const order = P.map((p, i) => i).sort((a, b) => num(P[b][y]) - num(P[a][y]));
  const top = new Set(), placed = [];
  // Label the highest-fit points, skipping any whose label box would overlap one already placed.
  for (const i of order) {
    if (top.size >= labelTop) break;
    const px = X(P[i][x]), py = Y(P[i][y]), wd = clip(P[i].name ?? P[i].id, 14).length * 5.5 + 10, right = px > L + pw * 0.7;
    const box = [right ? px - wd : px, right ? px : px + wd, py];
    if (placed.some((q) => Math.abs(q[2] - box[2]) < 12 && q[0] < box[1] && box[0] < q[1])) continue;
    placed.push(box); top.add(i);
  }
  P.forEach((p, i) => {
    const rad = r2(3 + 4 * Math.sqrt(ra[i] / rmax)), px = X(p[x]), py = Y(p[y]), right = px > L + pw * 0.7;
    const tip = `${p.name ?? p.id}: fit ${r2(num(p[y]))}, ${r2(num(p[x]))} days${ra[i] ? ', up to ' + usd(ra[i]) : ''}`;
    body += `<g class="viz-mark ${bucketCls(p.bucket, keys.indexOf(p.bucket))}" data-id="${esc(p.id)}"${p.lane ? ` data-lane="${esc(p.lane)}"` : ''}><title>${esc(tip)}</title>${mark(Math.max(0, BUCKETS.indexOf(p.bucket)) % 6, px, py, rad)}` +
      (top.has(i) ? `<text class="viz-t viz-sm viz-halo" x="${r2(right ? px - rad - 3 : px + rad + 3)}" y="${py}" text-anchor="${right ? 'end' : 'start'}" dominant-baseline="central">${esc(clip(p.name ?? p.id, 14))}</text>` : '') + '</g>';
  });
  const label = P.length ? `Scatter of ${P.length} funders, ${yLabel} against ${xLabel}. Highest fit ${r2(num(P[order[0]][y]))}` : 'Scatter: no dated funders yet';
  return svg(w, h, label, body, 'viz-scatter');
}

// Funnel: centred bars that narrow with count. stages: [{state,label?,n,usd?}].
export function funnel(stages, { w = 360, rowH = 30, labelW = 84, valueW = 84 } = {}) {
  const s = (Array.isArray(stages) ? stages : []).map((x) => ({ id: x?.state ?? x?.label ?? '', label: x?.label ?? x?.state ?? '', n: Math.max(0, num(x?.n)), usd: num(x?.usd) }));
  if (!s.length) return empty(w, rowH, 'Pipeline: no data yet', 'viz-funnel');
  const m = Math.max(1, ...s.map((x) => x.n)), bw = w - labelW - valueW, bh = Math.min(18, rowH - 12);
  const label = 'Pipeline: ' + s.map((x) => `${x.label} ${x.n}${x.usd ? ' (' + usd(x.usd) + ')' : ''}`).join(', ');
  const body = s.map((x, i) => {
    const fw = x.n > 0 ? Math.max(3, r2((bw * x.n) / m)) : 0, cy = i * rowH + rowH / 2;
    return `<g class="viz-row" data-id="${esc(x.id)}"><title>${esc(`${x.label}: ${x.n}${x.usd ? ', ' + usd(x.usd) : ''}`)}</title>` +
      `<rect class="viz-hit" x="0" y="${i * rowH}" width="${w}" height="${rowH}"/>` +
      `<text class="viz-t" x="0" y="${cy}" dominant-baseline="central">${esc(clip(x.label, Math.floor(labelW / 6)))}</text>` +
      `<rect class="viz-track" x="${labelW}" y="${cy - bh / 2}" width="${bw}" height="${bh}" rx="2"/>` +
      (fw ? `<rect class="viz-fill viz-f${Math.min(i, 5)}" x="${r2(labelW + (bw - fw) / 2)}" y="${cy - bh / 2}" width="${fw}" height="${bh}" rx="2"/>` : '') +
      `<text class="viz-t viz-num viz-strong" x="${w - valueW + 8}" y="${cy}" dominant-baseline="central">${x.n}<tspan class="viz-muted" dx="6">${x.usd ? esc(usd(x.usd)) : ''}</tspan></text></g>`;
  }).join('');
  return svg(w, s.length * rowH, label, body, 'viz-funnel');
}

// Single percentage meter with its number printed beside it.
export function meter(pct, { w = 160, h = 8, label = 'Progress' } = {}) {
  const has = isNum(pct), p = clamp(num(pct), 0, 100), tw = w - 40, vh = Math.max(h, 12), cy = vh / 2;
  const body = `<rect class="viz-track" x="0" y="${cy - h / 2}" width="${tw}" height="${h}" rx="${h / 2}"/>` +
    (has && p > 0 ? `<rect class="viz-fill" x="0" y="${cy - h / 2}" width="${r2(Math.max(h, (tw * p) / 100))}" height="${h}" rx="${h / 2}"/>` : '') +
    `<text class="viz-t viz-num viz-strong" x="${w}" y="${cy}" text-anchor="end" dominant-baseline="central">${has ? Math.round(p) + '%' : '–'}</text>`;
  return svg(w, vh, has ? `${label} ${Math.round(p)} percent` : `${label}: no data yet`, body, 'viz-meter');
}

// Stacked bars. series: [{id,label,parts:[{key,label?,value}]}]. Counts print inside wide segments; a legend names every part.
export function stackedBars(series, { w = 360, rowH = 26, labelW = 96, totalW = 30, legend = true, normalize = false } = {}) {
  const S = (Array.isArray(series) ? series : []).map((s, i) => ({
    id: s?.id ?? s?.label ?? i, label: s?.label ?? s?.id ?? '',
    parts: (Array.isArray(s?.parts) ? s.parts : []).map((p) => ({ key: p?.key ?? '', label: p?.label ?? p?.key ?? '', value: Math.max(0, num(p?.value)) })),
  }));
  if (!S.length) return empty(w, rowH, 'Stacked bars: no data yet', 'viz-stacked');
  const tot = (s) => s.parts.reduce((a, p) => a + p.value, 0);
  const m = Math.max(1, ...S.map(tot)), bw = w - labelW - totalW, bh = rowH - 10;
  const keys = [...new Map(S.flatMap((s) => s.parts).map((p) => [p.key, p.label])).entries()];
  let lx = 0, ly = 0, legendSvg = '';
  if (legend) {
    keys.forEach(([k, lab], i) => {
      const t = clip(lab, 18), cw = 18 + t.length * 6 + 10;
      if (lx + cw > w && lx > 0) { lx = 0; ly += 16; }
      legendSvg += `<g class="viz-leg ${bucketCls(k, i)}"><rect x="${lx}" y="${ly + 2}" width="9" height="9" rx="2"/><text class="viz-t viz-sm" x="${lx + 13}" y="${ly + 7}" dominant-baseline="central">${esc(t)}</text></g>`;
      lx += cw;
    });
  }
  const label = 'Stacked bars: ' + S.map((s) => `${s.label} ${tot(s)} (${s.parts.filter((p) => p.value).map((p) => `${p.label} ${p.value}`).join(', ')})`).join('; ');
  const body = S.map((s, i) => {
    const y = i * rowH + 5, t = tot(s), scale = normalize ? (t ? bw / t : 0) : bw / m;
    let x0 = labelW;
    const segs = s.parts.filter((p) => p.value > 0).map((p) => {
      const sw = r2(Math.max(1, p.value * scale)), ki = keys.findIndex(([k]) => k === p.key);
      const g = `<g class="viz-seg ${bucketCls(p.key, ki)}" data-id="${esc(s.id)}:${esc(p.key)}"><title>${esc(`${s.label}, ${p.label}: ${p.value}`)}</title><rect class="viz-fill viz-gap" x="${r2(x0)}" y="${y}" width="${sw}" height="${bh}"/>` +
        (sw >= 20 ? `<text class="viz-t viz-sm viz-num viz-on" x="${r2(x0 + sw / 2)}" y="${y + bh / 2}" text-anchor="middle" dominant-baseline="central">${p.value}</text>` : '') + '</g>';
      x0 += sw;
      return g;
    }).join('');
    return `<g class="viz-row"><text class="viz-t" x="0" y="${y + bh / 2}" dominant-baseline="central">${esc(clip(s.label, Math.floor(labelW / 6)))}</text><rect class="viz-track" x="${labelW}" y="${y}" width="${bw}" height="${bh}" rx="2"/>${segs}` +
      `<text class="viz-t viz-num viz-strong" x="${w}" y="${y + bh / 2}" text-anchor="end" dominant-baseline="central">${t}</text></g>`;
  }).join('');
  const bodyH = S.length * rowH;
  return svg(w, bodyH + (legend ? ly + 18 : 0), label, body + (legend ? `<g transform="translate(0 ${bodyH + 4})">${legendSvg}</g>` : ''), 'viz-stacked');
}

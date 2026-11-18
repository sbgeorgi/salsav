// node dash/database.test.mjs: row building, filters, sort, summary, agent schedule, leads and calls, team identity fallbacks,
// CSV and JSON export against dash/mock.json, plus source guards for the view and its stylesheet (no innerHTML, tokens only, known classes).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as DB from './database.js';
import * as D from '../dashboard.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const reg = JSON.parse(read('dash/mock.json')).registry;
const funders = reg.funders;
let n = 0;
const t = (name, fn) => { fn(); n++; };

const noNotes = {};
const rows = DB.buildRows(reg, noNotes);
const named = (s) => rows.find((r) => r.name.startsWith(s));

t('buildRows: one row per registry funder, every status, ids unique', () => {
  assert.equal(rows.length, funders.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.deepEqual(rows.map((r) => r.id).sort(), funders.map((f) => f.id).sort());
  const by = (s) => rows.filter((r) => r.status === s).length;
  assert.equal(by('vetted'), 16);
  assert.equal(by('rejected'), 7);
  assert.equal(by('candidate'), 2);
});
t('buildRows: notes come from the injected lookup', () => {
  const r = DB.buildRows(reg, { notes: () => 3 })[0];
  assert.equal(r.notes, 3);
  assert.equal(DB.buildRows(reg, { notes: () => null })[0].notes, null);
});
t('buildRows: a judgment call is a screened-out funder whose every gate passed', () => {
  const j = rows.filter((r) => r.judgment);
  assert.ok(j.every((r) => r.status === 'rejected' && r.f.gates.pass === true));
  assert.equal(j.length, funders.filter((f) => f.status === 'rejected' && f.gates?.pass === true).length);
});
t('criteriaOf: names every failed gate, none for a pass, judgment only when screened out', () => {
  assert.deepEqual(DB.criteriaOf({ status: 'vetted', gates: { scored: true, fit: true, ua: true, award: true, pass: true } }), []);
  assert.deepEqual(DB.criteriaOf({ status: 'rejected', gates: { scored: true, fit: false, ua: false, award: false, pass: false } }), ['fit', 'ua', 'award']);
  assert.deepEqual(DB.criteriaOf({ status: 'rejected', gates: { scored: false } }), ['unscored']);
  assert.deepEqual(DB.criteriaOf({ status: 'rejected', gates: { scored: true, fit: true, ua: true, award: true, pass: true } }), ['judgment']);
  assert.deepEqual(DB.criteriaOf({ status: 'vetted', gates: { scored: true, fit: true, ua: true, award: true, pass: true } }), []);
});
t('criterionRows: three checks, pass is null and the actual reads Not scored yet when the fit score is not there', () => {
  const cr = DB.criterionRows({ gates: { scored: false, ua: true, award: false }, ua_eligibility: 'eligible', award_max_usd: 150000, fit_score: null }, { fit_min: 40, award_min_usd: 200000 });
  assert.deepEqual(cr.map((c) => c.key), ['fit', 'ua', 'award']);
  assert.equal(cr[0].pass, null);
  assert.equal(cr[0].actual, D.UNSCORED);
  assert.equal(cr[1].pass, true);
  assert.equal(cr[2].pass, false);
  assert.match(cr[2].threshold, /200,000|200k/);
});
t('an unscored tracked funder (promoted, no fit score): Not scored yet, no pass, queued for the agent', () => {
  const g = named('Greenfield');
  assert.equal(g.status, 'vetted');
  assert.equal(g.fit, null);
  assert.equal(g.fitMin, reg.thresholds.fit_min);
  assert.equal(g.queue, 'pending');
  assert.equal(g.human.lock, 'promoted');
  assert.ok(g.criteria.includes('unscored'));
  assert.equal(DB.criterionRows(g.f, reg.thresholds)[0].actual, 'Not scored yet');
  assert.equal(DB.criterionRows(g.f, reg.thresholds)[0].pass, null);
  assert.equal(D.UNSCORED, 'Not scored yet');
});
t('filterRows: status, category and criterion filters agree with the raw registry', () => {
  const F = (o) => DB.filterRows(rows, o, []).length;
  assert.equal(F({ status: 'all' }), 25);
  assert.equal(F({ status: 'vetted' }), 16);
  assert.equal(F({ status: 'rejected' }), 7);
  assert.equal(F({ criterion: 'fit' }), funders.filter((f) => f.gates?.scored !== false && f.gates?.fit === false).length);
  assert.equal(F({ criterion: 'unscored' }), funders.filter((f) => f.gates?.scored === false).length);
  assert.equal(F({ criterion: 'judgment' }), rows.filter((r) => r.judgment).length);
  assert.equal(F({ human: true }), 4);
  assert.equal(F({ queue: true }), 2);
  assert.equal(F({ openCalls: true }), funders.filter((f) => f.calls_open > 0).length);
  assert.equal(F({ buckets: ['us_federal', 'intl_dev'] }), funders.filter((f) => ['us_federal', 'intl_dev'].includes(f.bucket)).length);
});
t('filterRows: search words must all match (name, reason, theme, category label)', () => {
  const hits = DB.filterRows(rows, {}, ['universities']).map((r) => r.name);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].startsWith('Heartland'));
  assert.equal(DB.filterRows(rows, {}, ['universities', 'zzz-no-match']).length, 0);
  assert.equal(DB.filterRows(rows, { status: 'vetted' }, ['universities']).length, 0);
  const g = DB.filterRows(rows, {}, ['greenfield']);
  assert.equal(g.length, 1);
  assert.equal(g[0].status, 'vetted');
});
t('filterRows: organization type and size band', () => {
  const org = DB.orgOptions(rows);
  assert.deepEqual(org, [['funder', 'Funder'], ['none', 'Not set']]);
  assert.equal(DB.filterRows(rows, { org: 'funder' }).length, funders.filter((f) => f.category === 'funder').length);
  const band = rows[0].band;
  assert.equal(DB.filterRows(rows, { band }).length, rows.filter((r) => r.band === band).length);
});
t('sortRows: default is evaluated newest first; screened view puts judgment calls first', () => {
  const def = DB.sortRows(rows, DB.defaultSort({}));
  for (let i = 1; i < def.length; i++) {
    const a = def[i - 1].evalMs, b = def[i].evalMs;
    if (a != null && b != null) assert.ok(a >= b, `${def[i - 1].name} before ${def[i].name}`);
  }
  const scr = DB.sortRows(rows.filter((r) => r.status === 'rejected'), DB.defaultSort({ status: 'rejected' }));
  const anyJ = scr.some((r) => r.judgment);
  if (anyJ) assert.equal(scr[0].judgment, true);
  assert.equal(DB.defaultSort({ status: 'rejected' }).judgmentFirst, true);
  assert.equal(DB.defaultSort({}).judgmentFirst, false);
});
t('sortRows: nulls last in both directions, fit descending', () => {
  const fit = DB.sortRows(rows, { key: 'fit', dir: 'desc' });
  const firstNull = fit.findIndex((r) => r.fit == null);
  if (firstNull > -1) assert.ok(fit.slice(firstNull).every((r) => r.fit == null));
  const vals = fit.filter((r) => r.fit != null).map((r) => r.fit);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a));
  const asc = DB.sortRows(rows, { key: 'fit', dir: 'asc' }).filter((r) => r.fit != null).map((r) => r.fit);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
});
t('nextSort: same column flips, a new column starts in its natural direction', () => {
  assert.deepEqual(DB.nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.deepEqual(DB.nextSort({ key: 'name', dir: 'desc' }, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(DB.nextSort({ key: 'name', dir: 'asc' }, 'fit'), { key: 'fit', dir: 'desc' });
  assert.deepEqual(DB.nextSort(null, 'name'), { key: 'name', dir: 'asc' });
});
t('summarize: the strip counts stay on the full registry', () => {
  const s = DB.summarize(rows, reg);
  assert.equal(s.tracked, 16);
  assert.equal(s.screened, 7);
  assert.equal(s.candidates, 2);
  assert.equal(s.leads, reg.leads.filter((l) => l.status === 'pending' || l.status === 'deferred').length);
  assert.equal(s.queue, 2);
  assert.equal(s.human, 4);
});
t('agentQueue: pending funders, oldest promotion first, then name', () => {
  const q = DB.agentQueue([
    { name: 'B', queue: 'pending', human: { at: '2026-11-16T10:00:00Z' } },
    { name: 'A', queue: 'pending', human: { at: '2026-11-14T10:00:00Z' } },
    { name: 'C', queue: 'done', human: { at: '2026-11-01T10:00:00Z' } },
    { name: 'D', queue: 'pending', human: null },
  ]);
  assert.deepEqual(q.map((f) => f.name), ['A', 'B', 'D']);
  assert.deepEqual(DB.agentQueue(funders).map((f) => f.id), funders.filter((f) => f.queue === 'pending').map((f) => f.id));
});
t('queueLine: who promoted and when, with the fallbacks for a read without a name or time', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  assert.equal(DB.queueLine({ human: { by: 'Ben Okafor', at: '2026-11-16T15:00:00Z' } }, now), 'Promoted by Ben Okafor, 21 h ago');
  assert.equal(DB.queueLine({ human: { by: null, at: null } }, now), 'Promoted, time not recorded');
  assert.equal(DB.queueLine({ human: null }, now), 'Promoted, time not recorded');
});
t('decisionParts: a name only when the read carries one; no null or undefined in any part', () => {
  const pub = DB.decisionParts({ lock: 'promoted', by: null, at: null, note: null });
  assert.deepEqual(pub, { by: '', verb: 'promoted this funder', start: 'Promoted this funder' });
  const named = DB.decisionParts({ lock: 'demoted', by: ' Ana Ruiz ' }, 'funder');
  assert.equal(named.by, 'Ana Ruiz');
  assert.equal(named.verb, 'screened this funder out');
  assert.equal(DB.decisionParts({ lock: 'demoted', by: 'Ana Ruiz' }, 'call').verb, 'hid this call from the feed');
  assert.equal(DB.decisionParts({ lock: 'promoted' }, 'call').verb, 'put this call in the feed');
  assert.equal(DB.decisionParts({ lock: 'other', by: 'Ana' }).verb, 'made a decision');
  assert.equal(DB.decisionParts(null).by, '');
  assert.equal(DB.decisionParts(undefined).start, 'Made a decision');
  for (const p of [pub, named, DB.decisionParts(undefined), DB.decisionParts(null)]) {
    for (const v of Object.values(p)) assert.doesNotMatch(String(v), /null|undefined|NaN/);
  }
});
t('nextAgentRun: next Tuesday or Friday at 07:00 local, strictly after now', () => {
  assert.equal(new Date(2026, 10, 17).getDay(), 2, '2026-11-17 is a Tuesday');
  const at = (y, mo, d, h, mi = 0) => new Date(y, mo, d, h, mi).getTime();
  assert.equal(DB.nextAgentRun(new Date(2026, 10, 17, 8)).getTime(), at(2026, 10, 20, 7));
  assert.equal(DB.nextAgentRun(new Date(2026, 10, 17, 6, 59)).getTime(), at(2026, 10, 17, 7));
  assert.equal(DB.nextAgentRun(new Date(2026, 10, 17, 7)).getTime(), at(2026, 10, 20, 7));
  assert.equal(DB.nextAgentRun(new Date(2026, 10, 20, 7, 1)).getTime(), at(2026, 10, 24, 7));
  assert.equal(DB.nextAgentRun(new Date(2026, 10, 22, 12)).getTime(), at(2026, 10, 24, 7));
  assert.equal(DB.agentRunLabel(new Date(2026, 10, 17, 8)), 'Friday, Nov 20 at 07:00');
  assert.equal(DB.agentDaysText(), 'Tuesdays and Fridays');
});
t('leadGroups: four groups in status order, each sorted by priority', () => {
  const g = DB.leadGroups(reg.leads);
  assert.deepEqual(g.map((x) => x.status), ['pending', 'deferred', 'covered', 'rejected']);
  assert.deepEqual(g.map((x) => x.label), ['Pending', 'Deferred', 'Covered', 'Dismissed']);
  assert.equal(g.reduce((s, x) => s + x.items.length, 0), reg.leads.length);
  for (const x of g) for (let i = 1; i < x.items.length; i++) assert.ok((x.items[i - 1].priority ?? 99) <= (x.items[i].priority ?? 99));
});
t('leadActions: queue for deferred or dismissed, dismiss for pending or deferred, nothing for covered', () => {
  assert.deepEqual(DB.leadActions({ status: 'pending' }), { queue: false, dismiss: true });
  assert.deepEqual(DB.leadActions({ status: 'deferred' }), { queue: true, dismiss: true });
  assert.deepEqual(DB.leadActions({ status: 'rejected' }), { queue: true, dismiss: false });
  assert.deepEqual(DB.leadActions({ status: 'covered' }), { queue: false, dismiss: false });
});
t('calls: the state list is the five states the Calls tab offers, in order', () => {
  assert.deepEqual(DB.CALL_STATES.map(([k]) => k), ['all', 'feed', 'hidden', 'candidate', 'decided']);
});
t('callRows and callCounts: every call by state; counts add up to the calls in each group', () => {
  const all = reg.calls;
  const c = DB.callCounts(all);
  assert.equal(c.all, all.length);
  assert.equal(c.feed, all.filter((x) => x.vet_status === 'vetted').length);
  assert.equal(c.hidden, all.filter((x) => x.vet_status === 'rejected').length);
  assert.equal(c.candidate, all.filter((x) => x.vet_status === 'candidate').length);
  assert.equal(c.decided, all.filter((x) => !!x.human).length);
  assert.equal(c.feed + c.hidden + c.candidate, all.length, 'every call is in the feed, hidden or candidate');
  assert.equal(DB.callRows(all, { state: 'all' }).length, all.length);
  assert.equal(DB.callRows(all, { state: 'feed' }).length, c.feed);
  assert.ok(c.feed > 0, 'in-feed calls are listed, so Demote is reachable from the Calls tab');
  assert.ok(DB.callRows(all, { state: 'decided' }).every((x) => !!x.human));
});
t('callRows: a funder scope keeps only that funder\'s calls', () => {
  const all = reg.calls;
  const scope = all[0].funder_id;
  const mine = DB.callRows(all, { funder: scope });
  assert.ok(mine.length > 0 && mine.every((x) => x.funder_id === scope));
  assert.equal(DB.callRows(all, { funder: 'no-such-funder' }).length, 0);
});
t('callAction: Restore for a hidden call, Demote for an in-feed or candidate call', () => {
  assert.equal(DB.callAction({ vet_status: 'rejected' }), 'restore');
  assert.equal(DB.callAction({ vet_status: 'vetted' }), 'demote');
  assert.equal(DB.callAction({ vet_status: 'candidate' }), 'demote');
});
t('sortCalls: soonest deadline first, calls without one last, then by title', () => {
  const s = DB.sortCalls([{ title: 'C', deadline: null }, { title: 'B', deadline: '2026-12-28' }, { title: 'A', deadline: '2026-11-30' }, { title: 'D' }]);
  assert.deepEqual(s.map((x) => x.title), ['A', 'B', 'C', 'D']);
});
t('registryCsv: BOM, one header and one record per funder, every record has every column', () => {
  const csv = DB.registryCsv(funders);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const records = parseCsv(csv.slice(1));
  assert.equal(records.length, funders.length + 1);
  assert.equal(records[0][0], 'Funder id');
  for (const rec of records) assert.equal(rec.length, DB.EXPORT_COLS.length);
  assert.equal(records[1][0], funders[0].id);
  assert.equal(records[1][1], funders[0].name);
});
t('registryCsv: a read without team identity exports blank cells, never null', () => {
  const f = { id: 'x', name: 'Y', status: 'vetted', gates: { pass: true }, human: { lock: 'promoted', by: null, at: null, note: null } };
  const csv = DB.registryCsv([f]);
  assert.doesNotMatch(csv, /null|undefined/);
  const rec = parseCsv(csv.slice(1))[1];
  assert.equal(rec[DB.EXPORT_COLS.findIndex((c) => c[0] === 'Human by')], '');
  assert.equal(rec[DB.EXPORT_COLS.findIndex((c) => c[0] === 'Human lock')], 'promoted');
});
t('registryCsv: commas, quotes and formulas are quoted through csvCell', () => {
  const csv = DB.registryCsv([{ id: 'x', name: 'A, "B"', status: 'rejected', gates: { pass: false } }]);
  const rec = parseCsv(csv.slice(1))[1];
  assert.equal(rec[1], 'A, "B"');
  assert.equal(rec[DB.EXPORT_COLS.findIndex((c) => c[0] === 'Gate: pass')], 'false');
  assert.equal(rec[DB.EXPORT_COLS.findIndex((c) => c[0] === 'Status')], 'Screened out');
});
t('registryJson: count and funders match the input, exported_at is ISO', () => {
  const j = JSON.parse(DB.registryJson(funders, new Date('2026-11-17T08:00:00Z')));
  assert.equal(j.count, funders.length);
  assert.equal(j.funders.length, funders.length);
  assert.equal(j.exported_at, '2026-11-17T08:00:00.000Z');
});
t('exports keep the funder fields a reviewer needs: reason, gates, human lock', () => {
  const h = named('Heartland');
  assert.ok(h.human && h.human.lock === 'demoted');
  const rec = parseCsv(DB.registryCsv([h.f]).slice(1))[1];
  assert.equal(rec[DB.EXPORT_COLS.findIndex((c) => c[0] === 'Human lock')], 'demoted');
  assert.ok(rec[DB.EXPORT_COLS.findIndex((c) => c[0] === 'Reject reason')].length > 0);
});

/* ---- source guards ---- */
const js = read('dash/database.js');
const css = read('dash/database.css');
const sharedCss = read('dashboard.css') + read('dash/ui.css');

t('database.js builds the DOM without innerHTML or raw HTML strings', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
t('database.js and database.css: no em or en dashes, middle dots, arrows or emoji', () => {
  for (const s of [js, css]) assert.doesNotMatch(s, /[–—·→\u{1F300}-\u{1FAFF}☀-➿]/u);
});
t('database.css: colours come from tokens only (no hex, rgb or hsl literals)', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});
t('database.css: every var() it uses is defined in the shared tokens', () => {
  const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const setInline = ['--tick']; // set on each fit bar by database.js
  const missing = used.filter((v) => !setInline.includes(v) && !new RegExp(`${v}\\s*:`).test(sharedCss));
  assert.deepEqual(missing, []);
});
t('database.js: every db- class it writes is styled in database.css', () => {
  const used = [...new Set([...js.matchAll(/['"`]\s*(?:db-[a-z0-9-]+)/g)].flatMap((m) => m[0].match(/db-[a-z0-9-]+/g)))];
  const missing = used.filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
  assert.deepEqual(missing, []);
});
t('database.css: each inline stand-in is hidden by default, shown in its own band, and its column is hidden there', () => {
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const displayOf = (block, sel) => {
    let d = null;
    for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(',').map((s) => s.trim()).includes(sel)) continue;
      const v = m[2].match(/display:\s*([a-z-]+)/);
      if (v) d = v[1];
    }
    return d;
  };
  const BANDS = [['db-ua-inline', 'c-ua', 1359], ['db-eval-inline', 'c-eval', 1239], ['db-pipe-inline', 'c-pipe', 1039]];
  for (const [inl, col, max] of BANDS) {
    assert.equal(displayOf(top, '.' + inl), 'none', `.${inl} is hidden by default`);
    const band = css.match(new RegExp(`@media \\(min-width: 901px\\) and \\(max-width: ${max}px\\) \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(band, `.${inl} has its 901-${max}px band`);
    assert.notEqual(displayOf(band[1], '.' + inl), 'none', `.${inl} shows in its band`);
    assert.equal(displayOf(band[1], '.' + col), 'none', `.${col} hides in the same band`);
  }
});
t('database.js: the exported view contract (render, onQuery) and the page size', () => {
  assert.equal(typeof DB.render, 'function');
  assert.equal(typeof DB.onQuery, 'function');
  assert.equal(DB.PAGE, 50);
  assert.deepEqual(DB.AGENT_DAYS, [2, 5]);
  assert.equal(DB.AGENT_HOUR, 7);
});
t('database.js takes the agent schedule from ui.js (no copy), and a queued funder shows the agent-queue chip beside Tracked', () => {
  assert.match(js, /from '\.\/ui\.js'/);
  assert.doesNotMatch(js, /function (nextAgentRun|agentRunLabel|agentDaysText)\b|DAY_NAMES/);
  assert.match(js, /r\.queue === 'pending' \? statusChip\('queue'\)/);
});

/* a small RFC 4180 reader: enough for the export's own quoting rules */
function parseCsv(text) {
  const out = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); out.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}

t('inFeed and the feed state: only a vetted call that is open or forecasted, a closed one is not in the feed', () => {
  const call = (vet_status, status) => ({ vet_status, status });
  assert.equal(DB.inFeed(call('vetted', 'open')), true);
  assert.equal(DB.inFeed(call('vetted', 'forecasted')), true);
  assert.equal(DB.inFeed(call('vetted', 'closed')), false, 'a vetted but closed call is not in the feed');
  assert.equal(DB.inFeed(call('rejected', 'open')), false);
  assert.equal(DB.callMatches(call('vetted', 'closed'), 'feed'), false);
  assert.equal(DB.callMatches(call('vetted', 'open'), 'feed'), true);
});

t('buildRows: a team decision is the reason and the crawler reason moves to its own field', () => {
  const f = { id: 'x1', name: 'Demo fund', status: 'rejected', reject_reason: 'Geography fails', human: { lock: true, note: 'Kept for the spring round' } };
  const [team] = DB.buildRows({ funders: [f] });
  assert.equal(team.reason, 'Team decision: Kept for the spring round');
  assert.equal(team.crawler, 'Geography fails');
  const [plain] = DB.buildRows({ funders: [{ ...f, human: null }] });
  assert.equal(plain.reason, 'Geography fails');
  assert.equal(plain.crawler, '');
});

t('buildRows: a named team decision leads the Why reason with who; a withheld note (public read) shows a team marker above the automated reason', () => {
  const f = { id: 'x2', name: 'Demo fund', status: 'rejected', reject_reason: 'Geography fails', human: { lock: 'demoted', by: ' Ana Ruiz ', note: 'Kept for the spring round' } };
  const [named] = DB.buildRows({ funders: [f] });
  assert.equal(named.reason, 'Team decision by Ana Ruiz: Kept for the spring round');
  assert.equal(named.crawler, 'Geography fails');
  const [withheld] = DB.buildRows({ funders: [{ ...f, human: { ...f.human, by: null, note: null } }] });
  assert.equal(withheld.reason, 'Team decision. Unlock to read the reason.');
  assert.equal(withheld.crawler, 'Geography fails');
});

t('buildRows: an aggregator (category or its vet note) is flagged for the Database note; a funder is not', () => {
  const agg = { id: 'g1', name: 'Grants.gov keyword search', status: 'candidate', category: null, bucket: 'tracker', vet_note: 'Aggregator: confirm each call on the funder page.' };
  const [a] = DB.buildRows({ funders: [agg] });
  assert.equal(a.aggregator, true);
  const [b] = DB.buildRows({ funders: [{ ...agg, id: 'g2', category: 'aggregator', vet_note: null }] });
  assert.equal(b.aggregator, true);
  const [c] = DB.buildRows({ funders: [{ id: 'f1', name: 'Demo fund', status: 'vetted', category: 'foundation', vet_note: 'Fits the radar.' }] });
  assert.equal(c.aggregator, false);
});

console.log(`ok ${n} tests`);

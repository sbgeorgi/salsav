// node dash/mods.test.mjs: pure helpers of the Insights and Method views (team activity, screened criteria, registry load once).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamActivity, screenedCriteria, loadRegistryOnce } from './insights.js';
import * as D from '../dashboard.js';
const { RANK_WEIGHTS } = D;

const NOW = new Date('2026-11-17T12:00:00Z'); // fixed clock
const DAY = 864e5;
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const STATES = ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip'];
let n = 0;
const t = (name, fn) => { fn(); n++; };
const ta = async (name, fn) => { await fn(); n++; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const ROOT = new URL('../', import.meta.url);

t('teamActivity: counts people actions in the window and leaves out automated and old events', () => {
  const events = [
    { actor: 'Ana Ruiz', at: ago(1), kind: 'update', funder_id: 'a', payload: { state: 'reviewing' } },
    { actor: 'Ana Ruiz', at: ago(2), kind: 'update', funder_id: 'a', payload: { owner: 'Ana Ruiz' } },
    { actor: 'Ben Okafor', at: ago(3), kind: 'promote', funder_id: 'b', payload: {} },
    { actor: '', at: ago(1), kind: 'update', funder_id: 'c', payload: { state: 'applying' } },
    { actor: 'Ben Okafor', at: ago(40), kind: 'update', funder_id: 'd', payload: { state: 'submitted' } },
  ];
  const notes = [{ actor: 'Carla Mendez', at: ago(5), funder_id: 'a' }, { actor: '', at: ago(1), funder_id: 'a' }, { actor: 'Carla Mendez', at: ago(60), funder_id: 'a' }];
  const r = teamActivity({ events, notes, rows: [], states: STATES, now: NOW });
  assert.equal(r.total, 4); // Ana 2 events, Ben 1 event, Carla 1 note
  assert.equal(r.automated, 1); // the event with no actor, not the 40-day-old one
  assert.deepEqual(r.people.map((p) => [p.name, p.actions]), [['Ana Ruiz', 2], ['Ben Okafor', 1], ['Carla Mendez', 1]]);
  assert.deepEqual(r.moves, [{ state: 'reviewing', n: 1 }]);
});

t('teamActivity: a wider window picks up the older event', () => {
  const events = [{ actor: 'Ben Okafor', at: ago(40), kind: 'update', funder_id: 'd', payload: { state: 'submitted' } }];
  const wide = teamActivity({ events, states: STATES, now: NOW, days: 90 });
  assert.equal(wide.total, 1);
  assert.deepEqual(wide.moves, [{ state: 'submitted', n: 1 }]);
  assert.equal(teamActivity({ events, states: STATES, now: NOW }).total, 0);
});

t('teamActivity: owners sort by size with unassigned last, and every row is counted once', () => {
  const rows = [
    { team: { owner: '', state: 'new' } },
    { team: { owner: 'Ana Ruiz', state: 'reviewing' } },
    { team: { owner: 'Ana Ruiz', state: 'new' } },
    { team: { owner: 'Ben Okafor' } },
  ];
  const r = teamActivity({ rows, states: STATES, now: NOW });
  assert.deepEqual(r.owners.map((o) => o.name), ['Ana Ruiz', 'Ben Okafor', '']);
  assert.deepEqual(r.owners.find((o) => o.name === 'Ana Ruiz').byState, { reviewing: 1, new: 1 });
  assert.equal(r.owners.reduce((s, o) => s + o.total, 0), rows.length);
  assert.deepEqual(teamActivity({}), { total: 0, automated: 0, people: [], moves: [], owners: [] });
});

t('screenedCriteria: each screened funder counted once, and the parts add up to the total', () => {
  const reg = { funders: [
    { id: 'a', status: 'rejected', human: { lock: 'demoted' }, gates: { scored: true, fit: false, ua: true, award: false } },
    { id: 'b', status: 'rejected', gates: { scored: false, fit: false } },
    { id: 'c', status: 'rejected', gates: { scored: true, fit: false, ua: true, award: false } },
    { id: 'd', status: 'rejected', gates: { scored: true, fit: true, ua: true, award: true } },
    { id: 'e', status: 'rejected', human: { lock: 'promoted' }, gates: { scored: true, fit: true, ua: false, award: true } },
    { id: 'f', status: 'vetted', gates: { scored: true, fit: false } },
  ] };
  const c = screenedCriteria(reg);
  assert.deepEqual(c, { total: 5, team: 1, notScored: 1, anyFail: 2, fit: 1, ua: 1, award: 1, none: 1 });
  assert.equal(c.team + c.notScored + c.anyFail + c.none, c.total);
  assert.equal(screenedCriteria(null).total, 0);
});

t('method.js and insights.js never assign markup through innerHTML', () => {
  for (const p of ['dash/method.js', 'dash/insights.js']) {
    assert.equal(/\.innerHTML\s*=/.test(readFileSync(new URL(p, ROOT), 'utf8')), false, p);
  }
});

/* the argument texts of the call whose "(" is at `open`, split at top-level commas; quoted text is skipped whole */
function callArgs(src, open) {
  const out = [];
  let depth = 0, cur = '', q = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (q) { cur += c; if (c === '\\') cur += src[++i]; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
t('the shell and the dash modules never pass a bare null into after, before, append, prepend or replaceChildren (it would print as the text "null")', () => {
  let calls = 0;
  for (const p of ['dashboard.html', ...['board', 'database', 'drawer', 'galaxy', 'horizon', 'insights', 'method', 'ui'].map((m) => `dash/${m}.js`)]) {
    const src = readFileSync(new URL(p, ROOT), 'utf8');
    for (const m of src.matchAll(/\.(after|before|append|prepend|replaceChildren)\(/g)) {
      calls++;
      const bare = callArgs(src, m.index + m[0].length - 1).filter((a) => /^null$/.test(a) || /[?:|&]\s*null$/.test(a));
      assert.deepEqual(bare, [], `${p} at ${m.index}: ${m[0]}`);
    }
  }
  assert.ok(calls > 0, 'the scan found the DOM insertion calls it checks');
});

await ta('loadRegistryOnce: a registry already loaded is not requested', async () => {
  let calls = 0, repaints = 0;
  const st = {};
  loadRegistryOnce({ reg: () => ({ funders: [] }), loadRegistry: async () => { calls++; } }, st, () => repaints++);
  await tick();
  assert.equal(calls, 0);
  assert.equal(repaints, 0);
  assert.equal(st.asked, undefined);
});

await ta('loadRegistryOnce: one request, one repaint on success', async () => {
  let repaints = 0;
  const st = { asked: false };
  loadRegistryOnce({ reg: () => null, loadRegistry: () => Promise.resolve({}) }, st, () => repaints++);
  assert.equal(st.loading, true);
  await tick();
  assert.equal(st.loading, false);
  assert.equal(st.failed, false);
  assert.equal(repaints, 1);
});

await ta('loadRegistryOnce: a failure is remembered, does not loop, and retries only when asked', async () => {
  let calls = 0, repaints = 0, fail = true;
  const st = { asked: false };
  const app = { reg: () => null, loadRegistry: () => { calls++; return fail ? Promise.reject(new Error('grants_registry unavailable')) : Promise.resolve({}); } };
  const again = () => repaints++;
  loadRegistryOnce(app, st, again);
  loadRegistryOnce(app, st, again); // a second render while the request is out
  assert.equal(calls, 1);
  await tick();
  assert.equal(st.failed, true);
  assert.equal(st.loading, false);
  assert.equal(repaints, 1);
  loadRegistryOnce(app, st, again); // a later render after the failure does not ask again
  await tick();
  assert.equal(calls, 1);
  assert.equal(repaints, 1);
  st.asked = false; fail = false; // what the Try again button does
  loadRegistryOnce(app, st, again);
  await tick();
  assert.equal(calls, 2);
  assert.equal(st.failed, false);
  assert.equal(repaints, 2);
});

t('Method ranking table: each weight is the points recommend() adds', () => {
  // Parity with dashboard.js recScore: fit + urgency + UA direct + three or more facts. Fixed clock, Phoenix date 2026-11-17.
  const W = RANK_WEIGHTS, day0 = D.dayNum(D.todayISO(NOW));
  const plus = (d) => D.isoFromDayNum(day0 + d);
  const base = { name: 'P', fit_score: 50, ua_eligibility: 'eligible', team: { state: 'new' }, _dq: false, _evid: { n: 3 } };
  const score = (o) => D.recommend([{ id: 'p', ...base, ...o }], NOW)[0]?.score;
  assert.equal(score({ _lane: 'apply_now', deadline: plus(30) }), 50 + W.soon45 + W.ua + W.facts);
  assert.equal(score({ _lane: 'apply_now', deadline: plus(60) }), 50 + W.sweet90 + W.ua + W.facts);
  assert.equal(score({ _lane: 'apply_now', deadline: plus(120) }), 50 + W.late180 + W.ua + W.facts);
  assert.equal(score({ _lane: 'rolling', deadline: plus(30) }), 50 + W.rolling + W.ua + W.facts);
  assert.equal(score({ _lane: 'prepare', deadline: plus(30) }), 50 + W.prepare + W.ua + W.facts);
  assert.equal(score({ _lane: 'apply_now', deadline: plus(30), ua_eligibility: 'unknown', _evid: { n: 2 } }), 50 + W.soon45);
  // band edges as Method states them: 45 and 46 days, 90 and 91, 180 and 181
  const urg = (days) => score({ _lane: 'apply_now', deadline: plus(days), ua_eligibility: 'unknown', _evid: { n: 0 }, fit_score: 0 });
  assert.equal(urg(45), W.soon45); assert.equal(urg(46), W.sweet90); assert.equal(urg(90), W.sweet90);
  assert.equal(urg(91), W.late180); assert.equal(urg(180), W.late180); assert.equal(urg(181), 0);
});

t('teamActivity: lead events with no funder, null actors and missing payloads never throw and are counted once', () => {
  const at = ago(1);
  const events = [
    { id: 1, funder_id: null, at, actor: 'Ana', kind: 'lead_queue', payload: { target_id: 'x', org: 'Org', reason: 'r', from_status: 'pending' } },
    { id: 2, funder_id: null, at, actor: 'Ana', kind: 'lead_dismiss', payload: null },
    { id: 3, funder_id: 'f1', at, actor: null, kind: 'update' },
    { id: 4, funder_id: 'f1', at, actor: 'Ben', kind: 'update', payload: { state: 'reviewing' } },
  ];
  const TA = teamActivity({ events, notes: [{ funder_id: null, at, actor: null, body: 'x' }], rows: [], states: STATES, now: NOW });
  assert.equal(TA.total, 3);
  assert.equal(TA.automated, 1);
  assert.deepEqual(TA.people.map((p) => [p.name, p.actions]), [['Ana', 2], ['Ben', 1]]);
  assert.deepEqual(TA.moves, [{ state: 'reviewing', n: 1 }]);
});

t('Method has the Bookmarks and the agent section; RANK_WEIGHTS and sv come from one place', () => {
  const m = readFileSync('dash/method.js', 'utf8'), ins = readFileSync('dash/insights.js', 'utf8');
  assert.match(m, /\['marks', 'Bookmarks and the agent'\]/);
  for (const w of ['MARK_EFFECTS', 'D.markCounts(S.marks)', 'app.manageMarks()', 'Manage bookmarks']) assert.ok(m.includes(w), w);
  assert.doesNotMatch(m, /export const RANK_WEIGHTS/);
  assert.match(m, /import \{ RANK_WEIGHTS \} from '\.\.\/dashboard\.js'/);
  assert.match(ins, /import \{ sv \} from '\.\/ui\.js'/);
  assert.doesNotMatch(ins, /const sv =/);
  assert.doesNotMatch(readFileSync('dash/method.css', 'utf8'), /\.cstat|\.cdot/);
});

console.log(`mods.test.mjs: ${n} tests passed`);

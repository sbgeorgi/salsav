// node dash/board.test.mjs: Pipeline grouping, filtering, caps, totals, activity merge and sort, and the colour guard for board.js and board.css.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLS, CAP, UNASSIGNED, MINE, ownerKey, ownerOf, ownerPass, ownerGroups, searchText, pipelineRows, orderColumn, capColumn,
  usdOf, totals, moneyLine, shortCountdown, shortAgo, dayKey, dayLabel, eventKind, personKey,
  activityItems, activityPeople, filterActivity, groupByDay, latestEvent, actionText, rowTarget, isScored,
} from './board.js';
import { BUCKETS, STATE_LABELS, fmtDate } from '../dashboard.js';

const NOW = new Date('2026-11-11T20:00:00Z'); // fixed clock, same as ui.test.mjs; Phoenix is 13:00 that day
let n = 0;
const t = (name, fn) => { fn(); n++; };
const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const row = (id, o = {}) => ({ id, name: o.name || `Funder ${id}`, program: o.program || '', bucket: o.bucket || 'foundation_ngo', themes: o.themes || [],
  fit_score: o.fit_score ?? null, deadline: o.deadline ?? null, _days: o._days ?? null, _dq: !!o._dq, award_max_usd: o.award_max_usd ?? null,
  team: { state: o.state || 'new', owner: o.owner ?? '', ask_usd: o.ask_usd ?? null, notes: o.notes || '' } });

t('COLS: six states in order, cap 12 for Not started and 10 elsewhere', () => {
  assert.deepEqual(COLS, ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined']);
  assert.equal(CAP.new, 12);
  assert.equal(CAP.reviewing, undefined, 'only Not started is capped');
});

t('ownerKey and ownerOf: case and spaces ignored, unowned is empty', () => {
  assert.equal(ownerKey('  Ana Ruiz '), 'ana ruiz');
  assert.equal(ownerOf(row('a', { owner: ' Ben Okafor ' })), 'Ben Okafor');
  assert.equal(ownerOf(row('b', { owner: null })), '');
});

t('ownerPass: empty owner passes everyone; Unassigned takes only blank owners', () => {
  const ana = row('a', { owner: 'Ana Ruiz' }), none = row('b', { owner: '' });
  assert.equal(ownerPass(ana, ''), true);
  assert.equal(ownerPass(none, ''), true);
  assert.equal(ownerPass(none, UNASSIGNED), true);
  assert.equal(ownerPass(ana, UNASSIGNED), false);
});

t('ownerPass: a name matches case-insensitively; Mine needs the signed-in name', () => {
  const ana = row('a', { owner: 'Ana Ruiz' }), ben = row('b', { owner: 'Ben Okafor' });
  assert.equal(ownerPass(ana, 'ana ruiz'), true);
  assert.equal(ownerPass(ben, 'Ana Ruiz'), false);
  assert.equal(ownerPass(ana, MINE, 'ANA RUIZ'), true);
  assert.equal(ownerPass(ben, MINE, 'Ana Ruiz'), false);
  assert.equal(ownerPass(ana, MINE, ''), false, 'no signed-in name means Mine matches nothing');
  assert.equal(ownerPass(row('c', { owner: '' }), 'Ana Ruiz'), false);
});

t('ownerGroups: counts per person, most first, then unassigned', () => {
  const g = ownerGroups([row('1', { owner: 'Ana Ruiz' }), row('2', { owner: 'ben okafor' }), row('3', { owner: 'Ana Ruiz ' }), row('4', { owner: '' }), row('5', { owner: null })]);
  assert.deepEqual(g.people.map((p) => [p.name, p.n]), [['Ana Ruiz', 2], ['ben okafor', 1]]);
  assert.equal(g.unassigned, 2);
});

t('searchText: name, program, owner, bucket label, themes and notes are all searchable', () => {
  const r = row('a', { name: 'Horizon Water', program: 'Drought fund', owner: 'Ana Ruiz', bucket: 'intl_dev', themes: ['water'] });
  const text = searchText(r, [{ actor: 'Ben', body: 'Call Tuesday' }]).toLowerCase();
  for (const w of ['horizon', 'drought', 'ana ruiz', BUCKETS.intl_dev.toLowerCase(), 'water', 'ben', 'call tuesday']) assert.ok(text.includes(w), `missing ${w}`);
});

t('pipelineRows: search narrows first, then the owner filter narrows what is searched', () => {
  const rows = [row('1', { name: 'Alpha water', owner: 'Ana Ruiz' }), row('2', { name: 'Beta water', owner: 'Ben Okafor' }), row('3', { name: 'Gamma soil', owner: 'Ana Ruiz' })];
  const match = (t) => t.toLowerCase().includes('water');
  const all = pipelineRows(rows, { match });
  assert.deepEqual(all.searched.map((r) => r.id), ['1', '2']);
  assert.deepEqual(all.pool.map((r) => r.id), ['1', '2']);
  const ana = pipelineRows(rows, { owner: 'Ana Ruiz', match });
  assert.deepEqual(ana.pool.map((r) => r.id), ['1']);
  assert.deepEqual(ana.searched.map((r) => r.id), ['1', '2'], 'owner filter does not change the search set');
  const none = pipelineRows(rows, { owner: UNASSIGNED, match: () => true });
  assert.equal(none.pool.length, 0);
});

t('orderColumn new: recommendation rank first, unranked after by fit, dq last', () => {
  const rows = [row('a', { fit_score: 40 }), row('b', { fit_score: 90 }), row('c', { fit_score: 10, _dq: true }), row('d', { fit_score: 70 }), row('e', { fit_score: 60 })];
  const out = orderColumn(rows, 'new', ['d', 'a']).map((r) => r.id);
  assert.deepEqual(out, ['d', 'a', 'b', 'e', 'c']);
});

t('orderColumn reviewing: soonest open deadline first, undated next, closed last', () => {
  const rows = [row('closed', { _days: -3 }), row('undated', { _days: null }), row('late', { _days: 40 }), row('soon', { _days: 5 })];
  assert.deepEqual(orderColumn(rows, 'reviewing').map((r) => r.id), ['soon', 'late', 'undated', 'closed']);
});

t('orderColumn awarded: fit first, name as the tie-break', () => {
  const rows = [row('b', { name: 'Bee', fit_score: 50 }), row('a', { name: 'Aye', fit_score: 50 }), row('c', { name: 'Cee', fit_score: 80 })];
  assert.deepEqual(orderColumn(rows, 'awarded').map((r) => r.id), ['c', 'a', 'b']);
});

t('capColumn: Not started shows 12 and reports the rest; showAll shows everything', () => {
  const list = Array.from({ length: 20 }, (_, i) => row(`r${i}`));
  const cut = capColumn(list, 'new');
  assert.equal(cut.shown.length, 12);
  assert.equal(cut.hidden, 8);
  assert.equal(capColumn(list, 'new', true).shown.length, 20);
  assert.equal(capColumn(list, 'new', true).hidden, 0);
  const other = capColumn(list, 'applying');
  assert.equal(other.shown.length, 20, 'other columns are never capped');
  assert.equal(other.hidden, 0);
});

t('usdOf and moneyLine: a team ask beats the award ceiling; no amount reads as unknown', () => {
  assert.equal(usdOf(row('a', { ask_usd: 250000, award_max_usd: 900000 })), 250000);
  assert.equal(usdOf(row('b', { award_max_usd: 900000 })), 900000);
  assert.equal(usdOf(row('c')), 0);
  assert.equal(moneyLine(row('a', { ask_usd: 250000 })), 'Ask $250k');
  assert.equal(moneyLine(row('b', { award_max_usd: 900000 })), 'Up to $900k');
  assert.equal(moneyLine(row('c')), 'Amount unknown');
});

t('totals: count and dollars, ask first then the largest award', () => {
  assert.deepEqual(totals([row('r', { ask_usd: 100 }), row('a', { award_max_usd: 200 })]), { n: 2, usd: 300 });
  assert.deepEqual(totals([]), { n: 0, usd: 0 });
});

t('shortCountdown: closed, today, days left, and nothing without a date', () => {
  assert.equal(shortCountdown(null), '');
  assert.equal(shortCountdown(-1), 'closed');
  assert.equal(shortCountdown(0), 'today');
  assert.equal(shortCountdown(5), '5 d left');
});

t('shortAgo: compact steps, then the plain date from timeAgo after two weeks', () => {
  assert.equal(shortAgo('2026-11-11T19:59:30Z', NOW), 'just now');
  assert.equal(shortAgo('2026-11-11T19:55:00Z', NOW), '5 min ago');
  assert.equal(shortAgo('2026-11-11T17:00:00Z', NOW), '3 h ago');
  assert.equal(shortAgo('2026-11-08T20:00:00Z', NOW), '3 d ago');
  assert.equal(shortAgo('2026-10-22T20:00:00Z', NOW), 'Oct 22, 2026');
  assert.equal(shortAgo('', NOW), '');
});

t('dayKey: days are Phoenix days (UTC-7, no daylight time)', () => {
  assert.equal(dayKey('2026-11-12T06:30:00Z'), '2026-11-11', '23:30 on the 11th in Phoenix');
  assert.equal(dayKey('2026-11-12T07:30:00Z'), '2026-11-12', '00:30 on the 12th in Phoenix');
  assert.equal(dayKey(NOW), '2026-11-11');
  assert.equal(dayKey(''), '');
});

t('dayLabel: Today, Yesterday, then the plain date; empty is Earlier', () => {
  assert.equal(dayLabel('2026-11-11', NOW), 'Today');
  assert.equal(dayLabel('2026-11-10', NOW), 'Yesterday');
  assert.equal(dayLabel('2026-11-02', NOW), fmtDate('2026-11-02'));
  assert.equal(dayLabel('', NOW), 'Earlier');
});

t('eventKind: moves, owners, asks, notes and decisions; anything else is other', () => {
  assert.equal(eventKind({ kind: 'update', payload: { state: 'applying' } }), 'move');
  assert.equal(eventKind({ kind: 'update', payload: { owner: 'Ana', from: { owner: '' } } }), 'owner');
  assert.equal(eventKind({ kind: 'update', payload: { ask_usd: 5 } }), 'ask');
  assert.equal(eventKind({ kind: 'update', payload: { notes_changed: true } }), 'note');
  for (const k of ['promote', 'demote', 'release', 'call_demote', 'call_restore', 'lead_queue', 'lead_dismiss']) assert.equal(eventKind({ kind: k, payload: {} }), 'decision', k);
  assert.equal(eventKind({ kind: 'mark_set', payload: {} }), 'decision');
  assert.equal(eventKind({ kind: 'mark_clear', payload: {} }), 'decision');
  assert.equal(eventKind({ kind: 'mystery', payload: {} }), 'other');
  assert.equal(eventKind(null), 'other');
});

const EVENTS = [
  { id: 1, funder_id: 'f1', at: '2026-11-11T15:00:00Z', actor: 'Christine', kind: 'update', payload: { state: 'applying', from: { state: 'reviewing' } } },
  { id: 2, funder_id: 'f2', at: '2026-11-10T16:00:00Z', actor: 'ana ruiz', kind: 'update', payload: { owner: 'Ben Okafor' } },
  { id: 3, funder_id: 'f1', at: '2026-11-11T18:00:00Z', actor: 'Ana Ruiz', kind: 'promote', payload: { reason: 'Clear fit' } },
];
const NOTES = [{ id: 'n1', funder_id: 'f2', at: '2026-11-11T17:00:00Z', actor: 'Ben Okafor', body: 'Spoke to programme officer' }];

t('activityItems: events and notes merged, newest first, with kind and body', () => {
  const items = activityItems({ events: EVENTS, notes: NOTES });
  assert.deepEqual(items.map((i) => i.key), ['ev:3', 'note:n1', 'ev:1', 'ev:2']);
  assert.equal(items[1].kind, 'note');
  assert.equal(items[1].body, 'Spoke to programme officer');
  assert.equal(items[0].kind, 'decision');
});

t('activityItems: empty input and missing timestamps do not throw', () => {
  assert.deepEqual(activityItems(), []);
  const items = activityItems({ events: [{ id: 9, kind: 'update', payload: { state: 'skip' } }], notes: [] });
  assert.equal(items.length, 1);
  assert.equal(items[0].at, '');
});

t('activityPeople: grouped by person ignoring case, with counts; blank actor is Automated', () => {
  const items = activityItems({ events: [...EVENTS, { id: 4, funder_id: 'f3', at: '2026-11-09T10:00:00Z', actor: '', kind: 'update', payload: { ask_usd: 1 } }], notes: NOTES });
  const people = activityPeople(items);
  assert.deepEqual(people.map((p) => [p.name, p.n]), [['Ana Ruiz', 2], ['Automated', 1], ['Ben Okafor', 1], ['Christine', 1]]);
  const ana = people.find((p) => p.key === 'ana ruiz');
  assert.equal(ana.n, 2);
});

t('filterActivity: by kind and by person together', () => {
  const items = activityItems({ events: EVENTS, notes: NOTES });
  assert.deepEqual(filterActivity(items, { kind: 'all' }).length, 4);
  assert.deepEqual(filterActivity(items, { kind: 'move' }).map((i) => i.key), ['ev:1']);
  assert.deepEqual(filterActivity(items, { kind: 'note' }).map((i) => i.key), ['note:n1']);
  assert.deepEqual(filterActivity(items, { person: 'ana ruiz' }).map((i) => i.key), ['ev:3', 'ev:2']);
  assert.deepEqual(filterActivity(items, { kind: 'owner', person: 'ana ruiz' }).map((i) => i.key), ['ev:2']);
  assert.deepEqual(filterActivity(items, { kind: 'ask' }), []);
});

t('groupByDay: consecutive items share a day; labels read Today and Yesterday', () => {
  const groups = groupByDay(activityItems({ events: EVENTS, notes: NOTES }), NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [['Today', 3], ['Yesterday', 1]]);
});

t('latestEvent: the newest by time, null when there are none', () => {
  assert.equal(latestEvent(EVENTS).id, 3);
  assert.equal(latestEvent([]), null);
  assert.equal(latestEvent(undefined), null);
});

t('actionText: a move reads as Who arrow State; other events read as a short verb', () => {
  assert.equal(actionText(EVENTS[0]), 'Christine → Applying');
  assert.equal(actionText(EVENTS[1]), 'ana ruiz set owner to Ben Okafor');
  assert.equal(actionText({ kind: 'update', payload: { state: 'new' } }), 'Automated → Not started');
  assert.equal(actionText(null), '');
});

t('one move, one activity row: board.js writes no team events; the shell adds the event once on save', () => {
  const src = read('dash/board.js');
  assert.equal(/logLocal|\.events\s*=|events\.(unshift|push)/.test(src), false, 'board.js must not add to S.events');
  assert.equal(/S\.events\.unshift\(ev\)/.test(read('dashboard.html')), true, 'the shell records the saved event');
  const items = activityItems({ events: [{ id: 7, funder_id: 'f9', at: '2026-11-11T19:00:00Z', actor: 'Christine', kind: 'update', payload: { state: 'applying', from: { state: 'reviewing' } } }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'move');
  assert.equal(actionText(items[0].ev), 'Christine → Applying');
});

t('personKey: the same person in any case maps to one key', () => {
  assert.equal(personKey({ actor: 'Ana Ruiz' }), personKey({ actor: 'ANA RUIZ' }));
  assert.equal(personKey({ actor: '' }), 'automated');
});

t('lead events with no funder: a decision with no funder link; the verb carries the lead wording', () => {
  const lead = { id: 'l1', funder_id: null, at: '2026-11-11T18:30:00Z', actor: 'Ben Okafor', kind: 'lead_dismiss', payload: { target_id: 'x', org: 'Acme Foundation', reason: 'Too small', from_status: 'pending' } };
  const items = activityItems({ events: [lead], notes: [] });
  assert.equal(items[0].kind, 'decision');
  assert.equal(rowTarget(items[0], 'anything'), null, 'no funder means no link');
  assert.equal(actionText(lead), 'Ben Okafor dismissed a lead');
  assert.equal(filterActivity(items, { kind: 'decision' }).length, 1);
});

t('rowTarget: a funder row links by id and name, with a plain fallback name', () => {
  assert.deepEqual(rowTarget({ funder_id: 'f1' }, 'Horizon Water'), { id: 'f1', name: 'Horizon Water' });
  assert.deepEqual(rowTarget({ funder_id: 'f1' }), { id: 'f1', name: 'a funder' });
  assert.equal(rowTarget({ funder_id: undefined }), null);
  assert.equal(rowTarget({ funder_id: null }), null);
  assert.equal(rowTarget(null), null);
});

t('isScored: a fit of 0 is scored; null, undefined and NaN read as Not scored yet', () => {
  assert.equal(isScored(row('a', { fit_score: 0 })), true);
  assert.equal(isScored(row('b', { fit_score: 55 })), true);
  assert.equal(isScored(row('c')), false);
  assert.equal(isScored({ fit_score: NaN }), false);
  assert.equal(isScored(null), false);
});

t('one state label map: board.js reads STATE_LABELS and keeps no copy of its own', () => {
  const src = read('dash/board.js');
  assert.equal(/\bLABEL\s*=/.test(src), false, 'no local LABEL map');
  assert.equal(/'Not started'|'Reviewing'/.test(src), false, 'state names are not typed out in board.js');
  assert.equal(actionText({ kind: 'update', payload: { state: 'new' } }), `Automated → ${STATE_LABELS.new}`);
});

/* colours: board.js and board.css use tokens only */
const LITERAL = /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i;
t('colour guard: no colour literals in board.css or board.js', () => {
  assert.equal(LITERAL.test(read('dash/board.css')), false);
  assert.equal(LITERAL.test(read('dash/board.js')), false);
});

console.log(`ok ${n} tests`);

t('Pipeline card: Move-to lists pickStates, the bookmark control closes .bcard-top, and the summary strip is gone', () => {
  const src = read('dash/board.js');
  assert.equal(src.includes('D.pickStates(r.team.state)'), true, 'Move-to source');
  assert.equal(/D\.STATES|menuLabel|Skip it|skipped/.test(src), false, 'no skip wording or raw STATES in the picker');
  assert.equal(/app\.markControl\('funder', r\.id, r\.name\)\),\s*el\('button', \{ class: 'rl'/.test(src), true, 'control is the last child of .bcard-top, passed as an el() child');
  assert.equal(/summarize|bstat/.test(src + read('dash/board.css')), false, 'summary strip removed');
  assert.equal(/\$\{hidden\} hidden/.test(src), true);
});

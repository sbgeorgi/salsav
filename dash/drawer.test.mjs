// node dash/drawer.test.mjs  (no dependencies): pure helpers of the funder drawer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTracked, diffOf, splitCalls, teamChange, historyItems, historyFilter, collectSays, COLLECT_SAYS, whoOf, callDemotedBy, fitAria, fitNote } from './drawer.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const money = (v) => '$' + v;

t('isTracked: vetted and missing status count as tracked, screened and candidate do not', () => {
  assert.equal(isTracked({ _status: 'vetted' }), true);
  assert.equal(isTracked({}), true);
  assert.equal(isTracked({ _status: 'rejected' }), false);
  assert.equal(isTracked({ _status: 'candidate' }), false);
});

t('diffOf: only [from, to] pairs, money keys formatted, arrays joined', () => {
  assert.equal(diffOf({ owner: ['Ana', 'Ben'], ask_usd: [100, 200], notes: 'x' }, money), 'Owner: Ana → Ben; Ask: $100 → $200');
  assert.equal(diffOf(null), '');
});

t('splitCalls: registry rejects or human demote wins over the feed row; open calls sorted by deadline', () => {
  const feed = [
    { id: 'c1', status: 'open', deadline: '2027-03-01', title: 'Late' },
    { id: 'c2', status: 'open', deadline: '2026-12-01', title: 'Early' },
    { id: 'c3', status: 'open', deadline: '2026-12-15', title: 'Gone by registry' },
  ];
  const registry = [{ id: 'c3', vet_status: 'rejected' }, { id: 'c4', status: 'closed', deadline: null }];
  const { open, demoted } = splitCalls({ feed, registry, detail: [] });
  assert.deepEqual(open.map((c) => c.id), ['c2', 'c1']);
  assert.deepEqual(demoted.map((c) => c.id), ['c3']);
});

t('splitCalls: demoted list is newest human decision first; a human lock counts as demoted', () => {
  const feed = [
    { id: 'a', status: 'open', human: { lock: 'demoted', at: '2026-11-01T10:00:00Z' } },
    { id: 'b', status: 'open', human: { lock: 'demoted', at: '2026-11-10T10:00:00Z' } },
  ];
  const { open, demoted } = splitCalls({ feed });
  assert.equal(open.length, 0);
  assert.deepEqual(demoted.map((c) => c.id), ['b', 'a']);
});

t('splitCalls: a team demote with by withheld (public access) stays demoted', () => {
  const { open, demoted } = splitCalls({ feed: [{ id: 'z', status: 'open', human: { lock: 'demoted', by: null, at: '2026-11-10T10:00:00Z', note: null } }] });
  assert.equal(open.length, 0);
  assert.deepEqual(demoted.map((c) => c.id), ['z']);
});

t('teamChange: status, owner and ask heads with from-to diffs', () => {
  const label = (s) => ({ applying: 'Applying' }[s] || s);
  assert.deepEqual(teamChange({ kind: 'update', payload: { state: 'applying', from: { state: 'new' } } }, { label, money }),
    { head: 'Status set to Applying', diff: 'new → Applying', note: '' });
  assert.equal(teamChange({ kind: 'update', payload: { owner: 'Ana Ruiz', from: { owner: '' } } }, { money }).diff, 'no owner → Ana Ruiz');
  assert.equal(teamChange({ kind: 'update', payload: { ask_usd: 1200000, from: { ask_usd: null } } }, { money }).diff, 'none → $1200000');
  assert.equal(teamChange({ kind: 'update', payload: { ask_usd: null } }, { money }).head, 'Ask cleared');
  assert.equal(teamChange({ kind: 'release', payload: { reason: 'Handed back' } }).note, 'Handed back');
});

t('teamChange: lead events get readable headings (no raw kind names)', () => {
  const q = teamChange({ kind: 'lead_queue', funder_id: null, payload: { target_id: 'l1', org: 'SRP', reason: 'Fits the crop program' } });
  assert.deepEqual(q, { head: 'Lead queued for the agent', diff: 'SRP', note: 'Fits the crop program' });
  const d = teamChange({ kind: 'lead_dismiss', funder_id: 'f1', payload: { target_id: 'l2', org: 'Gulbenkian', reason: null, from_status: 'pending' } });
  assert.equal(d.head, 'Lead dismissed');
  assert.equal(d.note, '');
});

t('teamChange: a demoted call and a team promote name the team, not the vetting run', () => {
  assert.equal(teamChange({ kind: 'call_demote', payload: { title: 'Call A', reason: 'Wrong crop' } }).head, 'Demoted a call: Call A');
  assert.equal(teamChange({ kind: 'promote', payload: { reason: 'Fits', from_status: 'rejected' } }).diff, 'Screened out → Tracked');
});

t('teamChange: null payloads, null funder ids and missing fields never throw or print null', () => {
  const kinds = ['update', 'promote', 'demote', 'release', 'call_demote', 'call_restore', 'lead_queue', 'lead_dismiss', 'mystery'];
  const payloads = [undefined, null, {}, { reason: null, title: null, org: null, from: null, from_status: null, target_id: null }];
  for (const kind of kinds) for (const payload of payloads) for (const funder_id of [null, 'f1']) {
    const x = teamChange({ kind, funder_id, actor: null, payload }, { money });
    for (const s of [x.head, x.diff, x.note]) {
      assert.equal(typeof s, 'string');
      assert.doesNotMatch(s, /\b(null|undefined|NaN)\b/, `${kind} ${JSON.stringify(payload)}`);
    }
  }
});

t('whoOf: a name, then "A team member" for a withheld human, then "Automated"', () => {
  assert.equal(whoOf('Ana Ruiz', true), 'Ana Ruiz');
  assert.equal(whoOf(null, true), 'A team member');
  assert.equal(whoOf('', true), 'A team member');
  assert.equal(whoOf(null, false), 'Automated');
  assert.equal(whoOf(undefined, false), 'Automated');
});

t('callDemotedBy: a team demote without a name says so; no human means the vetting run', () => {
  const ago = () => '1 day ago';
  assert.equal(callDemotedBy(null, ago), null);
  assert.equal(callDemotedBy({ lock: 'demoted', by: null, at: null }, ago), 'Demoted by a team member');
  assert.equal(callDemotedBy({ lock: 'demoted', by: null, at: '2026-11-16T10:00:00Z' }, ago), 'Demoted by a team member, 1 day ago');
  assert.equal(callDemotedBy({ lock: 'demoted', by: 'Ana Ruiz', at: '2026-11-16T10:00:00Z' }, ago), 'Ana Ruiz demoted it, 1 day ago');
  assert.equal(callDemotedBy({ lock: 'demoted', by: 'Ana Ruiz' }), 'Ana Ruiz demoted it');
  assert.equal(callDemotedBy({ lock: 'promoted', by: 'Ana Ruiz', at: '2026-11-16T10:00:00Z' }, ago), null, 'a promote lock is not a demote');
});

t('fitAria and fitNote: an unscored funder says "Not scored yet", never a dash or null', () => {
  assert.equal(fitAria(null, 'Strong'), 'Fit not scored yet. Jump to the explanation');
  assert.equal(fitAria(undefined), 'Fit not scored yet. Jump to the explanation');
  assert.equal(fitAria(72, 'Strong'), 'Fit 72, Strong. Jump to the explanation');
  assert.equal(fitAria(72, ''), 'Fit 72. Jump to the explanation');
  assert.equal(fitNote(null, true, 'Strong'), 'Not scored yet');
  assert.equal(fitNote(null, false, ''), 'Not scored yet');
  assert.equal(fitNote(72, false), 'Not itemized yet');
  assert.equal(fitNote(72, true, 'Strong'), 'Strong');
  assert.equal(fitNote(72, true), '');
});

t('historyItems: newest first across team, notes, vetting and health; human vetting rows skipped only when asked', () => {
  const src = {
    team: [{ kind: 'update', at: '2026-11-10T09:00:00Z', actor: 'Ana', payload: { state: 'applying', from: { state: 'new' } } }],
    notes: [{ at: '2026-11-12T09:00:00Z', actor: 'Ben', body: 'Called the program officer' }],
    vetting: [
      { kind: 'rescored', at: '2026-11-01T09:00:00Z', actor: '', changes: { fit: [40, 98] } },
      { kind: 'promoted', at: '2026-11-11T09:00:00Z', actor: 'Ana', run_label: 'human' },
    ],
    health: { at: '2026-11-13T09:00:00Z', note: 'ok' },
  };
  const all = historyItems(src, {});
  assert.equal(all[0].head, 'Source checked');
  assert.equal(all[all.length - 1].head, 'Re-scored');
  const unlocked = historyItems({ ...src, skipHuman: true }, {});
  assert.equal(unlocked.some((x) => x.head === 'Promoted to tracked'), false);
  assert.equal(unlocked.length, all.length - 1);
  assert.deepEqual(historyFilter(all, 'team').map((x) => x.kind), ['team', 'team']);
  assert.equal(historyFilter(all, 'all').length, all.length);
});

t('historyItems: who a row names; a withheld human vetting decision reads "A team member", not Automated', () => {
  const items = historyItems({
    vetting: [
      { kind: 'promoted', at: '2026-11-11T09:00:00Z', actor: null, run_label: 'human', changes: null, note: null },
      { kind: 'rescored', at: '2026-11-10T09:00:00Z', actor: null, run_label: 'auto', changes: { fit: [40, 98] } },
    ],
    team: [{ kind: 'update', at: '2026-11-09T09:00:00Z', actor: null, payload: { owner: 'Ben', from: { owner: '' } } }],
    changes: [{ kind: 'deadline', at: '2026-11-08T09:00:00Z', deadline: ['2026-12-01', '2027-01-15'] }],
  }, { money });
  const who = Object.fromEntries(items.map((x) => [x.head, x.who]));
  assert.equal(who['Promoted to tracked'], 'A team member');
  assert.equal(who['Re-scored'], 'Automated');
  assert.equal(who['Owner set to Ben'], 'A team member');
  assert.equal(who['Deadline changed'], 'Automated');
  assert.equal(items.find((x) => x.head === 'Promoted to tracked').diff, '');
});

t('historyItems: lead events on a funder and nulls from public access render without "null"', () => {
  const items = historyItems({
    team: [
      { kind: 'lead_dismiss', funder_id: null, at: '2026-11-12T09:00:00Z', actor: null, payload: { target_id: 'l1', org: null, reason: null } },
      { kind: 'lead_queue', at: null, actor: null },
    ],
    notes: [{ at: null, actor: null, body: null }],
    vetting: [{ kind: 'demoted', at: null, actor: null, run_label: 'human', changes: null, note: null }],
  }, { money });
  const heads = items.map((x) => x.head);
  assert.ok(heads.includes('Lead dismissed'));
  assert.ok(heads.includes('Lead queued for the agent'));
  for (const x of items) for (const s of [x.head, x.diff, x.note, x.who]) assert.doesNotMatch(String(s), /\b(null|undefined|NaN)\b/);
});

t('collectSays: base sentence, cadence appended only when a non-empty string', () => {
  assert.equal(collectSays('calls', {}), COLLECT_SAYS.calls);
  assert.equal(collectSays('calls', { collection: { cadence: '   ' } }), COLLECT_SAYS.calls);
  assert.equal(collectSays('page', { collection: { cadence: 'Checked every six hours.' } }), COLLECT_SAYS.page + ' Checked every six hours.');
  assert.equal(collectSays('bogus', {}), '');
});

t('one promotion, one history row: the team event stands in for the vetting row the same save wrote', () => {
  const at = '2026-11-16T10:00:00Z';
  const team = [{ id: 9, funder_id: 'f', at, actor: 'Ana Ruiz', kind: 'promote', payload: { reason: 'Fits the mission', from_status: 'rejected' } }];
  const vetting = [{ at, kind: 'promoted', actor: 'Ana Ruiz', run_label: 'human', note: 'Fits the mission', changes: null }];
  const rows = historyItems({ team, vetting, skipHuman: true }, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].head, 'Promoted to tracked');
  assert.equal(historyItems({ team: [], vetting, skipHuman: false }, {}).length, 1, 'a locked read shows the vetting row alone');
});
t('drawer.js writes no team events: the shell is the only writer of S.events', () => {
  const src = readFileSync(new URL('./drawer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /S\.events\s*(=[^=]|\.unshift|\.push)|events\.(unshift|push)/);
});
t('bannerEl: the team decision line is written before the automated reason', () => {
  const src = readFileSync(new URL('./drawer.js', import.meta.url), 'utf8');
  const team = src.indexOf('text: hm?.note ? `${who}'), auto = src.indexOf('text: hm ? `Automated: ${reason}`');
  assert.ok(team > 0 && auto > team, 'the team line must come first in the banner');
});

console.log(`${n} tests passed`);

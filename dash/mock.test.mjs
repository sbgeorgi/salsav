// node --test dash/mock.test.mjs: the in-memory bookmark RPCs of dash/mock.js (grants_marks, grants_mark) against 024_bookmarks.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, rpc } from './mock.js';

const json = readFileSync(new URL('./mock.json', import.meta.url), 'utf8');
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(json) });
const DB = JSON.parse(json);
const FUNDER = DB.registry.funders[0], CALL = DB.registry.calls[0], LEAD = DB.registry.leads[0];
const PASS = 'x';
const mark = (patch, pass = PASS) => rpc('grants_mark', { p_pass: pass, p_patch: { actor: 'Ada', ...patch } });
const rejects = (p, code, message) => assert.rejects(p, (e) => e.code === code && (message === undefined || e.message === message));
const events = async () => (await rpc('grants_team_notes', { p_pass: PASS })).events;
test.beforeEach(() => load('mock.json'));

test('seed: three definitions, no items', async () => {
  const p = await rpc('grants_marks', {});
  assert.deepEqual(p.defs.map((d) => [d.id, d.effect, d.sort, d.retired]), [['keep-an-eye', 'follow', 10, false], ['shortlist', 'none', 20, false], ['not-relevant', 'hide', 30, false]]);
  assert.deepEqual(p.items, []);
});

test('no passcode: team false, no note, by or retired definitions', async () => {
  await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'shortlist', note: 'why' });
  await mark({ action: 'define', label: 'Old', hue: 1, effect: 'none' });
  await mark({ action: 'retire', mark: 'old' });
  const pub = await rpc('grants_marks', {});
  assert.equal(pub.team, false);
  assert.deepEqual(pub.defs.map((d) => d.id), ['keep-an-eye', 'shortlist', 'not-relevant']);
  assert.equal(pub.items.length, 1);
  assert.equal('note' in pub.items[0] || 'by' in pub.items[0], false);
  const team = await rpc('grants_marks', { p_pass: PASS });
  assert.equal(team.team, true);
  assert.equal(team.defs.length, 4);
  assert.equal(team.items[0].note, 'why');
  assert.equal(team.items[0].by, 'Ada');
});

test('set then clear round-trip, for a funder, a call and a lead, with team events', async () => {
  let p = await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'keep-an-eye' });
  assert.deepEqual(p.items.map((i) => [i.kind, i.id, i.mark, i.name]), [['funder', FUNDER.id, 'keep-an-eye', FUNDER.name]]);
  p = await mark({ action: 'set', kind: 'call', id: CALL.id, mark: 'shortlist', note: 'n' });
  const call = p.items.find((i) => i.kind === 'call');
  assert.equal(call.funder, CALL.funder_id);
  assert.equal(call.name, CALL.title);
  p = await mark({ action: 'set', kind: 'lead', id: LEAD.id, mark: 'shortlist' });
  assert.equal(p.items.find((i) => i.kind === 'lead').name, LEAD.org);
  const before = (await events()).length;
  await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'keep-an-eye' }); // no change: no event
  assert.equal((await events()).length, before);
  p = await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'shortlist' });
  assert.equal(p.items.find((i) => i.kind === 'funder').mark, 'shortlist');
  p = await mark({ action: 'clear', kind: 'funder', id: FUNDER.id });
  assert.equal(p.items.some((i) => i.kind === 'funder'), false);
  const ev = await events();
  assert.equal(ev[0].kind, 'mark_clear');
  assert.deepEqual(ev[0].payload, { item_kind: 'funder', item_id: FUNDER.id, name: FUNDER.name, from: 'shortlist' });
  assert.deepEqual(ev[1].payload, { item_kind: 'funder', item_id: FUNDER.id, name: FUNDER.name, mark: 'shortlist', label: 'Shortlist', from: 'keep-an-eye' });
});

test('set and clear reject bad input with 22023', async () => {
  await rejects(mark({ action: 'set', kind: 'funder', id: 'nope', mark: 'shortlist' }), '22023', 'unknown item');
  await rejects(mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'nope' }), '22023', 'unknown bookmark');
  await rejects(rpc('grants_mark', { p_pass: PASS, p_patch: { action: 'clear', kind: 'funder', id: FUNDER.id } }), '22023', 'actor is required');
});

test('define without mark slugs the label and appends sort; a taken label is refused', async () => {
  const p = await mark({ action: 'define', label: '  Call   the  PI! ', hue: 5, effect: 'follow' });
  assert.deepEqual(p.defs.find((x) => x.label === 'Call the PI!'), { id: 'call-the-pi', label: 'Call the PI!', hue: 5, effect: 'follow', sort: 40, retired: false });
  await rejects(mark({ action: 'define', label: 'call the pi!', hue: 1, effect: 'none' }), '22023', 'a bookmark with that name already exists');
  const e = await mark({ action: 'define', label: '!!!', hue: 1, effect: 'none' });
  assert.ok(e.defs.some((x) => x.id === 'bookmark'));
  const q = await mark({ action: 'define', mark: 'shortlist', label: 'Short list', hue: 3, effect: 'hide' });
  assert.deepEqual(q.defs.find((x) => x.id === 'shortlist'), { id: 'shortlist', label: 'Short list', hue: 3, effect: 'hide', sort: 20, retired: false });
});

test('a retired id is not reused: the next slug gets -2', async () => {
  await mark({ action: 'define', label: 'Aa', hue: 0, effect: 'none' });
  await mark({ action: 'retire', mark: 'aa' });
  const p = await mark({ action: 'define', label: 'Aa', hue: 0, effect: 'none' });
  assert.ok(p.defs.some((x) => x.id === 'aa-2'));
});

test('a 13th active definition raises 22023 at most 12 bookmarks', async () => {
  for (let i = 0; i < 9; i++) await mark({ action: 'define', label: `Extra ${i}`, hue: i % 8, effect: 'none' });
  await rejects(mark({ action: 'define', label: 'One too many', hue: 0, effect: 'none' }), '22023', 'at most 12 bookmarks');
});

test('grants_mark without a passcode raises 28000', async () => {
  await rejects(mark({ action: 'clear', kind: 'funder', id: FUNDER.id }, ''), '28000');
  await rejects(rpc('grants_mark', { p_patch: { action: 'define', label: 'X' } }), '28000');
});

test('retire removes its items from items, restore returns them', async () => {
  await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'shortlist', note: 'keep me' });
  let p = await mark({ action: 'retire', mark: 'shortlist' });
  assert.equal(p.items.length, 0);
  assert.equal(p.defs.find((d) => d.id === 'shortlist').retired, true);
  assert.equal((await rpc('grants_marks', {})).defs.some((d) => d.id === 'shortlist'), false);
  await rejects(mark({ action: 'set', kind: 'call', id: CALL.id, mark: 'shortlist' }), '22023', 'unknown bookmark');
  p = await mark({ action: 'restore', mark: 'shortlist' });
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].note, 'keep me');
  p = await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'keep-an-eye' }); // 025: a switch with no note key keeps the stored note
  assert.equal(p.items[0].note, 'keep me');
  p = await mark({ action: 'set', kind: 'funder', id: FUNDER.id, mark: 'keep-an-eye', note: '' }); // only an explicit note changes it
  assert.equal('note' in p.items[0], false);
  await rejects(mark({ action: 'retire', mark: 'nope' }), '22023', 'unknown bookmark');
});

test('the shared STATES list backs grants_set_state', async () => {
  await rejects(rpc('grants_set_state', { p_pass: PASS, p_funder: FUNDER.id, p_patch: { state: 'bogus' } }), 'P0001', 'Unknown state');
  assert.equal((await rpc('grants_set_state', { p_pass: PASS, p_funder: FUNDER.id, p_patch: { state: 'skip' } })).state, 'skip');
});

test('grants_add_lead: adds a pending lead, then reports it queued; a funder name is not added', async () => {
  const add = (patch) => rpc('grants_add_lead', { p_pass: PASS, p_patch: { actor: 'Ada', bucket: 'foundation_ngo', ...patch } });
  const r = await add({ org: 'Zzqx Test Foundation', why: 'solar grazing' });
  assert.equal(r.added, true); assert.equal(r.status, 'pending');
  const reg = await rpc('grants_registry', { p_pass: PASS });
  assert.equal(reg.leads.find((l) => l.id === r.id)?.priority, 1);
  assert.equal((await events()).some((e) => e.kind === 'lead_queue' && e.payload?.target_id === r.id), true);
  assert.equal((await add({ org: 'Zzqx  test foundation' })).reason, 'queued');
  assert.equal((await add({ org: FUNDER.name, program: FUNDER.program })).reason, 'funder');
  await rejects(add({ org: 'Q' }), '22023');
  await rejects(add({ org: 'Some Org', url: 'ftp://x' }), '22023');
  await rejects(add({ org: 'Some Org', bucket: 'tracker' }), '22023');
});

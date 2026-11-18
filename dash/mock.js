/* Mock backend for dashboard.html?mock=dash/mock.json. Same RPC names, parameters and return shapes as the live API
   (supabase/grants/023_human_overrides.sql sections 5 and 8), served from memory. load() is the only fetch and it is same origin.
   Any non-empty passcode counts as the team tier. Without one, grants_registry and grants_funder withhold team identity
   (human.by, human.note, vetting actor, lead note, call human.by/note), and an unlisted funder keeps only the registry keys.
   Writes change memory only; a reload restores dash/mock.json. Local verification only, never a production path. */
const OPEN = new Set(['grants_feed', 'grants_registry', 'grants_funder']);
const PASSED = new Set(['grants_check_pass', 'grants_team_notes', 'grants_set_state', 'grants_note', 'grants_set_funder', 'grants_set_call', 'grants_set_lead']);
const STATES = ['new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'skip'];
const VETTING_KIND = { promote: 'promoted', demote: 'demoted', release: 'released' };
let DB = null, seq = 5000;

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
/* the live RPCs return exactly the contract keys; the JSON carries extras (registry team and deadline, note delete columns) that are dropped here */
const REG_FUNDER = 'id name program category bucket status url geography themes award_min_usd award_max_usd amount_confidence ua_eligibility cycle next_deadline fit_score fit_breakdown fit_reasons vet_note reject_reason gates evaluated_at vetted_at verified_at created_at discovered_via adapter fetchability last_ok_at calls_open calls_total team_state human queue'.split(' ');
const NOTE_KEYS = 'id funder_id opportunity_id body actor at'.split(' ');
const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, k in row ? row[k] : null]));
const fail = (message, code) => Object.assign(new Error(message), { code });
const stamp = () => new Date().toISOString();
const find = (rows, key, id) => rows.find((r) => String(r[key]) === String(id));
const why = (s) => String(s ?? '').trim().slice(0, 500);
const need = (id) => { const r = find(DB.registry.funders, 'id', id); if (!r) throw fail('Funder not found', 'P0002'); return r; };
const logEvent = (funder_id, kind, actor, payload) => { DB.events.unshift({ id: ++seq, funder_id, at: stamp(), actor, kind, payload }); };
const teamPass = (b) => String(b.p_pass ?? '').trim() !== '';
const hideHuman = (h) => (h ? { ...h, by: null, note: null } : h ?? null);
const teamRow = (id) => {
  let t = find(DB.team, 'funder_id', id);
  if (!t) { t = { funder_id: id, state: 'new', owner: '', ask_usd: null, notes: '', updated_at: null }; DB.team.push(t); }
  return t;
};
/* a feed row for a funder promoted into tracked; fields the shell reads come from the registry, the rest from a template row */
function feedRow(r) {
  const base = clone(DB.feed.funders[0] || {});
  delete base.team;
  return { ...base, id: r.id, name: r.name, program: r.program, category: r.category, bucket: r.bucket, url: r.url, geography: r.geography, themes: r.themes,
    award_min_usd: r.award_min_usd, award_max_usd: r.award_max_usd, amount_confidence: r.amount_confidence, ua_eligibility: r.ua_eligibility, cycle: r.cycle,
    deadline: r.next_deadline, fit_score: r.fit_score, fit_breakdown: null, fit_reasons: [], vet_note: r.vet_note, vetted_at: stamp(), verified_at: null,
    fetchability: 'ok', collection: { mode: 'none', health: 'off', open_calls: 0, total_calls: 0 } };
}

/* ---- reads: the access tier decides which team fields leave the server ---- */
function registryFor(team) {
  const reg = DB.registry;
  return { ...reg, access: team ? 'team' : 'public', funders: reg.funders.map((f) => pick({ ...f, human: team ? f.human : hideHuman(f.human) }, REG_FUNDER)),
    leads: reg.leads.map((l) => ({ ...l, note: team ? l.note : null })),
    calls: reg.calls.map((c) => ({ ...c, human: team ? c.human : hideHuman(c.human) })) };
}
function funderFor(id, team) {
  const d = DB.funders[id]; if (!d) return null;
  const listed = need(id).status === 'vetted';
  const opportunities = d.opportunities.map((o) => ({ ...o, human: team ? o.human : hideHuman(o.human) }));
  const vetting = d.vetting.map((e) => ({ ...e, actor: team ? e.actor ?? null : null }));
  if (team || listed) {
    const f = clone(d.funder);
    if (!team) f.human = hideHuman(f.human); // a listed funder keeps its owner and ask for anyone (023 section 8)
    return { access: team ? 'team' : 'public', funder: f, opportunities, vetting };
  }
  // unlisted and public: registry keys plus the team state only; no feed-style keys, no collection
  const f = pick({ ...d.funder, human: hideHuman(d.funder.human) }, REG_FUNDER);
  return { access: 'public', funder: { ...f, team: { state: d.funder.team?.state || 'new' } }, opportunities, vetting };
}

/* ---- writes: each returns the live shape and records a team event where the live function does ---- */
function setState(id, p, who) {
  const r = need(id), t = teamRow(id);
  if ('state' in p && !STATES.includes(p.state)) throw fail('Unknown state', 'P0001');
  const keys = ['state', 'owner', 'ask_usd'].filter((k) => k in p && (k === 'owner' ? (p.owner || '') : p[k]) !== t[k]);
  const next = {}, from = {};
  for (const k of keys) { next[k] = k === 'owner' ? (p.owner || '') : p[k]; from[k] = t[k]; }
  const notes = 'notes' in p && (p.notes || '') !== t.notes;
  if (keys.length || notes) { // one event per write, with the changed keys and their old values (no event for a no-op)
    const payload = { ...next };
    if (keys.length) payload.from = from;
    if (notes) payload.notes_changed = true;
    logEvent(id, 'update', who, payload);
    Object.assign(t, next);
    if (notes) t.notes = p.notes || '';
    t.updated_at = stamp();
  }
  r.team = clone(t);
  r.team_state = t.state === 'new' ? null : t.state;
  return { state: t.state, owner: t.owner, notes: t.notes, ask_usd: t.ask_usd, updated_at: t.updated_at };
}
function note(b, p, who) {
  if (p.remove != null) { // any passcode holder may remove any note (023 note_remove: design limit)
    const n = find(DB.notes, 'id', p.remove);
    if (!n || n.deleted_at) throw fail('Note not found', 'P0002');
    Object.assign(n, { deleted_at: stamp(), deleted_by: who });
    return { removed: n.id };
  }
  need(b.p_funder);
  const body = String(p.body ?? '').trim();
  if (!body || body.length > 2000) throw fail('A note needs 1 to 2000 characters', 'P0001');
  const n = { id: ++seq, funder_id: b.p_funder, opportunity_id: p.opportunity_id || null, body, actor: who, at: stamp(), deleted_at: null, deleted_by: null };
  DB.notes.unshift(n);
  return clone({ id: n.id, funder_id: n.funder_id, opportunity_id: n.opportunity_id, body, actor: who, at: n.at });
}
/* a funder that leaves 'vetted' moves its vetted calls to candidate, unless the team promoted the call (023 funders_unlist_cascade) */
function unlistCalls(id) {
  const move = (c) => { if (String(c.funder_id) === String(id) && c.vet_status === 'vetted' && c.human?.lock !== 'promoted') c.vet_status = 'candidate'; };
  DB.registry.calls.forEach(move);
  for (const o of DB.funders[id]?.opportunities || []) move(o);
}
function setFunder(id, p, who) {
  const r = need(id), reason = why(p.reason), from = r.status;
  if (!(p.action in VETTING_KIND)) throw fail('Unknown action', 'P0001');
  if (p.action !== 'release' && reason.length < 3) throw fail('Give a reason of at least 3 characters', 'P0001');
  if (p.action === 'promote') {
    if (r.status === 'vetted') throw fail('Already tracked', 'P0001');
    r.status = 'vetted'; r.queue = 'pending'; r.human = { lock: 'promoted', by: who, at: stamp(), note: reason };
    if (!find(DB.feed.funders, 'id', id)) DB.feed.funders.push(feedRow(r));
  } else if (p.action === 'demote') {
    if (r.status !== 'vetted') throw fail('Only tracked funders can be demoted', 'P0001');
    r.status = 'rejected'; r.queue = null; r.human = { lock: 'demoted', by: who, at: stamp(), note: reason };
    DB.feed.funders = DB.feed.funders.filter((f) => String(f.id) !== String(id));
    unlistCalls(id);
  } else {
    r.human = null;
  }
  logEvent(id, p.action, who, { reason, from_status: from });
  const d = DB.funders[id];
  if (d) {
    d.funder = { ...d.funder, status: r.status, human: r.human, queue: r.queue, team: r.team,
      collection: (find(DB.feed.funders, 'id', id) || {}).collection ?? d.funder.collection };
    d.vetting.unshift({ at: stamp(), kind: VETTING_KIND[p.action], note: reason, changes: null, run_label: 'human', actor: who });
  }
  return { id, status: r.status, human: r.human, queue: r.queue };
}
function setCall(id, p, who) {
  const c = find(DB.registry.calls, 'id', id);
  if (!c) throw fail('Call not found', 'P0002');
  const reason = why(p.reason), from = c.vet_status, d = DB.funders[c.funder_id], oc = d && find(d.opportunities, 'id', id);
  if (p.action === 'demote') {
    if (reason.length < 3) throw fail('Give a reason of at least 3 characters', 'P0001');
    if (c.vet_status === 'rejected') throw fail('This call is already screened out', 'P0001');
    c.vet_status = 'rejected'; c.human = { lock: 'demoted', by: who, at: stamp(), note: reason };
    logEvent(c.funder_id, 'call_demote', who, { opportunity_id: c.id, title: c.title, reason: reason || null, from_status: from });
  } else if (p.action === 'restore') {
    if (c.human?.lock !== 'demoted') throw fail('The team has not demoted this call', 'P0001');
    const fr = find(DB.registry.funders, 'id', c.funder_id);
    if (fr?.status !== 'vetted') throw fail('This call belongs to a funder that is not listed: promote the funder first', 'P0001');
    const last = DB.events.find((e) => e.kind === 'call_demote' && String(e.payload?.opportunity_id) === String(id));
    c.vet_status = last?.payload?.from_status || 'vetted'; c.human = null;
    logEvent(c.funder_id, 'call_restore', who, { opportunity_id: c.id, title: c.title, reason: reason || null, from_status: from });
  } else throw fail('Unknown action', 'P0001');
  if (oc) Object.assign(oc, { vet_status: c.vet_status, human: c.human });
  return { id: c.id, funder_id: c.funder_id, vet_status: c.vet_status, human: c.human };
}
function setLead(id, p, who) {
  const l = find(DB.registry.leads, 'id', id);
  if (!l) throw fail('Lead not found', 'P0002');
  if (l.status === 'covered') throw fail('This lead is already covered by a listed funder', 'P0001');
  const from = l.status, reason = why(p.reason);
  if (p.action === 'queue') { l.status = 'pending'; l.priority = 1; }
  else if (p.action === 'dismiss') {
    if (reason.length < 3) throw fail('Give a reason of at least 3 characters', 'P0001');
    l.status = 'rejected';
  } else throw fail('Unknown action', 'P0001');
  l.note = [who, reason].filter(Boolean).join(': ');
  l.updated_at = stamp();
  logEvent(l.funder_id ?? null, p.action === 'queue' ? 'lead_queue' : 'lead_dismiss', who, { target_id: l.id, org: l.org, reason: reason || null, from_status: from });
  return { id: l.id, status: l.status, note: l.note };
}

/* ---- public surface: load once, then rpc(fn, body) like the live API ---- */
export async function load(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Mock data returned ${r.status}`);
  DB = await r.json();
  return true;
}
export async function rpc(fn, body = {}) {
  if (!DB) throw fail('Mock data is not loaded', 'MOCK');
  if (!OPEN.has(fn) && !PASSED.has(fn)) throw fail(`Unknown mock RPC: ${fn}`, 'MOCK');
  const b = body || {}, p = b.p_patch || {};
  if (PASSED.has(fn) && !String(b.p_pass ?? '').trim()) throw fail('Passcode required', '28000');
  const who = String(p.actor || '').trim() || 'Mock user';
  switch (fn) {
    case 'grants_feed': return clone(DB.feed);
    case 'grants_registry': return clone(registryFor(teamPass(b)));
    case 'grants_funder': return clone(funderFor(b.p_id, teamPass(b)));
    case 'grants_check_pass': return true;
    case 'grants_team_notes': return clone({ team: DB.team, events: DB.events.slice(0, 500), notes: DB.notes.filter((n) => !n.deleted_at).map((n) => pick(n, NOTE_KEYS)) });
    case 'grants_set_state': return setState(b.p_funder, p, who);
    case 'grants_note': return note(b, p, who);
    case 'grants_set_funder': return setFunder(b.p_funder, p, who);
    case 'grants_set_call': return setCall(b.p_opp, p, who);
    case 'grants_set_lead': return setLead(b.p_target, p, who);
  }
}

// node dash/ui.test.mjs: pure helpers from dash/ui.js, event copy, token colour guard and contrast in both themes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initials, ownerHue, timeAgo, describeEvent, pipeLabel, notesLabel, agentRunLabel, agentDaysText, markItems, markAria, placeBox, markChip, markGlyph, markFilter, markList, markManager, menu, markGroups, canAddMark, MARK_EFFECTS } from './ui.js';
import { STATE_LABELS, marksIndex } from '../dashboard.js';

const NOW = new Date('2026-11-11T20:00:00Z'); // fixed clock, same as dashboard.test.mjs
let n = 0;
const t = (name, fn) => { fn(); n++; };
const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

t('initials: first and last word, uppercase, empty stays empty', () => {
  assert.equal(initials('Ana Ruiz'), 'AR');
  assert.equal(initials('carlos silva mendez'), 'CM');
  assert.equal(initials('Ana'), 'AN');
  assert.equal(initials('  '), '');
  assert.equal(initials(undefined), '');
});
t('ownerHue: always 0..7, stable per name, distinct for the four mock owners', () => {
  for (const name of ['Ana Ruiz', 'Ben Okafor', 'Carla Mendez', 'Dev Patel', '', 'Zoë Ñúñez', 'x'.repeat(200)]) {
    const h = ownerHue(name); assert.ok(Number.isInteger(h) && h >= 0 && h <= 7, `${name} -> ${h}`); assert.equal(ownerHue(name), h);
  }
  const hues = ['Ana Ruiz', 'Ben Okafor', 'Carla Mendez', 'Dev Patel'].map(ownerHue);
  assert.equal(new Set(hues).size, 4, `mock owners share a hue: ${hues}`);
});
t('timeAgo: fixed clock gives plain words, dates after two weeks', () => {
  assert.equal(timeAgo('2026-11-11T19:59:30Z', NOW), 'just now');
  assert.equal(timeAgo('2026-11-11T19:55:00Z', NOW), '5 min ago');
  assert.equal(timeAgo('2026-11-11T17:00:00Z', NOW), '3 h ago');
  assert.equal(timeAgo('2026-11-10T20:00:00Z', NOW), '1 day ago');
  assert.equal(timeAgo('2026-11-08T20:00:00Z', NOW), '3 days ago');
  assert.equal(timeAgo('2026-10-22T20:00:00Z', NOW), 'Oct 22, 2026');
  assert.equal(timeAgo('', NOW), '');
  assert.equal(timeAgo('not a date', NOW), '');
});
t('describeEvent: states read as moved to, with the old state as detail', () => {
  assert.deepEqual(describeEvent({ kind: 'update', payload: { state: 'applying', from: { state: 'reviewing' } } }, STATE_LABELS),
    { verb: 'moved to Applying', detail: 'from Reviewing' });
  assert.deepEqual(describeEvent({ kind: 'update', payload: { state: 'skip' } }).verb, 'moved to Skipped');
});
t('describeEvent: owner, ask, notes and the human-lock and call kinds', () => {
  assert.deepEqual(describeEvent({ kind: 'update', payload: { owner: 'Ben Okafor', from: { owner: 'Ana Ruiz' } } }),
    { verb: 'set owner to Ben Okafor', detail: 'from Ana Ruiz' });
  assert.equal(describeEvent({ kind: 'update', payload: { ask_usd: 250000 } }).verb, 'set the ask to $250k');
  assert.equal(describeEvent({ kind: 'update', payload: { notes_changed: true } }).verb, 'edited the notes');
  assert.deepEqual(describeEvent({ kind: 'promote', payload: { reason: 'Clear mission match' } }), { verb: 'promoted to tracked', detail: 'Clear mission match' });
  assert.deepEqual(describeEvent({ kind: 'demote', payload: { reason: 'Fit below 40' } }), { verb: 'screened out', detail: 'Fit below 40' });
  assert.deepEqual(describeEvent({ kind: 'release', payload: { reason: 'Re-check' } }), { verb: 'released the human lock', detail: 'Re-check' });
  assert.deepEqual(describeEvent({ kind: 'call_demote', payload: { title: 'Pilot 2027', reason: 'Not this year' } }), { verb: 'demoted a call', detail: 'Pilot 2027: Not this year' });
  assert.deepEqual(describeEvent({ kind: 'call_restore', payload: { title: 'Pilot 2027' } }), { verb: 'restored a call', detail: 'Pilot 2027' });
  assert.equal(describeEvent({ kind: 'odd_kind' }).verb, 'odd_kind');
  assert.equal(describeEvent(null).verb, 'changed');
});
t('describeEvent: lead queue and dismiss read as lead actions, never as raw kinds', () => {
  assert.deepEqual(describeEvent({ kind: 'lead_queue', payload: { org: 'Gulbenkian Foundation' } }), { verb: 'queued a lead', detail: 'Gulbenkian Foundation' });
  assert.deepEqual(describeEvent({ kind: 'lead_dismiss', payload: { org: 'UAE Fund', reason: 'Not a SALSAV theme' } }), { verb: 'dismissed a lead', detail: 'UAE Fund: Not a SALSAV theme' });
  assert.deepEqual(describeEvent({ kind: 'lead_dismiss', payload: { org: 'UAE Fund' } }), { verb: 'dismissed a lead', detail: 'UAE Fund' });
  assert.deepEqual(describeEvent({ kind: 'lead_queue', payload: { org: null, funder_id: null } }), { verb: 'queued a lead', detail: '' });
});

/* colours: ui.css and ui.js use tokens only */
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
t('pipeLabel: progressed funders read In pipeline with the team state, never as a rejection', () => {
  assert.equal(pipeLabel('applying'), 'In pipeline: Applying');
  assert.equal(pipeLabel('submitted'), 'In pipeline: Submitted');
  assert.equal(pipeLabel('mystery'), 'In pipeline: mystery');
  assert.equal(pipeLabel('declined'), 'In pipeline: Declined');
});
t('agentRunLabel: next Tuesday or Friday at 07:00 local time, strictly after now', () => {
  assert.equal(agentDaysText(), 'Tuesdays and Fridays');
  assert.equal(agentRunLabel(new Date(2026, 10, 17, 6, 30)), 'Tuesday, Nov 17 at 07:00'); // Tuesday before the run
  assert.equal(agentRunLabel(new Date(2026, 10, 17, 7, 0)), 'Friday, Nov 20 at 07:00'); // exactly at the run: the next one
  assert.equal(agentRunLabel(new Date(2026, 10, 21, 9, 0)), 'Tuesday, Nov 24 at 07:00'); // Saturday
});
t('notesLabel: singular for one note, plural otherwise, zero for none or junk', () => {
  assert.equal(notesLabel(0), '0 notes'); assert.equal(notesLabel(1), '1 note'); assert.equal(notesLabel(3), '3 notes');
  assert.equal(notesLabel(undefined), '0 notes'); assert.equal(notesLabel('2'), '2 notes');
});
t('colour guard: no colour literals in ui.css or ui.js', () => {
  assert.equal(LITERAL.test(read('dash/ui.css')), false);
  assert.equal(LITERAL.test(read('dash/ui.js')), false);
});

/* contrast: parse hex tokens from dashboard.css for light and dark, check text pairs */
const block = (css, sel) => { const i = css.indexOf(sel); assert.ok(i >= 0, `no block ${sel}`); const o = css.indexOf('{', i); return css.slice(o + 1, css.indexOf('}', o)); };
const tokens = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9_-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const css = read('dashboard.css');
const THEMES = { light: tokens(block(css, ':root {')), dark: tokens(block(css, 'html[data-theme="dark"] {')) };
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [name, T] of Object.entries(THEMES)) {
  t(`contrast (${name}): text tokens reach 4.5:1 on the surfaces they sit on`, () => {
    const pairs = [['ink', 'surface'], ['muted', 'surface'], ['muted', 'surface-2'], ['ink-2', 'surface'], ['primary-ink', 'primary'],
      ['ok-fg', 'surface'], ['warn-fg', 'surface'], ['bad-fg', 'surface'], ['primary', 'surface'],
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`av-ink`, `av-${i}`]),
      ...['apply', 'rolling', 'prepare', 'cultivate', 'watch'].map((l) => [`l-${l}`, 'surface']),
      ...['rolling', 'cultivate'].map((l) => [`l-${l}`, 'surface-2'])];
    for (const [fg, bg] of pairs) {
      assert.ok(T[fg] && T[bg], `${name}: missing ${fg} or ${bg}`);
      const r = ratio(T[fg], T[bg]);
      assert.ok(r >= 4.5, `${name}: --${fg} on --${bg} is ${r.toFixed(2)}:1`);
    }
  });
  t(`contrast (${name}): bucket hues reach 3:1 as dots and borders`, () => {
    for (const b of ['us_federal', 'intl_dev', 'state_regional', 'private_sector', 'foundation_ngo', 'tracker']) {
      const r = ratio(T[`b-${b}`], T.surface); assert.ok(r >= 3, `${name}: --b-${b} is ${r.toFixed(2)}:1`);
    }
  });
}

/* the two lanes moved apart in G3 keep CIE76 >= 20 from every bucket, the other lane and the status tokens of their theme;
   a lane chip is a 12% tint of the lane on the surface, so its text must still reach 4.5:1 */
const srgbLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lab = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => srgbLin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (x) => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const de76 = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const mixOn = (fg, bg, p) => '#' + [1, 3, 5].map((i) => Math.round(p * parseInt(fg.slice(i, i + 2), 16) + (1 - p) * parseInt(bg.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');
for (const [name, T] of Object.entries(THEMES)) {
  t(`palette (${name}): rolling and cultivate stay 20 CIE76 from every bucket, lane and status token`, () => {
    const others = [...Object.keys(T).filter((k) => /^b-/.test(k) || /^(primary|amber|red|terra|warn-fg|bad-fg)$/.test(k)),
      ...['apply', 'rolling', 'prepare', 'cultivate', 'watch'].map((l) => `l-${l}`)];
    for (const lane of ['rolling', 'cultivate']) {
      for (const k of others) {
        if (k === `l-${lane}`) continue;
        const d = de76(T[`l-${lane}`], T[k]); assert.ok(d >= 20, `${name}: --l-${lane} vs --${k} is ${d.toFixed(1)}`);
      }
    }
  });
  t(`palette (${name}): lane chip text reaches 4.5:1 on its own 12% tint`, () => {
    for (const lane of ['rolling', 'cultivate']) {
      const bg = mixOn(T[`l-${lane}`], T.surface, 0.12), r = ratio(T[`l-${lane}`], bg);
      assert.ok(r >= 4.5, `${name}: --l-${lane} chip is ${r.toFixed(2)}:1`);
    }
  });
}
t('agent queue chip is neutral, not the Apply green', () => {
  assert.doesNotMatch(read('dash/ui.css'), /\.rchip\.r-queue\s*\{[^}]*--primary/);
});
t('ordinal viz series (viz-s3, viz-s4) use no bucket token', () => {
  const viz = read('dash/viz.css');
  assert.doesNotMatch(viz, /viz-s[34]\s*\{[^}]*--b-/);
});

/* bookmarks */
let focused = null; // the node that got .focus() last
{ // a minimal DOM: markGlyph, markChip and markFilter only need element creation, attributes, children and text
  const mk = (tag) => ({ tag, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(k, f) { (this.ev ||= {})[k] = f; }, append(...c) { this.kids.push(...c); }, get children() { return this.kids; }, set className(v) { this.attrs.class = v; }, set textContent(v) { this.text = v; }, get textContent() { return this.text ?? ''; },
    getAttribute(k) { return this.attrs[k] ?? null; }, focus() { focused = this; },
    all() { return this.kids.flatMap((k) => (k.tag ? [k, ...k.all()] : [])); }, // descendants, for the two selectors ui.js uses
    querySelector(s) { return this.all().find((x) => (x.attrs.class || '').split(' ').includes(s.slice(1))) || null; }, querySelectorAll() { return this.all().filter((x) => (x.attrs.role || '').startsWith('menuitem')); } });
  globalThis.document = { createElement: mk, createElementNS: (ns, tag) => mk(tag), createTextNode: (x) => ({ text: x }), addEventListener() {}, removeEventListener() {} };
}
const DEFS = [{ id: 'keep', label: 'Keep an eye on', hue: 0, effect: 'follow' }, { id: 'short', label: 'Shortlist', hue: 1, effect: 'none' }, { id: 'nope', label: 'Not relevant', hue: 4, effect: 'hide' }];
t('markItems: exactly the current definition is checked; the list ends with Manage bookmarks...', () => {
  const its = markItems({ def: DEFS[1], defs: DEFS, note: 'x' }), radios = its.filter((i) => i.checked !== undefined);
  assert.equal(radios.length, 3);
  assert.deepEqual(radios.filter((i) => i.checked).map((i) => i.label), ['Shortlist']);
  assert.equal(its.at(-1).label, 'Manage bookmarks...');
  assert.deepEqual(its.slice(3).map((i) => (i.sep ? '-' : i.label)), ['-', 'Edit note...', 'Remove bookmark', '-', 'Manage bookmarks...']);
  assert.equal(radios[0].hint, MARK_EFFECTS.follow); assert.equal(radios[1].hint, null);
});
t('markItems: without a definition there is no Remove bookmark or note item; picking the checked row does nothing', () => {
  const picks = [], its = markItems({ defs: DEFS, onPick: (id) => picks.push(id) });
  assert.ok(!its.some((i) => i.label === 'Remove bookmark' || /note/.test(i.label || '')));
  assert.equal(its.filter((i) => i.checked).length, 0);
  its[0].onSelect(); assert.deepEqual(picks, ['keep']);
  const picks2 = [], withDef = markItems({ def: DEFS[0], defs: DEFS, onPick: (id) => picks2.push(id) });
  withDef[0].onSelect(); withDef.find((i) => i.danger).onSelect(); assert.deepEqual(picks2, [null]);
  assert.equal(markItems({ def: DEFS[0], defs: DEFS }).find((i) => /note/.test(i.label || '')).label, 'Add a note...');
  assert.equal(markItems({ defs: [] }).at(0).label, 'Manage bookmarks...'); // no leading separator
});
t('placeBox: below the anchor, flips above near the bottom, clamps left', () => {
  const a = { left: 100, top: 100, bottom: 128 };
  assert.deepEqual(placeBox(a, 200, 150, 1000, 800), { left: 100, top: 134 });
  assert.deepEqual(placeBox({ left: 100, top: 700, bottom: 728 }, 200, 150, 1000, 800), { left: 100, top: 544 });
  assert.equal(placeBox({ left: 950, top: 100, bottom: 128 }, 200, 150, 1000, 800).left, 792);
  assert.equal(placeBox({ left: -30, top: 100, bottom: 128 }, 200, 150, 1000, 800).left, 8);
  assert.equal(placeBox({ left: 100, top: 60, bottom: 88 }, 200, 750, 1000, 800).top, 94); // fits neither way: stays below
});
t('describeEvent: mark_set and mark_clear', () => {
  assert.deepEqual(describeEvent({ kind: 'mark_set', payload: { item_kind: 'funder', name: 'NIFA', label: 'Shortlist', note: 'ask in Jan' } }), { verb: 'bookmarked as Shortlist', detail: 'ask in Jan' });
  assert.deepEqual(describeEvent({ kind: 'mark_set', payload: { item_kind: 'call', name: 'Pilot 2027', label: 'Keep an eye on' } }), { verb: 'bookmarked as Keep an eye on', detail: 'Pilot 2027' });
  assert.equal(describeEvent({ kind: 'mark_set', payload: { item_kind: 'lead', name: 'UAE Fund', label: 'Shortlist', note: 'n' } }).detail, 'UAE Fund: n');
  assert.deepEqual(describeEvent({ kind: 'mark_clear', payload: { item_kind: 'funder', name: 'NIFA' } }), { verb: 'removed the bookmark', detail: '' });
  assert.deepEqual(describeEvent({ kind: 'mark_clear', payload: { item_kind: 'lead', name: 'UAE Fund' } }), { verb: 'removed the bookmark', detail: 'UAE Fund' });
});
t('markAria: set, unset and locked forms', () => {
  assert.equal(markAria('NIFA', DEFS[0], true), 'Bookmark NIFA: Keep an eye on');
  assert.equal(markAria('NIFA', null, true), 'Bookmark NIFA');
  assert.equal(markAria('NIFA', DEFS[0], false), 'Bookmarked Keep an eye on. Unlock to change.');
});
t('markGlyph, markChip, markFilter: hue class, hide dimming, null without data', () => {
  assert.equal(markGlyph(null).attrs.class, 'mk-ico');
  assert.equal(markGlyph(DEFS[0]).attrs.class, 'mk-ico mk-0 is-set');
  assert.equal(markGlyph(DEFS[2]).attrs.class, 'mk-ico mk-4 is-set is-hide');
  assert.equal(markGlyph({ hue: 99, label: 'x' }).attrs.class, 'mk-ico mk-7 is-set');
  assert.equal(markChip(null), null);
  assert.equal(markChip(DEFS[1], 'note').attrs.class, 'mchip mk-1');
  assert.equal(markFilter({ defs: [] }), null);
  const f = markFilter({ defs: DEFS, selected: ['short'], counts: new Map([['keep', 3]]) });
  assert.deepEqual(f.kids.map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false']);
  assert.equal(f.kids[0].kids.at(-1).text, '3'); assert.equal(f.kids[1].kids.length, 2);
});
t('ui.css: bookmark hues map mk-0..7 to --av-0..7 and the block holds no colour literal', () => {
  const ui = read('dash/ui.css'), i = ui.indexOf('/* bookmarks:'), j = ui.indexOf('/* the ask dialog');
  assert.ok(i > 0 && j > i);
  for (let k = 0; k < 8; k++) assert.ok(ui.includes(`.mk-${k} { --mk: var(--av-${k}); }`), `mk-${k}`);
  assert.equal(LITERAL.test(ui.slice(i, j)), false);
  for (const sel of ['.mchip', '.umenu-sep', '.umenu-hint', '.umenu--fixed', '.mk-line', '.mk-end', '.mk-dim', '.mk-btn--label']) assert.ok(ui.includes(sel), sel);
  assert.match(ui, /\(pointer: coarse\), \(max-width: 760px\) \{[^@]*\.mk-btn \{ min-width: 44px; min-height: 44px; \}/);
  assert.doesNotMatch(ui.slice(i, j), /\.mk-btn[^{]*\{[^}]*[^-\w]color:/); // glyph colour never on the button
  assert.ok(ui.includes('[aria-checked="true"]::after { content: "\\2713"; }'), 'checked row mark is the \\2713 escape');
  assert.equal(/[^\x00-\x7f]/.test(ui), false, 'ui.css stays ASCII (a mangled escape shows up as non-ASCII)');
});
const walk = (n, out = []) => { if (n && n.tag) { out.push(n); n.kids.forEach((k) => walk(k, out)); } return out; };
const byClass = (n, c) => walk(n).filter((x) => (x.attrs.class || '').split(' ').includes(c));
const dis = (n) => n.disabled === true || n.attrs.disabled !== undefined; // el sets the attribute, later edits set the property
const txt = (n) => (typeof n === 'string' ? n : (n.text ?? '') + (n.kids || []).map(txt).join(''));
const ALL = [...DEFS.map((d, i) => ({ ...d, sort: i * 10 })), { id: 'old', label: 'Old one', hue: 6, effect: 'none', sort: 99, retired: true }];
const IDX = marksIndex({ team: true, defs: ALL, items: [
  { kind: 'funder', id: 'f2', mark: 'short', name: 'Zeta Fund' }, { kind: 'call', id: 'c1', mark: 'short', name: 'Alpha Call', funder: 'f2' },
  { kind: 'lead', id: 'l1', mark: 'nope', name: 'Dead Lead' }, { kind: 'funder', id: 'f9', mark: 'old', name: 'Gone' }] });
t('markGroups: only definitions with items, in definition order, items by name', () => {
  const g = markGroups(IDX);
  assert.deepEqual(g.map((x) => x.def.id), ['short', 'nope']);
  assert.deepEqual(g[0].items.map((i) => i.name), ['Alpha Call', 'Zeta Fund']);
  assert.deepEqual(markGroups(null), []);
  assert.deepEqual(markGroups(marksIndex(null)), []);
});
t('canAddMark: false at the limit, retired ones do not count', () => {
  const act = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }));
  assert.equal(canAddMark(act(11), 12), true);
  assert.equal(canAddMark(act(12), 12), false);
  assert.equal(canAddMark([...act(11), { id: 'r', retired: true }, { id: 'r2', retired: true }], 12), true);
  assert.equal(canAddMark([], 12), true); assert.equal(canAddMark(undefined), true);
});
t('markList: empty message, groups with kind tags, Show all past 8, always a Manage footer', () => {
  const empty = markList({ index: marksIndex(null) });
  assert.match(txt(empty), /No bookmarks yet\. Use the ribbon on any funder, call or lead\./);
  assert.match(txt(markList({ index: marksIndex(null), team: false })), /No bookmarks yet\. Unlock editing, then use the ribbon/); // a locked viewer has no ribbons to use
  assert.equal(byClass(empty, 'mk-grp').length, 0);
  assert.match(txt(byClass(empty, 'mk-foot')[0]), /Manage bookmarks\.\.\./);
  const l = markList({ index: IDX });
  assert.deepEqual(byClass(l, 'mk-grp').map((g) => g.attrs['aria-label']), ['Shortlist', 'Not relevant']);
  assert.deepEqual(byClass(l, 'mk-open').map((b) => b.attrs['data-kind']), ['call', 'funder', 'lead']);
  assert.deepEqual(byClass(l, 'flag--muted').map(txt), ['Call', 'Lead']); // funders carry no kind tag
  assert.equal(byClass(l, 'mk-more').length, 0);
  const many = marksIndex({ defs: DEFS, items: Array.from({ length: 11 }, (_, i) => ({ kind: 'funder', id: `f${i}`, mark: 'keep', name: `F${i}` })) });
  const m = markList({ index: many });
  assert.equal(byClass(m, 'mk-open').length, 8);
  assert.equal(txt(byClass(m, 'mk-more')[0]), 'Show all 11');
});
t('markManager: active rows, retired with Restore, New bookmark row, cap text', () => {
  const m = markManager({ all: ALL, counts: new Map([['keep', 1], ['short', 2]]) });
  const rows = byClass(m, 'mk-row').filter((r) => r.attrs['data-mark-def']);
  assert.deepEqual(rows.map((r) => r.attrs['data-mark-def']), ['keep', 'short', 'nope', 'old']);
  assert.deepEqual(byClass(rows[0], 'mk-cnt').map(txt), ['1 item']); assert.deepEqual(byClass(rows[1], 'mk-cnt').map(txt), ['2 items']);
  assert.equal(byClass(rows[0], 'mk-sw').length, 8);
  assert.equal(byClass(rows[0], 'mk-sw').filter((b) => b.attrs['aria-checked'] === 'true').length, 1);
  assert.equal(byClass(rows[0], 'mk-name')[0].attrs.maxlength, '32');
  assert.deepEqual(walk(rows[0]).filter((x) => x.tag === 'option').map((o) => o.text), Object.values(MARK_EFFECTS));
  assert.equal(dis(walk(rows[0]).find((x) => x.text === 'Save')), true); // enabled only after a change
  assert.deepEqual(walk(rows[3]).filter((x) => x.tag === 'button').map((x) => x.text), ['Restore']);
  assert.match(txt(byClass(m, 'mk-new')[0]), /3 of 12 in use/);
  const full = markManager({ all: Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, label: `D${i}`, hue: i % 8, effect: 'none', sort: i })).concat([{ id: 'r', label: 'R', hue: 0, effect: 'none', sort: 99, retired: true }]) });
  assert.match(txt(byClass(full, 'mk-new')[0]), /12 of 12 in use/);
  assert.equal(dis(byClass(byClass(full, 'mk-new')[0], 'mk-name')[0]), true);
  assert.equal(dis(walk(full).find((x) => x.text === 'Restore')), true);
});
t('markList: Show all moves focus to the first new row; each Filter Radar button names its group', () => {
  const many = marksIndex({ defs: DEFS, items: Array.from({ length: 11 }, (_, i) => ({ kind: 'funder', id: `f${i}`, mark: 'keep', name: `F${i}` })) });
  const m = markList({ index: many }), more = byClass(m, 'mk-more')[0];
  focused = null; more.ev.click({ currentTarget: more });
  assert.equal(focused, byClass(m, 'mk-open')[8]); assert.equal(more.hidden, true);
  assert.deepEqual(byClass(markList({ index: IDX }), 'linkbtn').map((b) => b.attrs['aria-label']), ['Filter Radar by Shortlist', 'Filter Radar by Not relevant']);
});
t('markManager: Save, Retire and Restore carry the row label; retired rows show no count', () => {
  const m = markManager({ all: ALL, counts: new Map([['keep', 1]]) });
  const rows = byClass(m, 'mk-row').filter((r) => r.attrs['data-mark-def']), btn = (r, x) => walk(r).find((b) => b.text === x).attrs['aria-label'];
  assert.deepEqual([btn(rows[0], 'Save'), btn(rows[0], 'Retire'), btn(rows[3], 'Restore')], ['Save Keep an eye on', 'Retire Keep an eye on', 'Restore Old one']);
  assert.equal(byClass(rows[3], 'mk-cnt').length, 0); assert.equal(byClass(rows[0], 'mk-cnt').length, 1);
});
{ // the Save and Retire names follow a successful rename
  const m = markManager({ all: ALL, onDefine: async () => true }), row = byClass(m, 'mk-row').find((r) => r.attrs['data-mark-def'] === 'keep');
  const save = walk(row).find((b) => b.text === 'Save'), retire = walk(row).find((b) => b.text === 'Retire');
  byClass(row, 'mk-name')[0].ev.input({ target: { value: 'Watch' } });
  await save.ev.click();
  assert.equal(save.attrs['aria-label'], 'Save Watch'); assert.equal(retire.attrs['aria-label'], 'Retire Watch'); n++;
}
t('menu: list is named after the button, Home and End jump, a pick refocuses the button before onSelect', () => {
  // only the handlers are asserted: what .focus() does to a real page is up to the browser
  const mkMenu = (label) => {
    const wrap = document.createElement('span'), button = document.createElement('button'), picked = [];
    wrap.classList = { add() {} }; wrap.contains = () => true; button.parentElement = wrap; wrap.append(button);
    if (label) button.setAttribute('aria-label', label);
    const mn = menu(button, ['A', 'B', 'C'].map((l) => ({ label: l, onSelect: () => picked.push([l, focused]) })));
    return { button, list: wrap.kids[1], mn, picked };
  };
  assert.equal(mkMenu().list.attrs['aria-label'], 'Menu'); // no aria-label and no text: the fallback
  const { button, list, mn, picked } = mkMenu('Bookmark Zeta');
  assert.equal(list.attrs['aria-label'], 'Bookmark Zeta');
  const items = list.querySelectorAll(), key = (k) => list.ev.keydown({ key: k, preventDefault() {} });
  mn.open();
  document.activeElement = items[1]; key('End'); assert.equal(focused, items[2]);
  key('Home'); assert.equal(focused, items[0]);
  items[1].ev.click(); assert.deepEqual(picked, [['B', button]]); // the button had focus when onSelect ran
});
t('ui.css: popover, group, manager and hue-chip rules exist; the phone sheet is fixed under the topbar', () => {
  const ui = read('dash/ui.css');
  for (const sel of ['.mk-pop', '.mk-grp', '.mk-mgr', '.mk-sw', '.mk-open']) assert.ok(ui.includes(sel), sel);
  assert.match(ui, /\(pointer: coarse\), \(max-width: 760px\) \{[^@]*\.mk-pop \{ position: fixed; left: 8px; right: 8px; top: var\(--topbar-h\);[^}]*max-height: 70dvh;/);
  assert.doesNotMatch(ui, /\.mk-sw[^{]*\{[^}]*[^-\w]color:/); // hue chip colour is a background, never text colour on a button
});
t('ui.js builds the DOM with el and sv: no innerHTML', () => {
  assert.equal(/\.innerHTML\b/.test(read('dash/ui.js')), false);
});
for (const [name, T] of Object.entries(THEMES)) {
  t(`contrast (${name}): each --av-n reaches 4.5:1 on its 12% tint over --surface (bookmark chip text)`, () => {
    for (let k = 0; k < 8; k++) { const r = ratio(T[`av-${k}`], mixOn(T[`av-${k}`], T.surface, 0.12)); assert.ok(r >= 4.5, `${name}: --av-${k} chip is ${r.toFixed(2)}:1`); }
  });
}

console.log(`ok ${n} tests`);

// node dash/ui.test.mjs: pure helpers from dash/ui.js, event copy, token colour guard and contrast in both themes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initials, ownerHue, timeAgo, describeEvent, pipeLabel, notesLabel, agentRunLabel, agentDaysText } from './ui.js';
import { STATE_LABELS } from '../dashboard.js';

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

console.log(`ok ${n} tests`);

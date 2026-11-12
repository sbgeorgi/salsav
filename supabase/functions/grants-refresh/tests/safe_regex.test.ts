import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { newBudget, RegexBudgetError, regexSyntaxProblem, safeRegex, SOURCE_STEPS } from "../safe_regex.ts";
import type { SafeMatch } from "../safe_regex.ts";

// What native JavaScript returns for flags "gi", in the matcher's shape (every match).
const native = (src: string, text: string): SafeMatch[] => {
  const out: SafeMatch[] = [];
  for (const m of text.matchAll(new RegExp(src, "gi"))) {
    out.push({ index: m.index, end: m.index + m[0].length, groups: [...m] });
  }
  return out;
};
const sameAsNative = (src: string, text: string, label = ""): void => {
  const re = safeRegex(src), where = `${label} pattern ${JSON.stringify(src)} text ${JSON.stringify(text.slice(0, 120))}`;
  assert.deepEqual(re.matchAll(text), native(src, text), where);
  assert.equal(re.test(text), new RegExp(src, "gi").test(text), where);
};

// ---- 1. differential fuzz ----
const mulberry = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const TEXT_CHARS = [..."aaabbABéÉá12  _-.kKsSx", " ", "\n", "\r", " ", " ", "\t", "K", "ſ", "ß"];
const LITERALS = [
  "a", "a", "a", "b", "b", "A", "B", "é", "É", "á", "1", "2", " ", " ", "x", "k", "s", "_", "-", ",", " ", "\n", "ß",
  "\\.", "\\-", "\\/", "\\?", "\\(", "\\ ", "\\n", "\\r", "\\t", "\\f", "\\v", "\\0", "\\x41", "\\x20", "\\u00e9", "\\u2028", "\\u00a0",
  "{", "}", "]", "a{", "a{,2}", "b{1", ":",
];
const CLASSES = [
  ".", ".", "\\d", "\\D", "\\w", "\\W", "\\s", "\\s", "\\S", "[ab]", "[^a]", "[a-b]", "[A-Z]", "[a-z]", "[^\\s]", "[\\d\\s]",
  "[^\\S\\d]", "[a-é]", "[áéíóú]", "[^\\n]", "[\\s\\S]", "[.]", "[\\-a]", "[a\\]]", "[]", "[^]", "[k]", "[^k]", "[s]",
  "[\\u00e0-\\u00ff]", "[\\x41-\\x5a]", "[^a-z]", "[\\w-]", "[a-]", "[\\b]", "[0-9_]", "[^\\W_]", "[ \\u00a0]", "[^\\d\\s]",
  "[\\u2028\\n]", "[^.]", "[a^]", "[[a]", "[{}]", "[\\D]", "[^\\D1]",
];
const ASSERTS = ["^", "$", "\\b", "\\B"];
const QUANTS = ["?", "*", "+", "{2}", "{1,}", "{0,2}", "{1,3}", "{0}", "{2,2}", "{0,1}", "{3,}", "{1}", "{0,}", "{2,5}"];
const genPattern = (r: () => number): string => {
  const pick = (xs: string[]): string => xs[Math.floor(r() * xs.length)];
  const alt = (depth: number): string => {
    const n = r() < 0.3 ? 2 + Math.floor(r() * 2) : 1, parts: string[] = [];
    for (let k = 0; k < n; k++) parts.push(r() < 0.08 ? "" : seq(depth));
    return parts.join("|");
  };
  const seq = (depth: number): string => {
    let s = "";
    for (let k = 1 + Math.floor(r() * 4); k > 0; k--) {
      const x = r();
      if (x < 0.1) {
        s += pick(ASSERTS);
        continue;
      }
      if (x < 0.5) s += pick(LITERALS);
      else if (x < 0.75 || depth === 0) s += pick(CLASSES);
      else s += (r() < 0.6 ? "(" : "(?:") + alt(depth - 1) + ")";
      if (r() < 0.4) s += pick(QUANTS) + (r() < 0.3 ? "?" : "");
    }
    return s;
  };
  return alt(3);
};
const genText = (r: () => number): string => {
  let s = "";
  for (let k = Math.floor(r() * 41); k > 0; k--) s += TEXT_CHARS[Math.floor(r() * TEXT_CHARS.length)];
  return s;
};

test("differential fuzz: same matches, groups, test() and capture count as native RegExp", () => {
  const SEED = 20261112, r = mulberry(SEED), FUZZ_STEPS = 400_000;
  let pairs = 0, tooSlow = 0, invalid = 0, patterns = 0, matches = 0;
  while (pairs < 36_000) {
    const src = genPattern(r);
    let nat: RegExp;
    try {
      nat = new RegExp(src, "gi");
    } catch {
      // the generator can glue pieces into something native rejects: the matcher must refuse it too
      assert.notEqual(regexSyntaxProblem(src), null, `seed ${SEED}: native rejects ${JSON.stringify(src)}, the matcher accepts it`);
      invalid++;
      continue;
    }
    if (src.length > 300 || /\\0\d/.test(src)) continue; // \0 glued to a digit is an octal escape: refused on purpose
    assert.equal(regexSyntaxProblem(src), null, `seed ${SEED}: refused a supported pattern ${JSON.stringify(src)}`);
    const re = safeRegex(src);
    patterns++;
    assert.equal(re.captures, new RegExp(src + "|").exec("")!.length - 1, `seed ${SEED}: capture count of ${JSON.stringify(src)}`);
    for (let k = 0; k < 6; k++) {
      const text = genText(r), where = `seed ${SEED} pair ${pairs}: pattern ${JSON.stringify(src)} text ${JSON.stringify(text)}`;
      let mine: SafeMatch[];
      try {
        mine = re.matchAll(text, newBudget(FUZZ_STEPS));
      } catch (e) {
        // nested quantifiers can explode even on 40 characters: skip the pair so native is not asked either
        assert.ok(e instanceof RegexBudgetError, `${where}: threw ${e}`);
        tooSlow++;
        continue;
      }
      assert.deepEqual(mine, native(src, text), where);
      nat.lastIndex = 0;
      assert.equal(re.test(text, newBudget(FUZZ_STEPS)), nat.test(text), where);
      matches += mine.length;
      pairs++;
    }
  }
  console.log(`fuzz seed ${SEED}: ${pairs} pairs, ${patterns} patterns, ${matches} matches, ${tooSlow} pairs skipped as too slow, ${invalid} invalid patterns`);
  assert.ok(pairs >= 30_000);
  assert.ok(tooSlow < pairs / 50, `too many pairs skipped: ${tooSlow}`);
  assert.ok(matches > pairs, "the generator must produce matches");
});

test("known backtracking cases equal native", () => {
  const cases: [string, string][] = [
    ["(z)((a+)?(b+)?(c))*", "zaacbbbcac"], ["(a*)*", "b"], ["(a*)+", "b"], ["(a|ab)(c|bcd)(d*)", "abcd"], ["(?:(a)|b)*", "ab"],
    ["(a*)?", "b"], ["(?:a?)*?b", "aab"], ["()|a", "aa"], ["a*?", "aaa"], ["(a+?)(a*)", "aaaa"], ["\\b", "ab cd"], ["^|$|x", "axb"],
    ["(?:)*", "ab"], ["(a{0})b", "ab"], ["((a)|(b)){2,3}?", "abab"], ["x{", "x{"], ["x{,2}", "xx{,2}"], ["a{2}{", "aa{"],
    ["k", "KK k"], ["\\w+", "ſs KK é"], ["[^\\W]+", "ſKab"], ["é+", "éÉÉ"], ["ß", "ß SS ẞ"],
    ["\\s+", "  \t\n  ﻿　x"], [".+", "a\nb\rc d e"], ["[^]+", "a\nb"], ["$", "a\nb"], ["^b", "a\nb"],
    ["a{1000}", "a".repeat(2500)], ["(?:ab){400,1000}?(b)?", "ab".repeat(450) + "b"], ["(a|b|)*c", "abc"], ["(?:a|b)*?c", "ababc"], ["(a)|(b)|(c)", "cab"], ["(?:(a)(b)?)+", "aba"], ["(a?){3}a{3}", "aaaa"],
  ];
  for (const [src, text] of cases) sameAsNative(src, text);
});

// ---- 2. every pattern in the funder configs ----
const CFG_DIR = new URL("../../../grants/collect/cfg/", import.meta.url);
const cfgPatterns = (): string[] => {
  const out = new Set<string>();
  const walk = (v: unknown, key: string): void => {
    if (typeof v === "string") {
      if (["match", "skip", "closed", "deadline_regex"].includes(key)) out.add(v);
      else if (v.startsWith("re:")) out.add(v.slice(3));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const f of readdirSync(CFG_DIR).filter((f) => f.endsWith(".json"))) walk(JSON.parse(readFileSync(new URL(f, CFG_DIR), "utf8")), "");
  return [...out];
};
const FIXTURES = new URL("./fixtures/", import.meta.url);
const HTML = readdirSync(FIXTURES).filter((f) => f.endsWith(".html")).map((f) => readFileSync(new URL(f, FIXTURES), "utf8"));
const PROSE = HTML.join("\n").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
const LINES = [
  "Status: CLOSED. Not closedown. Request for Proposals Active now. See /workwithus/solicitation?id=42. Climate solutions fund.",
  "Round 1: March 1, 2027 and Round 2: June 15, 2027. Full proposal deadline: April 7, 2027.",
  "Cierre  15 noviembre 2026. Cierre miércoles 13 NOVIEMBRE 2026. CIERRE\n1 Marzo 2027",
  "Applications are due by: January 5, 2027. The deadline is March 9 2027. Proposals will be accepted from May 1 – July 31, 2027. are accepted from now until August 2, 2027",
  "Executive Summaries (using BIRD’s template) Jan. 12, 2027 Read More Full Proposals\n(following BIRD's detailed instructions)  March  3,  2027 Read More",
  "CSCI call; RISA, NIDIS and NIHHIS; semi-arid lands; crop and crops; seafood food-systems; SCALEUP Ready; NOI due; rfi",
  "NOI: notice of intent\nRFI response",
  "x".repeat(499) + "15 December 2027 " + "y".repeat(483) + "Deadline:15/12/2027",
].join("\n");

test("every config pattern is accepted and equals native on the fixtures and on hand-written lines", () => {
  const pats = cfgPatterns();
  assert.ok(pats.length >= 10, `found only ${pats.length} config patterns`);
  assert.ok(HTML.length >= 1 && PROSE.length > 1000);
  let hits = 0;
  for (const src of pats) {
    assert.equal(regexSyntaxProblem(src), null, src);
    for (const text of [...HTML, PROSE, LINES]) {
      sameAsNative(src, text, "config");
      hits += safeRegex(src).matchAll(text).length;
    }
  }
  assert.ok(hits > 20, `config patterns matched only ${hits} times`);
});

test("config patterns stay cheap on 600,000 characters: under 20% of the budget, about one step per position", () => {
  const big = PROSE.repeat(Math.ceil(600_000 / PROSE.length)).slice(0, 600_000);
  let worst = 0, worstSrc = "";
  for (const src of cfgPatterns()) {
    const b = newBudget(), t0 = performance.now();
    safeRegex(src).matchAll(big, b);
    const used = SOURCE_STEPS - b.left, ms = performance.now() - t0;
    if (used > worst) [worst, worstSrc] = [used, src];
    assert.ok(used < SOURCE_STEPS * 0.2, `${src} used ${used} steps of ${SOURCE_STEPS}`);
    assert.ok(ms < 100, `${src} took ${ms.toFixed(1)} ms`);
  }
  console.log(`config patterns on 600k: worst ${worst} steps (${(100 * worst / SOURCE_STEPS).toFixed(1)}% of the budget): ${worstSrc.slice(0, 50)}`);
  for (const src of ["Climate Solutions", "[0-9]{4}-[0-9]{2}","\\d{1,2} december \\d{4}"]) {
    const b = newBudget(), t0 = performance.now();
    safeRegex(src).matchAll(big, b);
    const ms = performance.now() - t0;
    assert.ok(SOURCE_STEPS - b.left < 2 * big.length, `${src}: ${SOURCE_STEPS - b.left} steps for ${big.length} positions`);
    assert.ok(ms < 40, `${src} took ${ms.toFixed(1)} ms`);
  }
});

// ---- 3. the inputs that broke the earlier designs (text is never cut or collapsed) ----
test("dates survive long lines and exact whitespace: the text is matched as it is", () => {
  const group1 = (src: string, text: string): (string | undefined)[] => {
    sameAsNative(src, text);
    return safeRegex(src).matchAll(text).map((m) => m.groups[1]);
  };
  // a date right after 499 other characters on one line
  assert.deepEqual(group1("(\\d{1,2} december \\d{4})", "x".repeat(499) + "15 December 2027"), ["15 December 2027"]);
  assert.deepEqual(group1("deadline:?\\s*(\\d{1,2}/\\d{1,2}/\\d{2,4})", "x".repeat(483) + "Deadline:15/12/2027"), ["15/12/2027"]);
  // two "Round N Deadline" dates in one paragraph longer than 500 characters: the first must not vanish
  const para = "lorem ".repeat(80).slice(0, 490) + " Round 1 Deadline: 1 March 2027. Late applications. Round 2 Deadline: 15 June 2027.";
  assert.ok(para.length > 500 && !para.includes("\n"));
  for (const src of ["deadline\\s*:?\\s*(\\d{1,2} \\w+ \\d{4})", "deadline.{0,50}?(\\d{1,2} \\w+ \\d{4})", "deadline[^\\d]{0,40}(\\d{1,2} \\w+ \\d{4})"]) {
    assert.deepEqual(group1(src, para), ["1 March 2027", "15 June 2027"], src);
  }
  // whitespace-exact patterns
  assert.deepEqual(group1("deadline\\s{2,}(\\d{4})", "Deadline 2026 deadline  2027 deadline   2028"), ["2027", "2028"]);
  assert.deepEqual(group1("deadline\\t(\\d{4})", "Deadline 2026 deadline\t2027"), ["2027"]);
  assert.deepEqual(group1("\\n\\n\\n(\\d{4})", "a\n\n2026 b\n\n\n2027"), ["2027"]);
  assert.deepEqual(group1("deadline: (\\d{4})", "Deadline: 2026 deadline: 2027"), ["2027"]); // a literal space is not a non-breaking space
});

// ---- 4. attack table ----
const ATTACK_TEXTS: [string, string][] = [
  ["'deadline 1 ' x18000 (198k)", "deadline 1 ".repeat(18000)],
  ["'deadline ' x22000 (198k)", "deadline ".repeat(22000)],
  ["'a' x200k", "a".repeat(200_000)],
  ["400 lines of 'deadline' + 450 'a'", ("deadline" + "a".repeat(450) + "\n").repeat(436)],
  ["400 lines of 499 'a'", ("a".repeat(499) + "\n").repeat(400)],
  ["400 lines of 499 digits", ("1".repeat(499) + "\n").repeat(400)],
  ["'1.' x100k", "1.".repeat(100_000)],
  ["spaces x200k", " ".repeat(200_000)],
  ["words, one line of 600k", "lorem ipsum dolor sit amet ".repeat(22223)],
  ["'a', one line of 600k", "a".repeat(600_000)],
  ["'ab', one line of 600k", "ab".repeat(300_000)],
];
const ATTACKS = [
  // attack:long-input and engine:harden
  "deadline.*?(\\d{1,2}).*?(\\w+).*?(\\d{4})", "deadline.{0,300}.{0,300}(\\d{4})", ".{0,300}.{0,300}.{0,300}x(\\d)",
  ".{0,100}.{0,100}.{0,100}x(\\d)", "deadline[^\\n]{0,300}[^\\n]{0,300}[^\\n]{0,300}(\\d{4})", "[a-z]+(?:-)?[a-z]+(\\d)",
  "\\w+(?:\\.)?\\w+ (\\d)", "(\\d+\\.?\\d+)/(\\d{4})", "(\\d+(?:st|nd|rd|th)?\\d+)z", "[a-z]+(?:\\s)?[a-z]+(\\d)",
  "(\\d{1,300}\\d{1,300})x", "[a-z0-9]+(?:\\.)?[a-z0-9]+(?:\\.)?[a-z0-9]+@(\\d)", "a?".repeat(25) + "a".repeat(25) + "(x)",
  ".*?Deadline.*?(\\d{4})",
  // re2js probe
  "(a?){25}a{25}", "(a+)+$", "(\\s*\\S+\\s*)+x", "(\\s*)*(\\d{4})", "[a-záéíóú]+\\s+(\\d{4})",
  "Cierre\\s+(?:[a-záéíóú]+\\s+)?(\\d{1,2}\\s+[a-záéíóú]+\\s+\\d{4})", "(x+x+)+y", "(?:.{0,300}){1,10}z",
  // deep group loops: these would overflow a recursive matcher
  "(?:.|\\n)*?x", "(?:a|b)*c", "((a)|(b))*c", "(a|b|)*c", "(()|a)+c", "(?:(?:a*)*)*c", "(a*)*(b*)*(c*)*d", "\\S+@\\S+", "(?:\\w+\\s?)+$",
];

test("attack table: every call ends within 500 ms with the native result or RegexBudgetError", () => {
  let worst = 0, worstCase = "", slow = 0, compared = 0;
  for (const src of ATTACKS) {
    const re = safeRegex(src);
    for (const [name, text] of ATTACK_TEXTS) {
      const label = `${src.slice(0, 50)} on ${name}`, t0 = performance.now();
      let mine: SafeMatch[] | null = null;
      try {
        mine = re.matchAll(text);
      } catch (e) {
        assert.ok(e instanceof RegexBudgetError, `${label}: threw ${e}`);
        assert.equal((e as Error).message, "pattern too slow on this text: " + src.slice(0, 60));
        slow++;
      }
      const ms = performance.now() - t0;
      if (ms > worst) [worst, worstCase] = [ms, label];
      assert.ok(ms < 500, `${label}: ${ms.toFixed(0)} ms`);
      // where the matcher finished inside its budget, native finishes fast too: the results must be equal
      if (mine) {
        assert.deepEqual(mine, native(src, text), label);
        compared++;
      }
    }
  }
  console.log(`attack table: ${ATTACKS.length * ATTACK_TEXTS.length} calls, ${slow} RegexBudgetError, ${compared} equal to native, worst ${worst.toFixed(1)} ms (${worstCase})`);
  assert.ok(slow > 50 && compared > 50);
});

test("spending a whole budget takes at most 150 ms", () => {
  // time one heavy call (best of 3) and scale it to the whole budget when the call ended before spending it
  const spend = (src: string, text: string): number => {
    const re = safeRegex(src);
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const b = newBudget(), t0 = performance.now();
      try {
        re.matchAll(text, b);
      } catch (e) {
        assert.ok(e instanceof RegexBudgetError, String(e));
      }
      const ms = performance.now() - t0, used = SOURCE_STEPS - b.left;
      assert.ok(used > SOURCE_STEPS / 4, `${src} used only ${used} steps`);
      best = Math.min(best, ms * SOURCE_STEPS / used);
    }
    return best;
  };
  const lines = ("a".repeat(499) + "\n").repeat(1200);
  const times: [string, number][] = [
    ["lazy dots", spend("deadline.*?(\\d{1,2}).*?(\\w+).*?(\\d{4})", "deadline 1 ".repeat(54545))],
    ["greedy classes", spend("[a-z]+(?:-)?[a-z]+(\\d)", lines)],
    ["alternation loop", spend("(?:a|b)*c", ("ab".repeat(250) + "\n").repeat(1200))],
    ["counted loop", spend("(a?){25}a{25}(x)", "a".repeat(600_000))],
    ["accented words", spend("[a-záéíóú]+\\s+(\\d{4})", "lorem ipsum dolor sit amet ".repeat(22223))],
    ["hebrew text", spend("(?:\\u05d0|\\u05d1|z)*?q", "אבג דה ".repeat(100_000))],
  ];
  const worst = times.reduce((a, b) => (b[1] > a[1] ? b : a));
  console.log(`budget ${SOURCE_STEPS} steps: slowest to spend is ${worst[0]} at ${worst[1].toFixed(1)} ms = ${(SOURCE_STEPS / worst[1] / 1000).toFixed(0)}M steps/s`);
  assert.ok(worst[1] <= 150, `${worst[0]} took ${worst[1].toFixed(1)} ms`);
});

// ---- 5. refusals ----
test("refused constructs give a reason an author can act on; supported patterns are not refused", () => {
  const refused: [string, RegExp][] = [
    ["(?=x)y", /lookahead/], ["a(?!x)", /lookahead/], ["(?<=x)y", /lookbehind/], ["(?<!a)b", /lookbehind/], ["(?<n>a)", /named groups/],
    ["(a)\\1", /backreferences/], ["\\k<n>", /named backreferences/], ["\\p{L}+", /unicode property/], ["[\\P{L}]", /unicode property/],
    ["\\cA", /control-letter/], ["[\\cA]", /control-letter/], ["a".repeat(301), /longer than 300/], ["a{1001}", /above 1000/],
    ["a{2,1001}", /above 1000/], ["(?:ab){1001,}", /above 1000/], ["[", /not a valid regular expression/], ["(?:a|b", /not a valid regular expression/],
    ["a**", /not a valid regular expression/], ["a{2,1}", /not a valid regular expression/], ["a)", /not a valid regular expression/],
    ["\\", /not a valid regular expression/], ["\\q", /escape \\q is not supported/], ["\\x4", /hex digits/], ["\\u12", /hex digits/],
    ["\\u{61}", /hex digits/], ["\\01", /octal/], ["(?i:a)", /not supported|not a valid/], ["[\\B]", /not supported/],
  ];
  for (const [src, why] of refused) {
    const reason = regexSyntaxProblem(src);
    assert.match(String(reason), why, src);
    assert.ok(reason !== null && reason.length < 160 && !reason.includes("\n"), src);
    assert.throws(() => safeRegex(src), (e: unknown) => e instanceof Error && !(e instanceof RegexBudgetError) && e.message === reason, src);
  }
  const ok = [
    "", "abc", "a|b|", "(a)(?:b)((c))", "a?b*c+d{2}e{2,}f{2,3}", "a??b*?c+?d{2}?e{2,}?f{2,3}?", "^a$", "\\bfoo\\B", "\\d\\D\\w\\W\\s\\S",
    "\\n\\t\\r\\f\\v\\0", "\\x41\\u00e9", "\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\^\\$\\\\\\/\\-", ".", "[a-z0-9_.-]", "[^\\s\\d]", "[\\b\\]\\\\]",
    "a{", "a{,5}", "x{1000}", "(?:a{1000}){1000}", "a".repeat(300), "(?:due|deadline)\\s*:?\\s*([A-Z][a-z]+ \\d{1,2},? 20\\d\\d)",
  ];
  for (const src of ok) {
    assert.equal(regexSyntaxProblem(src), null, src);
    assert.equal(safeRegex(src).source, src);
  }
  assert.equal(safeRegex("(a)(?:b)((c))").captures, 3);
});

// ---- 6. budget sharing ----
test("a shared budget is spent across calls; a fresh budget works again; matchAll never cuts silently", () => {
  const re = safeRegex("q"), text = "a".repeat(300), shared = newBudget(1000);
  let calls = 0;
  assert.throws(() => {
    for (;;) {
      const before = shared.left;
      assert.equal(re.test(text, shared), false);
      assert.ok(shared.left < before, "every call must charge the shared budget");
      calls++;
    }
  }, (e: unknown) => e instanceof RegexBudgetError && e.message === "pattern too slow on this text: q");
  assert.ok(calls >= 2 && calls <= 4, `calls before the budget ran out: ${calls}`);
  assert.equal(shared.left, 0);
  assert.throws(() => safeRegex("a").test("a", shared), RegexBudgetError); // spent for every pattern of the source
  assert.equal(re.test(text, newBudget(1000)), false);
  assert.equal(re.test(text), false);
  assert.equal(newBudget().left, SOURCE_STEPS);
  // beyond 1000 matches it still equals native (it used to stop silently at 1000); a huge count is a visible error
  sameAsNative("a", "a ".repeat(2000), "2000 matches");
  sameAsNative("x*", "ab".repeat(1000), "1501+ empty matches");
  assert.throws(() => safeRegex("a").matchAll("a".repeat(60000)), (e: unknown) => e instanceof RegexBudgetError && /more than 50000 times/.test((e as Error).message));
  const long = safeRegex("x".repeat(80) + "+$");
  assert.throws(() => long.test("x".repeat(100), newBudget(50)), (e: unknown) => e instanceof RegexBudgetError && e.message.endsWith(": " + "x".repeat(60)));
});

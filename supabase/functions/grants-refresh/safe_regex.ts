// Step-budgeted backtracking matcher for the patterns funder configs carry (list.match, list.skip,
// list.closed, deadline_regex, "re:" filter terms). Those patterns run on page text the funder controls,
// so the cost of one call must be bounded by construction: every unit of work charges a step budget and
// the call throws RegexBudgetError when the budget is spent. The text is never altered.
// Results equal text.matchAll(new RegExp(src, "gi")) for the supported dialect (no u flag: code units).
// Design: the pattern compiles to a small instruction list run by one loop with an explicit backtrack
// stack (no recursion, so no RangeError and no depth limit other than the budget and STACK_MAX).
// Not supported on purpose: lookaround, named groups, backreferences, \p{..}, \cX, octal escapes.

export class RegexBudgetError extends Error {
  name = "RegexBudgetError";
}
export type RegexBudget = { left: number };
// Budget of one source, in steps. One step is the cheapest unit of work (one text position scanned);
// an instruction or a backtrack costs OP steps. Set by measurement on 2026-11-12 (Node 22, this machine)
// so that spending it all stays under 150 ms: 20 to 30 ms warm (2 to 3 ns per step), about 50 ms on a first
// call in a fresh process, and up to 14 ns per step when a call lands right after a JIT deoptimization
// (166 ms was seen at 12M steps, hence 10M). The costliest config pattern uses 16% of it on 600,000
// characters (1.64M steps); a pattern that starts with a literal uses 6 to 7%.
export const SOURCE_STEPS = 10_000_000;
export const newBudget = (steps = SOURCE_STEPS): RegexBudget => ({ left: steps });
export type SafeMatch = { index: number; end: number; groups: (string | undefined)[] };
export type SafeRegex = {
  source: string;
  captures: number;
  test(text: string, budget?: RegexBudget): boolean;
  matchAll(text: string, budget?: RegexBudget): SafeMatch[];
};

const MAX_SOURCE = 300, MAX_COUNT = 1000, MAX_MATCHES = 50000; // more matches than this is an error, never a silent cut: native would return them all
const OP = 2; // steps per instruction, per backtrack and per match attempt (each costs about 2 scanned positions)
const FILL = 4096; // steps for classifying 256 code units with one native RegExp
const STACK_MAX = 1 << 20; // backtrack stack cap in ints (4 per frame): 4 MB, 262,144 frames, kept between calls

// ---- single-character sets: decided by native RegExp, so case folding agrees with native everywhere ----
type CharSet = { lo: Uint8Array; pages: (Uint8Array | undefined)[]; res: RegExp[] };
const SETS = new Map<string, CharSet>();
const fillPage = (s: CharSet, hi: number): Uint8Array => {
  const pg = new Uint8Array(256);
  for (let k = 0; k < 256; k++) {
    const ch = String.fromCharCode((hi << 8) | k);
    if (s.res.some((re) => re.test(ch))) pg[k] = 1;
  }
  return (s.pages[hi] = pg);
};
const makeSet = (res: RegExp[]): CharSet => {
  const s: CharSet = { lo: new Uint8Array(0), pages: new Array<Uint8Array | undefined>(256).fill(undefined), res };
  s.lo = fillPage(s, 0);
  return s;
};
const charSet = (atom: string): CharSet => {
  let s = SETS.get(atom);
  if (!s) {
    if (SETS.size >= 4096) SETS.clear();
    SETS.set(atom, (s = makeSet([new RegExp(atom, "i")])));
  }
  return s;
};
const WORD = new Uint8Array(128);
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_") WORD[ch.charCodeAt(0)] = 1;

// ---- instructions (C_*) and backtrack frames (F_*) ----
const C_CHAR = 0, C_BOL = 1, C_EOL = 2, C_WB = 3, C_NWB = 4, C_SPLIT = 5, C_JMP = 6, C_SAVE = 7, C_STAR = 8,
  C_LAZY = 9, C_INIT = 10, C_CHECK = 11, C_ENTER = 12, C_END = 13, C_MATCH = 14;
const F_ALT = 0, F_CAP = 1, F_CNT = 2, F_START = 3, F_GREEDY = 4, F_LAZY = 5;

type Node =
  | { t: "char"; set: number }
  | { t: "assert"; op: number }
  | { t: "seq"; items: Node[] }
  | { t: "alt"; alts: Node[] }
  | { t: "cap"; cap: number; body: Node }
  | { t: "rep"; body: Node; min: number; max: number; greedy: boolean; capLo: number; capHi: number };

// Parses the supported dialect; throws Error(reason) for a refused construct. The caller has already
// checked that native RegExp accepts the source.
function parse(src: string): { root: Node; sets: CharSet[]; captures: number } {
  const sets: CharSet[] = [], ids = new Map<string, number>(), len = src.length;
  let i = 0, ncap = 0;
  const no = (why: string): never => {
    throw new Error(why);
  };
  const atomSet = (atom: string): Node => {
    let k = ids.get(atom);
    if (k === undefined) {
      k = sets.length;
      ids.set(atom, k);
      sets.push(charSet(atom));
    }
    return { t: "char", set: k };
  };
  const lit = (c: number): Node => atomSet("\\u" + c.toString(16).padStart(4, "0"));
  const BRACE = /\{(\d+)(?:(,)(\d*))?\}/y; // a brace that does not fit this is a literal
  const braceAt = (): RegExpExecArray | null => {
    BRACE.lastIndex = i;
    return BRACE.exec(src);
  };
  // Checks the escape whose letter sits at i (after the backslash) and moves past it.
  const escape = (inClass: boolean): void => {
    const c = src[i] ?? "";
    if (c === "") no("the pattern ends with a backslash");
    else if ("dDwWsSntrfv".includes(c) || (c === "b" && inClass)) i++;
    else if (c === "0") {
      if (/\d/.test(src[i + 1] ?? "")) no("octal escapes are not supported; write \\xHH");
      i++;
    } else if (/[1-9]/.test(c)) no("backreferences (\\1) are not supported");
    else if (c === "x" || c === "u") {
      const k = c === "x" ? 2 : 4, hex = src.slice(i + 1, i + 1 + k);
      if (hex.length !== k || !/^[0-9a-fA-F]+$/.test(hex)) no(`\\${c} needs exactly ${k} hex digits`);
      i += k + 1;
    } else if (c === "k") no("named backreferences (\\k<name>) are not supported");
    else if (c === "p" || c === "P") no("unicode property escapes (\\p{...}) are not supported; list the letters in a class such as [a-záéíóúñ]");
    else if (c === "c") no("control-letter escapes (\\cX) are not supported; write \\xHH");
    else if (/[A-Za-z]/.test(c) || c > "\x7f") no(`the escape \\${c} is not supported`);
    else i++;
  };
  const atom = (): Node => {
    const c = src[i];
    if (c === "^" || c === "$") {
      i++;
      return { t: "assert", op: c === "^" ? C_BOL : C_EOL };
    }
    if (c === ".") {
      i++;
      return atomSet(".");
    }
    if (c === "(") {
      i++;
      let cap = 0;
      if (src[i] === "?") {
        const d = src[i + 1] ?? "", e = src[i + 2];
        if (d === ":") i += 2;
        else if (d === "=" || d === "!") no("lookahead (?=...) or (?!...) is not supported");
        else if (d === "<" && (e === "=" || e === "!")) no("lookbehind (?<=...) or (?<!...) is not supported");
        else if (d === "<") no("named groups (?<name>...) are not supported; use a plain (...) group");
        else no(`the group syntax (?${d} is not supported`);
      } else cap = ++ncap;
      const body = alternation();
      if (src[i] !== ")") no("a ( has no matching )");
      i++;
      // (?:^)* is legal, ^* is not: keep a bare assertion apart from a group that holds one
      return cap ? { t: "cap", cap, body } : body.t === "assert" ? { t: "seq", items: [body] } : body;
    }
    if (c === "[") {
      const at = i++;
      if (src[i] === "^") i++;
      while (i < len && src[i] !== "]") {
        if (src[i] === "\\") {
          i++;
          escape(true);
        } else i++;
      }
      if (i >= len) no("a [ has no matching ]");
      return atomSet(src.slice(at, ++i));
    }
    if (c === "\\") {
      const at = i++, e = src[i] ?? "";
      if (e === "b" || e === "B") {
        i++;
        return { t: "assert", op: e === "b" ? C_WB : C_NWB };
      }
      escape(false);
      return /[a-zA-Z0-9]/.test(e) ? atomSet(src.slice(at, i)) : lit(e.charCodeAt(0));
    }
    if (c === "*" || c === "+" || c === "?" || (c === "{" && braceAt())) no("a quantifier has nothing to repeat");
    i++;
    return lit(c.charCodeAt(0));
  };
  const seq = (): Node => {
    const items: Node[] = [];
    while (i < len && src[i] !== "|" && src[i] !== ")") {
      const capLo = ncap + 1, a = atom(), c = src[i], m = c === "{" ? braceAt() : null;
      let min = 1, max = 1;
      if (c === "*" || c === "+" || c === "?") {
        if (c !== "+") min = 0;
        if (c !== "?") max = -1; // -1: no upper bound
        i++;
      } else if (m) {
        min = Number(m[1]);
        max = m[2] ? (m[3] ? Number(m[3]) : -1) : min;
        i += m[0].length;
      } else {
        items.push(a);
        continue;
      }
      if (a.t === "assert") no("a quantifier has nothing to repeat");
      if (min > MAX_COUNT || max > MAX_COUNT) no(`a counted repeat above ${MAX_COUNT} is not supported`);
      let greedy = true;
      if (src[i] === "?") {
        greedy = false;
        i++;
      }
      items.push({ t: "rep", body: a, min, max, greedy, capLo, capHi: ncap });
    }
    return items.length === 1 ? items[0] : { t: "seq", items };
  };
  const alternation = (): Node => {
    const alts = [seq()];
    while (src[i] === "|") {
      i++;
      alts.push(seq());
    }
    return alts.length === 1 ? alts[0] : { t: "alt", alts };
  };
  const root = alternation();
  if (i < len) no("a ) has no matching (");
  return { root, sets, captures: ncap };
}

// Adds to acc the sets one of which the first consumed character must be in; returns whether the node
// can match without consuming. With bolDead, ^ counts as a dead end (true for every start after 0).
const firstOf = (n: Node, acc: Set<number>, bolDead: boolean): boolean => {
  switch (n.t) {
    case "char":
      acc.add(n.set);
      return false;
    case "assert":
      return !(bolDead && n.op === C_BOL);
    case "seq":
      return n.items.every((x) => firstOf(x, acc, bolDead));
    case "alt":
      return n.alts.map((x) => firstOf(x, acc, bolDead)).some(Boolean);
    case "cap":
      return firstOf(n.body, acc, bolDead);
    case "rep":
      return n.max === 0 || firstOf(n.body, acc, bolDead) || n.min === 0;
  }
};

type Prog = {
  code: Int32Array; sets: CharSet[]; lo: Uint8Array; caps: Int32Array; cnt: Int32Array; start: Int32Array;
  first: CharSet | null; margin: number; captures: number;
};

function compile(src: string): Prog {
  const { root, sets, captures } = parse(src), code: number[] = [];
  let nreg = 0;
  // index of a set equal to the union of the given sets (adds one when there are several)
  const union = (ids: number[]): number => ids.length === 1 ? ids[0] : sets.push(makeSet(ids.flatMap((k) => sets[k].res))) - 1;
  const emit = (n: Node): void => {
    if (n.t === "char") code.push(C_CHAR, n.set);
    else if (n.t === "assert") code.push(n.op);
    else if (n.t === "seq") n.items.forEach(emit);
    else if (n.t === "cap") {
      code.push(C_SAVE, 2 * n.cap);
      emit(n.body);
      code.push(C_SAVE, 2 * n.cap + 1);
    } else if (n.t === "alt") {
      const jumps: number[] = [];
      n.alts.forEach((a, k) => {
        if (k === n.alts.length - 1) return emit(a);
        // an alternative that must consume a character is skipped when the next character cannot start it
        const acc = new Set<number>(), peek = firstOf(a, acc, false) ? -1 : union([...acc]);
        const at = code.push(C_SPLIT, 0, peek) - 2;
        emit(a);
        jumps.push(code.push(C_JMP, 0) - 1);
        code[at] = code.length;
      });
      for (const j of jumps) code[j] = code.length;
    } else if (n.max === 0) return;
    else if (n.body.t === "char") {
      // a{2,5}? is two exact chars, then up to three lazy ones
      if (n.greedy) code.push(C_STAR, n.body.set, n.min, n.max);
      else {
        if (n.min > 0) code.push(C_STAR, n.body.set, n.min, n.min);
        if (n.max !== n.min) code.push(C_LAZY, n.body.set, n.max < 0 ? -1 : n.max - n.min);
      }
    } else if (n.min === 1 && n.max === 1) emit(n.body);
    else {
      // General loop, after RepeatMatcher in ECMA-262: a counter, a capture reset at each iteration,
      // and the rule that an iteration past the minimum may not match the empty string.
      const r = nreg++, nul = firstOf(n.body, new Set(), false);
      code.push(C_INIT, r);
      const check = code.push(C_CHECK, r, n.min, n.max, n.greedy ? 1 : 0, 0) - 6;
      if (nul || n.capHi >= n.capLo) code.push(C_ENTER, r, n.capLo, n.capHi, nul ? 1 : 0);
      emit(n.body);
      code.push(C_END, r, n.min, n.max, nul ? 1 : 0, check);
      code[check + 5] = code.length;
    }
  };
  emit(root);
  code.push(C_MATCH);
  const acc = new Set<number>();
  const first = firstOf(root, acc, true) ? null : acc.size === 0 ? makeSet([]) : sets[union([...acc])];
  const lo = new Uint8Array(256 * sets.length);
  sets.forEach((st, k) => lo.set(st.lo, 256 * k)); // one flat table: lo[set << 8 | code unit]
  return {
    lo, first,
    code: Int32Array.from(code), sets, captures,
    caps: new Int32Array(2 * captures + 2), cnt: new Int32Array(nreg), start: new Int32Array(nreg),
    margin: 4 * (2 * captures + 4),
  };
}

let STACK = new Int32Array(1 << 12);

// Finds the leftmost match starting at or after `from`. Returns 1 (p.caps filled), 0 (none) or -1 (budget).
function run(p: Prog, text: string, from: number, budget: RegexBudget): number {
  const n = text.length, code = p.code, sets = p.sets, tab = p.lo, caps = p.caps, cnt = p.cnt, start = p.start, first = p.first;
  let left = budget.left > 0 ? budget.left : 0, stack = STACK, high = stack.length - p.margin, res = 0;
  caps.fill(-1);
  outer: for (let s = from; s <= n; s++) {
    if ((left -= OP) < 0) {
      res = -1;
      break;
    }
    if (first !== null && s > 0) {
      // Prefilter: skip to the next position whose character can start a match (one step each).
      if (first.res.length === 0) break; // every path starts with ^
      const lo = first.lo, lim = n - s > left ? s + left : n, s0 = s;
      while (s < lim) {
        const c = text.charCodeAt(s);
        if ((c < 256 ? lo[c] : (first.pages[c >> 8] ?? (left -= FILL * first.res.length, fillPage(first, c >> 8)))[c & 255]) === 1) break;
        s++;
      }
      left -= s - s0;
      if (s === lim) {
        if (lim < n) res = -1;
        break;
      }
    }
    let pc = 0, pos = s, sp = 0, fail = false;
    for (;;) {
      if (fail) {
        for (;;) {
          if (sp === 0) continue outer;
          if ((left -= OP) < 0) {
            res = -1;
            break outer;
          }
          sp -= 4;
          const k = stack[sp];
          if (k === F_CAP) caps[stack[sp + 1]] = stack[sp + 2];
          else if (k === F_CNT) cnt[stack[sp + 1]] = stack[sp + 2];
          else if (k === F_START) start[stack[sp + 1]] = stack[sp + 2];
          else if (k === F_ALT) {
            pc = stack[sp + 1];
            pos = stack[sp + 2];
            break;
          } else if (k === F_GREEDY) {
            // give back one character; the frame stays until the minimum is reached
            pc = stack[sp + 1];
            pos = stack[sp + 2] - 1;
            if (pos > stack[sp + 3]) {
              stack[sp + 2] = pos;
              sp += 4;
            }
            break;
          } else {
            // F_LAZY: take one more character if it fits, and keep the frame
            const at = stack[sp + 1], q = stack[sp + 2];
            if (q < stack[sp + 3]) {
              const c = text.charCodeAt(q), k = code[at + 1], st = sets[k];
              if ((c < 256 ? tab[(k << 8) | c] : (st.pages[c >> 8] ?? (left -= FILL, fillPage(st, c >> 8)))[c & 255]) === 1) {
                stack[sp + 2] = pos = q + 1;
                sp += 4;
                pc = at + 3;
                break;
              }
            }
          }
        }
        fail = false;
      }
      if ((left -= OP) < 0) {
        res = -1;
        break outer;
      }
      if (sp > high) {
        if (stack.length >= STACK_MAX) {
          res = -1;
          break outer;
        }
        const g = new Int32Array(stack.length * 2);
        g.set(stack);
        stack = STACK = g;
        high = g.length - p.margin;
      }
      switch (code[pc]) {
        case C_CHAR: {
          if (pos < n) {
            const c = text.charCodeAt(pos), k = code[pc + 1], st = sets[k];
            if ((c < 256 ? tab[(k << 8) | c] : (st.pages[c >> 8] ?? (left -= FILL, fillPage(st, c >> 8)))[c & 255]) === 1) {
              pos++;
              pc += 2;
              break;
            }
          }
          fail = true;
          break;
        }
        case C_BOL:
          if (pos === 0) pc++;
          else fail = true;
          break;
        case C_EOL:
          if (pos === n) pc++;
          else fail = true;
          break;
        case C_WB:
        case C_NWB: {
          const a = pos > 0 ? text.charCodeAt(pos - 1) : 128, b = pos < n ? text.charCodeAt(pos) : 128;
          if (((a < 128 && WORD[a] === 1) !== (b < 128 && WORD[b] === 1)) === (code[pc] === C_WB)) pc++;
          else fail = true;
          break;
        }
        case C_SPLIT: {
          // operands: next alternative, set the first character of this one must be in (-1: none)
          const k = code[pc + 2], c = pos < n ? text.charCodeAt(pos) : -1;
          if (k >= 0 && (c < 0 || (c < 256 && tab[(k << 8) | c] === 0))) {
            pc = code[pc + 1]; // cannot start here: next alternative, no frame
            break;
          }
          stack[sp] = F_ALT;
          stack[sp + 1] = code[pc + 1];
          stack[sp + 2] = pos;
          sp += 4;
          pc += 3;
          break;
        }
        case C_JMP:
          pc = code[pc + 1];
          break;
        case C_SAVE: {
          const k = code[pc + 1];
          stack[sp] = F_CAP;
          stack[sp + 1] = k;
          stack[sp + 2] = caps[k];
          sp += 4;
          caps[k] = pos;
          pc += 2;
          break;
        }
        case C_STAR: {
          // Greedy run of one set: scan forward in a loop (one step per character, never past the
          // budget), then one frame gives characters back one at a time.
          const k = code[pc + 1], st = sets[k], base = k << 8, min = code[pc + 2], max = code[pc + 3];
          const lim0 = max < 0 || n - pos < max ? n : pos + max, lim = lim0 - pos > left ? pos + left : lim0;
          let q = pos;
          while (q < lim) {
            const c = text.charCodeAt(q);
            if ((c < 256 ? tab[base | c] : (st.pages[c >> 8] ?? (left -= FILL, fillPage(st, c >> 8)))[c & 255]) !== 1) break;
            q++;
          }
          left -= q - pos;
          if (q === lim && lim < lim0) {
            res = -1;
            break outer;
          }
          if (q - pos < min) {
            fail = true;
            break;
          }
          if (q > pos + min) {
            stack[sp] = F_GREEDY;
            stack[sp + 1] = pc + 4;
            stack[sp + 2] = q;
            stack[sp + 3] = pos + min;
            sp += 4;
          }
          pos = q;
          pc += 4;
          break;
        }
        case C_LAZY: {
          // Lazy run of one set: take nothing now; the frame takes one more character per backtrack.
          const max = code[pc + 2], lim = max < 0 || n - pos < max ? n : pos + max;
          if (pos < lim) {
            stack[sp] = F_LAZY;
            stack[sp + 1] = pc;
            stack[sp + 2] = pos;
            stack[sp + 3] = lim;
            sp += 4;
          }
          pc += 3;
          break;
        }
        case C_INIT: {
          const r = code[pc + 1];
          if (cnt[r] !== 0) {
            stack[sp] = F_CNT;
            stack[sp + 1] = r;
            stack[sp + 2] = cnt[r];
            sp += 4;
            cnt[r] = 0;
          }
          pc += 2;
          break;
        }
        case C_CHECK: {
          // operands: register, min, max, greedy, exit
          const c = cnt[code[pc + 1]], max = code[pc + 3];
          if (c < code[pc + 2]) pc += 6;
          else if (max >= 0 && c >= max) pc = code[pc + 5];
          else {
            stack[sp] = F_ALT;
            stack[sp + 2] = pos;
            sp += 4;
            if (code[pc + 4] === 1) {
              stack[sp - 3] = code[pc + 5];
              pc += 6;
            } else {
              stack[sp - 3] = pc + 6;
              pc = code[pc + 5];
            }
          }
          break;
        }
        case C_ENTER: {
          // operands: register, first capture, last capture, body can be empty
          const r = code[pc + 1], e = 2 * code[pc + 3] + 1;
          if (code[pc + 4] === 1 && start[r] !== pos) {
            stack[sp] = F_START;
            stack[sp + 1] = r;
            stack[sp + 2] = start[r];
            sp += 4;
            start[r] = pos;
          }
          for (let k = 2 * code[pc + 2]; k <= e; k++) {
            left--;
            if (caps[k] !== -1) {
              stack[sp] = F_CAP;
              stack[sp + 1] = k;
              stack[sp + 2] = caps[k];
              sp += 4;
              caps[k] = -1;
            }
          }
          pc += 5;
          break;
        }
        case C_END: {
          // operands: register, min, max, body can be empty, loop head
          const r = code[pc + 1], c = cnt[r], min = code[pc + 2];
          if (code[pc + 4] === 1 && c >= min && pos === start[r]) {
            fail = true; // an iteration past the minimum matched nothing: JavaScript rejects it
            break;
          }
          // with no upper bound the counter only has to tell "below the minimum" from "at or past it"
          if (code[pc + 3] >= 0 || c < min) {
            stack[sp] = F_CNT;
            stack[sp + 1] = r;
            stack[sp + 2] = c;
            sp += 4;
            cnt[r] = c + 1;
          }
          pc = code[pc + 5];
          break;
        }
        default: // C_MATCH
          caps[0] = s;
          caps[1] = pos;
          res = 1;
          break outer;
      }
    }
  }
  budget.left = left > 0 ? left : 0;
  return res;
}

function build(src: string): Prog | string {
  if (typeof src !== "string") return "the pattern must be a string";
  if (src.length > MAX_SOURCE) return `the pattern is longer than ${MAX_SOURCE} characters`;
  try {
    new RegExp(src, "gi");
  } catch (e) {
    return "not a valid regular expression: " + String((e as Error).message).split(": ").pop();
  }
  try {
    return compile(src);
  } catch (e) {
    return (e as Error).message;
  }
}

export function regexSyntaxProblem(src: string): string | null {
  const b = build(src);
  return typeof b === "string" ? b : null;
}

export function safeRegex(src: string): SafeRegex {
  const p = build(src);
  if (typeof p === "string") throw new Error(p);
  const find = (text: string, from: number, budget: RegexBudget): boolean => {
    const r = run(p, text, from, budget);
    if (r < 0) throw new RegexBudgetError("pattern too slow on this text: " + src.slice(0, 60));
    return r === 1;
  };
  return {
    source: src,
    captures: p.captures,
    test: (text, budget = newBudget()) => find(text, 0, budget),
    matchAll: (text, budget = newBudget()) => {
      const out: SafeMatch[] = [];
      for (let from = 0; from <= text.length && find(text, from, budget);) {
        if (out.length >= MAX_MATCHES) throw new RegexBudgetError(`pattern matches more than ${MAX_MATCHES} times: ` + src.slice(0, 60));
        const index = p.caps[0], end = p.caps[1], groups: (string | undefined)[] = [];
        for (let g = 0; g <= p.captures; g++) groups.push(p.caps[2 * g] < 0 ? undefined : text.slice(p.caps[2 * g], p.caps[2 * g + 1]));
        budget.left = Math.max(0, budget.left - groups.length);
        out.push({ index, end, groups });
        from = end === index ? end + 1 : end; // after an empty match the next search starts one code unit later
      }
      return out;
    },
  };
}

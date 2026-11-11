// Change detection between two snapshots of a page: sentence/line diff, new documents, deadline and amount moves.
import { type Amount, findAmount, findDeadlines } from "./extract.ts";
import type { Link } from "./types.ts";

export const MAX_DIFF_ITEMS = 40;
export const MAX_ITEM_CHARS = 300;

export interface Change {
  kind: "initial" | "deadline" | "amount" | "docs" | "content";
  summary: string;
  diff: {
    added?: string[];
    removed?: string[];
    docs_added?: { url: string; label: string }[];
    deadline?: { from: string | null; to: string | null };
    amount?: { from: number | null; to: number | null; currency: string };
  };
}

/** Lines, further split into sentences, deduplicated, empty/trivial ones dropped. */
export function units(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) {
      const t = s.trim();
      if (t.length >= 3) out.push(t);
    }
  }
  return out;
}

function onlyIn(a: string[], b: string[]): string[] {
  const have = new Set(b);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of a) {
    if (have.has(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

const cut = (xs: string[]) => xs.slice(0, MAX_DIFF_ITEMS).map((x) => x.slice(0, MAX_ITEM_CHARS));
const money = (n: number | null, cur: string) => (n === null ? "none" : `${cur} ${n.toLocaleString("en-US")}`);
const sameAmount = (a: Amount | null, b: Amount | null) => a?.value === b?.value && (a === null || a.currency === b?.currency);

export function computeChange(
  prev: { text: string; links: Link[] } | null,
  cur: { text: string; links: Link[] },
  today: string,
  withDates: boolean,
): Change {
  const to = withDates ? findDeadlines(cur.text, today).primary : null;
  const amountTo = withDates ? findAmount(cur.text) : null;
  if (!prev) {
    const diff: Change["diff"] = {};
    const parts = ["First snapshot"];
    if (to) {
      diff.deadline = { from: null, to };
      parts.push(`deadline ${to}`);
    }
    if (amountTo) {
      diff.amount = { from: null, to: amountTo.value, currency: amountTo.currency };
      parts.push(`award ${money(amountTo.value, amountTo.currency)}`);
    }
    return { kind: "initial", summary: parts.join(", "), diff };
  }
  const pu = units(prev.text), cu = units(cur.text);
  const added = onlyIn(cu, pu), removed = onlyIn(pu, cu);
  const diff: Change["diff"] = { added: cut(added), removed: cut(removed) };
  const parts: string[] = [];
  const kinds: Change["kind"][] = [];

  const from = withDates ? findDeadlines(prev.text, today).primary : null;
  if (to !== from) {
    diff.deadline = { from, to };
    kinds.push("deadline");
    parts.push(to && from ? `New deadline ${to} (was ${from})` : to ? `New deadline ${to}` : `Deadline removed (was ${from})`);
  }
  const amountFrom = withDates ? findAmount(prev.text) : null;
  if (!sameAmount(amountFrom, amountTo)) {
    const currency = (amountTo ?? amountFrom)!.currency;
    diff.amount = { from: amountFrom?.value ?? null, to: amountTo?.value ?? null, currency };
    kinds.push("amount");
    parts.push(`Award amount ${money(amountTo?.value ?? null, currency)} (was ${money(amountFrom?.value ?? null, currency)})`);
  }
  const known = new Set(prev.links.map((l) => l.url));
  const docs = cur.links.filter((l) => !known.has(l.url)).map((l) => ({ url: l.url, label: l.label }));
  if (docs.length) {
    diff.docs_added = docs;
    kinds.push("docs");
    parts.push(`${docs.length} new document${docs.length > 1 ? "s" : ""}`);
  }
  if (!parts.length) parts.push(added.length + removed.length ? `Page content changed (+${added.length}/-${removed.length} lines)` : "Content changed");
  kinds.push("content");
  return { kind: kinds[0], summary: parts.join("; "), diff };
}

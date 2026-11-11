// robots.txt parsing (RFC 9309 subset): most specific user-agent group, longest-match Allow/Disallow, Crawl-delay.

export const UA_TOKEN = "salsav-grantwatch";

interface Rule {
  allow: boolean;
  path: string;
}
export interface Robots {
  rules: Rule[];
  crawlDelayS: number | null;
}

export function parseRobots(text: string): Robots {
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/\0/g, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) groups.push(cur = { agents: [], rules: [], delay: null });
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === "allow" || k === "disallow") {
      if (v !== "") cur.rules.push({ allow: k === "allow", path: v }); // empty Disallow = allow all
    } else if (k === "crawl-delay") {
      const d = Number(v);
      if (Number.isFinite(d) && d >= 0) cur.delay = d;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && a !== "" && UA_TOKEN.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelayS: chosen.reduce<number | null>((a, g) => g.delay ?? a, null),
  };
}

// Linear glob match ('*' wildcard, trailing '$' anchor): leftmost indexOf per segment, no regex, so hostile patterns cannot backtrack.
function matchLen(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*");
  const first = parts[0];
  if (!path.startsWith(first)) return -1;
  let pos = first.length;
  if (parts.length === 1) return anchored && path.length !== pos ? -1 : body.length + 1;
  const last = parts[parts.length - 1];
  for (let i = 1; i < parts.length - 1; i++) {
    const at = path.indexOf(parts[i], pos);
    if (at < 0) return -1;
    pos = at + parts[i].length;
  }
  if (anchored) {
    if (path.length - last.length < pos || !path.endsWith(last)) return -1;
  } else if (path.indexOf(last, pos) < 0) return -1;
  return body.replace(/\*/g, "").length + 1;
}

/** Longest matching rule wins; Allow wins ties; no match = allowed. */
export function isAllowed(r: Robots, pathAndQuery: string): boolean {
  let best = -1, allow = true;
  for (const rule of r.rules) {
    const n = matchLen(rule.path, pathAndQuery);
    if (n > best || (n === best && rule.allow)) {
      best = n;
      allow = rule.allow;
    }
  }
  return allow;
}

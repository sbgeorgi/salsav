// SSRF guard: applied to the source URL and to every redirect hop.
// shortcut: no DNS resolution (a public name that resolves to a private IP is not caught), upgrade when Deno.resolveDns is acceptable.
// Residual risk (DNS rebinding / attacker-controlled DNS): a public-looking name that resolves to a private address is NOT blocked, because
// fetch() resolves the name itself and there is no hook between resolution and connect. Mitigations here: vetted funder URLs only, port 80/443 only,
// wildcard-DNS names (nip.io, 10-0-0-1.example.com style) refused, 1.5MB read cap, no response body is ever echoed to callers.

export class GuardError extends Error {}

function ipv4Blocked(a: number[]): boolean {
  const [o1, o2] = a;
  return o1 === 0 || o1 === 10 || o1 === 127 || o1 >= 224 ||
    (o1 === 100 && o2 >= 64 && o2 <= 127) || (o1 === 169 && o2 === 254) ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) ||
    (o1 === 192 && o2 === 0 && a[2] === 0) || (o1 === 198 && (o2 === 18 || o2 === 19));
}

function ipv6Blocked(h: string): boolean {
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
    return ipv4Blocked([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  }
  return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
}

const WILDCARD_DNS = /(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|vcap\.me)$/;
const QUAD = /(?<!\d)(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?!\d)/g;
/** Hostname that spells out a blocked IPv4 (10-0-0-1.foo.com, foo.169.254.169.254.example.com). */
function embeddedPrivateIp(h: string): boolean {
  for (const m of h.matchAll(QUAD)) {
    const q = m.slice(1).map(Number);
    if (q.every((n) => n <= 255) && ipv4Blocked(q)) return true;
  }
  return false;
}

/** Returns the parsed URL or throws GuardError. */
export function checkUrl(raw: string, allowLocal: boolean): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new GuardError(`invalid url: ${raw.slice(0, 100)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new GuardError(`blocked scheme ${u.protocol}`);
  if (u.username || u.password) throw new GuardError("credentials in url");
  if (allowLocal) return u;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (h.startsWith("[")) {
    if (ipv6Blocked(h.slice(1, -1))) throw new GuardError(`blocked ip ${h}`);
  } else if (v4) {
    if (ipv4Blocked(v4.slice(1).map(Number))) throw new GuardError(`blocked ip ${h}`);
  } else if (WILDCARD_DNS.test(h) || embeddedPrivateIp(h)) {
    throw new GuardError(`blocked host ${h}`);
  } else if (!h.includes(".") || /\.(local|localhost|internal|localdomain|lan|home\.arpa)$/.test(h)) {
    throw new GuardError(`blocked host ${h}`);
  }
  if (u.port && u.port !== "80" && u.port !== "443") throw new GuardError(`blocked port ${u.port}`); // default ports are dropped by URL
  return u;
}

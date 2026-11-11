// Honest-yet-realistic request headers: browser-shaped UA with our product token appended. No cookie jar.

export const PRODUCT_TOKEN = "SALSAV-GrantWatch/1.0 (+https://salsav.org)";

const CHROME_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
const GECKO_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

// shortcut: browser versions are hand-maintained and unverified against today's releases, refresh them yearly.
export const UA_POOL: { ua: string; accept: string }[] = [
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", CHROME_ACCEPT],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", CHROME_ACCEPT],
  ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", CHROME_ACCEPT],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0", CHROME_ACCEPT],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0", GECKO_ACCEPT],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0", GECKO_ACCEPT],
  ["Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0", GECKO_ACCEPT],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", GECKO_ACCEPT],
].map(([ua, accept]) => ({ ua: `${ua} ${PRODUCT_TOKEN}`, accept }));

export const ACCEPT_LANGUAGES = ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-US,en;q=0.9,es;q=0.6", "en-GB,en-US;q=0.9,en;q=0.8"];

export interface Profile {
  ua: string;
  accept: string;
  lang: string;
}

export function pickProfile(random: () => number): Profile {
  const p = UA_POOL[Math.floor(random() * UA_POOL.length)];
  return { ua: p.ua, accept: p.accept, lang: ACCEPT_LANGUAGES[Math.floor(random() * ACCEPT_LANGUAGES.length)] };
}

export function pageHeaders(p: Profile, cond?: { etag?: string | null; lastModified?: string | null }): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": p.ua, Accept: p.accept, "Accept-Language": p.lang, "Accept-Encoding": "gzip, br",
    "Upgrade-Insecure-Requests": "1",
  };
  if (cond?.etag) h["If-None-Match"] = cond.etag;
  if (cond?.lastModified) h["If-Modified-Since"] = cond.lastModified;
  return h;
}

export function apiHeaders(p: Profile): Record<string, string> {
  return { "User-Agent": p.ua, Accept: "application/json, text/plain, */*", "Accept-Language": p.lang, "Accept-Encoding": "gzip, br" };
}

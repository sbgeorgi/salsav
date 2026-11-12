"""Endpoint recon: find how the edge function can read a funder's LIVE opportunities, not just its landing page.

python supabase/grants/tools/endpoint_recon.py URL [--name "Funder"] [--no-chrome] [--out report.json]

Run this for EVERY new funder before registering it (the discovery swarm's "probe" stage), and for any funder whose
refresh returns thin text or errors. It never guesses: every proposed adapter_config is replayed with a plain HTTP client
(no cookies, same as the edge function) and only kept when it returns real items.

Stages
  A  plain fetch of the page: text length, <link rel=alternate> feeds, robots Sitemap:, embedded JSON (__NEXT_DATA__, ld+json)
  B  headless Chrome on port 9333 (the signed-in SEO profile browser, `python tools/browser.py up` in nomadswipe-growth):
     loads the page, records every XHR/fetch/JSON/XML response, rendered text length
  C  replay candidates (A+B+common CMS paths) with plain urllib; a candidate passes when it parses to a list of >=2 dicts
     with a title-like field. Emits a ready `adapter`, `feed_url`, `adapter_config` (json_api) or rss.
  A json_api/feed candidate must ALSO pass the opportunity gate (>=30% of first 10 items match grant/funding/call/... or a
  deadline field is populated); blog/news/generic lists, token/session URLs and cookie-only endpoints go to `rejected_candidates`.
  WordPress: generic posts/pages are not probed; only opportunity-ish custom post types (/wp-json/wp/v2/types) are, and
  `wp_page_text_len` reports the page's full text length from /wp-json/wp/v2/pages?slug= (evidence, never a proposal).
  EU Funding & Tenders topic-details URLs -> verdict eu_ft with a live-verified SEDIA `query` (terms on identifier).
Verdict: one of  rss | json_api | eu_ft | html_ok | needs_render | blocked | none  plus `confidence`, `why` and `evidence`.
  html_ok      plain text >= 1500 chars (and rendered < 2x plain) -> adapter html (edge function reads it as is)
  needs_render only Chrome sees the content and no endpoint was found -> keep adapter html, flag `render_only` (a Chrome
               ingest job, not the edge function, must feed it) - say so in the funder's notes, never claim live coverage.
"""
import argparse, html, json, re, sys, urllib.parse, urllib.request, uuid

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 SALSAV-grants-recon"
JUNK = re.compile(r"google-analytics|googletagmanager|doubleclick|facebook|hotjar|clarity\.ms|segment\.|sentry|newrelic|"
                  r"cookiebot|onetrust|fonts\.|gstatic|recaptcha|linkedin\.com|twitter|tiktok|optimizely|hubspot|"
                  r"/collect\b|/beacon|/pixel|consent|adobedtm|akamai|cloudflare", re.I)
TITLEY = ("title", "name", "headline", "label", "heading", "subject")
URLY = ("url", "link", "permalink", "href", "slug", "path", "uri")
DESCY = ("description", "summary", "excerpt", "teaser", "abstract", "body", "content", "synopsis")
DEADY = ("deadline", "closedate", "close_date", "closing", "enddate", "end_date", "due", "duedate", "expires", "closedate")
OPP = re.compile(r"grant|call for|funding|fund\b|apply|application|rfp|rfa|solicitation|opportunit|award|prize|challenge|"
                 r"fellowship|deadline|proposal", re.I)
BAD_URL = re.compile(r"p_auth|csrf|token=|sessionid|jsessionid|authenticity", re.I)  # session-bound URLs die after the visit
WP_TYPE = re.compile(r"grant|fund|opportunit|call|rfp|program|prize|award|fellowship", re.I)
EU_SEARCH = "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=*&pageSize=5&pageNumber=1"
EU_TOPIC = re.compile(r"/topic-details/([A-Za-z0-9_.\-]+)")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get(url, timeout=25, accept="*/*", method="GET", data=None, headers=None):
    h = {"User-Agent": UA, "Accept": accept, "Accept-Language": "en"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(4_000_000)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", b""
    except Exception as e:  # timeouts, DNS, TLS: recorded, not retried here
        return 0, f"{type(e).__name__}: {e}", b""


def text_of(raw):
    t = raw.decode("utf-8", "replace")
    t = re.sub(r"(?is)<(script|style|noscript|svg|template)\b.*?</\1>", " ", t)
    t = html.unescape(re.sub(r"(?s)<[^>]+>", " ", re.sub(r"(?s)<!--.*?-->", " ", t)))
    return re.sub(r"\s+", " ", t).strip()


def find_list(obj, depth=0, path=""):
    """Largest list of dicts anywhere in the JSON, returns (path, list)."""
    best = ("", [])
    if depth > 6:
        return best
    if isinstance(obj, list):
        if obj and all(isinstance(x, dict) for x in obj[:5]) and len(obj) > len(best[1]):
            best = (path, obj)
        for i, x in enumerate(obj[:3]):
            c = find_list(x, depth + 1, f"{path}.{i}" if path else str(i))
            if len(c[1]) > len(best[1]):
                best = c
    elif isinstance(obj, dict):
        for k, v in obj.items():
            c = find_list(v, depth + 1, f"{path}.{k}" if path else k)
            if len(c[1]) > len(best[1]):
                best = c
    return best


def pick(keys, names):
    low = {k.lower(): k for k in keys}
    for n in names:
        if n in low:
            return low[n]
    for n in names:
        for lk, k in low.items():
            if n in lk:
                return k
    return None


def flat_title(v):
    return v.get("rendered") if isinstance(v, dict) and "rendered" in v else v


def flat(v):
    return re.sub(r"<[^>]+>", " ", str(flat_title(v) or ""))


def score_json(raw, url=""):
    """Return a json_api adapter_config candidate if the body is a JSON list of OPPORTUNITY-like dicts.
    A list that fails the opportunity gate comes back as {"rejected": reason, ...} and must never be proposed."""
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None
    path, items = find_list(data)
    if len(items) < 2:
        return None
    keys = set().union(*[set(i.keys()) for i in items[:10]])
    t = pick(keys, TITLEY)
    if not t:
        return None
    titles = [str(flat_title(i.get(t)) or "") for i in items[:10]]
    if sum(1 for x in titles if len(x) > 8) < 2:
        return None
    m = {"title": t if not isinstance(items[0].get(t), dict) else f"{t}.rendered"}
    u, d, dl = pick(keys, URLY), pick(keys, DESCY), pick(keys, DEADY)
    idk = pick(keys, ("id", "guid", "nid", "uuid", "opportunityid", "number"))
    for k, v in (("url", u), ("description", d), ("deadline", dl), ("external_id", idk)):
        if v:
            m[k] = v if not isinstance(items[0].get(v), dict) else f"{v}.rendered"
    head = items[:10]
    ratio = sum(1 for i in head if OPP.search(" ".join(flat(i.get(k)) for k in (t, d) if k))) / len(head)
    dead = bool(dl) and any(i.get(dl) not in (None, "", [], {}) for i in head)
    out = {"items_path": path, "map": m, "n_items": len(items), "sample_titles": [x[:80] for x in titles[:3]],
           "opp_ratio": round(ratio, 2), "deadline_field": dead}
    if ratio < 0.3 and not dead:
        out["rejected"] = "news/blog" if re.search(r"/posts\b|/news|/blog|/articles", url, re.I) else "not opportunity-like"
    return out


def stage_a(url):
    out = {"url": url}
    st, ct, raw = get(url, accept="text/html,application/xhtml+xml")
    out.update(status=st, ctype=ct[:60], bytes=len(raw))
    body = raw.decode("utf-8", "replace")
    out["text_len"] = len(text_of(raw)) if raw else 0
    base = f"{urllib.parse.urlsplit(url).scheme}://{urllib.parse.urlsplit(url).netloc}"
    cands = []
    for m in re.finditer(r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]*>', body, re.I):
        h = re.search(r'href=["\']([^"\']+)', m.group(0))
        if h:
            cands.append(("feed", urllib.parse.urljoin(url, html.unescape(h.group(1)))))
    for h in re.findall(r'href=["\']([^"\']+\.(?:rss|xml)(?:\?[^"\']*)?)["\']', body, re.I)[:5]:
        cands.append(("feed", urllib.parse.urljoin(url, html.unescape(h))))
    if "/wp-content/" in body or "wp-json" in body:
        out["cms"] = "wordpress"
        # generic posts/pages are blog noise; probe only opportunity-ish custom post types
        st3, _, tb = get(f"{base}/wp-json/wp/v2/types")
        try:
            types = json.loads(tb) if st3 == 200 else {}
        except Exception:
            types = {}
        for ty in types.values() if isinstance(types, dict) else []:
            rb = ty.get("rest_base")
            if rb and (WP_TYPE.search(str(ty.get("slug"))) or WP_TYPE.search(str(ty.get("name")))):
                cands.append(("json", f"{base}/wp-json/wp/v2/{rb}?per_page=20&_fields=id,link,title,excerpt,date"))
        slug = urllib.parse.urlsplit(url).path.strip("/").split("/")[-1]
        if slug:
            st4, _, pb = get(f"{base}/wp-json/wp/v2/pages?slug={urllib.parse.quote(slug)}&_fields=link,title,content")
            try:
                pg = json.loads(pb) if st4 == 200 else []
                if pg:  # evidence only: full page text is reachable, never proposed as json_api
                    out["wp_page_text_len"] = len(text_of(str(flat_title(pg[0].get("content")) or "").encode()))
            except Exception:
                pass
    if "drupal" in body.lower():
        out["cms"] = "drupal"
        cands.append(("json", f"{base}/jsonapi/node/article?page[limit]=20"))
    nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if nd:
        out["next_data"] = True
        s = score_json(nd.group(1).encode())
        if s and not s.get("rejected"):
            out["embedded_json"] = s
    bid = re.search(r'"buildId"\s*:\s*"([^"]+)"', body)
    if bid:
        cands.append(("json", f"{base}/_next/data/{bid.group(1)}/{urllib.parse.urlsplit(url).path.strip('/') or 'index'}.json"))
    ld = re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', body, re.S)
    out["ld_json_blocks"] = len(ld)
    st2, _, rb = get(f"{base}/robots.txt")
    maps = re.findall(r"(?im)^sitemap:\s*(\S+)", rb.decode("utf-8", "replace")) if st2 == 200 else []
    for sm in (maps or [f"{base}/sitemap.xml"])[:3]:
        cands.append(("sitemap", sm))
    out["robots_status"] = st2
    out["candidates"] = list(dict.fromkeys(cands))
    return out


def stage_b(url, wait_ms=6000):
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        return {"error": f"playwright import: {e}"}
    caps, text_len, links = [], 0, []
    try:
        with sync_playwright() as p:
            br = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
            ctx = br.contexts[0] if br.contexts else br.new_context()
            pg = ctx.new_page()

            def on_resp(r):
                try:
                    ct = (r.headers.get("content-type") or "").lower()
                    rq = r.request
                    if rq.resource_type in ("xhr", "fetch") or "json" in ct or "xml" in ct:
                        if not JUNK.search(r.url):
                            caps.append({"url": r.url, "method": rq.method, "status": r.status, "ctype": ct[:40],
                                         "post": (rq.post_data or "")[:300] if rq.method != "GET" else None})
                except Exception:
                    pass

            pg.on("response", on_resp)
            try:
                pg.goto(url, wait_until="networkidle", timeout=45000)
            except Exception as e:
                caps.append({"error": f"goto: {type(e).__name__}"})
            pg.wait_for_timeout(wait_ms)
            try:
                t = pg.inner_text("body")
                text_len = len(t)
                links = pg.evaluate("[...document.links].map(a=>a.href).filter(h=>h.startsWith('http'))")[:300]
            except Exception:
                pass
            pg.close()
    except Exception as e:
        return {"error": f"chrome: {type(e).__name__}: {str(e)[:150]} (run: python tools/browser.py up in nomadswipe-growth)"}
    seen, uniq = set(), []
    for c in caps:
        k = (c.get("method"), c.get("url"))
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    return {"rendered_text_len": text_len, "n_links": len(links), "captured": uniq[:60]}


def replay(c):
    kind, u = c
    st, ct, raw = get(u, accept="application/json,application/xml,text/xml,*/*")
    r = {"kind": kind, "url": u, "status": st, "ctype": ct[:40], "bytes": len(raw)}
    if st != 200 or not raw:
        return r
    head = raw[:300].decode("utf-8", "replace").lower()
    if kind == "sitemap" or "<urlset" in head or "<sitemapindex" in head:
        locs = re.findall(r"<loc>([^<]+)</loc>", raw.decode("utf-8", "replace"))
        r["sitemap_urls"] = len(locs)
        r["sitemap_hits"] = [x for x in locs if re.search(r"grant|fund|call|opportunit|rfp|apply|prize|award|program", x, re.I)][:8]
        return r
    if "<rss" in head or "<feed" in head or "<rdf" in head:
        r["feed_items"] = len(re.findall(r"<(?:item|entry)[\s>]", raw.decode("utf-8", "replace")))
        return r
    s = score_json(raw, u)
    if s:
        r["rejected" if s.get("rejected") else "json_api"] = s.get("rejected") or s
        if s.get("rejected"):
            r["sample_titles"] = s["sample_titles"]
    return r


def eu_ft_probe(ident):
    """Verified live 2026-11: SEDIA search with a structured `query` part returns exactly the topic.
    Multipart like the portal (FormData+Blob): `query` JSON part + `languages`. text=<identifier> does NOT narrow (13k hits)."""
    q = {"terms": {"identifier": [ident]}}
    b = uuid.uuid4().hex
    parts = [("query", q), ("languages", ["en"])]
    nl = chr(13) + chr(10)
    body = "".join(f'--{b}{nl}Content-Disposition: form-data; name="{n}"; filename="blob"{nl}Content-Type: application/json{nl}{nl}'
                   f'{json.dumps(v)}{nl}' for n, v in parts).encode() + f"--{b}--{nl}".encode()
    st, _, raw = get(EU_SEARCH, method="POST", data=body, accept="application/json", headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        rs = json.loads(raw).get("results", [])
    except Exception:
        rs = []
    hit = [r for r in rs if ident in (r.get("metadata", {}).get("identifier") or [])]
    if st != 200 or len(rs) != 1 or not hit:
        return {"ok": False, "status": st, "n_results": len(rs)}
    m = hit[0]["metadata"]
    return {"ok": True, "query": q, "request": f"POST {EU_SEARCH} multipart: query={json.dumps(q)}, languages=[\"en\"]",
            "result_paths": {"title": "results.0.metadata.title.0", "deadline": "results.0.metadata.deadlineDate (list: one per stage)",
                             "status": "results.0.metadata.status.0 (31094501=open,31094502=forecasted,31094503=closed)"},
            "title": (m.get("title") or [""])[0], "deadlines": m.get("deadlineDate"), "status": (m.get("status") or [""])[0]}


def decide(A, B, results, eu=None):
    """Verdict from stage A/B facts and replayed candidates. Returns (verdict, confidence, proposal, why)."""
    plain, rend = A["text_len"], B.get("rendered_text_len") or 0
    feeds = [r for r in results if r.get("feed_items", 0) >= 1]
    apis = [r for r in results if r.get("json_api")]
    if eu and eu.get("ok"):
        return "eu_ft", 0.9, {"adapter": "eu_ft", "adapter_config": {"query": eu["query"]}}, \
            f"EU F&T topic: plain HTML is a JS shell ({plain} chars); SEDIA search returns exactly this topic"
    if feeds:
        f = max(feeds, key=lambda r: r["feed_items"])
        return "rss", 0.9, {"adapter": "rss", "feed_url": f["url"]}, f"feed with {f['feed_items']} items"
    if apis:
        j = max(apis, key=lambda r: r["json_api"]["n_items"])
        return "json_api", 0.75, {"adapter": "json_api", "feed_url": None, "adapter_config": {"url": j["url"], "method": "GET", **{k: j["json_api"][k] for k in ("items_path", "map")}}}, \
            f"opportunity-like JSON list ({j['json_api']['opp_ratio']:.0%} match, deadline field={j['json_api']['deadline_field']})"
    xhr = [f"{c.get('method')} {c['url']}" for c in B.get("captured", []) if c.get("url") and c.get("status") == 200
           and re.search("json|xml", c.get("ctype", "")) and "svg" not in c.get("ctype", "") and not BAD_URL.search(c["url"])][:8]
    if A["status"] == 200 and plain >= 1500 and rend < 2 * plain:
        return "html_ok", 0.7, {"adapter": "html"}, f"plain page has {plain} chars; no opportunity endpoint found"
    if rend >= 1500 and (rend >= 2 * plain or A["status"] != 200):
        return "needs_render", 0.5, {"adapter": "html", "render_only": True, "xhr_endpoints_seen": xhr}, \
            f"plain HTTP gives {plain} chars (status {A['status']}), Chrome renders {rend}; no usable opportunity endpoint"
    if A["status"] in (401, 403, 429):
        return "blocked", 0.2, {"adapter": "html", "render_only": False}, f"HTTP {A['status']} and Chrome rendered {rend} chars"
    return "none", 0.0, {}, f"plain {plain} chars, rendered {rend}: no opportunity endpoint or readable page"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--name", default="")
    ap.add_argument("--no-chrome", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    A = stage_a(a.url)
    B = {} if a.no_chrome else stage_b(a.url)
    cands, rejected = list(A["candidates"]), []
    for c in B.get("captured", []):
        ct = c.get("ctype", "")
        if c.get("url") and c.get("method") == "GET" and c.get("status") == 200 and ("json" in ct or "xml" in ct):
            cands.append(("json" if "json" in ct else "feed", c["url"]))
    captured_ok = {c["url"] for c in B.get("captured", []) if c.get("status") == 200}
    results = []
    for c in list(dict.fromkeys(cands))[:40]:
        if BAD_URL.search(c[1]):
            rejected.append({"url": c[1], "reason": "session/CSRF token in URL"})
            continue
        r = replay(c)
        if r["status"] in (401, 403) and c[1] in captured_ok:
            rejected.append({"url": c[1], "reason": "works only with browser cookies/session"})
        if r.get("rejected"):
            rejected.append({"url": c[1], "reason": r["rejected"], "sample_titles": r.get("sample_titles")})
        results.append(r)
    m = EU_TOPIC.search(a.url)
    eu = eu_ft_probe(m.group(1)) if m and "europa.eu" in a.url else None
    posts = [c for c in B.get("captured", []) if c.get("method") == "POST" and c.get("status") == 200]
    ev = {"plain_text_len": A["text_len"], "rendered_text_len": B.get("rendered_text_len"), "wp_page_text_len": A.get("wp_page_text_len")}
    verdict, conf, prop, why = decide(A, B, results, eu)
    rep = {"url": a.url, "name": a.name, "verdict": verdict, "confidence": conf, "proposal": prop, "why": why, "evidence": ev,
           "page": {k: A.get(k) for k in ("status", "ctype", "text_len", "cms", "next_data", "ld_json_blocks", "robots_status")},
           "embedded_json": A.get("embedded_json"), "chrome": {k: B.get(k) for k in ("rendered_text_len", "n_links", "error")},
           "rejected_candidates": rejected, "eu_ft": eu, "post_endpoints_seen": posts[:5],
           "replayed": results, "chrome_xhr_seen": len(B.get("captured", []))}
    s = json.dumps(rep, indent=1, ensure_ascii=False)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(s)
    print(s[:6000])


if __name__ == "__main__":
    main()

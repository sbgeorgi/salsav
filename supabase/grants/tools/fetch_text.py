"""Print the readable text of a web page so quotes can be copied verbatim (WebFetch paraphrases).

python supabase/grants/tools/fetch_text.py URL [--max 12000] [--grep "eligib|award|deadline"] [--window 300]
--grep prints only windows of text around each regex match (case-insensitive), at most 12 windows.
Exit 2 with a one-line reason when the page cannot be read (blocked, PDF, timeout): record that, never guess.
"""
import argparse, html, re, sys, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("url")
ap.add_argument("--max", type=int, default=12000)
ap.add_argument("--grep")
ap.add_argument("--window", type=int, default=300)
a = ap.parse_args()
if not re.match(r"https?://", a.url):
    sys.exit("only http(s) URLs")
req = urllib.request.Request(a.url, headers={
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) research-reader/1.0",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en"})
try:
    with urllib.request.urlopen(req, timeout=25) as r:
        ctype = r.headers.get("Content-Type", "")
        raw = r.read(3_000_000)
except Exception as e:  # blocked / timeout / 4xx: the caller records fetchability, it does not retry in a loop
    print(f"FETCH_FAILED {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(2)
if "pdf" in ctype.lower() or raw[:5] == b"%PDF-":
    print("FETCH_FAILED PDF: download it and read it with a PDF tool", file=sys.stderr)
    sys.exit(2)
m = re.search(r"charset=([\w-]+)", ctype)
text = raw.decode(m.group(1) if m else "utf-8", "replace")
text = re.sub(r"(?is)<(script|style|noscript|svg|template)\b.*?</\1>", " ", text)
text = re.sub(r"(?s)<!--.*?-->", " ", text)
text = re.sub(r"(?i)<(br|/p|/div|/li|/h[1-6]|/tr|/section)\s*/?>", "\n", text)
text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", text))
text = re.sub(r"[ \t\r\f\v]+", " ", text)
text = re.sub(r"\n\s*\n+", "\n", text).strip()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if len(text) < 200:
    print("FETCH_FAILED THIN: page has almost no text (JavaScript-rendered or blocked)", file=sys.stderr)
    sys.exit(2)
if a.grep:
    spans = []
    for hit in re.finditer(a.grep, text, re.I):
        s, e = max(0, hit.start() - a.window), min(len(text), hit.end() + a.window)
        if spans and s <= spans[-1][1]:
            spans[-1][1] = e
        else:
            spans.append([s, e])
        if len(spans) >= 12:
            break
    print(f"[{len(text)} chars, {len(spans)} windows]")
    for s, e in spans:
        print("...", text[s:e].replace("\n", " "), "...\n")
else:
    print(text[: a.max])

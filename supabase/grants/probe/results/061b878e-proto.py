import re, html, sys, json, time, urllib.request
from datetime import date
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
BASE = "https://minciencias.gov.co"
MES = {m: i for i, m in enumerate(["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"], 1)}

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "ignore")

def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()

def listing(page):
    h = get(f"{BASE}/convocatorias/todas?page={page}")
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", h, re.S):
        if "views-field-title" not in tr:
            continue
        a = re.search(r'<a href="(/node/\d+)">(.*?)</a>', tr, re.S)
        ap = re.search(r'content="(\d{4}-\d{2}-\d{2})', tr)
        if a:
            out.append({"node": a.group(1), "title": clean(a.group(2))[:160], "opened": ap.group(1) if ap else None})
    return out

def cierre(node):
    t = clean(get(BASE + node))
    m = re.search(r"Cierre\s+\w+\s+(\d{1,2}) (\w+) (\d{4})", t)
    if not m:
        return None
    return date(int(m.group(3)), MES[m.group(2).lower()], int(m.group(1))).isoformat()

if __name__ == "__main__":
    today = date.today().isoformat()
    items = []
    for p in range(0, 4):
        items += listing(p)
        time.sleep(2)
    seen, live = set(), []
    for it in items:
        if it["node"] in seen or not it["opened"] or it["opened"] < "2025-12-01":
            continue
        seen.add(it["node"])
        it["deadline"] = cierre(it["node"]); time.sleep(2)
        it["open_now"] = bool(it["deadline"] and it["deadline"] >= today)
        if it["open_now"]:
            live.append(it)
    print(json.dumps({"rows_scanned": len(items), "detail_checked": len(seen), "live_count": len(live), "live": live[:5]}, ensure_ascii=False, indent=1))

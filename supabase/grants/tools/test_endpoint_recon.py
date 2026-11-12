"""python -B supabase/grants/tools/test_endpoint_recon.py  (offline fixtures; no network)"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endpoint_recon as er


def body(items):
    return json.dumps(items).encode()


posts = [{"id": i, "link": f"https://x.org/{i}", "date": "2026-01-01", "title": {"rendered": t}, "excerpt": {"rendered": "<p>Joined the team last week.</p>"}}
         for i, t in enumerate(["Kelly Born Named Senior Advisor", "Our new office opens downtown", "Annual report is published", "Staff retreat photos"])]
r = er.score_json(body(posts), "https://x.org/wp-json/wp/v2/posts?per_page=20")
assert r and r["rejected"] == "news/blog", r
pages = [{"id": i, "link": f"https://x.org/{i}", "title": {"rendered": t}, "excerpt": {"rendered": ""}} for i, t in enumerate(["Terms & Conditions", "Privacy Policy", "Home page"])]
assert er.score_json(body(pages), "https://x.org/wp-json/wp/v2/pages")["rejected"] == "not opportunity-like"
countries = [{"id": i, "name": n, "title": n} for i, n in enumerate(["Afghanistan country", "Albania country", "Algeria country"])]
assert er.score_json(body(countries), "https://x.org/o/headless-delivery/v1.0/content-sets/1")["rejected"]

grants = [{"id": i, "link": f"https://x.org/g/{i}", "title": {"rendered": t}, "excerpt": {"rendered": d}}
          for i, (t, d) in enumerate([("Climate Resilience Fund 2027", "Apply by March"), ("Call for Proposals: Soil Health", "Open call"),
                                      ("Fellowship Programme", "Applications open"), ("About us", "history")])]
r = er.score_json(body(grants), "https://x.org/wp-json/wp/v2/grants")
assert r and "rejected" not in r and r["opp_ratio"] >= 0.3, r

# a deadline field alone rescues a list whose text does not match
dl = [{"id": i, "title": f"Thing number {i} here", "deadline": "2027-05-01"} for i in range(3)]
assert "rejected" not in er.score_json(body(dl), "https://x.org/api/list")
dl_empty = [{"id": i, "title": f"Thing number {i} here", "deadline": None} for i in range(3)]
assert er.score_json(body(dl_empty), "https://x.org/api/list")["rejected"]

# token / session URLs are rejected before replay
for u in ("https://www.ifad.org/o/x?p_auth=AbC123", "https://a.org/api?token=1", "https://a.org/x;jsessionid=9", "https://a.org/a?csrf=1"):
    assert er.BAD_URL.search(u), u
assert not er.BAD_URL.search("https://a.org/wp-json/wp/v2/grants?per_page=20")

# verdict semantics
A = lambda n, st=200: {"text_len": n, "status": st}
assert er.decide(A(27), {"rendered_text_len": 19000}, [])[0] == "needs_render"
assert er.decide(A(1600), {"rendered_text_len": 9000}, [])[0] == "needs_render"
assert er.decide(A(1600), {"rendered_text_len": 1700}, [])[0] == "html_ok"
assert er.decide(A(1499), {"rendered_text_len": 1500}, [])[0] == "none"  # thin everywhere: nothing to render
assert er.decide(A(0, 403), {"rendered_text_len": 3000}, [])[0] == "needs_render"
assert er.decide(A(300), {"rendered_text_len": 400}, [])[0] == "none"
v = er.decide(A(10), {}, [], {"ok": True, "query": {"terms": {"identifier": ["X"]}}})
assert v[0] == "eu_ft" and v[2]["adapter_config"]["query"]["terms"]["identifier"] == ["X"]
assert er.EU_TOPIC.search("https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-CL6-2027-02-FARM2FORK-02-two-stage;callCode=null").group(1) == "HORIZON-CL6-2027-02-FARM2FORK-02-two-stage"
print("ok")

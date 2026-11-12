"""Turn a saved execute_sql tool-output file (argv[1]) into a clean JSON rows file (argv[2])."""
import json, re, sys

env = json.load(open(sys.argv[1], encoding="utf-8"))
m = re.search(r"<untrusted-data-[^>]*>\s*(\[.*\])\s*</untrusted-data", env["result"], re.S)
rows = json.loads(m.group(1))
json.dump(rows, open(sys.argv[2], "w", encoding="utf-8"), indent=1)
print(len(rows))
for r in rows:
    print(r["id"][:8], r["adapter"], r["name"][:35], "|", r["url"][:70])

# Local preview server that forbids browser caching, so lazily imported dash/*.js and *.css always load fresh.
# usage (repo root): python .claude/runs/dash-fit-2026-11-18/serve_nocache.py [PORT]
import sys, http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8767
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory='.')).serve_forever()

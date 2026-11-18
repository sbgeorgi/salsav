"""Screenshot/measure a page at an exact viewport via the agent headless Chrome (CDP 9334, started by ~/.claude/bin/web).
usage: python shot.py URL WIDTH HEIGHT OUT.png [--js EXPR] [--full] [--wait SECONDS] [--scroll CSS]
--js runs after load (and before the shot) and prints its JSON result; --full captures the whole page height;
--scroll scrolls the first element matching CSS into view first. Start Chrome once with: ~/.claude/bin/web text about:blank 10
"""
import base64, json, sys, time, urllib.request
import websocket

a = sys.argv[1:]
url, w, h, out = a[0], int(a[1]), int(a[2]), a[3]
opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
js, wait, scroll, full = opt('--js'), float(opt('--wait', '2.5')), opt('--scroll'), '--full' in a

req = urllib.request.Request('http://127.0.0.1:9334/json/new?about:blank', method='PUT')
try: tgt = json.load(urllib.request.urlopen(req))
except OSError:  # the agent Chrome closes itself when idle; the web wrapper starts it again
    import subprocess; subprocess.run(['bash', '-c', '~/.claude/bin/web text about:blank 10'], capture_output=True, timeout=60)
    tgt = json.load(urllib.request.urlopen(req))
ws = websocket.create_connection(tgt['webSocketDebuggerUrl'], timeout=60)
n = 0
def cdp(method, **params):
    global n; n += 1; ws.send(json.dumps({'id': n, 'method': method, 'params': params}))
    while True:
        m = json.loads(ws.recv())
        if m.get('id') == n:
            if 'error' in m: raise RuntimeError(m['error'])
            return m.get('result', {})
try:
    mobile = w < 768
    cdp('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=mobile)
    if mobile: cdp('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
    cdp('Page.enable'); cdp('Runtime.enable'); cdp('Network.enable'); cdp('Network.setCacheDisabled', cacheDisabled=True)
    cdp('Page.navigate', url=url); time.sleep(wait)
    ev = lambda e: cdp('Runtime.evaluate', expression=e, awaitPromise=True, returnByValue=True).get('result', {}).get('value')
    if scroll: ev(f"document.querySelector({json.dumps(scroll)})?.scrollIntoView({{block:'start'}}); scrollBy(0,-70)"); time.sleep(.6)
    if js: print(json.dumps(ev(js), indent=1)); time.sleep(.4)
    p = {'format': 'png'}
    if full:
        H = ev('document.documentElement.scrollHeight')
        p.update(captureBeyondViewport=True, clip={'x': 0, 'y': 0, 'width': w, 'height': min(H, 12000), 'scale': 1})
    open(out, 'wb').write(base64.b64decode(cdp('Page.captureScreenshot', **p)['data']))
    print('saved', out)
finally:
    ws.close(); urllib.request.urlopen('http://127.0.0.1:9334/json/close/' + tgt['id'])

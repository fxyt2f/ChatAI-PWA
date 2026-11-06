"""Capture actual Chrome settings at every section boundary, in an isolated profile."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen
from urllib.parse import urlparse
import argparse, ast, base64, functools, hashlib, json, subprocess, sys, tempfile, threading, time

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['before', 'after'], required=True)
parser.add_argument('--output', type=Path, default=root/'docs/settings-visual-consistency')
parser.add_argument('--widths', nargs='+', type=int, default=[1280, 1440, 768, 390, 360])
parser.add_argument('--baseline-assets', type=Path, help='Serve captured pre-edit CSS/UI assets without modifying the worktree')
parser.add_argument('--overview-only', action='store_true', help='Capture top/middle/bottom of each category and the mobile category home')
args = parser.parse_args()
if args.baseline_assets and args.phase != 'before': parser.error('--baseline-assets requires --phase before')
output = args.output.resolve()/args.phase
output.mkdir(parents=True, exist_ok=True)

# Reuse only the existing CDP transport, without starting its test runner.
transport = ast.parse((root/'tests/run-browser-tests.py').read_text(encoding='utf-8'))
transport.body = [node for node in transport.body if isinstance(node, (ast.Import, ast.ImportFrom))
                  or isinstance(node, ast.ClassDef) and node.name == 'CDP']
namespace = {}
exec(compile(transport, str(root/'tests/run-browser-tests.py'), 'exec'), namespace)
CDP = namespace['CDP']

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def translate_path(self, path):
        name = urlparse(path).path.lstrip('/')
        if args.baseline_assets and name in ['style.css', 'settings-ui-v136.js', 'index.html', 'app.js']:
            return str(args.baseline_assets.resolve()/name)
        return super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
records, failures, assertions = [], [], 0

with tempfile.TemporaryDirectory(prefix='chatai-settings-layout-', ignore_cleanup_errors=True) as profile:
    proc = subprocess.Popen(['C:/Program Files/Google/Chrome/Application/chrome.exe', '--headless=new',
        '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-extensions',
        '--disable-popup-blocking', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    client = None
    try:
        deadline = time.monotonic()+15
        while True:
            try:
                port = (Path(profile)/'DevToolsActivePort').read_text().splitlines()[0]
                if port.isdigit(): break
            except (OSError, IndexError): pass
            if time.monotonic() > deadline: raise TimeoutError('Chrome endpoint not ready')
            time.sleep(.05)
        targets = json.load(urlopen(f'http://127.0.0.1:{port}/json/list'))
        client = CDP(next(t['webSocketDebuggerUrl'] for t in targets if t['type'] == 'page'))
        def evaluate(expression):
            result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
            if 'exceptionDetails' in result: raise RuntimeError(result['exceptionDetails'])
            return result.get('result', {}).get('value')
        client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
        client.call('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/tests/v136-browser.html?ui=1'})
        time.sleep(.2)
        baseline = evaluate("""(async()=>{const end=Date.now()+45000;while(!document.getElementById('test-results')){
            if(Date.now()>end)throw new Error('fixture timeout');await new Promise(r=>setTimeout(r,50));}
            return document.getElementById('test-results').textContent;})()""")
        if 'FAIL' in baseline: raise RuntimeError(baseline)
        evaluate("(async()=>{(0,eval)(await(await fetch('/tests/settings-layout-v136.js')).text());return true;})()")
        if args.phase == 'after':
            result = evaluate('assertSettingsLayoutIdentityV136()')
            assertions += result['assertions']
            failures.extend(result['failures'])
        print('PASS existing UI/browser fixture', flush=True)
        for width in args.widths:
            client.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': width < 800})
            for dark in [False, True]:
                theme = 'dark' if dark else 'light'
                for category in ['general', 'profile', 'integrations', 'other']:
                    groups = evaluate(f'prepareSettingsLayoutReviewV136({json.dumps(category)},{str(dark).lower()},true)')
                    prefix = f'{width}-{theme}-{category}'
                    locations = [('top', None, 0)]
                    if args.overview_only: locations.append(('middle',None,.5))
                    else:
                        for group in groups:
                            locations.append((f'section-{group["index"]:02d}', group['index'], 0))
                            if group['height'] > 750: locations.append((f'section-{group["index"]:02d}-middle', group['index'], .5))
                    locations.append(('bottom', None, 1))
                    for location, index, fraction in locations:
                        if index is None:
                            expression = f"document.getElementById('settings-detail').scrollTop=(document.getElementById('settings-detail').scrollHeight-document.getElementById('settings-detail').clientHeight)*{fraction}"
                        else:
                            expression = f"""(()=>{{const pane=document.getElementById('settings-detail'),section=document.querySelector('[data-settings-panel={category}] [data-layout-review-group="{index}"]');
                                pane.scrollTop+=section.getBoundingClientRect().top-pane.getBoundingClientRect().top-24+section.getBoundingClientRect().height*{fraction};}})()"""
                        evaluate(expression)
                        position = evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(document.getElementById('settings-detail').scrollTop))))")
                        shot = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
                        filename = f'{prefix}-{location}.png'
                        (output/filename).write_bytes(base64.b64decode(shot['data']))
                        records.append({'width': width, 'theme': theme, 'category': category, 'location': location,
                                        'scrollTop': position, 'file': filename})
                    metrics = evaluate(f'measureSettingsLayoutV136({json.dumps(category)})')
                    (output/f'{prefix}-computed.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')
                    if args.phase == 'after':
                        result = evaluate(f'assertSettingsLayoutV136({json.dumps(category)})')
                        assertions += result['assertions']
                        failures.extend(f'{prefix}: {message}' for message in result['failures'])
                    if width in [1280, 390] and not args.overview_only:
                        evaluate(f'prepareSettingsLayoutReviewV136({json.dumps(category)},{str(dark).lower()},false)')
                        if args.phase == 'after':
                            result = evaluate(f'assertSettingsLayoutV136({json.dumps(category)})')
                            assertions += result['assertions']
                            failures.extend(f'{prefix}-collapsed: {message}' for message in result['failures'])
                        shot = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
                        filename = f'{prefix}-collapsed.png'; (output/filename).write_bytes(base64.b64decode(shot['data']))
                        records.append({'width': width, 'theme': theme, 'category': category, 'location': 'collapsed', 'scrollTop': 0, 'file': filename})
                    print(f'Captured {prefix}', flush=True)
                if width < 800 and args.overview_only:
                    evaluate("(async()=>{await uiUtilsV136.showScreen('settings',true);settingsUiV136.selectCategory(null,false);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()")
                    shot=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                    filename=f'{width}-{theme}-home.png';(output/filename).write_bytes(base64.b64decode(shot['data']))
                    records.append({'width':width,'theme':theme,'category':'home','location':'top','scrollTop':0,'file':filename})
        manifest = {'phase': args.phase, 'records': records, 'failures': failures, 'assertions': assertions, 'baselineTests': baseline,
            'sourceHashes': {name: hashlib.sha256(((args.baseline_assets/name) if args.baseline_assets and name in ['style.css', 'settings-ui-v136.js', 'index.html', 'app.js'] else (root/name)).read_bytes()).hexdigest() for name in
                ['app.js', 'settings-v136.js', 'sw.js', 'settings-ui-v136.js', 'style.css', 'index.html', 'tests/run-browser-tests.py', 'tests/v136-ui-tests.js']}}
        (output/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'{len(records)} actual Chrome screenshots; {assertions} assertions; {len(failures)} layout failures', flush=True)
        for failure in failures: print('FAIL', failure)
    finally:
        if client:
            try: client.call('Browser.close')
            except (OSError, EOFError): pass
            client.sock.close()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.terminate()
        server.shutdown(); server.server_close()
sys.exit(1 if failures else 0)

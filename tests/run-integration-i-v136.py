"""Deterministic integration races in independent Chrome windows / real IndexedDB."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.request import urlopen
from urllib.parse import urlparse
import argparse,ast,functools,json,subprocess,sys,tempfile,threading,time
sys.stdout.reconfigure(encoding='utf-8');root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--phase',choices=['before','after'],required=True);args=p.parse_args();out=root/'docs/integration-i-v136';out.mkdir(parents=True,exist_ok=True)
tree=ast.parse((root/'tests/run-browser-tests.py').read_text(encoding='utf-8'));tree.body=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom)) or isinstance(n,ast.ClassDef) and n.name=='CDP'];ns={};exec(compile(tree,'transport','exec'),ns);CDP=ns['CDP']
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def translate_path(self,path):
        n=urlparse(path).path.lstrip('/')
        if args.phase=='before' and n=='tests/integration-i-v136.js':return str(out/'before/initial-regressions.js')
        if args.phase=='before' and n in ['app.js','settings-v136.js','settings-ui-v136.js','style.css','index.html']:return str(out/'before/assets'/n)
        return super().translate_path(path)
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='chatai-integration-i-',ignore_cleanup_errors=True) as profile:
    proc=subprocess.Popen(['C:/Program Files/Google/Chrome/Application/chrome.exe','--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-extensions','--disable-popup-blocking','--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW);client=None
    try:
        end=time.monotonic()+15
        while not (Path(profile)/'DevToolsActivePort').exists():
            if time.monotonic()>end:raise TimeoutError('Chrome startup')
            time.sleep(.05)
        port=(Path(profile)/'DevToolsActivePort').read_text().splitlines()[0];tabs=json.load(urlopen(f'http://127.0.0.1:{port}/json/list'));client=CDP(next(t['webSocketDebuggerUrl'] for t in tabs if t['type']=='page'))
        client.call('Runtime.enable');client.call('Runtime.addBinding',{'name':'testFocusTab'});client.call('Emulation.setDeviceMetricsOverride',{'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
        def ev(expression):
            r=client.call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True})
            if 'exceptionDetails' in r:raise RuntimeError(r['exceptionDetails'])
            return r.get('result',{}).get('value')
        client.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/tests/v136-browser.html?ui=1&review=1'})
        fixture=ev("(async()=>{while(!document.getElementById('test-results'))await new Promise(r=>setTimeout(r,50));return document.getElementById('test-results').textContent})()")
        if 'FAIL' in fixture:raise RuntimeError(fixture)
        ev("(async()=>{(0,eval)(await(await fetch('/tests/integration-i-v136.js')).text());return true})()")
        result=ev('runIntegrationIRegressionsV136()');result['fixture']=fixture
        (out/(args.phase+'-tests.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print('\n'.join(result['output']),flush=True);print(f"{result['passed']} passed / {result['failed']} failed",flush=True)
    finally:
        if client:
            try:client.call('Browser.close')
            except Exception:pass
            client.sock.close()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.terminate()
        server.shutdown();server.server_close()
sys.exit(1 if result['failed'] else 0)

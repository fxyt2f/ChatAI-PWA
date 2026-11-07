"""Before/after Chrome matrix, using the same isolated application fixture and CDP."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen
from urllib.parse import urlparse
import argparse, ast, base64, functools, hashlib, json, subprocess, sys, tempfile, threading, time
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--phase',choices=['before','after'],required=True);p.add_argument('--quick',action='store_true');p.add_argument('--extras-only',action='store_true');p.add_argument('--checks-only',action='store_true');p.add_argument('--kinds',nargs='+');p.add_argument('--output',type=Path,default=root/'docs/sidebar-background-v136');args=p.parse_args()
base=args.output.resolve();out=base/args.phase;out.mkdir(parents=True,exist_ok=True)
transport=ast.parse((root/'tests/run-browser-tests.py').read_text(encoding='utf-8'));transport.body=[n for n in transport.body if isinstance(n,(ast.Import,ast.ImportFrom)) or isinstance(n,ast.ClassDef) and n.name=='CDP'];ns={};exec(compile(transport,'transport','exec'),ns);CDP=ns['CDP']
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def translate_path(self,path):
        name=urlparse(path).path.lstrip('/')
        if args.phase=='before' and name in ['app.js','style.css','index.html','settings-ui-v136.js']:return str(base/'before/assets'/name)
        return super().translate_path(path)
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)));threading.Thread(target=server.serve_forever,daemon=True).start()
records=[];failures=[];assertions=0
with tempfile.TemporaryDirectory(prefix='chatai-sidebar-',ignore_cleanup_errors=True) as profile:
    proc=subprocess.Popen(['C:/Program Files/Google/Chrome/Application/chrome.exe','--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-extensions','--disable-popup-blocking','--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    client=None
    try:
        deadline=time.monotonic()+15
        while True:
            try:
                port=(Path(profile)/'DevToolsActivePort').read_text().splitlines()[0]
                if port.isdigit():break
            except (FileNotFoundError,PermissionError,IndexError):pass
            if time.monotonic()>deadline:raise TimeoutError('Chrome startup')
            time.sleep(.05)
        targets=json.load(urlopen(f'http://127.0.0.1:{port}/json/list'));client=CDP(next(t['webSocketDebuggerUrl'] for t in targets if t['type']=='page'))
        def ev(expr):
            r=client.call('Runtime.evaluate',{'expression':expr,'awaitPromise':True,'returnByValue':True})
            if 'exceptionDetails' in r:raise RuntimeError(r['exceptionDetails'])
            return r.get('result',{}).get('value')
        client.call('Emulation.setDeviceMetricsOverride',{'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
        client.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/tests/v136-browser.html?ui=1'})
        fixture=ev("(async()=>{while(!document.getElementById('test-results'))await new Promise(r=>setTimeout(r,50));return document.getElementById('test-results').textContent})()")
        if 'FAIL' in fixture:raise RuntimeError(fixture)
        ev("(async()=>{(0,eval)(await(await fetch('/tests/sidebar-background-v136.js')).text());return true})()")
        def shot(name,metrics):
            if not args.quick:
                data=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False});(out/(name+'.png')).write_bytes(base64.b64decode(data['data']))
            records.append({'file':name+'.png',**metrics})
        def check(value,message):
            global assertions
            assertions+=1
            if not value:failures.append(message)
        widths=[1199,1200,390] if args.quick else [360,390,768,900,1199,1200,1280,1440]
        for width in ([] if args.extras_only or args.checks_only else widths):
            client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
            if args.kinds:ev('prepareBackgroundReviewV136("chat","light-individual")')
            for opened in ([False,True] if width>=900 else [False]):
                for kind in (args.kinds or ['panel','search','replace','system','format','summary','character','debug','memory','models','profile']):
                    m=ev(f'prepareSidebarReviewV136({json.dumps(kind)},{str(opened).lower()})');name=f'{width}-{"open" if opened else "closed"}-{kind}';shot(name,m)
                    if args.phase=='after':
                        r=m['panel'];w=m['workspace'];blocked_model=kind=='models' and opened and 900<=width<1200
                        check((r is None) if blocked_model else (r is not None),name+' panel visibility/inert')
                        if r:
                            check(r['left']>=w['left']-1 and r['right']<=w['right']+1,name+' outside workspace')
                            check(r['top']>=-1 and r['bottom']<=901,name+' outside viewport')
                            if kind in ['system','format','summary','character','debug','memory']:check(abs(m['centerError'])<1,name+' not centered')
                            if kind in ['search','replace']:check(abs(r['left']-w['left']-(8 if width<=600 else 16))<1,name+' incorrect left')
                        check(m['inert']==(opened and 900<=width<1200),name+' inert mode')
            print(f'Captured floating UI {width}px',flush=True)
            by_scenario={}
            for scenario in ([] if args.kinds else ['light-plain','dark-plain','light-image','dark-image','light-opacity','light-individual']):
                states=[]
                for screen in ['chat','history','settings']:
                    m=ev(f'prepareBackgroundReviewV136({json.dumps(screen)},{json.dumps(scenario)})');shot(f'{width}-{scenario}-{screen}',m);states.append(m)
                by_scenario[scenario]=states
                if args.phase=='after':
                    keys=['base','overlayColor','overlayOpacity','image','imageOpacity']
                    for key in keys:check(len({s[key] for s in states})==1,f'{width}-{scenario} mismatched {key}')
                    check(all(s['pointerEvents']=='none' for s in states),f'{width}-{scenario} overlay intercepts input')
            print(f'Captured backgrounds {width}px',flush=True)
        if not args.quick and not args.checks_only and not args.kinds:
            for width in [1199,1280]:
                client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
                for header in ['hidden','forced']:
                    for behavior in ['always','on-click','hidden']:
                        ev('prepareSidebarReviewV136("panel",true)')
                        ev(f"document.body.classList.add('header-auto-hide');document.body.classList.toggle('header-force-show',{str(header=='forced').lower()});state.settings.floatingPanelBehavior={json.dumps(behavior)};appLogic.applyFloatingPanelBehavior();appLogic.showActionPanel();true")
                        ev('(async()=>{await new Promise(r=>setTimeout(r,350));return true})()')
                        shot(f'{width}-header-{header}-{behavior}',ev('measureSidebarReviewV136("panel")'))
        if args.phase=='after' and not args.kinds:
            client.call('Emulation.setDeviceMetricsOverride',{'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
            for kind in ['search','system','format','models']:
                ev(f'prepareSidebarReviewV136({json.dumps(kind)},true)')
                for width in [1199,1200,768,1280]:
                    client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
                    ev('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()')
                    m=ev(f'measureSidebarReviewV136({json.dumps(kind)})');r=m['panel'];w=m['workspace']
                    check(r is not None and r['left']>=w['left']-1 and r['right']<=w['right']+1,f'open {kind} follows resize {width}')
                    if kind in ['system','format']:check(abs(m['centerError'])<1,f'open {kind} resize center {width}')
            # Native mouse hit testing: neither a high-z search nor body popover
            # may be interactive above the overlay sidebar.
            client.call('Emulation.setDeviceMetricsOverride',{'width':1199,'height':900,'deviceScaleFactor':1,'mobile':False})
            ev('prepareSidebarReviewV136("search",true)')
            check(ev("!!document.elementFromPoint(25,85).closest('#chat-history-sidebar')"),'overlay sidebar is above search')
            client.call('Input.dispatchMouseEvent',{'type':'mousePressed','x':25,'y':85,'button':'left','clickCount':1});client.call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':25,'y':85,'button':'left','clickCount':1})
            check(ev("document.activeElement.id!=='chat-search-query'"),'native click cannot focus inert search')
            ev('(async()=>{await prepareSidebarReviewV136("panel",false);settingsUiV136.openModels(document.getElementById("chat-model-button"));return true})()')
            ev('uiUtilsV136.openChatSidebar();true');check(ev('!settingsUiV136.popover'),'opening overlay closes body popover')
            for kind in ['system','format','debug']:
                client.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':480,'deviceScaleFactor':1,'mobile':False})
                m=ev(f'prepareSidebarReviewV136({json.dumps(kind)},false)');r=m['panel']
                check(r['top']>=0 and r['bottom']<=481,f'{kind} fits reduced viewport')
                if kind=='system':check(ev("document.getElementById('system-prompt-dialog').matches('dialog:modal')"),'prompt uses native modal in reduced viewport')
            client.call('Emulation.setDeviceMetricsOverride',{'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
            ev("(async()=>{(0,eval)(await(await fetch('/tests/sidebar-background-regressions-v136.js')).text());return true})()")
            extra=ev('runSidebarBackgroundRegressionsV136()');records.append({'regressions':extra});failures.extend(extra['failures']);assertions+=extra['assertions']
        if args.extras_only:
            previous=json.loads((out/'manifest.json').read_text(encoding='utf-8'));records=previous['records']+records
        manifest={'phase':args.phase,'records':records,'assertions':assertions,'failures':failures,'fixture':fixture,'sourceHashes':{n:hashlib.sha256(((base/'before/assets'/n) if args.phase=='before' else root/n).read_bytes()).hexdigest() for n in ['app.js','style.css','index.html','settings-ui-v136.js','settings-v136.js','sw.js']}}
        filename=('subset-'+'-'.join(args.kinds)+'.json') if args.kinds else 'checks-results.json' if args.checks_only else 'quick-results.json' if args.quick else 'manifest.json'
        (out/filename).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        print(f'{len(records)} captures; {assertions} assertions; {len(failures)} failures',flush=True)
        for f in failures:print('FAIL '+f)
    finally:
        if client:
            try:client.call('Browser.close')
            except (OSError,EOFError):pass
            client.sock.close()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.terminate()
        server.shutdown();server.server_close()
sys.exit(1 if failures else 0)

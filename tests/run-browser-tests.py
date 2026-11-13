"""Isolated Chrome/real IndexedDB tests. Python standard library and CDP only."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen
from urllib.parse import urlparse
import functools, subprocess, tempfile, threading, json, socket, base64, os, struct, time, sys, argparse, traceback
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser()
parser.add_argument('--fixes-stage', choices=['1','2','3'], help='Run the requested F1–F10 regression stage in addition to the base harness')
parser.add_argument('--ui',action='store_true')
parser.add_argument('--scroll-buttons',action='store_true',help='Run v1.36.1 scroll button layout and behavior regressions')
parser.add_argument('--sidebar-hover',action='store_true',help='Run v1.36.1 sidebar hover, focus and touch regressions')
parser.add_argument('--thinking-startup',action='store_true',help='Run F3 on the real startup page with controlled OpenRouter responses')
parser.add_argument('--appearance-settings',action='store_true',help='Run F4 settings navigation and persistence on the real startup page')
parser.add_argument('--release-notes',action='store_true',help='Run startup and settings release notes on the real page')
parser.add_argument('--chat-search',action='store_true',help='Run chat and message search/replace on the real page')
parser.add_argument('--chat-search-screenshots',type=Path,help='Capture search and replacement panels during --chat-search')
parser.add_argument('--swipe-navigation',action='store_true',help='Run native touch and history navigation on the real page')
parser.add_argument('--attachments',action='store_true',help='Run direct file picker, drop, send and composer attachment layout tests')
parser.add_argument('--attachment-screenshots',type=Path,help='Capture composer attachment layouts during --attachments')
parser.add_argument('--memory-extraction',action='store_true',help='Run memory settings and mocked provider requests on the real startup page')
parser.add_argument('--api-settings',action='store_true',help='Run fresh API settings, autosave, reordering and responsive model picker')
parser.add_argument('--profiles',action='store_true',help='Run the 999-profile capacity, picker, icon and backup regressions')
parser.add_argument('--model-removal',action='store_true',help='Run F6 model removal with real dialogs, IndexedDB and two tabs')
parser.add_argument('--chat-parameters',action='store_true',help='Run F7 parameter editing, copying and generation on the real page')
parser.add_argument('--theme-color',action='store_true',help='Run v1.36.1 runtime PWA theme color regressions')
parser.add_argument('--dialogs',action='store_true',help='Run v1.36.1 native dialog and outside gesture regressions')
parser.add_argument('--safety',action='store_true',help='Run deterministic R1-R5 security and persistence regressions')
parser.add_argument('--dialog-races',action='store_true',help='Run deterministic F1/F2 dialog operation and gesture regressions')
parser.add_argument('--app-source',type=Path,help='Serve an alternate app.js snapshot for controlled before/after regressions')
parser.add_argument('--screenshots',action='store_true')
parser.add_argument('--sw',action='store_true')
parser.add_argument('--documents',action='store_true',help='Run the isolated document library, backup and Dropbox tests')
parser.add_argument('--document-search',action='store_true',help='Run document extraction, index and ranking tests')
parser.add_argument('--document-rag',action='store_true',help='Run RAG send, regeneration, persistence and security regressions')
parser.add_argument('--document-ui',action='store_true',help='Exercise the real library dialog in mobile and wide mode')
parser.add_argument('--project-ui',action='store_true',help='Exercise project navigation, membership, drafts and shared files')
parser.add_argument('--project-screenshots',type=Path,help='Capture the project home at the requested responsive widths')
parser.add_argument('--sw-diagnostics',type=Path,help='Write SW server, Console, Network and registration diagnostics')
parser.add_argument('--review',action='store_true',help='Run R01-R08 integration regressions')
parser.add_argument('--j',action='store_true',help='Run J01-J04 storage, wire and responsiveness regressions')
parser.add_argument('--integration',action='store_true',help='Run I01-I05 storage and continuation regressions')
parser.add_argument('--execution-screenshots',type=Path,help='Capture composer/model/Thinking review images in this workspace directory')
args=parser.parse_args()
if args.screenshots or args.sw or args.execution_screenshots:args.ui=True
if args.j:args.integration=True
if args.integration:args.ui=True;args.review=True
run_ui_matrix=args.ui
if args.scroll_buttons or args.sidebar_hover or args.theme_color or args.dialogs or args.safety or args.dialog_races or args.model_removal or args.chat_parameters or args.swipe_navigation or args.attachments or args.api_settings or args.profiles:args.ui=True

class CDP:
    def __init__(self, url):
        u=urlparse(url);self.sock=socket.create_connection((u.hostname,u.port),timeout=50);self.counter=0
        self.diagnostic_events=[]
        self.capture_diagnostics=False
        key=base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(f'GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        data=b''
        while b'\r\n\r\n' not in data: data+=self.sock.recv(1)
        if b'101' not in data: raise RuntimeError(data.decode())
    def read(self,n):
        data=b''
        while len(data)<n:
            chunk=self.sock.recv(n-len(data))
            if not chunk: raise EOFError()
            data+=chunk
        return data
    def send(self,method,params=None):
        self.counter+=1;ident=self.counter
        body=json.dumps({'id':ident,'method':method,'params':params or {}}).encode();mask=os.urandom(4)
        header=bytes([0x81,0x80|len(body)]) if len(body)<126 else bytes([0x81,0xfe])+struct.pack('!H',len(body))
        self.sock.sendall(header+mask+bytes(b^mask[i%4] for i,b in enumerate(body)))
        return ident
    def call(self,method,params=None):
        if self.capture_diagnostics and method in ['Network.emulateNetworkConditions','Network.setCacheDisabled']:
            self.diagnostic_events.append({'method':'command.'+method,'params':params})
        ident=self.send(method,params)
        while True:
            h=self.read(2);length=h[1]&127
            if length==126:length=struct.unpack('!H',self.read(2))[0]
            elif length==127:length=struct.unpack('!Q',self.read(8))[0]
            payload=self.read(length)
            if (h[0]&15)==8:raise EOFError()
            result=json.loads(payload)
            method=result.get('method','')
            if self.capture_diagnostics and (method == 'Page.fileChooserOpened' or method.startswith(('Network.','Runtime.console','Runtime.exception','ServiceWorker.'))):
                self.diagnostic_events.append(result)
            if result.get('method')=='Runtime.bindingCalled' and result.get('params',{}).get('name')=='testFocusTab':
                self.send('Page.bringToFront')
            if result.get('id')==ident:
                if 'error' in result:raise RuntimeError(result['error'])
                return result.get('result',{})

root=Path(__file__).resolve().parents[1]
chrome=Path('C:/Program Files/Google/Chrome/Application/chrome.exe')
class Handler(SimpleHTTPRequestHandler):
    sw_fault=None
    requests=[]
    def log_message(self,*args): pass
    def send_response(self,code,message=None):
        if hasattr(self,'request_diagnostic'):self.request_diagnostic['status']=code
        super().send_response(code,message)
    def do_GET(self):
        pathname=urlparse(self.path).path
        self.request_diagnostic={'path':self.path,'fault':Handler.sw_fault,'time':time.monotonic()}
        Handler.requests.append(self.request_diagnostic)
        if pathname=='/sw.js':
            # Test-only diagnostics: preserve the failure reason in the message
            # reply without changing the application worker on disk.
            body=(root/'sw.js').read_bytes().replace(
                b"catch { result = { status: 'cacheClearFailed'",
                b"catch (error) { result = { diagnostic: String(error), status: 'cacheClearFailed'")
            body=body.replace(b"throw new Error('App shell release integrity mismatch')",
                b"throw new Error('App shell release integrity mismatch: '+path)")
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        elif pathname=='/app.js' and args.app_source:
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(args.app_source.read_bytes())
        elif pathname=='/__sw-test-fault':
            Handler.sw_fault=urlparse(self.path).query or None
            self.send_response(200);self.end_headers();self.wfile.write(b'ok')
        elif pathname=='/__sw-test-health':
            self.send_response(200);self.end_headers();self.wfile.write(b'ok')
        elif pathname=='/candidate-sw-fixture.js':
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write((root/'sw.js').read_bytes())
        elif Handler.sw_fault and pathname in ['/','/index.html','/app.js','/style.css','/settings-v136.js']:
            fault=Handler.sw_fault
            if fault=='network' and pathname=='/settings-v136.js':self.send_error(503);return
            file=root/('index.html' if pathname=='/' else pathname[1:])
            body=file.read_bytes()
            if fault=='html' and pathname in ['/','/index.html']:body=body.replace(b'1.37.0',b'1.36.1')
            if fault=='javascript' and pathname=='/app.js':body=body.replace(b'1.37.0',b'1.36.1')
            if fault=='css' and pathname=='/style.css':body=b'/* stale stylesheet */'+body
            if fault=='reference' and pathname in ['/','/index.html']:body=body.replace(b'./app.js?v=1.37.0',b'./unlisted.js?v=1.37.0')
            self.send_response(200);self.send_header('Content-Type','text/html' if file.suffix=='.html' else 'text/css' if file.suffix=='.css' else 'text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        elif self.path=='/legacy-sw-fixture.js':
            legacy=subprocess.check_output(['git','show','198c8d5b3ff130034edd1250a965febe3d2aa6b9:sw.js'],cwd=root)
            self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8');self.end_headers();self.wfile.write(legacy)
        elif Handler.sw_fault=='document-parser' and pathname=='/vendor/document-analysis/text-parsers.js':
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers()
            self.wfile.write((root/pathname[1:]).read_bytes()+b'\n/* stale parser fixture */\n')
        else:super().do_GET()
class BrowserTestServer(ThreadingHTTPServer):
    # Installation fetches the shell in parallel, alongside control requests.
    request_queue_size=64


server=BrowserTestServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
server_thread=threading.Thread(target=server.serve_forever,daemon=True)
server_thread.start()
output='FAIL browser did not finish'
failure_diagnostics={}
with tempfile.TemporaryDirectory(prefix='chatai-v136-test-',ignore_cleanup_errors=True) as profile:
    proc=subprocess.Popen([str(chrome),'--headless=new','--disable-gpu','--no-first-run',
        '--disable-background-networking','--disable-extensions','--disable-breakpad','--disable-popup-blocking',
        '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW)
    client=None
    try:
        portfile=Path(profile)/'DevToolsActivePort'
        deadline=time.monotonic()+15
        while True:
            try:
                port=portfile.read_text().splitlines()[0]
                if port.isdigit():break
            except (FileNotFoundError,PermissionError,IndexError):pass
            if time.monotonic()>deadline:raise TimeoutError('Chrome debugging endpoint not ready')
            time.sleep(0.05)
        targets=json.load(urlopen(f'http://127.0.0.1:{port}/json/list'))
        client=CDP(next(t['webSocketDebuggerUrl'] for t in targets if t['type']=='page'))
        client.sock.settimeout(150)
        client.call('Runtime.enable')
        client.call('Runtime.addBinding',{'name':'testFocusTab'})
        client.call('Emulation.setDeviceMetricsOverride',{'width':1280,'height':900,'deviceScaleFactor':1,'mobile':False})
        startup_output=''
        if args.project_ui:
            from project_ui import run as run_project_ui
            startup_output+=run_project_ui(client, f'http://localhost:{server.server_port}/', args.project_screenshots)+'\n'
        if args.document_ui:
            from document_library_ui import run as run_document_library_ui
            startup_output+=run_document_library_ui(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.memory_extraction:
            from memory_extraction import run as run_memory_extraction
            startup_output+=run_memory_extraction(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.thinking_startup:
            from thinking_startup import run as run_thinking_startup
            startup_output+=run_thinking_startup(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.appearance_settings:
            from appearance_settings import run as run_appearance_settings
            startup_output+=run_appearance_settings(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.release_notes:
            from release_notes import run as run_release_notes
            startup_output+=run_release_notes(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.chat_search:
            from chat_search import run as run_chat_search
            startup_output+=run_chat_search(client, f'http://localhost:{server.server_port}/', args.chat_search_screenshots)+'\n'
        if args.attachments:
            from attachments import run as run_attachments
            startup_output+=run_attachments(client, f'http://localhost:{server.server_port}/', args.attachment_screenshots)+'\n'
        if args.swipe_navigation:
            from swipe_navigation import run as run_swipe_navigation
            startup_output+=run_swipe_navigation(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.profiles:
            from profiles import run as run_profiles
            startup_output+=run_profiles(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.api_settings:
            from api_settings import run as run_api_settings
            startup_output+=run_api_settings(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.model_removal:
            from model_removal import run as run_model_removal
            startup_output+=run_model_removal(client, f'http://localhost:{server.server_port}/')+'\n'
        if args.chat_parameters:
            from chat_parameters import run as run_chat_parameters
            startup_output+=run_chat_parameters(client, f'http://localhost:{server.server_port}/')+'\n'
        query='documents=1' if args.documents else 'document-search=1' if args.document_search else 'document-rag=1' if args.document_rag else (
            ('ui=1&' if args.ui else '')+('review=1&' if args.review else '')+
            ('integration=1&' if args.integration else '')+('j=1&' if args.j else '')+
            ('fixes-stage='+args.fixes_stage if args.fixes_stage else ''))
        client.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/tests/v136-browser.html?'+query})
        time.sleep(0.2)
        result=client.call('Runtime.evaluate',{'expression':'''(async()=>{
            const deadline=Date.now()+120000;
            while(Date.now()<deadline){const result=document.getElementById('test-results');if(result)return result.textContent;await new Promise(r=>setTimeout(r,50));}
            return 'FAIL timed out: '+document.documentElement.dataset.testStatus+' / J: '+document.documentElement.dataset.jStatus;
        })()''','awaitPromise':True,'returnByValue':True})
        output=startup_output+(result.get('result',{}).get('value') or 'FAIL '+json.dumps(result))
        if args.dialog_races and 'ALL PASSED' in output and 'FAIL' not in output:
            source=(root/'tests/dialog-races-v1361.js').read_text(encoding='utf-8')
            races=client.call('Runtime.evaluate',{'expression':source+'\nrunDialogRacesV1361()','awaitPromise':True,'returnByValue':True})
            if 'exceptionDetails' in races:raise RuntimeError(races['exceptionDetails'])
            output+='\n'+races['result']['value']
            if 'FAIL' not in output:
                from dialog_races_v1361 import run as run_native_dialog_races
                output+='\n'+run_native_dialog_races(client)
        if args.safety and 'ALL PASSED' in output and 'FAIL' not in output:
            source=(root/'tests/safety-v1361.js').read_text(encoding='utf-8')
            safety=client.call('Runtime.evaluate',{'expression':source+'\nrunSafetyV1361()','awaitPromise':True,'returnByValue':True})
            if 'exceptionDetails' in safety:raise RuntimeError(safety['exceptionDetails'])
            output+='\n'+safety['result']['value']
        if args.dialogs and 'ALL PASSED' in output and 'FAIL' not in output:
            from dialog_ui_v1361 import run as run_dialog_ui
            output+='\n'+run_dialog_ui(client,root)
        if args.theme_color and 'ALL PASSED' in output and 'FAIL' not in output:
            source=(root/'tests/theme-color-v1361.js').read_text(encoding='utf-8')
            color=client.call('Runtime.evaluate',{'expression':source+'\nrunThemeColorV1361()','awaitPromise':True,'returnByValue':True})
            if 'exceptionDetails' in color:raise RuntimeError(color['exceptionDetails'])
            details=color['result']['value'];directory=root/'docs'/'theme-color-v1361';directory.mkdir(exist_ok=True)
            (directory/'results.json').write_text(json.dumps(details,ensure_ascii=False,indent=2),encoding='utf-8')
            output+=f"\nALL PASSED ({details['assertions']} runtime theme color assertions; light/dark, header/accent independence, settings reload, CSS source)"
        if args.sidebar_hover and 'ALL PASSED' in output and 'FAIL' not in output:
            from sidebar_hover_v1361 import run as run_sidebar_hover
            output+='\n'+run_sidebar_hover(client,root)
        if args.scroll_buttons and 'ALL PASSED' in output and 'FAIL' not in output:
            def scroll_eval(expression):
                result=client.call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in result:raise RuntimeError(result['exceptionDetails'])
                return result.get('result',{}).get('value')
            scroll_eval((root/'tests/scroll-button-v1361.js').read_text(encoding='utf-8'))
            directory=root/'docs'/'scroll-button-v1361';directory.mkdir(exist_ok=True)
            scroll_checks=0;matrix=[]
            for width,wide in [(360,True),(390,True),(768,True),(1024,True),(1280,True),(1440,True),(1280,False)]:
                client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<800})
                client.call('Emulation.setTouchEmulationEnabled',{'enabled':width<800})
                for dark in [False,True]:
                    scroll_eval(f'prepareScrollButtonV1361({str(wide).lower()},{str(dark).lower()})')
                    measured=scroll_eval('runScrollButtonGeometryV1361()');scroll_checks+=measured['assertions']
                    matrix.append({'width':width,'wide':wide,'dark':dark,**measured})
                    r=measured['button'];point={'x':r['x']+r['width']/2,'y':r['y']+r['height']/2}
                    if width>=800:
                        client.call('Input.dispatchMouseEvent',{'type':'mouseMoved',**point})
                        scroll_checks+=scroll_eval('verifyScrollButtonHoverV1361()')
                    if width in [390,1280] and wide:
                        data=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})['data']
                        (directory/f'{width}-{"dark" if dark else "light"}.png').write_bytes(base64.b64decode(data))
                    if width<800:
                        client.call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
                        client.call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                    else:
                        client.call('Input.dispatchMouseEvent',{'type':'mousePressed',**point,'button':'left','clickCount':1})
                        client.call('Input.dispatchMouseEvent',{'type':'mouseReleased',**point,'button':'left','clickCount':1})
                    scroll_checks+=scroll_eval('verifyScrollButtonBottomV1361()')
                if width in [390,1024,1280] and wide:
                    scroll_checks+=scroll_eval('runScrollButtonBehaviorV1361()')
                if width==390:
                    scroll_eval('prepareScrollButtonV1361(true,false)')
                    scroll_checks+=scroll_eval('runScrollButtonKeyboardV1361()')
                    # Real browser viewport reduction in addition to visualViewport simulation.
                    client.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':500,'deviceScaleFactor':1,'mobile':True})
                    scroll_eval('prepareScrollButtonV1361(true,false)')
                    scroll_checks+=scroll_eval('runScrollButtonGeometryV1361()')['assertions']
            (directory/'results.json').write_text(json.dumps({'assertions':scroll_checks,'matrix':matrix},ensure_ascii=False,indent=2),encoding='utf-8')
            output+=f'\nALL PASSED ({scroll_checks} scroll button assertions; 14 width/wide/theme cases, reduced viewport and visual-only keyboard simulation)'
        if run_ui_matrix and 'ALL PASSED' in output and 'FAIL' not in output:
            checks=0
            for width in [360,390,768,1024,1280]:
                client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<800})
                value=client.call('Runtime.evaluate',{'expression':f'window.runSettingsViewportV136({width})','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in value:raise RuntimeError(value['exceptionDetails'])
                checks+=value['result']['value']
            output+=f'\nALL PASSED ({checks} responsive assertions across 360/390/768/1024/1280px)'
            client.call('Runtime.evaluate',{'expression':'window.prepareSettingsResizeV136()','awaitPromise':True,'returnByValue':True})
            for width in [390,1280]:
                client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<800})
                resized=client.call('Runtime.evaluate',{'expression':'window.verifySettingsResizeV136()','returnByValue':True})
                if 'exceptionDetails' in resized:raise RuntimeError(resized['exceptionDetails'])
            output+='\nALL PASSED (8 resize state/focus assertions)'
            client.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':500,'deviceScaleFactor':1,'mobile':True})
            reduced=client.call('Runtime.evaluate',{'expression':'window.runSettingsKeyboardV136()','awaitPromise':True,'returnByValue':True})
            if 'exceptionDetails' in reduced:raise RuntimeError(reduced['exceptionDetails'])
            output+=f"\nALL PASSED ({reduced['result']['value']} reduced-viewport assertions)"
            # Native touch and key dispatch exercise browser input semantics, beyond JS .click().
            native_checks=0
            for width in [360,390,768,1280]:
                client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<800})
                client.call('Emulation.setTouchEmulationEnabled',{'enabled':width<800})
                opened=client.call('Runtime.evaluate',{'expression':"(async()=>{await uiUtilsV136.showScreen('chat',true);return document.getElementById('chat-model-button').getBoundingClientRect().toJSON()})()",'awaitPromise':True,'returnByValue':True})
                rect=opened['result']['value'];point={'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2}
                if width<800:
                    client.call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
                    client.call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                else:
                    client.call('Input.dispatchMouseEvent',{'type':'mousePressed',**point,'button':'left','clickCount':1})
                    client.call('Input.dispatchMouseEvent',{'type':'mouseReleased',**point,'button':'left','clickCount':1})
                visible=client.call('Runtime.evaluate',{'expression':'!!settingsUiV136.popover','returnByValue':True})
                if not visible['result']['value']:raise RuntimeError(f'{width}px native picker activation failed')
                rect=client.call('Runtime.evaluate',{'expression':"document.querySelector('.thinking-model-switch').getBoundingClientRect().toJSON()",'returnByValue':True})['result']['value']
                point={'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2}
                if width<800:
                    client.call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]});client.call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                else:
                    client.call('Input.dispatchMouseEvent',{'type':'mousePressed',**point,'button':'left','clickCount':1});client.call('Input.dispatchMouseEvent',{'type':'mouseReleased',**point,'button':'left','clickCount':1})
                client.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'ArrowDown','code':'ArrowDown','windowsVirtualKeyCode':40})
                focused=client.call('Runtime.evaluate',{'expression':"document.activeElement.matches('.model-picker-choice')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0",'returnByValue':True})
                if not focused['result']['value']:raise RuntimeError('native keyboard selection failed')
                client.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
                closed=client.call('Runtime.evaluate',{'expression':'!settingsUiV136.popover','returnByValue':True})
                if not closed['result']['value']:raise RuntimeError('native Escape failed')
                native_checks+=3
                def click_selector(selector):
                    rect=client.call('Runtime.evaluate',{'expression':f'document.querySelector({json.dumps(selector)}).getBoundingClientRect().toJSON()','returnByValue':True})['result']['value']
                    point={'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2}
                    if width<800:
                        client.call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
                        client.call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                    else:
                        client.call('Input.dispatchMouseEvent',{'type':'mousePressed',**point,'button':'left','clickCount':1})
                        client.call('Input.dispatchMouseEvent',{'type':'mouseReleased',**point,'button':'left','clickCount':1})
                def expect_native(expression,label):
                    result=client.call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True})
                    if 'exceptionDetails' in result or result.get('result',{}).get('value') is not True:raise RuntimeError(f'{width}px {label}: {result}')
                click_selector('#chat-model-button')
                expect_native("!!settingsUiV136.popover?.classList.contains('thinking-popover')&&!settingsUiV136.popover.querySelector('.model-picker-search')",'Thinking trigger opens only Thinking')
                expect_native("getComputedStyle(document.activeElement).outlineStyle==='none'&&getComputedStyle(document.activeElement.querySelector('.thinking-mark')).outlineStyle==='none'",'pointer opening leaves no visible keyboard-only ring')
                click_selector('.thinking-dot:first-child')
                expect_native("(async()=>{await settingsUiV136.saveQueue;return !!settingsUiV136.popover&&appLogic.getCurrentChatThinkingEffort()===appLogic.getModelThinkingCapability().levels[0]})()",'minimum endpoint saves')
                for level in ['low','medium','high']:
                    click_selector(f'.thinking-dot[data-level="{level}"]')
                    expect_native(f"(async()=>{{await settingsUiV136.saveQueue;return !!settingsUiV136.popover&&appLogic.getCurrentChatThinkingEffort()==='{level}'&&settingsUiV136.popover.querySelector('.thinking-level-name').textContent==='{level.title()}'}})()",'continuous pointer selection '+level)
                click_selector('.thinking-reset')
                expect_native("(async()=>{await settingsUiV136.saveQueue;return !!settingsUiV136.popover&&appLogic.getCurrentChatThinkingEffort()===appLogic.getModelThinkingCapability().defaultEffort})()",'reset stays open')
                click_selector('.thinking-dot:last-child')
                expect_native("(async()=>{await settingsUiV136.saveQueue;return !!settingsUiV136.popover&&appLogic.getCurrentChatThinkingEffort()===appLogic.getModelThinkingCapability().levels.at(-1)})()",'maximum endpoint saves')
                for key in ['Home','End']:
                    client.call('Input.dispatchKeyEvent',{'type':'keyDown','key':key,'code':key,'windowsVirtualKeyCode':36 if key=='Home' else 35})
                    index='0' if key=='Home' else 'appLogic.getModelThinkingCapability().levels.length-1'
                    expect_native(f"(async()=>{{await settingsUiV136.saveQueue;return !!settingsUiV136.popover&&appLogic.getCurrentChatThinkingEffort()===appLogic.getModelThinkingCapability().levels[{index}]}})()",'keyboard '+key+' saves endpoint')
                click_selector('#chat-model-button')
                expect_native('!settingsUiV136.popover','trigger toggles persistent panel closed')
                native_checks+=11
            client.call('Runtime.evaluate',{'expression':'''(async()=>{
                await uiUtilsV136.showScreen('settings',true);settingsUiV136.selectCategory('general',false);
                await appLogic.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});
                await appLogic.setCurrentChatThinkingEffort('minimal');
                const control=document.getElementById('settings-thinking-button');control.scrollIntoView({block:'center'});control.focus();return true;
            })()''','awaitPromise':True,'returnByValue':True})
            client.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'ArrowDown','code':'ArrowDown','windowsVirtualKeyCode':40})
            client.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'ArrowDown','code':'ArrowDown','windowsVirtualKeyCode':40})
            expect_native("(async()=>{await settingsUiV136.saveQueue;return appLogic.getCurrentChatThinkingEffort()==='low'&&document.getElementById('settings-thinking-button').value==='low'&&!settingsUiV136.popover})()",'native settings Thinking select saves with keyboard')
            rect=client.call('Runtime.evaluate',{'expression':"(()=>{const input=document.getElementById('proofreading-system-instruction');input.scrollIntoView({block:'center'});return input.getBoundingClientRect().toJSON()})()",'returnByValue':True})['result']['value']
            point={'x':rect['right']-4,'y':rect['bottom']-4}
            client.call('Input.dispatchMouseEvent',{'type':'mouseMoved',**point})
            client.call('Input.dispatchMouseEvent',{'type':'mousePressed',**point,'button':'left','clickCount':1})
            client.call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':point['x'],'y':point['y']+64,'button':'left','buttons':1})
            client.call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':point['x'],'y':point['y']+64,'button':'left','clickCount':1})
            expect_native(f"document.getElementById('proofreading-system-instruction').getBoundingClientRect().height>={rect['height']+32}&&document.getElementById('proofreading-system-instruction').getBoundingClientRect().height<=500",'native vertical prompt resize')
            client.call('Runtime.evaluate',{'expression':"settingsUiV136.selectCategory('other',false);const summary=document.querySelector('#data-danger-settings summary');summary.scrollIntoView({block:'center'});summary.focus();",'returnByValue':True})
            for expanded in [True,False]:
                client.call('Input.dispatchKeyEvent',{'type':'keyDown','key':' ','code':'Space','windowsVirtualKeyCode':32})
                client.call('Input.dispatchKeyEvent',{'type':'keyUp','key':' ','code':'Space','windowsVirtualKeyCode':32})
                expect_native(f"document.querySelector('#data-danger-settings details').open==={str(expanded).lower()}",'native danger disclosure keyboard toggle')
            native_checks+=4
            output+=f'\nALL PASSED ({native_checks} native touch/mouse/keyboard assertions)'
            if args.screenshots:
                directory=root/'docs'/'screenshots-v136';directory.mkdir(exist_ok=True)
                for width in [1280,390]:
                    client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<800})
                    for category in ['general','profile','integrations','other','model','thinking']:
                        prepared=client.call('Runtime.evaluate',{'expression':f'window.prepareSettingsScreenshotV136({json.dumps(category)})','awaitPromise':True,'returnByValue':True})
                        if 'exceptionDetails' in prepared:raise RuntimeError(prepared['exceptionDetails'])
                        shot=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                        (directory/f'{width}-{category}.png').write_bytes(base64.b64decode(shot['data']))
                    client.call('Runtime.evaluate',{'expression':"window.prepareSettingsScreenshotV136('general',true)",'awaitPromise':True,'returnByValue':True})
                    shot=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                    (directory/f'{width}-general-dark.png').write_bytes(base64.b64decode(shot['data']))
                output+='\nSaved 14 UI screenshots'
            if args.execution_screenshots:
                directory=(root/args.execution_screenshots).resolve()
                directory.relative_to(root) # Review artifacts must stay in the workspace.
                directory.mkdir(parents=True,exist_ok=True)
                cases=[(w,900,c,True) for w in [1280,390] for c in ['composer','model','thinking','thinking-settings']]
                cases += [(360,900,'thinking',True),(768,900,'thinking',True),(390,500,'thinking',True)]
                cases += [(w,900,'thinking',False) for w in [1280,390]]
                cases += [(1280,900,c,True) for c in ['hover-model','hover-thinking']]
                cases += [(w,900,c,True) for w in [1280,390] for c in ['thinking-2','thinking-4','thinking-6']]
                cases += [(390,900,c,True) for c in ['thinking-low','thinking-high']]
                cases += [(w,900,c,True) for w in [1280,390,360] for c in ['font-deepseek','font-openrouter','font-descenders']]
                for width,height,category,dark in cases:
                    client.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<800})
                    client.call('Emulation.setTouchEmulationEnabled',{'enabled':width<800})
                    client.call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':0,'y':0})
                    prepared=client.call('Runtime.evaluate',{'expression':f'window.prepareSettingsScreenshotV136({json.dumps(category)},{json.dumps(dark)},true)','awaitPromise':True,'returnByValue':True})
                    if 'exceptionDetails' in prepared:raise RuntimeError(prepared['exceptionDetails'])
                    trigger=prepared.get('result',{}).get('value')
                    if trigger:click_selector('#'+trigger)
                    if category=='model':click_selector('.thinking-model-switch')
                    if category.startswith('hover-'):
                        ident='chat-model-button' if category=='hover-model' else 'chat-model-button'
                        rect=client.call('Runtime.evaluate',{'expression':f'document.getElementById({json.dumps(ident)}).getBoundingClientRect().toJSON()','returnByValue':True})['result']['value']
                        client.call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2})
                        time.sleep(.2)
                    shot=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                    name=f'{width}x{height}-{category}-'+('dark' if dark else 'light')
                    (directory/f'{name}.png').write_bytes(base64.b64decode(shot['data']))
                    if width in [1280,390] and height==900 and category=='thinking' and dark:
                        # Capture a readable detail directly from Chrome; keep the full viewport as evidence too.
                        clip=client.call('Runtime.evaluate',{'expression':'''(()=>{
                            const footer=document.querySelector('.chat-input-area').getBoundingClientRect(),panel=settingsUiV136.popover.getBoundingClientRect();
                            const x=Math.max(0,Math.min(footer.left,panel.left)-12),y=Math.max(0,Math.min(footer.top,panel.top)-12);
                            return {x,y,width:Math.min(innerWidth,Math.max(footer.right,panel.right)+12)-x,height:Math.min(innerHeight,footer.bottom+12)-y,scale:1};
                        })()''','returnByValue':True})['result']['value']
                        detail=client.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False,'clip':clip})
                        (directory/f'{name}-detail.png').write_bytes(base64.b64decode(detail['data']))
                output+=f'\nSaved {len(cases)} full execution UI screenshots and 2 Chrome detail captures to {directory}'
            if args.sw:
                client.capture_diagnostics=True
                client.call('Network.enable')
                client.call('ServiceWorker.enable')
                upgrade=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const controlledBy=suffix=>new Promise((resolve,reject)=>{
                        const check=()=>{
                            const worker=navigator.serviceWorker.controller;
                            if(!worker?.scriptURL.endsWith(suffix))return;
                            if(worker.state!=='activated'){worker.addEventListener('statechange',check,{once:true});return;}
                            clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',check);resolve();
                        };
                        const timer=setTimeout(()=>reject(new Error('worker activation timeout')),10000);
                        navigator.serviceWorker.addEventListener('controllerchange',check);check();
                    });
                    await navigator.serviceWorker.register('/legacy-sw-fixture.js',{scope:'/'});await controlledBy('/legacy-sw-fixture.js');
                    await caches.open('unrelated-cache');
                    const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});
                    const candidate=registration.installing||registration.waiting;
                    if(candidate){
                        if(candidate.state!=='installed')await new Promise((resolve,reject)=>{
                            const timer=setTimeout(()=>reject(new Error('worker install timeout')),10000);
                            candidate.addEventListener('statechange',()=>{
                                if(candidate.state==='installed'){clearTimeout(timer);resolve();}
                                else if(candidate.state==='redundant'){clearTimeout(timer);reject(new Error('worker install rejected'));}
                            });
                        });
                        candidate.postMessage({action:'skipWaiting'});
                    }
                    await controlledBy('/sw.js');
                    const names=await caches.keys();
                    if(names.includes('chatai-pwa-cache-v1.35.1')||!names.includes('chatai-pwa-cache-v1.37.0')||!names.includes('unrelated-cache')){
                        throw new Error('cache upgrade mismatch: '+JSON.stringify(names));
                    }
                    const primary=await caches.open('chatai-pwa-cache-v1.37.0');
                    const pointer=await primary.match(new URL('/.__active_app_shell__',location.href));
                    const shell=pointer?await caches.open(await pointer.text()):primary;
                    for(const asset of ['app.js','style.css','settings-v136.js','settings-ui-v136.js'])if(!await shell.match('/'+asset+'?v=1.37.0'))throw new Error('missing versioned asset '+asset);
                    await dbUtils.saveSetting('localUiSettings',{...state.localUiSettings,lastSeenReleaseVersion:'1.37.0'});
                    await dbUtils.saveSetting('dropboxTokens',null);sessionStorage.removeItem('pendingVersionNotice');
                    return true;
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in upgrade:raise RuntimeError(upgrade['exceptionDetails'])
                client.call('Network.enable')
                failures=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const previous=navigator.serviceWorker.controller.scriptURL;
                    for(const fault of ['html','javascript','css','reference','network','document-parser']) {
                        await fetch('/__sw-test-fault?'+fault,{cache:'no-store'});
                        try {
                            const reg=await navigator.serviceWorker.register('/candidate-sw-fixture.js?'+fault,{scope:'/'});
                            const candidate=reg.installing||reg.waiting;
                            if(candidate)await new Promise((resolve,reject)=>{
                                const timer=setTimeout(()=>reject(new Error('candidate timeout: '+fault)),10000);
                                const check=()=>{if(candidate.state==='redundant'){clearTimeout(timer);resolve()}
                                    else if(candidate.state==='activated'){clearTimeout(timer);reject(new Error('mixed release activated: '+fault))}};
                                candidate.addEventListener('statechange',check);check();
                            });
                        } catch(error) {if(!String(error).includes('Failed to register'))throw error;}
                        finally {await fetch('/__sw-test-fault',{cache:'no-store'});}
                        if(navigator.serviceWorker.controller.scriptURL!==previous||(await navigator.serviceWorker.getRegistration()).active?.scriptURL!==previous)
                            throw new Error('old worker lost after '+fault);
                    }
                    return true;
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in failures:raise RuntimeError(failures['exceptionDetails'])
                output+='\nALL PASSED (N02 real SW normal install rejects stale HTML, JavaScript, CSS, document parser, unlisted references and network failures; previous worker retained)'
                client.call('Network.clearBrowserCache')
                client.call('Network.setCacheDisabled',{'cacheDisabled':True})
                client.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
                retained=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const frame=document.createElement('iframe');frame.hidden=true;frame.src='/';document.body.append(frame);
                    try {
                        const deadline=Date.now()+15000;
                        while(Date.now()<deadline){
                            const win=frame.contentWindow;
                            if(win?.state?.activeProfile&&win.appLogic?._setupEventListenersCallCount&&win.document.getElementById('app-version')?.textContent.includes('1.37.0'))return true;
                            await new Promise(r=>setTimeout(r,50));
                        }
                        throw new Error('previous shell failed offline after rejected updates');
                    }finally{frame.remove();}
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in retained:raise RuntimeError(retained['exceptionDetails'])
                client.call('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
                output+='\nALL PASSED (N02 previous app boots offline after rejected normal installs with HTTP cache disabled)'
                concurrent=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const peer=window.open('about:blank','sw-fetch-peer');
                    try {
                        const reads=Array.from({length:12},(_,i)=>(i%2?peer:window).fetch(location.origin+'/app.js?v=1.37.0',{cache:'no-store'}).then(async response=>{
                            if(!response.ok||!(await response.text()).includes('const APP_VERSION = "1.37.0";'))throw new Error('concurrent shell read failed');
                        }));
                        const channel=new MessageChannel(),updated=new Promise((resolve,reject)=>{
                            const timer=setTimeout(()=>reject(new Error('concurrent rebuild timeout')),15000);
                            channel.port1.onmessage=event=>{clearTimeout(timer);event.data.status==='cacheCleared'?resolve():reject(new Error(JSON.stringify(event.data)))};
                        });
                        navigator.serviceWorker.controller.postMessage({action:'clearCache'},[channel.port2]);
                        await Promise.all([...reads,updated]);return true;
                    }finally{peer.close();}
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in concurrent:raise RuntimeError(concurrent['exceptionDetails'])
                output+='\nALL PASSED (N03 real SW parallel reads from two tabs during shell replacement; deterministic paused-pointer order tested separately in VM)'
                rebuilt=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const channel=new MessageChannel();
                    const done=new Promise((resolve,reject)=>{
                        const timer=setTimeout(()=>reject(new Error('shell rebuild timeout')),15000);
                        channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data)};
                    });
                    navigator.serviceWorker.controller.postMessage({action:'clearCache'},[channel.port2]);
                    const result=await done;if(result.status!=='cacheCleared')throw new Error(JSON.stringify(result));
                    return true;
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in rebuilt:raise RuntimeError(rebuilt['exceptionDetails'])
                client.call('Network.clearBrowserCache')
                client.call('Network.setCacheDisabled',{'cacheDisabled':True})
                client.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/'})
                time.sleep(.3)
                boot_expression='''(async()=>{
                    const deadline=Date.now()+15000;
                    while(Date.now()<deadline){
                        if(window.state?.activeProfile&&window.settingsUiV136&&appLogic._setupEventListenersCallCount&&document.getElementById('app-version')?.textContent.includes('1.37.0')){
                            if(!document.getElementById('chat-model-button'))throw new Error('picker missing');
                            if(typeof window.DOMPurify?.sanitize!=='function')throw new Error('offline sanitizer missing');
                            if(typeof window.StreamingV136?.collectResponse!=='function')throw new Error('offline SSE module missing');
                            const clean=DOMPurify.sanitize('<b>offline sanitizer</b><img src=x onerror="alert(1)"><script>bad()</script>');
                            if(!clean.includes('<b>offline sanitizer</b>')||/onerror|<script/i.test(clean))throw new Error('offline sanitizer failed');
                            return 'app booted';
                        }
                        await new Promise(r=>setTimeout(r,50));
                    }
                    throw new Error('app initialization timed out');
                })()'''
                online=client.call('Runtime.evaluate',{'expression':boot_expression,'awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in online:raise RuntimeError(online['exceptionDetails'])
                offline_documents=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const documents=[];
                    for(const name of ['japanese.pdf','japanese.docx']){
                        const response=await fetch('/tests/fixtures/document-analysis/'+name);
                        if(!response.ok)throw new Error('Missing offline original fixture '+name);
                        documents.push(await dbUtils.addLibraryDocument(new File([await response.blob()],name)));
                    }
                    const chatId=908173;
                    await dbUtils.saveChat(null,{id:chatId,title:'Offline library fixture',messages:[]});
                    await dbUtils.setChatDocuments(chatId,documents.map(entry=>entry.id));
                    return chatId;
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in offline_documents:raise RuntimeError(offline_documents['exceptionDetails'])
                # Stop the actual HTTP server, then discard HTTP cache again. Only the
                # rebuilt Service Worker CacheStorage shell can satisfy the next boot.
                server.shutdown()
                client.call('Network.clearBrowserCache')
                client.call('ServiceWorker.enable')
                client.call('ServiceWorker.stopAllWorkers')
                client.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
                client.call('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/'})
                time.sleep(.3)
                offline=client.call('Runtime.evaluate',{'expression':boot_expression,'awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in offline:raise RuntimeError(offline['exceptionDetails'])
                output+='\nALL PASSED (legacy worker upgrade; R07 manual clear, online reboot, HTTP cache disabled/cleared, server and worker stopped, offline 1.37.0 boot with SSE module and DOMPurify sanitization)'
                offline_search=client.call('Runtime.evaluate',{'expression':'''(async()=>{
                    const result=await DocumentSearch.searchChat(908173,'返金申請の期限は購入日から何日以内？');
                    const match=result.results[0];
                    if(result.unavailable.length || match?.fileName!=='japanese.pdf' ||
                        match.location.page!==2 || !match.text.normalize('NFKC').includes('30日以内')){
                        throw new Error('Offline PDF or DOCX analysis failed: '+JSON.stringify(result));
                    }
                    const docx=(await dbUtils.getChatDocuments(908173)).find(doc=>doc.format==='docx');
                    const parsed=await DocumentSearch.previewDocument(docx);
                    if(!parsed.chunks.some(chunk=>chunk.location.table===1 && chunk.text.includes('オンライン窓口')))
                        throw new Error('Offline DOCX preview failed');
                    const session={chatId:908173,controller:new AbortController()};
                    DocumentRag.capture(session);
                    const instruction=await DocumentRag.build(session,'返金申請の期限は購入日から何日以内？',null);
                    if(!instruction.parts[0].text.includes('untrusted-document') ||
                        session.rag.sources[0].location.page!==2) throw new Error('Offline RAG context failed');
                    const until=async predicate=>{
                        const deadline=Date.now()+5000;
                        while(Date.now()<deadline){
                            const result=predicate();
                            if(result)return result;
                            await new Promise(resolve=>setTimeout(resolve,25));
                        }
                        throw new Error('Offline library UI timed out');
                    };
                    if(document.getElementById('chat-history-sidebar').getAttribute('aria-hidden')==='true')
                        document.getElementById('goto-history-btn').click();
                    if(document.getElementById('chat-history-sidebar').getAttribute('aria-hidden')!=='false')
                        throw new Error('Offline sidebar did not open');
                    document.getElementById('document-library-open').click();
                    const row=await until(()=>[...document.querySelectorAll('#document-library-list .document-library-file')]
                        .find(button=>button.title==='japanese.docx'));
                    if(document.getElementById('document-library-workspace').hidden || !row.querySelector('svg path[d]'))
                        throw new Error('Offline library workspace or file icon missing');
                    row.click();
                    await until(()=>document.getElementById('document-library-extracts').textContent.includes('オンライン窓口'));
                    const pdf=await until(()=>document.querySelector('#document-library-list button[title="japanese.pdf"]'));
                    pdf.click();
                    await until(()=>document.querySelector('#document-library-pdf-viewport canvas[aria-label="PDF ページ 1"]'));
                    document.getElementById('document-library-pdf-next').click();
                    await until(()=>document.querySelector('#document-library-pdf-viewport canvas[aria-label="PDF ページ 2"]'));
                    return true;
                })()''','awaitPromise':True,'returnByValue':True})
                if 'exceptionDetails' in offline_search:raise RuntimeError(offline_search['exceptionDetails'])
                output+='\nALL PASSED (Japanese PDF original pages, DOCX extraction, library search and local RAG context with server stopped)'
    except Exception as error:
        output+='\nFAIL '+repr(error)+'\n'+traceback.format_exc()
        if args.sw_diagnostics and client:
            try:
                failure_diagnostics['browser']=client.call('Runtime.evaluate',{'expression':'''(async()=>({
                    online:navigator.onLine,controller:navigator.serviceWorker.controller?.scriptURL,
                    workerState:navigator.serviceWorker.controller?.state,caches:await caches.keys()
                }))()''','awaitPromise':True,'returnByValue':True})
                with urlopen(f'http://127.0.0.1:{server.server_port}/__sw-test-health',timeout=5) as health:
                    failure_diagnostics['serverHealthStatus']=health.status
            except Exception as diagnostic_error:
                failure_diagnostics['captureError']=repr(diagnostic_error)
    finally:
        if args.sw_diagnostics:
            args.sw_diagnostics.parent.mkdir(parents=True,exist_ok=True)
            args.sw_diagnostics.write_text(json.dumps({'events':client.diagnostic_events if client else [],
                'httpRequests':Handler.requests,'serverThreadAlive':server_thread.is_alive(),
                'listenBacklog':server.request_queue_size,'serverSocket':server.socket.fileno(),
                'swFault':Handler.sw_fault,'failureState':failure_diagnostics,
                'output':output},ensure_ascii=False,indent=2),encoding='utf-8')
        if client:
            try:client.call('Browser.close')
            except (OSError,EOFError):pass
            client.sock.close()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.terminate()
print(output if 'FAIL' in output or args.review else '\n'.join(line for line in output.splitlines() if line.startswith('ALL PASSED') or line.startswith('Saved')))
server.shutdown()
sys.exit(0 if 'ALL PASSED' in output and 'FAIL' not in output else 1)

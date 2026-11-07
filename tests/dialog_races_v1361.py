"""Trusted browser input complements the gated F1/F2 event-order tests."""


def run(client):
    def ev(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def metrics(width, touch):
        client.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 844, 'deviceScaleFactor': 1, 'mobile': touch})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': touch})

    frame = 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
    try:
        metrics(1280, False)
        ev('''(async()=>{
            await uiUtilsV136.showScreen('chat',true);
            uiUtilsV136.renderChatMessages();
            const spacer=document.createElement('div');spacer.style.height='10000px';
            document.getElementById('message-container').append(spacer);
            document.querySelector('#chat-screen .main-content').scrollTop=0;
            await appLogic.openSystemPromptDialog();
            window.__f2LeakedClicks=0;
            window.__f2ClickListener=()=>window.__f2LeakedClicks++;
            document.body.addEventListener('click',window.__f2ClickListener);
        })()''')
        client.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': 3, 'y': 3, 'button': 'left', 'clickCount': 1})
        ev('''(async()=>{
            const scroller=document.querySelector('#chat-screen .main-content');
            if(scroller.scrollHeight<=scroller.clientHeight)throw new Error('Background is not scrollable');
            await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(new Error('No native background scroll event')),2000);
                scroller.addEventListener('scroll',()=>{clearTimeout(timer);resolve()},{once:true});
                scroller.scrollTop=100;
            });
            if(!document.getElementById('system-prompt-dialog').open)throw new Error('Closed before release');
        })()''')
        client.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': 3, 'y': 3, 'button': 'left', 'clickCount': 1})
        ev(frame)
        ev('''if(document.getElementById('system-prompt-dialog').open||state.isEditingSystemPrompt)throw new Error('Trusted outside click lost during background scroll');
            if(window.__f2LeakedClicks)throw new Error('Trusted click propagated behind the dialog');''')
        ev('document.body.removeEventListener("click",window.__f2ClickListener)')

        metrics(390, True)
        point = ev('''(async()=>{
            uiUtilsV136.renderChatMessages();await appLogic.openSystemPromptDialog();
            const editor=document.getElementById('system-prompt-editor');
            editor.value='Actual touch scroll contents\\n'.repeat(300);editor.scrollTop=0;
            const r=editor.getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-24};
        })()''')
        client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        for distance in [35, 75, 115]:
            client.call('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': point['x'], 'y': point['y']-distance}]})
            ev(frame)
        client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        ev(frame)
        ev('''if(document.getElementById('system-prompt-editor').scrollTop<=0)throw new Error('Native touch did not actually scroll');
            if(!document.getElementById('system-prompt-dialog').open||!state.isEditingSystemPrompt)throw new Error('Native touch scroll dismissed the editor');''')
        return 'ALL PASSED (6 native F2 assertions; real background scroll between mouse down/up, click suppression and actual touch scrolling)'
    finally:
        ev('''(async()=>{
            document.body.removeEventListener('click',window.__f2ClickListener);
            await appLogic.closeSystemPromptDialog();uiUtilsV136.renderChatMessages();
        })()''')
        metrics(1280, False)

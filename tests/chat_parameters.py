"""F7 in the real app with IndexedDB, controllable saves and mocked Gemini replies."""
import time


def run(client, url):
    def ev(expression):
        response = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in response:
            raise RuntimeError(response['exceptionDetails'])
        return response.get('result', {}).get('value')

    def boot(reload=False):
        previous = ev('performance.timeOrigin')
        client.call('Page.reload' if reload else 'Page.navigate', {} if reload else {'url': url + '?f7=1#chat'})
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if ev(f"performance.timeOrigin > {previous} && !!window.appLogic?._setupEventListenersCallCount && window.state?.currentScreen === 'chat'"):
                return
            time.sleep(0.1)
        raise AssertionError('F7 app startup did not complete')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    script = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': '''
        if (location.search === '?f7=1' && navigator.serviceWorker) {
            const worker = navigator.serviceWorker, listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => { if (type !== 'controllerchange') listen(type, ...args); };
        }
    '''})['identifier']
    try:
        boot()
        ev(r'''(async () => {
            const app = appLogic, db = dbUtils, st = state, ui = uiUtilsV136;
            const $ = id => document.getElementById(id);
            const assert = (value,label) => { if (!value) throw new Error(label); };
            const eq = (a,b,label) => assert(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify({a,b})}`);
            const wait = async (condition,label) => {
                const end = Date.now() + 5000;
                while (!await condition()) {
                    if (Date.now() > end) throw new Error(label);
                    await new Promise(resolve => setTimeout(resolve, 15));
                }
            };
            const input = (id,value) => { const field = $(id); field.value = value; field.dispatchEvent(new Event('input',{bubbles:true})); };
            const confirm = async accept => {
                await wait(() => $('confirmDialog').open,'Confirmation did not open');
                $('confirmDialog').querySelector(`[value=${accept ? 'ok' : 'cancel'}]`).click();
            };
            const snapshot = chat => [chat.systemPrompt, chat.generationParameters];
            const paramsA = {maxTokens:800,temperature:0.2,topK:20,topP:0.8};
            const paramsB = {maxTokens:900,temperature:0.6,topK:30,topP:null};
            const ref = {apiConfigId:'f7-gem',modelName:'gemini-2.5-flash'};
            const a = st.activeProfileId;
            await app.updateLocalUiSetting('lastSeenReleaseVersion',APP_VERSION);
            if ($('alertDialog').open) $('alertDialog').close('ok');
            await app.saveApiConfigs([{id:ref.apiConfigId,name:'F7 Gemini',provider:'gemini',apiKey:'fixture',modelCandidates:[ref.modelName]}]);
            await app.saveGlobalSettingsV136({enableThoughtTranslation:false,enableProofreading:false,enableChatTitleGeneration:false,enableStreamingOutput:false});
            await app.patchProfileSettingsV136(a,{systemPrompt:'Profile A',...paramsA,enableMemory:false});
            const b = await db.addProfile({name:'F7 Profile B',settings:{systemPrompt:'Profile B',...paramsB,enableMemory:false,topK:30}});
            await app.mutateProfileV136(b, p => ({...p,settings:{...p.settings,legacyCustomField:'keep',defaultModelRef:ref}}),undefined,{preserveStoredSettings:true});
            app.startNewChat(); await st.executionSettingsReady;
            eq([st.currentSystemPrompt,app.getChatGenerationParameters()],['Profile A',paramsA],'New chat copies profile defaults');
            const messages = [{role:'user',content:'original',timestamp:1},{role:'model',content:'existing',thoughtSummary:'history',usageMetadata:{promptTokenCount:7},timestamp:2}];
            await new Promise((resolve,reject) => {
                const tx=st.db.transaction('chats','readwrite');
                for(const [id,prompt] of [[701,'legacy chat prompt'],[702,'other chat prompt']]) {
                    tx.objectStore('chats').put({id,title:`F7 ${id}`,systemPrompt:prompt,messages,createdAt:id,updatedAt:id,
                        executionSettings:{schemaVersion:1,modelRef:ref,thinkingEffort:null}});
                }
                tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
            });
            assert((await app.loadChat(701,{scrollAfterLoad:false})).ok,'Legacy chat loads');
            const other = await db.getChat(702);
            eq([st.currentSystemPrompt,app.getChatGenerationParameters()],['legacy chat prompt',paramsA],'Legacy prompt retained with numeric profile fallback');
            assert(await app.openSystemPromptDialog(),'Editor opens');
            eq($('system-prompt-dialog-title').textContent,'パラメータ設定','Dialog title');
            assert(!$('system-prompt-save-status'),'No status field');
            input('system-prompt-editor','F7 custom');
            input('chat-max-tokens','321'); input('chat-temperature','0'); input('chat-top-k','7'); input('chat-top-p','');
            eq($('system-prompt-char-count').textContent,'9文字','Numeric input does not change character count');
            const custom = {maxTokens:321,temperature:0,topK:7,topP:null};
            assert((await db.getChat(701)).systemPrompt === 'legacy chat prompt','Debounce does not write immediately');
            await wait(async () => (await db.getChat(701)).systemPrompt === 'F7 custom','700ms save did not complete');
            eq(snapshot(await db.getChat(701)),['F7 custom',custom],'Autosave stores one snapshot including null and zero');
            input('chat-temperature','2.1');
            assert(!await app.closeSystemPromptDialog() && $('system-prompt-dialog').open,'Invalid number cannot close or save');
            eq(snapshot(await db.getChat(701)),['F7 custom',custom],'Invalid edit is not persisted');
            input('chat-temperature','0');
            const persist = db.saveChat;
            db.saveChat = async () => { throw new Error('F7 parameter write failed'); };
            try {
                input('chat-top-k','12');
                assert(!await app.closeSystemPromptDialog() && $('chat-top-k').value === '12' && $('chat-parameter-save-error'), 'Failed save keeps numeric input visible');
                eq(snapshot(await db.getChat(701)),['F7 custom',custom],'Failed numeric edit changes no persistent values');
            } finally { db.saveChat = persist; }
            input('chat-top-k','7');

            const profileBefore = await db.getProfile(a);
            let action = app.copyChatParameters('to-profile');
            assert(!await app.copyChatParameters('to-chat'),'A second transfer cannot overtake the first');
            await confirm(false);
            assert(!await action,'Cancelled profile copy');
            eq(await db.getProfile(a),profileBefore,'Cancellation leaves profile unchanged');
            action = app.copyChatParameters('to-chat'); await confirm(true);
            assert(await action,'Profile to chat copy completes');
            eq(snapshot(await db.getChat(701)),['Profile A',paramsA],'Profile values copied to the current chat');
            eq(await db.getProfile(a),profileBefore,'Profile-to-chat does not modify profile');

            const saveChat = db.saveChat;
            let release, entered;
            const savingStarted = new Promise(resolve => entered = resolve), blocked = new Promise(resolve => release = resolve);
            db.saveChat = async function(title, record, options) {
                if (options?.systemPromptSave?.value === 'slow A') { entered(); await blocked; }
                return saveChat.apply(this,arguments);
            };
            try {
                input('system-prompt-editor','slow A');
                const saving = app.saveCurrentSystemPrompt(); await savingStarted;
                input('system-prompt-editor','newer A'); input('chat-top-k','11');
                const switching = app.switchProfile(b);
                assert(st.activeProfileId === a,'Profile does not change while a save is pending');
                release(); await saving;
                assert(await switching,'Profile switches after the pending save');
            } finally { release(); db.saveChat = saveChat; }
            eq(snapshot(await db.getChat(701)),['Profile B',paramsB],'Switch wins over old saved values');
            eq([$('system-prompt-editor').value,$('chat-top-k').value],['Profile B','30'],'Open editor immediately shows the destination profile');

            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(value) {
                if (this.name === 'settings' && value.key === 'activeProfileId') throw new Error('F7 injected switch failure');
                return put.apply(this,arguments);
            };
            try {
                const failing = app.switchProfile(a);
                await wait(() => $('alertDialog').open,'Switch failure was not announced');
                $('alertDialog').close('ok');
                assert(!await failing,'Failed profile switch does not report success');
            } finally { IDBObjectStore.prototype.put = put; }
            eq([(await db.getSetting('activeProfileId')).value,st.activeProfileId],[b,b],'Active profile is rolled back');
            eq(snapshot(await db.getChat(701)),['Profile B',paramsB],'Chat snapshot is rolled back with profile');
            assert(await app.switchProfile(a),'Switch back to A');
            eq(snapshot(await db.getChat(701)),['Profile A',paramsA],'Switch back restores A values');
            assert(await app.switchProfile(b),'Switch to B for profile-copy test');

            input('system-prompt-editor','F7 custom');
            input('chat-max-tokens','321'); input('chat-temperature','0'); input('chat-top-k','7'); input('chat-top-p','');
            action = app.copyChatParameters('to-profile'); await confirm(true);
            assert(await action,'Chat-to-profile copy completes');
            const updated = (await db.getProfile(b)).settings;
            eq([updated.systemPrompt,SettingsV136.normalizeChatNumbers(updated)],['F7 custom',custom],'Current editor values are copied');
            eq([updated.defaultModelRef,updated.legacyCustomField,updated.enableMemory],[ref,'keep',false],'Unrelated profile settings are preserved');
            eq($('max-tokens').value,'321','Profile form synchronizes');
            eq(snapshot(await db.getChat(701)),['F7 custom',custom],'Profile copy leaves current chat values intact');
            eq((await db.getChat(701)).messages,messages,'Parameter writes never change conversation or metadata');
            eq(await db.getChat(702),other,'Other chat is unchanged');
            assert(await app.closeSystemPromptDialog(),'Close flushes settings');

            const fetchBefore = window.fetch, requests = [];
            window.fetch = async (url,options) => {
                if (!String(url).includes(':generateContent') || options?.method !== 'POST') return fetchBefore(url,options);
                requests.push(JSON.parse(options.body));
                return Response.json({candidates:[{content:{parts:[{text:'F7 answer'}]},finishReason:'STOP'}]});
            };
            try {
                await app.patchProfileSettingsV136(b,{temperature:1.8,maxTokens:1000});
                $('user-input').value='next';
                await app.handleSend();
                const retry = app.retryFromMessage(2); await confirm(true); await retry;
                eq(requests.length,2,'Normal send and retry produce two requests');
                for (const body of requests) {
                    eq([body.generationConfig.maxOutputTokens,body.generationConfig.temperature,body.generationConfig.topK],[321,0,7],'Actual request uses chat numeric values');
                    assert(!Object.hasOwn(body.generationConfig,'topP'),'Null Top P is omitted from the request');
                    eq(body.systemInstruction.parts[0].text,'F7 custom','Actual request uses chat system prompt');
                }
            } finally { window.fetch = fetchBefore; }
        })()''')
        client.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
        boot(reload=True)
        if not ev('''(async () => {
            const app = appLogic, menu = document.getElementById('chat-parameter-menu'), button = document.getElementById('chat-parameter-menu-btn');
            if (state.currentChatId !== 701 || !await app.openSystemPromptDialog()) return false;
            const value = id => document.getElementById(id).value;
            if (value('system-prompt-editor') !== 'F7 custom' || value('chat-temperature') !== '0' || value('chat-top-p') !== '') return false;
            button.click();
            const bounds = menu.getBoundingClientRect();
            if (menu.hidden || bounds.left < 0 || bounds.right > innerWidth) return false;
            document.querySelector('textarea.system-prompt-editor').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
            if (!menu.hidden) return false;
            button.click();
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
            return menu.hidden && document.getElementById('system-prompt-dialog').open && document.activeElement === button;
        })()'''):
            raise AssertionError('Reloaded parameter values or mobile menu behavior differed')
        return 'ALL PASSED (F7 real editor, IndexedDB snapshots, profile transfers and rollback, mocked send/retry payloads, mobile menu and reload)'
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})

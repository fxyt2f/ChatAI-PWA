"""F6 through the real API settings dialog and two Chrome tabs on the same IndexedDB."""
import time


def run(client, url):
    def ev(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    # The initial shell activation can reload a page once its dialogs close.
    # F6 exercises app/IDB behavior, with the worker integrity checked separately.
    script = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': '''
        if (location.search === '?f6=1') {
            const serviceWorker = navigator.serviceWorker;
            if (serviceWorker) {
                const listen = serviceWorker.addEventListener.bind(serviceWorker);
                serviceWorker.addEventListener = (type, ...args) => {
                    if (type !== 'controllerchange') listen(type, ...args);
                };
            }
        }
    '''})['identifier']
    try:
        previous = ev('performance.timeOrigin')
        client.call('Page.navigate', {'url': url + '?f6=1#settings/general'})
        deadline = time.monotonic() + 12
        while not ev(f"performance.timeOrigin > {previous} && !!window.appLogic?._setupEventListenersCallCount"):
            if time.monotonic() >= deadline:
                raise AssertionError('F6 app startup did not complete')
            time.sleep(0.1)

        return ev(r'''(async () => {
            const app = appLogic, db = dbUtils, ui = uiUtilsV136, st = state, S = SettingsV136;
            const $ = id => document.getElementById(id);
            const stage = value => sessionStorage.setItem('f6-test-stage', value);
            const assert = (value, label) => { if (!value) throw new Error(label); };
            const eq = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), label);
            const wait = async (predicate, label) => {
                const limit = Date.now() + 5000;
                while (!await predicate()) {
                    if (Date.now() > limit) throw new Error(label);
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            };
            const a = (modelName) => ({apiConfigId: 'f6-a', modelName});
            const b = {apiConfigId: 'f6-b', modelName: 'shared'};
            const execution = modelRef => ({schemaVersion: 1, modelRef, thinkingEffort: 'high', updatedAt: 1});
            const names = async () => app.getApiConfigModelCandidates((await db.getSetting('apiConfigs')).value.find(config => config.id === 'f6-a'));
            const settings = async () => (await db.getSetting(S.GLOBAL_KEY)).value;
            const snapshot = async () => [await db.getSetting('apiConfigs'), await settings(), await db.getAllProfiles(), await db.getAllChats(), await db.getAllMemories()];
            const setNames = value => { $('api-config-additional-models').value = value; };
            const confirm = () => wait(() => $('confirmDialog').open, 'F6 impact dialog did not open');
            const approve = () => $('confirmDialog').querySelector('[value=ok]').click();
            const cancel = () => $('confirmDialog').querySelector('[value=cancel]').click();
            const alert = async expected => {
                await wait(() => $('alertDialog').open, 'Expected failure dialog did not open: ' + expected);
                assert($('alertDialog').textContent.includes(expected), 'Failure dialog: ' + $('alertDialog').textContent);
                $('alertDialog').close('ok');
            };
            const addLegacyProfile = (database, profile) => new Promise((resolve,reject) => {
                const tx = database.transaction('profiles','readwrite');
                const request = tx.objectStore('profiles').add(profile);
                tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error);
            });
            stage('seed');
            await app.updateLocalUiSetting('lastSeenReleaseVersion', APP_VERSION);
            if ($('alertDialog').open) $('alertDialog').close('ok');
            await app.saveApiConfigs([
                {id:'f6-a', name:'F6 A', provider:'gemini', apiKey:'fixture', modelCandidates:['shared','second','unused','survivor']},
                {id:'f6-b', name:'F6 B', provider:'gemini', apiKey:'fixture', modelCandidates:['shared']}
            ]);
            await app.saveGlobalSettingsV136({thoughtTranslationModelRef:a('shared'), thoughtTranslationModel:'shared',
                proofreadingModelRef:b, proofreadingModelName:'shared', summaryModelRef:a('second'), chatTitleModelRef:a('shared'),
                memoryModelRef:a('shared'), sdQcModelRef:null, sdQcModel:'second', sdPromptImproveModelRef:a('second')});
            await db.saveSetting(S.SUCCESS_KEY, {modelRef:a('shared'), completedAt:1});
            const other = await addLegacyProfile(st.db, {name:'F6 他プロファイル',settings:{defaultModelRef:a('second'), apiConfigId:'f6-a', modelName:'second'}});
            await db.saveMemory(other, {items:['保存済み記憶']});
            const history = [{role:'user',content:'質問',attachments:[{name:'fixture',mimeType:'text/plain',base64Data:'QQ=='}]},
                {role:'model',content:'応答',thoughtSummary:'思考',executedFunctions:[{name:'test',result:{ok:true}}],
                    usageMetadata:{tmExecution:{...a('shared'),tokens:42},promptTokenCount:7}}];
            const createChat = (id, title, ref) => ({id,title,profileId:st.activeProfileId,createdAt:id,updatedAt:id,
                messages:structuredClone(history), ...(ref && {executionSettings:execution(ref)})});
            await new Promise((resolve,reject) => {
                const tx = st.db.transaction('chats','readwrite');
                for (const chat of [createChat(601,'F6 current',a('shared')),createChat(602,'F6 legacy',null),createChat(603,'F6 other API',b)])
                    tx.objectStore('chats').put(chat);
                tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
            });
            assert((await app.loadChat(601,{scrollAfterLoad:false})).ok,'Load target chat');

            app.openApiConfigDialog('f6-a');
            setNames('shared\nsecond\nsurvivor\nnew');
            await app.saveApiConfigFromDialog();
            eq(await names(),['shared','second','survivor','new'],'Unused removal plus addition saved without a confirmation');
            app.openApiConfigDialog('f6-a');
            setNames('survivor\nnew');
            const before = await snapshot(), oldChat = await db.getChat(601), oldConfigs = (await db.getSetting('apiConfigs')).value;
            let operation = app.saveApiConfigFromDialog();
            await confirm();
            const impact = $('confirmDialog').textContent;
            for (const text of ['モデルを削除','shared','second','思考翻訳モデル','記憶抽出モデル','F6 他プロファイル','保存済みチャット 2 件','画像クオリティチェッカー'])
                assert(impact.includes(text), 'Impact missing: ' + text);
            assert(!impact.includes('校正モデル'),'Other API with same model is outside the impact');
            cancel(); await operation;
            eq(await snapshot(),before,'Cancel keeps all persistent records');
            eq(app.getCurrentChatModelRef(),a('shared'),'Cancel keeps the current chat model');

            const peer = window.open('/?f6=peer#settings/general','f6-peer');
            try {
                stage('peer ready');
                await wait(() => peer.appLogic?._setupEventListenersCallCount, 'Peer tab did not boot');
                window.testFocusTab('f6');
                await wait(() => document.hasFocus(), 'Main dialog tab did not regain focus');
                peer.appLogic.startNewChat();
                await peer.state.executionSettingsReady;
                await peer.appLogic.setCurrentChatModelRef(a('second'));
                stage('reference added before commit');
                operation = app.saveApiConfigFromDialog();
                await confirm();
                assert($('confirmDialog').textContent.includes('別タブの未送信チャット'),'Peer draft is included in the impact');
                const added = await addLegacyProfile(peer.state.db, {name:'F6 concurrent',settings:{defaultModelRef:a('second')}});
                approve(); await alert('使用箇所が変更されました'); await operation;
                eq(await names(),['shared','second','survivor','new'],'New peer reference forces reconfirmation without a partial write');
                await db.deleteProfile(added);

                stage('write failure');
                operation = app.saveApiConfigFromDialog();
                await confirm();
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function(value) {
                    if (this.name === 'chats' && value.id === 601) throw new Error('F6 injected failure');
                    return put.apply(this, arguments);
                };
                try { approve(); await alert('F6 injected failure'); await operation; }
                finally { IDBObjectStore.prototype.put = put; }
                eq(await snapshot(),before,'A failed chat write rolls back candidates, global references and profiles');

                stage('successful removal');
                operation = app.saveApiConfigFromDialog();
                await confirm(); approve(); await operation;
                eq(await names(),['survivor','new'],'Both selected candidates removed');
                const global = await settings();
                for (const key of ['thoughtTranslationModelRef','summaryModelRef','chatTitleModelRef','memoryModelRef','sdQcModelRef','sdPromptImproveModelRef'])
                    eq(global[key],null,'Unset global ' + key);
                eq(global.sdQcModel,'','Old name cannot revive a removed model');
                eq(global.proofreadingModelRef,b,'Same model name on the other API survives');
                eq((await db.getProfile(other)).settings.defaultModelRef,null,'Inactive profile model is cleared');
                eq((await db.getMemory(other)).items,['保存済み記憶'],'Memory is unchanged');
                for (const id of [601,602]) {
                    const chat = await db.getChat(id);
                    eq(chat.executionSettings.modelRef,null,'Saved next execution model is unset');
                    eq(chat.messages,history,'History and execution metadata remain identical');
                }
                eq((await db.getChat(603)).executionSettings.modelRef,b,'Other API chat remains intact');
                eq(app.getCurrentChatModelRef(),null,'Current chat is unset');
                eq($('model-name').value,'','Basic settings do not select a replacement');
                eq($('memory-extraction-model').value,'','Auxiliary settings show unset');
                await wait(() => peer.appLogic.getCurrentChatModelRef() === null && peer.appLogic.readExecutionDraft()?.modelRef === null,
                    'Peer draft is cleared by the update notification');

                let rejected = false;
                try { await peer.appLogic.saveGlobalSettingsV136({memoryModelRef:a('shared')}); }
                catch { rejected = true; }
                assert(rejected && (await settings()).memoryModelRef === null,'A queued peer selection cannot revive an auxiliary reference');
                await peer.dbUtils.saveChat(null, oldChat, {existingSnapshot:true,skipPush:true,
                    successfulExecution:{modelRef:a('shared'),completedAt:Date.now()}});
                eq((await db.getChat(601)).executionSettings.modelRef,null,'Stale chat snapshot cannot restore a removed selection');
                eq((await db.getChat(601)).messages,history,'Stale response save retains its execution history');
                eq((await db.getSetting(S.SUCCESS_KEY)).value.modelRef,null,'An in-flight response does not revive a new-chat default');
                const staleOtherSelection = {...await db.getChat(601), executionSettings:execution(b)};
                await peer.dbUtils.saveChat(null, staleOtherSelection, {existingSnapshot:true,skipPush:true});
                eq((await db.getChat(601)).executionSettings.modelRef,null,'Content saves cannot replace unset with another API model');
                await peer.appLogic.saveApiConfigs(oldConfigs);
                eq(await names(),['survivor','new'],'Stale configuration save cannot restore removed candidates');

                stage('draft reload');
                const oldPage = peer.performance.timeOrigin;
                peer.location.reload();
                await wait(() => peer.performance.timeOrigin > oldPage && peer.appLogic?._setupEventListenersCallCount,'Peer reload did not finish');
                eq(peer.appLogic.getCurrentChatModelRef(),null,'Reloaded draft remains unset');
                eq(peer.appLogic.readExecutionDraft()?.modelRef,null,'Persisted draft retains the unset choice');

                const fetchBefore = window.fetch, alertBefore = ui.showCustomAlert;
                let sent = 0, notice = '';
                window.fetch = async () => { sent++; throw new Error('Unexpected request'); };
                ui.showCustomAlert = async message => { notice = message; };
                try {
                    $('user-input').value = '未設定の送信';
                    await app.handleSend();
                    assert(sent === 0 && notice.includes('モデルが選択されていません'),'Next send requires an explicit model');
                } finally { window.fetch = fetchBefore; ui.showCustomAlert = alertBefore; }

                app.openApiConfigDialog('f6-a'); setNames('');
                await app.saveApiConfigFromDialog();
                eq(await names(),[],'Empty candidate list stays empty');
                assert(!app.buildModelRefOptions().some(choice => choice.apiConfigId === 'f6-a'),'Empty route contributes no synthetic candidates');
                assert(await app.switchProfile(other),'A parameter-only switch tolerates a peer content save');
                eq(app.getCurrentChatModelRef(),null,'Switching profiles does not select a replacement');
                assert((await app.loadChat(602,{scrollAfterLoad:false})).ok && app.getCurrentChatModelRef() === null,
                    'Loading a legacy chat uses the cleared execution record instead of historical metadata');
                return 'ALL PASSED (F6 real confirmation, atomic rollback, history preservation, draft reload and cross-tab stale writes)';
            } finally { peer.close(); }
        })()''')
    except RuntimeError as error:
        last_stage = ev("sessionStorage.getItem('f6-test-stage')")
        raise RuntimeError(f'F6 stage {last_stage}: {error}') from error
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})
        client.call('Network.setBlockedURLs', {'urls': []})

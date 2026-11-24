"""Local startup and sync integration with delayed Dropbox in the real app."""
import time
import json
import threading


def run(client, url):
    def ev(expression):
        response = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in response:
            raise RuntimeError(response['exceptionDetails'])
        return response.get('result', {}).get('value')

    def wait(expression):
        for _ in range(320):
            try:
                result = ev(expression)
            except RuntimeError as error:
                if not any(term in str(error) for term in ('navigated', 'context was destroyed', 'Cannot find context')):
                    raise
                continue
            if result:
                return result
            time.sleep(.025)
        raise AssertionError((expression, ev("""({
            url: location.href, dialogs: [...document.querySelectorAll('dialog[open]')].map(x=>x.id),
            loaded: window.appLogic?._setupEventListenersCallCount, started: window.localSyncFixture?.checks,
            error: window.state?.sync?.lastError?.message
        })""")))

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    script = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': '''
        (() => {
        if (!location.search.startsWith('?local-first=')) return;
        if (navigator.serviceWorker) {
            const sw = navigator.serviceWorker, listen = sw.addEventListener.bind(sw);
            sw.addEventListener = (type, ...args) => { if (type !== 'controllerchange') listen(type, ...args); };
        }
        window.localSyncFixture = { checks: 0, originals:new Map(), pause: ms => new Promise(resolve => setTimeout(resolve, ms)) };
        const fixture = window.localSyncFixture;
        let api;
        Object.defineProperty(window, 'dropboxApi', {
            get: () => api,
            set: value => {
                api = value;
                api.testConnection = async () => { await fixture.pause(250); return { name: { display_name: 'Fixture' } }; };
                api.checkLockFile = async () => {
                    fixture.checks++;
                    await fixture.pause(1250);
                    if (location.search.endsWith('failure')) throw new Error('controlled Dropbox failure');
                    fixture.checkFinished = performance.now();
                    return null;
                };
                api.uploadLockFile = api.deleteLockFile = async () => {};
                api.ensureAssetsFolderExists = async () => {};
                api.uploadLibraryOriginal = async (id, blob) => fixture.originals.set(id,blob);
                api.downloadLibraryOriginal = async id => { await fixture.pause(80); return fixture.originals.get(id); };
                api.getMetadataRevision = async () => fixture.head?.rev ?? null;
                api.downloadMetadata = async () => { await fixture.pause(250); return fixture.head ?? null; };
                api.uploadMetadata = async (content, rev) => {
                    if (rev !== (fixture.head?.rev ?? null)) throw Error('incorrect revision');
                    fixture.head = { content, rev: String(Number(rev || 0) + 1) };
                    return { rev: fixture.head.rev };
                };
                api.downloadInputDraftFromDropbox = async () => null;
                api.uploadInputDraftToDropbox = async () => {};
            }
        });
        })();
    '''})['identifier']
    def ready(mode):
        return (f"location.search === '?local-first={mode}' && window.localSyncFixture && "
                "window.appLogic?._setupEventListenersCallCount && !document.querySelector('#progressDialog[open]') && performance.now()")
    try:
        client.call('Page.navigate', {'url': url + '?local-first=seed'})
        wait(ready('seed'))
        ev("""(async () => {
            document.querySelector('#releaseNotesDialog[open] .dialog-ok-btn')?.click();
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', '1.38.3');
            const executionSettings = { schemaVersion:1, modelRef:null, thinkingEffort:null };
            const id = await dbUtils.saveChat(null,{title:'Local startup chat',executionSettings,messages:[{role:'user',content:'local history'}]}, {skipPush:true});
            await dbUtils.saveChat(null,{title:'Second chat',createdAt:1,updatedAt:1,executionSettings,messages:[{role:'user',content:'second history'}]}, {skipPush:true});
            await appLogic.loadChat(id);
            await dbUtils.saveSetting('dropboxTokens',{access_token:'fixture'});
        })()""")
        client.call('Page.navigate', {'url': url + '?local-first=delayed'})
        ready_ms = wait(ready('delayed'))
        check_at_ready = ev('localSyncFixture.checkFinished ?? null')
        assert check_at_ready is None, (check_at_ready, ready_ms)
        actual = ev("({id:state.currentChatId, content:state.currentMessages[0]?.content, draft:!!appLogic.readExecutionDraft()})")
        assert actual.get('content') == 'local history', actual
        ev("""(() => {
            const input = document.getElementById('user-input');
            input.focus();
            input.value = 'typing before Dropbox responds';
            input.dispatchEvent(new Event('input', {bubbles:true}));
        })()""")
        sync_ms = wait('localSyncFixture.head && !state.sync.isSyncing && performance.now()')
        asset_ms, serial_asset_ms = ev("""(async () => {
            const fixture = localSyncFixture;
            window.dropboxApi.downloadAsset = async id => { await fixture.pause(110); return new Blob([id]); };
            const ids = Array.from({length: 6}, (_, i) => 'fixture-' + i);
            const data = { chats:[{messages:[{imageIds:ids}]}] };
            let now = performance.now();
            for (const id of ids) await DocumentLibrary.digest(await window.dropboxApi.downloadAsset(id));
            const serial = performance.now()-now;
            now = performance.now();
            await appLogic.prepareDropboxMergeAssets(data,{data},{localAssets:new Map()},async () => {});
            return [performance.now()-now, serial];
        })()""")
        merge_ms, apply_ms, original_ms = ev("""(async () => {
            const fixture = localSyncFixture, input = document.getElementById('user-input');
            const before = performance.timeOrigin, id = state.currentChatId;
            const assert = (ok, label) => { if (!ok) throw Error(label); };
            const modify = (key, change) => {
                const envelope = JSON.parse(fixture.head.content);
                envelope.syncId = key;
                change(envelope);
                fixture.head = { content:JSON.stringify(envelope), rev:String(Number(fixture.head.rev)+1) };
            };
            const awaitView = async predicate => {
                for (let i=0; i<150 && !predicate(); i++) await fixture.pause(15);
                assert(predicate(), 'the view did not refresh');
            };
            modify('cloud-edited-current-chat', cloud => {
                const chat = cloud.data.chats.find(row => row.id === id);
                chat.title = 'Remote title';
                chat.messages[0].content = 'remote body';
                chat.isPinned = true;
            });
            const now = performance.now();
            const importData = dbUtils.clearAndImportData;
            let applyMs;
            dbUtils.clearAndImportData = async function (...args) {
                const t = performance.now();
                try { return await importData.apply(this, args); }
                finally { applyMs = performance.now()-t; }
            };
            try { await appLogic.handlePull(); }
            finally { dbUtils.clearAndImportData = importData; }
            await awaitView(() => state.currentMessages[0]?.content === 'remote body');
            const elapsed = performance.now() - now;
            assert(performance.timeOrigin === before && state.currentChatId === id, 'page or chat navigation changed');
            assert(input.value === 'typing before Dropbox responds' && document.activeElement === input, 'composer lost');
            assert(state.currentChatIsPinned && document.getElementById('chat-title').textContent.includes('Remote title'), 'pin/title not reflected');
            assert(!document.getElementById('progressDialog').open, 'background progress blocked the app');

            const key = appLogic.getInputDraftContextKey(), local = appLogic.loadInputDraftLocal(key);
            assert(local?.text === input.value && key.startsWith('chat:sync:'), 'local draft missing or unsafe key');
            input.value = '';
            let resolveDraft;
            dropboxApi.downloadInputDraftFromDropbox = () => new Promise(resolve => resolveDraft = resolve);
            const pendingDraft = appLogic.restoreInputDraftForCurrentContext(true);
            assert(input.value === local.text, 'local draft waited for Dropbox');
            await awaitView(() => resolveDraft);
            input.value='new input'; input.dispatchEvent(new Event('input', {bubbles:true}));
            input.value=''; input.dispatchEvent(new Event('input', {bubbles:true}));
            resolveDraft({...local, text:'stale response', updatedAt:local.updatedAt+10000});
            await pendingDraft;
            assert(input.value === '', 'stale response resurrected cleared input');
            dropboxApi.downloadInputDraftFromDropbox = async () => null;

            modify('cloud-edited-second-chat', cloud => {
                cloud.data.chats.find(row => row.id !== id).messages[0].content = 'updated second chat';
            });
            const second = (await dbUtils.getAllChats()).find(row => row.id !== id);
            const liveMessages = state.currentMessages, job = { controller: new AbortController() };
            state.sendJobsV136.set(liveMessages, job);
            try {
                await appLogic.handlePull();
                assert(state.currentMessages === liveMessages && !job.controller.signal.aborted &&
                    (await dbUtils.getChat(second.id)).messages[0].content === 'second history', 'generation lost ownership during sync');
            } finally { state.sendJobsV136.delete(liveMessages); }
            const pull = appLogic.handlePull();
            await appLogic.loadChat(second.id);
            await pull;
            await awaitView(() => state.currentMessages[0]?.content === 'updated second chat');
            assert(state.currentChatId === second.id && performance.timeOrigin === before, 'sync overrode navigation');

            const push = appLogic.handlePush;
            let project, file;
            appLogic.handlePush = () => {};
            try {
                project = await dbUtils.createProject({name:'Local project', description:'Before'});
                file = await dbUtils.addLibraryDocument(new File(['verified text'], 'sync-fixture.txt', {type:'text/plain'}));
                await dbUtils.addProjectDocument(project.id, file.id);
            } finally { appLogic.handlePush = push; }
            await appLogic._doPush();
            const library = JSON.parse(fixture.head.content).data.documentLibrary;
            const originalStart = performance.now();
            await DocumentLibrary.restoreOriginals(library, hash => dropboxApi.downloadLibraryOriginal(hash));
            const originalMs = performance.now() - originalStart;
            window.ProjectUI.open(project.id, {tab:'settings'});
            const description = document.getElementById('project-settings-description');
            await awaitView(() => description.value === 'Before');
            description.focus();
            description.value = 'unsaved project text';
            modify('cloud-edited-project', cloud => {
                const row = cloud.data.projectData.projects.find(item => item.id === project.id);
                row.name = 'Remote project';
                row.description = 'Remote description';
                cloud.data.projectData.revision = DocumentLibrary.uniqueId();
            });
            await appLogic.handlePull();
            await awaitView(() => document.getElementById('project-settings-name').value === 'Remote project');
            assert(description.value === 'unsaved project text' && document.activeElement === description, 'project edit was lost');
            document.getElementById('project-settings-form').requestSubmit();
            await awaitView(() => document.getElementById('project-settings-status').textContent.includes('編集中に'));
            assert((await dbUtils.getProject(project.id)).description === 'Remote description', 'stale project editor overwrote a cloud change');

            window.ProjectUI.close();
            window.DocumentLibraryUI.openWorkspace();
            const row = () => document.querySelector('#document-library-workspace [data-document-id="' + file.id + '"]');
            await awaitView(row);
            row().querySelector('.document-library-file').click();
            await awaitView(() => row()?.dataset.selected === 'true');
            const query = document.getElementById('document-library-query');
            query.value = 'sync-fixture';
            query.dispatchEvent(new Event('input', {bubbles:true}));
            modify('cloud-renamed-file', cloud => {
                const manifest = cloud.data.documentLibrary, name = 'sync-fixture renamed.txt';
                const doc = manifest.documents.find(item => item.id === file.id);
                doc.name = doc.fileName = name;
                manifest.originals.find(item => item.documentId === file.id && item.version === doc.version).fileName = name;
                cloud.data.documentLibrary.revision = DocumentLibrary.uniqueId();
            });
            await appLogic.handlePull();
            await awaitView(() => row()?.textContent.includes('sync-fixture renamed'));
            assert(query.value === 'sync-fixture' && row().dataset.selected === 'true' &&
                performance.timeOrigin === before, 'library view, selection or query was reset');
            window.DocumentLibraryUI.close();
            const openChat = await dbUtils.getChat(state.currentChatId);
            input.value = 'draft for the open chat';
            input.dispatchEvent(new Event('input', {bubbles:true}));
            modify('cloud-deleted-open-chat', cloud => {
                cloud.data.chats = cloud.data.chats.filter(item => item.syncIdentity !== openChat.syncIdentity);
                cloud.syncProtection.deletedChats.push(openChat.syncIdentity);
            });
            await appLogic.handlePull();
            await awaitView(() => appLogic.dropboxRemovedChatView === state.currentMessages);
            const oldAlert = uiUtilsV136.showCustomAlert;
            let notified = false;
            uiUtilsV136.showCustomAlert = async () => { notified = true; };
            try { assert(!await appLogic.beginSendPreparationV136() && notified, 'sending to deleted chat was allowed'); }
            finally { uiUtilsV136.showCustomAlert = oldAlert; }
            assert(input.value === 'draft for the open chat' && state.currentChatId === openChat.id, 'remote deletion discarded the open view');
            return [elapsed, applyMs, originalMs];
        })()""")
        client.call('Page.navigate', {'url': url + '?local-first=failure'})
        failure_ms = wait(ready('failure'))
        wait("state.sync.lastError?.message === 'controlled Dropbox failure'")
        assert ev("state.currentChatId != null && !document.getElementById('progressDialog').open")
        wait('navigator.serviceWorker.controller !== null')
        old_origin = ev('performance.timeOrigin')
        client.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': 0, 'uploadThroughput': 0})
        try:
            client.call('Page.reload')
            offline_ms = wait(f'performance.timeOrigin > {old_origin} && ' + ready('failure'))
            assert ev("navigator.onLine === false && state.currentMessages.length > 0")
        finally:
            client.call('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
        join_scenario = """(async () => {
            document.querySelector('#releaseNotesDialog[open] .dialog-ok-btn')?.click();
            uiUtils.showCustomAlert = async () => {};
            const configure = location.search.endsWith('join-configured');
            const capture = await appLogic._prepareExportData({sync:true});
            const shared = JSON.parse(capture.metadataJson);
            if (shared.data.profiles.length !== 1 || !capture.chatSync.bootstrap) throw Error('normal startup did not create bootstrap defaults');
            shared.syncId = 'configured-join-remote';
            shared.data.profiles[0].name = 'Shared profile';
            const syncIdentity = DocumentLibrary.uniqueId();
            shared.data.chats.push({id:1, syncIdentity, title:'Shared chat', createdAt:1, updatedAt:1, systemPrompt:'shared fixture prompt',
                executionSettings:{schemaVersion:1, modelRef:null, thinkingEffort:null}, messages:[{role:'user', content:'shared history'}]});
            const cloudConfig = appLogic.normalizeApiConfig({id:'fixture-shared-api', name:'Shared API', provider:'gemini',
                apiKey:'fixture-shared-only', modelCandidates:['gemini-2.5-flash']});
            const localId = await dbUtils.saveChat(null, {title:'Independent chat', systemPrompt:'local fixture prompt',
                executionSettings:{schemaVersion:1, modelRef:null, thinkingEffort:null}, messages:[{role:'user',content:'local history'}]}, {skipPush:true});
            if (localId !== 1) throw Error('fixture must exercise a numerical ID collision');
            const localIdentity = (await dbUtils.getChat(localId)).syncIdentity;
            if (configure) {
                const profileId = await dbUtils.addProfile({name:'Independent profile', createdAt:2, settings:{}});
                if (!await appLogic.switchProfile(profileId)) throw Error('fixture could not select the independent profile');
                await dbUtils.saveMemory(profileId, {items:['fixture local memory']});
                await appLogic.saveApiConfigs([{id:'fixture-join-api', name:'Fixture API', provider:'gemini', apiKey:'fixture-only',
                    modelCandidates:['gemini-2.5-flash']}]);
                await appLogic.saveGlobalSettingsV136({apiTimeoutSeconds:456, dropboxAppKey:'fixture-local-app', theme:{accentColor:'#114488'}});
                await appLogic.updateGlobalOtherSetting('additionalModels', 'fixture-local-model');
                await appLogic.saveTextFormattingSettings({indentProse:false});
                await dbUtils.saveSetting('apiConfigDeletedIdsV1318', ['fixture-local-deleted']);
            }
            const local = JSON.parse((await appLogic._prepareExportData({sync:true})).metadataJson);
            const setting = (envelope, key) => envelope.data.settings.find(row => row.key === key);
            const selected = envelope => setting(envelope, 'activeProfileId').value;
            const sharedProfileId = 42;
            shared.data.profiles.push({...shared.data.profiles[0], id:sharedProfileId, name:'Shared selected profile'});
            setting(shared, 'activeProfileId').value = sharedProfileId;
            shared.data.memories.push({profileId:sharedProfileId, items:['fixture shared memory']});
            if (selected(local) === sharedProfileId || (configure && selected(local) === selected(JSON.parse(capture.metadataJson)))) {
                throw Error('fixture must exercise differing selections after a real profile switch');
            }
            const globalSetting = envelope => setting(envelope, SettingsV136.GLOBAL_KEY).value;
            const keys = envelope => setting(envelope, 'apiConfigs').value.map(row => row.id).sort().join(',');
            globalSetting(shared).maxRetries = 9;
            if (configure) {
                globalSetting(shared).dropboxAppKey = ' fixture-local-app ';
                delete globalSetting(shared).apiTimeoutSeconds;
                globalSetting(shared).theme.userMessageColor = '#223344';
                const putSetting = (key, value) => {
                    const row = setting(shared, key);
                    if (row) row.value = value;
                    else shared.data.settings.push({key,value});
                };
                putSetting('globalThemeSettings', structuredClone(globalSetting(shared).theme));
                putSetting('globalOtherSettings', appLogic.normalizeGlobalOtherSettings({additionalOpenRouterModels:'fixture-shared-model'}));
                putSetting('textFormattingSettings', appLogic.normalizeTextFormattingSettings({boundaryBlank:false}));
                putSetting('apiConfigDeletedIdsV1318', ['fixture-shared-deleted']);
            }
            setting(shared, 'apiConfigs').value = [cloudConfig];
            const joinPlan = (remote, localData = local) => DropboxSync.planJoin({local:localData, remote, bootstrap:capture.chatSync.bootstrap, deletes:[],
                settingDefaults:DROPBOX_JOIN_SETTING_DEFAULTS,
                identify:(chats, id) => dbUtils.chatJournal.identifySnapshotChats(chats, id),
                isIdentity:id => dbUtils.chatJournal.isChatIdentity(id)});
            if (configure) {
                const localConfig = setting(local, 'apiConfigs').value[0];
                const collision = structuredClone(shared);
                setting(collision, 'apiConfigs').value = [{...localConfig, name:'Conflicting shared configuration'}];
                const deleted = structuredClone(shared);
                setting(deleted, 'apiConfigDeletedIdsV1318').value.push(localConfig.id);
                for (const remote of [collision, deleted]) {
                    try {
                        joinPlan(remote);
                        throw Error('unsafe API configuration was accepted');
                    } catch (error) {
                        if (error.syncDiagnostic !== 'join-setting-conflict:apiConfigs') throw error;
                    }
                }
                const separateServers = structuredClone(shared);
                globalSetting(separateServers).sdApiUrl = 'https://shared.invalid';
                const localServer = structuredClone(local);
                Object.assign(globalSetting(localServer), {sdApiUrl:'https://local.invalid', sdApiUser:'fixture-user'});
                try {
                    joinPlan(separateServers, localServer);
                    throw Error('unsafe server credential merge was accepted');
                } catch (error) {
                    if (error.syncDiagnostic !== 'join-setting-conflict:globalSettingsV136.sdApiUrl') throw error;
                }
                const unselected = structuredClone(shared);
                unselected.data.settings = unselected.data.settings.filter(row => row.key !== 'activeProfileId');
                if (selected(joinPlan(unselected)) !== selected(local)) throw Error('valid local selection was dropped');
                const collidingProfile = structuredClone(shared);
                collidingProfile.data.profiles.push({...shared.data.profiles[0], id:selected(local), name:'Unrelated shared profile'});
                try {
                    joinPlan(collidingProfile);
                    throw Error('ambiguous profile identity was accepted');
                } catch (error) {
                    if (!error.message.includes('プロファイルの変更が競合')) throw error;
                }
            }
            localSyncFixture.head = {content:JSON.stringify(shared), rev:'1'};
            await dbUtils.saveSetting('dropboxTokens', {access_token:'fixture'});
            let diagnostic;
            const warn = console.warn;
            console.warn = (tag, code, ...args) => {
                if (tag === '[Dropbox Sync]' && typeof code === 'string' && code.startsWith('join-setting-conflict:')) diagnostic = code;
                else warn(tag, code, ...args);
            };
            try {
                if (configure) {
                    const goodHead = localSyncFixture.head;
                    const dangling = structuredClone(shared);
                    setting(dangling, 'activeProfileId').value = selected(local);
                    const realConflict = structuredClone(shared);
                    globalSetting(realConflict).apiTimeoutSeconds = 789;
                    for (const [invalid, reason] of [[dangling, 'activeProfileId'], [realConflict, 'globalSettingsV136.apiTimeoutSeconds']]) {
                        const invalidHead = {content:JSON.stringify(invalid), rev:'1'};
                        localSyncFixture.head = invalidHead;
                        await appLogic.handleManualDropboxSync();
                        const afterReject = await appLogic._prepareExportData({sync:true});
                        if (diagnostic !== 'join-setting-conflict:' + reason || localSyncFixture.head !== invalidHead ||
                            afterReject.chatSync.snapshot || !DropboxSync.same(DropboxSync.logical(local),
                                DropboxSync.logical(JSON.parse(afterReject.metadataJson)))) throw Error('unsafe join was not rejected: ' + reason);
                    }
                    localSyncFixture.head = goodHead;
                    diagnostic = undefined;
                }
                await appLogic.handleManualDropboxSync();
            }
            finally { console.warn = warn; }
            if (state.sync.lastError) throw Error(diagnostic ?? state.sync.lastError.message);
            const head = JSON.parse(localSyncFixture.head.content);
            const result = await appLogic._prepareExportData({sync:true});
            const resultEnvelope = JSON.parse(result.metadataJson);
            const ids = envelope => envelope.data.chats.map(row => row.syncIdentity);
            const before = localSyncFixture.head.content;
            await appLogic.handleManualDropboxSync();
            const noRepeatedUpload = before === localSyncFixture.head.content;
            let normalConflict = false;
            if (configure) {
                const thisChange = structuredClone(resultEnvelope);
                const otherChange = structuredClone(head);
                globalSetting(thisChange).apiTimeoutSeconds = 654;
                globalSetting(otherChange).apiTimeoutSeconds = 789;
                try {
                    DropboxSync.plan({base:head, local:thisChange, remote:otherChange, priorSyncId:head.syncId, deletes:[],
                        isIdentity:id => dbUtils.chatJournal.isChatIdentity(id)});
                    throw Error('normal global settings conflict was accepted');
                } catch (error) {
                    if (error.syncDiagnostic || !error.message.includes('設定の変更が競合')) throw error;
                }
                const sharedEdit = structuredClone(head);
                sharedEdit.syncId = 'joined-normal-settings-conflict';
                setting(sharedEdit, 'apiConfigs').value.find(row => row.id === cloudConfig.id).name = 'Peer edit';
                localSyncFixture.head = {content:JSON.stringify(sharedEdit), rev:String(Number(localSyncFixture.head.rev)+1)};
                const peerBytes = localSyncFixture.head.content;
                await appLogic.saveApiConfigs(setting(resultEnvelope, 'apiConfigs').value.map(row =>
                    row.id === cloudConfig.id ? {...row, name:'Local edit'} : row));
                await appLogic.handleManualDropboxSync();
                normalConflict = state.sync.lastError?.message.includes('設定の変更が競合') &&
                    localSyncFixture.head.content === peerBytes &&
                    (await dbUtils.getSetting('apiConfigs')).value.find(row => row.id === cloudConfig.id).name === 'Local edit';
            }
            return {bothChats:[head, resultEnvelope].every(envelope => ids(envelope).length === 2 &&
                ids(envelope).includes(syncIdentity) && ids(envelope).includes(localIdentity) &&
                envelope.data.chats.every(row => !row.syncConflictOf && row.systemPrompt ===
                    (row.syncIdentity === syncIdentity ? 'shared fixture prompt' : 'local fixture prompt'))),
                apiSaved:keys(resultEnvelope), apiInCloud:keys(head), noRepeatedUpload, normalConflict,
                settingsKept:[head, resultEnvelope].every(envelope => globalSetting(envelope).maxRetries === 9 &&
                    (!configure || globalSetting(envelope).apiTimeoutSeconds === 456 && globalSetting(envelope).dropboxAppKey === ' fixture-local-app ' &&
                     [globalSetting(envelope).theme, setting(envelope,'globalThemeSettings').value].every(theme =>
                         theme.accentColor === '#114488' && theme.userMessageColor === '#223344') &&
                     setting(envelope,'globalOtherSettings').value.additionalModels === 'fixture-local-model' &&
                     setting(envelope,'globalOtherSettings').value.additionalOpenRouterModels === 'fixture-shared-model' &&
                     setting(envelope,'textFormattingSettings').value.indentProse === false &&
                     setting(envelope,'textFormattingSettings').value.boundaryBlank === false &&
                     setting(envelope,'apiConfigDeletedIdsV1318').value.length === 2 &&
                     setting(envelope,'apiConfigDeletedIdsV1318').value.includes('fixture-local-deleted') &&
                     setting(envelope,'apiConfigDeletedIdsV1318').value.includes('fixture-shared-deleted'))),
                tokenKept:(await dbUtils.getSetting('dropboxTokens')).value.access_token === 'fixture',
                profileSelectionKept:[head,resultEnvelope].every(envelope => selected(envelope) === sharedProfileId &&
                    envelope.data.profiles.some(row => row.id === sharedProfileId && row.name === 'Shared selected profile') &&
                    envelope.data.memories.some(row => row.profileId === sharedProfileId && row.items[0] === 'fixture shared memory') &&
                    (!configure || envelope.data.profiles.some(row => row.id === selected(local) && row.name === 'Independent profile') &&
                     envelope.data.memories.some(row => row.profileId === selected(local) && row.items[0] === 'fixture local memory'))),
                profile:resultEnvelope.data.profiles[0]?.name, baseline:!!result.chatSync.snapshot};
        })()"""
        for host, mode, config_ids in [('join-defaults.localhost', 'join-defaults', 'fixture-shared-api'),
                                       ('localhost', 'join-configured', 'fixture-join-api,fixture-shared-api')]:
            client.call('Page.navigate', {'url': url.replace('127.0.0.1', host) + '?local-first=' + mode})
            wait(ready(mode))
            first_join = ev(join_scenario)
            assert first_join == {'bothChats': True, 'apiSaved': config_ids, 'apiInCloud': config_ids,
                                  'profile': 'Shared profile', 'baseline': True, 'noRepeatedUpload': True,
                                  'settingsKept': True, 'tokenKept': True, 'profileSelectionKept': True,
                                  'normalConflict': mode == 'join-configured'}, first_join
        for width, dark, actions in [(1280, False, ['local', 'Escape']), (360, True, ['remote', 'cancel', 'backdrop'])]:
            client.call('Emulation.setDeviceMetricsOverride', {'width':width, 'height':740, 'deviceScaleFactor':1, 'mobile':width == 360})
            ev(f"document.body.classList.toggle('dark-mode', {str(dark).lower()})")
            for action in actions:
                client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', 'x':2, 'y':2})
                ev("window.conflictChoice = uiUtilsV136.showDropboxConflictChoice({title:'Fixture chat', deletion:false}); true")
                wait("document.querySelector('#dropboxConflictDialog:modal:not(.animating)') && document.activeElement?.value === 'cancel'")
                assert ev("""(() => {
                    const dialog = document.getElementById('dropboxConflictDialog');
                    const bounds = dialog.getBoundingClientRect();
                    const visible = [...dialog.querySelectorAll('button:not([hidden])')];
                    const rects = visible.map(button => button.getBoundingClientRect());
                    return dialog.querySelector('h3').textContent === 'チャットの内容が異なります' && !dialog.querySelector('input') &&
                        visible.map(button => button.value).join(',') === 'local,remote,cancel' &&
                        bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
                        rects.every((r, i) => r.height >= 44 && r.top >= bounds.top && r.bottom <= bounds.bottom &&
                            r.left >= bounds.left && r.right <= bounds.right && (!i || r.top > rects[i - 1].bottom) &&
                            document.elementFromPoint(r.x + r.width/2, r.y + r.height/2).closest('button') === visible[i]) &&
                        getComputedStyle(visible[0]).backgroundColor === getComputedStyle(visible[1]).backgroundColor;
                })()""")
                if action in ('Escape', 'cancel'):
                    key, code = ('Escape', 27) if action == 'Escape' else ('Enter', 13)
                    for kind in ['keyDown', 'keyUp']:
                        options = {'type':kind, 'key':key, 'code':key, 'windowsVirtualKeyCode':code}
                        if key == 'Enter' and kind == 'keyDown': options['text'] = '\r'
                        client.call('Input.dispatchKeyEvent', options)
                else:
                    point = {'x':2,'y':2} if action == 'backdrop' else ev(f"""(() => {{
                        const rect = document.querySelector('#dropboxConflictDialog button[value={action}]').getBoundingClientRect();
                        return {{x:rect.x + rect.width/2, y:rect.y + rect.height/2}};
                    }})()""")
                    for kind in ['mousePressed', 'mouseReleased']:
                        client.call('Input.dispatchMouseEvent', {'type':kind, 'button':'left', 'clickCount':1, **point})
                try:
                    wait("!document.getElementById('dropboxConflictDialog').open")
                except AssertionError as error:
                    raise AssertionError((width, action, *error.args)) from error
                assert ev('window.conflictChoice') == (action if action in ('local', 'remote') else None)
        client.call('Emulation.setDeviceMetricsOverride', {'width':1280, 'height':900, 'deviceScaleFactor':1, 'mobile':False})
        client.call('Page.navigate', {'url': url.replace('127.0.0.1', 'restore.localhost') + '?local-first=restore'})
        wait(ready('restore'))
        ev("""(async () => {
            document.querySelector('#releaseNotesDialog[open] .dialog-ok-btn')?.click();
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', '1.38.3');
            const id = await dbUtils.saveChat(null, {title:'Restore fixture', messages:[{role:'user',content:'fixture'}]}, {skipPush:true});
            await dbUtils.saveSetting('dropboxTokens', {access_token:'fixture'});
            await appLogic.handleManualDropboxSync();
            const backup = await appLogic.createFullBackup();
            const fixture = window.restoreSyncFixture = { id, backup };
            uiUtilsV136.showCustomConfirm = () => new Promise(resolve => { fixture.confirm = resolve; });
            uiUtilsV136.showCustomAlert = message => {
                fixture.message = message;
                if (message.startsWith('バックアップを復元しました')) return new Promise(resolve => { fixture.restart = resolve; });
            };
            fixture.changeCloud = title => {
                const head = localSyncFixture.head, remote = JSON.parse(head.content);
                remote.syncId = 'restore-peer-' + head.rev;
                remote.data.chats[0].title = title;
                localSyncFixture.head = {content:JSON.stringify(remote), rev:String(Number(head.rev)+1)};
            };
            fixture.start = () => {
                fixture.confirm = null;
                fixture.task = appLogic.handleFullBackupImport(backup);
            };
            fixture.baseline = (await dbUtils.getChatSyncContext()).syncId;
            fixture.start();
        })()""")
        wait('restoreSyncFixture.confirm && state.sync.isSyncing')
        ev("restoreSyncFixture.changeCloud('Peer change during confirmation'); dispatchEvent(new Event('online'))")
        ev('(async()=> { await localSyncFixture.pause(50); await appLogic.dropboxSyncTask; })()')
        assert ev("""(async()=> {
            const fixture = restoreSyncFixture;
            return state.sync.isSyncing && (await dbUtils.getChat(fixture.id)).title === 'Restore fixture' &&
                (await dbUtils.getChatSyncContext()).syncId === fixture.baseline &&
                (await navigator.locks.query()).held.some(lock => lock.name === 'chatai-dropbox-sync:' + state.db.name);
        })()"""), 'Dropbox sync entered while restore confirmation was open'
        ev('restoreSyncFixture.confirm(false); restoreSyncFixture.task')
        wait("(async()=> (await dbUtils.getChat(restoreSyncFixture.id)).title === 'Peer change during confirmation' && !state.sync.isSyncing)()")
        ev("""(async()=> {
            const fixture = restoreSyncFixture;
            let rejectFile;
            fixture.task = appLogic.handleFullBackupImport({ text: () => new Promise((_, reject) => { rejectFile = reject; }) });
            for (let i = 0; !rejectFile && i < 100; i++) await localSyncFixture.pause(15);
            if (!rejectFile) throw Error('restore did not enter the backup read');
            fixture.changeCloud('Peer change after failed restore');
            dispatchEvent(new Event('online'));
            await localSyncFixture.pause(50);
            rejectFile(new Error('fixture backup read failure'));
            await fixture.task;
            if (!fixture.message.includes('fixture backup read failure')) throw Error('restore failure was not reported');
        })()""")
        wait("(async()=> (await dbUtils.getChat(restoreSyncFixture.id)).title === 'Peer change after failed restore' && !state.sync.isSyncing)()")
        ev("""(async()=> {
            const fixture = restoreSyncFixture, api = window.dropboxApi;
            const probe = api.getMetadataRevision;
            api.getMetadataRevision = () => new Promise(resolve => { fixture.releaseProbe = resolve; });
            fixture.changeCloud('Peer change from ongoing sync');
            fixture.task = appLogic.synchronizeDropbox('pull', false, {automatic:true});
            for (let i = 0; !fixture.releaseProbe && i < 100; i++) await localSyncFixture.pause(15);
            if (!fixture.releaseProbe) throw Error('sync did not enter the revision check');
            fixture.confirm = null;
            await appLogic.handleFullBackupImport(fixture.backup);
            if (fixture.confirm || !fixture.message.includes('同期または復元が終わってから')) throw Error('restore entered an ongoing sync');
            api.getMetadataRevision = probe;
            fixture.releaseProbe(await probe());
            await fixture.task;
        })()""")
        assert ev("(async()=> (await dbUtils.getChat(restoreSyncFixture.id)).title === 'Peer change from ongoing sync')()")
        ev("""(() => {
            const fixture = restoreSyncFixture;
            const importBackup = appLogic.importDataFromString.bind(appLogic);
            appLogic.importDataFromString = async (...args) => {
                await new Promise(resolve => { fixture.apply = resolve; });
                return importBackup(...args);
            };
            fixture.start();
        })()""")
        wait('restoreSyncFixture.confirm && state.sync.isSyncing')
        ev('restoreSyncFixture.confirm(true)')
        wait('!!restoreSyncFixture.apply')
        ev("restoreSyncFixture.changeCloud('Peer change during restore execution'); dispatchEvent(new Event('online'))")
        ev('(async()=> { await localSyncFixture.pause(50); await appLogic.dropboxSyncTask; })()')
        assert ev("(async()=> state.sync.isSyncing && (await dbUtils.getChat(restoreSyncFixture.id)).title === 'Peer change from ongoing sync')()")
        ev('restoreSyncFixture.apply()')
        wait('restoreSyncFixture.restart && state.sync.isSyncing')
        assert ev("""(async()=> (await dbUtils.getChat(restoreSyncFixture.id)).title === 'Restore fixture' &&
            (await dbUtils.getChatSyncContext()).pending &&
            JSON.parse(localSyncFixture.head.content).data.chats[0].title === 'Peer change during restore execution')()""")
        old_origin = ev('performance.timeOrigin')
        ev('restoreSyncFixture.restart(); true')
        wait(f'performance.timeOrigin > {old_origin} && ' + ready('restore'))
        return (f'ALL PASSED (Local-first: UI {ready_ms:.0f} ms, first cloud round {sync_ms:.0f} ms, merged UI {merge_ms:.0f} ms '
                f'(IndexedDB apply {apply_ms:.0f} ms), six verified assets {asset_ms:.0f} ms vs serial {serial_asset_ms:.0f} ms, '
                f'one original {original_ms:.0f} ms, error-path UI {failure_ms:.0f} ms, offline UI {offline_ms:.0f} ms; '
                'new browser joins after normal startup and API settings save; conflict UI; restore excludes Dropbox sync through confirmation, failure, cancellation, and commit)')
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})


def run_automatic(pc, phone, url, server):
    cloud = {'content': None, 'rev': 0, 'probes': 0, 'downloads': 0, 'attempts': 0, 'race': False}
    mutex = threading.Lock()

    def handle_mock(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        status = 200
        with mutex:
            rev = str(cloud['rev']) if cloud['rev'] else None
            if self.path.endswith('/rev'):
                cloud['probes'] += 1
                result = {'.tag': 'file', 'rev': rev} if rev else None
            elif self.path.endswith('/download'):
                cloud['downloads'] += 1
                result = {'content': cloud['content'], 'rev': rev} if rev else None
            else:
                cloud['attempts'] += 1
                if cloud['race']:
                    cloud['race'] = False
                    cloud['rev'] += 1
                    rev = str(cloud['rev'])
                if request['rev'] != rev:
                    status, result = 409, None
                else:
                    cloud['content'] = request['content']
                    cloud['rev'] += 1
                    result = {'rev': str(cloud['rev'])}
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def evaluate(tab, code):
        result = tab.call('Runtime.evaluate', {'expression': code, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result['result'].get('value')

    def wait(test):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if test(): return
            time.sleep(.075)
        states = [evaluate(tab, "({url:location.search, error:window.state?.sync?.lastError?.message, busy:window.state?.sync?.isSyncing, timer:!!window.appLogic?.dropboxCheckAt, hidden:document.hidden, fixture:window.autoDropboxFixture})") for tab in (pc, phone)]
        counts = {key:cloud[key] for key in ('rev','probes','downloads','attempts')}
        raise AssertionError((counts, states))

    def titles(tab, names):
        return evaluate(tab, '(async()=> window.dbUtils && (await dbUtils.getAllChats()).map(chat => chat.title).sort())()') == sorted(names)

    server.dropbox_fixture = handle_mock
    setup = '''(() => {
        if (!location.search.startsWith('?auto-sync=')) return;
        const sw = navigator.serviceWorker, listen = sw.addEventListener.bind(sw);
        sw.addEventListener = (type, ...args) => { if (type !== 'controllerchange') listen(type, ...args); };
        const fixture = window.autoDropboxFixture = {visible:true, online:true, failed:0};
        Object.defineProperties(document, {hidden:{get:()=>!fixture.visible}, visibilityState:{get:()=>fixture.visible?'visible':'hidden'}});
        Object.defineProperty(navigator, 'onLine', {get:()=>fixture.online});
        const timer = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => timer(callback, delay === 20000 ? 1200 : delay, ...args);
        const call = async (route, data = null) => {
            fixture.route = route;
            const reply = await fetch('/__dropbox_test/' + route, {method:'POST', body:JSON.stringify(data)});
            if (reply.status === 409) throw Object.assign(Error('path/conflict'), {status:409});
            return reply.json();
        };
        let api;
        Object.defineProperty(window, 'dropboxApi', {get:()=>api, set:value=>{
            api = value;
            api.testConnection = async () => ({name:{display_name:'Fixture'}});
            api.checkLockFile = async () => null;
            api.uploadLockFile = api.deleteLockFile = async () => {};
            api.ensureAssetsFolderExists = async () => {};
            api.downloadInputDraftFromDropbox = async () => null;
            api._request = async (_, endpoint) => {
                if (endpoint !== '/files/get_metadata') throw Error('Unexpected Dropbox endpoint');
                if (fixture.failNext) {
                    fixture.failNext = false;
                    fixture.failed++;
                    throw Object.assign(Error('fixture unavailable'), {status:503});
                }
                const result = await call('rev');
                if (!result) throw Object.assign(Error('path/not_found'), {status:409});
                return result;
            };
            api.downloadMetadata = () => call('download');
            api.uploadMetadata = (content, rev) => call('upload', {content, rev});
        }});
    })();'''
    scripts = []
    try:
        for tab, origin in [(pc, 'auto-pc.localhost'), (phone, 'auto-phone.localhost')]:
            tab.call('Page.enable')
            tab.call('Network.enable')
            tab.call('Network.setBlockedURLs', {'urls': ['https://*']})
            ident = tab.call('Page.addScriptToEvaluateOnNewDocument', {'source': setup})['identifier']
            scripts.append((tab, ident))
            tab.call('Network.setBypassServiceWorker', {'bypass': True})
            tab.call('Page.navigate', {'url':url.replace('127.0.0.1', origin) + '?auto-sync=seed'})
            wait(lambda: evaluate(tab, '!!window.autoDropboxFixture && !!window.appLogic?._setupEventListenersCallCount'))
            evaluate(tab, '''(async()=> {
                document.querySelector('#releaseNotesDialog[open] .dialog-ok-btn')?.click();
                await appLogic.updateLocalUiSetting('lastSeenReleaseVersion','1.38.3');
                await appLogic.saveGlobalSettingsV136({dropboxSyncFrequency:'manual'});
                await dbUtils.saveSetting('dropboxTokens',{access_token:'fixture'});
            })()''')
            tab.call('Page.navigate', {'url':url.replace('127.0.0.1', origin) + '?auto-sync=live'})
            wait(lambda: evaluate(tab, "location.search.endsWith('live') && !!window.autoDropboxFixture && !!window.appLogic?._setupEventListenersCallCount"))
            wait(lambda: evaluate(tab, "!!window.state?.sync?.lastSyncId && !state.sync.isSyncing"))

        def save(tab, title):
            evaluate(tab, '''dbUtils.saveChat(null,{executionSettings:{schemaVersion:1,modelRef:null,thinkingEffort:null},
                title:TITLE,messages:[{role:'user',content:'fixture'}]})'''.replace('TITLE', json.dumps(title)))

        save(pc, 'PC')
        wait(lambda: titles(phone, ['PC']))
        save(phone, 'Phone')
        wait(lambda: titles(pc, ['PC','Phone']))
        wait(lambda: evaluate(phone, '!state.sync.isSyncing'))
        attempts, probes, downloads = cloud['attempts'], cloud['probes'], cloud['downloads']
        wait(lambda: cloud['probes'] >= probes + 3)
        assert (cloud['attempts'], cloud['downloads']) == (attempts, downloads), cloud['rev']

        evaluate(phone, "autoDropboxFixture.online=false; dispatchEvent(new Event('offline'))")
        previous = cloud['rev']
        save(pc, 'While offline')
        wait(lambda: cloud['rev'] > previous)
        assert titles(phone, ['PC','Phone'])
        evaluate(phone, "autoDropboxFixture.online=true; dispatchEvent(new Event('online'))")
        wait(lambda: titles(phone, ['PC','Phone','While offline']))

        evaluate(phone, "autoDropboxFixture.visible=false; document.dispatchEvent(new Event('visibilitychange'))")
        evaluate(phone, "state.isSending=true; document.getElementById('user-input').value='unsent fixture'")
        cloud['race'] = True
        previous = cloud['rev']
        save(pc, 'While generating')
        wait(lambda: cloud['rev'] >= previous + 2)
        evaluate(phone, "autoDropboxFixture.visible=true; document.dispatchEvent(new Event('visibilitychange'))")
        wait(lambda: evaluate(phone, "document.getElementById('sync-status-header-icon').dataset.status === 'pending'"))
        assert titles(phone, ['PC','Phone','While offline'])
        evaluate(phone, 'state.isSending=false')
        all_titles = ['PC','Phone','While offline','While generating']
        wait(lambda: titles(phone, all_titles))
        assert evaluate(phone, "document.getElementById('user-input').value === 'unsent fixture'")

        evaluate(phone, 'autoDropboxFixture.failNext=true')
        save(phone, 'After failure')
        wait(lambda: evaluate(phone, "autoDropboxFixture.failed === 1 && state.sync.lastError?.message === 'fixture unavailable'"))
        assert titles(phone, [*all_titles, 'After failure']) and titles(pc, all_titles)
        wait(lambda: evaluate(phone, 'appLogic.dropboxRetryAt > Date.now()'))
        # Drive the recovery event without waiting out the production backoff.
        evaluate(phone, "dispatchEvent(new Event('online'))")
        wait(lambda: titles(pc, [*all_titles, 'After failure']))
        return 'ALL PASSED (automatic sync across two Chrome origins: bidirectional saves, revision-only idle checks, offline and foreground recovery, generation/draft protection, CAS and 503 recovery)'
    finally:
        for tab, ident in scripts:
            tab.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': ident})
            tab.call('Page.navigate', {'url':'about:blank'})
        server.dropbox_fixture = None

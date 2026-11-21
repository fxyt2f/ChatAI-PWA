"""Local startup and sync integration with delayed Dropbox in the real app."""
import time


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
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', '1.38.0.1');
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
        return (f'ALL PASSED (Local-first: UI {ready_ms:.0f} ms, first cloud round {sync_ms:.0f} ms, merged UI {merge_ms:.0f} ms '
                f'(IndexedDB apply {apply_ms:.0f} ms), six verified assets {asset_ms:.0f} ms vs serial {serial_asset_ms:.0f} ms, '
                f'one original {original_ms:.0f} ms, error-path UI {failure_ms:.0f} ms, offline UI {offline_ms:.0f} ms)')
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})

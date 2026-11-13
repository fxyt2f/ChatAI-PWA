async function runDocumentLibraryTests({ app, db, st, ui, el, test, assert, eq }) {
    const file = (content, name = '資料.md') => new File([content], name, { type: 'text/plain' });
    const read = (name, id) => DocumentLibrary.request(db._getStore(name).get(id));
    const put = (name, record) => DocumentLibrary.transaction(st.db, [name], 'readwrite', tx => {
        tx.objectStore(name).put(record);
    });
    const fails = async (operation, message) => {
        try { await operation(); } catch (error) {
            assert(message.test(String(error)), String(error));
            return;
        }
        throw new Error('Expected failure: ' + message);
    };
    const withDatabase = async run => {
        const name = 'library-test-' + crypto.randomUUID();
        const open = indexedDB.open;
        const old = { ...st };
        st.db = null;
        st.sync = { isSyncing: false, isDirty: false, pendingPush: false, lastSyncId: null };
        st.currentChatId = null;
        st.currentMessages = [];
        try {
            indexedDB.open = (_, version) => open.call(indexedDB, name, version);
            await db.openDB();
            indexedDB.open = open;
            return await run();
        } finally {
            indexedDB.open = open;
            st.db?.close();
            Object.assign(st, old);
            indexedDB.deleteDatabase(name);
        }
    };
    const saveChat = async (id, content, extra = {}) => db.saveChat(null, {
        id, title: content, messages: [{ role: 'user', content }], ...extra
    }, { skipPush: true });
    const ids = async chatId => (await db.getChatDocuments(chatId)).map(document => document.id);

    await test('Library supports ten formats, draft IDs and shared chat links', () => withDatabase(async () => {
        for (const format of ['pdf', 'docx', 'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html']) {
            const document = await db.addLibraryDocument(file(format, '原本.' + format.toUpperCase()));
            eq(document.format, format);
            eq(await (await db.getLibraryOriginal(document.id, document.version)).blob.text(), format);
            await db.deleteLibraryDocument(document.id);
        }
        await fails(() => db.addLibraryDocument(file('other', 'ignored.exe')), /対応する形式/);
        const doc = await db.addLibraryDocument(file('first'), { name: '表示名' });
        eq(await db.listLibraryDocuments(), [doc]);
        eq(await db.getLibraryDocument(doc.id), doc);
        await fails(() => app.setCurrentChatDocuments([DocumentLibrary.uniqueId()]), /見つかりません/);
        eq(await db.getAllChats(), []);
        eq(st.currentChatId, null);

        const draft = await app.setCurrentChatDocuments([doc.id, doc.id]);
        eq(st.currentChatId, draft);
        eq((await db.getChat(draft)).messages, []);
        eq(await ids(draft), [doc.id]);
        st.currentMessages.push({ role: 'user', content: 'first turn' });
        eq(await db.saveChat(null, null, { skipPush: true }), draft);
        eq((await db.getChat(draft)).messages[0].content, 'first turn');
        const second = await saveChat(10, 'second chat');
        const firstLookup = db.getChatDocuments(draft);
        st.currentChatId = second;
        await db.setChatDocuments(second, [doc.id]);
        eq((await firstLookup).map(document => document.id), [doc.id]);
        eq(await ids(second), [doc.id]);
        st.currentChatId = null;
        st.currentMessages = [];
        const savingDraft = app.setCurrentChatDocuments([doc.id]);
        st.currentChatId = second;
        st.currentMessages = [{ role: 'user', content: 'second chat' }];
        const linkedDraft = await savingDraft;
        assert(linkedDraft !== second);
        eq(st.currentChatId, second);
        eq(await ids(linkedDraft), [doc.id]);

        const replaced = await db.replaceLibraryDocument(doc.id, file('new', '差替.TXT'), { expectedVersion: 1 });
        eq(replaced.version, 2);
        eq(replaced.name, '表示名');
        assert(replaced.versionId !== doc.versionId);
        eq((await db.getChatDocuments(second))[0].version, 2);
        eq(await (await db.getLibraryOriginal(doc.id, 1)).blob.text(), 'first');
        eq(await db.getLibraryOriginal(doc.id, 2, doc.versionId), undefined);
        eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'new');
        await fails(() => db.replaceLibraryDocument(doc.id, file('stale'), { expectedVersion: 1 }), /更新/);

        await db.deleteChat(draft);
        eq(await ids(draft), []);
        eq(await ids(second), [doc.id]);
        await db.setChatDocuments(second, []);
        eq(await ids(second), []);
        eq((await db.getLibraryDocument(doc.id)).version, 2);
        await db.setChatDocuments(second, [doc.id]);
        await db.deleteLibraryDocument(doc.id, { expectedVersion: 2 });
        eq(await ids(second), []);
        eq(await ids(linkedDraft), []);
        eq(await db.getLibraryOriginal(doc.id, 1), undefined);
        eq(await db.getLibraryOriginal(doc.id, 2), undefined);
    }));

    await test('Library link additions merge in the transaction and a missing target rolls back the batch', () => withDatabase(async () => {
        const chatId = await saveChat(9, 'existing chat');
        const original = await db.addLibraryDocument(file('already linked'));
        const first = await db.addLibraryDocument(file('first addition'));
        const second = await db.addLibraryDocument(file('second addition'));
        const unlinked = await db.addLibraryDocument(file('saved but not linked'));
        const record = await db.getChat(chatId);
        delete record.recordGenerationId;
        await put('chats', record);
        await db.setChatDocuments(chatId, [original.id], { recordGenerationId: null }, 'add');
        await Promise.all([
            db.setChatDocuments(chatId, [first.id, original.id], undefined, 'add'),
            db.setChatDocuments(chatId, [second.id], undefined, 'add'),
            db.setChatDocuments(chatId, [original.id], undefined, 'remove')
        ]);
        eq((await ids(chatId)).sort(), [first.id, second.id].sort());
        await fails(() => db.setChatDocuments(chatId, [unlinked.id, DocumentLibrary.uniqueId()], undefined, 'add'), /見つかりません/);
        eq((await ids(chatId)).sort(), [first.id, second.id].sort());
        eq(await (await db.getLibraryOriginal(unlinked.id)).blob.text(), 'saved but not linked');
    }));

    await test('Library replacement rolls back on quota failure and transaction abort', () => withDatabase(async () => {
        const doc = await db.addLibraryDocument(file('untouched'));
        const chatId = await saveChat(9, 'existing chat');
        await db.setChatDocuments(chatId, [doc.id]);
        const before = await db.getDocumentLibrarySyncState();
        const putOriginal = IDBObjectStore.prototype.put;
        const addOriginal = IDBObjectStore.prototype.add;
        try {
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (this.name === DocumentLibrary.documents) throw new DOMException('simulated quota', 'QuotaExceededError');
                return putOriginal.call(this, value, ...args);
            };
            await fails(() => db.replaceLibraryDocument(doc.id, file('quota')), /QuotaExceededError/);
            IDBObjectStore.prototype.put = putOriginal;
            IDBObjectStore.prototype.add = function (value, ...args) {
                const request = addOriginal.call(this, value, ...args);
                if (this.name === DocumentLibrary.originals) request.addEventListener('success', () => this.transaction.abort());
                return request;
            };
            await fails(() => db.replaceLibraryDocument(doc.id, file('aborted')), /AbortError/);
        } finally {
            IDBObjectStore.prototype.put = putOriginal;
            IDBObjectStore.prototype.add = addOriginal;
        }
        eq(await db.getLibraryDocument(doc.id), doc);
        eq(await db.getLibraryOriginal(doc.id, 2), undefined);
        eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'untouched');
        eq(await ids(chatId), [doc.id]);
        eq(await db.getDocumentLibrarySyncState(), before);
    }));

    await test('Portable backup restores binary versions, links, chat images, memory, profiles and settings', () => withDatabase(async () => {
        const profileId = await db.addProfile({ name: 'backup profile', settings: { systemPrompt: 'profile prompt' } });
        await db.saveMemory(profileId, { items: ['memory'] });
        await db.saveSetting('backup-fixture', { value: 'shared setting' });
        const originalBytes = [0, 1, 255, 2];
        const doc = await db.addLibraryDocument(new File([new Uint8Array(originalBytes)], 'bytes.pdf'));
        await db.replaceLibraryDocument(doc.id, file('next version'));
        const chatId = await saveChat(15, 'backup chat', {
            messages: [{ role: 'user', content: 'backup chat', imageIds: ['image'] }]
        });
        await db.setChatDocuments(chatId, [doc.id]);
        await put('image_store', { id: 'image', blob: new Blob(['image data'], { type: 'image/webp' }) });
        const backup = await app.createFullBackup();
        const json = await backup.text();
        const parsed = JSON.parse(json);
        eq(parsed.minimumReaderVersion, 137);
        eq(parsed.backupOriginals.length, 2);
        assert(!JSON.stringify(parsed.data.chats).includes(parsed.backupOriginals[0].base64));

        await db.clearAllData();
        await db.saveSetting('dropboxTokens', { access_token: 'local only' });
        await app.importDataFromString(json, { source: 'file' });
        eq((await db.getProfile(profileId)).name, 'backup profile');
        eq((await db.getMemory(profileId)).items, ['memory']);
        eq((await db.getSetting('backup-fixture')).value, { value: 'shared setting' });
        eq((await db.getSetting('dropboxTokens')).value, { access_token: 'local only' });
        eq(await (await read('image_store', 'image')).blob.text(), 'image data');
        eq((await db.getChat(chatId)).messages[0].content, 'backup chat');
        eq(await ids(chatId), [doc.id]);
        eq(Array.from(new Uint8Array(await (await db.getLibraryOriginal(doc.id, 1)).blob.arrayBuffer())), originalBytes);
        eq(await (await db.getLibraryOriginal(doc.id, 2)).blob.text(), 'next version');
        const before = await db.getDocumentLibrarySyncState();

        const corrupted = structuredClone(parsed);
        corrupted.backupOriginals[0].base64 = btoa('corrupt');
        await fails(() => app.importDataFromString(JSON.stringify(corrupted), { source: 'file' }), /破損/);
        const badLink = structuredClone(parsed);
        badLink.data.documentLibrary.links[0].chatId = 991;
        await fails(() => app.importDataFromString(JSON.stringify(badLink), { source: 'file' }), /形式が無効/);
        await fails(() => app.importDataFromString('{"version":"2.0","data":{}}', { source: 'file' }), /一覧が不足/);
        eq(await db.getDocumentLibrarySyncState(), before);

        const newer = await db.addLibraryDocument(file('created after the backup'));
        const putOriginal = IDBObjectStore.prototype.put;
        try {
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (this.name === DocumentLibrary.originals) throw new DOMException('simulated quota', 'QuotaExceededError');
                return putOriginal.call(this, value, ...args);
            };
            await fails(() => app.importDataFromString(json, { source: 'file' }), /simulated quota/);
        } finally { IDBObjectStore.prototype.put = putOriginal; }
        eq(await (await db.getLibraryOriginal(newer.id)).blob.text(), 'created after the backup');
        eq(await (await read('image_store', 'image')).blob.text(), 'image data');
        eq(await ids(chatId), [doc.id]);
        for (const store of DocumentLibrary.stores) eq(await DocumentLibrary.request(db._getStore(store + '_temp').count()), 0);
        await fails(() => app.importDataFromString(json, { source: 'file', libraryBefore: before }), /準備中にファイルが変更/);
    }));

    await test('Legacy file restore warns, preserves originals and detaches reused chat IDs', () => withDatabase(async () => {
        const doc = await db.addLibraryDocument(file('legacy-safe'));
        const chatId = await saveChat(6, 'local chat');
        await db.setChatDocuments(chatId, [doc.id]);
        const legacy = { version: '2.0', minimumReaderVersion: 136, data: {
            chats: [{ id: chatId, title: 'legacy replacement', messages: [], createdAt: 1, updatedAt: 1 }],
            profiles: [], settings: [], assets: [], memories: []
        } };
        const json = JSON.stringify(legacy);
        await fails(() => app.importDataFromString(json), /紐づけが含まれていない/);
        const confirm = ui.showCustomConfirm;
        const progress = ui.hideProgressDialog;
        let warning;
        try {
            ui.showCustomConfirm = async message => { warning = message; return false; };
            ui.hideProgressDialog = () => {};
            await app.handleFullBackupImport(file(json, 'legacy.json'));
        } finally { Object.assign(ui, { showCustomConfirm: confirm, hideProgressDialog: progress }); }
        assert(warning.includes('ファイル原本と版は保持') && warning.includes('紐づけは解除'));
        eq(await ids(chatId), [doc.id]);
        await app.importDataFromString(json, { source: 'file' });
        eq((await db.getChat(chatId)).title, 'legacy replacement');
        eq(await ids(chatId), []);
        eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'legacy-safe');
    }));

    await test('Dropbox stages originals, uses revision checks and keeps conflicting libraries intact', async () => {
        const api = window.dropboxApi;
        const previousFetch = window.fetch;
        const previousStatus = app.updateSyncStatusUI;
        const previousUpdate = app.updateDropboxUIState;
        const confirm = ui.showCustomConfirm;
        const alert = ui.showCustomAlert;
        const progress = ui.showProgressDialog;
        const retries = api.MAX_RETRY_COUNT;
        const files = new Map();
        const folders = new Set();
        const commits = [];
        const statuses = [];
        let counter = 0, failOriginal = false, beforeCommit;
        const conflict = () => Response.json({ error_summary: 'path/conflict/file/' }, { status: 409 });
        const notFound = () => Response.json({ error_summary: 'path/not_found/' }, { status: 409 });
        const remote = () => files.get(api.METADATA_PATH);
        const metadata = () => remote().blob.text();
        const connect = () => db.saveSetting('dropboxTokens', { access_token: 'fixture', expires_at: Date.now() + 600000 });
        try {
            api.MAX_RETRY_COUNT = 0;
            app.updateSyncStatusUI = (status, message) => { statuses.push({ status, message }); };
            app.updateDropboxUIState = async () => {};
            ui.showProgressDialog = () => {};
            ui.showCustomAlert = async () => {};
            window.fetch = async (url, options) => {
                const request = new URL(url, location.href);
                if (!request.hostname.endsWith('.dropboxapi.com')) return previousFetch(url, options);
                const args = JSON.parse(options.headers['Dropbox-API-Arg'] || options.body);
                const path = args.path;
                const entry = files.get(path);
                if (request.pathname.endsWith('/download')) {
                    return entry ? new Response(entry.blob, { headers: { 'Dropbox-API-Result': JSON.stringify({ rev: entry.rev }) } }) : notFound();
                }
                if (request.pathname.endsWith('/upload')) {
                    if (path.startsWith(api.DOCUMENTS_DIR_PATH + '/') && failOriginal) return new Response('', { status: 503 });
                    if (path === api.METADATA_PATH) {
                        if (beforeCommit) await beforeCommit();
                        assert(args.strict_conflict && args.autorename === false);
                        if (args.mode === 'add' ? remote() : args.mode['.tag'] !== 'update' || args.mode.update !== remote()?.rev) return conflict();
                        const envelope = JSON.parse(options.body);
                        for (const original of envelope.data.documentLibrary?.originals || []) {
                            assert(files.has(api.libraryOriginalPath(original.hash)), 'published before original existed');
                        }
                        commits.push(envelope);
                    } else if (args.mode === 'add' && entry) return conflict();
                    files.set(path, { blob: new Blob([options.body]), rev: String(++counter) });
                    return Response.json({ rev: String(counter) });
                }
                if (request.pathname.endsWith('/get_metadata')) return folders.has(path) ? Response.json({ '.tag': 'folder' }) : notFound();
                if (request.pathname.endsWith('/create_folder_v2')) {
                    folders.add(path);
                    return Response.json({});
                }
                if (request.pathname.endsWith('/list_folder')) {
                    return Response.json({ entries: [...files].filter(([key]) => key.startsWith(path + '/'))
                        .map(([key, item]) => ({ '.tag': 'file', name: key.split('/').at(-1), size: item.blob.size })), has_more: false });
                }
                if (request.pathname.endsWith('/delete_v2') && path === '/.sync_lock') {
                    files.delete(path);
                    return Response.json({});
                }
                throw new Error('Unexpected mocked Dropbox request ' + request.pathname);
            };
            let first, second, doc, chatId;
            await withDatabase(async () => {
                await connect();
                doc = await db.addLibraryDocument(file('cloud v1'));
                chatId = await saveChat(12, 'cloud chat');
                await db.setChatDocuments(chatId, [doc.id]);
                failOriginal = true;
                await app._doPush();
                eq(commits.length, 0);
                eq((await db.getDocumentLibrarySyncState()).syncedRevision, null);
                failOriginal = false;
                await app._doPush();
                assert(commits.length === 1, JSON.stringify(statuses.at(-1)));
                first = await metadata();

                await db.replaceLibraryDocument(doc.id, file('cloud v2'));
                beforeCommit = async () => { files.set(api.METADATA_PATH, { ...remote(), rev: String(++counter) }); };
                await app._doPush();
                eq(await metadata(), first);
                eq(commits.length, 1);
                assert(statuses.some(({ status, message }) => status === 'error' && message.includes('保存先が変更')));
                const pending = await db.getDocumentLibrarySyncState();
                assert(pending.revision !== pending.syncedRevision);
                beforeCommit = undefined;
                await app._doPush();
                eq(commits.length, 2);
                second = await metadata();
            });
            await withDatabase(async () => {
                await connect();
                await app.importDataFromString(first, { source: 'dropbox' });
                await app.initializeSyncState();
                eq(await ids(chatId), [doc.id]);
                eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'cloud v1');
                const newest = commits[1].data.documentLibrary.originals.find(original => original.version === 2);
                const newestPath = api.libraryOriginalPath(newest.hash);
                const original = files.get(newestPath);
                files.set(newestPath, { ...original, blob: new Blob(['wrong v2']) });
                await fails(() => app.importDataFromString(second, { source: 'dropbox' }), /内容が一致/);
                files.delete(newestPath);
                await fails(() => app.importDataFromString(second, { source: 'dropbox' }), /path\/not_found/);
                files.set(newestPath, original);
                eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'cloud v1');

                await db.replaceLibraryDocument(doc.id, file('local v2'));
                await app._doPush();
                eq(await metadata(), second);
                await app.handlePull();
                eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'local v2');
                assert(statuses.some(({ status, message }) => status === 'error' && message.includes('未同期のファイル')));

                let warning;
                ui.showCustomConfirm = async message => { warning = message; return false; };
                await app.handlePull(true);
                assert(warning.includes('未同期のファイル') && warning.includes('バックアップ'));
                eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'local v2');
                await app.importDataFromString(second, { source: 'dropbox', allowLibraryReplace: true });
                await app.initializeSyncState();
                eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'cloud v2');
                eq(await ids(chatId), [doc.id]);
                const [restored] = await db.getChatDocuments(chatId);
                eq((await DocumentSearch.getStatus(restored)).status, 'pending');
                const search = await DocumentSearch.searchChat(chatId, 'cloud v2');
                eq(search.results[0].versionId, restored.versionId);
                assert(search.results[0].text.includes('cloud v2'));
                const legacy = JSON.parse(second);
                delete legacy.data.documentLibrary;
                legacy.minimumReaderVersion = 136;
                await fails(() => app.importDataFromString(JSON.stringify(legacy), { source: 'dropbox' }), /ファイル/);
                await db.deleteLibraryDocument(doc.id);
                await app._doPush();
                eq(commits.at(-1).minimumReaderVersion, 137);
                eq(commits.at(-1).data.documentLibrary.documents, []);
                assert(files.has(newestPath), 'an older remote revision can still read its originals');
            });
            await withDatabase(async () => {
                await connect();
                await app.importDataFromString(second, { source: 'dropbox' });
                await app.importDataFromString(await metadata(), { source: 'dropbox' });
                eq(await ids(chatId), []);
                eq(await db.getLibraryDocument(doc.id), undefined);
            });
            await withDatabase(async () => {
                await connect();
                const legacy = JSON.parse(first);
                delete legacy.data.documentLibrary;
                legacy.minimumReaderVersion = 136;
                files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(legacy)]), rev: String(++counter) });
                const document = await db.addLibraryDocument(file('locally linked document'));
                const linked = await app.setCurrentChatDocuments([document.id]);
                const warnings = [];
                ui.showCustomConfirm = async message => { warnings.push(message); return true; };
                await app.handleManualDropboxSync();
                eq(warnings.length, 1);
                assert(warnings[0].includes('ファイルや紐づけ'));
                eq(JSON.parse(await metadata()).data.documentLibrary.links, [{ chatId: linked, documentId: document.id }]);
                eq(await ids(linked), [document.id]);
            });
        } finally {
            Object.assign(app, { updateSyncStatusUI: previousStatus, updateDropboxUIState: previousUpdate });
            Object.assign(ui, { showCustomConfirm: confirm, showCustomAlert: alert, showProgressDialog: progress });
            window.fetch = previousFetch;
            api.MAX_RETRY_COUNT = retries;
            ui.hideProgressDialog();
        }
    });
}

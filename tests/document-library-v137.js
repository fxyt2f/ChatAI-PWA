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
    const withDatabase = async (run, seed) => {
        const name = 'library-test-' + crypto.randomUUID();
        const open = indexedDB.open;
        const old = { ...st };
        st.db = null;
        st.sync = { isSyncing: false, isDirty: false, pendingPush: false, lastSyncId: null };
        st.currentChatId = null;
        st.currentMessages = [];
        try {
            if (seed) await seed(name);
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

    await test('IndexedDB v16 upgrades in place with chats, document versions and links intact', async () => {
        const blob = file('v16 original');
        const entry = { id: DocumentLibrary.uniqueId(), version: 1, versionId: DocumentLibrary.uniqueId(), name: blob.name,
            fileName: blob.name, format: 'md', mimeType: blob.type, size: blob.size, hash: await DocumentLibrary.digest(blob),
            createdAt: 1, updatedAt: 1 };
        await withDatabase(async () => {
            eq(st.db.version, 17);
            eq((await db.getChat(42)).title, 'v16 chat');
            eq(await db.getLibraryDocument(entry.id), entry);
            eq(await (await db.getLibraryOriginal(entry.id, 1)).blob.text(), 'v16 original');
            eq(await ids(42), [entry.id]);
            for (const store of ProjectStore.stores) {
                eq(await DocumentLibrary.request(db._getStore(store).count()), 0);
                eq(await DocumentLibrary.request(db._getStore(store + '_temp').count()), 0);
            }
        }, async name => {
            const connection = await new Promise((resolve, reject) => {
                const open = indexedDB.open(name, 16);
                open.onerror = () => reject(open.error);
                open.onupgradeneeded = () => {
                    const legacy = open.result;
                    legacy.createObjectStore('chats', { keyPath: 'id', autoIncrement: true }).add({ id: 42, title: 'v16 chat' });
                    legacy.createObjectStore('settings', { keyPath: 'key' });
                    legacy.createObjectStore('profiles', { keyPath: 'id' });
                    legacy.createObjectStore('image_store', { keyPath: 'id' });
                    legacy.createObjectStore('image_assets', { keyPath: 'name' });
                    legacy.createObjectStore('memory_store', { keyPath: 'profileId' });
                    for (const [store, keyPath] of [['chats', 'id'], ['settings', 'key'], ['profiles', 'id'],
                        ['image_store', 'id'], ['image_assets', 'name'], ['memory_store', 'profileId']]) {
                        legacy.createObjectStore(store + '_temp', { keyPath });
                    }
                    DocumentLibrary.upgrade(legacy);
                    legacy.createObjectStore(DocumentLibrary.indexStore, { keyPath: ['documentId', 'kind'] });
                    open.transaction.objectStore(DocumentLibrary.documents).add(entry);
                    open.transaction.objectStore(DocumentLibrary.originals).add({ ...entry, documentId: entry.id, blob });
                    open.transaction.objectStore(DocumentLibrary.links).add({ chatId: 42, documentId: entry.id });
                };
                open.onsuccess = () => resolve(open.result);
            });
            connection.close();
        });
    });

    await test('Project CRUD, membership moves, and shared documents keep original records intact', () => withDatabase(async () => {
        const doc = await db.addLibraryDocument(file('version 1'));
        await db.replaceLibraryDocument(doc.id, file('version 2'));
        const chatId = await saveChat(15, 'chat contents', { systemPrompt: 'private prompt' });
        await db.setChatDocuments(chatId, [doc.id]);
        const chat = await db.getChat(chatId);
        const profileId = await db.addProfile({ name: 'other profile' });
        await db.saveMemory(profileId, { note: 'memory survives' });
        const sync = () => db.getProjectSyncContext();
        const untouched = await sync();
        await fails(() => db.createProject({ name: '  ' }), /プロジェクト名/);
        eq(await sync(), untouched);
        const first = await db.createProject({ name: ' 同名 ' });
        const second = await db.createProject({ name: '同名', description: 'second' });
        assert(first.id !== second.id);
        eq((await db.listProjects()).map(project => project.name), ['同名', '同名']);
        eq(await db.getProject(first.id), first);
        eq(await db.listProjectChats(first.id), []);
        eq(await db.listProjectDocuments(first.id), []);
        eq(await db.updateProject(first.id, { description: 'edited' }), true);
        eq((await db.getProject(first.id)).description, 'edited');
        const edited = await sync();
        eq(await db.updateProject(first.id, { description: 'edited' }), false);
        eq(await db.setChatProject(chatId, null), false);
        eq(await db.clearProjectDocuments(first.id), false);
        eq(await sync(), edited);
        await fails(() => db.setChatProject(404, first.id), /チャットが見つかりません/);
        await fails(() => db.setChatProject(chatId, 'missing'), /プロジェクトが見つかりません/);
        await fails(() => db.addProjectDocument(first.id, 'missing'), /ファイルが見つかりません/);
        eq(await sync(), edited);

        eq(await db.setChatProject(chatId, first.id), true);
        const assigned = await sync();
        eq(await db.setChatProject(chatId, first.id), false);
        eq(await sync(), assigned);
        eq((await db.getChatProject(chatId)).id, first.id);
        await db.setChatProject(chatId, second.id);
        eq(await db.listProjectChats(first.id), []);
        eq(await db.listProjectChats(second.id), [chat]);
        await db.setChatProject(chatId, null);
        eq(await db.getChatProject(chatId), undefined);
        await db.setChatProject(chatId, first.id);
        await db.addProjectDocument(first.id, doc.id);
        await db.addProjectDocument(second.id, doc.id);
        const shared = await sync();
        eq(await db.addProjectDocument(first.id, doc.id), false);
        await fails(() => db.clearProjectDocuments(undefined), /DataError/);
        await fails(() => db.listProjectDocuments(undefined), /DataError/);
        eq(await sync(), shared);
        eq((await db.listProjectDocuments(first.id)).map(item => item.id), [doc.id]);
        eq(await db.removeProjectDocument(first.id, doc.id), true);
        eq(await db.removeProjectDocument(first.id, doc.id), false);
        await db.addProjectDocument(first.id, doc.id);
        eq(await db.clearProjectDocuments(second.id), true);
        await db.addProjectDocument(second.id, doc.id);
        await db.deleteProject(first.id);
        eq(await db.getProject(first.id), undefined);
        eq(await db.getChatProject(chatId), undefined);
        eq(await db.listProjectDocuments(first.id), []);
        eq((await db.listProjectDocuments(second.id)).map(item => item.id), [doc.id]);
        eq(await db.getChat(chatId), chat);
        eq(await ids(chatId), [doc.id]);
        eq((await db.getMemory(profileId)).note, 'memory survives');
        eq(await (await db.getLibraryOriginal(doc.id, 1)).blob.text(), 'version 1');
        eq(await (await db.getLibraryOriginal(doc.id, 2)).blob.text(), 'version 2');
        await db.setChatProject(chatId, second.id);
        await db.deleteChat(chatId);
        eq(await db.getChatProject(chatId), undefined);
        eq(await db.listProjectChats(second.id), []);
        eq((await db.listProjectDocuments(second.id)).length, 1);
        await db.deleteLibraryDocument(doc.id);
        eq(await db.listProjectDocuments(second.id), []);
        eq(await db.getLibraryOriginal(doc.id, 1), undefined);
    }));

    await test('Project, chat and library deletions roll back their links and sync revisions on failure', () => withDatabase(async () => {
        const project = await db.createProject({ name: 'rollback' });
        const doc = await db.addLibraryDocument(file('rollback original'));
        const chatId = await saveChat(11, 'rollback chat');
        await db.setChatProject(chatId, project.id);
        await db.setChatDocuments(chatId, [doc.id]);
        await db.addProjectDocument(project.id, doc.id);
        const revision = await db.getProjectSyncContext();
        const library = await db.getDocumentLibrarySyncState();
        const put = IDBObjectStore.prototype.put;
        try {
            IDBObjectStore.prototype.put = function(record, ...args) {
                if (record.key === ProjectStore.syncKey) throw new DOMException('project revision write failed', 'QuotaExceededError');
                return put.call(this, record, ...args);
            };
            for (const operation of [() => db.deleteProject(project.id), () => db.deleteChat(chatId), () => db.deleteLibraryDocument(doc.id)]) {
                await fails(operation, /project revision write failed/);
                eq(await db.getProject(project.id), project);
                eq(await db.getChatProject(chatId), project);
                eq((await db.getChat(chatId)).title, 'rollback chat');
                eq(await ids(chatId), [doc.id]);
                eq(await db.listProjectDocuments(project.id), [doc]);
                eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'rollback original');
                eq(await db.getProjectSyncContext(), revision);
                eq(await db.getDocumentLibrarySyncState(), library);
            }
        } finally { IDBObjectStore.prototype.put = put; }
    }));

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
        const project = await db.createProject({ name: 'backup project', description: 'shared across profiles' });
        const empty = await db.createProject({ name: 'empty project' });
        await db.setChatProject(chatId, project.id);
        await db.addProjectDocument(project.id, doc.id);
        await put('image_store', { id: 'image', blob: new Blob(['image data'], { type: 'image/webp' }) });
        const backup = await app.createFullBackup();
        const json = await backup.text();
        const parsed = JSON.parse(json);
        eq(parsed.minimumReaderVersion, 138);
        eq(parsed.backupOriginals.length, 2);
        eq(parsed.data.projectData.chats, [{ chatId, projectId: project.id }]);
        eq(parsed.data.projectData.documents, [{ projectId: project.id, documentId: doc.id }]);
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
        eq(await db.getChatProject(chatId), project);
        eq(await db.getProject(empty.id), empty);
        eq((await db.listProjectDocuments(project.id)).map(document => document.id), [doc.id]);
        eq(Array.from(new Uint8Array(await (await db.getLibraryOriginal(doc.id, 1)).blob.arrayBuffer())), originalBytes);
        eq(await (await db.getLibraryOriginal(doc.id, 2)).blob.text(), 'next version');
        const before = await db.getDocumentLibrarySyncState();
        const projectsBefore = await db.getProjectSyncContext();

        const corrupted = structuredClone(parsed);
        corrupted.backupOriginals[0].base64 = btoa('corrupt');
        await fails(() => app.importDataFromString(JSON.stringify(corrupted), { source: 'file' }), /破損/);
        const badLink = structuredClone(parsed);
        badLink.data.documentLibrary.links[0].chatId = 991;
        await fails(() => app.importDataFromString(JSON.stringify(badLink), { source: 'file' }), /形式が無効/);
        const invalidSnapshots = [
            snapshot => { snapshot.schemaVersion++; },
            snapshot => { snapshot.projects[0].id = 'invalid'; },
            snapshot => { snapshot.projects[0].description = 5; },
            snapshot => { snapshot.projects.push(snapshot.projects[0]); },
            snapshot => { snapshot.chats[0].projectId = DocumentLibrary.uniqueId(); },
            snapshot => { snapshot.chats[0].chatId = 404; },
            snapshot => { snapshot.chats.push({ chatId, projectId: empty.id }); },
            snapshot => { snapshot.documents[0].documentId = DocumentLibrary.uniqueId(); },
            snapshot => { snapshot.documents.push(snapshot.documents[0]); }
        ];
        for (const corrupt of invalidSnapshots) {
            const invalid = structuredClone(parsed);
            corrupt(invalid.data.projectData);
            await fails(() => app.importDataFromString(JSON.stringify(invalid), { source: 'file' }), /プロジェクト情報|新しいバージョン/);
        }
        eq(await db.getProjectSyncContext(), projectsBefore);
        eq(await db.getChatProject(chatId), project);
        await fails(() => app.importDataFromString('{"version":"2.0","data":{}}', { source: 'file', allowLegacyProjectClear: true }), /一覧が不足/);
        eq(await db.getDocumentLibrarySyncState(), before);

        const newer = await db.addLibraryDocument(file('created after the backup'));
        const newerProject = await db.createProject({ name: 'created after the backup' });
        const putOriginal = IDBObjectStore.prototype.put;
        try {
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (this.name === DocumentLibrary.originals) throw new DOMException('simulated quota', 'QuotaExceededError');
                return putOriginal.call(this, value, ...args);
            };
            await fails(() => app.importDataFromString(json, { source: 'file' }), /simulated quota/);
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (this.name === ProjectStore.documents) throw new DOMException('simulated project quota', 'QuotaExceededError');
                return putOriginal.call(this, value, ...args);
            };
            await fails(() => app.importDataFromString(json, { source: 'file' }), /simulated project quota/);
        } finally { IDBObjectStore.prototype.put = putOriginal; }
        eq(await (await db.getLibraryOriginal(newer.id)).blob.text(), 'created after the backup');
        eq(await (await read('image_store', 'image')).blob.text(), 'image data');
        eq(await ids(chatId), [doc.id]);
        eq(await db.getProject(newerProject.id), newerProject);
        eq(await db.getChatProject(chatId), project);
        for (const store of [...DocumentLibrary.stores, ...ProjectStore.stores]) {
            eq(await DocumentLibrary.request(db._getStore(store + '_temp').count()), 0);
        }
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
        await app.importDataFromString(json, { source: 'file', allowLegacyProjectClear: true });
        eq((await db.getChat(chatId)).title, 'legacy replacement');
        eq(await ids(chatId), []);
        eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'legacy-safe');
    }));

    await test('v1.37.0 portable backup warns and only clears projects after confirmation', () => withDatabase(async () => {
        const doc = await db.addLibraryDocument(file('v1.37.0 original'));
        const chatId = await saveChat(29, 'v1.37.0 chat');
        await db.setChatDocuments(chatId, [doc.id]);
        const legacy = JSON.parse(await (await app.createFullBackup()).text());
        delete legacy.data.projectData;
        legacy.minimumReaderVersion = 137;
        const json = JSON.stringify(legacy);
        const project = await db.createProject({ name: 'current project' });
        await db.setChatProject(chatId, project.id);
        await db.addProjectDocument(project.id, doc.id);
        await fails(() => app.importDataFromString(json, { source: 'file' }), /確認してください/);
        const confirm = ui.showCustomConfirm;
        const alert = ui.showCustomAlert;
        const alerts = [];
        let warning;
        try {
            ui.showCustomAlert = async message => { alerts.push(message); throw new Error('stop test reload'); };
            ui.showCustomConfirm = async message => { warning = message; return false; };
            await app.handleFullBackupImport(file(json, 'v1.37.0.json'));
            assert(warning.includes('プロジェクト、チャットの所属、共有ファイルの関連付けが失われます'));
            eq(await db.getChatProject(chatId), project);
            const revision = await db.getProjectSyncContext();
            ui.showCustomConfirm = async () => {
                await db.updateProject(project.id, { name: 'edited while confirming' });
                return true;
            };
            await fails(() => app.handleFullBackupImport(file(json, 'v1.37.0.json')), /stop test reload/);
            assert(alerts.at(-1).includes('準備中にプロジェクト情報'));
            eq((await db.getChatProject(chatId)).name, 'edited while confirming');
            ui.showCustomConfirm = async () => true;
            await fails(() => app.handleFullBackupImport(file(json, 'v1.37.0.json')), /stop test reload/);
            assert(alerts.some(message => message.includes('バックアップを復元しました')));
            assert((await db.getProjectSyncContext()).revision !== revision.revision);
            eq(await db.listProjects(), []);
            eq(await db.getChatProject(chatId), undefined);
            eq(await db.listProjectDocuments(project.id), []);
            eq(await ids(chatId), [doc.id]);
            eq(await (await db.getLibraryOriginal(doc.id)).blob.text(), 'v1.37.0 original');
        } finally { Object.assign(ui, { showCustomConfirm: confirm, showCustomAlert: alert }); }
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
        const originalUploads = [];
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
                    if (path.startsWith(api.DOCUMENTS_DIR_PATH + '/')) originalUploads.push(path);
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
                delete legacy.data.projectData;
                legacy.minimumReaderVersion = 136;
                await fails(() => app.importDataFromString(JSON.stringify(legacy), { source: 'dropbox' }), /ファイル/);
                await db.deleteLibraryDocument(doc.id);
                await app._doPush();
                eq(commits.at(-1).minimumReaderVersion, 138);
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
                delete legacy.data.projectData;
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
            await test('Dropbox round-trips projects and empty deletions, retains concurrent changes and blocks old data', async () => {
                const uploadsBefore = originalUploads.length;
                files.delete(api.METADATA_PATH);
                let project, document, member, snapshot, emptySnapshot, revision;
                await withDatabase(async () => {
                    await connect();
                    document = await db.addLibraryDocument(file('project-shared original'));
                    member = await saveChat(40, 'project member');
                    project = await db.createProject({ name: 'shared' });
                    const other = await db.createProject({ name: 'also shared' });
                    await db.setChatProject(member, project.id);
                    await db.addProjectDocument(project.id, document.id);
                    await db.addProjectDocument(other.id, document.id);
                    const before = await db.getProjectSyncContext();
                    const peer = await DocumentLibrary.request(indexedDB.open(st.db.name));
                    beforeCommit = async () => {
                        await DocumentLibrary.transaction(peer, [ProjectStore.projects, 'settings'], 'readwrite', async tx => {
                            tx.objectStore(ProjectStore.projects).put({ ...project, name: 'edited during push' });
                            await ProjectStore.markChanged(tx.objectStore('settings'));
                        });
                    };
                    try { await app._doPush(); }
                    finally { beforeCommit = undefined; peer.close(); }
                    const sent = JSON.parse(await metadata());
                    eq(sent.minimumReaderVersion, 138);
                    eq(sent.data.projectData.revision, before.revision);
                    eq(sent.data.projectData.projects.find(row => row.id === project.id).name, 'shared');
                    const pending = await db.getProjectSyncContext();
                    eq(pending.syncedRevision, before.revision);
                    assert(pending.revision !== pending.syncedRevision && st.sync.isDirty);
                    eq((await db.getSetting('syncIsDirty')).value, true);
                    await app._doPush();
                    snapshot = await metadata();
                    revision = JSON.parse(snapshot).data.projectData.revision;
                    eq(revision, pending.revision);
                    eq(originalUploads.length - uploadsBefore, 1);
                    eq((await db.getProjectSyncContext()).syncedRevision, revision);
                    const badRemote = JSON.parse(snapshot);
                    badRemote.data.projectData.chats[0].projectId = 'invalid';
                    await fails(() => app.importDataFromString(JSON.stringify(badRemote), { source: 'dropbox' }), /プロジェクト情報/);
                    eq((await db.getChatProject(member)).name, 'edited during push');

                    const oldRemote = JSON.parse(snapshot);
                    delete oldRemote.data.projectData;
                    oldRemote.minimumReaderVersion = 137;
                    const saved = remote();
                    files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(oldRemote)]), rev: String(++counter) });
                    await app.handlePull();
                    assert(statuses.at(-1).message.includes('プロジェクト情報がありません'));
                    eq((await db.getChatProject(member)).name, 'edited during push');
                    files.set(api.METADATA_PATH, saved);
                    await db.deleteProject(project.id);
                    await db.deleteProject(other.id);
                    await app._doPush();
                    emptySnapshot = await metadata();
                    const empty = JSON.parse(emptySnapshot);
                    eq(empty.minimumReaderVersion, 138);
                    eq(empty.data.projectData.projects, []);
                    eq(empty.data.projectData.chats, []);
                    eq(empty.data.projectData.documents, []);
                    assert(empty.data.projectData.revision !== revision);
                    eq(originalUploads.length - uploadsBefore, 1);
                    const newest = remote();
                    files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(oldRemote)]), rev: String(++counter) });
                    await app.handlePull();
                    assert(statuses.at(-1).message.includes('プロジェクト情報がありません'));
                    eq((await db.getProjectSyncContext()).syncedRevision, empty.data.projectData.revision);
                    files.set(api.METADATA_PATH, newest);
                });
                await withDatabase(async () => {
                    await connect();
                    const legacy = JSON.parse(snapshot);
                    delete legacy.data.projectData;
                    legacy.minimumReaderVersion = 137;
                    await app.importDataFromString(JSON.stringify(legacy), { source: 'dropbox' });
                    eq(await db.listProjects(), []);
                    eq(await (await db.getLibraryOriginal(document.id)).blob.text(), 'project-shared original');
                    await app.importDataFromString(snapshot, { source: 'dropbox' });
                    await app.initializeSyncState();
                    eq((await db.getChatProject(member)).name, 'edited during push');
                    eq((await db.listProjectDocuments(project.id)).map(item => item.id), [document.id]);
                    eq((await db.getProjectSyncContext()).syncedRevision, revision);
                    await db.updateProject(project.id, { name: 'second device edit' });
                    await app._doPush();
                    assert(statuses.at(-1).message.includes('Dropboxに新しいプロジェクト情報'));
                    eq(await metadata(), emptySnapshot);
                    await app.handlePull();
                    assert(statuses.at(-1).message.includes('未同期のプロジェクト'));
                    eq((await db.getChatProject(member)).name, 'second device edit');
                    ui.showCustomConfirm = async message => {
                        assert(message.includes('未同期のプロジェクト'));
                        return false;
                    };
                    await app.handlePull(true);
                    eq((await db.getChatProject(member)).name, 'second device edit');
                    const projectsBefore = await db.getProjectSyncContext();
                    const peer = await DocumentLibrary.request(indexedDB.open(st.db.name));
                    try {
                        await DocumentLibrary.transaction(peer, [ProjectStore.chats, 'settings'], 'readwrite', async tx => {
                            tx.objectStore(ProjectStore.chats).delete(member);
                            await ProjectStore.markChanged(tx.objectStore('settings'));
                        });
                    } finally { peer.close(); }
                    await fails(() => app.importDataFromString(emptySnapshot, {
                        source: 'dropbox', allowProjectReplace: true, projectsBefore
                    }), /準備中にプロジェクト情報/);
                    eq(await db.getChatProject(member), undefined);
                    eq((await db.getProject(project.id)).name, 'second device edit');
                    await app.importDataFromString(emptySnapshot, { source: 'dropbox', allowProjectReplace: true });
                    eq(await db.listProjects(), []);
                    eq(await db.getChatProject(member), undefined);
                    eq((await db.getChat(member)).title, 'project member');
                    eq(await (await db.getLibraryOriginal(document.id)).blob.text(), 'project-shared original');
                });
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

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
        ...(id !== undefined && { id }), title: content, messages: [{ role: 'user', content }], ...extra
    }, { skipPush: true });
    const ids = async chatId => (await db.getChatDocuments(chatId)).map(document => document.id);

    for (const version of [16, 17, 18]) await test('IndexedDB v' + version + ' upgrades in place with chats, projects, originals and links intact', async () => {
        const blob = file('legacy original');
        const project = { id: DocumentLibrary.uniqueId(), name: '旧プロジェクト', description: '', createdAt: 1, updatedAt: 1 };
        const entry = { id: DocumentLibrary.uniqueId(), version: 1, versionId: DocumentLibrary.uniqueId(), name: blob.name,
            fileName: blob.name, format: 'md', mimeType: blob.type, size: blob.size, hash: await DocumentLibrary.digest(blob),
            createdAt: 1, updatedAt: 1 };
        await withDatabase(async () => {
            eq(st.db.version, 19);
            const chat = await db.getChat(42);
            eq(chat.title, 'legacy chat');
            assert(DocumentLibrary.isId(chat.syncIdentity));
            eq(chat.syncLegacyOrigin, { syncId: 'previous-dropbox-sync', id: 42, createdAt: null });
            eq((await db.getChatSyncContext()).syncId, 'previous-dropbox-sync');
            eq((await db.getChatSyncContext()).pending, false);
            eq(await db.getLibraryDocument(entry.id), entry);
            eq(await (await db.getLibraryOriginal(entry.id, 1)).blob.text(), 'legacy original');
            eq(await ids(42), [entry.id]);
            const hasProjects = version >= 17;
            if (hasProjects) {
                eq(await db.getChatProject(42), project);
                eq((await db.listProjectDocuments(project.id))[0].referenceMode, 'full');
                eq(DocumentLibrary.referenceMode((await db.getChatDocuments(42))[0]), 'rag');
                eq((await db.getChatRagDocuments(42)).documents[0].referenceMode, 'full');
            }
            eq(await DocumentLibrary.request(db._getStore(DocumentLibrary.embeddingStore).count()), 0);
            for (const store of ProjectStore.stores) {
                eq(await DocumentLibrary.request(db._getStore(store).count()), hasProjects ? 1 : 0);
                eq(await DocumentLibrary.request(db._getStore(store + '_temp').count()), 0);
            }
        }, async name => {
            const connection = await new Promise((resolve, reject) => {
                const open = indexedDB.open(name, version);
                open.onerror = () => reject(open.error);
                open.onupgradeneeded = () => {
                    const legacy = open.result;
                    legacy.createObjectStore('chats', { keyPath: 'id', autoIncrement: true }).add({ id: 42, title: 'legacy chat' });
                    legacy.createObjectStore('settings', { keyPath: 'key' }).put({ key: 'lastSyncId', value: 'previous-dropbox-sync' });
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
                    if (version >= 17) {
                        ProjectStore.upgrade(legacy);
                        open.transaction.objectStore(ProjectStore.projects).add(project);
                        open.transaction.objectStore(ProjectStore.chats).add({ chatId: 42, projectId: project.id });
                        open.transaction.objectStore(ProjectStore.documents).add({ projectId: project.id, documentId: entry.id, referenceMode: 'full' });
                    }
                    if (version >= 18) {
                        legacy.createObjectStore(DocumentLibrary.embeddingStore, { keyPath: 'key' }).createIndex('specId', 'specId');
                    }
                };
                open.onsuccess = () => resolve(open.result);
            });
            connection.close();
            if (version !== 18) return;

            const update = IDBCursorWithValue.prototype.update;
            const open = indexedDB.open;
            IDBCursorWithValue.prototype.update = function (value) {
                const request = update.call(this, value);
                if (this.source.name === 'chats') request.addEventListener('success', () => this.source.transaction.abort());
                return request;
            };
            try {
                indexedDB.open = (_, version) => open.call(indexedDB, name, version);
                await fails(() => db.openDB(), /AbortError/);
            } finally {
                indexedDB.open = open;
                IDBCursorWithValue.prototype.update = update;
            }
            const unchanged = await DocumentLibrary.request(indexedDB.open(name, 18));
            try {
                assert(!unchanged.objectStoreNames.contains(db.chatJournal.store));
                const chat = await DocumentLibrary.request(unchanged.transaction('chats').objectStore('chats').get(42));
                eq(chat, { id: 42, title: 'legacy chat' });
            } finally { unchanged.close(); }
        });
    });

    const journal = () => DocumentLibrary.request(db._getStore(db.chatJournal.store).getAll(IDBKeyRange.bound(1, Number.MAX_SAFE_INTEGER)));
    const checkpoint = () => read(db.chatJournal.store, db.chatJournal.checkpointKey);
    const base = async () => JSON.parse(await (await read(db.chatJournal.store, db.chatJournal.snapshotKey)).text());
    await test('Chat writes and tombstones are atomic and survive reopening IndexedDB', () => withDatabase(async () => {
        const chatId = await saveChat(42, 'local');
        const { syncIdentity } = await db.getChat(chatId);
        const originalAdd = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
            const result = originalAdd.apply(this, args);
            if (this.name === db.chatJournal.store) result.addEventListener('success', () => this.transaction.abort());
            return result;
        };
        try {
            await fails(() => saveChat(43, 'aborted creation'), /中断|AbortError/);
            await fails(() => db.updateChatTitleDb(chatId, 'aborted edit'), /中断|AbortError/);
            await fails(() => db.deleteChat(chatId), /中断|AbortError/);
        } finally { IDBObjectStore.prototype.add = originalAdd; }
        eq(await db.getChat(43), undefined);
        eq((await db.getChat(chatId)).title, 'local');
        eq((await journal()).map(row => row.operation), ['create']);
        await db.updateChatTitleDb(chatId, 'edited');
        await db.updateChatPinState(chatId, true);
        const doc = await db.addLibraryDocument(file('tombstone fixture'));
        const project = await db.createProject({ name: 'tombstone project' });
        await db.setChatDocuments(chatId, [doc.id]);
        await db.setChatProject(chatId, project.id);

        const remove = IDBObjectStore.prototype.delete;
        IDBObjectStore.prototype.delete = function (key) {
            const result = remove.call(this, key);
            if (this.name === ProjectStore.chats) result.addEventListener('success', () => this.transaction.abort());
            return result;
        };
        try {
            await fails(() => db.deleteChat(chatId), /中断|AbortError/);
        } finally { IDBObjectStore.prototype.delete = remove; }
        eq(await ids(chatId), [doc.id]);
        eq(await db.getChatProject(chatId), project);
        eq((await journal()).map(row => row.operation), ['create', 'update', 'update']);
        await db.deleteChat(chatId);
        const name = st.db.name;
        st.db.close();
        st.db = await DocumentLibrary.request(indexedDB.open(name));
        await app.initializeSyncState();
        eq(await db.getChat(chatId), undefined);
        eq(await ids(chatId), []);
        eq(await db.getChatProject(chatId), undefined);
        assert(st.sync.isDirty && (await db.getChatSyncContext()).pending);
        const rows = await journal();
        eq(rows.map(row => row.operation), ['create', 'update', 'update', 'delete']);
        assert(rows.every(row => row.entityType === 'chat' && row.entityId === syncIdentity && row.status === 'pending' && row.baseSyncId === null));
        eq(new Set(rows.map(row => row.operationId)).size, rows.length);
    }));

    await test('V2 snapshots carry portable identity and legacy imports share identity only within the same snapshot', async () => {
        let snapshot, identity, firstId;
        await withDatabase(async () => {
            firstId = await saveChat(undefined, 'device A');
            identity = (await db.getChat(firstId)).syncIdentity;
            snapshot = JSON.parse(await (await app.createFullBackup()).text());
            eq(snapshot.data.chats[0].syncIdentity, identity);
            assert(snapshot.data.chats[0].syncLegacyOrigin === undefined);
            assert(!JSON.stringify(snapshot).includes('sync_journal'));
        });
        await withDatabase(async () => {
            const id = await saveChat(undefined, 'device B');
            eq(id, firstId);
            const unrelated = (await db.getChat(id)).syncIdentity;
            assert(unrelated !== identity);
            const fence = await db.getChatSyncContext();
            await db.updateChatTitleDb(id, 'new local edit');
            await fails(() => app.importDataFromString(JSON.stringify(snapshot), { source: 'file', chatSyncBefore: fence }), /準備中にチャット/);
            eq((await db.getChat(id)).title, 'new local edit');
            await app.importDataFromString(JSON.stringify(snapshot), { source: 'file' });
            eq((await db.getChat(id)).syncIdentity, identity);
            eq((await journal()).slice(-2).map(row => [row.operation, row.entityId]), [['delete', unrelated], ['create', identity]]);
        });
        delete snapshot.data.chats[0].syncIdentity;
        const restoreLegacy = () => withDatabase(async () => {
            await app.importDataFromString(JSON.stringify(snapshot), { source: 'file' });
            return (await db.getChat(firstId)).syncIdentity;
        });
        const legacy = await restoreLegacy();
        eq(await restoreLegacy(), legacy);
        snapshot.syncId += '_different';
        assert(await restoreLegacy() !== legacy);
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
        const history = new Map();
        const movedHistory = new Map();
        const metadataFileId = 'id:fixture-metadata';
        const folders = new Set();
        const commits = [];
        const statuses = [];
        const originalUploads = [];
        let counter = 0, failOriginal = false, beforeCommit, beforeDraftCommit, metadataAttempts = 0,
            loseUploadResponse = false, historyRequests = [];
        const historyRev = index => index.toString(16).padStart(9, '0');
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
                const entry = path?.startsWith('rev:') ? history.get(path.slice(4)) ?? movedHistory.get(path.slice(4)) : files.get(path);
                if (request.pathname.endsWith('/list_revisions')) {
                    if (args.mode === 'id') {
                        eq([path, args.limit, args.before_rev], [metadataFileId, 100, undefined]);
                        historyRequests.push('id');
                    } else {
                        eq([path, args.mode, args.limit], [api.METADATA_PATH, 'path', 100]);
                        historyRequests.push(args.before_rev ?? null);
                    }
                    const all = args.mode === 'id' ? [...movedHistory.values()] : [...history.values()];
                    const offset = args.before_rev ? all.findIndex(row => row.rev === args.before_rev) + 1 : 0;
                    if (args.before_rev) assert(offset > 0, 'unknown history cursor');
                    return Response.json({ entries: all.slice(offset, offset + 100).map(row => ({ rev: row.rev, id: row.listedId ?? row.id })),
                        has_more: all.length > offset + 100 });
                }
                if (request.pathname.endsWith('/download')) {
                    const id = path === api.METADATA_PATH ? metadataFileId : entry?.id;
                    return entry ? new Response(entry.blob, { headers: { 'Dropbox-API-Result': JSON.stringify({ rev: entry.rev, id }) } }) : notFound();
                }
                if (request.pathname.endsWith('/upload')) {
                    if (path.startsWith(api.DRAFTS_DIR_PATH + '/')) {
                        await beforeDraftCommit?.(JSON.parse(options.body));
                        assert(args.strict_conflict && args.autorename === false);
                        if (args.mode === 'add' ? files.has(path) : args.mode.update !== files.get(path)?.rev) return conflict();
                    }
                    if (path.startsWith(api.DOCUMENTS_DIR_PATH + '/')) originalUploads.push(path);
                    if (path.startsWith(api.DOCUMENTS_DIR_PATH + '/') && failOriginal) return new Response('', { status: 503 });
                    if (path === api.METADATA_PATH) {
                        metadataAttempts++;
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
                    if (path === api.METADATA_PATH && loseUploadResponse) {
                        loseUploadResponse = false;
                        throw new TypeError('connection lost after server commit');
                    }
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
                eq((await checkpoint()).source, 'migration');
                eq((await journal()).map(row => row.status), ['pending']);
                failOriginal = false;
                await app._doPush();
                assert(commits.length === 1, JSON.stringify(statuses.at(-1)));
                first = await metadata();
                eq((await checkpoint()).syncId, JSON.parse(first).syncId);
                eq((await checkpoint()).dropboxRev, remote().rev);
                eq(await base(), JSON.parse(first));

                await db.replaceLibraryDocument(doc.id, file('cloud v2'));
                const attempts = metadataAttempts;
                beforeCommit = async () => { files.set(api.METADATA_PATH, { ...remote(), rev: String(++counter) }); };
                await app._doPush();
                eq(await metadata(), first);
                eq(commits.length, 1);
                eq((await checkpoint()).syncId, JSON.parse(first).syncId);
                eq(metadataAttempts - attempts, 3);
                assert(statuses.some(({ status, message }) => status === 'error' && message.includes('同時更新が続いた')));
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
                eq((await checkpoint()).source, 'pull');
                eq((await db.getChat(chatId)).syncIdentity, JSON.parse(first).data.chats[0].syncIdentity);
                eq(await base(), JSON.parse(first));
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
                assert(statuses.some(({ status, message }) => status === 'error' && message.includes('資料ライブラリの変更が競合')));

                ui.showCustomConfirm = async () => { throw Error('unexpected destructive confirmation'); };
                await app.handlePull(true);
                assert(statuses.at(-1).message.includes('資料ライブラリの変更が競合'));
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
                eq(warnings.length, 0);
                assert(statuses.at(-1).status !== 'error', JSON.stringify(statuses.at(-1)));
                assert((await db.getAllChats()).some(row => row.id === chatId));
                eq(await ids(linked), [document.id]);
            });
            await test('First join preserves both sets of chats through CAS and a lost upload response', () => withDatabase(async () => {
                files.delete(api.METADATA_PATH);
                const addChats = async (prefix) => {
                    const a = await saveChat(1, prefix + '1');
                    await saveChat(2, prefix + '2');
                    const document = await db.addLibraryDocument(file(prefix + ' original'));
                    const project = await db.createProject({ name: prefix });
                    await db.setChatProject(a, project.id);
                    await db.setChatDocuments(a, [document.id]);
                    return { identity: (await db.getChat(a)).syncIdentity, project, document };
                };
                await connect();
                const pc = await addChats('PC');
                await app._doPush();
                await withDatabase(async () => {
                    await connect();
                    const phone = await addChats('Phone');
                    let bumped = false;
                    beforeCommit = async () => {
                        if (bumped) return;
                        bumped = true;
                        const rival = JSON.parse(await metadata());
                        rival.syncId = 'join-cas-concurrent';
                        rival.data.settings.push({ key: 'join-rival-setting', value: true });
                        files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(rival)]), rev: String(++counter) });
                    };
                    const attempted = metadataAttempts;
                    loseUploadResponse = true;
                    try { await app.handleManualDropboxSync(); }
                    finally { beforeCommit = undefined; }
                    eq(metadataAttempts - attempted, 2);
                    eq(statuses.at(-1).status, 'error');
                    eq((await db.getAllChats()).length, 2);
                    eq((await checkpoint()).syncId, null);
                    eq(JSON.parse(await metadata()).data.chats.length, 4);
                    const connection = st.db;
                    const name = connection.name;
                    connection.close();
                    st.db = await DocumentLibrary.request(indexedDB.open(name));
                    await db.updateChatTitleDb(1, 'Phone edited after upload');
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).status !== 'error', JSON.stringify(statuses.at(-1)));
                    const chats = await db.getAllChats();
                    eq(chats.map(chat => chat.title).sort(), ['PC1', 'PC2', 'Phone edited after upload', 'Phone2']);
                    eq((await db.getSetting('join-rival-setting')).value, true);
                    eq(chats.find(chat => chat.syncIdentity === phone.identity).id, 1);
                    for (const row of [pc, phone]) {
                        const chat = chats.find(chat => chat.syncIdentity === row.identity);
                        eq((await db.getChatProject(chat.id)).id, row.project.id);
                        eq(await ids(chat.id), [row.document.id]);
                    }
                    assert(chats.every(chat => !chat.syncConflictOf));
                    const final = await metadata();
                    await app.handleManualDropboxSync();
                    eq(await metadata(), final);
                    eq((await db.getAllChats()).length, 4);
                });
                const committed = await metadata();
                const publishes = metadataAttempts;
                await withDatabase(async () => {
                    await connect();
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).status !== 'error', JSON.stringify(statuses.at(-1)));
                    eq((await db.getAllChats()).length, 4);
                    eq((await checkpoint()).syncId, JSON.parse(committed).syncId);
                });
                eq(metadataAttempts, publishes);
                await withDatabase(async () => {
                    await connect();
                    const id = await saveChat(1, 'Local chat with a remote tombstone');
                    const chat = await db.getChat(id);
                    const head = JSON.parse(committed);
                    head.syncProtection.deletedChats.push(chat.syncIdentity);
                    const tombstoned = JSON.stringify(head);
                    files.set(api.METADATA_PATH, { blob: new Blob([tombstoned]), rev: String(++counter) });
                    await app.handleManualDropboxSync();
                    eq(statuses.at(-1).status, 'error');
                    eq(await metadata(), tombstoned);
                    eq((await db.getChat(id)).syncIdentity, chat.syncIdentity);
                    eq((await checkpoint()).syncId, null);
                });
                eq(metadataAttempts, publishes);
            }));
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
                        await DocumentLibrary.transaction(peer, ['chats', db.chatJournal.store], 'readwrite', async tx => {
                            const store = tx.objectStore('chats');
                            const current = await DocumentLibrary.request(store.get(member));
                            db.chatJournal.writeChat(store, { ...current, title: 'chat edited during push' }, current);
                        });
                    };
                    try { await app._doPush(); }
                    finally { beforeCommit = undefined; peer.close(); }
                    const sent = JSON.parse(await metadata());
                    eq(sent.minimumReaderVersion, 138);
                    eq(sent.data.projectData.revision, before.revision);
                    eq(sent.data.projectData.projects.find(row => row.id === project.id).name, 'shared');
                    eq((await base()).data.chats.find(chat => chat.id === member).title, 'project member');
                    const rows = await journal();
                    eq(rows.map(row => [row.operation, row.status]), [['create', 'synced'], ['update', 'pending']]);
                    eq(rows[0].settledBy, sent.syncId);
                    const reopened = await DocumentLibrary.request(indexedDB.open(st.db.name));
                    st.db.close();
                    st.db = reopened;
                    eq((await db.getChat(member)).title, 'chat edited during push');
                    eq((await checkpoint()).syncId, sent.syncId);
                    assert((await db.getChatSyncContext()).pending);
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
                    eq((await base()).data.chats.find(chat => chat.id === member).title, 'chat edited during push');
                    eq((await journal()).map(row => row.status), ['synced', 'synced']);
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
                    assert(statuses.at(-1).message.includes('旧クライアント'));
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
                    assert(statuses.at(-1).message.includes('旧クライアント'));
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
                    assert(statuses.at(-1).message.includes('プロジェクトの変更が競合'));
                    eq(await metadata(), emptySnapshot);
                    await app.handlePull();
                    assert(statuses.at(-1).message.includes('プロジェクトの変更が競合'));
                    eq((await db.getChatProject(member)).name, 'second device edit');
                    await app.handlePull(true);
                    assert(statuses.at(-1).message.includes('プロジェクトの変更が競合'));
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
                    eq((await db.getChat(member)).title, 'chat edited during push');
                    eq(await (await db.getLibraryOriginal(document.id)).blob.text(), 'project-shared original');
                });
            });
            await test('Dropbox restore detects later edits and records explicitly replaced work separately', () => withDatabase(async () => {
                await connect();
                await app.importDataFromString(first, { source: 'dropbox' });
                await db.deleteChat(chatId);
                const fence = await db.getChatSyncContext();
                const local = await saveChat(50, 'created during download');
                await fails(() => app.importDataFromString(second, { source: 'dropbox', chatSyncBefore: fence,
                    allowLibraryReplace: true }), /準備中にチャット/);
                eq((await checkpoint()).syncId, JSON.parse(first).syncId);
                eq((await journal()).map(row => row.status), ['pending', 'pending']);
                eq((await db.getChat(local)).title, 'created during download');
                await app.importDataFromString(second, { source: 'dropbox', allowLibraryReplace: true });
                eq((await checkpoint()).syncId, JSON.parse(second).syncId);
                eq((await journal()).map(row => [row.operation, row.status, row.settledBy]),
                    [['delete', 'replaced', JSON.parse(second).syncId], ['create', 'replaced', JSON.parse(second).syncId]]);
                eq((await db.getChatSyncContext()).pending, false);
            }));
            await test('Joined clients merge independent changes, keep references and hold chat conflicts', () => withDatabase(async () => {
                files.delete(api.METADATA_PATH);
                await connect();
                const profile = await db.addProfile({ name: 'Shared profile' });
                for (const id of [1, 2, 3, 4, 5]) await saveChat(id, 'shared-' + id);
                await db.editProfileMemory(profile, () => ['base memory']);
                await app._doPush();
                const initial = await metadata();
                const edit = async (id, content) => {
                    const chat = await db.getChat(id);
                    await db.saveChat(null, { ...chat, messages: [{ role: 'user', content }] }, { skipPush: true, existingSnapshot: true });
                };
                const branch = async (label) => {
                    const imageId = label + '.webp';
                    await put('image_store', { id: imageId, blob: new Blob([label]) });
                    const id = await saveChat(undefined, label, { messages: [{ role: 'user', content: label, imageIds: [imageId] }] });
                    const document = await db.addLibraryDocument(file(label + ' original'));
                    const project = await db.createProject({ name: label });
                    await db.setChatProject(id, project.id);
                    await db.setChatDocuments(id, [document.id]);
                    await db.addProjectDocument(project.id, document.id);
                    await db.editProfileMemory(profile, items => [...items, label + ' memory']);
                    return { id, identity: (await db.getChat(id)).syncIdentity, document, imageId, project };
                };
                await db.updateChatTitleDb(1, 'PC title');
                await db.deleteChat(4);
                await db.deleteChat(5);
                const pc = await branch('PC');
                const mobile = await withDatabase(async () => {
                    await connect();
                    await app.handlePull();
                    if (!await db.getChat(1)) {
                        const local = JSON.parse((await app._prepareExportData({ sync: true })).metadataJson);
                        throw Error(JSON.stringify({ status: statuses.at(-1), profiles: local.data.profiles.length,
                            settings: local.data.settings.map(row => row.key), context: await db.getChatSyncContext() }));
                    }
                    await db.updateChatPinState(1, true);
                    await db.updateChatTitleDb(2, 'Mobile title');
                    await db.deleteChat(4);
                    await db.deleteChat(5);
                    const result = await branch('Mobile');
                    await app._doPush();
                    assert(await metadata() !== initial, JSON.stringify(statuses.at(-1)));
                    return result;
                });
                eq(pc.id, mobile.id);
                let bumped = false;
                beforeCommit = async () => {
                    if (bumped) return;
                    bumped = true;
                    const winner = JSON.parse(await metadata());
                    winner.syncId = 'concurrent-device-write';
                    winner.data.settings.push({ key: 'independent-remote', value: true });
                    files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(winner)]), rev: String(++counter) });
                };
                const attempts = metadataAttempts;
                try { await app._doPush(); }
                finally { beforeCommit = undefined; }
                eq(metadataAttempts - attempts, 2);
                const merged = JSON.parse(await metadata());
                eq((await checkpoint()).syncId, merged.syncId);
                const chats = await db.getAllChats();
                const byIdentity = new Map(chats.map(chat => [chat.syncIdentity, chat]));
                eq((await db.getChat(1)).title, 'PC title');
                eq((await db.getChat(1)).isPinned, true);
                eq((await db.getChat(2)).title, 'Mobile title');
                assert(chats.every(row => !row.syncConflictOf));
                eq(await db.getChat(4), undefined);
                eq(await db.getChat(5), undefined);
                eq(merged.syncProtection.deletedChats.length, 2);
                eq(byIdentity.get(pc.identity).id, pc.id);
                assert(byIdentity.get(mobile.identity).id !== pc.id);
                for (const branch of [pc, mobile]) {
                    const chat = byIdentity.get(branch.identity);
                    eq((await db.getChatProject(chat.id)).id, branch.project.id);
                    eq(await ids(chat.id), [branch.document.id]);
                    eq((await db.listProjectDocuments(branch.project.id)).map(row => row.id), [branch.document.id]);
                    eq(await (await db.getLibraryOriginal(branch.document.id, 1)).blob.text(), branch.project.name + ' original');
                    eq(await (await read('image_store', branch.imageId)).blob.text(), branch.project.name);
                    assert(merged.syncProtection.assetHashes.some(row => row.id === branch.imageId));
                }
                eq((await db.getMemory(profile)).items, ['base memory', 'Mobile memory', 'PC memory']);
                eq((await db.getSetting('independent-remote')).value, true);
                const attemptsAfter = metadataAttempts;
                await app.handlePull();
                eq(metadataAttempts, attemptsAfter);
                eq((await db.getAllChats()).filter(row => row.syncConflictOf).length, 0);
                assert(!(await db.getChatSyncContext()).pending);
                const originalHead = remote();
                const originalChat = await db.getChat(3);
                await edit(3, 'PC conflicting message');
                const rival = JSON.parse(await metadata());
                rival.syncId = 'joined-chat-conflict';
                rival.data.chats.find(row => row.id === 3).messages[0].content = 'Mobile conflicting message';
                const rivalJson = JSON.stringify(rival);
                files.set(api.METADATA_PATH, { blob: new Blob([rivalJson]), rev: String(++counter) });
                await app._doPush();
                assert(statuses.at(-1).message.includes('チャットの変更が競合'));
                eq(await metadata(), rivalJson);
                eq((await db.getChat(3)).messages[0].content, 'PC conflicting message');
                eq((await db.getAllChats()).length, chats.length);
                files.set(api.METADATA_PATH, originalHead);
                await put('chats', originalChat);

                const changed = JSON.parse(await metadata());
                changed.syncId = 'later-remote-write';
                changed.data.chats.find(row => row.id === 2).title = 'Later remote title';
                files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(changed)]), rev: String(++counter) });
                await db.updateChatTitleDb(1, 'Later PC title');
                const peer = await DocumentLibrary.request(indexedDB.open(st.db.name));
                beforeCommit = () => DocumentLibrary.transaction(peer, ['settings'], 'readwrite', tx => {
                    tx.objectStore('settings').put({ key: 'written-during-merge', value: 'peer setting' });
                });
                try { await app._doPush(); }
                finally { beforeCommit = undefined; peer.close(); }
                assert(statuses.at(-1).message.includes('この端末のデータが変わりました'));
                assert((await db.getChatSyncContext()).pending);
                eq((await db.getChat(2)).title, 'Mobile title');
                eq((await checkpoint()).syncId, merged.syncId);
                await app.handlePull();
                eq((await db.getChat(1)).title, 'Later PC title');
                eq((await db.getChat(2)).title, 'Later remote title');
                eq((await db.getSetting('written-during-merge')).value, 'peer setting');
                eq((await db.getAllChats()).filter(row => row.syncConflictOf).length, 0);

                const afterPeer = JSON.parse(await metadata());
                afterPeer.syncId = 'update-during-editor';
                afterPeer.data.chats.find(row => row.id === 2).title = 'New while editor is open';
                files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(afterPeer)]), rev: String(++counter) });
                const releaseEditor = await app.acquireDropboxEdit();
                assert(releaseEditor, 'shared editor lock was not acquired');
                try {
                    await app.handlePull();
                    eq((await db.getChat(2)).title, 'Later remote title');
                    assert(statuses.at(-1).message.includes('この端末のデータが変わりました'));
                } finally { releaseEditor(); }
                await app.handlePull();
                eq((await db.getChat(2)).title, 'New while editor is open');

                const imagePath = api.ASSETS_DIR_PATH + '/' + mobile.imageId;
                const originalImage = files.get(imagePath);
                const saved = await checkpoint();
                files.set(imagePath, { ...originalImage, blob: new Blob(['corrupted bytes']) });
                try {
                    await app.handlePull();
                    assert(statuses.at(-1).message.includes('画像アセットの内容'));
                    eq((await checkpoint()).syncId, saved.syncId);
                    eq(await (await read('image_store', mobile.imageId)).blob.text(), 'Mobile');
                } finally { files.set(imagePath, originalImage); }
            }));

            await test('Conflict backups survive reopening, fence the choice by CAS and recover a lost response', () => withDatabase(async () => {
                files.delete(api.METADATA_PATH);
                await connect();
                const id = await saveChat(1, 'Common title');
                await app._doPush();
                let current = JSON.parse(await metadata());
                const publishRemote = title => {
                    current.syncId = 'peer-' + counter;
                    current.data.chats.find(row => row.id === id).title = title;
                    files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(current)]), rev: String(++counter) });
                };
                publishRemote('Shared first edit');
                await db.updateChatTitleDb(id, 'Device edit');
                await saveChat(2, 'Independent new chat');
                const backups = () => DocumentLibrary.transaction(st.db, [db.chatJournal.store], 'readonly', tx =>
                    DocumentLibrary.request(tx.objectStore(db.chatJournal.store).getAll(IDBKeyRange.bound('conflict-backup:', 'conflict-backup:\uffff'))));
                const attempts = metadataAttempts;
                await app._doPush();
                eq(metadataAttempts, attempts);
                const name = st.db.name;
                st.db.close();
                st.db = await DocumentLibrary.request(indexedDB.open(name));
                const [archive] = await backups();
                eq(JSON.parse(await archive.deviceBackup.text()).data.chats.find(row => row.id === id).title, 'Device edit');
                eq(JSON.parse(await archive.cloudBackup.text()).data.chats[0].title, 'Shared first edit');
                await app._doPush();
                eq((await backups()).length, 1);
                const prompt = ui.showDropboxConflictChoice;
                ui.showDropboxConflictChoice = async () => null;
                try {
                    await app.handleManualDropboxSync();
                    eq(metadataAttempts, attempts);
                    eq((await backups()).length, 1);
                    eq((await db.getChat(id)).title, 'Device edit');
                    ui.showDropboxConflictChoice = async () => 'remote';
                    beforeCommit = () => publishRemote('Shared second edit');
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).message.includes('選び直してください'));
                    eq((await db.getChat(id)).title, 'Device edit');
                    eq(JSON.parse(await metadata()).data.chats[0].title, 'Shared second edit');
                    beforeCommit = undefined;
                    loseUploadResponse = true;
                    await app.handleManualDropboxSync();
                    eq((await db.getChat(id)).title, 'Device edit');
                    const settled = await metadata();
                    await app._doPush();
                    eq(await metadata(), settled);
                    eq((await db.getAllChats()).map(row => row.title).sort(), ['Independent new chat', 'Shared second edit']);
                    assert(!(await db.getChatSyncContext()).pending);
                    const backup = await archive.deviceBackup.text();
                    await withDatabase(async () => {
                        const restored = await app.importDataFromString(backup, { source:'file', allowLibraryReplace:true, allowProjectReplace:true });
                        assert(restored);
                        eq((await db.getChat(id)).title, 'Device edit');
                    });
                    current = JSON.parse(await metadata());
                    publishRemote('Another Dropbox edit');
                    await db.updateChatTitleDb(id, 'Keep this device edit');
                    ui.showDropboxConflictChoice = async () => 'local';
                    await app.handleManualDropboxSync();
                    current = JSON.parse(await metadata());
                    eq(current.data.chats.find(row => row.id === id).title, 'Keep this device edit');
                    const cloudVersions = await Promise.all((await backups()).map(async row => JSON.parse(await row.cloudBackup.text())));
                    assert(cloudVersions.some(row => row.data.chats.some(chat => chat.title === 'Another Dropbox edit')));
                    const identity = (await db.getChat(id)).syncIdentity;
                    publishRemote('Edited before deletion');
                    await db.deleteChat(id);
                    ui.showDropboxConflictChoice = async options => options.deletion ? 'delete' : null;
                    await app.handleManualDropboxSync();
                    const deletion = JSON.parse(await metadata());
                    assert(deletion.syncProtection.deletedChats.includes(identity));
                    eq(deletion.data.chats.map(row => row.title), ['Independent new chat']);
                    const kept = await Promise.all((await backups()).map(async row => JSON.parse(await row.cloudBackup.text())));
                    assert(kept.some(row => row.data.chats.some(chat => chat.title === 'Edited before deletion')));
                } finally {
                    beforeCommit = undefined;
                    ui.showDropboxConflictChoice = prompt;
                }
            }));

            await test('Interrupted first upload recovers its exact receipt while subsequent local edits remain safe', () => withDatabase(async () => {
                files.delete(api.METADATA_PATH);
                await connect();
                const id = await saveChat(1, 'first publication');
                loseUploadResponse = true;
                await app._doPush();
                assert(statuses.at(-1).status === 'error');
                eq((await checkpoint()).syncId, null);
                eq((await journal()).map(row => row.status), ['pending']);
                const firstSyncId = JSON.parse(await metadata()).syncId;
                const name = st.db.name;
                st.db.close();
                st.db = await DocumentLibrary.request(indexedDB.open(name));
                await db.updateChatTitleDb(id, 'edited after restart');
                await app.handlePull();
                const current = JSON.parse(await metadata());
                assert(current.syncId !== firstSyncId, JSON.stringify(statuses.at(-1)));
                eq(current.data.chats.map(chat => chat.title), ['edited after restart']);
                eq((await journal()).map(row => row.status), ['synced', 'synced']);
                const lostId = { ...current, syncId: 'old-format-edit' };
                delete lostId.syncProtection;
                delete lostId.data.chats[0].syncIdentity;
                lostId.data.chats[0].title = 'old client edit';
                files.set(api.METADATA_PATH, { blob: new Blob([JSON.stringify(lostId)]), rev: String(++counter) });
                await db.updateChatTitleDb(id, 'pending local edit');
                await app.handlePull();
                assert(statuses.at(-1).message.includes('旧クライアント'));
                eq((await db.getChat(id)).title, 'pending local edit');
                assert((await db.getChatSyncContext()).pending);
                eq(await metadata(), JSON.stringify(lostId));
                await withDatabase(async () => {
                    await connect();
                    await db.saveSetting('lastSyncId', lostId.syncId);
                    await saveChat(id, 'unverified migrated history');
                    await app.handlePull();
                    assert(statuses.at(-1).message.includes('共通の同期基準'));
                    eq((await db.getChat(id)).title, 'unverified migrated history');
                    eq(await metadata(), JSON.stringify(lostId));
                });
            }));
            await test('An older draft upload cannot replace a newer deletion after a revision race', () => withDatabase(async () => {
                await connect();
                const contextKey = 'chat:sync:' + DocumentLibrary.uniqueId();
                const draft = { kind: 'inputDraft', contextKey, text: 'old text', updatedAt: 10, clientId: 'PC' };
                let entered, release;
                const waiting = new Promise(resolve => { entered = resolve; });
                const paused = new Promise(resolve => { release = resolve; });
                beforeDraftCommit = row => { if (!row.deleted) { entered(); return paused; } };
                const old = api.uploadInputDraftToDropbox(draft);
                try {
                    await Promise.race([waiting, old.then(() => { throw Error('draft upload did not reach Dropbox'); })]);
                    await api.uploadInputDraftToDropbox({ ...draft, text: '', deleted: true, updatedAt: 11, clientId: 'Mobile' });
                } finally { release(); beforeDraftCommit = undefined; }
                await old;
                const remoteDraft = await api.downloadInputDraftFromDropbox(contextKey);
                assert(remoteDraft.deleted && remoteDraft.text === '');
                eq(remoteDraft.updatedAt, 11);
            }));
            await test('Dropbox finds an older revision in the first 100 and verifies its file ID at download', () => withDatabase(async () => {
                await connect();
                const add = (i, id, syncId) => {
                    const rev = historyRev(i);
                    history.set(rev, { id, listedId: metadataFileId, rev, blob: new Blob([JSON.stringify({ syncId })]) });
                };
                add(0, 'id:other-file', 'same-test-sync');
                for (let i = 1; i < 35; i++) add(i, metadataFileId, 'unrelated-test-sync');
                add(35, metadataFileId, 'same-test-sync');
                const head = { fileId: metadataFileId, rev: historyRev(999) };
                try {
                    const result = await api.findMetadataRevision(head, 'same-test-sync');
                    eq(result.reason, 'history-match');
                    eq(result.counts, { pages: 1, listed: 36, checked: 36, foreign: 1, unreadable: 0 });
                    history.delete(historyRev(35));
                    eq((await api.findMetadataRevision(head, 'same-test-sync')).reason, 'history-file-id-mismatch');
                    const movedRev = historyRev(700);
                    movedHistory.set(movedRev, { id: metadataFileId, rev: movedRev,
                        blob: new Blob([JSON.stringify({ syncId: 'same-test-sync' })]) });
                    const moved = await api.findMetadataRevision(head, 'same-test-sync');
                    eq(moved.reason, 'history-match');
                    eq(moved.counts.pages, 2);
                    eq(historyRequests.at(-1), 'id');
                    movedHistory.clear();
                    history.clear();
                    for (let i = 0; i < 301; i++) add(i, metadataFileId, 'unrelated-test-sync');
                    add(301, metadataFileId, 'same-test-sync');
                    const bounded = await api.findMetadataRevision(head, 'same-test-sync');
                    eq(bounded.reason, 'history-limit-reached');
                    eq(bounded.counts.checked, 300);
                } finally { history.clear(); movedHistory.clear(); }
            }));
            await test('A real v18 migration recovers a proven Dropbox revision without discarding either device', async () => {
                const earlier = 'legacy-base-sync', later = 'legacy-mobile-sync';
                const chat = (id, title) => ({ id, title, createdAt: id * 100, updatedAt: id * 100,
                    messages: [{ role: 'user', timestamp: id * 100 + 1, content: 'anchor ' + title }] });
                const shared = chat(1, 'shared'), removed = chat(2, 'shared to delete');
                const pc = chat(3, 'PC'), mobile = { ...chat(3, 'Mobile'), createdAt: 340 };
                const project = { id: DocumentLibrary.uniqueId(), name: 'Legacy project', createdAt: 1, updatedAt: 1 };
                const baseProjectRevision = DocumentLibrary.uniqueId(), mobileProjectRevision = DocumentLibrary.uniqueId();
                const envelope = (syncId, chats, members, revision) => ({ version: '2.0', settingsSchemaVersion: 136,
                    minimumReaderVersion: 138, syncId, exportedAt: new Date().toISOString(), data: {
                        chats, settings: [], profiles: [], assets: [], memories: [], projectData: { schemaVersion: 1, revision,
                            projects: [project], chats: members.map(chatId => ({ chatId, projectId: project.id })), documents: [] }
                    } });
                const baseJson = JSON.stringify(envelope(earlier, [shared, removed], [1], baseProjectRevision));
                const remoteJson = JSON.stringify(envelope(later, [{ ...shared, title: 'Mobile edit' }, mobile], [1, 3], mobileProjectRevision));
                files.set(api.METADATA_PATH, { blob: new Blob([remoteJson]), rev: 'legacy2' });
                const seed = (chats, members) => async name => {
                    const request = indexedDB.open(name, 18);
                    request.onupgradeneeded = () => {
                        const db = request.result;
                        for (const [store, keyPath] of [['chats', 'id'], ['settings', 'key'], ['profiles', 'id'],
                            ['image_store', 'id'], ['image_assets', 'name'], ['memory_store', 'profileId']]) {
                            db.createObjectStore(store, { keyPath, autoIncrement: store === 'chats' || store === 'profiles' });
                            db.createObjectStore(store + '_temp', { keyPath });
                        }
                        DocumentLibrary.upgrade(db);
                        db.createObjectStore(DocumentLibrary.indexStore, { keyPath: ['documentId', 'kind'] });
                        db.createObjectStore(DocumentLibrary.embeddingStore, { keyPath: 'key' }).createIndex('specId', 'specId');
                        ProjectStore.upgrade(db);
                        const tx = request.transaction;
                        tx.objectStore('settings').put({ key: 'lastSyncId', value: earlier });
                        tx.objectStore('settings').put({ key: ProjectStore.syncKey,
                            value: { revision: DocumentLibrary.uniqueId(), syncedRevision: baseProjectRevision } });
                        for (const row of chats) tx.objectStore('chats').put(row);
                        tx.objectStore(ProjectStore.projects).put(project);
                        for (const chatId of members) tx.objectStore(ProjectStore.chats).put({ chatId, projectId: project.id });
                    };
                    (await DocumentLibrary.request(request)).close();
                };
                await withDatabase(async () => {
                    await connect();
                    eq(st.db.version, 19);
                    eq(await read(db.chatJournal.store, db.chatJournal.snapshotKey), undefined);
                    const previousIdentity = (await db.getChat(1)).syncIdentity;
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).message.includes('取得できたDropboxの変更履歴'));
                    eq(await metadata(), remoteJson);
                    eq((await db.getChat(1)).syncIdentity, previousIdentity);
                    historyRequests = [];
                    history.set(historyRev(0), { id: 'id:other-file', rev: historyRev(0), blob: new Blob([baseJson]) });
                    for (let i = 1; i < 130; i++) {
                        history.set(historyRev(i), { id: metadataFileId, rev: historyRev(i), blob: new Blob([remoteJson]) });
                    }
                    history.set(historyRev(130), { id: metadataFileId, rev: historyRev(130), blob: new Blob([baseJson]) });
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).message.includes('チャットの削除と編集'));
                    eq(await metadata(), remoteJson);
                    eq((await db.getChat(2)).title, 'PC recovered edit');
                    eq((await db.getAllChats()).length, 3);
                    // Resolve the fixture's edit explicitly before retrying.
                    await put('chats', { ...await db.getChat(2), title: removed.title });
                    historyRequests = [];
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).status !== 'error', JSON.stringify(statuses.at(-1)));
                    eq(historyRequests, [null, historyRev(99)]);
                    const synced = JSON.parse(await metadata());
                    const chats = await db.getAllChats();
                    eq((await db.getChat(1)).title, 'Mobile edit');
                    eq((await db.getChat(1)).systemPrompt, 'PC prompt');
                    eq((await db.getChat(1)).syncDraftSource, previousIdentity);
                    eq(await db.getChat(2), undefined);
                    assert(chats.every(row => !row.syncConflictOf));
                    assert(synced.syncProtection.deletedChats.includes(db.chatJournal.legacyIdentity(earlier, 2)));
                    const imported = chats.find(row => row.title === 'Mobile');
                    assert(imported && imported.id !== pc.id);
                    eq((await db.getChat(3)).title, 'PC');
                    eq((await db.getChatProject(3)).id, project.id);
                    eq((await db.getChatProject(imported.id)).id, project.id);
                    eq((await checkpoint()).syncId, synced.syncId);
                    await app.handleManualDropboxSync();
                    eq(JSON.parse(await metadata()).syncId, synced.syncId);
                }, seed([{ ...shared, systemPrompt: 'PC prompt' }, { ...removed, title: 'PC recovered edit' }, pc], [1, 3]));
                history.clear();
                await withDatabase(async () => {
                    await connect();
                    files.set(api.METADATA_PATH, { blob: new Blob([remoteJson]), rev: historyRev(900) });
                    historyRequests = [];
                    await app.handleManualDropboxSync();
                    assert(statuses.at(-1).status !== 'error', JSON.stringify(statuses.at(-1)));
                    eq(historyRequests, []);
                    const synced = JSON.parse(await metadata());
                    eq((await checkpoint()).syncId, synced.syncId);
                    const otherLineage = structuredClone(synced);
                    otherLineage.syncProtection.lineage = DocumentLibrary.uniqueId();
                    const unrelated = JSON.stringify(otherLineage);
                    files.set(api.METADATA_PATH, { blob: new Blob([unrelated]), rev: historyRev(901) });
                    await fails(() => app.runDropboxMerge('push', () => {}).catch(error => {
                        eq(error.syncDiagnostic, 'lineage-mismatch');
                        throw error;
                    }), /共通の同期基準/);
                    eq((await checkpoint()).syncId, synced.syncId);
                    eq(await metadata(), unrelated);
                }, seed([{ ...shared, title: 'Mobile edit' }, mobile], [1, 3]));
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

const ProjectStore = (() => {
    const projects = 'projects';
    const chats = 'project_chats';
    const documents = 'project_documents';
    const stores = [projects, chats, documents];
    const syncKey = 'projectSync';
    // A never-edited empty store still has a recognizable revision on the wire.
    const initialRevision = '00000000000000000000000000000000';
    const legacyConflict = 'Dropboxやバックアップにプロジェクト情報がありません。現在のプロジェクト・所属・共有関係を保持するため、復元を中止しました。';
    const localConflict = '未同期のプロジェクト変更があります。バックアップを作成してから手動で同期してください。';
    const { request, syncState, uniqueId, isId, isChatId } = DocumentLibrary;
    const projectFieldsList = new Set(['id', 'name', 'description', 'createdAt', 'updatedAt']);

    function upgrade(db) {
        for (const suffix of ['', '_temp']) {
            db.createObjectStore(projects + suffix, { keyPath: 'id' });
            const memberships = db.createObjectStore(chats + suffix, { keyPath: 'chatId' });
            const shares = db.createObjectStore(documents + suffix, { keyPath: ['projectId', 'documentId'] });
            if (!suffix) {
                memberships.createIndex('projectId', 'projectId');
                shares.createIndex('projectId', 'projectId');
                shares.createIndex('documentId', 'documentId');
            }
        }
    }

    async function markChanged(settings) {
        const current = syncState(await request(settings.get(syncKey)));
        settings.put({ key: syncKey, value: { ...current, revision: uniqueId() } });
        settings.put({ key: 'syncIsDirty', value: true });
    }

    async function deleteByIndex(store, index, id) {
        const keys = await request(store.index(index).getAllKeys(IDBKeyRange.only(id)));
        for (const key of keys) store.delete(key);
        return keys.length > 0;
    }

    async function detachChat(tx, chatId) {
        const store = tx.objectStore(chats);
        if (await request(store.getKey(chatId)) === undefined) return false;
        store.delete(chatId);
        return true;
    }

    function projectFields(name, description = '') {
        if (typeof name !== 'string' || !name.trim()) throw new Error('プロジェクト名を入力してください。');
        if (typeof description !== 'string') throw new Error('プロジェクトの説明を文字列で指定してください。');
        return { name: name.trim(), description };
    }

    async function requireProject(tx, id) {
        const project = await request(tx.objectStore(projects).get(id));
        if (!project) throw new Error('プロジェクトが見つかりません。');
        return project;
    }

    function validateSnapshot(snapshot, data) {
        const invalid = () => new Error('プロジェクト情報が欠落しているか、形式または参照先が無効です。');
        if (snapshot?.schemaVersion !== 1 || !isId(snapshot.revision) ||
            !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.chats) || !Array.isArray(snapshot.documents) ||
            !Array.isArray(data.chats) ||
            (snapshot.revision === initialRevision && (snapshot.projects.length || snapshot.chats.length || snapshot.documents.length))) {
            throw invalid();
        }
        const projectIds = new Set();
        for (const project of snapshot.projects) {
            if (!project || !isId(project.id) || projectIds.has(project.id) ||
                Object.keys(project).some(key => !projectFieldsList.has(key)) ||
                typeof project.name !== 'string' || !project.name.trim() ||
                (Object.hasOwn(project, 'description') && typeof project.description !== 'string') ||
                !Number.isFinite(project.createdAt) || !Number.isFinite(project.updatedAt)) throw invalid();
            projectIds.add(project.id);
        }
        const chatIds = new Set(data.chats.map(chat => chat?.id));
        const memberships = new Set();
        for (const link of snapshot.chats) {
            if (!link || Object.keys(link).length !== 2 || !isChatId(link.chatId) || !projectIds.has(link.projectId) ||
                !chatIds.has(link.chatId) || memberships.has(link.chatId)) throw invalid();
            memberships.add(link.chatId);
        }
        const library = data.documentLibrary?.documents;
        const documentIds = new Set(Array.isArray(library) ? library.map(document => document?.id) : []);
        const shares = new Set();
        for (const link of snapshot.documents) {
            if (!link || Object.keys(link).length !== 2 || !projectIds.has(link.projectId) || !documentIds.has(link.documentId)) throw invalid();
            const key = JSON.stringify([link.projectId, link.documentId]);
            if (shares.has(key)) throw invalid();
            shares.add(key);
        }
    }

    function exportSnapshot(revision, [projectRecords, memberships, shares], data) {
        const snapshot = {
            schemaVersion: 1, revision: revision ?? initialRevision,
            projects: projectRecords, chats: memberships, documents: shares
        };
        validateSnapshot(snapshot, data);
        return snapshot;
    }

    function sameSyncState(current, expected) {
        return current.revision === expected.revision && current.syncedRevision === expected.syncedRevision;
    }

    function hasLocalConflict(current, incoming) {
        return incoming && current.revision !== current.syncedRevision && incoming.revision !== current.revision;
    }

    function isRollback(current, incoming) {
        return Boolean(current.syncedRevision && (!incoming ||
            (incoming.revision === initialRevision && current.syncedRevision !== initialRevision)));
    }

    function assertPushBase(current, incoming) {
        if (incoming && !isRollback(current, incoming) && incoming.revision !== current.revision &&
            incoming.revision !== (current.syncedRevision ?? initialRevision)) {
            throw new Error('Dropboxに新しいプロジェクト情報があります。先に手動で同期してください。');
        }
    }

    async function hasChanged(tx, snapshot) {
        const current = await Promise.all(stores.map(name => request(tx.objectStore(name).getAll())));
        const next = [snapshot?.projects ?? [], snapshot?.chats ?? [], snapshot?.documents ?? []];
        const keys = [row => row.id, row => row.chatId, row => JSON.stringify([row.projectId, row.documentId])];
        return current.some((rows, i) => {
            if (rows.length !== next[i].length) return true;
            const indexed = new Map(next[i].map(row => [keys[i](row), row]));
            return rows.some(row => {
                const other = indexed.get(keys[i](row));
                return !other || Object.keys(row).length !== Object.keys(other).length ||
                    Object.keys(row).some(key => row[key] !== other[key]);
            });
        });
    }

    return { projects, chats, documents, stores, syncKey, initialRevision, upgrade, markChanged, deleteByIndex,
        detachChat, projectFields, requireProject, validateSnapshot, exportSnapshot, sameSyncState, hasChanged,
        hasLocalConflict, isRollback, assertPushBase, legacyConflict, localConflict };
})();

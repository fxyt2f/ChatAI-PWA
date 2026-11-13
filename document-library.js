/* Shared originals, immutable versions, and per-chat links. */
const DocumentLibrary = (() => {
    const documents = 'library_documents';
    const originals = 'library_originals';
    const links = 'chat_documents';
    const indexStore = 'library_search_indexes';
    const stores = [documents, originals, links];
    const syncKey = 'documentLibrarySync';
    const formats = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html']);
    const isId = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
    const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    const isChatId = value => Number.isSafeInteger(value) && value > 0 || typeof value === 'string' && value.length > 0;
    const uniqueId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
    const invalid = () => new Error('ライブラリのデータが欠落しているか、形式が無効です。');

    function hex(bytes) {
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function digest(blob) {
        return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
    }

    function upgrade(db) {
        for (const suffix of ['', '_temp']) {
            db.createObjectStore(documents + suffix, { keyPath: 'id' });
            const versions = db.createObjectStore(originals + suffix, { keyPath: ['documentId', 'version'] });
            const relations = db.createObjectStore(links + suffix, { keyPath: ['chatId', 'documentId'] });
            if (!suffix) {
                versions.createIndex('documentId', 'documentId');
                relations.createIndex('chatId', 'chatId');
                relations.createIndex('documentId', 'documentId');
            }
        }
    }

    function discardIndex(tx, id) {
        const store = tx.objectStore(indexStore);
        store.delete([id, 'state']);
        store.delete([id, 'index']);
    }

    async function discardChangedIndexes(tx, incoming) {
        const next = new Map(incoming.map(entry => [entry.id, entry]));
        const previous = await request(tx.objectStore(documents).getAll());
        for (const entry of previous) {
            const replacement = next.get(entry.id);
            if (!replacement || ['version', 'versionId', 'hash', 'format'].some(key => entry[key] !== replacement[key])) {
                discardIndex(tx, entry.id);
            }
        }
    }

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function transaction(db, names, mode, operation) {
        const tx = db.transaction(names, mode);
        const done = new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error || new DOMException('保存処理が中断されました。', 'AbortError'));
        });
        try {
            const [result] = await Promise.all([operation(tx), done]);
            return result;
        } catch (error) {
            try { tx.abort(); } catch { /* already aborted */ }
            await done.catch(() => {});
            throw error;
        }
    }

    function syncState(record) {
        return { revision: record?.value?.revision ?? null, syncedRevision: record?.value?.syncedRevision ?? null };
    }

    async function markChanged(settings) {
        const current = syncState(await request(settings.get(syncKey)));
        settings.put({ key: syncKey, value: { ...current, revision: uniqueId() } });
        settings.put({ key: 'syncIsDirty', value: true });
    }

    function matchesVersion(entry, { expectedVersion, expectedVersionId }) {
        return (expectedVersion == null || entry.version === expectedVersion) &&
            (expectedVersionId == null || entry.versionId === expectedVersionId);
    }

    async function prepareFile(file, { fileName = file?.name } = {}) {
        const format = typeof fileName === 'string' && /\.([^.]+)$/.exec(fileName)?.[1].toLowerCase();
        if (!(file instanceof Blob) || !formats.has(format) || /[/\\\0]/.test(fileName)) {
            throw new Error('対応する形式のファイルを指定してください。');
        }
        return { fileName, format, size: file.size, mimeType: file.type, hash: await digest(file), blob: file };
    }

    async function writeDocument(db, settingsName, id, file, options = {}) {
        const versionData = await prepareFile(file, options);
        const names = [documents, originals, settingsName];
        if (id != null) names.push(indexStore);
        return transaction(db, names, 'readwrite', async tx => {
            const metadata = tx.objectStore(documents);
            const previous = id == null ? null : await request(metadata.get(id));
            if (id != null && (!previous || !matchesVersion(previous, options))) {
                throw new Error('ファイルが更新または削除されました。');
            }
            const now = Date.now();
            const version = (previous?.version ?? 0) + 1;
            const versionId = uniqueId();
            const { blob, ...fileInfo } = versionData;
            const entry = {
                ...fileInfo, id: id ?? uniqueId(), version, versionId,
                name: options.name?.trim() || previous?.name || fileInfo.fileName,
                createdAt: previous?.createdAt ?? now, updatedAt: now
            };
            tx.objectStore(originals).add({ ...fileInfo, documentId: entry.id, version, versionId, createdAt: now, blob });
            metadata.put(entry);
            if (previous) discardIndex(tx, entry.id);
            await markChanged(tx.objectStore(settingsName));
            return entry;
        });
    }

    async function deleteDocument(db, settingsName, id, options) {
        return transaction(db, [...stores, settingsName, indexStore, ProjectStore.documents], 'readwrite', async tx => {
            const metadata = tx.objectStore(documents);
            const previous = await request(metadata.get(id));
            if (!previous) return false;
            if (!matchesVersion(previous, options)) throw new Error('ファイルが更新されました。');
            const versions = tx.objectStore(originals);
            const relations = tx.objectStore(links);
            const [versionKeys, linkKeys] = await Promise.all([
                request(versions.index('documentId').getAllKeys(id)),
                request(relations.index('documentId').getAllKeys(id))
            ]);
            metadata.delete(id);
            for (const key of versionKeys) versions.delete(key);
            for (const key of linkKeys) relations.delete(key);
            discardIndex(tx, id);
            const settings = tx.objectStore(settingsName);
            if (await ProjectStore.deleteByIndex(tx.objectStore(ProjectStore.documents), 'documentId', id)) {
                await ProjectStore.markChanged(settings);
            }
            await markChanged(settings);
            return true;
        });
    }

    async function replaceLinks(tx, settingsName, chatId, ids, mode = 'replace') {
        const relations = tx.objectStore(links);
        const metadata = tx.objectStore(documents);
        const [previous, ...targets] = await Promise.all([
            request(relations.index('chatId').getAll(chatId)),
            ...(mode === 'remove' ? [] : ids.map(id => request(metadata.getKey(id))))
        ]);
        if (targets.some(id => id === undefined)) throw new Error('指定したファイルが見つかりません。');
        const oldIds = new Set(previous.map(link => link.documentId));
        const nextIds = new Set(mode === 'replace' ? ids : oldIds);
        if (mode === 'add') for (const id of ids) nextIds.add(id);
        if (mode === 'remove') for (const id of ids) nextIds.delete(id);
        const removed = previous.filter(link => !nextIds.has(link.documentId));
        const added = [...nextIds].filter(id => !oldIds.has(id));
        if (!removed.length && !added.length) return false;
        for (const link of removed) relations.delete([chatId, link.documentId]);
        for (const documentId of added) relations.add({ chatId, documentId });
        await markChanged(tx.objectStore(settingsName));
        return true;
    }

    function normalizeIds(ids) {
        if (!Array.isArray(ids) || !ids.every(isId)) throw new TypeError('ファイルIDの一覧を指定してください。');
        return [...new Set(ids)];
    }

    async function getChatDocuments(db, chatId, owner) {
        if (chatId == null) return [];
        const stores = owner ? [links, documents, owner.store] : [links, documents];
        return transaction(db, stores, 'readonly', async tx => {
            if (owner) {
                const chat = await request(tx.objectStore(owner.store).get(chatId));
                if (!chat || (chat.recordGenerationId ?? null) !== owner.recordGenerationId) {
                    throw new DOMException('チャットが別のデータに置き換わりました。', 'ChatContentConflict');
                }
            }
            const relations = await request(tx.objectStore(links).index('chatId').getAll(chatId));
            return Promise.all(relations.map(link => request(tx.objectStore(documents).get(link.documentId))));
        });
    }

    function checkFileInfo(entry) {
        if (!entry || !Number.isSafeInteger(entry.version) || entry.version < 1 || !isId(entry.versionId) ||
            typeof entry.fileName !== 'string' || /[/\\\0]/.test(entry.fileName) ||
            entry.fileName.split('.').length < 2 || entry.fileName.split('.').pop().toLowerCase() !== entry.format ||
            !formats.has(entry.format) || typeof entry.mimeType !== 'string' || !isHash(entry.hash) ||
            !Number.isSafeInteger(entry.size) || entry.size < 0) throw invalid();
    }

    function validateManifest(manifest, chats) {
        if (!manifest || manifest.schemaVersion !== 1 || !isId(manifest.revision) ||
            !Array.isArray(manifest.documents) || !Array.isArray(manifest.originals) ||
            !Array.isArray(manifest.links) || !Array.isArray(chats)) throw invalid();
        const byId = new Map();
        const histories = new Map();
        const sizes = new Map();
        const versionIds = new Set();
        for (const document of manifest.documents) {
            checkFileInfo(document);
            if (!isId(document.id) || byId.has(document.id) || !document.name?.trim?.() ||
                !Number.isFinite(document.createdAt) || !Number.isFinite(document.updatedAt)) throw invalid();
            byId.set(document.id, document);
            histories.set(document.id, new Map());
        }
        for (const original of manifest.originals) {
            checkFileInfo(original);
            const history = histories.get(original.documentId);
            if (!history || history.has(original.version) || versionIds.has(original.versionId) ||
                original.version > byId.get(original.documentId).version ||
                !Number.isFinite(original.createdAt) ||
                (sizes.has(original.hash) && sizes.get(original.hash) !== original.size)) throw invalid();
            history.set(original.version, original);
            sizes.set(original.hash, original.size);
            versionIds.add(original.versionId);
        }
        for (const [id, document] of byId) {
            const history = histories.get(id);
            const current = history.get(document.version);
            if (history.size !== document.version ||
                ['versionId', 'hash', 'fileName', 'format', 'size', 'mimeType'].some(key => current[key] !== document[key])) throw invalid();
        }
        const chatIds = new Set(chats.map(chat => chat.id));
        const linkKeys = new Set();
        for (const link of manifest.links) {
            if (!link || !isChatId(link.chatId) || !chatIds.has(link.chatId) || !byId.has(link.documentId)) throw invalid();
            const key = JSON.stringify([link.chatId, link.documentId]);
            if (linkKeys.has(key)) throw invalid();
            linkKeys.add(key);
        }
    }

    function exportSnapshot(revision, records, chats) {
        const [entries, versions, relations] = records;
        const blobs = new Map();
        if (!revision && !entries.length && !versions.length && !relations.length) return { manifest: null, blobs };
        const manifest = {
            schemaVersion: 1, revision, documents: entries, links: relations,
            originals: versions.map(({ blob, ...info }) => {
                if (!(blob instanceof Blob) || blob.size !== info.size) throw invalid();
                blobs.set(info.hash, blob);
                return info;
            })
        };
        validateManifest(manifest, chats);
        return { manifest, blobs };
    }

    async function restoreOriginals(manifest, getBlob) {
        const blobs = new Map();
        for (const original of manifest.originals) {
            if (blobs.has(original.hash)) continue;
            const blob = await getBlob(original.hash);
            if (!(blob instanceof Blob) || blob.size !== original.size || await digest(blob) !== original.hash) {
                throw new Error('ファイル原本が不足しているか、内容が一致しないため復元を中止しました。');
            }
            blobs.set(original.hash, blob);
        }
        return manifest.originals.map(original => {
            const blob = blobs.get(original.hash);
            return { ...original, blob: blob.slice(0, blob.size, original.mimeType) };
        });
    }

    return { documents, originals, links, indexStore, stores, syncKey, isId, isChatId, isHash, uniqueId, digest, upgrade, request, discardChangedIndexes,
        transaction, syncState, markChanged, writeDocument, deleteDocument, replaceLinks, normalizeIds,
        getChatDocuments, validateManifest, exportSnapshot, restoreOriginals };
})();

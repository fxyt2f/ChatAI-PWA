const DropboxSync = (() => {
    const missingBase = 'Dropboxとこの端末の共通の同期基準を確認できません。両方のデータを保持しました。';
    const oldWriter = '旧クライアントの変更を安全に照合できません。Dropboxとこの端末のデータを保持しました。';
    const concurrentLocal = '同期中にこの端末のデータが変わりました。変更を保持しています。再度同期してください。';
    const own = (value, key) => Object.hasOwn(value, key);
    const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
    const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
    const signature = value => JSON.stringify(ordered(value));
    const same = (a, b) => a === b || signature(a) === signature(b);
    const by = (rows, key) => {
        const map = new Map();
        for (const row of rows) {
            const id = key(row);
            if (id == null || map.has(id)) throw new Error('同期データに重複または不正な識別子があります。');
            map.set(id, row);
        }
        return map;
    };
    const union = (...maps) => new Set(maps.flatMap(map => [...map.keys()]));
    const sorted = (rows, key) => [...rows].sort((a, b) => {
        const x = key(a), y = key(b);
        return x < y ? -1 : x > y ? 1 : 0;
    });
    const conflict = label => new Error(`${label}の変更が競合しています。両方のデータを保持しました。`);
    const undecided = Symbol('conflict');

    function choose(base, local, remote) {
        if (same(local, remote) || same(base, remote)) return local;
        if (same(base, local)) return remote;
        return undecided;
    }

    function mergeRows(base, local, remote, label, resolve) {
        const result = [];
        for (const id of union(base, local, remote)) {
            const args = [base.get(id), local.get(id), remote.get(id)];
            let row = choose(...args);
            if (row === undecided && resolve) row = resolve(...args);
            if (row === undecided) throw conflict(label);
            if (row !== undefined) result.push(row);
        }
        return result;
    }

    function mergeFields(base, local, remote, special = {}) {
        if (![base, local, remote].every(object)) return undecided;
        const entries = [];
        for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
            const args = [base[key], local[key], remote[key]];
            let field = choose(...args);
            if (field === undecided && own(special, key)) field = special[key](...args);
            if (field === undecided) return undecided;
            if (field !== undefined) entries.push([key, field]);
        }
        return Object.fromEntries(entries);
    }

    function mergeProfile(base, local, remote) {
        return mergeFields(base, local, remote, {
            settings: mergeFields,
            // The existing daily counter is an estimate and has no per-request ID.
            apiUsage: (_, a, b) => {
                if (![a, b].every(row => row && typeof row.date === 'string' && Number.isSafeInteger(row.count))) return undecided;
                return (a.date === b.date ? a.count >= b.count : a.date > b.date) ? a : b;
            }
        });
    }

    function mergeSetting(base, local, remote) {
        if (local?.key === SettingsV136.SUCCESS_KEY && [local?.value, remote?.value].every(value =>
            value && Number.isFinite(value.completedAt))) {
            return sorted([local, remote], row => row.value.completedAt).at(-1);
        }
        if (local?.key !== SettingsV136.GLOBAL_KEY || !base || !remote) return undecided;
        const value = mergeFields(base.value, local.value, remote.value, {
            revision: (_, a, b) => Number.isSafeInteger(a) && Number.isSafeInteger(b) ? Math.max(a, b) : undecided
        });
        return value === undecided ? value : { key: local.key, value };
    }

    function mergeMemory(base, local, remote) {
        if (!local || !remote) return undecided;
        const original = base?.items ?? [];
        const seed = base ?? { profileId: local.profileId, items: [] };
        return mergeFields(seed, local, remote, {
            items: (_, a, b) => {
                if (![a, b].every(items => Array.isArray(items) && items.length >= original.length &&
                    same(items.slice(0, original.length), original))) return undecided;
                const additions = new Map([...a.slice(original.length), ...b.slice(original.length)].map(item => [signature(item), item]));
                return [...original, ...sorted([...additions], ([key]) => key).map(([, item]) => item)];
            }
        });
    }

    function validate(envelope, isIdentity, { legacy = false } = {}) {
        SettingsV136.assertCompatible(envelope);
        if (own(envelope, 'backupSchemaVersion') || typeof envelope.syncId !== 'string' || !envelope.syncId ||
            !Number.isFinite(Date.parse(envelope.exportedAt))) throw new Error('Dropboxの同期データが無効です。');
        const data = envelope.data;
        if (!['chats', 'profiles', 'memories', 'settings', 'assets'].every(key => Array.isArray(data[key]))) {
            throw new Error('Dropboxの同期データの一覧が不足しています。');
        }
        const ids = by(data.chats, chat => DocumentLibrary.isChatId(chat.id) ? chat.id : null);
        const identified = data.chats.filter(chat => isIdentity(chat.syncIdentity));
        if ((!legacy || envelope.syncProtection) && identified.length !== ids.size) throw new Error(oldWriter);
        by(identified, chat => chat.syncIdentity);
        const profiles = by(data.profiles, row => DocumentLibrary.isChatId(row.id) ? row.id : null);
        by(data.settings, row => typeof row.key === 'string' && row.key ? row.key : null);
        by(data.memories, row => profiles.has(row.profileId) ? row.profileId : null);
        by(data.assets, row => typeof row.name === 'string' && row.name && typeof row.assetId === 'string' && row.assetId ? row.name : null);
        if (data.projectData) ProjectStore.validateSnapshot(data.projectData, data);
        if (data.documentLibrary) DocumentLibrary.validateManifest(data.documentLibrary, data.chats);
        const protection = envelope.syncProtection;
        if (!own(envelope, 'syncProtection')) return;
        if (protection?.version !== 1 || !DocumentLibrary.isId(protection.lineage) ||
            !Array.isArray(protection.deletedChats) || !Array.isArray(protection.assetHashes) ||
            protection.deletedChats.some(id => !isIdentity(id)) ||
            new Set(protection.deletedChats).size !== protection.deletedChats.length ||
            protection.assetHashes.some(row => typeof row?.id !== 'string' || !row.id || !DocumentLibrary.isHash(row.hash))) {
            throw new Error('Dropboxの同期保護情報が無効です。');
        }
        const tombstones = new Set(protection.deletedChats);
        if (identified.some(chat => tombstones.has(chat.syncIdentity))) throw new Error('削除済みのチャットが同期データに含まれています。');
        by(protection.assetHashes, row => row.id);
    }

    function view(envelope) {
        const data = envelope.data;
        const projects = data.projectData;
        const library = data.documentLibrary;
        const memberships = by(projects?.chats ?? [], row => row.chatId);
        const links = new Map();
        for (const { chatId, ...link } of library?.links ?? []) {
            if (!links.has(chatId)) links.set(chatId, []);
            links.get(chatId).push(link);
        }
        const chats = by(data.chats.map(row => {
            const { id, syncIdentity, updatedAt, stats, syncLegacyOrigin, syncDraftSource, ...contents } = applyNormalizedChatPinState(row);
            return { identity: syncIdentity, chat: contents, stats, updatedAt, project: memberships.get(id)?.projectId,
                links: sorted(links.get(id) ?? [], link => link.documentId) };
        }), record => record.identity);
        const originals = new Map();
        for (const row of library?.originals ?? []) {
            if (!originals.has(row.documentId)) originals.set(row.documentId, []);
            originals.get(row.documentId).push(row);
        }
        return {
            chats, profiles: by(data.profiles, row => row.id),
            settings: by(data.settings.filter(row => row.key !== 'lastSyncTimestamp'), row => row.key),
            memories: by(data.memories, row => row.profileId), assets: by(data.assets, row => row.name),
            projects: by(projects?.projects ?? [], row => row.id),
            shares: by(projects?.documents ?? [], row => JSON.stringify([row.projectId, row.documentId])),
            documents: by((library?.documents ?? []).map(document => ({ document,
                originals: sorted(originals.get(document.id) ?? [], row => row.version) })), row => row.document.id)
        };
    }

    function chatValue(row) {
        if (!row) return;
        const { stats, updatedAt, ...content } = row;
        return content;
    }

    const groups = [
        ['messages', 'summarizedContext', 'persistentMemory', 'changeHistoryLayout'],
        ['title', 'titleSource'], ['isPinned', 'pinnedAt', 'pinStateUpdatedAt'],
        ['systemPrompt', 'generationParameters', 'parameterRevision']
    ];

    function mergeChatFields(base, local, remote) {
        const keys = new Set([...Object.keys(base.chat), ...Object.keys(local.chat), ...Object.keys(remote.chat)]);
        const chat = {};
        let stats = local.stats;
        for (const fields of [...groups, ...[...keys].filter(key => !groups.some(group => group.includes(key))).map(key => [key])]) {
            const pick = row => Object.fromEntries(fields.filter(key => own(row.chat, key)).map(key => [key, row.chat[key]]));
            const before = pick(base), left = pick(local), right = pick(remote);
            const selected = choose(before, left, right);
            if (selected === undecided) return;
            Object.assign(chat, selected);
            if (fields[0] === 'messages' && selected === right) stats = remote.stats;
        }
        const project = choose(base.project, local.project, remote.project);
        if (project === undecided) return;
        const maps = [base, local, remote].map(row => by(row.links, link => link.documentId));
        const links = [];
        for (const id of union(...maps)) {
            const chosen = choose(...maps.map(map => map.get(id)));
            if (chosen === undecided) return;
            if (chosen) links.push(chosen);
        }
        return { identity: local.identity, chat, stats, project, links: sorted(links, row => row.documentId),
            updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0) };
    }

    async function mergeChats(base, local, remote, deleted) {
        const result = new Map();
        const copies = [];
        for (const id of union(base, local, remote, deleted)) {
            const before = base.get(id), left = local.get(id), right = remote.get(id);
            if (deleted.has(id) || before && (!left || !right)) {
                if (!before && (left || right)) throw conflict('削除済みチャット');
                deleted.add(id);
                for (const row of [left, right]) {
                    if (row && !same(chatValue(row), chatValue(before))) copies.push(row);
                }
                continue;
            }
            const selected = choose(chatValue(before), chatValue(left), chatValue(right));
            if (selected !== undecided) {
                if (selected) result.set(id, same(selected, chatValue(left)) ? left : right);
                continue;
            }
            const combined = before && mergeChatFields(before, left, right);
            if (combined) {
                result.set(id, combined);
                continue;
            }
            const [original, copy] = sorted([left, right], row => signature(chatValue(row)));
            result.set(id, original);
            copies.push(copy);
        }
        for (const row of copies) {
            const digest = await DocumentLibrary.digest(new Blob([signature(chatValue(row))]));
            const identity = digest.slice(0, 32);
            if (deleted.has(identity)) continue;
            if (result.has(identity)) {
                if (result.get(identity).chat.syncConflictOf !== row.identity) throw conflict('チャットの同期ID');
                continue;
            }
            result.set(identity, { ...row, identity, chat: { ...row.chat, syncConflictOf: row.identity,
                title: `${row.chat.title || '無題のチャット'}（同期競合）` } });
        }
        return result;
    }

    function assignIds(chats, local, remote) {
        const localIds = new Map(local.data.chats.map(row => [row.syncIdentity, row.id]));
        const remoteIds = new Map((remote?.data.chats ?? []).map(row => [row.syncIdentity, row.id]));
        const reserved = new Set(localIds.values());
        let next = 0;
        for (const id of [...reserved, ...remoteIds.values()]) if (Number.isSafeInteger(id)) next = Math.max(next, id);
        return sorted([...chats.values()], row => row.identity).map(({ identity, chat, updatedAt, stats, ...links }) => {
            let id = localIds.get(identity);
            if (id == null) {
                const candidate = remoteIds.get(identity);
                id = Number.isSafeInteger(candidate) && candidate > 0 && !reserved.has(candidate) ? candidate : ++next;
                if (!Number.isSafeInteger(id)) throw new Error('チャットの内部IDを割り当てられません。');
                reserved.add(id);
            }
            return { record: { ...chat, id, syncIdentity: identity, updatedAt, ...(stats !== undefined && { stats }) }, ...links };
        });
    }

    function contents(snapshot, fields) {
        return fields.map(field => sorted(snapshot?.[field] ?? [], row => signature(row)));
    }

    function revision(fields, merged, local, remote) {
        if (remote && same(contents(merged, fields), contents(remote, fields))) return remote.revision;
        if (local && same(contents(merged, fields), contents(local, fields))) return local.revision;
        return DocumentLibrary.uniqueId();
    }

    async function merge(base, local, remote, pendingDeletes) {
        const [before, left, right] = [base, local, remote].map(view);
        const rows = (key, label, resolve) => mergeRows(before[key], left[key], right[key], label, resolve);
        const deleted = new Set([...(base.syncProtection?.deletedChats ?? []),
            ...(remote.syncProtection?.deletedChats ?? []), ...pendingDeletes]);
        const chats = assignIds(await mergeChats(before.chats, left.chats, right.chats, deleted), local, remote);
        const data = {
            chats: chats.map(row => row.record), profiles: rows('profiles', 'プロファイル', mergeProfile),
            settings: rows('settings', '設定', mergeSetting), memories: rows('memories', 'メモリ', mergeMemory),
            assets: rows('assets', '画像アセット')
        };
        const documents = rows('documents', '資料ライブラリ');
        const links = chats.flatMap(row => row.links.map(link => ({ ...link, chatId: row.record.id })));
        const [localLibrary, remoteLibrary] = [local.data.documentLibrary, remote.data.documentLibrary];
        if (localLibrary || remoteLibrary || base.data.documentLibrary) {
            const library = { schemaVersion: 1, documents: documents.map(row => row.document),
                originals: documents.flatMap(row => row.originals), links };
            library.revision = revision(['documents', 'originals', 'links'], library, localLibrary, remoteLibrary);
            data.documentLibrary = library;
        }
        const project = { schemaVersion: 1, projects: rows('projects', 'プロジェクト'),
            documents: rows('shares', 'プロジェクトの共有ファイル'),
            chats: chats.filter(row => row.project).map(row => ({ chatId: row.record.id, projectId: row.project })) };
        project.revision = revision(['projects', 'documents', 'chats'], project, local.data.projectData, remote.data.projectData);
        data.projectData = project;
        return { data, deleted: sorted(deleted, id => id) };
    }

    function logical(envelope) {
        const data = view(envelope);
        return Object.fromEntries(Object.entries(data).map(([name, map]) =>
            [name, sorted([...map], ([key]) => signature(key)).map(([key, value]) => [key, name === 'chats' ? chatValue(value) : value])]));
    }

    function legacyContents(envelope) {
        const data = envelope.data;
        return logical({ data: { ...data, chats: data.chats.map(chat => ({ ...chat, syncIdentity: JSON.stringify(chat.id) })) } });
    }

    function applyLegacyIdentities(reference, incoming, isIdentity) {
        const ids = new Map(reference.data.chats.map(chat => [chat.id, chat.syncIdentity]));
        return { ...incoming, data: { ...incoming.data, chats: incoming.data.chats.map(chat => {
            if (isIdentity(chat.syncIdentity) && chat.syncIdentity !== ids.get(chat.id)) throw new Error(oldWriter);
            return { ...chat, syncIdentity: ids.get(chat.id) };
        }) } };
    }

    async function plan({ base, local, remote, priorSyncId, fresh, legacyIds, deletes, identify, isIdentity }) {
        const knownIds = new Set(local.data.chats.map(chat => chat.syncIdentity));
        const pendingDeletes = deletes.filter(id => !knownIds.has(id));
        const lineage = remote?.syncProtection?.lineage ?? base?.syncProtection?.lineage ?? DocumentLibrary.uniqueId();
        if (!remote) {
            if (priorSyncId || base) throw new Error('以前のDropbox同期データが見つかりません。上書きを中止しました。');
            return { data: local.data, deleted: sorted(new Set(pendingDeletes), id => id), lineage };
        }
        validate(remote, isIdentity, { legacy: true });
        if (!base) {
            const exact = same(legacyContents(local), legacyContents(remote));
            if (!exact && (priorSyncId || !fresh)) throw new Error(missingBase);
            const localById = new Map(local.data.chats.map(chat => [chat.id, chat.syncIdentity]));
            const aliases = new Map();
            const chats = identify(remote.data.chats, remote.syncId).map(chat => {
                const identity = localById.get(chat.id);
                if (!identity) return chat;
                if (legacyIds.has(identity)) {
                    if (exact && identity !== chat.syncIdentity) aliases.set(chat.syncIdentity, identity);
                    return chat;
                }
                if (chat.syncIdentity !== identity) throw new Error(missingBase);
                return chat;
            });
            return { data: { ...remote.data, chats }, deleted: remote.syncProtection?.deletedChats ?? [], lineage, aliases };
        }
        validate(base, isIdentity);
        if (base.syncId !== priorSyncId) throw new Error(missingBase);
        const baseProtection = base.syncProtection;
        if (baseProtection && remote.syncProtection && baseProtection.lineage !== lineage) throw new Error(missingBase);
        if (base.data.documentLibrary && !remote.data.documentLibrary || base.data.projectData && !remote.data.projectData) {
            throw new Error(oldWriter);
        }
        const missingIdentity = remote.data.chats.some(chat => !isIdentity(chat.syncIdentity));
        if (missingIdentity || baseProtection && !remote.syncProtection) {
            if (!same(legacyContents(base), legacyContents(remote))) throw new Error(oldWriter);
            remote = applyLegacyIdentities(base, remote, isIdentity);
        }
        if (baseProtection && remote.syncProtection) {
            const retainedDeletes = new Set(remote.syncProtection.deletedChats);
            if (baseProtection.deletedChats.some(id => !retainedDeletes.has(id))) throw new Error(oldWriter);
        }
        return { ...await merge(base, local, remote, pendingDeletes), lineage };
    }

    function equalBytes(a, b, pairs) {
        if (a === b) return true;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || a.constructor !== b.constructor) return false;
        if (a instanceof Blob) {
            if (a.size !== b.size || a.type !== b.type) return false;
            pairs.push([a, b]);
            return true;
        }
        if (a instanceof Date) return a.getTime() === b.getTime();
        if (Array.isArray(a) || object(a)) {
            if (Array.isArray(a) && a.length !== b.length) return false;
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equalBytes(a[key], b[key], pairs));
        }
        return false;
    }

    // resolve from an IDB event so the caller can enqueue writes in the same
    // transaction, even when comparing Blob bytes required asynchronous I/O.
    async function assertCapture(tx, captured, journalStore, ignoredSetting) {
        const pairs = [];
        await Promise.all([...captured].map(async ([name, previous]) => {
            const rows = await DocumentLibrary.request(tx.objectStore(name).getAll());
            const select = items => name === 'settings' ? items.filter(row => !ignoredSetting(row.key)) : items;
            if (!equalBytes(select(previous), select(rows), pairs)) throw new Error(concurrentLocal);
        }));
        if (!pairs.length) return;
        await new Promise((resolve, reject) => {
            let done = false, failure;
            (async () => {
                for (const [a, b] of pairs) {
                    const [x, y] = await Promise.all([DocumentLibrary.digest(a), DocumentLibrary.digest(b)]);
                    if (x !== y) throw new Error(concurrentLocal);
                }
            })().catch(error => { failure = error; }).finally(() => { done = true; });
            const store = tx.objectStore(journalStore);
            const poll = () => {
                const request = store.getKey('checkpoint');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => done ? (failure ? reject(failure) : resolve()) : poll();
            };
            poll();
        });
    }

    return { validate, plan, logical, same, signature, concurrentLocal, assertCapture };
})();

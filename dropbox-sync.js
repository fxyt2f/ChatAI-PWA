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
    const conflict = (label, chatId, deletion) => Object.assign(
        new Error(`${label}の変更が競合しています。両方のデータを保持しました。`),
        { syncConflict: { label, chatId, deletion } });
    const undecided = Symbol('conflict');
    const deletedApiConfigIdsKey = 'apiConfigDeletedIdsV1318';

    function joinSettingConflict(key, field) {
        const knownKeys = ['apiConfigs', SettingsV136.GLOBAL_KEY, SettingsV136.SUCCESS_KEY,
            SettingsV136.REMOVED_MODELS_KEY, deletedApiConfigIdsKey, 'activeProfileId', 'legacyInitialModelRefV136',
            'globalOtherSettings', 'globalThemeSettings', 'themeSettingsProfileScoped', 'textFormattingSettings'];
        const error = conflict('設定');
        error.syncDiagnostic = 'join-setting-conflict:' + (knownKeys.includes(key) ? key : 'other') + (field ? '.' + field : '');
        return error;
    }

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

    function joinApiConfigs(local, remote) {
        const configMap = configs => new Map(configs.map(config => [config?.id, config]));
        const left = configMap(local.value), right = configMap(remote.value);
        if (left.size !== local.value.length || right.size !== remote.value.length ||
            [...union(left, right)].some(id => typeof id !== 'string' || !id.trim() || id !== id.trim())) return undecided;
        // Keep the shared order and preserve config IDs used by chat and profile model references.
        const value = [...right.values()];
        for (const [id, config] of left) {
            if (!right.has(id)) value.push(config);
            else if (!same(config, right.get(id))) return undecided;
        }
        return { ...remote, value };
    }

    function joinPreferences(key, local, remote, baseline, defaults, section) {
        const global = key === SettingsV136.GLOBAL_KEY && !section;
        const fields = new Set([...Object.keys(local), ...Object.keys(remote)]);
        const entries = [];
        // These credentials belong to the configured server. Do not combine a
        // URL from one device with credentials added for a different URL.
        const sdConnection = ['sdApiUrl', 'sdApiUser', 'sdApiPassword'];
        if (global && sdConnection.some(field => fields.has(field))) {
            const initial = { ...SettingsV136.pick(defaults, sdConnection), ...SettingsV136.pick(baseline, sdConnection) };
            const connection = side => ({ ...initial, ...SettingsV136.pick(side, sdConnection) });
            const merged = choose(initial, connection(local), connection(remote));
            if (merged === undecided) throw joinSettingConflict(key, 'sdApiUrl');
            for (const field of sdConnection) if (fields.delete(field)) entries.push([field, merged[field]]);
        }
        for (const field of fields) {
            const left = local[field], right = remote[field];
            let value;
            if (!own(local, field) || !own(remote, field)) {
                // These preference records may be sparse in earlier exports.
                value = own(remote, field) ? right : left;
            } else if (global && (field === 'theme' || field === 'appearance') && object(left) && object(right)) {
                value = joinPreferences(key, left, right, object(baseline[field]) ? baseline[field] : {}, defaults[field] ?? {}, field);
            } else if (global && field === 'dropboxAppKey' && typeof left === 'string' && typeof right === 'string') {
                // Dropbox authentication trims this value. Keep the shared representation if equivalent.
                const effective = choose('', left.trim(), right.trim());
                value = effective === undecided ? undecided : effective === right.trim() ? right : left;
            } else if (global && field === 'revision' && Number.isSafeInteger(left) && Number.isSafeInteger(right)) {
                value = Math.max(left, right);
            } else {
                const initial = own(baseline, field) ? baseline[field] : own(defaults, field) ? defaults[field] : undefined;
                value = choose(initial, left, right);
            }
            if (value === undecided) {
                const knownFields = global ? [...SettingsV136.globalKeys, 'schemaVersion', 'revision'] :
                    section ? SettingsV136[section + 'Keys'] : Object.keys(defaults);
                const path = knownFields.includes(field) ? (section ? section + '.' + field : field) : undefined;
                throw joinSettingConflict(key, path);
            }
            entries.push([field, value]);
        }
        return Object.fromEntries(entries);
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

    function mergeChats(base, local, remote, deleted, decisions) {
        const result = new Map();
        for (const id of union(base, local, remote, deleted)) {
            const before = base.get(id), left = local.get(id), right = remote.get(id);
            if (deleted.has(id) || before && (!left || !right)) {
                if (!before && (left || right)) throw conflict('削除済みチャット', id, true);
                deleted.add(id);
                for (const row of [left, right]) {
                    if (row && !same(chatValue(row), chatValue(before)) && decisions?.get(id) !== 'delete') {
                        throw conflict('チャットの削除と編集', id, true);
                    }
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
            const decision = decisions?.get(id);
            if (before && left && right && ['local', 'remote'].includes(decision)) {
                result.set(id, decision === 'local' ? left : right);
                continue;
            }
            throw conflict('チャット', before && left && right ? id : undefined);
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

    function merge(base, local, remote, pendingDeletes, joining = null, decisions) {
        const [before, left, right] = [base, local, remote].map(view);
        const rows = (key, label, resolve) => mergeRows(before[key], left[key], right[key], label, resolve);
        const deleted = new Set([...(base.syncProtection?.deletedChats ?? []),
            ...(remote.syncProtection?.deletedChats ?? []), ...pendingDeletes]);
        const chats = assignIds(mergeChats(before.chats, left.chats, right.chats, deleted, decisions), local, remote);
        const data = {
            chats: chats.map(row => row.record),
            profiles: rows('profiles', 'プロファイル', joining?.profile ?? mergeProfile),
            settings: rows('settings', '設定', joining?.setting ?? mergeSetting),
            memories: rows('memories', 'メモリ', mergeMemory),
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

    const sameLegacyContents = (local, remote) => same(legacyContents(local), legacyContents(remote));

    function participation({ base, checkpoint, priorSyncId, syncedRevisions, local, bootstrap, deletes }) {
        if (base) return 'joined';
        if (checkpoint?.syncId || priorSyncId || syncedRevisions.some(Boolean) ||
            ['push', 'pull'].includes(checkpoint?.source)) {
            return checkpoint?.source === 'migration' && priorSyncId && checkpoint.syncId === priorSyncId
                ? 'legacy' : 'recovery-required';
        }
        const data = local.data;
        const independent = deletes.length || data.chats.length || data.memories.length || data.assets.length ||
            data.documentLibrary || data.projectData?.projects.length ||
            !same(logical(local).profiles, bootstrap?.profiles ?? []);
        return independent ? 'join-local' : 'join-empty';
    }

    function planJoin({ local, remote, bootstrap, settingDefaults = {}, deletes, identify, isIdentity }) {
        const checkActiveProfile = data => {
            const id = data.settings.find(row => row.key === 'activeProfileId')?.value;
            if (id != null && !data.profiles.some(profile => profile.id === id)) {
                throw joinSettingConflict('activeProfileId');
            }
        };
        checkActiveProfile(local.data);
        const lineage = remote?.syncProtection?.lineage ?? DocumentLibrary.uniqueId();
        const live = new Set(local.data.chats.map(chat => chat.syncIdentity));
        const pendingDeletes = deletes.filter(id => !live.has(id));
        if (!remote) return { data: local.data, deleted: sorted(new Set(pendingDeletes), id => id), lineage };
        validate(remote, isIdentity, { legacy: true });
        checkActiveProfile(remote.data);
        const identified = { ...remote, data: { ...remote.data,
            chats: identify(remote.data.chats, remote.syncId) } };
        // Bootstrap records describe generated defaults on this device. They
        // can resolve overlapping settings but are never a shared deletion base.
        const defaults = new Map(bootstrap?.settings ?? []);
        const generatedProfiles = new Map(bootstrap?.profiles ?? []);
        const profile = (_, left, right) => {
            const generated = generatedProfiles.get(left?.id);
            return generated && same(generated, left) &&
                !local.data.memories.some(row => row.profileId === left.id) ? right : undecided;
        };
        const apiConfigs = envelope => envelope.data.settings.find(row => row.key === 'apiConfigs')?.value ?? [];
        for (const [incoming, other] of [[local, remote], [remote, local]]) {
            const configs = apiConfigs(incoming), existing = apiConfigs(other);
            const deletedIds = other.data.settings.find(row => row.key === deletedApiConfigIdsKey)?.value;
            if (Array.isArray(deletedIds) && Array.isArray(configs) && Array.isArray(existing) &&
                configs.some(config => deletedIds.includes(config?.id) && !existing.some(row => row?.id === config.id))) {
                throw joinSettingConflict('apiConfigs');
            }
        }
        const setting = (_, left, right) => {
            // This is a selection among the merged profiles. Preserve an existing
            // shared selection when explicitly set, while retaining both profiles.
            if (left.key === 'activeProfileId') return right.value != null ? right : left;
            const baseline = defaults.get(left?.key);
            if (own(settingDefaults, left.key) && object(left.value) && object(right.value)) {
                return { ...right, value: joinPreferences(left.key, left.value, right.value,
                    object(baseline?.value) ? baseline.value : {}, settingDefaults[left.key]) };
            }
            if (left.key === deletedApiConfigIdsKey && [left.value, right.value].every(ids =>
                Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.trim()))) {
                return { ...right, value: [...new Set([...right.value, ...left.value])] };
            }
            if (baseline && same(baseline, left)) return right;
            const resolved = left.key === 'apiConfigs' && Array.isArray(left.value) && Array.isArray(right.value)
                ? joinApiConfigs(left, right) : mergeSetting(undefined, left, right);
            if (resolved === undecided) throw joinSettingConflict(left.key);
            return resolved;
        };
        const empty = { data: { chats: [], profiles: [], settings: [], memories: [], assets: [] } };
        const result = merge(empty, local, identified, pendingDeletes, { profile, setting });
        checkActiveProfile(result.data);
        return { ...result, lineage };
    }

    function applyLegacyIdentities(reference, incoming, isIdentity) {
        const ids = new Map(reference.data.chats.map(chat => [chat.id, chat.syncIdentity]));
        return { ...incoming, data: { ...incoming.data, chats: incoming.data.chats.map(chat => {
            if (isIdentity(chat.syncIdentity) && chat.syncIdentity !== ids.get(chat.id)) throw new Error(oldWriter);
            return { ...chat, syncIdentity: ids.get(chat.id) };
        }) } };
    }

    function baseError(reason, detail = '') {
        const error = new Error(missingBase + (detail ? ' ' + detail : ''));
        error.syncDiagnostic = reason;
        return error;
    }

    function legacyRecovery(snapshot, local, remote, origins, priorSyncId, identify, isIdentity) {
        validate(snapshot, isIdentity, { legacy: true });
        validate(remote, isIdentity, { legacy: true });
        if (snapshot.syncId !== priorSyncId) throw baseError('sync-id-mismatch');
        if (snapshot.syncProtection && remote.syncProtection &&
            snapshot.syncProtection.lineage !== remote.syncProtection.lineage) throw baseError('lineage-mismatch');
        const baseChats = identify(snapshot.data.chats, snapshot.syncId);
        const byInternalId = by(baseChats, chat => chat.id);
        const originalRows = by(snapshot.data.chats, chat => chat.id);
        const aliases = new Map(), remoteIds = new Map();
        const anchor = message => [message.role, message.timestamp, message.content];
        const anchors = chat => new Set((chat.messages ?? []).filter(message =>
            message.timestamp != null && typeof message.content === 'string' && message.content.length &&
            ['model', 'user'].includes(message.role)).map(message => signature(anchor(message))));
        const matches = (before, after) => {
            if ((before.createdAt ?? null) !== (after.createdAt ?? null) || after.syncConflictOf) return false;
            const content = row => {
                const { id, syncIdentity, stats, updatedAt, ...rest } = applyNormalizedChatPinState(row);
                return rest;
            };
            if (same(content(before), content(after))) return true;
            if (!Number.isFinite(before.createdAt)) return false;
            const original = anchors(before);
            return [...anchors(after)].some(key => original.has(key));
        };
        const remoteChats = identify(remote.data.chats, remote.syncId).map((chat, index) => {
            const incoming = remote.data.chats[index];
            const before = byInternalId.get(chat.id);
            if (!before) return chat;
            const assigned = isIdentity(incoming.syncIdentity);
            if (assigned && incoming.syncIdentity === before.syncIdentity) return chat;
            if (!matches(before, chat)) throw baseError('legacy-chat-identity-unproven', '旧チャットの対応を確認できません。');
            if (assigned && isIdentity(originalRows.get(chat.id)?.syncIdentity)) {
                throw baseError('legacy-chat-identity-unproven');
            }
            if (assigned) remoteIds.set(before.syncIdentity, chat.syncIdentity);
            return assigned ? chat : { ...chat, syncIdentity: before.syncIdentity };
        });
        const localChats = local.data.chats.map(chat => {
            const before = byInternalId.get(chat.id);
            if (!before) return chat;
            const origin = origins.get(chat.syncIdentity);
            if (!origin || origin.syncId !== priorSyncId || origin.id !== chat.id) {
                if (chat.syncIdentity === before.syncIdentity) return chat;
                throw baseError('legacy-chat-identity-unproven', '旧チャットの対応を確認できません。');
            }
            if (origin.createdAt !== (before.createdAt ?? null) || !matches(before, chat)) {
                throw baseError('legacy-chat-identity-unproven', '旧チャットの対応を確認できません。');
            }
            const syncIdentity = remoteIds.get(before.syncIdentity) ?? before.syncIdentity;
            if (syncIdentity !== chat.syncIdentity) aliases.set(syncIdentity, chat.syncIdentity);
            return { ...chat, syncIdentity };
        });
        const replace = (envelope, chats) => ({ ...envelope, data: { ...envelope.data, chats } });
        const resolvedBase = replace(snapshot, baseChats.map(chat => ({
            ...chat, syncIdentity: remoteIds.get(chat.syncIdentity) ?? chat.syncIdentity
        })));
        return { base: resolvedBase, local: replace(local, localChats), remote: replace(remote, remoteChats), aliases };
    }

    function plan({ base, local, remote, priorSyncId, legacyIds, deletes, identify, isIdentity, decisions }) {
        const knownIds = new Set(local.data.chats.map(chat => chat.syncIdentity));
        const pendingDeletes = deletes.filter(id => !knownIds.has(id));
        const lineage = remote?.syncProtection?.lineage ?? base?.syncProtection?.lineage ?? DocumentLibrary.uniqueId();
        if (!remote) {
            if (priorSyncId || base) throw new Error('以前のDropbox同期データが見つかりません。上書きを中止しました。');
            return { data: local.data, deleted: sorted(new Set(pendingDeletes), id => id), lineage };
        }
        validate(remote, isIdentity, { legacy: true });
        if (!base) {
            const exact = sameLegacyContents(local, remote);
            if (exact && pendingDeletes.length) throw baseError('unverified-local-deletions');
            if (!exact) throw baseError('missing-snapshot');
            const localById = new Map(local.data.chats.map(chat => [chat.id, chat.syncIdentity]));
            const aliases = new Map();
            const chats = identify(remote.data.chats, remote.syncId).map(chat => {
                const identity = localById.get(chat.id);
                if (!identity) return chat;
                if (legacyIds.has(identity)) {
                    if (exact && identity !== chat.syncIdentity) aliases.set(chat.syncIdentity, identity);
                    return chat;
                }
                if (chat.syncIdentity !== identity) throw baseError('legacy-chat-identity-unproven');
                return chat;
            });
            return { data: { ...remote.data, chats }, deleted: remote.syncProtection?.deletedChats ?? [], lineage, aliases };
        }
        validate(base, isIdentity);
        if (base.syncId !== priorSyncId) throw baseError('sync-id-mismatch');
        const baseProtection = base.syncProtection;
        if (baseProtection && remote.syncProtection && baseProtection.lineage !== lineage) throw baseError('lineage-mismatch');
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
        return { ...merge(base, local, remote, pendingDeletes, null, decisions), lineage };
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

    return { validate, participation, planJoin, plan, legacyRecovery, baseError, logical, same, sameLegacyContents,
        signature, concurrentLocal, assertCapture };
})();

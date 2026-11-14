/* Version-pinned local analysis and retrieval for the shared document library. */
window.DocumentSearch = (() => {
    const root = new URL('.', document.currentScript.src);
    const workerUrl = new URL('document-analysis-worker.js', root);
    const vendor = new URL('vendor/document-analysis/', root);
    const algorithmVersion = 1;
    const MB = 1024 * 1024;
    const maxBytes = { pdf: 32 * MB, docx: 24 * MB };
    const maxScopeChars = 4000000;
    const jobsByDatabase = new WeakMap();
    const snapshots = new WeakMap();
    let pendingAnalysis = Promise.resolve();
    let pdfResources;

    const failure = (code, message) => Object.assign(new Error(message), { code });
    const changed = () => failure('version-changed', 'ファイルの版が変わったか、ファイルが削除されました。');
    const read = request => DocumentLibrary.request(request);
    const cacheStore = () => DocumentLibrary.indexStore;
    const descriptor = entry => ({ documentId: entry.id, documentName: entry.name, fileName: entry.fileName,
        format: entry.format, version: entry.version, versionId: entry.versionId, hash: entry.hash });
    const sameVersion = (a, b) => a?.versionId === b.versionId && a.version === b.version && a.hash === b.hash && a.format === b.format;
    const currentCache = (record, entry) => record?.algorithmVersion === algorithmVersion && sameVersion(record, entry);

    function runWorker(message, signal) {
        return new Promise((resolve, reject) => {
            signal.throwIfAborted();
            const worker = new Worker(workerUrl, { type: 'module', name: 'ChatAI document analysis' });
            const finish = (callback, value) => {
                signal.removeEventListener('abort', abort);
                worker.terminate();
                callback(value);
            };
            const abort = () => finish(reject, signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            worker.onmessage = ({ data }) => data.error
                ? finish(reject, failure(data.error.code, data.error.message)) : finish(resolve, data.result);
            worker.onerror = event => {
                event.preventDefault();
                finish(reject, failure('worker', 'ファイル解析を起動できませんでした。再試行してください。'));
            };
            worker.onmessageerror = () => finish(reject, failure('worker', '解析データを読み取れませんでした。'));
            try { worker.postMessage(message); } catch (error) { finish(reject, error); }
        });
    }

    function withDeadline(signal, ms, operation) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => controller.abort(
            failure('timeout', '処理時間の上限に達しました。小さいファイルに分割するか、再試行してください。')), ms);
        return Promise.resolve().then(() => operation(controller.signal)).finally(() => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        });
    }

    function waitFor(job, signal) {
        if (!signal) return job;
        return new Promise((resolve, reject) => {
            const abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            job.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
            if (signal.aborted) abort();
        });
    }

    class PdfResources {
        async fetch({ kind, filename }) {
            pdfResources ??= fetch(new URL('pdf-resources.json', vendor)).then(response => {
                if (!response.ok) throw failure('worker', 'PDFの解析データを読み込めませんでした。');
                return response.json();
            }).catch(error => { pdfResources = null; throw error; });
            const group = (await pdfResources)[kind];
            if (!group || !Object.hasOwn(group, filename)) throw new Error('Unavailable PDF resource');
            return Uint8Array.from(atob(group[filename]), char => char.charCodeAt(0));
        }
    }

    async function openPdf(blob, signal) {
        signal.throwIfAborted();
        const pdfjs = await import(new URL('pdf.min.js', vendor));
        const data = new Uint8Array(await blob.arrayBuffer());
        signal.throwIfAborted();
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', vendor).href;
        return pdfjs.getDocument({
            data, BinaryDataFactory: PdfResources, cMapPacked: true,
            cMapUrl: vendor.href, standardFontDataUrl: vendor.href,
            useWorkerFetch: false, useWasm: false, useSystemFonts: false, disableFontFace: true,
            enableXfa: false, isEvalSupported: false, stopAtErrors: true
        });
    }

    async function pdfBlocks(blob, signal) {
        const task = await openPdf(blob, signal);
        const abort = () => { void task.destroy().catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            signal.throwIfAborted();
            const pdf = await task.promise;
            if (pdf.numPages > 400) throw failure('page-limit', 'PDFの解析上限は400ページです。分割したファイルを登録してください。');
            const blocks = [];
            let total = 0;
            for (let page = 1; page <= pdf.numPages; page++) {
                signal.throwIfAborted();
                const source = await pdf.getPage(page);
                const { items } = await source.getTextContent();
                let text = '';
                for (const item of items) {
                    if (typeof item.str !== 'string') continue;
                    text += item.str + (item.hasEOL ? '\n' : '');
                    if (total + text.length > 800000) throw failure('content-limit', '抽出できる本文量の上限を超えました。');
                }
                source.cleanup();
                text = text.replace(/[\u0000\uFFFD]/g, '').trim();
                if (!text) continue;
                total += text.length;
                blocks.push({ text, location: { type: 'pdf', page } });
            }
            if (!blocks.length) {
                throw failure('no-pdf-text', 'PDFに読み取れるテキストがありません。画像だけのPDFにはOCRが必要です。');
            }
            return blocks;
        } catch (error) {
            signal.throwIfAborted();
            if (error.code && typeof error.code === 'string') throw error;
            if (error.name === 'PasswordException') throw failure('encrypted', 'パスワード付きPDFは解析できません。');
            throw failure('invalid-pdf', 'PDFの本文を読み取れませんでした。ファイルの破損やフォント情報を確認してください。');
        } finally {
            signal.removeEventListener('abort', abort);
            await task.destroy().catch(() => {});
        }
    }

    async function getRecord(db, entry, kind) {
        return DocumentLibrary.transaction(db, [cacheStore()], 'readonly',
            tx => read(tx.objectStore(cacheStore()).get([entry.id, kind])));
    }

    function validIndex(index, entry, status) {
        return currentCache(index, entry) && Array.isArray(index.chunks) && index.chunks.length > 0 &&
            index.chunks.length === status.chunkCount && index.totalChars === status.totalChars &&
            index.postings && typeof index.postings === 'object' && !Array.isArray(index.postings) &&
            Object.keys(index.postings).length === status.termCount &&
            index.chunks.every((chunk, order) => chunk?.order === order &&
                chunk.id === entry.versionId + ':' + (order + 1) && typeof chunk.text === 'string' &&
                chunk.text.length > 0 && chunk.text.length <= 840 && chunk.location?.type &&
                Number.isSafeInteger(chunk.length) && chunk.length >= 0);
    }

    async function persist(db, entry, status, index, signal) {
        return DocumentLibrary.transaction(db, [DocumentLibrary.documents, cacheStore()], 'readwrite', async tx => {
            const current = await read(tx.objectStore(DocumentLibrary.documents).get(entry.id));
            signal.throwIfAborted();
            if (!sameVersion(current, entry)) throw changed();
            const store = tx.objectStore(cacheStore());
            const version = { ...descriptor(entry), algorithmVersion };
            store.put({ ...version, kind: 'state', ...status });
            if (index) store.put({ ...version, kind: 'index', ...index });
            else store.delete([entry.id, 'index']);
        });
    }

    async function analyze(db, entry, controller, { historical = false } = {}) {
        const signal = controller.signal;
        let index;
        try {
            signal.throwIfAborted();
            const maximum = maxBytes[entry.format] || 8 * MB;
            if (entry.size > maximum) throw failure('size-limit', 'この形式の解析上限は ' + maximum / MB + ' MiB です。');
            const original = await window.dbUtils.getLibraryOriginal(entry.id, entry.version, entry.versionId);
            if (!original?.blob || original.hash !== entry.hash) throw changed();
            index = await withDeadline(signal, 45000, async deadline => {
                if (entry.format !== 'pdf') return runWorker({ operation: 'analyze', entry, blob: original.blob }, deadline);
                const blocks = await pdfBlocks(original.blob, deadline);
                return runWorker({ operation: 'index', entry, blocks }, deadline);
            });
            const status = { status: 'ready', chunkCount: index.chunks.length, totalChars: index.totalChars, termCount: index.termCount };
            try { if (!historical) await persist(db, entry, status, index, signal); }
            catch (error) {
                if (typeof error.code === 'string' || signal.aborted) throw error;
                throw failure('index-storage', '索引を保存できませんでした。端末の空き容量を確認してください。');
            }
            return { ...status, index: { ...descriptor(entry), ...index } };
        } catch (error) {
            if (signal.aborted) return { status: 'pending', code: 'cancelled', message: '解析を中止しました。' };
            const code = typeof error.code === 'string' ? error.code : 'analysis';
            const status = { status: 'failed', code, message: code !== 'analysis'
                ? error.message : 'ファイルを解析できませんでした。原本を確認して再試行してください。' };
            if (!historical && status.code !== 'version-changed') {
                try { await persist(db, entry, status, null, signal); }
                catch (saveError) {
                    if (saveError.code === 'version-changed') return { status: 'failed', code: saveError.code, message: saveError.message };
                }
            }
            return status;
        }
    }

    function getJobs(db) {
        if (!jobsByDatabase.has(db)) jobsByDatabase.set(db, new Map());
        return jobsByDatabase.get(db);
    }

    async function ensureIndex(entry, { retry = false, signal } = {}) {
        signal?.throwIfAborted();
        const db = await window.dbUtils.openDB();
        const jobs = getJobs(db);
        const key = entry.id + ':' + entry.versionId;
        if (jobs.has(key)) return waitFor(jobs.get(key).promise, signal);
        const status = retry ? null : await getRecord(db, entry, 'state');
        signal?.throwIfAborted();
        if (jobs.has(key)) return waitFor(jobs.get(key).promise, signal);
        if (currentCache(status, entry)) {
            if (status.status === 'failed' && typeof status.code === 'string' && typeof status.message === 'string') return status;
            const index = await getRecord(db, entry, 'index');
            signal?.throwIfAborted();
            if (status.status === 'ready' && validIndex(index, entry, status)) return { ...status, index };
        }
        let job = jobs.get(key);
        if (!job) {
            const controller = new AbortController();
            job = { controller, promise: null };
            const run = pendingAnalysis.then(() => analyze(db, entry, controller));
            job.promise = run.finally(() => jobs.delete(key));
            pendingAnalysis = job.promise.then(() => undefined, () => undefined);
            jobs.set(key, job);
        }
        return waitFor(job.promise, signal);
    }

    async function analyzeHistorical(db, entry, signal) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.throwIfAborted();
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const run = pendingAnalysis.then(() => analyze(db, entry, controller, { historical: true }));
            pendingAnalysis = run.then(() => undefined, () => undefined);
            return await waitFor(run, signal);
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }

    async function ensureSnapshotIndex(entry, signal) {
        const result = await ensureIndex(entry, { signal });
        if (result.code !== 'version-changed' && result.code !== 'cancelled') return result;
        // Replacement can invalidate the cache and cancel its in-flight analysis.
        return analyzeHistorical(await window.dbUtils.openDB(), entry, signal);
    }

    async function getStatus(entry) {
        return (await getStatuses([entry])).get(entry.id);
    }

    async function getStatuses(entries) {
        const db = await window.dbUtils.openDB();
        const jobs = getJobs(db);
        return DocumentLibrary.transaction(db, [cacheStore()], 'readonly', async tx => {
            const store = tx.objectStore(cacheStore());
            return new Map(await Promise.all(entries.map(async entry => {
                if (jobs.has(entry.id + ':' + entry.versionId)) return [entry.id, { status: 'analyzing' }];
                const record = await read(store.get([entry.id, 'state']));
                return [entry.id, currentCache(record, entry) ? record : { status: 'pending' }];
            })));
        });
    }

    async function cancelAnalysis(entry) {
        const db = await window.dbUtils.openDB();
        getJobs(db).get(entry.id + ':' + entry.versionId)?.controller.abort();
    }

    async function previewDocument(entry, options) {
        const { index, ...status } = await ensureIndex(entry, options);
        return { ...status, chunks: index?.chunks || [] };
    }

    async function analyzeDocument(entry, options) {
        const { index, ...status } = await ensureIndex(entry, options);
        return status;
    }

    function captureChat(chatId, expectedChat) {
        const token = Object.freeze({ chatId });
        const scope = chatId == null ? Promise.resolve({ projectId: null, documents: [] }) :
            window.dbUtils.getChatRagDocuments(chatId, expectedChat);
        scope.catch(() => {});
        snapshots.set(token, scope);
        return token;
    }

    async function searchChat(chatId, question, { limit = 6, signal, snapshot } = {}) {
        signal?.throwIfAborted();
        if (chatId != null && typeof chatId !== 'string' && !Number.isSafeInteger(chatId)) throw new TypeError('チャットIDが無効です。');
        if (typeof question !== 'string') throw new TypeError('質問を文字列で指定してください。');
        const query = question.trim().slice(0, 512);
        if (!query || chatId == null) return { chatId, documentCount: 0, results: [], unavailable: [] };
        if (snapshot && (!snapshots.has(snapshot) || snapshot.chatId !== chatId)) throw new TypeError('ファイルの検索対象が無効です。');
        const scope = snapshot ? await snapshots.get(snapshot) : null;
        const documents = snapshot ? scope.documents : await window.dbUtils.getChatDocuments(chatId);
        return { chatId, ...await searchDocuments(documents, query, { limit, signal, useCapturedVersions: scope?.projectId != null }) };
    }

    async function searchDocuments(documents, question, { limit = 6, signal, useCapturedVersions = false } = {}) {
        signal?.throwIfAborted();
        const query = question.trim().slice(0, 512);
        if (!query || !documents.length) return { documentCount: documents.length, results: [], unavailable: [] };
        const terms = await withDeadline(signal, 15000, deadline => runWorker({ operation: 'terms', query }, deadline));
        const indexes = [], unavailable = [];
        const sources = new Map();
        let total = 0;
        for (const entry of documents) {
            signal?.throwIfAborted();
            let result;
            try {
                result = useCapturedVersions ? await ensureSnapshotIndex(entry, signal) : await ensureIndex(entry, { signal });
            }
            catch (error) {
                signal?.throwIfAborted();
                result = { code: 'index-storage', message: '索引を読み取れませんでした。' };
            }
            const source = descriptor(entry);
            if (!result.index) {
                unavailable.push({ ...source, code: result.code, message: result.message });
                continue;
            }
            if (total + result.index.totalChars > maxScopeChars) {
                unavailable.push({ ...source, code: 'scope-limit', message: '1回の検索で扱える本文量の上限を超えました。' });
                continue;
            }
            total += result.index.totalChars;
            sources.set(entry.id, source);
            const postings = {};
            for (const term of terms) {
                const positions = result.index.postings[term];
                if (Array.isArray(positions)) postings[term] = positions;
            }
            indexes.push({ documentId: entry.id, chunks: result.index.chunks, postings });
        }
        if (!indexes.length) return { documentCount: documents.length, results: [], unavailable };
        const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(20, limit)) : 6;
        const matches = await withDeadline(signal, 15000, deadline =>
            runWorker({ operation: 'search', indexes, query, terms, limit: count }, deadline));
        return { documentCount: documents.length, unavailable, results: matches.map(match => ({
            ...sources.get(match.documentId), ...match, contentTrust: 'untrusted-document'
        })) };
    }

    function findInChunks(documents, query, signal, firstPerDocument = false) {
        return withDeadline(signal, 15000, deadline => runWorker({
            operation: 'find-text', documents, query, firstPerDocument
        }, deadline));
    }

    async function findLibraryText(entries, query, signal) {
        const matches = [], unavailable = [];
        let batch = [], chars = 0;
        for (const entry of entries) {
            signal.throwIfAborted();
            let index;
            try { ({ index } = await ensureIndex(entry, { signal })); }
            catch { signal.throwIfAborted(); }
            if (!index) { unavailable.push(entry.id); continue; }
            if (chars + index.totalChars > maxScopeChars && batch.length) {
                matches.push(...await findInChunks(batch, query, signal, true));
                batch = [];
                chars = 0;
            }
            batch.push({ id: entry.id, chunks: index.chunks });
            chars += index.totalChars;
        }
        if (batch.length) matches.push(...await findInChunks(batch, query, signal, true));
        return { matches, unavailable };
    }

    async function previewReference(reference, { signal } = {}) {
        const db = await window.dbUtils.openDB();
        signal?.throwIfAborted();
        const original = await window.dbUtils.getLibraryOriginal(reference.documentId, reference.version, reference.versionId);
        if (!original?.blob || original.hash !== reference.hash || original.format !== reference.format) {
            return { status: 'failed', code: 'source-unavailable', message: '参照元の版を利用できません。', chunks: [] };
        }
        const entry = { ...original, id: reference.documentId, name: reference.documentName };
        const status = await getRecord(db, entry, 'state');
        let index = currentCache(status, entry) && status.status === 'ready' ? await getRecord(db, entry, 'index') : null;
        signal?.throwIfAborted();
        if (!index || !validIndex(index, entry, status)) index = (await analyzeHistorical(db, entry, signal)).index;
        const chunk = index?.chunks.find(chunk => chunk.id === reference.chunkId);
        const keys = new Set([...Object.keys(chunk?.location || {}), ...Object.keys(reference.location)]);
        if (!chunk || await DocumentLibrary.digest(new Blob([chunk.text])) !== reference.chunkHash ||
            [...keys].some(key => chunk.location[key] !== reference.location[key])) {
            return { status: 'failed', code: 'source-unavailable',
                message: '記録された参考箇所を確認できません。', chunks: [] };
        }
        const available = await window.dbUtils.getLibraryOriginal(reference.documentId, reference.version, reference.versionId);
        signal?.throwIfAborted();
        if (available?.hash !== reference.hash) {
            return { status: 'failed', code: 'source-unavailable', message: '参照元の版を利用できません。', chunks: [] };
        }
        return { status: 'ready', chunkCount: index.chunks.length, chunks: index.chunks };
    }

    function formatLocation(location) {
        const range = (label, first, last) => label + ' ' + first + (last > first ? '–' + last : '');
        const heading = location.heading ? location.heading + ' · ' : '';
        switch (location.type) {
            case 'pdf': return 'ページ ' + location.page;
            case 'lines':
            case 'html': return heading + range('行', location.lineStart, location.lineEnd);
            case 'table': return 'レコード ' + location.row + ' · ' + range('行', location.lineStart, location.lineEnd);
            case 'docx': return heading + (location.table
                ? '表 ' + location.table + ' · 行 ' + location.row
                : range('段落', location.paragraphStart, location.paragraphEnd));
            case 'path': return (location.document ? '文書 ' + location.document + ' · ' : '') + location.path;
            case 'xml': return location.path;
            default: return '';
        }
    }

    return { captureChat, searchChat, searchDocuments, analyzeDocument, previewDocument, previewReference, getStatus,
        getStatuses, cancelAnalysis, formatLocation, openPdf, findInChunks, findLibraryText };
})();

/* Model weights are fetched only by the explicit download action. */
window.DocumentEmbedding = (() => {
    const root = new URL('.', document.currentScript.src);
    const workerUrl = new URL('document-embedding-worker.js', root);
    const defaultModel = 'embeddinggemma-2';
    const models = {
        [defaultModel]: {
            name: 'EmbeddingGemma 2',
            model: 'onnx-community/embeddinggemma-2-ONNX',
            revision: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
            runtime: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js',
            cacheName: 'chatai-embeddinggemma-2-daa72c5-q4',
            dtype: 'q4', dimensions: 768, queryPrefix: 'task: search result | query: ',
            specId: 'onnx-community/embeddinggemma-2-ONNX@daa72c51243991dfcaf9f9137d2c573d8f7790c0:4.3.1:webgpu:q4:768:l2:search-result+title-v1'
        }
    };
    const modelSetting = value => Object.hasOwn(models, value) ? value : defaultModel;
    let worker, loaded, pending, serial = 0, working = false, editing = false, errorText = '';
    let controls, generation = 0;
    const selected = () => models[modelSetting(window.state?.settings?.documentEmbeddingModel)];
    const workerSpec = spec => ({ ...spec, marker: new URL('embedding-ready/' + spec.cacheName, root).href });
    const status = message => { if (controls) controls.status.textContent = message; };

    function closeWorker(reason = new DOMException('意味検索を中止しました。', 'AbortError')) {
        worker?.terminate();
        worker = null;
        loaded = null;
        pending?.finish(false, reason);
    }

    function call(spec, action, payload, signal) {
        signal.throwIfAborted();
        if (!worker) {
            worker = new Worker(workerUrl, { type: 'module', name: 'ChatAI document embeddings' });
            worker.onmessage = ({ data }) => {
                if (data.progress && editing) status('モデル取得中 · ' + data.progress);
                if (data.id === pending?.id) pending.finish(!data.error, data.error ? new Error(data.error) : data.result);
            };
            worker.onerror = event => {
                event.preventDefault();
                closeWorker(new Error('意味検索Workerを起動できません。'));
            };
        }
        return new Promise((resolve, reject) => {
            const id = ++serial;
            const abort = () => closeWorker(signal.reason);
            const finish = (ok, value) => {
                signal.removeEventListener('abort', abort);
                pending = null;
                if (ok) resolve(value);
                else reject(value);
            };
            pending = { id, finish };
            signal.addEventListener('abort', abort, { once: true });
            try { worker.postMessage({ id, spec: workerSpec(spec), action, ...payload }); }
            catch (error) { closeWorker(error); }
        });
    }

    async function available(spec) {
        if (!window.caches || !await caches.has(spec.cacheName)) return false;
        return Boolean(await (await caches.open(spec.cacheName)).match(workerSpec(spec).marker));
    }

    async function initialize(spec, allowDownload, signal) {
        if (loaded === spec.specId && worker) return;
        await call(spec, 'load', { allowDownload }, signal);
        loaded = spec.specId;
    }

    async function refresh() {
        if (!controls || editing) return;
        const spec = selected();
        controls.enabled.checked = window.state?.settings?.documentEmbeddingEnabled === true;
        controls.model.value = modelSetting(window.state?.settings?.documentEmbeddingModel);
        window.settingsUiV136?.syncChoiceRows();
        const ticket = ++generation;
        const cached = await available(spec).catch(() => false);
        if (editing || generation !== ticket) return;
        controls.remove.disabled = !cached && !(await window.caches?.has(spec.cacheName).catch(() => false));
        controls.download.disabled = !navigator.gpu || cached;
        status(errorText || (!navigator.gpu ? 'WebGPU非対応。キーワード検索を使用します。' : cached ?
            loaded ? '意味検索を利用できます。' : '取得済み。意味検索時に初期化します。' :
            '未取得。キーワード検索を使用します。'));
    }

    function install() {
        if (controls) return;
        controls = Object.fromEntries(['enabled', 'model', 'status', 'download', 'remove']
            .map(key => [key, document.getElementById('document-embedding-' + key)]));
        if (!controls.model) { controls = null; return; }
        controls.model.replaceChildren(...Object.entries(models).map(([id, spec]) => new Option(spec.name, id)));
        controls.enabled.addEventListener('change', () => {
            if (!controls.enabled.checked) closeWorker();
            void window.appLogic.updateGlobalOtherSetting('documentEmbeddingEnabled', controls.enabled.checked).catch(showError);
        });
        controls.model.addEventListener('change', () => {
            closeWorker();
            errorText = '';
            void window.appLogic.updateGlobalOtherSetting('documentEmbeddingModel', controls.model.value).catch(showError);
        });
        controls.download.addEventListener('click', () => void manage(true));
        controls.remove.addEventListener('click', () => void manage(false));
        void refresh();
    }

    function showError(error) {
        errorText = '意味検索を利用できません。キーワード検索を使用します。 ' + (error?.message || '');
        status(errorText);
    }

    async function manage(download) {
        if (editing) return;
        const spec = selected();
        editing = true;
        try {
            const message = download ? 'Hugging Faceからモデル（約207 MB）、jsDelivrから実行環境を取得します。ダウンロードしますか？' :
                '端末に保存したモデルと、このモデルで作ったベクトルを削除しますか？';
            if (!await window.uiUtilsV136.showCustomConfirm(message)) return;
            controls.download.disabled = controls.remove.disabled = controls.model.disabled = controls.enabled.disabled = true;
            closeWorker();
            errorText = '';
            const action = async () => {
                if (download) {
                    status('モデルを取得・初期化中…');
                    await initialize(spec, true, AbortSignal.timeout(240000));
                    await window.appLogic.updateGlobalOtherSetting('documentEmbeddingEnabled', true);
                } else {
                    await caches.delete(spec.cacheName);
                    const db = await window.dbUtils.openDB();
                    await DocumentLibrary.transaction(db, [DocumentLibrary.embeddingStore], 'readwrite',
                        tx => DocumentLibrary.request(tx.objectStore(DocumentLibrary.embeddingStore).index('specId')
                            .getAllKeys(spec.specId)).then(keys => {
                            const store = tx.objectStore(DocumentLibrary.embeddingStore);
                            for (const key of keys) store.delete(key);
                        }));
                }
            };
            if (navigator.locks) await navigator.locks.request(spec.cacheName, action);
            else await action();
        } catch (error) {
            closeWorker();
            showError(error);
        } finally {
            editing = false;
            controls.enabled.disabled = controls.model.disabled = false;
            void refresh();
        }
    }

    const validVector = (vector, dimensions) => vector instanceof Float32Array && vector.length === dimensions &&
        Math.abs(Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) - 1) <= 0.002;

    async function score(indexes, question, sources, parent) {
        if (working || editing || window.state?.settings?.documentEmbeddingEnabled !== true || !navigator.gpu) return null;
        working = true;
        try {
            const spec = selected();
            if (!await available(spec)) { closeWorker(); return null; }
            const signal = AbortSignal.any([parent, AbortSignal.timeout(6500)]);
            const db = await window.dbUtils.openDB();
            // Round-robin avoids spending the entire inference budget on a single long document.
            const rows = [];
            for (let i = 0; rows.length < 96; i++) {
                let found = false;
                for (const index of indexes) {
                    const chunk = index.chunks[i];
                    if (!chunk) continue;
                    found = true;
                    rows.push({ ...chunk, documentId: index.documentId, source: sources.get(index.documentId) });
                    if (rows.length === 96) break;
                }
                if (!found) break;
            }
            if (!rows.length) return null;
            await Promise.all(rows.map(async row => {
                const chunkHash = await DocumentLibrary.digest(new Blob([row.text]));
                row.key = [row.documentId, row.source.versionId, row.id, chunkHash, spec.specId, row.source.documentName || ''];
            }));
            await DocumentLibrary.transaction(db, [DocumentLibrary.embeddingStore], 'readonly', async tx => {
                const store = tx.objectStore(DocumentLibrary.embeddingStore);
                await Promise.all(rows.map(async row => {
                    const record = await DocumentLibrary.request(store.get(row.key));
                    if (validVector(record?.vector, spec.dimensions)) row.vector = record.vector;
                }));
            });
            if (editing || selected() !== spec || !window.state.settings.documentEmbeddingEnabled) return null;
            await initialize(spec, false, signal);
            const [query] = await call(spec, 'embed', { texts: [{ text: question }], query: true }, signal);
            const missing = rows.filter(row => !row.vector);
            // Bound cold indexing per search. Repeated searches can backfill the rest.
            const toIndex = missing.slice(0, 24);
            while (toIndex.length) {
                const batch = toIndex.splice(0, toIndex.slice(0, 4).some(row => row.text.length > 600) ? 1 : 4);
                const vectors = await call(spec, 'embed', {
                    texts: batch.map(row => ({ title: row.source.documentName, text: row.text }))
                }, signal);
                batch.forEach((row, index) => { row.vector = vectors[index]; });
                await DocumentLibrary.transaction(db, [DocumentLibrary.embeddingStore, DocumentLibrary.documents], 'readwrite', async tx => {
                    const entries = tx.objectStore(DocumentLibrary.documents);
                    const store = tx.objectStore(DocumentLibrary.embeddingStore);
                    const current = await Promise.all(batch.map(row => DocumentLibrary.request(entries.get(row.documentId))));
                    signal.throwIfAborted();
                    if (editing || selected() !== spec) return;
                    batch.forEach((row, index) => {
                        if (current[index]?.versionId === row.source.versionId && current[index]?.hash === row.source.hash &&
                            current[index]?.name === row.source.documentName) {
                            store.put({ key: row.key, specId: spec.specId, vector: row.vector });
                        }
                    });
                });
            }
            parent.throwIfAborted();
            if (editing || selected() !== spec || !window.state.settings.documentEmbeddingEnabled) return null;
            errorText = '';
            void refresh();
            return rows.filter(row => row.vector).map(row => ({
                documentId: row.documentId, chunkId: row.id, order: row.order, text: row.text,
                excerpt: row.text, location: row.location,
                similarity: row.vector.reduce((sum, value, index) => sum + value * query[index], 0)
            })).sort((a, b) => b.similarity - a.similarity);
        } catch (error) {
            if (!parent.aborted && !editing) {
                closeWorker();
                showError(error);
            }
            return null;
        } finally {
            working = false;
        }
    }

    return { install, refresh, score, defaultModel, modelSetting };
})();

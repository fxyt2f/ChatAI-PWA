"""Chrome test of the actual embedding UI, WebGPU Worker and IndexedDB integration."""
import json
import time


def run(client, origin):
    def evaluate(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            details = result['exceptionDetails']
            raise AssertionError(details.get('exception', {}).get('description', details))
        return result.get('result', {}).get('value')

    def wait(expression, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = evaluate(expression)
            if value:
                return value
            time.sleep(0.25)
        raise AssertionError(evaluate("document.querySelector('#document-embedding-status')?.textContent"))

    client.call('Page.navigate', {'url': origin})
    wait("Boolean(window.appLogic && document.querySelector('#document-embedding-model option'))")
    client.call('Page.bringToFront')
    assert evaluate("navigator.gpu?.requestAdapter().then(Boolean)"), 'No WebGPU adapter'
    assert evaluate("caches.keys().then(keys => !keys.some(key => key.startsWith('chatai-embedding')))")
    evaluate("""(() => {
        uiUtilsV136.showCustomConfirm = async () => true;
        document.querySelector('#document-embedding-download').click();
    })()""")
    outcome = wait("""(() => {
        const text = document.querySelector('#document-embedding-status').textContent;
        return text.includes('取得済み') || text.includes('利用できます') || text.includes('利用できません') ? text : '';
    })()""", 235)
    assert '利用できません' not in outcome, outcome

    # Fresh page/worker. The ready marker must be sufficient to reuse model weights.
    client.call('Page.reload')
    wait("window.appLogic && document.querySelector('#document-embedding-status')?.textContent.includes('取得済み')")
    evaluation = evaluate("""(async () => {
        const fixtures = [
            ['断水時の受付', '蛇口から水が出ないときは、市の上水道緊急窓口に電話で連絡してください。'],
            ['道路の故障連絡', '舗装に大きな穴があるときは、道路管理課に場所と写真を提出します。'],
            ['配送設定・本番', 'delivery_retry_ms の値は 8400 です。保存後に配送サービスを再起動します。'],
            ['配送設定・試験', 'delivery_retry_ms の値は 4800 です。保存後に配送サービスを再起動します。'],
            ['西原駅の催し', '西原駅北口の音楽会は2027年5月12日に開催されます。'],
            ['東原駅の催し', '東原駅北口の音楽会は2027年5月21日に開催されます。'],
            ['返送の手引き', '注文品が到着時に壊れていた場合は、販売店に連絡して交換を申し込めます。'],
            ['レシピ', '焼き菓子の生地にはバターと卵黄を入れます。'],
            ['体育館', '市民体育館の利用には、受付で登録証の提示が必要です。']
        ];
        const queries = [
            ['家の水が突然止まった。どこに知らせればいい？', 0],
            ['でこぼこで危ない車道を見つけたら誰に知らせる？', 1],
            ['delivery_retry_ms 8400', 2],
            ['2027年5月21日 東原駅北口の音楽会', 5],
            ['届いた品が破損していたので、別の同じ品に替えたい', 6],
            ['月面の鉱物資源の観測方法', -1],
            ['クラゲの繁殖周期', -1]
        ];
        const entries = [];
        for (const [title, text] of fixtures) entries.push(await dbUtils.addLibraryDocument(new File([text], title + '.txt')));
        const database = await dbUtils.openDB();
        const getVectors = () => DocumentLibrary.request(database.transaction(DocumentLibrary.embeddingStore)
            .objectStore(DocumentLibrary.embeddingStore).getAll());
        const sources = new Map(entries.map(entry => [entry.id, { ...entry, documentName: entry.name }]));
        const indexes = [];
        for (const entry of entries) {
            const result = await DocumentSearch.previewDocument(entry);
            if (result.status !== 'ready') throw Error(result.message);
            indexes.push({ documentId: entry.id, chunks: result.chunks });
        }
        const rows = [];
        const rank = (items, target) => target < 0 ? items.length :
            items.findIndex(item => item.documentId === entries[target].id) + 1;
        for (const [query, target] of queries) {
            const lexical = (await DocumentSearch.searchDocuments(entries, query)).results;
            const semantic = await DocumentEmbedding.score(indexes, query, sources, new AbortController().signal);
            if (!semantic?.length) throw Error(document.querySelector('#document-embedding-status').textContent);
            const hybrid = DocumentSearch.rankHybrid(lexical, semantic, query, 6);
            rows.push({ query, target, keyword: rank(lexical, target), semantic: rank(semantic, target),
                hybrid: rank(hybrid, target), cosine: semantic[0].similarity, next: semantic[1]?.similarity });
        }
        const count = (await getVectors()).length;
        const oldEntry = entries[0];
        await dbUtils.replaceLibraryDocument(oldEntry.id, new File(['更新した原本。'], oldEntry.fileName));
        const vectors = await getVectors();
        const discarded = !vectors.some(value => value.key[0] === oldEntry.id);
        const settings = await dbUtils.getSetting('globalOtherSettings');
        const backup = await appLogic._prepareExportData({ backup: true });
        const persisted = JSON.parse(backup.metadataJson);
        await appLogic.updateGlobalOtherSetting('documentEmbeddingEnabled', false);
        const disabled = await DocumentEmbedding.score(indexes, queries[0][0], sources, new AbortController().signal);
        await appLogic.updateGlobalOtherSetting('documentEmbeddingEnabled', true);
        Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
        const fallback = await DocumentSearch.searchDocuments(entries.slice(2, 4), queries[2][0], { semantic: true });
        delete navigator.gpu;
        const NativeWorker = window.Worker;
        const toggle = document.querySelector('#document-embedding-enabled');
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        await appLogic.updateGlobalOtherSetting('documentEmbeddingEnabled', true);
        window.Worker = function(url, options) {
            if (!String(url).includes('document-embedding-worker.js')) return new NativeWorker(url, options);
            return {
                terminate() {},
                postMessage({ id, action }) {
                    queueMicrotask(() => this.onmessage({ data: { id, ...(action === 'embed' && { error: 'simulated inference failure' }) } }));
                }
            };
        };
        let failedInference;
        try { failedInference = await DocumentSearch.searchDocuments(entries.slice(2, 4), queries[2][0], { semantic: true }); }
        finally { window.Worker = NativeWorker; }
        uiUtilsV136.showCustomConfirm = async () => true;
        document.querySelector('#document-embedding-remove').click();
        return { rows, count, discarded, enabled: settings.value.documentEmbeddingEnabled, disabled,
            backup: JSON.stringify(persisted).includes('library_embedding_vectors'),
            savedPreference: JSON.stringify(persisted).includes('"documentEmbeddingEnabled":true'),
            fallback: fallback.results[0]?.documentId === entries[2].id,
            failedInferenceFallback: failedInference.results[0]?.documentId === entries[2].id };
    })()""")
    assert evaluation['count'] == 9 and evaluation['discarded'], evaluation
    assert evaluation['enabled'] and evaluation['disabled'] is None and not evaluation['backup'], evaluation
    assert evaluation['fallback'] and evaluation['failedInferenceFallback'] and evaluation['savedPreference'], evaluation
    assert all(row['hybrid'] == (1 if row['target'] >= 0 else 0) for row in evaluation['rows']), evaluation
    wait("""(async () => !(await caches.keys()).some(key => key.startsWith('chatai-embedding')) &&
        await DocumentLibrary.request(state.db.transaction(DocumentLibrary.embeddingStore)
            .objectStore(DocumentLibrary.embeddingStore).count()) === 0)()""")
    return 'ALL PASSED embedding WebGPU/IndexedDB: ' + json.dumps(evaluation, ensure_ascii=False)

async function runDocumentSearchTests({ app, db, st, test, assert, eq }) {
    const search = window.DocumentSearch;
    const file = (name, content) => new File([content], name);
    const add = (name, content) => db.addLibraryDocument(file(name, content));
    const fixture = async name => {
        const response = await fetch('./fixtures/document-analysis/' + name);
        assert(response.ok, 'Missing fixture: ' + name);
        return db.addLibraryDocument(file(name, await response.blob()));
    };
    const ready = async entry => {
        const preview = await search.previewDocument(entry);
        assert(preview.status === 'ready', entry.fileName + ': ' + preview.message);
        return preview.chunks;
    };
    const link = async (id, entries) => {
        await db.saveChat(null, { id, title: 'Fixture ' + id, messages: [], createdAt: 1, updatedAt: 1 });
        await db.setChatDocuments(id, entries.map(entry => entry.id));
    };
    const indexRecord = async (entry, kind = 'index') => DocumentLibrary.request(
        db._getStore(DocumentLibrary.indexStore).get([entry.id, kind]));
    const originalText = async entry => (await db.getLibraryOriginal(entry.id, entry.version, entry.versionId)).blob.text();

    await test('Japanese PDF text retains real page locations and image-only PDF gives an OCR reason', async () => {
        const japanese = await fixture('japanese.pdf');
        const chunks = await ready(japanese);
        eq(chunks.map(chunk => chunk.location), [{ type: 'pdf', page: 1 }, { type: 'pdf', page: 2 }]);
        assert(chunks[0].text.includes('返品の受付方法'), chunks[0].text);
        assert(chunks[1].text.normalize('NFKC').includes('購入日から30日以内'), chunks[1].text);
        await link(121, [japanese]);
        const result = await search.searchChat(121, '返金申請の期限は何日以内ですか？');
        eq(result.results[0].location.page, 2);

        const image = await fixture('image-only.pdf');
        const failed = await search.previewDocument(image);
        eq(failed.code, 'no-pdf-text');
        assert(failed.message.includes('OCR') && (await db.getLibraryOriginal(image.id)).blob.size === image.size);
        eq(await indexRecord(image), undefined);
    });

    await test('Japanese DOCX extracts custom headings, ordered paragraphs and table cells', async () => {
        const entry = await fixture('japanese.docx');
        const chunks = await ready(entry);
        assert(chunks[0].text.includes('返品申請には領収書が必要'));
        eq(chunks[0].location.heading, '返品と返金');
        eq(chunks[0].location.paragraphStart, 1);
        eq(chunks[0].location.paragraphEnd, 2);
        eq(chunks[1].text, '申請方法 | オンライン窓口');
        eq(chunks[1].location, { type: 'docx', heading: '返品と返金', table: 1, row: 1 });
        assert(chunks[2].text.includes('窓口の営業時間'));
        assert(!chunks.some(chunk => chunk.text.includes('対象外ヘッダー')));
    });

    await test('TXT and Markdown preserve Japanese encodings, heading and fenced code locations', async () => {
        const shift = await ready(await fixture('shift-jis.txt'));
        assert(shift[0].text.includes('領収書をご用意'));
        eq(shift[0].location.lineEnd, 2);
        const wide = new Uint16Array([0xfeff, ...Array.from('日本語 UTF16', char => char.charCodeAt(0))]);
        eq((await ready(await add('utf16.txt', wide)))[0].text, '日本語 UTF16');
        const markdown = '# 窓口案内\n手続きです。\n\n' + '\x60\x60\x60html\n<div>サンプル</div>\n# コード内\n\x60\x60\x60\n\n別の章\n---\n連絡方法。';
        const sections = await ready(await add('guide.md', markdown));
        eq(sections[0].location.heading, '窓口案内');
        assert(sections[0].text.includes('<div>サンプル</div>') && sections[0].text.includes('# コード内'));
        eq(sections.at(-1).location.heading, '別の章');
    });

    await test('CSV and TSV preserve quoted cells, escapes, headers and physical lines', async () => {
        const csv = await ready(await add('inventory.csv', '商品,手続き\r\n"書籍,限定","担当者は""受付""\r\nオンラインで申請"\r\n'));
        eq(csv[0].text, '商品 = 書籍,限定\n手続き = 担当者は"受付"\nオンラインで申請');
        eq(csv[0].location, { type: 'table', row: 2, lineStart: 2, lineEnd: 3 });
        const tsv = await ready(await add('inventory.tsv', '商品\t規則\n書籍\t"返品\t無料\n翌日まで"\n'));
        assert(tsv[0].text.includes('規則 = 返品\t無料\n翌日まで'));
        eq(tsv[0].location.lineEnd, 3);
        const broken = await search.previewDocument(await add('broken.csv', '商品,手続き\n"閉じていない'));
        eq(broken.code, 'invalid-document');
        assert(broken.message.includes('引用符'));
    });

    await test('JSON, multi-document YAML and XML keep hierarchy while blocking expansion', async () => {
        const json = await ready(await add('products.json', '{"商品":[{"手続き/窓口":"日本語受付"}],"有効":true}'));
        eq(json[0].location.path, '/商品/0/手続き~1窓口');
        assert(json[0].text.includes('日本語受付'));
        const yaml = await ready(await add('products.yaml', '商品:\n  - 手続き: オンライン受付\n---\n日付: 2025-12-31\n'));
        eq(yaml[0].location, { type: 'path', path: '/商品/0/手続き', document: 1 });
        eq(yaml[1].location.document, 2);
        assert(yaml[0].text.includes('オンライン受付'));
        const alias = await search.previewDocument(await add('recursive.yaml', 'root: &root [*root]'));
        eq(alias.code, 'yaml-alias');
        const xml = await ready(await add('products.xml', '<商品><窓口 番号="42">日本語受付</窓口><窓口>オンライン</窓口></商品>'));
        eq(xml.map(chunk => chunk.location.path), ['/商品[1]/窓口[1]/@番号', '/商品[1]/窓口[1]', '/商品[1]/窓口[2]']);
        assert(xml[1].text.includes('日本語受付'));
        const doctype = await search.previewDocument(await add('external.xml',
            '<!DOCTYPE root SYSTEM "https://example.invalid/fixture"><root>本文</root>'));
        eq(doctype.code, 'unsafe-xml');
    });

    await test('HTML parses headings and visible text without rendering or reading external resources', async () => {
        const html = await add('notice.html', '<html><head><title>対象外タイトル</title></head><body>' +
            '<h1>申請窓口</h1>\n<p>日本語の受付は<strong>午前９時</strong>です &amp; 詳細。</p>' +
            '<img src="https://example.invalid/fixture" onerror="window.documentFixtureExecuted = true">' +
            '<script>window.documentFixtureExecuted = true; SCRIPT_MARKER</script>' +
            '<style>STYLE_MARKER</style><div hidden>HIDDEN_MARKER</div><template>TEMPLATE_MARKER</template></body></html>');
        const chunks = await ready(html);
        const text = chunks.map(chunk => chunk.text).join('\n');
        assert(text.includes('日本語の受付は午前９時') && text.includes('& 詳細'));
        assert(!/MARKER|example\.invalid|対象外タイトル/.test(text), text);
        eq(chunks[0].location.heading, '申請窓口');
        eq(window.documentFixtureExecuted, undefined);
    });

    await test('Japanese ranking promotes precise passages over repeated distractors and keeps chat scope', async () => {
        const doc = await add('返品規約.md', '# 返品と返金\n購入後の返品に伴う返金申請の期限は購入日から30日以内です。領収書が必要です。\n\n' +
            '# 海外注文\n海外注文の返金申請は商品到着から14日以内です。\n\n' +
            '# 会員登録\n会員申請、申請フォーム、申請番号、申請手順、申請の進捗を確認できます。\n\n' +
            '# SKU-42 の特別手続き\nＳＫＵ－４２ / ABC-9 は返品センターで受付します。');
        const noise = await add('配送案内.md', '# 配送日数\n購入日から配送までの期限は２日です。申請の案内です。');
        const other = await add('別チャット.md', '# 返品と返金\n返金申請は購入日から99日以内です。SKU-42 / ABC-9。');
        await link(131, [doc, noise]);
        await link(132, [other]);
        const answer = await search.searchChat(131, '返品した商品の返金申請は購入日から何日以内ですか？');
        eq(answer.chatId, 131);
        eq(answer.results[0].documentId, doc.id);
        eq(answer.results[0].versionId, doc.versionId);
        assert(answer.results[0].text.includes('30日以内'), JSON.stringify(answer.results.map(result => [result.score, result.text])));
        eq(answer.results[0].location.heading, '返品と返金');
        assert(answer.results.some(result => result.documentId === doc.id && result.text.includes('14日以内')));
        assert(answer.results.every(result => result.documentId !== other.id && result.contentTrust === 'untrusted-document'));
        const sku = await search.searchChat(131, 'sku-４２ ABC-９');
        eq(sku.results[0].location.heading, 'SKU-42 の特別手続き');
        assert(sku.results[0].excerpt.includes('返品センター'));
        eq((await search.searchChat(132, '返金申請')).results[0].documentId, other.id);
        eq((await search.searchChat(131, '天体観測望遠鏡')).results, []);
        eq((await search.searchChat(null, '返金申請')).results, []);
    });

    await test('Index is reused, rebuilt when corrupt, invalidated on replacement and rebuilt after restore', async () => {
        const original = await add('versioned.txt', '原本第一版。受付時間は午前十時です。');
        await link(141, [original]);
        const get = db.getLibraryOriginal;
        let reads = 0;
        db.getLibraryOriginal = async (...args) => { reads++; return get.apply(db, args); };
        try {
            await Promise.all([ready(original), ready(original)]);
            eq(reads, 1);
            await search.searchChat(141, '受付時間');
            eq(reads, 1);
            const stored = await indexRecord(original);
            stored.chunks[0].id = 'corrupt';
            await DocumentLibrary.transaction(st.db, [DocumentLibrary.indexStore], 'readwrite',
                tx => { tx.objectStore(DocumentLibrary.indexStore).put(stored); });
            await ready(original);
            eq(reads, 2);

            const next = await db.replaceLibraryDocument(original.id, file('versioned.txt', '原本第二版。受付時間は午後二時です。'),
                { expectedVersionId: original.versionId });
            eq(await indexRecord(next), undefined);
            eq((await search.getStatus(next)).status, 'pending');
            const latest = await search.searchChat(141, '受付時間');
            eq(latest.results[0].versionId, next.versionId);
            assert(latest.results[0].text.includes('午後二時'));
            eq(reads, 3);
            assert((await originalText(original)).includes('午前十時'));

            const backup = await (await app.createFullBackup()).text();
            assert(!backup.includes(DocumentLibrary.indexStore) && !backup.includes('"postings"'));
            const previousReads = reads;
            await app.importDataFromString(backup, { source: 'file' });
            eq((await search.searchChat(141, '受付時間')).results[0].versionId, next.versionId);
            eq(reads, previousReads);
            const another = await db.replaceLibraryDocument(original.id, file('versioned.txt', '臨時の第三版です。'));
            await ready(another);
            await app.importDataFromString(backup, { source: 'file' });
            eq(await indexRecord(next), undefined);
            eq((await search.searchChat(141, '受付時間')).results[0].versionId, next.versionId);
            eq((await indexRecord(next)).versionId, next.versionId);
        } finally { db.getLibraryOriginal = get; }
    });

    await test('Updating or removing a document during analysis cannot publish a stale index', async () => {
        for (const action of ['replace', 'delete', 'cancel']) {
            const entry = await add(action + '.txt', '変更前の受付方法です。');
            await link(150, [entry]);
            let entered, release;
            const started = new Promise(resolve => { entered = resolve; });
            const paused = new Promise(resolve => { release = resolve; });
            const get = db.getLibraryOriginal;
            db.getLibraryOriginal = async (...args) => {
                const original = await get.apply(db, args);
                entered();
                await paused;
                return original;
            };
            const pending = search.searchChat(150, '受付方法');
            try {
                await started;
                if (action === 'replace') {
                    await db.replaceLibraryDocument(entry.id, file('replace.txt', '新しい受付方法です。'));
                } else if (action === 'delete') {
                    await db.deleteLibraryDocument(entry.id);
                } else {
                    await search.cancelAnalysis(entry);
                }
                release();
                const result = await pending;
                eq(result.results, []);
                eq(result.unavailable[0].code, action === 'cancel' ? 'cancelled' : 'version-changed');
                eq(await indexRecord(entry), undefined);
                if (action !== 'delete') assert((await originalText(entry)).includes('変更前'));
                if (action === 'cancel') eq((await search.getStatus(entry)).status, 'pending');
            } finally {
                release();
                db.getLibraryOriginal = get;
            }
            await db.deleteChat(150);
        }
    });

    await test('Oversized or invalid originals remain stored while search reports unavailable sources', async () => {
        const large = await add('large.txt', new Uint8Array(8 * 1024 * 1024 + 1));
        const valid = await add('small.txt', '手続きは窓口で受付します。');
        await link(170, [large, valid]);
        const result = await search.searchChat(170, '受付手続き');
        eq(result.results[0].documentId, valid.id);
        eq(result.unavailable[0].documentId, large.id);
        eq(result.unavailable[0].code, 'size-limit');
        eq((await db.getLibraryOriginal(large.id)).blob.size, large.size);
        eq(await indexRecord(large), undefined);
        const controller = new AbortController();
        controller.abort();
        let cancelled = false;
        try { await search.searchChat(170, '受付手続き', { signal: controller.signal }); }
        catch (error) { cancelled = error.name === 'AbortError'; }
        assert(cancelled);
    });
}

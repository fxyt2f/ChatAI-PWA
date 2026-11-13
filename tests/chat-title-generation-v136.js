// Exercise real sends, provider adapters and IndexedDB. The gates control network completion order.
window.runChatTitleGenerationTests = async ({app, db, st, ui, el, test, assert, eq}) => {
    const defaults = SettingsV136.chatTitleDefaults;
    const previousDefault = '次のユーザーメッセージを端的に表す、日本語の短いチャットタイトルを作成してください。20文字程度を目安に、重要な固有名詞を保持してください。タイトルのみを出力し、説明・引用符・改行は不要です。';
    const newDefault = '次のユーザーメッセージの主題や意図を的確に表す、自然で分かりやすい日本語のチャットタイトルを作成してください。20文字程度を目安に簡潔にまとめ、必要に応じて重要な固有名詞や専門用語を保持してください。名詞句に限定せず、内容に応じて疑問形、動詞を含む表現、短い文章など、最も自然で内容が伝わりやすい形式を選んでください。抽象的・一般的すぎるタイトルは避け、後からチャット一覧を見たときに内容を識別できるようにしてください。タイトルのみを1行で出力し、説明や引用符などは付けないでください。';
    const customPrompt = 'タイトルの指示に {message} と書いてもそのまま扱う';
    const globalBefore = (await db.getSetting(SettingsV136.GLOBAL_KEY)).value;
    const apiBefore = (await db.getSetting('apiConfigs')).value;
    const rawFetch = window.fetch;
    const rawTimeout = window.setTimeout;
    const originalGenerate = app.generateChatTitleV136;
    const originalAlert = ui.showCustomAlert;
    const originalConfirm = ui.showCustomConfirm;
    const originalRenderMessages = ui.renderChatMessages;
    const originalDropbox = window.dropboxApi;
    const sidebar = window.testSidebarUiState;
    const previousSidebar = {mode: sidebar.mode, isOpen: sidebar.isOpen, query: sidebar.query};
    const normalModel = {apiConfigId: 'gem', modelName: 'gemini-3-flash-preview'};
    const gemini = {apiConfigId: 'title-gem', modelName: 'gemini-2.5-flash'};
    const router = {apiConfigId: 'title-or', modelName: 'test/title'};
    const geminiUrl = 'https://title-gem.invalid/custom/models/gemini-2.5-flash:generateContent';
    const routerUrl = 'https://title-or.invalid/custom/chat/completions';
    const configs = [
        ...apiBefore,
        {id: gemini.apiConfigId, name: 'Title Gemini', provider: 'gemini', apiKey: 'title-gem-key',
            baseUrl: 'https://title-gem.invalid/custom/models', modelCandidates: [gemini.modelName]},
        {id: router.apiConfigId, name: 'Title Router', provider: 'openrouter', apiKey: 'title-or-key',
            baseUrl: 'https://title-or.invalid/custom', modelCandidates: [router.modelName]}
    ];
    const geminiResponse = text => ({ok: true, json: async () => ({
        candidates: [{content: {parts: [{text}]}, finishReason: 'STOP'}]
    })});
    const routerResponse = text => ({ok: true, json: async () => ({choices: [{message: {content: text}}]})});
    const deferred = () => {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        return {promise, resolve};
    };
    const waitFor = async (condition, description) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const value = await condition();
            if (value) return value;
            await new Promise(resolve => rawTimeout(resolve, 10));
        }
        throw new Error('Timed out waiting for ' + description);
    };
    const titles = [];
    const answers = [];
    const jobs = new Map();
    let titleReply, answerReply;
    const resetReplies = () => {
        titleReply = request => request.url === routerUrl ? routerResponse('自動タイトル') : geminiResponse('自動タイトル');
        answerReply = () => geminiResponse('通常の回答');
    };
    resetReplies();
    const send = (text, logic = app, input = el.userInput) => {
        input.value = text;
        return logic.handleSend();
    };
    const start = async () => {
        app.startNewChat();
        await st.executionSettingsReady;
        await app.setCurrentChatModelRef(normalModel);
        st.settings.enableAutoRetry = false;
        st.settings.enableProofreading = false;
    };
    const completeTitle = id => {
        assert(jobs.has(id), 'no generation job for chat ' + id);
        return jobs.get(id);
    };
    const assertTitle = async (id, title, source) => {
        const stored = await db.getChat(id);
        eq(stored.title, title);
        eq(stored.titleSource, source);
        return stored;
    };
    const sidebarRow = id => el.chatSidebarList.querySelector(`.chat-sidebar-item[data-chat-id="${id}"]`);
    const isDotVisible = row => Boolean(row?.querySelector('.chat-sidebar-title-dot:not([hidden])'));
    const renderSidebar = async () => {
        Object.assign(sidebar, {mode: 'overlay', isOpen: true, query: ''});
        await ui.renderChatSidebar({refreshRecent: true});
    };
    const mockFetch = async (url, options) => {
        const request = {url: String(url), ...options, body: JSON.parse(options.body)};
        if (request.url === geminiUrl || request.url === routerUrl) {
            titles.push(request);
            return titleReply(request);
        }
        assert(request.url.includes(normalModel.modelName + ':generateContent'), 'unexpected API request ' + request.url);
        answers.push(request);
        return answerReply(request);
    };
    let autoId;
    try {
        await db.saveSetting('apiConfigs', configs);
        await app.refreshExecutionApiConfigsV136();
        await test('chat title defaults, global controls and API reference audit', async () => {
            eq(st.settings.enableChatTitleGeneration, false);
            eq(st.settings.chatTitleModelRef, null);
            eq(defaults.chatTitleSystemPrompt, newDefault);
            eq(st.settings.chatTitleSystemPrompt, newDefault);
            const section = document.getElementById('chat-title-settings');
            const heading = section.querySelector('h2');
            const description = section.querySelector('p');
            eq(heading.textContent, 'タイトル自動生成機能');
            eq(description.textContent, '新規チャットの最初のメッセージを送信し、チャットのタイトルを生成します。');
            assert(!section.textContent.includes('{message}'));
            ui.updateUserModelOptions();
            const model = document.getElementById('chat-title-model');
            const prompt = document.getElementById('chat-title-system-prompt');
            const enabled = document.getElementById('enable-chat-title-generation');
            if (window.settingsUiV136) eq(prompt.value, newDefault);
            [heading, description, enabled, model, prompt].reduce((previous, next) => {
                assert(previous.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
                return next;
            });
            model.value = app.encodeModelRefValue(gemini);
            model.dispatchEvent(new Event('change', {bubbles: true}));
            prompt.value = '題名にする';
            prompt.dispatchEvent(new Event('input', {bubbles: true}));
            enabled.checked = true;
            enabled.dispatchEvent(new Event('change', {bubbles: true}));
            const saved = await waitFor(async () => {
                const value = (await db.getSetting(SettingsV136.GLOBAL_KEY)).value;
                return value.enableChatTitleGeneration && value.chatTitleModelRef?.apiConfigId === gemini.apiConfigId
                    && value.chatTitleSystemPrompt === '題名にする' && value;
            }, 'global form saves');
            eq(saved.chatTitleModelRef, gemini);
            eq(saved.chatTitleSystemPrompt, prompt.value);
            assert((await app.inspectApiConfigReferences(gemini.apiConfigId)).isInUse);
            const profile = await db.getProfile(st.activeProfileId);
            assert(Object.keys(defaults).every(key => !Object.hasOwn(profile.settings, key)));
        });
        await test('old title prompt migrates once and custom settings survive', async () => {
            const savedGlobal = async () => (await db.getSetting(SettingsV136.GLOBAL_KEY)).value;
            const historyBefore = await db.getChat(100);
            for (const prompt of [previousDefault, previousDefault + '\n\n{message}']) {
                const old = {...await savedGlobal(), chatTitleSystemPrompt: prompt};
                await db.saveSetting(SettingsV136.GLOBAL_KEY, old);
                await app.reloadGlobalSettingsV136();
                eq(st.settings.chatTitleSystemPrompt, newDefault);
                const expected = {...old, chatTitleSystemPrompt: newDefault, revision: old.revision + 1};
                await app.ensureSettingsMigrationV136();
                eq(await savedGlobal(), expected);
                await app.ensureSettingsMigrationV136();
                eq(await savedGlobal(), expected);
            }
            for (const prompt of [customPrompt, previousDefault + '\n専門用語は原文で保持する。']) {
                await app.saveGlobalSettingsV136({chatTitleSystemPrompt: prompt});
                const saved = await savedGlobal();
                await app.ensureSettingsMigrationV136();
                await app.reloadGlobalSettingsV136();
                eq(await savedGlobal(), saved);
                eq(st.settings.chatTitleSystemPrompt, prompt);
            }
            eq(await db.getChat(100), historyBefore);
            await app.saveGlobalSettingsV136({chatTitleSystemPrompt: newDefault});
        });
        app.generateChatTitleV136 = function (id, generation) {
            const job = originalGenerate.call(this, id, generation);
            jobs.set(id, job);
            return job;
        };
        window.fetch = mockFetch;
        ui.showCustomConfirm = async () => true;
        // The base harness stubs message rendering. Clear its temporary generation nodes on render.
        ui.renderChatMessages = () => el.messageContainer.replaceChildren();

        await test('chat title can finish first, uses Gemini route and survives response saves', async () => {
            const normalGate = deferred();
            const titleGate = deferred();
            answerReply = () => normalGate.promise;
            titleReply = () => titleGate.promise;
            await start();
            await app.setCurrentChatThinkingEffort('medium');
            st.currentSystemPrompt = '会話専用システムプロンプト';
            st.settings.dummyUser = '通常会話のダミーユーザー';
            st.settings.dummyModel = '通常会話のダミー回答';
            const first = '最初の質問 $& {message} ' + 'あ'.repeat(50);
            const sending = send(first);
            try {
                await waitFor(() => titles.length === 1 && answers.length === 1, 'both requests in flight');
                autoId = st.currentChatId;
                assert((await assertTitle(autoId, first.slice(0, 50), 'fallback')).titleGenerationId);
                const request = titles[0];
                eq(request.url, geminiUrl);
                eq(request.headers['x-goog-api-key'], 'title-gem-key');
                eq(request.body, {
                    systemInstruction: {parts: [{text: newDefault}]},
                    contents: [{role: 'user', parts: [{text: first}]}]
                });
                const normalController = st.abortController;
                assert(normalController && answers[0].signal && request.signal !== answers[0].signal);
                titleGate.resolve(geminiResponse('```text\n## タイトル： 「Geminiの**題名**」\n補足説明\n```'));
                await completeTitle(autoId);
                assert(st.isSending);
                assert(st.abortController === normalController);
                assert(!answers[0].signal.aborted);
                eq(app.getCurrentChatModelRef(), normalModel);
                eq(app.getCurrentChatThinkingEffort(), 'medium');
                eq(el.chatTitle.textContent, 'Geminiの題名');
            } finally {
                titleGate.resolve(geminiResponse('予備タイトル'));
                normalGate.resolve(geminiResponse('通常の回答'));
                await sending;
                resetReplies();
            }
            const saved = await assertTitle(autoId, 'Geminiの題名', 'auto');
            eq(saved.messages.at(-1).content, '通常の回答');
            assert(!saved.titleGenerationId);
            await Promise.all([db.saveChat('古い暫定タイトル'), db.saveChat()]);
            await send('二つ目の質問');
            await assertTitle(autoId, 'Geminiの題名', 'auto');
            eq(el.chatTitle.textContent, 'Geminiの題名');
            eq(titles.length, 1);
        });

        await test('chat title can finish last, uses OpenRouter settings and stays on the original chat', async () => {
            const titleGate = deferred();
            const previousScreen = st.currentScreen;
            const previousHistoryQuery = el.chatSidebarSearchInput.value;
            titleReply = () => titleGate.promise;
            await app.saveGlobalSettingsV136({chatTitleModelRef: router, chatTitleSystemPrompt: customPrompt});
            await start();
            // Saving a new chat's system prompt can allocate its ID before the first message.
            st.currentSystemPrompt = '先に保存した会話用の指示';
            const id = await db.saveChat();
            assert((await db.getChat(id)).titleGenerationEligible);
            try {
                await send('後からタイトルが届く');
                eq(st.currentChatId, id);
                await assertTitle(id, '後からタイトルが届く', 'fallback');
                assert(!st.isSending);
                eq(titles.length, 2);
                const request = titles.at(-1);
                eq(request.url, routerUrl);
                eq(request.headers.Authorization, 'Bearer title-or-key');
                eq(request.body, {model: router.modelName, messages: [
                    {role: 'system', content: customPrompt},
                    {role: 'user', content: [{type: 'text', text: '後からタイトルが届く'}]}
                ]});
                await renderSidebar();
                assert(isDotVisible(sidebarRow(id)) && !isDotVisible(sidebarRow(autoId)));
                assert((await app.loadChat(autoId)).ok);
                await ui.showScreen('chat', true);
                const sidebarTitle = () => el.chatSidebarList.querySelector(`[data-chat-id="${id}"] .chat-sidebar-item-title`)?.textContent;
                await renderSidebar();
                eq(sidebarTitle(), '後からタイトルが届く');
                assert(isDotVisible(sidebarRow(id)) && !isDotVisible(sidebarRow(autoId)));
                assert(sidebarRow(id).querySelector('.chat-sidebar-item-open').ariaLabel.includes('タイトル生成中'));
                await app.saveGlobalSettingsV136({chatTitleModelRef: gemini, chatTitleSystemPrompt: defaults.chatTitleSystemPrompt});
                titleGate.resolve(routerResponse('「' + '😀'.repeat(55) + '」'));
                await completeTitle(id);
                await assertTitle(id, '😀'.repeat(50), 'auto');
                await waitFor(() => sidebarTitle() === '😀'.repeat(50), 'updated sidebar title');
                assert(!isDotVisible(sidebarRow(id)));
                eq(st.currentChatId, autoId);
                eq(el.chatTitle.textContent, 'Geminiの題名');
            } finally {
                titleGate.resolve(routerResponse('予備タイトル'));
                Object.assign(sidebar, previousSidebar);
                el.chatSidebarSearchInput.value = previousHistoryQuery;
                el.chatSidebarSearchInput.dispatchEvent(new Event('input'));
                await ui.showScreen(previousScreen, true);
                resetReplies();
            }
        });

        if (window.settingsUiV136) await test('sidebar title, dot, pin and menu stay centered at narrow and wide row widths', async () => {
            const id = 'title-layout-fixture';
            const fixture = document.createElement('div');
            const row = ui.createChatSidebarItem({id, title: '長いタイトル'.repeat(14), isPinned: true});
            const button = row.querySelector('.chat-sidebar-item-open');
            const title = row.querySelector('.chat-sidebar-item-title');
            const dot = row.querySelector('.chat-sidebar-title-dot');
            const pin = row.querySelector('.chat-pin-icon');
            const menu = row.querySelector('.chat-sidebar-item-menu');
            fixture.append(row);
            document.body.append(fixture);
            const centerY = node => {
                const rect = node.getBoundingClientRect();
                return rect.y + rect.height / 2;
            };
            try {
                for (const width of [180, 280]) {
                    fixture.style.width = width + 'px';
                    st.chatTitleGenerations.delete(id);
                    ui.syncChatSidebarTitleGeneration(id, button);
                    const rowHeight = row.getBoundingClientRect().height;
                    const buttonHeight = button.getBoundingClientRect().height;
                    const titleX = title.getBoundingClientRect().x;
                    eq(dot.getBoundingClientRect().width, 0);
                    st.chatTitleGenerations.set(id, new AbortController());
                    ui.syncChatSidebarTitleGeneration(id, button);
                    eq(row.getBoundingClientRect().height, rowHeight);
                    eq(button.getBoundingClientRect().height, buttonHeight);
                    eq(title.getBoundingClientRect().x, titleX);
                    eq(getComputedStyle(title).textOverflow, 'ellipsis');
                    assert(title.scrollWidth > title.clientWidth);
                    eq(getComputedStyle(dot).animationName,
                        matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'generationStatusPulse');
                    assert(dot.getBoundingClientRect().left >= title.getBoundingClientRect().right);
                    for (const node of [title, pin, dot, menu]) assert(Math.abs(centerY(node) - centerY(row)) < 1);
                }
            } finally {
                st.chatTitleGenerations.delete(id);
                fixture.remove();
            }
        });

        await test('chat title OFF and an attachment-only first send make no title request', async () => {
            const count = titles.length;
            await app.saveGlobalSettingsV136({enableChatTitleGeneration: false});
            await start();
            await send('無効時の質問');
            const disabledId = st.currentChatId;
            await assertTitle(disabledId, '無効時の質問', 'fallback');
            await app.saveGlobalSettingsV136({enableChatTitleGeneration: true});
            await send('有効化した後の質問');
            await start();
            st.pendingAttachments = [{name: 'first.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='}];
            await send('');
            await assertTitle(st.currentChatId, '', 'fallback');
            await send('添付の後の質問');
            eq(titles.length, count);
        });

        await test('chat title HTTP error, invalid responses and timeout preserve fallback and normal answer', async () => {
            const failures = [
                () => ({ok: false, status: 429}),
                () => ({ok: true, json: async () => { throw new SyntaxError('bad JSON'); }}),
                () => geminiResponse('**「」**\nタイトル：'),
                ({signal}) => new Promise((resolve, reject) => {
                    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
                })
            ];
            for (const [index, response] of failures.entries()) {
                await start();
                const before = titles.length;
                const gate = deferred();
                titleReply = request => gate.promise.then(() => response(request));
                let expireTitleRequest;
                if (index === failures.length - 1) {
                    window.setTimeout = (fn, ms, ...args) => {
                        if (ms !== 15000) return rawTimeout(fn, ms, ...args);
                        expireTitleRequest = fn;
                        return 0;
                    };
                }
                await send('暫定タイトル ' + index);
                await renderSidebar();
                const row = sidebarRow(st.currentChatId);
                assert(isDotVisible(row));
                gate.resolve();
                if (expireTitleRequest) {
                    await Promise.resolve();
                    expireTitleRequest();
                }
                await completeTitle(st.currentChatId);
                assert(!isDotVisible(sidebarRow(st.currentChatId)));
                eq(titles.length, before + 1);
                const chat = await assertTitle(st.currentChatId, '暫定タイトル ' + index, 'fallback');
                eq(chat.messages.at(-1).content, '通常の回答');
                assert(!chat.titleGenerationId);
                eq(titles.at(-1).signal.aborted, index === failures.length - 1);
                assert(!answers.at(-1).signal.aborted);
            }
            window.setTimeout = rawTimeout;
            resetReplies();
        });

        await test('chat title manual rename and deletion beat delayed results', async () => {
            for (const action of ['rename', 'delete']) {
                const gate = deferred();
                titleReply = () => gate.promise;
                await start();
                await send('競合する質問');
                const id = st.currentChatId;
                assert((await db.getChat(id)).titleGenerationId);
                await renderSidebar();
                const row = sidebarRow(id);
                assert(isDotVisible(row));
                const manualTitle = '手'.repeat(100);
                if (action === 'rename') {
                    await window.chatHistoryActions.rename(id, manualTitle + '超過');
                    await db.saveChat('保存前に作った暫定タイトル');
                } else {
                    assert((await window.chatHistoryActions.delete(id)).ok);
                }
                assert(titles.at(-1).signal.aborted);
                assert(!isDotVisible(sidebarRow(id)));
                gate.resolve(geminiResponse('遅れて届いた題名'));
                await completeTitle(id);
                if (action === 'rename') {
                    await assertTitle(id, manualTitle, 'manual');
                    eq(el.chatTitle.textContent, manualTitle);
                } else assert(!await db.getChat(id));
            }
            resetReplies();
        });

        await test('chat title is not started on reopen in a fresh page, retry, duplicate or text import', async () => {
            const count = titles.length;
            const gate = deferred();
            titleReply = () => gate.promise;
            await start();
            await send('別ページでも一度だけ');
            const id = st.currentChatId;
            const iframe = document.createElement('iframe');
            iframe.hidden = true;
            const loaded = new Promise(resolve => { iframe.onload = resolve; });
            iframe.src = './integration-i-peer-v136.html';
            document.body.append(iframe);
            let peer;
            try {
                await loaded;
                peer = await iframe.contentWindow.openFullIntegrationPeerV136(st.db.name);
                iframe.contentWindow.fetch = mockFetch;
                iframe.contentWindow.peerUi.setSendingState = value => { peer.state.isSending = value; };
                await peer.app.loadGlobalSettings();
                eq(peer.state.settings.chatTitleSystemPrompt, newDefault);
                assert((await peer.app.loadChat(id)).ok);
                await send('再読み込み後の送信', peer.app, iframe.contentDocument.getElementById('user-input'));
                eq(titles.length, count + 1);
            } finally {
                peer?.close();
                iframe.remove();
                gate.resolve(geminiResponse('別ページの題名'));
                await completeTitle(id);
                resetReplies();
            }
            assert((await app.loadChat(id)).ok);
            const answersBeforeRetry = answers.length;
            await app.retryFromMessage(0);
            eq(answers.length, answersBeforeRetry + 1);
            ui.showCustomAlert = async message => assert(message.includes('複製しました'));
            const duplicate = await window.chatHistoryActions.duplicate(id);
            assert(duplicate.ok);
            assert((await app.loadChat(duplicate.chatId)).ok);
            await send('複製後の質問');
            const imported = deferred();
            ui.showCustomAlert = async message => imported.resolve(message);
            await app.handleHistoryImport(new File(['<|#|user|#|>旧メッセージ<|#|/user|#|>'], 'title-fixture.txt', {type: 'text/plain'}));
            assert((await imported.promise).includes('インポートしました'));
            ui.showCustomAlert = originalAlert;
            const importedChat = (await db.getAllChats()).find(chat => chat.title.includes('title-fixture'));
            assert((await app.loadChat(importedChat.id)).ok);
            await app.setCurrentChatModelRef(normalModel);
            await send('インポート後の質問');
            await assertTitle(importedChat.id, importedChat.title, undefined);
            assert((await app.loadChat(100)).ok);
            await app.setCurrentChatModelRef(normalModel);
            await send('既存履歴への質問');
            await assertTitle(100, 'legacy', undefined);
            eq(titles.length, count + 1);
        });

        await test('Dropbox format restores title settings and invalidates pending title operations on replacement', async () => {
            const gate = deferred();
            titleReply = () => gate.promise;
            await app.saveGlobalSettingsV136({chatTitleSystemPrompt: customPrompt});
            await start();
            await send('同期で置き換わる質問');
            const id = st.currentChatId;
            const pending = await db.getChat(id);
            await db.saveSetting('activeProfileId', st.activeProfileId);
            const exported = await app._prepareExportData();
            const payload = JSON.parse(exported.metadataJson);
            const global = payload.data.settings.find(setting => setting.key === SettingsV136.GLOBAL_KEY);
            const replacement = payload.data.chats.find(chat => chat.id === id);
            assert(!replacement.titleGenerationId);
            replacement.titleGenerationId = pending.titleGenerationId;
            replacement.title = '同期元のタイトル';
            const savedGlobals = structuredClone(global.value);
            window.dropboxApi = {downloadAsset: async assetId => exported.localAssets.get(assetId)?.blob};
            const showProgress = ui.showProgressDialog;
            const hideProgress = ui.hideProgressDialog;
            ui.showProgressDialog = ui.hideProgressDialog = () => {};
            try {
                await app.importDataFromString(JSON.stringify(payload));
                eq(st.globalSettingsV136.chatTitleModelRef, gemini);
                eq(st.globalSettingsV136.chatTitleSystemPrompt, savedGlobals.chatTitleSystemPrompt);
                eq(st.globalSettingsV136.enableChatTitleGeneration, true);
                assert(titles.at(-1).signal.aborted);
                await assertTitle(autoId, 'Geminiの題名', 'auto');
                gate.resolve(geminiResponse('古い生成結果'));
                await completeTitle(id);
                assert(!(await assertTitle(id, '同期元のタイトル', 'fallback')).titleGenerationId);

                for (const key of Object.keys(defaults)) delete global.value[key];
                await app.importDataFromString(JSON.stringify(payload));
                eq(SettingsV136.pick(st.settings, Object.keys(defaults)), defaults);
            } finally {
                ui.showProgressDialog = showProgress;
                ui.hideProgressDialog = hideProgress;
                gate.resolve(geminiResponse('予備タイトル'));
                resetReplies();
            }
        });
    } finally {
        window.fetch = rawFetch;
        window.setTimeout = rawTimeout;
        window.dropboxApi = originalDropbox;
        app.generateChatTitleV136 = originalGenerate;
        ui.showCustomAlert = originalAlert;
        ui.showCustomConfirm = originalConfirm;
        ui.renderChatMessages = originalRenderMessages;
        Object.assign(sidebar, previousSidebar);
        await db.saveSetting('apiConfigs', apiBefore);
        await app.saveGlobalSettingsV136({...defaults, ...globalBefore});
        await app.refreshExecutionApiConfigsV136();
    }
};

window.runStreamingBrowserTestsV136 = async ({app, db, st, ui, el, test, assert, eq}) => {
    const rawFetch = window.fetch;
    const rawTimeout = window.setTimeout;
    const globalBefore = (await db.getSetting(SettingsV136.GLOBAL_KEY)).value;
    const originalConfigs = (await db.getSetting('apiConfigs')).value;
    const originalTools = window.functionCallingTools;
    const originalDeclarations = window.functionDeclarations;
    const originalUi = {...ui};
    const gemini = {apiConfigId: 'gem', modelName: 'gemini-3-flash-preview'};
    const router = {apiConfigId: 'stream-or', modelName: 'google/gemini-3-flash-preview'};
    const deepseek = {...router, modelName: 'deepseek/deepseek-r1'};
    const routerMetadata = [router, deepseek].map(ref => ({
        id: ref.modelName, reasoning: {supported_efforts: ['low', 'high'], default_effort: 'high'}
    }));
    const routerBase = 'https://stream-router.invalid/v1';
    const geminiImage = {...gemini, modelName: 'gemini-2.5-flash-image-preview'};
    const encoder = new TextEncoder();
    const calls = [];
    const events = [];
    let reply;
    const geminiResult = (parts, finishReason) => ({
        candidates: [{index: 0, content: {role: 'model', parts}, ...(finishReason && {finishReason})}]
    });
    const routerResult = (delta, finish_reason = null) => ({choices: [{index: 0, delta, finish_reason}]});
    const json = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
    const tick = () => new Promise(resolve => rawTimeout(resolve, 10));
    const waitFor = async (fn, label) => {
        const limit = Date.now() + 5000;
        while (Date.now() < limit) {
            const result = await fn();
            if (result) return result;
            await tick();
        }
        throw new Error('Timed out: ' + label);
    };
    const sse = () => {
        let writer, closed = false, canceled = false;
        const body = new ReadableStream({
            start(controller) { writer = controller; },
            cancel() { canceled = true; closed = true; }
        });
        const write = text => {
            if (closed) return;
            const bytes = encoder.encode(text);
            for (let index = 0; index < bytes.length; index += 13) writer.enqueue(bytes.slice(index, index + 13));
        };
        const stream = {
            body,
            response: new Response(body, {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}}),
            frame: value => write('data: ' + JSON.stringify(value) + '\r\n\r\n'),
            done: () => write('data: [DONE]\r\n\r\n'),
            close() { if (!closed) { closed = true; writer.close(); } },
            get canceled() { return canceled; }
        };
        events.push(stream);
        return stream;
    };
    const settings = values => app.saveGlobalSettingsV136(values);
    const start = async (ref = gemini, options = {}) => {
        await ui.showScreen('chat', true);
        app.startNewChat();
        await st.executionSettingsReady;
        await app.setCurrentChatModelRef(ref);
        Object.assign(st.settings, {
            enableAutoRetry: false, enableApiTimeout: false, enableProofreading: false,
            enableThoughtTranslation: false, geminiEnableFunctionCalling: false, forceFunctionCalling: false,
            enableMemory: false, autoScroll: true, dummyUser: '', dummyModel: '', ...options
        });
    };
    const send = text => { el.userInput.value = text; return app.handleSend(); };
    const chat = () => db.getChat(st.currentChatId);
    const body = () => el.messageContainer.querySelector('[id^="streaming-content-"]');
    const visibleThoughtLabel = () => el.messageContainer.querySelector('.thought-summary-details summary')?.textContent;
    const existingSuccessful = async () => (await db.getSetting(SettingsV136.SUCCESS_KEY))?.value;
    const assertQuietStop = () => {
        assert(!body() && !el.messageContainer.querySelector('.generation-placeholder, .message.error'));
        assert(!el.messageContainer.textContent.includes('リクエストがキャンセルされました'));
        assert(!st.isSending && st.abortController === null && st.sendExecutionV136 === null && !st.currentExecutionApiConfig);
        assert(el.sendButton.title === '送信' && !el.sendButton.classList.contains('sending') && !el.userInput.disabled);
    };
    let toolId;

    try {
        for (const name of ['appendMessage', 'renderChatMessages', 'updateStreamingMessage', 'renderStreamingResult']) {
            ui[name] = window.testRealUi[name];
        }
        ui.showCustomConfirm = async () => true;
        for (const path of ['../marked.js', '../purify.min.js']) {
            if (path.includes('marked') ? !window.marked : !window.DOMPurify) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = path;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.append(script);
                });
            }
        }
        await db.saveSetting('apiConfigs', [
            ...originalConfigs.map(config => config.id === gemini.apiConfigId
                ? {...config, modelCandidates: [...config.modelCandidates, geminiImage.modelName]} : config),
            {id: router.apiConfigId, name: 'Streaming fixture', provider: 'openrouter', apiKey: 'mock',
                baseUrl: routerBase, modelCandidates: [router.modelName, deepseek.modelName], defaultModel: router.modelName}
        ]);
        st.modelMetadataV136[router.apiConfigId] = Object.fromEntries(routerMetadata.map(meta => [meta.id, meta]));
        window.fetch = async (url, options) => {
            if (!options?.body && String(url).startsWith(routerBase)) return json({data: routerMetadata});
            if (!options?.body) return rawFetch(url, options);
            const call = {url: String(url), body: JSON.parse(options.body), signal: options.signal};
            calls.push(call);
            return reply(call);
        };
        await test('streaming setting is global, opt-in and has the exact two descriptions', async () => {
            eq(st.settings.enableStreamingOutput, false);
            const input = el.enableStreamingOutputCheckbox;
            eq(input.closest('[data-settings-panel]').dataset.settingsPanel, 'general');
            eq(input.parentElement.textContent.trim(), 'ストリーミング出力を有効にする');
            eq(document.getElementById('streaming-output-description').textContent, 'AIの回答を生成中に順次表示します。');
            eq(document.getElementById('streaming-output-support').textContent, '現在はGeminiとOpenRouterに対応しています。');
            input.checked = true;
            input.dispatchEvent(new Event('change', {bubbles: true}));
            await waitFor(() => st.globalSettingsV136.enableStreamingOutput, 'global streaming setting');
            const exported = JSON.parse((await app._prepareExportData()).metadataJson);
            eq(exported.data.settings.find(entry => entry.key === SettingsV136.GLOBAL_KEY).value.enableStreamingOutput, true);
            assert(!Object.hasOwn((await db.getProfile(st.activeProfileId)).settings, 'enableStreamingOutput'));
            await settings({showThoughtProcess: true});
        });

        await test('Gemini streams safe text and thoughts into one placeholder, follows only near bottom and finishes as Markdown', async () => {
            const channel = sse();
            const begin = calls.length;
            reply = () => channel.response;
            await start();
            const running = send('本文を生成');
            const answer = await waitFor(body, 'Gemini placeholder');
            await waitFor(() => calls.length > begin, 'Gemini request');
            assert(calls[begin].url.includes(':streamGenerateContent?alt=sse'));
            const scroll = el.chatScreen.querySelector('.main-content');
            if (window.settingsUiV136) {
                const filler = document.createElement('div');
                filler.style.height = '1600px';
                el.messageContainer.prepend(filler);
                scroll.scrollTop = scroll.scrollHeight;
            }
            const raw = '**太字** <svg onload="window.streamMarkupExecuted=true"></svg>';
            const first = raw + '\n長い行'.repeat(90);
            channel.frame(geminiResult([{text: '<b>思考</b>', thought: true}, {text: first, thoughtSignature: 'text-signature'}]));
            await waitFor(() => answer.textContent === first, 'first displayed SSE chunk');
            assert(body() === answer && !answer.querySelector('svg,strong'));
            eq(visibleThoughtLabel(), '思考プロセス');
            assert(!el.messageContainer.querySelector('.thought-summary-content b'));
            assert(!el.messageContainer.textContent.includes('受信中') && !el.messageContainer.textContent.includes('生成完了'));
            if (window.settingsUiV136) {
                assert(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4, 'follows the bottom');
                scroll.scrollTop = 0;
            }
            channel.frame(geminiResult([{text: '\n続き'.repeat(20)}]));
            await waitFor(() => answer.textContent.endsWith('続き'), 'second displayed SSE chunk');
            if (window.settingsUiV136) assert(scroll.scrollTop < 4, 'does not jump when scrolled up');
            channel.frame({...geminiResult([], 'STOP'), usageMetadata: {totalTokenCount: 52}});
            channel.close();
            await running;
            assert(!body() && el.messageContainer.querySelector('.model .message-content strong')?.textContent === '太字');
            assert(!el.messageContainer.querySelector('[onload]') && !window.streamMarkupExecuted);
            eq(visibleThoughtLabel(), '思考プロセス');
            const model = (await chat()).messages.at(-1);
            eq(model.continuation.parts[1].thoughtSignature, 'text-signature');
            eq(model.usageMetadata.totalTokenCount, 52);
            assert(!model.incomplete);
        });

        await test('Gemini executes signed tools only after stream completion and matches non-streaming continuation', async () => {
            const parts = [
                {functionCall: {name: 'stream_fixture', args: {city: '東京'}, id: 'tool-id'}, thoughtSignature: 'tool-signature'}
            ];
            window.functionDeclarations = [{function_declarations: [{name: 'stream_fixture', parameters: {type: 'object'}}]}];
            const executed = [];
            window.functionCallingTools = {stream_fixture: async args => { executed.push(args.city); return {answer: 'fixture'}; }};
            const initial = sse(), followup = sse();
            const begin = calls.length;
            reply = () => calls.length === begin + 1 ? initial.response : followup.response;
            await start(gemini, {geminiEnableFunctionCalling: true});
            const running = send('ツールを使用');
            await waitFor(() => calls.length === begin + 1, 'first tool stream');
            initial.frame(geminiResult(parts, 'STOP'));
            await tick();
            eq(executed, []);
            initial.close();
            await waitFor(() => calls.length === begin + 2, 'tool continuation request');
            eq(executed, ['東京']);
            const contents = calls.at(-1).body.contents;
            eq(contents.find(entry => entry.role === 'model').parts, parts);
            eq(contents.at(-1).parts[0].functionResponse.id, 'tool-id');
            const finalParts = [{text: 'ツール結果', thoughtSignature: 'answer-signature'}];
            followup.frame(geminiResult(finalParts, 'STOP'));
            followup.close();
            await running;
            const streamed = (await chat()).messages.at(-1);
            toolId = st.currentChatId;
            await settings({enableStreamingOutput: false});
            await start(gemini, {geminiEnableFunctionCalling: true});
            const baseline = calls.length;
            reply = () => json(calls.length === baseline + 1 ? geminiResult(parts, 'STOP') : geminiResult(finalParts, 'STOP'));
            await send('ツールを使用');
            assert(calls.slice(baseline).every(call => call.url.includes(':generateContent?')));
            eq(calls[begin].body, calls[baseline].body);
            eq((await chat()).messages.at(-1).continuation.turns, streamed.continuation.turns);
            await settings({enableStreamingOutput: true});
        });

        await test('OpenRouter merges reasoning without duplication, preserves opaque details and maintains routing', async () => {
            const channel = sse();
            const begin = calls.length;
            const encrypted = {type: 'reasoning.encrypted', format: 'google-gemini-v1', id: 'opaque', data: 'unchanged/=='};
            const thought = {type: 'reasoning.text', format: 'google-gemini-v1', index: 0, text: '思考'};
            const secondThought = {...thought, index: 1, text: '続き'};
            reply = () => channel.response;
            await start(router);
            const running = send('OpenRouter');
            await waitFor(() => calls.length > begin, 'OpenRouter request');
            eq(calls[begin].url, routerBase + '/chat/completions');
            eq(calls[begin].body.model, router.modelName);
            eq(calls[begin].body.stream, true);
            channel.frame(routerResult({reasoning: '思考 続き', reasoning_content: '思考 続き',
                reasoning_details: [thought, secondThought, encrypted]}));
            channel.frame(routerResult({content: '回答'}, 'stop'));
            channel.frame({choices: [], usage: {total_tokens: 43}});
            channel.done();
            await running;
            const model = (await chat()).messages.at(-1);
            eq(model.thoughtSummary, '思考 続き');
            eq(model.continuation.openai.reasoning_details.at(-1), encrypted);
            eq(model.usageMetadata.totalTokenCount, 43);
            await settings({enableStreamingOutput: false});
            await start(router);
            reply = () => json({model: router.modelName, choices: [{index: 0, finish_reason: 'stop',
                message: {content: '回答', reasoning: '思考 続き', reasoning_content: '思考 続き',
                    reasoning_details: [thought, secondThought, encrypted]}}]});
            await send('OpenRouter');
            const {stream, ...streamRequest} = calls[begin].body;
            eq(calls.at(-1).body, streamRequest);
            eq((await chat()).messages.at(-1).continuation.turns, model.continuation.turns);
            await settings({enableStreamingOutput: true});
        });

        await test('DeepSeek streams reasoning_content and a Gemini image model uses its legacy request once', async () => {
            const channel = sse();
            await start(deepseek);
            reply = () => channel.response;
            channel.frame(routerResult({reasoning_content: 'DeepSeek thought '}));
            channel.frame(routerResult({reasoning_content: 'continued', content: 'DeepSeek answer'}, 'stop'));
            channel.done();
            await send('DeepSeek');
            eq(calls.at(-1).body.model, deepseek.modelName);
            eq((await chat()).messages.at(-1).thoughtSummary, 'DeepSeek thought continued');
            await start(geminiImage);
            const before = calls.length;
            reply = () => json(geminiResult([{text: 'media fallback'}], 'STOP'));
            await send('画像');
            eq(calls.length, before + 1);
            assert(calls.at(-1).url.includes(':generateContent?'));
            eq(calls.at(-1).body.generationConfig.responseModalities, ['IMAGE', 'TEXT']);
        });

        await test('early stop before the first save prevents the main API request', async () => {
            await start();
            const before = calls.length;
            const save = db.saveChat;
            let release, entered = false;
            const gate = new Promise(resolve => { release = resolve; });
            db.saveChat = async function (...args) {
                db.saveChat = save;
                entered = true;
                await gate;
                return save.apply(this, args);
            };
            const running = send('初回保存中に停止');
            try {
                await waitFor(() => entered, 'initial save');
                assert(st.abortController && st.isSending);
                app.abortRequest();
                assert(st.abortController.signal.aborted);
            } finally {
                db.saveChat = save;
                release();
                await running;
            }
            eq(calls.length, before);
            eq((await chat()).messages.map(message => message.role), ['user']);
            assertQuietStop();
        });

        await test('OpenRouter stops quietly before output or with only thoughts, including after reload', async () => {
            for (const thoughtOnly of [false, true]) {
                await start(router);
                const channel = sse();
                reply = () => channel.response;
                const running = send('OpenRouterの生成を停止');
                await waitFor(() => channel.body.locked && body(), 'OpenRouter response reader');
                if (thoughtOnly) {
                    channel.frame(routerResult({reasoning: '停止前の思考だけ'}));
                    await waitFor(() => visibleThoughtLabel() === '思考プロセス', 'thought-only placeholder');
                }
                el.sendButton.click();
                await running;
                assert(channel.canceled && !channel.body.locked);
                assertQuietStop();
                const saved = await chat();
                eq(saved.messages.map(message => message.role), thoughtOnly ? ['user', 'model'] : ['user']);
                if (thoughtOnly) {
                    const partial = saved.messages.at(-1);
                    eq(partial.content, '');
                    eq(partial.thoughtSummary, '停止前の思考だけ');
                    assert(partial.incomplete && !partial.continuation);
                    eq((await app._prepareApiHistory(saved.messages)).map(entry => entry.role), ['user']);
                    eq(visibleThoughtLabel(), '思考プロセス');
                }
                assert((await app.loadChat(saved.id)).ok);
                assertQuietStop();
                if (thoughtOnly) {
                    eq(visibleThoughtLabel(), '思考プロセス');
                    assert(el.messageContainer.querySelector('.thought-summary-content').textContent.includes('停止前の思考だけ'));
                }
            }
        });

        await test('interruption, read timeout and HTTP-200 stream errors keep partials without retries or continuation', async () => {
            for (const ending of ['stop', 'timeout', 'error']) {
                await start(gemini, {enableAutoRetry: true, maxRetries: 1, enableApiTimeout: ending === 'timeout', apiTimeoutSeconds: 1.5,
                    useFixedRetryDelay: true, fixedRetryDelaySeconds: 0});
                const channel = sse();
                reply = () => channel.response;
                const begin = calls.length;
                const before = await existingSuccessful();
                let expire;
                if (ending === 'timeout') window.setTimeout = (fn, ms, ...args) => {
                    if (ms !== 1500) return rawTimeout(fn, ms, ...args);
                    expire = fn;
                    return 0;
                };
                const running = send('失敗テスト ' + ending);
                await waitFor(() => calls.length === begin + 1, 'failure case request');
                channel.frame(geminiResult([{text: 'partial-' + ending}]));
                await waitFor(() => body()?.textContent === 'partial-' + ending, 'received partial');
                if (ending === 'stop') app.abortRequest();
                else if (ending === 'timeout') { assert(expire); expire(); }
                else channel.frame({error: {code: 503, message: '途中エラー'}});
                await running;
                window.setTimeout = rawTimeout;
                eq(calls.length, begin + 1);
                assert(channel.canceled && !channel.body.locked);
                const saved = await chat();
                const partial = saved.messages.find(message => message.role === 'model');
                eq(partial.content, 'partial-' + ending);
                assert(partial.incomplete && !partial.continuation);
                if (ending === 'stop') {
                    eq(saved.messages.map(message => message.role), ['user', 'model']);
                    assertQuietStop();
                } else {
                    const expected = ending === 'timeout' ? 'APIタイムアウト' : '途中エラー';
                    assert(saved.messages.at(-1).role === 'error' && saved.messages.at(-1).content.includes(expected));
                    assert(el.messageContainer.querySelector('.message.error').textContent.includes(expected));
                }
                assert(app.parseImportedHistory('<|#|model|#|incomplete>途中<|#|/model|#|>').messages[0].incomplete);
                assert((await app._prepareApiHistory(saved.messages)).every(entry =>
                    entry.parts.every(part => !part.text?.includes('partial-'))));
                eq(await existingSuccessful(), before);
            }
            await start(gemini, {enableAutoRetry: true, maxRetries: 1, useFixedRetryDelay: true, fixedRetryDelaySeconds: 0});
            const failed = sse(), recovered = sse();
            failed.frame({error: {code: 503, message: '最初の出力前のエラー'}});
            recovered.frame(geminiResult([{text: 'recovered'}], 'STOP'));
            recovered.close();
            const before = calls.length;
            reply = () => calls.length === before + 1 ? failed.response : recovered.response;
            await send('出力前なら再試行');
            eq(calls.length, before + 2);
            eq((await chat()).messages.at(-1).content, 'recovered');

            await start();
            reply = () => { throw new TypeError('fixture network failure'); };
            await send('通信失敗');
            const failedMessage = (await chat()).messages.at(-1);
            eq(failedMessage.role, 'error');
            eq(failedMessage.content, 'fixture network failure');
            assert(el.messageContainer.querySelector('.message.error').textContent.includes(failedMessage.content));
        });

        await test('switch, regenerate and delete isolate stale streams; title generation continues separately', async () => {
            await settings({enableChatTitleGeneration: true, chatTitleModelRef: gemini});
            await start();
            const main = sse();
            let titleReply;
            const title = new Promise(resolve => { titleReply = resolve; });
            let titleSignal;
            reply = call => {
                if (call.url.includes(':streamGenerateContent')) return main.response;
                titleSignal = call.signal;
                return title;
            };
            const sending = send('別のチャットへ移動');
            await waitFor(() => titleSignal && body(), 'parallel title and main request');
            const sourceId = st.currentChatId;
            main.frame(geminiResult([{text: '切替前の部分'}]));
            await waitFor(() => body()?.textContent === '切替前の部分', 'source partial');
            assert((await app.loadChat(toolId)).ok);
            await sending;
            main.frame(geminiResult([{text: '遅い出力'}], 'STOP'));
            assert(main.canceled && !titleSignal.aborted && st.currentChatId === toolId);
            assert(!el.messageContainer.textContent.includes('遅い出力'));
            titleReply(json(geminiResult([{text: '別通信で生成した題名'}], 'STOP')));
            await waitFor(async () => (await db.getChat(sourceId)).title === '別通信で生成した題名', 'independent title');
            const source = await db.getChat(sourceId);
            eq(source.messages.map(message => message.role), ['user', 'model']);
            assert(source.messages.at(-1).incomplete && source.messages.at(-1).content === '切替前の部分');
            assertQuietStop();
            await settings({enableChatTitleGeneration: false});
            await app.setCurrentChatModelRef(gemini);
            const original = (await chat()).messages.find(message => message.role === 'model');
            const emptyRegen = sse();
            reply = () => emptyRegen.response;
            const emptyRerun = app.retryFromMessage(0);
            await waitFor(() => emptyRegen.body.locked && body(), 'regeneration without output');
            app.abortRequest();
            await emptyRerun;
            assertQuietStop();
            const afterEmptyStop = (await chat()).messages;
            eq(afterEmptyStop.map(message => message.role), ['user', 'model']);
            eq(afterEmptyStop.at(-1).content, original.content);
            eq(afterEmptyStop.at(-1).continuation, original.continuation);
            const regen = sse();
            reply = () => regen.response;
            const rerun = app.retryFromMessage(0);
            await waitFor(body, 'regeneration placeholder');
            regen.frame(geminiResult([{text: '再生成の部分'}]));
            await waitFor(() => body()?.textContent === '再生成の部分', 'regeneration partial');
            app.abortRequest();
            await rerun;
            const messages = (await chat()).messages;
            eq(messages.find(message => message.role === 'model' && !message.incomplete).continuation, original.continuation);
            assert(messages.some(message => message.incomplete && message.content === '再生成の部分'));
            assert(!messages.some(message => message.role === 'error'));
            assertQuietStop();
            assert((await app.loadChat(toolId)).ok);
            assertQuietStop();
            const replacement = sse();
            replacement.frame(geminiResult([{text: '再生成成功'}], 'STOP'));
            replacement.close();
            reply = () => replacement.response;
            await app.retryFromMessage(0);
            assert((await chat()).messages.some(message => message.isSelected && message.content === '再生成成功'));
            const remove = sse();
            await start();
            reply = () => remove.response;
            const pending = send('生成中に削除');
            const begin = calls.length;
            await waitFor(() => calls.length > begin && st.currentChatId, 'deleted chat request');
            const id = st.currentChatId;
            assert((await window.chatHistoryActions.delete(id)).ok);
            await pending;
            assert(remove.canceled && !(await db.getChat(id)));
        });

        await test('thought label is identical on all saved response routes and hidden when disabled', async () => {
            await settings({showThoughtProcess: true});
            const original = st.currentMessages;
            try {
                const providers = ['gemini', 'openrouter', 'zai', 'bedrock'];
                st.currentMessages = providers.map(provider => ({role: 'model', content: provider, thoughtSummary: '考えたこと',
                    continuation: {provider}}));
                for (const [index, message] of st.currentMessages.entries()) {
                    const node = ui.createMessageElement('model', message.content, index);
                    eq(node.querySelector('.thought-summary-details summary')?.textContent, '思考プロセス');
                }
                await settings({showThoughtProcess: false});
                assert(!ui.createMessageElement('model', 'gemini', 0).querySelector('.thought-summary-details'));
            } finally { st.currentMessages = original; }
        });
    } finally {
        for (const event of events) event.close();
        window.fetch = rawFetch;
        window.setTimeout = rawTimeout;
        window.functionCallingTools = originalTools;
        window.functionDeclarations = originalDeclarations;
        Object.assign(ui, originalUi);
        await db.saveSetting('apiConfigs', originalConfigs);
        await settings({enableStreamingOutput: false, ...globalBefore});
    }
};

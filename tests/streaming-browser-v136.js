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
    const geminiBase = 'https://gemini-thinking.invalid/v1beta/models';
    const hydrogen = {apiConfigId: 'thinking-gemini', modelName: 'gemini-4-hydrogen'};
    const future = {...hydrogen, modelName: 'gemini-12.1-nova-preview'};
    const noThinking = {...hydrogen, modelName: 'gemini-13-embedder'};
    const geminiConfig = {id: hydrogen.apiConfigId, name: 'Gemini Thinking fixture', provider: 'gemini',
        apiKey: 'mock-key-1', baseUrl: geminiBase + '/', defaultModel: hydrogen.modelName,
        modelCandidates: [hydrogen.modelName, future.modelName, noThinking.modelName]};
    const encoder = new TextEncoder();
    const calls = [];
    const modelCalls = [];
    const events = [];
    let reply, modelReply;
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
                baseUrl: routerBase, modelCandidates: [router.modelName, deepseek.modelName], defaultModel: router.modelName},
            geminiConfig
        ]);
        st.modelMetadataV136[router.apiConfigId] = Object.fromEntries(routerMetadata.map(meta => [meta.id, meta]));
        window.fetch = async (url, options) => {
            if (!options?.body && String(url).startsWith(routerBase)) return json({data: routerMetadata});
            if (!options?.body && String(url).startsWith('https://gemini-thinking.invalid/')) {
                const call = {url: String(url), key: options.headers['x-goog-api-key'], redirect: options.redirect, cache: options.cache};
                modelCalls.push(call);
                return modelReply(call);
            }
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

        await test('Japanese-majority thought still translates its English paragraph in one request', async () => {
            const japanese = '既に日本語で書かれた説明はそのままにする。'.repeat(8);
            const source = `${japanese}\n\nCheck the remaining results.`;
            const start = calls.length;
            reply = () => json(geminiResult([{text: '{"1":"残りの結果を確認する。"}'}], 'STOP'));
            const translated = await window.testApi.translateText(source, {provider: 'gemini', modelName: gemini.modelName, apiKey: 'mock'});
            eq(translated, {text: `${japanese}\n\n残りの結果を確認する。`, complete: true});
            eq(calls.length - start, 1);
        });

        const translationConfig = {provider: 'gemini', modelName: 'gemini-2.5-pro', apiKey: 'mock'};
        const translate = (source, config = translationConfig, signal) => window.testApi.translateText(source, config, signal);
        const translationResponse = entries => json(geminiResult([{text: JSON.stringify(entries)}], 'STOP'));

        await test('translate only prose and keep Markdown, CRLF, literals and existing Japanese', async () => {
            const technical = 'Gemini 2.5 Pro / OpenAI API / Amazon Bedrock / getFoo() / foo_bar / model-name';
            const unchanged = `日本語で既に説明しています。${technical}\n${technical}\n\`\`\`js\nDo not translate this code.\n\`\`\``;
            const before = calls.length;
            eq(await translate(unchanged), {text: unchanged, complete: true});
            eq(calls.length, before);
            const source = '## Next steps\r\n- Verify inputs.  \r\n\r\n既存の説明。\r\n> Check `getFoo()` again.\r\n' + unchanged;
            const result = {1: '次の手順', 2: '入力を確認する。', 3: '`getFoo()` を再確認する。'};
            reply = ({body}) => {
                eq(JSON.parse(body.contents[0].parts[0].text), {1:'Next steps', 2:'Verify inputs.', 3:'Check `getFoo()` again.'});
                return translationResponse(result);
            };
            eq(await translate(source), {text:'## 次の手順\r\n- 入力を確認する。  \r\n\r\n既存の説明。\r\n> `getFoo()` を再確認する。\r\n' + unchanged, complete:true});
            eq(calls.length - before, 1);
        });

        await test('partial, omitted, and altered-literal rows get one bounded repair; accepted rows survive', async () => {
            const source = 'Check inputs.\n\n日本語の説明。\nCheck outputs.\nKeep all details.\nCall `getFoo()` now.';
            const before = calls.length;
            reply = ({body}) => {
                const rows = JSON.parse(body.contents[0].parts[0].text);
                if (calls.length === before + 1) {
                    eq(Object.keys(rows), ['1','2','3','4']);
                    return translationResponse({1:'入力を確認する。', 2:'確認する。 Check outputs.', 4:'`getBar()` を呼ぶ。'});
                }
                eq(Object.keys(rows), ['2','3','4']);
                return translationResponse({2:'出力を確認する。', 3:'Keep all details.', 4:'`getFoo()` を呼ぶ。'});
            };
            eq(await translate(source), {text:'入力を確認する。\n\n日本語の説明。\n出力を確認する。\nKeep all details.\n`getFoo()` を呼ぶ。', complete:false});
            eq(calls.length - before, 2);
        });

        await test('all four translation routes use the chosen model and extract only final text', async () => {
            const source = 'Check the final result.';
            const expected = {text:'最終結果を確認する。', complete:true};
            const data = JSON.stringify({1:expected.text});
            const before = calls.length;
            for (const provider of ['gemini','openrouter','zai']) {
                const config = {...translationConfig, provider, modelName: `${provider}-chosen`};
                reply = ({url, body}) => {
                    if (provider === 'gemini') {
                        assert(url.includes('/gemini-chosen:generateContent'));
                        eq(JSON.parse(body.contents[0].parts[0].text), {1:source});
                        return json(geminiResult([{thought:true, text:'Private fixture'}, {text:data.slice(0, 5)}, {text:data.slice(5)}], 'STOP'));
                    }
                    eq(body.model, config.modelName);
                    eq(JSON.parse(body.messages[1].content), {1:source});
                    const content = provider === 'openrouter' ? [{type:'reasoning', text:'private fixture'}, {type:'text', text:data}] : data;
                    return json({choices:[{finish_reason:'stop', message:{content, reasoning_content:'private fixture'}}]});
                };
                eq(await translate(source, config), expected);
            }
            eq(calls.length - before, 3);
            const {BedrockRuntimeClient, ConverseCommand} = window;
            try {
                window.ConverseCommand = class { constructor(input) { this.input = input; } };
                window.BedrockRuntimeClient = class {
                    async send(command) {
                        eq(command.input.modelId, 'bedrock-chosen');
                        eq(JSON.parse(command.input.messages[0].content[0].text), {1:source});
                        return {stopReason:'end_turn', output:{message:{content:[{reasoningContent:{reasoningText:{text:'private fixture'}}}, {text:data}]}}};
                    }
                };
                eq(await translate(source, {...translationConfig, provider:'bedrock', modelName:'bedrock-chosen', bedrockSecretKey:'mock'}), expected);
            } finally {
                Object.assign(window, {BedrockRuntimeClient, ConverseCommand});
            }
        });

        await test('output cap, empty response, network error, timeout and cancellation preserve originals', async () => {
            const rows = Array.from({length:24}, (_, index) => `Check item ${index}. ` + 'Review all related input carefully. '.repeat(10).trim());
            const translatedRow = index => `項目${index}を確認する。` + '関連する入力をすべて注意深く見直す。'.repeat(10);
            const source = rows.join('\n\n');
            const before = calls.length;
            const started = performance.now();
            reply = ({body}) => {
                const sent = JSON.parse(body.contents[0].parts[0].text);
                if (calls.length === before + 1) {
                    eq(Object.keys(sent).length, 24);
                    return json(geminiResult([{text:'{"1":"途中'}], 'MAX_TOKENS'));
                }
                eq(Object.keys(sent).length, 12);
                return translationResponse(Object.fromEntries(Object.keys(sent).map(key => [key, translatedRow(Number(key) - 1)])));
            };
            eq(await translate(source), {text:[...rows.slice(0, 12).map((_, index) => translatedRow(index)), ...rows.slice(12)].join('\n\n'), complete:false});
            eq(calls.length - before, 2);
            console.log('Long thought fixture (mock) ms:', Math.round(performance.now() - started));

            const short = 'Check inputs.';
            const fallback = {text:short, complete:false};
            st.settings.enableAutoRetry = false;
            st.settings.enableApiTimeout = false;
            reply = () => json(geminiResult([{thought:true, text:'reasoning only'}], 'STOP'));
            eq(await translate(short), fallback);
            reply = () => new Response('', {status:500});
            eq(await translate(short), fallback);
            reply = ({signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
            window.setTimeout = (fn, ms, ...args) => rawTimeout(fn, ms === 15000 ? 12 : ms, ...args);
            try { eq(await translate(short), fallback); }
            finally { window.setTimeout = rawTimeout; }
            const controller = new AbortController();
            const running = translate(short, translationConfig, controller.signal);
            controller.abort();
            const error = await running.catch(reason => reason);
            eq(error.name, 'AbortError');
            eq(calls.length - before, 6);
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
                {text: 'Check the location.', thought: true},
                {functionCall: {name: 'stream_fixture', args: {city: '東京'}, id: 'tool-id'}, thoughtSignature: 'tool-signature'}
            ];
            window.functionDeclarations = [{function_declarations: [{name: 'stream_fixture', parameters: {type: 'object'}}]}];
            const executed = [];
            window.functionCallingTools = {stream_fixture: async args => { executed.push(args.city); return {answer: 'fixture'}; }};
            const initial = sse(), followup = sse();
            const begin = calls.length;
            const translation = call => {
                assert(call.url.includes('/gemini-2.5-pro:generateContent'));
                eq(JSON.parse(call.body.contents[0].parts[0].text), {1:'Check the location.', 2:'Review the tool result.'});
                return translationResponse({1:'場所を確認する。', 2:'ツール結果を確認する。'});
            };
            reply = call => {
                if (calls.length === begin + 1) return initial.response;
                if (calls.length === begin + 2) return followup.response;
                return translation(call);
            };
            await settings({thoughtTranslationModelRef:{apiConfigId:'gem', modelName:'gemini-2.5-pro'}});
            const options = {geminiEnableFunctionCalling: true, enableThoughtTranslation: true};
            await start(gemini, options);
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
            const finalParts = [{text:'Review the tool result.', thought:true}, {text: 'ツール結果', thoughtSignature: 'answer-signature'}];
            followup.frame(geminiResult(finalParts, 'STOP'));
            followup.close();
            await running;
            const streamed = (await chat()).messages.at(-1);
            eq(calls.length - begin, 3);
            eq(streamed.thoughtSummary, '場所を確認する。\n\nツール結果を確認する。');
            eq(streamed.thoughtTranslationMeta.model, 'gemini-2.5-pro');
            assert(el.messageContainer.querySelector('.thought-summary-content').textContent.includes('場所を確認する。'));
            toolId = st.currentChatId;
            await settings({enableStreamingOutput: false});
            await start(gemini, options);
            const baseline = calls.length;
            reply = call => calls.length > baseline + 2 ? translation(call)
                : json(calls.length === baseline + 1 ? geminiResult(parts, 'STOP') : geminiResult(finalParts, 'STOP'));
            el.userInput.value = 'ツールを使用';
            el.userInput.dispatchEvent(new Event('input', {bubbles:true}));
            el.sendButton.click();
            const nonstreamed = await waitFor(async () => st.currentChatId && (await chat())?.messages.find(message =>
                message.role === 'model' && message.thoughtTranslationMeta), 'send button persists the translated response');
            await waitFor(() => !st.isSending, 'send button action completed');
            eq(calls.length - baseline, 3);
            assert(calls.slice(baseline, baseline + 2).every(call => call.url.includes(':generateContent?')));
            eq(calls[begin].body, calls[baseline].body);
            eq(nonstreamed.continuation.turns, streamed.continuation.turns);
            eq(nonstreamed.thoughtSummary, streamed.thoughtSummary);
            assert((await app.loadChat(toolId)).ok);
            eq(st.currentMessages.at(-1).thoughtSummary, streamed.thoughtSummary);
            await settings({enableStreamingOutput: true});
            window.functionCallingTools = originalTools;
            window.functionDeclarations = originalDeclarations;
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

        await test('stream survives navigation and restores its partial; regeneration, deletion and title requests remain independent', async () => {
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
            assert(!main.canceled && !titleSignal.aborted && st.currentChatId === toolId);
            assert(!el.messageContainer.textContent.includes('切替前の部分'));
            main.frame(geminiResult([{text: ' + 非表示中の部分'}]));
            assert((await app.loadChat(sourceId)).ok);
            await waitFor(() => body()?.textContent === '切替前の部分 + 非表示中の部分', 'restored stream');
            assert(st.isSending && el.sendButton.title === '停止');
            await app.loadChat(toolId);
            main.frame(geminiResult([{text: ' + 最終出力'}], 'STOP'));
            main.close();
            await sending;
            assert(!el.messageContainer.textContent.includes('最終出力'));
            titleReply(json(geminiResult([{text: '別通信で生成した題名'}], 'STOP')));
            await waitFor(async () => (await db.getChat(sourceId)).title === '別通信で生成した題名', 'independent title');
            const source = await db.getChat(sourceId);
            eq(source.messages.map(message => message.role), ['user', 'model']);
            assert(!source.messages.at(-1).incomplete && source.messages.at(-1).content === '切替前の部分 + 非表示中の部分 + 最終出力');
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
            await app.loadChat(sourceId);
            assert(!regen.canceled && !st.isSending);
            await app.loadChat(toolId);
            eq(body()?.textContent, '再生成の部分');
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
            replacement.frame(geminiResult([{text:'Check the new answer.', thought:true}, {text: '再生成成功'}], 'STOP'));
            replacement.close();
            await settings({enableThoughtTranslation: true});
            reply = call => {
                if (call.url.includes(':streamGenerateContent')) return replacement.response;
                eq(JSON.parse(call.body.contents[0].parts[0].text), {1:'Check the new answer.'});
                return translationResponse({1:'新しい回答を確認する。'});
            };
            await app.retryFromMessage(0);
            const responses = (await chat()).messages;
            eq(responses.find(message => message.isSelected && message.content === '再生成成功')?.thoughtSummary, '新しい回答を確認する。');
            assert(responses.some(message => !message.isSelected && message.thoughtSummary === original.thoughtSummary));
            await settings({enableThoughtTranslation: globalBefore.enableThoughtTranslation});
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

        await test('two providers can send independently while the first draft is still waiting for its ID', async () => {
            await start(gemini, {enableStreamingOutput: true});
            const main = sse(), other = sse();
            const save = db.saveChat;
            let release, releaseStop, stopping = false;
            const hold = new Promise(resolve => { release = resolve; });
            const holdStop = new Promise(resolve => { releaseStop = resolve; });
            let draft;
            // Capture the initial write even when title generation is disabled.
            db.saveChat = async function (...args) {
                if (Object.hasOwn(args[2] || {}, 'titleGeneration') && !draft) {
                    draft = args[2].sendSession;
                    await hold;
                }
                if (args[2]?.sendSession?.controller.signal.aborted && args[2].sendSession !== draft) {
                    stopping = true;
                    await holdStop;
                }
                return save.apply(this, args);
            };
            reply = call => call.url.startsWith(routerBase) ? other.response : main.response;
            const first = send('A draft prompt');
            let second;
            try {
                await waitFor(() => draft, 'first draft waiting for IndexedDB');
                eq(draft.chatId, null);
                const sourceProfile = draft.profileId;
                assert(await app.confirmStartNewChat());
                await st.executionSettingsReady;
                assert(!st.isSending && !el.userInput.disabled && el.sendButton.title === '送信');
                await app.setCurrentChatModelRef(router);
                const profile = (await db.getAllProfiles()).find(candidate => candidate.id !== sourceProfile);
                if (profile) assert(await app.switchProfile(profile.id));
                st.settings.enableStreamingOutput = true;
                second = send('B draft prompt');
                await waitFor(() => other.body.locked, 'second provider streaming');
                const targetId = st.currentChatId;
                const targetMessages = st.currentMessages;
                release();
                await waitFor(() => main.body.locked, 'first provider streaming after second draft commits');
                const sourceId = draft.chatId;
                assert(sourceId !== targetId && st.currentChatId === targetId && st.currentMessages === targetMessages);
                main.frame(geminiResult([{text: 'A partial'}]));
                other.frame(routerResult({content: 'B partial'}));
                await waitFor(() => body()?.textContent === 'B partial', 'only second stream rendered');
                assert(st.sendJobsV136.size === 2 && !draft.controller.signal.aborted);
                const copied = await app.duplicateChat(sourceId);
                assert(copied.ok && !other.canceled && !main.canceled);
                eq((await db.getChat(copied.chatId)).messages.map(message => message.content), ['A draft prompt']);
                await app.loadChat(sourceId);
                await waitFor(() => body()?.textContent === 'A partial', 'first stream restored');
                await app.loadChat(targetId);
                await waitFor(() => body()?.textContent === 'B partial', 'second stream restored');
                await send('duplicate B');
                el.sendButton.click();
                await waitFor(() => stopping, 'second job saving its stopped partial');
                assert(other.canceled && !main.canceled && !draft.controller.signal.aborted);
                main.frame(geminiResult([{text: ' A final'}], 'STOP'));
                main.close();
                await first;
                eq(st.currentChatId, targetId);
                releaseStop();
                await second;
                const a = await db.getChat(sourceId), b = await db.getChat(targetId);
                eq(a.messages.map(message => message.content), ['A draft prompt', 'A partial A final']);
                eq(b.messages.map(message => message.content), ['B draft prompt', 'B partial']);
                assert(!a.messages.at(-1).incomplete && b.messages.at(-1).incomplete);
                eq(a.messages.at(-1).usageMetadata.tmExecution.profileId, sourceProfile);
                eq(a.executionSettings.modelRef, gemini);
                eq(b.executionSettings.modelRef, router);
                assertQuietStop();
            } finally {
                release();
                releaseStop();
                db.saveChat = save;
                main.close();
                other.close();
                await Promise.allSettled([first, second]);
                if (draft && draft.profileId !== st.activeProfileId) await app.switchProfile(draft.profileId);
            }
        });

        await test('background retry and tool continuation retain the source system, memory and model after racing loads', async () => {
            await settings({memoryModelRef: router});
            await start(gemini, {enableStreamingOutput: false, enableAutoRetry: true, maxRetries: 1,
                useFixedRetryDelay: true, fixedRetryDelaySeconds: 0, geminiEnableFunctionCalling: true,
                enableMemory: true, memoryAutoSaveInterval: 1});
            const sourceProfile = st.activeProfileId;
            const originalMemory = await db.getMemory(sourceProfile);
            await db.saveMemory(sourceProfile, {items: ['profile A memory']});
            st.currentSystemPrompt = 'system A';
            st.currentPersistentMemory = {inventories: {a: ['source-only']}};
            st.currentSummarizedContext = {summaryText: 'summary A', summaryRange: {start: 0, end: 0}};
            const original = await db.getChat(toolId);
            const get = db.getChat;
            let releaseRead, readEntered, replyFailure;
            const holdRead = new Promise(resolve => { releaseRead = resolve; });
            const attempts = [];
            const toolSource = await (await rawFetch('../function-calling.js')).text();
            Function(toolSource)();
            const sourceResponse = new Promise(resolve => { replyFailure = resolve; });
            reply = call => {
                attempts.push(call);
                if (attempts.length === 1) return sourceResponse;
                if (attempts.length === 2) return json(geminiResult([{functionCall: {
                    name:'manage_persistent_memory', args:{action:'add', key:'source-key', value:'source-value'}
                }}], 'STOP'));
                if (attempts.length === 3) return json(geminiResult([{text:'A tool answer'}], 'STOP'));
                return json({choices: [{message: {content: '- extracted source item'}}]});
            };
            const sending = send('tool and retry from A');
            try {
                await waitFor(() => attempts.length === 1, 'first source request');
                const sourceId = st.currentChatId;
                db.getChat = async function (...args) {
                    const result = await get.apply(this, args);
                    if (args[0] === sourceId && !readEntered) {
                        readEntered = true;
                        await holdRead;
                    }
                    return result;
                };
                const stale = app.loadChat(sourceId);
                await waitFor(() => readEntered, 'source read held while navigating');
                assert((await app.loadChat(toolId)).ok);
                await ui.showScreen('settings', true);
                Object.assign(st.settings, {enableAutoRetry:false, geminiEnableFunctionCalling:false});
                st.currentSystemPrompt = 'system B';
                replyFailure(new Response('temporary service error', {status: 503}));
                await sending;
                releaseRead();
                assert(!(await stale).ok);
                eq(st.currentChatId, toolId);
                eq(st.currentSystemPrompt, 'system B');
                eq((await get.call(db, toolId)).messages, original.messages);
                eq((await get.call(db, toolId)).persistentMemory, original.persistentMemory);
                await waitFor(async () => (await db.getMemory(sourceProfile)).items.includes('extracted source item'), 'source memory extraction');
                eq(attempts.length, 4);
                for (const attempt of attempts.slice(0, 3)) {
                    assert(attempt.url.includes(gemini.modelName));
                    assert(attempt.body.systemInstruction.parts[0].text.includes('system A'));
                    assert(attempt.body.systemInstruction.parts[0].text.includes('profile A memory'));
                    assert(JSON.stringify(attempt.body.contents).includes('summary A'));
                    assert(!JSON.stringify(attempt.body).includes('system B'));
                }
                const result = attempts[2].body.contents.at(-1).parts[0].functionResponse;
                assert(result.response.success, JSON.stringify(result));
                eq(attempts[3].body.model, router.modelName);
                assert(JSON.stringify(attempts[3].body).includes('A tool answer'));
                assert(!JSON.stringify(attempts[3].body).includes('system B'));
                const source = await get.call(db, sourceId);
                eq(source.persistentMemory['source-key'], 'source-value');
                eq(source.messages.at(-1).content, 'A tool answer');
                eq(source.messages.at(-1).executedFunctions, ['manage_persistent_memory']);
                assert((await app.loadChat(sourceId)).ok);
                assertQuietStop();
            } finally {
                releaseRead();
                replyFailure(new Response('controlled cleanup', {status: 400}));
                db.getChat = get;
                await Promise.allSettled([sending]);
                await db.saveMemory(sourceProfile, originalMemory || {items: []});
                await settings({memoryModelRef: globalBefore.memoryModelRef ?? null});
                await ui.showScreen('chat', true);
            }
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

        await test('Hydrogen displays its documented default, preserves choices and observes both GenerateContent transports', async () => {
            await settings({enableStreamingOutput:false, showThoughtProcess:true});
            modelReply = () => json({name:'models/' + hydrogen.modelName, thinking:true, supportedGenerationMethods:['generateContent']});
            await start(hydrogen);
            await app.ensureGeminiThinkingCapabilities(hydrogen);
            await app.ensureGeminiThinkingCapabilities(hydrogen);
            eq(modelCalls, [{url:geminiBase + '/' + hydrogen.modelName,key:'mock-key-1',redirect:'error',cache:'no-store'}]);
            const capability = () => app.getModelThinkingCapability(hydrogen);
            eq(capability().levels, ['low','medium','high','xhigh']);
            assert(capability().thinkingConfirmed && !capability().acceptedLevels.length);
            eq(app.getCurrentChatThinkingEffort(), null);
            const select = document.getElementById('settings-thinking-button');
            const trigger = document.getElementById('chat-model-button');
            eq([...select.options].map(option=>option.textContent), ['モデル既定','Low','Medium','High','Extra High']);
            eq(select.value, 'high');
            eq(document.getElementById('chat-thinking-label').textContent, 'High');
            reply = () => json(geminiResult([{text:'default answer'}],'STOP'));
            await send('Hydrogen before selecting a Thinking level');
            eq(calls.at(-1).body.generationConfig.thinkingConfig,{includeThoughts:true});
            eq(capability().acceptedLevels, []);
            const storedChat = st.currentChatId;
            eq((await chat()).executionSettings.thinkingEffort, null);
            await app.loadChat(storedChat,{scrollAfterLoad:false});
            eq(app.getCurrentChatThinkingEffort(), null);
            eq(select.value, 'high');
            trigger.click();
            const popover = document.querySelector('.thinking-popover');
            eq(popover.querySelector('.thinking-level-name').textContent, 'High');
            eq(popover.querySelector('[data-level="high"]').getAttribute('aria-checked'), 'true');
            eq([...popover.querySelectorAll('[role=radio]')].map(dot=>dot.dataset.level), ['low','medium','high','xhigh']);
            eq([...popover.querySelectorAll('[role=radio]')].map(dot=>dot.getAttribute('aria-label')), ['Low','Medium','High','Extra High']);
            popover.querySelector('[data-level="xhigh"]').click();
            await waitFor(()=>app.getCurrentChatThinkingEffort()==='xhigh', 'Hydrogen choice in popover');
            eq(popover.querySelector('.thinking-level-name').textContent, 'Extra High');
            let before = calls.length;
            reply = () => json(geminiResult([{text:'thought',thought:true},{text:'answer'}],'STOP'));
            await send('Hydrogen non-stream');
            eq(calls.length-before,1);
            assert(calls.at(-1).url.includes(':generateContent?'));
            eq(calls.at(-1).body.generationConfig.thinkingConfig,{thinkingLevel:'XHIGH',includeThoughts:true});
            eq(capability().acceptedLevels,['xhigh']);
            eq((await chat()).executionSettings.thinkingEffort,'xhigh');
            await app.loadChat(storedChat,{scrollAfterLoad:false});
            eq(app.getCurrentChatThinkingEffort(),'xhigh');
            eq(select.options[4].textContent,'Extra High');
            await app.setCurrentChatThinkingEffort('low');
            await settings({enableStreamingOutput:true});
            reply = () => {
                const event = sse();
                event.frame(geminiResult([{text:'stream answer'}],'STOP'));
                event.done(); event.close();
                return event.response;
            };
            before = calls.length;
            await send('Hydrogen stream');
            eq(calls.length-before,1);
            assert(calls.at(-1).url.includes(':streamGenerateContent?'));
            eq(calls.at(-1).body.generationConfig.thinkingConfig.thinkingLevel,'LOW');
            eq(capability().acceptedLevels,['xhigh','low']);
            await app.setCurrentChatThinkingEffort(SettingsV136.MODEL_DEFAULT_EFFORT);
            await settings({enableStreamingOutput:false});
            reply = () => json(geminiResult([{text:'default answer'}],'STOP'));
            await send('Hydrogen model default');
            eq(calls.at(-1).body.generationConfig.thinkingConfig,{includeThoughts:true});
            eq((await chat()).executionSettings.thinkingEffort,'model-default');
        });

        await test('future Gemini preserves choices on error, isolates cached metadata and never probes generation', async () => {
            await settings({enableStreamingOutput:false});
            modelReply = () => { throw new TypeError('fixture offline'); };
            await start(future, {enableAutoRetry:true,maxRetries:2});
            eq(app.getModelThinkingCapability().levels,['low','medium','high','xhigh']);
            eq(document.getElementById('settings-thinking-button').value, SettingsV136.MODEL_DEFAULT_EFFORT);
            eq(document.getElementById('chat-thinking-label').textContent, 'モデル既定');
            let before = calls.length;
            reply = () => json(geminiResult([{text:'works offline from Models API'}],'STOP'));
            await send('Default while metadata is unavailable');
            eq(calls.length-before,1);
            assert(!calls.at(-1).body.generationConfig.thinkingConfig);
            await app.setCurrentChatThinkingEffort('xhigh');
            const errorResponse = message => new Response(JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT',message}}),
                {status:400,headers:{'Content-Type':'application/json'}});
            reply = () => errorResponse('Invalid maxOutputTokens.');
            before = calls.length;
            await send('Unrelated invalid argument');
            eq(calls.length-before,1);
            eq(app.getModelThinkingCapability().rejectedLevels,[]);
            eq(app.getCurrentChatThinkingEffort(),'xhigh');
            reply = () => errorResponse('Thinking level XHIGH is not supported for this model.');
            before = calls.length;
            await send('Rejected thinking level');
            eq(calls.length-before,1);
            eq(app.getModelThinkingCapability().rejectedLevels,['xhigh']);
            eq(app.getCurrentChatThinkingEffort(),'xhigh');
            const rejected = document.querySelector('#settings-thinking-button option[value="xhigh"]');
            assert(rejected.disabled);
            eq(rejected.textContent,'Extra High');
            assert(st.currentMessages.some(message=>message.content.includes('Thinking レベル「XHIGH」を拒否')));
            let blocked = false;
            try { app.freezeExecutionSettings(); } catch (error) { blocked = error.message.includes('拒否'); }
            assert(blocked && calls.length===before+1);

            await app.setCurrentChatThinkingEffort('medium');
            await settings({enableStreamingOutput:true});
            reply = () => {
                const event = sse();
                event.frame({error:{code:400,message:'Thinking level MEDIUM is not supported for this model.'}});
                event.close();
                return event.response;
            };
            before = calls.length;
            await send('Stream rejected thinking level');
            eq(calls.length-before,1);
            eq(app.getModelThinkingCapability().rejectedLevels,['xhigh','medium']);
            eq(app.getCurrentChatThinkingEffort(),'medium');
            await settings({enableStreamingOutput:false});

            let releaseOld, releaseOther;
            modelReply = ({key,url}) => key==='mock-key-2' && url===geminiBase+'/'+future.modelName
                ? new Promise(resolve=>{releaseOld=resolve;})
                : url.endsWith(noThinking.modelName)
                    ? new Promise(resolve=>{releaseOther=resolve;})
                    : json({name:'models/'+future.modelName,thinking:true});
            const changeConnection = async (apiKey, baseUrl) => {
                const configs = (await db.getSetting('apiConfigs')).value;
                await db.saveSetting('apiConfigs',configs.map(config=>config.id===future.apiConfigId ? {...config,apiKey,baseUrl} : config));
                await app.refreshExecutionApiConfigsV136();
            };
            await changeConnection('mock-key-2',geminiBase);
            const pending = app.ensureGeminiThinkingCapabilities(future);
            assert(pending && pending===app.ensureGeminiThinkingCapabilities(future));
            await waitFor(()=>releaseOld,'pending metadata for old credential');
            eq(app.getModelThinkingCapability(future).rejectedLevels,[]);
            await changeConnection('mock-key-2','https://gemini-thinking.invalid/v1/models/');
            await app.ensureGeminiThinkingCapabilities(future);
            releaseOld(json({name:'models/'+future.modelName,thinking:false}));
            await pending;
            assert(app.getModelThinkingCapability(future).thinkingConfirmed);
            await app.setCurrentChatModelRef(noThinking);
            const other = app.ensureGeminiThinkingCapabilities(noThinking);
            await waitFor(()=>releaseOther,'pending metadata for another model');
            await app.setCurrentChatModelRef(future);
            releaseOther(json({name:'models/'+noThinking.modelName,thinking:false}));
            await other;
            eq(app.getModelThinkingCapability().levels,['low','medium','high','xhigh']);
            eq(app.getModelThinkingCapability(noThinking).mode,'none');
            await app.setCurrentChatModelRef(noThinking);
            assert(document.getElementById('settings-thinking-button').hidden);
            before = calls.length;
            reply = () => json(geminiResult([{text:'response without thinking'}],'STOP'));
            await send('Metadata says unsupported');
            eq(calls.length-before,1);
            assert(!calls.at(-1).body.generationConfig.thinkingConfig);
            assert(modelCalls.some(call=>call.url==='https://gemini-thinking.invalid/v1/models/'+future.modelName &&
                call.key==='mock-key-2' && !call.url.includes('?')));
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

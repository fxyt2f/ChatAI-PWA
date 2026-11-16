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
            fail(error) { if (!closed) { closed = true; writer.error(error); } },
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
            channel.frame({...geminiResult([], 'STOP'), usageMetadata: {candidatesTokenCount: 20, totalTokenCount: 52}});
            channel.close();
            await running;
            assert(!body() && el.messageContainer.querySelector('.model .message-content strong')?.textContent === '太字');
            assert(!el.messageContainer.querySelector('[onload]') && !window.streamMarkupExecuted);
            eq(visibleThoughtLabel(), '思考プロセス');
            const model = (await chat()).messages.at(-1);
            eq(model.continuation.parts[1].thoughtSignature, 'text-signature');
            eq(model.usageMetadata.totalTokenCount, 52);
            assert(model.usageMetadata.tmExecution.completedAt);
            eq(el.messageContainer.querySelector('.model [title="Candidate Tokens / Total Tokens"]').textContent, '20 / 52');
            assert(el.messageContainer.querySelector('.model .tm-execution-meta').textContent.includes(gemini.modelName));
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

            await start(gemini, {geminiEnableFunctionCalling: true});
            const tool = sse(), interrupted = sse();
            const usage = {candidatesTokenCount: 3, totalTokenCount: 14};
            const toolStart = calls.length;
            reply = () => calls.length === toolStart + 1 ? tool.response : interrupted.response;
            tool.frame(geminiResult([{text: 'ツール実行前'}, ...parts], 'STOP'));
            tool.close();
            interrupted.frame({...geminiResult([{text: 'ツール実行後'}]), usageMetadata: usage});
            interrupted.frame({error: {code: 503, message: 'ツール実行後のエラー'}});
            await send('ツールの途中で終了');
            const partial = (await chat()).messages.at(-1);
            eq(partial.content, 'ツール実行前\n\nツール実行後');
            eq(partial.usageMetadata.tmLastResponseUsage, usage);
            eq(partial.executedFunctions, ['stream_fixture']);
            assert(partial.incomplete && !partial.continuation);
            assert(!el.messageContainer.querySelector('.model [title="Candidate Tokens / Total Tokens"]'));
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

        await test('interrupted answers keep their footer, original error and plain-text history after reload', async () => {
            const providerError = '  途中エラー\r\n\n<img src=x onerror="window.partialErrorExecuted=true">\n  詳細  ';
            const usage = {candidatesTokenCount: 12, totalTokenCount: 38, thoughtsTokenCount: 3};
            const actualModel = 'gemini-3-flash-fixture-version';
            const expected = {
                stop: { reason: 'manual-stop' },
                timeout: { reason: 'timeout', error: 'APIタイムアウト: 1500ms以内にレスポンスが返りませんでした。' },
                error: { reason: 'error', error: providerError },
                network: { reason: 'network-error', error: 'fixture stream network failure' },
                safety: { reason: 'error', finish: 'SAFETY', error: 'モデルが応答をブロックしました (理由: SAFETY)' },
                cap: { finish: 'MAX_TOKENS' }
            };
            for (const [ending, outcome] of Object.entries(expected)) {
                await start(gemini, {enableAutoRetry: true, maxRetries: 1, enableApiTimeout: ending === 'timeout', apiTimeoutSeconds: 1.5,
                    useFixedRetryDelay: true, fixedRetryDelaySeconds: 0});
                const channel = sse();
                const begin = calls.length;
                const retries = ending === 'error' ? 1 : 0;
                if (retries) {
                    const first = sse();
                    first.frame({usageMetadata: usage, modelVersion: 'model-from-failed-attempt'});
                    first.frame({error: {code: 503, message: '出力前の一時エラー'}});
                    reply = () => calls.length === begin + 1 ? first.response : channel.response;
                } else reply = () => channel.response;
                const before = await existingSuccessful();
                let expire;
                if (ending === 'timeout') window.setTimeout = (fn, ms, ...args) => {
                    if (ms !== 1500) return rawTimeout(fn, ms, ...args);
                    expire = fn;
                    return 0;
                };
                const running = send('失敗テスト ' + ending);
                await waitFor(() => calls.length === begin + 1 + retries, 'failure case request');
                if (ending === 'stop') channel.frame({usageMetadata: usage});
                if (ending === 'network') {
                    channel.frame({usageMetadata: {totalTokenCount: 30}});
                    channel.frame({usageMetadata: {candidatesTokenCount: 15}});
                }
                channel.frame(geminiResult([{text: 'partial-' + ending}]));
                await waitFor(() => body()?.textContent === 'partial-' + ending, 'received partial');
                if (ending === 'stop') app.abortRequest();
                else if (ending === 'timeout') { assert(expire); expire(); }
                else if (ending === 'error') channel.frame({error: {code: 503, message: providerError}});
                else if (ending === 'network') channel.fail(new TypeError(outcome.error));
                else {
                    channel.frame({...geminiResult([], outcome.finish), ...(ending === 'safety' && {usageMetadata: usage, modelVersion: actualModel})});
                    channel.close();
                }
                await running;
                window.setTimeout = rawTimeout;
                eq(calls.length, begin + 1 + retries);
                assert(!channel.body.locked);
                if (['stop', 'timeout', 'error'].includes(ending)) assert(channel.canceled);
                const saved = await chat();
                eq(saved.messages.map(message => message.role), ['user', 'model']);
                const partial = saved.messages.at(-1);
                eq(partial.content, 'partial-' + ending);
                assert(partial.incomplete && !partial.continuation);
                eq(partial.interruptionReason, outcome.reason);
                eq(partial.finishReason, outcome.finish);
                eq(partial.error, outcome.error);
                eq(partial.retryCount, retries);
                const execution = partial.usageMetadata.tmExecution;
                eq(execution.provider, 'gemini');
                eq(execution.modelName, ending === 'safety' ? actualModel : gemini.modelName);
                eq(execution.completedAt, undefined);
                eq(partial.usageMetadata.candidatesTokenCount, ['stop', 'safety'].includes(ending) ? 12 : ending === 'network' ? 15 : undefined);
                for (const reloaded of [false, true]) {
                    if (reloaded) assert((await app.loadChat(saved.id)).ok);
                    assertQuietStop();
                    const answer = el.messageContainer.querySelector('.message.model');
                    eq(answer.querySelector('.message-content').textContent.trim(), partial.content);
                    assert(answer.querySelector('.tm-copy-message-btn') && answer.querySelector('.js-edit-btn') && answer.querySelector('.js-delete-btn'));
                    const executionLabel = answer.querySelector('.tm-execution-meta');
                    assert(executionLabel.textContent.includes(execution.modelName) && executionLabel.title.includes('プロバイダー: Gemini'));
                    const tokens = answer.querySelector('[title="Candidate Tokens / Total Tokens"]');
                    eq(tokens?.textContent, ['stop', 'safety'].includes(ending) ? '12 / 35' : undefined);
                    eq(answer.querySelector('[title^="APIリクエストを"]')?.textContent, retries ? '(リトライ: 1回)' : undefined);
                    const info = answer.querySelector('.tm-message-info-btn');
                    if (outcome.error) {
                        assert(info && info.getAttribute('aria-expanded') === 'false');
                        info.click();
                        const displayed = answer.querySelector('.message-info-error');
                        eq(displayed.textContent, outcome.error);
                        eq(getComputedStyle(displayed).whiteSpace, 'pre-wrap');
                        assert(!displayed.children.length && !window.partialErrorExecuted);
                        info.click();
                    } else {
                        assert(!info);
                    }
                }
                eq((await app._prepareApiHistory(saved.messages)).at(-1), {role: 'model', parts: [{text: partial.content}]});
                eq(await existingSuccessful(), before);
                if (ending === 'error') {
                    const answer = el.messageContainer.querySelector('.message.model');
                    const write = app.writeTextToClipboard;
                    let copied;
                    try {
                        app.writeTextToClipboard = async text => { copied = text; };
                        answer.querySelector('.tm-copy-message-btn').click();
                        eq(copied, partial.content);
                    } finally { app.writeTextToClipboard = write; }
                    await app.startEditMessage(1, answer);
                    await app.saveEditMessage(1, answer, {value: 'edited partial'});
                    const edited = (await chat()).messages.at(-1);
                    eq([edited.content, edited.error, edited.incomplete], ['edited partial', providerError, true]);
                    const confirm = ui.showCustomConfirm;
                    try {
                        ui.showCustomConfirm = async () => true;
                        await app.deleteMessage(1);
                        eq((await chat()).messages.map(message => message.role), ['user']);
                    } finally { ui.showCustomConfirm = confirm; }
                }
            }
            assert(app.parseImportedHistory('<|#|model|#|incomplete>途中<|#|/model|#|>').messages[0].incomplete);
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
        });

        await test('failures before answer text persist as empty AI messages and never reach the next request', async () => {
            const sourceError = '  Service Unavailable\r\n\n<img src=x onerror="window.partialErrorExecuted=true">\n  詳細  ';
            const cases = [
                {kind: 'http', error: `APIエラー (503): ${sourceError}`, retries: 1},
                {kind: 'network', error: 'fixture network failure', retries: 0},
                {kind: 'moderation', error: 'モデルが応答をブロックしました (理由: SAFETY)', retries: 0, finishReason: 'SAFETY'},
                {kind: 'timeout', error: 'APIタイムアウト: 1500ms以内にレスポンスが返りませんでした。', retries: 0}
            ];
            const prompt = '回答のないリクエスト';
            for (const {kind, error, retries, finishReason} of cases) {
                await start(gemini, {enableAutoRetry: retries > 0, maxRetries: retries, useFixedRetryDelay: true,
                    fixedRetryDelaySeconds: 0, enableApiTimeout: kind === 'timeout', apiTimeoutSeconds: 1.5});
                const begin = calls.length;
                const previousSuccess = await existingSuccessful();
                let expire;
                if (kind === 'http') reply = () => new Response(JSON.stringify({error: {message: sourceError}}),
                    {status: 503, headers: {'Content-Type': 'application/json'}});
                if (kind === 'network') reply = () => { throw new TypeError(error); };
                if (kind === 'moderation') reply = () => json({...geminiResult([], finishReason),
                    usageMetadata: {candidatesTokenCount: 0, totalTokenCount: 14}, modelVersion: 'gemini-moderation-fixture'});
                if (kind === 'timeout') {
                    const channel = sse();
                    reply = () => channel.response;
                    window.setTimeout = (fn, ms, ...args) => {
                        if (ms !== 1500) return rawTimeout(fn, ms, ...args);
                        expire = fn;
                        return 0;
                    };
                }
                try {
                    const running = send(prompt);
                    if (kind === 'timeout') {
                        await waitFor(() => expire && calls.length === begin + 1, 'timeout before any answer');
                        expire();
                    }
                    await running;
                } finally { window.setTimeout = rawTimeout; }
                eq(calls.length, begin + 1 + retries);
                eq(await existingSuccessful(), previousSuccess);

                const saved = await chat();
                eq(saved.messages.map(message => message.role), ['user', 'model']);
                const failure = saved.messages.at(-1);
                eq([failure.content, failure.error, failure.incomplete, failure.finishReason, failure.retryCount],
                    ['', error, true, finishReason, retries]);
                eq(failure.interruptionReason, kind === 'timeout' ? 'timeout' : 'error');
                assert(!failure.continuation && !failure.tool_calls);
                const expectedModel = kind === 'moderation' ? 'gemini-moderation-fixture' : gemini.modelName;
                eq(failure.usageMetadata.tmExecution.modelName, expectedModel);
                eq(failure.usageMetadata.tmExecution.completedAt, undefined);
                for (const reloaded of [false, true]) {
                    if (reloaded) assert((await app.loadChat(saved.id)).ok);
                    assertQuietStop();
                    const answer = el.messageContainer.querySelector('.message.model');
                    const content = answer.querySelector('.message-content');
                    eq(content.textContent, '');
                    eq(getComputedStyle(content).display, 'none');
                    assert(!answer.querySelector('.tm-copy-message-btn, .js-edit-btn, .tm-format-message-btn'));
                    assert(answer.querySelector('.tm-search-message-btn').disabled);
                    const execution = answer.querySelector('.tm-execution-meta');
                    assert(execution.textContent.includes(expectedModel) && execution.title.includes('プロバイダー: Gemini'));
                    eq(answer.querySelector('[title="Candidate Tokens / Total Tokens"]')?.textContent,
                        kind === 'moderation' ? '0 / 14' : undefined);
                    eq(answer.querySelector('[title^="APIリクエストを"]')?.textContent, retries ? '(リトライ: 1回)' : undefined);
                    const info = answer.querySelector('.tm-message-info-btn');
                    assert(info.getAttribute('aria-expanded') === 'false');
                    info.click();
                    const displayed = answer.querySelector('.message-info-error');
                    eq(displayed.textContent, error);
                    assert(!displayed.children.length && !window.partialErrorExecuted);
                    eq(getComputedStyle(displayed).whiteSpace, 'pre-wrap');
                    info.click();
                }
                eq(await app._prepareApiHistory(saved.messages), [{role: 'user', parts: [{text: prompt}]}]);
                if (kind === 'http') {
                    reply = () => json(geminiResult([{text: '再開しました'}], 'STOP'));
                    await send('続けてください');
                    eq(calls.at(-1).body.contents, [{role: 'user', parts: [{text: prompt}]},
                        {role: 'user', parts: [{text: '続けてください'}]}]);
                    eq((await chat()).messages.at(-1).content, '再開しました');
                }
            }
            await start(gemini);
            reply = () => json(geminiResult([{text: ' '}], 'STOP'));
            await send('正常終了の空白応答');
            const blankSuccess = (await chat()).messages.at(-1);
            eq([blankSuccess.content, blankSuccess.error, blankSuccess.incomplete], [' ', undefined, undefined]);
            assert(!el.messageContainer.querySelector('.message.model .message-info-error'));
        });

        await test('an initial chat save failure keeps the existing storage error path', async () => {
            await start(gemini);
            const begin = calls.length;
            const save = db.saveChat;
            db.saveChat = async function (...args) {
                db.saveChat = save;
                throw new Error('fixture initial save failure');
            };
            try { await send('保存に失敗する送信'); }
            finally { db.saveChat = save; }
            eq(calls.length, begin);
            const saved = await chat();
            eq(saved.messages.map(message => [message.role, message.content]),
                [['user', '保存に失敗する送信'], ['error', 'fixture initial save failure']]);
            assert((await app.loadChat(saved.id)).ok);
            assert(el.messageContainer.querySelector('.message.error').textContent.includes('fixture initial save failure'));
        });

        await test('continued chats send interrupted text without tool state via all four normal adapters', async () => {
            const partialText = '途中で止まった本文';
            const marker = 'DO-NOT-SEND';
            const toolCall = { functionCall: {name: marker, _toolCallId: marker, args: {}}, thoughtSignature: marker };
            const continuation = { parts: [toolCall], turns: [{role: 'model', parts: [toolCall]}],
                openai: {reasoning_content: marker}, bedrock: [{reasoningContent: {reasoningText: {text: marker, signature: marker}}}] };
            const bedrock = {apiConfigId: 'aws', modelName: 'us.anthropic.claude-opus-4-6-v1'};
            const zai = {apiConfigId: 'zai', modelName: 'glm-4.6'};
            const client = window.BedrockRuntimeClient;
            try {
                for (const [provider, ref] of Object.entries({gemini, openrouter: router, zai, bedrock})) {
                    await start(ref);
                    const history = [
                        {role: 'user', content: '最初の質問'},
                        {role: 'model', content: '', tool_calls: [toolCall], continuation: {parts: [toolCall]}},
                        {role: 'tool', name: marker, response: {bad: marker}, incomplete: true},
                        {role: 'model', content: partialText, incomplete: true, thoughtSummary: marker, error: marker,
                            continuation: {...continuation, provider, apiConfigId: ref.apiConfigId, modelName: ref.modelName}, tool_calls: [toolCall]},
                        {role: 'tool', name: marker, response: {bad: marker}},
                        {role: 'model', isCascaded: true, isSelected: false, content: marker}
                    ];
                    st.currentMessages.push(...history);
                    let request;
                    reply = call => {
                        request = call.body;
                        if (provider === 'gemini') return json(geminiResult([{text: '続き'}], 'STOP'));
                        return json({choices: [{message: {content: '続き'}, finish_reason: 'stop'}]});
                    };
                    window.BedrockRuntimeClient = class {
                        async send(command) {
                            request = command.body;
                            return {output: {message: {content: [{text: '続き'}]}}, stopReason: 'end_turn'};
                        }
                    };
                    await send('続けてください');
                    eq((await chat()).messages.at(-1).content, '続き');
                    const messages = (provider === 'gemini' ? request.contents : request.messages).filter(message => message.role !== 'system');
                    eq(messages.map(message => message.role), ['user', provider === 'gemini' ? 'model' : 'assistant', 'user']);
                    if (provider === 'gemini') eq(messages[1], {role: 'model', parts: [{text: partialText}]});
                    else if (provider === 'bedrock') eq(messages[1], {role: 'assistant', content: [{text: partialText}]});
                    else assert(JSON.stringify(messages[1].content).includes(partialText));
                    assert(!JSON.stringify(request).includes(marker));
                }
            } finally { window.BedrockRuntimeClient = client; }
        });

        await test('provider moderation with JSON text and a final OpenRouter error delta keep only the received answer', async () => {
            await start(gemini);
            reply = () => json({...geminiResult([{text: '表示された部分'}, {text: '思考だけ', thought: true}], 'SAFETY'),
                usageMetadata: {candidatesTokenCount: 2, totalTokenCount: 10}});
            await send('JSONの終了');
            let partial = (await chat()).messages.at(-1);
            eq([partial.content, partial.error, partial.finishReason], ['表示された部分', 'モデルが応答をブロックしました (理由: SAFETY)', 'SAFETY']);
            eq(partial.usageMetadata.totalTokenCount, 10);
            assert(partial.incomplete && !partial.continuation);

            await start(router);
            const channel = sse();
            reply = () => channel.response;
            channel.frame({choices: [], model: 'google/gemini-fixture-version', usage: {completion_tokens: 6, total_tokens: 27}});
            channel.frame(routerResult({content: '最終イベントの本文'}, 'error'));
            await send('SSEの終了');
            partial = (await chat()).messages.at(-1);
            eq([partial.content, partial.error, partial.finishReason], ['最終イベントの本文', 'OpenRouterストリームの途中でエラーが発生しました。', 'error']);
            eq(partial.usageMetadata.tmExecution.modelName, 'google/gemini-fixture-version');
            eq(el.messageContainer.querySelector('.model [title="Candidate Tokens / Total Tokens"]').textContent, '6 / 27');
            assert(partial.incomplete && !partial.continuation);

            await start({apiConfigId: 'aws', modelName: 'us.anthropic.claude-opus-4-6-v1'});
            const client = window.BedrockRuntimeClient;
            try {
                window.BedrockRuntimeClient = class {
                    async send() {
                        return {output: {message: {content: [{text: '返された本文'}]}}, stopReason: 'content_filtered',
                            usage: {inputTokens: 11, outputTokens: 3}};
                    }
                };
                await send('Bedrockの終了');
                partial = (await chat()).messages.at(-1);
                eq([partial.content, partial.usageMetadata.tmExecution.provider, partial.usageMetadata.candidatesTokenCount],
                    ['返された本文', 'bedrock', 3]);
                eq(partial.usageMetadata.totalTokenCount, undefined);
                assert(!el.messageContainer.querySelector('.model [title="Candidate Tokens / Total Tokens"]'));
            } finally { window.BedrockRuntimeClient = client; }
        });

        await test('a failed interrupted-response save leaves the received text in its source chat', async () => {
            await start(gemini);
            const otherChat = (await db.getAllChats()).find(chat => chat.id != null);
            const channel = sse();
            reply = () => channel.response;
            const save = db.saveChat;
            try {
                db.saveChat = async function (...args) {
                    const session = args[2]?.sendSession;
                    if (session?.messages.at(-1)?.incomplete) throw new Error('fixture write failed');
                    return save.apply(this, args);
                };
                const running = send('保存失敗テスト').catch(error => error);
                await waitFor(() => channel.body.locked && body(), 'source response');
                const sourceId = st.currentChatId;
                const sourceMessages = st.currentMessages;
                const oldOther = (await db.getChat(otherChat.id)).messages;
                assert((await app.loadChat(otherChat.id)).ok);
                channel.frame(geminiResult([{text: '保存失敗時も保持'}]));
                channel.frame({error: {code: 503, message: '生成エラー原文'}});
                eq((await running).message, 'fixture write failed');
                eq(st.currentChatId, otherChat.id);
                eq((await db.getChat(otherChat.id)).messages, oldOther);
                eq((await db.getChat(sourceId)).messages.map(message => message.role), ['user']);
                const partial = sourceMessages.at(-1);
                eq([partial.role, partial.content, partial.error, partial.incomplete], ['model', '保存失敗時も保持', '生成エラー原文', true]);
                assert(!el.messageContainer.textContent.includes(partial.content));
            } finally { db.saveChat = save; }
        });

        await test('regeneration replaces empty failures and preserves answers, selection and later turns', async () => {
            const prompt = {role: 'user', content: '再生成対象'};
            const later = [{role: 'user', content: '後続の質問'}, {role: 'model', content: '後続の回答'}];
            const oldError = {role: 'model', content: '', incomplete: true, error: '古いエラー',
                usageMetadata: {tmExecution: {modelName: 'old-fixture-model'}}};
            const oldAnswer = {role: 'model', content: '前回の途中本文', incomplete: true, error: '前回の終了理由'};
            const seed = async answers => {
                await start(gemini);
                st.currentMessages.push(prompt, ...structuredClone(answers), ...later);
                await db.saveChat();
            };
            const regenerate = async (kind, label, beforeReply) => {
                const sourceId = st.currentChatId;
                const channel = sse();
                reply = () => channel.response;
                const pending = app.retryFromMessage(0);
                await waitFor(() => channel.body.locked, 'regeneration reader');
                if (beforeReply) await beforeReply();
                if (kind === 'cancel' || kind === 'cancel-thought') {
                    if (kind === 'cancel-thought') {
                        channel.frame(geminiResult([{text: '思考だけの停止', thought: true}]));
                        await waitFor(() => st.sendExecutionV136?.getStreamThought?.() === '思考だけの停止', 'thought-only regeneration');
                    }
                    app.abortRequest();
                }
                else if (kind === 'error') channel.frame({error: {message: label}});
                else if (kind === 'partial-error') {
                    channel.frame(geminiResult([{text: label}]));
                    channel.frame(geminiResult([], 'SAFETY'));
                    channel.close();
                }
                else {
                    channel.frame(geminiResult([{text: label}], kind === 'partial' ? 'MAX_TOKENS' : 'STOP'));
                    channel.close();
                }
                await pending;
                assertQuietStop();
                return db.getChat(sourceId);
            };
            const answersIn = saved => {
                const end = saved.messages.findIndex((message, i) => i > 0 && message.role === 'user');
                return saved.messages.slice(1, end === -1 ? undefined : end);
            };
            const assertLaterTurns = saved => eq(saved.messages.slice(-2).map(message => message.content), later.map(message => message.content));
            const assertCascade = async saved => {
                const answers = answersIn(saved);
                assert(answers.length > 1 && answers.every(message => message.isCascaded && message.siblingGroupId === answers[0].siblingGroupId));
                eq(answers.map(message => message.isSelected), [...answers.slice(1).map(() => false), true]);
                assert((await app.loadChat(saved.id)).ok);
                const selectedIndex = st.currentMessages.indexOf(app.getVisibleMessages().find(message => message.isSelected));
                eq(st.currentMessages[selectedIndex].content, answers.at(-1).content);
                assert(!el.messageContainer.querySelector('.cascade-prev-btn').disabled);
                await app.navigateCascade(selectedIndex, 'prev');
                eq((await chat()).messages.find(message => message.isSelected)?.content, answers.at(-2).content);
            };

            await seed([oldError]);
            for (const error of ['新しいエラー\n詳細', '別のエラー', '最後のエラー']) {
                const saved = await regenerate('error', error);
                const answers = answersIn(saved);
                eq(answers.map(message => message.error), [error]);
                assertLaterTurns(saved);
                assert(!answers[0].isCascaded);
                eq(answers[0].usageMetadata.tmExecution.modelName, gemini.modelName);
                assert((await app.loadChat(saved.id)).ok);
                const answer = el.messageContainer.querySelector('.message.model');
                answer.querySelector('.tm-message-info-btn').click();
                eq(answer.querySelector('.message-info-error').textContent, error);
            }

            await seed([oldError]);
            let saved = await regenerate('normal', '回復した本文');
            eq(saved.messages.map(message => message.content), [prompt.content, '回復した本文']);
            assert(!saved.messages[1].incomplete && saved.messages[1].usageMetadata.tmExecution.completedAt);

            await seed([oldError]);
            saved = await regenerate('partial-error', 'エラー前の新しい本文');
            assertLaterTurns(saved);
            const partial = answersIn(saved)[0];
            eq([partial.content, partial.incomplete, partial.finishReason, partial.error],
                ['エラー前の新しい本文', true, 'SAFETY', 'モデルが応答をブロックしました (理由: SAFETY)']);
            eq(answersIn(saved).length, 1);
            eq((await app._prepareApiHistory(saved.messages))[1], {role: 'model', parts: [{text: partial.content}]});

            await seed([oldAnswer]);
            saved = await regenerate('normal', '新しい正常本文');
            eq(saved.messages.map(message => message.content), [prompt.content, oldAnswer.content, '新しい正常本文']);
            eq(answersIn(saved)[0].error, oldAnswer.error);
            await assertCascade(saved);

            await seed([oldAnswer]);
            saved = await regenerate('partial', '出力上限までの本文');
            assertLaterTurns(saved);
            eq(answersIn(saved).map(message => message.content), [oldAnswer.content, '出力上限までの本文']);
            eq(answersIn(saved)[1].finishReason, 'MAX_TOKENS');
            eq((await app._prepareApiHistory(saved.messages))[1], {role: 'model', parts: [{text: '出力上限までの本文'}]});
            await assertCascade(saved);

            for (const error of ['候補の失敗1', '候補の失敗2']) {
                saved = await regenerate('error', error);
                assertLaterTurns(saved);
                eq(answersIn(saved).map(message => [message.content, message.error]),
                    [[oldAnswer.content, oldAnswer.error], ['出力上限までの本文', undefined], ['', error]]);
                eq((await app._prepareApiHistory(saved.messages)).map(message => message.role), ['user', 'user', 'model']);
                await assertCascade(saved);
            }

            const beforeCancel = (await chat()).messages;
            eq((await regenerate('cancel')).messages, beforeCancel);
            eq((await regenerate('cancel-thought')).messages, beforeCancel);
            const save = db.saveChat;
            db.saveChat = async function (...args) {
                if (args[2]?.sendSession) throw new Error('regeneration fixture save failure');
                return save.apply(this, args);
            };
            try {
                for (const kind of ['normal', 'error']) {
                    const error = await regenerate(kind, '保存されない応答').catch(reason => reason);
                    eq(error.message, 'regeneration fixture save failure');
                    eq((await chat()).messages, beforeCancel);
                    eq(st.currentMessages, beforeCancel);
                    assertQuietStop();
                }
            } finally { db.saveChat = save; }

            const otherChat = await chat();
            await seed([oldError]);
            const sourceId = st.currentChatId;
            saved = await regenerate('error', '切り替え中の新しいエラー', async () => {
                assert((await app.loadChat(otherChat.id)).ok);
            });
            eq(st.currentChatId, otherChat.id);
            eq((await chat()).messages, otherChat.messages);
            eq(answersIn(saved).map(message => message.error), ['切り替え中の新しいエラー']);
            assertLaterTurns(saved);
            assert((await app.loadChat(sourceId)).ok);
            assert(el.messageContainer.querySelector('.message-info-error').textContent.includes('切り替え中の新しいエラー'));

            const toolCall = {functionCall: {name: 'legacy_fixture', id: 'tool-id', args: {}}, thoughtSignature: 'legacy-signature'};
            await seed([{role: 'model', content: '', tool_calls: [toolCall]},
                {role: 'tool', name: 'legacy_fixture', response: {record: 'legacy-result'}}, {role: 'model', content: '以前のツール利用回答'}]);
            saved = await regenerate('normal', '新しい回答');
            assert(saved.messages.some(message => message.role === 'tool' && message.response.record === 'legacy-result'));
            const history = await app._prepareApiHistory(saved.messages);
            eq(history.map(message => message.role), ['user', 'model']);
            eq(history.at(-1).parts, [{text: '新しい回答'}]);
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
            const history = await app._prepareApiHistory(messages);
            assert(!JSON.stringify(history).includes(original.content) && JSON.stringify(history).includes('再生成の部分'));
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
            assert(st.currentMessages.some(message=>message.role==='model' && message.content==='' &&
                message.error?.includes('Thinking レベル「XHIGH」を拒否')));
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

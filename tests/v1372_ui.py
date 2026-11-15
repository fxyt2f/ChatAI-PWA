"""Focused v1.37.2 layout and provider wire checks on the actual startup page."""
import json
import time


def run(client, base_url):
    def ev(expression):
        result = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'].get('exception', result['exceptionDetails']))
        return result.get('result', {}).get('value')

    def wait(expression, label):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if ev(f'Promise.resolve({expression}).then(Boolean)'):
                return
            time.sleep(.05)
        raise AssertionError(label)

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def viewport(width):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': 850, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })
        wait(f'innerWidth === {width}', f'{width}px viewport')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?v1372-fixture') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
        }
    """})['identifier']
    try:
        viewport(1280)
        client.call('Page.navigate', {'url': base_url + '?v1372-fixture'})
        wait("window.appLogic?._setupEventListenersCallCount && window.informationUi && state.activeProfileId && !document.querySelector('#progressDialog[open]')",
             'App startup')
        if ev("Boolean(document.querySelector('#releaseNotesDialog[open]'))"):
            click('#releaseNotesDialog .dialog-ok-btn')
        ev("""(async () => {
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', APP_VERSION);
            await appLogic.updateLocalUiSetting('enableWideMode', true);
            appLogic.applyWideMode();
            window.v1372Labels = selector => [...document.querySelectorAll(selector + ' .sidebar-nav-label')]
                .map(node => node.getBoundingClientRect().left);
        })()""")
        for width in (1280, 900, 390):
            viewport(width)
            mode = 'permanent' if width >= 1200 else 'overlay'
            wait(f"chatSidebarUiState.mode === '{mode}'", f'{width}px sidebar mode')
            ev("uiUtilsV136.openChatSidebar()")
            wait("""chatSidebarUiState.isOpen && !elements.chatHistorySidebar.inert &&
                Math.abs(elements.chatHistorySidebar.getBoundingClientRect().left - elements.appContainer.getBoundingClientRect().left) < .5""",
                 f'Sidebar is in position at {width}px')
            origin = ev("v1372Labels('.chat-sidebar-navigation')")
            assert len(origin) == 3 and max(origin) - min(origin) < .5 and origin[0] >= 0, origin
            sidebar_width = ev("elements.chatHistorySidebar.getBoundingClientRect().width")
            assert abs(sidebar_width - 288) < .5, (width, sidebar_width, ev("elements.chatScreen.className"))
            for name, category in [('settings', 'general'), ('information', 'character')]:
                click('#goto-settings-btn' if name == 'settings' else '#information-open-btn')
                wait(f"state.currentScreen === '{name}'", name)
                labels = ev(f"v1372Labels('#{name}-category-nav')")
                assert labels and max(abs(value - origin[0]) for value in labels) < 1, (width, name, origin, labels)
                if width >= 800:
                    assert ev(f"document.querySelector('#{name}-screen .settings-sidebar').offsetWidth") == 288
                else:
                    click(f'[data-{name}-category="{category}"]')
                assert ev(f"""(() => {{
                    const menu = document.querySelector('#{name}-menu-btn');
                    return menu.firstElementChild.textContent === '{'menu' if width >= 800 else 'chevron_left'}' &&
                        (innerWidth >= 800 || menu.getAttribute('aria-label').endsWith('一覧へ戻る'));
                }})()""")
                if width < 800:
                    click(f'#{name}-menu-btn')
                    wait(f"location.hash === '#{name}'", 'Back to category list')
                click(f'#back-to-chat-from-{name}')
                wait("state.currentScreen === 'chat'", 'Back to chat')
            ev("uiUtilsV136.closeChatSidebar()")
        assert ev("""(() => {
            const gear = document.querySelector('[data-settings-category=general] .material-symbols-outlined');
            const chatGear = document.querySelector('#goto-settings-btn .material-symbols-outlined');
            return gear.textContent === chatGear.textContent && [gear, chatGear].every(icon =>
                getComputedStyle(icon).overflow === 'hidden' && getComputedStyle(icon).width === '20px'
            );
        })()"""), 'The shared gear stays within its slot when the icon font is unavailable'
        assert ev("""getComputedStyle(document.querySelector('.chat-search-toolbar-bottom')).gap === '8px' &&
            getComputedStyle(document.querySelector('.floating-action-panel')).gap === '8px'""")

        ev("""(async () => {
            await appLogic.setShowThoughtProcess(true);
            const messages = [{role:'user', content:'ユーザー本文', timestamp:10}, {
                role:'model', content:'モデル本文', thoughtSummary:'理由', thoughtTranslationMeta:{provider:'gemini', model:'実験モデル'}, timestamp:20
            }];
            await dbUtils.saveChat(null, {id: 813421, messages, createdAt:10, systemPrompt:'個別の指示'});
            await appLogic.loadChat(813421, {scrollAfterLoad:false});
        })()""")
        wait("state.currentChatId === 813421 && document.querySelector('.thought-summary-details > summary')", 'Message fixture loads')
        assert ev("document.querySelector('.thought-summary-details > summary').textContent.includes('翻訳:') && !document.querySelector('.thought-summary-details > summary').textContent.includes('思考翻訳:')")
        assert ev("""(async () => {
            const root = document.documentElement;
            const canvas = document.createElement('canvas').getContext('2d');
            const alpha = color => {
                canvas.clearRect(0,0,1,1); canvas.fillStyle = color; canvas.fillRect(0,0,1,1);
                return canvas.getImageData(0,0,1,1).data[3];
            };
            const bubble = document.querySelector('.message.user');
            const values = [];
            root.style.setProperty('--message-bubble-opacity', '.35');
            root.style.setProperty('--overlay-opacity-value', '.4');
            root.style.setProperty('--chat-background-image', 'linear-gradient(red, blue)');
            for (const show of [false,true,false]) {
                uiUtilsV136.setBackgroundImageVisible(show);
                const overlay = document.querySelector('#chat-overlay');
                getComputedStyle(overlay).opacity;
                await Promise.allSettled(overlay.getAnimations().map(animation => animation.finished));
                values.push([Number(getComputedStyle(overlay).opacity), alpha(getComputedStyle(bubble,'::before').backgroundColor),
                    alpha(getComputedStyle(elements.chatHistorySidebar).backgroundColor)]);
            }
            root.style.removeProperty('--chat-background-image');
            return values[0].join() === '0,255,255' && values[1][0] === .4 && Math.abs(values[1][1]-89) < 2
                && values[1][2] === 255 && values[2].join() === values[0].join() &&
                root.style.getPropertyValue('--message-bubble-opacity') === '.35';
        })()"""), 'Background gates opacity settings while keeping the sidebar opaque'
        viewport(1280)
        assert ev("""(async () => {
            const geometry = [];
            for (let index=0; index<2; index++) {
                const message = document.querySelector('.message[data-index="' + index + '"]');
                await appLogic.startEditMessage(index, message);
                const editor = message.querySelector('.message-edit-area');
                const input = editor.querySelector('textarea').getBoundingClientRect();
                const [cancel, save] = [...editor.querySelectorAll('button')];
                const a = cancel.getBoundingClientRect(), b = save.getBoundingClientRect();
                if (editor.querySelectorAll('button').length !== 2 || a.top < input.bottom || a.right >= b.left
                    || Math.abs(b.right - input.right) > 1) return false;
                geometry.push([input.left, input.width, input.height, a.width, b.width]);
                appLogic.cancelEditMessage(index, message);
            }
            return geometry[0].every((value,index) => Math.abs(value-geometry[1][index]) < 1) &&
                document.querySelectorAll('.tm-copy-message-btn').length >= 2;
        })()"""), 'Desktop editors align and the ordinary copy action remains'
        viewport(390)
        ev("appLogic.startEditMessage(1, document.querySelector('.message[data-index=\"1\"]'))")
        assert ev("""(() => {
            const editor = document.querySelector('#mobile-message-editor');
            const textarea = editor.querySelector('textarea');
            textarea.value = '日本語編集中\\n'.repeat(120);
            textarea.setSelectionRange(7,7);
            textarea.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
            Object.defineProperty(window.visualViewport, 'height', {configurable:true, value:400});
            appLogic.updateMobileMessageEditorViewport();
            delete window.visualViewport.height;
            const buttons = [...editor.querySelectorAll('button')];
            const save = buttons[1].getBoundingClientRect();
            const input = textarea.getBoundingClientRect();
            return buttons.map(button => button.textContent).join() === 'キャンセル,保存' &&
                input.bottom <= save.top && save.bottom <= editor.getBoundingClientRect().top + 400 &&
                editor.getBoundingClientRect().height === 400 && textarea.scrollHeight > textarea.clientHeight &&
                textarea.selectionStart === 7;
        })()"""), 'Mobile editor footer stays above the simulated keyboard'
        ev("""document.querySelector('#mobile-message-editor textarea').value='保存する日本語\\n二行目';
            document.querySelector('#mobile-message-editor .save-edit-btn').click();""")
        wait("dbUtils.getChat(813421).then(chat => chat.messages[1].content === '保存する日本語\\n二行目')", 'Mobile save reaches IndexedDB')

        assert ev("""(async () => {
            const original = '  共通原文\\n第二行  ', changed = '次回の共通指示', prompt = '  個別原文\\n個別行  ';
            const project = await dbUtils.createProject({name:'共通指示のテスト'});
            await dbUtils.updateProject(project.id, {systemInstruction:original});
            const read = async () => (await DocumentSearch.readChatSnapshot(DocumentSearch.captureSendChat({
                chatId: state.currentChatId, messages: state.currentMessages
            }))).projectInstruction;
            if (await read() !== '') return false;
            await dbUtils.setChatProject(813421, project.id);
            const captured = await read();
            await dbUtils.updateProject(project.id, {systemInstruction:changed});
            if (captured !== original || await read() !== changed) return false;
            await dbUtils.setChatProject(813421, null);
            if (await read() !== '') return false;
            await dbUtils.setChatProject(813421, project.id);
            let instruction;
            const rag = window.DocumentRag;
            try {
                window.DocumentRag = null;
                instruction = await appLogic.buildSendSystemInstruction({
                    systemPrompt:prompt, projectInstruction:captured, settings:{}, persistentMemory:{}
                }, '');
            } finally { window.DocumentRag = rag; }
            const [common, personal] = instruction.parts.map(part => part.text);
            if (!common.endsWith(original) || !personal.endsWith(prompt)) return false;
            let body;
            const previousFetch = window.fetch, previousClient = window.BedrockRuntimeClient, previousCommand = window.ConverseCommand;
            try {
                window.fetch = async (url, options) => {
                    body = JSON.parse(options.body);
                    return Response.json(body.contents ? {candidates:[{content:{parts:[{text:'応答'}]},finishReason:'STOP'}]} :
                        {choices:[{message:{content:'応答'},finish_reason:'stop'}]});
                };
                window.BedrockRuntimeClient = class { async send(command) {
                    body = command.body;
                    return {output:{message:{content:[{text:'応答'}]}},stopReason:'end_turn'};
                }};
                window.ConverseCommand = class { constructor(body) { this.body = body; } };
                for (const [provider, modelName] of [['gemini','gemini-2.5-flash'],['openrouter','test/model'],['zai','glm-4.6'],['bedrock','us.anthropic.claude-sonnet-4-20250514-v1:0']]) {
                    const session = {
                        apiConfig:{provider, modelName, apiKey:'fixture',bedrockAccessKey:'fixture',bedrockSecretKey:'fixture'},
                        settings:{...state.settings, geminiEnableFunctionCalling:false,geminiEnableGrounding:false}
                    };
                    await apiUtils.callApi([{role:'user',parts:[{text:'質問'}]}], {}, instruction, null, false, new AbortController().signal, null, session);
                    const system = provider === 'gemini' ? body.systemInstruction.parts.map(part=>part.text) :
                        provider === 'bedrock' ? body.system.map(part=>part.text) : [body.messages[0].content];
                    if (system.join('\\n\\n') !== [common,personal].join('\\n\\n')) throw new Error(provider + ' system block mismatch');
                    if (system.length !== (['gemini','bedrock'].includes(provider) ? 2 : 1)) return false;
                }
            } finally {
                window.fetch = previousFetch; window.BedrockRuntimeClient = previousClient; window.ConverseCommand = previousCommand;
            }
            await dbUtils.deleteProject(project.id);
            return await read() === '' && Boolean(await dbUtils.getChat(813421)) &&
                (await dbUtils.getChat(813421)).systemPrompt === '個別の指示';
        })()"""), 'Project membership, snapshots and Gemini/OpenRouter/Z.ai/Bedrock payloads'
        return 'ALL PASSED (v1.37.2: three sidebar alignments and responsive back controls, theme opacity, message editors and four project instruction wire formats)'
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        viewport(1280)

"""Exercise API configuration and both model picker layouts on the real startup page."""
import json
import time


def run(client, url):
    socket_timeout = client.sock.gettimeout()
    client.sock.settimeout(25)

    def ev(expression):
        result = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def wait(expression, label):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if ev(f'Promise.resolve({expression}).then(Boolean)'):
                return
            time.sleep(0.05)
        info = ev("""[location.hash, document.querySelector('#api-config-save-status')?.textContent,
            Array.from(document.querySelectorAll('dialog[open]'), d => [d.id, d.textContent.trim().slice(0, 120)])]""")
        raise AssertionError(f'{label}: {info}')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def input_value(field, value, event='input'):
        ev(f"""(() => {{
            const control = document.getElementById({json.dumps(field)});
            control[control.type === 'checkbox' ? 'checked' : 'value'] = {json.dumps(value)};
            control.dispatchEvent(new Event({json.dumps(event)}, {{bubbles: true}}));
        }})()""")

    def edit(field, value, event='input'):
        input_value('api-config-' + field, value, event)

    def stored(condition):
        return f"(async () => {{const configs = (await dbUtils.getSetting('apiConfigs')).value; return ({condition});}})()"

    def open_general():
        ev("uiUtilsV136.showScreen('settings')")
        ev("settingsUiV136.selectCategory('general')")
        wait("""location.hash === '#settings/general' && !document.getElementById('settings-screen').getAnimations()
            .some(animation => animation.transitionProperty === 'transform' && animation.playState === 'running')""",
             'General settings are visible')

    def open_editor(config_id=None):
        click('#add-api-config-btn' if config_id is None else
              f'[data-action="edit-api-config"][data-api-config-id="{config_id}"]')
        wait("document.getElementById('api-config-dialog').matches(':modal')", 'API editor opens')

    def close_editor():
        click('#close-api-config-btn')
        wait("!document.getElementById('api-config-dialog').open", 'Editor closes after flushing')

    def status(message):
        wait(f"document.getElementById('api-config-save-status').textContent === {json.dumps(message)}",
             'Autosave status: ' + message)

    def metrics(width, height=820):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': width < 800})
        wait(f"innerWidth === {width} && settingsUiV136.media.matches === {str(width >= 800).lower()}",
             f'Viewport is {width}px')

    def key(name, number):
        for action in ('keyDown', 'keyUp'):
            client.call('Input.dispatchKeyEvent', {
                'type': action, 'key': name, 'code': name, 'windowsVirtualKeyCode': number,
            })

    def boot(reload=False):
        previous = ev('performance.timeOrigin')
        client.call('Page.reload' if reload else 'Page.navigate',
                    {} if reload else {'url': url + '?apiSettingsFixture=1'})
        wait(f"""performance.timeOrigin > {previous} && window.appLogic?._setupEventListenersCallCount &&
            !state.executionInitializingV136 && !document.querySelector('#progressDialog[open]')""", 'App startup completed')
        ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        if ev("Boolean(document.querySelector('#releaseNotesDialog[open]'))"):
            click('#releaseNotesDialog .dialog-ok-btn')
            wait("!document.querySelector('#releaseNotesDialog[open]')", 'Release notes closed')

    def assert_empty():
        assert ev(stored('Array.isArray(configs) && configs.length === 0'))
        assert ev("""!state.apiConfigs.length && !appLogic.getApiModelChoices().length &&
            appLogic.getCurrentChatModelRef() === null && state.settings.defaultModelRef === null &&
            state.settings.modelName === '' && state.settings.apiConfigId === '' && state.settings.apiProvider === '' &&
            appLogic.getExecutionProvider() === '' && appLogic.getExecutionModelName() === '' &&
            document.getElementById('model-name').options.length === 1 &&
            document.getElementById('model-name').selectedOptions[0].textContent === '選択してください' &&
            Object.values(SettingsV136.auxiliaryModelSelectIds).every(id => document.getElementById(id).options.length === 1) &&
            document.getElementById('openrouter-model-suggestions').options.length === 0""")

    def compare_arrow_hover():
        def styles_on_hover(selector):
            target = f'document.querySelector({json.dumps(selector)})'
            point = ev(f"""(() => {{
                const el = {target};
                el.scrollIntoView({{block:'center'}});
                const r = el.getBoundingClientRect();
                return {{x: r.left + r.width / 2, y: r.top + r.height / 2}};
            }})()""")
            client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **point})
            wait(f"""{target}.matches(':hover') &&
                getComputedStyle({target}, '::before').backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                !{target}.getAnimations({{subtree:true}}).some(animation => animation.playState === 'running')""",
                 'Arrow button hover completes for ' + selector)
            styles = ev(f"""(() => {{
                const style = getComputedStyle({target});
                const circle = getComputedStyle({target}, '::before');
                return [style.backgroundColor, style.borderWidth, style.boxShadow, style.color, style.transform,
                    circle.backgroundColor, circle.borderRadius];
            }})()""")
            client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': 0, 'y': 0})
            return styles

        api = styles_on_hover('.api-config-card:first-child .api-config-move[data-offset="1"]')
        ev("uiUtilsV136.showScreen('chat')")
        wait("""!document.getElementById('chat-screen').getAnimations().some(animation =>
            animation.transitionProperty === 'transform' && animation.playState === 'running')""", 'Chat screen transition completes')
        click('#chat-search-open-btn')
        try:
            ev("document.getElementById('chat-search-next-btn').disabled = false")
            search = styles_on_hover('#chat-search-next-btn')
            assert api == search, (api, search)
        finally:
            click('#chat-search-close-btn')

    def open_model_picker(thinking=True):
        click('#chat-model-button')
        if thinking:
            wait("Boolean(document.querySelector('.thinking-model-switch'))", 'Thinking popover opens')
            assert ev("!(settingsUiV136.popover instanceof HTMLDialogElement)")
            click('.thinking-model-switch')
        wait("Boolean(document.querySelector('.model-picker-search'))", 'Model picker opens')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?apiSettingsFixture=1') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
        }
    """})['identifier']
    try:
        boot()
        metrics(375)
        assert_empty()
        open_model_picker(thinking=False)
        assert ev("""settingsUiV136.popover.matches(':modal') &&
            settingsUiV136.popover.textContent.includes('選択できるモデルがありません')""")
        click('.execution-model-dialog-header button')
        assert_empty()

        ev("appLogic.handleFileSelection([new File(['x'], 'draft.txt')])")
        input_value('user-input', '未送信の本文')
        click('#send-button')
        wait("document.querySelector('#alertDialog[open]')?.textContent.includes('モデルが選択されていません')",
             'No-model send displays the existing settings warning')
        assert ev("""!state.isSending && !state.currentMessages.length && state.pendingAttachments.length === 1
            && document.getElementById('user-input').value === '未送信の本文'""")
        click('#alertDialog .dialog-ok-btn')
        ev('sessionStorage.removeItem(SettingsV136.DRAFT_KEY)')
        boot(reload=True)
        assert_empty()
        assert ev("""(async () => {
            const id = await dbUtils.addProfile({name:'API fixture profile', settings:{}, createdAt:Date.now()});
            await appLogic.loadProfiles();
            return appLogic.switchProfile(id);
        })()""")
        assert_empty()

        # Exercise the persisted state left by earlier startup behavior. Seed
        # the same obsolete route in each independent restoration source.
        ev("""(async () => {
            const ref = {apiConfigId:'api_gemini_default', modelName:'gemini-2.5-pro'};
            const execution = {schemaVersion:1, modelRef:ref, thinkingEffort:null, updatedAt:1};
            const metadata = {...ref, provider:'gemini', generatedAt:1};
            const messages = [{role:'model', content:'以前の応答', timestamp:1, usageMetadata:{tmExecution:metadata}}];
            await dbUtils.saveSetting('legacyInitialModelRefV136', ref);
            await dbUtils.saveSetting(SettingsV136.SUCCESS_KEY, {...execution, completedAt:1});
            const globals = (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value;
            await dbUtils.saveSetting(SettingsV136.GLOBAL_KEY, {...globals, summaryModelRef:ref});
            await dbUtils.addProfile({name:'旧初期設定のプロファイル', createdAt:1, settings:{...ref,
                apiProvider:'gemini', defaultModelRef:ref}});
            await new Promise((resolve, reject) => {
                const tx = state.db.transaction('chats', 'readwrite'), store = tx.objectStore('chats');
                store.put({id:8101, title:'保存済みの実行モデル', messages, executionSettings:execution, createdAt:1, updatedAt:2});
                store.put({id:8102, title:'旧形式の実行モデル', messages, defaultModelRef:ref, createdAt:1, updatedAt:1});
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            });
            sessionStorage.setItem(SettingsV136.DRAFT_KEY, JSON.stringify(execution));
        })()""")
        boot(reload=True)
        assert_empty()
        assert ev("""appLogic.readExecutionDraft().modelRef === null &&
            !appLogic.buildModelRefOptions({currentRefs:[{apiConfigId:'api_gemini_default',modelName:'gemini-2.5-pro'}]}).length""")
        ev('appLogic.startNewChat(); state.executionSettingsReady')
        assert_empty()
        open_model_picker(thinking=False)
        assert ev("!document.querySelector('.model-picker-choice')")
        click('.execution-model-dialog-header button')
        ev('sessionStorage.removeItem(SettingsV136.DRAFT_KEY)')
        boot(reload=True)
        assert_empty()
        assert ev("""state.currentChatId === 8101 && state.currentExecutionSettings.modelRef === null &&
            state.currentMessages[0].usageMetadata.tmExecution.modelName === 'gemini-2.5-pro'""")
        assert ev("""(async () => {
            await dbUtils.saveChat();
            const stored = await dbUtils.getChat(8101);
            const success = (await dbUtils.getSetting(SettingsV136.SUCCESS_KEY)).value;
            const legacy = (await dbUtils.getSetting('legacyInitialModelRefV136')).value;
            return stored.executionSettings.modelRef.apiConfigId === 'api_gemini_default' &&
                stored.messages[0].usageMetadata.tmExecution.modelName === 'gemini-2.5-pro' &&
                success.modelRef.apiConfigId === 'api_gemini_default' && legacy.modelName === 'gemini-2.5-pro';
        })()"""), 'Content save preserves past execution, success and migration records'
        assert ev("(async () => (await appLogic.loadChat(8102)).ok)()")
        assert_empty()
        assert ev("""(async () => {
            const old = state.profiles.find(profile => profile.name === '旧初期設定のプロファイル');
            return appLogic.switchProfile(old.id);
        })()""")
        assert_empty()
        ev('appLogic.startNewChat(); state.executionSettingsReady')
        assert_empty()

        open_general()
        assert ev("document.querySelector('.api-config-empty') && !document.getElementById('add-api-config-btn').disabled")
        open_editor()
        close_editor()
        assert_empty()

        open_editor()
        edit('provider', 'bedrock', 'change')
        status('保存済み')
        assert ev(stored("configs.length === 1 && configs[0].provider === 'bedrock' && !configs[0].modelCandidates.length"))
        assert ev("appLogic.getCurrentChatModelRef() === null")
        click('#delete-api-config-dialog-btn')
        wait("document.querySelector('#confirmDialog[open]')?.textContent.includes('削除')", 'Unused last API can be deleted')
        click('#confirmDialog .dialog-ok-btn')
        wait("!document.getElementById('api-config-dialog').open", 'Editor closes after deletion')
        boot(reload=True)
        assert_empty()

        open_general()
        open_editor()
        edit('provider', 'gemini', 'change')
        status('保存済み')
        a_id = ev("state.apiConfigs[0].id")
        edit('name', 'Gemini A')
        edit('api-key', 'fixture-a')
        wait(stored("configs.length === 1 && configs[0].name === 'Gemini A' && configs[0].apiKey === 'fixture-a'"),
             'Debounced name and key are saved')
        edit('additional-models', 'gemini-3-flash-preview\ngemini-2.5-pro')
        assert ev(stored('configs[0].modelCandidates.length === 0'))
        edit('additional-models', 'gemini-3-flash-preview\ngemini-2.5-pro', 'change')
        status('保存済み')
        edit('base-url', 'https://api-settings-fixture.invalid/models')
        key('Escape', 27)
        wait("!document.getElementById('api-config-dialog').open", 'Escape flushes the editor before closing')
        assert ev(stored("""configs.length === 1 && configs[0].baseUrl === 'https://api-settings-fixture.invalid/models'
            && configs[0].modelCandidates.join() === 'gemini-3-flash-preview,gemini-2.5-pro'"""))
        assert ev("appLogic.getCurrentChatModelRef() === null && document.getElementById('model-name').value === ''")

        open_editor()
        edit('provider', 'zai', 'change')
        status('保存済み')
        b_id = ev('state.apiConfigs.at(-1).id')
        edit('name', 'Z.ai B')
        edit('additional-models', '\n'.join(f'glm-test-{i:02d}' for i in range(25)), 'change')
        status('保存済み')
        edit('enabled', False, 'change')
        wait(stored('configs[1].enabled === false'), 'Disable unused API')
        edit('enabled', True, 'change')
        close_editor()

        model_ref = {'apiConfigId': a_id, 'modelName': 'gemini-3-flash-preview'}
        auxiliary = {'apiConfigId': a_id, 'modelName': 'gemini-2.5-pro'}
        ev(f"appLogic.setCurrentChatModelRef({json.dumps(model_ref)})")
        ev(f"appLogic.saveGlobalSettingsV136({{summaryModelRef:{json.dumps(auxiliary)}}})")
        before_order = ev(stored('configs'))
        assert ev("""document.querySelector('.api-config-card:first-child [data-offset="-1"]').disabled &&
            document.querySelector('.api-config-card:last-child [data-offset="1"]').disabled""")
        click(f'[data-api-config-id="{b_id}"][data-offset="-1"]')
        wait(stored(f'configs[0].id === {json.dumps(b_id)}'), 'API order persisted')
        assert ev(stored('configs')) == list(reversed(before_order)), 'Only the array order changed'
        click(f'[data-api-config-id="{b_id}"][data-offset="1"]')
        wait(stored(f'configs[1].id === {json.dumps(b_id)}'), 'Down move persisted')
        click(f'[data-api-config-id="{b_id}"][data-offset="-1"]')
        wait(stored(f'configs[0].id === {json.dumps(b_id)}'), 'Up move persisted again')
        assert ev("appLogic.getCurrentChatModelRef()") == model_ref
        assert ev("""(() => {
            const order = appLogic.buildModelRefOptions().map(choice => choice.value);
            const select = id => [...document.getElementById(id).options].slice(1).map(option => option.value);
            return ['model-name', 'summary-model-name', 'proofreading-model-name', ...Object.values(SettingsV136.auxiliaryModelSelectIds)]
                .every(id => JSON.stringify(select(id)) === JSON.stringify(order));
        })()"""), 'Basic and auxiliary selects follow API order, then candidate order'

        open_editor(a_id)
        edit('additional-models', 'gemini-3-flash-preview')
        edit('name', 'Gemini A renamed')
        wait(stored("configs[1].name === 'Gemini A renamed'"), 'Other field autosaves while candidates are being edited')
        assert ev(stored('configs[1].modelCandidates.length === 2'))
        assert ev("!document.querySelector('#confirmDialog[open]')")
        edit('additional-models', 'gemini-3-flash-preview', 'change')
        wait("document.querySelector('#confirmDialog[open]')?.textContent.includes('gemini-2.5-pro')",
             'Removing a referenced candidate prompts on field commit')
        click('#confirmDialog .dialog-cancel-btn')
        status('保存済み')
        assert ev(stored("configs[1].name === 'Gemini A renamed' && configs[1].modelCandidates.length === 2"))
        assert ev("document.getElementById('api-config-additional-models').value.includes('gemini-2.5-pro')")
        edit('enabled', False, 'change')
        wait("document.querySelector('#alertDialog[open]')?.textContent.includes('無効化できません')", 'Disabling a used API warns')
        click('#alertDialog .dialog-ok-btn')
        status('保存済み')
        assert ev(stored('configs[1].enabled && configs[1].apiKey === "fixture-a"'))
        assert ev("document.getElementById('api-config-enabled').checked")

        ev("""(() => {
            const edit = appLogic.editApiConfigModelsV136;
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            window.apiFixture = {edit, release, started: false};
            appLogic.editApiConfigModelsV136 = async function (next, ...args) {
                if (next.name === 'Slow first edit') { apiFixture.started = true; await gate; }
                return edit.call(this, next, ...args);
            };
        })()""")
        edit('name', 'Slow first edit')
        wait('apiFixture.started', 'First save is in flight')
        edit('name', 'Latest edit')
        edit('api-key', 'fixture-a-latest')
        ev('apiFixture.release()')
        wait(stored("configs.length === 2 && configs[1].name === 'Latest edit' && configs[1].apiKey === 'fixture-a-latest'"),
             'Queued latest edit wins without creating another configuration')
        ev('appLogic.editApiConfigModelsV136 = apiFixture.edit')
        ev("""(() => {
            const transaction = state.db.transaction;
            state.db.transaction = function (stores, mode) {
                if (mode === 'readwrite' && stores.includes('settings')) {
                    state.db.transaction = transaction;
                    throw new Error('injected API save failure');
                }
                return transaction.call(this, stores, mode);
            };
        })()""")
        edit('name', 'Retained failed edit')
        wait("document.querySelector('#alertDialog[open]')?.textContent.includes('injected API save failure')", 'Storage failure is reported')
        assert ev(stored("configs[1].name === 'Latest edit'"))
        assert ev("""document.getElementById('api-config-name').value === 'Retained failed edit' &&
            document.getElementById('api-config-save-status').dataset.error === 'true'""")
        click('#alertDialog .dialog-ok-btn')
        edit('name', 'Recovered edit')
        close_editor()
        assert ev(stored("configs[1].name === 'Recovered edit'"))

        for width in (320, 375, 430, 600, 601, 768, 799, 800, 801, 1280):
            metrics(width)
            for dark in (False, True):
                ev(f"appLogic.saveAppearanceValues('theme', {{darkMode: {str(dark).lower()}}}, {{global: true}})")
                open_general()
                wait(f"""document.body.classList.contains('dark-mode') === {str(dark).lower()} &&
                    !document.getAnimations().some(animation =>
                        animation.effect?.target?.matches?.('.api-config-move') && animation.playState === 'running')""",
                     'API button theme transition completes')
                layout = ev("""(() => {
                    const card = document.querySelector('.api-config-card');
                    const area = card.getBoundingClientRect(), actions = card.querySelector('.api-config-actions').getBoundingClientRect();
                    const button = card.querySelector('.api-config-move'), style = getComputedStyle(button);
                    const reference = document.getElementById('chat-search-prev-btn');
                    const previous = reference.disabled;
                    reference.disabled = true;
                    const referenceStyle = getComputedStyle(reference);
                    const sameStyle = ['backgroundColor','borderColor','borderWidth','borderRadius','boxShadow','color','opacity']
                        .every(property => style[property] === referenceStyle[property]);
                    reference.disabled = previous;
                    const icons = [...card.querySelectorAll('.api-config-move .material-symbols-outlined')];
                    return {ok: area.left >= 0 && area.right <= innerWidth && actions.right <= area.right &&
                        button.offsetWidth === 40 && button.offsetHeight === 40 && sameStyle &&
                        style.borderWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
                        style.boxShadow === 'none' && getComputedStyle(icons[0]).opacity === '0.36' &&
                        icons.map(icon => icon.textContent).join() === 'arrow_upward,arrow_downward' &&
                        icons.every(icon => getComputedStyle(icon).fontSize === '22px'),
                        area: [area.left, area.right, actions.right], size: [button.offsetWidth, button.offsetHeight],
                        style: [style.backgroundColor, style.boxShadow, style.borderWidth]};
                })()""")
                assert layout['ok'], (width, dark, layout)
                if width == 1280:
                    compare_arrow_hover()
                ev("uiUtilsV136.showScreen('chat')")
                open_model_picker()
                assert ev(f"""(() => {{
                    const panel = settingsUiV136.popover, r = panel.getBoundingClientRect();
                    const list = panel.querySelector('.model-picker-list');
                    return panel.matches(':modal') === {str(width < 800).lower()} &&
                        r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
                        document.body.classList.contains('dark-mode') === {str(dark).lower()} &&
                        panel.querySelector('.model-picker-group').textContent === 'Z.ai B' &&
                        panel.querySelector('[aria-pressed=true]').textContent === 'gemini-3-flash-preview' &&
                        list.scrollHeight > list.clientHeight;
                }})()"""), f'Model picker fits {width}px, dark={dark}'
                ev('settingsUiV136.closePopover(true)')

        metrics(799)
        open_model_picker()
        ev("""(() => {
            const search = document.querySelector('.model-picker-search');
            search.value = '2.5-pro'; search.dispatchEvent(new Event('input'));
        })()""")
        metrics(800)
        wait("settingsUiV136.popover && !settingsUiV136.popover.matches(':modal')", 'Open picker switches to desktop presentation')
        metrics(799)
        wait("settingsUiV136.popover?.matches(':modal')", 'Open picker switches back to modal')
        assert ev("document.querySelectorAll('.model-picker-choice').length === 1 && document.querySelector('.model-picker-search').value === '2.5-pro'")
        metrics(375, 380)
        assert ev("""(() => {
            const panel = settingsUiV136.popover, search = panel.querySelector('input'), close = panel.querySelector('header button') || panel.querySelector('.execution-model-dialog-header button');
            const workspace = document.querySelector('.chat-input-area');
            const before = workspace.getBoundingClientRect().height;
            const viewport = visualViewport;
            Object.defineProperty(viewport, 'height', {configurable: true, value: 260});
            try {
                settingsUiV136.positionPopover();
                search.focus();
                return panel.getBoundingClientRect().bottom <= 260 && close.getBoundingClientRect().bottom <= 260 &&
                    search.getBoundingClientRect().bottom <= 260 && workspace.getBoundingClientRect().height === before;
            } finally { delete viewport.height; settingsUiV136.positionPopover(); }
        })()"""), 'Search and close fit the visual viewport while typing'
        key('Escape', 27)
        wait("!settingsUiV136.popover && document.activeElement.id === 'chat-model-button'", 'Escape restores model trigger focus')
        assert ev('appLogic.getCurrentChatModelRef()') == model_ref

        open_model_picker()
        ev("""(() => {
            const search = document.querySelector('.model-picker-search');
            search.value = '2.5-pro'; search.dispatchEvent(new Event('input'));
        })()""")
        click('.model-picker-choice')
        wait("!settingsUiV136.popover && appLogic.getCurrentChatModelRef()?.modelName === 'gemini-2.5-pro'",
             'Selecting a filtered model applies the reference and closes the picker')
        assert ev('appLogic.getCurrentChatModelRef()') == auxiliary

        ev("""(() => {
            window.apiSendFixture = [];
            const fetch = window.fetch;
            window.fetch = (url, options) => {
                if (!String(url).includes('api-settings-fixture.invalid/models/gemini-2.5-pro:generateContent')) return fetch(url, options);
                apiSendFixture.push(JSON.parse(options.body));
                return Promise.resolve(Response.json({
                    candidates:[{content:{parts:[{text:'送信できました'}]},finishReason:'STOP'}]
                }));
            };
            document.getElementById('user-input').value = '明示選択後の送信';
        })()""")
        ev('appLogic.handleSend()')
        assert ev("apiSendFixture.length === 1 && state.currentMessages.at(-1).content === '送信できました'")
        sent_chat = ev('state.currentChatId')
        boot(reload=True)
        assert ev(stored(f"""configs.map(c => c.id).join() === {json.dumps(b_id + ',' + a_id)} &&
            configs[1].apiKey === 'fixture-a-latest' && configs[1].modelCandidates.includes('gemini-2.5-pro')"""))
        assert ev('appLogic.getCurrentChatModelRef()') == auxiliary and ev('state.currentChatId') == sent_chat
        assert ev("""(() => {
            const legacy = {apiProvider:'gemini', apiKey:'legacy-fixture', modelName:'gemini-2.5-pro'};
            const ref = {apiConfigId:'api_gemini_default', modelName:'gemini-2.5-pro'};
            const old = appLogic.convertLegacyApiSettingsV136(legacy, [], null);
            const empty = appLogic.convertLegacyApiSettingsV136({...legacy, apiConfigs:[]}, [], null);
            const bare = appLogic.convertLegacyApiSettingsV136({...legacy, apiKey:'', defaultModelRef:ref}, [], null);
            const otherCandidate = appLogic.convertLegacyApiSettingsV136({...legacy, defaultModelRef:ref,
                apiConfigs:[{id:ref.apiConfigId, provider:'gemini', apiKey:'real', modelCandidates:['gemini-3-flash-preview']}]}, [], null);
            return old.configs.length === 1 && old.configs[0].apiKey === 'legacy-fixture' &&
                old.configs[0].modelCandidates.includes('gemini-2.5-pro') && !empty.configs.length &&
                !bare.configs.length && !otherCandidate.configs[0].modelCandidates.includes(ref.modelName);
        })()"""), 'Real legacy data migrates and an explicit empty array remains empty'
        assert ev("""(async () => {
            const ref = {apiConfigId:'api_gemini_default', modelName:'gemini-2.5-pro'};
            const config = {id:ref.apiConfigId, provider:'gemini', apiKey:'legacy-real-key', modelCandidates:[ref.modelName]};
            await dbUtils.saveSetting('apiConfigs', [...state.apiConfigs, config]);
            await appLogic.refreshExecutionApiConfigsV136();
            const loaded = await appLogic.loadChat(8101);
            return loaded.ok && JSON.stringify(appLogic.getCurrentChatModelRef()) === JSON.stringify(ref) &&
                appLogic.resolveDefaultExecutionApiConfig().apiKey === 'legacy-real-key';
        })()"""), 'An explicitly registered legacy ID and model remain selectable'
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        metrics(1280, 900)
        client.sock.settimeout(socket_timeout)

    return 'ALL PASSED (fresh and legacy-empty API settings, historical and valid references, autosave, order, model send and 20 layouts)'

"""F4 and F8 on the real settings screen, including navigation and IndexedDB reloads."""
import base64
import json
import time


def run(client, url, screenshots=None):
    def ev(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def wait(expression, label, timeout=4):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if ev(expression):
                return
            time.sleep(0.05)
        raise AssertionError(label)

    def boot(path=None):
        previous = ev('performance.timeOrigin')
        client.call('Page.reload' if path is None else 'Page.navigate', {} if path is None else {'url': url + path})
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                if ev(f'performance.timeOrigin > {previous} && !!window.appLogic?._setupEventListenersCallCount && !!window.settingsUiV136'):
                    return
            except RuntimeError as error:
                if 'Inspected target navigated or closed' not in str(error):
                    raise
            time.sleep(0.05)
        raise AssertionError('Real app startup completed')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def press_enter(selector):
        ev(f'document.querySelector({json.dumps(selector)}).focus()')
        assert ev(f'document.activeElement === document.querySelector({json.dumps(selector)})')
        key = {'key': 'Enter', 'code': 'Enter', 'windowsVirtualKeyCode': 13}
        client.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'text': '\r', **key})
        client.call('Input.dispatchKeyEvent', {'type': 'keyUp', **key})

    def category(name):
        click(f'[data-settings-category="{name}"]')
        panel(name)

    def panel(name):
        wait(f"state.currentScreen === 'settings' && location.hash === '#settings/{name}' && !document.querySelector('#settings-panel-{name}').hidden",
             f'{name} is restored and visible')

    def capture(name):
        if screenshots is None:
            return
        wait("![document.querySelector('#settings-screen'), document.querySelector('#settings-color-dialog')].some(node => node.getAnimations({subtree:true}).some(a => a.playState === 'running'))",
             'Settings layout has settled')
        image = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})['data']
        screenshots.mkdir(parents=True, exist_ok=True)
        (screenshots / f'{name}.png').write_bytes(base64.b64decode(image))

    def change(id, value, event='change'):
        ev(f'''(() => {{
            const control = document.getElementById({json.dumps(id)});
            if (control.type === 'checkbox') control.checked = {json.dumps(value)};
            else control.value = {json.dumps(value)};
            control.dispatchEvent(new Event({json.dumps(event)}, {{bubbles: true}}));
        }})()''')
        ev('settingsUiV136.saveQueue')

    def open_color(id):
        click(f'[data-color-input="{id}"]')
        wait("document.querySelector('#settings-color-dialog').open && document.activeElement.id === 'settings-color-title'",
             'The settings color dialog opens and receives focus')
        assert ev("document.querySelectorAll('.settings-color-preset').length === 14")

    def finish_color(action='ok'):
        click(f'#settings-color-dialog [value="{action}"]')
        wait("!settingsUiV136.colorPicker.active", 'Color dialog has closed')
        ev('settingsUiV136.saveQueue')

    def global_theme(expected, mode):
        wait(f'''(async () => {{
            const theme = (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.theme;
            return theme.darkMode === {json.dumps(expected)} && document.querySelector('#dark-mode-toggle').value === '{mode}';
        }})()''', f'Global {mode} is selected and stored as a boolean')

    tool_controls = {
        'geminiEnableFunctionCalling': 'gemini-enable-function-calling-toggle',
        'allowPromptUiChanges': 'allow-prompt-ui-changes',
        'forceFunctionCalling': 'force-function-calling-toggle',
        'geminiEnableGrounding': 'gemini-enable-grounding-toggle',
    }

    def tool_state(profile, values, *, change_values=False):
        if change_values:
            for id, value in zip(tool_controls.values(), values):
                change(id, value)
        wait(f'''(async () => {{
            const profile = await dbUtils.getProfile({profile});
            return state.activeProfileId === profile.id && Object.entries({json.dumps(tool_controls)}).every(([key, id], index) => {{
                const expected = {json.dumps(values)}[index];
                return profile.settings[key] === expected && state.settings[key] === expected && document.getElementById(id).checked === expected
                    && !Object.hasOwn(state.globalSettingsV136, key);
            }});
        }})()''', f'AI tool settings are stored and applied for profile {profile}')

    def tool_request(expected, *, first=True):
        observed = ev(f'''(async () => {{
            const api = appLogic.getExecutionApiConfig, fetch = window.fetch;
            let request;
            appLogic.getExecutionApiConfig = () => ({{provider: 'gemini', modelName: 'gemini-2.5-flash', apiKey: 'f8-test'}});
            window.fetch = (url, options) => {{
                if (!String(url).includes(':generateContent') || options?.method !== 'POST') return fetch(url, options);
                request = JSON.parse(options.body);
                return Promise.resolve(Response.json({{candidates:[{{content:{{parts:[{{text:'F8 answer'}}]}},finishReason:'STOP'}}]}}));
            }};
            try {{
                await appLogic.callApiWithRetry({{messagesForApi:[{{role:'user',parts:[{{text:'F8 check'}}]}}],generationConfig:{{}},isFirstCall:{json.dumps(first)}}});
                const mode = request?.toolConfig?.functionCallingConfig?.mode ?? null;
                const tool = request?.tools?.[0];
                const kind = tool?.functionDeclarations || tool?.function_declarations ? 'function' : tool?.google_search ? 'search' : null;
                return request ? [kind, mode, request.tools?.length ?? 0] : null;
            }} finally {{ window.fetch = fetch; appLogic.getExecutionApiConfig = api; }}
        }})()''')
        assert observed == expected, f'Expected Gemini tool selection {expected}, got {observed}'

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    try:
        boot('?settings-navigation#chat')
        wait("navigator.serviceWorker.controller?.state === 'activated'", 'Local Service Worker serves the settings UI')
        boot()
        if ev("document.querySelector('#releaseNotesDialog[open]') !== null"):
            click('#releaseNotesDialog .dialog-ok-btn')
        ev("appLogic.updateLocalUiSetting('enableWideMode', true).then(() => appLogic.applyWideMode())")
        if not ev('chatSidebarUiState.isOpen'):
            click('#goto-history-btn')
        assert ev("""(() => {
            const entries = Array.from(document.querySelectorAll('.chat-sidebar-navigation > button'));
            return entries.map(button => button.id).join() === 'new-chat-btn,document-library-open,goto-settings-btn'
                && entries[2].textContent.trim() === 'settings設定'
                && entries.every(button => button.classList.contains('chat-sidebar-nav-button'))
                && !document.querySelector('#chat-workspace .app-header #goto-settings-btn');
        })()""")
        chat_width = ev('elements.chatHistorySidebar.offsetWidth')
        press_enter('#goto-settings-btn')
        wait("state.currentScreen === 'settings' && document.querySelector('#settings-title').textContent === 'API・モデル'",
             'Settings sidebar entry opens the default desktop category')
        capture('desktop-settings')
        assert ev(f"""(() => {{
            const left = document.querySelector('.settings-sidebar'), right = document.querySelector('.settings-detail-header');
            const layout = left.parentElement;
            const back = document.querySelector('#back-to-chat-from-settings'), icon = back.firstElementChild;
            return {chat_width} === 288 && left.offsetWidth === {chat_width} &&
                left.offsetHeight === layout.offsetHeight && left.offsetTop === 0 &&
                getComputedStyle(left).borderRight === getComputedStyle(elements.chatHistorySidebar).borderRight &&
                right.offsetLeft === left.offsetWidth && right.offsetLeft === document.querySelector('#settings-detail').offsetLeft &&
                left.querySelector('header').offsetHeight === right.offsetHeight &&
                Math.abs(back.clientWidth / 2 - icon.offsetLeft - icon.offsetWidth / 2) < 1 &&
                Math.abs(back.clientHeight / 2 - icon.offsetTop - icon.offsetHeight / 2) < 1;
        }})()"""), 'Shared pane width, continuous divider, paired headers and centered back icon'
        for width in (1280, 900):
            client.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            category('tools-integrations')
            wait("document.querySelector('#settings-title').textContent === 'ツール・外部連携'", 'Desktop/tablet category title')
            depth = ev('history.length')
            for expanded in (False, True):
                press_enter('#settings-menu-btn')
                assert ev(f"""(() => {{
                    const menu = document.querySelector('#settings-menu-btn');
                    const nav = document.getElementById(menu.getAttribute('aria-controls'));
                    return menu.getAttribute('aria-expanded') === '{str(expanded).lower()}' &&
                        Boolean(nav.offsetWidth) === {json.dumps(expanded)} &&
                        document.activeElement === menu && history.length === {depth} &&
                        location.hash === '#settings/tools-integrations';
                }})()"""), f'Keyboard toggles the category pane at {width}px'
        press_enter('#back-to-chat-from-settings')
        wait("state.currentScreen === 'chat'", 'Left header returns to chat')
        ev('history.back()')
        panel('tools-integrations')
        ev('history.forward()')
        wait("state.currentScreen === 'chat'", 'Browser forward returns to chat')
        client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})

        boot('?f4=desktop#settings/appearance')
        panel('appearance')
        ev('''(async () => {
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', APP_VERSION);
            await appLogic.setProfileOverride('theme', false);
            await appLogic.saveAppearanceValues('theme', {darkMode: true, themeColorMode: 'accent'}, {global: true});
        })()''')
        boot()
        panel('appearance')
        global_theme(True, 'dark')
        wait("document.body.classList.contains('dark-mode')", 'Existing dark value is applied at boot')
        category('api-model')
        category('appearance')
        change('dark-mode-toggle', 'light')
        global_theme(False, 'light')
        wait("document.body.classList.contains('light-mode-forced')", 'Light is applied')
        change('dark-mode-toggle', 'dark')
        global_theme(True, 'dark')
        wait("document.body.classList.contains('dark-mode')", 'Dark is applied')
        capture('desktop-color-list')
        assert ev("""(() => {
            const items = ['[data-color-input=accent-color-input] .settings-color-swatch','#upload-background-btn .settings-background-value'];
            return items.every(selector => {
                const value = document.querySelector(selector);
                const row = value.closest('button');
                const right = row.getBoundingClientRect().right - value.getBoundingClientRect().right;
                return right >= 20 && right <= 40;
            });
        })()""")
        capture('desktop-background-row')
        open_color('accent-color-input')
        capture('desktop-dark-color-picker')
        click('.settings-color-preset[data-color="#dc3545"]')
        assert ev("""(() => {
            const picker = settingsUiV136.colorPicker;
            return picker.hex.value === '#dc3545' && picker.hue.value !== '0' &&
                picker.dialog.style.getPropertyValue('--swatch') === '#dc3545' &&
                picker.presets.querySelector('[aria-pressed=true]').dataset.color === '#dc3545' &&
                Number.parseFloat(picker.plane.style.getPropertyValue('--saturation')) > 50;
        })()""")
        change('settings-color-hex', '#abcd', 'input')
        click('#settings-color-dialog [value=ok]')
        assert ev("settingsUiV136.colorPicker.dialog.open && !settingsUiV136.colorPicker.hex.validity.valid && state.globalSettingsV136.theme.accentColor !== '#dc3545'")
        finish_color('cancel')
        assert ev("state.globalSettingsV136.theme.accentColor !== '#dc3545'")
        change('dark-mode-toggle', 'light')

        open_color('accent-color-input')
        change('settings-color-hex', '#135789', 'input')
        wait("!document.querySelector('#settings-color-dialog').classList.contains('animating')", 'The color dialog has settled')
        hex_border = ev("getComputedStyle(document.getElementById('settings-color-hex')).borderTopColor")
        hex_point = ev("""(() => {
            const rect = document.getElementById('settings-color-hex').getBoundingClientRect();
            return {x:rect.left + 70,y:rect.top + rect.height / 2};
        })()""")
        for event in ('mousePressed','mouseReleased'):
            client.call('Input.dispatchMouseEvent', {'type':event,'button':'left','clickCount':1, **hex_point})
        wait(f"""document.activeElement.id === 'settings-color-hex' && getComputedStyle(document.activeElement).outlineStyle === 'none' &&
            getComputedStyle(document.activeElement).borderTopColor !== {json.dumps(hex_border)}""",
             'The HEX field is visibly focused')
        capture('desktop-hex-editing')
        finish_color()
        wait("uiUtilsV136.getEffectiveHeaderColor() === '#135789'", 'Accent color is applied')
        open_color('accent-color-input')
        click('#settings-color-dialog .settings-color-reset')
        assert ev("state.globalSettingsV136.theme.accentColor === '#135789'")
        finish_color()
        wait("state.globalSettingsV136.theme.accentColor === appLogic.normalizeGlobalThemeSettings({}).accentColor", 'Accent reset is saved')
        change('theme-color-mode-select', 'individual')
        assert ev("document.querySelector('[data-color-input=header-text-color-input]').disabled")
        change('header-text-color-mode-select', 'custom')
        open_color('header-text-color-input')
        click('.settings-color-preset[data-color="#ffffff"]')
        finish_color()
        wait("state.globalSettingsV136.theme.headerTextColor === '#ffffff'", 'Manual header text color applies')
        open_color('header-text-color-input')
        click('#settings-color-dialog .settings-color-reset')
        finish_color()
        wait("state.globalSettingsV136.theme.headerTextColorMode === 'auto' && document.querySelector('[data-color-input=header-text-color-input]').disabled",
             'Reset retains the existing automatic header text behavior')
        open_color('header-color-input')
        change('settings-color-hex', '#457123', 'input')
        finish_color()
        wait("uiUtilsV136.getEffectiveHeaderColor() === '#457123'", 'Individual header color is applied')
        capture('desktop-individual-colors')
        assert ev("!document.querySelector('#upload-background-btn').textContent.includes('画像を選択')")
        ev("""(async () => {
            const control = document.getElementById('background-image-input');
            const image = await (await fetch('./icon-192x192.png')).blob();
            const files = new DataTransfer();
            files.items.add(new File([image], 'background.png', {type:'image/png'}));
            control.files = files.files;
            control.dispatchEvent(new Event('change', {bubbles:true}));
            await settingsUiV136.saveQueue;
        })()""")
        wait("document.getElementById('background-thumbnail').getClientRects().length > 0 && document.querySelector('#upload-background-btn').textContent.includes('設定済み')",
             'The background row updates its status and thumbnail')
        assert ev("""(() => {
            const remove = document.getElementById('delete-background-btn');
            const bounds = remove.closest('.settings-island').getBoundingClientRect();
            const row = remove.getBoundingClientRect();
            return Math.abs(row.left - bounds.left) <= 1 && Math.abs(row.right - bounds.right) <= 1;
        })()""")
        capture('desktop-background-selected')
        click('#delete-background-btn')
        wait("!state.globalSettingsV136.appearance.backgroundAssetId && document.querySelector('#upload-background-btn').textContent.includes('未設定')",
             'Deleting the background restores the unset row')
        change('chat-font-size-select', '20')
        capture('desktop-appearance')
        category('data-sync')
        change('history-sort-order', 'title')
        wait("(async () => { const local = (await dbUtils.getSetting('localUiSettings')).value; return local.chatFontSize === 20 && local.historySortOrder === 'title'; })()",
             'Moved display and history settings keep their original persistence')

        boot()
        panel('data-sync')
        category('appearance')
        global_theme(False, 'light')
        wait("document.querySelector('#theme-color-mode-select').value === 'individual' && document.querySelector('#header-color-input').value === '#457123' && document.querySelector('#chat-font-size-select').value === '20' && document.querySelector('#history-sort-order').value === 'title'",
             'Color, display and history values survive a reload')

        other = ev('state.activeProfileId')
        own = ev('''(async () => {
            const id = await dbUtils.addProfile({name: 'F4 own', settings: {}, createdAt: Date.now()});
            await appLogic.loadProfiles();
            await appLogic.switchProfile(id);
            return id;
        })()''')
        category('profile')
        change('profile-theme-override', True)
        change('profile-dark-mode-toggle', 'dark')
        change('profile-theme-color-mode-select', 'accent')
        open_color('profile-accent-color-input')
        change('settings-color-hex', '#8a2167', 'input')
        capture('desktop-profile-color-picker')
        finish_color()
        change('profile-appearance-override', True)
        change('profile-overlay-opacity-slider', '25', 'input')
        wait(f'''(async () => {{
            const own = (await dbUtils.getProfile({own})).settings;
            return own.theme.darkMode === true && own.theme.accentColor === '#8a2167' && own.appearance.overlayOpacity === 0.25
                && state.settings.darkMode === true && uiUtilsV136.getEffectiveHeaderColor() === '#8a2167' && state.settings.overlayOpacity === 0.25;
        }})()''', 'Profile theme, color and background effect are stored and applied')
        global_theme(False, 'light')
        open_color('profile-accent-color-input')
        click('.settings-color-preset[data-color="#000000"]')
        ev(f'appLogic.switchProfile({other})')
        finish_color()
        assert ev(f"(async () => (await dbUtils.getProfile({own})).settings.theme.accentColor === '#8a2167')()")
        ev(f'appLogic.switchProfile({own})')
        change('profile-theme-override', False)
        wait("document.querySelector('#profile-theme-editor').hidden && state.settings.darkMode === false", 'Disabling override uses global theme')
        change('profile-theme-override', True)
        ev(f'appLogic.switchProfile({other})')
        wait("document.querySelector('#profile-theme-editor').hidden && state.settings.darkMode === false", 'Other profile restores global theme')
        ev(f'appLogic.switchProfile({own})')
        boot()
        panel('profile')
        wait("!document.querySelector('#profile-theme-editor').hidden && document.querySelector('#profile-dark-mode-toggle').value === 'dark' && document.querySelector('#profile-accent-color-input').value === '#8a2167' && document.querySelector('#profile-overlay-opacity-slider').value === '25'",
             'Profile settings are restored after profile switch and reload')

        category('tools-integrations')
        a_tools = [True, False, True, True]
        b_tools = [False, True, False, True]
        tool_state(own, a_tools, change_values=True)
        change('force-function-calling-toggle', False)
        category('appearance')
        category('tools-integrations')
        tool_state(own, [True, False, False, True])
        change('force-function-calling-toggle', True)
        tool_state(own, a_tools)
        tool_request(['function', 'ANY', 1])
        tool_request(['function', None, 1], first=False)
        ev(f'appLogic.switchProfile({other})')
        tool_state(other, b_tools, change_values=True)
        tool_request(['search', None, 1])
        change('gemini-enable-grounding-toggle', False)
        tool_state(other, [False, True, False, False])
        tool_request([None, None, 0])
        wait('''(async () => {
            const update = appLogic.updateOpacitySettings;
            appLogic.updateOpacitySettings = async () => true;
            try { return (await window.functionCallingTools.set_ui_opacity({overlay:0.5})).success === true; }
            finally { appLogic.updateOpacitySettings = update; }
        })()''', 'The enabled UI tool can apply a change')
        ev(f'appLogic.switchProfile({own})')
        tool_state(own, a_tools)
        wait("(async () => !!(await window.functionCallingTools.set_ui_opacity({overlay:0.5})).error)()", 'The disabled UI tool rejects a change')
        boot()
        panel('tools-integrations')
        tool_state(own, a_tools)
        ev(f'appLogic.switchProfile({other})')
        tool_state(other, [False, True, False, False])

        client.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        boot('?f4=mobile#settings/appearance')
        panel('appearance')
        wait("innerWidth === 390 && document.querySelector('#settings-title').textContent === 'テーマ・表示'", 'Mobile appearance title')
        click('#settings-menu-btn')
        wait("location.hash === '#settings' && document.querySelector('#settings-screen').classList.contains('settings-show-top')", 'Direct mobile link backs to the category list')
        capture('mobile-settings')
        category('appearance')
        capture('mobile-appearance')
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
        open_color('header-color-input')
        capture('mobile-light-color-picker')
        preset_point = ev("""(() => {
            const r = document.querySelector('.settings-color-preset[data-color="#ffffff"]').getBoundingClientRect();
            return {x:r.left + r.width / 2, y:r.top + r.height / 2};
        })()""")
        client.call('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[preset_point]})
        client.call('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        wait("settingsUiV136.colorPicker.hex.value === '#ffffff' && state.globalSettingsV136.theme.headerColor === '#457123'",
             'Touch preset selection changes only the draft')
        surface = ev("""(() => { const r = document.querySelector('.settings-color-plane').getBoundingClientRect();
            return [{x:r.left + r.width * .25,y:r.top + r.height * .3},{x:r.left+r.width*.75,y:r.top+r.height*.5}]; })()""")
        scroll_before = ev("settingsUiV136.detail.scrollTop")
        client.call('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':surface[:1]})
        client.call('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':surface[1:]})
        client.call('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        assert ev(f"""settingsUiV136.colorPicker.hex.value !== '#ffffff' &&
            state.globalSettingsV136.theme.headerColor === '#457123' &&
            settingsUiV136.detail.scrollTop === {scroll_before} && location.hash === '#settings/appearance'""")
        before_cancel = ev('settingsUiV136.colorPicker.hex.value')
        client.call('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':surface[:1]})
        client.call('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
        assert ev(f"settingsUiV136.colorPicker.hex.value === {json.dumps(before_cancel)}")
        assert ev("""(() => {
            const hue = document.querySelector('.settings-hue'), old = document.getElementById('settings-color-hex').value;
            hue.value = (Number(hue.value) + 180) % 360; hue.dispatchEvent(new Event('input', {bubbles:true}));
            return old !== document.getElementById('settings-color-hex').value;
        })()""")
        client.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':370,'deviceScaleFactor':1,'mobile':True})
        ev("document.getElementById('settings-color-hex').focus()")
        wait("""(() => {
            const dialog = document.getElementById('settings-color-dialog'), bounds = dialog.getBoundingClientRect();
            return bounds.top >= 0 && bounds.bottom <= 370 && dialog.scrollHeight > dialog.clientHeight &&
                document.activeElement.id === 'settings-color-hex';
        })()""", 'The dialog remains scrollable when the visible viewport shrinks')
        client.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
        finish_color('cancel')
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        ev("document.querySelector('#settings-detail').scrollTop = 240")
        saved_top = ev("document.querySelector('#settings-detail').scrollTop")
        assert saved_top > 0
        click('#settings-menu-btn')
        wait("location.hash === '#settings' && settingsUiV136.category === null", 'Mobile detail backs through browser history')
        ev('history.forward()')
        panel('appearance')
        assert ev("document.querySelector('#settings-detail').scrollTop") == saved_top
        boot()
        panel('appearance')
        click('#settings-menu-btn')
        wait("location.hash === '#settings' && settingsUiV136.category === null", 'Reloaded mobile detail preserves its history entry')
        press_enter('[data-settings-category=tools-integrations]')
        panel('tools-integrations')
        wait("document.querySelector('#settings-title').textContent === 'ツール・外部連携'", 'Mobile AI tools title')
        assert ev("document.activeElement.id === 'settings-menu-btn' && document.activeElement.getAttribute('aria-expanded') === 'false'")
        press_enter('#settings-menu-btn')
        wait("location.hash === '#settings' && settingsUiV136.category === null", 'AI tools back to category list')
        assert ev("document.activeElement.dataset.settingsCategory === 'tools-integrations'")
        press_enter('#back-to-chat-from-settings')
        wait("state.currentScreen === 'chat'", 'Mobile category list returns to chat')
        ev('history.back()')
        wait("state.currentScreen === 'settings' && location.hash === '#settings'", 'Browser back restores the category list')
        category('tools-integrations')
        ev('history.back()')
        wait("location.hash === '#settings'", 'Browser back restores the list from detail')
        ev('history.forward()')
        panel('tools-integrations')
        boot()
        panel('tools-integrations')
        tool_state(other, [False, True, False, False])
        click('#settings-menu-btn')
        wait("settingsUiV136.category === null", 'Category list is available for legacy history entries')
        for legacy, current in [('general', 'api-model'), ('ai-tools', 'tools-integrations'),
                                ('integrations', 'data-sync'), ('other', 'chat-operation')]:
            ev(f"location.hash = '#settings/{legacy}'")
            wait(f"state.currentScreen === 'settings' && settingsUiV136.category === '{current}'",
                 f'Legacy settings route {legacy} opens {current}')
            click('#settings-menu-btn')
            wait("settingsUiV136.category === null && location.hash === '#settings'", 'Legacy detail backs to the list')
        category('chat-operation')
        ev("history.replaceState({...history.state, settingsCategory:'other'}, '', '#settings/other')")
        boot()
        wait("settingsUiV136.category === 'chat-operation' && history.state.settingsDetailPushed",
             'Reload restores a legacy mobile detail and its history state')
        click('#settings-menu-btn')
        wait("settingsUiV136.category === null && location.hash === '#settings'", 'Reloaded legacy detail backs through history')
        wait("navigator.serviceWorker.controller?.state === 'activated'", 'The PWA worker controls the current page', timeout=10)
        offline = {'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}
        client.call('Network.emulateNetworkConditions', {'offline':True, **offline})
        try:
            boot('?f4=offline#settings/appearance')
            panel('appearance')
            assert ev("!navigator.onLine && !!navigator.serviceWorker.controller")
            open_color('header-color-input')
            click('.settings-color-preset[data-color="#8756c7"]')
            assert ev("settingsUiV136.colorPicker.hex.value === '#8756c7'")
            finish_color('cancel')
        finally:
            client.call('Network.emulateNetworkConditions', {'offline':False, **offline})
        return ('ALL PASSED (settings pane width, divider, headers, sidebar entry, keyboard toggle and desktop/tablet/phone navigation)\n'
                'ALL PASSED (F4 real page: desktop/mobile history, color picker and offline PWA, theme and background scope)\n'
                'ALL PASSED (F8 real page: AI tools navigation, keyboard, history/reload, profile checkboxes and mocked Gemini requests)')
    finally:
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})

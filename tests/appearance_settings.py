"""F4 and F8 on the real settings screen, including navigation and IndexedDB reloads."""
import json
import time


def run(client, url):
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

    def category(name):
        click(f'[data-settings-category="{name}"]')
        panel(name)

    def panel(name):
        wait(f"state.currentScreen === 'settings' && location.hash === '#settings/{name}' && !document.querySelector('#settings-panel-{name}').hidden",
             f'{name} is restored and visible')

    def change(id, value, event='change'):
        ev(f'''(() => {{
            const control = document.getElementById({json.dumps(id)});
            if (control.type === 'checkbox') control.checked = {json.dumps(value)};
            else control.value = {json.dumps(value)};
            control.dispatchEvent(new Event({json.dumps(event)}, {{bubbles: true}}));
        }})()''')
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
                await appLogic.callApiWithRetry({{messagesForApi:[{{role:'user',content:'F8 check'}}],generationConfig:{{}},isFirstCall:{json.dumps(first)}}});
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
        category('general')
        category('appearance')
        change('dark-mode-toggle', 'light')
        global_theme(False, 'light')
        wait("document.body.classList.contains('light-mode-forced')", 'Light is applied')
        change('dark-mode-toggle', 'dark')
        global_theme(True, 'dark')
        wait("document.body.classList.contains('dark-mode')", 'Dark is applied')
        change('dark-mode-toggle', 'light')

        change('accent-color-input', '#135789', 'input')
        wait("uiUtilsV136.getEffectiveHeaderColor() === '#135789'", 'Accent color is applied')
        click('#reset-accent-color-btn')
        ev('settingsUiV136.saveQueue')
        wait("state.globalSettingsV136.theme.accentColor === appLogic.normalizeGlobalThemeSettings({}).accentColor", 'Accent reset is saved')
        change('theme-color-mode-select', 'individual')
        change('header-color-input', '#457123', 'input')
        wait("uiUtilsV136.getEffectiveHeaderColor() === '#457123'", 'Individual header color is applied')
        change('chat-font-size-select', '20')
        category('other')
        change('history-sort-order', 'title')
        wait("(async () => { const local = (await dbUtils.getSetting('localUiSettings')).value; return local.chatFontSize === 20 && local.historySortOrder === 'title'; })()",
             'Moved display and history settings keep their original persistence')

        boot()
        panel('other')
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
        change('profile-accent-color-input', '#8a2167', 'input')
        change('profile-appearance-override', True)
        change('profile-overlay-opacity-slider', '25', 'input')
        wait(f'''(async () => {{
            const own = (await dbUtils.getProfile({own})).settings;
            return own.theme.darkMode === true && own.theme.accentColor === '#8a2167' && own.appearance.overlayOpacity === 0.25
                && state.settings.darkMode === true && uiUtilsV136.getEffectiveHeaderColor() === '#8a2167' && state.settings.overlayOpacity === 0.25;
        }})()''', 'Profile theme, color and background effect are stored and applied')
        global_theme(False, 'light')
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

        category('ai-tools')
        a_tools = [True, False, True, True]
        b_tools = [False, True, False, True]
        tool_state(own, a_tools, change_values=True)
        change('force-function-calling-toggle', False)
        category('appearance')
        category('ai-tools')
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
        panel('ai-tools')
        tool_state(own, a_tools)
        ev(f'appLogic.switchProfile({other})')
        tool_state(other, [False, True, False, False])

        client.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        boot('?f4=mobile#settings/appearance')
        panel('appearance')
        wait("innerWidth === 390 && document.querySelector('#settings-title').textContent === 'テーマ・表示設定'", 'Mobile appearance title')
        click('#back-to-chat-from-settings')
        wait("location.hash === '#settings' && document.querySelector('#settings-screen').classList.contains('settings-show-top')", 'Direct mobile link backs to the category list')
        category('appearance')
        click('#back-to-chat-from-settings')
        wait("location.hash === '#settings' && settingsUiV136.category === null", 'Mobile detail backs through browser history')
        ev('history.forward()')
        panel('appearance')
        boot()
        panel('appearance')
        click('#back-to-chat-from-settings')
        wait("location.hash === '#settings' && settingsUiV136.category === null", 'Reloaded mobile detail preserves its history entry')
        ev("document.querySelector('[data-settings-category=ai-tools]').focus()")
        for event in ['keyDown', 'keyUp']:
            client.call('Input.dispatchKeyEvent', {'type': event, 'key': 'Enter', 'code': 'Enter', 'windowsVirtualKeyCode': 13})
        panel('ai-tools')
        wait("document.querySelector('#settings-title').textContent === 'AI機能・ツール設定'", 'Mobile AI tools title')
        click('#back-to-chat-from-settings')
        wait("location.hash === '#settings' && settingsUiV136.category === null", 'AI tools back to category list')
        ev('history.forward()')
        panel('ai-tools')
        boot()
        panel('ai-tools')
        tool_state(other, [False, True, False, False])
        return ('ALL PASSED (F4 real page: desktop/mobile history, boolean theme, colors/reset, profile/background scope)\n'
                'ALL PASSED (F8 real page: AI tools navigation, keyboard, history/reload, profile checkboxes and mocked Gemini requests)')
    finally:
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})

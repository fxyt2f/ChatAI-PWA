"""Capacity, real profile switching, bounded rendering and backup in isolated Chrome."""
import json
import time


def run(client, url):
    socket_timeout = client.sock.gettimeout()
    client.sock.settimeout(30)
    timings = {}
    trigger = '#profile-card-header'
    settings_trigger = '#profile-card-header-settings'
    picker = '.profile-picker-panel'
    rows = '.profile-picker-choice'

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
            time.sleep(0.04)
        info = ev("""[window.state?.currentScreen, window.state?.activeProfileId, window.state?.profiles.length,
            document.querySelector('.profile-picker-status')?.textContent, document.activeElement?.className]""")
        raise AssertionError(f'{label}: {info}')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def row_selector(profile_id):
        return f'{rows}[data-profile-id="{profile_id}"]'

    def pointer_click(selector, touch=False):
        point = ev(f"""(() => {{
            const element = document.querySelector({json.dumps(selector)});
            const box = element.getBoundingClientRect();
            const x = Math.floor((box.left + box.right) / 2), y = Math.floor((box.top + box.bottom) / 2);
            return {{x, y, hit: element.contains(document.elementFromPoint(x, y))}};
        }})()""")
        assert point.pop('hit'), (selector, point)
        if touch:
            client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            for event in ('mousePressed', 'mouseReleased'):
                client.call('Input.dispatchMouseEvent', {**point, 'type': event, 'button': 'left', 'clickCount': 1})

    def key(name, code):
        for event in ('keyDown', 'keyUp'):
            client.call('Input.dispatchKeyEvent', {'type': event, 'key': name, 'code': name, 'windowsVirtualKeyCode': code})

    def viewport(width, height=820):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': width < 800})
        wait(f'innerWidth === {width} && settingsUiV136.media.matches === {str(width >= 800).lower()}',
             f'Viewport {width}px')

    def boot(reload=False):
        origin = ev('performance.timeOrigin')
        client.call('Page.reload' if reload else 'Page.navigate',
                    {} if reload else {'url': url + '?profilePickerFixture=1'})
        wait(f"""performance.timeOrigin > {origin} && window.appLogic?._setupEventListenersCallCount
            && state.activeProfile && !state.executionInitializingV136 && !document.querySelector('#progressDialog[open]')""",
             'Application startup completed')
        ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        if ev("Boolean(document.querySelector('#releaseNotesDialog[open]'))"):
            click('#releaseNotesDialog .dialog-ok-btn')
            wait("!document.querySelector('#releaseNotesDialog[open]')", 'Release notes closed')

    def open_picker(anchor=trigger):
        click(anchor)
        wait("settingsUiV136.popover?.matches('.profile-picker-panel')", 'Profile picker opened')

    def open_with_pointer(anchor, touch):
        pointer_click(anchor, touch)
        wait("settingsUiV136.popover?.matches('.profile-picker-panel')", f'Profile picker opened from {anchor}')

    def assert_selected(profile_id):
        assert ev(f"""(async () => {{
            const profile = state.activeProfile, id = {profile_id};
            if (profile?.id !== id || state.activeProfileId !== id ||
                (await dbUtils.getSetting('activeProfileId'))?.value !== id) return false;
            const url = state.profileIconUrls.get(id)?.url;
            return ['#profile-card-icon-container', '#profile-card-icon-container-settings'].every(selector => {{
                const icon = document.querySelector(selector);
                return profile.icon ? Boolean(url) && icon.querySelector('img')?.src === url :
                    icon.querySelector('.material-symbols-outlined')?.textContent === 'account_circle';
            }}) && document.querySelector('#profile-card-name-settings').textContent === profile.name &&
                document.querySelector('#profile-display-name-main').textContent === profile.name;
        }})()"""), f'Profile {profile_id} is selected in memory, both displays and IndexedDB'

    def select_with_pointer(profile_id, touch, label):
        pointer_click(row_selector(profile_id), touch)
        wait(f"!settingsUiV136.popover && state.activeProfileId === {profile_id}", label)
        assert_selected(profile_id)

    def close_picker():
        ev('settingsUiV136.closePopover(true)')
        assert ev("state.profileIconUrls.size <= 1 && !settingsUiV136.popover")

    def query(value):
        ev(f"""(() => {{
            const search = document.querySelector('{picker} input');
            search.value = {json.dumps(value)};
            search.dispatchEvent(new Event('input', {{bubbles: true}}));
        }})()""")

    def result_ids():
        return ev(f"[...document.querySelectorAll('{rows}')].map(row => Number(row.dataset.profileId))")

    def composer_bounds():
        return ev("""['#user-input', '#send-button', '#message-container'].map(selector => {
            const {x, y, width, height} = document.querySelector(selector).getBoundingClientRect();
            return [x, y, width, height];
        })""")

    def desktop_position():
        return ev(f"""(() => {{
            const panel = settingsUiV136.popover, box = panel.getBoundingClientRect();
            const button = document.querySelector('{trigger}').getBoundingClientRect();
            return !panel.matches(':modal') && Math.abs(box.left - button.left) < 0.5 &&
                Math.abs(box.bottom - (button.top - 6)) < 0.5 && box.top >= 8 && box.right <= innerWidth - 8;
        }})()""")

    def seed(count):
        ev(f"""(async () => {{
            const current = await dbUtils.countProfiles();
            await new Promise((resolve, reject) => {{
                const tx = state.db.transaction('profiles', 'readwrite'), profiles = tx.objectStore('profiles');
                for (let n = current + 1; n <= {count}; n++) {{
                    const label = 'Profile ' + String(n).padStart(3,'0') + ' 日本語' + n;
                    profiles.add({{name: label, createdAt:n, settings:{{systemPrompt:'prompt-' + n, maxTokens:100 + n}},
                        icon: n % 5 === 0 ? null : new Blob([
                            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="hsl(' +
                            n % 360 + ' 70% 50%)"/></svg>'
                        ], {{type:'image/svg+xml'}})}});
                }}
                tx.oncomplete = resolve;
                tx.onabort = () => reject(tx.error);
            }});
        }})()""")

    def sample(count):
        result = ev(f"""(async () => {{
            const frame = () => new Promise(requestAnimationFrame);
            let now = performance.now();
            await appLogic.loadProfiles();
            const load = performance.now() - now;
            if (state.profiles.length !== {count}) throw new Error('Unexpected profile count');
            now = performance.now();
            document.querySelector('{trigger}').click();
            await frame();
            const open = performance.now() - now;
            const root = settingsUiV136.popover;
            const list = root.querySelector('.profile-picker-list');
            const rows = root.querySelectorAll('{rows}').length;
            const urls = state.profileIconUrls.size;
            const search = root.querySelector('input');
            now = performance.now();
            search.value = '日本語' + Math.min(2,{count});
            search.dispatchEvent(new Event('input', {{bubbles:true}}));
            await frame();
            const searchMs = performance.now() - now;
            const selected = root.querySelector('{rows}');
            const id = Number(selected.dataset.profileId);
            now = performance.now();
            selected.click();
            while (settingsUiV136.popover === root && performance.now() - now < 2500) await frame();
            if (state.activeProfileId !== id || settingsUiV136.popover) throw new Error('Profile switch did not complete');
            return {{load, open, search: searchMs, switch: performance.now()-now, rows, urls}};
        }})()""")
        assert 0 < result['rows'] <= 24 and result['urls'] <= result['rows'] + 1, result
        assert result['load'] < 2000 and result['open'] < 500 and result['search'] < 500 and result['switch'] < 2000, result
        timings[str(count)] = {k: round(v, 1) for k, v in result.items()}

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?profilePickerFixture=1') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
        }
    """})['identifier']
    try:
        boot()
        seed(5)
        ev('appLogic.loadProfiles()')
        a, b = ev('state.profiles.slice(0, 2).map(profile => profile.id)')
        ev("""(async () => {
            await appLogic.saveApiConfigs([{id:'profile-e2e-api', name:'Profile fixture', provider:'openrouter',
                apiKey:'fixture', modelCandidates:['profile-e2e-model']}]);
            await appLogic.setCurrentChatModelRef({apiConfigId:'profile-e2e-api', modelName:'profile-e2e-model'});
        })()""")
        model_ref = {'apiConfigId': 'profile-e2e-api', 'modelName': 'profile-e2e-model'}
        assert ev('appLogic.getCurrentChatModelRef()') == model_ref
        for width in (1280, 375):
            viewport(width)
            for anchor in (trigger, settings_trigger):
                label = f'Trusted selection {width}px {anchor}'
                ev(f'appLogic.switchProfile({a})')
                assert_selected(a)
                screen = 'chat' if anchor == trigger else 'settings'
                ev(f"uiUtilsV136.showScreen('{screen}', true)")
                if anchor == settings_trigger:
                    ev("settingsUiV136.selectCategory('profile', false)")
                open_with_pointer(anchor, width < 800)
                select_with_pointer(b, width < 800, label)
                assert ev("state.currentSystemPrompt === 'prompt-2' && appLogic.getChatGenerationParameters().maxTokens === 102 && document.querySelector('#max-tokens').value === '102'")
                assert ev('appLogic.getCurrentChatModelRef()') == model_ref
        boot(reload=True)
        assert_selected(b)
        assert ev('appLogic.getCurrentChatModelRef()') == model_ref
        ev("uiUtilsV136.showScreen('chat', true)")
        viewport(1280)
        for count in (5, 50, 200, 500):
            seed(count)
            ev("appLogic.switchProfile(state.profiles[0].id)")
            sample(count)

        seed(998)
        assert ev("""(async () => {
            const profile = {name:'Profile 999 日本語999', settings:{systemPrompt:'prompt-999'}, createdAt:999};
            const [created, imported] = await Promise.allSettled([
                dbUtils.addProfile(profile), appLogic.addImportedProfileV136(profile)
            ]);
            const results = [created, imported];
            return results.filter(item => item.status === 'fulfilled').length === 1 &&
                results.find(item => item.status === 'rejected').reason.message.includes('999') &&
                await dbUtils.countProfiles() === 999;
        })()"""), 'Concurrent creation and import can only claim one remaining slot'
        ev("appLogic.switchProfile(state.profiles[0].id)")
        sample(999)
        assert ev("""(async () => {
            const [created, imported] = await Promise.allSettled([
                dbUtils.addProfile({name:'overflow',settings:{}}), appLogic.addImportedProfileV136({name:'overflow',settings:{}})
            ]);
            return [created, imported].every(result => result.status === 'rejected' && result.reason.message.includes('999'));
        })()""")
        ev("void appLogic.saveNewProfile()")
        wait("document.querySelector('#alertDialog[open]')?.textContent.includes('999')", 'Capacity alert for UI creation')
        click('#alertDialog .dialog-ok-btn')
        wait("!appLogic.profileAddPending", 'Limit notice completed')

        ids = ev("state.profiles.map(p => p.id)")
        first, middle, last = ids[0], ids[499], ids[-1]
        ev(f'appLogic.switchProfile({first})')
        open_picker()
        query('nO SuCh ProFile')
        assert result_ids() == [] and ev("document.querySelector('.profile-picker-status').textContent === '該当するプロファイルがありません'")
        assert ev('state.activeProfileId') == first
        query('pRoFiLe 500')
        assert result_ids() == [middle]
        assert ev(f"document.querySelector('{rows} .material-symbols-outlined').textContent === 'account_circle'")
        query('日本語501')
        assert len(result_ids()) == 1
        assert ev(f"(async () => {{ const image = document.querySelector('{rows} img'); await image.decode(); return image.naturalWidth > 0; }})()")
        query('')
        assert len(result_ids()) <= 24
        assert desktop_position(), 'Clearing the search keeps the picker anchored to the profile button'
        ev("document.querySelector('.profile-picker-list').scrollTop = document.querySelector('.profile-picker-list').scrollHeight")
        wait(f"document.querySelector('{rows}[data-profile-id=\"{last}\"]')", 'Last row is reachable by scrolling')
        assert ev(f"document.querySelectorAll('{rows}').length <= 24 && state.profileIconUrls.size <= 25")
        select_with_pointer(last, False, 'Click selects the 999th profile from the virtual list')
        open_with_pointer(trigger, False)
        query(ev('state.profiles[0].name'))
        select_with_pointer(first, False, 'Return to the first profile through search')

        viewport(375)
        open_picker()
        ev(f"""(() => {{
            const search = document.querySelector('{picker} input');
            search.focus();
            search.dispatchEvent(new CompositionEvent('compositionstart', {{bubbles:true}}));
            search.value = '日本語999';
            search.dispatchEvent(new InputEvent('input', {{bubbles:true, isComposing:true}}));
        }})()""")
        key('Enter', 13)
        assert len(result_ids()) > 1 and ev('state.activeProfileId') == first
        ev(f"document.querySelector('{picker} input').dispatchEvent(new CompositionEvent('compositionend', {{bubbles:true}}))")
        assert result_ids() == [last]
        select_with_pointer(last, True, 'Last profile selected on mobile after IME search')
        assert ev("state.currentSystemPrompt === 'prompt-999' && state.profileIconUrls.size <= 1")

        # Fail the active-profile write inside the real transaction.
        ev("""(() => {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(value) {
                if (this.name === 'settings' && value.key === 'activeProfileId') {
                    IDBObjectStore.prototype.put = put;
                    throw new Error('controlled profile switch failure');
                }
                return put.apply(this, arguments);
            };
            const input = document.getElementById('user-input');
            input.value = '選択失敗時の下書き';
            input.dispatchEvent(new Event('input', {bubbles:true}));
        })()""")
        open_with_pointer(trigger, True)
        query('pRoFiLe 500')
        pointer_click(row_selector(middle), True)
        wait("document.querySelector('#alertDialog[open]')?.textContent.includes('controlled profile switch failure')",
             'Failure uses existing switch error dialog')
        assert ev(f"""state.activeProfileId === {last} && settingsUiV136.popover.profileSwitchPending &&
            document.getElementById('user-input').value === '選択失敗時の下書き'""")
        assert_selected(last)
        click('#alertDialog .dialog-ok-btn')
        wait("document.querySelector('.profile-picker-status').textContent.includes('切り替えられませんでした')",
             'Picker reports the failed switch without changing the selection')
        select_with_pointer(middle, True, 'Mid-list profile selected after retry')
        assert ev("state.currentSystemPrompt === 'prompt-500'")
        open_picker()
        query('日本語999')
        select_with_pointer(last, True, 'Return to the original profile after retry')
        wait(f"state.activeProfileId === {last} && document.getElementById('user-input').value === '選択失敗時の下書き'",
             'Returning to a profile restores its input draft')

        viewport(1280)
        open_with_pointer(trigger, False)
        query('Profile 50')
        ev("""(() => {
            const save = dbUtils.saveChat;
            let release;
            const paused = new Promise(resolve => { release = resolve; });
            window.profileSwitchWrites = 0;
            dbUtils.saveChat = async function(...args) {
                if (args[2]?.systemPromptSave?.profileSwitch) {
                    window.profileSwitchWrites++;
                    await paused;
                }
                return save.apply(this, args);
            };
            window.releaseProfileSwitch = () => { dbUtils.saveChat = save; release(); };
        })()""")
        try:
            pointer_click(row_selector(middle))
            wait('settingsUiV136.popover?.profileSwitchPending && profileSwitchWrites === 1', 'First selection is saving')
            pointer_click(row_selector(ids[500]))
            assert ev('profileSwitchWrites') == 1
            assert_selected(last)
        finally:
            ev('releaseProfileSwitch()')
        wait(f"!settingsUiV136.popover && state.activeProfileId === {middle}", 'Only the first pending selection is applied')
        assert_selected(middle)
        open_with_pointer(trigger, False)
        query('pRoFiLe 500')
        select_with_pointer(middle, False, 'Reselecting the current profile preserves the active ID')
        open_with_pointer(trigger, False)
        query('日本語999')
        select_with_pointer(last, False, 'Return to the profile with the draft')

        for width in (320, 375, 430, 600, 768, 799, 800, 801, 1024, 1280):
            viewport(width)
            touch = width < 800
            for wide in ((True,) if width < 800 else (False, True)):
                ev(f"""(async () => {{
                    await appLogic.updateLocalUiSetting('enableWideMode', {str(wide).lower()});
                    appLogic.applyWideMode();
                }})()""")
                for dark in (False, True):
                    label = (width, wide, dark)
                    ev(f"appLogic.saveAppearanceValues('theme', {{darkMode: {str(dark).lower()}}}, {{global: true}})")
                    before = composer_bounds()
                    open_with_pointer(trigger, touch)
                    assert ev(f"""(() => {{
                        const panel = settingsUiV136.popover, box = panel.getBoundingClientRect();
                        const list = panel.querySelector('.profile-picker-list'), search = panel.querySelector('input');
                        return panel.matches(':modal') === {str(width < 800).lower()} &&
                            document.body.classList.contains('dark-mode') === {str(dark).lower()} &&
                            document.body.classList.contains('wide-mode-enabled') === {str(wide).lower()} &&
                            box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
                            list.clientHeight > 0 && list.scrollHeight > list.clientHeight &&
                            list.querySelector('{rows}').offsetHeight === 44 &&
                            list.querySelector('[aria-pressed=true]')?.dataset.profileId === '{last}' &&
                            getComputedStyle(search).borderRadius === '10px' &&
                            list.querySelectorAll('{rows}').length <= 24;
                    }})()"""), label
                    if width >= 800:
                        assert desktop_position() and composer_bounds() == before, label
                        assert ev("""(() => {
                            const panel = settingsUiV136.popover, box = panel.getBoundingClientRect();
                            const input = document.querySelector('#user-input').getBoundingClientRect();
                            const x = Math.max(box.left, input.left), y = Math.max(box.top, input.top);
                            const right = Math.min(box.right, input.right), bottom = Math.min(box.bottom, input.bottom);
                            return x < right && y < bottom &&
                                panel.contains(document.elementFromPoint((x + right) / 2, (y + bottom) / 2));
                        })()"""), label
                    query('pRoFiLe 500')
                    assert result_ids() == [middle] and (touch or desktop_position()), label
                    select_with_pointer(middle, touch, f'Chat selection {label}')
                    assert ev("state.currentSystemPrompt === 'prompt-500'")
                    ev("uiUtilsV136.showScreen('settings', true); settingsUiV136.selectCategory('profile', false)")
                    open_with_pointer(settings_trigger, touch)
                    assert ev("settingsUiV136.popover.matches(':modal')") == touch, label
                    query('日本語999')
                    select_with_pointer(last, touch, f'Settings selection {label}')
                    assert ev("state.currentSystemPrompt === 'prompt-999'")
                    ev("uiUtilsV136.showScreen('chat', true)")

        viewport(800, 290)
        open_picker()
        assert desktop_position() and ev("""(() => {
            const list = settingsUiV136.popover.querySelector('.profile-picker-list');
            return list.clientHeight >= 44 && list.scrollHeight > list.clientHeight;
        })()"""), 'Short desktop viewport keeps the picker above the button and the list scrollable'
        close_picker()

        viewport(375, 370)
        open_picker()
        assert ev("""(() => {
            const viewport = visualViewport;
            Object.defineProperty(viewport, 'height', {configurable:true, value:250});
            try {
                settingsUiV136.positionPopover();
                const panel = settingsUiV136.popover, search = panel.querySelector('input');
                search.focus();
                return panel.getBoundingClientRect().bottom <= 250 &&
                    search.getBoundingClientRect().bottom <= 250 &&
                    panel.querySelector('.profile-picker-list').clientHeight >= 44;
            } finally { delete viewport.height; settingsUiV136.positionPopover(); }
        })()"""), 'Picker remains usable at a reduced visual viewport'
        key('Escape', 27)
        wait("!settingsUiV136.popover && document.activeElement.id === 'profile-card-header'", 'Escape restores focus')
        assert_selected(last)

        viewport(799)
        open_picker()
        query('日本語999')
        viewport(800)
        wait("settingsUiV136.popover && !settingsUiV136.popover.matches(':modal')", 'Open picker becomes a popover at 800px')
        assert result_ids() == [last]
        viewport(799)
        wait("settingsUiV136.popover?.matches(':modal')", 'Open picker becomes a modal below 800px')
        assert result_ids() == [last]
        close_picker()

        viewport(1280)
        open_picker()
        key('ArrowDown', 40)
        key('End', 35)
        assert ev(f"document.activeElement.dataset.profileId === '{last}'")
        close_picker()
        open_picker()
        client.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': 2, 'y': 2, 'button': 'left', 'clickCount': 1})
        client.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': 2, 'y': 2, 'button': 'left', 'clickCount': 1})
        wait(f"!settingsUiV136.popover && state.activeProfileId === {last}", 'Outside click does not select a profile')

        ev("uiUtilsV136.showScreen('settings', true)")
        ev("settingsUiV136.selectCategory('profile', false)")
        open_picker('#profile-card-header-settings')
        query('pRoFiLe 500')
        click(f'{rows}[data-profile-id="{middle}"]')
        wait(f"!settingsUiV136.popover && state.activeProfileId === {middle}", 'Settings uses the same selection')
        assert ev("""(async () => {
            const icon = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>'], {type:'image/svg+xml'});
            await appLogic.updateCurrentProfile({name:'Renamed profile 中間 ' + '長い名前'.repeat(25),icon});
            const previous = state.profileIconUrls.get(state.activeProfileId)?.url;
            if (!previous) return false;
            await appLogic.updateCurrentProfile({icon:null});
            const revoked = await fetch(previous).then(() => false, () => true);
            return revoked && document.querySelector('#profile-card-icon-container .material-symbols-outlined')?.textContent === 'account_circle';
        })()"""), 'Icon replacement and reset release old object URLs'
        open_picker('#profile-card-header-settings')
        query('中間')
        assert result_ids() == [middle]
        assert ev("""(() => {
            const row = document.querySelector('.profile-picker-choice');
            const name = row.querySelector('.profile-picker-name');
            row.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
            return name.scrollWidth > name.clientWidth && row.title === state.activeProfile.name &&
                document.querySelector('.profile-picker-status').textContent === row.title;
        })()"""), 'Long names are truncated in the row and available in full'
        close_picker()
        namesake = ids[498]
        ev(f'appLogic.updateCurrentProfile({{name: state.activeProfile.name}}, {namesake})')
        open_with_pointer(settings_trigger, False)
        query('中間')
        assert set(result_ids()) == {namesake, middle}
        select_with_pointer(namesake, False, 'Select the other profile with the same long name')
        assert ev("state.currentSystemPrompt === 'prompt-499'")
        open_with_pointer(settings_trigger, False)
        query('中間')
        select_with_pointer(middle, False, 'Select the original profile by ID from identical names')
        assert ev("state.currentSystemPrompt === 'prompt-500'")
        ev("void appLogic.deleteCurrentProfile()")
        wait("document.querySelector('#confirmDialog[open]')?.textContent.includes('Renamed profile')", 'Delete uses existing confirmation')
        click('#confirmDialog .dialog-ok-btn')
        wait(f"state.activeProfileId !== {middle} && state.profiles.length === 998", 'Delete frees one slot')

        ev("void appLogic.saveNewProfile()")
        wait("document.querySelector('#promptDialog[open]')", 'Creation prompts for a profile name')
        ev("""void appLogic.saveNewProfile();
            void appLogic.importProfile(new File(['{}'], 'duplicate-action.json'))""")
        ev("document.querySelector('#promptDialog input').value = 'Created after delete'")
        click('#promptDialog .dialog-ok-btn')
        wait("state.activeProfile?.name === 'Created after delete' && !appLogic.profileAddPending", 'Create reuses free slot')
        assert ev('dbUtils.countProfiles()') == 999
        created_id = ev("state.activeProfileId")
        ev("void appLogic.deleteCurrentProfile()")
        wait("document.querySelector('#confirmDialog[open]')", 'Delete temporary profile')
        click('#confirmDialog .dialog-ok-btn')
        wait(f"state.activeProfileId !== {created_id} && state.profiles.length === 998", 'A slot is available for import')
        ev("""void appLogic.importProfile(new File([JSON.stringify({
            name:state.profiles[0].name, settings:{systemPrompt:'imported-prompt'}
        })], 'profile.json', {type:'application/json'}))""")
        wait("document.querySelector('#alertDialog[open]')?.textContent.includes('インポートしました')", 'Real file import completes')
        click('#alertDialog .dialog-ok-btn')
        wait("!appLogic.profileAddPending", 'Import notice closed')
        assert ev("state.activeProfile.name.startsWith('(取込) ') && state.currentSystemPrompt === 'imported-prompt'")
        assert ev('dbUtils.countProfiles()') == 999
        saved_id = ev('state.activeProfileId')

        backup = ev("""(async () => {
            const records = await dbUtils.getAllProfiles();
            const signature = items => JSON.stringify(items.map(p => [p.id, p.name, p.settings.systemPrompt, p.icon?.size ?? null]));
            const getProfile = dbUtils.getProfile;
            let reads = 0, exported;
            dbUtils.getProfile = function (...args) { reads++; return getProfile.apply(this,args); };
            let start = performance.now();
            try { exported = await appLogic._prepareExportData(); }
            finally { dbUtils.getProfile = getProfile; }
            const exportMs = performance.now() - start;
            const payload = JSON.parse(exported.metadataJson);
            const excess = structuredClone(payload);
            excess.data.profiles.push({...payload.data.profiles[0],id:5000});
            let rejected = false;
            try { await appLogic.importDataFromString(JSON.stringify(excess)); }
            catch (error) { rejected = error.message.includes('999'); }
            if (!rejected || signature(await dbUtils.getAllProfiles()) !== signature(records))
                throw new Error('An over-capacity backup changed the current profiles');
            const mock = window.dropboxApi;
            window.dropboxApi = { downloadAsset: async id => exported.localAssets.get(id)?.blob };
            start = performance.now();
            try { await appLogic.importDataFromString(exported.metadataJson); }
            finally { window.dropboxApi = mock; }
            const importMs = performance.now() - start;
            const restored = await dbUtils.getAllProfiles();
            return {profiles:payload.data.profiles.length, icons:payload.data.profiles.filter(p => p.iconAssetId).length,
                reads, exportMs, importMs, same:signature(records) === signature(restored)};
        })()""")
        assert backup['profiles'] == 999 and backup['icons'] > 500 and backup['reads'] == 0 and backup['same'], backup
        boot(reload=True)
        assert ev('state.activeProfileId') == saved_id and ev('dbUtils.countProfiles()') == 999
        timings['backup'] = {k: round(v, 1) if isinstance(v, float) else v for k, v in backup.items()}
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        viewport(1280, 900)
        client.sock.settimeout(socket_timeout)

    return 'ALL PASSED (999-profile capacity, picker, icons, backup and 28 layouts)\nALL PASSED profile timings in ms: ' + json.dumps(timings)

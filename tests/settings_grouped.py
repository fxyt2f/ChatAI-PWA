"""Real-page checks and captures for grouped settings."""
import base64
import json
from pathlib import Path
import time


def run(client, url, screenshots=None):
    def evaluate(expression):
        response = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in response:
            raise RuntimeError(response['exceptionDetails'])
        return response['result'].get('value')

    def wait(expression, label):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if evaluate(expression):
                return
            time.sleep(0.05)
        context = evaluate("({url: location.hash, history: history.state, category: window.settingsUiV136?.category})")
        raise AssertionError(f'{label}: {context}')

    def viewport(width, height):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })
        wait(f'innerWidth === {width} && innerHeight === {height}', f'{width}×{height}px viewport')

    def click(selector):
        evaluate(f'document.querySelector({json.dumps(selector)}).click()')

    def row_point(selector, horizontal=.5):
        return evaluate(f"""(() => {{
            const node = document.querySelector({json.dumps(selector)});
            node.scrollIntoView({{block:'nearest'}});
            const rect = node.getBoundingClientRect();
            return {{x:rect.left + rect.width * {horizontal}, y:rect.top + rect.height / 2}};
        }})()""")

    def hit(selector, horizontal=.5):
        point = row_point(selector, horizontal)
        for event in ('mousePressed', 'mouseReleased'):
            client.call('Input.dispatchMouseEvent', {'type': event, 'button': 'left', 'clickCount': 1, **point})

    def tap(selector, horizontal=.5):
        point = row_point(selector, horizontal)
        client.call('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[point]})
        client.call('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})

    def assert_prompt_open(prompt_id):
        checks = evaluate(f"""(() => {{
            const input = document.getElementById({json.dumps(prompt_id)});
            const editor = input.parentElement;
            const row = editor.previousElementSibling;
            const style = getComputedStyle(input);
            const value = input.getBoundingClientRect();
            return {{
                focused: document.activeElement === input,
                expanded: row.getAttribute('aria-expanded') === 'true',
                restBackground: getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)',
                noPaintOverflow: ['none', 'rgba(0, 0, 0, 0) 0px -1px 0px 0px, rgba(0, 0, 0, 0) 0px 1px 0px 0px']
                    .includes(getComputedStyle(row).boxShadow),
                topGap: value.top - row.getBoundingClientRect().bottom >= 6,
                bottomGap: parseFloat(getComputedStyle(editor).paddingBottom) >= 12,
                inset: style.paddingTop === '12px',
                border: style.borderTopWidth === '1px',
                noBrowserOutline: style.outlineStyle === 'none'
            }};
        }})()""")
        assert all(checks.values()), (prompt_id, checks)

    def hover(selector):
        point = evaluate(f"""(() => {{
            const node = document.querySelector({json.dumps(selector)});
            node.scrollIntoView({{block:'nearest'}});
            const rect = node.getBoundingClientRect();
            return {{x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}};
        }})()""")
        client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', **point})

    def assert_island_edges(selector, reference=None):
        box = evaluate(f"""(() => {{
            const row = document.querySelector({json.dumps(selector)});
            const surface = row.closest('.settings-dependent-group:not(.profile-appearance-editor),.settings-island');
            const bounds = surface.getBoundingClientRect(), area = row.getBoundingClientRect();
            const start = node => node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft);
            const reference = {json.dumps(reference)};
            return {{left:area.left - bounds.left, right:bounds.right - area.right,
                label:reference ? start(row) - start(document.querySelector(reference)) : 0}};
        }})()""")
        assert all(abs(value) <= 1 for value in box.values()), (selector, box)

    def key(name, code):
        for event in ('keyDown', 'keyUp'):
            data = {'type':event, 'key':name, 'code':name, 'windowsVirtualKeyCode':code}
            if event == 'keyDown' and name == 'Enter':
                data['text'] = '\r'
            client.call('Input.dispatchKeyEvent', data)

    def assert_center(left, right, row=None):
        result = evaluate(f"""(() => {{
            const left = document.querySelector({json.dumps(left)}).getBoundingClientRect();
            const right = document.querySelector({json.dumps(right)}).getBoundingClientRect();
            const rowSelector = {json.dumps(row)};
            const row = rowSelector ? document.querySelector(rowSelector).getBoundingClientRect() : left;
            return {{left:left.top + left.height/2, right:right.top + right.height/2,
                row:row.top + row.height/2, leftHeight:left.height, rightHeight:right.height}};
        }})()""")
        assert result['leftHeight'] > 0 and result['rightHeight'] > 0
        assert abs(result['left'] - result['right']) <= 1 and abs(result['row'] - result['right']) <= 1, (left, result)

    def category(name, mobile=False):
        if mobile and evaluate('Boolean(settingsUiV136.category)'):
            click('#settings-menu-btn')
            wait('settingsUiV136.category === null', 'Back to settings list')
        click(f'[data-settings-category="{name}"]')
        wait(f"settingsUiV136.category === '{name}' && !settingsUiV136.detail.closest('[inert]')",
             f'{name} is open')
        evaluate('settingsUiV136.detail.scrollTop = 0')

    def capture(name, dialog=None):
        if screenshots is None:
            return
        wait(f"""document.querySelector('dialog[open]')?.id === {json.dumps(dialog) if dialog else 'undefined'} &&
            ![document.querySelector('#settings-screen'), settingsUiV136.popover, document.querySelector('dialog[open]')].filter(Boolean).some(
                node => node.getAnimations({{subtree:true}}).some(a => a.playState === 'running'))""",
             'Settings transitions settled')
        destination = screenshots / f'{name}.png'
        destination.parent.mkdir(parents=True, exist_ok=True)
        png = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})['data']
        destination.write_bytes(base64.b64decode(png))

    def check_row_palette(selector, dark, capture_prefix=None):
        measure = f"""(() => {{
            const row = document.querySelector({json.dumps(selector)});
            const style = getComputedStyle(row);
            const value = row.querySelector('.settings-row-value');
            const arrow = getComputedStyle(row, '::after');
            const canvas = document.createElement('canvas').getContext('2d');
            const luminance = color => {{
                canvas.clearRect(0, 0, 1, 1);
                canvas.fillStyle = color;
                canvas.fillRect(0, 0, 1, 1);
                return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3)
                    .map(value => value / 255)
                    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
                    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
            }};
            const bg = style.backgroundColor === 'rgba(0, 0, 0, 0)'
                ? getComputedStyle(row.closest('.settings-island,.settings-choice-popover')).backgroundColor
                : style.backgroundColor;
            const foreground = [style.color, value && getComputedStyle(value).color,
                arrow.content !== 'none' && arrow.color].filter(Boolean);
            const surface = luminance(bg);
            return {{foreground, surface, contrast: foreground.map(color => {{
                const fg = luminance(color);
                return (Math.max(fg, surface) + .05) / (Math.min(fg, surface) + .05);
            }})}};
        }})()"""
        outside = {'x':1, 'y':1}
        client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', **outside})
        point = row_point(selector)
        values = [evaluate(measure)]
        if capture_prefix:
            capture(f'{capture_prefix}-normal')
        client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', **point})
        values.append(evaluate(measure))
        if capture_prefix:
            capture(f'{capture_prefix}-hover')
        client.call('Input.dispatchMouseEvent', {'type':'mousePressed', 'button':'left', 'clickCount':1, **point})
        values.append(evaluate(measure))
        if capture_prefix:
            capture(f'{capture_prefix}-pressed')
        client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', 'buttons':1, **outside})
        client.call('Input.dispatchMouseEvent', {'type':'mouseReleased', 'button':'left', **outside})
        assert all(sample['foreground'] == values[0]['foreground'] for sample in values), (selector, values)
        assert all(min(sample['contrast']) >= 4.5 for sample in values), (selector, values)
        surfaces = [sample['surface'] for sample in values]
        assert (surfaces[0] < surfaces[1] < surfaces[2] if dark else surfaces[0] > surfaces[1] > surfaces[2]), (selector, values)

    def model_button(select_id):
        return f'.settings-field:has(> #{select_id}) > .settings-row-action'

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    # Allow the initial Worker to activate without an app reload during a gesture or capture.
    client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """(() => {
        const worker = navigator.serviceWorker;
        const addListener = worker.addEventListener.bind(worker);
        worker.addEventListener = (type, ...args) => {
            if (type !== 'controllerchange') return addListener(type, ...args);
        };
    })()"""})
    client.call('Page.navigate', {'url': url + '?groupedSettings=1#settings/ai-assistance'})
    wait("navigator.serviceWorker?.controller?.state === 'activated'", 'App shell is controlled')
    wait("""window.state?.currentScreen === 'settings' && !!window.appLogic?._setupEventListenersCallCount
        && !document.querySelector('#progressDialog[open]')""", 'Settings boot')
    if evaluate("Boolean(document.querySelector('#releaseNotesDialog[open]'))"):
        click('#releaseNotesDialog .dialog-ok-btn')
        wait("!document.querySelector('#releaseNotesDialog[open]')", 'Release notes dismissed')

    evaluate("""(async () => {
        await appLogic.saveApiConfigs([
            {id:'group-gem', name:'Gemini', provider:'gemini', apiKey:'fixture', modelCandidates:['gemini-2.5-flash','gemini-2.5-pro']},
            {id:'group-or', name:'OpenRouter', provider:'openrouter', apiKey:'fixture',
                modelCandidates:['deepseek/deepseek-v3.2',
                    'lab/very-long-model-name-for-the-settings-overflow-check-0123456789012345678901234567890123456789012345']},
            {id:'group-disabled', name:'Disabled API', provider:'openrouter', apiKey:'fixture',
                enabled:false, modelCandidates:['hidden/disabled-route']}
        ]);
        await appLogic.setCurrentChatModelRef({apiConfigId:'group-gem',modelName:'gemini-2.5-flash'});
        await appLogic.saveGlobalSettingsV136({
            showThoughtProcess:true, enableThoughtTranslation:true, enableProofreading:true,
            thoughtTranslationModelRef:{apiConfigId:'group-gem',modelName:'gemini-2.5-flash'}
        });
        await appLogic.setProfileOverride('theme', false);
        await appLogic.saveAppearanceValues('theme', {darkMode:false,themeColorMode:'accent'}, {global:true});
    })()""")

    toggle = '#enable-chat-title-generation'
    assert evaluate(f"document.querySelector('{toggle}').matches('input[type=checkbox][role=switch]')")
    evaluate(f"""(() => {{
        const control = document.querySelector('{toggle}');
        window.titleToggleChanges = 0;
        control.addEventListener('change', () => titleToggleChanges++);
        control.focus();
    }})()""")
    for event in ('keyDown', 'keyUp'):
        client.call('Input.dispatchKeyEvent', {'type': event, 'key': ' ', 'code': 'Space', 'windowsVirtualKeyCode': 32})
    wait("(async()=> (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.enableChatTitleGeneration === true)()",
         'Keyboard switch saves the setting')
    assert evaluate('titleToggleChanges === 1')
    click(f'label:has({toggle})')
    wait("!state.globalSettingsV136.enableChatTitleGeneration && titleToggleChanges === 2", 'The label saves once')
    assert evaluate("""(() => {
        const section = document.querySelector('#proofreading-settings');
        const island = section.querySelector(':scope > .settings-island');
        const label = document.querySelector('label:has(#include-thoughts-toggle)');
        const model = document.querySelector('#thought-translation-model').parentElement.querySelector('button');
        return island.previousElementSibling.tagName === 'H3' &&
            island.nextElementSibling.matches('.settings-footer') &&
            !island.querySelector('.settings-footer') &&
            [label, model].every(row => getComputedStyle(row).fontWeight === '400' &&
                row.getBoundingClientRect().height >= 48 && row.getBoundingClientRect().height <= 52);
    })()"""), 'Section notes, font weight and row height follow the common rules'

    proofreading = model_button('proofreading-model-name')
    click(proofreading)
    assert evaluate("settingsUiV136.popover.matches('div[role=dialog]') && !settingsUiV136.popover.textContent.includes('Disabled API')")
    evaluate("""(() => {
        const search = settingsUiV136.popover.querySelector('input');
        search.value = 'very-long';
        search.dispatchEvent(new Event('input'));
    })()""")
    assert evaluate("settingsUiV136.popover.querySelectorAll('.model-picker-choice').length === 1")
    click('.model-picker-choice')
    wait("state.globalSettingsV136.proofreadingModelRef?.apiConfigId === 'group-or'", 'Search selection saves a global reference')
    assert evaluate("appLogic.getCurrentChatModelRef().apiConfigId === 'group-gem'")
    assert evaluate(f"document.activeElement === document.querySelector({json.dumps(proofreading)})")

    click('[aria-controls="proofreading-system-instruction-editor"]')
    assert evaluate("document.activeElement.id === 'proofreading-system-instruction'")
    evaluate("""(() => {
        const field = document.activeElement;
        field.value = '校正テスト';
        field.dispatchEvent(new Event('input', {bubbles:true}));
    })()""")
    wait("(async()=> (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.proofreadingSystemInstruction === '校正テスト')()",
         'Original textarea autosaves from the disclosure')
    click('[aria-controls="proofreading-system-instruction-editor"]')

    viewport(320, 820)
    wait("location.hash === '#settings/ai-assistance'", 'Resize preserves the detail')
    assert evaluate(f"""(() => {{
        const value = document.querySelector({json.dumps(proofreading)}).querySelector('.settings-row-value');
        return value.scrollWidth > value.clientWidth && getComputedStyle(value).textOverflow === 'ellipsis';
    }})()""")
    click(proofreading)
    assert evaluate("""settingsUiV136.popover.matches('div[role=dialog]') &&
        settingsUiV136.popover.textContent.includes('0123456789012345') &&
        Math.abs(settingsUiV136.popover.getBoundingClientRect().right - settingsUiV136.anchor.getBoundingClientRect().right) <= 1""")
    capture('mobile-light-model-picker')
    click('.model-picker-choice[data-model-ref-value=""]')
    wait("state.globalSettingsV136.proofreadingModelRef === null", 'Auxiliary picker preserves its unset option')
    click(proofreading)
    click('.model-picker-choice[data-model-ref-value*="deepseek"]')
    wait("state.globalSettingsV136.proofreadingModelRef?.modelName.startsWith('deepseek/')", 'Selected model is reflected after save')
    evaluate("""(() => {
        window.originalGroupedSettingsSave = appLogic.saveGlobalSettingsV136;
        appLogic.saveGlobalSettingsV136 = async () => { throw new Error('Controlled settings save failure'); };
    })()""")
    try:
        click(proofreading)
        click('.model-picker-choice[data-model-ref-value*="gemini-2.5-pro"]')
        wait("""document.querySelector('#proofreading-model-name').parentElement.querySelector('[role="alert"]')
            ?.textContent.includes('Controlled settings save failure')""", 'Save failure is visible')
        assert evaluate(f"document.querySelector({json.dumps(proofreading)}).textContent.includes('deepseek/deepseek-v3.2')")
    finally:
        evaluate('appLogic.saveGlobalSettingsV136 = originalGroupedSettingsSave')
    click(proofreading)
    click('.model-picker-choice[data-model-ref-value*="gemini-2.5-pro"]')
    wait("state.globalSettingsV136.proofreadingModelRef?.modelName === 'gemini-2.5-pro'", 'Retry after failure')
    click(proofreading)
    click('.model-picker-choice[data-model-ref-value*="deepseek"]')
    wait("state.globalSettingsV136.proofreadingModelRef?.modelName.startsWith('deepseek/')", 'Restore configured sample')

    for name in ('api-model', 'profile', 'ai-assistance', 'memory-context', 'tools-integrations', 'document-search',
                 'chat-operation', 'appearance', 'data-sync', 'app-info'):
        category(name, mobile=True)
        assert evaluate("""(() => {
            const detail = settingsUiV136.detail;
            const rows = [...detail.querySelectorAll('[data-settings-panel]:not([hidden]) .settings-row-action')];
            return detail.scrollWidth <= detail.clientWidth + 1 &&
                rows.filter(row => row.getClientRects().length).every(row => {
                    const style = getComputedStyle(row);
                    const arrow = getComputedStyle(row,'::after');
                    const surface = row.closest('.settings-dependent-group:not(.profile-appearance-editor),.settings-island');
                    const box = row.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
                    return style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
                        box.height >= 48 &&
                        (row.closest('.settings-prompt-editor,.sync-error-display') ||
                            Math.abs(box.left - bounds.left) <= 1 && Math.abs(box.right - bounds.right) <= 1) &&
                        (arrow.content === 'none') === row.hasAttribute('data-settings-action');
                }) &&
                [...detail.querySelectorAll('[data-settings-panel]:not([hidden]) > .settings-group')].every(
                    group => group.querySelector(':scope > .settings-island')?.getClientRects().length &&
                        !group.querySelector('.settings-island :is(.settings-scope,.settings-footer)'));
        })()"""), f'{name} uses islands without horizontal overflow at 320px'
        if name == 'app-info':
            assert evaluate("""(() => {
                const row = document.querySelector('.settings-version-row');
                const value = document.querySelector('#app-version');
                return row.getBoundingClientRect().height <= 52 && getComputedStyle(value).textOverflow === 'ellipsis';
            })()"""), 'The long version value preserves a single line at 320px'
        if name == 'document-search':
            assert evaluate("""(() => {
                const row = document.getElementById('document-embedding-download');
                const divider = getComputedStyle(row, '::before');
                return getComputedStyle(row).borderTopWidth === '0px' &&
                    divider.left === '16px' && divider.right === '16px';
            })()"""), 'Nested action rows use the same inset divider'
        capture(f'audit/mobile-{name}')

    category('profile', mobile=True)
    profile_edit = '#profile-edit-name-btn'
    profile_name = evaluate('state.activeProfile.name')
    hit(profile_edit, .1)
    wait("document.querySelector('#profile-edit-dialog').open && document.activeElement.id === 'profile-edit-title'", 'Profile row opens the shared modal')
    capture('mobile-light-profile-edit', 'profile-edit-dialog')
    hit('#profile-edit-name-input')
    capture('mobile-light-profile-name-focus', 'profile-edit-dialog')
    evaluate("document.activeElement.value = '名前の変更を確認'")
    key('Enter', 13)
    wait("!document.querySelector('#profile-edit-dialog').open && state.activeProfile.name === '名前の変更を確認'", 'Enter saves the edited name')
    hit(profile_edit, .1)
    wait("document.querySelector('#profile-edit-dialog').open", 'Profile editing opens again')
    evaluate("document.querySelector('#profile-edit-name-input').value = 'キャンセルする名前'")
    click('#profile-edit-close-btn')
    wait("!appLogic.profileEditId && state.activeProfile.name === '名前の変更を確認'", 'Closing discards a draft name')
    hit(profile_edit, .1)
    wait("document.querySelector('#profile-edit-dialog').open", 'Profile icon can be edited')
    client.capture_diagnostics = True
    event_offset = len(client.diagnostic_events)
    client.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    try:
        wait("!document.querySelector('#profile-edit-dialog').classList.contains('animating')", 'Profile dialog is ready for file selection')
        hit('#profile-change-icon-btn')
        deadline = time.monotonic() + 3
        event = None
        while event is None and time.monotonic() < deadline:
            evaluate('true')
            event = next((event['params'] for event in client.diagnostic_events[event_offset:]
                          if event['method'] == 'Page.fileChooserOpened'), None)
            if not event:
                time.sleep(.05)
        assert event, 'The avatar click launches the native file chooser'
        fixture = Path(__file__).resolve().parents[1] / 'icon-192x192.png'
        client.call('DOM.setFileInputFiles', {'backendNodeId': event['backendNodeId'], 'files': [str(fixture)]})
        wait("state.activeProfile.icon instanceof Blob && document.querySelector('#profile-display-icon img')?.complete",
             'The existing icon chooser saves and displays the image immediately')
        capture('mobile-light-profile-custom-icon', 'profile-edit-dialog')
    finally:
        client.call('Page.setInterceptFileChooserDialog', {'enabled': False})
        client.capture_diagnostics = False
    click('#profile-reset-icon-btn')
    wait("document.querySelector('#confirmDialog').open", 'Icon reset keeps the confirmation')
    click('#confirmDialog .dialog-ok-btn')
    wait("!state.activeProfile.icon && document.querySelector('#profile-reset-icon-btn').hidden", 'The existing icon reset saves')
    evaluate(f"document.querySelector('#profile-edit-name-input').value = {json.dumps(profile_name)}")
    click('#profile-edit-dialog .dialog-ok-btn')
    wait(f'state.activeProfile.name === {json.dumps(profile_name)}', 'Restore the test fixture name')
    assert evaluate("""(() => {
        const input = document.querySelector('#max-tokens');
        if (input.value || input.placeholder !== '未設定') return false;
        input.focus();
        const example = input.placeholder === input.dataset.example;
        input.blur();
        return example && input.placeholder === '未設定' && !input.value;
    })()""")
    click('label:has(#profile-theme-override)')
    wait("!document.getElementById('profile-theme-editor').hidden", 'Profile theme override is enabled')
    assert evaluate("""[...document.querySelectorAll('#profile-theme-editor > .settings-group')].length === 2 &&
        [...document.querySelectorAll('#profile-theme-editor > .settings-group')].every(group =>
            group.querySelector(':scope > h2 + .settings-island')) &&
        getComputedStyle(document.querySelector('#profile-theme-editor')).backgroundColor !==
        getComputedStyle(document.querySelector('#profile-theme-settings .settings-island')).backgroundColor""")
    evaluate("""(async () => {
        await appLogic.saveAppearanceValues('theme', {themeColorMode:'individual',headerTextColorMode:'custom'});
        await settingsUiV136.saveQueue;
    })()""")
    assert evaluate("""document.getElementById('profile-accent-color-settings').hidden &&
        !document.getElementById('profile-individual-color-settings').hidden &&
        !document.getElementById('profile-header-text-color-input').disabled &&
        !document.getElementById('accent-color-settings').hidden &&
        document.getElementById('individual-color-settings').hidden"""), 'Common and individual color rows follow independent settings'
    assert_island_edges('[data-color-input=profile-header-color-input]',
                        '[data-settings-choice=profile-theme-color-mode-select]')
    click('label:has(#profile-appearance-override)')
    wait("""!document.querySelector('#profile-appearance-editor').hidden &&
        document.querySelector('#profile-appearance-editor > .settings-group > h2 + .settings-island')?.getClientRects().length""",
        'Profile background has an independent island')
    client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', 'x':1, 'y':1})
    evaluate("document.querySelector('#profile-theme-settings').scrollIntoView({block:'start'})")
    capture('mobile-profile-theme-enabled')
    evaluate("document.querySelector('#profile-appearance-settings').scrollIntoView({block:'start'})")
    capture('mobile-profile-background-enabled')
    click('label:has(#profile-theme-override)')
    click('label:has(#profile-appearance-override)')
    wait("['theme','appearance'].every(kind => document.querySelector('#profile-' + kind + '-editor').hidden)",
         'Both overrides can be disabled')
    evaluate("document.querySelector('#profile-theme-settings').scrollIntoView({block:'start'})")
    capture('mobile-profile-overrides-disabled')

    category('chat-operation', mobile=True)
    click('label:has(#swipe-navigation-toggle)')
    expected_swipe = evaluate("document.querySelector('#swipe-navigation-toggle').checked")
    wait("state.settings.enableSwipeNavigation === " + str(expected_swipe).lower(), 'Swipe switch saves')
    if not expected_swipe:
        click('label:has(#swipe-navigation-toggle)')
    wait("!document.querySelector('#swipe-destination-library').disabled", 'Swipe destination switches become available')
    expected_library = not evaluate("document.querySelector('#swipe-destination-library').checked")
    hit('label:has(#swipe-destination-library)')
    wait("state.settings.swipeDestinations.includes('library') === " + str(expected_library).lower(), 'Swipe destination saves')
    assert evaluate("""['chat-navigation-settings','swipe-destinations','chat-header-settings'].every(id =>
        document.querySelector('#' + id + ' > h2 + .settings-island')) &&
        [...document.querySelectorAll('#swipe-destinations input')].every(input => input.matches('.settings-switch > [role=switch]'))""")
    evaluate("document.querySelector('#chat-navigation-settings').scrollIntoView({block:'start'})")
    client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', 'x':1, 'y':1})
    capture('mobile-chat-operation')
    hit('label:has(#swipe-destination-library)')

    category('api-model', mobile=True)
    assert evaluate("""(() => {
        const input = document.querySelector('#enable-api-timeout');
        const row = input.closest('.settings-field');
        const note = row.querySelector('.settings-row-copy > .settings-supporting-text');
        return note && input.getAttribute('aria-describedby').includes(note.id) &&
            getComputedStyle(note).borderTopWidth === '0px' && note.getBoundingClientRect().width < row.clientWidth;
    })()"""), 'Timeout help belongs to its own setting row'
    assert_center('label:has(#enable-api-timeout) .settings-row-copy', '#enable-api-timeout', 'label:has(#enable-api-timeout)')
    assert_center('.settings-field:has(#max-backoff-delay-seconds) .settings-row-copy', '#max-backoff-delay-seconds',
                  '.settings-field:has(#max-backoff-delay-seconds)')
    assert evaluate("!document.querySelector('.api-config-move').getClientRects().length")
    hit('.api-config-card:first-child', .15)
    wait("document.querySelector('#api-config-dialog').open", 'Tapping the API name opens the existing editing dialog')
    evaluate("""new Promise(resolve => {
        document.querySelector('#api-config-dialog').addEventListener('close', resolve, { once:true });
        document.querySelector('#close-api-config-btn').click();
    }).then(() => true)""")
    click('#add-api-config-btn')
    wait("document.querySelector('#api-config-dialog').open", 'API add dialog opens')
    click('[data-settings-choice="api-config-provider"]')
    assert evaluate("settingsUiV136.popover.classList.contains('settings-choice-popover') && settingsUiV136.popover.matches(':popover-open')")
    key('Escape', 27)
    assert evaluate("!settingsUiV136.popover && document.querySelector('#api-config-dialog').open && document.activeElement.dataset.settingsChoice === 'api-config-provider'")
    click('#close-api-config-btn')
    wait("!document.querySelector('#api-config-dialog').open", 'API add dialog closes')
    click(model_button('model-name'))
    click('.model-picker-choice[data-model-ref-value*="gemini-2.5-pro"]')
    wait("appLogic.getCurrentChatModelRef().modelName === 'gemini-2.5-pro'", 'Basic model choice applies to the current chat')
    assert evaluate("state.globalSettingsV136.proofreadingModelRef.modelName.startsWith('deepseek/')")

    viewport(390, 880)
    category('appearance', mobile=True)
    capture('mobile-light-appearance')
    assert_center('label[for=message-opacity-slider]', '#message-opacity-slider', '.settings-slider-container:has(#message-opacity-slider)')
    assert_center('[data-color-input=accent-color-input]', '[data-color-input=accent-color-input] .settings-color-swatch')
    const_choice = '[data-settings-choice="chat-font-size-select"]'
    hit(const_choice, .10)
    assert evaluate("""settingsUiV136.popover.matches('.settings-choice-popover:not(dialog)') &&
        settingsUiV136.popover.querySelector('[aria-pressed=true]').textContent === '14px' &&
        settingsUiV136.popover.getBoundingClientRect().right <= innerWidth""")
    capture('mobile-light-choice')
    click('.settings-choice-option[data-option-index="6"]')
    wait("(async()=> (await dbUtils.getSetting('localUiSettings')).value.chatFontSize === 20)()", 'Choice saves once through the native select change')
    assert evaluate("document.querySelector('[data-settings-choice=chat-font-size-select]').textContent.includes('20px')")
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
    tap(const_choice, .015)
    wait("Boolean(settingsUiV136.popover)", 'Touch at the island edge opens the choice')
    evaluate("window.tappedSettingChoice = settingsUiV136.popover.querySelector('[aria-pressed=true]')")
    tap('.settings-choice-popover [aria-pressed=true]')
    wait("!settingsUiV136.popover && getComputedStyle(document.querySelector('[data-settings-choice=chat-font-size-select]')).backgroundColor === 'rgba(0, 0, 0, 0)'",
         'Touch selection leaves no lingering hover paint')
    assert evaluate("""!document.querySelector('#settings-screen .ripple') &&
        !window.tappedSettingChoice.querySelector('.ripple')"""), 'Touch trigger and option do not generate ripple elements'
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
    category('api-model', mobile=True)
    capture('mobile-light-api-model')
    evaluate("appLogic.saveAppearanceValues('theme', {darkMode:true}, {global:true})")
    wait("document.body.classList.contains('dark-mode')", 'Dark theme applied')
    category('memory-context', mobile=True)
    capture('mobile-dark-memory-context')
    assert_center('[data-settings-choice=memory-auto-save-interval] .settings-row-copy',
                  '[data-settings-choice=memory-auto-save-interval] .settings-row-value',
                  '[data-settings-choice=memory-auto-save-interval]')
    hit('#manage-memory-btn', .25)
    wait("document.querySelector('#memoryManagementDialog').open", 'Memory action opens the original manager')
    click('#close-memory-dialog-btn')
    wait("!document.querySelector('#memoryManagementDialog').open", 'Memory manager closes')
    assert evaluate("!document.querySelector('#reset-memory-extraction-prompt').getClientRects().length")
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
    tap('[aria-controls="memory-extraction-prompt-editor"]')
    wait("document.activeElement.id === 'memory-extraction-prompt'", 'Touch opens and focuses the prompt')
    assert_prompt_open('memory-extraction-prompt')
    assert evaluate("!document.querySelector('#settings-screen .ripple')")
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
    assert evaluate("document.querySelector('#memory-extraction-prompt-editor > #reset-memory-extraction-prompt').getClientRects().length > 0")
    assert evaluate(r"""(() => {
        const prompt = document.querySelector('#memory-extraction-prompt');
        prompt.value = '長文のスクロールを確認します。\n'.repeat(80);
        prompt.dispatchEvent(new Event('input',{bubbles:true}));
        return prompt.getBoundingClientRect().height === 500 && prompt.scrollHeight > prompt.clientHeight;
    })()"""), 'Long prompt grows to the limit and remains scrollable'
    evaluate("""(() => {
        const prompt = document.querySelector('#memory-extraction-prompt');
        prompt.value = '記憶抽出の編集テスト';
        prompt.dispatchEvent(new Event('input',{bubbles:true}));
    })()""")
    wait("state.globalSettingsV136.memoryExtractionPrompt === '記憶抽出の編集テスト'", 'Memory prompt saves')
    evaluate("document.querySelector('[aria-controls=memory-extraction-prompt-editor]').scrollIntoView({block:'center'})")
    capture('mobile-dark-memory-prompt')
    click('#reset-memory-extraction-prompt')
    wait("""(async()=> (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.memoryExtractionPrompt
        === SettingsV136.DEFAULT_MEMORY_EXTRACTION_PROMPT)()""", 'The existing reset persists the default')
    click('[aria-controls="memory-extraction-prompt-editor"]')

    category('tools-integrations', mobile=True)
    assert evaluate("""(() => {
        const key = document.querySelector('#google-search-api-key');
        const setup = document.querySelector('#google-search-settings .settings-setup-details');
        const note = document.querySelector('#google-search-tool-note');
        return key.type === 'password' && !setup.open && setup.querySelectorAll('a[href]').length === 2 &&
            note.textContent.includes('同時に使用できません') && !note.closest('.settings-island') &&
            document.querySelector('#stable-diffusion-settings .settings-footer code').textContent === '--listen';
    })()""")
    click('#google-search-settings summary')
    assert evaluate("document.querySelector('#google-search-settings details').open")
    click('#google-search-settings summary')
    click('label:has(#sd-enable-quality-checker)')
    wait("document.querySelector('#sd-quality-checker-options').getClientRects().length && state.settings.sdEnableQualityChecker",
         'Image quality details follow their toggle')
    assert evaluate("document.querySelector('#sd-quality-checker-options').matches('.settings-dependent-group')")
    evaluate("document.querySelector('#image-quality-settings').scrollIntoView({block:'center'})")
    capture('mobile-dark-image-quality-enabled')
    click('label:has(#sd-enable-quality-checker)')
    wait("!document.querySelector('#sd-quality-checker-options').getClientRects().length && !state.settings.sdEnableQualityChecker",
         'Image quality details hide again')
    evaluate("""(() => {
        const original = window.fetch;
        const input = document.querySelector('#sd-api-url');
        window.restoreSettingsConnectionFixture = () => { window.fetch = original; input.value = ''; };
        input.value = 'http://127.0.0.1:17860';
        window.fetch = (resource, options) => {
            if (resource !== 'http://127.0.0.1:17860/sdapi/v1/progress') return original(resource, options);
            return new Promise(resolve => { window.finishSettingsConnection = status => resolve(new Response(null,{status})); });
        };
    })()""")
    try:
        evaluate("document.querySelector('#sd-api-url').scrollIntoView({block:'center'})")
        hit('#sd-api-url')
        wait("document.activeElement.id === 'sd-api-url'", 'URL is focused')
        capture('mobile-dark-url-editing')
        for status, expected in ((200, '接続できました。'), (503, '接続エラー (503)')):
            click('#sd-test-connection-btn')
            wait("document.querySelector('#sd-test-connection-btn').disabled && document.querySelector('#sd-connection-status').textContent.includes('接続中')",
                 'Connection check is disabled while running')
            evaluate(f'finishSettingsConnection({status})')
            wait(f"document.querySelector('#sd-connection-status').textContent === {json.dumps(expected)} && !document.querySelector('#sd-test-connection-btn').disabled",
                 'Connection result is shown next to the action')
    finally:
        evaluate("restoreSettingsConnectionFixture(); document.querySelector('#sd-connection-status').textContent = ''")

    category('document-search', mobile=True)
    capture('mobile-dark-document-search')
    category('ai-assistance', mobile=True)
    capture('mobile-dark-ai-assistance')
    click('#settings-menu-btn')
    wait('settingsUiV136.category === null', 'Mobile settings list')
    assert evaluate("document.querySelectorAll('#settings-category-nav .settings-category-list button > svg').length === 10")
    capture('mobile-dark-settings')

    viewport(900, 900)
    category('appearance')
    click('#settings-menu-btn')
    assert evaluate("settingsUiV136.sidebarCollapsed && settingsUiV136.detail.scrollWidth <= settingsUiV136.detail.clientWidth + 1")
    click('#settings-menu-btn')
    viewport(1280, 900)
    capture('desktop-dark-appearance')
    accent = '[data-color-input=accent-color-input]'
    color_mode = '[data-settings-choice=theme-color-mode-select]'
    assert_island_edges(accent, color_mode)
    edge = row_point(accent, .005)
    client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', **edge})
    capture('desktop-dark-accent-hover')
    client.call('Input.dispatchMouseEvent', {'type':'mousePressed','button':'left','clickCount':1, **edge})
    assert evaluate("""(() => {
        const row = document.querySelector('[data-color-input=accent-color-input]');
        return row.matches(':active') && getComputedStyle(row).transform === 'none' && !row.getAnimations({subtree:true}).length;
    })()""")
    capture('desktop-dark-accent-pressed')
    client.call('Input.dispatchMouseEvent', {'type':'mouseMoved','buttons':1,'x':1,'y':1})
    client.call('Input.dispatchMouseEvent', {'type':'mouseReleased','button':'left','x':1,'y':1})
    hit(accent, .005)
    wait("document.querySelector('#settings-color-dialog').open", 'Island edge opens the color picker')
    key('Escape', 27)
    wait("!settingsUiV136.colorPicker.active", 'Color picker closes after the edge click')
    assert_island_edges('#upload-background-btn')
    hover('#upload-background-btn')
    capture('desktop-dark-background-hover')
    hover('[data-settings-choice=dark-mode-toggle]')
    wait("""(() => {
        const button = document.querySelector('[data-settings-choice=dark-mode-toggle]');
        return button.matches(':hover') && getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)';
    })()""", 'Single-row island gets full hover paint')
    capture('desktop-dark-single-hover')
    category('profile')
    capture('desktop-dark-profile')
    hit(profile_edit, .2)
    wait("document.querySelector('#profile-edit-dialog').open", 'Desktop profile editor is visible')
    capture('desktop-dark-profile-edit', 'profile-edit-dialog')
    key('Escape', 27)
    wait("!appLogic.profileEditId", 'Escape closes the editor')
    evaluate("""(async () => {
        await dbUtils.addProfile({name:'作業用プロファイル',settings:{}});
        await appLogic.loadProfiles();
    })()""")
    hit('#profile-card-header-settings', .05)
    wait("""settingsUiV136.popover?.matches('.profile-picker-panel') &&
        Math.abs(settingsUiV136.popover.getBoundingClientRect().right -
                 document.getElementById('profile-card-header-settings').getBoundingClientRect().right) <= 1""",
         'The profile picker is right aligned')
    hover('.profile-picker-choice + .profile-picker-choice')
    capture('desktop-dark-profile-picker')
    key('Escape', 27)
    evaluate("""(() => {
        const input = document.querySelector('#max-tokens');
        input.value = '1024';
        input.dispatchEvent(new Event('input', {bubbles:true}));
    })()""")
    wait("state.settings.maxTokens === 1024", 'Profile numeric input saves')
    capture('desktop-dark-number-normal')
    geometry = """JSON.stringify(['#max-tokens', '.settings-field:has(#max-tokens)', '#temperature'].map(selector => {
        const {width,height,y} = document.querySelector(selector).getBoundingClientRect();
        return [width,height,y];
    }))"""
    before_edit = evaluate(geometry)
    hit('#max-tokens')
    assert evaluate("document.activeElement.id === 'max-tokens' && getComputedStyle(document.activeElement).appearance === 'textfield' && getComputedStyle(document.activeElement).outlineStyle === 'none'")
    assert evaluate(geometry) == before_edit, 'Number editing preserves the field and its neighbors'
    capture('desktop-dark-number-editing')
    assert evaluate("getComputedStyle(document.activeElement).borderTopColor !== getComputedStyle(document.activeElement).getPropertyValue('--settings-rule').trim()")
    key('ArrowUp', 38)
    wait("state.settings.maxTokens === 1025", 'Native number keyboard stepping still saves')
    evaluate("document.activeElement.blur()")
    system_prompt = '[aria-controls="system-prompt-default-editor"]'
    point = row_point(system_prompt)
    client.call('Input.dispatchMouseEvent', {'type':'mousePressed', 'button':'left', 'clickCount':1, **point})
    assert evaluate("""(() => {
        const row = document.querySelector('[aria-controls="system-prompt-default-editor"]');
        const style = getComputedStyle(row);
        return row.matches(':active') && style.getPropertyValue('--settings-interaction').trim() ===
            style.getPropertyValue('--settings-row-active').trim() && style.transform === 'none' &&
            !row.getAnimations({subtree:true}).length;
    })()"""), 'Mouse press changes the entire row background without scaling or animation'
    capture('desktop-dark-system-prompt-pressed')
    client.call('Input.dispatchMouseEvent', {'type':'mouseReleased', 'button':'left', 'clickCount':1, **point})
    client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', 'x':1, 'y':1})
    assert_prompt_open('system-prompt-default')
    assert evaluate("!document.querySelector('#settings-screen .ripple')")
    capture('desktop-dark-system-prompt-open')
    category('api-model')
    client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', 'x':1, 'y':1})
    capture('desktop-dark-api-model')
    hit(model_button('model-name'), .05)
    wait("""settingsUiV136.popover?.matches('.selection-picker') &&
        Math.abs(settingsUiV136.popover.getBoundingClientRect().right - settingsUiV136.anchor.getBoundingClientRect().right) <= 1""",
         'The model picker is right aligned')
    hover('.model-picker-choice + .model-picker-choice')
    capture('desktop-dark-model-picker')
    key('Escape', 27)
    click('label:has(#enable-api-timeout)')
    wait("state.settings.enableApiTimeout && document.querySelector('#api-timeout-options').getClientRects().length",
         'Timeout displays a subordinate input')
    evaluate("""(() => {
        const field = document.querySelector('#api-timeout-seconds');
        field.value = '120';
        field.dispatchEvent(new Event('input', {bubbles:true}));
    })()""")
    wait("state.settings.apiTimeoutSeconds === 120", 'Timeout value saves')
    evaluate("document.querySelector('#connection-settings').scrollIntoView({block:'start'})")
    capture('desktop-dark-conditional-connection')
    click('label:has(#enable-api-timeout)')
    wait("!state.settings.enableApiTimeout && !document.querySelector('#api-timeout-options').getClientRects().length", 'Timeout hides when off')
    click('label:has(#enable-api-timeout)')
    wait("state.settings.enableApiTimeout && document.querySelector('#api-timeout-seconds').value === '120'", 'Reenabled timeout retains its value')
    click('label:has(#enable-api-timeout)')
    wait("!state.settings.enableApiTimeout", 'Timeout fixture restored')
    evaluate('settingsUiV136.detail.scrollTop = 0')
    hover('.api-config-edit-row')
    capture('desktop-dark-api-first-hover')
    click('#api-reorder-btn')
    assert evaluate("""document.querySelector('.api-config-move').getClientRects().length > 0 &&
        document.querySelector('.api-config-move').disabled && !document.querySelector('.api-config-edit-row').getClientRects().length &&
        !document.querySelector('#add-api-config-btn').getClientRects().length""")
    assert evaluate("""[...document.querySelectorAll('.api-config-card')].every(row => {
        const centers = [...row.querySelectorAll('.api-config-name,.api-config-provider,svg path')].map(node => {
            if (node instanceof SVGPathElement) {
                const bounds = node.getBBox();
                return new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                    .matrixTransform(node.getScreenCTM()).y;
            }
            const bounds = node.getBoundingClientRect();
            return bounds.top + bounds.height / 2;
        });
        return Math.max(...centers) - Math.min(...centers) <= .5;
    })"""), 'Rendered SVG paths share the text centers'
    capture('desktop-dark-api-reorder')
    hit('.api-config-card:first-child [data-offset="1"]')
    wait("(async()=> (await dbUtils.getSetting('apiConfigs')).value[0].id === 'group-or')()", 'Reordered API is saved')
    hit('.api-config-card:nth-child(2) [data-offset="-1"]')
    wait("(async()=> (await dbUtils.getSetting('apiConfigs')).value[0].id === 'group-gem')()", 'API order restored')
    click('#api-reorder-btn')
    assert evaluate("!document.querySelector('.api-config-move').getClientRects().length && document.querySelector('#add-api-config-btn').getClientRects().length")
    awaitable = """(async()=> {
        const api = state.apiConfigs.find(config => config.id === 'group-gem');
        await appLogic.saveApiConfigs(state.apiConfigs.map(config => config.id === api.id
            ? {...config, modelCandidates:[...config.modelCandidates,'gemini-3.8-flash']} : config));
        await appLogic.setCurrentChatModelRef({apiConfigId:api.id,modelName:'gemini-3.8-flash'});
    })()"""
    evaluate(awaitable)
    thinking = '[data-settings-choice="settings-thinking-button"]'
    wait(f"document.querySelector({json.dumps(thinking)}).getClientRects().length > 0", 'Thinking row is available for the active model')
    hover(thinking)
    wait(f"getComputedStyle(document.querySelector({json.dumps(thinking)})).backgroundColor !== 'rgba(0, 0, 0, 0)'", 'Last row highlights to the island edge')
    capture('desktop-dark-last-hover')
    hit(thinking, .10)
    assert evaluate("""(() => {
        const list = document.querySelector('.settings-choice-list');
        const bounds = list.getBoundingClientRect();
        return [...list.children].every(row => row.getBoundingClientRect().left === bounds.left &&
            row.getBoundingClientRect().right === bounds.right && getComputedStyle(row).fontWeight === '400');
    })()""")
    hover('.settings-choice-option:nth-child(2)')
    wait("document.querySelector('.settings-choice-option:nth-child(2)').matches(':hover')", 'Middle choice is hovered')
    capture('desktop-dark-thinking-middle-hover')
    hover('.settings-choice-option:last-child')
    wait("document.querySelector('.settings-choice-option:last-child').matches(':hover')", 'Last choice is hovered')
    capture('desktop-dark-thinking-last-hover')
    hover('.settings-choice-option:first-child')
    wait("document.querySelector('.settings-choice-option:first-child').matches(':hover')", 'First choice is hovered')
    capture('desktop-dark-thinking-first-hover')
    key('Home', 36)
    assert evaluate("document.activeElement.matches('.settings-choice-option') && document.activeElement.textContent === 'Low'")
    key('Enter', 13)
    wait("appLogic.getCurrentChatThinkingEffort() === 'low' && !settingsUiV136.popover && document.activeElement.dataset.settingsChoice === 'settings-thinking-button'",
         'Keyboard Thinking choice saves and returns focus')
    assert_center('label:has(#enable-api-timeout) .settings-row-copy', '#enable-api-timeout', 'label:has(#enable-api-timeout)')
    category('tools-integrations')
    capture('desktop-dark-tools-integrations')
    evaluate("document.querySelector('#stable-diffusion-settings').scrollIntoView({block:'start'})")
    capture('desktop-dark-tools-connection')
    category('data-sync')
    capture('desktop-dark-data-sync')
    assert_island_edges('#dropbox-auth-btn', '#dropbox-conflict-backups')
    hover('#dropbox-auth-btn')
    capture('desktop-dark-dropbox-hover')
    assert evaluate("""(() => {
        const connected = document.querySelector('#dropbox-connected-state');
        const before = document.querySelector('#dropbox-auth-state');
        before.classList.add('hidden');
        connected.classList.remove('hidden');
        try {
            const bounds = connected.closest('.settings-island').getBoundingClientRect();
            return [...connected.querySelectorAll('.sync-actions > button')].every(button => {
                const row = button.getBoundingClientRect();
                return row.left === bounds.left && row.right === bounds.right;
            });
        } finally {
            before.classList.remove('hidden');
            connected.classList.add('hidden');
        }
    })()"""), 'Connected Dropbox actions use the same island edges'
    assert evaluate("""(async () => {
        await appLogic.updateAssetCount();
        const count = document.getElementById('asset-count-display');
        return count.parentElement.id === 'manage-assets-btn' &&
            count.textContent === (await dbUtils.getAllAssets()).length + '枚';
    })()""")
    click('#manage-assets-btn')
    wait("document.querySelector('#assetManagementDialog').open", 'Asset row opens the original manager')
    click('#close-asset-dialog-btn')
    wait("!document.querySelector('#assetManagementDialog').open", 'Asset manager closes')
    evaluate("""document.querySelector('#full-backup-input').addEventListener('click', event => {
        window.backupInputActivated = true;
        event.preventDefault();
    }, {once:true})""")
    click('#full-backup-import')
    assert evaluate('backupInputActivated')
    hover('#data-danger-settings summary')
    capture('desktop-dark-danger-disclosure-hover')
    evaluate("document.querySelector('#data-danger-settings summary').focus()")
    key('Enter', 13)
    wait("document.querySelector('#data-danger-settings details').open", 'The shared disclosure row opens with the keyboard')
    click('#clear-data-btn')
    wait("document.querySelector('#confirmDialog').open", 'Clear data still asks for confirmation')
    click('#confirmDialog .dialog-cancel-btn')
    wait("!document.querySelector('#confirmDialog').open", 'Clear data confirmation is canceled')
    evaluate("document.querySelector('#data-danger-settings').scrollIntoView({block:'end'})")
    capture('desktop-dark-data-actions')
    evaluate("appLogic.saveAppearanceValues('theme', {darkMode:false}, {global:true})")
    category('app-info')
    capture('desktop-light-app-info')
    category('ai-assistance')
    capture('desktop-light-ai-assistance')
    for dark in (False, True):
        mode = 'dark' if dark else 'light'
        evaluate(f"appLogic.saveAppearanceValues('theme', {{darkMode:{str(dark).lower()}}}, {{global:true}})")
        category('appearance')
        check_row_palette(const_choice, dark)
        hit(const_choice)
        evaluate("document.activeElement.blur(); document.getElementById('chat-font-size-select').options[0].disabled = true")
        wait("Boolean(document.querySelector('.settings-choice-option:disabled'))", 'Disabled choice is rendered')
        check_row_palette('.settings-choice-option[aria-pressed=true]', dark, f'desktop-{mode}-choice-palette')
        assert evaluate("""(() => {
            const disabled = document.querySelector('.settings-choice-option:disabled');
            const current = document.querySelector('.settings-choice-option[aria-pressed=true]');
            return current && getComputedStyle(disabled).color !== getComputedStyle(current).color &&
                getComputedStyle(current, '::after').content.includes('✓');
        })()""")
        evaluate("settingsUiV136.popover.querySelector('[aria-pressed=true]').focus({preventScroll:true})")
        key('Home', 36)
        focus = evaluate("""({
            correctChoice: document.activeElement === document.querySelector('.settings-choice-option:not(:disabled)'),
            text: document.activeElement.textContent.slice(0, 16),
            mode: settingsUiV136.popover?.dataset.inputMode,
            paint: getComputedStyle(document.activeElement).boxShadow
        })""")
        assert focus['correctChoice'] and 'inset' in focus['paint'], focus
        key('Escape', 27)
        evaluate("document.getElementById('chat-font-size-select').options[0].disabled = false")
        category('data-sync')
        check_row_palette('#full-backup-export', dark)
        check_row_palette('#history-delete-mode-btn', dark)
    evaluate("appLogic.saveAppearanceValues('theme', {darkMode:false}, {global:true})")
    viewport(390, 880)
    category('profile', mobile=True)
    click(system_prompt)
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
    tap('#profile-card-header-settings', .1)
    assert evaluate("""settingsUiV136.popover?.matches('.profile-picker-panel:not(dialog)') &&
        document.activeElement.matches('.profile-picker-choice') &&
        Math.abs(settingsUiV136.popover.getBoundingClientRect().right - settingsUiV136.anchor.getBoundingClientRect().right) <= 1""")
    capture('mobile-light-profile-picker')
    evaluate("""(() => {
        const search = settingsUiV136.popover.querySelector('input');
        search.focus();
        search.value = '作業用';
        search.setSelectionRange(2, 2);
        search.dispatchEvent(new Event('input'));
    })()""")
    viewport(390, 250)
    wait("settingsUiV136.popover?.matches('dialog:modal')", 'Short settings viewport uses the profile dialog')
    assert evaluate("""(() => {
        const search = settingsUiV136.popover.querySelector('input');
        return document.activeElement === search && search.value === '作業用' && search.selectionStart === 2 &&
            settingsUiV136.popover.querySelectorAll('.profile-picker-choice').length === 1;
    })()""")
    viewport(390, 880)
    assert evaluate("settingsUiV136.popover?.matches('dialog:modal') && document.activeElement.matches('.model-picker-search')")
    viewport(390, 250)
    tap('.profile-picker-choice:not([aria-pressed=true])')
    wait("!settingsUiV136.popover && state.activeProfile.name === '作業用プロファイル'", 'Touch selection still switches the profile')
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})

    viewport(320, 190)
    category('ai-assistance', mobile=True)
    evaluate(f"document.querySelector({json.dumps(proofreading)}).scrollIntoView({{block:'center'}})")
    click(proofreading)
    wait("settingsUiV136.popover?.matches('dialog:modal')", 'Short settings viewport uses the model dialog')
    evaluate("""(() => {
        const search = settingsUiV136.popover.querySelector('input');
        search.value = 'gemini-2.5-pro';
        search.dispatchEvent(new Event('input'));
    })()""")
    hit('.model-picker-choice[data-model-ref-value*="gemini-2.5-pro"]')
    wait("!settingsUiV136.popover && state.globalSettingsV136.proofreadingModelRef?.modelName === 'gemini-2.5-pro'",
         'The model is selectable and saved in the fallback dialog')
    return 'ALL PASSED (grouped settings and short-viewport profile/model selection)'

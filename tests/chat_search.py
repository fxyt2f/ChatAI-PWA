"""Search and replace through the production chat UI in Chrome."""
import base64
import json
import time


def run(client, url, screenshots=None):
    def ev(expression):
        response = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in response:
            raise RuntimeError(response['exceptionDetails'])
        return response.get('result', {}).get('value')

    def wait(expression, label):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if ev(expression):
                return
            time.sleep(0.05)
        raise AssertionError(label)

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def fill(id, value):
        ev(f"""(() => {{
            const input = document.getElementById({json.dumps(id)});
            input.value = {json.dumps(value)};
            input.dispatchEvent(new Event('input', {{bubbles: true}}));
        }})()""")

    def count(expected):
        wait(f"document.getElementById('chat-search-count').textContent === '{expected}'",
             f'Search count is {expected}')

    def key(name, code, modifiers=0):
        params = {'key': name, 'code': 'Space' if name == ' ' else name,
                  'windowsVirtualKeyCode': code, 'modifiers': modifiers}
        client.call('Input.dispatchKeyEvent', {'type': 'keyDown', **params, **({'text': name} if name == ' ' else {})})
        client.call('Input.dispatchKeyEvent', {'type': 'keyUp', **params})

    def replace_plan(scope, target, indices, replacement):
        wait(f"""(() => {{
            const plan = state.chatReplacePreview.plan;
            return plan?.scope === '{scope}' && plan.target === '{target}'
                && plan.replacement === {json.dumps(replacement)} && !state.chatReplacePreview.timer
                && JSON.stringify(plan.changes.map(change => change.index)) === '{json.dumps(indices, separators=(',', ':'))}';
        }})()""", f'{scope} replacement preview for {target} at {indices}')

    def set_messages(messages):
        ev(f"""(() => {{
            state.currentMessages = {json.dumps(messages)};
            uiUtilsV136.renderChatMessages();
        }})()""")

    def contents():
        return ev('state.currentMessages.map(message => message.content)')

    def viewport(width, height=740):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 768,
        })

    def position(selector):
        return ev(f"""(() => {{
            const rect = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            return {{x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2}};
        }})()""")

    def capture(name):
        if not screenshots:
            return
        clip = ev("""(() => {
            const bounds = document.getElementById('chat-search-dialog').getBoundingClientRect();
            const x = Math.max(0, bounds.left - 16), y = Math.max(0, bounds.top - 12);
            return {x, y, width: Math.min(innerWidth, bounds.right + 16) - x,
                height: Math.min(innerHeight, bounds.bottom + 30) - y, scale: 1};
        })()""")
        result = client.call('Page.captureScreenshot', {'format': 'png', 'clip': clip})
        screenshots.mkdir(parents=True, exist_ok=True)
        (screenshots / (name + '.png')).write_bytes(base64.b64decode(result['data']))

    def check_toolbar(width, expected):
        measure = """(() => {
            const $ = id => document.getElementById(id);
            const panel = $('chat-search-dialog');
            const count = $('chat-search-count');
            const top = ['chat-search-query', 'chat-search-count', 'chat-search-prev-btn',
                'chat-search-next-btn', 'chat-search-close-btn'].map(id => $(id).getBoundingClientRect());
            const navigation = panel.querySelector('.chat-search-navigation');
            const divider = getComputedStyle(navigation, '::before');
            const first = panel.querySelector('.chat-search-toggle-label');
            const firstBox = first.getBoundingClientRect();
            const bounds = panel.getBoundingClientRect();
            const workspace = panel.parentElement.getBoundingClientRect();
            const gutter = innerWidth <= 600 ? 8 : 16;
            const style = getComputedStyle(count);
            return {
                width: innerWidth, count: count.textContent,
                full: count.scrollWidth <= count.clientWidth && style.textOverflow !== 'ellipsis'
                    && style.whiteSpace === 'nowrap' && style.fontVariantNumeric.includes('tabular-nums'),
                order: top.every((rect, index) => rect.width > 0 && (!index || top[index - 1].right <= rect.left))
                    && top.slice(1).every(rect => rect.top >= top[0].top && rect.bottom <= top[0].bottom),
                divider: divider.width === '1px' && parseFloat(divider.height) < top[0].height
                    && Number(divider.opacity) < 0.5 && parseFloat(style.paddingRight) >= 8
                    && top[2].left - navigation.getBoundingClientRect().left === 5,
                targets: top.slice(2).every(rect => rect.width === 34 && rect.height === 34)
                    && navigation.getBoundingClientRect().width === 115,
                iconsOnly: Array.from(navigation.querySelectorAll('button')).every(button => {
                    const buttonStyle = getComputedStyle(button);
                    const iconStyle = getComputedStyle(button.firstElementChild);
                    const hover = getComputedStyle(button, '::before');
                    return buttonStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && buttonStyle.borderWidth === '0px'
                        && buttonStyle.boxShadow === 'none' && buttonStyle.opacity === '1'
                        && buttonStyle.color === getComputedStyle(panel).color
                        && hover.backgroundColor === 'rgba(0, 0, 0, 0)'
                        && (button.disabled ? Number(iconStyle.opacity) < 0.5 : iconStyle.opacity === '1');
                }),
                widened: bounds.width === (innerWidth <= 600 ? workspace.width - 2 * gutter : 388)
                    && bounds.left - workspace.left === gutter
                    && Math.abs(top[0].width - (bounds.width - top[1].width - 115 - 4 - 2)) < 1,
                aligned: Math.abs(firstBox.left + (firstBox.width - first.offsetWidth) / 2 - bounds.left) < 1,
                bottom: Array.from(panel.querySelectorAll('.chat-search-toolbar-bottom input, .chat-search-toolbar-bottom button'), el => el.id),
                fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
                outerOverflow: getComputedStyle(panel).overflowY,
            };
        })()"""
        expected_layout = {
            'width': width, 'count': expected, 'full': True, 'order': True, 'divider': True,
            'targets': True, 'iconsOnly': True, 'widened': True, 'aligned': True,
            'bottom': ['chat-search-regex', 'chat-search-case-sensitive', 'chat-search-replace-toggle-btn'],
            'fits': True, 'outerOverflow': 'visible',
        }
        try:
            wait(f"JSON.stringify({measure}) === JSON.stringify({json.dumps(expected_layout)})",
                 f'Search toolbar settles at {width}px')
        except AssertionError as error:
            raise AssertionError(ev(measure)) from error

    def check_unclipped(selector, expanded):
        bounds = ev(f"""(() => {{
            const control = document.querySelector({json.dumps(selector)});
            const rect = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            let left = 0, right = innerWidth, top = 0, bottom = innerHeight;
            for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {{
                const parentStyle = getComputedStyle(parent), box = parent.getBoundingClientRect();
                if (parentStyle.overflowX !== 'visible') {{ left = Math.max(left, box.left); right = Math.min(right, box.right); }}
                if (parentStyle.overflowY !== 'visible') {{ top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }}
            }}
            return {{
                left: rect.left - left, right: right - rect.right, top: rect.top - top, bottom: bottom - rect.bottom,
                width: rect.width, shadow: style.boxShadow,
            }};
        }})()""")
        assert min(bounds[side] for side in ('left', 'right', 'top', 'bottom')) >= 5, bounds
        assert bounds['shadow'] != 'none' and (not expanded or bounds['width'] >= 43), bounds

    def history_action(direction, expected_count):
        button = f'#chat-replace-{direction}-btn'
        wait(f"!document.querySelector('{button}').disabled", f'{direction} is available')
        click(button)
        wait('!state.isApplyingChangeHistory', f'{direction} finished')
        count(expected_count)

    def check_replacement_layout():
        layout = ev("""(() => {
            const search = document.getElementById('chat-search-query').closest('.chat-search-field').getBoundingClientRect();
            const panel = document.getElementById('chat-replace-preview-panel');
            const box = panel.getBoundingClientRect(), list = document.getElementById('chat-replace-preview-list');
            const buttons = ['execute', 'undo', 'redo'].map(name => document.getElementById('chat-replace-' + name + '-btn'));
            const controls = [document.getElementById('chat-replace-input'), document.getElementById('chat-replace-target'), ...buttons];
            const before = controls.map(control => control.getBoundingClientRect().top);
            list.scrollTop = list.scrollHeight;
            return {
                aligned: search.left === box.left && search.right === box.right,
                fits: controls.every(control => {
                    const rect = control.getBoundingClientRect();
                    return rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
                }),
                actions: buttons.every((button, index) => button.offsetHeight >= 40
                    && (!index || button.offsetLeft >= buttons[index - 1].offsetLeft + buttons[index - 1].offsetWidth)),
                historyIcons: buttons.slice(1).every((button, index) => {
                    const icon = button.firstElementChild;
                    const buttonBox = button.getBoundingClientRect(), iconBox = icon.getBoundingClientRect();
                    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize);
                    return buttonBox.width === 40 && buttonBox.height === 40
                        && getComputedStyle(button).borderRadius === getComputedStyle(controls[0]).borderRadius
                        && icon.textContent === (index ? 'redo' : 'undo')
                        && Math.abs(parseFloat(getComputedStyle(icon).fontSize) - (rootFont * 1.15 + 2)) < 0.1
                        && Math.abs(buttonBox.left + buttonBox.right - iconBox.left - iconBox.right) < 1
                        && Math.abs(buttonBox.top + buttonBox.bottom - iconBox.top - iconBox.bottom) < 1;
                }),
                fixed: panel.scrollTop === 0 && controls.every((control, index) => control.getBoundingClientRect().top === before[index]),
                scrolls: list.scrollTop > 0 && list.scrollHeight - list.scrollTop - list.clientHeight < 2,
                noHorizontalScroll: panel.scrollWidth <= panel.clientWidth && list.scrollWidth <= list.clientWidth,
                height: box.height <= Math.min(480, innerWidth <= 600 ? Math.max(176, innerHeight * .55) : 480) + 1
                    && box.bottom <= visualViewport.offsetTop + visualViewport.height,
            };
        })()""")
        assert all(layout.values()), layout

    def check_replacement_fields(width):
        target = '#chat-replace-target'
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': width - 1, 'y': 1})
        ev("document.getElementById('chat-replace-back-btn').focus()")
        wait("""(() => {
            const select = getComputedStyle(document.getElementById('chat-replace-target'));
            const settings = getComputedStyle(document.getElementById('dark-mode-toggle'));
            const input = getComputedStyle(document.getElementById('chat-replace-input'));
            const panel = getComputedStyle(document.getElementById('chat-replace-preview-panel'));
            return ['appearance', 'borderRadius', 'backgroundColor', 'backgroundImage', 'backgroundPosition',
                'backgroundSize', 'paddingInlineStart', 'paddingInlineEnd', 'color'].every(key => select[key] === settings[key])
                && select.transform === 'none' && input.borderColor === panel.borderColor && select.borderColor === panel.borderColor;
        })()""", 'Replacement select shares the settings select design')
        for field in ('#chat-replace-input', target):
            before = position(field)
            key('Tab', 9)
            focus = ev(f"""(() => {{
                const field = document.querySelector('{field}');
                const style = getComputedStyle(field);
                const border = field.closest('.chat-replace-preview-panel');
                return {{
                    focused: field === document.activeElement && field.matches(':focus-visible'),
                    noRing: style.outlineStyle === 'none' && style.boxShadow === 'none',
                    borderMatches: style.borderColor === getComputedStyle(border).borderColor,
                    active: document.activeElement.id,
                }};
            }})()""")
            assert focus == {'focused': True, 'noRing': True, 'borderMatches': True, 'active': field[1:]}, focus
            assert position(field) == before, 'Keyboard focus does not move the control'
        ev("document.activeElement.blur()")
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **position(target)})
        wait("""(() => {
            const select = document.getElementById('chat-replace-target');
            const style = getComputedStyle(select);
            return select.matches(':hover') && (!matchMedia('(hover: hover) and (pointer: fine)').matches ||
                (style.transform === 'matrix(1, 0, 0, 1, 0, -1)' && style.boxShadow !== 'none' &&
                    style.backgroundColor !== getComputedStyle(document.getElementById('dark-mode-toggle')).backgroundColor));
        })()""", 'Mouse hover lightens and lifts the target select')

    def expanded_state(selector):
        root = client.call('DOM.getDocument', {'depth': 0})['root']['nodeId']
        node = client.call('DOM.querySelector', {'nodeId': root, 'selector': selector})['nodeId']
        tree = client.call('Accessibility.getPartialAXTree', {'nodeId': node, 'fetchRelatives': False})
        return next(property['value']['value'] for item in tree['nodes']
                    for property in item.get('properties', []) if property['name'] == 'expanded')

    client.call('Page.enable')
    client.call('Network.enable')
    blocked_urls = ['https://cdn.jsdelivr.net/*', 'https://cdnjs.cloudflare.com/*'] if screenshots else ['https://*']
    client.call('Network.setBlockedURLs', {'urls': blocked_urls})
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?chatSearchFixture=1') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
        }
    """})['identifier']
    try:
        client.call('Page.navigate', {'url': url + '?chatSearchFixture=1'})
        wait("location.search === '?chatSearchFixture=1' && !!window.appLogic?._setupEventListenersCallCount",
             'Chat startup completed')
        if ev("document.querySelector('#releaseNotesDialog[open]') !== null"):
            click('#releaseNotesDialog .dialog-ok-btn')
            wait("!document.querySelector('#releaseNotesDialog[open]')", 'Startup release notes closed')
        ev("""(() => {
            state.currentMessages = [
                {role: 'user', content: '共通 共通', timestamp: 1},
                {role: 'model', content: '共通', timestamp: 2},
                {role: 'user', content: '共通', timestamp: 3},
            ];
            uiUtilsV136.renderChatMessages();
        })()""")
        actual = ev("""(() => {
            const button = document.querySelector('.message[data-index="0"] button[aria-label^="このメッセージを"]'
                + ':is([title$="検索"], [title$="置換"])');
            return {
                icon: button?.textContent.trim(), label: button?.getAttribute('aria-label'),
                input: document.getElementById('chat-search-query').type,
                count: document.getElementById('chat-search-count').textContent,
                topButtons: Array.from(document.querySelectorAll('.chat-search-toolbar-top button'), el => el.id),
            };
        })()""")
        assert actual == {
            'icon': 'search', 'label': 'このメッセージを検索', 'input': 'text', 'count': '0/0',
            'topButtons': ['chat-search-prev-btn', 'chat-search-next-btn', 'chat-search-close-btn'],
        }, actual

        assert ev("dbUtils.saveChat('Search fixture')"), 'Initial chat saved'
        saved_chat = ev('state.currentChatId')
        assert ev("""(() => {
            state.isSending = true;
            appLogic.updateMessageActionButtonStates();
            const first = document.querySelector('.message[data-index="0"]');
            const search = first.querySelector('.tm-search-message-btn');
            const format = first.querySelector('.tm-format-message-btn');
            search.click();
            const valid = format.disabled && !search.disabled && state.chatSearch.isOpen
                && !state.chatReplacePreview.isOpen && document.activeElement.id === 'chat-search-query';
            state.isSending = false;
            appLogic.updateMessageActionButtonStates();
            return valid;
        })()"""), 'Read-only search remains available during generation'
        assert ev("['prev','next'].every(id => document.getElementById('chat-search-' + id + '-btn').disabled)")
        fill('chat-search-query', '共通')
        count('1/2')
        assert ev("""state.chatSearch.matches.every(match => match.messageElement.dataset.index === '0')
            && CSS.highlights.get('chatai-search-match').size === 2""")
        key('Enter', 13)
        count('2/2')
        key('Enter', 13, modifiers=8)
        count('1/2')
        assert ev("""(() => {
            const input = document.getElementById('chat-search-query');
            input.dispatchEvent(new CompositionEvent('compositionstart'));
            return state.chatSearch.isComposing;
        })()""")
        fill('chat-search-query', '仮入力')
        time.sleep(0.25)
        count('1/2')
        ev("""(() => {
            const input = document.getElementById('chat-search-query');
            input.value = '共通';
            input.dispatchEvent(new CompositionEvent('compositionend'));
        })()""")
        wait("!state.chatSearch.isComposing", 'IME commit resumes search')
        click('#chat-search-regex')
        click('#chat-search-case-sensitive')
        click('#chat-search-replace-toggle-btn')
        assert ev("""document.querySelector('.chat-replace-preview-title').textContent === '置換'
            && document.getElementById('chat-search-replace-toggle-btn').title === '置換'
            && document.getElementById('chat-search-replace-toggle-btn').getAttribute('aria-label') === '置換'
            && document.getElementById('chat-replace-target').disabled
            && document.getElementById('chat-replace-target').value === 'user'
            && document.getElementById('chat-replace-scope').textContent === '対象: このユーザーメッセージのみ'""")
        fill('chat-replace-input', '変更')
        replace_plan('message', 'user', [0], '変更')
        assert contents() == ['共通 共通', '共通', '共通'], 'Preview did not mutate messages'
        click('#chat-replace-back-btn')
        assert ev("""!state.chatReplacePreview.isOpen && document.activeElement.id === 'chat-search-query'
            && document.getElementById('chat-search-query').value === '共通'
            && document.getElementById('chat-search-regex').checked
            && document.getElementById('chat-search-case-sensitive').checked""")
        count('1/2')
        click('#chat-search-replace-toggle-btn')
        replace_plan('message', 'user', [0], '変更')
        click('#chat-replace-execute-btn')
        count('0/0')
        wait("!state.chatReplacePreview.isExecuting", 'Replacement completed')
        assert contents() == ['変更 変更', '共通', '共通']
        assert ev("dbUtils.getChat(state.currentChatId).then(chat => chat.messages.map(message => message.content))") == contents()
        history_action('undo', '1/2')
        assert contents() == ['共通 共通', '共通', '共通']
        history_action('redo', '0/0')
        assert contents() == ['変更 変更', '共通', '共通']
        click('#chat-replace-back-btn')
        count('0/0')
        assert ev("state.chatSearch.messageTarget.index === 0")

        click('.message[data-index="1"] .tm-search-message-btn')
        count('1/1')
        click('#chat-search-replace-toggle-btn')
        assert ev("document.getElementById('chat-replace-scope').textContent === '対象: このモデル回答のみ'")
        replace_plan('message', 'model', [1], '変更')
        click('#chat-replace-execute-btn')
        count('0/0')
        assert contents() == ['変更 変更', '変更', '共通']
        click('#chat-search-close-btn')
        assert ev("!state.chatSearch.isOpen && !state.chatReplacePreview.isOpen && state.chatSearch.messageTarget === null")

        click('#chat-search-open-btn')
        fill('chat-search-query', '変更')
        count('1/3')
        click('#chat-search-replace-toggle-btn')
        assert ev("""!document.getElementById('chat-replace-target').disabled
            && document.getElementById('chat-replace-scope').hidden""")
        ev("""(() => {
            const target = document.getElementById('chat-replace-target');
            target.value = 'both';
            target.dispatchEvent(new Event('change'));
        })()""")
        fill('chat-replace-input', '全体')
        assert ev("document.getElementById('chat-replace-execute-btn').disabled")
        replace_plan('chat', 'both', [0, 1], '全体')
        click('#chat-replace-execute-btn')
        count('0/0')
        assert contents() == ['全体 全体', '全体', '共通'], contents()
        assert ev("document.getElementById('chat-replace-execute-btn').textContent === '置換'")
        ev("""(async () => {
            const chatId = state.currentChatId;
            for (const [type, before, after] of [['edit', '共通', '編集済み'], ['format', '編集済み', '整形済み']]) {
                state.currentMessages[2].content = after;
                await dbUtils.saveChat();
                const result = await appendChangeHistory(chatId, {id: createChangeHistoryId(), chatId, type,
                    timestamp: Date.now(), changes: [{index: 2, role: 'user', before, after}]});
                if (!result.saved) throw new Error('Could not save unrelated history fixture');
            }
            await appLogic.updateChangeHistoryControls();
        })()""")
        history_action('undo', '1/3')
        assert contents() == ['変更 変更', '変更', '整形済み']
        assert ev("state.chatReplacePreview.plan.changes.length === 2"), 'Undo refreshed the replacement preview'
        history_action('redo', '0/0')
        assert contents() == ['全体 全体', '全体', '整形済み']
        assert ev("""loadChangeHistory(state.currentChatId, true).then(entries =>
            entries.filter(entry => entry.type !== 'replace').length === 2
                && entries.filter(entry => entry.type !== 'replace').every(entry => entry.status === 'applied'))""")
        ev("""(async () => {
            state.currentMessages[0].content = '全体 全体（後続の編集）';
            await dbUtils.saveChat();
            await appendChangeHistory(state.currentChatId, {id: createChangeHistoryId(), chatId: state.currentChatId,
                type: 'edit', timestamp: Date.now(),
                changes: [{index: 0, role: 'user', before: '全体 全体', after: '全体 全体（後続の編集）'}]});
            await appLogic.updateChangeHistoryControls();
        })()""")
        assert ev("document.getElementById('chat-replace-undo-btn').disabled"), 'Later overlapping edit blocks batch undo'
        click('#chat-replace-undo-btn')
        assert contents() == ['全体 全体（後続の編集）', '全体', '整形済み']
        click('#chat-replace-back-btn')
        assert ev("state.chatSearch.isOpen && state.chatSearch.messageTarget === null")
        key('Escape', 27)
        assert ev("!state.chatSearch.isOpen && !state.chatReplacePreview.isOpen")

        set_messages([
            {'role': 'user', 'content': '共通', 'timestamp': 4},
            {'role': 'user', 'content': '共通', 'timestamp': 4},
        ])
        click('.message[data-index="0"] .tm-search-message-btn')
        fill('chat-search-query', '共通')
        click('#chat-search-replace-toggle-btn')
        fill('chat-replace-input', '消してはいけない')
        replace_plan('message', 'user', [0], '消してはいけない')
        assert ev("""(async () => {
            const remember = SettingsV136.rememberHistoryContextsAsyncV136;
            let release;
            SettingsV136.rememberHistoryContextsAsyncV136 = () => new Promise(resolve => { release = resolve; });
            let execution;
            try { execution = uiUtilsV136.executeChatReplacePreviewPlan(); }
            finally { SettingsV136.rememberHistoryContextsAsyncV136 = remember; }
            if (!release) throw new Error('Replacement did not reach the history snapshot');
            state.currentMessages.splice(0, 1);
            uiUtilsV136.renderChatMessages();
            release();
            await execution;
            return state.currentMessages[0].content === '共通' && !state.chatSearch.isOpen
                && !state.chatReplacePreview.isOpen && state.chatSearch.messageTarget === null;
        })()"""), 'Deleting a scoped target cannot replace a same-role neighbor at the old index'

        click('.message[data-index="0"] .tm-search-message-btn')
        fill('chat-search-query', '共通')
        count('1/1')
        ev('appLogic.startNewChat(); state.executionSettingsReady')
        assert ev("!state.chatSearch.isOpen && state.chatSearch.messageTarget === null")
        click('#chat-search-open-btn')
        click('#chat-search-replace-toggle-btn')
        assert ev("['undo','redo'].every(direction => document.getElementById('chat-replace-' + direction + '-btn').disabled)")
        assert ev(f"appLogic.loadChat({saved_chat}).then(result => result.ok)")
        click('#chat-search-open-btn')
        fill('chat-search-query', '全体')
        count('1/3')
        click('#chat-search-close-btn')

        set_messages([
            {'role': 'user', 'content': 'one ' + 'five ' * 5 + 'many ' * 128 + 'huge ' * 1234},
            *[{'role': 'model', 'content': 'preview'} for _ in range(8)],
        ])
        click('#chat-search-open-btn')
        for query, current, total in [('absent', 0, 0), ('one', 1, 1), ('five', 2, 5), ('many', 12, 128), ('huge', 999, 1234)]:
            fill('chat-search-query', query)
            count(f'{int(total > 0)}/{total}')
            if current > 1:
                ev(f'uiUtilsV136.moveChatSearchCurrent({current - 1})')
            count(f'{current}/{total}')
            check_toolbar(1280, f'{current}/{total}')
            if not total:
                client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **position('#chat-search-prev-btn')})
                assert ev("""(() => {
                    const previous = document.getElementById('chat-search-prev-btn');
                    return previous.disabled && getComputedStyle(previous, '::before').backgroundColor === 'rgba(0, 0, 0, 0)';
                })()"""), 'Disabled navigation has no mouse hover background'
                client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': 0, 'y': 0})

        regex_label = 'label[title="正規表現"] .chat-search-toggle-label'
        case_label = 'label[title="大文字・小文字を区別"] .chat-search-toggle-label'
        replace = '#chat-search-replace-toggle-btn'
        for width in (320, 375, 430, 768, 1280):
            viewport(width)
            for dark in (False, True):
                ev(f"document.body.classList.toggle('dark-mode', {str(dark).lower()})")
                client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': width - 1, 'y': 1})
                wait(f"""(async () => {{
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    return innerWidth === {width} && !state.chatSearch.inputTimer && state.chatSearch.matches.length === 1234;
                }})()""",
                     'Search settled after viewport changes')
                ev('uiUtilsV136.moveChatSearchCurrent(998 - state.chatSearch.currentIndex)')
                check_toolbar(width, '999/1234')
                for button in ('prev', 'next', 'close'):
                    selector = f'#chat-search-{button}-btn'
                    client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **position(selector)})
                    wait(f"""(() => {{
                        const button = document.querySelector('{selector}');
                        const style = getComputedStyle(button), hover = getComputedStyle(button, '::before');
                        const box = button.getBoundingClientRect();
                        const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
                        const alpha = Number(hover.backgroundColor.match(/(?:\\/|,)\\s*([\\d.]+)\\)$/)?.[1]);
                        return button.matches(':hover') && (mouse ? alpha >= 0.079 && alpha <= 0.081
                            : hover.backgroundColor === 'rgba(0, 0, 0, 0)')
                            && hover.borderRadius === '50%' && style.boxShadow === 'none'
                            && style.backgroundColor === 'rgba(0, 0, 0, 0)'
                            && getComputedStyle(button.firstElementChild).textShadow === 'none'
                            && box.width === 34 && box.height === 34
                            && document.elementFromPoint(box.left + 3, box.top + 3).closest('button') === button;
                    }})()""", f'{button} uses a subtle circular mouse hover background at {width}px')
                    if button == 'next' and width in (320, 1280):
                        capture(f'{width}-{"dark" if dark else "light"}-navigation-hover')
                for selector in (regex_label, case_label, replace):
                    client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **position(selector)})
                    wait(f"document.querySelector({json.dumps(selector)}).getBoundingClientRect().width >= 43",
                         f'Hover enlarges {selector} at {width}px, dark={dark}')
                    check_unclipped(selector, expanded=True)
                client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': width - 1, 'y': 1})
                ev("document.getElementById('chat-search-next-btn').focus()")
                key('Tab', 9)
                wait("""(() => {
                    const close = document.getElementById('chat-search-close-btn');
                    const style = getComputedStyle(close);
                    return close === document.activeElement && close.matches(':focus-visible')
                        && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2;
                })()""", 'Top navigation keeps a visible keyboard focus outline')
                key('Tab', 9)
                wait("document.activeElement.id === 'chat-search-regex' && document.activeElement.matches(':focus-visible')",
                     'Keyboard Tab moves from the top controls to regex')
                wait(f"document.querySelector({json.dumps(regex_label)}).getBoundingClientRect().width >= 43",
                     'Keyboard focus enlarges regex')
                check_unclipped(regex_label, expanded=True)
                capture(f'{width}-{"dark" if dark else "light"}-keyboard-focus')
                if width < 768:
                    before = ev("document.getElementById('chat-search-regex').checked")
                    client.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 1})
                    client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [position(regex_label)]})
                    client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                    wait(f"document.getElementById('chat-search-regex').checked !== {str(before).lower()}",
                         f'Touch toggles the leftmost button at {width}px, dark={dark}')
                    check_unclipped(regex_label, expanded=False)
                    # Changing the options reruns search and returns to its first result.
                    count('1/1234')
                    client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [position('#chat-search-next-btn')]})
                    client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                    count('2/1234')
                    assert ev("getComputedStyle(document.getElementById('chat-search-next-btn'), '::before').backgroundColor === 'rgba(0, 0, 0, 0)'")
                    client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})

        viewport(430)
        assert ev("""(() => {
            const panel = document.getElementById('chat-search-dialog');
            panel.style.setProperty('--safe-left', '24px');
            panel.style.setProperty('--safe-right', '32px');
            const box = panel.getBoundingClientRect(), workspace = panel.parentElement.getBoundingClientRect();
            panel.style.removeProperty('--safe-left');
            panel.style.removeProperty('--safe-right');
            return box.left - workspace.left === 24 && workspace.right - box.right >= 32;
        })()"""), 'Search bar fits asymmetric safe-area insets'

        viewport(320, 310)
        fill('chat-search-query', 'preview')
        count('1/8')
        click('#chat-search-next-btn')
        count('2/8')
        click('#chat-search-prev-btn')
        count('1/8')
        click(replace)
        fill('chat-replace-input', 'new')
        replace_plan('chat', 'model', list(range(1, 9)), 'new')
        check_replacement_layout()
        capture('320-scrollable-replacement')
        click('#chat-search-close-btn')
        assert ev("!state.chatSearch.isOpen && !state.chatReplacePreview.isOpen")

        viewport(320)
        ev('appLogic.startNewChat(); state.executionSettingsReady')
        literal = '<img src=x onerror="window.previewInjected=true">'
        messages = [
            {'role': 'model', 'content': ('longcontext' * 16 if index == 0 else '')
             + (' ' + literal + ' ' if index == 0 else '')
             + ' '.join('Alpha' if i % 2 == 0 else 'alpha' for i in range(amount)),
             'timestamp': 20 + index}
            for index, amount in enumerate([19] + [9] * 10 + [8])
        ]
        set_messages(messages)
        assert ev("dbUtils.saveChat('Replacement preview fixture')")
        click('#chat-search-open-btn')
        click('#chat-search-regex')
        click(replace)
        fill('chat-search-query', '(<img[^>]+>)')
        fill('chat-replace-input', '')
        replace_plan('chat', 'model', [0], '')
        first_group = '#chat-replace-preview-list details:first-child'
        first_heading = first_group + ' summary'
        assert ev(f"document.querySelector('{first_group}').childElementCount === 1"), 'Single match starts collapsed'
        wait('!state.chatSearch.inputTimer && !state.chatReplacePreview.timer', 'Single-match search is settled')
        assert ev(f"document.querySelector('{first_heading}').focus(); document.activeElement.matches('{first_heading}')")
        key(' ', 32)
        wait(f"document.querySelector('{first_group}').open", 'Native keyboard activation opens the group')
        wait(f"document.querySelectorAll('{first_group} .chat-replace-preview-pair').length === 1", 'Keyboard expands the single match')
        assert ev(f"""(() => {{
            const group = document.querySelector('{first_group}');
            const before = group.querySelector('.chat-replace-match-before');
            const after = group.querySelector('.chat-replace-preview-pair').lastElementChild;
            return before.textContent === {json.dumps(literal)} && !after.querySelector('mark')
                && before.parentElement.textContent.startsWith('変更前: ') && after.textContent.startsWith('変更後: ')
                && !after.textContent.includes('削除') && !after.textContent.includes('previewInjected')
                && before.parentElement.textContent.includes('longcontext') && before.parentElement.textContent.includes('Alpha')
                && !group.querySelector('img, script') && !window.previewInjected;
        }})()"""), 'Deletion and HTML-like content are rendered as text with context'

        fill('chat-search-query', '([Aa])lp(ha)')
        fill('chat-replace-input', '<$2:$1>')
        replace_plan('chat', 'model', list(range(12)), '<$2:$1>')
        assert ev("""(() => {
            const list = document.getElementById('chat-replace-preview-list');
            return state.chatReplacePreview.plan.occurrenceCount === 117
                && list.children.length === 12 && !list.querySelector('details[open], .chat-replace-preview-pair')
                && list.lastElementChild.querySelector('summary').textContent.includes('#12 / 8件');
        })()"""), 'All 12 groups are accessible without drawing the 117 match rows initially'
        click(first_heading)
        wait(f"document.querySelectorAll('{first_group} .chat-replace-preview-pair').length === 19", 'Every match in the first message is rendered')
        assert expanded_state(first_heading) is True
        assert ev(f"""(() => {{
            const first = document.querySelector('{first_group}');
            const before = [...first.querySelectorAll('.chat-replace-match-before')];
            const after = [...first.querySelectorAll('.chat-replace-match-after')];
            return before.length === 19 && before.every((mark, i) => mark.textContent === (i % 2 ? 'alpha' : 'Alpha'))
                && after.length === 19 && after.every((mark, i) => mark.textContent === (i % 2 ? '<ha:a>' : '<ha:A>'))
                && !first.querySelector('img, script')
                && after[0].parentElement.scrollWidth === after[0].parentElement.clientWidth;
        }})()"""), 'Each regex capture and its replacement is visible in the corresponding match'
        for dark in (False, True):
            custom_color = '#365f84' if dark else '#815332'
            assert ev(f"""(async () => {{
                await appLogic.saveAppearanceValues('theme', {{
                    darkMode: {str(dark).lower()}, themeColorMode: 'individual', otherButtonColor: '{custom_color}'
                }}, {{global: true}});
                return uiUtilsV136.getEffectiveOtherButtonColor().toLowerCase() === '{custom_color}';
            }})()"""), 'The existing Other Button Color setting applied'
            execute = '#chat-replace-execute-btn'
            client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': 0, 'y': 0})
            wait(f"uiUtilsV136.colorToHex(getComputedStyle(document.querySelector('{execute}')).backgroundColor).toLowerCase() === '{custom_color}'",
                 'Replace uses the configured color')
            client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **position(execute)})
            wait(f"""(() => {{
                const style = getComputedStyle(document.querySelector('{execute}'));
                return uiUtilsV136.colorToHex(style.backgroundColor).toLowerCase()
                    === style.getPropertyValue('--bg-button-hover').trim().toLowerCase()
                    && uiUtilsV136.colorToHex(style.color).toLowerCase()
                    === style.getPropertyValue('--other-button-hover-fg').trim().toLowerCase();
            }})()""", 'Replace hover follows the configured hover colors')
            ev('uiUtilsV136.setSendingState(true)')
            wait(f"""(() => {{
                const button = document.querySelector('{execute}');
                const style = getComputedStyle(button);
                return button.disabled && style.opacity === '0.45'
                    && uiUtilsV136.colorToHex(style.backgroundColor).toLowerCase() === '{custom_color}';
            }})()""", 'Disabled Replace keeps the configured color with reduced opacity')
            ev('uiUtilsV136.setSendingState(false)')
        last_group = '#chat-replace-preview-list details:last-child'
        ev("document.getElementById('chat-replace-target').focus()")
        key('ArrowDown', 40)
        wait("""document.getElementById('chat-replace-target').value === 'user'
            && state.chatReplacePreview.plan?.target === 'user' && state.chatReplacePreview.plan.occurrenceCount === 0""",
             'Keyboard can select a different target and refresh the preview')
        key('ArrowUp', 38)
        replace_plan('chat', 'model', list(range(12)), '<$2:$1>')
        assert ev("!document.querySelector('#chat-replace-preview-list details[open]')"), 'A new plan starts collapsed'
        click(first_heading)
        wait(f"document.querySelectorAll('{first_group} .chat-replace-preview-pair').length === 19", 'First group reopened')
        ev(f"document.querySelector('{last_group} summary').scrollIntoView({{block:'nearest'}})")
        click(last_group + ' summary')
        wait(f"document.querySelectorAll('{last_group} .chat-replace-preview-pair').length === 8", 'The last group also exposes its matches')
        wait(f"!document.querySelector('{first_group}').open && !document.querySelector('{first_group} .chat-replace-preview-pair')",
             'Opening the last group closes and clears the first')
        assert expanded_state(first_heading) is False
        assert expanded_state(last_group + ' summary') is True
        assert ev(f"""(() => {{
            const list = document.getElementById('chat-replace-preview-list').getBoundingClientRect();
            const heading = document.querySelector('{last_group} summary').getBoundingClientRect();
            const detail = document.querySelector('{last_group} .chat-replace-preview-pair').getBoundingClientRect();
            return heading.top >= list.top - 1 && detail.top < list.bottom && state.chatReplacePreview.plan.occurrenceCount === 117;
        }})()"""), 'Switching groups keeps the new heading and its details in view'
        click(last_group + ' summary')
        wait("!document.querySelector('#chat-replace-preview-list details[open], #chat-replace-preview-list .chat-replace-preview-pair')",
             'Activating the open heading collapses it and clears its rows')
        assert expanded_state(last_group + ' summary') is False

        for width in (320, 375, 430, 768, 1280):
            viewport(width)
            wait(f"""(async () => {{
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return innerWidth === {width} && !state.chatReplacePreview.timer && !state.chatSearch.inputTimer;
            }})()""",
                 'Replacement settles after viewport changes')
            for dark in (False, True):
                ev(f"document.body.classList.toggle('dark-mode', {str(dark).lower()})")
                check_replacement_fields(width)
                if not ev(f"document.querySelector('{first_group}').open"):
                    click(first_heading)
                wait(f"document.querySelectorAll('{first_group} .chat-replace-preview-pair').length === 19",
                     'The expanded message is ready for layout checks')
                check_replacement_layout()
                assert ev(f"""(() => {{
                    const before = document.querySelector('{first_group} .chat-replace-match-before');
                    const after = document.querySelector('{first_group} .chat-replace-match-after');
                    return getComputedStyle(before).color !== getComputedStyle(after).color
                        && getComputedStyle(before).backgroundColor !== getComputedStyle(after).backgroundColor;
                }})()"""), 'Before and after use distinct colors in both themes'
                ev("document.getElementById('chat-replace-preview-list').scrollTop = 0")
                if width in (320, 1280):
                    wait("""(() => {
                        const panel = document.getElementById('chat-replace-preview-panel');
                        return ['chat-replace-input', 'chat-replace-back-btn'].every(id =>
                            getComputedStyle(document.getElementById(id)).backgroundColor === getComputedStyle(panel).backgroundColor);
                    })()""", 'The replacement controls finished changing theme')
                    capture(f'{width}-{"dark" if dark else "light"}-replacement-matches')

        viewport(320, 740)
        assert ev("""(() => {
            const viewport = visualViewport;
            Object.defineProperties(viewport, {
                offsetTop: {configurable: true, value: 36},
                height: {configurable: true, value: 220},
            });
            try {
                uiUtilsV136.updateChatWorkspaceLayout();
                const search = document.querySelector('.chat-search-field').getBoundingClientRect();
                const panel = document.getElementById('chat-replace-preview-panel').getBoundingClientRect();
                const execute = document.getElementById('chat-replace-execute-btn').getBoundingClientRect();
                return search.top >= 36 && panel.bottom <= 256 && execute.bottom <= panel.bottom;
            } finally {
                delete viewport.offsetTop;
                delete viewport.height;
                uiUtilsV136.updateChatWorkspaceLayout();
            }
        })()"""), 'The controls fit a panned 220px visual viewport'
        ev("document.getElementById('chat-replace-preview-list').scrollTop = 0")
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 1})
        was_open = ev(f"document.querySelector('{first_group}').open")
        client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [position(first_heading)]})
        client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        wait(f"document.querySelector('{first_group}').open !== {str(was_open).lower()}", 'Touch toggles the first group')
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        replace_plan('chat', 'model', list(range(12)), '<$2:$1>')
        wait("!document.getElementById('chat-replace-execute-btn').disabled", 'The full plan is ready')
        click('#chat-replace-execute-btn')
        wait("!state.chatReplacePreview.isExecuting", 'The full replacement has been saved')
        expected = [message['content'].replace('Alpha', '<ha:A>').replace('alpha', '<ha:a>') for message in messages]
        assert contents() == expected
        assert ev("dbUtils.getChat(state.currentChatId).then(chat => chat.messages.map(message => message.content))") == expected
        assert ev("""loadChangeHistory(state.currentChatId, true).then(entries =>
            entries.length === 1 && entries[0].occurrenceCount === 117 && entries[0].changes.length === 12
                && entries[0].changes.every(change => !Object.hasOwn(change, 'occurrences')))""")

        fill('chat-search-query', '(<img[^>]+>)')
        fill('chat-replace-input', '')
        replace_plan('chat', 'model', [0], '')
        click('#chat-replace-execute-btn')
        wait("!state.chatReplacePreview.isExecuting", 'Deletion has been saved')
        expected[0] = expected[0].replace(literal, '')
        assert contents() == expected, 'Deletion marker never enters the chat text'

        assert ev("""(async () => {
            const sourceChat = state.currentChatId;
            const refresh = appLogic.updateChangeHistoryControls;
            let release;
            appLogic.updateChangeHistoryControls = () => new Promise(resolve => { release = resolve; });
            let pending;
            try {
                pending = appLogic.applyChangeHistoryEntry('undo', 'replace');
                await Promise.resolve();
                await Promise.resolve();
            } finally {
                appLogic.updateChangeHistoryControls = refresh;
            }
            if (!release) throw new Error('Undo did not reach its pre-apply check');
            appLogic.startNewChat();
            await state.executionSettingsReady;
            release();
            await pending;
            const entries = await loadChangeHistory(sourceChat, true);
            return state.currentChatId === null && state.currentMessages.length === 0
                && entries.length === 2 && entries.every(entry => entry.status === 'applied');
        })()"""), 'An Undo still preparing at chat switch cannot apply to either chat'

        long_match = 'LONG' + '😀' * 70
        quote_cases = [
            ('NEEDLE' + 'a' * 80, 'NEEDLE' + 'a' * 50 + '…', 'NEEDLE!' + 'a' * 50 + '…', ['NEEDLE']),
            ('b' * 60 + 'NEEDLE' + 'c' * 60, '…' + 'b' * 25 + 'NEEDLE' + 'c' * 25 + '…',
             '…' + 'b' * 25 + 'NEEDLE!' + 'c' * 25 + '…', ['NEEDLE']),
            ('d' * 80 + 'NEEDLE', '…' + 'd' * 50 + 'NEEDLE', '…' + 'd' * 50 + 'NEEDLE!', ['NEEDLE']),
            ('前: NEEDLE :後', '前: NEEDLE :後', '前: NEEDLE! :後', ['NEEDLE']),
            ('前:' + long_match + ':後', '前:' + long_match + ':後', '前:' + long_match + '!:後', [long_match]),
            ('先頭: CROSS\r\nLINE :末尾', '先頭: CROSS\r\nLINE :末尾', '先頭: CROSS\r\nLINE! :末尾', ['CROSS\r\nLINE']),
            ('NEEDLE : NEEDLE', 'NEEDLE : NEEDLE', 'NEEDLE! : NEEDLE!', ['NEEDLE', 'NEEDLE']),
            ('😀' * 60 + 'NEEDLE' + '😀' * 60, '…' + '😀' * 25 + 'NEEDLE' + '😀' * 25 + '…',
             '…' + '😀' * 25 + 'NEEDLE!' + '😀' * 25 + '…', ['NEEDLE']),
        ]
        set_messages([
            {'role': 'model', 'content': 'PREVIOUS LINE\r\n' + source + '\u2028NEXT LINE', 'timestamp': 200 + index}
            for index, (source, _, _, _) in enumerate(quote_cases)
        ])
        click('#chat-search-open-btn')
        click('#chat-search-regex')
        click(replace)
        fill('chat-search-query', r'NEEDLE|LONG(?:😀)+|CROSS\r\nLINE')
        fill('chat-replace-input', '$&!')
        replace_plan('chat', 'model', list(range(len(quote_cases))), '$&!')
        wait('!state.chatSearch.inputTimer && !state.chatReplacePreview.timer', 'Quote preview has settled')
        for index, (_, before, after, matches) in enumerate(quote_cases, start=1):
            group = f'#chat-replace-preview-list details:nth-child({index})'
            click(group + ' summary')
            wait(f"document.querySelectorAll('{group} .chat-replace-preview-pair').length === {len(matches)}",
                 f'Quote case {index} shows every match')
            actual = ev(f"""Array.from(document.querySelectorAll('{group} .chat-replace-preview-pair'), pair => [
                pair.firstElementChild.textContent, pair.lastElementChild.textContent,
                pair.querySelector('.chat-replace-match-before').textContent,
                pair.querySelector('.chat-replace-match-after').textContent
            ])""")
            assert actual == [['変更前: ' + before, '変更後: ' + after, match, match + '!'] for match in matches], actual
        long_group = '#chat-replace-preview-list details:nth-child(5)'
        click(long_group + ' summary')
        wait(f"Boolean(document.querySelector('{long_group} .chat-replace-match-before'))", 'Long match group reopened')
        assert ev("""(() => {
            const mark = document.querySelector('#chat-replace-preview-list details:nth-child(5) .chat-replace-match-before');
            const row = mark.parentElement;
            const style = getComputedStyle(row);
            return innerWidth === 320 && mark.getClientRects().length > 1 && row.scrollWidth <= row.clientWidth
                && style.whiteSpace === 'pre-wrap' && style.textOverflow === 'clip';
        })()"""), 'The entire long match wraps at 320px without clipping'
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        viewport(1280, 900)
    return 'ALL PASSED (chat search/replace, logical-line quotes, theme colors, 117 previews, replacement-only undo/redo, 5 widths in both themes)'

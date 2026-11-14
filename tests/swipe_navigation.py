"""Swipe the real app with Chrome touch input, plus deterministic cancellation cases."""
import json
import time


def run(client, url):
    chat = '#chat-screen .main-content'
    settings_top = '#settings-screen .settings-layout'
    settings_detail = '#settings-detail'
    touch_id = 0

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
            try:
                if ev(expression):
                    return
            except RuntimeError as error:
                detail = error.args[0]
                if not isinstance(detail, dict) or detail.get('message') != 'Inspected target navigated or closed':
                    raise
            time.sleep(0.05)
        details = ev("[state.currentScreen, location.hash, settingsUiV136.category, swipeFixtureTrace.slice(-10)]")
        raise AssertionError(f'{label}: {details}')

    def screen(name, fragment=None):
        wait(f"""state.currentScreen === '{name}' && location.hash === {json.dumps(fragment or '#' + name)}
            && !appLogic.swipeSnap?.committing
            && !document.getElementById('{name}-screen').getAnimations().some(animation =>
                animation.transitionProperty === 'transform' && animation.playState === 'running')""",
             f'Navigated to {fragment or name}')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def viewport(width):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': 740, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })
        wait(f"innerWidth === {width} && settingsUiV136.media.matches === {str(width >= 800).lower()}",
             f'Viewport is {width}px')
        ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

    def touch(event, points):
        client.call('Input.dispatchTouchEvent', {
            'type': event, 'touchPoints': points, 'timestamp': time.time(),
        })

    def tap(selector, *, dwell=0):
        nonlocal touch_id
        touch_id += 1
        point = ev(f"""(() => {{
            const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            return {{x: r.left + r.width / 2, y: r.top + r.height / 2, id: {touch_id}}};
        }})()""")
        touch('touchStart', [point])
        if dwell:
            time.sleep(dwell)
        touch('touchEnd', [])

    def manual_gesture(steps):
        nonlocal touch_id
        touch_id += len(steps[0])
        for i, points in enumerate(steps):
            if i:
                time.sleep(0.035)
            touch('touchMove' if i else 'touchStart', [
                {'x': x, 'y': y, 'id': touch_id + j} for j, (x, y) in enumerate(points)
            ])
        touch('touchEnd', [])
        touch_id += len(steps[0])
        ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

    def pinch(enlarge):
        if enlarge:
            manual_gesture([[(115-i*5, 270-i*8), (145+i*5, 330+i*8)] for i in range(10)])
        else:
            manual_gesture([[(75+i*4, 215+i*7), (175-i*4, 355-i*7)] for i in range(10)])

    def pan_viewport(axis):
        prop = 'offsetLeft' if axis == 'x' else 'offsetTop'
        start = ev(f'visualViewport.{prop}')
        for direction in (-1, 1):
            dx, dy = (direction * 80, 0) if axis == 'x' else (0, direction * 110)
            manual_gesture([[(170+dx*i/8, 300+dy*i/8)] for i in range(9)])
            if abs(ev(f'visualViewport.{prop}') - start) > 2:
                return
        raise AssertionError(f'Zoomed visual viewport did not pan on {axis}: {start}, {ev(f"visualViewport.{prop}")}')

    def drag(selector, dx, dy=0, *, padding=False, cancel=False, measure=False, initial_drift=False):
        nonlocal touch_id
        touch_id += 1
        origin = ev(f"""(() => {{
            const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
            const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
            return {{x: {('left + 6' if dx >= 0 else 'right - 8') if padding else f'Math.max(left + 1, Math.min(right - 1, (left + right - ({dx})) / 2))'},
                y: {('bottom - 50' if selector == settings_top else f'(top + bottom - ({dy})) / 2')} }};
        }})()""")
        point = lambda step: {'x': origin['x'] + dx * step / 8, 'y': origin['y'] + dy * step / 8, 'id': touch_id}
        position = "document.querySelector('.screen.active').getBoundingClientRect().left"
        before = ev(position) if measure else None
        touch('touchStart', [point(0)])
        if initial_drift:
            # Force Chrome to deliver this first sample before any stronger horizontal move.
            first = {'x': origin['x'] + (14 if dx > 0 else -14), 'y': origin['y'] + 10, 'id': touch_id}
            touch('touchMove', [first])
            wait(f"""swipeFixtureTrace.some(event => event.type === 'touchmove' && event.id === {touch_id}
                && Math.abs(event.x - {first['x']}) < 1 && Math.abs(event.y - {first['y']}) < 1)""",
                 'Initial drift was delivered')
        for step in range(2 if initial_drift else 1, 9):
            time.sleep(0.018)
            touch('touchMove', [point(step)])
            if measure and step in (4, 8):
                # Chrome can hold the last CDP move until the next input. Measure the delivered contact.
                wait(f"""(() => {{
                    const last = swipeFixtureTrace.at(-1);
                    const delta = last.x - {origin['x']};
                    return last.type === 'touchmove' && last.id === {touch_id} && delta >= {dx * (step - 1) / 8}
                        && Math.abs(({position}) - ({before}) - (delta - 10)) < 2;
                }})()""", f'Native drag reached step {step}')
        touch('touchCancel' if cancel else 'touchEnd', [])

    def synthetic(selector, moves, end, start=(100, 300), *, captured=False):
        points = [[0, *start], *[[0, *position] for position in moves], [0, *end]]
        assert ev(f"""(() => {{
            const points = {json.dumps(points)}, target = {json.dumps(selector)};
            const allowed = swipeFixtureEvent(target, 'touchstart', [points[0]]) &&
                points.slice(1, -1).every(point => swipeFixtureEvent(target, 'touchmove', [point]));
            return swipeFixtureEvent(target, 'touchend', [], [points.at(-1)]) === {str(not captured).lower()} && allowed;
        }})()"""), 'Only the release of a captured drawer drag may cancel its tap'

    def settled_sidebar(opened):
        wait(f"""(() => {{
            const panel = elements.chatHistorySidebar.getBoundingClientRect();
            const x = panel.left - elements.chatScreen.getBoundingClientRect().left;
            return chatSidebarUiState.isOpen === {str(opened).lower()} &&
                Math.abs(x - ({'0' if opened else '-panel.width'})) < 0.5 &&
                !elements.chatScreen.classList.contains('chat-sidebar-dragging');
        }})()""", 'Drawer animation reached its endpoint')

    def unchanged(action):
        before = ev('[state.currentScreen, location.hash, history.length, settingsUiV136.category]')
        action()
        ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        assert ev('[state.currentScreen, location.hash, history.length, settingsUiV136.category]') == before, before

    def feedback_clear():
        wait("""!appLogic.swipeSnap && !appLogic.swipePreview &&
            [...document.querySelectorAll('.screen, #settings-detail')].every(el =>
                !el.style.translate && getComputedStyle(el).translate === 'none')""", 'Swipe feedback is fully cleared')

    def release_with_feedback(selector, element, dx, *, follows=True, animated=True):
        result = ev(f"""(async () => {{
            const target = {json.dumps(selector)}, element = document.querySelector({json.dumps(element)});
            const detail = element.id === 'settings-detail';
            const neighbor = document.querySelector(detail ? '.settings-category-nav' : element.id === 'chat-screen'
                ? '#settings-screen' : '#chat-screen');
            const before = element.getBoundingClientRect().left;
            const neighborBefore = neighbor.getBoundingClientRect().left;
            swipeFixtureEvent(target, 'touchstart', [[0, 180, 300]]);
            swipeFixtureEvent(target, 'touchmove', [[0, 180 + ({dx}), 300]]);
            await new Promise(requestAnimationFrame);
            const offset = element.getBoundingClientRect().left - before;
            const neighborBounds = neighbor.getBoundingClientRect();
            const clip = document.querySelector('.app-container').getBoundingClientRect();
            const preview = neighbor.inert && neighborBounds.right > clip.left && neighborBounds.left < clip.right;
            const settingsEntry = neighbor.id !== 'settings-screen' || (innerWidth < 800
                ? neighbor.classList.contains('settings-show-top') : !neighbor.querySelector('[data-settings-panel=general]').hidden);
            const adjacentOffset = neighborBounds.left - neighborBefore;
            swipeFixtureEvent(target, 'touchend', [], [[0, 180 + ({dx}), 300]]);
            const released = element.getBoundingClientRect().left - before;
            const duration = appLogic.swipeSnap?.animations[0].effect.getTiming().duration ?? null;
            return {{offset, released, duration, preview, adjacentOffset, detail, settingsEntry, width:innerWidth,
                lastTouches:swipeFixtureTrace.slice(-3)}};
        }})()""")
        if follows:
            assert abs(result['offset'] - (dx - (10 if dx > 0 else -10))) < 0.5, result
            assert result['preview'] and result['settingsEntry'], result
            if not result['detail']:
                assert abs(result['adjacentOffset'] - result['offset']) < 0.5, result
            if animated:
                assert 180 <= result['duration'] <= 320, result
                assert abs(result['released'] - result['offset']) < 2, result
            else:
                assert result['duration'] is None, result
        else:
            assert abs(result['offset']) < 0.1 and result['duration'] is None, result

    def boot(reload=False):
        origin = ev('performance.timeOrigin')
        client.call('Page.reload' if reload else 'Page.navigate',
                    {} if reload else {'url': url + '?swipeNavigationFixture=1'})
        wait(f"""performance.timeOrigin > {origin} && location.search === '?swipeNavigationFixture=1'
            && Boolean(window.appLogic?._setupEventListenersCallCount) && !document.querySelector('#progressDialog[open]')""",
             'App startup completed')
        if ev("document.querySelector('#releaseNotesDialog[open]') !== null"):
            click('#releaseNotesDialog .dialog-ok-btn')
            wait("!document.querySelector('#releaseNotesDialog[open]')", 'Release notes closed')

    socket_timeout = client.sock.gettimeout()
    client.sock.settimeout(20)
    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 2})
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?swipeNavigationFixture=1') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
            window.swipeFixtureEvent = (selector, type, points, changed = points, time) => {
                const target = document.querySelector(selector);
                const touches = values => values.map(([identifier, clientX, clientY]) =>
                    new Touch({identifier, clientX, clientY, target}));
                const event = new TouchEvent(type, {
                    bubbles: true, cancelable: true, touches: touches(points), changedTouches: touches(changed)
                });
                if (time !== undefined) Object.defineProperty(event, 'timeStamp', {value: time});
                return target.dispatchEvent(event);
            };
            window.swipeFixtureMoves = [];
            window.swipeFixtureTrace = [];
            for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
                document.addEventListener(type, event => {
                    const touch = event.changedTouches[0];
                    swipeFixtureTrace.push({type, id: touch?.identifier, x: touch?.clientX, y: touch?.clientY,
                        target: event.target.tagName + '#' + event.target.id + '.' + event.target.className,
                        tracked: Boolean(window.appLogic?.swipeGesture), screen: window.state?.currentScreen,
                        touches: Array.from(event.touches, point => [point.identifier, point.clientX, point.clientY])});
                }, {passive: true});
            }
            document.addEventListener('touchmove', event => swipeFixtureMoves.push({
                trusted: event.isTrusted, cancelable: event.cancelable, prevented: event.defaultPrevented
            }), {passive: true});
        }
    """})['identifier']
    try:
        # Establish the default, then use the production checkbox and reload its persisted value.
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': 375, 'height': 740, 'deviceScaleFactor': 1, 'mobile': True,
        })
        boot()
        screen('chat')
        assert ev("!state.settings.enableSwipeNavigation && !document.documentElement.classList.contains('swipe-navigation-enabled')")
        unchanged(lambda: drag(chat, -104))
        unchanged(lambda: synthetic(chat, [(205, 300)], (245, 300), start=(140, 300)))
        click('#goto-settings-btn')
        screen('settings')
        unchanged(lambda: drag(settings_top, 104))
        tap('[data-settings-category="other"]')
        screen('settings', '#settings/other')
        unchanged(lambda: drag(settings_detail, 104, padding=True))
        assert ev("document.getElementById('swipe-navigation-toggle').closest('label').textContent.trim() === '左右スワイプで画面を移動する'")
        click('#swipe-navigation-toggle')
        wait("(async () => (await dbUtils.getSetting('localUiSettings'))?.value.enableSwipeNavigation === true)()",
             'Swipe setting saved')
        boot(reload=True)
        screen('settings', '#settings/other')
        assert ev("""state.settings.enableSwipeNavigation && document.getElementById('swipe-navigation-toggle').checked
            && getComputedStyle(document.documentElement).overscrollBehaviorX === 'contain'""")

        unchanged(lambda: drag(settings_detail, -104, padding=True))
        ev("document.getElementById('settings-detail').scrollTop = 0")
        drag(settings_detail, 0, -170, padding=True)
        wait("document.getElementById('settings-detail').scrollTop > 0", 'Settings vertical scroll works')
        screen('settings', '#settings/other')
        depth = ev('history.length')
        swipe_label = 'label:has(#swipe-navigation-toggle)'
        ev(f"document.querySelector({json.dumps(swipe_label)}).scrollIntoView({{block:'center'}})")
        drag(swipe_label, 104)
        screen('settings')
        assert ev('settingsUiV136.category') is None and ev('history.length') == depth
        assert ev('state.settings.enableSwipeNavigation'), 'Swiping the label did not toggle its checkbox'
        ev('history.forward()')
        screen('settings', '#settings/other')
        ev('history.back()')
        screen('settings')
        click('[data-settings-category="other"]')
        screen('settings', '#settings/other')
        click('#back-to-chat-from-settings')
        screen('settings')
        click('[data-settings-category="appearance"]')
        screen('settings', '#settings/appearance')
        ev("document.getElementById('dark-mode-toggle').focus()")
        unchanged(lambda: synthetic('#dark-mode-toggle', [(160, 300)], (205, 300)))
        ev("document.getElementById('dark-mode-toggle').blur()")
        unchanged(lambda: synthetic('#overlay-opacity-slider', [(160, 300)], (205, 300)))
        slider = '#overlay-opacity-slider'
        ev(f"document.querySelector('{slider}').scrollIntoView({{block:'center'}})")
        old_value, thumb_x, slider_y, slider_dx = ev(f"""(() => {{
            const input = document.querySelector('{slider}'), rect = input.getBoundingClientRect();
            const fraction = (input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min));
            return [input.value, rect.left + 8 + (rect.width - 16) * fraction,
                rect.top + rect.height / 2, fraction < 0.5 ? 70 : -70];
        }})()""")
        touch_id += 1
        point = {'x': thumb_x, 'y': slider_y, 'id': touch_id}
        touch('touchStart', [point])
        for step in range(1, 7):
            touch('touchMove', [{**point, 'x': thumb_x + slider_dx * step / 6}])
        touch('touchEnd', [])
        wait(f"document.querySelector('{slider}').value !== {json.dumps(old_value)}",
             'The range keeps native thumb drag behavior')
        screen('settings', '#settings/appearance')
        ev("document.getElementById('dark-mode-toggle').scrollIntoView({block:'center'})")
        drag('#dark-mode-toggle', 104)
        screen('settings')
        click('[data-settings-category="appearance"]')
        screen('settings', '#settings/appearance')
        # Two end-to-end gestures in the same task must not queue two history.back() calls.
        assert ev(f"""(() => {{
            const target = {json.dumps(settings_detail)};
            for (let i = 0; i < 2; i++) {{
                swipeFixtureEvent(target, 'touchstart', [[0, 100, 300]]);
                swipeFixtureEvent(target, 'touchend', [], [[0, 205, 300]]);
            }}
            return Boolean(appLogic.swipeSettingsBackTimer);
        }})()""")
        screen('settings')
        unchanged(lambda: drag(settings_top, -104))
        assert ev('settingsUiV136.category') is None
        drag('[data-settings-category="general"]', 104)
        screen('chat')
        ev('history.back()')
        screen('settings')
        ev('history.forward()')
        screen('chat')
        # Chrome's CDP touch emulation can retain a released contact when the app
        # hides its target during touchend. Isolate subsequent native streams.
        boot(reload=True)
        screen('chat')

        ev("""window.headerTaps = 0;
            document.getElementById('goto-settings-btn').addEventListener('click', () => headerTaps++);""")
        tap('#goto-settings-btn')
        screen('settings')
        assert ev('headerTaps === 1'), 'A normal header tap still opens settings'
        click('#back-to-chat-from-settings')
        screen('chat')
        ev("document.getElementById('goto-settings-btn').focus({preventScroll:true})")
        drag('#goto-settings-btn', -104)
        screen('settings')
        assert ev('headerTaps === 1'), 'A focused header button allows a swipe without another click'
        click('#back-to-chat-from-settings')
        screen('chat')
        boot(reload=True)
        screen('chat')
        tap('#user-input')
        wait("document.activeElement.id === 'user-input'", 'A tap focuses the composer')
        unchanged(lambda: drag('#user-input', -104))
        assert ev("document.activeElement.id === 'user-input'")
        boot(reload=True)
        screen('chat')
        assert ev("document.activeElement.id !== 'user-input'")
        drag('#user-input', -104)
        screen('settings')
        click('#back-to-chat-from-settings')
        screen('chat')
        boot(reload=True)
        screen('chat')

        ev("""(async () => {
            const tx = state.db.transaction(CHATS_STORE, 'readwrite');
            const store = tx.objectStore(CHATS_STORE);
            for (let i = 0; i < 35; i++) store.add({
                title: 'Swipe fixture ' + i, updatedAt: i + 1, createdAt: i + 1,
                profileId: state.activeProfileId, messages: [{role: 'user', content: 'fixture ' + i}]
            });
            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; });
        })()""")
        drag(chat, 104, 12, padding=True, initial_drift=True)
        wait("chatSidebarUiState.isOpen && document.querySelectorAll('.chat-sidebar-item').length>=35",
             'A left-edge swipe with initial drift opens the complete sidebar')
        # Chrome can suppress a compatibility click when CDP starts another
        # contact immediately after a drag. Leave time for a distinct tap.
        time.sleep(0.22)
        tap('.chat-sidebar-item .chat-sidebar-item-menu')
        wait("!elements.historyItemMenu.classList.contains('hidden')", 'Tapping a row menu works')
        ev("uiUtilsV136.closeHistoryItemMenu()")
        tap('#chat-sidebar-search-toggle')
        wait("document.activeElement.id === 'chat-sidebar-search-input'", 'Search opens and focuses')
        client.call('Input.insertText', {'text': 'fixture 34'})
        wait("document.querySelectorAll('.chat-sidebar-item').length === 1", 'Sidebar can search message text')
        click('#chat-sidebar-search-toggle')
        wait("document.querySelectorAll('.chat-sidebar-item').length>=35", 'Closing search restores all rows')
        drag('#chat-sidebar-scroll', 0, -180)
        wait("elements.chatSidebarScroll.scrollTop > 0", 'Sidebar vertical scroll works')
        # Reset CDP's contact bookkeeping after the opening swipe changes
        # which element is under the original contact.
        boot(reload=True)
        screen('chat')
        click('#goto-history-btn')
        wait("chatSidebarUiState.isOpen && document.querySelectorAll('.chat-sidebar-item').length>=35", 'Sidebar ready for the closing swipe')
        settled_sidebar(True)
        ev("""const row = [...document.querySelectorAll('.chat-sidebar-item-open')].find(button=>{
            const rect=button.getBoundingClientRect();
            return rect.top>220 && rect.bottom<450;
        });
        row.dataset.swipeTestTarget = '';
        window.historySwipeClicks = 0;
        row.addEventListener('click', () => historySwipeClicks++);""")
        drag('[data-swipe-test-target]', -104, 12, initial_drift=True)
        wait("!chatSidebarUiState.isOpen", 'A reverse swipe from a history row with initial drift closes the sidebar')
        assert ev("historySwipeClicks === 0 && state.currentChatId === null"), 'Reverse swipe does not select the row'
        boot(reload=True)
        screen('chat')
        drag(chat, 104, padding=True)
        row = '.chat-sidebar-item-open'
        wait(f"chatSidebarUiState.isOpen && Boolean(document.querySelector('{row}'))", 'Sidebar is ready after the opening swipe')
        chosen = ev(f"document.querySelector('{row}').dataset.chatId")
        # A distinct contact after a CDP drag avoids Chrome suppressing its click.
        time.sleep(0.20)
        tap(row, dwell=0.06)
        wait(f"!chatSidebarUiState.isOpen && String(state.currentChatId) === {json.dumps(chosen)}",
             'A native tap after opening selects the intended chat')
        boot(reload=True)
        screen('chat')
        assert ev(f"getComputedStyle(document.querySelector({json.dumps(chat)})).touchAction === 'pan-y pinch-zoom'")
        for target, start, end, expected in [(chat, 187, 292, True), ('#chat-sidebar-scroll', 185, 80, False)]:
            ev(f"""(() => {{
                const target = {json.dumps(target)};
                swipeFixtureEvent(target, 'touchstart', [[0, {start}, 300]]);
                swipeFixtureEvent(target, 'touchmove', [[0, {end}, 300]]);
                window.dispatchEvent(new Event('resize'));
                swipeFixtureEvent(target, 'touchend', [], [[0, {end}, 300]]);
            }})()""")
            wait(f'chatSidebarUiState.isOpen === {str(expected).lower()}',
                 'A height-only browser resize keeps the sidebar swipe active')
        for cancellation in ('pointercancel', 'touchcancel'):
            assert ev(f"""(() => {{
                const selector = {json.dumps(chat)};
                const target = document.querySelector(selector);
                swipeFixtureEvent(selector, 'touchstart', [[0, 10, 300]]);
                swipeFixtureEvent(selector, 'touchmove', [[0, 84, 310]]);
                if (!appLogic.swipeGesture) return false;
                if ({json.dumps(cancellation)} === 'pointercancel') {{
                    target.dispatchEvent(new PointerEvent('pointercancel', {{bubbles:true, pointerType:'touch', isPrimary:true}}));
                }} else {{
                    swipeFixtureEvent(selector, 'touchcancel', []);
                }}
                swipeFixtureEvent(selector, 'touchend', [], [[0, 115, 312]]);
                return !appLogic.swipeGesture && !chatSidebarUiState.isOpen;
            }})()"""), f'{cancellation} must prevent a late touchend from opening the sidebar'
        click('#goto-history-btn')
        wait('chatSidebarUiState.isOpen', 'Header opens the sidebar at normal zoom')
        manual_gesture([[(ev('innerWidth') - 20, 300)]])
        wait('!chatSidebarUiState.isOpen', 'Native tap outside closes the sidebar')
        settled_sidebar(False)
        width = ev('elements.chatHistorySidebar.getBoundingClientRect().width')
        drawer_x = '(elements.chatHistorySidebar.getBoundingClientRect().left - elements.chatScreen.getBoundingClientRect().left)'
        for opened, origin, direction, positions, finish, expected in [
            (False, 48, 1, (36, 72, 32), 'touchEnd', False),
            (False, 48, 1, (36, 118), 'touchEnd', True),
            (True, 205, -1, (34, 73, 31), 'touchEnd', True),
            (True, 205, -1, (34, 116), 'touchEnd', False),
            (False, 187, 1, (36, 72, 48, 110), 'touchEnd', True),
            (True, 205, -1, (34, 116), 'touchEnd', False),
            (False, 258, 1, (36, 72, 48, 110), 'touchEnd', True),
            (True, 205, -1, (34, 116), 'touchEnd', False),
            (False, 258, 1, (36, 64), 'touchCancel', False),
        ]:
            settled_sidebar(opened)
            touch_id += 1
            point = lambda delta: {'x': origin + direction * delta, 'y': 390, 'id': touch_id}
            touch('touchStart', [point(0)])
            for delta in positions:
                touch('touchMove', [point(delta)])
                offset = (0 if opened else -width) + direction * delta
                progress = 1 + offset / width
                wait(f"""Math.abs({drawer_x} - ({offset})) < 1 &&
                    Math.abs(Number(getComputedStyle(elements.chatSidebarBackdrop).opacity) - {progress}) < .02 &&
                    elements.chatScreen.classList.contains('chat-sidebar-dragging') &&
                    chatSidebarUiState.isOpen === {str(opened).lower()}""",
                     f'Native drawer and backdrop follow the touch from x={origin}')
            # The distance tests must not inherit velocity from the last move.
            time.sleep(0.12)
            touch(finish, [])
            wait("""Boolean(getComputedStyle(elements.chatHistorySidebar).transform) &&
                elements.chatHistorySidebar.getAnimations().some(animation => animation.transitionProperty === 'transform')""",
                 'Release or cancel animates from the drag position')
            settled_sidebar(expected)
            assert ev("!elements.chatScreen.style.getPropertyValue('--sidebar-offset') && "
                      "!elements.chatScreen.style.getPropertyValue('--sidebar-progress')")

        for opened, origin, direction, duration, expected in [
            (False, 330, 1, 260, False),
            (False, 330, 1, 40, True),
            (True, 205, -1, 40, False),
        ]:
            settled_sidebar(opened)
            target = '#chat-sidebar-scroll' if opened else chat
            ev(f"""(() => {{
                const target = {json.dumps(target)}, start = [0, {origin}, 390], end = [0, {origin + direction * 36}, 390];
                swipeFixtureEvent(target, 'touchstart', [start], [start], 1000);
                swipeFixtureEvent(target, 'touchmove', [end], [end], {1000 + duration - 5});
                swipeFixtureEvent(target, 'touchend', [], [end], {1000 + duration});
            }})()""")
            settled_sidebar(expected)

        ev(f"""(() => {{
            const target = {json.dumps(chat)};
            swipeFixtureEvent(target, 'touchstart', [[0, 48, 390]]);
            swipeFixtureEvent(target, 'touchmove', [[0, 90, 390]]);
        }})()""")
        wait("elements.chatScreen.classList.contains('chat-sidebar-dragging')", 'A drawer drag is in progress')
        click('#goto-history-btn')
        settled_sidebar(True)
        ev(f"swipeFixtureEvent({json.dumps(chat)}, 'touchend', [], [[0, 100, 390]])")
        assert ev('chatSidebarUiState.isOpen && !appLogic.swipeGesture')
        click('#chat-sidebar-backdrop')
        settled_sidebar(False)
        ev("""(() => {
            state.currentMessages = [{role: 'model',
                content: 'Horizontal code below\\n\\n\\x60\\x60\\x60\\n' + '0123456789'.repeat(70)
                    + '\\n\\x60\\x60\\x60\\n\\n' + 'Vertical scroll fixture text.\\n\\n'.repeat(60)}];
            uiUtilsV136.renderChatMessages();
            document.querySelector('#chat-screen .main-content').scrollTop = 0;
        })()""")
        wait("document.querySelector('#chat-screen .main-content').scrollHeight > innerHeight * 2", 'Chat content is scrollable')
        drag(chat, 4, -180, padding=True)
        wait("document.querySelector('#chat-screen .main-content').scrollTop > 0", 'Chat vertical scroll works')
        ev("document.querySelector('.message.model pre').scrollIntoView({block:'center'})")
        wait("document.querySelector('.message.model pre').scrollWidth > document.querySelector('.message.model pre').clientWidth",
             'Code has real horizontal overflow')
        drag('.message.model pre', -104)
        wait("document.querySelector('.message.model pre').scrollLeft > 0", 'Native code scrolling works')
        assert ev("""swipeFixtureMoves.some(event => event.trusted && !event.cancelable)
            && swipeFixtureMoves.every(event => !event.prevented)"""), 'Native scrolling commits without prevented touch events'
        code_offset = ev("document.querySelector('.message.model pre').scrollLeft")
        drag('.message.model pre', 104)
        wait(f"document.querySelector('.message.model pre').scrollLeft < {code_offset}",
             'A right drag scrolls the code without opening the drawer')
        settled_sidebar(False)
        screen('chat')
        ev("document.querySelector('#chat-screen .main-content').scrollTop = 0")

        for moves, end, captured in [
            ([(104, 335), (205, 336)], (210, 336), False),   # Vertical first, then horizontal.
            ([(140, 335)], (190, 380), False),              # Diagonal.
            ([(130, 300)], (127, 300), True),               # Below both commit distances.
            ([(190, 300)], (125, 300), True),               # Returned below the threshold before release.
        ]:
            unchanged(lambda: synthetic(chat, moves, end, captured=captured))
            settled_sidebar(False)
        ev("getSelection().selectAllChildren(document.querySelector('.message.model .message-content p'))")
        synthetic(chat, [(225, 300)], (300, 300), start=(185, 300))
        assert ev("!getSelection().isCollapsed && !chatSidebarUiState.isOpen")
        ev("getSelection().removeAllRanges()")
        for selector in ('#chat-search-dialog', '#chat-replace-preview-list', '.message.model pre'):
            if selector == '#chat-search-dialog':
                click('#chat-search-open-btn')
            unchanged(lambda: synthetic(selector, [(160, 300)], (205, 300)))
        click('#chat-search-close-btn')
        ev("settingsUiV136.openModels(document.getElementById('chat-model-button'))")
        assert ev("Boolean(settingsUiV136.popover)")
        unchanged(lambda: synthetic('.execution-popover', [(160, 300)], (205, 300)))
        ev("settingsUiV136.closePopover(false)")
        ev("document.getElementById('alertDialog').showModal()")
        unchanged(lambda: synthetic(chat, [(160, 300)], (205, 300)))
        unchanged(lambda: synthetic('#alertDialog', [(160, 300)], (205, 300)))
        ev("document.getElementById('alertDialog').close()")
        ev("document.getElementById('image-modal-overlay').classList.remove('hidden')")
        unchanged(lambda: synthetic('#image-modal-overlay', [(160, 300)], (205, 300)))
        ev("document.getElementById('image-modal-overlay').classList.add('hidden')")
        unchanged(lambda: drag(chat, 104, cancel=True, padding=True))
        assert ev('appLogic.swipeGesture === null'), 'touchcancel clears the contact'
        feedback_clear()
        # Sample the actual translation through a distance-limited release, a reversal and cancellation.
        assert ev(f"""(async () => {{
            const target = {json.dumps(chat)}, element = document.querySelector('#chat-screen');
            const base = element.getBoundingClientRect().left;
            const position = () => element.getBoundingClientRect().left - base;
            const start = () => swipeFixtureEvent(target, 'touchstart', [[0, 240, 300]]);
            const move = async dx => {{
                swipeFixtureEvent(target, 'touchmove', [[0, 240 + dx, 300]]);
                await new Promise(requestAnimationFrame);
            }};
            start(); await move(-5);
            if (Math.abs(position()) > 0.1) throw new Error('Moved before horizontal direction was determined');
            await move(-30); const small = position();
            await move(-100); const larger = position();
            await move(-200); const farther = position();
            await new Promise(requestAnimationFrame);
            if (small !== -20 || larger !== -90 || farther !== -190 || position() !== farther || appLogic.swipeSnap)
                throw new Error('Drag did not track the finger directly: ' + [small,larger,farther,position()]);
            await move(-30);
            if (Math.abs(position()-small) > 0.1) throw new Error('Unexpected reversal offset');
            swipeFixtureEvent(target, 'touchend', [], [[0, 210, 300]]);
            const rollback = appLogic.swipeSnap?.animations[0];
            const duration = rollback?.effect.getTiming().duration;
            if (!(duration >= 180 && duration <= 260) || Math.abs(position()-small) > 1)
                throw new Error('Rollback did not start from the release position');
            rollback.pause(); rollback.currentTime = 90;
            if (!(position() > small && position() < 0)) throw new Error('Rollback is not interpolated');
            const midway = position();
            start(); await move(-35);
            if (rollback.playState !== 'idle' || Math.abs(position() - midway) > 0.5)
                throw new Error('Re-grabbing the rollback jumped');
            await move(-60);
            if (Math.abs(position() - midway + 25) > 0.5) throw new Error('Re-grab did not follow the finger');
            swipeFixtureEvent(target, 'touchcancel', []);
            const canceled = appLogic.swipeSnap?.animations[0];
            if (!canceled || position() >= 0) throw new Error('Cancel did not roll back');
            await canceled.finished;
            return Math.abs(position()) < 0.1 && location.hash === '#chat';
        }})()""")
        feedback_clear()
        assert ev(f"""(() => {{
            const target = {json.dumps(chat)};
            swipeFixtureEvent(target, 'touchstart', [[0, 100, 300]]);
            swipeFixtureEvent(target, 'touchstart', [[0, 120, 300], [1, 160, 300]]);
            swipeFixtureEvent(target, 'touchend', [[0, 120, 300]], [[1, 180, 300]]);
            swipeFixtureEvent(target, 'touchend', [], [[0, 205, 300]]);
            return appLogic.swipeGesture === null && location.hash === '#chat';
        }})()"""), 'Lifting one finger after multitouch cannot revive the swipe'
        boot(reload=True)
        screen('chat')
        client.call('Emulation.setEmitTouchEventsForMouse', {'enabled': True, 'configuration': 'mobile'})
        for surface, scroll in (('chat', chat), ('sidebar', '#chat-sidebar-scroll'),
                                ('library', '#document-library-collection-scroll'), ('settings', settings_top)):
            if surface == 'sidebar':
                click('#goto-history-btn')
                wait('chatSidebarUiState.isOpen', 'Sidebar opens from the header')
            if surface == 'library':
                click('#goto-history-btn')
                click('#document-library-open')
                wait('!elements.documentLibraryWorkspace.hidden', 'Library opens from sidebar')
            if surface == 'settings':
                click('#goto-settings-btn')
                screen('settings')
            pinch(True)
            wait('visualViewport.scale > 1.2 && state.isZoomed', f'Two-finger pinch zooms {surface}')
            before = ev('[location.hash,chatSidebarUiState.isOpen,elements.documentLibraryWorkspace.hidden]')
            pan_viewport('x')
            ev(f"(() => {{ const pane=document.querySelector({json.dumps(scroll)}); if(pane) pane.scrollTop=pane.scrollHeight; }})()")
            pan_viewport('y')
            assert ev('[location.hash,chatSidebarUiState.isOpen,elements.documentLibraryWorkspace.hidden]') == before
            pinch(False)
            wait('!state.isZoomed && visualViewport.scale < 1.01', f'Pinch restores {surface} to normal')
            if surface == 'sidebar':
                click('#chat-sidebar-backdrop')
            if surface == 'library':
                ev('history.back()')
                wait('elements.documentLibraryWorkspace.hidden', 'Return from zoomed library')
            if surface == 'settings':
                click('#back-to-chat-from-settings')
                screen('chat')
        ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', false)")
        pinch(True)
        wait('state.isZoomed', 'Zoom works with swipes disabled')
        # Pan the enlarged viewport to the header, then hit the actual control.
        for _ in range(3):
            if ev('visualViewport.offsetLeft < 2 && visualViewport.offsetTop < 2'):
                break
            manual_gesture([[(80+i*24, 120+i*55)] for i in range(10)])
        point = ev("""(() => {
            const button=elements.gotoHistoryBtn, rect=button.getBoundingClientRect(), view=visualViewport;
            const x=rect.left+rect.width/2, y=rect.top+rect.height/2;
            return [x, y, button.contains(document.elementFromPoint(x,y)) &&
                x>=view.offsetLeft && x<view.offsetLeft+view.width && y>=view.offsetTop && y<view.offsetTop+view.height];
        })()""")
        assert point[2] and 0<point[0]<375 and 0<point[1]<740, point
        manual_gesture([[(point[0], point[1])]])
        wait('chatSidebarUiState.isOpen', 'Header opens sidebar at enlarged scale')
        click('#chat-sidebar-backdrop')
        pinch(False)
        wait('!state.isZoomed', 'Normal zoom restored')
        assert ev("dbUtils.getSetting('localUiSettings').then(record=>!record.value.enableSwipeNavigation)")
        drag(chat, 104)
        assert ev('!chatSidebarUiState.isOpen && !state.settings.enableSwipeNavigation')
        client.call('Emulation.setEmitTouchEventsForMouse', {'enabled': False})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 2})
        ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', true)")
        assert ev(f"""(async () => {{
            const target = {json.dumps(chat)};
            swipeFixtureEvent(target, 'touchstart', [[0, 100, 300]]);
            await appLogic.updateLocalUiSetting('enableSwipeNavigation', false);
            await appLogic.updateLocalUiSetting('enableSwipeNavigation', true);
            swipeFixtureEvent(target, 'touchend', [], [[0, 205, 300]]);
            return location.hash === '#chat' && appLogic.swipeGesture === null;
        }})()"""), 'Turning the setting off invalidates an in-flight gesture'
        ev(f"""swipeFixtureEvent({json.dumps(chat)}, 'touchstart', [[0, 180, 300]]);
            swipeFixtureEvent({json.dumps(chat)}, 'touchmove', [[0, 130, 300]])""")
        wait("document.getElementById('chat-screen').style.translate !== ''", 'Chat is following the finger')
        click('#goto-settings-btn')
        screen('settings')
        feedback_clear()
        unchanged(lambda: ev(f"swipeFixtureEvent({json.dumps(chat)}, 'touchend', [], [[0, 205, 300]])"))
        synthetic(settings_top, [(160, 300)], (205, 300))
        screen('chat')
        synthetic(chat, [(25, 300)], (105, 300), start=(0, 300), captured=True)
        wait('chatSidebarUiState.isOpen', 'Left edge swipe opens sidebar')
        click('#chat-sidebar-backdrop')
        screen('chat')
        depth = ev('history.length')
        assert ev(f"""(() => {{
            const chat = {json.dumps(chat)};
            swipeFixtureEvent(chat, 'touchstart', [[0, 200, 300]]);
            swipeFixtureEvent(chat, 'touchend', [], [[0, 100, 300]]);
            swipeFixtureEvent(chat, 'touchend', [], [[0, 100, 300]]);
            return location.hash === '#settings' && history.length === {depth + 1};
        }})()"""), 'A duplicate touchend cannot navigate a second time'
        screen('settings')
        synthetic(settings_top, [(160, 300)], (205, 300))
        screen('chat')

        for width in (320, 375, 430, 768, 799, 800, 801, 1280):
            viewport(width)
            release_with_feedback(chat, '#chat-screen', -104)
            screen('settings')
            feedback_clear()
            if width < 800:
                assert ev('settingsUiV136.category') is None
                click('[data-settings-category="other"]')
                screen('settings', '#settings/other')
                release_with_feedback(settings_detail, settings_detail, 104)
                screen('settings')
                feedback_clear()
                release_with_feedback(settings_top, '#settings-screen', 104)
            else:
                assert ev("settingsUiV136.category === 'general' && !document.querySelector('#settings-screen').classList.contains('settings-show-top')")
                click('[data-settings-category="other"]')
                screen('settings', '#settings/other')
                release_with_feedback(settings_detail, '#settings-screen', 104)
            screen('chat')
            feedback_clear()

        viewport(799)
        click('#goto-settings-btn')
        screen('settings')
        click('[data-settings-category="other"]')
        screen('settings', '#settings/other')
        ev(f"""swipeFixtureEvent({json.dumps(settings_detail)}, 'touchstart', [[0, 100, 300]]);
            swipeFixtureEvent({json.dumps(settings_detail)}, 'touchmove', [[0, 140, 300]])""")
        wait("document.getElementById('settings-detail').style.translate !== ''", 'Settings detail is following the finger')
        viewport(800)
        feedback_clear()
        viewport(799)
        ev(f"""(async () => {{
            swipeFixtureEvent({json.dumps(settings_detail)}, 'touchstart', [[0, 100, 300]]);
            swipeFixtureEvent({json.dumps(settings_detail)}, 'touchmove', [[0, 140, 300]]);
            await new Promise(requestAnimationFrame); history.back();
        }})()""")
        screen('settings')
        feedback_clear()
        client.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
        wait('appLogic.swipeReducedMotion.matches', 'Reduced motion is active')
        release_with_feedback(settings_top, '#settings-screen', 104, animated=False)
        screen('chat')
        release_with_feedback(chat, '#chat-screen', -104, animated=False)
        screen('settings')
        feedback_clear()
        release_with_feedback(settings_top, '#settings-screen', 104, animated=False)
        screen('chat')
        client.call('Emulation.setEmulatedMedia', {'features': []})

        ev("appLogic.updateLocalUiSetting('enableWideMode', true).then(() => appLogic.applyWideMode())")
        for width in (1024, 1280):
            viewport(width)
            mode = 'permanent' if width == 1280 else 'overlay'
            wait(f"document.querySelector('#chat-screen').classList.contains('chat-sidebar-mode-{mode}')", 'Sidebar mode is ready')
            ev("uiUtilsV136.closeChatSidebar()")
            depth = ev('history.length')
            synthetic(chat, [(75, 300)], (110, 300), start=(6, 300), captured=mode == 'overlay')
            wait("document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Swipe opens the history sidebar')
            assert ev("location.hash === '#chat'") and ev('history.length') == depth
            unchanged(lambda: synthetic('#chat-history-sidebar', [(160, 300)], (205, 300)))
            unchanged(lambda: synthetic(chat, [(160, 300)], (205, 300)))
            click('#goto-history-btn' if mode == 'permanent' else '#chat-sidebar-backdrop')
            wait("!chatSidebarUiState.isOpen", 'Existing sidebar close operations work')

        for width, wide, mode in ((375, True, 'overlay'), (1024, False, 'overlay'),
                                  (1024, True, 'overlay'), (1280, True, 'permanent')):
            viewport(width)
            ev(f"appLogic.updateLocalUiSetting('enableWideMode', {str(wide).lower()}).then(() => appLogic.applyWideMode())")
            for dark in (False, True):
                theme = str(dark).lower()
                ev(f"appLogic.saveAppearanceValues('theme', {{darkMode: {theme}}}, {{global: true}})")
                ev('uiUtilsV136.closeChatSidebar()')
                assert ev(f"""(() => {{
                    const header = document.querySelector('#goto-history-btn');
                    return uiUtilsV136.getChatSidebarMode() === '{mode}' && document.body.classList.contains('dark-mode') === {theme} &&
                        header.querySelector('.material-symbols-outlined').textContent === 'menu' && !document.querySelector('#chat-sidebar-close-btn') &&
                        header.title === 'サイドバーを開く' && header.getAttribute('aria-label') === 'サイドバーを開く' &&
                        header.getBoundingClientRect().width > 0;
                }})()"""), (width, mode, dark)
                click('#goto-history-btn')
                wait("document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Menu opens the sidebar')
                assert ev("elements.gotoHistoryBtn.getAttribute('aria-expanded') === 'true' && elements.gotoHistoryBtn.title === 'サイドバーを閉じる'")
                click('#goto-history-btn' if mode == 'permanent' else '#chat-sidebar-backdrop')
                wait("!document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Menu closes the sidebar')
        viewport(375)
        ev("appLogic.updateLocalUiSetting('enableWideMode', false).then(() => appLogic.applyWideMode())")
        check_consecutive_swipes(ev, wait, screen, click, boot, touch, feedback_clear)
        ev("uiUtilsV136.showScreen('chat')")
        boot(reload=True)
        check_thinking_drag(ev, wait, screen, tap, touch)
        check_chat_action_ui(client, ev, wait, screen, click, tap, drag, unchanged, boot, viewport)
        viewport(375)
        check_sidebar_button_feedback(client, ev, wait, screen, click, tap, drag, manual_gesture, settled_sidebar, boot)
    finally:
        client.sock.settimeout(socket_timeout)
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setEmulatedMedia', {'features': []})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False,
        })
    return ('ALL PASSED (native pinch and X/Y pan across chat, sidebar, library and settings, swipe navigation, rollback and cancel, '
            'consecutive swipe handoff and reversal, reduced motion, 320–1280px, header and form controls, Thinking drag, and sidebar navigation)\n'
            'ALL PASSED (native drawer position from left, center and right, reversal, backdrop, snap/cancel, timed fling and button interruption)\n'
            'ALL PASSED (sidebar button appearance, outside touch in both modes, Tab focus and desktop hover/press)\n'
            'ALL PASSED (chat action swipes and taps, wrapped action geometry, floating panel focus/hit-testing, and local formatting settings)')


def check_sidebar_button_feedback(client, ev, wait, screen, click, tap, drag, manual_gesture, settled_sidebar, boot):
    menu = '#goto-history-btn'
    new = '#new-chat-btn'

    def key(key, code, number, modifiers=0):
        for event in ('keyDown', 'keyUp'):
            client.call('Input.dispatchKeyEvent', {'type': event, 'key': key, 'code': code,
                'windowsVirtualKeyCode': number, 'modifiers': modifiers})

    def idle(selector):
        return f"""(() => {{
            const style = getComputedStyle(document.querySelector({json.dumps(selector)}));
            return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.outlineStyle === 'none' && style.boxShadow === 'none';
        }})()"""

    def keyboard_focus(selector):
        wait(f"""(() => {{
            const button = document.querySelector({json.dumps(selector)}), style = getComputedStyle(button);
            return document.activeElement === button && button.matches(':focus-visible') &&
                style.outlineStyle === 'solid' && style.outlineWidth === '2px' && style.outlineColor === style.color;
        }})()""", f'Visible keyboard focus for {selector}')

    boot(reload=True)
    screen('chat')
    ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', true)")
    ev("appLogic.updateLocalUiSetting('enableWideMode', false).then(() => appLogic.applyWideMode())")
    tap(menu, dwell=0.08)
    settled_sidebar(True)
    wait(f'{idle(menu)} && {idle(new)}', 'Opening by touch leaves both buttons visually idle')
    manual_gesture([[(350, 320)]])
    settled_sidebar(False)
    assert ev(f'document.activeElement === elements.gotoHistoryBtn && {idle(menu)}')

    tap(menu, dwell=0.08)
    settled_sidebar(True)
    key('Tab', 'Tab', 9)
    key('Tab', 'Tab', 9, modifiers=8)
    keyboard_focus(new)
    drag('#chat-sidebar-scroll', -112)
    settled_sidebar(False)
    wait(f'document.activeElement === elements.gotoHistoryBtn && {idle(menu)} && {idle(new)}',
         'Closing by touch after Tab restores focus without highlighting either button')
    key('Tab', 'Tab', 9)
    key('Tab', 'Tab', 9, modifiers=8)
    keyboard_focus(menu)
    click(menu)
    settled_sidebar(True)
    keyboard_focus(new)
    key('Escape', 'Escape', 27)
    settled_sidebar(False)
    keyboard_focus(menu)

    boot(reload=True)
    screen('chat')
    tap(menu, dwell=0.08)
    settled_sidebar(True)
    tap(new, dwell=0.08)
    wait("document.querySelector('#confirmDialog').open", 'Touching New Chat opens its normal confirmation')
    wait(idle(new), 'New Chat has no sticky hover behind the confirmation')
    tap('#confirmDialog .dialog-ok-btn', dwell=0.08)
    settled_sidebar(False)
    wait(f'{idle(menu)} && {idle(new)}', 'Both buttons are visually idle after touch confirmation')

    client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
    ev("appLogic.updateLocalUiSetting('enableWideMode', true).then(() => appLogic.applyWideMode())")
    wait("chatSidebarUiState.mode === 'permanent'", 'Wide touch viewport uses the permanent sidebar')
    ev("uiUtilsV136.openChatSidebar()")
    tap('.chat-sidebar-brand', dwell=0.08)
    assert ev('chatSidebarUiState.isOpen'), 'Tapping inside the sidebar does not close it'
    tap('#chat-workspace .main-content', dwell=0.08)
    wait('!chatSidebarUiState.isOpen', 'A touch outside closes the permanent sidebar')
    wait("dbUtils.getSetting('localUiSettings').then(record => record.value.isPersistentChatSidebarOpen === false)",
         'The usual permanent sidebar preference records the close')
    ev("appLogic.updateLocalUiSetting('enableWideMode', false).then(() => appLogic.applyWideMode())")
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
    for selector in (menu, new):
        point = ev(f"""(() => {{
            const rect = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            return {{x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}};
        }})()""")
        client.call('Input.dispatchMouseEvent', {**point, 'type': 'mouseMoved'})
        wait(f"document.querySelector('{selector}').matches(':hover') && !({idle(selector)})", f'Mouse hover for {selector}')
        client.call('Input.dispatchMouseEvent', {**point, 'type': 'mousePressed', 'button': 'left', 'clickCount': 1})
        assert ev(f"document.querySelector('{selector}').matches(':active')")
        client.call('Input.dispatchMouseEvent', {**point, 'type': 'mouseReleased', 'button': 'left', 'clickCount': 1})
        if selector == menu:
            settled_sidebar(True)
        else:
            wait("document.querySelector('#confirmDialog').open", 'Mouse still activates New Chat')
            click('#confirmDialog .dialog-cancel-btn')


def check_chat_action_ui(client, ev, wait, screen, click, tap, drag, unchanged, boot, viewport):
    main = '#chat-screen .main-content'
    thought = '.thought-summary-details > summary'
    message_action = '.message.model .tm-search-message-btn'
    floating = '#system-prompt-open-btn'
    scroll = '#scroll-to-bottom-btn'
    formatting = '#enable-text-formatting-toggle'

    def set_formatting(value):
        click('#goto-settings-btn')
        screen('settings')
        click('[data-settings-category="general"]')
        screen('settings', '#settings/general')
        assert ev(f"document.querySelector('#settings-panel-general {formatting}').checked !== {value}")
        click(formatting)
        wait(f"(async () => (await dbUtils.getSetting('localUiSettings')).value.enableTextFormatting === {value})()",
             'Formatting setting persisted')
        click('#back-to-chat-from-settings')
        screen('settings')
        click('#back-to-chat-from-settings')
        screen('chat')
        boot(reload=True)
        screen('chat')
        assert ev(f"state.settings.enableTextFormatting === {value} && document.querySelector('{formatting}').checked === {value}")

    def seed():
        ev(r"""state.globalSettingsV136.showThoughtProcess = true;
            state.currentMessages = [
                {role:'user', content:'わお！  '},
                {role:'model', content:'モデル本文。', thoughtSummary:'思考のテスト',
                    usageMetadata:{candidatesTokenCount:4,totalTokenCount:9}},
                {role:'model', content:'長文のテスト。\n\n'.repeat(120)}
            ];
            uiUtilsV136.renderChatMessages({suppressMessageAnimation:true});
            document.querySelector('#chat-screen .main-content').scrollTop = 0;""")

    ev("""(async () => {
        await dbUtils.saveSetting('textFormattingSettings', {trimTrailing:true, indentProse:false, normalizeWidth:false, target:'user'});
        const current = (await dbUtils.getSetting('localUiSettings')).value;
        await dbUtils.saveSetting('localUiSettings', {...current, autoScroll:false, hideSystemPromptInChat:true});
    })()""")
    boot(reload=True)
    screen('chat')
    seed()
    assert ev("""!state.settings.enableTextFormatting && state.textFormattingSettings.target === 'user' &&
        !document.querySelector('#hide-system-prompt-toggle') &&
        [...document.querySelectorAll('#text-formatting-btn, .tm-format-message-btn')].every(el => !el.getClientRects().length)""")
    set_formatting('true')
    seed()
    assert ev("document.querySelector('.message.user .tm-format-message-btn').getClientRects().length === 1")

    for width, wide, dark, sidebar in [(375, False, False, False), (160, False, True, False),
                                      (768, False, True, False), (1280, True, False, True)]:
        viewport(width)
        ev(f"""(async () => {{
            await appLogic.updateLocalUiSetting('enableWideMode', {str(wide).lower()});
            appLogic.applyWideMode();
            await appLogic.saveAppearanceValues('theme', {{darkMode:{str(dark).lower()}}}, {{global:true}});
            if ({str(sidebar).lower()}) uiUtilsV136.openChatSidebar();
        }})()""")
        geometry = ev("""(() => {
            const container = elements.messageContainer.getBoundingClientRect();
            return [...elements.messageContainer.querySelectorAll('.message')].map(message => {
                const actions = message.querySelector('.message-action-buttons');
                const boxes = [...actions.querySelectorAll('button')].filter(b => b.getClientRects().length)
                    .map(b => b.getBoundingClientRect());
                const content = message.querySelector('.message-content').getBoundingClientRect();
                const meta = message.querySelector('.message-action-meta')?.getBoundingClientRect();
                const next = message.nextElementSibling?.getBoundingClientRect();
                const buttonBounds = actions.getBoundingClientRect();
                return {
                    lines: new Set(boxes.map(b => b.top)).size,
                    within: boxes.every(b => b.left >= container.left - 1 && b.right <= container.right + 1),
                    noScroll: actions.scrollWidth <= actions.clientWidth && getComputedStyle(actions).overflowX === 'visible',
                    noOverlap: (meta?.bottom ?? content.bottom) <= buttonBounds.top &&
                        (!next || next.top >= buttonBounds.bottom),
                    aligned: message.classList.contains('user')
                        ? Math.abs(Math.max(...boxes.map(b => b.right)) - container.right) < 1
                        : Math.abs(boxes[0].left - container.left) < 1,
                    bodyWidth: content.width
                };
            });
        })()""")
        assert all(all(row[key] for key in ('within', 'noScroll', 'noOverlap', 'aligned')) for row in geometry), (width, geometry)
        assert geometry[0]['bodyWidth'] < 100, (width, geometry)
        assert geometry[0]['lines'] >= 3 if width == 160 else all(row['lines'] == 1 for row in geometry), (width, geometry)

    assert ev("""(async () => {
        const user = elements.messageContainer.querySelector('.message.user');
        await appLogic.startEditMessage(0, user);
        const editing = user.classList.contains('editing') &&
            user.querySelector('.edit-textarea').getBoundingClientRect().width > 200 &&
            !user.querySelector('.message-actions').getClientRects().length;
        appLogic.cancelEditMessage(0, user);
        return editing && user.querySelector('.message-actions').getClientRects().length === 1;
    })()""")
    assert ev("""(() => {
        const index = state.currentMessages.length;
        const actions = [...elements.messageContainer.querySelectorAll('.message-actions')].at(-1);
        state.currentMessages.push({role:'model', content:''});
        uiUtilsV136.appendMessage('model', '', index, true);
        uiUtilsV136.updateStreamingMessage(index, {content:'生成中の本文', thoughtSummary:'生成中の思考'});
        const message = document.getElementById('streaming-message-' + index);
        const visible = message.getBoundingClientRect().top >= actions.getBoundingClientRect().bottom &&
            message.querySelector('.message-content').textContent === '生成中の本文' &&
            !message.querySelector('.message-actions').getClientRects().length;
        message.remove();
        state.currentMessages.pop();
        return visible;
    })()"""), 'Streaming message stays below the preceding actions'
    viewport(375)
    ev("dbUtils.saveChat('Chat action fixture')")
    ev("uiUtilsV136.closeChatSidebar(); appLogic.updateLocalUiSetting('floatingPanelBehavior', 'always').then(() => appLogic.applyFloatingPanelBehavior())")
    tap('#text-formatting-btn')
    wait("document.getElementById('textFormattingDialog').open", 'Floating formatting opens')
    ev("document.getElementById('textFormattingDialog').close()")
    assert ev("!document.querySelector('.message.user .tm-format-message-btn').disabled")
    click('.message.user .tm-format-message-btn')
    wait("document.getElementById('alertDialog').open", 'Individual formatting finishes')
    assert ev("state.currentMessages[0].content === 'わお！'"), ev(
        "[state.currentMessages[0].content, document.querySelector('#alertDialog .dialog-message').textContent]")
    ev("document.getElementById('alertDialog').close()")
    wait("!elements.collapseAllMessagesBtn.disabled && elements.collapseAllMessagesBtn.textContent.includes('unfold_less')",
         'Long message can be collapsed')
    click('#collapse-all-messages-btn')
    assert ev("""(() => {
        const button = elements.collapseAllMessagesBtn;
        const messages = uiUtilsV136.getCollapsibleMessageElements();
        return messages.length > 0 && messages.every(message => message.classList.contains('tm-collapsed')) &&
            !button.disabled && !button.classList.contains('active') &&
            button.getAttribute('aria-label') === button.title && button.textContent.includes('unfold_more');
    })()""")
    click('#collapse-all-messages-btn')
    assert ev("!elements.collapseAllMessagesBtn.classList.contains('active') && elements.collapseAllMessagesBtn.textContent.includes('unfold_less')")

    for selector, dx, destination, tapped, undo_tap in (
        (thought, -104, 'settings', "document.querySelector('.thought-summary-details').open",
         "document.querySelector('.thought-summary-details').open = false"),
        (message_action, -104, 'settings', "uiUtilsV136.isChatSearchOpen()", "uiUtilsV136.closeChatSearch()"),
        (floating, -104, 'settings', "document.querySelector('#system-prompt-dialog').open", "appLogic.closeSystemPromptDialog()"),
        (scroll, -104, 'settings', "elements.scrollToBottomBtn.hidden", None),
    ):
        boot(reload=True)
        screen('chat')
        seed()
        wait(f"""(() => {{
            const node = document.querySelector('{selector}'), rect = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }})()""", f'{selector} is hittable')
        tap(selector)
        wait(tapped, f'Tap invokes {selector}')
        if undo_tap is None:
            # The scroll button hides before the final frame of its smooth scroll.
            boot(reload=True)
            screen('chat')
            seed()
        else:
            ev(undo_tap)
        wait(f"!({tapped})", f'{selector} is ready for swipe')
        ev(f"window.actionTapCount = 0; document.querySelector('{selector}').addEventListener('click', () => actionTapCount++)")
        drag(selector, dx)
        screen(destination)
        assert ev(f"actionTapCount === 0 && !({tapped})" if selector != scroll else "actionTapCount === 0"), selector
        click(f'#back-to-chat-from-{destination}')
        screen('chat')

    boot(reload=True)
    screen('chat')
    seed()
    ev(f"""window.floatingPoint = (() => {{
        const rect = document.querySelector('{floating}').getBoundingClientRect();
        return [rect.x + rect.width / 2, rect.y + rect.height / 2];
    }})();
        document.querySelector('{floating}').focus()""")
    assert ev(f"document.activeElement.matches('{floating}')")
    ev("""appLogic.updateLocalUiSetting('floatingPanelBehavior', 'on-click').then(() => {
        appLogic.applyFloatingPanelBehavior();
        appLogic.showActionPanel();
        document.getElementById('system-prompt-open-btn').focus();
    })""")
    wait("elements.floatingActionPanel.inert && !elements.floatingActionPanel.classList.contains('visible')",
         'Auto-hide makes the panel inert')
    ev(f"document.querySelector('{floating}').focus()")
    assert ev("!elements.floatingActionPanel.contains(document.activeElement)"), 'Hidden panel still owns focus'
    assert ev(f"Boolean(document.elementFromPoint(...floatingPoint).closest('{main}'))"), ev(
        "[floatingPoint, document.elementFromPoint(...floatingPoint)?.outerHTML.slice(0, 150)]")
    client.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': 'Tab', 'code': 'Tab', 'windowsVirtualKeyCode': 9})
    client.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': 'Tab', 'code': 'Tab', 'windowsVirtualKeyCode': 9})
    assert ev("!elements.floatingActionPanel.contains(document.activeElement)")
    ev("appLogic.updateLocalUiSetting('floatingPanelBehavior', 'hidden').then(() => appLogic.applyFloatingPanelBehavior())")
    app_point = ev('floatingPoint')
    for event in ('mousePressed', 'mouseReleased'):
        client.call('Input.dispatchMouseEvent', {'type':event, 'x':app_point[0], 'y':app_point[1], 'button':'left', 'clickCount':1})
    assert ev("elements.floatingActionPanel.inert && !elements.systemPromptDialog.open")
    ev("window.getSelection().selectAllChildren(document.querySelector('.message.user .message-content'))")
    assert ev("!window.getSelection().isCollapsed")
    unchanged(lambda: ev(f"""swipeFixtureEvent('{thought}', 'touchstart', [[0, 205, 300]]);
        swipeFixtureEvent('{thought}', 'touchmove', [[0, 100, 300]]);
        swipeFixtureEvent('{thought}', 'touchend', [], [[0, 100, 300]]);"""))
    assert ev("!window.getSelection().isCollapsed")
    ev("window.getSelection().removeAllRanges()")
    ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', false)")
    unchanged(lambda: drag(thought, -104))
    ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', true)")
    set_formatting('false')
    assert ev("""state.textFormattingSettings.trimTrailing && !state.textFormattingSettings.indentProse &&
        state.textFormattingSettings.target === 'user'""")


def check_consecutive_swipes(ev, wait, screen, click, boot, touch, feedback_clear):
    def route(name, pushes):
        expression = """[window.state?.currentScreen, location.hash, history.state?.screen, window.swipeChain?.pushes,
            [...document.querySelectorAll('.screen')].filter(el => el.classList.contains('active')).map(el => el.id),
            [...document.querySelectorAll('.screen')].filter(el => !el.inert).map(el => el.id)]"""
        actual = ev(expression)
        assert actual == [name, '#' + name, name, pushes, [name + '-screen'], [name + '-screen']], (
            actual, ev("[location.href, window.swipeFixtureTrace?.slice(-5)]"))

    def positions():
        return ev('swipeChain.lefts()')

    def close_positions(before, after):
        assert max(abs(a - b) for a, b in zip(before, after)) < 2, (before, after)

    def contact(x, pointer_id):
        return {'x': x, 'y': 390, 'id': pointer_id}

    def move(x, pointer_id):
        touch('touchMove', [contact(x, pointer_id)])
        wait(f"""swipeFixtureTrace.some(event => event.type === 'touchmove' &&
            event.id === {pointer_id} && Math.abs(event.x - {x}) < 1)""", 'Chrome delivered the native move')
        ev('new Promise(requestAnimationFrame)')

    def begin():
        ev("uiUtilsV136.showScreen('chat')")
        boot(reload=True)
        screen('chat')
        click('#goto-settings-btn')
        screen('settings')
        ev("""(() => {
            const ids = ['chat', 'settings'];
            window.swipeChain = {
                pushes: 0,
                lefts: () => ids.map(id => document.getElementById(id + '-screen').getBoundingClientRect().left),
                pauseAt: time => appLogic.swipeSnap.animations.forEach(animation => {
                    animation.pause();
                    animation.currentTime = time;
                })
            };
            // Chromium can drop older entries once the regression suite fills the stack.
            const push = history.pushState.bind(history);
            history.pushState = (...args) => { push(...args); swipeChain.pushes++; };
        })()""")
        direction = 1
        start = 54
        touch('touchStart', [contact(start, 700)])
        for distance in (30, 100, 175, 230):
            move(start + direction * distance, 700)
        touch('touchEnd', [])
        # A long contact still commits exactly one screen, even with the next one visible.
        route('chat', 1)
        assert ev("Boolean(appLogic.swipeSnap?.committing) && appLogic.swipeSnap.animations[0].playState === 'running'")
        return direction

    for cancel, settle_on_touch in ((False, False), (True, False), (False, True)):
        begin()
        direction = -1
        measured = not settle_on_touch
        ev(f'swipeChain.pauseAt({100 if settle_on_touch else 65})')
        chat_left = positions()[0]
        start = min(345, chat_left + 345)
        ev('swipeChain.firstSnap = appLogic.swipeSnap')
        touch('touchStart', [contact(start, 701)])
        assert ev("""appLogic.swipeGesture?.identifier === 701 &&
            appLogic.swipeGesture.screen.id === 'chat-screen' && appLogic.swipeSnap === swipeChain.firstSnap""")
        if settle_on_touch:
            ev('swipeChain.firstSnap.animations.forEach(animation => animation.finish())')
            feedback_clear()
            assert ev('appLogic.swipeGesture?.identifier === 701'), 'Snap cleanup preserves the new contact'
        handoff = positions()
        move(start + direction * 27, 701)
        wait('!appLogic.swipeSnap && Boolean(appLogic.swipeGesture)', 'The second native contact takes over the snap')
        after_handoff = positions()
        if measured:
            close_positions(handoff, after_handoff)
        move(start + direction * 92, 701)
        released = positions()
        if measured:
            close_positions([left + direction * 65 for left in after_handoff], released)
        assert (released[0] - after_handoff[0]) * direction > 0, (after_handoff, released)
        touch('touchCancel' if cancel else 'touchEnd', [])

        destination = 'chat' if cancel else 'settings'
        route(destination, 1 if cancel else 2)
        if measured:
            ev('swipeChain.pauseAt(0)')
            close_positions(released, positions())
            index = {'chat': 0, 'settings': 1}[destination]
            ev('swipeChain.pauseAt(70)')
            during_snap = positions()
            assert abs(during_snap[index]) < abs(released[index]), (released, during_snap)
            ev('appLogic.swipeSnap.animations.forEach(animation => animation.finish())')

        feedback_clear()
        screen(destination)
        if not cancel:
            ev('history.back()')
            screen('chat')
            route('chat', 2)


def check_thinking_drag(ev, wait, screen, tap, touch):
    screen('chat')
    ev("""(async () => {
        const modelNames = ['gemini-3.8-flash', 'gemini-3-pro-preview'];
        await appLogic.updateLocalUiSetting('enableSwipeNavigation', false);
        await appLogic.saveApiConfigs([{
            id: 'thinking-drag', provider: 'gemini', apiKey: 'fixture', modelCandidates: modelNames
        }]);
        appLogic.startNewChat();
        await state.executionSettingsReady;
        await appLogic.setCurrentChatModelRef({apiConfigId:'thinking-drag', modelName:modelNames[0]});
        await appLogic.setCurrentChatThinkingEffort('medium');
        state.currentMessages = [{role:'user', content:'Thinking drag fixture'}];
        const chatId = await dbUtils.saveChat('Thinking drag fixture');
        const setEffort = appLogic.setCurrentChatThinkingEffort;
        window.thinkingDragProbe = {chatId, setEffort, saves: []};
        appLogic.setCurrentChatThinkingEffort = function(level) {
            thinkingDragProbe.saves.push(level);
            return setEffort.call(this, level);
        };
    })()""")

    def point(level, identifier):
        return ev(f"""(() => {{
            const r = document.querySelector('.thinking-dot[data-level="{level}"] .thinking-mark').getBoundingClientRect();
            return {{x:r.left+r.width/2, y:r.top+r.height/2, id:{identifier}}};
        }})()""")

    def preview(level, identifier):
        end = point(level, identifier)
        touch('touchMove', [end])
        wait(f"""document.querySelector('.thinking-level-name')?.textContent === '{level.title()}' &&
            document.querySelector('.thinking-dot[aria-checked="true"]')?.dataset.level === '{level}'""",
             'Thinking label and radio follow the finger')

    def saved(level, writes):
        wait(f"""(async () => {{
            await settingsUiV136.saveQueue;
            return thinkingDragProbe.saves.join(',') === {json.dumps(writes)}
                && (await dbUtils.getChat(thinkingDragProbe.chatId)).executionSettings.thinkingEffort === '{level}';
        }})()""", 'The drag persists exactly its final level')

    try:
        tap('#chat-model-button')
        wait("Boolean(document.querySelector('.thinking-dots')) && !state.settings.enableSwipeNavigation",
             'Thinking opens independently of the screen swipe setting')
        touch('touchStart', [point('low', 900)])
        preview('high', 900)
        saved('medium', '')
        assert ev("appLogic.getCurrentChatThinkingEffort() === 'medium'"), 'A preview does not change the chat setting'
        touch('touchEnd', [])
        saved('high', 'high')

        touch('touchStart', [point('high', 901)])
        preview('low', 901)
        touch('touchCancel', [])
        wait("document.querySelector('.thinking-level-name')?.textContent === 'High'", 'Cancel restores the previous level')
        saved('high', 'high')

        touch('touchStart', [point('high', 902)])
        preview('low', 902)
        touch('touchEnd', [])
        saved('low', 'high,low')

        start = point('high', 903)
        touch('touchStart', [start])
        touch('touchMove', [{**start, 'y': start['y'] - 80}])
        touch('touchEnd', [])
        saved('low', 'high,low')
        assert ev("document.querySelector('.thinking-level-name')?.textContent === 'Low'")

        touch('touchStart', [point('low', 904)])
        preview('high', 904)
        ev("appLogic.setCurrentChatModelRef({apiConfigId:'thinking-drag', modelName:'gemini-3-pro-preview'})")
        touch('touchEnd', [])
        wait('!settingsUiV136.popover', 'Switching the model invalidates the old drag')
        saved('low', 'high,low')

        tap('#chat-model-button')
        wait("document.querySelectorAll('.thinking-dot').length === 2", 'The new model has only its two supported levels')
        touch('touchStart', [point('low', 905)])
        preview('high', 905)
        touch('touchEnd', [])
        saved('high', 'high,low,high')

        touch('touchStart', [point('high', 906)])
        preview('low', 906)
        ev('appLogic.startNewChat(); state.executionSettingsReady')
        touch('touchEnd', [])
        wait('!settingsUiV136.popover', 'Switching the chat invalidates the old drag')
        saved('high', 'high,low,high')
    finally:
        ev("""(async () => {
            await settingsUiV136.saveQueue;
            appLogic.setCurrentChatThinkingEffort = thinkingDragProbe.setEffort;
            settingsUiV136.closePopover(false);
            await appLogic.updateLocalUiSetting('enableSwipeNavigation', true);
        })()""")

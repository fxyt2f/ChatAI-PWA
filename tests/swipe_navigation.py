"""Swipe the real app with Chrome touch input, plus deterministic cancellation cases."""
import json
import time


def run(client, url):
    chat = '#chat-screen .main-content'
    history_list = '#history-screen .history-main-content'
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
            if ev(expression):
                return
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

    def tap(selector):
        nonlocal touch_id
        touch_id += 1
        point = ev(f"""(() => {{
            const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            return {{x: r.left + r.width / 2, y: r.top + r.height / 2, id: {touch_id}}};
        }})()""")
        touch('touchStart', [point])
        touch('touchEnd', [])

    def drag(selector, dx, dy=0, *, padding=False, cancel=False, measure=False):
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
        for step in range(1, 9):
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

    def synthetic(selector, moves, end, start=(100, 300)):
        points = [[0, *start], *[[0, *position] for position in moves], [0, *end]]
        assert ev(f"""(() => {{
            const points = {json.dumps(points)}, target = {json.dumps(selector)};
            const allowed = swipeFixtureEvent(target, 'touchstart', [points[0]]) &&
                points.slice(1, -1).every(point => swipeFixtureEvent(target, 'touchmove', [point]));
            return swipeFixtureEvent(target, 'touchend', [], [points.at(-1)]) && allowed;
        }})()"""), 'Swipe events must remain uncanceled'

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
                ? ({dx} > 0 ? '#history-screen' : '#settings-screen') : '#chat-screen');
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
            window.swipeFixtureEvent = (selector, type, points, changed = points) => {
                const target = document.querySelector(selector);
                const touches = values => values.map(([identifier, clientX, clientY]) =>
                    new Touch({identifier, clientX, clientY, target}));
                return target.dispatchEvent(new TouchEvent(type, {
                    bubbles: true, cancelable: true, touches: touches(points), changedTouches: touches(changed)
                }));
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
        unchanged(lambda: drag(chat, 104))
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
        drag(chat, 104, measure=True)
        screen('history')
        feedback_clear()
        boot(reload=True)
        screen('chat')
        click('#goto-history-btn')
        screen('history')
        wait("document.querySelectorAll('#history-list .history-item').length >= 20", 'Real history rows are rendered')
        tap('#history-list .history-item-menu-button')
        wait("!document.querySelector('#history-item-menu').classList.contains('hidden')", 'Tapping a card menu still works')
        ev("uiUtilsV136.closeHistoryItemMenu()")
        tap('#history-search-input')
        wait("document.activeElement.id === 'history-search-input'", 'Tapping the search field focuses it')
        unchanged(lambda: drag('#history-search-input', -104))
        client.call('Input.insertText', {'text': 'Swipe fixture'})
        wait("document.querySelector('#history-search-input').value === 'Swipe fixture'", 'History search accepts text')
        ev("document.querySelector('#history-search-input').blur()")
        wait("!historyUiState.searchTimer && !document.querySelector('#history-list').classList.contains('hidden')",
             'Search is applied before testing native scrolling')
        ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', false)")
        unchanged(lambda: drag(history_list, -104, padding=True))
        ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', true)")
        unchanged(lambda: drag(history_list, 104, padding=True))
        unchanged(lambda: release_with_feedback(history_list, '#history-screen', 104, follows=False))
        drag(history_list, 0, -180, padding=True)
        wait("document.querySelector('.history-main-content').scrollTop > 0", 'History vertical scroll works')
        saved_scroll = ev("document.querySelector('.history-main-content').scrollTop")
        ev("""(() => {
            const card = [...document.querySelectorAll('#history-list .history-item-open')].find(button => {
                const rect = button.getBoundingClientRect();
                return rect.top > 150 && rect.bottom < innerHeight - 24;
            });
            card.dataset.swipeTestTarget = '';
            window.historySwipeClicks = 0;
            card.addEventListener('click', () => historySwipeClicks++);
        })()""")
        drag('[data-swipe-test-target]', -104)
        screen('chat')
        assert ev('historySwipeClicks === 0'), 'The horizontal swipe did not click the card'
        feedback_clear()
        ev('history.back()')
        screen('history')
        wait(f"document.querySelector('.history-main-content').scrollTop >= {saved_scroll - 2}", 'History restores its scroll')
        click('#back-to-chat-from-history')
        screen('chat')
        boot(reload=True)
        screen('chat')

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
        screen('chat')
        ev("document.querySelector('#chat-screen .main-content').scrollTop = 0")

        for moves, end in [
            ([(104, 335), (205, 336)], (210, 336)),   # Vertical first, then horizontal.
            ([(140, 335)], (190, 380)),             # Diagonal.
            ([(130, 300)], (149, 300)),             # Less than 50px.
            ([(190, 300)], (130, 300)),             # Returned below the threshold before release.
        ]:
            unchanged(lambda: synthetic(chat, moves, end))
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
            const start = () => swipeFixtureEvent(target, 'touchstart', [[0, 140, 300]]);
            const move = async dx => {{
                swipeFixtureEvent(target, 'touchmove', [[0, 140 + dx, 300]]);
                await new Promise(requestAnimationFrame);
            }};
            start(); await move(5);
            if (Math.abs(position()) > 0.1) throw new Error('Moved before horizontal direction was determined');
            await move(30); const small = position();
            await move(100); const larger = position();
            await move(200); const farther = position();
            await new Promise(requestAnimationFrame);
            if (small !== 20 || larger !== 90 || farther !== 190 || position() !== farther || appLogic.swipeSnap)
                throw new Error('Drag did not track the finger directly: ' + [small,larger,farther,position()]);
            await move(-30);
            if (Math.abs(position()+small) > 0.1) throw new Error('Unexpected reversal offset');
            swipeFixtureEvent(target, 'touchend', [], [[0, 110, 300]]);
            const rollback = appLogic.swipeSnap?.animations[0];
            const duration = rollback?.effect.getTiming().duration;
            if (!(duration >= 180 && duration <= 260) || Math.abs(position()+small) > 1)
                throw new Error('Rollback did not start from the release position');
            rollback.pause(); rollback.currentTime = 90;
            if (!(position() > -small && position() < 0)) throw new Error('Rollback is not interpolated');
            const midway = position();
            start(); await move(35);
            if (rollback.playState !== 'idle' || Math.abs(position() - midway) > 0.5)
                throw new Error('Re-grabbing the rollback jumped');
            await move(60);
            if (Math.abs(position() - midway - 25) > 0.5) throw new Error('Re-grab did not follow the finger');
            swipeFixtureEvent(target, 'touchcancel', []);
            const canceled = appLogic.swipeSnap?.animations[0];
            if (!canceled || position() <= 0) throw new Error('Cancel did not roll back');
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
        client.call('Emulation.setPageScaleFactor', {'pageScaleFactor': 1.5})
        wait('state.isZoomed', 'Pinch zoom state is active')
        unchanged(lambda: synthetic(chat, [(160, 300)], (205, 300)))
        client.call('Emulation.setPageScaleFactor', {'pageScaleFactor': 1})
        wait('!state.isZoomed', 'Normal zoom restored')
        assert ev(f"""(async () => {{
            const target = {json.dumps(chat)};
            swipeFixtureEvent(target, 'touchstart', [[0, 100, 300]]);
            await appLogic.updateLocalUiSetting('enableSwipeNavigation', false);
            await appLogic.updateLocalUiSetting('enableSwipeNavigation', true);
            swipeFixtureEvent(target, 'touchend', [], [[0, 205, 300]]);
            return location.hash === '#chat' && appLogic.swipeGesture === null;
        }})()"""), 'Turning the setting off invalidates an in-flight gesture'
        ev(f"""swipeFixtureEvent({json.dumps(chat)}, 'touchstart', [[0, 100, 300]]);
            swipeFixtureEvent({json.dumps(chat)}, 'touchmove', [[0, 150, 300]])""")
        wait("document.getElementById('chat-screen').style.translate !== ''", 'Chat is following the finger')
        click('#goto-settings-btn')
        screen('settings')
        feedback_clear()
        unchanged(lambda: ev(f"swipeFixtureEvent({json.dumps(chat)}, 'touchend', [], [[0, 205, 300]])"))
        synthetic(settings_top, [(160, 300)], (205, 300))
        screen('chat')
        synthetic(chat, [(25, 300)], (70, 300), start=(0, 300))
        screen('history')
        click('#back-to-chat-from-history')
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

        release_with_feedback(chat, '#chat-screen', 104)
        screen('history')
        feedback_clear()
        release_with_feedback(history_list, '#history-screen', -104)
        screen('chat')
        feedback_clear()

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
            release_with_feedback(chat, '#chat-screen', 104, follows=False)
            wait("document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Swipe opens the history sidebar')
            assert ev("location.hash === '#chat'") and ev('history.length') == depth
            unchanged(lambda: synthetic('#chat-history-sidebar', [(20, 300)], (0, 300)))
            unchanged(lambda: synthetic(chat, [(160, 300)], (205, 300)))
            click('#chat-sidebar-close-btn')
            wait("!document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Existing sidebar close button works')

        for width, wide, mode in ((375, True, 'disabled'), (1024, False, 'disabled'),
                                  (1024, True, 'overlay'), (1280, True, 'permanent')):
            viewport(width)
            ev(f"appLogic.updateLocalUiSetting('enableWideMode', {str(wide).lower()}).then(() => appLogic.applyWideMode())")
            for dark in (False, True):
                theme = str(dark).lower()
                ev(f"appLogic.saveAppearanceValues('theme', {{darkMode: {theme}}}, {{global: true}})")
                ev('uiUtilsV136.closeChatSidebar()')
                label = '履歴一覧へ' if mode == 'disabled' else 'サイドバーを開く'
                assert ev(f"""(() => {{
                    const header = document.querySelector('#goto-history-btn'), close = document.querySelector('#chat-sidebar-close-btn');
                    return uiUtilsV136.getChatSidebarMode() === '{mode}' && document.body.classList.contains('dark-mode') === {theme} &&
                        [header, close].every(button => button.querySelector('.material-symbols-outlined').textContent === 'menu') &&
                        header.title === '{label}' && header.getAttribute('aria-label') === '{label}' &&
                        header.getBoundingClientRect().width > 0;
                }})()"""), (width, mode, dark)
                click('#goto-history-btn')
                if mode == 'disabled':
                    screen('history')
                    ev('history.back()')
                    screen('chat')
                else:
                    wait("document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Menu opens the sidebar')
                    assert ev("""(() => {
                        const close = document.querySelector('#chat-sidebar-close-btn');
                        return close.getBoundingClientRect().width > 0 && close.title === 'サイドバーを閉じる' &&
                            close.getAttribute('aria-label') === 'サイドバーを閉じる' && close.getAttribute('aria-expanded') === 'true';
                    })()""")
                    click('#chat-sidebar-close-btn')
                    wait("!document.querySelector('#chat-screen').classList.contains('chat-sidebar-open')", 'Menu closes the sidebar')
        viewport(375)
        ev("appLogic.updateLocalUiSetting('enableWideMode', false).then(() => appLogic.applyWideMode())")
        check_consecutive_swipes(ev, wait, screen, click, boot, touch, feedback_clear)
        ev("uiUtilsV136.showScreen('chat')")
        boot(reload=True)
        check_thinking_drag(ev, wait, screen, tap, touch)
        check_chat_action_ui(client, ev, wait, screen, click, tap, drag, unchanged, boot, viewport)
        check_history_reuse(ev, wait, screen, click, boot)
    finally:
        client.sock.settimeout(socket_timeout)
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setEmulatedMedia', {'features': []})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False,
        })
    return ('ALL PASSED (swipe navigation, native scroll/touch, feedback and handoff, rollback and cancel, '
            'consecutive swipe handoff and reversal, reduced motion, 320–1280px, header and form controls, Thinking drag, and history reuse)\n'
            'ALL PASSED (chat action swipes and taps, wrapped action geometry, floating panel focus/hit-testing, and local formatting settings)')


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
        (floating, 104, 'history', "document.querySelector('#system-prompt-dialog').open", "appLogic.closeSystemPromptDialog()"),
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

    def begin(origin):
        ev("uiUtilsV136.showScreen('chat')")
        boot(reload=True)
        screen('chat')
        click('#goto-history-btn' if origin == 'history' else '#goto-settings-btn')
        screen(origin)
        ev("""(() => {
            const ids = ['history', 'chat', 'settings'];
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
        direction = -1 if origin == 'history' else 1
        start = 321 if direction < 0 else 54
        touch('touchStart', [contact(start, 700)])
        for distance in (30, 100, 175, 230):
            move(start + direction * distance, 700)
        touch('touchEnd', [])
        # A long contact still commits exactly one screen, even with the next one visible.
        route('chat', 1)
        assert ev("Boolean(appLogic.swipeSnap?.committing) && appLogic.swipeSnap.animations[0].playState === 'running'")
        return direction

    for origin, reverse, cancel, settle_on_touch in (
        ('history', False, False, False),
        ('settings', False, False, False),
        ('history', True, False, False),
        ('settings', False, True, False),
        ('history', False, False, True),
    ):
        first_direction = begin(origin)
        direction = -first_direction if reverse else first_direction
        # The first case uses normal elapsed time. Pausing the others at an actual
        # interpolated frame makes pixel comparisons independent of CDP timing.
        measured = origin == 'settings' or reverse
        if measured:
            ev('swipeChain.pauseAt(65)')
        if settle_on_touch:
            ev('swipeChain.pauseAt(100)')
        chat_left = positions()[1]
        if direction < 0:
            start = min(345, chat_left + 345)
        else:
            start = max(30, chat_left + 24)
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
        assert (released[1] - after_handoff[1]) * direction > 0, (after_handoff, released)
        touch('touchCancel' if cancel else 'touchEnd', [])

        destination = 'chat' if cancel else 'settings' if direction < 0 else 'history'
        route(destination, 1 if cancel else 2)
        if measured:
            ev('swipeChain.pauseAt(0)')
            close_positions(released, positions())
            index = {'history': 0, 'chat': 1, 'settings': 2}[destination]
            ev('swipeChain.pauseAt(70)')
            during_snap = positions()
            assert abs(during_snap[index]) < abs(released[index]), (released, during_snap)
            ev('appLogic.swipeSnap.animations.forEach(animation => animation.finish())')
        if origin == 'history' and not reverse and not settle_on_touch:
            # Back can supersede the second snap without introducing another history entry.
            ev('history.back()')
            screen('chat')
            route('chat', 2)
            ev('history.back()')
            screen('history')
            route('history', 2)
            ev('history.forward()')
            screen('chat')
            ev('history.forward()')
            screen('settings')
            route('settings', 2)
        feedback_clear()
        screen(destination)
        assert abs(positions()[{'history': 0, 'chat': 1, 'settings': 2}[destination]]) < 1


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


def check_history_reuse(ev, wait, screen, click, boot):
    rows = '#history-list .history-item'
    count = f"document.querySelectorAll('{rows}').length"
    panel = "document.getElementById('history-state-panel')"
    loading = f"(!{panel}.classList.contains('hidden') && {panel}.dataset.state === 'loading')"

    def open_history():
        click('#goto-history-btn')
        screen('history')

    def leave_history():
        click('#back-to-chat-from-history')
        screen('chat')

    def search(query):
        ev(f"""(() => {{
            const input = document.getElementById('history-search-input');
            input.value = {json.dumps(query)};
            input.dispatchEvent(new Event('input', {{bubbles: true}}));
        }})()""")
        wait('!historyUiState.searchTimer', 'History search settled')

    ev("""(async () => {
        const tx = state.db.transaction(CHATS_STORE, 'readwrite');
        const store = tx.objectStore(CHATS_STORE);
        for (let i = 0; i < 520; i++) store.add({
            id: 10000 + i, title: 'Cache fixture ' + i,
            createdAt: i + 1, updatedAt: i + 1,
            isPinned: i % 2 === 0, pinnedAt: i + 1,
            messages: [{role: 'user', content: 'Cache fixture body ' + i}]
        });
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; });
    })()""")
    boot(reload=True)
    screen('chat')
    ev("""(() => {
        const probe = window.historyProbe = {scans: 0, rows: 0, fail: true, hold: false};
        const getAll = dbUtils.getAllChats;
        dbUtils.getAllChats = async function(...args) {
            probe.scans++;
            if (probe.fail) { probe.fail = false; throw new Error('Controlled history read failure'); }
            const chats = await getAll.apply(this, args);
            if (probe.hold) {
                probe.hold = false;
                await new Promise(resolve => {
                    probe.release = () => { probe.release = null; resolve(); };
                });
            }
            return chats;
        };
        const createRow = uiUtilsV136.createHistoryItemElement;
        uiUtilsV136.createHistoryItemElement = function(...args) {
            probe.rows++;
            return createRow.apply(this, args);
        };
    })()""")
    open_history()
    wait(f"{panel}.dataset.state === 'error'", 'Initial read failure offers retry')
    click('#history-state-action')
    wait(f'{count} >= 520', 'Initial read retry draws the complete large history')
    assert ev('historyProbe.scans === 2')
    click('[data-history-pin-filter="pinned"]')
    ev("""(() => {
        const sort = document.getElementById('history-sort-order-toolbar');
        sort.value = 'title';
        sort.dispatchEvent(new Event('change', {bubbles:true}));
    })()""")
    search('Cache fixture')
    wait(f"{count} === 260 && document.querySelector('#history-status').textContent === '検索結果 260件'",
         'History search, title sort and pinned filter render')
    assert ev(f"document.querySelector('{rows} .history-item-title').title === 'Cache fixture 0'")
    click('#history-delete-mode-btn')
    assert ev("!document.getElementById('history-delete-toolbar').classList.contains('hidden')")
    click('#history-delete-cancel-btn')
    assert ev("document.getElementById('history-delete-toolbar').classList.contains('hidden')")
    ev(f"""(() => {{
        const probe = historyProbe;
        probe.first = document.querySelector('{rows}');
        probe.metrics = [probe.scans, probe.rows];
        uiUtilsV136.getHistoryScrollContainer().scrollTop = 1200;
        probe.scroll = uiUtilsV136.captureHistoryScrollPosition();
    }})()""")
    for _ in range(3):
        leave_history()
        open_history()
        checks = ev(f"""({{
            sameRows: historyProbe.first === document.querySelector('{rows}'),
            noLoadingPanel: !({loading}),
            noRescan: historyProbe.scans === historyProbe.metrics[0],
            noNewRows: historyProbe.rows === historyProbe.metrics[1],
            sameScroll: Math.abs(uiUtilsV136.getHistoryScrollContainer().scrollTop - historyProbe.scroll) <= 2,
            sameQuery: document.getElementById('history-search-input').value === 'Cache fixture',
            sameSort: document.getElementById('history-sort-order-toolbar').value === 'title',
            sameFilter: document.querySelector('[data-history-pin-filter="pinned"]').getAttribute('aria-pressed') === 'true'
        }})""")
        assert all(checks.values()), checks

    leave_history()
    ev("""(async () => {
        await chatHistoryActions.rename(10000, 'Cache fixture renamed');
        await chatHistoryActions.setPinned(10002, false);
    })()""")
    open_history()
    wait(f"{count} === 259 && document.querySelector('[data-chat-id=\"10000\"] .history-item-title')?.title === 'Cache fixture renamed'",
         'Hidden rename and unpin update cached rows')
    assert ev('historyProbe.scans === historyProbe.metrics[0]'), 'Local metadata changes avoid a full scan'

    leave_history()
    saved_id = ev("""(async () => {
        appLogic.startNewChat();
        await state.executionSettingsReady;
        state.currentMessages = [{role: 'user', content: 'Cache fixture new body'}];
        const id = await dbUtils.saveChat('Cache fixture new');
        await chatHistoryActions.setPinned(id, true);
        return id;
    })()""")
    ev(f"""historyProbe.hold = true;
        historyProbe.previous = document.querySelector('{rows}');""")
    open_history()
    wait('Boolean(historyProbe.release)', 'A pre-update history snapshot is pending')
    assert ev(f"historyProbe.previous.isConnected && !({loading}) && {count} === 259")
    ev("""(async () => {
        state.currentMessages[0].content = 'Unique edited message';
        await dbUtils.saveChat('Cache fixture latest');
    })()""")
    leave_history()
    open_history()
    assert ev(f"historyProbe.previous.isConnected && !({loading})")
    ev("historyProbe.release()")
    wait(f"document.querySelector('.history-item[data-chat-id=\"{saved_id}\"] .history-item-title')?.title === 'Cache fixture latest'",
         'A stale read cannot win after a newer save and re-entry')
    assert ev('historyProbe.scans === historyProbe.metrics[0] + 2'), 'Overlapping views share the pending read'
    search('Unique edited message')
    wait(f"{count} === 1 && document.querySelector('{rows}')?.dataset.chatId === '{saved_id}'",
         'Search uses newly saved message contents')

    leave_history()
    ev("""(async () => {
        uiUtilsV136.showCustomAlert = async () => {};
        uiUtilsV136.showCustomConfirm = async () => true;
        historyProbe.duplicate = (await chatHistoryActions.duplicate(10000)).chatId;
        await chatHistoryActions.delete(10004);
        await appLogic.handleHistoryImport(new File(
            ['<|#|user|#|>Imported fixture body<|#|/user|#|>'], 'Imported fixture.txt', {type:'text/plain'}));
    })()""")
    wait("!document.querySelector('#progressDialog[open]')", 'Single history import committed')
    ev("appLogic.updateHistoryPinFilter('all')")
    ev("historyProbe.previous = document.querySelector('#history-list .history-item'); historyProbe.fail = true;")
    open_history()
    wait(f"{panel}.dataset.state === 'error' && !{panel}.classList.contains('hidden')", 'Failed refresh offers retry')
    assert ev("historyProbe.previous.isConnected && !document.getElementById('history-list').classList.contains('hidden')")
    click('#history-state-action')
    search('')
    wait(f"""Boolean(document.querySelector('.history-item[data-chat-id="' + historyProbe.duplicate + '"]')) &&
        !document.querySelector('.history-item[data-chat-id="10004"]') &&
        [...document.querySelectorAll('{rows} .history-item-title')].some(el => el.title.includes('Imported fixture'))""",
         'Retry applies hidden duplicate, delete and import')

    leave_history()
    ev("""(async () => {
        await appLogic.importDataFromString(JSON.stringify({version: '2.0', data: {
            profiles: await dbUtils.getAllProfiles(),
            chats: [{id: 99999, title:'Restored cache fixture', createdAt:1, updatedAt:1, messages:[]}]
        }}));
        uiUtilsV136.hideProgressDialog();
    })()""")
    open_history()
    wait(f"{count} === 1 && document.querySelector('{rows}')?.dataset.chatId === '99999'",
         'Restoring a backup replaces the cached history')

    leave_history()
    ev("""(() => {
        historyProbe.revision = historyUiState.dataRevision;
        const peer = historyProbe.peer = document.createElement('iframe');
        peer.hidden = true;
        peer.src = location.pathname + location.search + '#chat';
        document.body.appendChild(peer);
    })()""")
    wait('Boolean(historyProbe.peer.contentWindow.appLogic?._setupEventListenersCallCount)',
         'Second page is connected to the same database')
    peer_id = ev("""historyProbe.peer.contentWindow.eval(`(async () => {
        appLogic.startNewChat();
        await state.executionSettingsReady;
        state.currentMessages = [{role: 'user', content: 'Saved in the second page'}];
        return dbUtils.saveChat('Cache fixture from another page');
    })()`)""")
    wait('historyUiState.dataRevision > historyProbe.revision', 'History receives the cross-page invalidation')
    open_history()
    wait(f"{count} === 2 && Boolean(document.querySelector('.history-item[data-chat-id=\"{peer_id}\"]'))",
         'A hidden history includes the second page’s saved chat on re-entry')
    ev('historyProbe.peer.remove()')

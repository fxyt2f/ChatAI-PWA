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

    def drag(selector, dx, dy=0, *, padding=False, cancel=False, measure=False):
        nonlocal touch_id
        touch_id += 1
        origin = ev(f"""(() => {{
            const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
            const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
            return {{x: {('left + 6' if dx >= 0 else 'right - 8') if padding else f'(left + right - ({dx})) / 2'},
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
        click('[data-settings-category="other"]')
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
        drag(settings_detail, 104, padding=True)
        screen('settings')
        assert ev('settingsUiV136.category') is None and ev('history.length') == depth
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
        for selector in ('#dark-mode-toggle', '#overlay-opacity-slider'):
            unchanged(lambda: synthetic(selector, [(160, 300)], (205, 300)))
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
        drag(settings_top, 104)
        screen('chat')
        ev('history.back()')
        screen('settings')
        ev('history.forward()')
        screen('chat')
        # Chrome's CDP touch emulation can retain a released contact when the app
        # hides its target during touchend. Isolate subsequent native streams.
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
        ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', false)")
        unchanged(lambda: drag(history_list, -104, padding=True))
        ev("appLogic.updateLocalUiSetting('enableSwipeNavigation', true)")
        unchanged(lambda: drag(history_list, 104, padding=True))
        unchanged(lambda: release_with_feedback(history_list, '#history-screen', 104, follows=False))
        drag(history_list, 0, -180, padding=True)
        wait("document.querySelector('.history-main-content').scrollTop > 0", 'History vertical scroll works')
        saved_scroll = ev("document.querySelector('.history-main-content').scrollTop")
        drag(history_list, -104, padding=True)
        screen('chat')
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
        for selector in ('#user-input', '#chat-search-dialog', '#chat-replace-preview-list', '.message.model pre'):
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
            const chat = {json.dumps(chat)}, settings = {json.dumps(settings_top)};
            swipeFixtureEvent(chat, 'touchstart', [[0, 200, 300]]);
            swipeFixtureEvent(chat, 'touchend', [], [[0, 100, 300]]);
            swipeFixtureEvent(chat, 'touchend', [], [[0, 100, 300]]);
            swipeFixtureEvent(settings, 'touchstart', [[0, 100, 300]]);
            swipeFixtureEvent(settings, 'touchend', [], [[0, 200, 300]]);
            return location.hash === '#settings' && history.length === {depth + 1};
        }})()"""), 'A duplicate end and a second gesture during transition cause no second navigation'
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
            'reduced motion, settings/history/back-forward, 320–1280px and menu controls in both themes)')

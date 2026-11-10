"""Release notes on the real startup and settings pages with controlled CHANGELOG responses."""
import time


def run(client, url):
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

    def viewport(width, height=760):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })

    def key(name, code, modifiers=0):
        for event in ('keyDown', 'keyUp'):
            client.call('Input.dispatchKeyEvent', {
                'type': event, 'key': name, 'code': name, 'windowsVirtualKeyCode': code, 'modifiers': modifiers,
            })

    dialog = '#releaseNotesDialog'
    content = f'{dialog} .release-notes-content'
    saved = "(await dbUtils.getSetting('localUiSettings'))?.value?.lastSeenReleaseVersion || ''"

    def close_notes(ok=True):
        if ok:
            ev(f"document.querySelector('{dialog} .dialog-ok-btn').click()")
        else:
            key('Escape', 27)
        wait('appLogic.releaseNotesDialogPromise === null', 'Release notes dialog closed and cleaned up')

    def boot(mode, expect_notice=True):
        old_time = ev('performance.timeOrigin')
        target = f'{url}?releaseNotesFixture={mode}#settings/other'
        if ev('location.href') == target:
            client.call('Page.reload')
        else:
            client.call('Page.navigate', {'url': target})
        if mode == 'keyboard':
            wait(f"performance.timeOrigin > {old_time} && Boolean(window.resumeReleaseNotesStartup)", 'Startup is paused before opening the notes')
            key('Tab', 9)
            ev('resumeReleaseNotesStartup()')
        wait(f"""performance.timeOrigin > {old_time} && Boolean(window.appLogic?._setupEventListenersCallCount)
            && !document.querySelector('#progressDialog[open]')""", 'App startup completed')
        assert ev(f"Boolean(document.querySelector('{dialog}[open]'))") == expect_notice, mode
        assert ev("!document.querySelector('#alertDialog[open]') && sessionStorage.getItem('pendingVersionNotice') === null")

    def check_fallback():
        wait(f"document.querySelector('{content}').textContent.includes('読み込めませんでした')",
             'Invalid or unavailable notes show the fallback')
        assert ev(f"!document.querySelector('{content} h2') && !document.querySelector('{content}').textContent.includes('STALE')")
        close_notes()
        assert ev(f"(async () => ({saved}) !== APP_VERSION)()"), 'Fallback was incorrectly marked as read'

    def check_layout(width, count):
        wait(f"""document.querySelectorAll('{content} h2').length === {count}
            && !document.querySelector('{dialog}').classList.contains('animating')""",
             f'{count} Markdown version sections at {width}px')
        result = ev(f"""(() => {{
            const dialog = document.querySelector('{dialog}');
            const body = dialog.querySelector('.release-notes-content');
            const ok = dialog.querySelector('.dialog-ok-btn');
            const rect = dialog.getBoundingClientRect(), button = ok.getBoundingClientRect();
            const headings = Array.from(body.querySelectorAll('h2'), el => el.textContent);
            const atTop = body.scrollTop === 0
                && body.firstElementChild.getBoundingClientRect().top >= body.getBoundingClientRect().top;
            return {{
                headings, atTop, initiallyFocused: document.activeElement === body,
                initialOutline: getComputedStyle(document.activeElement).outlineStyle,
                width: Math.round(rect.width), height: Math.round(rect.height), viewport: innerWidth,
                radius: getComputedStyle(dialog).borderRadius,
                flush: rect.left === 0 && rect.top === 0 && rect.right === innerWidth && rect.bottom === innerHeight,
                fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
                    && button.left >= rect.left && button.right <= rect.right && button.bottom <= rect.bottom
                    && body.scrollWidth === body.clientWidth,
                markdown: Boolean(body.querySelector('h3') && body.querySelector('ul li') && body.querySelector('p br'))
            }};
        }})()""")
        assert result['headings'] == [
            'v1.36.5 (2099/01/02)', 'v1.36.4', 'v1.36.3', 'v1.36.2',
        ][:count], result
        assert result['viewport'] == width and result['width'] == (width if width < 800 else 720), result
        assert result['height'] == (760 if width < 800 else 720), result
        assert result['flush'] == (width < 800) and (result['radius'] == '0px') == (width < 800), result
        if count == 1:
            assert result['initialOutline'] == 'none', result
        assert all(result[key] for key in ('atTop', 'initiallyFocused', 'fits', 'markdown')), result

        key('Tab', 9)
        assert ev(f"""(() => {{
            const ok = document.querySelector('{dialog} .dialog-ok-btn');
            const body = document.querySelector('{content}');
            return document.activeElement === ok && ok.matches(':focus-visible') &&
                getComputedStyle(ok).outlineStyle !== 'none' && body.scrollTop === 0 && ok.closest('dialog').scrollTop === 0;
        }})()"""), 'Tab visibly focuses OK without scrolling the notes'
        key('Tab', 9, modifiers=8)
        assert ev(f"""document.activeElement === document.querySelector('{content}') &&
            getComputedStyle(document.activeElement).outlineStyle !== 'none'"""), 'Shift+Tab visibly focuses the notes again'
        assert ev(f"""(() => {{
            const body = document.querySelector('{content}');
            const ok = document.querySelector('{dialog} .dialog-ok-btn');
            const buttonTop = ok.getBoundingClientRect().top;
            body.scrollTop = body.scrollHeight;
            return body.scrollTop > 0 && body.scrollHeight - body.clientHeight - body.scrollTop < 2 &&
                body.lastElementChild.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 2 &&
                ok.getBoundingClientRect().top === buttonTop;
        }})()"""), 'Notes scroll to the end with OK still visible'

    repository = '#app-info-settings a.app-info-action'
    update_button = '#update-app-btn'
    github_url = 'https://github.com/fxyt2f/ChatAI-PWA'

    def point(selector):
        return ev(f"""(() => {{
            const box = document.querySelector('{selector}').getBoundingClientRect();
            return {{x: box.left + box.width / 2, y: box.top + box.height / 2}};
        }})()""")

    def check_app_info():
        ev(f"document.querySelector('{repository}').scrollIntoView({{block:'center'}})")
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': 1, 'y': 1})
        wait(f"Array.from(document.querySelectorAll('{repository}, {update_button}')).every(el => !el.getAnimations().length)",
             'The app info buttons are in their resting state')
        assert ev(f"""(() => {{
            const link = document.querySelector('{repository}'), button = document.querySelector('{update_button}');
            const a = link.getBoundingClientRect(), b = button.getBoundingClientRect();
            const linkStyle = getComputedStyle(link), buttonStyle = getComputedStyle(button);
            return a.left === b.left && a.width === b.width && a.height === b.height &&
                ['backgroundColor', 'color', 'fontSize', 'fontFamily', 'fontWeight', 'padding', 'lineHeight',
                    'borderRadius', 'border', 'boxShadow'].every(property => linkStyle[property] === buttonStyle[property]) &&
                linkStyle.textDecorationLine === 'none' && linkStyle.textTransform === 'none' &&
                link.textContent === 'GitHub Repository' && link.href === '{github_url}' &&
                link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer');
        }})()"""), 'Repository link and update button share the same styling'

        def hover_style(selector):
            client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **point(selector)})
            wait(f"""(() => {{ const element = document.querySelector('{selector}');
                return element.matches(':hover') && !element.getAnimations().length;
            }})()""", f'Hover transition for {selector}')
            return ev(f"""(() => {{ const style = getComputedStyle(document.querySelector('{selector}'));
                return [style.backgroundColor, style.color, style.boxShadow, style.textDecorationLine];
            }})()""")

        normal = ev(f"getComputedStyle(document.querySelector('{repository}')).backgroundColor")
        link_hover = hover_style(repository)
        assert link_hover == hover_style(update_button) and link_hover[0] != normal, 'Hover styling also matches'

    def check_repository_navigation():
        before = {item['targetId'] for item in client.call('Target.getTargets')['targetInfos']}
        for event in ('mousePressed', 'mouseReleased'):
            client.call('Input.dispatchMouseEvent', {'type': event, 'button': 'left', 'clickCount': 1, **point(repository)})
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            targets = client.call('Target.getTargets')['targetInfos']
            for target in targets:
                if target['targetId'] not in before and target['url'] == github_url:
                    client.call('Target.closeTarget', {'targetId': target['targetId']})
                    client.call('Page.bringToFront')
                    return
            time.sleep(0.05)
        raise AssertionError(f'GitHub did not open in a new tab: {targets}')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    identifier = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': r"""
        const mode = new URL(location.href).searchParams.get('releaseNotesFixture');
        if (mode) {
            if (mode === 'keyboard') document.addEventListener('DOMContentLoaded', () => {
                const open = dbUtils.openDB;
                const paused = new Promise(resolve => {
                    window.resumeReleaseNotesStartup = () => { dbUtils.openDB = open; resolve(); };
                });
                dbUtils.openDB = async function(...args) { await paused; return open.apply(this, args); };
            }, { once: true });
            // Keep Worker activation from reloading this fixture between dialog assertions.
            const sw = navigator.serviceWorker;
            const listen = sw.addEventListener.bind(sw);
            sw.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') return listen(type, ...args);
            };
            sessionStorage.setItem('pendingVersionNotice', JSON.stringify({
                version: mode === 'stale' ? '1.36.4' : '1.36.5',
                message: 'STALE pending notice', shouldPersist: true
            }));
            const history = ['1.36.4', '1.36.3', '1.36.2', '1.36.1'].map(
                version => '## v' + version + '\r\n\r\n- STALE ' + version + '\r\n'
            ).join('\r\n');
            const notes = '## v1.36.5 (2099/01/02)\r\n\r\n### Details\r\n\r\nFirst line\r\nSecond line\r\n\r\n'
                + Array.from({length: 70}, (_, i) => '- Release note ' + (i + 1) + '\r\n').join('') + '\r\n' + history;
            window.releaseNotesFixture = mode;
            const fetchOriginal = window.fetch;
            window.fetch = async (resource, options) => {
                if (resource !== './CHANGELOG.md') return fetchOriginal(resource, options);
                if (window.releaseNotesFixture === 'error') throw new TypeError('Controlled fetch failure');
                if (window.releaseNotesFixture === 'stale') return new Response(history);
                return new Response(notes);
            };
        }
    """})['identifier']
    try:
        viewport(320)
        boot('stale')
        check_fallback()
        ev("window.releaseNotesFixture = 'current'")
        assert ev("appLogic.formatReleaseNotes().then(notes => notes?.startsWith('## v1.36.5 (2099/01/02)'))")
        assert ev("appLogic.formatReleaseNotes('1.36.50').then(notes => notes === null)")
        assert ev("appLogic.formatReleaseNotes('1.36.4').then(notes => notes?.startsWith('## v1.36.4\\n'))")

        boot('error')
        check_fallback()

        viewport(1280)
        boot('keyboard')
        check_layout(1280, 1)
        close_notes(ok=False)

        viewport(320)
        boot('current')
        check_layout(320, 1)
        assert ev(f"(async () => ({saved}) !== APP_VERSION)()"), 'Version was marked read before OK'
        close_notes(ok=False)
        assert ev(f"(async () => ({saved}) !== APP_VERSION)()"), 'Cancellation was marked read'

        boot('current')
        check_layout(320, 1)
        close_notes()
        wait(f'(async () => ({saved}) === APP_VERSION)()', 'OK saves the verified version to IndexedDB')
        boot('current', expect_notice=False)

        for width in (375, 430, 799, 800, 801, 1280):
            viewport(width)
            for dark in (False, True):
                theme = str(dark).lower()
                ev(f"appLogic.saveAppearanceValues('theme', {{darkMode: {theme}}}, {{global: true}})")
                ev("appLogic.updateLocalUiSetting('lastSeenReleaseVersion', '')")
                boot('current')
                assert ev(f"document.body.classList.contains('dark-mode') === {theme}")
                check_layout(width, 1)
                if width == 375 and not dark:
                    assert ev(f"""(() => {{
                        const root = document.documentElement, dialog = document.querySelector('{dialog}');
                        const insets = {{top: 30, right: 12, bottom: 26, left: 10}};
                        for (const [edge, inset] of Object.entries(insets)) root.style.setProperty('--safe-' + edge, inset + 'px');
                        try {{
                            const style = getComputedStyle(dialog), button = dialog.querySelector('.dialog-ok-btn');
                            return style.padding === '44px 26px 40px 24px' && button.getBoundingClientRect().bottom <= innerHeight - insets.bottom;
                        }} finally {{
                            for (const edge of Object.keys(insets)) root.style.removeProperty('--safe-' + edge);
                        }}
                    }})()"""), 'Fullscreen notes keep the content and OK inside the safe area'
                assert ev(f"(async () => ({saved}) !== APP_VERSION)()")
                close_notes()
                wait(f'(async () => ({saved}) === APP_VERSION)()', 'Automatic notes acknowledged')

                wait("""state.currentScreen === 'settings' && !document.querySelector('#settings-panel-other').hidden
                    && document.querySelector('#release-notes-btn').getClientRects().length > 0""",
                     'Other settings and the release notes button are available')
                ev("document.querySelector('#release-notes-btn').click()")
                check_layout(width, 4)
                close_notes()
                check_app_info()

        check_repository_navigation()
        viewport(375)

        ev("void uiUtils.showCustomAlert('Regular alert')")
        wait("""document.activeElement === document.querySelector('#alertDialog .dialog-ok-btn')""",
             'Regular alert still focuses its OK button')
        assert ev("""(() => {
            const alert = document.querySelector('#alertDialog');
            const body = alert.querySelector('.dialog-message');
            return alert.open && !alert.matches('.release-notes-dialog') && !body.matches('.release-notes-content')
                && alert.scrollTop === 0 && body.scrollTop === 0 && body.textContent === 'Regular alert';
        })()""")
        ev("document.querySelector('#alertDialog .dialog-ok-btn').click()")
        wait("!document.querySelector('#alertDialog').open", 'Regular alert still closes with OK')
        ev("uiUtils.showCustomConfirm('Regular confirmation').then(result => window.regularConfirmResult = result); void 0")
        wait("document.activeElement === document.querySelector('#confirmDialog .dialog-ok-btn')", 'Confirmation still focuses OK')
        assert ev("document.querySelector('#confirmDialog').getBoundingClientRect().width < innerWidth")
        key('Escape', 27)
        wait("window.regularConfirmResult === false", 'Regular confirmation cancels with Escape')
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': identifier})
        client.call('Network.setBlockedURLs', {'urls': []})
        viewport(1280, 900)
    return 'ALL PASSED (release notes startup and settings, 6 widths × 2 themes, keyboard focus, Markdown, acknowledgement, regular dialogs and GitHub button)'

"""Native mouse/touch dialog matrix, invoked with --dialogs."""
import base64
import json


def run(client, root):
    output = root / 'docs' / 'dialog-ui-v1361'
    output.mkdir(exist_ok=True)

    def ev(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def metrics(width, height=900, touch=False):
        client.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': touch})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': touch})

    def press(point, kind='mousePressed', touch=False):
        if touch:
            client.call('Input.dispatchTouchEvent', {'type': 'touchStart' if kind == 'mousePressed' else 'touchEnd',
                                                     'touchPoints': [point] if kind == 'mousePressed' else []})
        else:
            client.call('Input.dispatchMouseEvent', {'type': kind, **point, 'button': 'left', 'clickCount': 1})

    def click(point, touch=False):
        press(point, touch=touch); press(point, 'mouseReleased', touch)

    def key(name, code, number):
        for kind in ['keyDown', 'keyUp']:
            params = {'type': kind, 'key': name, 'code': code, 'windowsVirtualKeyCode': number}
            if name == 'Enter' and kind == 'keyDown':
                params['text'] = '\r'
            client.call('Input.dispatchKeyEvent', params)

    def screenshot(name):
        data = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})['data']
        (output / name).write_bytes(base64.b64decode(data))

    def button(selector):
        r = ev(f'document.querySelector({json.dumps(selector)}).getBoundingClientRect().toJSON()')
        return {'x': r['x'] + r['width'] / 2, 'y': r['y'] + r['height'] / 2}

    ev((root / 'tests/dialog-ui-v1361.js').read_text(encoding='utf-8'))
    metrics(1280); ev('dialogUiV1361.prepare(false,false)')
    ev('dialogUiV1361.open("system")'); ev('dialogUiV1361.focusCloseButton()')
    key('Enter', 'Enter', 13); ev('dialogUiV1361.closed()')
    records = []
    for width, height in [(1280, 900), (1024, 900), (390, 844), (390, 420)]:
        touch = width < 800
        metrics(width, height, touch)
        for dark in [False, True]:
            ev(f'dialogUiV1361.prepare({str(dark).lower()})')
            for kind in ['system', 'format', 'debug', 'summary', 'compression']:
                try:
                    ev(f'dialogUiV1361.open({json.dumps(kind)})')
                    measured = ev('dialogUiV1361.layout()')
                    click(ev('dialogUiV1361.inside()'), touch); ev('dialogUiV1361.staysOpen()')
                    if width in [1280, 390] and kind in ['system', 'format', 'debug'] and height > 500:
                        screenshot(f'{width}-{"dark" if dark else "light"}-{kind}.png')
                    if width >= 900:
                        ev('uiUtilsV136.closeChatSidebar();true'); ev('dialogUiV1361.layout()')
                        ev('uiUtilsV136.openChatSidebar();true'); ev('dialogUiV1361.layout()')
                    click({'x': 3, 'y': 3}, touch); ev('dialogUiV1361.closed()')
                    if width == 1024 and kind == 'system':
                        ev('dialogUiV1361.open("system")'); key('Escape', 'Escape', 27)
                        ev('dialogUiV1361.closed()'); ev('dialogUiV1361.sidebarOpen()')
                    records.append({'width': width, 'height': height, 'touch': touch, 'dark': dark, 'kind': kind, **measured})
                except Exception as error:
                    raise RuntimeError(f'{width}x{height} dark={dark} {kind}: {error}') from error

    # Every native dialog category, plus the custom image overlay.
    for touch, width in [(False, 1280), (True, 390)]:
        metrics(width, 844, touch); ev('dialogUiV1361.prepare(false,false)')
        for kind in ['confirm', 'prompt', 'alert', 'api', 'conflict', 'memory', 'character', 'assets']:
            ev(f'dialogUiV1361.open({json.dumps(kind)})')
            click(ev('dialogUiV1361.inside()'), touch); ev('dialogUiV1361.staysOpen()')
            click({'x': 3, 'y': 3}, touch); ev('dialogUiV1361.closed()')
        ev('dialogUiV1361.image()')
        click({'x': width / 2, 'y': 422}, touch); ev('dialogUiV1361.imageVisible(true)')
        click({'x': 3, 'y': 3}, touch); ev('dialogUiV1361.imageVisible(false)')
        ev('dialogUiV1361.open("progress")')
        click({'x': 3, 'y': 3}, touch); ev('dialogUiV1361.progressOpen()')
        key('Escape', 'Escape', 27); ev('dialogUiV1361.progressOpen()'); ev('uiUtilsV136.hideProgressDialog()')

    metrics(1280); ev('dialogUiV1361.prepare(false,false)')
    ev('dialogUiV1361.open("format")')
    inside = ev('dialogUiV1361.inside()'); outside = {'x': 3, 'y': 3}
    for start, end in [(inside, outside), (outside, inside), (outside, {'x': 40, 'y': 40})]:
        press(start)
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **end, 'button': 'left', 'buttons': 1})
        press(end, 'mouseReleased'); ev('dialogUiV1361.staysOpen()')
    press(outside)
    client.call('Input.dispatchMouseEvent', {'type': 'mouseWheel', **outside, 'deltaX': 0, 'deltaY': 120})
    press(outside, 'mouseReleased'); ev('dialogUiV1361.staysOpen()')
    key('Escape', 'Escape', 27); ev('dialogUiV1361.closed()')

    metrics(390, 844, True); ev('dialogUiV1361.prepare(false,false)'); ev('dialogUiV1361.open("format")')
    for start, end in [({'x': 3, 'y': 3}, {'x': 50, 'y': 50}), (ev('dialogUiV1361.inside()'), {'x': 3, 'y': 3})]:
        press(start, touch=True)
        client.call('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [end]})
        press(end, 'mouseReleased', True); ev('dialogUiV1361.staysOpen()')
    key('Escape', 'Escape', 27); ev('dialogUiV1361.closed()')
    ev('dialogUiV1361.open("system")'); ev('dialogUiV1361.fakeKeyboard()'); ev('dialogUiV1361.layout()')
    screenshot('390-visual-keyboard-system.png')
    key('Escape', 'Escape', 27); ev('dialogUiV1361.closed()'); ev('dialogUiV1361.restoreViewport()')
    metrics(1280)

    ev('dialogUiV1361.addProbe();dialogUiV1361.stack()'); click(outside); ev('dialogUiV1361.topClosed()')
    # A second independent gesture is required to dismiss the underlying modal.
    click(outside); ev('dialogUiV1361.formatClosed();dialogUiV1361.noClickThrough()')
    ev('dialogUiV1361.reset()')
    for _ in range(3):
        ev('dialogUiV1361.reopenConfirmWithOldResult()'); ev('dialogUiV1361.open("confirm")')
        key('Escape', 'Escape', 27); ev('dialogUiV1361.closed()')

    ev('dialogUiV1361.open("system")'); ev('dialogUiV1361.input("700msの自動保存")'); ev('dialogUiV1361.autosaved()')
    ev('dialogUiV1361.input("外側クリック直前の編集")'); click(outside); ev('dialogUiV1361.closed()'); ev('dialogUiV1361.saved("外側クリック直前の編集")')
    ev('dialogUiV1361.open("system")'); ev('dialogUiV1361.input("失敗後に保持する編集");dialogUiV1361.failSave()')
    click(outside); ev('dialogUiV1361.failedSaveStaysOpen()')
    click(outside); ev('dialogUiV1361.closed()'); ev('dialogUiV1361.saved("失敗後に保持する編集")')
    ev('dialogUiV1361.sending(true)'); ev('dialogUiV1361.open("system")'); ev('dialogUiV1361.readOnly()')
    key('Escape', 'Escape', 27); ev('dialogUiV1361.closed()'); ev('dialogUiV1361.sending(false)')
    ev('dialogUiV1361.open("system")'); ev('dialogUiV1361.input("切替直前の編集")'); ev('dialogUiV1361.switchChat()')
    ev('dialogUiV1361.lateSummary()'); click(outside); ev('dialogUiV1361.closed()'); ev('dialogUiV1361.finishLateSummary()')
    ev('dialogUiV1361.open("debug")'); ev('dialogUiV1361.beginLogCopy()')
    click(button('#copy-logs-btn')); ev('dialogUiV1361.logCopyReady()'); click(outside); ev('dialogUiV1361.logCopied()')
    click(button('#clear-logs-btn')); ev('dialogUiV1361.logsCleared()')
    click(button('#close-log-dialog-btn')); ev('dialogUiV1361.closed()')
    ev('dialogUiV1361.settingsConfirm()'); click(outside); ev('dialogUiV1361.reset()')
    ev('dialogUiV1361.repeatClose()')
    result = {'assertions': ev('dialogUiV1361.count()'), 'matrix': records}
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return f"ALL PASSED ({result['assertions']} dialog assertions; native mouse/touch, storage, modal stack and progress exception)"

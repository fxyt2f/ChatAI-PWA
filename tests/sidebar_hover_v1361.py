"""Focused native input matrix; invoked by run-browser-tests.py --sidebar-hover."""
import base64
import json


def run(client, root):
    output = root / 'docs' / 'sidebar-hover-v1361'
    output.mkdir(exist_ok=True)

    def ev(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            diagnostics = client.call('Runtime.evaluate', {'expression':'JSON.stringify(sidebarHoverV1361.diagnostics())','returnByValue':True})
            print('SIDEBAR DIAGNOSTICS',diagnostics.get('result',{}).get('value'),flush=True)
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def key(name, code, number):
        for kind in ['keyDown', 'keyUp']:
            client.call('Input.dispatchKeyEvent', {'type': kind, 'key': name, 'code': code, 'windowsVirtualKeyCode': number})

    def point(selector):
        bounds = ev(f'document.querySelector({json.dumps(selector)}).getBoundingClientRect().toJSON()')
        return {'x': bounds['x'] + bounds['width'] / 2, 'y': bounds['y'] + bounds['height'] / 2}

    def move(selector=None):
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **(point(selector) if selector else {'x': 800, 'y': 850})})
        ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')

    def activate(selector, touch=False):
        coords = point(selector)
        if touch:
            client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [coords]})
            client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            move(selector)
            for kind in ['mousePressed', 'mouseReleased']:
                client.call('Input.dispatchMouseEvent', {'type': kind, **coords, 'button': 'left', 'clickCount': 1})

    def item(ident, target='open'):
        return f'.chat-sidebar-item[data-chat-id="{ident}"] .chat-sidebar-item-{target}'

    def capture(name):
        screenshot = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})['data']
        (output / name).write_bytes(base64.b64decode(screenshot))

    ev((root / 'tests' / 'sidebar-hover-v1361.js').read_text(encoding='utf-8'))
    ids = ev('sidebarHoverV1361.ids')
    records = []
    for touch in [False, True]:
        for width in [1024, 1280]:
            client.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': touch})
            client.call('Emulation.setTouchEmulationEnabled', {'enabled': touch})
            for dark in [False, True]:
                move()
                before = ev('sidebarHoverV1361.count()')
                prepared = ev(f'sidebarHoverV1361.prepare({str(dark).lower()})')
                media = ev("({hover:matchMedia('(hover: hover)').matches,coarse:matchMedia('(any-pointer: coarse)').matches})")
                if media['coarse'] != touch or media['hover'] == touch:
                    raise RuntimeError(f'Unexpected input emulation: touch={touch}, {media}')
                ev(f'sidebarHoverV1361.baseline({str(touch).lower()})')
                if not touch:
                    for ident in ids[:2]:
                        move(item(ident)); ev(f'sidebarHoverV1361.hovered({ident})')
                        move(item(ident, 'menu')); ev(f'sidebarHoverV1361.circle({ident})')
                    capture(f'{width}-{"dark" if dark else "light"}-hover.png')
                    activate(item(ids[1], 'menu')); ev(f'sidebarHoverV1361.opened({ids[1]})')
                    move(); ev(f'sidebarHoverV1361.opened({ids[1]})')
                    key('ArrowDown', 'ArrowDown', 40)
                    if ev('document.activeElement.dataset.historyMenuAction') != 'rename':
                        raise RuntimeError('Native menu arrow navigation failed')
                    key('Escape', 'Escape', 27); ev(f'sidebarHoverV1361.escaped({ids[1]})')
                    ev(f'sidebarHoverV1361.focusOpen({ids[2]})'); key('Tab', 'Tab', 9)
                    ev(f'sidebarHoverV1361.focusMenu({ids[2]})')
                    key('Enter', 'Enter', 13); ev(f'sidebarHoverV1361.opened({ids[2]})')
                    key('Escape', 'Escape', 27); ev(f'sidebarHoverV1361.escaped({ids[2]})')
                    ev('sidebarHoverV1361.blur()'); move(); ev('sidebarHoverV1361.baseline(false)')
                    ev('sidebarHoverV1361.redraw()'); ev('sidebarHoverV1361.baseline(false)')
                    move(item(ids[1])); ev(f'sidebarHoverV1361.hovered({ids[1]})')
                else:
                    activate(item(ids[1], 'menu'), True); ev(f'sidebarHoverV1361.opened({ids[1]})')
                    key('Escape', 'Escape', 27); ev(f'sidebarHoverV1361.escaped({ids[1]})')
                activate(item(ids[1]), touch); ev('sidebarHoverV1361.switched()')
                move(); ev('sidebarHoverV1361.blur()'); ev(f'sidebarHoverV1361.baseline({str(touch).lower()})')
                records.append({'width': width, 'touch': touch, 'dark': dark, 'media': media, **prepared,
                                'assertions': ev('sidebarHoverV1361.count()') - before})

    # Exercise all five real menu actions once against fixture records. Only
    # confirmations/prompts and the final download are intercepted.
    client.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
    ev('sidebarHoverV1361.prepare(false)'); ev('sidebarHoverV1361.beginActions()')
    try:
        for action in ['pin', 'rename', 'export', 'duplicate', 'delete']:
            ident = ids[2] if action == 'delete' else ids[1]
            activate(item(ident, 'menu')); ev(f'sidebarHoverV1361.opened({ident})')
            activate(f'#history-item-menu [data-history-menu-action="{action}"]')
            ev(f'sidebarHoverV1361.actionDone({json.dumps(action)})')
    finally:
        actions = ev('sidebarHoverV1361.endActions()')

    client.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
    client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
    ev('sidebarHoverV1361.phone()')
    result = {'assertions': ev('sidebarHoverV1361.count()'), 'matrix': records, 'actions': actions}
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    ev('sidebarHoverV1361.finish()')
    return f"ALL PASSED ({result['assertions']} sidebar hover assertions; 8 theme/sidebar/input cases; five real menu actions)"

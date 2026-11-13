"""Project workflows through the real app, Chrome and IndexedDB."""
import base64
import json
import time


def run(client, url, screenshots=None):
    checks = []

    def ev(expression):
        result = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in result:
            raise AssertionError(result['exceptionDetails'])
        return result['result'].get('value')

    def wait(condition, description):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            try:
                if ev(f'Promise.resolve(window.state && ({condition})).then(Boolean)'):
                    return
            except AssertionError as error:
                if 'Execution context was destroyed' not in str(error):
                    raise
            time.sleep(.04)
        raise AssertionError((description, ev("""({
            project: document.querySelector('#project-title')?.textContent,
            notice: document.querySelector('#project-notice')?.textContent,
            error: document.querySelector('#project-dialog-notice')?.textContent,
            dialogs: [...document.querySelectorAll('dialog[open]')].map(x=>[x.id, x.textContent.trim().slice(0,200)]),
            sidebar: [chatSidebarUiState.mode, chatSidebarUiState.isOpen],
            chat: state.currentChatId, history: history.state, url: location.href,
            startupPaused: Boolean(window.resumeSidebarStartup), setup: appLogic._setupEventListenersCallCount,
            cached: chatSidebarUiState.projects.length, loaded: chatSidebarUiState.hasLoadedAll
        })""")))

    def click(selector, touch=False):
        if not touch:
            ev(f'document.querySelector({json.dumps(selector)}).click()')
            return
        point = ev(f"""(() => {{
            const node = document.querySelector({json.dumps(selector)});
            node.scrollIntoView({{block:'nearest'}});
            const r = node.getBoundingClientRect(), x = r.left+r.width/2, y=r.top+r.height/2;
            const target = document.elementFromPoint(x,y);
            return {{x,y,hit:node.contains(target), target:target?.id || target?.className}};
        }})()""")
        assert point.pop('hit'), (selector, point)
        point.pop('target')
        client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

    def change(selector, value, event='input'):
        ev(f"""(() => {{
            const field = document.querySelector({json.dumps(selector)});
            field.value = {json.dumps(value)};
            field.dispatchEvent(new Event({json.dumps(event)}, {{bubbles:true}}));
        }})()""")

    def viewport(width, mobile, height=800):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': mobile,
        })
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': mobile})

    def hover(selector):
        point = ev(f"""(() => {{
            const row=document.querySelector({json.dumps(selector)});
            row.scrollIntoView({{block:'nearest'}});
            const r=row.getBoundingClientRect();
            return {{x:r.left+r.width/2,y:r.top+r.height/2}};
        }})()""")
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **point})

    def mouse_click(selector):
        hover(selector)
        point = ev(f"""(() => {{
            const node = document.querySelector({json.dumps(selector)});
            const r = node.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;
            return {{x,y,hit:node.contains(document.elementFromPoint(x,y))}};
        }})()""")
        assert point.pop('hit'), (selector, point)
        for kind in ['mousePressed', 'mouseReleased']:
            client.call('Input.dispatchMouseEvent', {'type': kind, 'button': 'left', 'clickCount': 1, **point})

    def key(name):
        for kind in ['keyDown', 'keyUp']:
            params = {'type': kind, 'key': name, 'code': name,
                      'windowsVirtualKeyCode': {'Tab': 9, 'Enter': 13, 'Escape': 27}[name]}
            if kind == 'keyDown' and name == 'Enter':
                params['text'] = '\r'
            client.call('Input.dispatchKeyEvent', params)

    def menu_in_bounds(selector, crosses_sidebar=False):
        return ev(f"""(() => {{
            const menu=document.querySelector({json.dumps(selector)});
            const rect=menu.getBoundingClientRect();
            const edge=elements.chatHistorySidebar.getBoundingClientRect().right;
            return !menu.closest('#chat-history-sidebar') && rect.width>0 && rect.left>=0 && rect.top>=0 &&
                rect.right<=innerWidth && rect.bottom<=innerHeight &&
                ({str(not crosses_sidebar).lower()} || rect.left<edge && rect.right>edge) &&
                elements.chatSidebarScroll.scrollWidth===elements.chatSidebarScroll.clientWidth &&
                document.documentElement.scrollWidth===innerWidth &&
                [...menu.querySelectorAll('[hidden]')].every(button=>!button.getClientRects().length) &&
                [...menu.querySelectorAll('[role=menuitem]:not([hidden])')].every(button=>{{
                    const r=button.getBoundingClientRect();
                    return !button.disabled && button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
                }});
        }})()""")

    def capture(name):
        if screenshots:
            screenshots.mkdir(parents=True, exist_ok=True)
            ev("""(async()=>{
                await document.fonts.ready;
                await Promise.all(document.getAnimations().filter(animation=>
                    animation.effect?.getTiming().iterations!==Infinity &&
                    animation.effect?.target?.closest('#project-workspace, #chat-history-sidebar'))
                    .map(animation=>animation.finished.catch(()=>{})));
            })()""")
            shot = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
            (screenshots / f'{name}.png').write_bytes(base64.b64decode(shot['data']))

    def folder(project, action='open'):
        return f'#project-sidebar-list [data-project-id="{project}"] [data-project-focus="{action}"]'

    def open_sidebar(touch=False):
        if not ev('chatSidebarUiState.isOpen'):
            click('#goto-history-btn', touch)
        wait('chatSidebarUiState.isOpen && chatSidebarUiState.hasLoadedAll', 'sidebar loaded')
        if touch:
            wait("elements.chatHistorySidebar.getBoundingClientRect().left>=-0.5", 'sidebar slide finished')

    def open_project(project, title, touch=False):
        open_sidebar(touch)
        click(folder(project), touch)
        wait(f"!elements.projectWorkspace.hidden && document.querySelector('#project-title').textContent==={json.dumps(title)}",
             'project open')

    def accept():
        wait("document.querySelector('#confirmDialog').open", 'confirmation open')
        click('#confirmDialog .dialog-ok-btn')
        wait("!document.querySelector('#confirmDialog').open", 'confirmation closed')

    def create(name, description=''):
        click('#project-create')
        change('#project-dialog-fields input', name)
        change('#project-dialog-fields textarea', description)
        click('#project-dialog-submit')
        wait(f"document.querySelector('#project-title').textContent==={json.dumps(name)}", 'created project open')
        return ev('history.state.projectId')

    def move(chat_id, project_id, scope='#chat-sidebar-list'):
        click(f'{scope} [data-chat-id="{chat_id}"] [data-sidebar-action="menu"]')
        click('#history-item-menu [data-history-menu-action="project"]')
        wait("document.querySelector('#project-dialog-fields select:not(:disabled)')", 'move picker loaded')
        change('#project-dialog-fields select', project_id or '', 'change')
        click('#project-dialog-submit')
        wait("!document.querySelector('#project-dialog').open", 'move committed')

    viewport(1280, False)
    client.call('Page.navigate', {'url': url + '?projectUiFixture=1'})
    ready = 'window.appLogic?._setupEventListenersCallCount && state.activeProfile && !state.executionInitializingV136'
    wait(ready, 'app initialized')
    wait("navigator.serviceWorker.controller?.state === 'activated'", 'local Service Worker serves project UI')
    ev("appLogic.updateLocalUiSetting('lastSeenReleaseVersion',APP_VERSION)")
    first_load = ev('performance.timeOrigin')
    client.call('Page.reload')
    wait(f"performance.timeOrigin>{first_load} && {ready} && !document.querySelector('dialog[open]')", 'controlled startup')
    ev("appLogic.updateLocalUiSetting('enableWideMode',true)")
    open_sidebar()
    ev("""window.originalProjectControls = ['#chat-workspace > .app-header', '#user-input', '#send-button',
        '#chat-model-button', '#attach-file-btn', '#file-input'].map(selector=>document.querySelector(selector))""")
    assert ev("document.querySelectorAll('.project-folder').length===0")
    click('#project-create')
    change('#project-dialog-fields input', '  ')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-dialog-notice').textContent.includes('プロジェクト名')", 'blank name rejected')
    click('#project-dialog-cancel')
    alpha = create('第一プロジェクト', '最初の説明')
    assert ev("""originalProjectControls.every((element,index)=>element===document.querySelector(
        ['#project-workspace > .app-header','#user-input','#send-button','#chat-model-button','#attach-file-btn','#file-input'][index])) &&
        document.querySelectorAll('#user-input').length===1 && document.querySelectorAll('#send-button').length===1""")
    assert ev("document.querySelector('#project-chats').textContent.includes('チャットはありません') && "
              "document.querySelector('#project-documents').textContent.includes('共有ファイルはありません')")
    assert ev("document.querySelector('#project-description').textContent==='最初の説明'")
    capture('pc-empty')
    click('#project-options')
    click('#project-menu [data-project-action="edit"]')
    wait("document.querySelector('#project-dialog').open", 'project edit')
    change('#project-dialog-fields input', '第一・編集済み')
    change('#project-dialog-fields textarea', '更新した説明')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-title').textContent==='第一・編集済み' && "
         "document.querySelector('#project-description').textContent==='更新した説明'", 'editing updates visible view')
    beta = create('第二プロジェクト')
    assert ev("document.querySelectorAll('.project-folder').length===2")
    click('#project-back')
    wait('elements.projectWorkspace.hidden', 'back from second project returns to chat')
    ev('history.forward()')
    wait("history.state?.projectId && document.querySelector('#project-title').textContent==='第二プロジェクト'", 'forward reopens project')
    click('#project-back')
    wait('elements.projectWorkspace.hidden', 'return to chat again')
    checks.append('empty list, form validation, creation, editing, back and forward')

    member, loose, old = ev(f"""(async()=>{{
        const member=await dbUtils.saveChat(null,{{title:'共通語 所属チャット',messages:[{{role:'user',content:'検証文'}}],
            isPinned:true,pinnedAt:Date.now(),pinStateUpdatedAt:Date.now(),updatedAt:Date.now()}},{{skipPush:true}});
        const loose=await dbUtils.saveChat(null,{{title:'共通語 未所属チャット',messages:[]}},{{skipPush:true}});
        const old=await dbUtils.saveChat(null,{{title:'古いチャット · 混在 AB12 '+ '長いタイトル'.repeat(16),
            messages:[],createdAt:1}},{{skipPush:true}});
        await DocumentLibrary.transaction(state.db,['chats'],'readwrite',async tx=>{{
            const store=tx.objectStore('chats');
            const chat=await DocumentLibrary.request(store.get(old));
            store.put({{...chat,updatedAt:1}});
        }});
        await dbUtils.setChatProject(member,{json.dumps(alpha)});
        return [member,loose,old];
    }})()""")
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{loose}"]')""", 'recent lists unassigned chat')
    assert ev(f"""(() => {{
        const ids=[...document.querySelector('#chat-sidebar-scroll').children].map(node=>node.id);
        return ids.indexOf('chat-sidebar-pinned')<ids.indexOf('project-sidebar') &&
            ids.indexOf('project-sidebar')<ids.indexOf('chat-sidebar-recent') &&
            !document.querySelector('#project-all-history, #chat-sidebar-list .chat-sidebar-group-title') &&
            Boolean(document.querySelector('#chat-sidebar-list [data-chat-id="{old}"]'));
    }})()""")
    capture('pc-chat-sidebar')
    assert ev(f"""!document.querySelector('#chat-sidebar-list [data-chat-id="{member}"]')""")
    click(folder(alpha, 'expand'))
    wait(f"""document.querySelector('#project-sidebar-list [data-chat-id="{member}"] .chat-pin-icon')""", 'expanded folder shows pinned chat')
    assert ev(f"""(() => {{
        const title=document.querySelector({json.dumps(folder(alpha,'expand'))}+' .chat-sidebar-item-title');
        const child=document.querySelector('#project-sidebar-list [data-chat-id="{member}"] .chat-sidebar-item-title');
        const row=title.closest('.chat-sidebar-item');
        const loose=document.querySelector('#chat-sidebar-list [data-chat-id="{loose}"]');
        return Math.abs(title.getBoundingClientRect().left-child.getBoundingClientRect().left)<1 &&
            Math.abs(row.getBoundingClientRect().width-loose.getBoundingClientRect().width)<1 &&
            getComputedStyle(row).backgroundColor==='rgba(0, 0, 0, 0)' && elements.projectWorkspace.hidden;
    }})()""")
    capture('pc-expanded')
    capture('sidebar-pc-expanded')
    viewport(1200, True)
    wait("innerWidth===1200 && chatSidebarUiState.mode==='permanent'", 'tablet wide sidebar')
    capture('sidebar-tablet-wide')
    viewport(1280, False)
    wait("innerWidth===1280", 'desktop sidebar restored')
    groups = {
        'pinned': '#chat-sidebar-pinned-title button',
        'projects': '#project-sidebar-title button',
        'recent': '#chat-sidebar-recent-title button',
    }
    for name, toggle in groups.items():
        mouse_click(toggle)
        wait(f"""[...document.querySelectorAll('.chat-sidebar-group-title')].every(button=>{{
            const content=document.getElementById(button.getAttribute('aria-controls'));
            const collapsed=button.matches({json.dumps(toggle)});
            if (collapsed) content.querySelector('button')?.focus();
            return button.getAttribute('aria-expanded')===String(!collapsed) && content.hidden===collapsed &&
                (getComputedStyle(button.lastElementChild).transform==='none')===collapsed &&
                (!collapsed || !content.getClientRects().length && !content.contains(document.activeElement));
        }})""", name + ' section toggles independently')
        capture('sidebar-pc-' + name + '-collapsed')
        if name == 'projects':
            mouse_click('#project-create')
            wait("document.querySelector('#project-dialog').open", 'add button opens dialog even while section is collapsed')
            click('#project-dialog-cancel')
            assert ev(f"document.querySelector({json.dumps(toggle)}).getAttribute('aria-expanded')==='false'")
        mouse_click(toggle)
        assert ev(f"document.querySelector({json.dumps(folder(alpha, 'expand'))}).getAttribute('aria-expanded')==='true'")
    hover('.chat-sidebar-brand')
    ev('document.activeElement.blur()')
    wait("getComputedStyle(document.querySelector('#project-create')).opacity==='0'", 'project add is hidden at rest')
    assert ev(f"""[...document.querySelector({json.dumps(folder(alpha, 'expand'))}).parentElement.querySelectorAll('.chat-sidebar-item-menu')]
        .every(button=>getComputedStyle(button).pointerEvents==='none')""")
    hover('#project-sidebar-title button')
    wait("getComputedStyle(document.querySelector('#project-create')).opacity==='1'", 'section hover shows add')
    capture('sidebar-pc-heading-hover')
    hover('.chat-sidebar-brand')
    ev("document.querySelector('#project-sidebar-title button').focus()")
    key('Tab')
    wait("document.activeElement.id==='project-create' && getComputedStyle(document.activeElement).opacity==='1'",
         'Tab reaches and reveals add')
    ev(f"document.querySelector({json.dumps(folder(alpha, 'expand'))}).focus()")
    for action in ['open', 'menu']:
        key('Tab')
        wait(f"""document.activeElement.matches({json.dumps(folder(alpha, action))}) &&
            getComputedStyle(document.activeElement).opacity==='1'""", 'Tab reaches project ' + action)
    ev('document.activeElement.blur()')
    assert ev(f"""(() => {{
        const folder = document.querySelector({json.dumps(folder(alpha, 'expand'))});
        const pinned = document.querySelector('#chat-sidebar-pinned-list [data-chat-id="{member}"] .chat-sidebar-item-open');
        const measure = button => {{
            const [icon, title] = button.querySelector('.chat-sidebar-title-line').children;
            const i = icon.getBoundingClientRect(), t = title.getBoundingClientRect();
            return [i.left, t.left - i.right, getComputedStyle(title).fontSize, i.y + i.height / 2 - t.y - t.height / 2];
        }};
        const a = measure(folder), b = measure(pinned);
        return a.slice(0, 3).every((value,index)=>value===b[index]) && Math.abs(a[3])<1 && Math.abs(b[3])<1 &&
            new Set([...document.querySelectorAll('.chat-sidebar-group-title')].map(button=>{{
                const style=getComputedStyle(button);
                return [style.fontSize,style.fontWeight,style.color,style.padding,style.minHeight].join();
            }})).size===1 &&
            parseFloat(getComputedStyle(document.querySelector('#project-create span')).fontSize) <
            parseFloat(getComputedStyle(document.querySelector('#chat-sidebar-history-menu-btn span')).fontSize) &&
            parseFloat(getComputedStyle(folder.parentElement.querySelector('.project-folder-compose span')).fontSize) <
            parseFloat(getComputedStyle(folder.parentElement.querySelector('.project-folder-options span')).fontSize);
    }})()""")
    mouse_click(groups['recent'])
    click('#chat-sidebar-search-toggle')
    change('#chat-sidebar-search-input', 'AB12')
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{old}"]').getClientRects().length""",
         'search overrides a collapsed recent section')
    assert ev("""(() => {
        const title=document.querySelector('#chat-sidebar-list .chat-sidebar-item-title');
        return title.scrollWidth>title.clientWidth && getComputedStyle(title).textOverflow==='ellipsis';
    })()""")
    click('#chat-sidebar-search-toggle')
    wait("document.querySelector('#chat-sidebar-recent-content').hidden", 'clearing search restores collapsed section')
    first_load = ev('performance.timeOrigin')
    client.call('Page.reload')
    wait(f"""performance.timeOrigin>{first_load} && {ready} && chatSidebarUiState.hasLoadedAll &&
        document.querySelector('#chat-sidebar-recent-content').hidden &&
        document.querySelector({json.dumps(folder(alpha, 'expand'))})?.getAttribute('aria-expanded')==='true'""",
        'reload preserves section and folder states')
    mouse_click(groups['recent'])
    checks.append('independent sections, keyboard and hover controls, icon alignment, collapsed search and reload')
    hover(folder(alpha, 'expand'))
    wait(f"""[...document.querySelector({json.dumps(folder(alpha, 'expand'))}).parentElement.querySelectorAll('.chat-sidebar-item-menu')]
         .every(button=>Number(getComputedStyle(button).opacity)>.99)""", 'mouse hover reveals compose and management')
    capture('pc-folder-hover')
    capture('sidebar-pc-folder-hover')
    def project_actions(project, visible):
        toggle = json.dumps(folder(project, 'expand'))
        return f"""[...document.querySelector({toggle}).parentElement.querySelectorAll('.chat-sidebar-item-menu')]
            .every(button=>getComputedStyle(button).opacity==='{int(visible)}' &&
                getComputedStyle(button).pointerEvents==='{ 'auto' if visible else 'none' }')"""

    # Native mouse input retains focus on the replacement button after the folder redraw.
    for expanded in ['false', 'true', 'false']:
        toggle = json.dumps(folder(alpha, 'expand'))
        mouse_click(folder(alpha, 'expand'))
        wait(f"document.querySelector({toggle}).getAttribute('aria-expanded')==='{expanded}'", 'mouse toggles folder')
        hover('.chat-sidebar-brand')
        try:
            wait(project_actions(alpha, False), 'moving away hides actions without a click')
        except AssertionError as error:
            raise AssertionError(ev(f"""(() => {{
                const button=document.querySelector({toggle}), row=button.parentElement;
                return {{expanded:button.getAttribute('aria-expanded'), hovered:row.matches(':hover'),
                    focusWithin:row.matches(':focus-within'), focusVisible:button.matches(':focus-visible'),
                    actions:[...row.querySelectorAll('.chat-sidebar-item-menu')].map(action=>getComputedStyle(action).opacity)}};
            }})()""")) from error
        capture('sidebar-pc-after-expand' if expanded == 'true' else 'sidebar-pc-after-collapse')
        hover(folder(beta, 'expand'))
        wait(f"({project_actions(alpha, False)}) && ({project_actions(beta, True)})", 'only the newly hovered row shows actions')

    previous_menu = json.dumps(folder(alpha, 'menu'))
    ev(f"document.querySelector({previous_menu}).focus()")
    key('Tab')
    wait(f"document.activeElement.matches({json.dumps(folder(beta, 'expand'))})", 'Tab reaches the next folder')
    ev(f"document.querySelector({toggle}).focus()")
    wait(f"document.querySelector({toggle}).matches(':focus-visible')", 'keyboard focus is visible before activation')
    key('Enter')
    wait(f"document.activeElement===document.querySelector({toggle}) && document.activeElement.matches(':focus-visible') && "
         f"document.activeElement.getAttribute('aria-expanded')==='true' && ({project_actions(alpha, True)})",
         'keyboard activation retains visible focus after redraw')
    key('Tab')
    wait(f"document.activeElement.matches({json.dumps(folder(alpha))})", 'Tab reaches the project home button after redraw')
    mouse_click(folder(alpha, 'expand'))
    wait(f"document.querySelector({toggle}).getAttribute('aria-expanded')==='false'", 'folder restored for later scenarios')
    checks.append('mouse hover resets after folder redraw and keyboard focus is retained')
    wait(f"""document.querySelector('#chat-sidebar-pinned-list [data-chat-id="{member}"] .chat-sidebar-item-snippet')?.textContent==='第一・編集済み'""",
         'project member is also in pinned shortcuts')
    click('#chat-sidebar-search-toggle')
    change('#chat-sidebar-search-input', '共通語')
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{member}"]') &&
         document.querySelectorAll('#chat-sidebar-list .chat-sidebar-item').length===2""", 'search includes both chats')
    assert ev(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{member}"] .chat-sidebar-item-snippet').textContent==='第一・編集済み'""")
    click('#chat-sidebar-search-toggle')
    wait(f"""!document.querySelector('#chat-sidebar-list [data-chat-id="{member}"]') && !document.querySelector('#project-sidebar').hidden""",
         'clear search returns to recent')
    short_viewport = ev("""document.querySelector('#chat-sidebar-recent').getBoundingClientRect().bottom - 12""")
    short_height = round(short_viewport)
    viewport(1280, False, short_height)
    wait(f"innerHeight==={short_height} && elements.chatSidebarScroll.scrollHeight>elements.chatSidebarScroll.clientHeight",
         'sidebar can scroll while a menu is open')
    for anchor, menu in [
        (f'#chat-sidebar-pinned-list [data-chat-id="{member}"] [data-sidebar-action="menu"]', '#history-item-menu'),
        (f'#chat-sidebar-list [data-chat-id="{loose}"] [data-sidebar-action="menu"]', '#history-item-menu'),
        (folder(alpha, 'menu'), '#project-menu'),
    ]:
        sidebar_width = ev('elements.chatHistorySidebar.getBoundingClientRect().width')
        mouse_click(anchor)
        wait(f"document.querySelector({json.dumps(menu)}).getClientRects().length", 'sidebar menu opens')
        assert ev(f'elements.chatHistorySidebar.getBoundingClientRect().width==={sidebar_width}')
        assert menu_in_bounds(menu, crosses_sidebar=True), ev(f"""(() => {{
            const menu=document.querySelector({json.dumps(menu)});
            return {{viewport:[innerWidth,innerHeight], sidebar:elements.chatHistorySidebar.getBoundingClientRect().toJSON(),
                anchor:document.querySelector({json.dumps(anchor)}).getBoundingClientRect().toJSON(),
                menu:menu.getBoundingClientRect().toJSON(),
                items:[...menu.querySelectorAll('[role=menuitem]:not([hidden])')].map(button=>{{
                    const r=button.getBoundingClientRect();
                    return [button.textContent,r.y,r.height,document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,120)];
                }})}};
        }})()""")
        hover(f'{menu} [role="menuitem"]:not([hidden])')
        assert menu_in_bounds(menu, crosses_sidebar=True), 'pointer crossing the sidebar edge keeps the menu open'
        assert ev("""(() => {
            const scroller=elements.chatSidebarScroll, before=scroller.scrollTop;
            scroller.scrollTop += before>8 ? -8 : 8;
            return scroller.scrollTop!==before;
        })()""")
        wait(f"""(() => {{
            const popup=document.querySelector({json.dumps(menu)}).getBoundingClientRect();
            const button=document.querySelector({json.dumps(anchor)}).getBoundingClientRect();
            return Math.abs(popup.top-Math.max(8,Math.min(button.top,innerHeight-8-popup.height)))<1;
        }})()""", 'menu follows sidebar scroll within viewport bounds')
        assert menu_in_bounds(menu, crosses_sidebar=True)
        viewport(1220, False, short_height + 16)
        wait(f"innerWidth===1220 && innerHeight==={short_height + 16}", 'desktop resized while menu remains open')
        assert menu_in_bounds(menu, crosses_sidebar=True)
        if menu == '#project-menu':
            capture('sidebar-pc-menu')
            mouse_click('#project-menu [data-project-action="edit"]')
            wait("document.querySelector('#project-dialog').open", 'menu action outside sidebar opens editor')
            click('#project-dialog-cancel')
            assert ev(f"document.querySelector({json.dumps(folder(alpha, 'expand'))}).getAttribute('aria-expanded')==='false'")
        else:
            if 'pinned' in anchor:
                capture('sidebar-pc-chat-menu')
            key('Escape')
            wait("elements.historyItemMenu.classList.contains('hidden')", 'Escape hides history menu')
        assert ev(f"!document.querySelector({json.dumps(menu)}).getClientRects().length && "
                  f"elements.chatHistorySidebar.getBoundingClientRect().width==={sidebar_width}")
        viewport(1280, False, short_height)
    viewport(390, True)
    wait("chatSidebarUiState.mode==='overlay' && !chatSidebarUiState.isOpen", 'phone sidebar ready')
    open_sidebar(True)
    click(folder(alpha, 'expand'), True)
    capture('sidebar-mobile')
    click(folder(alpha, 'menu'), True)
    wait("!document.querySelector('#project-menu').hidden", 'phone project menu opens')
    assert menu_in_bounds('#project-menu')
    capture('sidebar-mobile-menu')
    key('Escape')
    assert ev("chatSidebarUiState.isOpen && document.querySelector('#project-menu').hidden")
    click(folder(alpha, 'expand'), True)
    viewport(490, True, 480)
    wait('innerWidth===490 && innerHeight===480', 'narrow viewport with limited space to the right and below')
    click(f'#chat-sidebar-list [data-chat-id="{loose}"] [data-sidebar-action="menu"]', True)
    wait("!elements.historyItemMenu.classList.contains('hidden')", 'touch opens chat menu near the viewport bottom')
    assert menu_in_bounds('#history-item-menu')
    assert ev(f"""(() => {{
        const anchor=document.querySelector('#chat-sidebar-list [data-chat-id="{loose}"] [data-sidebar-action="menu"]').getBoundingClientRect();
        const menu=elements.historyItemMenu.getBoundingClientRect();
        return anchor.right+4+menu.width>innerWidth-8 && anchor.bottom+4+menu.height>innerHeight-8 &&
            menu.bottom<=anchor.top && menu.right<=innerWidth-8;
    }})()""")
    key('Escape')
    wait("elements.historyItemMenu.classList.contains('hidden')", 'close narrow viewport menu')
    viewport(1280, False)
    open_sidebar()
    ev('elements.chatSidebarScroll.scrollTop=0')
    mouse_click(f'#chat-sidebar-list [data-chat-id="{loose}"] [data-sidebar-action="open"]')
    wait(f'state.currentChatId==={loose}', 'normal chat selected')
    for scope, pinned in [('#chat-sidebar-list', 'true'), ('#chat-sidebar-pinned-list', 'false')]:
        mouse_click(f'{scope} [data-chat-id="{loose}"] [data-sidebar-action="menu"]')
        wait("!elements.historyItemMenu.classList.contains('hidden')", 'pin action menu opens')
        mouse_click('#history-item-menu [data-history-menu-action="pin"]')
        wait(f"dbUtils.getChat({loose}).then(chat=>chat.isPinned==={pinned})", 'pin action via menu outside sidebar')
        wait(f"""document.querySelector('#chat-sidebar-{"pinned-list" if pinned == "true" else "list"} [data-chat-id="{loose}"]')""",
             'pin and unpin rerender the expected section')
    delete_chat = ev("dbUtils.saveChat(null,{title:'メニューから削除するチャット',messages:[]},{skipPush:true})")
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{delete_chat}"]')""", 'delete fixture rendered')
    mouse_click(f'#chat-sidebar-list [data-chat-id="{delete_chat}"] [data-sidebar-action="menu"]')
    wait("!elements.historyItemMenu.classList.contains('hidden')", 'delete action menu opens')
    mouse_click('#history-item-menu [data-history-menu-action="delete"]')
    accept()
    wait(f'dbUtils.getChat({delete_chat}).then(chat=>!chat)', 'chat deleted through existing menu')
    checks.append('sidebar menus escape clipping, follow scroll and resize, and preserve chat actions')
    click(folder(alpha, 'expand'))
    click(f'#project-sidebar-list [data-chat-id="{member}"] [data-sidebar-action="open"]')
    wait(f"""state.currentChatId==={member} && document.querySelector('#project-sidebar-list .chat-sidebar-item[aria-current="page"]')""",
         'selected chat is marked in folder')
    open_project(alpha, '第一・編集済み')
    move(member, beta, '#project-chats')
    wait(f"""!document.querySelector('#project-chats [data-chat-id="{member}"]')""", 'moved chat removed from old project')
    assert ev(f"dbUtils.getChat({member}).then(chat=>chat.isPinned && chat.messages[0].content==='検証文')")
    open_project(beta, '第二プロジェクト')
    wait(f"""document.querySelector('#project-chats [data-chat-id="{member}"]')""", 'moved chat appears in destination')
    click(f'#project-chats [data-chat-id="{member}"] [data-sidebar-action="menu"]')
    click('#history-item-menu [data-history-menu-action="project"]')
    wait("document.querySelector('#project-dialog-fields select:not(:disabled)')", 'move picker captures current membership')
    assert ev(f"document.querySelector('#project-dialog-fields select').value==={json.dumps(beta)}")
    ev(f'dbUtils.setChatProject({member},{json.dumps(alpha)})')
    change('#project-dialog-fields select', '', 'change')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-dialog-notice').textContent.includes('チャットの所属が変更されました')",
         'stale move cannot overwrite newer membership')
    assert ev(f"dbUtils.getChatProject({member}).then(project=>project.id==={json.dumps(alpha)})")
    click('#project-dialog-cancel')
    ev(f'dbUtils.setChatProject({member},{json.dumps(beta)})')
    wait(f"""document.querySelector('#project-chats [data-chat-id="{member}"]')""", 'chat returned to destination')
    move(member, None, '#project-chats')
    wait(f"""document.querySelector('#chat-sidebar-pinned-list [data-chat-id="{member}"] .chat-pin-icon')""", 'detached chat returns to recent')
    click('#project-add-chat')
    wait("document.querySelector('#project-dialog-fields input[type=checkbox]')", 'existing chat chooser loaded')
    capture('pc-chat-picker')
    change('#project-dialog-fields input[type=search]', 'AB12')
    ev("document.querySelector('.project-picker-list label').click()")
    change('#project-dialog-fields input[type=search]', '共通語')
    ev("""[...document.querySelectorAll('.project-picker-list label')].find(label=>label.textContent==='共通語 所属チャット').click()""")
    wait("document.querySelector('#project-dialog-fields [role=status]').textContent.includes('2件')", 'selection survives filtering')
    change('#project-dialog-fields input[type=search]', 'AB12')
    assert ev("document.querySelector('.project-picker-list input').checked")
    ev("document.querySelector('.project-picker-list label').click()")
    wait("document.querySelector('#project-dialog-fields [role=status]').textContent.includes('1件')", 'unselect updates count')
    ev("document.querySelector('.project-picker-list label').click()")
    click('#project-dialog-submit')
    wait(f"""document.querySelector('#project-chats [data-chat-id="{member}"]') &&
        document.querySelector('#project-chats [data-chat-id="{old}"]')""", 'add both selected chats from chooser')
    assert ev(f"""dbUtils.getChatProject({old}).then(project=>project.id==={json.dumps(beta)})""")
    ev(f'dbUtils.setChatProject({old},null)')
    checks.append('pinned shortcuts, folders, old unassigned chats, global search and multi-select chat assignment')

    doc = ev("""dbUtils.addLibraryDocument(new File(['共有ファイル本文'], '共有資料.md')).then(entry=>entry.id)""")
    extra_doc = ev("""dbUtils.addLibraryDocument(new File(['second'], '日本語とEnglish AB12 ' + '長いファイル名'.repeat(12) + '.txt')).then(entry=>entry.id)""")
    ev(f'dbUtils.setChatDocuments({member},[{json.dumps(doc)}])')
    click('#project-file-add')
    click('#project-add-document')
    wait("document.querySelector('#project-dialog-fields input[type=checkbox]')", 'library chooser loaded')
    capture('pc-file-picker')
    change('#project-dialog-fields input[type=search]', 'AB12')
    click('.project-picker-list label')
    change('#project-dialog-fields input[type=search]', '共有資料')
    click('.project-picker-list label')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-documents').textContent.includes('共有資料.md')", 'existing original shared')
    assert ev(f'dbUtils.listProjectDocuments({json.dumps(beta)}).then(items=>items.some(item=>item.id==={json.dumps(extra_doc)}))')
    ev('window.projectFixtureDark=state.settings.darkMode; state.settings.darkMode=true; uiUtilsV136.applyDarkMode()')
    capture('pc-chats-and-files')
    ev('state.settings.darkMode=window.projectFixtureDark; uiUtilsV136.applyDarkMode()')
    click(f'#project-documents [data-document-id="{doc}"] .document-library-file')
    wait("document.querySelector('#document-library-extracts').textContent.includes('共有ファイル本文')", 'shared document previews')
    ev('history.back()')
    wait("!elements.projectWorkspace.hidden && elements.documentLibraryWorkspace.hidden && "
         "document.querySelector('#project-documents').textContent.includes('共有資料.md')", 'preview returns to project')
    ev('history.forward()')
    wait("!elements.documentLibraryWorkspace.hidden && elements.projectWorkspace.hidden", 'forward restores preview')
    ev('history.back()')
    wait("!elements.projectWorkspace.hidden && document.querySelector('#project-chats [data-sidebar-action=open]')", 'project restored')
    click(f'#project-chats [data-chat-id="{member}"] [data-sidebar-action="open"]')
    wait(f'state.currentChatId==={member} && elements.projectWorkspace.hidden', 'chat returns')
    click('#document-library-picker-open')
    wait("!document.querySelector('#document-library-picker-project').hidden && "
         "document.querySelector('#document-library-picker-list').textContent.includes('共有資料.md')", 'shared and chat files are both shown')
    assert ev("document.querySelector('#document-library-picker-heading').textContent==='チャット固有ファイル' && "
              "document.querySelector('#document-library-picker-project-list').textContent.includes('共有資料.md')")
    click('#document-library-picker-project-open')
    wait("document.querySelector('#project-documents .document-library-row')", 'manage shared documents')
    click(f'#project-documents [data-document-id="{doc}"] .document-library-more')
    click('#project-menu [data-project-action=unlink-file]')
    wait("!document.querySelector('#project-documents').textContent.includes('共有資料.md')", 'share removed')
    assert ev(f"dbUtils.getChatDocuments({member}).then(items=>items[0].id==={json.dumps(doc)})")
    ev("""(() => {
        const input = document.querySelector('#project-files');
        input.click=()=>{};
        document.querySelector('#project-file-add').click();
        document.querySelector('#project-upload-document').click();
        const files = new DataTransfer();
        files.items.add(new File(['upload text'],'新規アップロード.txt'));
        input.files = files.files;
        input.dispatchEvent(new Event('change'));
    })()""")
    wait("document.querySelector('#project-documents').textContent.includes('新規アップロード.txt')", 'upload registered and shared')
    ev("""(() => {
        const add = dbUtils.addProjectDocument;
        dbUtils.addProjectDocument = async () => { dbUtils.addProjectDocument = add; throw new Error('関連付け失敗'); };
        const input = document.querySelector('#project-files');
        document.querySelector('#project-file-add').click();
        document.querySelector('#project-upload-document').click();
        const files = new DataTransfer();
        files.items.add(new File(['original survives'],'登録済み.txt'));
        input.files = files.files;
        input.dispatchEvent(new Event('change'));
    })()""")
    wait("document.querySelector('#project-notice').textContent.includes('ライブラリに登録しました')", 'partial upload result displayed')
    assert ev("dbUtils.listLibraryDocuments().then(entries=>entries.some(entry=>entry.fileName==='登録済み.txt'))")
    checks.append('library chooser, preview and history, separate file scopes, unlink, upload and partial failure')

    click('#project-options')
    click('#project-menu [data-project-action="edit"]')
    wait("document.querySelector('#project-dialog').open", 'edit for failure test')
    ev("""(() => {
        const update = dbUtils.updateProject;
        dbUtils.updateProject = async () => { dbUtils.updateProject = update; throw new Error('保存のテスト失敗'); };
    })()""")
    change('#project-dialog-fields input', '保存されない名前')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-dialog-notice').textContent.includes('保存のテスト失敗')", 'save failure visible')
    assert ev("document.querySelector('#project-title').textContent==='第二プロジェクト'")
    click('#project-dialog-cancel')

    open_project(alpha, '第一・編集済み')
    count = ev('dbUtils.getAllChats().then(chats=>chats.length)')
    assert ev(f'dbUtils.getAllChats().then(chats=>chats.length==={count})')
    change('#user-input', '第一の未送信下書き')
    open_project(beta, '第二プロジェクト')
    assert ev("!document.querySelector('#user-input').value")
    change('#user-input', '第二の下書き')
    open_project(alpha, '第一・編集済み')
    wait("document.querySelector('#user-input').value==='第一の未送信下書き'", 'project drafts are isolated')
    click('#project-back')
    wait('elements.projectWorkspace.hidden', 'back to original conversation')
    change('#user-input', '会話の入力を保持')
    original_id = ev('state.currentChatId')
    ev("""(async()=>{
        await dbUtils.saveSetting('apiConfigs',[{id:'project-ui-gem',provider:'gemini',apiKey:'mock',enabled:true,
            modelCandidates:['gemini-3-flash-preview','gemini-2.5-flash'],defaultModel:'gemini-3-flash-preview'}]);
        await appLogic.loadGlobalSettings();
        await appLogic.setCurrentChatModelRef({apiConfigId:'project-ui-gem',modelName:'gemini-2.5-flash'});
        await appLogic.saveGlobalSettingsV136({enableChatTitleGeneration:false,enableStreamingOutput:false});
        Object.assign(state.settings,{enableMemory:false,enableAutoRetry:false,enableApiTimeout:false,
            enableProofreading:false,enableThoughtTranslation:false,geminiEnableFunctionCalling:false});
        await appLogic.handleFileSelection([new File(['keep'], 'keep.txt', {type:'text/plain'})]);
    })()""")
    open_project(alpha, '第一・編集済み')
    click('#chat-model-button')
    wait("document.querySelector('#execution-popover .model-picker-choice')", 'reuse model picker')
    ev("[...document.querySelectorAll('.model-picker-choice')].find(button=>button.textContent==='gemini-3-flash-preview').click()")
    wait("state.currentExecutionSettings.modelRef.modelName==='gemini-3-flash-preview'", 'project model selected')

    ev("""(() => {
        const input=document.querySelector('#file-input');
        input.click=()=>{};
        document.querySelector('#attach-file-btn').click();
        const data=new DataTransfer();
        data.items.add(new File([new Uint8Array([37,80,68,70])],'送信ファイル.pdf',{type:'application/pdf'}));
        input.files=data.files;
        input.dispatchEvent(new Event('change'));
    })()""")
    wait("document.querySelector('#composer-attachment-list').textContent.includes('送信ファイル.pdf')", 'project attachment added')
    other_profile = ev("""dbUtils.addProfile({name:'ホーム下書き検証', settings:state.activeProfile.settings})""")
    original_profile = ev('state.activeProfileId')
    assert ev(f'appLogic.switchProfile({other_profile})')
    wait("document.querySelector('#user-input').value==='' && !state.pendingAttachments.length", 'other profile has an independent draft')
    change('#user-input', '別プロファイルの下書き')
    assert ev(f'appLogic.switchProfile({original_profile})')
    wait("document.querySelector('#user-input').value==='第一の未送信下書き' && "
         "state.pendingAttachments[0]?.name==='送信ファイル.pdf' && state.currentExecutionSettings.modelRef?.modelName==='gemini-3-flash-preview'",
         'returning to first profile restores draft, model and attachment')
    ev("""(() => {
        const original = window.fetch;
        window.fetch = (url, options) => {
            if (!String(url).includes('generativelanguage.googleapis.com') || !options?.body) return original(url, options);
            window.firstWireMembership=dbUtils.getChatProject(state.currentChatId);
            window.projectRequest={url:String(url),body:JSON.parse(options.body)};
            return new Promise(resolve=>window.finishProjectSend=()=>resolve(Response.json({
                candidates:[{content:{role:'model',parts:[{text:'検証用回答'}]},finishReason:'STOP'}]
            })));
        };
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function(...args) {
            if (this.name==='project_chats') {
                IDBObjectStore.prototype.add=add;
                throw new DOMException('所属保存のテスト失敗','QuotaExceededError');
            }
            return add.apply(this,args);
        };
    })()""")
    click('#send-button')
    wait("document.querySelector('#alertDialog').open && document.querySelector('#alertDialog').textContent.includes('所属保存のテスト失敗')",
         'existing alert shows initial save failure')
    click('#alertDialog .dialog-ok-btn')
    wait("!document.querySelector('#send-button').disabled && !state.isSending", 'send becomes available after failure')
    assert ev(f"""(async()=>state.currentChatId===null && !window.firstWireMembership &&
        (await dbUtils.getAllChats()).length==={count} && document.querySelector('#user-input').value==='第一の未送信下書き' &&
        state.pendingAttachments[0].name==='送信ファイル.pdf')()""")
    ev("""document.querySelector('#user-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))""")
    wait('window.finishProjectSend && state.isSending && elements.projectWorkspace.hidden', 'first network request begins from chat')
    project_chat = ev('state.currentChatId')
    assert ev(f'window.firstWireMembership.then(project=>project.id==={json.dumps(alpha)})')
    assert ev("projectRequest.url.includes('gemini-3-flash-preview:generateContent') && "
              "JSON.stringify(projectRequest.body).includes('application/pdf')")
    ev('history.back()')
    wait("!elements.projectWorkspace.hidden && state.currentChatId===null", 'back restores project draft during generation')
    assert ev(f"Boolean(appLogic.getSendJobV136({project_chat}))")
    click('#project-back')
    wait(f"elements.projectWorkspace.hidden && state.currentChatId==={original_id}", 'project back restores origin during generation')
    assert ev("document.querySelector('#user-input').value==='会話の入力を保持' && "
              "state.pendingAttachments[0].name==='keep.txt' && state.currentExecutionSettings.modelRef.modelName==='gemini-2.5-flash'")
    assert ev(f"Boolean(appLogic.getSendJobV136({project_chat}))")
    ev('window.finishProjectSend()')
    wait(f"!appLogic.getSendJobV136({project_chat})", 'send completes under project home')
    assert ev(f"dbUtils.getChat({project_chat}).then(chat=>chat.messages.at(-1).content==='検証用回答')")
    ev('history.forward()')
    wait("!elements.projectWorkspace.hidden", 'forward restores project home')
    ev('history.forward()')
    wait(f"elements.projectWorkspace.hidden && state.currentChatId==={project_chat}", 'forward restores generated chat')
    open_project(beta, '第二プロジェクト')
    assert ev("document.querySelector('#user-input').value==='第二の下書き'")
    checks.append('project and ordinary drafts, atomic initial send and failure, generation during navigation')

    if screenshots:
        ev(f"""(async()=>{{
            const id={json.dumps(beta)};
            for(let i=0;i<14;i++){{
                const chat=await dbUtils.saveChat(null,{{title:(i+1)+' · 章の構成と登場人物の会話について確認する長いチャットの題名',messages:[]}},{{skipPush:true}});
                await dbUtils.setChatProject(chat,id);
                const file=await dbUtils.addLibraryDocument(new File(['world '+i],(i+1)+' · 長いタイトルの世界観設定と登場人物のメモ.md'));
                await dbUtils.addProjectDocument(id,file.id);
            }}
        }})()""")
        wait("document.querySelectorAll('#project-documents .document-library-row').length>=14 && "
             "document.querySelectorAll('#project-chats [data-chat-id]').length>=14", 'many chats and files')
    viewport(1600, False)
    wait("innerWidth===1600 && getComputedStyle(document.querySelector('#project-tabs')).display==='none'", 'wide PC columns')
    assert ev("""(() => {
        const composer=document.querySelector('#project-composer-slot').getBoundingClientRect();
        const files=document.querySelector('#project-file-panel').getBoundingClientRect();
        const list=document.querySelector('#project-documents');
        return composer.width>files.width && files.width>=245 && composer.right<files.left &&
            list.scrollWidth<=list.clientWidth+1;
    })()""")
    capture('pc-many-chats-and-files')
    viewport(1200, True)
    wait("innerWidth===1200 && chatSidebarUiState.mode==='permanent' && "
         "getComputedStyle(document.querySelector('#project-tabs')).display==='none'", 'tablet wide uses available width')
    capture('tablet-wide')
    ev("appLogic.updateLocalUiSetting('enableWideMode',false)")
    viewport(1024, True)
    wait("chatSidebarUiState.mode==='overlay' && "
         "getComputedStyle(document.querySelector('#project-tabs')).display==='none'", 'tablet regular uses two columns')
    ev("appLogic.updateLocalUiSetting('enableWideMode',true)")
    viewport(390, True)
    wait("innerWidth===390 && getComputedStyle(document.querySelector('#project-tabs')).display==='flex'", 'phone uses tabs')
    click('#project-tab-chats', True)
    assert ev("getComputedStyle(document.querySelector('#project-file-panel')).display==='none'")
    capture('mobile-project-home')
    click('#project-add-chat', True)
    wait("document.querySelector('.project-picker-list input')", 'mobile picker loaded')
    capture('mobile-picker')
    click('#project-dialog-cancel', True)
    ev("appLogic.handleFileSelection([new File(['keep'], 'mobile-tabs.txt', {type:'text/plain'})])")
    wait("document.querySelector('.composer-attachment-remove')", 'project attachment is visible')
    click('#project-tab-files', True)
    assert ev("""(() => {
        const content=document.querySelector('#project-content');
        return content.scrollWidth<=content.clientWidth+1 &&
            document.querySelector('#user-input').value==='第二の下書き' &&
            state.pendingAttachments[0]?.name==='mobile-tabs.txt' &&
            Boolean(document.querySelector('.composer-attachment-remove').getBoundingClientRect().width) &&
            getComputedStyle(document.querySelector('#project-chat-panel')).display==='none';
    })()""")
    click('.composer-attachment-remove', True)
    click('#project-file-add', True)
    wait("!document.querySelector('#project-menu').hidden", 'file menu opened')
    assert ev("""(() => {
        const menu=document.querySelector('#project-menu').getBoundingClientRect();
        return menu.width>0 && menu.left>=0 && menu.right<=innerWidth && menu.bottom<=innerHeight;
    })()""")
    click('#project-file-add', True)
    wait("document.querySelector('#project-menu').hidden", 'file menu closed before capture')
    capture('mobile-files')
    viewport(1280, False)
    wait("innerWidth===1280 && chatSidebarUiState.mode==='permanent'", 'PC restored for remaining actions')
    checks.append('responsive columns, phone tabs, file menu bounds and draft preservation')

    click('#project-options')
    click('#project-menu [data-project-action="delete"]')
    wait("document.querySelector('#confirmDialog').open", 'delete needs confirmation')
    assert ev("document.querySelector('#confirmDialog').textContent.includes('未所属に戻ります') && "
              "document.querySelector('#confirmDialog').textContent.includes('原本と旧版は残ります')")
    accept()
    wait(f"""elements.projectWorkspace.hidden && !document.querySelector('[data-project-id="{beta}"]')""", 'deleted project closes')
    assert ev(f"(async()=>Boolean(await dbUtils.getChat({member})) && !await dbUtils.getChatProject({member}) && "
              "(await dbUtils.listLibraryDocuments()).some(entry=>entry.fileName==='新規アップロード.txt'))()")
    ev("""(async()=>{for(let i=0;i<24;i++) await dbUtils.createProject({name:'一覧 '+i});})()""")
    wait("document.querySelectorAll('.project-folder').length===25", 'large project list rendered')
    assert ev(f"""(() => {{
        const project = document.querySelector('[data-project-id="{alpha}"]');
        return project && document.querySelector('.project-folder')!==project;
    }})()"""), 'Newly edited empty projects sort ahead of a project with an earlier chat'
    open_project(alpha, '第一・編集済み')
    ev("""(async()=>{
        const backup=await appLogic.createFullBackup();
        const payload=JSON.parse(await backup.text());
        const id=history.state.projectId;
        const data=payload.data.projectData;
        data.projects=data.projects.filter(project=>project.id!==id);
        data.chats=data.chats.filter(link=>link.projectId!==id);
        data.documents=data.documents.filter(link=>link.projectId!==id);
        await appLogic.importDataFromString(JSON.stringify(payload),{source:'file'});
        uiUtilsV136.hideProgressDialog();
    })()""")
    wait(f"""elements.projectWorkspace.hidden && !document.querySelector('[data-project-id="{alpha}"]')""", 'restore updates current workspace')
    assert ev(f'dbUtils.getChat({project_chat}).then(Boolean)')
    checks.append('confirmed delete, many projects and restore-driven workspace refresh')

    viewport(390, True)
    wait("innerWidth===390 && chatSidebarUiState.mode==='overlay' && !chatSidebarUiState.isOpen && "
         "(()=>{const button=elements.gotoHistoryBtn,r=button.getBoundingClientRect();"
         "return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()", 'mobile overlay ready')
    open_sidebar(True)
    capture('mobile-sidebar')
    mobile_id = ev("document.querySelector('.project-folder').dataset.projectId")
    click('#project-create', True)
    wait("document.querySelector('#project-dialog').open", 'touch reveals and opens add')
    click('#project-dialog-cancel', True)
    click(folder(mobile_id, 'expand'), True)
    assert ev(f"document.querySelector({json.dumps(folder(mobile_id, 'expand'))}).getAttribute('aria-expanded')==='true'")
    click(folder(mobile_id, 'menu'), True)
    wait("!document.querySelector('#project-menu').hidden", 'touch opens project menu')
    assert menu_in_bounds('#project-menu')
    key('Escape')
    assert ev("chatSidebarUiState.isOpen && document.querySelector('#project-menu').hidden")
    click(folder(mobile_id, 'menu'), True)
    click('#project-menu [data-project-action="edit"]', True)
    wait("document.querySelector('#project-dialog').open", 'touch activates a menu item')
    click('#project-dialog-cancel', True)
    assert ev(f"document.querySelector({json.dumps(folder(mobile_id, 'expand'))}).getAttribute('aria-expanded')==='true'")
    click(folder(mobile_id), True)
    wait('!elements.projectWorkspace.hidden && !chatSidebarUiState.isOpen', 'touch opens workspace and closes overlay')
    ev("appLogic.updateLocalUiSetting('enableSwipeNavigation',true)")
    for i in range(8):
        client.call('Input.dispatchTouchEvent', {'type': 'touchMove' if i else 'touchStart',
                    'touchPoints': [{'x': 340-i*28, 'y': 450, 'id': 901}]})
        time.sleep(.02)
    client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    assert ev("state.currentScreen==='chat' && !elements.projectWorkspace.hidden")
    viewport(1280, False)
    wait("chatSidebarUiState.mode==='permanent' && !elements.projectWorkspace.hidden", 'project survives wide layout change')
    ev('uiUtilsV136.openChatSidebar()')
    assert ev("""(() => {
        const r=elements.projectWorkspace.getBoundingClientRect();
        const sidebar=elements.chatHistorySidebar.getBoundingClientRect();
        return r.left>=sidebar.right-1 && r.right<=innerWidth+1;
    })()""")
    checks.append('mobile touch targets, swipe isolation and wide layout')

    project, chat, first_profile, second_profile, saved_ids = ev("""(async()=>{
        const project = await dbUtils.createProject({name:'起動時サイドバー検証'});
        const chat = await dbUtils.saveChat(null, {title:'復帰先チャット', messages:[]}, {skipPush:true});
        const firstProfile = state.activeProfileId;
        const secondProfile = await dbUtils.addProfile({name:'切替検証', settings:state.activeProfile.settings});
        await appLogic.updateLocalUiSetting('isPersistentChatSidebarOpen', true);
        return [project.id, chat, firstProfile, secondProfile, (await dbUtils.listProjects()).map(item=>item.id).sort()];
    })()""")
    expected = json.dumps(saved_ids)
    visible = f"""(() => {{
        const section = document.querySelector('#project-sidebar');
        const rendered = [...section.querySelectorAll('.project-folder')].map(row=>row.dataset.projectId).sort();
        return chatSidebarUiState.isOpen && !section.hidden && section.getBoundingClientRect().width > 0 &&
            JSON.stringify(rendered) === JSON.stringify({expected});
    }})()"""
    client.call('Page.enable')
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        Object.defineProperty(window, 'appLogic', {
            configurable: true,
            set(app) {
                Object.defineProperty(window, 'appLogic', {configurable:true, writable:true, value:app});
                const loadProfiles = app.loadProfiles;
                app.loadProfiles = async function (...args) {
                    app.loadProfiles = loadProfiles;
                    await loadProfiles.apply(this, args);
                    // Let any early sidebar read finish before startup binds UI events.
                    await new Promise(resolve => { window.resumeSidebarStartup = resolve; });
                };
            }
        });
    """})['identifier']
    try:
        first_load = ev('performance.timeOrigin')
        client.call('Page.navigate', {'url': url + '?projectSidebarStartup=delayed'})
        wait(f"performance.timeOrigin>{first_load} && window.resumeSidebarStartup && "
             "(chatSidebarUiState.mode==='disabled' || chatSidebarUiState.hasLoadedAll)", 'startup paused after loading profiles')
        ev('window.resumeSidebarStartup()')
        wait(ready, 'startup resumed')
        assert ev(visible), ev("""(async()=>({
            stored: (await dbUtils.listProjects()).length,
            cached: chatSidebarUiState.projects.length,
            loaded: chatSidebarUiState.hasLoadedAll,
            hidden: document.querySelector('#project-sidebar').hidden
        }))()""")
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
    wait(visible, 'saved projects visible after delayed startup')
    ev(f'dbUtils.setChatProject({chat},{json.dumps(project)})')
    wait(f"chatSidebarUiState.memberships.get({chat})==={json.dumps(project)}", 'fixture membership loaded')

    for attempt in range(12):
        first_load = ev('performance.timeOrigin')
        client.call('Page.reload')
        wait(f"performance.timeOrigin>{first_load} && {ready} && {visible}", f'normal startup {attempt + 1}')
        open_project(project, '起動時サイドバー検証')
        click(f'#project-chats [data-chat-id="{chat}"] [data-sidebar-action="open"]')
        wait(f'elements.projectWorkspace.hidden && state.currentChatId==={chat} && {visible}', 'return to chat with projects')
        open_project(project, '起動時サイドバー検証')
        click('#project-back')
        wait(f'elements.projectWorkspace.hidden && {visible}', 'return from project home')
        ev('uiUtilsV136.closeChatSidebar(); uiUtilsV136.openChatSidebar()')
        wait(visible, 'reopened sidebar')
        viewport(390, True)
        wait("innerWidth===390 && chatSidebarUiState.mode==='overlay'", 'sidebar switches to overlay')
        open_sidebar(True)
        wait(visible, 'projects visible in overlay')
        viewport(1280, False)
        wait(f"innerWidth===1280 && chatSidebarUiState.mode==='permanent' && {visible}", 'projects visible after width restored')
        for profile in [second_profile, first_profile]:
            assert ev(f'appLogic.switchProfile({profile})')
            wait(f'state.activeProfileId==={profile} && {visible}', 'projects visible after profile switch')
    checks.append('saved projects survive delayed startup and 12 repeated reload, navigation, sidebar, width and profile cycles')
    return 'ALL PASSED ({} project UI scenarios: {})'.format(len(checks), '; '.join(checks))

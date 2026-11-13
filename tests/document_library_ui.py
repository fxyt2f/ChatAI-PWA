"""Real Chrome coverage for the chat picker and the library workspace."""
import json
from pathlib import Path
import time


def run(client, url):
    prefix = '#document-library-'
    checks = []

    def ev(expression):
        result = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def wait(expression, description):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if ev(f'Promise.resolve({expression}).then(Boolean)'):
                    return
            except RuntimeError as error:
                if not any(message in str(error) for message in (
                    'Execution context was destroyed', 'Inspected target navigated or closed',
                )):
                    raise
            time.sleep(0.04)
        details = ev("""({chat:window.state?.currentChatId, screen:window.state?.currentScreen,
            dialogs:[...document.querySelectorAll('dialog[open]')].map(dialog=>dialog.id),
            sidebar:[chatSidebarUiState.mode,chatSidebarUiState.isOpen,chatSidebarUiState.query,chatSidebarUiState.hasLoadedAll],
            menu:[historyUiState.menuContext?.chatId,historyUiState.menuContext?.importOnly,
                [...document.querySelectorAll('#history-item-menu button:not([hidden])')].map(item=>item.dataset.historyMenuAction)],
            library:document.querySelector('#document-library-notice')?.textContent,
            preview:document.querySelector('#document-library-preview-status')?.textContent,
            search:document.querySelector('#document-library-search-status')?.textContent})""")
        raise AssertionError(f'{description}: {details}')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def move_mouse(selector):
        point = ev(f"""(() => {{
            const bounds=document.querySelector({json.dumps(selector)}).getBoundingClientRect();
            return {{x: Math.floor((bounds.left+bounds.right)/2), y: Math.floor((bounds.top+bounds.bottom)/2)}};
        }})()""")
        client.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **point})

    def key(name, number):
        for event in ('keyDown', 'keyUp'):
            client.call('Input.dispatchKeyEvent', {'type': event, 'key': name, 'code': name,
                                                   'windowsVirtualKeyCode': number})

    def pointer(selector, touch):
        if not touch:
            ev(f"document.querySelector({json.dumps(selector)}).scrollIntoView({{block:'nearest'}})")
            move_mouse(selector)
        point = ev(f"""(() => {{
            const element=document.querySelector({json.dumps(selector)});
            element.scrollIntoView({{block:'nearest'}});
            const box=element.getBoundingClientRect();
            const x=Math.floor((box.left+box.right)/2), y=Math.floor((box.top+box.bottom)/2);
            const hit = document.elementFromPoint(x,y);
            return {{x,y,hit:element.contains(hit), target:hit?.id || hit?.className,
                inert:element.closest('[inert]')?.id, visibility:getComputedStyle(element).visibility}};
        }})()""")
        assert point.pop('hit'), (selector, point)
        point = {axis:point[axis] for axis in ('x', 'y')}
        if touch:
            client.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            for event in ('mousePressed', 'mouseReleased'):
                client.call('Input.dispatchMouseEvent', {**point, 'type': event, 'button': 'left', 'clickCount': 1})

    def viewport(width, height, touch, verify=True):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': touch,
        })
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': touch})
        if verify:
            wait(f'innerWidth === {width} && innerHeight === {height}', 'Viewport ready')

    def selector(scope, doc_id, control=''):
        return f'{prefix}{scope} [data-document-id="{doc_id}"]{control}'

    def check_sidebar_alignment():
        wait("""(() => {
            const sidebar = document.querySelector('#chat-history-sidebar');
            const bounds = sidebar.getBoundingClientRect();
            return bounds.width > 0 && bounds.left >= -0.5 && bounds.right <= innerWidth;
        })()""", 'Sidebar is visible within the viewport')
        assert ev("""(() => {
            const get = selector => document.querySelector(selector);
            const left = element => element.getBoundingClientRect().left;
            const contentLeft = element => left(element) + parseFloat(getComputedStyle(element).paddingLeft);
            const history = get('.chat-sidebar-history-header');
            const group = get('#chat-sidebar-pinned:not([hidden]) .chat-sidebar-group-title');
            const title = get('#chat-sidebar-list .chat-sidebar-item:not(:has(.chat-pin-icon)) .chat-sidebar-item-title');
            const leading = group ? contentLeft(group) : contentLeft(history);
            const aligned = [get('.chat-sidebar-brand'), get('#new-chat-btn .material-symbols-outlined'),
                get('#document-library-open .document-library-icon'), get('.chat-sidebar-history-header h2'),
                ...(title ? [title] : [])].every(element => Math.abs(left(element) - leading) < 0.5);
            const menu = get('#chat-sidebar-history-menu-btn');
            const rowMenu = get('#chat-sidebar-list .chat-sidebar-item-menu, #chat-sidebar-pinned:not([hidden]) .chat-sidebar-item-menu');
            const geometry = element => {
                const {left, width, height} = element.getBoundingClientRect();
                return [left + width / 2, width, height, getComputedStyle(element.firstElementChild).fontSize];
            };
            if (!aligned || !rowMenu) return aligned;
            const menusAlign = () => JSON.stringify(geometry(menu)) === JSON.stringify(geometry(rowMenu));
            if (!menusAlign()) return false;
            const list = get('#chat-sidebar-list');
            try {
                list.style.minHeight = '200vh';
                return menusAlign();
            } finally {
                list.style.removeProperty('min-height');
            }
        })()"""), f'Sidebar leading edges and menu geometry align at {ev("innerWidth")}px'

    library_current = """document.querySelector('#document-library-open').getAttribute('aria-current')==='page'
        && !document.querySelector('.chat-sidebar-item[aria-current="page"]')"""

    def open_workspace(touch):
        expected = ev("""(() => {
            const header=document.querySelector('#chat-workspace > .app-header');
            const style=getComputedStyle(header);
            return [header.getBoundingClientRect().height, style.backgroundColor, style.paddingTop,
                style.paddingBottom, style.borderBottomWidth, style.boxShadow];
        })()""")
        if ev("document.querySelector('#chat-history-sidebar').getAttribute('aria-hidden') === 'true'"):
            pointer('#goto-history-btn', touch)
        wait("document.querySelector('#chat-history-sidebar').getAttribute('aria-hidden') === 'false'", 'Sidebar open')
        check_sidebar_alignment()
        assert ev("""(() => {
            const [newChat, library]=document.querySelector('.chat-sidebar-navigation').children;
            const heading=document.querySelector('.chat-sidebar-history-header');
            return newChat.textContent.endsWith('新規チャット') && library.textContent.trim()==='ライブラリ' &&
                heading.querySelector('h2').textContent==='チャット' && !document.querySelector('#history-screen, #chat-sidebar-close-btn') &&
                !document.querySelector('#chat-workspace #document-library-open, #chat-workspace #new-chat-btn') &&
                newChat.getBoundingClientRect().bottom <= library.getBoundingClientRect().top &&
                library.getBoundingClientRect().bottom <= heading.getBoundingClientRect().top &&
                getComputedStyle(heading).backgroundColor==='rgba(0, 0, 0, 0)';
        })()""")
        pointer(prefix + 'open', touch)
        wait("!document.querySelector('#document-library-workspace').hidden", 'Library workspace opened')
        assert ev(library_current), 'The displayed workspace is the only current sidebar item'
        assert ev("""state.currentScreen === 'chat' && document.querySelector('#chat-workspace').inert &&
            !document.querySelector('dialog[open]')""")
        assert ev("""(() => {
            const header=document.querySelector('#document-library-workspace > .app-header');
            const style=getComputedStyle(header);
            return [header.getBoundingClientRect().height, style.backgroundColor, style.paddingTop,
                style.paddingBottom, style.borderBottomWidth, style.boxShadow];
        })()""") == expected, 'Library and chat share the header geometry and theme'
        assert ev("""(() => {
            const button=document.querySelector('#document-library-add');
            const box=button.getBoundingClientRect(), title=document.querySelector('#document-library-title').getBoundingClientRect();
            const header=button.parentElement.getBoundingClientRect();
            return button.parentElement.matches('.app-header') && button.textContent.trim()==='ファイルを追加' &&
                document.querySelectorAll('#document-library-add').length===1 && box.left>=title.right &&
                box.right<=header.right && box.height>=40 && button.scrollWidth<=button.clientWidth;
        })()"""), 'The labeled upload button fits on the right side of the header'
        assert ev("""(() => {
            const toggle=document.querySelector('#goto-history-btn');
            const library=document.querySelector('#document-library-workspace');
            return toggle.closest('.app-header').parentElement===library &&
                toggle.firstElementChild.textContent==='menu' && !library.querySelector('#document-library-sidebar, #document-library-back') &&
                document.querySelector('#chat-overlay').parentElement===library.parentElement &&
                getComputedStyle(library).backgroundColor===getComputedStyle(document.querySelector('#chat-workspace')).backgroundColor;
        })()"""), 'Library uses the chat background and shared sidebar toggle'

    def close_workspace(touch):
        if ev("Boolean(history.state?.documentLibraryDetail)"):
            ev('history.back()')
            wait("document.querySelector('#document-library-preview').hidden", 'Back returns to the collection')
        ev('history.back()')
        wait("document.querySelector('#document-library-workspace').hidden", 'Back returns to the conversation')
        assert ev("!document.querySelector('#document-library-open').hasAttribute('aria-current')")

    def open_picker(touch):
        ev("clearTimeout(state.panelFadeOutTimer); appLogic.setFloatingPanelVisible(true)")
        wait("Number(getComputedStyle(document.querySelector('#floating-action-panel')).opacity)>0.95", 'Action panel visible')
        pointer(prefix + 'picker-open', touch)
        wait("document.querySelector('#document-library-picker').open", 'Chat document modal opened')
        assert ev("""document.querySelector('#document-library-picker').classList.contains('chat-workspace-dialog') &&
            document.querySelector('#document-library-workspace').hidden""")
        assert ev("""(() => {
            const toolbar=document.querySelector('#document-library-picker-actions');
            const [left,right]=[...toolbar.children].map(button=>button.getBoundingClientRect());
            const outer=toolbar.getBoundingClientRect();
            return Math.abs(left.width-right.width)<1 && left.height===right.height &&
                left.top===right.top && left.left===outer.left && right.right===outer.right &&
                [...toolbar.children].every(button=>{
                    const range=document.createRange();
                    range.selectNodeContents(button.lastElementChild);
                    const bounds=button.getBoundingClientRect();
                    return [...range.getClientRects()].every(rect=>rect.left>=bounds.left && rect.right<=bounds.right);
                });
        })()"""), 'Picker actions share all available width and fit their labels'

    def select_document(doc_id, touch, from_search=False):
        if not from_search:
            pointer(prefix + 'picker-select', touch)
        candidate = selector('picker-list', doc_id, ' button')
        wait(f"document.querySelector({json.dumps(candidate)})", 'Selection candidate')
        pointer(candidate, touch)
        wait(f"document.querySelector('#document-library-picker-heading').textContent==='このチャットのファイル' && "
             f"document.querySelector({json.dumps(selector('picker-list', doc_id, ' .document-library-more'))})", 'Picker returns to links')

    def focus_icon(selector_text):
        for event in ('keyDown', 'keyUp'):
            client.call('Input.dispatchKeyEvent', {'type':event,'key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
        return ev(f"""(() => {{
            const button=document.querySelector({json.dumps(selector_text)});
            button.focus({{preventScroll:true}});
            const style=getComputedStyle(button), rect=button.getBoundingClientRect(), icon=button.firstElementChild.getBoundingClientRect();
            return {{visible:button.matches(':focus-visible'), width:rect.width, height:rect.height,
                centered:Math.abs((rect.left+rect.right)-(icon.left+icon.right))<1 &&
                    Math.abs((rect.top+rect.bottom)-(icon.top+icon.bottom))<1,
                radius:style.borderTopLeftRadius, background:style.backgroundColor, shadow:style.boxShadow}};
        }})()""")

    def choose(selector_text, records):
        ev(f"""(() => {{
            const input = document.querySelector({json.dumps(selector_text)});
            const transfer = new DataTransfer();
            for (const [name, text] of {json.dumps(records)}) transfer.items.add(new File([text], name));
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', {{bubbles:true}}));
        }})()""")

    def open_reference(touch):
        assert ev("document.querySelector('.rag-references summary').textContent.startsWith('参照ファイル')")
        if not ev("document.querySelector('.rag-references').open"):
            pointer('.rag-references summary', touch)
        pointer('.rag-references button', touch)
        wait("!document.querySelector('#document-library-workspace').hidden", 'Reference opens the workspace')

    def type_search(query, scope=''):
        field = prefix + scope + 'query'
        ev(f"""(() => {{
            const field = document.querySelector({json.dumps(field)});
            field.value={json.dumps(query)};
            field.dispatchEvent(new Event('input',{{bubbles:true}}));
        }})()""")

    def search_mode(mode):
        ev(f"""(() => {{
            const select=document.querySelector('#document-library-search-mode');
            select.value={json.dumps(mode)}; select.dispatchEvent(new Event('change'));
        }})()""")

    def drop_files(selector_text, records):
        return ev(f"""(() => {{
            const target=document.querySelector({json.dumps(selector_text)});
            const surface=target.closest('#document-library-workspace,#document-library-picker');
            const files=new DataTransfer();
            for(const [name,text] of {json.dumps(records)}) files.items.add(new File([text],name));
            const fire=(type,transfer,extra={{}})=>!target.dispatchEvent(new DragEvent(type,
                {{bubbles:true,cancelable:true,dataTransfer:transfer,...extra}}));
            const url=new DataTransfer();
            url.setData('text/uri-list','https://example.invalid/document.pdf');
            fire('dragover',url);
            const ignoresUrl=!surface.hasAttribute('data-file-drop');
            fire('dragenter',files);
            const highlighted=surface.hasAttribute('data-file-drop');
            fire('dragleave',files,{{relatedTarget:document.body}});
            const clearedOnLeave=!surface.hasAttribute('data-file-drop');
            fire('dragover',files);
            return {{ignoresUrl,highlighted,clearedOnLeave,canceled:fire('drop',files),
                clearedOnDrop:!surface.hasAttribute('data-file-drop')}};
        }})()""")

    viewport(390, 760, True, verify=False)
    client.call('Page.navigate', {'url': url + '?libraryUiFixture=2'})
    ready = """window.appLogic?._setupEventListenersCallCount && state.activeProfile &&
        !state.executionInitializingV136 && !document.querySelector('#progressDialog[open]')"""
    wait(ready, 'Real app initialized')
    wait("navigator.serviceWorker.controller?.state === 'activated'", 'Service Worker active')
    ev("appLogic.updateLocalUiSetting('lastSeenReleaseVersion',APP_VERSION)")
    first_load = ev('performance.timeOrigin')
    client.call('Page.reload')
    wait(f"performance.timeOrigin > {first_load} && {ready} && !document.querySelector('dialog[open]')",
         'Controlled startup completed')
    wait('innerWidth === 390 && innerHeight === 760', 'Mobile viewport ready')

    ev("document.querySelector('#user-input').value='入力途中の文章'; document.querySelector('#user-input').dispatchEvent(new Event('input'))")
    open_picker(True)
    assert ev("""document.querySelector('#document-library-picker-heading').textContent === 'このチャットのファイル' &&
        document.querySelector('#document-library-picker-count').textContent==='0件' &&
        !document.querySelector('#document-library-picker-empty').textContent &&
        document.querySelector('#document-library-picker-empty').hidden &&
        document.querySelector('#document-library-picker-open svg path').getAttribute('d')===
            'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6' &&
        document.querySelector('#document-library-picker-search').hidden &&
        document.querySelector('#document-library-picker').getBoundingClientRect().width < innerWidth""")
    pointer(prefix + 'picker-close', True)
    wait("!document.querySelector('#document-library-picker').open", 'Close picker')
    open_workspace(True)
    wait("!document.querySelector('#document-library-empty').hidden", 'Empty library')
    assert ev("""(() => {
        const panel=document.querySelector('#document-library-workspace').getBoundingClientRect();
        return panel.left === 0 && panel.right === innerWidth && !document.querySelector('#document-library-preview').offsetWidth;
    })()"""), 'Mobile workspace uses the full width'
    choose(prefix + 'files', [
        ['返品案内.md', '# 返品\n返金申請は３０日以内です。\n\n~~~html\n<img src="/unsafe-preview-fixture" onerror="window.previewExecuted=true">\n~~~'],
        ['店舗案内.html', '<h2>受付窓口</h2><p>店舗は午前９時に開店します。</p><script>window.previewExecuted=true</script>'],
        ['不正な資料.xml', '<手続き>途中のXML'],
        ['unsupported.bin', 'not a document'],
    ])
    wait("document.querySelectorAll('#document-library-list li').length === 3", 'Saved supported originals')
    assert ev("document.querySelector('#document-library-notice').textContent.includes('unsupported.bin')")
    docs = ev("(async()=>Object.fromEntries((await dbUtils.listLibraryDocuments()).map(entry=>[entry.fileName,entry.id])))()")
    first, second = docs['返品案内.md'], docs['店舗案内.html']
    row1, row2 = selector('list', first), selector('list', second)
    pointer(selector('list', docs['不正な資料.xml'], ' .document-library-file'), True)
    wait("""document.querySelector('#document-library-preview-status').textContent.includes('XMLの構造が無効') &&
        !document.querySelector('#document-library-retry').hidden""", 'Analysis failure explains why and offers retry')
    assert ev("getComputedStyle(document.querySelector('#document-library-collection')).display === 'none'")
    ev('history.back()')
    wait("document.querySelector('#document-library-preview').hidden && !document.querySelector('#document-library-workspace').hidden",
         'Browser Back returns from mobile detail to the list')

    type_search(' 返品案内.MD ')
    assert ev("document.querySelectorAll('#document-library-list li').length===1")
    search_mode('body')
    type_search('30日以内')
    wait("document.querySelector('#document-library-list .document-library-file-excerpt')?.textContent.includes('３０日以内')",
         'Library-wide body search updates on input')
    pointer(row1 + ' .document-library-file', True)
    wait("document.querySelector('.document-library-extract[data-highlight=true]')?.textContent.includes('３０日以内')",
         'Body hit opens the exact passage')
    assert ev("""!window.previewExecuted && !document.querySelector('#document-library-extracts img, #document-library-extracts script') &&
        document.querySelector('#document-library-extracts pre').textContent.includes('<img')"""), 'Preview renders literal text'
    assert ev("""document.querySelector('#document-library-mobile-title').textContent==='返品案内.md' &&
        !document.querySelector('#document-library-add').offsetWidth &&
        document.querySelector('#document-library-detail-close').offsetWidth>0 &&
        document.querySelector('#document-library-detail-find').hidden &&
        document.querySelector('#document-library-show-original').disabled &&
        !document.querySelector('#document-library-workspace button[type=submit]')""")
    pointer(prefix + 'mobile-search', True)
    assert ev("document.activeElement.id==='document-library-detail-query'")
    type_search('30日以内', 'detail-')
    wait("document.querySelector('#document-library-detail-results button')?.textContent.includes('３０日以内')", 'Search within one document')
    pointer(prefix + 'detail-results button', True)
    assert ev("document.activeElement.matches('.document-library-extract[data-highlight=true]')")
    pointer(prefix + 'mobile-search', True)
    assert ev("document.querySelector('#document-library-detail-find').hidden")
    pointer(prefix + 'detail-close', True)
    wait("document.querySelector('#document-library-list .document-library-file-excerpt') && document.querySelector('#document-library-preview').hidden",
         'Back to the matching search results')
    close_workspace(True)
    assert ev("document.querySelector('#user-input').value === '入力途中の文章' && state.currentChatId === null")
    checks.append('mobile workspace, both searches, positions, literal preview and back')

    open_picker(True)
    pointer(prefix + 'picker-select', True)
    wait("document.querySelectorAll('#document-library-picker-list li').length===3", 'Picker shows available files')
    assert ev("""!document.querySelector('#document-library-picker-search').hidden &&
        document.querySelector('#document-library-picker-actions').hidden &&
        !document.querySelector('#document-library-picker-search select, #document-library-picker-search button')""")
    type_search('店舗', 'picker-')
    assert ev("""document.querySelectorAll('#document-library-picker-list li').length===1 &&
        document.querySelector('#document-library-picker-list button').title==='店舗案内.html'""")
    type_search('該当しない名前', 'picker-')
    assert ev("""!document.querySelector('#document-library-picker-list li') &&
        !document.querySelector('#document-library-picker-empty').hidden""")
    type_search('', 'picker-')
    assert ev("""document.querySelectorAll('#document-library-picker-list li').length===3 &&
        document.querySelector('#document-library-picker-empty').hidden""")
    type_search(' 返品案内.MD ', 'picker-')
    assert ev("document.querySelectorAll('#document-library-picker-list li').length===1")
    select_document(first, True, from_search=True)
    chat1 = ev('state.currentChatId')
    assert chat1 is not None
    assert ev("document.querySelector('#document-library-picker-count').textContent==='1件'")
    pointer(prefix + 'picker-select', True)
    assert ev("""document.querySelector('#document-library-picker-query').value===' 返品案内.MD ' &&
        !document.querySelector('#document-library-picker-list li')"""), 'Already linked file stays excluded when returning to the filter'
    pointer(prefix + 'picker-back', True)
    assert ev("document.querySelector('#document-library-picker-count').textContent==='1件'")
    checks.append('picker filename filtering, clearing, case and Japanese matches, association and back')
    assert ev("""(() => {
        const row=document.querySelector('#document-library-picker-list li');
        const file=row.firstElementChild;
        return [...file.children].map(element=>element.getAttribute('class')).join(',')===
            'document-library-icon,document-library-file-name,document-library-file-size' &&
            row.children.length===2 && !row.textContent.includes('検索可能') &&
            !row.querySelector('input, a') && row.lastElementChild.classList.contains('document-library-more');
    })()""")
    file_more = selector('picker-list', first, ' .document-library-more')
    picker_close = focus_icon(prefix + 'picker-close')
    assert picker_close == focus_icon(file_more)
    assert picker_close['visible'] and picker_close['centered'] and picker_close['width'] == picker_close['height'] == 44
    assert picker_close['radius'] == '50%' and picker_close['shadow'] == 'none'
    assert ev("getComputedStyle(document.querySelector('#document-library-picker')).boxShadow===getComputedStyle(document.querySelector('#system-prompt-dialog')).boxShadow")
    ev("""window.libraryTheme=[state.settings.themeColorMode,state.settings.headerColor];
        Object.assign(state.settings,{themeColorMode:'individual',headerColor:'#ffffff'});uiUtilsV136.applyHeaderColor();""")
    assert ev("""(() => {
        const button=document.querySelector('#document-library-picker-close');
        button.focus();
        const dialog=document.querySelector('#document-library-picker');
        const canvas=document.createElement('canvas').getContext('2d');
        const red=element=>{ canvas.fillStyle=getComputedStyle(element).backgroundColor;
            canvas.fillRect(0,0,1,1); return canvas.getImageData(0,0,1,1).data[0]; };
        return button.matches(':focus-visible') && red(dialog)-red(button)>=10;
    })()"""), 'White theme color still leaves a visible focus background'
    ev("""
        Object.assign(state.settings,{themeColorMode:'individual',headerColor:'#92314e'});uiUtilsV136.applyHeaderColor();""")
    colored = focus_icon(file_more)
    assert colored['background'] != picker_close['background']
    assert colored == focus_icon(prefix + 'picker-close')
    pointer(file_more, True)
    wait("!document.querySelector('#document-library-picker-menu').hidden", 'Unlink menu opens')
    assert ev(f"""(async()=> (await dbUtils.getChatDocuments({chat1}))[0].id==={json.dumps(first)} &&
        document.querySelector('#document-library-picker-menu').childElementCount===1 &&
        document.querySelector('#document-library-picker-menu').textContent.includes('このチャットから解除'))()""")
    pointer(prefix + 'picker-menu [role=menuitem]', True)
    wait("document.querySelector('#document-library-picker-count').textContent==='0件' && !document.querySelector('#document-library-picker-list li')",
         'Unlink is immediately reflected in the count')
    assert ev(f"""(async()=> (await dbUtils.getLibraryOriginal({json.dumps(first)},1)).blob.size>0 &&
        !(await DocumentSearch.searchChat({chat1},'返金申請は何日以内？')).results.length)()"""), 'Unlink preserves originals and removes RAG scope'
    select_document(first, True)
    pointer(prefix + 'picker-close', True)
    assert ev('appLogic.openSystemPromptDialog()')
    wait("document.activeElement.id==='system-prompt-editor'", 'Parameter dialog completed its initial focus')
    assert colored == focus_icon('#system-prompt-close-btn') == focus_icon('#chat-parameter-menu-btn')
    assert ev('appLogic.closeSystemPromptDialog()')
    wait("getComputedStyle(document.querySelector('#chat-workspace > .app-header')).backgroundColor==='rgb(146, 49, 78)'", 'Custom header color is applied')
    open_workspace(True)
    close_workspace(True)
    ev("""[state.settings.themeColorMode,state.settings.headerColor]=window.libraryTheme;uiUtilsV136.applyHeaderColor();""")
    assert ev("document.querySelector('#user-input').value==='入力途中の文章' && !state.currentMessages.length")
    checks.append('file icon, count, shared themed focus on four buttons, pre-send link, unlink and RAG scope')

    ev("""(async()=>{
        await dbUtils.saveSetting('apiConfigs',[{id:'library-ui-gem',provider:'gemini',apiKey:'mock',enabled:true,
            modelCandidates:['gemini-3-flash-preview'],defaultModel:'gemini-3-flash-preview'}]);
        await appLogic.loadGlobalSettings();
        await appLogic.setCurrentChatModelRef({apiConfigId:'library-ui-gem',modelName:'gemini-3-flash-preview'});
        await appLogic.saveGlobalSettingsV136({enableChatTitleGeneration:false,enableStreamingOutput:false});
        Object.assign(state.settings,{enableMemory:false,enableAutoRetry:false,enableApiTimeout:false,
            enableProofreading:false,enableThoughtTranslation:false,geminiEnableFunctionCalling:false});
        for(let i=0;i<24;i++) state.currentMessages.push({role:i%2?'model':'user', content:'検証用の会話 '+i+'\\n\\n文章の続き。',timestamp:Date.now()+i});
        uiUtilsV136.renderChatMessages();
        const original=window.fetch;
        window.fetch=(input, options)=>{
            if(!String(input).includes('generativelanguage.googleapis.com') || !options?.body) return original(input, options);
            window.documentUiPayload=JSON.parse(options.body);
            return new Promise(resolve=>window.completeDocumentUiSend=()=>{
                window.fetch=original;
                resolve(Response.json({candidates:[{content:{role:'model',parts:[{text:'資料UIの検証用回答です。'}]},finishReason:'STOP'}]}));
            });
        };
        document.querySelector('#user-input').value='返金申請の期限は何日以内ですか？';
        window.documentUiSend=appLogic.handleSend();
    })()""")
    wait("window.completeDocumentUiSend && state.isSending", 'Mocked API request is held in flight')
    assert ev("window.documentUiPayload.systemInstruction.parts[0].text.includes('３０日以内')")
    time.sleep(0.35)  # Let the existing send scroll animation finish before positioning the conversation.
    ev("document.querySelector('#chat-workspace .main-content').scrollTop=86")
    open_workspace(True)
    ev("window.completeDocumentUiSend(); window.documentUiSend")
    wait("!state.isSending", 'Generation finishes while the library is open')
    close_workspace(True)
    assert ev(f"state.currentChatId==={chat1} && document.querySelector('#chat-workspace .main-content').scrollTop===86")
    ev("""document.querySelector('.rag-references').open=true;
        document.querySelector('.rag-references button').scrollIntoView({block:'center'});""")
    open_reference(True)
    wait("document.querySelector('.document-library-extract[data-highlight=true]')?.textContent.includes('３０日以内')",
         'Mobile reference opens the recorded passage')
    close_workspace(True)
    checks.append('mocked generation continues, original scroll and exact answer reference')

    open_picker(True)
    first_picker_more = selector('picker-list', first, ' .document-library-more')
    wait(f"document.querySelector({json.dumps(first_picker_more)})", 'First chat links loaded before delaying unlink')
    ev("""(() => {
        const original=dbUtils.addLibraryDocument;
        dbUtils.addLibraryDocument=(...args)=>new Promise(resolve=>window.finishOldPicker=()=>{
            dbUtils.addLibraryDocument=original;
            const saved=original.apply(dbUtils,args);
            resolve(saved);
            return saved.then(()=>true);
        });
    })()""")
    drop_files(prefix + 'picker-title', [['切り替え試験.txt', 'チャットを切り替えたときのアップロード']])
    wait("window.finishOldPicker", 'Upload is awaiting the first chat library write')
    ev("appLogic.startNewChat(); window.finishOldPicker()")
    assert ev("""(async()=>{
        const entry=(await dbUtils.listLibraryDocuments()).find(item=>item.fileName==='切り替え試験.txt');
        return entry && await dbUtils.deleteLibraryDocument(entry.id);
    })()""")
    wait("!document.querySelector('#document-library-picker').open && state.currentChatId===null", 'Chat switch closes old picker')
    open_picker(True)
    wait("document.querySelector('#document-library-picker-count').textContent==='0件' && !document.querySelector('#document-library-picker-list li')",
         'Empty links in second chat')
    select_document(second, True)
    chat2 = ev('state.currentChatId')
    pointer(prefix + 'picker-close', True)
    assert ev(f"""(async()=>{chat1}!=={chat2} &&
        (await dbUtils.getChatDocuments({chat1}))[0].id==={json.dumps(first)} &&
        (await dbUtils.getChatDocuments({chat2}))[0].id==={json.dumps(second)})()""")
    checks.append('delayed upload cannot link to a different chat')

    viewport(1024, 800, True)
    ev("""(async()=>{
        await appLogic.updateLocalUiSetting('enableWideMode',true);
        appLogic.applyWideMode();
    })()""")
    wait("document.querySelector('#chat-screen').classList.contains('chat-sidebar-mode-overlay')", 'Tablet overlay sidebar')
    open_workspace(True)
    close_workspace(True)

    viewport(1440, 900, False)
    ev('uiUtilsV136.openChatSidebar()')
    wait("document.querySelector('#chat-screen').classList.contains('chat-sidebar-mode-permanent')", 'Permanent desktop sidebar')
    wait("document.querySelector('.chat-sidebar-item[aria-current=page]')", 'Current chat is highlighted')
    selected_color = ev("getComputedStyle(document.querySelector('.chat-sidebar-item[aria-current=page]')).backgroundColor")
    open_workspace(False)
    background = "getComputedStyle(document.querySelector('#document-library-open')).backgroundColor"
    wait(f'{background} === {json.dumps(selected_color)}',
         'Library uses the chat selection background even under the pointer')
    assert ev("""(() => {
        const {darkMode, themeColorMode, accentColor} = state.settings;
        const library = document.querySelector('#document-library-open');
        try {
            const light = getComputedStyle(library).backgroundColor;
            library.style.transition = 'none';
            Object.assign(state.settings, {darkMode: true, themeColorMode: 'accent', accentColor: '#c04c69'});
            uiUtilsV136.applyDarkMode();
            const dark = getComputedStyle(library).backgroundColor;
            state.settings.accentColor = '#20b471';
            uiUtilsV136.applyThemeColorSettings();
            return light !== dark && dark !== getComputedStyle(library).backgroundColor;
        } finally {
            Object.assign(state.settings, {darkMode, themeColorMode, accentColor});
            uiUtilsV136.applyDarkMode();
            library.style.removeProperty('transition');
        }
    })()"""), 'The selection follows dark mode and custom accent colors'
    wait(f"document.querySelector({json.dumps(row1)})", 'Desktop list rendered')
    chat_row = '.chat-sidebar-item:not([aria-current])'

    def row_style(row, main, menu):
        return ev(f"""(async () => {{
            const row=document.querySelector({json.dumps(row)});
            const main=row.querySelector({json.dumps(main)}), menu=row.querySelector({json.dumps(menu)});
            await Promise.all(menu.getAnimations().map(animation=>animation.finished.catch(()=>{{}})));
            const glyph=menu.firstElementChild, bounds=menu.getBoundingClientRect();
            return {{
                row:[getComputedStyle(row).backgroundColor,getComputedStyle(row).borderRadius],
                mainBackground:getComputedStyle(main).backgroundColor,
                menu:[bounds.width,bounds.height,row.getBoundingClientRect().right-bounds.right,
                    ...['backgroundColor','color','borderRadius','padding','margin','boxShadow','opacity','pointerEvents','outlineStyle']
                        .map(key=>getComputedStyle(menu)[key])],
                glyph:[glyph.textContent,getComputedStyle(glyph).fontFamily,getComputedStyle(glyph).fontSize]
            }};
        }})()""")

    original_dark = ev('state.settings.darkMode')
    for dark in [False, True]:
        ev(f'state.settings.darkMode={str(dark).lower()}; uiUtilsV136.applyDarkMode()')
        comparison = []
        for row, main, menu in [(chat_row, '.chat-sidebar-item-open', '.chat-sidebar-item-menu'),
                                (row1, '.document-library-file', '.document-library-more')]:
            ev('document.activeElement.blur()')
            move_mouse(prefix + 'title')
            normal = row_style(row, main, menu)
            move_mouse(f'{row} {main}')
            hovered = row_style(row, main, menu)
            move_mouse(f'{row} {menu}')
            circle = row_style(row, main, menu)
            assert normal['row'][0] != hovered['row'][0] == circle['row'][0]
            assert hovered['mainBackground'] == hovered['menu'][3] == 'rgba(0, 0, 0, 0)'
            assert circle['menu'][3] != hovered['menu'][3]
            pointer(f'{row} {menu}', False)
            move_mouse(prefix + 'title')
            expanded = row_style(row, main, menu)
            assert ev(f"""document.querySelector({json.dumps(row + ' ' + menu)}).getAttribute('aria-expanded')==='true' &&
                document.querySelector('#document-library-preview').hidden""")
            key('Escape', 27)
            wait(f"document.activeElement===document.querySelector({json.dumps(row + ' ' + menu)})",
                 'Escape restores menu focus')
            focused = row_style(row, main, menu)
            comparison.append([normal, hovered, circle, expanded, focused])
        assert comparison[0] == comparison[1], comparison
    ev(f'state.settings.darkMode={str(original_dark).lower()}; uiUtilsV136.applyDarkMode()')
    checks.append('sidebar and library match in both themes for idle, row hover, menu hover, open and keyboard focus')
    search_layout = ev("""(() => {
        const get=id=>document.getElementById('document-library-'+id);
        const list=get('collection').getBoundingClientRect(), bar=get('search').getBoundingClientRect();
        const mode=get('search-mode').getBoundingClientRect();
        return { listWidth:list.width, workspaceWidth:get('workspace').clientWidth, barWidth:bar.width,
            embedded:get('search').contains(get('search-mode')) && mode.right<=bar.right && mode.left>=bar.left+bar.width/2,
            mode:get('search-mode').value, status:get('search-status').textContent };
    })()""")
    assert abs(search_layout['listWidth'] - search_layout['workspaceWidth']) < 1, search_layout
    assert 480 <= search_layout['barWidth'] <= 520 and search_layout['embedded'], search_layout
    assert search_layout['mode'] == 'name' and not search_layout['status'], search_layout
    for dark in [False, True]:
        ev(f'state.settings.darkMode={str(dark).lower()}; uiUtilsV136.applyDarkMode()')
        move_mouse(prefix + 'title')
        appearance = ev("""(async () => {
            const controls=document.querySelectorAll('#document-library-search-mode, #document-library-sort');
            await Promise.all([...controls].flatMap(control=>control.getAnimations())
                .map(animation=>animation.finished.catch(()=>{})));
            const style=id=>getComputedStyle(document.getElementById(id));
            const standard=style('theme-color-mode-select'), scope=style('document-library-search-mode'),
                sort=style('document-library-sort'), bar=style('document-library-search');
            const ctx=document.createElement('canvas').getContext('2d');
            const lightness=color=>{
                ctx.fillStyle=color; ctx.fillRect(0,0,1,1);
                const [r,g,b]=ctx.getImageData(0,0,1,1).data;
                return .2126*r+.7152*g+.0722*b;
            };
            const delta=lightness(scope.backgroundColor)-lightness(bar.backgroundColor);
            const visual=control=>Object.fromEntries(['appearance','backgroundImage','backgroundPosition','borderRadius',
                'borderStyle','borderWidth','fontSize','lineHeight','color'].map(key=>[key,control[key]]));
            return {delta, standard:visual(standard), scope:visual(scope), sort:visual(sort),
                borders:[standard.borderColor,sort.borderColor], rightPadding:[scope.paddingRight,sort.paddingRight]};
        })()""")
        assert 0 < appearance['delta'] < 18 and appearance['standard']['backgroundImage'] != 'none', appearance
        assert appearance['scope'] == appearance['sort'] == appearance['standard'], appearance
        assert len(set(appearance['borders'])) == len(set(appearance['rightPadding'])) == 1, appearance
        ev("document.querySelector('#document-library-query').focus()")
        assert ev("""(() => {
            const style=getComputedStyle(document.querySelector('#document-library-search'));
            return uiUtilsV136.colorToHex(style.borderTopColor)===style.getPropertyValue('--text-link').trim().toLowerCase();
        })()"""), 'Text input retains the search bar focus border'
        key('Tab', 9)
        assert ev("""(() => {
            const active=document.activeElement, bar=getComputedStyle(document.querySelector('#document-library-search'));
            const scope=getComputedStyle(active);
            return active.id==='document-library-search-mode' && active.matches(':focus-visible') &&
                scope.outlineStyle==='solid' && scope.outlineOffset==='-2px' &&
                uiUtilsV136.colorToHex(scope.outlineColor)===scope.getPropertyValue('--text-link').trim().toLowerCase() &&
                bar.borderTopColor===getComputedStyle(document.querySelector('#document-library-sort')).borderTopColor &&
                bar.outlineStyle==='none';
        })()"""), 'Keyboard scope focus is inset and leaves the surrounding bar border neutral'
        key('Tab', 9)
        assert ev("""document.activeElement.id==='document-library-sort' &&
            getComputedStyle(document.activeElement).outlineStyle==='solid'""")
        pointer(prefix + 'search-mode', False)
        pointer_focus = ev("""(() => {
            const scope=document.querySelector('#document-library-search-mode');
            return {active:document.activeElement.id, visible:scope.matches(':focus-visible'),
                outline:getComputedStyle(scope).outlineStyle};
        })()""")
        assert pointer_focus['active'] == 'document-library-search-mode' and pointer_focus['outline'] == 'none', pointer_focus
        key('Escape', 27)
        ev('document.activeElement.blur()')
    ev(f'state.settings.darkMode={str(original_dark).lower()}; uiUtilsV136.applyDarkMode()')
    checks.append('standard select arrow and border, light/dark inset contrast and keyboard/pointer focus')
    type_search('案内')
    ev("""window.libraryLayoutTransitions=0;
        document.querySelector('.document-library-layout').addEventListener('transitionrun',event=>{
            if(event.propertyName==='grid-template-columns') window.libraryLayoutTransitions++;
        });""")
    pointer(row1 + ' .document-library-file', False)
    wait("document.querySelector('#document-library-extracts pre')", 'Desktop preview loaded')
    assert ev("document.querySelector('#document-library-add').offsetWidth"), 'Upload is visible during desktop extraction'
    selected_colors = ev("""(async () => {
        const sidebar=document.querySelector('#document-library-open');
        await Promise.all(sidebar.getAnimations().map(animation=>animation.finished.catch(()=>{})));
        const selected=document.querySelector('#document-library-list [data-selected=true]');
        return [getComputedStyle(selected).backgroundColor,getComputedStyle(sidebar).backgroundColor];
    })()""")
    assert selected_colors[0] == selected_colors[1], selected_colors
    wait("""(() => {
        const bounds=id=>document.querySelector('#'+id).getBoundingClientRect();
        const library=bounds('document-library-workspace'), list=bounds('document-library-collection'),
            preview=bounds('document-library-preview'), sidebar=bounds('chat-history-sidebar');
        return library.left===sidebar.right && list.width>=310 && list.right<=preview.left && preview.width>=300 &&
            library.right===innerWidth && !document.querySelector('#chat-history-sidebar').inert;
    })()""", 'Desktop list and detail fill the space beside the permanent sidebar')
    assert ev('window.libraryLayoutTransitions===1')
    pointer(row2 + ' .document-library-file', False)
    wait("document.querySelector('#document-library-preview-title').textContent==='店舗案内.html'", 'Split preview switches documents')
    assert ev('window.libraryLayoutTransitions===1')
    pointer(row2 + ' .document-library-file', False)
    wait("document.querySelector('#document-library-preview').hidden", 'Clicking the active row closes the preview')
    pointer(row1 + ' .document-library-file', False)
    wait("document.querySelector('#document-library-preview').clientWidth>=300", 'Preview close is in view')
    pointer(prefix + 'detail-close', False)
    wait("document.querySelector('#document-library-preview').hidden", 'Desktop close button returns to the collection')
    assert ev("document.querySelector('#document-library-query').value==='案内'")
    type_search('')
    pointer(row1 + ' .document-library-file', False)
    client.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    try:
        pointer(row1 + ' .document-library-more', False)
        pointer(prefix + 'menu [role=menuitem]:first-child', False)
        root = client.call('DOM.getDocument')['root']['nodeId']
        input_node = client.call('DOM.querySelector', {'nodeId': root, 'selector': prefix + 'replacement'})['nodeId']
        replacement = Path(__file__).resolve().parent / 'fixtures/document-analysis/replacement.md'
        client.call('DOM.setFileInputFiles', {'nodeId': input_node, 'files': [str(replacement)]})
    finally:
        client.call('Page.setInterceptFileChooserDialog', {'enabled': False})
    wait("document.querySelector('#document-library-extracts pre')?.textContent.includes('４５日以内')", 'Replacement previews the new version')
    assert ev(f"appLogic.loadChat({chat1}, {{scrollAfterLoad:false}}).then(result=>result.ok)")
    assert ev(f"document.querySelector('.chat-sidebar-item[data-chat-id=\"{chat1}\"]').getAttribute('aria-current')==='page' && "
              "!document.querySelector('#document-library-open').hasAttribute('aria-current')")
    open_reference(False)
    wait("document.querySelector('.document-library-extract[data-highlight=true]')?.textContent.includes('３０日以内')",
         'Reference still opens version one after replacement')
    close_workspace(False)
    open_workspace(False)
    wait(f"document.querySelector({json.dumps(row1)})", 'Latest document available')
    pointer(row1 + ' .document-library-more', False)
    pointer(prefix + 'menu [role=menuitem]:last-child', False)
    wait("document.querySelector('#confirmDialog').open", 'Delete uses app confirmation')
    click('#confirmDialog .dialog-cancel-btn')
    wait("!document.querySelector('#document-library-add').disabled", 'Canceled confirmation leaves management actions ready')
    assert ev(f"(async()=>!!(await dbUtils.getLibraryDocument({json.dumps(first)})))()")
    pointer(row1 + ' .document-library-more', False)
    pointer(prefix + 'menu [role=menuitem]:last-child', False)
    wait("document.querySelector('#confirmDialog').open", 'Confirm the selected version')
    click('#confirmDialog .dialog-ok-btn')
    wait(f"!document.querySelector({json.dumps(row1)})", 'Confirmed delete refreshes the list')
    assert ev(f"""(async()=> !(await dbUtils.getLibraryDocument({json.dumps(first)})) &&
        !(await dbUtils.getChatDocuments({chat1})).length && !!(await dbUtils.getLibraryDocument({json.dumps(second)})))()""")
    close_workspace(False)
    open_reference(False)
    wait("document.querySelector('#document-library-preview-status').textContent.includes('利用できません')",
         'A deleted reference remains unavailable')
    close_workspace(False)
    checks.append('tablet sidebar, desktop two panes, versioned replacement, confirmed deletion')

    open_workspace(False)
    pointer('#new-chat-btn', False)
    wait("document.querySelector('#confirmDialog').open", 'New chat from library confirms the existing conversation')
    click('#confirmDialog .dialog-ok-btn')
    wait("state.currentChatId===null && document.querySelector('#document-library-workspace').hidden", 'New chat returns from the library')
    assert ev(f"dbUtils.getChat({chat1}).then(Boolean)"), 'New chat keeps the previous conversation'

    def chat_menu(chat_id, action):
        row = f'#chat-sidebar-scroll [data-chat-id="{chat_id}"]'
        wait(f"document.querySelector({json.dumps(row)})", 'Chat row is available')
        position = ev(f"""(() => {{
            const row=document.querySelector({json.dumps(row)});
            row.scrollIntoView({{block:'nearest'}});
            const rect=row.getBoundingClientRect();
            return {{x:rect.left+rect.width/2,y:rect.top+rect.height/2}};
        }})()""")
        client.call('Input.dispatchMouseEvent', {'type':'mouseMoved', **position})
        pointer(row + ' .chat-sidebar-item-menu', False)
        item = f'#history-item-menu [data-history-menu-action="{action}"]'
        wait(f"!document.querySelector({json.dumps(item)}).hidden", 'The chat menu exposes its operation')
        pointer(item, False)

    client.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    try:
        before = ev('dbUtils.getAllChats().then(chats=>chats.length)')
        pointer('#chat-sidebar-history-menu-btn', False)
        assert ev("[...document.querySelectorAll('#history-item-menu button:not([hidden])')].map(item=>item.dataset.historyMenuAction).join()==='import'")
        pointer('.chat-sidebar-brand', False)
        wait("document.querySelector('#history-item-menu').classList.contains('hidden')", 'Outside click closes the history menu')
        pointer('#chat-sidebar-history-menu-btn', False)
        pointer('#import-history-btn', False)
        ev("document.querySelector('#import-history-input').dispatchEvent(new Event('cancel'))")
        assert ev(f'dbUtils.getAllChats().then(chats=>chats.length==={before})')
        pointer('#chat-sidebar-history-menu-btn', False)
        pointer('#import-history-btn', False)
        ev("""const transfer=new DataTransfer();
            transfer.items.add(new File(['<|#|user|#|>固有の履歴本文<|#|/user|#|>'],'履歴検証.txt',{type:'text/plain'}));
            const input=document.querySelector('#import-history-input');
            input.files=transfer.files;
            input.dispatchEvent(new Event('change',{bubbles:true}));""")
    finally:
        client.call('Page.setInterceptFileChooserDialog', {'enabled': False})
    wait("document.querySelector('#alertDialog').open", 'Existing import completed')
    click('#alertDialog .dialog-ok-btn')
    imported = ev("dbUtils.getAllChats().then(chats=>chats.find(chat=>chat.title.includes('履歴検証')).id)")
    wait(f"document.querySelector('#chat-sidebar-list [data-chat-id=\"{imported}\"]')", 'Import refreshes sidebar')
    pointer('#chat-sidebar-search-toggle', False)
    ev("""const historyQuery=document.querySelector('#chat-sidebar-search-input');historyQuery.value='固有の履歴本文';
        historyQuery.dispatchEvent(new Event('input',{bubbles:true}));""")
    wait("document.querySelectorAll('#chat-sidebar-list .chat-sidebar-item').length===1", 'History search matches message body')
    pointer(f'#chat-sidebar-list [data-chat-id="{imported}"] .chat-sidebar-item-open', False)
    wait(f'state.currentChatId==={imported}', 'A search result opens the conversation')
    pointer('#chat-sidebar-search-toggle', False)
    wait("document.querySelectorAll('#chat-sidebar-list .chat-sidebar-item').length>1 && chatSidebarUiState.hasLoadedAll",
         'Closing search restores the complete list')
    chat_menu(imported, 'pin')
    wait(f'dbUtils.getChat({imported}).then(chat=>chat.isPinned)', 'Pinning still saves')
    chat_menu(imported, 'rename')
    wait("document.querySelector('#promptDialog').open", 'Rename prompts for a title')
    ev("document.querySelector('#promptDialog .dialog-input').value='改名した履歴'")
    click('#promptDialog .dialog-ok-btn')
    wait(f'dbUtils.getChat({imported}).then(chat=>chat.title==="改名した履歴")', 'Rename still saves')
    ev("""window.originalExportAnchor=HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click=function(){ if(this.download) window.exportedHistoryName=this.download;
            else return window.originalExportAnchor.call(this); };""")
    try:
        chat_menu(imported, 'export')
        wait("document.querySelector('#confirmDialog').open", 'Export asks for confirmation')
        click('#confirmDialog .dialog-ok-btn')
        wait("window.exportedHistoryName?.endsWith('.txt')", 'Existing export creates a text file')
    finally:
        ev('HTMLAnchorElement.prototype.click=window.originalExportAnchor')
    chat_menu(imported, 'duplicate')
    wait(f"dbUtils.getAllChats().then(chats=>chats.some(chat=>chat.id!=={imported}&&chat.title.includes('改名した履歴')))", 'Duplicate completes')
    duplicate = ev(f"dbUtils.getAllChats().then(chats=>chats.find(chat=>chat.id!=={imported}&&chat.title.includes('改名した履歴')).id)")
    wait(f"document.querySelector('#chat-sidebar-list [data-chat-id=\"{duplicate}\"]')", 'Duplicate appears in history')
    chat_menu(duplicate, 'delete')
    wait("document.querySelector('#confirmDialog').open", 'Individual delete uses confirmation')
    click('#confirmDialog .dialog-ok-btn')
    wait(f'dbUtils.getChat({duplicate}).then(chat=>!chat)', 'Individual delete removes the selected chat')

    bulk = ev(f"""(async()=>{{
        const id=await dbUtils.saveChat(null,{{id:807702,title:'一括削除の検証',createdAt:100,messages:[]}});
        await dbUtils.setChatDocuments(id,[{json.dumps(second)}]);
        return id;
    }})()""")
    pointer('#goto-settings-btn', False)
    wait("state.currentScreen==='settings'", 'Settings opens from the header')
    click('[data-settings-category="other"]')
    wait("document.querySelector('#history-delete-mode-btn').getClientRects().length", 'History management is available')
    pointer('#history-delete-mode-btn', False)
    wait(f"document.querySelector('#history-delete-list input[value=\"{bulk}\"]')", 'Bulk delete lists saved chats')
    pointer(f'#history-delete-list input[value="{bulk}"]', False)
    pointer(f'#history-delete-list input[value="{imported}"]', False)
    pointer('#history-delete-confirm-btn', False)
    wait("document.querySelector('#confirmDialog').open", 'Bulk deletion confirms only the checked chats')
    click('#confirmDialog .dialog-cancel-btn')
    wait("!document.querySelector('#history-delete-confirm-btn').disabled", 'Cancel preserves selected chats')
    assert ev(f'dbUtils.getChat({bulk}).then(Boolean)')
    pointer('#history-delete-confirm-btn', False)
    wait("document.querySelector('#confirmDialog').open", 'Bulk delete confirms again')
    click('#confirmDialog .dialog-ok-btn')
    wait(f"state.currentScreen==='chat' && state.currentChatId===null && dbUtils.getChat({bulk}).then(chat=>!chat)", 'Deleting the current chat returns to a new conversation')
    assert ev(f"""(async()=> !(await dbUtils.getChat({imported})) && (await dbUtils.getChatDocuments({chat2}))[0].id==={json.dumps(second)} &&
        (await dbUtils.getLibraryOriginal({json.dumps(second)},1)).blob.size>0 && !(await dbUtils.getChatDocuments({bulk})).length)()""")
    stale = ev("dbUtils.saveChat(null,{id:807703,title:'選択後に置き換わる履歴',createdAt:101,messages:[]})")
    click('#goto-settings-btn')
    wait("state.currentScreen==='settings'", 'Reopen history management')
    click('[data-settings-category="other"]')
    click('#history-delete-mode-btn')
    wait(f"document.querySelector('#history-delete-list input[value=\"{stale}\"]')", 'Snapshot captured before replacement')
    pointer(f'#history-delete-list input[value="{stale}"]', False)
    pointer('#history-delete-confirm-btn', False)
    wait("document.querySelector('#confirmDialog').open", 'Deletion awaits confirmation')
    ev(f"""(async()=>{{
        const old=await dbUtils.getChat({stale});
        const store=dbUtils._getStore(CHATS_STORE,'readwrite');
        store.put({{...old,title:'同期で置き換えた履歴',recordGenerationId:DocumentLibrary.uniqueId()}});
        await new Promise((resolve,reject)=>{{store.transaction.oncomplete=resolve;store.transaction.onabort=reject;}});
    }})()""")
    click('#confirmDialog .dialog-ok-btn')
    wait("document.querySelector('#history-delete-status').textContent.includes('削除できませんでした')", 'Stale selection fails closed')
    assert ev(f'dbUtils.getChat({stale}).then(chat=>chat.title==="同期で置き換えた履歴")')
    click('#history-delete-cancel-btn')
    click('#back-to-chat-from-settings')
    wait("state.currentScreen==='chat'", 'Return from history management')
    checks.append('sidebar new chat, import and row actions, bulk delete protects stale IDs, unselected chats and shared files')

    ev("""(async()=>{
        for(let i=0;i<45;i++) {
            const number=String(i).padStart(2,'0');
            await dbUtils.addLibraryDocument(new File(['長いファイル名の試験'],
                '長い日本語ファイル名と英数字_'+number+'_'.repeat(5)+'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3)+'.txt'));
        }
    })()""")
    viewport(320, 650, True)
    open_workspace(True)
    wait("document.querySelectorAll('#document-library-list li').length===47", 'Long and numerous files rendered')
    assert ev("""(() => {
        const viewport=document.querySelector('#document-library-workspace');
        const name=document.querySelector('#document-library-list .document-library-file-name');
        const more=document.querySelector('#document-library-list .document-library-more').getBoundingClientRect();
        return name.scrollWidth>name.clientWidth && more.right<=innerWidth &&
            more.width===parseFloat(getComputedStyle(viewport).getPropertyValue('--sidebar-menu-size')) &&
            getComputedStyle(name).textTransform==='none' && getComputedStyle(name.parentElement).boxShadow==='none' &&
            viewport.scrollWidth===viewport.clientWidth && document.documentElement.scrollWidth===innerWidth;
    })()"""), 'Long names truncate without moving the row menu or producing horizontal scroll'
    pointer('#document-library-list li:last-child .document-library-more', True)
    wait("!document.querySelector('#document-library-menu').hidden", 'Last row menu is reachable by touch')
    assert ev("""(() => {
        const bounds=document.querySelector('#document-library-menu').getBoundingClientRect();
        return bounds.left>=0 && bounds.right<=innerWidth && bounds.top>=0 && bounds.bottom<=innerHeight;
    })()""")
    for event in ('keyDown','keyUp'):
        client.call('Input.dispatchKeyEvent', {'type':event,'key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
    wait("document.querySelector('#document-library-menu').hidden && document.activeElement.matches('.document-library-more')",
         'Escape closes the menu and restores trigger focus')
    search_mode('all')
    type_search('長い日本語')
    ev("""const sort = document.querySelector('#document-library-sort');
        sort.value='updated'; sort.dispatchEvent(new Event('change'));""")
    wait("document.querySelectorAll('#document-library-list li').length===45", 'Combined search includes filename matches')
    ev("document.querySelector('#document-library-collection-scroll').scrollTop=250")
    pointer('#document-library-list li:nth-child(9) .document-library-file', True)
    wait("document.querySelector('#document-library-mobile-title').textContent.startsWith('長い日本語')", 'Long filename shown in mobile header')
    assert ev("""(() => {
        const title=document.querySelector('#document-library-title');
        const search=document.querySelector('#document-library-mobile-search').getBoundingClientRect();
        return title.scrollWidth>title.clientWidth && search.right<=innerWidth && search.width>=40;
    })()""")
    pointer(prefix + 'detail-close', True)
    wait("""document.querySelector('#document-library-preview').hidden &&
        document.querySelector('#document-library-collection-scroll').scrollTop===250 &&
        document.querySelector('#document-library-sort').value==='updated' &&
        document.querySelector('#document-library-search-mode').value==='all' &&
        document.querySelector('#document-library-query').value==='長い日本語'""", 'Mobile back restores sorting, filtering and scroll')
    close_workspace(True)
    open_picker(True)
    assert ev("""(() => {
        const count=document.querySelector('#document-library-picker-count');
        const rect=count.getBoundingClientRect();
        return count.textContent==='0件' && rect.width>0 && rect.right<=count.parentElement.getBoundingClientRect().right;
    })()"""), 'Count remains visible at 320px'
    pointer(prefix + 'picker-close', True)
    ev("appLogic.updateLocalUiSetting('enableSwipeNavigation',true)")
    open_workspace(True)
    for i in range(8):
        client.call('Input.dispatchTouchEvent', {'type':'touchMove' if i else 'touchStart',
            'touchPoints':[{'x':6+i*16,'y':310,'id':200}]})
        time.sleep(0.02)
    client.call('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    wait("chatSidebarUiState.isOpen && !elements.documentLibraryWorkspace.hidden", 'Edge swipe opens sidebar over mobile library')
    check_sidebar_alignment()
    assert ev(library_current), 'The library stays current when the overlay sidebar is reopened'
    pointer('#new-chat-btn', True)
    wait("document.querySelector('#confirmDialog').open", 'New chat from mobile library')
    click('#confirmDialog .dialog-ok-btn')
    wait("!chatSidebarUiState.isOpen && elements.documentLibraryWorkspace.hidden && state.currentChatId===null", 'Return to the new chat')
    viewport(1280, 900, False)

    open_picker(False)
    diagnostics = client.capture_diagnostics
    client.capture_diagnostics = True
    chooser_offset = len(client.diagnostic_events)
    client.call('Page.enable')
    client.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    try:
        pointer(prefix + 'picker-upload', False)
        ev('true')
        chooser = next((event['params'] for event in client.diagnostic_events[chooser_offset:]
                        if event['method'] == 'Page.fileChooserOpened'), None)
        assert chooser and chooser['mode'] == 'selectMultiple', 'Upload opens a native multi-file chooser'
        fixture = Path(__file__).resolve().parent / 'fixtures/document-analysis/shift-jis.txt'
        client.call('DOM.setFileInputFiles', {'backendNodeId': chooser['backendNodeId'], 'files': [str(fixture)]})
    finally:
        client.call('Page.setInterceptFileChooserDialog', {'enabled': False})
        client.capture_diagnostics = diagnostics
    wait("document.querySelector('#document-library-picker-count').textContent==='1件'", 'File chooser uploads and links to a draft chat')
    paged_text = '照合キーワード 一\n\n' + '\n\n'.join(f'段落{i} ' + '文章の分割表示を確認します。' * 50 for i in range(1, 10))
    dropped = drop_files(prefix + 'picker-list li', [
        ['upload-first.txt', paged_text], ['upload-second.txt', '照合キーワード 二'], ['invalid.bin', 'invalid']
    ])
    assert all(dropped.values()), dropped
    wait("""document.querySelector('#document-library-picker-count').textContent==='3件' &&
        document.querySelector('#document-library-picker-notice').textContent.includes('invalid.bin')""",
         'Picker drop attaches both valid files and reports the invalid one')
    ev("""window.realSetChatDocuments=dbUtils.setChatDocuments;
        dbUtils.setChatDocuments=function(id, ids, owner, mode) {
            return window.realSetChatDocuments.call(this,id,ids,{...owner,recordGenerationId:'changed'},mode);
        };""")
    drop_files(prefix + 'picker-title', [['link-failed.txt', 'リンク保存失敗']])
    wait("document.querySelector('#document-library-picker-notice').textContent.includes('チャットに追加できません')",
         'A failed link explains that its original remains saved')
    ev('dbUtils.setChatDocuments=window.realSetChatDocuments')
    assert ev("""(async()=>{
        const library=await dbUtils.listLibraryDocuments(), links=await dbUtils.getChatDocuments(state.currentChatId);
        const names=links.map(item=>item.fileName).sort().join(',');
        return names==='shift-jis.txt,upload-first.txt,upload-second.txt' &&
            links.every(link=>library.some(entry=>entry.id===link.id)) &&
            library.some(item=>item.fileName==='link-failed.txt') &&
            !library.some(item=>item.fileName==='invalid.bin') && !state.pendingAttachments.length;
    })()""")
    pointer(prefix + 'picker-close', False)
    checks.append('chat chooser, batch drop, partial failure, shared originals and atomic link failure')

    open_workspace(False)
    wait("document.querySelector('#document-library-list li')", 'Library ready before drop')
    x, y = ev("""(() => {
        const rect=document.querySelector('#document-library-search').getBoundingClientRect();
        return [Math.round(rect.left+15),Math.round(rect.top+15)];
    })()""")
    pdf = Path(__file__).resolve().parent / 'fixtures/document-analysis/japanese.pdf'
    drag = {'x': x, 'y': y, 'data': {'items': [], 'files': [str(pdf)], 'dragOperationsMask': 1}}
    for event in ('dragEnter', 'dragOver'):
        client.call('Input.dispatchDragEvent', {'type': event, **drag})
    assert ev("document.querySelector('#document-library-workspace').hasAttribute('data-file-drop')")
    client.call('Input.dispatchDragEvent', {'type': 'drop', **drag})
    wait("document.querySelector('#document-library-list button[title=\"japanese.pdf\"]')", 'Native PDF drop over search bar adds a library row')
    assert ev("""(async()=>!document.querySelector('#document-library-workspace').hasAttribute('data-file-drop') &&
        !(await dbUtils.getChatDocuments(state.currentChatId)).some(entry=>entry.format==='pdf'))()""")
    pointer('#document-library-list button[title="japanese.pdf"]', False)
    wait("document.querySelector('#document-library-pdf-viewport canvas[aria-label=\"PDF ページ 1\"]')",
         'First original PDF page rendered')
    assert ev("!document.querySelector('#document-library-add').offsetWidth"), 'Original PDF still hides upload'
    assert ev("""(() => {
        const canvas=document.querySelector('#document-library-pdf-viewport canvas');
        const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        return pixels.some((channel,i)=>i%4===0 && channel<128 && pixels[i+3]===255);
    })()"""), 'PDF canvas contains actual visible content'
    pointer(prefix + 'pdf-next', False)
    wait("document.querySelector('#document-library-pdf-viewport canvas[aria-label=\"PDF ページ 2\"]')", 'PDF next page')
    pointer(prefix + 'pdf-previous', False)
    wait("document.querySelector('#document-library-pdf-viewport canvas[aria-label=\"PDF ページ 1\"]')", 'PDF previous page')
    ev("window.pdfWidthBefore=document.querySelector('#document-library-pdf-viewport canvas').width")
    pointer(prefix + 'pdf-zoom-in', False)
    wait("document.querySelector('#document-library-pdf-viewport canvas').width>window.pdfWidthBefore", 'PDF zoom increases resolution and width')
    pointer(prefix + 'desktop-search', False)
    type_search('30日以内', 'detail-')
    wait("document.querySelector('#document-library-detail-results button')?.textContent.includes('ページ 2')", 'PDF search finds the actual page')
    pointer(prefix + 'detail-results button', False)
    wait("document.querySelector('#document-library-pdf-viewport canvas[aria-label=\"PDF ページ 2\"]')", 'PDF search jumps to page two')
    pointer(prefix + 'show-extracts', False)
    wait("!document.querySelector('#document-library-extracted').hidden && document.querySelector('#document-library-extracts pre')", 'PDF extraction tab')
    assert ev("document.querySelector('#document-library-add').offsetWidth")
    pointer(prefix + 'show-original', False)
    wait("!document.querySelector('#document-library-original').hidden && document.querySelector('#document-library-pdf-viewport canvas')", 'PDF original tab')
    assert ev("!document.querySelector('#document-library-add').offsetWidth")
    click('#document-library-list button[title="upload-first.txt"]')
    assert ev("""document.querySelector('#document-library-pdf-viewport').childElementCount===0 &&
        document.querySelector('#document-library-detail-find').hidden &&
        document.querySelector('#document-library-show-original').disabled"""), 'Switching documents clears PDF and search results'
    ev("""(() => {
        const original=dbUtils.getLibraryOriginal;
        dbUtils.getLibraryOriginal=function(...args) {
            return new Promise(resolve=>window.releaseOldPdf=()=>{
                dbUtils.getLibraryOriginal=original;
                const result=original.apply(this,args);
                resolve(result);
                return result.then(()=>true);
            });
        };
    })()""")
    click('#document-library-list button[title="japanese.pdf"]')
    wait('window.releaseOldPdf', 'PDF original read is awaiting completion')
    click('#document-library-list button[title="upload-first.txt"]')
    ev('window.releaseOldPdf()')
    assert ev("""document.querySelector('#document-library-pdf-viewport').childElementCount===0 &&
        document.querySelector('#document-library-preview-title').textContent==='upload-first.txt'""")
    dropped = drop_files(prefix + 'collection-scroll', [
        ['照合キーワード.txt', 'ファイル名だけが一致'], ['another-hit.txt', '照合キーワード 三']
    ])
    assert all(dropped.values()), dropped
    wait("document.querySelector('#document-library-list button[title=\"another-hit.txt\"]')", 'Split library accepts multi-file drop')
    type_search('照合キーワード')
    assert ev("document.querySelectorAll('#document-library-list li').length===1")
    search_mode('body')
    wait("document.querySelectorAll('#document-library-list li').length===3", 'Body scope matches all three documents')
    search_mode('all')
    wait("document.querySelectorAll('#document-library-list li').length===4", 'All scope unions filename and body hits')
    type_search('絶対に一致しない文字列')
    type_search('照合キーワード')
    wait("document.querySelectorAll('#document-library-list li').length===4", 'Newest query wins after rapid typing')
    type_search('')
    assert ev("""document.querySelectorAll('#document-library-list li').length>45 &&
        !document.querySelector('#document-library-search-status').textContent""")
    checks.append('native library drop, PDF canvas, page and zoom controls, PDF hit navigation and all search scopes')
    viewport(390, 760, True)
    pointer(prefix + 'detail-close', True)
    wait("document.querySelector('#document-library-preview').hidden", 'Header returns to the mobile collection after resize')
    pointer('#document-library-list button[title="japanese.pdf"]', True)
    wait("document.querySelector('#document-library-pdf-viewport canvas')", 'Mobile PDF original rendered')
    assert ev("!document.querySelector('#document-library-add').offsetWidth"), 'Mobile original still hides upload'
    dropped = drop_files(prefix + 'pdf-viewport', [['ignored-mobile.txt', '閲覧画面にドロップ']])
    assert dropped['ignoresUrl'] and dropped['canceled'] and not dropped['highlighted'], dropped
    assert ev("dbUtils.listLibraryDocuments().then(entries=>!entries.some(entry=>entry.fileName==='ignored-mobile.txt'))")
    pointer(prefix + 'show-extracts', True)
    wait("!document.querySelector('#document-library-extracted').hidden && document.querySelector('#document-library-extracts pre')",
         'Mobile PDF extraction tab')
    assert ev("!document.querySelector('#document-library-add').offsetWidth"), 'Mobile extraction hides upload'
    pointer(prefix + 'detail-close', True)
    wait("document.querySelector('#document-library-preview').hidden", 'Return from mobile PDF')
    pointer('#document-library-list button[title="upload-first.txt"]', True)
    wait("!document.querySelector('#document-library-pages').hidden", 'Long extraction has multiple pages')
    page_first = ev("document.querySelector('#document-library-page-number').textContent")
    pointer(prefix + 'next', True)
    assert ev("document.querySelector('#document-library-page-number').textContent") != page_first
    pointer(prefix + 'previous', True)
    assert ev("document.querySelector('#document-library-page-number').textContent") == page_first
    checks.append('mobile PDF tabs, view-only drop protection and extraction paging')

    close_workspace(True)
    viewport(1280, 900, False)
    click('#goto-settings-btn')
    wait("state.currentScreen==='settings'", 'Theme settings screen opened')
    click('[data-settings-category="appearance"]')
    wait("document.querySelector('#theme-color-mode-select').offsetWidth", 'Color settings are visible')
    assert ev("""!document.querySelector(`#new-chat-button-color-input, #reset-new-chat-button-color-btn,
        [data-source-id="new-chat-button-color-input"]`)""")
    ev("""(() => {
        const select=document.querySelector('#theme-color-mode-select');
        select.value='individual'; select.dispatchEvent(new Event('change',{bubbles:true}));
    })()""")
    wait("!document.querySelector('#other-button-color-input').disabled", 'Individual button color can be edited')
    ev("""(() => {
        const input=document.querySelector('#other-button-color-input');
        input.value='#a1316d'; input.dispatchEvent(new Event('input',{bubbles:true}));
    })()""")
    wait("""dbUtils.getSetting(SettingsV136.GLOBAL_KEY).then(record=>record.value.theme.otherButtonColor==='#a1316d')""",
         'Other button color saved by the settings control')
    click('#back-to-chat-from-settings')
    wait("state.currentScreen==='chat'", 'Returned to chat after saving colors')
    open_workspace(False)
    move_mouse(prefix + 'title')
    wait("""(() => {
        const style=getComputedStyle(document.querySelector('#document-library-add'));
        return uiUtilsV136.colorToHex(style.backgroundColor)==='#a1316d' &&
            uiUtilsV136.colorToHex(style.color)===style.getPropertyValue('--other-button-fg').trim().toLowerCase();
    })()""", 'Other button setting supplies both header button colors')
    move_mouse(prefix + 'add')
    wait("""(() => {
        const style=getComputedStyle(document.querySelector('#document-library-add'));
        return uiUtilsV136.colorToHex(style.backgroundColor)===style.getPropertyValue('--bg-button-hover').trim().toLowerCase() &&
            uiUtilsV136.colorToHex(style.color)===style.getPropertyValue('--other-button-hover-fg').trim().toLowerCase();
    })()""", 'Header button hover uses the Other button palette')
    viewport(320, 650, True)
    header_height = ev("document.querySelector('#document-library-workspace > .app-header').getBoundingClientRect().height")
    pointer('#document-library-list button[title="upload-first.txt"]', True)
    wait("!document.querySelector('#document-library-extracted').hidden", 'Compact extraction is open')
    assert ev(f"""(() => {{
        const header=document.querySelector('#document-library-workspace > .app-header');
        const bounds=name=>document.querySelector('#document-library-'+name).getBoundingClientRect();
        const back=document.querySelector('#goto-history-btn').getBoundingClientRect(), title=bounds('title'), search=bounds('mobile-search'), add=bounds('add');
        const center=box=>(box.top+box.bottom)/2;
        return getComputedStyle(header).display==='flex' && header.getBoundingClientRect().height==={header_height} &&
            add.width===0 && back.width>0 && title.width>=140 && search.width>0 &&
            back.right<=title.left && title.right<=search.left && search.right<=innerWidth &&
            Math.abs(center(back)-center(title))<1 && Math.abs(center(search)-center(title))<1;
    }})()"""), 'Compact extraction header has sidebar toggle, filename and search on one row'
    pointer(prefix + 'detail-close', True)
    wait("document.querySelector('#document-library-preview').hidden && document.querySelector('#document-library-add').offsetWidth",
         'Mobile list restores the upload button')
    checks.append('one-row mobile extraction header and upload visibility on return to the list')
    existing_replacements = ev("""document.querySelectorAll('#document-library-list button[title="replacement.md"]').length""")
    diagnostics = client.capture_diagnostics
    client.capture_diagnostics = True
    chooser_offset = len(client.diagnostic_events)
    client.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    try:
        pointer(prefix + 'add', True)
        ev('true')
        chooser = next((event['params'] for event in client.diagnostic_events[chooser_offset:]
                        if event['method'] == 'Page.fileChooserOpened'), None)
        assert chooser and chooser['mode'] == 'selectMultiple', 'Header button opens the native multi-file chooser'
        file = Path(__file__).resolve().parent / 'fixtures/document-analysis/replacement.md'
        client.call('DOM.setFileInputFiles', {'backendNodeId': chooser['backendNodeId'], 'files': [str(file)]})
    finally:
        client.call('Page.setInterceptFileChooserDialog', {'enabled': False})
        client.capture_diagnostics = diagnostics
    wait(f"""document.querySelectorAll('#document-library-list button[title="replacement.md"]').length==={existing_replacements + 1}""",
         'Header upload adds the selected file')
    close_workspace(True)
    viewport(1280, 900, False)
    click('#goto-settings-btn')
    wait("state.currentScreen==='settings'", 'Reopened color settings for reset')
    click('[data-settings-category="appearance"]')
    click('#reset-other-button-color-btn')
    wait("""dbUtils.getSetting(SettingsV136.GLOBAL_KEY).then(record=>
        record.value.theme.otherButtonColor===appLogic.normalizeGlobalThemeSettings({}).otherButtonColor)""",
         'Other button color reset persists')
    click('#back-to-chat-from-settings')
    wait("state.currentScreen==='chat'", 'Back after color reset')
    open_workspace(False)
    wait("""uiUtilsV136.colorToHex(getComputedStyle(document.querySelector('#document-library-add')).backgroundColor)==='#1976d2'""",
         'Header button reflects the restored default color')
    ev("appLogic.updateLocalUiSetting('enableWideMode',false).then(()=>appLogic.applyWideMode())")
    wait("!document.body.classList.contains('wide-mode-enabled')", 'Desktop regular mode')
    pointer('#document-library-list button[title="upload-first.txt"]', False)
    assert ev("""!document.querySelector('#document-library-extracted').hidden &&
        document.querySelector('#document-library-add').offsetWidth"""), 'Upload remains visible in regular desktop extraction'
    checks.append('header upload on touch, custom normal and hover colors, and reset')
    return f'ALL PASSED ({len(checks)+1} document library UI scenarios: {"; ".join(checks)}; 320px overflow and keyboard menu)'

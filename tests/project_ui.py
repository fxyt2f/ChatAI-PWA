"""Project workflows through the real app, Chrome and IndexedDB."""
import json
import time


def run(client, url):
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
            dialogs: [...document.querySelectorAll('dialog[open]')].map(x=>x.id),
            sidebar: [chatSidebarUiState.mode, chatSidebarUiState.isOpen, chatSidebarUiState.showAll],
            chat: state.currentChatId, draft: document.querySelector('#user-input').value, history: history.state
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

    def viewport(width, mobile):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': 800, 'deviceScaleFactor': 1, 'mobile': mobile,
        })
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': mobile})

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
    assert ev("document.querySelectorAll('.project-folder').length===0")
    click('#project-create')
    change('#project-dialog-fields input', '  ')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-dialog-notice').textContent.includes('プロジェクト名')", 'blank name rejected')
    click('#project-dialog-cancel')
    alpha = create('第一プロジェクト', '最初の説明')
    assert ev("document.querySelector('#project-chats').textContent.includes('チャットはありません') && "
              "document.querySelector('#project-documents').textContent.includes('共有資料はありません')")
    assert ev("document.querySelector('#project-description').textContent==='最初の説明'")
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

    member, loose = ev(f"""(async()=>{{
        const member=await dbUtils.saveChat(null,{{title:'共通語 所属チャット',messages:[{{role:'user',content:'検証文'}}],
            isPinned:true,pinnedAt:Date.now(),pinStateUpdatedAt:Date.now(),updatedAt:Date.now()}},{{skipPush:true}});
        const loose=await dbUtils.saveChat(null,{{title:'共通語 未所属チャット',messages:[]}},{{skipPush:true}});
        await dbUtils.setChatProject(member,{json.dumps(alpha)});
        return [member,loose];
    }})()""")
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{loose}"]')""", 'recent lists unassigned chat')
    assert ev(f"""!document.querySelector('#chat-sidebar-list [data-chat-id="{member}"]')""")
    click(folder(alpha, 'expand'))
    wait(f"""document.querySelector('#project-sidebar-list [data-chat-id="{member}"] .chat-pin-icon')""", 'expanded folder shows pinned chat')
    click(folder(alpha, 'expand'))
    assert ev(f"document.querySelector({json.dumps(folder(alpha, 'expand'))}).getAttribute('aria-expanded')==='false'")
    click('#project-all-history')
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{member}"] .chat-sidebar-item-snippet')?.textContent==='第一・編集済み'""",
         'full history includes project name')
    click('#chat-sidebar-search-toggle')
    change('#chat-sidebar-search-input', '共通語')
    wait("document.querySelectorAll('#chat-sidebar-list .chat-sidebar-item').length===2", 'search includes both chats')
    assert ev(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{member}"] .chat-sidebar-item-snippet').textContent==='第一・編集済み'""")
    click('#chat-sidebar-search-toggle')
    wait(f"""!document.querySelector('#chat-sidebar-list [data-chat-id="{member}"]') && !document.querySelector('#project-sidebar').hidden""",
         'clear search returns to recent')
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
    wait(f"""document.querySelector('#chat-sidebar-list [data-chat-id="{member}"] .chat-pin-icon')""", 'detached chat returns to recent')
    click('#project-add-chat')
    wait("document.querySelector('#project-dialog-fields input[type=radio]')", 'existing chat chooser loaded')
    change('#project-dialog-fields input[type=search]', '所属チャット')
    ev("""[...document.querySelectorAll('#project-dialog-fields label')].find(label=>label.textContent==='共通語 所属チャット').querySelector('input').click()""")
    click('#project-dialog-submit')
    wait(f"""document.querySelector('#project-chats [data-chat-id="{member}"]')""", 'add existing chat from chooser')
    checks.append('recent, all history, search, folder selection, add, move, unlink and pin preservation')

    doc = ev("""dbUtils.addLibraryDocument(new File(['共有ファイル本文'], '共有資料.md')).then(entry=>entry.id)""")
    ev(f'dbUtils.setChatDocuments({member},[{json.dumps(doc)}])')
    click('#project-add-document')
    wait("document.querySelector('#project-dialog-fields input[type=checkbox]')", 'library chooser loaded')
    click('#project-dialog-fields input[type=checkbox]')
    click('#project-dialog-submit')
    wait("document.querySelector('#project-documents').textContent.includes('共有資料.md')", 'existing original shared')
    click('#project-documents .chat-sidebar-item-open')
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
    assert ev("document.querySelector('#document-library-picker-heading').textContent==='チャット固有資料' && "
              "document.querySelector('#document-library-picker-project-list').textContent.includes('共有資料.md')")
    click('#document-library-picker-project-open')
    wait("document.querySelector('#project-documents .project-document-row')", 'manage shared documents')
    click('#project-documents .project-document-row button:last-child')
    wait("document.querySelector('#project-documents').textContent.includes('共有資料はありません')", 'share removed')
    assert ev(f"dbUtils.getChatDocuments({member}).then(items=>items[0].id==={json.dumps(doc)})")
    ev("""(() => {
        const input = document.querySelector('#project-files');
        input.click=()=>{};
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
    click('#project-new-chat')
    accept()
    wait("elements.projectWorkspace.hidden && state.currentChatId===null && "
         "document.querySelector('#project-draft-label').textContent.includes('第一・編集済み')", 'project draft started')
    assert ev(f'dbUtils.getAllChats().then(chats=>chats.length==={count})')
    change('#user-input', '第一の未送信下書き')
    open_project(beta, '第二プロジェクト')
    assert ev("document.querySelector('#user-input').value==='第一の未送信下書き'")
    click('#project-new-chat')
    accept()
    wait("document.querySelector('#project-draft-label').textContent.includes('第二プロジェクト')", 'different project draft')
    assert ev("!document.querySelector('#user-input').value")
    open_project(alpha, '第一・編集済み')
    click('#project-new-chat')
    accept()
    wait("document.querySelector('#user-input').value==='第一の未送信下書き'", 'original draft restored by project')
    click('#new-chat-btn')
    accept()
    wait("document.querySelector('#project-draft-label').hidden && state.currentChatId===null", 'normal draft has no project')
    assert ev("!document.querySelector('#user-input').value")
    plain = ev("""(async()=>{
        state.currentMessages.push({role:'user',content:'通常チャット'});
        return dbUtils.saveChat();
    })()""")
    assert ev(f'dbUtils.getChatProject({plain}).then(project=>!project)')
    open_project(alpha, '第一・編集済み')
    click('#project-new-chat')
    accept()
    wait("document.querySelector('#user-input').value==='第一の未送信下書き'", 'project draft still present')
    ev("""(async()=>{
        await dbUtils.saveSetting('apiConfigs',[{id:'project-ui-gem',provider:'gemini',apiKey:'mock',enabled:true,
            modelCandidates:['gemini-3-flash-preview'],defaultModel:'gemini-3-flash-preview'}]);
        await appLogic.loadGlobalSettings();
        await appLogic.setCurrentChatModelRef({apiConfigId:'project-ui-gem',modelName:'gemini-3-flash-preview'});
        await appLogic.saveGlobalSettingsV136({enableChatTitleGeneration:false,enableStreamingOutput:false});
        Object.assign(state.settings,{enableMemory:false,enableAutoRetry:false,enableApiTimeout:false,
            enableProofreading:false,enableThoughtTranslation:false,geminiEnableFunctionCalling:false});
        const original = window.fetch;
        window.fetch = (url, options) => {
            if (!String(url).includes('generativelanguage.googleapis.com') || !options?.body) return original(url, options);
            window.firstWireMembership=dbUtils.getChatProject(state.currentChatId);
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
        window.projectSend = appLogic.handleSend();
    })()""")
    wait("document.querySelector('#alertDialog').open", 'initial save failure shown')
    assert ev(f"""(async()=>state.currentChatId===null && !window.firstWireMembership &&
        (await dbUtils.getAllChats()).length==={count+1} && document.querySelector('#user-input').value==='第一の未送信下書き')()""")
    click('#alertDialog .dialog-ok-btn')
    ev('window.projectSend')
    ev('window.projectSend=appLogic.handleSend(); void 0')
    wait('window.finishProjectSend && state.isSending', 'first network request begins')
    project_chat = ev('state.currentChatId')
    assert ev(f'window.firstWireMembership.then(project=>project.id==={json.dumps(alpha)})')
    open_project(beta, '第二プロジェクト')
    ev('window.finishProjectSend(); window.projectSend')
    wait('!state.isSending', 'send completes under management workspace')
    assert ev(f"dbUtils.getChat({project_chat}).then(chat=>chat.messages.at(-1).content==='検証用回答')")
    checks.append('project and ordinary drafts, atomic initial send and failure, generation during navigation')

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
    mobile_id = ev("document.querySelector('.project-folder').dataset.projectId")
    click(folder(mobile_id, 'expand'), True)
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
    return 'ALL PASSED ({} project UI scenarios: {})'.format(len(checks), '; '.join(checks))

"""The information hub through the real app, using Chrome and isolated IndexedDB."""
import json
import time


def run(client, url):
    def ev(expression):
        call = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in call:
            raise RuntimeError(call['exceptionDetails']['exception'].get('description') or call['exceptionDetails'])
        return call.get('result', {}).get('value')

    def wait(condition, message):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if ev(condition):
                return
            time.sleep(.04)
        raise AssertionError(f'{message}: {ev("[location.hash, window.state?.currentScreen, window.state?.currentChatId]")}')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def key_activate(selector):
        target = f'document.querySelector({json.dumps(selector)})'
        ev(f'{target}.focus()')
        assert ev(f'document.activeElement === {target}')
        press_enter()

    def press_enter():
        params = {'key': 'Enter', 'code': 'Enter', 'windowsVirtualKeyCode': 13}
        client.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'text': '\r', **params})
        client.call('Input.dispatchKeyEvent', {'type': 'keyUp', **params})

    def viewport(width):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': 850, 'deviceScaleFactor': 1, 'mobile': width < 800,
        })
        wait(f'innerWidth === {width}', f'{width}px viewport')

    def category(name):
        key_activate(f'[data-information-category="{name}"]')
        wait(f"!document.querySelector('#information-panel-{name}').hidden", name)

    def field(label, text, group=None):
        return ev(f'hubFixture.field({json.dumps(label)}, {json.dumps(text)}, {json.dumps(group)})')

    def action(label, group=None):
        ev(f'hubFixture.action({json.dumps(label)}, {json.dumps(group)})')

    def open_hub(before=''):
        ev(before + " document.querySelector('#information-open-btn').click()")
        wait("state.currentScreen === 'information'", 'Hub opens through floating entry')
        assert ev("""(() => {
            const info = document.querySelector('#information-screen');
            const settings = document.querySelector('#settings-screen');
            return getComputedStyle(info).transitionProperty === getComputedStyle(settings).transitionProperty &&
                Math.abs(info.getBoundingClientRect().left - settings.parentElement.getBoundingClientRect().left) < 1 &&
                !info.getAnimations().some(animation => animation.transitionProperty === 'transform');
        })()"""), 'The hub switches instantly like settings'

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    injection = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?information-hub=1') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
        }
    """})['identifier']
    try:
        viewport(1280)
        client.call('Page.navigate', {'url': url + '?information-hub=1'})
        wait("window.appLogic?._setupEventListenersCallCount && window.informationUi && state.activeProfileId && !document.querySelector('#progressDialog[open]')",
             'Real app startup')
        if ev("Boolean(document.querySelector('#releaseNotesDialog[open]'))"):
            click('#releaseNotesDialog .dialog-ok-btn')

        legacy_context = r'出会い\n友情を築いた' + '\n' + r'コード `\n`、引用は "\n"、パス C:\new\notes、明示 \\n、タブ \t'
        display_context = legacy_context.replace(r'\n', '\n', 1)
        edited_context = display_context + r'\n次の約束'
        saved_context = display_context + '\n次の約束'
        ev(f'window.hubLegacyContext = {json.dumps(legacy_context)}; window.hubSavedContext = {json.dumps(saved_context)}')
        ev('''(async () => {
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', APP_VERSION);
            await appLogic.updateLocalUiSetting('enableWideMode', true);
            appLogic.applyWideMode();
            await appLogic.updateLocalUiSetting('enableSwipeNavigation', true);
            const A = 880092, B = 880093;
            const messages = [{role:'user', content:'もとの本文', timestamp:10}, {role:'model', content:'もとの回答', timestamp:20}];
            const summary = {summaryText:'既存の要約', summaryRange:{start:0,end:2}, summarizedAt:21, summaryMeta:{model:'test'}, metadata:'keep'};
            await dbUtils.saveChat(null, {id:A, messages, createdAt:1, summarizedContext:summary, isMemoryEnabledForChat:false,
                persistentMemory:{
                    character_memory_花: {status:'待機', summary:'旧概要', short_term_goal:'保持\\\\n短期目標',
                        relationships:{友人:{affinity:5,context:hubLegacyContext}}},
                    'character_ 花 ': {HP:10, MP:3}, character_剣士: {HP:4},
                    character_memory_あい: {summary:'別名Ａ'}, 'character_memory_あい ': {summary:'別名Ｂ'}, character_あい:{HP:11},
                    inventories:{花:{水:2}, 商人:{貨幣:7}},
                    style_profiles:{花:{politeness:.5, first_person:'私'}, '地の文':{first_person:null, description:'中立'}, 語り手:{dialect:'standard'}},
                    scene_stack:[{scene_id:'past',location:'街'}, {scene_id:'now',location:'城', metadata:{x:1}}],
                    game_day:2, explored:false, visits:3, 世界設定:{紋章:'青', レベル:1}
                }});
            await dbUtils.saveChat(null, {id:B, messages, createdAt:2, persistentMemory:{}});
            await appLogic.loadChat(A, {scrollAfterLoad:false});
            const scope = group => {
                if (!group) return document.querySelector('#information-detail > section:not([hidden])');
                return [...document.querySelectorAll('#information-detail > section:not([hidden]) summary')]
                    .find(node => node.textContent === group).parentElement;
            };
            window.hubFixture = {
                A, B, summary, profile:state.activeProfileId, picker:() => document.querySelector('#information-panel-character select'),
                disclosure(title) {
                    return [...scope().querySelectorAll('summary')].find(node => node.textContent === title);
                },
                control(label, group) {
                    const labelNode = [...scope(group).querySelectorAll('label')].find(e => e.firstChild.textContent.trim() === label);
                    if (!labelNode) throw new Error('Missing field: ' + label);
                    return labelNode.querySelector('input, textarea, select');
                },
                field(label, text, group) {
                    const control = this.control(label, group);
                    if (text === null) return control.value;
                    if (control.disabled) throw new Error('Disabled field: ' + label);
                    control.value = String(text);
                    control.dispatchEvent(new Event('input', {bubbles:true}));
                    return getComputedStyle(control).height;
                },
                action(label, group) {
                    const button = [...scope(group).querySelectorAll('button')].find(e => e.textContent === label);
                    if (!button || button.disabled) throw new Error('Unavailable action: ' + label);
                    button.click();
                },
                select(label) {
                    const select = this.picker();
                    const option = [...select.options].find(e => e.textContent === label);
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', {bubbles:true}));
                }
            };
            await dbUtils.saveMemory(state.activeProfileId, {items:['元の記憶'], customMeta:'keep'});
            uiUtilsV136.showCustomPrompt = async (_, initial) => hubFixture.prompt ?? initial ?? null;
            uiUtilsV136.showCustomConfirm = async () => hubFixture.confirm !== false;
            uiUtilsV136.showCustomAlert = async message => { hubFixture.alert = message; };
        })()''')

        wait("state.currentChatId === hubFixture.A && !state.executionInitializingV136", 'Fixture chat loads')
        ev("""elements.userInput.value = '入力中'; elements.userInput.dispatchEvent(new Event('input'));
            appLogic.restoreComposerAttachments([{name:'pending.txt', mimeType:'text/plain', base64Data:'dGVzdA=='}]);
            window.hubMessages = state.currentMessages;
            const content = elements.chatWorkspace.querySelector('.main-content');
            const spacer = document.createElement('div');
            spacer.id = 'hub-fixture-scroll'; spacer.style.height = '1800px'; content.append(spacer);""")
        open_hub("""const chatContent = elements.chatWorkspace.querySelector('.main-content');
            chatContent.scrollTop = 340; window.hubScroll = chatContent.scrollTop;""")
        assert ev("hubScroll > 0 && informationUi.returnScroll.top === hubScroll")
        assert ev("""document.querySelector('.settings-sidebar').offsetWidth ===
            document.querySelector('#information-screen .settings-sidebar').offsetWidth &&
            document.querySelector('#information-screen .settings-sidebar').offsetWidth === 288""")
        assert ev("[...hubFixture.picker().options].map(option => option.text).sort().join() === ['「あい」','「あい 」','剣士','商人','花','語り手'].sort().join()")
        ev("hubFixture.select('花')")
        assert ev("""(() => {
            const status = hubFixture.control('状態').getBoundingClientRect();
            const location = hubFixture.control('現在地').getBoundingClientRect();
            const summary = hubFixture.control('概要').getBoundingClientRect();
            return status.bottom < location.top && status.left === location.left &&
                status.width === location.width && location.width === summary.width &&
                !document.querySelector('.information-toolbar, [data-information-save], [data-information-revert]');
        })()""")
        assert ev("""['状態', '現在地'].every(name => {
            const control = hubFixture.control(name);
            return control.tagName === 'TEXTAREA' && control.offsetHeight >= 38 && control.offsetHeight <= 44;
        })"""), 'Short values use a one-line textarea'
        field('状態', '行の多い状態\n' * 70)
        assert ev("hubFixture.control('状態').offsetHeight === 500 && hubFixture.control('状態').scrollHeight > 500")
        field('状態', '待機中')
        assert ev("hubFixture.control('状態').offsetHeight <= 44"), 'Shortening a long value shrinks the textarea'
        ev("""(() => {
            const input = hubFixture.control('現在地');
            input.focus();
            input.value = '長い日本語の地名です。'.repeat(18);
            input.setSelectionRange(5, 5);
            input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
        })()""")
        assert ev("""(() => {
            const input = hubFixture.control('現在地');
            return input.offsetHeight > 44 && input.offsetHeight < 500 && input.selectionStart === 5 &&
                document.activeElement === input;
        })()"""), 'Wrapping after IME commit preserves focus and caret'
        assert field('HP', None, 'ステータス') == '10'
        assert field('水', None, '所持品') == '2'
        assert field('丁寧さ（0〜1）', None, '口調設定') == '0.5'
        assert ev("!document.querySelector('#information-panel-character .information-record .information-record').open")
        ev("hubFixture.disclosure('友人').focus()")
        press_enter()
        assert ev("hubFixture.disclosure('友人').parentElement.open && document.activeElement === hubFixture.disclosure('友人')")
        assert field('関係性の文脈', None, '友人') == display_context
        assert ev("dbUtils.getChat(hubFixture.A).then(c => c.persistentMemory.character_memory_花.relationships.友人.context === hubLegacyContext)")
        ev("hubFixture.control('関係性の文脈', '友人').focus()")
        field('関係性の文脈', edited_context, '友人')
        ev("hubFixture.disclosure('友人').focus()")
        press_enter()
        assert ev("!hubFixture.disclosure('友人').parentElement.open")
        press_enter()
        assert field('関係性の文脈', None, '友人') == saved_context
        assert field('短期目標', None) == r'保持\n短期目標'
        field('HP', '12.5', 'ステータス')
        ev("hubFixture.prompt = '水筒'")
        action('名前を変更', '所持品')
        wait("hubFixture.field('水筒', null, '所持品') === '2'", 'Rename preserves quantity')
        field('水筒', '6', '所持品')
        field('丁寧さ（0〜1）', '1.5', '口調設定')
        assert ev("hubFixture.control('丁寧さ（0〜1）', '口調設定').getAttribute('aria-invalid') === 'true'")
        field('丁寧さ（0〜1）', '0.6', '口調設定')
        field('概要', '長文\n' * 80)
        wait("hubFixture.control('概要').offsetHeight === 500", 'Textarea grows to the height limit')
        ev("hubFixture.select('商人'); hubFixture.select('花')")
        assert field('HP', None, 'ステータス') == '12.5'
        ev("hubFixture.confirm = false")
        action('キャラクターメモリを削除')
        assert ev("Boolean(informationUi.working.persistentMemory.character_memory_花)")
        ev("hubFixture.confirm = true")
        category('scenario')
        field('場所', '図書館', '現在のシーン · 城')
        field('経過日数', '3', '物語内の日付')
        field('explored', 'true', 'フラグ・カウンター')
        field('visits', '8', 'フラグ・カウンター')
        field('世界設定', '{"紋章":"銀","レベル":1}', '設定・記録')
        field('一人称', '', '文章スタイル（地の文）')
        field('説明', '簡潔', '文章スタイル（地の文）')
        ev("hubFixture.prompt = '任意記録'")
        action('記録を追加', '設定・記録')
        wait("hubFixture.field('任意記録', null, '設定・記録') === ''", 'A string record is added')
        field('任意記録', '追加内容', '設定・記録')
        wait("""dbUtils.getChat(hubFixture.A).then(c => {
            const m = c.persistentMemory;
            return m.scene_stack.length === 2 && m.scene_stack[0].location === '街' &&
                m.scene_stack[1].location === '図書館' && m.scene_stack[1].metadata.x === 1 &&
                m.game_day === 3 && m.explored === true && m.visits === 8 && m.世界設定.紋章 === '銀' &&
                m.style_profiles.地の文.first_person === null && m.style_profiles.地の文.description === '簡潔' &&
                m.任意記録 === '追加内容';
        })""", 'The scenario is saved after the input delay')
        category('character')
        assert field('HP', None, 'ステータス') == '12.5'
        wait("""dbUtils.getChat(hubFixture.A).then(c => {
            const m = c.persistentMemory;
            return m['character_ 花 '].HP === 12.5 && !Object.hasOwn(m,'character_花') &&
                m.inventories.花.水筒 === 6 && !Object.hasOwn(m.inventories.花, '水') &&
                m.style_profiles.花.politeness === .6 && m.character_memory_花.status === '待機中' &&
                m.character_memory_花.relationships.友人.context === window.hubSavedContext;
        })""", 'Character and category changes flush character editing')
        ev("window.hubCommit = dbUtils.commitChatInformation; dbUtils.commitChatInformation = async () => { throw new Error('テスト用の保存失敗'); }")
        field('HP', '13', 'ステータス')
        wait("document.querySelector('#information-panel-character [data-save-error]')?.textContent.includes('テスト用の保存失敗')",
             'Autosave failure is visible')
        assert field('HP', None, 'ステータス') == '13'
        assert ev("dbUtils.getChat(hubFixture.A).then(c => c.persistentMemory['character_ 花 '].HP === 12.5)")
        ev("""dbUtils.commitChatInformation = async function (...args) {
            await new Promise(resolve => { hubFixture.releaseSave = resolve; });
            return hubCommit.apply(this, args);
        }""")
        field('HP', '13.5', 'ステータス')
        assert ev("!hubFixture.releaseSave"), 'Editing starts a debounce'
        wait("Boolean(hubFixture.releaseSave)", 'A debounced save starts')
        field('HP', '14', 'ステータス')
        ev("dbUtils.commitChatInformation = hubCommit; hubFixture.releaseSave()")
        wait("dbUtils.getChat(hubFixture.A).then(c => c.persistentMemory['character_ 花 '].HP === 14)",
             'The newer value survives the earlier in-flight save')
        assert ev("!document.querySelector('#information-panel-character [data-save-error]') && !document.querySelector('#information-detail').textContent.includes('保存しました。')")

        category('profile')
        wait("document.querySelector('.memory-item-text')?.textContent === '元の記憶'", 'Saved memory is visible with chat memory disabled')
        assert ev("!document.querySelector('#information-memory-enabled').checked")
        click('#information-memory-enabled')
        wait("dbUtils.getChat(hubFixture.A).then(chat => chat.isMemoryEnabledForChat === true)", 'Existing per-chat memory flag saves')
        ev("document.querySelector('#new-memory-input').value = '追加した記憶'")
        click('#add-memory-btn')
        wait("document.querySelectorAll('.memory-item').length === 2 && dbUtils.getMemory(hubFixture.profile).then(m => m.customMeta === 'keep')", 'Profile add preserves external metadata')
        ev("hubFixture.prompt = '編集後の記憶'")
        click('.memory-item button[aria-label="編集"]')
        wait("document.querySelector('.memory-item-text')?.textContent === '編集後の記憶'", 'Profile memory edit')
        click('.memory-item button[aria-label="削除"]')
        wait("document.querySelectorAll('#memory-list-container .memory-item').length === 1", 'Profile item delete')
        click('#delete-all-memory-btn')
        wait("dbUtils.getMemory(hubFixture.profile).then(m => !m.items.length && m.customMeta === 'keep')", 'Profile clear preserves metadata')

        category('summary')
        ev("""const summaryInput = hubFixture.control('要約本文');
            summaryInput.focus(); summaryInput.value = '編集後の要約';
            summaryInput.dispatchEvent(new InputEvent('input', {bubbles: true, isComposing: true}));""")
        assert ev("!informationUi.draft.changes.size"), 'IME preedit text is not queued'
        ev("""const committedSummaryInput = hubFixture.control('要約本文');
            committedSummaryInput.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}));
            committedSummaryInput.blur();""")
        wait("""dbUtils.getChat(hubFixture.A).then(c => {
            const {summaryText, ...rest} = c.summarizedContext;
            const {summaryText: originalText, ...original} = hubFixture.summary;
            return summaryText === '編集後の要約' && JSON.stringify(rest) === JSON.stringify(original) && c.messages.length === 2;
        })""", 'Blur saves only the summary text')
        key_activate('#information-menu-btn')
        assert ev("document.querySelector('#information-menu-btn').getAttribute('aria-expanded') === 'false'")
        viewport(900)
        key_activate('#information-menu-btn')
        assert ev("document.querySelector('#information-menu-btn').getAttribute('aria-expanded') === 'true' && document.querySelector('#information-title').textContent === '会話要約'")
        viewport(390)
        wait("history.state?.settingsDetailPushed && location.hash === '#information/summary'", 'Desktop to phone history')
        key_activate('#information-menu-btn')
        wait("location.hash === '#information' && informationUi.category === null", 'Phone menu returns to category list')
        ev('history.forward()')
        wait("location.hash === '#information/summary' && hubFixture.field('要約本文', null) === '編集後の要約'", 'Forward restores the phone detail')
        ev('history.back()')
        wait("location.hash === '#information' && !informationUi.category", 'Browser back restores list')
        category('summary')
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
        for i in range(8):
            client.call('Input.dispatchTouchEvent', {
                'type': 'touchStart' if i == 0 else 'touchMove',
                'touchPoints': [{'x': 24 + 15*i, 'y': 500, 'id': 1}],
            })
            time.sleep(.025)
        client.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        assert ev("location.hash === '#information/summary' && informationUi.category === 'summary'"), 'An excluded page stays open during a swipe'
        key_activate('#information-menu-btn')
        wait("location.hash === '#information' && !informationUi.category", 'The detail arrow returns to the category list')
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        category('character')
        assert ev("""(() => {
            const input = hubFixture.control('現在地');
            const headings = [...document.querySelectorAll('#information-panel-character summary')].filter(el => el.getClientRects().length);
            return input.offsetHeight > 44 && input.offsetHeight <= 500 &&
                headings.every(el => el.scrollWidth <= el.clientWidth + 1);
        })()"""), 'Phone width wraps the location and keeps disclosure rows usable'
        key_activate('#information-menu-btn')
        wait("location.hash === '#information' && !informationUi.category", 'Phone returns to the list from character memory')
        key_activate('#back-to-chat-from-information')
        wait("state.currentScreen === 'chat'", 'Left header returns to chat')
        assert ev("state.currentMessages === hubMessages && elements.userInput.value === '入力中' && state.pendingAttachments[0].name === 'pending.txt'")
        wait("hubScroll > 0 && Math.abs(elements.chatWorkspace.querySelector('.main-content').scrollTop - hubScroll) < 1",
             'The previous conversation scroll position is restored')
        ev("document.querySelector('#hub-fixture-scroll').remove(); appLogic.restoreComposerAttachments([])")

        viewport(1280)
        open_hub()
        ev("hubFixture.select('花')")
        field('HP', '15', 'ステータス')
        key_activate('#back-to-chat-from-information')
        wait("dbUtils.getChat(hubFixture.A).then(c => c.persistentMemory['character_ 花 '].HP === 15)",
             'Closing the hub flushes the edit')
        tool_context = r'再会\n今後の計画' + '\n' + r'そのままの記号 `\n` と \t'
        final_context = saved_context + '\n' + tool_context.replace(r'\n', '\n', 1)
        ev(f'window.hubToolContext = {json.dumps(tool_context)}')
        ev('''(async () => {
            await appLogic.saveApiConfigs([{id:'hub-fixture', name:'Hub test', provider:'gemini', apiKey:'fixture', modelCandidates:['gemini-2.5-flash']}]);
            await appLogic.setCurrentChatModelRef({apiConfigId:'hub-fixture',modelName:'gemini-2.5-flash'});
            await appLogic.saveGlobalSettingsV136({enableStreamingOutput:false});
            state.settings.geminiEnableFunctionCalling = true;
            hubFixture.provider = appLogic.callApiWithRetry;
            let first = true;
            appLogic.callApiWithRetry = async () => {
                if (!first) return {content:'生成中もハブを使用', continuation:{parts:[{text:'生成中もハブを使用'}]}};
                first = false;
                await new Promise(resolve => { hubFixture.release = resolve; });
                const call = {functionCall:{name:'manage_character_status',args:{character_name:' 花 ',action:'set',status_key:'HP',value:19}}};
                const relationshipArgs = apiUtils._parseToolArguments(JSON.stringify({
                    character_name:'花', action:'update', relationship_target:'友人', relationship_context:hubToolContext
                }));
                if (relationshipArgs.relationship_context !== hubToolContext) throw new Error('Argument parsing changed the escape boundaries');
                const relationshipCall = {functionCall:{name:'manage_character_memory',args:relationshipArgs}};
                const parts = [call, relationshipCall];
                return {toolCalls:parts, continuation:{parts}};
            };
            hubFixture.send = appLogic.handleSend();
        })()''')
        wait("state.isSending && Boolean(hubFixture.release)", 'Generation is awaiting mocked provider')
        open_hub()
        ev("hubFixture.select('花')")
        wait("document.querySelector('#information-panel-character [data-information-edit]').disabled", 'Chat editing disabled while generating')
        assert field('HP', None, 'ステータス') == '15'
        category('profile')
        ev("document.querySelector('#new-memory-input').value = '生成中に追加'")
        click('#add-memory-btn')
        wait("document.querySelector('.memory-item-text')?.textContent === '生成中に追加'", 'Profile memory can still be changed')
        category('character')
        ev('hubFixture.release(); hubFixture.send')
        wait("!state.isSending", 'Response finishes with the hub open')
        result = ev("dbUtils.getChat(hubFixture.A).then(c => [c.messages.at(-1).content, c.persistentMemory['character_ 花 '].HP])")
        assert result == ['生成中もハブを使用', 19], result
        wait("hubFixture.field('HP', null, 'ステータス') === '19'", 'The latest committed tool result is shown automatically')
        assert field('関係性の文脈', None, '友人') == final_context
        old_version = ev('dbUtils.getChat(hubFixture.A).then(c => c.contentRevision)')
        field('関係性の文脈', final_context, '友人')
        ev('appLogic.callApiWithRetry = hubFixture.provider')
        category('summary')
        assert ev('dbUtils.getChat(hubFixture.A).then(c => c.contentRevision)') == old_version
        field('要約本文', '切り替え前の要約')
        ev("appLogic.loadChat(hubFixture.B, {scrollAfterLoad:false})")
        wait("state.currentChatId === hubFixture.B", 'Switch chat while hub is open')
        assert ev("!document.querySelector('#information-panel-summary textarea') && document.querySelector('#information-panel-summary').textContent.includes('保存済みの要約がありません')")
        ev("appLogic.loadChat(hubFixture.A, {scrollAfterLoad:false})")
        assert field('要約本文', None) == '切り替え前の要約'
        assert ev("dbUtils.getChat(hubFixture.B).then(c => c.summarizedContext == null)")
        ev("""(async () => {
            await uiUtilsV136.showScreen('chat');
            elements.summaryDialog.dataset.summaryRangeStart = '2';
            elements.summaryDialog.dataset.summaryRangeEnd = String(state.currentMessages.length);
            appLogic._showSummaryDialog('新しく生成した分', 100, {provider:'gemini',model:'fixture'});
            await appLogic.confirmSummary();
        })()""")
        assert ev("dbUtils.getChat(hubFixture.A).then(c => c.summarizedContext.summaryText === '切り替え前の要約\\n\\n新しく生成した分')")
        open_hub()
        ev("hubFixture.select('花')")
        action('キャラクターメモリを削除')
        wait("!Object.hasOwn(informationUi.working.persistentMemory, 'character_memory_花')", 'Confirmed character deletion is staged')
        wait("""dbUtils.getChat(hubFixture.A).then(c => {
            const m = c.persistentMemory;
            return !Object.hasOwn(m, 'character_memory_花') && m['character_ 花 '].HP === 19 &&
                m.inventories.花.水筒 === 6 && m.style_profiles.花.politeness === .6;
        })""", 'Confirmed deletion automatically saves only the character memory record')
        ev("""(async () => {
            const chat = await dbUtils.getChat(hubFixture.A);
            await dbUtils.commitChatInformation(chat.id, SettingsV136.chatContentVersion(chat), stored => ({
                persistentMemory: { ...stored.persistentMemory, 'character_ 花 ': { ...stored.persistentMemory['character_ 花 '], HP:31 } }
            }));
        })()""")
        field('HP', '30', 'ステータス')
        wait("document.querySelector('#information-panel-character [data-save-error]')?.textContent.includes('別の操作')",
             'A conflicting record produces a visible save error')
        assert field('HP', None, 'ステータス') == '30'
        assert ev("dbUtils.getChat(hubFixture.A).then(c => c.persistentMemory['character_ 花 '].HP === 31)")
        ev("appLogic.loadChat(hubFixture.B, {scrollAfterLoad:false})")
        assert ev("!Object.hasOwn(informationUi.working.persistentMemory, 'character_ 花 ')")
        ev("appLogic.loadChat(hubFixture.A, {scrollAfterLoad:false})")
        assert field('HP', None, 'ステータス') == '30'
        return 'ALL PASSED (information hub: compact textareas, scoped newline normalization, disclosure state, responsive navigation, autosave, conflict retention and generation)'
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': injection})
        client.call('Network.setBlockedURLs', {'urls': []})
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
        viewport(1280)

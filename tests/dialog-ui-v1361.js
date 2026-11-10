/* Real modal lifecycle, storage and geometry tests in the isolated fixture. */
(() => {
    const app = window.appLogic, ui = window.uiUtilsV136, st = window.state, db = window.dbUtils;
    const $ = id => document.getElementById(id);
    const ids = { system: 'system-prompt-dialog', format: 'textFormattingDialog', debug: 'debugLogDialog', summary: 'summaryDialog',
        compression: 'confirmDialog', confirm: 'confirmDialog', prompt: 'promptDialog', alert: 'alertDialog', api: 'api-config-dialog',
        conflict: 'assetConflictDialog', memory: 'memoryManagementDialog', character: 'characterProfileDialog',
        assets: 'assetManagementDialog', progress: 'progressDialog' };
    let assertions = 0, current, pending, opener, contents, originalSummary, apiCalls = 0, oldSave, late, releaseLate, oldResolver, oldProvider, viewportDescriptors, clipboardWrite, copied;
    const check = (ok, message) => { assertions++; if (!ok) throw new Error(message); };
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wait = async (fn, label) => {
        const deadline = performance.now() + 3500;
        while (!await fn()) {
            if (performance.now() > deadline) throw new Error(label);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const api = window.dialogUiV1361 = {
        ids,
        count: () => assertions,
        frame,
        async reset() {
            for (const dialog of document.querySelectorAll('dialog[open]')) {
                if (dialog.id === ids.system) await app.closeSystemPromptDialog({ skipSave: true });
                else dialog.close('cancel');
            }
            if (pending) { await pending; pending = null; }
            if (originalSummary) { app._callSummaryApi = originalSummary; originalSummary = null; }
            $('image-modal-overlay').classList.add('hidden');
            await frame();
        },
        async prepare(dark = false, sidebar = true) {
            await api.reset();
            for (const name of ['showCustomAlert', 'showCustomConfirm', 'showCustomPrompt']) ui[name] = window.testRealUi[name];
            st.isSending = false; st.editingMessageIndex = null; ui.setSendingState(false);
            await app.updateLocalUiSetting('enableWideMode', true);
            await app.setProfileOverride('theme', false); await app.saveAppearanceValues('theme', { darkMode: dark }, { global: true });
            document.body.classList.add('wide-mode-enabled'); ui.applyDarkMode();
            await ui.showScreen('chat', true);
            app.startNewChat(); await st.executionSettingsReady;
            st.currentMessages = [{ role: 'user', content: 'ダイアログ動作確認の本文。', timestamp: Date.now() },
                { role: 'model', content: '整形対象の文章。  \n\n\n次の文章。', timestamp: Date.now() }];
            st.currentSystemPrompt = '保存済みのプロンプト';
            st.currentPersistentMemory = { character_memory_テスト: { name: 'テスト', description: '確認用' } };
            await db.saveChat(); ui.renderChatMessages();
            ui.updateChatSidebarResponsiveState(); sidebar ? ui.openChatSidebar() : ui.closeChatSidebar();
            await frame(); await frame();
            return { mode: ui.getChatSidebarMode(), manifest: (await (await fetch('../manifest.json')).json()).theme_color };
        },
        async open(kind) {
            await api.reset(); current = kind;
            $('user-input').focus(); opener = document.activeElement;
            contents = st.currentMessages.map(message => message.content).join('\n');
            switch (kind) {
                case 'system': await app.openSystemPromptDialog(); break;
                case 'format': await app.openTextFormattingDialog(); break;
                case 'debug': app.openLogDialog(); break;
                case 'summary': app._showSummaryDialog('生成済みの要約です。', 1000); break;
                case 'compression':
                    originalSummary = app._callSummaryApi; apiCalls = 0;
                    app._callSummaryApi = async () => { apiCalls++; };
                    pending = app.startSummaryProcess(); break;
                case 'confirm': pending = ui.showCustomConfirm('削除しますか？ 確認用のメッセージです。'); break;
                case 'prompt': pending = ui.showCustomPrompt('名前を入力してください。', '未確定の入力'); break;
                case 'alert': pending = ui.showCustomAlert('アラートの内容です。'); break;
                case 'api': app.openApiConfigDialog(); break;
                case 'conflict': pending = app.showAssetConflictDialog('fixture.webp'); break;
                case 'memory': await app.openMemoryManagementDialog(); break;
                case 'character': await app.openCharacterProfileDialog(); break;
                case 'assets': $('assetManagementDialog').showModal(); break;
                case 'progress': ui.showProgressDialog('DBを更新中です。'); break;
            }
            const dialog = $(ids[kind]);
            await wait(() => dialog.open, 'dialog opens: ' + kind);
            await wait(() => !dialog.classList.contains('animating'), 'dialog animation completes'); await frame();
            check(dialog instanceof HTMLDialogElement && dialog.matches(':modal'), 'native top layer: ' + kind);
            check(getComputedStyle(dialog, '::backdrop').backdropFilter === 'blur(2px)', 'shared backdrop blur');
            check(getComputedStyle(dialog, '::backdrop').backgroundColor === 'rgba(0, 0, 0, 0.5)', 'shared backdrop dimming');
            return { id: dialog.id, rect: dialog.getBoundingClientRect().toJSON() };
        },
        async layout() {
            await frame(); await frame();
            const dialog = $(ids[current]), r = dialog.getBoundingClientRect();
            const w = $('chat-workspace').getBoundingClientRect(), v = visualViewport;
            const left = Math.max(w.left, v.offsetLeft), right = Math.min(w.right, v.offsetLeft + v.width);
            const top = Math.max(w.top, v.offsetTop), bottom = Math.min(w.bottom, v.offsetTop + v.height);
            check(Math.abs(r.left + r.width / 2 - (left + right) / 2) <= 1, 'chat dialog horizontal center: ' + current);
            check(Math.abs(r.top + r.height / 2 - (top + bottom) / 2) <= 1, 'chat dialog vertical center: ' + current);
            check(r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom, 'chat dialog inside visible workspace');
            return { id: dialog.id, rect: r.toJSON(), workspace: w.toJSON() };
        },
        inside() {
            const r = $(ids[current]).getBoundingClientRect(); return { x: r.left + 8, y: r.top + 8 };
        },
        staysOpen() { check($(ids[current]).open, 'inside/drag/scroll keeps dialog open: ' + current); },
        async closed() {
            const kind = current, dialog = $(ids[kind]);
            await wait(() => !dialog.open, 'outside/ESC closes: ' + kind);
            let result;
            if (pending) { result = await pending; pending = null; }
            if (kind === 'confirm') check(result === false, 'confirmation cancels without confirmation');
            if (kind === 'prompt') check(result === '', 'prompt cancels without input confirmation');
            if (kind === 'conflict') check(result.choice === 'cancel' && result.applyToAll === false, 'conflict cancels without overwrite');
            if (kind === 'compression') {
                check(apiCalls === 0 && !$('summaryDialog').open, 'cancelled compression does not invoke API');
                app._callSummaryApi = originalSummary; originalSummary = null;
            }
            if (kind === 'format') check(st.currentMessages.map(message => message.content).join('\n') === contents, 'format cancel does not modify messages');
            if (kind === 'system') check(!st.isEditingSystemPrompt, 'prompt editing ends after save');
            if (kind === 'api') check(!$('api-config-provider').disabled, 'API dialog cancel cleanup');
            await frame();
            check(document.activeElement === opener || !opener.isConnected || opener.closest('[inert]'), 'focus restores to opener');
        },
        input(value) { const editor = $('system-prompt-editor'); editor.value = value; editor.dispatchEvent(new Event('input', { bubbles: true })); },
        async autosaved() {
            await wait(async () => (await db.getChat(st.currentChatId)).systemPrompt === '700msの自動保存', '700ms autosave persists');
            check(!$('system-prompt-save-status'), 'save status presentation is removed');
            check($('system-prompt-char-count').textContent.includes(String('700msの自動保存'.length)), 'character count updates');
            check($('system-prompt-dialog').open, 'autosave keeps dialog open');
        },
        async saved(value) { check((await db.getChat(st.currentChatId)).systemPrompt === value, 'close flushes prompt to DB'); },
        failSave() { oldSave = db.saveChat; db.saveChat = async () => { throw new Error('expected test save failure'); }; },
        async failedSaveStaysOpen() {
            await wait(() => st.systemPromptSaveStatus === 'error', 'save failure status');
            check($('system-prompt-dialog').open && st.isEditingSystemPrompt, 'failed save retains editor');
            check($('chat-parameter-save-error')?.getAttribute('role') === 'alert', 'failure is announced without a persistent status area');
            db.saveChat = oldSave;
        },
        sending(value) { st.isSending = value; ui.setSendingState(value); },
        focusCloseButton() { $('system-prompt-close-btn').focus(); check(document.activeElement === $('system-prompt-close-btn'), 'close button receives keyboard focus'); },
        sidebarOpen() { check($('chat-screen').classList.contains('chat-sidebar-open'), 'modal Escape preserves overlay sidebar'); },
        readOnly() { check($('system-prompt-editor').disabled, 'sending keeps prompt read-only'); },
        async switchChat() {
            const previous = st.currentChatId;
            const id = await new Promise((resolve, reject) => {
                const tx = st.db.transaction('chats', 'readwrite');
                const request = tx.objectStore('chats').add({ title: '切替先', messages: [], createdAt: Date.now(), updatedAt: Date.now(), systemPrompt: '切替先の設定' });
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            await app.loadChat(id);
            check((await db.getChat(previous)).systemPrompt === '切替直前の編集', 'chat switch saves previous prompt');
            check(!$('system-prompt-dialog').open && st.currentChatId === id, 'chat switch closes prompt modal');
        },
        async stack() {
            await api.open('format'); pending = ui.showCustomConfirm('一番手前の確認です。'); current = 'confirm';
            await wait(() => $('confirmDialog').open && !$('confirmDialog').classList.contains('animating'), 'stacked confirm ready');
            opener = document.activeElement; // Focus restoration below is checked directly on the underlying modal.
        },
        async topClosed() {
            await wait(() => !$('confirmDialog').open, 'top confirm closes');
            check(await pending === false, 'top confirm resolves cancelled'); pending = null;
            check($('textFormattingDialog').open, 'underlying dialog remains open');
            check($('textFormattingDialog').contains(document.activeElement), 'focus returns to underlying dialog');
            current = 'format';
        },
        reopenConfirmWithOldResult() { $('confirmDialog').returnValue = 'ok'; },
        async image() {
            await api.reset(); $('user-input').focus(); ui.imageModalPreviousFocus = document.activeElement;
            $('image-modal-img').src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="gray"/></svg>';
            $('image-modal-overlay').classList.remove('hidden'); await $('image-modal-img').decode();
        },
        imageVisible(visible) { check(!$('image-modal-overlay').classList.contains('hidden') === visible, 'image overlay visibility'); },
        async lateSummary() {
            await api.open('summary');
            oldResolver = app.resolveSummaryApiConfig; oldProvider = app._callOpenRouterSummaryApi;
            app.resolveSummaryApiConfig = () => ({ provider: 'openrouter', name: 'fixture', modelName: 'test' });
            app._callOpenRouterSummaryApi = () => new Promise(resolve => { releaseLate = resolve; });
            late = app._callSummaryApi('元の会話'); current = 'summary';
        },
        async finishLateSummary() {
            releaseLate('遅れて返った要約'); await late;
            app.resolveSummaryApiConfig = oldResolver; app._callOpenRouterSummaryApi = oldProvider;
            check(!$('summaryDialog').open, 'dismissed summary does not reopen when API completes');
        },
        progressOpen() { check($('progressDialog').open, 'progress is protected while operation runs'); },
        addProbe() {
            const button = document.createElement('button'); button.id = 'dialog-underlay-probe'; button.tabIndex = -1;
            button.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:99999';
            button.onclick = () => { button.dataset.clicked = 'true'; }; document.body.append(button);
        },
        async noClickThrough() { await frame(); check(!$('dialog-underlay-probe').dataset.clicked, 'backdrop click does not activate underlying control'); $('dialog-underlay-probe').remove(); },
        formatClosed() { check(!$('textFormattingDialog').open, 'second gesture closes underlying modal'); },
        fakeKeyboard() {
            viewportDescriptors = ['height', 'offsetTop'].map(name => Object.getOwnPropertyDescriptor(visualViewport, name));
            Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 });
            Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 40 });
            visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll'));
        },
        restoreViewport() {
            ['height', 'offsetTop'].forEach((name, i) => viewportDescriptors[i] ? Object.defineProperty(visualViewport, name, viewportDescriptors[i]) : delete visualViewport[name]);
            visualViewport.dispatchEvent(new Event('resize'));
        },
        beginLogCopy() {
            window.testDebug.logs.push({ type: 'info', timestamp: new Date(), args: ['fixture debug copy'] });
            clipboardWrite = navigator.clipboard.writeText; copied = '';
            navigator.clipboard.writeText = async text => { copied = text; };
        },
        async logCopyReady() { await wait(() => $('alertDialog').open, 'copy notification opens'); },
        async logCopied() {
            await wait(() => !$('alertDialog').open, 'copy notification dismissed');
            navigator.clipboard.writeText = clipboardWrite;
            check(copied.includes('fixture debug copy'), 'debug copy generates existing log text');
            check($('debugLogDialog').open, 'copy notification preserves underlying debug dialog');
        },
        logsCleared() { check(window.testDebug.getLogs().length === 0 && $('debugLogDialog').open, 'debug clear works without closing dialog'); },
        async repeatClose() {
            await api.reset();
            for (let i = 0; i < 3; i++) {
                ui.installDialogDismissal();
                const result = ui.showCustomConfirm('すぐ閉じる確認');
                $('confirmDialog').close('cancel');
                check(await result === false, 'rapid reopen resolves cancelled');
                check(!$('confirmDialog').classList.contains('animating'), 'rapid close clears animation lifecycle');
            }
        },
        async settingsConfirm() {
            await api.reset(); await ui.showScreen('settings', true);
            pending = ui.showCustomConfirm('通常の確認'); current = 'confirm';
            await wait(() => $('confirmDialog').open && !$('confirmDialog').classList.contains('animating'), 'global confirm ready');
            const r = $('confirmDialog').getBoundingClientRect();
            check(!$('confirmDialog').classList.contains('chat-workspace-dialog'), 'normal confirm keeps global scope');
            check(Math.abs(r.left + r.width / 2 - innerWidth / 2) <= 1, 'normal confirm stays viewport centered');
        }
    };
})();

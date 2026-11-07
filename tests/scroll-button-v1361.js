/* Real DOM/layout regressions, using the isolated v136 IndexedDB fixture. */
(() => {
    const app = window.appLogic, ui = window.uiUtilsV136, st = window.state;
    const $ = id => document.getElementById(id);
    const main = () => document.querySelector('#chat-workspace .main-content');
    const button = () => $('scroll-to-bottom-btn');
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const check = (ok, label) => { if (!ok) throw new Error(label); };
    const wait = async (fn, label) => {
        const deadline = performance.now() + 2500;
        while (!fn()) {
            if (performance.now() > deadline) throw new Error(label);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const messages = count => Array.from({ length: count }, (_, i) => ({
        role: i % 2 ? 'model' : 'user', content: `メッセージ ${i + 1}：スクロールと表示位置の確認。`, timestamp: i + 1
    }));
    const render = async items => {
        st.currentMessages = items;
        ui.renderChatMessages({ suppressMessageAnimation: true });
        await frame(); await frame();
    };
    const atBottom = () => main().scrollHeight - main().clientHeight - main().scrollTop <= 4;
    const geometry = () => {
        const b = button().getBoundingClientRect(), w = $('chat-workspace').getBoundingClientRect();
        const composer = document.querySelector('#chat-workspace footer').getBoundingClientRect();
        check(Math.abs((b.left + b.right - w.left - w.right) / 2) <= 1, 'button centered in actual workspace');
        check(Math.abs(composer.top - b.bottom - 16) <= 1, `composer gap is 16px (${composer.top - b.bottom})`);
        check(b.top >= 0 && b.bottom <= innerHeight, 'button inside viewport');
        return { button: b.toJSON(), workspace: w.toJSON(), composer: composer.toJSON() };
    };

    window.prepareScrollButtonV1361 = async (wide, dark) => {
        window.scrollButtonExpectedDarkV1361 = dark;
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
        window.settingsUiV136.closePopover(false);
        ui.closeChatSearch({ restoreFocus: false });
        await ui.showScreen('chat', true);
        st.isSending = false; st.editingMessageIndex = null;
        st.currentSummarizedContext = null;
        // Use the owning settings store so sidebar persistence cannot overwrite
        // temporary test-only values in the effective settings object.
        await app.updateLocalUiSetting('autoScroll', false);
        await app.updateLocalUiSetting('enableWideMode', wide);
        await app.setProfileOverride('theme', false);
        await app.saveAppearanceValues('theme', { darkMode: dark }, { global: true });
        document.body.classList.toggle('wide-mode-enabled', wide);
        ui.applyDarkMode();
        document.body.classList.remove('header-auto-hide', 'header-force-show');
        app.scrollToBottom = window.testRealAppFunctions.scrollToBottom;
        ui.updateChatSidebarResponsiveState(); ui.closeChatSidebar();
        $('user-input').value = ''; ui.applyComposerTextareaSize(true);
        await render(messages(18));
        main().scrollTop = 0;
        await wait(() => !button().hidden, 'button visible at top of overflowing chat');
        return geometry();
    };

    window.runScrollButtonGeometryV1361 = async () => {
        let assertions = 0;
        check(!$('scroll-to-top-btn') && typeof app.scrollToTop === 'undefined', 'top control removed'); assertions++;
        check(button().parentElement === $('chat-workspace'), 'button independent from panel'); assertions++;
        check(button().getAttribute('aria-label') === '最下部へ移動', 'accessible name'); assertions++;
        check(document.body.classList.contains('dark-mode') === window.scrollButtonExpectedDarkV1361, 'requested theme applied'); assertions++;
        geometry(); assertions += 3;
        for (const mode of ['hidden', 'always', 'on-click']) {
            st.settings.floatingPanelBehavior = mode; app.applyFloatingPanelBehavior();
            check(!button().hidden && getComputedStyle(button()).display !== 'none', 'independent panel setting ' + mode);
            check($('floating-action-panel').classList.contains('visible') === (mode === 'always'), 'other panel setting ' + mode);
            assertions += 2;
        }
        document.body.classList.add('header-auto-hide'); await frame();
        geometry(); assertions += 3;
        document.body.classList.remove('header-auto-hide');
        const mode = ui.getChatSidebarMode();
        if (mode !== 'disabled') {
            ui.openChatSidebar(); await frame(); await frame();
            geometry(); assertions += 3;
            const r = button().getBoundingClientRect();
            if (mode === 'overlay') {
                check($('chat-workspace').inert, 'overlay makes button inert');
                check(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== button(), 'overlay covers button');
                assertions += 2;
            } else {
                check($('chat-workspace').getBoundingClientRect().left >= $('chat-history-sidebar').getBoundingClientRect().right - 1, 'permanent sidebar excluded');
                check(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === button(), 'permanent button clickable');
                assertions += 2;
            }
            ui.closeChatSidebar(); await frame(); geometry(); assertions += 3;
        }
        // An actual native modal must remain above the workspace button.
        const dialog = $('textFormattingDialog');
        dialog.showModal(); check(!button().matches(':modal') && dialog.matches(':modal'), 'modal uses top layer'); assertions++;
        dialog.close();
        return { assertions, mode, ...geometry() };
    };

    window.verifyScrollButtonBottomV1361 = async () => {
        // Visibility uses a 4px tolerance, so wait for the 300ms animation to
        // finish before the next scenario changes scrollTop.
        await new Promise(resolve => setTimeout(resolve, 350));
        await wait(() => atBottom() && button().hidden, 'native button activation reaches bottom with auto-scroll off');
        check(st.settings.autoScroll === false, 'manual activation preserves auto-scroll setting');
        return 2;
    };

    window.verifyScrollButtonHoverV1361 = async () => {
        check(button().matches(':hover'), 'native mouse hover reaches button');
        const dark = document.body.classList.contains('dark-mode');
        const expected = dark ? 'rgb(48, 48, 48)' : 'rgb(207, 207, 207)';
        await wait(() => getComputedStyle(button()).backgroundColor === expected, 'hover background reaches ' + expected);
        check(getComputedStyle(button()).color === (dark ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 24)'), 'hover arrow matches theme');
        return 3;
    };

    window.runScrollButtonBehaviorV1361 = async () => {
        let assertions = 0;
        main().scrollTop = 0; await wait(() => !button().hidden, 'scroll up shows button'); assertions++;
        main().scrollTop = main().scrollHeight; await wait(() => button().hidden, 'scroll down hides button'); assertions++;
        main().scrollTop -= 3; await frame(); check(button().hidden, '3px bottom tolerance'); assertions++;
        main().scrollTop -= 12; await wait(() => !button().hidden, 'larger bottom distance shows button'); assertions++;
        const y = main().scrollTop; app.scrollToBottom(); await frame();
        check(main().scrollTop === y, 'disabled auto-scroll does not move chat'); assertions++;
        button().click(); await window.verifyScrollButtonBottomV1361(); assertions += 2;

        // A streaming text node grows while scrollTop remains unchanged.
        const content = $('message-container').lastElementChild.querySelector('.message-content');
        const stream = document.createTextNode(''); content.append(stream);
        stream.appendData('\n' + 'ストリーミング表示の追加行。\n'.repeat(12));
        await wait(() => !button().hidden, 'stream growth updates visibility without a scroll event'); assertions++;
        stream.remove(); await frame(); await wait(() => button().hidden, 'content shrink updates visibility'); assertions++;

        main().scrollTop = 0; await wait(() => !button().hidden, 'top before composer resize');
        $('user-input').value = '複数行の入力\n'.repeat(8); $('user-input').dispatchEvent(new Event('input', { bubbles: true }));
        await frame(); await frame(); geometry(); assertions += 3;
        $('user-input').value = ''; $('user-input').dispatchEvent(new Event('input', { bubbles: true }));
        await frame(); await frame(); geometry(); assertions += 3;
        $('chat-workspace').style.setProperty('--safe-bottom', '34px');
        await frame(); await frame(); geometry(); assertions += 3;
        check(document.querySelector('#chat-workspace footer').getBoundingClientRect().bottom <= innerHeight - 34, 'bottom safe area respected'); assertions++;
        $('chat-workspace').style.removeProperty('--safe-bottom'); await frame();

        await render([]); await wait(() => button().hidden, 'empty chat hides button'); assertions++;
        await render(messages(1)); check(button().hidden, 'non-overflowing short chat hides button'); assertions++;
        await render(messages(18)); await wait(() => !button().hidden, 'message addition shows button'); assertions++;
        await render([]); await wait(() => button().hidden, 'message deletion hides button'); assertions++;

        await render([{ role: 'model', content: '長文メッセージの行\n'.repeat(180), timestamp: 901 }]);
        ui.applyMessageCollapseToAll(); await frame();
        const message = $('message-container').querySelector('.message.model');
        check(message.classList.contains('tm-collapsible'), 'long message supports collapse'); assertions++;
        ui.setMessageCollapsed(message, false, { persist: false, keepVisible: false });
        await wait(() => !button().hidden, 'expanded message shows button'); assertions++;
        ui.setMessageCollapsed(message, true, { persist: false, keepVisible: false });
        await frame(); await frame();
        check(button().hidden === atBottom(), 'collapse visibility matches actual scroll geometry'); assertions++;

        // Persisted chat switching exercises real loadChat/startNewChat rendering.
        await render(messages(18)); st.currentChatId = null; await window.dbUtils.saveChat();
        const chatId = st.currentChatId;
        app.startNewChat(); await st.executionSettingsReady;
        await wait(() => button().hidden, 'new chat hides button'); assertions++;
        await app.loadChat(chatId, { scrollAfterLoad: false });
        await wait(() => !button().hidden, 'loading saved chat restores button'); assertions++;
        return assertions;
    };

    window.runScrollButtonKeyboardV1361 = async () => {
        // Test the visual-only resize Android uses without resizing layoutViewport.
        const viewport = window.visualViewport;
        const names = ['height', 'offsetTop', 'scale'];
        const descriptors = names.map(name => Object.getOwnPropertyDescriptor(viewport, name));
        let assertions = 0;
        try {
            $('user-input').value = '長い入力欄もキーボードと共存する\n'.repeat(60);
            $('user-input').dispatchEvent(new Event('input', { bubbles: true }));
            $('user-input').focus();
            for (const [height, top, scale] of [[500, 0, 1], [420, 40, 1], [500, 0, 2], [innerHeight, 0, 1]]) {
                for (const [name, value] of Object.entries({ height, offsetTop: top, scale })) {
                    Object.defineProperty(viewport, name, { configurable: true, value });
                }
                viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
                await frame(); await frame(); geometry(); assertions += 3;
                const composer = document.querySelector('#chat-workspace footer').getBoundingClientRect();
                check(scale !== 1 || composer.bottom <= height + top, 'composer clears visual-only keyboard'); assertions++;
                check(scale !== 1 || button().getBoundingClientRect().top >= Math.max(top, document.querySelector('#chat-workspace .app-header').getBoundingClientRect().bottom), 'long composer keeps button above keyboard and below header'); assertions++;
                check(getComputedStyle($('user-input')).overflowY === 'auto', 'capped long input remains scrollable'); assertions++;
                check(scale === 1 || parseFloat($('chat-workspace').style.getPropertyValue('--composer-viewport-inset')) === 0, 'pinch zoom does not shift composer'); assertions++;
            }
        } finally {
            names.forEach((name, i) => descriptors[i] ? Object.defineProperty(viewport, name, descriptors[i]) : delete viewport[name]);
            $('user-input').value = ''; $('user-input').dispatchEvent(new Event('input', { bubbles: true }));
            viewport.dispatchEvent(new Event('resize')); $('user-input').blur(); await frame(); await frame();
        }
        return assertions;
    };
})();

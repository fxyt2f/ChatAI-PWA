/* Sidebar hover/focus tests against the real isolated UI and IndexedDB. */
(() => {
    const app = window.appLogic, ui = window.uiUtilsV136, st = window.state, db = window.dbUtils;
    const $ = id => document.getElementById(id);
    const trace = [], traced = {};
    const inputTrace = event => {
        trace.push({name:event.type,at:performance.now(),x:event.clientX,y:event.clientY,
            target:event.target.closest?.('button')?.dataset.sidebarAction || event.target.id || event.target.tagName,
            chat:event.target.closest?.('.chat-sidebar-item')?.dataset.chatId,scale:visualViewport.scale});
        if(trace.length>80)trace.shift();
    };
    for(const name of ['pointerdown','pointerup','click'])document.addEventListener(name,inputTrace,true);
    for (const name of ['openHistoryItemMenu','closeHistoryItemMenu','renderChatSidebarModels']) {
        traced[name] = ui[name];
        ui[name] = function (...args) {
            trace.push({name, at:performance.now(), chat:args[1], connected:args[0]?.isConnected,
                caller:new Error().stack.split('\n')[2]?.trim()});
            if (trace.length > 80) trace.shift();
            return traced[name].apply(this,args);
        };
    }
    const ids = [936101, 936102, 936103];
    const row = id => document.querySelector(`#chat-sidebar-list .chat-sidebar-item[data-chat-id="${id}"]`);
    const menu = id => row(id).querySelector('.chat-sidebar-item-menu');
    const open = id => row(id).querySelector('.chat-sidebar-item-open');
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = node => node.getBoundingClientRect().toJSON();
    let assertions = 0, palette, widths, originalRow, actions, downloads, restoreActions;
    const check = (ok, label) => { assertions++; if (!ok) throw new Error(label); };
    const wait = async (predicate, label) => {
        const deadline = performance.now() + 3000;
        while (!await predicate()) {
            if (performance.now() > deadline) throw new Error(label);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const cssColor = name => {
        const probe = document.createElement('span');
        probe.style.cssText = `display:none;background:${name.startsWith('--') ? `var(${name})` : name}`;
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value;
    };
    const verifyWidths = () => ids.forEach(id => {
        check(Math.abs(open(id).getBoundingClientRect().width - widths[id]) < 1, 'menu visibility keeps title column width');
    });
    const resetFocus = () => $('chat-sidebar-search-input').focus();
    const api = window.sidebarHoverV1361 = {
        ids,
        diagnostics() {
            return {trace, rows:ids.map(id=>({id,expanded:menu(id)?.getAttribute('aria-expanded'),active:row(id)?.classList.contains('menu-active')})),
                menuHidden:$('history-item-menu').classList.contains('hidden'), focus:document.activeElement?.outerHTML.slice(0,180),
                viewport:{scale:visualViewport.scale,left:visualViewport.offsetLeft,top:visualViewport.offsetTop},currentChat:st.currentChatId,
                sidebarOpen:$('chat-screen').classList.contains('chat-sidebar-open')};
        },
        finish() { Object.assign(ui,traced);for(const name of ['pointerdown','pointerup','click'])document.removeEventListener(name,inputTrace,true); },
        count: () => assertions,
        async prepare(dark) {
            trace.push({name:'prepare',dark,width:innerWidth,touch:matchMedia('(any-pointer:coarse)').matches,at:performance.now()});
            ui.closeHistoryItemMenu(); ui.closeChatSearch({ restoreFocus: false });
            window.settingsUiV136.closePopover(false);
            await ui.showScreen('chat', true);
            await app.updateLocalUiSetting('enableWideMode', true);
            await app.setProfileOverride('theme', false);
            await app.saveAppearanceValues('theme', { darkMode: dark }, { global: true });
            document.body.classList.add('wide-mode-enabled'); ui.applyDarkMode();
            const now = Date.now() + 3600000;
            await new Promise((resolve, reject) => {
                const tx = st.db.transaction('chats', 'readwrite');
                ids.forEach((id, i) => tx.objectStore('chats').put({ id, title: ['選択中のチャット', 'ホバーするチャット', 'もう一つのチャット'][i],
                    profileId: st.activeProfileId, messages: [{ role: 'user', content: `sidebar hover message ${i}`, timestamp: now }],
                    createdAt: now - i, updatedAt: now - i, isPinned: false }));
                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
            await app.loadChat(ids[0], { scrollAfterLoad: false });
            ui.updateChatSidebarResponsiveState(); ui.openChatSidebar();
            await wait(() => !window.testSidebarUiState.refreshTimer && !db.pendingChatSaves, 'sidebar saves and trailing refresh settle');
            await ui.renderChatSidebar({ refreshRecent: true });
            await Promise.all($('chat-history-sidebar').getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
            await frame(); resetFocus();
            palette = { tertiary: cssColor('--bg-tertiary'), selected: cssColor('--sidebar-selected-bg'),
                primary: cssColor('--text-primary'), secondary: cssColor('--text-secondary'),
                menuHover: cssColor('color-mix(in srgb, var(--text-primary) 8%, var(--bg-tertiary))') };
            widths = Object.fromEntries(ids.map(id => [id, open(id).getBoundingClientRect().width]));
            check(document.body.classList.contains('dark-mode') === dark, 'requested theme applied');
            check(getComputedStyle(row(ids[0])).backgroundColor === palette.selected, 'selected background retained');
            return { mode: ui.getChatSidebarMode(), palette };
        },
        point(id, target = 'open') { return rect(target === 'menu' ? menu(id) : open(id)); },
        async baseline(touch) {
            await wait(() => ids.every(id => getComputedStyle(menu(id)).opacity === (touch ? '1' : '0')), 'idle menu opacity');
            ids.forEach(id => {
                check(getComputedStyle(menu(id)).pointerEvents === (touch ? 'auto' : 'none'), 'idle pointer handling');
                check(menu(id).tabIndex === 0, 'menu remains in keyboard tab order');
                const b = rect(menu(id));
                check(b.width === 40 && b.height === 40, '40px menu hit area');
                if (!touch) check(!document.elementFromPoint(b.x + 20, b.y + 20)?.closest('.chat-sidebar-item-menu'), 'hidden menu excluded from hit testing');
            });
            verifyWidths();
            check(getComputedStyle(menu(ids[1])).transitionProperty.includes('opacity') &&
                parseFloat(getComputedStyle(menu(ids[1])).transitionDuration) > 0, 'short opacity fade configured');
        },
        async hovered(id, touch = false) {
            if (!touch) await wait(() => row(id).matches(':hover') && open(id).matches(':hover'), 'native hover state settles after redraw');
            await wait(() => getComputedStyle(menu(id)).opacity === '1', 'hovered menu fades in');
            check(row(id).matches(':hover'), 'native pointer hovers row');
            check(getComputedStyle(row(id)).backgroundColor === (row(id).hasAttribute('aria-current') ? palette.selected : palette.tertiary), 'row uses correct selected/hover color');
            check(getComputedStyle(open(id)).backgroundColor === 'rgba(0, 0, 0, 0)', 'inner button stays transparent');
            check(getComputedStyle(open(id)).color === palette.primary, 'inner button keeps text color');
            check(getComputedStyle(open(id)).boxShadow === 'none', 'inner button has no global hover shadow');
            check(getComputedStyle(menu(id)).pointerEvents === 'auto', 'shown menu accepts pointer');
            if (!touch) {
                await wait(() => ids.filter(other => other !== id).every(other => getComputedStyle(menu(other)).opacity === '0'), 'other rows stay hidden');
                check(ids.filter(other => other !== id).every(other => getComputedStyle(menu(other)).pointerEvents === 'none'), 'other rows remain noninteractive');
            }
            verifyWidths();
        },
        async circle(id) {
            await wait(() => getComputedStyle(menu(id)).backgroundColor === palette.menuHover, 'menu hover uses theme gray');
            const button = menu(id), icon = button.querySelector('span'), b = rect(button), i = rect(icon);
            check(button.matches(':hover'), 'native pointer hovers menu');
            check(getComputedStyle(button).borderRadius === '50%', 'circular menu hover');
            check(getComputedStyle(button).color === palette.secondary && getComputedStyle(button).boxShadow === 'none', 'menu hover keeps color without global shadow');
            check(Math.abs(i.x + i.width / 2 - b.x - 20) < 1 && Math.abs(i.y + i.height / 2 - b.y - 20) < 1, 'menu icon centered');
            check(getComputedStyle(row(id)).backgroundColor === (row(id).hasAttribute('aria-current') ? palette.selected : palette.tertiary), 'menu hover preserves row background');
            check(getComputedStyle(button).backgroundColor !== getComputedStyle(row(id)).backgroundColor, 'circle distinguishable from row background');
        },
        async opened(id) {
            await wait(() => !$('history-item-menu').classList.contains('hidden'), 'native activation opens menu');
            await wait(() => getComputedStyle(menu(id)).opacity === '1', 'active menu fade completes');
            check(menu(id).getAttribute('aria-expanded') === 'true' && row(id).classList.contains('menu-active'), 'menu expansion state applied');
            check(getComputedStyle(menu(id)).opacity === '1', 'menu remains visible while focus is in popup');
            check(getComputedStyle(row(id)).backgroundColor === (row(id).hasAttribute('aria-current') ? palette.selected : palette.tertiary), 'popup keeps row background');
            const items = [...$('history-item-menu').querySelectorAll('[data-history-menu-action]')];
            check(items.every(item => !item.hidden && !item.disabled), 'all five actions enabled');
            check(items.map(item => item.dataset.historyMenuAction).join() === 'pin,rename,export,duplicate,delete', 'all five existing actions retained');
        },
        async escaped(id) {
            await wait(() => $('history-item-menu').classList.contains('hidden'), 'Escape closes popup');
            check(document.activeElement === menu(id), 'Escape restores menu trigger focus');
            check(getComputedStyle(menu(id)).opacity === '1', 'focused menu remains visible');
        },
        focusOpen(id) { open(id).focus(); },
        focusMenu(id) {
            check(document.activeElement === menu(id), 'native Tab reaches menu button');
            check(getComputedStyle(menu(id)).pointerEvents === 'auto', 'keyboard focus reveals menu');
        },
        blur: resetFocus,
        async redraw() {
            originalRow = row(ids[1]); await ui.renderChatSidebar({ refreshRecent: true }); resetFocus(); await frame();
            check(originalRow !== row(ids[1]), 'sidebar rows actually recreated');
            check(getComputedStyle(row(ids[0])).backgroundColor === palette.selected, 'selected color survives redraw');
        },
        async switched() {
            await wait(() => st.currentChatId === ids[1], 'native row activation switches chat');
            await wait(() => row(ids[1])?.getAttribute('aria-current') === 'page', 'selection updated after chat switch');
            check(!row(ids[0]).hasAttribute('aria-current'), 'old row selection cleared');
            await wait(() => !window.testSidebarUiState.refreshTimer && !db.pendingChatSaves, 'chat switch persistence settles');
            ui.openChatSidebar(); await ui.renderChatSidebar({ refreshRecent: true }); await frame(); resetFocus();
            check(getComputedStyle(row(ids[1])).backgroundColor === palette.selected, 'switched selection color retained');
        },
        beginActions() {
            const original = { execute: ui.executeHistoryAction, prompt: ui.showCustomPrompt, confirm: ui.showCustomConfirm,
                alert: ui.showCustomAlert, click: HTMLAnchorElement.prototype.click, create: URL.createObjectURL };
            actions = []; downloads = []; const urls = new Map();
            ui.showCustomPrompt = async () => '名前変更済みのチャット'; ui.showCustomConfirm = async () => true; ui.showCustomAlert = async () => {};
            URL.createObjectURL = blob => { const url = original.create.call(URL, blob); urls.set(url, blob); return url; };
            HTMLAnchorElement.prototype.click = function () {
                if (this.download) downloads.push({ fileName: this.download, blob: urls.get(this.href) });
                else original.click.call(this);
            };
            ui.executeHistoryAction = async function (action, context, options) {
                const result = await original.execute.call(this, action, context, options);
                actions.push({ action, context: { chatId: context.chatId, source: context.source }, result }); return result;
            };
            restoreActions = () => {
                ui.executeHistoryAction = original.execute; ui.showCustomPrompt = original.prompt; ui.showCustomConfirm = original.confirm;
                ui.showCustomAlert = original.alert; HTMLAnchorElement.prototype.click = original.click; URL.createObjectURL = original.create;
            };
        },
        async actionDone(action) {
            await wait(() => actions.some(entry => entry.action === action), 'native action completes: ' + action);
            const entry = actions.find(entry => entry.action === action);
            check(entry.result?.ok === true && entry.context.source === 'sidebar', 'real sidebar action succeeds: ' + action);
            if (action === 'pin') check((await db.getChat(ids[1])).isPinned === true, 'pin persisted');
            if (action === 'rename') check((await db.getChat(ids[1])).title === '名前変更済みのチャット', 'rename persisted');
            if (action === 'duplicate') check((await db.getChat(entry.result.chatId)).messages[0].content === 'sidebar hover message 1', 'duplicate persisted');
            if (action === 'delete') check(!await db.getChat(ids[2]), 'delete persisted');
            if (action === 'export') check(downloads.length === 1 && downloads[0].fileName.endsWith('.txt') &&
                (await downloads[0].blob.text()).includes('sidebar hover message 1'), 'real export text generated without a disk download');
            await ui.renderChatSidebar({ refreshRecent: true }); await frame();
        },
        endActions() { restoreActions?.(); return actions.map(entry => ({ action: entry.action, ok: entry.result.ok })); },
        phone() {
            check(ui.getChatSidebarMode() === 'disabled', 'existing phone sidebar breakpoint retained');
            check($('chat-history-sidebar').getBoundingClientRect().width === 0, 'phone sidebar remains hidden');
            check(getComputedStyle(menu(ids[1])).opacity === '1', 'touch CSS remains accessible at phone width');
        }
    };
})();

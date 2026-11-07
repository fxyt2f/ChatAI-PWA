/* Production DOM/IndexedDB paths; explicit gates control event and save order. */
window.runDialogRacesV1361 = async function () {
    const app = window.appLogic, ui = window.uiUtilsV136, st = window.state, db = window.dbUtils;
    const dialog = document.getElementById('system-prompt-dialog');
    const editor = document.getElementById('system-prompt-editor');
    const results = [];
    let assertions = 0;
    const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
    const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
    const enteredGate = async promise => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('async gate was never reached')), 5000); })]); }
        finally { clearTimeout(timer); }
    };
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const input = value => { editor.value = value; editor.dispatchEvent(new Event('input', { bubbles: true })); };
    const consistent = () => check(dialog.open === st.isEditingSystemPrompt, 'native open and editing state disagree');
    async function reset() {
        Object.assign(ui, window.testRealUi);
        st.isSending = false; st.editingMessageIndex = null;
        if (st.isEditingSystemPrompt) await app.closeSystemPromptDialog();
        document.querySelectorAll('dialog[open]').forEach(d => d.close('cancel'));
        await frame();
        await ui.showScreen('chat', true);
        app.startNewChat(); await st.executionSettingsReady;
        st.currentMessages = [{ role: 'user', content: 'F1/F2 fixture', timestamp: Date.now() }];
        st.currentSystemPrompt = 'initial';
        await db.saveChat(); ui.updateSystemPromptUI();
        // Avoid leaving timers and fixture bubbles for the next suite.
        clearTimeout(st.systemPromptSaveTimer); st.systemPromptSaveTimer = 0;
    }
    async function run(name, fn) {
        document.documentElement.dataset.dialogRaceStatus = name;
        try { await reset(); await fn(); consistent(); results.push('PASS '+name); }
        catch (error) { results.push('FAIL '+name+': '+error.message); }
    }
    async function holdHistory(fn) {
        const original = SettingsV136.rememberHistoryContextsAsyncV136;
        const entered = gate(), release = gate(); let blocked = false;
        SettingsV136.rememberHistoryContextsAsyncV136 = async (...args) => {
            if (!blocked) { blocked = true; entered.resolve(); await release.promise; }
            return original(...args);
        };
        try { await fn(enteredGate(entered.promise), release.resolve); }
        finally { release.resolve(); SettingsV136.rememberHistoryContextsAsyncV136 = original; }
    }
    await run('F1 reopen before queued close event preserves the new editor and focus', async () => {
        await app.openSystemPromptDialog();
        const queued = gate();
        const holdClose = event => {
            if (event.target === dialog && event.isTrusted) { event.stopImmediatePropagation(); queued.resolve(); }
        };
        window.addEventListener('close', holdClose, true);
        try {
            input('first edit'); await app.closeSystemPromptDialog();
            // No frame/task yield between close completion and the reopen request.
            await app.openSystemPromptDialog(); input('new unsaved editor');
            await enteredGate(queued.promise);
            editor.focus();
            // Deliver the old notification deterministically after the reopen.
            // Observe any close work it starts, so slow IndexedDB cannot hide
            // the bug merely by completing after our next animation frame.
            const originalClose = app.closeSystemPromptDialog;
            let staleClosing;
            app.closeSystemPromptDialog = function (...args) { return staleClosing = originalClose.apply(this, args); };
            try {
                dialog.dispatchEvent(new Event('close'));
                await staleClosing; await frame();
                check(dialog.open && st.isEditingSystemPrompt, 'stale close dismissed the reopened dialog');
                check(editor.value === 'new unsaved editor' && app.hasUnsavedSystemPrompt(), 'stale close discarded or saved the new edit');
                check(document.activeElement === editor, 'stale close stole editor focus');
            } finally { app.closeSystemPromptDialog = originalClose; }
        } finally { window.removeEventListener('close', holdClose, true); }
        await app.closeSystemPromptDialog();
        check((await db.getChat(st.currentChatId)).systemPrompt === 'new unsaved editor', 'reopened edit not persisted');
    });
    await run('F1 settings transition invalidates a pending open before its first frame', async () => {
        await holdHistory(async (entered, release) => {
            const opening = app.openSystemPromptDialog(); await entered;
            const transition = ui.showScreen('settings', true);
            release(); await opening; // Resume before showScreen updates currentScreen.
            check(!dialog.open && !st.isEditingSystemPrompt, 'pending open survived screen transition');
            await transition;
            check(st.currentScreen === 'settings' && !dialog.open, 'dialog opened above settings');
        });
    });
    await run('F1 returning from settings cannot revive an old open request', async () => {
        await holdHistory(async (entered, release) => {
            const opening = app.openSystemPromptDialog(); await entered;
            await ui.showScreen('settings', true); await ui.showScreen('chat', true);
            release(); await opening;
            check(!dialog.open, 'request revived after leaving and returning');
        });
    });
    await run('F1 loading another chat invalidates a pending open', async () => {
        const source = st.currentChatId;
        const destination = await db.saveChat(null, { messages: [{role:'user',content:'destination'}], systemPrompt:'destination' });
        await holdHistory(async (entered, release) => {
            const opening = app.openSystemPromptDialog(); await entered;
            const loaded = await app.loadChat(destination, {scrollAfterLoad:false});
            check(loaded.ok && st.currentChatId !== source, 'chat switch fixture failed');
            release(); await opening;
            check(!dialog.open && !st.isEditingSystemPrompt, 'old chat editor opened');
            check(st.currentSystemPrompt === 'destination', 'destination prompt changed');
        });
    });
    await run('F1 close during pending open cancels it', async () => {
        await holdHistory(async (entered, release) => {
            const opening = app.openSystemPromptDialog(); await entered;
            await app.closeSystemPromptDialog(); release(); await opening;
            check(!dialog.open && !st.isEditingSystemPrompt, 'cancelled opening resumed');
        });
    });
    await run('F1 a stale history preparation rejection is cancelled after a chat change', async () => {
        const original = SettingsV136.rememberHistoryContextsAsyncV136;
        const entered = gate(), release = gate();
        SettingsV136.rememberHistoryContextsAsyncV136 = async () => {
            entered.resolve(); await release.promise;
            throw new DOMException('controlled old history owner', 'AbortError');
        };
        let opening;
        try {
            opening = app.openSystemPromptDialog(); await enteredGate(entered.promise);
            app.startNewChat(); await st.executionSettingsReady;
            release.resolve();
            check(await opening === false && !dialog.open, 'stale history rejection was not cancelled');
        } finally { release.resolve(); await Promise.allSettled([opening]); SettingsV136.rememberHistoryContextsAsyncV136 = original; }
    });
    await run('F1 reversed open completions cannot reset a newer edit', async () => {
        await holdHistory(async (entered, release) => {
            const older = app.openSystemPromptDialog(); await entered;
            await app.openSystemPromptDialog(); input('  latest open edit  ');
            release(); await older;
            check(dialog.open && editor.value === '  latest open edit  ', 'old opening reset editor');
            check(app.hasUnsavedSystemPrompt(), 'old opening cleared dirty revision');
        });
    });
    await run('F1 superseded close completion cannot close or clear a new editing operation', async () => {
        await app.openSystemPromptDialog(); input('saving A');
        await holdHistory(async (entered, release) => {
            const closing = app.closeSystemPromptDialog(); await entered;
            await app.openSystemPromptDialog(); input('saving B');
            release(); check(await closing === false, 'superseded close reported success');
            check(dialog.open && editor.value === 'saving B', 'old close discarded newer editor'); consistent();
            await app.closeSystemPromptDialog();
            check((await db.getChat(st.currentChatId)).systemPrompt === 'saving B', 'latest edit not persisted');
        });
    });
    await run('F1 latest close still awaits the latest serialized save', async () => {
        await app.openSystemPromptDialog(); input('serialized A');
        await holdHistory(async (entered, release) => {
            const oldClose = app.closeSystemPromptDialog(); await entered;
            await app.openSystemPromptDialog(); input('serialized B');
            const latestClose = app.closeSystemPromptDialog();
            check(dialog.open, 'closed before save completion'); consistent();
            release(); await oldClose; check(await latestClose, 'latest close did not finish');
            check(!dialog.open && !st.isEditingSystemPrompt, 'latest close not reflected');
            check((await db.getChat(st.currentChatId)).systemPrompt === 'serialized B', 'latest snapshot not saved');
        });
    });
    await run('F1 superseded save failure leaves the new editor intact for retry', async () => {
        await app.openSystemPromptDialog(); input('failed older save');
        const original = db.saveChat, entered = gate(), release = gate(); let closing;
        db.saveChat = async () => { entered.resolve(); await release.promise; throw new Error('superseded controlled failure'); };
        try {
            closing = app.closeSystemPromptDialog(); await enteredGate(entered.promise);
            await app.openSystemPromptDialog(); input('newer failed draft');
            release.resolve(); check(await closing === false, 'old failure reported success');
            check(dialog.open && editor.value === 'newer failed draft' && app.hasUnsavedSystemPrompt(), 'old failure cleared new draft');
            consistent();
        } finally { release.resolve(); await Promise.allSettled([closing]); db.saveChat = original; }
        check(await app.closeSystemPromptDialog(), 'latest draft retry failed');
        check((await db.getChat(st.currentChatId)).systemPrompt === 'newer failed draft', 'retry saved the wrong snapshot');
    });
    await run('F1 save failure and stale close preserve content until a successful retry', async () => {
        await app.openSystemPromptDialog(); input('retain failed value');
        const original = db.saveChat;
        db.saveChat = async () => { throw new Error('F1 controlled save failure'); };
        try {
            check(await app.closeSystemPromptDialog() === false, 'failed close reported success');
            dialog.dispatchEvent(new Event('close')); await frame();
            check(dialog.open && st.isEditingSystemPrompt && editor.value === 'retain failed value', 'failed draft lost');
            check(app.hasUnsavedSystemPrompt() && st.systemPromptSaveStatus === 'error', 'failed revision marked saved');
        } finally { db.saveChat = original; }
        check(await app.closeSystemPromptDialog(), 'retry failed');
        check((await db.getChat(st.currentChatId)).systemPrompt === 'retain failed value', 'retry lost draft');
    });
    await run('F1 native close waits visibly for saving and recovers on failure', async () => {
        const opener = document.getElementById('user-input'); opener.focus();
        await app.openSystemPromptDialog(); input('native close draft');
        const original = db.saveChat, entered = gate(), release = gate();
        db.saveChat = async () => { entered.resolve(); await release.promise; throw new Error('native controlled failure'); };
        try {
            dialog.close(); await enteredGate(entered.promise); consistent();
            check(dialog.open, 'native close hid pending edits');
            const closing = app.closeSystemPromptDialog(); release.resolve();
            check(await closing === false, 'native close failure reported success');
            check(dialog.open && editor.value === 'native close draft', 'native close lost failed draft');
        } finally { release.resolve(); db.saveChat = original; }
        await app.closeSystemPromptDialog();
        await frame(); check(document.activeElement === opener, 'native failure/retry lost focus restoration');
    });

    const pointer = (target, type, point = {x:2,y:2}, extra = {}) => target.dispatchEvent(new PointerEvent(type, {
        bubbles:true, cancelable:true, pointerId:1, pointerType:'mouse', isPrimary:true,
        button:0, clientX:point.x, clientY:point.y, ...extra
    }));
    const outsideClick = async (between = () => {}, extra = {}, end = {x:2,y:2}) => {
        pointer(dialog, 'pointerdown', undefined, extra); await between();
        pointer(dialog, 'pointerup', end, extra); await frame();
    };
    await run('F2 ordinary outside click dismisses', async () => {
        await app.openSystemPromptDialog(); await outsideClick(); check(!dialog.open, 'outside click ignored');
    });
    await run('F2 programmatic background and document scroll do not cancel an outside click', async () => {
        await app.openSystemPromptDialog();
        await outsideClick(() => {
            const background = document.querySelector('#chat-screen .main-content');
            background.scrollTop += 40;
            // A deterministic notification even if layout clamps scrollTop.
            background.dispatchEvent(new Event('scroll'));
            document.dispatchEvent(new Event('scroll'));
        });
        check(!dialog.open, 'unrelated background scroll cancelled click');
    });
    await run('F2 mouse drag and a distant release without a move event stay open', async () => {
        await app.openSystemPromptDialog();
        await outsideClick(() => { pointer(dialog, 'pointermove', {x:30,y:30}); });
        check(dialog.open, 'drag closed dialog');
        await outsideClick(undefined, {}, {x:40,y:40});
        check(dialog.open, 'distant release treated as click');
    });
    await run('F2 touch scroll movement, related scroll and pointer cancellation stay open', async () => {
        await app.openSystemPromptDialog();
        await outsideClick(() => {
            pointer(dialog, 'pointermove', {x:3,y:35}, {pointerType:'touch'});
            dialog.dispatchEvent(new Event('scroll'));
        }, {pointerType:'touch'});
        check(dialog.open, 'touch scroll dismissed');
        await outsideClick(() => pointer(dialog, 'pointercancel', undefined, {pointerType:'touch'}), {pointerType:'touch'});
        check(dialog.open, 'cancelled touch dismissed');
        await outsideClick(() => dialog.dispatchEvent(new WheelEvent('wheel', {bubbles:true,deltaY:60})));
        check(dialog.open, 'wheel gesture dismissed');
        // Exercise a scroll source on the pressed content path, then release outside.
        const r = editor.getBoundingClientRect(), inside = {x:r.left+12,y:r.top+12};
        pointer(editor, 'pointerdown', inside, {pointerType:'touch'});
        editor.dispatchEvent(new Event('scroll'));
        pointer(dialog, 'pointerup', undefined, {pointerType:'touch'});
        check(dialog.open, 'internal scroll released outside dismissed');
    });
    await run('F2 inside clicks and mixed inside/outside endpoints stay open', async () => {
        await app.openSystemPromptDialog();
        const r = editor.getBoundingClientRect(), point = {x:r.left+12,y:r.top+12};
        pointer(editor, 'pointerdown', point); pointer(editor, 'pointerup', point);
        check(dialog.open, 'inside click dismissed');
        pointer(editor, 'pointerdown', point); pointer(dialog, 'pointerup');
        check(dialog.open, 'inside to outside dismissed');
        pointer(dialog, 'pointerdown'); pointer(editor, 'pointerup', point);
        check(dialog.open, 'outside to inside dismissed');
    });
    await run('F2 stacked dialogs dismiss only the top surface and consume pointer events', async () => {
        await app.openSystemPromptDialog();
        const top = document.getElementById('confirmDialog');
        const pending = ui.showCustomConfirm('F2 stacked dialog');
        let leaked = 0;
        const leak = () => leaked++;
        document.body.addEventListener('pointerup', leak);
        try {
            const down = pointer(top, 'pointerdown'), up = pointer(top, 'pointerup');
            check(!down && !up && leaked === 0, 'backdrop pointer event leaked');
            await pending;
            check(!top.open && dialog.open && st.isEditingSystemPrompt, 'underlying dialog dismissed');
        } finally { document.body.removeEventListener('pointerup', leak); }
    });
    await reset();
    return results.join('\n')+'\n'+(results.some(r => r.startsWith('FAIL')) ? 'DIALOG RACES FAILED' : `ALL PASSED (${results.length} F1/F2 regressions; ${assertions} assertions)`);
};

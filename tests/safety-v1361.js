/* Real DOM/IndexedDB regressions. Gates control async order, without timing races. */
window.runSafetyV1361 = async function () {
    const shell = await (await fetch('../index.html')).text();
    for (const name of ['marked.js','purify.min.js']) {
        if (shell.includes('./'+name)) (0,eval)(await (await fetch('../'+name)).text());
    }
    // The isolated fixture skips initialize(); use its production Markdown defaults.
    marked.setOptions({breaks:true,gfm:true,smartypants:false});
    const app = window.appLogic, db = window.dbUtils, st = window.state, ui = window.uiUtilsV136;
    const $ = id => document.getElementById(id), results = [];
    const check = (ok, why) => { if (!ok) throw new Error(why); };
    const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const input = value => { $('system-prompt-editor').value = value; $('system-prompt-editor').dispatchEvent(new Event('input', {bubbles:true})); };
    async function reset(empty = false) {
        clearTimeout(st.systemPromptSaveTimer);
        st.isEditingSystemPrompt = false;
        document.querySelectorAll('dialog[open]').forEach(d => d.close('cancel'));
        await frame();
        Object.assign(ui, window.testRealUi);
        st.isSending = false; st.editingMessageIndex = null;
        app.startNewChat(); await st.executionSettingsReady;
        st.currentMessages = empty ? [] : [{role:'user', content:'safety fixture', timestamp:Date.now()}];
        st.currentSystemPrompt = 'initial'; st.systemPromptSaveStatus = 'saved';
        await db.saveChat(); ui.updateSystemPromptUI();
    }
    async function run(name, fn) {
        try { await reset(); await fn(); results.push('PASS '+name); }
        catch (e) { results.push('FAIL '+name+': '+e.message); }
        finally { clearTimeout(st.systemPromptSaveTimer); }
    }
    await run('R1 model, thought and imported/reloaded HTML are sanitized', async () => {
        window.__xssSafety = 0;
        const attack = '<img src="invalid-safety-image" onerror="window.__xssSafety++"><svg onload="window.__xssSafety++"></svg><iframe srcdoc="<script>parent.__xssSafety++</script>"></iframe><a href="javascript:window.__xssSafety++">bad</a>';
        st.currentMessages = app.parseImportedHistory('<|#|model|#|>'+attack+'<|#|/model|#|>').messages;
        st.currentMessages[0].thoughtSummary = attack;
        // Exercise the same explicit-record persistence path used for restored history.
        const snapshot = await db.getChat(st.currentChatId);
        await db.saveChat(null, {...snapshot, messages:st.currentMessages});
        const record = await db.getChat(st.currentChatId);
        st.currentMessages = record.messages;
        const node = ui.createMessageElement('model',record.messages[0].content,0);
        $('message-container').replaceChildren(node); await frame();
        check(!node.querySelector('iframe,svg,script,[onerror],[onload],[srcdoc]'), 'dangerous HTML survived');
        check(![...node.querySelectorAll('a')].some(a => a.href.startsWith('javascript:')), 'script URL survived');
        check(window.__xssSafety === 0, 'payload executed');
    });
    await run('R1 image IDs cannot become HTML attributes', async () => {
        const id = 'image" onerror="window.__xssSafety++';
        st.currentMessages = [{role:'model',content:'[IMAGE_HERE]',imageIds:[id],timestamp:Date.now()}];
        const node = ui.createMessageElement('model','[IMAGE_HERE]',0);
        const img = node.querySelector('img');
        check(img?.dataset.imageId === id && !img.hasAttribute('onerror'), 'image ID escaped its attribute');
    });
    await run('R1 normal Markdown and streaming text remain usable', async () => {
        const text = '# Heading\n\n[link](https://example.test)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = "<tag>";\n```';
        st.currentMessages = [{role:'model',content:text,timestamp:Date.now()}];
        const node = ui.createMessageElement('model',text,0);
        check(node.querySelector('h1') && node.querySelector('table td') && node.querySelector('pre code'), 'Markdown structure lost');
        check(node.querySelector('a')?.rel.includes('noopener'), 'link protection lost');
        const streaming = ui.createMessageElement('model','<img onerror="bad()">',0,true);
        check(!streaming.querySelector('.message-content img'), 'streaming interpreted untrusted HTML');
    });
    await run('R1 editing a restored model message uses the same sanitizer',async()=>{
        st.currentMessages.splice(0,st.currentMessages.length,{role:'model',content:'before edit',timestamp:Date.now()});
        await db.saveChat();
        const node=ui.createMessageElement('model','before edit',0);$('message-container').replaceChildren(node);
        await app.startEditMessage(0,node);
        const editor=node.querySelector('.edit-textarea');check(editor,'message editor missing');
        editor.value='<img src="invalid-edit-image" onerror="window.__xssSafety++">\n\n[bad](javascript:bad())';
        await app.saveEditMessage(0,node,editor);
        check(!node.querySelector('.message-content [onerror]'),'edit bypassed sanitizer');
        check(![...node.querySelectorAll('.message-content a')].some(a=>a.href.startsWith('javascript:')),'edit retained script URL');
    });
    await run('R2 older completion cannot mark newer edits saved', async () => {
        await app.openSystemPromptDialog(); const entered=gate(), release=gate(), enteredB=gate(), releaseB=gate();
        const original=SettingsV136.rememberHistoryContextsAsyncV136;
        SettingsV136.rememberHistoryContextsAsyncV136=async (messages,prompt) => {
            if(prompt==='revision A'){entered.resolve();await release.promise;}
            if(prompt==='revision B'){enteredB.resolve();await releaseB.promise;}
            return original(messages,prompt);
        };
        let first;
        try {
            input('revision A'); first=app.saveCurrentSystemPrompt(); await entered.promise;
            input('revision B'); st.currentSystemPrompt='concurrent default update'; release.resolve();
            check(await Promise.race([enteredB.promise.then(()=>true),first.then(()=>false)]) === true,'save finished before persisting latest edit');
            check(st.systemPromptSaveStatus!=='saved','newer pending edit marked saved');
            const closing=app.closeSystemPromptDialog(); await frame();
            check($('system-prompt-dialog').open,'dialog closed before latest save');
            releaseB.resolve(); await first; await closing;
            check((await db.getChat(st.currentChatId)).systemPrompt==='revision B','newest edit was lost');
            check(st.currentSystemPrompt==='revision B','mutable defaults replaced the editor value');
            check(!st.isEditingSystemPrompt && !$('system-prompt-dialog').open,'close did not finish');
        } finally { release.resolve(); releaseB.resolve(); if(first)await first; SettingsV136.rememberHistoryContextsAsyncV136=original; }
    });
    await run('R2 DB writes cannot finish in reverse order or duplicate a new chat', async () => {
        app.startNewChat(); await st.executionSettingsReady;
        st.currentMessages=[{role:'user',content:'queued new chat',timestamp:Date.now()}];
        const entered=gate(), release=gate(), original=SettingsV136.rememberHistoryContextsAsyncV136;
        SettingsV136.rememberHistoryContextsAsyncV136=async (messages,prompt) => {
            if(prompt==='queue A'){entered.resolve();await release.promise;}
            return original(messages,prompt);
        };
        let a,b;
        try {
            st.currentSystemPrompt='queue A'; a=db.saveChat(); await entered.promise;
            st.currentSystemPrompt='queue B'; b=db.saveChat();
            await frame(); release.resolve(); const [idA,idB]=await Promise.all([a,b]);
            check(idA===idB,'concurrent new-chat saves created different records');
            check((await db.getChat(idB)).systemPrompt==='queue B','older snapshot overwrote newer');
        } finally {release.resolve();await Promise.allSettled([a,b]);SettingsV136.rememberHistoryContextsAsyncV136=original;}
    });
    await run('R2 save failure keeps editor, content and dirty state', async () => {
        await app.openSystemPromptDialog(); input('keep on failure'); const original=db.saveChat;
        db.saveChat=async()=>{throw new Error('controlled failure');};
        try {
            check(await app.closeSystemPromptDialog()===false,'failed save reported success');
            check($('system-prompt-dialog').open && $('system-prompt-editor').value==='keep on failure','failed edit lost');
            check(st.systemPromptSaveStatus==='error','save error not visible');
        } finally {db.saveChat=original;}
        check(await app.closeSystemPromptDialog()===true,'retry did not recover');
    });
    await run('R2 delayed old-chat save cannot overwrite destination', async () => {
        const source=st.currentChatId, entered=gate(), release=gate(), original=SettingsV136.rememberHistoryContextsAsyncV136;
        SettingsV136.rememberHistoryContextsAsyncV136=async (messages,prompt)=>{
            if(prompt==='source pending'){entered.resolve();await release.promise;}
            return original(messages,prompt);
        };
        let saving;
        try {
            st.currentSystemPrompt='source pending';saving=db.saveChat();await entered.promise;
            app.startNewChat();await st.executionSettingsReady;st.currentSystemPrompt='destination';
            const destination=db.saveChat();release.resolve();await Promise.all([saving,destination]);
            check(st.currentChatId!==source && st.currentSystemPrompt==='destination','active owner corrupted');
            check((await db.getChat(source)).systemPrompt==='source pending','source snapshot lost');
            check((await db.getChat(st.currentChatId)).systemPrompt==='destination','destination overwritten');
        } finally {release.resolve();if(saving)await saving;SettingsV136.rememberHistoryContextsAsyncV136=original;}
    });
    await run('R5 clearing the last prompt persists; empty drafts create no record', async () => {
        await reset(true); const id=st.currentChatId; await app.openSystemPromptDialog();input('');
        check(await app.closeSystemPromptDialog()===true,'clear failed');
        check((await db.getChat(id)).systemPrompt==='','cleared prompt reappeared');
        app.startNewChat();await st.executionSettingsReady;st.currentSystemPrompt='';
        check(await db.saveChat()==null && st.currentChatId==null,'empty draft created record');
    });
    await run('R5 clearing a new prompt while its first insert is pending persists',async()=>{
        app.startNewChat();await st.executionSettingsReady;st.currentSystemPrompt='first insert';
        const entered=gate(),release=gate(),original=SettingsV136.rememberHistoryContextsAsyncV136;let a,b;
        SettingsV136.rememberHistoryContextsAsyncV136=async(messages,prompt)=>{
            if(prompt==='first insert'){entered.resolve();await release.promise;}return original(messages,prompt);
        };
        try {
            a=db.saveChat();await entered.promise;st.currentSystemPrompt='';b=db.saveChat();release.resolve();
            const [first,last]=await Promise.all([a,b]);
            check(first===last && (await db.getChat(last)).systemPrompt==='','clear lost during first insert');
        }finally{release.resolve();await Promise.allSettled([a,b]);SettingsV136.rememberHistoryContextsAsyncV136=original;}
    });
    await run('R2 transaction abort after put success never adopts an uncommitted chat ID',async()=>{
        app.startNewChat();await st.executionSettingsReady;st.currentSystemPrompt='aborted insert';
        const original=st.db.transaction;
        st.db.transaction=function(...args){
            const tx=original.apply(this,args);
            if(args[1]==='readwrite'){
                const get=tx.objectStore.bind(tx);
                tx.objectStore=name=>{
                    const store=get(name);
                    if(name==='chats'){
                        const put=store.put.bind(store);
                        store.put=(...data)=>{const request=put(...data);request.addEventListener('success',()=>tx.abort());return request;};
                    }
                    return store;
                };
            }
            return tx;
        };
        try {
            let failed=false;try{await db.saveChat();}catch{failed=true;}
            check(failed && st.currentChatId==null,'aborted transaction adopted chat ID');
        }finally{st.db.transaction=original;}
        check(await db.saveChat()!=null,'save queue did not recover after abort');
    });
    await run('R2 committed writes resolve even when a view update throws',async()=>{
        const original=ui.updateChatTitle;ui.updateChatTitle=()=>{throw new Error('controlled view failure');};
        try {check(await db.saveChat()===st.currentChatId,'committed write did not resolve');}
        finally{ui.updateChatTitle=original;}
        check(await db.saveChat()===st.currentChatId,'queue did not recover after view failure');
    });
    for(const mode of ['cancel','switch'])await run('R3 attachment processing cancelled via '+mode,async()=>{
        const entered=gate(),release=gate(),original=app.fileToBase64;
        app.fileToBase64=async()=>{entered.resolve();return release.promise;};
        const work=app.handleFileSelection([new File(['x'],'safety.txt',{type:'text/plain'})]);
        try {
            await entered.promise;
            check($('send-button').disabled,'conversion did not block send');
            if(mode==='cancel')$('cancel-attachment-processing').click();
            else {app.startNewChat();await st.executionSettingsReady;}
            release.resolve('eA==');await work;
            check(st.pendingAttachments.length===0,'cancelled attachment committed');
            check($('cancel-attachment-processing').hidden && !app.attachmentOperation,'processing controls did not recover');
        }finally{release.resolve('eA==');await work;app.fileToBase64=original;}
    });
    await run('R3 old conversion cannot reset or commit a newer attachment operation',async()=>{
        const enteredA=gate(),releaseA=gate(),enteredB=gate(),releaseB=gate(),original=app.fileToBase64;
        app.fileToBase64=async file=>{const a=file.name==='a.txt';(a?enteredA:enteredB).resolve();return (a?releaseA:releaseB).promise;};
        let a,b;
        try {
            a=app.handleFileSelection([new File(['a'],'a.txt',{type:'text/plain'})]);
            await enteredA.promise;$('cancel-attachment-processing').click();
            b=app.handleFileSelection([new File(['b'],'b.txt',{type:'text/plain'})]);
            await enteredB.promise;releaseA.resolve('YQ==');await a;
            check($('send-button').disabled && !$('cancel-attachment-processing').hidden && st.pendingAttachments.length===0,'old completion affected new operation');
            releaseB.resolve('Yg==');await b;
            check(st.pendingAttachments.length===1 && st.pendingAttachments[0].name==='b.txt','new attachment did not commit');
        } finally {releaseA.resolve('YQ==');releaseB.resolve('Yg==');await Promise.allSettled([a,b]);app.fileToBase64=original;}
    });
    await run('R3 encoding exception preserves successful files and restores controls',async()=>{
        const original=app.fileToBase64;
        app.fileToBase64=async file=>{
            if(file.name==='bad.txt')throw new Error('controlled encoding failure');
            return original.call(app,file);
        };
        try {
            await app.handleFileSelection(['first.txt','bad.txt','last.txt'].map(name=>new File(['x'],name)));
            check(!$('send-button').disabled && st.pendingAttachments.map(a=>a.name).join()==='first.txt,last.txt','encoding failure affected valid attachments');
            check($('composer-attachment-status').textContent.includes('変換失敗'),'encoding failure was not reported inline');
        } finally {app.fileToBase64=original;}
    });
    st.isEditingSystemPrompt=false;document.querySelectorAll('dialog[open]').forEach(d=>d.close('cancel'));
    return results.join('\n')+'\n'+(results.some(x=>x.startsWith('FAIL'))?'SAFETY FAILED':'ALL PASSED ('+results.length+' safety regressions)');
};

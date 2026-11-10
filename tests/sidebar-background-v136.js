/* Real application UI fixtures and geometry assertions; no external APIs. */
(() => {
    const $ = id => document.getElementById(id);
    const app = window.appLogic, st = window.state, ui = window.uiUtilsV136;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = node => { const r=node.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    const panels = {system:'system-prompt-dialog',format:'textFormattingDialog',summary:'summaryDialog',character:'characterProfileDialog',debug:'debugLogDialog',memory:'memoryManagementDialog'};
    window.prepareSidebarReviewV136 = async (kind, open=false, dark=false) => {
        for (const d of document.querySelectorAll('dialog[open]')) d.close();
        window.settingsUiV136.closePopover(false);
        if(st.isEditingSystemPrompt)await app.closeSystemPromptDialog({skipSave:true});
        ui.closeChatSearch({restoreFocus:false});
        st.isSending=false; st.editingMessageIndex=null; st.settings.enableWideMode=true;
        st.settings.darkMode=dark; document.body.classList.toggle('dark-mode',dark);
        document.body.classList.add('wide-mode-enabled');
        document.body.classList.remove('header-auto-hide','header-force-show');
        await ui.showScreen('chat',true);
        st.currentMessages=[{role:'user',content:'検索テスト Alpha alpha\n「こんにちは」\n次の文章です。',timestamp:1},{role:'model',content:'検索テスト Alpha\nキャラクターと物語を続けます。',timestamp:2}];
        st.currentChatId=null; st.currentSystemPrompt='物語の進行を手伝ってください。';
        await window.dbUtils.saveChat('検索テスト');
        ui.renderChatMessages();
        st.currentPersistentMemory={character_memory_花:{name:'花',description:'旅の仲間',personality:'穏やか'}};
        ui.updateChatSidebarResponsiveState();
        open ? ui.openChatSidebar() : ui.closeChatSidebar();
        await frame();
        st.settings.floatingPanelBehavior='always';app.applyFloatingPanelBehavior();
        $('debug-log-btn').classList.remove('hidden');
        if(kind==='search'||kind==='replace') {
            await ui.openChatSearch(); $('chat-search-query').value='Alpha';ui.runChatSearch({scrollToFirst:false});
            if(kind==='replace') {ui.setChatReplacePreviewOpen(true);$('chat-replace-input').value='Beta';$('chat-replace-target').value='both';ui.updateChatReplacePreview();}
        } else if(kind==='system') await app.openSystemPromptDialog();
        else if(kind==='format') app.openTextFormattingDialog();
        else if(kind==='summary') app._showSummaryDialog('物語のここまでの展開を圧縮したテキスト。',1200);
        else if(kind==='character') await app.openCharacterProfileDialog();
        else if(kind==='debug') app.openLogDialog();
        else if(kind==='memory') await app.openMemoryManagementDialog();
        else if(kind==='models') window.settingsUiV136.openModels($('chat-model-button'));
        else if(kind==='profile') window.settingsUiV136.openProfiles($('profile-card-header'));
        await document.fonts.ready; await frame();
        return window.measureSidebarReviewV136(kind);
    };
    window.measureSidebarReviewV136 = kind => {
        const node=$(panels[kind]||({panel:'floating-action-panel',search:'chat-search-dialog',replace:'chat-search-dialog',models:'execution-popover',profile:'execution-popover'}[kind]));
        const workspace=$('chat-workspace'), r=rect(workspace), p=node?rect(node):null;
        return {kind,width:innerWidth,workspace:r,panel:p,inert:workspace.inert,sidebarOpen:$('chat-screen').classList.contains('chat-sidebar-open'),mode:ui.getChatSidebarMode(),
            overflow:node?node.scrollWidth>node.clientWidth+1:false,
            visible:node?getComputedStyle(node).display!=='none':false,
            centerError:p?(p.left+p.width/2)-(r.left+r.width/2):null};
    };
    window.prepareBackgroundReviewV136 = async (screen, scenario) => {
        for(const d of document.querySelectorAll('dialog[open]'))d.close();
        ui.closeChatSearch({restoreFocus:false});if($('system-prompt-dialog').open)await app.closeSystemPromptDialog({skipSave:true});
        window.settingsUiV136.closePopover(false);ui.closeChatSidebar();
        const dark=scenario.startsWith('dark'), image=!scenario.endsWith('plain');
        st.settings.darkMode=dark;document.body.classList.toggle('dark-mode',dark);
        const alpha=scenario.includes('opacity')?.25:.75;
        document.documentElement.style.setProperty('--overlay-opacity-value',alpha);
        const c=document.createElement('canvas');c.width=480;c.height=480;const ctx=c.getContext('2d');
        ctx.fillStyle=scenario.includes('individual')?'#315c49':'#36567d';ctx.fillRect(0,0,480,480);
        ctx.fillStyle=scenario.includes('individual')?'#95c58b':'#8ab4e4';ctx.fillRect(0,0,240,240);ctx.fillRect(240,240,240,240);
        document.documentElement.style.setProperty('--chat-background-image',`url("${c.toDataURL()}")`);
        ui.setBackgroundImageVisible(image);
        await ui.showScreen(screen,true);
        if(screen==='settings'){window.settingsUiV136.selectCategory(innerWidth>=800?'general':null,false);}
        await new Promise(r=>setTimeout(r,850));await frame();
        const el=$(screen+'-screen'), overlay=screen==='chat'?getComputedStyle($('chat-overlay')):getComputedStyle(el,'::after');
        const style=getComputedStyle(el);
        return {screen,scenario,base:style.backgroundColor,overlayColor:overlay.backgroundColor,overlayOpacity:overlay.opacity,
            image:getComputedStyle(el,'::before').backgroundImage,imageOpacity:getComputedStyle(el,'::before').opacity,
            settingsContainers:screen==='settings'?['settings-layout','settings-category-nav','settings-detail'].map(c=>getComputedStyle(document.querySelector('.'+c)).backgroundColor):[],
            pointerEvents:overlay.pointerEvents};
    };
})();

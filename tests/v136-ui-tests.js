window.runSettingsUiTestsV136 = async function ({app,db,st,ui,el,realUi,realAppFunctions,test,assert,eq}) {
    const css=document.createElement('link');css.rel='stylesheet';css.href='../style.css';
    const loaded=new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=reject});document.head.append(css);await loaded;
    (0,eval)(await (await fetch('../settings-ui-v136.js')).text());
    const view=window.settingsUiV136;
    app.renderApiConfigList=realAppFunctions.renderApiConfigList;
    ui.renderChatMessages=realUi.renderChatMessages;
    app.renderApiConfigList();ui.applySettingsToUI();ui.updateProfileCardUI();
    const iconCanvas=document.createElement('canvas');iconCanvas.width=48;iconCanvas.height=48;
    const iconContext=iconCanvas.getContext('2d');iconContext.fillStyle='#1976d2';iconContext.fillRect(0,0,48,48);iconContext.fillStyle='white';iconContext.font='26px sans-serif';iconContext.fillText('B',14,34);
    st.activeProfile.icon=await new Promise(resolve=>iconCanvas.toBlob(resolve,'image/png'));await db.updateProfile(st.activeProfile);
    const oldIcon=st.profileIconUrls.get(st.activeProfileId);if(oldIcon)URL.revokeObjectURL(oldIcon);st.profileIconUrls.delete(st.activeProfileId);ui.updateProfileCardUI();
    const $=id=>document.getElementById(id);
    const wait=async fn=>{const end=Date.now()+2000;while(!await fn()){if(Date.now()>end)throw new Error('Timed out waiting for saved UI state');await new Promise(r=>setTimeout(r,10));}};
    const event=(id,value,type='input')=>{const input=$(id);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new Event(type,{bubbles:true}));};
    const openModelPicker=()=>{ $('chat-model-button').click();if(view.popover?.classList.contains('thinking-popover'))view.popover.querySelector('.thinking-model-switch').click(); };
    await test('UI categories retain existing controls and remove obsolete budget/profile model labels',async()=>{
        eq(document.querySelectorAll('[data-settings-category]').length,4);eq(document.querySelectorAll('[data-settings-panel]').length,4);
        eq(document.querySelectorAll('#settings-screen details').length,1);assert($('data-danger-settings').querySelector('details'));assert(!$('thinking-budget'));assert(!$('theme-settings-profile-scoped-toggle'));
        assert(!document.querySelector('.profile-menu-model'));assert(!$('profile-display-name-sub').textContent.includes('gemini'));
        for(const id of ['model-name','include-thoughts-toggle','enable-proofreading','summary-model-name','dark-mode-toggle','background-image-input'])assert($(id).closest('[data-settings-panel]').dataset.settingsPanel==='general',id);
        for(const id of ['enable-memory-toggle','temperature','dummy-user','gemini-enable-function-calling-toggle'])eq($(id).closest('[data-settings-panel]').dataset.settingsPanel,'profile');
        for(const id of ['dropbox-app-key-input','google-search-api-key','sd-api-url','sd-qc-model'])eq($(id).closest('[data-settings-panel]').dataset.settingsPanel,'integrations');
        assert($('include-thoughts-toggle').parentElement.textContent.includes('思考プロセスを表示'));
        const execution=st.currentExecutionSettings;st.currentExecutionSettings=null;st.executionInitializingV136=true;view.renderExecution();assert($('chat-model-button').disabled);assert($('chat-model-button').textContent.includes('準備中'));
        st.currentExecutionSettings=execution;st.executionInitializingV136=false;view.renderExecution();
    });
    await test('chat model popover and general selector share the same saved selection',async()=>{
        await ui.showScreen('chat',true);
        openModelPicker();assert(view.popover);
        const button=[...view.popover.querySelectorAll('.model-picker-choice')].find(b=>b.textContent==='gemini-3-pro-preview');assert(button);button.click();await view.saveQueue;
        eq(app.getCurrentChatModelRef().modelName,'gemini-3-pro-preview');eq(app.decodeModelRefValue($('model-name').value),app.getCurrentChatModelRef());
        assert(document.activeElement===$('chat-model-button'));
        event('model-name',app.encodeModelRefValue({apiConfigId:'gem',modelName:'gemini-3-flash-preview'}),'change');
        await wait(()=>app.getCurrentChatModelRef().modelName==='gemini-3-flash-preview');assert($('chat-model-button').textContent.includes('gemini-3-flash-preview'));
    });
    await test('Thinking popover exposes only supported dots, resets and closes accessibly',async()=>{
        $('chat-model-button').click();assert(view.popover);eq([...view.popover.querySelectorAll('[role=radio]')].map(b=>b.getAttribute('aria-label')),['Minimal','Low','Medium','High']);
        assert(!/Auto|Off/.test(view.popover.textContent));
        view.popover.querySelector('[aria-label=Low]').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'low');
        view.popover.querySelector('.thinking-reset').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'high');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!view.popover);eq(document.activeElement.id,'chat-model-button');
        $('chat-model-button').click();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));assert(!view.popover);
        await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-2.5-pro'});assert($('chat-thinking-label').hidden);assert($('settings-thinking-button').hidden);
        $('chat-model-button').click();assert(view.popover.querySelector('.model-picker-search'));view.closePopover(false);
        await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});
    });
    await test('model and Thinking labels use one button and model selection lives inside its popover',async()=>{
        assert(document.querySelector('.chat-model-controls').querySelectorAll('button').length===1);
        assert(!$('chat-thinking-button'));
        for(const id of ['chat-model-label','chat-thinking-label']){
            $(id).click();assert(view.popover.classList.contains('thinking-popover'));view.closePopover(false);
        }
        $('chat-model-button').click();view.popover.querySelector('.thinking-model-switch').click();
        assert(view.popover.querySelector('.model-picker-search'));eq($('chat-model-button').getAttribute('aria-expanded'),'true');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));eq(document.activeElement,$('chat-model-button'));
    });
    await test('OpenRouter reversed metadata renders low-to-high without changing capabilities or saved effort',async()=>{
        const ref=app.getCurrentChatModelRef(),effort=app.getCurrentChatThinkingEffort(),original=st.modelMetadataV136.or;
        const reversed=['max','xhigh','high','medium','low','minimal'];
        try {
            st.modelMetadataV136.or={'test/reasoner':{reasoning:{supported_efforts:reversed,default_effort:'high'}}};
            await app.setCurrentChatModelRef({apiConfigId:'or',modelName:'test/reasoner'});
            $('chat-model-button').click();
            eq([...view.popover.querySelectorAll('[role=radio]')].map(b=>b.getAttribute('aria-label')),['Minimal','Low','Medium','High','Xhigh','Max']);
            eq(app.getModelThinkingCapability().levels,reversed);
            view.popover.querySelector('.thinking-dot:first-child').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'minimal');
            view.popover.querySelector('.thinking-dot:last-child').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'max');
            view.popover.querySelector('.thinking-dots').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'xhigh');
            view.popover.querySelector('.thinking-reset').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'high');
        } finally {view.closePopover(false);st.modelMetadataV136.or=original;await app.setCurrentChatModelRef(ref);await app.setCurrentChatThinkingEffort(effort);}
    });
    await test('Thinking stays mounted through rapid delayed saves, reset, keys and chat reload',async()=>{
        const ref=app.getCurrentChatModelRef(),effort=app.getCurrentChatThinkingEffort(),setter=app.setCurrentChatThinkingEffort;
        let release;
        try {
            await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3.8-flash'});
            await db.saveChat();const id=st.currentChatId;
            $('chat-model-button').click();const panel=view.popover,radio=panel.querySelector('[aria-label=Low]');
            let started=false;
            app.setCurrentChatThinkingEffort=async value=>{if(!started){started=true;await new Promise(r=>{release=r;});}return setter.call(app,value);};
            radio.click();eq(panel.querySelector('.thinking-level-name').textContent,'Low');await wait(()=>started);
            panel.querySelector('[aria-label=Medium]').click();panel.querySelector('[aria-label=High]').click();
            eq(panel.querySelector('.thinking-level-name').textContent,'High');assert(view.popover===panel);
            release();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'high');assert(view.popover===panel);
            assert(panel.querySelector('[aria-label=Low]')===radio,'radio nodes are updated in place');
            eq((await db.getChat(id)).executionSettings.thinkingEffort,'high');
            panel.querySelector('.thinking-reset').click();await view.saveQueue;assert(view.popover===panel);eq(app.getCurrentChatThinkingEffort(),'medium');
            for(const [key,value] of [['End','high'],['Home','low'],['ArrowRight','medium'],['ArrowRight','high'],['ArrowLeft','medium']]){
                panel.querySelector('.thinking-dots').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));await view.saveQueue;
                assert(view.popover===panel);eq(app.getCurrentChatThinkingEffort(),value);eq(panel.querySelector('.thinking-level-name').textContent,value[0].toUpperCase()+value.slice(1));
            }
            app.startNewChat();await st.executionSettingsReady;assert(!view.popover);
            await app.loadChat(id);eq(app.getCurrentChatThinkingEffort(),'medium');
            $('chat-model-button').click();assert(view.popover);$('chat-model-button').click();assert(!view.popover);
        } finally {release?.();await view.saveQueue;app.setCurrentChatThinkingEffort=setter;view.closePopover(false);await app.setCurrentChatModelRef(ref);await app.setCurrentChatThinkingEffort(effort);}
    });
    await test('Gemini 3.8 chat picker and general settings expose exactly three Thinking levels and reset to medium',async()=>{
        openModelPicker();
        const choice=[...view.popover.querySelectorAll('.model-picker-choice')].find(b=>b.textContent==='gemini-3.8-flash');assert(choice);choice.click();await view.saveQueue;
        eq(app.decodeModelRefValue($('model-name').value),{apiConfigId:'gem',modelName:'gemini-3.8-flash'});
        for(const [screen,trigger] of [['chat','chat-model-button'],['settings','settings-thinking-button']]) {
            await ui.showScreen(screen,true);if(screen==='settings')view.selectCategory('general',false);
            assert(!$(trigger).hidden);assert($(trigger).getBoundingClientRect().width>0);
            if(screen==='settings') {
                eq($(trigger).tagName,'SELECT');eq([...$(trigger).options].map(option=>option.textContent),['Low','Medium','High']);
                event(trigger,'high','change');await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'high');
                event(trigger,'medium','change');await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'medium');assert(!view.popover);continue;
            }
            $(trigger).click();assert(view.popover);
            const panel=view.popover.getBoundingClientRect(),anchor=$(trigger).getBoundingClientRect();
            assert(panel.left>=8&&panel.right<=innerWidth-8+1&&panel.top>=8&&panel.bottom<=innerHeight-8+1,'Thinking surface fits viewport');
            if(screen==='settings')assert(Math.abs(panel.left-Math.max(8,Math.min(anchor.left,innerWidth-panel.width-8)))<=1,'general Thinking aligns with its trigger');
            eq([...view.popover.querySelectorAll('[role=radio]')].map(b=>b.getAttribute('aria-label')),['Low','Medium','High']);
            view.popover.querySelector('[aria-label=High]').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'high');
            view.popover.querySelector('.thinking-reset').click();await view.saveQueue;eq(app.getCurrentChatThinkingEffort(),'medium');view.closePopover(false);
        }
        event('model-name',app.encodeModelRefValue({apiConfigId:'gem',modelName:'gemini-3-flash-preview'}),'change');
        await wait(()=>app.getCurrentChatModelRef().modelName==='gemini-3-flash-preview');
        event('model-name',app.encodeModelRefValue({apiConfigId:'gem',modelName:'gemini-3.8-flash'}),'change');
        await wait(()=>app.getCurrentChatModelRef().modelName==='gemini-3.8-flash');assert(!$('chat-thinking-label').hidden);assert(!$('settings-thinking-button').hidden);
        await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});await ui.showScreen('chat',true);
    });
    await test('generation disables both model/Thinking surfaces without changing execution',async()=>{
        const ref=app.getCurrentChatModelRef();ui.setSendingState(true);assert($('chat-model-button').disabled);assert($('model-name').disabled);assert($('settings-thinking-button').disabled);
        $('chat-model-button').click();assert(!view.popover);eq(app.getCurrentChatModelRef(),ref);ui.setSendingState(false);
        const config=st.apiConfigs.find(c=>c.id===ref.apiConfigId);config.enabled=false;view.renderExecution();
        assert($('chat-model-button').textContent.includes('無効'));eq($('chat-model-button').getAttribute('aria-invalid'),'true');config.enabled=true;view.renderExecution();
    });
    await test('shared theme editor saves global values while a custom profile remains independent',async()=>{
        await app.setProfileOverride('theme',true);await app.saveAppearanceValues('theme',{accentColor:'#cc0000'});
        event('accent-color-input','#0055aa');await view.saveQueue;eq(st.globalSettingsV136.theme.accentColor,'#0055aa');eq(st.activeProfile.settings.theme.accentColor,'#cc0000');
        event('profile-accent-color-input','#22aa44');await view.saveQueue;eq(st.activeProfile.settings.theme.accentColor,'#22aa44');eq(st.globalSettingsV136.theme.accentColor,'#0055aa');
        event('profile-theme-override',false,'change');await view.saveQueue;assert($('profile-theme-editor').hidden);
        event('profile-theme-override',true,'change');await view.saveQueue;eq($('profile-accent-color-input').value,'#22aa44');
    });
    await test('background picker and deletion obey explicit global/profile scope and preserve referenced assets',async()=>{
        const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        await app.setProfileOverride('appearance',true);await app.saveBackgroundBlobV136(blob);const own=st.activeProfile.settings.appearance.backgroundAssetId;
        const transfer=new DataTransfer();transfer.items.add(new File([blob],'test.png',{type:'image/png'}));$('background-image-input').files=transfer.files;$('background-image-input').dispatchEvent(new Event('change',{bubbles:true}));await view.saveQueue;
        const global=st.globalSettingsV136.appearance.backgroundAssetId;assert(global!==own);eq(st.activeProfile.settings.appearance.backgroundAssetId,own);
        $('delete-background-btn').click();await view.saveQueue;eq(st.globalSettingsV136.appearance.backgroundAssetId,null);eq(st.activeProfile.settings.appearance.backgroundAssetId,own);
        const found=await new Promise(resolve=>{const r=st.db.transaction('image_store').objectStore('image_store').get(own);r.onsuccess=()=>resolve(r.result)});assert(found?.blob);
        event('profile-overlay-opacity-slider','25');await view.saveQueue;event('overlay-opacity-slider','80');await view.saveQueue;
        eq(st.activeProfile.settings.appearance.overlayOpacity,0.25);eq(st.globalSettingsV136.appearance.overlayOpacity,0.8);
        event('profile-appearance-override',false,'change');await view.saveQueue;eq(st.settings.overlayOpacity,0.8);
        event('profile-appearance-override',true,'change');await view.saveQueue;eq(st.settings.overlayOpacity,0.25);
    });
    await test('integration/global and profile tool controls retain their storage scopes',async()=>{
        event('sd-api-url','http://127.0.0.1:7860');await wait(async()=> (await db.getSetting('globalSettingsV136')).value.sdApiUrl==='http://127.0.0.1:7860');
        event('gemini-enable-function-calling-toggle',true,'change');await wait(async()=> (await db.getProfile(st.activeProfileId)).settings.geminiEnableFunctionCalling===true);
        event('chat-font-size-select','18','change');await wait(async()=> (await db.getSetting('localUiSettings')).value.chatFontSize===18);
        assert(!st.activeProfile.settings.sdApiUrl);assert(!st.globalSettingsV136.geminiEnableFunctionCalling);
    });
    await test('failed automatic save stays inline without a confirmation dialog',async()=>{
        // Shared settings now persist in an atomic readwrite transaction, so inject
        // the same storage failure at that boundary instead of the retired helper.
        const transaction=st.db.transaction;
        st.db.transaction=function(stores,mode){if(mode==='readwrite'&&stores.includes('settings'))throw new Error('mock save failure');return transaction.call(this,stores,mode);};
        try {
            event('sd-api-url','http://failed.invalid');await wait(()=> $('sd-api-url').getAttribute('aria-invalid')==='true');
            assert($('sd-api-url').parentElement.textContent.includes('mock save failure'));
        }finally{st.db.transaction=transaction;}
        event('sd-api-url','http://127.0.0.1:7860');await wait(()=> $('sd-api-url').getAttribute('aria-invalid')!=='true');
    });
    await test('API save closes the dialog without a success alert',async()=>{
        const collect=app.collectApiConfigFormValues, alert=ui.showCustomAlert;let alerts=0;ui.showCustomAlert=async()=>{alerts++};
        app.collectApiConfigFormValues=()=>({...st.apiConfigs.find(c=>c.id==='gem'),name:'Gemini test'});
        await app.saveApiConfigFromDialog();eq(alerts,0);ui.showCustomAlert=alert;app.collectApiConfigFormValues=collect;
    });
    await test('SD connection tests report success and failure in their section',async()=>{
        const fetchOriginal=window.fetch;window.fetch=async()=>({ok:true});$('sd-test-connection-btn').click();await wait(()=>!$('sd-test-connection-btn').disabled);assert($('sd-connection-status').textContent.includes('接続できました'));
        window.fetch=async()=>{throw new Error('mock connection failure')};$('sd-test-connection-btn').click();await wait(()=>!$('sd-test-connection-btn').disabled);assert($('sd-connection-status').dataset.error==='true');window.fetch=fetchOriginal;
    });
    await test('profile default prompt, chat prompt editing and local draft remain independent',async()=>{
        await ui.showScreen('chat',true);app.startNewChat();await st.executionSettingsReady;
        st.currentSystemPrompt='chat prompt';event('system-prompt-default','profile default');await wait(async()=> (await db.getProfile(st.activeProfileId)).settings.systemPrompt==='profile default');eq(st.currentSystemPrompt,'chat prompt');
        await app.openSystemPromptDialog();$('system-prompt-editor').value='edited chat prompt';await app.saveCurrentSystemPrompt({keepOpen:false});eq(st.currentSystemPrompt,'edited chat prompt');eq(st.activeProfile.settings.systemPrompt,'profile default');
        $('user-input').value='local input draft';app.flushInputDraft();$('user-input').value='';await app.restoreInputDraftForCurrentContext(true);eq($('user-input').value,'local input draft');
    });
    await test('late model capability results cannot change a newer chat selection',async()=>{
        app.startNewChat();await st.executionSettingsReady;const fetchOriginal=window.fetch;delete st.modelMetadataV136.or;
        let release,started=false;window.fetch=async()=>{started=true;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({data:[{id:'test/reasoner',reasoning:{supported_efforts:['low','high'],default_effort:'high'}}]})})})};
        const changing=app.setCurrentChatModelRef({apiConfigId:'or',modelName:'test/reasoner'}).then(()=>false,()=>true);await wait(()=>started);
        app.startNewChat();await st.executionSettingsReady;const expected=app.getCurrentChatModelRef();release();assert(await changing);eq(app.getCurrentChatModelRef(),expected);window.fetch=fetchOriginal;
    });
    await test('concurrent global saves merge distinct fields instead of overwriting them',async()=>{
        await Promise.all([app.saveGlobalSettingsV136({sdApiUrl:'http://parallel.invalid'}),app.saveGlobalSettingsV136({googleSearchEngineId:'parallel-cx'})]);
        const value=(await db.getSetting('globalSettingsV136')).value;eq(value.sdApiUrl,'http://parallel.invalid');eq(value.googleSearchEngineId,'parallel-cx');
    });
    await test('a newer model selection wins over an older metadata request in the same chat',async()=>{
        const fetchOriginal=window.fetch;delete st.modelMetadataV136.or;let release,started=false;
        window.fetch=async()=>{started=true;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({data:[]})})})};
        const old=app.setCurrentChatModelRef({apiConfigId:'or',modelName:'test/reasoner'}).then(()=>false,()=>true);await wait(()=>started);
        await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});release();assert(await old);eq(app.getCurrentChatModelRef().modelName,'gemini-3-flash-preview');window.fetch=fetchOriginal;
    });
    await test('history pinning, title search and detail controls still operate',async()=>{
        const original=await db.getChat(100);await db.updateChatPinState(100,true);assert((await db.getChat(100)).isPinned);
        await ui.showScreen('history',true);await ui.renderHistoryList();
        $('history-search-input').value='legacy';$('history-search-input').dispatchEvent(new Event('input',{bubbles:true}));
        await wait(()=>document.querySelector('#history-list [data-chat-id="100"]') || document.querySelector('[data-history-chat-id="100"]'));
        await db.updateChatPinState(100,false);eq((await db.getChat(100)).messages,original.messages);$('history-search-input').value='';
    });
    window.runSettingsKeyboardV136=async()=>{
        await ui.showScreen('chat',true);await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});$('user-input').focus();
        view.openThinking($('chat-model-button'));const bounds=view.popover.getBoundingClientRect();assert(bounds.bottom<=innerHeight+1&&bounds.top>=0,'reduced viewport popover');
        assert(bounds.bottom<=document.querySelector('.chat-model-controls').getBoundingClientRect().top-8,'reduced viewport panel clears control row');view.closePopover(false);
        await ui.showScreen('settings',true);view.selectCategory('integrations',false);$('sd-api-url').focus();assert($('settings-detail').clientHeight>100);assert(document.querySelector('#settings-screen .app-header').getBoundingClientRect().bottom<innerHeight);
        return 4;
    };
    let resizeNode;
    window.prepareSettingsResizeV136=async()=>{
        await ui.showScreen('settings',true);view.selectCategory('profile',false);resizeNode=$('dummy-user');resizeNode.value='resize draft';resizeNode.focus();$('settings-detail').scrollTop=100;
    };
    window.verifySettingsResizeV136=()=>{
        assert(view.category==='profile');assert(document.activeElement===resizeNode);eq(resizeNode.value,'resize draft');assert($('settings-detail').scrollTop>0);return 4;
    };
    window.runSettingsViewportV136=async width=>{
        const results=[];const check=(ok,message)=>{assert(ok,`${width}px: ${message}`);results.push(message)};
        check(Math.abs(innerWidth-width)<=1,'actual CSS viewport width');
        await ui.showScreen('settings',true);view.enter();
        check(view.media.matches ? !document.querySelector('[data-settings-panel=general]').hidden : $('settings-screen').classList.contains('settings-show-top'),'initial navigation');
        for(const category of Object.keys(titlesForTests)){
            view.selectCategory(category);const panel=document.querySelector(`[data-settings-panel=${category}]`);check(!panel.hidden,category+' accessible');
            const container=$('settings-detail');check(container.scrollWidth<=container.clientWidth+1,category+' no horizontal overflow');
            const nav=document.querySelector('.settings-category-nav'),before=nav.getBoundingClientRect().top;container.scrollTop=200;
            if(view.media.matches)check(nav.getBoundingClientRect().top===before,'sidebar fixed');container.scrollTop=0;
        }
        if(!view.media.matches){view.selectCategory('profile');view.back();await wait(()=>view.category===null);check($('settings-screen').classList.contains('settings-show-top'),'detail back to top');}
        await ui.showScreen('chat',true);await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});
        $('chat-model-button').click();const bounds=view.popover.getBoundingClientRect();check(bounds.left>=0&&bounds.right<=innerWidth+1&&bounds.top>=0&&bounds.bottom<=innerHeight+1,'popover fits viewport');view.closePopover(false);
        const input=$('user-input').getBoundingClientRect(),send=$('send-button').getBoundingClientRect();check(input.bottom<=send.top+2,'composer buttons do not overlap input');
        const composer=document.querySelector('.chat-input-area'),controls=document.querySelector('.chat-model-controls');
        const toolbar=controls.getBoundingClientRect(),attach=$('attach-file-btn').getBoundingClientRect();
        check(toolbar.right+4<=attach.left&&attach.right+4<=send.left,'grouped controls leave space for attachment and send');
        check(composer.scrollWidth<=composer.clientWidth+1&&toolbar.width<=420,'composer and compact control group do not overflow');
        check(parseFloat(getComputedStyle($('chat-model-button')).fontSize)>=12,'model label remains readable on mobile');
        const center=node=>{const r=node.getBoundingClientRect();return r.top+r.height/2;};
        const row=document.querySelector('.composer-actions');
        check(getComputedStyle(row).display==='flex'&&getComputedStyle(row).alignItems==='center','shared composer Flex row centers its controls');
        const target=center($('send-button'));
        check(['profile-card-header','chat-model-button','attach-file-btn'].every(id=>Math.abs(center($(id))-target)<=1),'all four control frames share one vertical center');
        check(['#profile-card-icon-container','#chat-model-label','#chat-thinking-label','#attach-file-btn .material-symbols-outlined','#send-button .material-symbols-outlined'].every(selector=>Math.abs(center(document.querySelector(selector))-target)<=1),'profile image, labels and icon boxes share the visual center');
        const metrics=document.createElement('canvas').getContext('2d');
        for(const [id,samples] of [['chat-model-label',['gemini-3.8-flash','deepseek/deepseek-v4.1-flash-1017','OpenRouter/gpt-5.6-luna','gypq']],['chat-thinking-label',['High','Medium']]]){
            const node=$(id),original=node.textContent,style=getComputedStyle(node);
            metrics.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            try{for(const sample of samples){node.textContent=sample;const ink=metrics.measureText(sample);
                check(parseFloat(style.lineHeight)>=ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent+2&&node.getBoundingClientRect().height>=parseFloat(style.lineHeight)+1.9,'descender ink has vertical clearance: '+sample+' '+JSON.stringify({line:style.lineHeight,box:node.getBoundingClientRect().height,ink:ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent}));
            }}finally{node.textContent=original;}
        }
        check(getComputedStyle(controls).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(controls).borderTopWidth==='0px','resting control group has no permanent background or border');
        check(controls.querySelectorAll('button').length===1&&$('chat-thinking-label').closest('button')===$('chat-model-button'),'model and Thinking share one click target');
        const metadata=st.modelMetadataV136.or,gem=st.apiConfigs.find(c=>c.id==='gem');
        const longName='gemini-layout-review-with-a-very-long-unregistered-model-name';
        try {
            st.modelMetadataV136.or={'test/reasoner':{reasoning:{supported_efforts:['minimal','low','medium','high','xhigh','max'],default_effort:'high'}}};
            for(const ref of [{apiConfigId:'gem',modelName:'gemini-3-pro-preview'},{apiConfigId:'gem',modelName:'gemini-3.8-flash'},{apiConfigId:'gem',modelName:'gemini-3-flash-preview'},{apiConfigId:'or',modelName:'test/reasoner'}]) {
                await app.setCurrentChatModelRef(ref);$('chat-model-button').click();
                const panel=view.popover.getBoundingClientRect(),group=controls.getBoundingClientRect();
                check(Math.abs(panel.bottom-(group.top-10))<=1,'Thinking popover stays connected above the control row');
                check(panel.bottom<=attach.top-4&&panel.bottom<=send.top-4,'Thinking popover clears attachment and send controls');
                check(Math.abs(panel.left-Math.max(8,Math.min(group.right-panel.width,innerWidth-panel.width-8)))<=1,'Thinking popover follows its trigger group');
                const name=view.popover.querySelector('.thinking-heading').getBoundingClientRect(),dots=view.popover.querySelector('.thinking-dots').getBoundingClientRect(),reset=view.popover.querySelector('.thinking-reset').getBoundingClientRect();
                check(dots.top>=name.bottom&&reset.left>=name.right,'label, selector and reset have separate space');
                check([...view.popover.querySelectorAll('[role=radio]')].every(b=>b.getBoundingClientRect().width>=40&&b.getBoundingClientRect().height>=44),'2/3/4/6 level controls have usable hit areas');
                const positions=[...view.popover.querySelectorAll('.thinking-mark')].map(b=>{const r=b.getBoundingClientRect();return (r.left+r.right)/2;});
                check(positions[0]-dots.left<=13&&dots.right-positions.at(-1)<=13,'visible endpoint dots reach the track ends while keeping large hit areas');
                const spacing=positions[1]-positions[0];check(positions.slice(1).every((x,i)=>Math.abs(x-positions[i]-spacing)<=1),'intermediate level positions are equally spaced');
                check(Math.abs((name.left+name.right-panel.left-panel.right)/2)<=1,'level and model heading is centered in the panel');
                check(!view.popover.querySelector('.thinking-popover-icon')&&reset.right>=panel.right-16,'no lightning icon or reserved column; reset sits at upper right');
                view.closePopover(false);
            }
            gem.modelCandidates.push(longName);await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:longName});
            check($('chat-thinking-label').hidden&&composer.scrollWidth<=composer.clientWidth+1,'long unknown model truncates without shifting other controls');
            check($('chat-model-button').title.includes(longName)&&$('chat-model-button').getAttribute('aria-label').includes(longName),'truncated model retains its complete accessible name');
        } finally {
            view.closePopover(false);st.modelMetadataV136.or=metadata;gem.modelCandidates=gem.modelCandidates.filter(id=>id!==longName);
            await app.setCurrentChatModelRef({apiConfigId:'gem',modelName:'gemini-3-flash-preview'});
        }
        return results.length;
    };
    const titlesForTests={general:1,profile:1,integrations:1,other:1};
    window.prepareSettingsScreenshotV136=async(category,dark=false,deferOpen=false)=>{
        let trigger=null;
        view.closePopover(false);await app.saveAppearanceValues('theme',{darkMode:dark},{global:true});await app.setProfileOverride('theme',false);
        if(['composer','model','thinking','thinking-settings','hover-model','hover-thinking','thinking-2','thinking-4','thinking-6','thinking-low','thinking-high','font-deepseek','font-openrouter','font-descenders'].includes(category)){
            let ref={apiConfigId:'gem',modelName:'gemini-3.8-flash'},effort='medium';
            if(category==='thinking-2'){ref.modelName='gemini-3-pro-preview';effort='high';}
            if(category==='thinking-4')ref.modelName='gemini-3-flash-preview';
            if(category==='thinking-6'){
                st.modelMetadataV136.or={'test/reasoner':{reasoning:{supported_efforts:['max','xhigh','high','medium','low','minimal'],default_effort:'high'}}};
                ref={apiConfigId:'or',modelName:'test/reasoner'};effort='high';
            }
            if(category==='thinking-low')effort='low';if(category==='thinking-high')effort='high';
            if(category.startsWith('font-')){
                const name={'font-deepseek':'deepseek/deepseek-v4.1-flash-1017','font-openrouter':'OpenRouter/gpt-5.6-luna','font-descenders':'gypq'}[category];
                const config=st.apiConfigs.find(c=>c.id==='or');if(!config.modelCandidates.includes(name))config.modelCandidates.push(name);
                st.modelMetadataV136.or ||= {};st.modelMetadataV136.or[name]={reasoning:{supported_efforts:['low','medium','high'],default_effort:'medium'}};
                ref={apiConfigId:'or',modelName:name};effort=category==='font-deepseek'?'medium':'high';
            }
            await app.setCurrentChatModelRef(ref);await app.setCurrentChatThinkingEffort(effort);
            await ui.showScreen('chat',true);$('user-input').value='メッセージを入力…';
            document.activeElement?.blur();
            if(category==='thinking-settings'){
                await ui.showScreen('settings',true);view.selectCategory('general',false);$('settings-thinking-button').scrollIntoView({block:'center'});trigger=$('settings-thinking-button');
            }else if(!['composer','hover-model','hover-thinking'].includes(category)&&!category.startsWith('font-'))trigger=$('chat-model-button');
            if(trigger&&!deferOpen){trigger.click();if(category==='model'&&view.popover?.classList.contains('thinking-popover'))view.popover.querySelector('.thinking-model-switch').click();}
        }else{await ui.showScreen('settings',true);view.selectCategory(category,false);$('settings-detail').scrollTop=0;}
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        await new Promise(r=>setTimeout(r,250)); // Let the existing theme and screen transitions finish.
        return trigger?.id || null;
    };
};

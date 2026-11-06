window.runNRegressionsV136=async({run,app,db,st,ui,realUi,el,assert,eq,putChat})=>{
    for(const editedIndex of [1,3,2])await run(`N01 Bedrock signed suffix after edit ${editedIndex}, Undo, Redo and reload`,async()=>{
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'},thinkingEffort:'high'};
        st.currentChatId=900+editedIndex;await putChat(st.currentChatId);
        const common={provider:'bedrock',apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'};
        const model=(text,sig)=>({role:'model',content:text,continuation:{...common,displayContent:text,parts:[{text}],bedrock:[{reasoningContent:{reasoningText:{text:'reason',signature:sig}}}]}});
        st.currentMessages=[{role:'user',content:'one'},model('first','sig-a'),{role:'user',content:'two'},model('middle','sig-b'),{role:'user',content:'three'},model('last','sig-c')];
        const middle=st.currentMessages[3];middle.continuation.turns=[{role:'model',parts:[{functionCall:{name:'tool',args:{},_toolCallId:'tool-a'}},{functionCall:{name:'tool',args:{},_toolCallId:'tool-b'}}],tmBedrockContinuation:middle.continuation.bedrock},
            {role:'tool',parts:[{functionResponse:{name:'tool',response:{ok:true},_toolCallId:'tool-a'}},{functionResponse:{name:'tool',response:{ok:true},_toolCallId:'tool-b'}}]},
            {role:'model',parts:[{text:'middle'}]}];
        const oldClient=window.BedrockRuntimeClient,oldCommand=window.ConverseCommand;let body;
        window.ConverseCommand=class{constructor(body){this.body=body}};
        window.BedrockRuntimeClient=class{async send(command){body=command.body;return {output:{message:{content:[{text:'done'}]}},stopReason:'end_turn'}}};
        app.updateChangeHistoryControls=async()=>{};app.recalculateSearchAndReplaceAfterHistoryApply=()=>{};app.setChangeHistoryStatus=()=>{};app.finishEditing=()=>{st.editingMessageIndex=null};
        const verify=async changed=>{app.freezeExecutionSettings();await window.testApi.callBedrockApi(await app._prepareApiHistory(st.currentMessages),{},'');st.currentExecutionApiConfig=null;
            const text=JSON.stringify(body),affected=editedIndex===1?['sig-a','sig-b','sig-c']:['sig-b','sig-c'];
            for(const sig of ['sig-a','sig-b','sig-c'])eq(text.includes(sig),!(changed&&affected.includes(sig)));
            if(changed)assert(text.includes('edited'));};
        const node=document.createElement('div');node.innerHTML='<div class="message-content"></div><textarea class="edit-textarea">edited</textarea>';el.messageContainer.append(node);
        try {
            await verify(false);await app.saveEditMessage(editedIndex,node);
            const saved=await db.getChat(st.currentChatId);st.currentMessages=saved.messages;await verify(true);
            eq(saved.messages[5].continuation.bedrock[0].reasoningContent.reasoningText.signature,'sig-c');
            await app.undoLatestChangeForMessage(editedIndex,st.currentMessages[editedIndex].role);await verify(false);
            await app.redoLatestChangeForMessage(editedIndex,st.currentMessages[editedIndex].role);await verify(true);
        }finally{node.remove();window.BedrockRuntimeClient=oldClient;window.ConverseCommand=oldCommand;}
    });
    await run('N01 user replacement invalidates only the affected Bedrock suffix',async()=>{
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'},thinkingEffort:'high'};st.currentChatId=915;await putChat(915);
        const common={provider:'bedrock',apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'};
        const model=(text,signature)=>({role:'model',content:text,continuation:{...common,displayContent:text,parts:[{text}],bedrock:[{reasoningContent:{reasoningText:{text:'reason',signature}}}]}});
        st.currentMessages=[{role:'user',content:'one'},model('first','prefix-signature'),{role:'user',content:'two'},model('last','suffix-signature')];
        const plan={query:'two',replacement:'replacement',target:'user',scope:'all',occurrenceCount:1,messageCount:1,changes:[{index:2,role:'user',before:'two',after:'replacement',count:1}]};
        ui.buildChatReplacePreviewPlan=()=>plan;ui.validateReplacePlanAgainstCurrentMessages=p=>realUi.validateReplacePlanAgainstCurrentMessages.call(realUi,p);
        await realUi.executeChatReplacePreviewPlan.call(ui);st.currentMessages=(await db.getChat(915)).messages;
        const oldClient=window.BedrockRuntimeClient,oldCommand=window.ConverseCommand;let body;
        window.ConverseCommand=class{constructor(body){this.body=body}};window.BedrockRuntimeClient=class{async send(command){body=command.body;return {output:{message:{content:[{text:'done'}]}},stopReason:'end_turn'}}};
        try{app.freezeExecutionSettings();await window.testApi.callBedrockApi(await app._prepareApiHistory(st.currentMessages),{},'');const sent=JSON.stringify(body);assert(sent.includes('prefix-signature'));assert(!sent.includes('suffix-signature'));assert(sent.includes('replacement'));}
        finally{window.BedrockRuntimeClient=oldClient;window.ConverseCommand=oldCommand;}
    });
    await run('N01 Gemini later unedited turn retains its own Thought Signature',async()=>{
        app.freezeExecutionSettings();
        const common={provider:'gemini',apiConfigId:'gem',modelName:'gemini-3-pro-preview'};
        const history=await app._prepareApiHistory([{role:'user',content:'one'},{role:'model',content:'edited',continuation:{...common,displayContent:'old',parts:[{text:'old',thoughtSignature:'old-sig'}]}},
            {role:'user',content:'next turn'},{role:'model',content:'later',continuation:{...common,displayContent:'later',parts:[{text:'later',thoughtSignature:'later-sig'}]}}]);
        assert(!JSON.stringify(history).includes('old-sig'));assert(JSON.stringify(history).includes('later-sig'));
    });
    for(const first of ['empty','missing','network'])await run('N04 '+first+' metadata recovers through actual retries without losing Low',async()=>{
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'or',modelName:'test/reasoner'},thinkingEffort:'low'};
        st.modelMetadataV136={};st.modelMetadataStatusV136={};let requests=0,body;
        window.fetch=async(url,opts)=>{
            if(String(url).endsWith('/models')){requests++;if(requests===1){if(first==='network')throw Error('offline');return {ok:true,json:async()=>({data:first==='empty'?[]:[{id:'other',reasoning:null}]})};}
                return {ok:true,json:async()=>({data:[{id:'test/reasoner',reasoning:{supported_efforts:['low','high'],default_effort:'high'}}]})};}
            body=JSON.parse(opts.body);return {ok:true,status:200,json:async()=>({choices:[{message:{content:'done'},finish_reason:'stop'}]})};
        };
        await app.refreshExecutionApiConfigsV136();eq(app.getCurrentChatThinkingEffort(),'low');
        await Promise.all([app.refreshExecutionApiConfigsV136(),app.refreshExecutionApiConfigsV136()]);
        app.freezeExecutionSettings();await window.testApi.callOpenRouterApi([{role:'user',parts:[{text:'test'}]}],{},'');st.currentExecutionApiConfig=null;
        eq(requests,2);eq(body.reasoning.effort,'low');eq(app.getCurrentChatThinkingEffort(),'low');
        await app.refreshExecutionApiConfigsV136();eq(requests,2);
    });
    await run('N04 simultaneous capability refresh is shared across a chat switch',async()=>{
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'or',modelName:'test/reasoner'},thinkingEffort:'low'};
        st.modelMetadataV136={};let release,entered,calls=0;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
        window.fetch=async()=>{calls++;entered();await gate;return {ok:true,json:async()=>({data:[{id:'test/reasoner',reasoning:{supported_efforts:['low','high'],default_effort:'high'}}]})}};
        const first=app.refreshModelThinkingCapabilities('or');await waiting;const second=app.refreshModelThinkingCapabilities('or');
        st.currentChatId=980;await putChat(980);await app.loadChat(980);release();await Promise.all([first,second]);
        eq(calls,1);eq(app.getCurrentChatThinkingEffort(),'low');
    });
    await run('N04 same API config ID with a changed endpoint rechecks model capabilities',async()=>{
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'or',modelName:'test/reasoner'},thinkingEffort:'low'};
        st.modelMetadataV136={};st.modelMetadataSourcesV136={};const urls=[];
        window.fetch=async url=>{urls.push(String(url));return {ok:true,json:async()=>({data:[{id:'test/reasoner',reasoning:{supported_efforts:['low','high'],default_effort:'high'}}]})}};
        await app.refreshExecutionApiConfigsV136();eq(urls.length,1);
        const config=st.apiConfigs.find(c=>c.id==='or');config.baseUrl='https://new-endpoint.invalid/v1';await db.saveSetting('apiConfigs',st.apiConfigs);
        await app.refreshExecutionApiConfigsV136();eq(urls.length,2);assert(urls[1].startsWith(config.baseUrl));eq(app.freezeExecutionSettings().thinkingEffort,'low');
    });
    for(const model of ['glm-4.6','glm-4.6v','unverified-glm-4.6v-copy'])await run('N06 saved SD quality ModelRef '+model,async()=>{
        st.apiConfigs.find(c=>c.id==='zai').modelCandidates.push('glm-4.6v','unverified-glm-4.6v-copy');await db.saveSetting('apiConfigs',st.apiConfigs);
        await app.saveGlobalSettingsV136({sdQcModelRef:{apiConfigId:'zai',modelName:model}});await app.loadSettingsV136();app.applyGlobalSettingsV136();
        app.fileToBase64=async()=> 'AA==';let body,calls=0,error;
        window.fetch=async(url,opts)=>{calls++;body=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:'Result: OK'}}]})}};
        try{await app.runQualityChecker(new Blob(['image'],{type:'image/png'}),'check')}catch(e){error=e;}
        if(model==='glm-4.6v'){eq(calls,1);eq(body.messages[0].content[1].image_url.url,'data:image/png;base64,AA==');}
        else{eq(calls,0);assert(error&&error.message.includes('画像'));}
    });
    await run('N06 Bedrock vision quality adapter emits actual image bytes',async()=>{
        st.globalSettingsV136.sdQcModelRef={apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'};app.fileToBase64=async()=> 'AA==';
        const oldClient=window.BedrockRuntimeClient,oldCommand=window.ConverseCommand;let body;
        window.ConverseCommand=class{constructor(body){this.body=body}};window.BedrockRuntimeClient=class{async send(command){body=command.body;return {output:{message:{content:[{text:'Result: OK'}]}}}}};
        try{eq((await app.runQualityChecker(new Blob(['image']),'check')).result,'OK');eq(body.messages[0].content[1].image.format,'png');eq([...body.messages[0].content[1].image.source.bytes],[0]);}
        finally{window.BedrockRuntimeClient=oldClient;window.ConverseCommand=oldCommand;}
    });
    await run('N06 Dropbox-format restored text-only ModelRef is rejected before image POST',async()=>{
        await app.saveGlobalSettingsV136({sdQcModelRef:{apiConfigId:'zai',modelName:'glm-4.6'}});
        const exported=await app._prepareExportData(),oldDropbox=window.dropboxApi;
        window.dropboxApi={downloadAsset:async id=>exported.localAssets.get(id)?.blob};
        try{await app.importDataFromString(exported.metadataJson);await app.loadGlobalSettings();await app.loadProfiles();}
        finally{window.dropboxApi=oldDropbox;}
        app.fileToBase64=async()=> 'AA==';let calls=0,rejected=false;window.fetch=async()=>{calls++;throw Error('unexpected API')};
        try{await app.runQualityChecker(new Blob(['image']),'check')}catch(error){rejected=error.message.includes('画像')};eq(calls,0);assert(rejected);
    });
};
window.runNSettingsUiV136=async({app,db,st,ui,test,assert,eq})=>{
    const initial=structuredClone(st.globalSettingsV136),peer=window.open('/tests/settings-peer-v136.html','n-settings-peer');assert(peer);
    const wait=async fn=>{const end=Date.now()+3000;while(!await fn()){if(Date.now()>end)throw Error('N05 sync timeout');await new Promise(r=>setTimeout(r,10));}};
    const $=id=>document.getElementById(id);
    try {
        await new Promise(resolve=>peer.addEventListener('load',resolve,{once:true}));await peer.initializeSettingsPeerV136(st.db.name,initial);
        await test('N05 actual independent tab updates global checkbox, auxiliary model, network and integration DOM',async()=>{
            const ref={apiConfigId:'gem',modelName:'gemini-2.5-pro'};
            await peer.peerSettings.saveGlobalSettingsV136({enableProofreading:true,proofreadingModelRef:ref,maxRetries:19,sdApiUrl:'http://second-tab.invalid',enableThoughtTranslation:true,showThoughtProcess:true});
            await wait(()=>st.globalSettingsV136.maxRetries===19);
            eq($('enable-proofreading').checked,true);eq($('proofreading-model-name').value,app.encodeModelRefValue(ref));
            eq($('max-retries').value,'19');eq($('sd-api-url').value,'http://second-tab.invalid');eq($('enable-thought-translation').checked,true);eq($('include-thoughts-toggle').checked,true);
        });
        await test('N05 focused text is retained until blur then matches committed DB state',async()=>{
            await ui.showScreen('settings',true);window.settingsUiV136.selectCategory('integrations',false);
            window.testFocusTab('');await wait(()=>document.hasFocus());
            const control=$('sd-api-url');
            control.focus();control.value='http://local-draft.invalid';control.dispatchEvent(new Event('input',{bubbles:true}));
            assert(window.settingsUiV136.editedGlobalInputs?.has(control),'N05 input not tracked: '+JSON.stringify({keys:Object.keys(app.globalSettingControlsV136||{}),active:document.activeElement?.id,screen:st.currentScreen}));
            await wait(async()=> (await db.getSetting('globalSettingsV136')).value.sdApiUrl==='http://local-draft.invalid');
            await peer.peerSettings.saveGlobalSettingsV136({sdApiUrl:'http://remote-last.invalid'});await wait(()=>st.globalSettingsV136.sdApiUrl==='http://remote-last.invalid');
            assert(document.activeElement===control);eq(control.value,'http://local-draft.invalid');control.blur();
            await wait(()=>control.value==='http://remote-last.invalid');eq(st.settings.sdApiUrl,control.value);eq((await db.getSetting('globalSettingsV136')).value.sdApiUrl,control.value);
            window.settingsUiV136.enter();eq(control.value,'http://remote-last.invalid');
        });
    }finally{peer.close();await app.saveGlobalSettingsV136(initial);ui.applySettingsToUI();}
};

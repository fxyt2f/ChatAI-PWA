/* Integration regressions: real application methods, IndexedDB and provider bodies. */
window.runReviewRegressionsV136 = async ({app,db,st,ui,el,assert,eq}) => {
    const results=[];
    const original={app:{...app},db:{...db},ui:{...ui},fetch:window.fetch};
    const base={...st,settings:structuredClone(st.settings),globalSettingsV136:structuredClone(st.globalSettingsV136),apiConfigs:structuredClone(st.apiConfigs)};
    const run=async(name,fn)=>{
        Object.assign(app,original.app);Object.assign(db,original.db);Object.assign(ui,original.ui);
        Object.assign(st,base,{settings:structuredClone(base.settings),globalSettingsV136:structuredClone(base.globalSettingsV136),apiConfigs:structuredClone(base.apiConfigs),
            currentMessages:[],currentChatId:null,currentExecutionApiConfig:null,isSending:false,abortController:null,
            modelMetadataStatusV136:{},
            modelMetadataSourcesV136:{},
            sendPreparationV136:null,pendingAttachments:[],editingMessageIndex:null,isEditingSystemPrompt:false,
            currentSystemPrompt:'',pendingCascadeResponses:null,executionSettingsReady:Promise.resolve()});
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'gem',modelName:'gemini-3-pro-preview'},thinkingEffort:'low'};
        Object.keys(ui).forEach(k=>{if(typeof ui[k]==='function')ui[k]=()=>{};});
        ui.setSendingState=v=>{st.isSending=v};ui.showCustomConfirm=async()=>true;
        ui.showCustomAlert=async message=>{throw new Error('unexpected alert: '+message)};
        app.markAsDirtyAndSchedulePush=()=>{};app.scrollToBottom=()=>{};app.updateCharacterProfileButtonVisibility=()=>{};
        app.scheduleInputDraftRestore=()=>{};app.clearInputDraftAfterSend=()=>{};
        window.fetch=original.fetch;
        await db.saveSetting('apiConfigs',st.apiConfigs);
        try {await fn();results.push('PASS '+name);}catch(e){results.push('FAIL '+name+': '+e.stack);}
    };
    const response=(text='answer')=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]})});
    const putChat=async(id,messages=[])=>new Promise((resolve,reject)=>{const tx=st.db.transaction('chats','readwrite');
        tx.objectStore('chats').put({id,title:'regression',messages,executionSettings:structuredClone(st.currentExecutionSettings),createdAt:1,updatedAt:1});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    for(const regenerate of [false,true]) for(const action of ['load','new','abort','profile']) {
        await run(`R01 ${regenerate?'regeneration':'send'} preparation cancelled by ${action}`,async()=>{
            st.currentChatId=801;st.currentMessages=[{role:'user',content:'origin'}];await putChat(801,st.currentMessages);await putChat(802);
            el.userInput.value='origin draft';let entered,release;
            const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
            app.refreshExecutionApiConfigsV136=async()=>{entered();await gate;};
            let calls=0,saves=0;app._internalHandleSend=async()=>{calls++;return [{role:'model',content:'answer'}]};
            db.saveChat=async()=>{saves++};app.flushInputDraft=()=>{};
            const pending=regenerate?app.retryFromMessage(0):app.handleSend();await waiting;
            if(action==='load')await app.loadChat(802);
            if(action==='new'){app.startNewChat();await st.executionSettingsReady;}
            if(action==='abort')app.abortRequest();
            if(action==='profile')await app.switchProfile(st.profiles.find(p=>p.id!==st.activeProfileId).id);
            const destination=JSON.stringify(st.currentMessages);release();await pending;
            eq(calls,0);eq(saves,0);eq(JSON.stringify(st.currentMessages),destination);eq(st.isSending,false);
            if(action==='abort')eq(el.userInput.value,'origin draft');
        });
    }
    await run('R01 duplicate preparation and completed send release ownership',async()=>{
        el.userInput.value='once';let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
        app.refreshExecutionApiConfigsV136=async()=>{entered();await gate;};let calls=0;
        app._internalHandleSend=async()=>{calls++;return [{role:'model',content:'answer'}]};db.saveChat=async()=>{};
        const a=app.handleSend();await waiting;const b=app.handleSend();release();await Promise.all([a,b]);
        eq(calls,1);eq(st.isSending,false);assert(!st.sendPreparationV136);assert(!st.currentExecutionApiConfig);
    });
    await run('R01 changed input and model cancel preparation without clearing the draft',async()=>{
        for(const action of ['input','model']) {
            el.userInput.value='original';let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
            app.refreshExecutionApiConfigsV136=async()=>{entered();await gate;};let calls=0;
            app._internalHandleSend=async()=>{calls++;return [{role:'model',content:'answer'}]};
            const sending=app.handleSend();await waiting;
            if(action==='input')el.userInput.value='newer draft';
            else st.currentExecutionSettings={...st.currentExecutionSettings,thinkingEffort:'high'};
            release();await sending;eq(calls,0);eq(el.userInput.value,action==='input'?'newer draft':'original');
            assert(!st.sendPreparationV136);eq(st.isSending,false);
        }
    });
    await run('R01 cancelled old preparation cannot clear the newer operation',async()=>{
        el.userInput.value='original';const releases=[],entered=[];
        app.refreshExecutionApiConfigsV136=()=>new Promise(resolve=>{releases.push(resolve);entered.splice(0).forEach(r=>r())});
        const waitFor=async count=>{while(releases.length<count)await new Promise(r=>entered.push(r));};let calls=0;
        app._internalHandleSend=async()=>{calls++;return [{role:'model',content:'answer'}]};db.saveChat=async()=>{};
        const first=app.handleSend();await waitFor(1);app.abortRequest();
        const second=app.handleSend();await waitFor(2);const newer=st.sendPreparationV136;
        releases[0]();await first;eq(st.sendPreparationV136,newer);eq(calls,0);
        releases[1]();await second;eq(calls,1);assert(!st.sendPreparationV136);eq(st.isSending,false);
    });
    await run('R01 delayed history save keeps its original chat and preserves the destination draft',async()=>{
        st.currentChatId=806;st.currentMessages=[{role:'user',content:'original save'}];await putChat(806,st.currentMessages);await putChat(807);
        const calculate=db._calculateChatStats;let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
        db._calculateChatStats=async messages=>{entered();await gate;return calculate.call(db,messages)};
        const saving=db.saveChat(null,null,{skipPush:true});await waiting;await app.loadChat(807);
        sessionStorage.setItem(SettingsV136.DRAFT_KEY,JSON.stringify({destination:'draft'}));
        release();eq(await saving,806);eq(st.currentChatId,807);eq(st.currentMessages.length,0);
        eq((await db.getChat(806)).messages[0].content,'original save');eq((await db.getChat(807)).messages.length,0);
        eq(JSON.parse(sessionStorage.getItem(SettingsV136.DRAFT_KEY)),{destination:'draft'});
    });
    await run('R02 edited signed tool aggregate sends edited body after save/reload and undo/redo',async()=>{
        await putChat(803);
        const common={provider:'gemini',apiConfigId:'gem',modelName:'gemini-3-pro-preview'};
        const aggregate=app._aggregateMessages([{role:'model',content:'',continuation:{...common,parts:[{functionCall:{id:'native',name:'tool',args:{}},thoughtSignature:'signed-call'}]}},
            {role:'tool',name:'tool',response:{ok:true},geminiFunctionCallId:'native'},
            {role:'model',content:'before',continuation:{...common,parts:[{text:'before',thoughtSignature:'signed-answer'}]}}]);
        const past={role:'model',content:'past',continuation:{...common,parts:[{text:'past',thoughtSignature:'past-signature'}]}};
        for(const text of ['edited','replacement','before','replacement']) {
            aggregate.content=text;st.currentChatId=803;st.currentMessages=[{role:'user',content:'first'},past,{role:'user',content:'tool request'},aggregate];
            db.bindChatSaveOwnerV136(st.currentMessages,await db.getChat(803));
            await db.saveChat(null,null,{skipPush:true});const saved=await db.getChat(803);
            app.freezeExecutionSettings();let body;window.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return response()};
            await window.testApi.callGeminiApi(await app._prepareApiHistory(saved.messages),{},'');st.currentExecutionApiConfig=null;
            eq(body.contents[1].parts[0].thoughtSignature,'past-signature');
            const tail=body.contents.slice(3);assert(JSON.stringify(tail).includes(text));
            if(text!=='before'){assert(!JSON.stringify(tail).includes('before'));assert(!JSON.stringify(tail).includes('signed-call'));assert(!JSON.stringify(tail).includes('functionResponse'));}
            else assert(JSON.stringify(tail).includes('signed-call'));
        }
    });
    await run('R02 real editor and Undo/Redo persist the body used by the next API request',async()=>{
        await putChat(805);st.currentChatId=805;
        const common={provider:'gemini',apiConfigId:'gem',modelName:'gemini-3-pro-preview'};
        st.currentMessages=[{role:'user',content:'test'},{role:'model',content:'before',continuation:{...common,parts:[{text:'before',thoughtSignature:'original-signature'}]}}];
        app.updateChangeHistoryControls=async()=>{};app.recalculateSearchAndReplaceAfterHistoryApply=()=>{};app.setChangeHistoryStatus=()=>{};
        app.finishEditing=()=>{st.editingMessageIndex=null};
        const node=document.createElement('div');node.className='message';node.dataset.index='1';node.innerHTML='<div class="message-content"></div><textarea class="edit-textarea">edited</textarea>';
        el.messageContainer.append(node);
        const verify=async text=>{const saved=await db.getChat(805);eq(saved.messages[1].content,text);app.freezeExecutionSettings();let body;
            window.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return response()};await window.testApi.callGeminiApi(await app._prepareApiHistory(saved.messages),{},'');
            st.currentExecutionApiConfig=null;eq(body.contents[1].parts[0].text,text);};
        try {
            await app.saveEditMessage(1,node);await verify('edited');
            await app.undoLatestChangeForMessage(1,'model');await verify('before');
            await app.redoLatestChangeForMessage(1,'model');await verify('edited');
            const plan={query:'edited',replacement:'replacement',target:'model',scope:'all',occurrenceCount:1,messageCount:1,
                changes:[{index:1,role:'model',before:'edited',after:'replacement',count:1}]};
            ui.buildChatReplacePreviewPlan=()=>plan;
            ui.validateReplacePlanAgainstCurrentMessages=p=>original.ui.validateReplacePlanAgainstCurrentMessages.call(original.ui,p);
            await original.ui.executeChatReplacePreviewPlan.call(ui);await verify('replacement');
            await app.undoLatestChangeForMessage(1,'model');await verify('edited');
            await app.redoLatestChangeForMessage(1,'model');await verify('replacement');
        }finally{node.remove();}
    });
    await run('R02 separate edited tool history is explicitly rejected',async()=>{
        const message={role:'model',content:'edited',continuation:{provider:'gemini',apiConfigId:'gem',modelName:'gemini-3-pro-preview',parts:[{text:'before'},{functionCall:{id:'id',name:'tool',args:{}}}]}};
        let rejected=false;try{await app._prepareApiHistory([message,{role:'tool',name:'tool',response:{ok:true}}]);}catch(e){rejected=e.message.includes('安全');}assert(rejected);
    });
    await run('R03 independent tab snapshots merge top-level and nested field patches',async()=>{
        const peer=window.open('/tests/settings-peer-v136.html','settings-regression-peer');
        assert(peer,'peer window blocked');
        try {
            await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('peer timeout')),5000);peer.addEventListener('load',()=>{clearTimeout(timer);resolve()},{once:true});});
            const initial=structuredClone(st.globalSettingsV136);await db.saveSetting('globalSettingsV136',initial);
            await peer.initializeSettingsPeerV136(st.db.name,initial);
            await Promise.all([app.saveGlobalSettingsV136({maxRetries:71,theme:{accentColor:'#112233'},appearance:{overlayOpacity:0.31}}),
                peer.peerSettings.saveGlobalSettingsV136({apiTimeoutSeconds:72,theme:{headerColor:'#445566'},appearance:{messageOpacity:0.42}})]);
            const value=(await db.getSetting('globalSettingsV136')).value;
            eq(value.maxRetries,71);eq(value.apiTimeoutSeconds,72);eq(value.theme.accentColor,'#112233');eq(value.theme.headerColor,'#445566');eq(value.appearance.overlayOpacity,0.31);eq(value.appearance.messageOpacity,0.42);
            st.activeProfile={...st.activeProfile,settings:{...st.activeProfile.settings,useCustomTheme:false,useCustomAppearance:false}};
            await Promise.all([app.saveAppearanceValues('theme',{newChatButtonColor:'#778899'}),peer.peerSettings.saveGlobalSettingsV136({theme:{sendButtonColor:'#aabbcc'}})]);
            // Function calling uses the same appearance patch method as the settings UI.
            await app.updateOpacitySettings({overlay:0.61,message_bubble:0.62});
            const appearance=(await db.getSetting('globalSettingsV136')).value;
            eq(appearance.theme.newChatButtonColor,'#778899');eq(appearance.theme.sendButtonColor,'#aabbcc');
            eq(appearance.appearance.overlayOpacity,0.61);eq(appearance.appearance.messageOpacity,0.62);
            await app.saveGlobalSettingsV136({maxRetries:73});await peer.peerSettings.saveGlobalSettingsV136({maxRetries:74});
            eq((await db.getSetting('globalSettingsV136')).value.maxRetries,74);
            await new Promise(r=>setTimeout(r,80));eq(st.globalSettingsV136.maxRetries,74);
        }finally{peer.close();}
    });
    await run('R04 cold auxiliary Gemini functions use central keys and dedicated models',async()=>{
        st.settings.apiKey='';st.settings.sdQcModel='gemini-2.5-pro';st.settings.sdPromptImproveModel='gemini-2.5-flash';
        st.apiConfigs[0].modelCandidates.push('gemini-2.5-flash');await db.saveSetting('apiConfigs',st.apiConfigs);
        st.activeProfileId=base.activeProfileId;st.settings.memoryAutoSaveInterval=1;st.currentMessages=[{role:'user',content:'hello'}];
        const sent=[];window.fetch=async(url,opts)=>{sent.push({url,headers:opts.headers});return response('Result: OK')};
        app.fileToBase64=async()=> 'AA==';await app.triggerAutoMemorySave();await app.runQualityChecker(new Blob(['image']),'prompt');await app._improveSdPrompt('a','b','c');
        eq(sent.length,3);assert(sent.every(r=>r.headers['x-goog-api-key']==='mock'));
        assert(sent[0].url.includes('gemini-2.5-flash:'));assert(sent[1].url.includes('gemini-2.5-pro:'));assert(sent[2].url.includes('gemini-2.5-flash:'));
    });
    await run('R04 dedicated auxiliary provider, custom endpoint and disabled/deleted credentials',async()=>{
        st.settings.apiKey='obsolete-key';st.apiConfigs[0].baseUrl='https://gemini.example/v1beta/models/';
        await db.saveSetting('apiConfigs',st.apiConfigs);app.fileToBase64=async()=> 'AA==';
        const sent=[];window.fetch=async(url,opts)=>{if(String(url).endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'test/reasoner',reasoning:{supported_efforts:['low','high']},architecture:{input_modalities:['text','image']}}]})};sent.push({url,headers:opts.headers,body:JSON.parse(opts.body)});return url.includes('chat/completions')
            ?{ok:true,json:async()=>({choices:[{message:{content:'Result: OK'}}]})}:response('Result: OK');};
        st.globalSettingsV136.sdQcModelRef={apiConfigId:'or',modelName:'test/reasoner'};
        await app.runQualityChecker(new Blob(['image']),'prompt');assert(sent[0].headers.Authorization==='Bearer mock');eq(sent[0].body.model,'test/reasoner');
        st.globalSettingsV136.sdPromptImproveModelRef={apiConfigId:'gem',modelName:'gemini-2.5-pro'};
        await app._improveSdPrompt('a','b','c');assert(sent[1].url.startsWith('https://gemini.example/'));
        for(const mode of ['disabled','deleted']) {
            const configs=structuredClone(st.apiConfigs);if(mode==='disabled')configs.find(c=>c.id==='or').enabled=false;else configs.splice(configs.findIndex(c=>c.id==='or'),1);
            await db.saveSetting('apiConfigs',configs);let rejected=false;
            try{await app.runQualityChecker(new Blob(['image']),'prompt')}catch(e){rejected=true;assert(!JSON.stringify(e).includes('obsolete-key'));assert(!JSON.stringify(e).includes('"apiKey"'));}
            assert(rejected);eq(sent.length,2);
        }
    });
    await run('R05 cold draft and inherited low survive unknown/failed capabilities',async()=>{
        const ref={apiConfigId:'or',modelName:'test/reasoner'};
        const source={schemaVersion:1,modelRef:ref,thinkingEffort:'low'};
        st.modelMetadataV136={};sessionStorage.setItem(SettingsV136.DRAFT_KEY,JSON.stringify(source));
        await db.saveSetting('lastSuccessfulExecution',source);st.currentChatId=null;
        await app.initializeNewChatExecution({restoreDraft:true});eq(app.getCurrentChatThinkingEffort(),'low');
        await app.initializeNewChatExecution();eq(app.getCurrentChatThinkingEffort(),'low');
        window.fetch=async()=>{throw new Error('offline')};await app.refreshExecutionApiConfigsV136();
        let rejected=false;try{app.freezeExecutionSettings();}catch{rejected=true;}
        assert(rejected,'unknown saved effort must not silently send a default');eq(app.getCurrentChatThinkingEffort(),'low');
        st.modelMetadataV136.or={'test/reasoner':{reasoning:{supported_efforts:['low','high'],default_effort:'high'}}};
        eq(app.freezeExecutionSettings().thinkingEffort,'low');st.currentExecutionApiConfig=null;
    });
    await run('R05 known unsupported clears effort only after metadata confirmation',async()=>{
        const ref={apiConfigId:'or',modelName:'test/reasoner'};st.currentExecutionSettings={schemaVersion:1,modelRef:ref,thinkingEffort:'low'};
        st.modelMetadataV136={};eq(app.getModelThinkingCapability().status,'pending');
        window.fetch=async()=>({ok:true,json:async()=>({data:[{id:'test/reasoner',reasoning:null}]})});
        await app.refreshModelThinkingCapabilities('or');eq(app.getModelThinkingCapability().mode,'none');
        const frozen=app.freezeExecutionSettings();eq(frozen.thinkingEffort,null);
        const body=app.applyExecutionThinking({reasoning:{effort:'high'}},'openrouter');assert(!body.reasoning);
    });
    await run('R06 parallel native Gemini function IDs survive tool loop, save and next request',async()=>{
        await putChat(804);
        app.freezeExecutionSettings();let n=0;const bodies=[];
        window.fetch=async(url,opts)=>{bodies.push(JSON.parse(opts.body));n++;
            if(n===1)return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[
                {functionCall:{id:'gem-a',name:'native_tool',args:{n:1}},thoughtSignature:'sig-a'},
                {functionCall:{id:'gem-b',name:'native_tool',args:{n:2}}}]},finishReason:'STOP'}]})};return response('done');};
        const oldTools=window.functionCallingTools;window.functionCallingTools={native_tool:async()=>({ok:true})};
        try {
            const turns=await app._internalHandleSend([{role:'user',parts:[{text:'tools'}]}],{},null);
            const replies=bodies[1].contents.flatMap(m=>m.parts).filter(p=>p.functionResponse).map(p=>p.functionResponse.id);
            eq(replies,['gem-a','gem-b']);eq(bodies[1].contents[1].parts[0].thoughtSignature,'sig-a');
            st.currentChatId=804;st.currentMessages=[{role:'user',content:'tools'},app._aggregateMessages(turns)];await db.saveChat(null,null,{skipPush:true});
            const saved=await db.getChat(804);await window.testApi.callGeminiApi(await app._prepareApiHistory(saved.messages),{},'');
            eq(bodies.at(-1).contents.flatMap(m=>m.parts).filter(p=>p.functionResponse).map(p=>p.functionResponse.id),['gem-a','gem-b']);
        }finally{window.functionCallingTools=oldTools;}
    });
    await run('R08 nested log sanitization leaves original continuation intact',async()=>{
        const raw={items:[{reasoning_content:'zai-secret',reasoningContent:'camel-secret',reasoning:'plain-reasoning',reasoning_details:[{data:'opaque'}],thoughtSignature:'gem-secret',reasoning_content_extra:'extra',
            reasoning_content_nested:{token:'nested'},redacted_content:'bedrock-secret',Authorization:'Bearer auth-secret',api_key:'key-secret'}]};
        const before=JSON.stringify(raw),safe=JSON.stringify(window.sanitizeApiRequestBodyForLog(raw));
        for(const secret of ['zai-secret','camel-secret','plain-reasoning','opaque','gem-secret','bedrock-secret','auth-secret','key-secret'])assert(!safe.includes(secret),secret+' leaked');
        eq(JSON.stringify(raw),before);
        const debug=window.testDebug,beforeLogs=debug.logs;debug.logs=[];
        try{debug.addLog('log',[raw,JSON.stringify(raw)]);const logs=JSON.stringify(debug.getLogs());assert(!logs.includes('zai-secret'));assert(!logs.includes('auth-secret'));}
        finally{debug.logs=beforeLogs;}
    });
    await run('R08 Z.ai actual request retains reasoning while console output masks it',async()=>{
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'zai',modelName:'glm-4.6'},thinkingEffort:null};app.freezeExecutionSettings();
        let body;const logs=[],originalLog=console.log;
        window.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,status:200,json:async()=>({choices:[{message:{content:'done'},finish_reason:'stop'}]})}};
        try{
            console.log=(...args)=>logs.push(args);
            await window.testApi.callZaiApi([{role:'model',parts:[{text:'previous'}],tmContinuation:{reasoning_content:'zai-request-secret'}},{role:'user',parts:[{text:'next'}]}],{},'');
            eq(body.messages[0].reasoning_content,'zai-request-secret');assert(!JSON.stringify(logs).includes('zai-request-secret'));
        }finally{console.log=originalLog;}
    });
    if(window.runNRegressionsV136)await window.runNRegressionsV136({run,app,db,st,ui,realUi:original.ui,el,assert,eq,putChat});
    Object.assign(app,original.app);Object.assign(db,original.db);Object.assign(ui,original.ui);Object.assign(st,base);window.fetch=original.fetch;
    await db.saveSetting('apiConfigs',base.apiConfigs);await db.saveSetting('globalSettingsV136',base.globalSettingsV136);
    return results;
};

window.runIntegrationJRegressionsV136=async()=>{
    const output=[],failures=[],metrics=[],gates=[];
    const assert=(v,m='assertion failed')=>{if(!v)throw Error(m)};
    const eq=(a,b,m='values differ')=>assert(JSON.stringify(a)===JSON.stringify(b),m+': '+JSON.stringify({a,b}));
    const run=async(name,fn)=>{document.documentElement.dataset.jStatus=name;try{await fn();output.push('PASS '+name)}catch(e){output.push('FAIL '+name+': '+e.message);failures.push({name,error:e.stack})}};
    const required=async(gate,operation,label)=>{await Promise.race([gate,operation.then(()=>{throw Error('Required gate skipped: '+label)})]);gates.push(label)};
    const peers=async(count,fn)=>{
        const wins=[],peers=[],name='j-migration-'+crypto.randomUUID();
        try{for(let i=0;i<count;i++){const w=window.open('/tests/integration-i-peer-v136.html','j-peer-'+name+i);wins.push(w);await new Promise(r=>w.addEventListener('load',r,{once:true}));peers.push(await w.openFullIntegrationPeerV136(name))}
            await peers[0].seed();await fn(peers);
        }finally{peers.forEach(p=>p.close());wins.forEach(w=>w.close())}
    };
    for(const count of [2,3])await run('J01 real loadProfiles protects new configs, credentials and refs across '+count+' stale startups',()=>peers(count,async ps=>{
        const [a,...late]=ps,waiting=[];
        for(const [i,p] of late.entries()){
            await p.app.loadGlobalSettings();let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),get=p.db.getAllProfiles;
            p.db.getAllProfiles=async()=>{enter();await gate;return get.call(p.db)};
            const operation=p.app.loadProfiles();await required(entered,operation,'loadProfiles after old settings read '+i);waiting.push({operation,release});
        }
        await a.app.loadGlobalSettings();await a.app.loadProfiles();
        const backup=await a.read('settings','settingsMigrationBackupV136');
        const configs=structuredClone(a.state.apiConfigs);configs[0].apiKey='new-dummy-credential';configs.push({id:'j-new',name:'J fixture',provider:'gemini',enabled:true,apiKey:'dummy-new',modelCandidates:['j-model'],defaultModel:'j-model'});
        await a.app.saveApiConfigs(configs);await a.app.saveGlobalSettingsV136({summaryModelRef:{apiConfigId:'j-new',modelName:'j-model'}});
        const expected=(await a.read('settings','apiConfigs')).value;
        waiting.forEach(g=>g.release());await Promise.all(waiting.map(g=>g.operation));
        eq((await a.read('settings','apiConfigs')).value,expected);eq((await a.read('settings','settingsSchemaVersion')).value,136);
        eq((await a.read('settings','globalSettingsV136')).value.summaryModelRef,{apiConfigId:'j-new',modelName:'j-model'});eq(await a.read('settings','settingsMigrationBackupV136'),backup);
        for(const p of ps){p.db.getAllProfiles=window.dbUtils.getAllProfiles.bind(p.db);await p.app.loadProfiles();eq((await p.read('settings','apiConfigs')).value,expected)}
    }));
    await run('J01 actual startup abort rolls back markers, API changes and backup, then retries idempotently',()=>peers(1,async([a])=>{
        await a.app.loadGlobalSettings();const before=await a.read('settings','apiConfigs'),restore=a.abortMigrationOnce();let rejected=false;
        try{await a.app.loadProfiles()}catch{rejected=true}finally{restore()}
        assert(rejected);eq((await a.read('settings','settingsSchemaVersion')).value,0);eq(await a.read('settings','apiConfigs'),before);eq(await a.read('settings','settingsMigrationBackupV136'),undefined);
        await a.app.loadProfiles();const backup=await a.read('settings','settingsMigrationBackupV136');await a.app.loadProfiles();eq(await a.read('settings','settingsMigrationBackupV136'),backup);
    }));
    await run('J01 custom legacy model refs resolve after candidates are supplemented without replacing defaults',()=>peers(1,async([a])=>{
        await a.write(['settings','profiles'],tx=>{
            tx.objectStore('settings').put({key:'apiConfigs',value:[{id:'api_gemini_default',provider:'gemini',enabled:true,apiKey:'latest-dummy',defaultModel:'kept-default',modelCandidates:['kept-default']}]});
            tx.objectStore('profiles').put({id:1,name:'custom',settings:{apiConfigId:'api_gemini_default',apiProvider:'gemini',modelName:'custom-main',additionalModels:'custom-main\ncustom-aux',thoughtTranslationModel:'custom-aux'}});
        });
        await a.app.loadGlobalSettings();await a.app.loadProfiles();const settings=(await a.read('settings','globalSettingsV136')).value,configs=(await a.read('settings','apiConfigs')).value;
        eq(settings.thoughtTranslationModelRef,{apiConfigId:'api_gemini_default',modelName:'custom-aux'});eq(configs.find(c=>c.id==='api_gemini_default').defaultModel,'kept-default');eq(configs.find(c=>c.id==='api_gemini_default').apiKey,'latest-dummy');
    }));
    const app=window.appLogic,st=window.state,db=window.dbUtils,ui=window.uiUtilsV136,api=window.testApi;
    const snapshot={...st},oldFetch=window.fetch,oldClient=window.BedrockRuntimeClient,oldCommand=window.ConverseCommand,confirm=ui.showCustomConfirm,alert=ui.showCustomAlert;
    let bodies=[],serial=0;
    const config={bedrock:['aws','us.anthropic.claude-opus-4-6-v1'],gemini:['gem','gemini-3-pro-preview'],openrouter:['or','test/reasoner'],zai:['zai','glm-4.6']};
    const setup=(provider='bedrock')=>{
        const [id,modelName]=config[provider];st.currentChatId=880000+(++serial);st.currentMessages=[];st.currentSystemPrompt='';st.currentSummarizedContext=null;st.currentExecutionApiConfig=null;
        st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:id,modelName},thinkingEffort:null};st.isSending=false;st.isEditingSystemPrompt=false;st.editingMessageIndex=null;st.abortController=new AbortController();
        st.settings={...st.settings,dummyUser:'',dummyModel:'',enableMemory:false,enableProofreading:false,enableThoughtTranslation:false,enableAutoRetry:false,maxRetries:0,reverseDummyOrder:false,concatDummyModel:false};app.freezeExecutionSettings();bodies=[];
    };
    const bed=(content,sig,original=content)=>({role:'model',content,continuation:{provider:'bedrock',apiConfigId:'aws',modelName:config.bedrock[1],displayContent:original,parts:[{text:original}],bedrock:[{reasoningContent:{reasoningText:{text:'fixture reasoning',signature:sig}}},{text:original}]}});
    const adapter=async(provider,prepared,system)=>api[{bedrock:'callBedrockApi',gemini:'callGeminiApi',openrouter:'callOpenRouterApi',zai:'callZaiApi'}[provider]](prepared,{},system);
    const mock=provider=>{
        const answer=()=>{const key='j-sig-'+(++serial);return {key,text:'answer '+serial}};
        window.ConverseCommand=class{constructor(body){this.body=body}};
        window.BedrockRuntimeClient=class{async send(command){bodies.push(structuredClone(command.body));const a=answer();return {output:{message:{content:[{reasoningContent:{reasoningText:{text:'reason',signature:a.key}}},{text:a.text}]}},stopReason:'end_turn'}}};
        window.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));const a=answer();return {ok:true,status:200,json:async()=>provider==='gemini'?{candidates:[{content:{parts:[{text:a.text,thoughtSignature:a.key}]},finishReason:'STOP'}]}:{choices:[{message:{content:a.text,...(provider==='zai'?{reasoning_content:a.key}:{reasoning_details:[{type:'reasoning.encrypted',data:a.key,signature:a.key}]})},finish_reason:'stop'}]}}};
    };
    const generate=async(provider,system=null)=>{const prepared=await app._prepareApiHistory(st.currentMessages,system);const results=await app._internalHandleSend(prepared,{},system);const message=app._aggregateMessages(results);st.currentMessages.push(message);await db.saveChat();st.currentMessages=(await db.getChat(st.currentChatId)).messages;return message;};
    try{
        ui.showCustomConfirm=async()=>true;ui.showCustomAlert=async()=>{};
        await run('J02 unknown edited legacy suffix stays invalid through delete, reload and repeated saves',async()=>{
            setup();mock('bedrock');st.currentMessages=[{role:'user',content:'one'},bed('edited','edited-signature','original'),{role:'user',content:'two'},bed('later','legacy-later'),{role:'user',content:'three'},bed('last','legacy-last')];
            await db.saveChat(null,{id:st.currentChatId,title:'legacy',messages:structuredClone(st.currentMessages),systemPrompt:''});
            await app.deleteMessage(1);for(let i=0;i<2;i++){st.currentMessages=(await db.getChat(st.currentChatId)).messages;await db.saveChat()}
            await adapter('bedrock',await app._prepareApiHistory(st.currentMessages),null);const sent=JSON.stringify(bodies.at(-1));assert(!sent.includes('legacy-later')&&!sent.includes('legacy-last'));
            for(const m of st.currentMessages.filter(m=>m.role==='model'))assert(m.continuation.historyPrefixInvalidV136,'invalid state not persisted');
        });
        await run('J02 unchanged unknown legacy signatures remain usable after repeated persistence',async()=>{
            setup();mock('bedrock');st.currentMessages=[{role:'user',content:'one'},bed('first','unchanged-legacy')];await db.saveChat();st.currentMessages=(await db.getChat(st.currentChatId)).messages;await db.saveChat();
            await adapter('bedrock',await app._prepareApiHistory(st.currentMessages),null);assert(JSON.stringify(bodies.at(-1)).includes('unchanged-legacy'));
        });
        for(const provider of ['bedrock','openrouter'])await run('J03 '+provider+' native tool IDs stay identical between fingerprint and adapter',async()=>{
            setup(provider);mock(provider);st.currentMessages=[{role:'user',content:'run tool'},{role:'model',content:'',tool_calls:[{functionCall:{id:'native-tool-id',name:'fixture_tool',args:{}}}]},{role:'tool',name:'fixture_tool',response:{ok:true},geminiFunctionCallId:'native-tool-id'},{role:'user',content:'continue'}];
            const response=await generate(provider),signature=JSON.stringify(response.continuation).match(/j-sig-\d+/)[0];const prepared=await app._prepareApiHistory(st.currentMessages);assert(JSON.stringify(prepared).includes(signature));
            await adapter(provider,prepared,null);const native=JSON.stringify(bodies.at(-1));assert(native.includes('native-tool-id'));assert(native.includes(signature));
        });
        for(const provider of Object.keys(config))for(const dummy of [false,true])await run('J03 '+provider+' actual adapters, three saved turns, dummy '+dummy,async()=>{
            setup(provider);mock(provider);if(dummy)st.settings.dummyUser='configured dummy';let previous;
            for(let i=0;i<3;i++){
                st.currentMessages.push({role:'user',content:'question '+i});const prepared=await app._prepareApiHistory(st.currentMessages,null);
                if(previous)eq(JSON.stringify(prepared).includes(previous),!dummy,'previous signature dependency');
                const message=await generate(provider);assert(message.continuation.historyWireV136?.prefix,'wire context not recorded');
                previous=JSON.stringify(message.continuation).match(/j-sig-\d+/)?.[0];assert(previous);
                st.settings.dummyUser=i===2?'changed dummy':st.settings.dummyUser;
            }
        });
        for(const provider of ['bedrock','openrouter'])await run('J03 '+provider+' stable summarized prefix retains signature; summary and system changes invalidate it',async()=>{
            setup(provider);mock(provider);st.currentMessages=Array.from({length:7},(_,i)=>({role:i%2?'model':'user',content:'m'+i}));st.currentSummarizedContext={summaryText:'summary one'};
            const response=await generate(provider),signature=JSON.stringify(response.continuation).match(/j-sig-\d+/)[0];
            let prepared=await app._prepareApiHistory(st.currentMessages,null);assert(JSON.stringify(prepared).includes(signature));
            st.currentSummarizedContext.summaryText='summary changed';prepared=await app._prepareApiHistory(st.currentMessages,null);assert(!JSON.stringify(prepared).includes(signature));
            st.currentSummarizedContext.summaryText='summary one';st.currentSystemPrompt='different system';prepared=await app._prepareApiHistory(st.currentMessages,{parts:[{text:'different system'}]});assert(!JSON.stringify(prepared).includes(signature));
        });
        await run('J03 no dummy to added dummy preserves the unchanged historical prefix',async()=>{
            setup();mock('bedrock');st.currentMessages=[{role:'user',content:'one'}];const response=await generate('bedrock'),signature=JSON.stringify(response.continuation).match(/j-sig-\d+/)[0];
            st.settings.dummyUser='new dummy';const prepared=await app._prepareApiHistory(st.currentMessages);assert(JSON.stringify(prepared).includes(signature));
        });
        for(const provider of Object.keys(config))await run('J03 '+provider+' actual edit and Undo/Redo preserve the provider dependency scope',async()=>{
            setup(provider);mock(provider);st.currentMessages=[{role:'user',content:'first question'}];const a=await generate(provider),first=JSON.stringify(a.continuation).match(/j-sig-\d+/)[0];
            st.currentMessages.push({role:'user',content:'second question'});const b=await generate(provider),second=JSON.stringify(b.continuation).match(/j-sig-\d+/)[0];
            const node=document.createElement('div');node.innerHTML='<div class="message-content"></div><textarea class="edit-textarea">edited question</textarea>';window.testElements.messageContainer.append(node);
            try{await app.saveEditMessage(0,node);let text=JSON.stringify(await app._prepareApiHistory(st.currentMessages));assert(!text.includes(first));eq(text.includes(second),['gemini','zai'].includes(provider));
                await app.undoLatestChangeForMessage(0,'user');text=JSON.stringify(await app._prepareApiHistory(st.currentMessages));assert(text.includes(first)&&text.includes(second));
                await app.redoLatestChangeForMessage(0,'user');text=JSON.stringify(await app._prepareApiHistory(st.currentMessages));assert(!text.includes(first));
            }finally{node.remove()}
        });
        await run('J03 fresh signed candidate switch invalidates only its dependent suffix and restores on return',async()=>{
            setup();mock('bedrock');const user={role:'user',content:'choose'};st.currentMessages=[user];const a=await generate('bedrock');st.currentMessages=[user];const b=await generate('bedrock');
            Object.assign(a,{isCascaded:true,isSelected:true,siblingGroupId:'j-group'});Object.assign(b,{isCascaded:true,isSelected:false,siblingGroupId:'j-group'});
            st.currentMessages=[user,a,b,{role:'user',content:'next'}];const c=await generate('bedrock'),signature=JSON.stringify(c.continuation).match(/j-sig-\d+/)[0];
            await app.navigateCascade(1,'next');let prepared=await app._prepareApiHistory(st.currentMessages.filter(m=>!m.isCascaded||m.isSelected));assert(!JSON.stringify(prepared).includes(signature));
            await app.navigateCascade(2,'prev');prepared=await app._prepareApiHistory(st.currentMessages.filter(m=>!m.isCascaded||m.isSelected));assert(JSON.stringify(prepared).includes(signature));
        });
        await run('J04 content, MIME and order invalidate cached dependencies while UI-only metadata does not',async()=>{
            setup('gemini');mock('gemini');st.currentMessages=[{role:'user',content:'images',attachments:[{name:'a',mimeType:'image/png',base64Data:'a'.repeat(1024*1024)},{name:'b',mimeType:'image/jpeg',base64Data:'b'.repeat(1024*1024)}]}];
            const response=await generate('gemini'),signature=JSON.stringify(response.continuation).match(/j-sig-\d+/)[0];st.currentMessages[0].timestamp=123;st.currentMessages[0].uiNote='display only';assert(JSON.stringify(await app._prepareApiHistory(st.currentMessages)).includes(signature));
            st.currentMessages[0].attachments.reverse();assert(!JSON.stringify(await app._prepareApiHistory(st.currentMessages)).includes(signature));st.currentMessages[0].attachments.reverse();
            st.currentMessages[0].attachments[0].mimeType='image/webp';assert(!JSON.stringify(await app._prepareApiHistory(st.currentMessages)).includes(signature));
        });
        for(const scenario of [{name:'none',sizes:[]},{name:'1MiB',sizes:[1]},{name:'4MiB',sizes:[4]},{name:'20MiB',sizes:[20]},{name:'multiple',sizes:[1,1,1,1]}])await run('J04 responsive save and prepare '+scenario.name,async()=>{
            setup('gemini');mock('gemini');st.currentMessages=[{role:'user',content:'fixture',attachments:scenario.sizes.map((size,i)=>({name:'image'+i,mimeType:'image/png',base64Data:'a'.repeat(size*1024*1024)}))}];
            let worst=0,last=performance.now();const tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});const timer=setInterval(()=>{const now=performance.now();worst=Math.max(worst,now-last);last=now},5);
            const start=performance.now(),saving=db.saveChat(),saveSync=performance.now()-start;await saving;const saveTotal=performance.now()-start;
            const p=performance.now(),preparing=app._prepareApiHistory(st.currentMessages),prepareSync=performance.now()-p;const prepared=await preparing;const prepareTotal=performance.now()-p;
            await generate('gemini');const wire=st.currentMessages.at(-1).continuation.historyWireV136;const original=st.currentMessages[0].attachments;
            if(original.length){original[0].base64Data='b'+original[0].base64Data.slice(1);const changed=await app._prepareApiHistory(st.currentMessages);assert(!JSON.stringify(changed).includes('j-sig-'),'changed bytes reused cached digest')}
            await new Promise(r=>setTimeout(r,0));clearInterval(timer);observer.disconnect();metrics.push({name:scenario.name,saveSync,saveTotal,prepareSync,prepareTotal,maxTimerGap:worst,maxLongTask:Math.max(0,...tasks)});
            assert(saveSync<150&&prepareSync<150,'long main-thread preparation');assert(worst<200,'main-thread responsiveness gap '+worst);
        });
        for(const action of ['abort','chat'])await run('J04 actual handleSend '+action+' during the digest never posts or saves into the destination',async()=>{
            setup('gemini');mock('gemini');st.currentMessages=[{role:'user',content:'original',attachments:[{name:'image',mimeType:'image/png',base64Data:'a'.repeat(4*1024*1024)}]}];await db.saveChat();
            const originalId=st.currentChatId,targetId=originalId+100000;await db.saveChat(null,{id:targetId,title:'destination',systemPrompt:'',messages:[{role:'user',content:'destination'}],executionSettings:structuredClone(st.currentExecutionSettings)});
            const task=SettingsV136.historyTaskV136;let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);let once=true;
            SettingsV136.historyTaskV136=async(...args)=>{if(once&&args[0]==='wire'){once=false;enter();await gate}return task(...args)};
            try{window.testElements.userInput.value='new prompt';const sending=app.handleSend();await required(entered,sending,'actual handleSend digest '+action);
                const navigation=action==='chat'?app.loadChat(targetId):(app.abortRequest(),Promise.resolve());release();await Promise.all([sending,navigation]);
                eq(bodies.length,0,'request escaped after cancellation');eq((await db.getChat(targetId)).messages.map(m=>m.content),['destination']);assert((await db.getChat(originalId)).messages.some(m=>m.content==='new prompt'));
            }finally{release();SettingsV136.historyTaskV136=task;st.isSending=false}
        });
        for(const action of ['abort','chat','profile'])await run('J04 ownership checked after asynchronous digest '+action,async()=>{
            setup();mock('bedrock');st.currentMessages=[{role:'user',content:'one'}];await generate('bedrock');
            const task=SettingsV136.historyTaskV136;let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);let once=true;
            SettingsV136.historyTaskV136=async(...args)=>{if(once&&args[0]==='wire'){once=false;enter();await gate}return task(...args)};
            try{const pending=app._prepareApiHistory(st.currentMessages);await required(entered,pending,'digest before owner check '+action);if(action==='abort')st.abortController.abort();else if(action==='chat'){st.currentChatId++;st.currentMessages=[]}else st.activeProfileId++;
                release();let cancelled=false;try{await pending}catch(e){cancelled=e.name==='AbortError'}assert(cancelled,'stale preparation returned');
            }finally{SettingsV136.historyTaskV136=task;st.activeProfileId=snapshot.activeProfileId}
        });
    }finally{Object.assign(st,snapshot);window.fetch=oldFetch;window.BedrockRuntimeClient=oldClient;window.ConverseCommand=oldCommand;ui.showCustomConfirm=confirm;ui.showCustomAlert=alert}
    return {output,failures,metrics,gates,passed:output.filter(x=>x.startsWith('PASS')).length,failed:failures.length};
};

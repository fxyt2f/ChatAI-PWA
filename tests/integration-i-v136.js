window.runIntegrationIRegressionsV136=async()=>{
    const output=[],failures=[];
    const assert=(v,m)=>{if(!v)throw Error(m)};
    const eq=(a,b,m)=>assert(JSON.stringify(a)===JSON.stringify(b),m||JSON.stringify({actual:a,expected:b}));
    const run=async(name,fn)=>{try{await fn();output.push('PASS '+name)}catch(e){output.push('FAIL '+name+': '+e.message);failures.push({name,error:e.stack})}};
    const peers=async(count,fn)=>{
        const windows=[],values=[],name='chatai-integration-i-'+crypto.randomUUID();
        try{for(let i=0;i<count;i++){
            const w=window.open('/tests/integration-i-peer-v136.html','integration-'+name+'-'+i);windows.push(w);
            await new Promise(r=>w.addEventListener('load',r,{once:true}));values.push(await w.openIntegrationPeerV136(name));
        }
        await values[0].seed();for(const p of values)await p.reload();return await fn(values);
        }finally{for(let i=0;i<windows.length;i++){values[i]?.close();windows[i]?.close()}}
    };
    const readyOrDone=(gate,promise)=>Promise.race([gate.entered.then(()=>true),promise.then(()=>{throw Error('Required race gate was not reached')})]);
    const image=()=>new Blob(['isolated image fixture'],{type:'image/png'});
    const referenced=async p=>{
        const global=(await p.read('settings','globalSettingsV136'))?.value;
        const profiles=await p.read('profiles',null,true),ids=[global?.appearance?.backgroundAssetId,...profiles.map(p=>p.settings?.appearance?.backgroundAssetId)].filter(Boolean);
        for(const id of ids){
            const asset=await p.read('image_store',id);
            assert(asset?.blob && Object.prototype.toString.call(asset.blob)==='[object Blob]' && asset.blob.size>0,'Referenced Blob is missing: '+id);
        }
        return ids;
    };
    await run('I01 delayed migration cannot overwrite messages saved after the first migration',()=>peers(2,async([a,b])=>{
        const gate=b.hold('chats'),late=b.app.ensureSettingsMigrationV136();await readyOrDone(gate,late);
        await a.app.ensureSettingsMigrationV136();
        await a.write(['chats'],tx=>tx.objectStore('chats').put({id:1,messages:[{role:'user',content:'original'},{role:'model',content:'saved after migration'}]}));
        gate.release();await late;
        eq((await a.read('chats',1)).messages.length,2,'late migration rolled back the new message');
    }));
    await run('I02 cleanup uses current references when a different tab saves a new background',()=>peers(2,async([a,b])=>{
        const gate=a.hold('profiles'),cleaning=a.app.cleanupBackgroundAssetsV136();await readyOrDone(gate,cleaning);
        await b.app.saveBackgroundBlobV136(image(),{global:true});gate.release();await cleaning;await referenced(a);
    }));
    await run('I02 background addition and reference publication have no cleanup gap',()=>peers(2,async([a,b])=>{
        const gate=a.holdAppearance(),saving=a.app.saveBackgroundBlobV136(image(),{global:true});await readyOrDone(gate,saving);
        await b.app.cleanupBackgroundAssetsV136();gate.release();await saving;await referenced(a);
    }));
    for(const own of [true,false])await run('I03 A background stays on A after switching to B (B override '+own+')',()=>peers(1,async([a])=>{
        const gate=a.holdAppearance(),saving=a.app.saveBackgroundBlobV136(image());await readyOrDone(gate,saving);
        await a.select(2,own);gate.release();await saving;
        assert((await a.read('profiles',1)).settings.appearance.backgroundAssetId,'A did not receive its background');
        eq((await a.read('profiles',2)).settings.appearance.backgroundAssetId,null,'B background changed');
        eq((await a.read('settings','globalSettingsV136')).value.appearance.backgroundAssetId,null,'global background changed');await referenced(a);
    }));
    await run('I04 stale override toggle preserves another tab temperature and system prompt',()=>peers(2,async([a,b])=>{
        await b.write(['profiles'],tx=>{const s=tx.objectStore('profiles'),r=s.get(1);r.onsuccess=()=>s.put({...r.result,settings:{...r.result.settings,temperature:.12345,systemPrompt:'saved in another tab'}})});
        await a.app.setProfileOverride('theme',true);
        const saved=await a.read('profiles',1);eq(saved.settings.temperature,.12345,'temperature rolled back');eq(saved.settings.systemPrompt,'saved in another tab','system prompt rolled back');
        eq(a.state.activeProfile.settings.temperature,.12345,'active state is stale');
    }));
    await run('I01 three stale tabs and a post-migration profile/chat save retain current records and backup',()=>peers(3,async([a,b,c])=>{
        const gate=b.hold('chats'),late=b.app.ensureSettingsMigrationV136();await readyOrDone(gate,late);
        await a.app.ensureSettingsMigrationV136();const backup=(await a.read('settings','settingsMigrationBackupV136')).value;
        await a.write(['profiles','chats'],tx=>{
            const ps=tx.objectStore('profiles'),r=ps.get(1);r.onsuccess=()=>ps.put({...r.result,settings:{...r.result.settings,temperature:.22222,systemPrompt:'after first migration'}});
            tx.objectStore('chats').put({id:1,messages:[{role:'user',content:'one'},{role:'model',content:'two'}]});
        });
        await c.app.ensureSettingsMigrationV136();gate.release();await late;
        eq((await a.read('chats',1)).messages.length,2);eq((await a.read('profiles',1)).settings.temperature,.22222);
        eq((await a.read('profiles',1)).settings.systemPrompt,'after first migration');eq((await a.read('settings','settingsMigrationBackupV136')).value,backup);
    }));
    await run('I01 migration reads the latest profile and chat rather than stale in-memory inputs',()=>peers(2,async([a,b])=>{
        await b.write(['profiles','chats'],tx=>{
            tx.objectStore('profiles').put({id:1,name:'latest',settings:{temperature:.12345,systemPrompt:'latest prompt'}});
            tx.objectStore('chats').put({id:2,messages:[{role:'user',content:'new before lock'}]});
        });
        await a.app.ensureSettingsMigrationV136();eq((await a.read('profiles',1)).settings.temperature,.12345);eq((await a.read('profiles',1)).settings.systemPrompt,'latest prompt');
        assert((await a.read('chats',2)).executionSettings,'new chat was not migrated');
    }));
    await run('I01 aborted migration rolls back marker, backup and records, then retries and restarts safely',()=>peers(1,async([a])=>{
        const restore=a.abortMigrationOnce();let failed=false;try{await a.app.ensureSettingsMigrationV136()}catch{failed=true}finally{restore()}
        assert(failed,'abort did not fail migration');eq((await a.read('settings','settingsSchemaVersion')).value,0);
        eq(await a.read('settings','settingsMigrationBackupV136'),undefined);assert(!(await a.read('chats',1)).executionSettings);
        await a.app.ensureSettingsMigrationV136();const backup=(await a.read('settings','settingsMigrationBackupV136')).value;
        await a.reload();await a.app.ensureSettingsMigrationV136();eq((await a.read('settings','settingsMigrationBackupV136')).value,backup);eq((await a.read('settings','settingsSchemaVersion')).value,136);
    }));
    await run('I02 cleanup requested at Blob write cannot observe an unpublished image',()=>peers(2,async([a,b])=>{
        let cleaning,observed=false;const restore=a.observeBlobPut(()=>{observed=true;cleaning=b.app.cleanupBackgroundAssetsV136()});
        try{await a.app.saveBackgroundBlobV136(image(),{global:true});await cleaning;assert(observed,'Blob write was not observed');await referenced(a)}finally{restore()}
    }));
    await run('I02 global and individual saves across tabs retain both images and reclaim only orphans',()=>peers(2,async([a,b])=>{
        await b.select(2,true);await a.write(['image_store'],tx=>{
            tx.objectStore('image_store').put({id:'background_orphan',blob:image()});
            tx.objectStore('image_store').put({id:'img_unrelated',blob:image()});
        });
        await Promise.all([a.app.saveBackgroundBlobV136(image(),{global:true}),b.app.saveBackgroundBlobV136(image())]);
        const ids=await referenced(a);eq(ids.length,2);assert(ids[0]!==ids[1]);
        assert(!(await a.read('image_store','background_orphan')),'unreferenced background survived cleanup');assert(await a.read('image_store','img_unrelated'),'unrelated image was deleted');
        await a.reload();await referenced(a);
    }));
    await run('I02 two concurrent saves to the same owner leave a valid final image without leaked predecessors',()=>peers(2,async([a,b])=>{
        await Promise.all([a.app.saveBackgroundBlobV136(image()),b.app.saveBackgroundBlobV136(image())]);await a.app.cleanupBackgroundAssetsV136();
        const ids=await referenced(a),images=await a.read('image_store',null,true);eq(images.filter(x=>x.id.startsWith('background_')).map(x=>x.id),ids);
    }));
    for(const own of [true,false])await run('I03 immediate switch while IDB save is pending keeps A owner (B override '+own+')',()=>peers(1,async([a])=>{
        a.state.profiles[1].settings.useCustomAppearance=own;await a.db.updateProfile(a.state.profiles[1]);
        const saving=a.app.saveBackgroundBlobV136(image());a.state.activeProfileId=2;a.state.activeProfile=a.state.profiles[1];
        await saving;assert((await a.read('profiles',1)).settings.appearance.backgroundAssetId);eq((await a.read('profiles',2)).settings.appearance.backgroundAssetId,null);eq((await a.read('settings','globalSettingsV136')).value.appearance.backgroundAssetId,null);await referenced(a);
    }));
    await run('I03 explicit global scope survives an immediate profile switch',()=>peers(1,async([a])=>{
        const saving=a.app.saveBackgroundBlobV136(image(),{global:true});a.state.activeProfileId=2;a.state.activeProfile=a.state.profiles[1];await saving;
        assert((await a.read('settings','globalSettingsV136')).value.appearance.backgroundAssetId);eq((await a.read('profiles',1)).settings.appearance.backgroundAssetId,null);eq((await a.read('profiles',2)).settings.appearance.backgroundAssetId,null);await referenced(a);
    }));
    await run('I02/I03 deleted target is never recreated and its pending Blob is rolled back',()=>peers(2,async([a,b])=>{
        const deletion=b.write(['profiles'],tx=>tx.objectStore('profiles').delete(1));
        let failed=false;try{await a.app.saveBackgroundBlobV136(image())}catch{failed=true}await deletion;
        assert(failed,'deleted target did not fail');eq(await a.read('profiles',1),undefined);eq((await a.read('image_store',null,true)).length,0);await referenced(a);
    }));
    await run('I02 profile-import Blob and profile reference publish atomically',()=>peers(2,async([a,b])=>{
        a.app.base64ToBlob=async()=>image();const imported=await a.app.parseProfileImportV136({profileSchemaVersion:1,name:'import',settings:{useCustomAppearance:true},backgroundAsset:{data:'fixture',mimeType:'image/png'}});
        await b.app.cleanupBackgroundAssetsV136();const id=await a.app.addImportedProfileV136(imported);assert(id);await b.app.cleanupBackgroundAssetsV136();await referenced(a);
    }));
    await run('I04 concurrent profile patches merge generation, prompt and nested appearance fields',()=>peers(2,async([a,b])=>{
        await Promise.all([a.app.patchProfileSettingsV136(1,{temperature:.12345,appearance:{overlayOpacity:.2}}),b.app.patchProfileSettingsV136(1,{systemPrompt:'peer prompt',appearance:{messageOpacity:.4}})]);
        const profile=await a.read('profiles',1);eq(profile.settings.temperature,.12345);eq(profile.settings.systemPrompt,'peer prompt');eq(profile.settings.appearance.overlayOpacity,.2);eq(profile.settings.appearance.messageOpacity,.4);
        await a.app.reloadProfileSettingsV136(1);await b.app.reloadProfileSettingsV136(1);eq(a.state.activeProfile.settings,profile.settings);eq(b.state.activeProfile.settings,profile.settings);
    }));
    await run('I04 first-on copies current global values; off and on restore the retained override',()=>peers(2,async([a,b])=>{
        await b.app.saveGlobalSettingsV136({theme:{accentColor:'#123456'}});await a.app.setProfileOverride('theme',true);
        eq((await a.read('profiles',1)).settings.theme.accentColor,'#123456');
        await a.app.saveAppearanceValues('theme',{accentColor:'#abcdef'});await a.app.setProfileOverride('theme',false);
        eq((await a.read('profiles',1)).settings.theme.accentColor,'#abcdef');await a.app.setProfileOverride('theme',true);eq(a.state.settings.accentColor,'#abcdef');
    }));
    await run('I04 delayed theme, appearance and profile patches cannot revive a deleted profile',()=>peers(2,async([a,b])=>{
        await b.write(['profiles'],tx=>tx.objectStore('profiles').delete(1));
        for(const operation of [()=>a.app.setProfileOverride('theme',true),()=>a.app.saveAppearanceValues('appearance',{overlayOpacity:.1}),()=>a.app.patchProfileSettingsV136(1,{temperature:.9})]){
            let rejected=false;try{await operation()}catch{rejected=true}assert(rejected,'deleted profile patch was accepted');eq(await a.read('profiles',1),undefined);
        }
    }));
    for(const global of [true,false])await run('I02 direct '+(global?'global':'profile')+' reference publication rejects an image reclaimed before it acquires the lock',()=>peers(2,async([a,b])=>{
        await a.write(['image_store'],tx=>tx.objectStore('image_store').put({id:'background_unpublished',blob:image()}));
        const cleaning=a.app.cleanupBackgroundAssetsV136();let rejected=false;
        try{await b.app.saveAppearanceValues('appearance',{backgroundAssetId:'background_unpublished'},{global})}catch{rejected=true}await cleaning;
        assert(rejected,'dangling reference was published');await referenced(a);
    }));
    await run('I04 empty first-on override captures current global settings',()=>peers(2,async([a,b])=>{
        await a.write(['profiles'],tx=>{const s=tx.objectStore('profiles'),r=s.get(1);r.onsuccess=()=>s.put({...r.result,settings:{...r.result.settings,theme:{}}})});
        await b.app.saveGlobalSettingsV136({theme:{accentColor:'#654321'}});await a.app.setProfileOverride('theme',true);eq((await a.read('profiles',1)).settings.theme.accentColor,'#654321');
    }));
    const app=window.appLogic,st=window.state,db=window.dbUtils,ui=window.uiUtilsV136,api=window.testApi;
    const snapshot=Object.fromEntries(['currentMessages','currentChatId','currentSystemPrompt','currentExecutionSettings','currentExecutionApiConfig','currentSummarizedContext','isSending','isEditingSystemPrompt','editingMessageIndex'].map(k=>[k,st[k]]));
    const oldConfirm=ui.showCustomConfirm,oldAlert=ui.showCustomAlert,oldClient=window.BedrockRuntimeClient,oldCommand=window.ConverseCommand;
    let body;
    window.ConverseCommand=class{constructor(body){this.body=body}};window.BedrockRuntimeClient=class{async send(command){body=command.body;return {output:{message:{content:[{text:'done'}]}},stopReason:'end_turn'}}};
    const reloadChat=async()=>{const saved=await db.getChat(st.currentChatId);st.currentMessages=saved.messages;db.bindChatSaveOwnerV136(st.currentMessages,saved)};
    const model=(content,sig)=>({role:'model',content,continuation:{provider:'bedrock',apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1',displayContent:content,parts:[{text:content}],bedrock:[{reasoningContent:{reasoningText:{text:'reason',signature:sig}}}]}});
    try{
        ui.showCustomConfirm=async()=>true;ui.showCustomAlert=async()=>{};
        for(const index of [0,2,1])await run('I05 delete '+index+' strips only dependent Bedrock signatures after reload',async()=>{
            st.isSending=false;st.isEditingSystemPrompt=false;st.editingMessageIndex=null;st.currentSummarizedContext=null;st.currentSystemPrompt='';
            st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'},thinkingEffort:'high'};
            st.currentChatId=null;st.currentMessages=[{role:'user',content:'one'},model('first','i-sig-a'),{role:'user',content:'two'},model('second','i-sig-b'),{role:'user',content:'three'},model('last','i-sig-c')];
            await db.saveChat();await app.deleteMessage(index);await reloadChat();
            app.freezeExecutionSettings();await api.callBedrockApi(await app._prepareApiHistory(st.currentMessages),{},'');st.currentExecutionApiConfig=null;
            const sent=JSON.stringify(body);assert(!sent.includes('i-sig-b')&&!sent.includes('i-sig-c'),'dependent signature was replayed');
            eq(sent.includes('i-sig-a'),index===2,'unchanged prefix signature preservation');
        });
        const history=()=>[{role:'user',content:'one'},model('first','i-sig-a'),{role:'user',content:'two'},model('second','i-sig-b'),{role:'user',content:'three'},model('last','i-sig-c')];
        const setup=async(id,messages)=>{st.isSending=false;st.isEditingSystemPrompt=false;st.editingMessageIndex=null;st.currentSummarizedContext=null;st.currentSystemPrompt='';st.currentExecutionApiConfig=null;
            st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'aws',modelName:'us.anthropic.claude-opus-4-6-v1'},thinkingEffort:'high'};st.currentChatId=null;st.currentMessages=messages;await db.saveChat()};
        const sentSignatures=async()=>{app.freezeExecutionSettings();await api.callBedrockApi(await app._prepareApiHistory(st.currentMessages.filter(m=>!m.isCascaded||m.isSelected)),{},'');st.currentExecutionApiConfig=null;return JSON.stringify(body)};
        for(const index of [3,4,5])await run('I05 deletion '+index+' preserves every signature before the changed prefix',async()=>{
            await setup(870010+index,history());await app.deleteMessage(index);await reloadChat();
            const sent=await sentSignatures();assert(sent.includes('i-sig-a'));eq(sent.includes('i-sig-b'),index>=4);assert(!sent.includes('i-sig-c'));
        });
        await run('I05 unchanged signed history survives save and reload without discarding signatures',async()=>{
            await setup(870020,history());await reloadChat();const sent=await sentSignatures();for(const sig of ['i-sig-a','i-sig-b','i-sig-c'])assert(sent.includes(sig));
        });
        const candidates=()=>[{role:'user',content:'one'},{...model('candidate A','candidate-a'),isCascaded:true,isSelected:true,siblingGroupId:'i-group'},
            {...model('candidate B','candidate-b'),isCascaded:true,isSelected:false,siblingGroupId:'i-group'}, {role:'user',content:'two'},model('dependent','dependent-sig')];
        await run('I05 candidate switch invalidates dependent signatures and switching back restores coherent originals',async()=>{
            await setup(870021,candidates());await app.navigateCascade(1,'next');await reloadChat();
            let sent=await sentSignatures();assert(sent.includes('candidate-b'));assert(!sent.includes('candidate-a')&&!sent.includes('dependent-sig'));
            await app.navigateCascade(2,'prev');await reloadChat();sent=await sentSignatures();assert(sent.includes('candidate-a')&&sent.includes('dependent-sig'));
        });
        for(const selected of [false,true])await run('I05 deleting '+(selected?'selected':'unselected')+' candidate follows visible-history dependencies',async()=>{
            await setup(selected?870022:870023,candidates());await app.confirmDeleteCascadeResponse(selected?1:2);await reloadChat();
            const sent=await sentSignatures();eq(sent.includes('dependent-sig'),!selected);assert(sent.includes(selected?'candidate-b':'candidate-a'));
        });
        await run('I05 fresh Bedrock response after deletion remains valid while older dependent signatures stay invalid',async()=>{
            await setup(870024,history());await app.deleteMessage(0);st.currentMessages.push({role:'user',content:'continue on modified history'});
            app.freezeExecutionSettings();const prepared=await app._prepareApiHistory(st.currentMessages);
            window.BedrockRuntimeClient=class{async send(command){body=command.body;return {output:{message:{content:[{reasoningContent:{reasoningText:{text:'new reasoning',signature:'fresh-signature'}}},{text:'fresh response'}]}},stopReason:'end_turn'}}};
            try{const result=await app._internalHandleSend(prepared,{},null);st.currentMessages.push(app._aggregateMessages(result));await db.saveChat();await reloadChat();
                const sent=await sentSignatures();assert(sent.includes('fresh-signature'));assert(!sent.includes('i-sig-a')&&!sent.includes('i-sig-b')&&!sent.includes('i-sig-c'));
            }finally{window.BedrockRuntimeClient=class{async send(command){body=command.body;return {output:{message:{content:[{text:'done'}]}},stopReason:'end_turn'}}};st.currentExecutionApiConfig=null}
        });
        await run('I05 invalid tool-only continuation fails before an adapter request',async()=>{
            const tool=model('','tool-only-signature');tool.continuation.parts=[{functionCall:{name:'tool',args:{}}}];
            await setup(870025,[{role:'user',content:'request'},tool]);await app.deleteMessage(0);
            let failed=false;try{await app._prepareApiHistory(st.currentMessages)}catch(e){failed=e.message.includes('再構築')}assert(failed,'unsafe tool-only continuation was accepted');
        });
        await run('I05 Gemini turn dependencies preserve independent signatures after an earlier user deletion',async()=>{
            const gem=(content,sig)=>({role:'model',content,continuation:{provider:'gemini',apiConfigId:'gem',modelName:'gemini-3-pro-preview',displayContent:content,parts:[{text:content,thoughtSignature:sig}]}});
            await setup(870026,[{role:'user',content:'one'},gem('first','g-first'),{role:'user',content:'two'},gem('second','g-second')]);
            st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'gem',modelName:'gemini-3-pro-preview'},thinkingEffort:'high'};await app.deleteMessage(0);await reloadChat();
            app.freezeExecutionSettings();const prepared=JSON.stringify(await app._prepareApiHistory(st.currentMessages));assert(!prepared.includes('g-first'));assert(prepared.includes('g-second'));st.currentExecutionApiConfig=null;
        });
        for(const provider of ['openrouter','zai'])await run('I05 '+provider+' deletion obeys its continuation dependency policy in the final adapter request',async()=>{
            const configId=provider==='zai'?'zai':'or',modelName=provider==='zai'?'glm-4.6':'test/reasoner';
            const response=(content,key)=>({role:'model',content,continuation:{provider,apiConfigId:configId,modelName,displayContent:content,parts:[{text:content}],
                openai:provider==='zai'?{reasoning_content:key}:{reasoning_details:[{type:'reasoning.encrypted',data:key,signature:key}]}}});
            await setup(provider==='zai'?870027:870028,[{role:'user',content:'one'},response('first','provider-first'),{role:'user',content:'two'},response('second','provider-second')]);
            st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:configId,modelName},thinkingEffort:null};await app.deleteMessage(0);await reloadChat();
            const fetchBefore=window.fetch;let sent;
            window.fetch=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({choices:[{message:{content:'done'},finish_reason:'stop'}]})}};
            try{app.freezeExecutionSettings();const prepared=await app._prepareApiHistory(st.currentMessages);await(provider==='zai'?api.callZaiApi(prepared,{},''):api.callOpenRouterApi(prepared,{},''));
                const encoded=JSON.stringify(sent);assert(!encoded.includes('provider-first'));eq(encoded.includes('provider-second'),provider==='zai');assert(JSON.stringify(st.currentMessages).includes('provider-first'));
            }finally{window.fetch=fetchBefore;st.currentExecutionApiConfig=null}
        });
        // Exercise the real queued settings UI, with two additional isolated profiles.
        const profileBeforeUi=st.activeProfileId,view=window.settingsUiV136;
        const newUiProfile=async name=>db.addProfile({name,createdAt:Date.now(),icon:null,settings:{...SettingsV136.profileSettings(st.activeProfile.settings),useCustomTheme:false,useCustomAppearance:true,appearance:{backgroundAssetId:null,overlayOpacity:.75,messageOpacity:1}}});
        const uiA=await newUiProfile('Integration UI A'),uiB=await newUiProfile('Integration UI B');await app.loadProfiles();
        const png=await new Promise(resolve=>{const c=document.createElement('canvas');c.width=c.height=4;const x=c.getContext('2d');x.fillStyle='#316293';x.fillRect(0,0,4,4);c.toBlob(resolve,'image/png')});
        try{
            await run('I03 real file input queued on A saves A after switching to B and decodes after reload',async()=>{
                await app.switchProfile(uiA);await ui.showScreen('settings',true);view.selectCategory('profile',false);
                let release;const held=new Promise(r=>release=r);view.saveQueue=view.saveQueue.then(()=>held);
                const input=document.getElementById('profile-background-image-input'),dt=new DataTransfer();dt.items.add(new File([png],'integration.png',{type:'image/png'}));input.files=dt.files;
                const oldGlobal=(await db.getSetting('globalSettingsV136')).value.appearance.backgroundAssetId;input.dispatchEvent(new Event('change',{bubbles:true}));
                await app.switchProfile(uiB);release();await view.saveQueue;
                const a=await db.getProfile(uiA),b=await db.getProfile(uiB);assert(a.settings.appearance.backgroundAssetId);eq(b.settings.appearance.backgroundAssetId,null);eq((await db.getSetting('globalSettingsV136')).value.appearance.backgroundAssetId,oldGlobal);
                await app.switchProfile(uiA);await new Promise(r=>setTimeout(r,25));const asset=await new Promise((resolve,reject)=>{const req=st.db.transaction('image_store').objectStore('image_store').get(a.settings.appearance.backgroundAssetId);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
                const url=URL.createObjectURL(asset.blob),image=new Image();try{image.src=url;await image.decode();eq(image.naturalWidth,4)}finally{URL.revokeObjectURL(url)}
            });
            await run('I03 URL download pins its profile owner before awaiting the network',async()=>{
                await app.switchProfile(uiA);let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),fetchBefore=window.fetch;
                window.fetch=async(url,...args)=>url==='https://integration.invalid/background'? (enter(),await gate,new Response(png)):fetchBefore(url,...args);
                try{const saving=app.handleBackgroundImageUrl('https://integration.invalid/background');await entered;await app.switchProfile(uiB);const oldB=(await db.getProfile(uiB)).settings.appearance.backgroundAssetId;release();await saving;eq((await db.getProfile(uiB)).settings.appearance.backgroundAssetId,oldB);assert((await db.getProfile(uiA)).settings.appearance.backgroundAssetId)}finally{window.fetch=fetchBefore}
            });
            await run('I04 actual peer patch refreshes DB, active state and settings DOM without rolling fields back',async()=>{
                await app.switchProfile(uiA);await ui.showScreen('settings',true);view.selectCategory('profile',false);
                const peerWindow=window.open('/tests/integration-i-peer-v136.html','integration-profile-ui-peer');let peer;
                try{await new Promise(r=>peerWindow.addEventListener('load',r,{once:true}));peer=await peerWindow.openIntegrationPeerV136(st.db.name);peer.state.activeProfileId=uiA;await peer.reload();
                    await peer.app.patchProfileSettingsV136(uiA,{temperature:.12345,systemPrompt:'committed in actual peer'});
                    const end=Date.now()+3000;while(st.activeProfile.settings.temperature!==.12345){if(Date.now()>end)throw Error('profile broadcast timeout');await new Promise(r=>setTimeout(r,10))}
                    eq(Number(app.profileSettingControlsV136.temperature.value),.12345);eq(st.settings.systemPrompt,'committed in actual peer');
                    const prompt=app.profileSettingControlsV136.systemPrompt;window.testFocusTab('');await new Promise(r=>setTimeout(r,25));prompt.focus();prompt.value='編集中のプロファイル指示';prompt.setSelectionRange(4,4);prompt.dispatchEvent(new Event('input',{bubbles:true}));
                    await peer.app.patchProfileSettingsV136(uiA,{topP:.4321});await app.reloadProfileSettingsV136(uiA);eq(prompt.value,'編集中のプロファイル指示');eq(prompt.selectionStart,4);assert(document.activeElement===prompt);prompt.blur();
                }finally{peer?.close();peerWindow.close()}
            });
            await run('I04 profile name patch preserves a concurrently committed generation setting',async()=>{
                await app.switchProfile(uiA);const tx=st.db.transaction('profiles','readwrite'),store=tx.objectStore('profiles'),request=store.get(uiA);request.onsuccess=()=>store.put({...request.result,settings:{...request.result.settings,temperature:.2468}});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
                await app.updateCurrentProfile({name:'Integration renamed'},uiA);const saved=await db.getProfile(uiA);eq(saved.name,'Integration renamed');eq(saved.settings.temperature,.2468);eq(st.settings.temperature,.2468);
            });
            await run('I04 asynchronous icon read keeps its original profile and preserves other fields',async()=>{
                await app.switchProfile(uiA);const NativeReader=window.FileReader;let enter,apply;const entered=new Promise(r=>enter=r);
                window.FileReader=class extends NativeReader{readAsArrayBuffer(file){const callback=this.onload;this.onload=e=>{apply=()=>callback(e);enter()};super.readAsArrayBuffer(file)}};
                try{app.handleProfileIconChange(new File([png],'icon.png',{type:'image/png'}));await entered;await app.switchProfile(uiB);await apply();const a=await db.getProfile(uiA),b=await db.getProfile(uiB);assert(a.icon?.size>0);eq(b.icon,null);eq(a.settings.temperature,.2468)}finally{window.FileReader=NativeReader}
            });
            await run('I02 chat deletion cannot remove a background newly referenced after its initial scan',async()=>{
                const id='background_chat_share_integration',chatId=870101;
                await new Promise((resolve,reject)=>{const tx=st.db.transaction(['image_store','chats'],'readwrite');tx.objectStore('image_store').put({id,blob:png});tx.objectStore('chats').put({id:chatId,messages:[{role:'user',content:'isolated shared image',imageIds:[id]}]});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
                const original=app.getReferencedImageIdsV136;let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
                app.getReferencedImageIdsV136=async(...args)=>{const ids=await original.apply(app,args);enter();await gate;return ids};
                try{const deleting=db.deleteChat(chatId,{markDirty:false});await entered;await app.saveAppearanceValues('appearance',{backgroundAssetId:id},{scope:'profile',profileId:uiA});release();await deleting;
                    const asset=await new Promise(r=>{const q=st.db.transaction('image_store').objectStore('image_store').get(id);q.onsuccess=()=>r(q.result)});assert(asset?.blob,'newly referenced shared background was deleted');
                }finally{release();app.getReferencedImageIdsV136=original}
            });
            await run('I02 explicit profile replacement rejects a missing background instead of publishing a dangling reference',async()=>{
                const original=await db.getProfile(uiA);let rejected=false;
                try{await db.updateProfile({...original,settings:{...original.settings,appearance:{...original.settings.appearance,backgroundAssetId:'background_missing_fixture'}}})}catch{rejected=true}
                assert(rejected);eq((await db.getProfile(uiA)).settings.appearance.backgroundAssetId,original.settings.appearance.backgroundAssetId);
            });
        }finally{await app.switchProfile(profileBeforeUi)}
    }finally{Object.assign(st,snapshot);ui.showCustomConfirm=oldConfirm;ui.showCustomAlert=oldAlert;window.BedrockRuntimeClient=oldClient;window.ConverseCommand=oldCommand;window.settingsUiV136?.renderExecution()}
    return {output,failures,passed:output.filter(x=>x.startsWith('PASS')).length,failed:failures.length};
};

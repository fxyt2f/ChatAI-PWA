window.runReviewFixesV136 = async ({app, db, st, ui, el, test, assert, eq, stage}) => {
    const gemini = {apiConfigId:'gem', modelName:'gemini-3-flash-preview'};
    const originalFetch = window.fetch, originalConfirm = ui.showCustomConfirm, originalAlert = ui.showCustomAlert;
    const savedGlobals = (await db.getSetting(SettingsV136.GLOBAL_KEY)).value;
    const encoder = new TextEncoder();
    const wait = async (predicate, label) => {
        const end = Date.now() + 5000;
        while (Date.now() < end) {
            const value = await predicate();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('Timed out: ' + label);
    };
    const channels = [];
    const channel = () => {
        let writer, closed = false;
        const body = new ReadableStream({start(c){writer=c},cancel(){closed=true}});
        const stream = {
            body, response:new Response(body,{headers:{'Content-Type':'text/event-stream'}}),
            frame(parts, reason) {
                writer.enqueue(encoder.encode('data: '+JSON.stringify({candidates:[{content:{parts},finishReason:reason}]})+'\n\n'));
            },
            close(){if (!closed) {closed=true;writer.close();}}
        };
        channels.push(stream);
        return stream;
    };
    const messages = entries => entries.map(([role,content], i) => ({role,content,timestamp:i+1}));
    const contents = chat => chat.messages.map(message => message.content);
    const seed = async entries => {
        app.startNewChat(); await st.executionSettingsReady; await app.setCurrentChatModelRef(gemini);
        Object.assign(st.settings,{enableStreamingOutput:true,enableApiTimeout:false,enableProofreading:false,enableThoughtTranslation:false,
            enableMemory:false,enableAutoRetry:false,geminiEnableFunctionCalling:false,dummyUser:'',dummyModel:''});
        if (entries.length) {
            st.currentMessages.push(...messages(entries));
            await db.saveChat();
        }
        return st.currentChatId;
    };
    const send = text => {el.userInput.value=text;return app.handleSend()};
    const openPeer = async () => {
        const iframe = document.createElement('iframe');
        iframe.hidden=true;
        const loaded=new Promise(resolve=>iframe.onload=resolve);
        iframe.src='./integration-i-peer-v136.html';document.body.append(iframe);await loaded;
        const peer=await iframe.contentWindow.openFullIntegrationPeerV136(st.db.name);
        return {peer, peerWindow:iframe.contentWindow, close(){peer.close();iframe.remove()}};
    };
    try {
        await app.saveGlobalSettingsV136({enableChatTitleGeneration:false,enableStreamingOutput:true});
        ui.showCustomConfirm=async()=>true;
        ui.showCustomAlert=async()=>{};
        if (!stage || stage===1) {
            await test('F1 a stale stream cannot overwrite a peer save, restore or reused ID', async () => {
                const {peer,peerWindow,close}=await openPeer();
                try {
                    for (const action of ['save','restore','reuse']) {
                        const id=await seed([['user','original']]);
                        const stream=channel();
                        window.fetch=async()=>stream.response;
                        const pending=send('request in A');
                        await wait(()=>stream.body.locked,'stream in A');
                        const saved=await db.getChat(id);
                        const replacement=messages([['user','newer from B: '+action]]);
                        if (action==='save') {
                            assert((await peer.app.loadChat(id)).ok);
                            peer.state.currentMessages.splice(0,peer.state.currentMessages.length,...replacement);
                            await peer.db.saveChat();
                        } else if (action==='restore') {
                            const {metadataJson,localAssets}=await app._prepareExportData();
                            const payload=JSON.parse(metadataJson);
                            const data=payload.data;
                            const original= data.chats.find(chat=>chat.id===id);
                            original.messages=replacement;
                            peerWindow.dropboxApi={downloadAsset:async id=>localAssets.get(id)?.blob};
                            await peer.app.importDataFromString(JSON.stringify(payload));
                        } else {
                            await peer.db.deleteChat(id,{markDirty:false});
                            await peer.db.saveChat(null,{id,title:'replacement',messages:replacement});
                        }
                        const newer=await db.getChat(id);
                        if(action!=='save') assert(saved.recordGenerationId!==newer.recordGenerationId);
                        stream.frame([{text:'stale response'}],'STOP');stream.close();await pending;
                        eq(contents(await db.getChat(id)),contents(newer));
                        assert(!st.isSending && st.abortController===null);
                    }
                } finally {close()}
            });
            await test('F1 metadata writes do not conflict with a stream or roll back title/pin; local saves serialize', async () => {
                const id=await seed([['user','first']]);
                const stream=channel();
                window.fetch=async()=>stream.response;
                const pending=send('next');
                await wait(()=>stream.body.locked,'stream for metadata test');
                const version=(await db.getChat(id)).contentRevision;
                const {peer,close}=await openPeer();
                try {
                    await peer.db.updateChatTitleDb(id,'manual title');
                    await peer.db.updateChatPinState(id,true);
                } finally { close(); }
                eq((await db.getChat(id)).contentRevision,version);
                stream.frame([{text:'final answer'}],'STOP');stream.close();await pending;
                const final=await db.getChat(id);
                eq([final.title,final.titleSource,final.isPinned,final.messages.at(-1).content],['manual title','manual',true,'final answer']);
                st.currentMessages.push(...messages([['user','queued one']]));
                const first=db.saveChat();
                st.currentMessages.push(...messages([['user','queued two']]));
                const second=db.saveChat();
                await Promise.all([first,second]);
                eq(contents(await db.getChat(id)).slice(-2),['queued one','queued two']);
            });
            await test('F1 a stopped stream and its independent title request preserve a peer conversation update', async () => {
                const {peer,close}=await openPeer();
                let releaseTitle, releaseSave;
                const save=db.saveChat;
                try {
                    await app.saveGlobalSettingsV136({enableChatTitleGeneration:true,chatTitleModelRef:gemini});
                    await seed([]);
                    const stream=channel();
                    window.fetch=async (url, options)=>{
                        if(String(url).includes('streamGenerateContent')) return stream.response;
                        return new Promise(resolve=>{
                            releaseTitle=()=>{
                                assert(!options.signal.aborted);
                                resolve(Response.json({candidates:[{content:{parts:[{text:'independent title'}]}}]}));
                            };
                        });
                    };
                    db.saveChat=async function(...args) {
                        if (args[2]?.sendSession?.controller.signal.aborted) await new Promise(resolve=>{releaseSave=resolve});
                        return save.apply(this,args);
                    };
                    const pending=send('first request');
                    await wait(()=>releaseTitle && stream.body.locked,'title and stream in flight');
                    const id=st.currentChatId;
                    stream.frame([{text:'old partial'}]);
                    await wait(()=>st.sendExecutionV136?.streamContent,'old partial');
                    app.abortRequest();
                    await wait(()=>releaseSave,'stopped send has not saved yet');
                    assert((await peer.app.loadChat(id)).ok);
                    peer.state.currentMessages.push(...messages([['user','peer update']]));
                    await peer.db.saveChat();
                    releaseSave();await pending;
                    releaseTitle();
                    await wait(async()=>(await db.getChat(id)).title==='independent title','independent title commit');
                    eq(contents(await db.getChat(id)),['first request','peer update']);
                } finally {
                    db.saveChat=save;releaseSave?.();releaseTitle?.();close();
                    await app.saveGlobalSettingsV136({enableChatTitleGeneration:false,chatTitleModelRef:null});
                }
            });
            await test('F2 stopping two different regeneration targets retains their own history', async () => {
                const id=await seed([['user','q1'],['model','a1'],['user','q2'],['model','a2']]);
                for (const index of [2,0]) {
                    const stream=channel();window.fetch=async()=>stream.response;
                    const pending=app.retryFromMessage(index);
                    await wait(()=>stream.body.locked,'regeneration reader');
                    if (index===0) {
                        stream.frame([{text:'partial q1'}]);
                        await wait(()=>st.sendExecutionV136?.streamContent,'regeneration partial');
                    }
                    app.abortRequest();await pending;
                }
                const saved=await db.getChat(id);
                eq(contents(saved),['q1','a1','partial q1','q2','a2']);
                assert(saved.messages[2].incomplete && !saved.messages[2].continuation);
            });
        }
        if (!stage || stage===2) {
            await test('F3 signed duplicate Gemini tool IDs fail before executing any tool', async () => {
                const tools = window.functionCallingTools;
                let calls = 0, requests = 0;
                window.functionCallingTools = {...tools, review_probe:async()=>{calls++;return {success:true}}};
                try {
                    for (const ids of [['same','same'],['first','second'],[undefined,undefined]]) {
                        const id=await seed([['user','first']]);
                        const stream=channel(), final=channel();
                        requests=0; calls=0;
                        window.fetch=async()=>++requests===1 ? stream.response : final.response;
                        const pending=send('use tools');
                        await wait(()=>stream.body.locked,'tool response');
                        stream.frame(ids.map((id,i)=>({functionCall:{id,name:'review_probe',args:{i}},thoughtSignature:'sig'+i})),'STOP');
                        stream.close();
                        final.frame([{text:'done'}],'STOP');final.close();
                        await pending;
                        const saved=await db.getChat(id);
                        if (ids[0]==='same') {
                            eq([calls,requests],[0,1]);
                            assert(saved.messages.some(m=>m.role==='error' && m.content.includes('同じID')));
                        } else {
                            eq([calls,requests],[2,2]);eq(saved.messages.at(-1).content,'done');
                        }
                    }
                } finally { window.functionCallingTools=tools; }
            });
            await test('F4 stopping real auxiliary fetches and an in-flight tool permits an immediate new send', async () => {
                const tools = window.functionCallingTools;
                const translation = app.resolveThoughtTranslationApiConfig;
                let secondToolCalls = 0;
                try {
                    app.resolveThoughtTranslationApiConfig=()=>({provider:'gemini',modelName:gemini.modelName,apiKey:'mock'});
                    for (const phase of ['translation','proofreading','json-translation','tool']) {
                        const id=await seed([['user','first']]);
                        const stream=channel();
                        let receivedSignal, completeTool, calls=0;
                        st.settings.enableThoughtTranslation=phase.endsWith('translation');
                        st.settings.enableProofreading=phase==='proofreading';
                        st.settings.proofreadingModelRef=gemini;
                        st.settings.enableStreamingOutput=phase!=='json-translation';
                        window.functionCallingTools={...tools,
                            review_probe:async(_,chat)=>{
                                receivedSignal=chat.signal;
                                await new Promise(resolve=>{completeTool=resolve});
                                chat.assertActive();
                                throw new Error('stale tool reached a side effect');
                            },
                            review_second:async()=>{secondToolCalls++;return {success:true}}
                        };
                        window.fetch=async(_,options)=>{
                            if (++calls===1) return phase==='json-translation'
                                ? Response.json({candidates:[{content:{parts:[{text:'English thought',thought:true},{text:'kept text'}]},finishReason:'STOP'}]})
                                : stream.response;
                            receivedSignal=options.signal;
                            return new Promise((_,reject)=>receivedSignal.addEventListener('abort',()=>reject(receivedSignal.reason),{once:true}));
                        };
                        const pending=send('first attempt');
                        if (phase!=='json-translation') {
                            await wait(()=>stream.body.locked,'main stream');
                            const parts=[{text:'English thought',thought:true},{text:'kept text'}];
                            if (phase==='tool') parts.push(...['review_probe','review_second'].map(name=>({functionCall:{name,args:{}}})));
                            stream.frame(parts,'STOP');stream.close();
                        }
                        await wait(()=>receivedSignal,phase+' request signal');
                        app.abortRequest();await pending;
                        assert(receivedSignal.aborted,phase+' was aborted');
                        eq(st.isSending,false);eq(st.abortController,null);
                        const partial=(await db.getChat(id)).messages.at(-1);
                        eq([partial.content,partial.thoughtSummary,partial.incomplete],['kept text','English thought',true]);
                        assert(!(await db.getChat(id)).messages.some(m=>m.role==='error'));
                        st.settings.enableThoughtTranslation=false;
                        st.settings.enableProofreading=false;
                        st.settings.enableStreamingOutput=true;
                        const next=channel();window.fetch=async()=>next.response;
                        const second=send('next attempt');
                        await wait(()=>next.body.locked,'next send');
                        completeTool?.();
                        next.frame([{text:'new reply'}],'STOP');next.close();await second;
                        eq((await db.getChat(id)).messages.at(-1).content,'new reply');
                        eq(secondToolCalls,0);
                    }
                } finally {
                    window.functionCallingTools=tools;
                    app.resolveThoughtTranslationApiConfig=translation;
                }
            });
            await test('F5 duplication waits until stopped partial content and metadata commit', async () => {
                const id=await seed([['user','first']]);
                const stream=channel();window.fetch=async()=>stream.response;
                const pending=send('request');
                await wait(()=>stream.body.locked,'stream before copy');
                stream.frame([{text:'partial thought',thought:true},{text:'partial answer'}]);
                await wait(()=>st.sendExecutionV136?.streamContent,'partial answer');
                const save=db.saveChat;
                let release, copyFinished=false;
                db.saveChat=async function(...args) {
                    if (args[2]?.sendSession?.controller.signal.aborted) {
                        await new Promise(resolve=>{release=resolve});
                    }
                    return save.apply(this,args);
                };
                try {
                    const copy=app.duplicateChat(id).then(result=>{copyFinished=true;return result});
                    await wait(()=>release,'blocked partial save');
                    await new Promise(resolve=>setTimeout(resolve,25));
                    eq(copyFinished,false);
                    release();
                    await pending;
                    const result=await copy;
                    assert(result?.ok,JSON.stringify(result));
                    const partial=(await db.getChat(result.chatId ?? result.id)).messages.at(-1);
                    eq([partial.content,partial.thoughtSummary,partial.incomplete],['partial answer','partial thought',true]);
                    assert(!partial.continuation);
                } finally { db.saveChat=save;release?.(); }
            });
            await test('F4 video polling passes the SDK signal and discards late operation results', async () => {
                const toolSource=await (await originalFetch('../function-calling.js')).text();
                const tools=window.functionCallingTools, declarations=window.functionDeclarations;
                const tool=Function(toolSource+'\nreturn generate_video;')();
                const sdk=window.GoogleGenAI, timer=window.setTimeout, key=st.settings.apiKey;
                const controller=new AbortController();
                let startSignal, pollSignal, resolvePoll, downloads=0;
                try {
                    st.settings.apiKey='mock-video';
                    window.setTimeout=(fn,ms,...args)=>timer(fn,ms===10000 ? 1 : ms,...args);
                    window.GoogleGenAI=class {
                        models={generateVideos:async ({config})=>{
                            startSignal=config.abortSignal;
                            return {done:false};
                        }};
                        operations={getVideosOperation:({config})=>{
                            pollSignal=config.abortSignal;
                            return new Promise(resolve=>{resolvePoll=resolve});
                        }};
                    };
                    window.fetch=async()=>{downloads++;throw new Error('stale video download')};
                    const pending=tool({prompt:'a test video'},{signal:controller.signal});
                    await wait(()=>resolvePoll,'video poll');
                    assert(startSignal===controller.signal && pollSignal===controller.signal);
                    controller.abort();
                    assert((await pending).success===false);
                    resolvePoll({done:true,response:{generatedVideos:[{video:{uri:'https://video.invalid'}}]}});
                    await new Promise(resolve=>timer(resolve,0));
                    eq(downloads,0);
                } finally {
                    controller.abort();
                    st.settings.apiKey=key;window.GoogleGenAI=sdk;window.setTimeout=timer;
                    window.functionCallingTools=tools;window.functionDeclarations=declarations;
                }
            });
            await test('F5 a failed partial save prevents the waiting duplicate', async () => {
                const id=await seed([['user','first']]);
                const before=(await db.getAllChats()).length;
                const stream=channel();window.fetch=async()=>stream.response;
                const pending=send('request').then(()=>null,error=>error.message);
                await wait(()=>stream.body.locked,'stream before save error');
                stream.frame([{text:'unsaved partial'}]);
                await wait(()=>st.sendExecutionV136?.streamContent,'unsaved answer');
                const save=db.saveChat;
                db.saveChat=function(...args) {
                    if (args[2]?.sendSession?.controller.signal.aborted) return Promise.reject(new Error('forced save failure'));
                    return save.apply(this,args);
                };
                try {
                    const result=await app.duplicateChat(id);
                    eq(await pending,'forced save failure');
                    eq(result,{ok:false,reason:'generation-save-failed'});
                    eq((await db.getAllChats()).length,before);
                    assert(!st.isSending && st.abortController===null);
                } finally { db.saveChat=save; }
            });
        }
        if (!stage || stage===3) {
            await test('F6 deletion rechecks a peer title reference and preserves peer API edits', async () => {
                const configs=structuredClone(st.apiConfigs);
                const target={...configs[0],id:'delete-race',name:'Delete race'};
                const {peer,close}=await openPeer();
                const alerts=[];
                try {
                    await seed([['user','first']]);
                    await app.saveApiConfigs([...configs,target]);
                    ui.showCustomAlert=async message=>alerts.push(message);
                    ui.showCustomConfirm=async()=>{
                        await peer.app.saveGlobalSettingsV136({chatTitleModelRef:{apiConfigId:target.id,modelName:target.defaultModel}});
                        return true;
                    };
                    await app.deleteApiConfig(target.id);
                    assert(alerts.some(message=>message.includes('使用中')));
                    assert((await db.getSetting('apiConfigs')).value.some(c=>c.id===target.id));
                    await peer.app.saveGlobalSettingsV136({chatTitleModelRef:null});
                    await app.reloadGlobalSettingsV136();
                    ui.showCustomConfirm=async()=>{
                        await peer.app.saveApiConfigs([...configs,target,{...target,id:'peer-added',name:'Peer added'}]);
                        return true;
                    };
                    await app.deleteApiConfig(target.id);
                    const stored=(await db.getSetting('apiConfigs')).value;
                    assert(!stored.some(c=>c.id===target.id) && stored.some(c=>c.id==='peer-added'));
                } finally {
                    ui.showCustomConfirm=async()=>true;ui.showCustomAlert=async()=>{};
                    await app.saveApiConfigs(configs);close();
                }
            });
            await test('F8 OpenRouter saves all distinct public thought fields on stop and recovers after malformed SSE', async () => {
                const id=await seed([['user','first']]);
                const reply=data=>new Response(data,{headers:{'Content-Type':'text/event-stream'}});
                const requests=[];
                let routerReply;
                window.fetch=async(url,options)=>{
                    requests.push([String(url),options?.method]);
                    if (!options?.body) return Response.json({data:[{id:'test/reasoner',reasoning:{supported_efforts:['low','high'],default_effort:'low'}}]});
                    assert(String(url).includes('/chat/completions'),String(url));
                    return routerReply();
                };
                await app.setCurrentChatModelRef({apiConfigId:'or',modelName:'test/reasoner'});
                let writer, cancelled=false;
                const body=new ReadableStream({start(c){writer=c},cancel(){cancelled=true}});
                routerReply=()=>reply(body);
                const pending=send('mixed thinking');
                await wait(async()=>{
                    if (body.locked) return true;
                    const last=(await db.getChat(id)).messages.at(-1);
                    if (last.role==='error') throw new Error(JSON.stringify({requests,message:last.content}));
                    return false;
                },'router reader');
                for (const delta of [
                    {reasoning:'first thought'},
                    {reasoning_content:'second thought'},
                    {reasoning_details:[{type:'reasoning.text',index:0,text:'first thought'},{type:'reasoning.encrypted',data:'opaque'},
                        {type:'reasoning.summary',index:1,summary:'third thought'}]},
                    {content:'partial content'}
                ]) writer.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\n'));
                const thought='first thought\n\nsecond thought\n\nthird thought';
                await wait(()=>st.sendExecutionV136?.getStreamThought?.()===thought,'mixed thought preview');
                app.abortRequest();await pending;
                assert(cancelled);
                const partial=(await db.getChat(id)).messages.at(-1);
                eq([partial.content,partial.thoughtSummary,partial.incomplete],['partial content',thought,true]);
                assert(!partial.continuation);
                routerReply=()=>reply('data: {invalid}\n\n');
                await send('malformed');
                eq((await db.getChat(id)).messages.at(-1).role,'error');
                routerReply=()=>reply('data: '+JSON.stringify({choices:[{index:0,delta:{content:'recovered'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
                await send('retry again');
                eq((await db.getChat(id)).messages.at(-1).content,'recovered');
            });
            await test('F10 accepts a final response on request 19 or 20 and rejects a request 21', async () => {
                const tools=window.functionCallingTools;
                let calls=0, requests=0;
                const tool=async()=>{calls++;return {success:true}};
                window.functionCallingTools={...tools,review_probe:tool,generate_video:tool};
                try {
                    for (const finalAt of [19,20,21,'terminal']) {
                        const id=await seed([['user','first']]);
                        calls=0;requests=0;
                        window.fetch=async()=>{
                            requests++;
                            const terminal=finalAt==='terminal'&&requests===20;
                            const parts=requests===finalAt ? [{text:'final answer'}] :
                                [{functionCall:{name:terminal?'generate_video':'review_probe',args:{}}}];
                            if(terminal) parts.push({text:'final answer'});
                            const stream=channel();
                            stream.frame(parts,'STOP');stream.close();return stream.response;
                        };
                        await send('repeat tools');
                        const final=(await db.getChat(id)).messages.at(-1);
                        if (finalAt===21) eq([requests,calls,final.role],[20,19,'error']);
                        else eq([requests,calls,final.content],finalAt==='terminal'?[20,20,'final answer']:[finalAt,finalAt-1,'final answer']);
                    }
                } finally {window.functionCallingTools=tools;}
            });
        }
    } finally {
        for(const stream of channels) stream.close();
        window.fetch=originalFetch;
        ui.showCustomConfirm=originalConfirm;ui.showCustomAlert=originalAlert;
        await app.saveGlobalSettingsV136(savedGlobals);
    }
};

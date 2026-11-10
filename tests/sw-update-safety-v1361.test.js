const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const region=source.slice(source.indexOf('// --- Service Worker関連 ---'),source.indexOf('const htmlUtils'));
function fixture(){
    const events={},windowEvents={},timers=[],metrics={reload:0,close:0,activate:0};
    const state={db:{close(){metrics.close++;}},activeProfile:{id:'fixture'},currentMessages:[],currentSystemPrompt:'',
        isSending:true,editingMessageIndex:null,pendingAttachments:[],sync:{},systemPromptSaveStatus:'saved'};
    const app={_setupEventListenersCallCount:1,isGenerationBlockingActive:()=>false,flushInputDraft:()=>{},hasUnsavedSystemPrompt:()=>false};
    const sandbox={state,dbUtils:{pendingChatSaves:0},appLogic:app,uiUtils:{showCustomAlert:async()=>{}},console,
        setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout:()=>{},setInterval:()=>{},
        document:{querySelector:()=>null,getElementById:()=>null,addEventListener:()=>{}},
        navigator:{serviceWorker:{addEventListener:(name,fn)=>events[name]=fn}},
        window:{addEventListener:(name,fn)=>windowEvents[name]=fn,location:{reload(){metrics.reload++;}}}};
    vm.createContext(sandbox);vm.runInContext(region+'\nregisterServiceWorker();',sandbox);
    async function drain(){for(let i=0;i<5;i++)await Promise.resolve();}
    async function resume(){const batch=timers.splice(0);for(const fn of batch)fn();await drain();}
    return {state,app,events,windowEvents,service:sandbox.navigator.serviceWorker,metrics,drain,resume,db:sandbox.dbUtils,
        coordinator:()=>vm.runInContext('createServiceWorkerUpdateCoordinator()',sandbox)};
}
(async()=>{
    for(const blocker of ['sending','prompt','picker','attachment','message']){
        const f=fixture();f.state.isSending=false;
        if(blocker==='sending')f.state.isSending=true;
        if(blocker==='prompt')f.app.hasUnsavedSystemPrompt=()=>true;
        if(blocker==='picker')f.app.attachmentPickerMessages=[];
        if(blocker==='attachment')f.app.attachmentOperation={};
        if(blocker==='message')f.state.editingMessageIndex=0;
        f.events.controllerchange();await f.drain();
        assert.equal(f.metrics.reload,0,blocker+' must defer reload');assert.equal(f.metrics.close,0,'DB closed while busy');
        f.state.isSending=false;f.state.editingMessageIndex=null;f.app.attachmentOperation=null;f.app.attachmentPickerMessages=null;f.app.hasUnsavedSystemPrompt=()=>false;
        await f.resume();assert.equal(f.metrics.reload,1,blocker+' must resume');
        f.events.controllerchange();await f.resume();assert.equal(f.metrics.reload,1,'reload must run once');
        console.log('PASS R4 controller replacement defers and resumes: '+blocker);
    }
    for(const blocker of ['db','initialization','draft','attachments']){
        const f=fixture();f.state.isSending=false;
        if(blocker==='db')f.db.pendingChatSaves=1;
        if(blocker==='initialization')f.state.executionInitializingV136=true;
        if(blocker==='draft')f.app.prepareForServiceWorkerUpdate=()=>false;
        if(blocker==='attachments')f.state.pendingAttachments=[{}];
        f.events.controllerchange();await f.resume();assert.equal(f.metrics.reload,0,blocker+' not protected');
        f.db.pendingChatSaves=0;f.state.executionInitializingV136=false;f.app.prepareForServiceWorkerUpdate=()=>true;f.state.pendingAttachments=[];
        await f.resume();assert.equal(f.metrics.reload,1,blocker+' did not recover');
        assert.equal(f.metrics.close,0);console.log('PASS R4 additional data guard: '+blocker);
    }
    {
        const f=fixture();f.state.isSending=false;
        f.app.prepareForServiceWorkerUpdate=async()=>{f.state.isSending=true;};
        f.events.controllerchange();await f.resume();assert.equal(f.metrics.reload,0,'state changed during flush');
        f.state.isSending=false;f.app.prepareForServiceWorkerUpdate=()=>true;
        await f.resume();assert.equal(f.metrics.reload,1);
        console.log('PASS R4 rechecks safety after asynchronous draft flush');
    }
    {
        const f=fixture(),updates=f.coordinator();let attempts=0;
        const worker={state:'installed',postMessage(){if(++attempts===1)throw new Error('controlled activation failure');f.metrics.activate++;}};
        updates.requestActivation(worker);await f.resume();assert.equal(attempts,0,'activated while sending');
        f.state.isSending=false;await f.resume();assert.equal(f.metrics.activate,0,'injected activation failure');
        await f.resume();assert.equal(f.metrics.activate,1,'activation not retried');
        assert.equal(f.metrics.close,0);console.log('PASS R4 waiting activation is deferred and failed delivery retried');
    }
    for(const phase of ['installing','installed']){
        const f=fixture(),listeners={};f.state.isSending=false;f.service.controller={};
        const worker={state:phase,addEventListener:(name,fn)=>listeners[name]=fn,postMessage(){f.metrics.activate++;}};
        const registration={installing:worker,waiting:null,addEventListener:()=>{}};
        f.service.register=async()=>registration;
        await f.windowEvents.load();
        worker.state='installed';listeners.statechange?.();
        await f.resume();assert.equal(f.metrics.activate,1,'missed existing '+phase+' worker');
        assert.equal(f.metrics.close,0);console.log('PASS R4 registration observes existing worker: '+phase);
    }
    {
        const f=fixture();f.state.isSending=false;f.service.controller={};
        const worker={state:'installed',postMessage(){f.metrics.activate++;}};
        const registration={installing:null,waiting:null,addEventListener:()=>{},update:async()=>{registration.waiting=worker;}};
        f.service.register=async()=>registration;f.service.ready=Promise.resolve(registration);
        await f.windowEvents.load();f.windowEvents.focus();await f.drain();await f.resume();
        assert.equal(f.metrics.activate,1,'focus/update check did not recover waiting worker');
        console.log('PASS R4 update checks recover a missed waiting worker');
    }
})().catch(error=>{console.error(error);process.exitCode=1;});

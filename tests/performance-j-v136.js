window.measureHistoryPerformanceJV136=async()=>{
    const app=window.appLogic,db=window.dbUtils,st=window.state,results=[];
    st.isSending=false;st.currentSystemPrompt='';st.currentSummarizedContext=null;st.currentExecutionApiConfig=null;
    st.currentExecutionSettings={schemaVersion:1,modelRef:{apiConfigId:'gem',modelName:'gemini-3-pro-preview'},thinkingEffort:null};app.freezeExecutionSettings();
    Object.assign(st.settings,{dummyUser:'',dummyModel:'',reverseDummyOrder:false});
    for(const [index,sizes] of [[],[1],[4],[20],[1,1,1,1]].entries()){
        st.currentChatId=889000+index;st.currentMessages=[{role:'user',content:'performance fixture',attachments:sizes.map((n,i)=>({name:'image'+i,mimeType:'image/png',base64Data:'a'.repeat(n*1024*1024)}))}];
        await new Promise(r=>setTimeout(r,0));
        const tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
        let maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now},5);
        // Measure native input dispatch latency during the operation, independently
        // of total worker runtime. The callback and timer run on the main thread.
        let tick=false;setTimeout(()=>{tick=true},0);
        const start=performance.now(),save=db.saveChat(),saveSync=performance.now()-start;await save;const saveTotal=performance.now()-start;
        const prep=performance.now(),preparing=app._prepareApiHistory(st.currentMessages),prepareSync=performance.now()-prep;await preparing;const prepareTotal=performance.now()-prep;
        await new Promise(r=>setTimeout(r,20));clearInterval(timer);observer.disconnect();
        results.push({base64MiB:sizes.reduce((a,b)=>a+b,0),attachments:sizes.length,saveSync,saveTotal,prepareSync,prepareTotal,maxTimerGap:maxGap,maxLongTask:Math.max(0,...tasks),uiTick:tick});
        st.currentMessages=(await db.getChat(st.currentChatId)).messages;const repeat=performance.now();await db.saveChat();await app._prepareApiHistory(st.currentMessages);results.at(-1).reloadAndRepeat=performance.now()-repeat;
    }
    return {metrics:results,output:results.map(r=>'PASS measured '+r.base64MiB+'MiB / '+r.attachments+' attachments'),passed:results.length,failed:0};
};

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
module.exports=function fixture(){
    const handlers={},data=new Map(),notices=[],metrics={skip:0,claim:0,assets:[],cacheModes:[],deleted:[]};
    let online=true,failPath=null,wrongPath=null,wrongContent=null,failPointer=false,gate=null,failureMessage='network unavailable';
    const href='https://example.test/sw.js',absolute=x=>new URL(typeof x==='string'?x:x.url,href).href;
    const fetch=async req=>{
        const url=absolute(req);if(!online||url.includes(failPath||'never-fail'))throw Error(failureMessage);
        metrics.cacheModes.push(req.cache);
        const pathname=new URL(url).pathname.slice(1)||'index.html';
        const file=path.join(__dirname,'..',pathname);
        let content=fs.existsSync(file)?fs.readFileSync(file):'asset';
        if(wrongPath===pathname)content=wrongContent;
        return new Response(content);
    };
    const caches={keys:async()=>[...data.keys()],has:async name=>data.has(name),delete:async name=>{metrics.deleted.push(name);return data.delete(name)},open:async name=>{
        if(!data.has(name))data.set(name,new Map());const entries=data.get(name);
        return {match:async req=>{
            const res=entries.get(absolute(req))?.clone();
            if(res&&gate&&absolute(req).endsWith('/.__active_app_shell__')){
                const held=gate;gate=null;const value=await res.text();held.enter();
                return {text:async()=>{await held.promise;return value}};
            }
            return res;
        },put:async(req,res)=>{if(failPointer&&absolute(req).includes('__active_app_shell__'))throw Error('quota');entries.set(absolute(req),res.clone())},delete:async req=>entries.delete(absolute(req)),
            keys:async()=>[...entries.keys()].map(url=>new Request(url)),addAll:async requests=>{
                metrics.assets=requests.map(r=>'./'+new URL(absolute(r)).pathname.slice(1)+new URL(absolute(r)).search);
                const results=await Promise.all(requests.map(async req=>[absolute(req),await fetch(req)]));
                results.forEach(([url,res])=>entries.set(url,res));
            }};
    }};
    const self={location:{href,origin:new URL(href).origin},addEventListener:(name,fn)=>(handlers[name]||=[]).push(fn),skipWaiting:async()=>metrics.skip++,
        clients:{claim:async()=>metrics.claim++,matchAll:async()=>[{postMessage:msg=>notices.push(msg)}]}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{self,caches,URL,Set,Map,Response,Request,crypto:webcrypto,fetch,console,TextEncoder});
    const event=async(name,extra={})=>{const waits=[];let response;for(const fn of handlers[name]||[])fn({...extra,waitUntil:p=>waits.push(p),respondWith:p=>response=p});await Promise.all(waits);return response;};
    return {event,notices,caches,metrics,offline:()=>online=false,online:()=>online=true,fail:(pathname,message='network unavailable')=>{failPath=pathname;failureMessage=message},
        wrong:(pathname,content)=>{wrongPath=pathname;wrongContent=content},quotaFailure:()=>failPointer=true,
        pausePointer:()=>{let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);gate={enter,promise};return {entered,release}}};
};

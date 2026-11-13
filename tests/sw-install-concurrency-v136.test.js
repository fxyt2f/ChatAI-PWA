const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./sw-fixture-v136');
for(const failure of ['html','javascript','css','reference','network'])test('N02 normal install rejects '+failure+' while preserving prior offline resources',async()=>{
    const w=fixture(),old=await w.caches.open('chatai-pwa-cache-v1.35.1');await old.put('https://example.test/index.html',new Response('old working shell'));
    if(failure==='network')w.fail('settings-v136.js');
    else {
        const name={html:'index.html',javascript:'app.js',css:'style.css',reference:'index.html'}[failure];
        const current=fs.readFileSync(require.resolve('../'+name),'utf8');
        w.wrong(name,failure==='css'?'/* previous release */':failure==='reference'?current.replace('./app.js?v=1.37.0','./unlisted.js?v=1.37.0'):current.replaceAll('1.37.0','1.36.0'));
    }
    await assert.rejects(w.event('install'));assert.equal(w.metrics.skip,0);assert((await w.caches.keys()).includes('chatai-pwa-cache-v1.35.1'));
    w.offline();assert.equal(await (await old.match('https://example.test/index.html')).text(),'old working shell');
});
test('N02 complete normal install promotes only the verified shell',async()=>{
    const w=fixture();await w.event('install');assert.equal(w.metrics.skip,0);await w.event('message',{data:{action:'skipWaiting'}});assert.equal(w.metrics.skip,1);await w.event('activate');w.offline();
    const res=await w.event('fetch',{request:{url:'https://example.test/app.js?v=1.37.0',method:'GET',mode:'cors'}});assert.equal(res.status,200);
});
test('N03 fetch paused after old pointer recovers after replacement and cleanup offline',async()=>{
    const w=fixture();await w.event('install');await w.event('activate');await w.event('message',{data:{action:'clearCache'}});
    const gate=w.pausePointer();const reading=w.event('fetch',{request:{url:'https://example.test/app.js?v=1.37.0',method:'GET',mode:'cors'}});await gate.entered;
    await w.event('message',{data:{action:'clearCache'}});w.offline();gate.release();
    assert.equal((await reading).status,200);
});
test('N03 two independent readers recover from the same retired pointer without looping',async()=>{
    const w=fixture();await w.event('install');await w.event('activate');
    const reads=[],gates=[];
    for(const asset of ['app.js','style.css']){
        const gate=w.pausePointer();gates.push(gate);reads.push(w.event('fetch',{request:{url:'https://example.test/'+asset+'?v=1.37.0',method:'GET',mode:'cors'}}));await gate.entered;
    }
    await w.event('message',{data:{action:'clearCache'}});w.offline();gates.forEach(gate=>gate.release());
    for(const response of await Promise.all(reads))assert.equal(response.status,200);
});

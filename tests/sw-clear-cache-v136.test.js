const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const makeFixture=require('./sw-fixture-v136');
function fixture(){const w=makeFixture();return {...w,cacheModes:w.metrics.cacheModes,mismatch:()=>w.wrong('index.html',fs.readFileSync(require.resolve('../index.html'),'utf8').replaceAll('?v=1.37.0','?v=1.36.7'))};}
test('R07 clearCache completes a complete shell before offline restart',async()=>{
    const w=fixture();await w.event('install');await w.event('activate');w.cacheModes.length=0;await w.event('message',{data:{action:'clearCache'}});
    // A real browser dispatch is asynchronous; give legacy untracked work time to expose its result.
    await new Promise(r=>setTimeout(r,20));assert.equal(w.notices.at(-1)?.status,'cacheCleared');w.offline();
    assert(w.cacheModes.length>0&&w.cacheModes.every(mode=>mode==='no-store'));
    for(const path of ['/','/app.js?v=1.37.0','/style.css?v=1.37.0','/settings-v136.js?v=1.37.0']){
        const res=await w.event('fetch',{request:{url:'https://example.test'+path,method:'GET',mode:path==='/'?'navigate':'cors'}});
        assert.equal(res.status,200,path+' must remain cached');
    }
});
for(const failure of ['mismatch','quotaFailure'])test('R07 '+failure+' keeps a usable prior shell',async()=>{
    const w=fixture();await w.event('install');await w.event('activate');w[failure]();await w.event('message',{data:{action:'clearCache'}});
    assert.equal(w.notices.at(-1)?.status,'cacheClearFailed');w.offline();
    const res=await w.event('fetch',{request:{url:'https://example.test/',method:'GET',mode:'navigate'}});assert.equal(res.status,200);
});
test('R07 failed replacement retains the existing offline shell and reports failure',async()=>{
    const w=fixture();await w.event('install');await w.event('activate');w.fail('settings-v136.js');await w.event('message',{data:{action:'clearCache'}});
    await new Promise(r=>setTimeout(r,20));assert.equal(w.notices.at(-1)?.status,'cacheClearFailed');w.offline();
    const res=await w.event('fetch',{request:{url:'https://example.test/',method:'GET',mode:'navigate'}});assert.equal(res.status,200);
});

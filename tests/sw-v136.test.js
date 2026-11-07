const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const fixture=require('./sw-fixture-v136');
function worker({failInstall=false}={}){
    const w=fixture();if(failInstall)w.fail('index.html','offline install');
    const seed=Promise.all(['chatai-pwa-cache-v1.35.1','unrelated-cache'].map(name=>w.caches.open(name)));
    return {event:async(...args)=>{await seed;return w.event(...args)},deleted:w.metrics.deleted,metrics:w.metrics};
}
(async()=>{
    const failed=worker({failInstall:true});await assert.rejects(failed.event('install'),/offline install/);assert.equal(failed.metrics.skip,0);
    console.log('PASS incomplete shell install does not promote the new worker');
    const good=worker();await good.event('install');assert.equal(good.metrics.skip,0);await good.event('message',{data:{action:'skipWaiting'}});assert.equal(good.metrics.skip,1);
    for(const name of ['style.css','app.js','settings-v136.js','settings-ui-v136.js','function-calling.js','dropbox.js'])assert(good.metrics.assets.includes('./'+name+'?v=1.36.2'));
    console.log('PASS versioned shell includes matching styles, core and UI');
    await good.event('activate');assert.deepEqual(good.deleted,['chatai-pwa-cache-v1.35.1']);assert.equal(good.metrics.claim,1);
    console.log('PASS activation removes old app caches and preserves unrelated caches');
    const response=await good.event('fetch',{request:{url:'https://example.test/offline-route',method:'GET',mode:'navigate'}});assert.equal(await response.text(),fs.readFileSync(require.resolve('../index.html'),'utf8'));
    console.log('PASS offline navigation falls back to this version of the shell');
    const offline=fixture();await offline.event('install');await offline.event('activate');offline.offline();
    const sanitizer=await offline.event('fetch',{request:{url:'https://example.test/purify.min.js',method:'GET'}});
    assert.equal(await sanitizer.text(),fs.readFileSync(require.resolve('../purify.min.js'),'utf8'));
    console.log('PASS offline sanitizer is served with exact pinned bytes');
    const external=await good.event('fetch',{request:{url:'https://api.example.test/endpoint',method:'POST',mode:'cors'}});assert.equal(external,undefined);
    console.log('PASS external and non-GET requests bypass the shell cache');
    console.log('6 Service Worker tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html'),ids=text=>[...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const original=cp.execFileSync('git',['show','198c8d5b3ff130034edd1250a965febe3d2aa6b9:index.html'],{cwd:root,encoding:'utf8'});
const removed=ids(original).filter(id=>!ids(html).includes(id));
assert.deepEqual(removed.sort(),[
    'api-config-default-model','api-config-id','cancel-api-config-btn','cancel-attach-btn','confirm-attach-btn',
    'file-upload-notice','fileUploadDialog','header-profile-menu','header-profile-menu-settings','hide-system-prompt-toggle','save-api-config-btn',
    'scroll-to-top-btn','sd-prompt-improve-user-models','sd-qc-user-models','select-files-btn','selected-files-list',
    'system-prompt-save-status','theme-settings-profile-scoped-toggle','thinking-budget',
    'back-to-chat-from-history','chat-sidebar-all-history-btn','chat-sidebar-close-btn',
    'history-delete-live','history-delete-select-all-label','history-delete-toolbar',
    'history-detail-assets','history-detail-attachments','history-detail-content','history-detail-created',
    'history-detail-empty','history-detail-first-heading','history-detail-first-message','history-detail-heading',
    'history-detail-latest-heading','history-detail-latest-message','history-detail-latest-role','history-detail-live',
    'history-detail-message-count','history-detail-pane','history-detail-pin-status','history-detail-size',
    'history-detail-stats-heading','history-detail-system-prompt','history-detail-title','history-detail-tokens',
    'history-detail-updated','history-item-template','history-list','history-pin-filter','history-screen',
    'history-search-clear-btn','history-search-input','history-sort-order-toolbar','history-state-action',
    'history-state-description','history-state-panel','history-status','history-title','no-history-message',
    'new-chat-button-color-input','reset-new-chat-button-color-btn'
].sort());
assert.equal(new Set(ids(html)).size,ids(html).length);
console.log('PASS control IDs retained; only explicitly retired controls and optgroups removed');
const settings=html.slice(html.indexOf('id="settings-screen"'),html.indexOf('id="api-config-dialog"'));
assert.equal((settings.match(/<details\b/g)||[]).length,1);assert(settings.includes('<details class="settings-danger-disclosure">'));assert(!settings.includes('Thinking Budget'));assert(!settings.includes('Include Thoughts'));
console.log('PASS settings sections are expanded except the requested danger disclosure; obsolete labels are removed');
const profile=html.slice(html.indexOf('id="settings-panel-profile"'),html.indexOf('id="settings-panel-integrations"'));
assert(profile.includes('id="profile-card-header-wrapper-settings"'));
assert(!html.slice(html.indexOf('id="settings-screen"'),html.indexOf('id="settings-panel-profile"')).includes('id="profile-card-header-wrapper-settings"'));
console.log('PASS settings profile switcher belongs only to the profile category');
assert(read('app.js').includes('const APP_VERSION = "1.37.0";'));assert(read('app.js').includes('const APP_CACHE_VERSION = "v1.37.0";'));
assert(read('app.js').includes('const DB_VERSION = 17;'));
const worker=read('sw.js');
assert(worker.includes("const CACHE_NAME = 'chatai-pwa-cache-v1.37.0';"));
const shell=[...worker.split('const urlsToCache = [')[1].split('];')[0].matchAll(/'([^']+)'/g)].map(m=>m[1]);
assert.equal(shell.length,27);assert.equal(new Set(shell).size,27);
for(const asset of ['app.js','style.css','settings-v136.js','settings-ui-v136.js','streaming-v136.js','dropbox.js','function-calling.js','document-library.js','project-store.js','document-search.js','document-library-ui.js']){
    assert(html.includes(`./${asset}?v=1.37.0`),asset);
    assert(shell.includes(`./${asset}?v=1.37.0`),asset);
}
assert(html.indexOf('./settings-v136.js?v=')<html.indexOf('./streaming-v136.js?v='));
assert(html.indexOf('./streaming-v136.js?v=')<html.indexOf('./app.js?v='));
assert(html.indexOf('./document-library.js?v=')<html.indexOf('./app.js?v='));
assert(html.indexOf('./document-library.js?v=')<html.indexOf('./project-store.js?v='));
assert(html.indexOf('./project-store.js?v=')<html.indexOf('./app.js?v='));
assert(read('CHANGELOG.md').includes('## v1.37.0'));
console.log('PASS HTML, scripts, styles, worker and release notes agree on 1.37.0');
console.log('4 UI/static tests passed');

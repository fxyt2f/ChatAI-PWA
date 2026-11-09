"""F3 against index.html and real IndexedDB, with a gated OpenRouter response."""
import json
import time


def run(client, url):
    def ev(expression):
        result = client.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def check(expression, label):
        if not ev(expression):
            raise AssertionError(label)

    def boot(reload=False):
        previous = ev('performance.timeOrigin') if reload else 0
        client.call('Page.reload' if reload else 'Page.navigate', {} if reload else {'url': url})
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if ev(f'performance.timeOrigin > {previous} && !!window.appLogic?._setupEventListenersCallCount && !!window.settingsUiV136'):
                return
            time.sleep(0.1)
        raise AssertionError('App startup did not finish while the catalog response was held')

    def click(selector):
        check(f'(() => {{ const node = document.querySelector({json.dumps(selector)}); node?.click(); return !!node; }})()',
              f'Control not found: {selector}')

    def reply(failed=False):
        ev(f'answerCatalog({json.dumps(failed)})')
        check("appLogic.getModelThinkingCapability(f3Ref).status === 'failed'" if failed else
              "appLogic.getModelThinkingCapability(f3Ref).mode === 'effort'", 'Catalog response applied')

    def thinking(value):
        check(f"!thinkingLabel().hidden && document.querySelector('#settings-thinking-button').value === {json.dumps(value)}",
              f'Thinking UI automatically shows {value}')

    def pending(chat_id, context):
        check(f'state.currentChatId === {json.dumps(chat_id)} && appLogic.getCurrentChatModelRef().modelName === f3Ref.modelName',
              f'{context}: expected selected chat/model')
        check("catalogRequests.length === 1 && appLogic.getModelThinkingCapability().status === 'pending'",
              f'{context}: startup did not request the selected OpenRouter catalog')
        check("thinkingLabel().hidden && !document.querySelector('#chat-model-button').disabled && !document.querySelector('#user-input').disabled",
              f'{context}: chat stays usable while unconfirmed Thinking is hidden')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    script = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': '''
        window.f3Base = 'https://f3-fixture.invalid/api/v1';
        window.f3Ref = {apiConfigId: 'f3-or', modelName: 'fixture/reasoner'};
        window.catalogRequests = [];
        window.thinkingLabel = () => document.querySelector('#chat-thinking-label');
        const fetchWithoutFixture = window.fetch.bind(window);
        window.fetch = (url, options) => String(url) === f3Base + '/models'
            ? new Promise(resolve => catalogRequests.push(resolve)) : fetchWithoutFixture(url, options);
        async function answerCatalog(failed) {
            const signal = AbortSignal.timeout(3000);
            const received = new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('No capability event after fixture response')), {once: true});
                window.addEventListener('execution-settings-changed', event => {
                    if (event.detail?.type === 'capabilities' && event.detail.apiConfigId === f3Ref.apiConfigId) resolve();
                }, {signal});
            });
            catalogRequests[0](failed ? new Response(null, {status: 503}) : Response.json({data: [
                {id: f3Ref.modelName, reasoning: {supported_efforts: ['low', 'high'], default_effort: 'high'}},
                {id: 'fixture/plain', reasoning: null, supported_parameters: []}
            ]}));
            await received;
        }
    '''})['identifier']
    try:
        boot()
        ev('''(async () => {
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', APP_VERSION);
            await dbUtils.saveSetting('apiConfigs', [
                {id: f3Ref.apiConfigId, name: 'Fixture OR', provider: 'openrouter', baseUrl: f3Base, enabled: true,
                    apiKey: 'fixture', modelCandidates: [f3Ref.modelName, 'fixture/plain'], defaultModel: f3Ref.modelName},
                {id: 'f3-gem', name: 'Fixture Gemini', provider: 'gemini', enabled: true,
                    apiKey: 'fixture', modelCandidates: ['gemini-3-flash-preview'], defaultModel: 'gemini-3-flash-preview'}
            ]);
            await dbUtils.saveSetting(SettingsV136.SUCCESS_KEY, {modelRef: f3Ref, thinkingEffort: null});
            sessionStorage.removeItem(SettingsV136.DRAFT_KEY);
        })()''')
        boot(reload=True)
        pending(None, 'New chat')
        click('#chat-model-button')
        check("!!document.querySelector('.model-picker-search')", 'Pending metadata leaves model switching available')
        reply()
        thinking('high')
        check("!!document.querySelector('.model-picker-search')", 'Catalog completion keeps the open model picker usable')
        click('#chat-model-button')
        click('#chat-model-button')
        click('.thinking-dot[data-level="low"]')
        check("(async () => { await settingsUiV136.saveQueue; return appLogic.readExecutionDraft().thinkingEffort === 'low'; })()",
              'Thinking change is saved in the draft')

        boot(reload=True)
        pending(None, 'Reloaded draft')
        reply()
        thinking('low')
        ev('''(async () => {
            await new Promise((resolve, reject) => {
                const tx = state.db.transaction('chats', 'readwrite');
                for (const [id, modelRef, thinkingEffort] of [[301, f3Ref, 'high'], [302, {...f3Ref, modelName: 'fixture/plain'}, null]]) {
                    tx.objectStore('chats').put({id, title: `F3 chat ${id}`, profileId: state.activeProfileId,
                        messages: [{role: 'user', content: 'F3 fixture'}], createdAt: 1000 - id, updatedAt: 1000 - id,
                        executionSettings: {schemaVersion: 1, modelRef, thinkingEffort, updatedAt: 1}});
                }
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
            });
            sessionStorage.removeItem(SettingsV136.DRAFT_KEY);
        })()''')
        boot(reload=True)
        pending(301, 'Restored chat')
        reply()
        thinking('high')
        click('#chat-model-button')
        click('.thinking-dot[data-level="low"]')
        check("(async () => { await settingsUiV136.saveQueue; return (await dbUtils.getChat(301)).executionSettings.thinkingEffort === 'low'; })()",
              'Thinking change is saved to the restored chat')

        boot(reload=True)
        pending(301, 'Failed request')
        reply(failed=True)
        check("(async () => thinkingLabel().hidden && appLogic.getCurrentChatThinkingEffort() === 'low' && (await dbUtils.getChat(301)).executionSettings.thinkingEffort === 'low')()",
              'Failed metadata stays unconfirmed and preserves the stored level')

        boot(reload=True)
        pending(301, 'Chat switch')
        check('(async () => (await appLogic.loadChat(302)).ok)()', 'Chat switch completes during the pending fetch')
        reply()
        check("state.currentChatId === 302 && catalogRequests.length === 1 && appLogic.getModelThinkingCapability().mode === 'none' && thinkingLabel().hidden",
              'Same catalog is shared and does not expose Thinking for the unsupported current model')

        boot(reload=True)
        pending(301, 'Model switch')
        click('#chat-model-button')
        check("(() => { const choice = [...document.querySelectorAll('.model-picker-choice')].find(node => node.textContent === 'gemini-3-flash-preview'); choice?.click(); return !!choice; })()",
              'Gemini is selectable while the startup fetch is pending')
        ev('settingsUiV136.saveQueue')
        thinking('low')
        click('#chat-model-button')
        click('.thinking-model-switch')
        ev('window.f3Picker = settingsUiV136.popover')
        reply()
        check("(async () => { const saved = (await dbUtils.getChat(301)).executionSettings; return saved.modelRef.apiConfigId === 'f3-gem' && saved.thinkingEffort === 'low' && f3Picker === settingsUiV136.popover; })()",
              'Late OpenRouter result does not disturb the current model, saved level or model picker')
        thinking('low')
        return 'ALL PASSED (F3 real startup, restored chat, reload, failure, and pending model/chat switches with synthetic catalog responses)'
    finally:
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})
        client.call('Network.setBlockedURLs', {'urls': []})

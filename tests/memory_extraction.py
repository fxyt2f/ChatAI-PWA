"""Memory extraction against the real settings page and IndexedDB with mocked providers."""
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
        previous = ev('performance.timeOrigin')
        client.call('Page.reload' if reload else 'Page.navigate', {} if reload else {'url': url + '?memory-test=1#settings/profile'})
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if ev(f"performance.timeOrigin > {previous} && !!window.appLogic?._setupEventListenersCallCount && window.settingsUiV136?.category === 'profile'"):
                return
            time.sleep(0.1)
        raise AssertionError('Real settings page did not boot')

    def save_control(id, value, event='change'):
        ev(f'''(async () => {{
            const control = document.getElementById({json.dumps(id)});
            control.value = {json.dumps(value)};
            control.dispatchEvent(new Event({json.dumps(event)}, {{bubbles: true}}));
            await settingsUiV136.saveQueue;
        }})()''')

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    try:
        boot()
        check("(async () => (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.memoryModelRef === null && document.querySelector('#memory-extraction-model').value === '' && document.querySelector('#memory-extraction-prompt').value === SettingsV136.DEFAULT_MEMORY_EXTRACTION_PROMPT)()",
              'Fresh install starts unset with the existing extraction instructions')
        check("Object.entries(SettingsV136.auxiliaryModelSelectIds).every(([key,id]) => { const select = document.getElementById(id); return select.value === '' && select.options[0].value === '' && select.options[0].text === '選択してください' && appLogic.getGlobalAuxiliaryModelRefV136(key) === null; })",
              'All seven auxiliary selectors have the same unset option on a fresh install')
        ev('''(async () => {
            await appLogic.updateLocalUiSetting('lastSeenReleaseVersion', APP_VERSION);
            await appLogic.saveApiConfigs([
                {id: 'mem-gem', name: 'Memory Gemini', provider: 'gemini', apiKey: 'gem-fixture', modelCandidates: ['gemini-2.5-flash']},
                {id: 'mem-alt', name: 'Second Gemini', provider: 'gemini', apiKey: 'alt-fixture', modelCandidates: ['gemini-2.5-flash']},
                {id: 'mem-or', name: 'Memory OpenRouter', provider: 'openrouter', apiKey: 'or-fixture', modelCandidates: ['fixture/reasoner']},
                {id: 'mem-zai', name: 'Memory Z.ai', provider: 'zai', apiKey: 'zai-fixture', modelCandidates: ['glm-4.6']},
                {id: 'mem-aws', name: 'Memory Bedrock', provider: 'bedrock', bedrockAccessKey: 'aws-fixture', bedrockSecretKey: 'secret-fixture', modelCandidates: ['us.anthropic.claude-opus-4-6-v1']},
                {id: 'mem-no-key', name: 'Without credentials', provider: 'openrouter', modelCandidates: ['fixture/no-key']},
                {id: 'mem-off', name: 'Disabled route', provider: 'openrouter', apiKey: 'off-fixture', enabled: false, modelCandidates: ['fixture/off']}
            ]);
        })()''')
        check("(() => { const options = [...document.querySelector('#memory-extraction-model').options]; return options.length === 7 && options.some(o => o.text === 'Second Gemini / gemini-2.5-flash') && options.some(o => o.text === 'Memory Gemini / gemini-2.5-flash') && !options.some(o => o.text.includes('Disabled route')); })()",
              'Registered enabled routes list API setting names and distinguish identical model names')
        ev('''(async () => {
            const ref = {apiConfigId: 'mem-alt', modelName: 'gemini-2.5-flash'};
            for (const [key, id] of Object.entries(SettingsV136.auxiliaryModelSelectIds)) {
                const select = document.getElementById(id);
                for (const expected of [ref, null]) {
                    select.value = expected ? appLogic.encodeModelRefValue(expected) : '';
                    select.dispatchEvent(new Event('change', {bubbles: true}));
                    await settingsUiV136.saveQueue;
                    const saved = (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value[key];
                    if (JSON.stringify(saved) !== JSON.stringify(expected)) throw new Error(`Selection did not persist: ${key}`);
                }
            }
        })()''')
        boot(reload=True)
        check("Object.values(SettingsV136.auxiliaryModelSelectIds).every(id => document.getElementById(id).value === '') && !!appLogic.getCurrentChatModelRef()",
              'All unset selections survive reload without clearing the normal chat model')
        check('''(async () => {
            const app = appLogic, ui = uiUtilsV136;
            const alert = ui.showCustomAlert, generate = app.callStableDiffusionApi, save = app.saveImageBlob;
            let notice = '', images = 0;
            ui.showCustomAlert = async message => { notice = message; };
            app.callStableDiffusionApi = async () => { images++; return new Blob(['fixture']); };
            app.saveImageBlob = async () => 'fixture-image';
            try {
                const history = JSON.stringify(state.currentMessages);
                await app.startSummaryProcess();
                if (!notice.includes('要約用モデルを選択') || JSON.stringify(state.currentMessages) !== history) return false;
                await app.saveGlobalSettingsV136({sdApiUrl: 'https://fixture.invalid', sdEnableQualityChecker: true, sdQcRetries: 2});
                const result = await app.handleStableDiffusionGeneration({prompt: 'original'});
                return result.success && images === 1 && result.meta.qualityCheckResult === null;
            } finally { ui.showCustomAlert = alert; app.callStableDiffusionApi = generate; app.saveImageBlob = save; }
        })()''', 'Unset manual summary is explained and unset automatic QC leaves image generation available')
        for config, model in [('mem-gem', 'gemini-2.5-flash'), ('mem-or', 'fixture/reasoner'),
                              ('mem-zai', 'glm-4.6'), ('mem-aws', 'us.anthropic.claude-opus-4-6-v1')]:
            ref = json.dumps({'apiConfigId': config, 'modelName': model})
            save_control('memory-extraction-model', ev(f'appLogic.encodeModelRefValue({ref})'))
            check(f"(async () => JSON.stringify((await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.memoryModelRef) === JSON.stringify({ref}))()",
                  f'{config} selection persisted by config ID and model')
        save_control('memory-extraction-prompt', '独自の抽出指示\n好みを抽出してください。', 'input')
        boot(reload=True)
        check("document.querySelector('#memory-extraction-model').value.startsWith('mem-aws|||') && document.querySelector('#memory-extraction-prompt').value === '独自の抽出指示\\n好みを抽出してください。'",
              'Selected model and multiline prompt survive a page reload')

        ev('''(async () => {
            const app = appLogic, db = dbUtils, st = state;
            const assert = (condition, label) => { if (!condition) throw new Error(label); };
            const first = st.activeProfileId;
            const second = await db.addProfile({name: 'Memory fixture B', settings: {enableMemory: false, memoryAutoSaveInterval: 20}});
            await app.loadProfiles();
            await db.saveMemory(first, {items: ['既存A'], fixtureMetadata: 'keep'});
            await db.saveMemory(second, {items: ['既存B']});
            const input = document.querySelector('#enable-memory-toggle');
            const interval = document.querySelector('#memory-auto-save-interval');
            assert(!input.checked && interval.getClientRects().length && document.querySelector('#manage-memory-btn').getClientRects().length, 'Memory controls visible while OFF');
            await app.openMemoryManagementDialog();
            const dialog = document.querySelector('#close-memory-dialog-btn').closest('dialog');
            assert(dialog.open && dialog.textContent.includes('既存A'), 'OFF profile can open and view its memory');
            dialog.close();
            interval.value = '10'; interval.dispatchEvent(new Event('change', {bubbles: true}));
            const deadline = Date.now() + 3000;
            while (st.settings.memoryAutoSaveInterval !== 10) {
                if (Date.now() > deadline) throw new Error('Profile memory controls did not persist');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert(!st.settings.enableMemory && (await db.getProfile(first)).settings.memoryAutoSaveInterval === 10, 'Interval saved while memory remains OFF');
            input.checked = true; input.dispatchEvent(new Event('change', {bubbles: true}));
            while (!st.settings.enableMemory) {
                if (Date.now() > deadline) throw new Error('Memory enable did not persist');
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            const requests = [];
            let output = '[追加情報なし]', status = 200;
            const nativeFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (options?.method !== 'POST') return nativeFetch(url, options);
                const body = JSON.parse(options.body), headers = new Headers(options.headers);
                requests.push({url: String(url), headers, body});
                const text = await (typeof output === 'function' ? output() : output);
                return Response.json(body.contents ? {candidates: [{content: {parts: [{text}]}}]} : {choices: [{message: {content: text}}]}, {status});
            };
            window.BedrockRuntimeClient = class { async send(command) {
                requests.push({bedrock: command.body});
                return {output: {message: {content: [{text: output}]}}};
            }};
            window.ConverseCommand = class { constructor(body) { this.body = body; }};
            const setModel = (apiConfigId, modelName) => app.saveGlobalSettingsV136({memoryModelRef: {apiConfigId, modelName}});
            const messages = [{role: 'user', content: '抽出範囲外'}, ...Array.from({length: 10}, (_, i) => ({role: 'user', content: `発言${i}`})),
                {role: 'model', content: '中断された応答', incomplete: true}];
            st.currentMessages = messages;

            await app.triggerAutoMemorySave();
            assert(requests.at(-1).bedrock.modelId === 'us.anthropic.claude-opus-4-6-v1', 'Bedrock receives selected model');
            await setModel('mem-zai', 'glm-4.6'); await app.triggerAutoMemorySave();
            assert(requests.at(-1).body.model === 'glm-4.6' && requests.at(-1).headers.get('authorization') === 'Bearer zai-fixture', 'Z.ai receives selected model and credentials');
            await setModel('mem-or', 'fixture/reasoner'); await app.triggerAutoMemorySave();
            const body = requests.at(-1).body;
            const text = body.messages[0].content[0].text;
            assert(body.model === 'fixture/reasoner' && requests.at(-1).headers.get('authorization') === 'Bearer or-fixture', 'OpenRouter receives selected route');
            assert(text.startsWith('独自の抽出指示\\n好みを抽出してください。') && text.includes('【既存の記憶】\\n- 既存A') && text.includes('【会話履歴】\\nユーザー: 発言0')
                && text.indexOf('【既存の記憶】') < text.indexOf('【会話履歴】') && text.indexOf('【会話履歴】') < text.indexOf('**出力形式の厳守**')
                && text.endsWith('[抽出結果]') && text.includes('[追加情報なし]') && !text.includes('抽出範囲外') && !text.includes('中断された応答'),
                'Custom instructions, fixed boundaries, old memory and interval-limited conversation reach the provider');
            await setModel('mem-alt', 'gemini-2.5-flash'); await app.triggerAutoMemorySave();
            assert(requests.at(-1).url.includes('gemini-2.5-flash:') && requests.at(-1).headers.get('x-goog-api-key') === 'alt-fixture', 'Gemini uses the selected config with the same model name');

            const unchanged = async () => assert(JSON.stringify((await db.getMemory(first)).items) === '["既存A"]', 'No writes for skipped/failed extraction');
            output = '  '; await app.triggerAutoMemorySave(); await unchanged();
            status = 503; output = '- 保存してはいけない'; await app.triggerAutoMemorySave(); await unchanged(); status = 200;
            const count = requests.length;
            for (const [id, model] of [['missing', 'fixture/missing'], ['mem-or', 'fixture/deleted'], ['mem-off', 'fixture/off'], ['mem-no-key', 'fixture/no-key']]) {
                await setModel(id, model);
                assert(document.querySelector('#memory-extraction-model').selectedOptions[0].disabled === (id !== 'mem-no-key'), 'Invalid saved choice is unavailable');
                await app.triggerAutoMemorySave(); await unchanged();
            }
            assert(requests.length === count, 'Invalid refs and missing credentials never call a provider or fall back');

            await setModel('mem-or', 'fixture/reasoner');
            let reply, requestStarted;
            const started = new Promise(resolve => requestStarted = resolve);
            output = () => new Promise(resolve => { reply = resolve; requestStarted(); });
            const pending = app.triggerAutoMemorySave();
            await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('Memory request did not start')), 3000))]);
            await app.switchProfile(second);
            assert(!st.settings.enableMemory && st.settings.memoryAutoSaveInterval === 20, 'Second profile retains its own settings');
            await app.triggerAutoMemorySave();
            assert(requests.length === count + 1, 'Disabled profile does not extract');
            await db.saveMemory(first, {items: ['既存A', '別操作で追加'], fixtureMetadata: 'keep'});
            reply('- 既存A\\n* 追加A\\n- 追加A\\n- [追加情報なし]');
            await pending;
            const firstMemory = await db.getMemory(first);
            assert(JSON.stringify(firstMemory.items) === '["既存A","別操作で追加","追加A"]' && firstMemory.fixtureMetadata === 'keep', 'Append preserves latest original-profile memory and deduplicates');
            assert(JSON.stringify((await db.getMemory(second)).items) === '["既存B"]', 'Switched profile memory is untouched');
            await app.switchProfile(first);
            assert(st.settings.enableMemory && st.settings.memoryAutoSaveInterval === 10, 'First profile retains its settings');
            document.querySelector('#reset-memory-extraction-prompt').click();
            await settingsUiV136.saveQueue;
            assert((await db.getSetting(SettingsV136.GLOBAL_KEY)).value.memoryExtractionPrompt === SettingsV136.DEFAULT_MEMORY_EXTRACTION_PROMPT, 'Reset saves the original instructions');
            assert(JSON.stringify((await db.getMemory(first)).items) === JSON.stringify(firstMemory.items), 'Editing and resetting the prompt preserve memory');
        })()''')

        save_control('memory-extraction-model', '')
        boot(reload=True)
        check("(async () => (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value.memoryModelRef === null && document.querySelector('#memory-extraction-model').value === '' && document.querySelector('#memory-extraction-prompt').value === SettingsV136.DEFAULT_MEMORY_EXTRACTION_PROMPT)()",
              'Explicit unset and the reset prompt survive reload')
        check('''(async () => {
            const nativeFetch = window.fetch, calls = [];
            state.currentMessages = [{role: 'user', content: 'test'}];
            window.fetch = async (url, options) => {
                if (options?.method !== 'POST') return nativeFetch(url, options);
                calls.push({url: String(url), key: new Headers(options.headers).get('x-goog-api-key')});
                return Response.json({candidates: [{content: {parts: [{text: '[追加情報なし]'}]}}]});
            };
            try {
                await appLogic.triggerAutoMemorySave();
                if (calls.length) return false;
                const settings = (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value;
                delete settings.memoryModelRef;
                settings.sdQcModelRef = null;
                settings.sdQcModel = 'gemini-2.5-flash';
                await dbUtils.saveSetting(SettingsV136.GLOBAL_KEY, settings);
                await appLogic.reloadGlobalSettingsV136();
                await appLogic.triggerAutoMemorySave();
                if (appLogic.getGlobalAuxiliaryModelRefV136('sdQcModelRef')?.apiConfigId !== 'mem-gem') return false;
                await appLogic.saveGlobalSettingsV136({sdQcModelRef: null});
                const saved = (await dbUtils.getSetting(SettingsV136.GLOBAL_KEY)).value;
                return calls.length === 0 && document.querySelector('#memory-extraction-model').value === ''
                    && saved.sdQcModelRef === null && saved.sdQcModel === '' && document.querySelector('#sd-qc-model').value === '';
            } finally { window.fetch = nativeFetch; }
        })()''', 'Absent memory skips, exact legacy SD names survive old null refs, and clearing persists an unset state')
        return 'ALL PASSED (seven auxiliary selectors and reload, OFF memory controls, four mocked memory providers, unset/legacy compatibility and profile-safe append)'
    finally:
        client.call('Network.setBlockedURLs', {'urls': []})

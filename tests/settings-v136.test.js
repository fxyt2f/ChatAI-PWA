const assert = require('node:assert/strict');
const S = require('../settings-v136.js');
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };
test('profile allowlist excludes global, local and execution settings', () => {
    const result = S.profileSettings({ systemPrompt: 'p', temperature: 0.4, defaultModelRef: { apiConfigId: 'secret' },
        modelName: 'm', apiKey: 'secret', sdApiPassword: 'secret', enableProofreading: true, summarySystemPrompt: 'global',
        includeThoughts: true, chatFontSize: 24, unknown: 'ignored', theme: { darkMode: true, apiKey: 'secret' } });
    assert.deepEqual(result, { systemPrompt: 'p', temperature: 0.4, useCustomTheme: false, useCustomAppearance: false, theme: { darkMode: true } });
});
test('legacy theme conversion and idempotency', () => {
    const result = S.profileSettings({ darkMode: true, accentColor: '#fff',
        newChatButtonColor: '#112233', otherButtonColor: '#778899' }, true);
    assert.equal(result.useCustomTheme, true);
    assert.deepEqual(result.theme, { darkMode: true, accentColor: '#fff', otherButtonColor: '#778899' });
    assert.deepEqual(S.profileSettings(result), result);
    assert.deepEqual(S.profileSettings({ useCustomTheme: true,
        theme: { newChatButtonColor: '#112233', otherButtonColor: '#778899' } }).theme, { otherButtonColor: '#778899' });
});
const fourLevels = ['minimal','low','medium','high'];
for (const [id, levels, defaultEffort] of [
    ['gemini-3-pro-preview', ['low','high'], 'high'],
    ['gemini-3-flash-preview', fourLevels, 'high'],
    ['gemini-3.1-pro-preview', ['low','medium','high'], 'high'],
    ['gemini-3.1-pro-preview-customtools', ['low','medium','high'], 'high'],
    ['gemini-3.1-flash-lite-preview', fourLevels, 'minimal'],
    ['gemini-3.1-flash-lite', fourLevels, 'minimal'],
    ['gemini-3.5-flash-lite', fourLevels, 'minimal'],
    ['gemini-3.5-flash', fourLevels, 'medium'],
    ['gemini-3.6-flash', fourLevels, 'medium'],
    ['gemini-3.7-flash', ['low','medium','high'], 'medium'],
    ['gemini-3.8-flash', ['low','medium','high'], 'medium'],
    ['gemini-3.1-flash-image', ['minimal','high'], 'minimal'],
    ['gemini-3.1-flash-lite-image', ['minimal','high'], 'minimal'],
    ['gemini-3-pro-image', ['high'], 'high']
]) {
    test(id + ' has verified levels/default and sends only supported values', () => {
        const c = S.capability('gemini', id);
        assert.equal(c.mode, 'level'); assert.deepEqual(c.levels, levels); assert.equal(c.defaultEffort, defaultEffort);
        assert.equal(c.initialEffort, defaultEffort);
        assert.deepEqual(S.capability('gemini', 'models/' + id), c);
        const fallback = S.capability('openrouter', 'google/' + id);
        assert.deepEqual(fallback.levels, levels); assert.equal(fallback.defaultEffort, defaultEffort);
        for (const effort of [...levels, 'unsupported']) {
            assert.deepEqual(S.applyThinking({thinkingConfig:{thinkingBudget:8000}}, 'gemini', c, effort),
                {thinkingConfig:{thinkingLevel:levels.includes(effort) ? effort : defaultEffort,includeThoughts:true}});
        }
        for (const effort of [null, S.MODEL_DEFAULT_EFFORT]) {
            assert.deepEqual(S.applyThinking({}, 'gemini', c, effort), {thinkingConfig:{includeThoughts:true}});
        }
    });
}
test('substring lookalikes are unknown', () => {
    for (const p of ['gemini','openrouter','zai','bedrock']) assert.equal(S.capability(p, 'fake-gemini-3-pro-preview-claude-sonnet-4-6-glm-4.6').mode, 'unknown');
    for (const id of ['fake-gemini-3.8-flash','gemini-3.8-flash-tts','gemini-3.8-flash/foreign','constructor','__proto__']) {
        assert.equal(S.capability('gemini', id).mode, 'unknown');
        assert.equal(S.capability('openrouter', 'google/' + id).mode, 'unknown');
    }
});
test('Gemini families use candidate levels and display documented defaults without forcing them', () => {
    for (const [id, initial] of [['gemini-4-hydrogen', 'high'], ['models/gemini-12.1-nova-preview-11-2027', S.MODEL_DEFAULT_EFFORT]]) {
        const c = S.capability('gemini', id);
        assert.equal(c.source, 'inferred');
        assert.deepEqual(c.levels, ['low', 'medium', 'high', 'xhigh']);
        assert.equal(c.initialEffort, initial);
        assert.deepEqual(c.acceptedLevels, []);
        assert.deepEqual(S.applyThinking({}, 'gemini', c, null), {});
        for (const level of c.levels)
            assert.deepEqual(S.applyThinking({}, 'gemini', c, level).thinkingConfig,
                { thinkingLevel: level.toUpperCase(), includeThoughts: true });
        assert.equal(S.capability('openrouter', 'google/' + id).mode, 'unknown');
    }
    assert.deepEqual(S.capability('gemini','gemini-3.8-flash-preview').levels, ['low','medium','high']);
    for (const id of ['gemini-4-carbon', 'gemini-4-argon']) {
        const c = S.capability('gemini', id);
        assert.deepEqual(c.levels, ['low','medium','high']);
        assert.equal(c.initialEffort, 'medium');
    }
    assert.equal(S.capability('gemini', 'gemini-robotics-er-2-preview').initialEffort, 'high');
    assert.equal(S.capability('gemini', 'gemini-latest', {baseModelId:'models/gemini-4-hydrogen'}).initialEffort, 'high');
    assert.equal(S.capability('gemini', 'gemini-4-hydrogen', {rejectedLevels:['high']}).initialEffort, S.MODEL_DEFAULT_EFFORT);
});
test('Gemini Models metadata wins and cannot invent levels', () => {
    for (const metadata of [{ thinking:false }, { supportedGenerationMethods:['embedContent'] }]) {
        const c = S.capability('gemini','gemini-3.8-flash',metadata);
        assert.equal(c.mode,'none');
        assert.deepEqual(S.applyThinking({},'gemini',c,'low'),{});
    }
    const alias = S.capability('gemini','gemini-alias', { thinking:true, baseModelId:'gemini-4-new',
        supportedThinkingLevels:['minimal'], defaultThinkingLevel:'low' });
    assert.deepEqual(alias.levels,['low','medium','high','xhigh']);
    assert.equal(alias.initialEffort, S.MODEL_DEFAULT_EFFORT);
    assert.deepEqual(S.applyThinking({},'gemini',alias,S.MODEL_DEFAULT_EFFORT),{thinkingConfig:{includeThoughts:true}});
    const legacy = S.capability('gemini','gemini-2.5-future', { thinking:true });
    assert.equal(legacy.mode,'legacy-default');
});
test('Gemini records only explicit Thinking rejections', () => {
    const rejected = (message,status=400,level='XHIGH') => S.geminiThinkingRejection({message,status},level);
    assert.equal(rejected('Thinking level XHIGH is not supported for this model.'),'level');
    assert.equal(rejected("Invalid value at 'generation_config.thinking_config.thinking_level' (type: enum), XHIGH"),'level');
    assert.equal(rejected('This model does not support thinking.'),'config');
    assert.equal(rejected('ThinkingConfig is not supported for this model.'),'config');
    assert.equal(rejected('Thinking level is not supported with this tool.'),null);
    assert.equal(rejected('Thinking level XHIGH is not supported.',503),null);
    assert.equal(rejected('Invalid max_output_tokens.'),null);
});
test('Gemini 3.8 unsupported minimal normalizes to medium', () => {
    const c = S.capability('gemini', 'gemini-3.8-flash');
    assert.equal(S.normalizeEffort('minimal', c), 'medium');
    assert.deepEqual(S.applyThinking({}, 'gemini', c, 'minimal'), {thinkingConfig:{thinkingLevel:'medium',includeThoughts:true}});
});
test('Gemini 2.5 never receives budget or level', () => {
    const body = S.applyThinking({ thinkingConfig: { thinkingBudget: 8000, thinkingLevel: 'high' } }, 'gemini', S.capability('gemini','gemini-2.5-pro'), 'high');
    assert.deepEqual(body, { thinkingConfig: { includeThoughts: true } });
});
test('Gemini 3 request uses selected level', () => {
    assert.deepEqual(S.applyThinking({}, 'gemini', S.capability('gemini','gemini-3-flash-preview'), 'medium'),
        { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } });
});
test('unknown Gemini sends no thinkingConfig', () => assert.deepEqual(S.applyThinking({ thinkingConfig: { thinkingBudget: 1 } },'gemini', S.capability('gemini','unknown'), 'high'), {}));
test('OpenRouter metadata takes precedence and excludes off', () => {
    const c = S.capability('openrouter','new/model', { reasoning: { supported_efforts: ['none','low','high'], default_effort:'none' } });
    assert.deepEqual(c.levels, ['low','high']);
    assert.equal(c.defaultEffort, 'low');
    assert.deepEqual(S.applyThinking({},'openrouter',c,'high'), { reasoning: { effort:'high',exclude:false } });
});
test('OpenRouter unknown metadata does not invent effort support', () => assert.equal(S.capability('openrouter','new/model',{}).mode, 'none'));
test('effort normalizes when model changes; unsupported is null', () => {
    assert.equal(S.normalizeEffort('medium', S.capability('gemini','gemini-3-pro-preview')), 'high');
    assert.equal(S.normalizeEffort('high', S.capability('gemini','unknown')), null);
});
test('Z.ai hybrid GLM enables thinking without invented effort', () => assert.deepEqual(S.applyThinking({}, 'zai', S.capability('zai','glm-4.6'), 'high'), { thinking:{type:'enabled'} }));
test('Z.ai effort only on verified newer models', () => assert.deepEqual(S.applyThinking({}, 'zai', S.capability('zai','glm-5.2'), 'high'), { thinking:{type:'enabled'},reasoning_effort:'high' }));
test('Bedrock adaptive uses output_config; incompatible sampling removed', () => {
    const body = S.applyThinking({ inferenceConfig:{temperature:0.7,topP:0.9} },'bedrock',S.capability('bedrock','us.anthropic.claude-opus-4-6-v1'),'max');
    assert.deepEqual(body, { inferenceConfig:{},additionalModelRequestFields:{thinking:{type:'adaptive'},output_config:{effort:'max'}} });
});
test('Bedrock budget is separate from effort', () => {
    const body = S.applyThinking({ inferenceConfig:{maxTokens:4000} },'bedrock',S.capability('bedrock','jp.anthropic.claude-sonnet-4-5-20250929-v1:0'),'high');
    assert.deepEqual(body.additionalModelRequestFields, {thinking:{type:'enabled',budget_tokens:1024}});
    assert.equal(body.additionalModelRequestFields.output_config, undefined);
});
test('Bedrock rejects invalid token limit and forced tool choice', () => {
    const c=S.capability('bedrock','anthropic.claude-sonnet-4-5-20250929-v1:0');
    assert.throws(()=>S.applyThinking({ inferenceConfig:{maxTokens:1000} },'bedrock',c,null));
    assert.throws(()=>S.applyThinking({ inferenceConfig:{},toolConfig:{toolChoice:{any:{}}} },'bedrock',c,null));
});
test('future sync versions rejected; legacy v2 accepted', () => {
    S.assertCompatible({version:'2.0',data:{}});
    S.assertCompatible({version:'2.0',minimumReaderVersion:137,data:{documentLibrary:{schemaVersion:1}}});
    S.assertCompatible({version:'2.0',minimumReaderVersion:137,backupSchemaVersion:1,data:{documentLibrary:{schemaVersion:1}}});
    S.assertCompatible({version:'2.0',minimumReaderVersion:138,data:{projectData:{schemaVersion:1},documentLibrary:{schemaVersion:1}}});
    for(const value of [{settingsSchemaVersion:137},{minimumReaderVersion:138},{minimumReaderVersion:139},
        {minimumReaderVersion:137,data:{projectData:{schemaVersion:1}}},
        {minimumReaderVersion:138,data:{projectData:{schemaVersion:2}}},
        {minimumReaderVersion:136,data:{documentLibrary:{schemaVersion:1}}},
        {minimumReaderVersion:137,data:{documentLibrary:{schemaVersion:2}}},
        {minimumReaderVersion:137,backupSchemaVersion:2},
        {data:{profiles:[{profileSchemaVersion:2}]}},{data:{chats:[{executionSettings:{schemaVersion:2}}]}},{data:{settings:[{key:'globalSettingsV136',value:{schemaVersion:2}}]}}])
        assert.throws(()=>S.assertCompatible({version:'2.0',data:{},...value}));
});
test('released v1.37.0 reader rejects project envelopes even when projects are empty', () => {
    const { execFileSync } = require('node:child_process');
    const { runInNewContext } = require('node:vm');
    const source = execFileSync('git', ['show', 'e7f5dfb4b8bd24b1b61db081b935ced6d8a971df:settings-v136.js'], {
        cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8'
    });
    const old = {};
    runInNewContext(source, { window: old });
    assert.equal(old.SettingsV136.READER_VERSION, 137);
    for (const projects of [[], [{ id: 'project' }]]) {
        const envelope = { version: '2.0', minimumReaderVersion: 138,
            data: { projectData: { schemaVersion: 1, projects, chats: [], documents: [] } } };
        S.assertCompatible(envelope);
        assert.throws(() => old.SettingsV136.assertCompatible(envelope), /復元・上書きできません/);
    }
});
console.log(`${count} tests passed`);

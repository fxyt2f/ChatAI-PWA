const test = require('node:test');
const assert = require('node:assert/strict');
const { canStream, collectResponse, readSse, reasoningText } = require('../streaming-v136.js');

const encode = new TextEncoder();
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
const done = 'data: [DONE]\r\n\r\n';
const gemini = (parts, extra = {}) => ({ candidates: [{ index: 0, content: { role: 'model', parts }, ...extra }] });
const router = (delta, finish_reason = null, index = 0) => ({ choices: [{ index, delta, finish_reason }] });

function byteStream(text) {
    const bytes = encode.encode(text);
    let offset = 0;
    return new ReadableStream({
        pull(controller) {
            if (offset === bytes.length) controller.close();
            else controller.enqueue(bytes.subarray(offset, ++offset));
        }
    });
}

test('SSE framing accepts split UTF-8, CRLF/LF/CR, multiline data and comments', async () => {
    const chunks = [];
    const ended = await readSse(byteStream('\uFEFF: wait\r\n\r\nevent: message\rdata: {"text":\ndata: "日本😀"}\r\n\r\ndata: [DONE]\n\n'),
        undefined, (data, eventType) => {
            if (data === '[DONE]') return true;
            chunks.push({ data: JSON.parse(data), eventType });
            return false;
        });
    assert.equal(ended, true);
    assert.deepEqual(chunks, [{ data: { text: '日本😀' }, eventType: 'message' }]);
});

test('Gemini leaves every signed part in its original order and collects terminal metadata', async () => {
    const parts = [
        { text: '思考', thought: true },
        { text: 'こんにちは', thoughtSignature: 'opaque-text' },
        { functionCall: { name: 'lookup', args: { query: '東京' }, id: 'gem-call' }, thoughtSignature: 'opaque-call' },
        { functionCall: { name: 'other', args: {} } },
        { text: '。' }
    ];
    const safetyRatings = [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'LOW' }];
    const input = parts.map(part => event(gemini([part]))).join('')
        + event({ ...gemini([], { finishReason: 'STOP', safetyRatings }), usageMetadata: { promptTokenCount: 6 }, modelVersion: 'gemini-3' })
        + event({ usageMetadata: { candidatesTokenCount: 12 } });
    const updates = [];
    const result = await collectResponse('gemini', byteStream(input), undefined, data => updates.push(data));
    assert.deepEqual(result.candidates, gemini(parts, { finishReason: 'STOP', safetyRatings }).candidates);
    assert.deepEqual(result.usageMetadata, { promptTokenCount: 6, candidatesTokenCount: 12 });
    assert.equal(result.modelVersion, 'gemini-3');
    assert.deepEqual(updates.at(-1), { content: 'こんにちは。', thoughtSummary: '思考' });
});

test('OpenRouter assembles multiple interleaved tool calls and preserves Gemini reasoning blocks', async () => {
    const opaque = { type: 'reasoning.encrypted', format: 'google-gemini-v1', data: 'opaque/A=', id: 'tool-a', index: 1 };
    const opaqueSecond = { ...opaque, data: 'opaque/B=', id: 'tool-b' };
    const thinking = { type: 'reasoning.text', format: 'google-gemini-v1', text: '考え', index: 0 };
    const usage = { prompt_tokens: 14, completion_tokens: 8, total_tokens: 22 };
    const updates = [];
    const stream = event({ ...router({ reasoning: '考え', reasoning_details: [thinking] }), model: 'google/gemini-3' })
        + event(router({ reasoning: 'ます', reasoning_details: [{ ...thinking, text: 'ます' }, opaque],
            tool_calls: [{ index: 1, id: 'tool-b', type: 'function', function: { name: 'second', arguments: '{"num":' } }] }))
        + event(router({ reasoning_details: [opaqueSecond],
            tool_calls: [{ index: 0, id: 'tool-a', type: 'function', function: { name: 'first', arguments: '{"text":"' } },
                { index: 1, function: { arguments: '2}' } }] }))
        + event(router({ tool_calls: [{ index: 0, function: { arguments: '京都"}' } }] }, 'tool_calls'))
        + event({ ...router({}, 'tool_calls'), usage }) + done;
    const response = await collectResponse('openrouter', byteStream(stream), undefined, data => updates.push(data));
    const { message, finish_reason } = response.choices[0];
    assert.equal(finish_reason, 'tool_calls');
    assert.equal(message.reasoning, '考えます');
    assert.deepEqual(message.reasoning_details, [{ ...thinking, text: '考えます' }, opaque, opaqueSecond]);
    assert.deepEqual(message.tool_calls.map(call => [call.id, call.function.name, JSON.parse(call.function.arguments)]),
        [['tool-a', 'first', { text: '京都' }], ['tool-b', 'second', { num: 2 }]]);
    assert.deepEqual(response.usage, usage);
    assert.equal(updates.at(-1).getThoughtSummary(), '考えます');
});

test('F7 repeated typed metadata and equal string fragments are handled separately', async () => {
    const stream = event(router({tool_calls:[
        {index:0,id:'repeat',type:'function',function:{name:'get',arguments:'{"v":"x'}},
        {index:1,id:'call_',type:'function',function:{name:'go',arguments:'{"v":"y'}}
    ]})) + event(router({tool_calls:[
        {index:0,id:'repeat',type:'function',function:{name:'get',arguments:'x"}'}},
        {index:1,id:'call_',function:{name:'go',arguments:'y"}'}}
    ]},'tool_calls')) + done;
    const result=await collectResponse('openrouter',byteStream(stream),undefined,()=>{});
    assert.deepEqual(result.choices[0].message.tool_calls.map(tool=>[tool.id,tool.function.name,JSON.parse(tool.function.arguments)]),
        [['repeat','getget',{v:'xx'}],['call_call_','gogo',{v:'yy'}]]);
    for (const reason of ['tool_calls','function_call']) {
        await assert.rejects(collectResponse('openrouter',byteStream(event(router({},reason))+done),undefined,()=>{}),/未完了/);
    }
    const conflicting=event(router({tool_calls:[{index:0,id:'first',type:'function'}]}))
        +event(router({tool_calls:[{index:0,id:'second',type:'function'}]},'tool_calls'))+done;
    await assert.rejects(collectResponse('openrouter',byteStream(conflicting),undefined,()=>{}),/異なるツール呼び出しID/);
});

test('F8 mixed public reasoning is shared by previews and final rendering without exposing opaque blocks', async () => {
    const opaque={type:'reasoning.encrypted',data:'cipher',text:'opaque string',index:4};
    const signature={type:'reasoning.signature',signature:'signature',text:'opaque signature',index:5};
    const snapshots=[];
    const deltas=[
        {reasoning:'first'},
        {reasoning_content:'second'},
        {reasoning_details:[{type:'reasoning.text',index:0,text:'first'},opaque]},
        {reasoning_details:[{type:'reasoning.summary',index:1,summary:'third'},signature]}
    ];
    const text=deltas.map(delta=>event(router(delta))).join('')+event(router({content:'answer'},'stop'))+done;
    const result=await collectResponse('openrouter',byteStream(text),undefined,p=>snapshots.push(p.getThoughtSummary()));
    assert.deepEqual(snapshots,['first','first\n\nsecond','first\n\nsecond','first\n\nsecond\n\nthird','first\n\nsecond\n\nthird']);
    assert.equal(reasoningText(result.choices[0].message),snapshots.at(-1));
    assert.deepEqual(result.choices[0].message.reasoning_details.filter(d=>d.type==='reasoning.encrypted'||d.type==='reasoning.signature'),[opaque,signature]);
});

test('F9 oversized lines, multiline events and total wire input cancel their readers', async () => {
    for (const chunks of [
        [encode.encode('data: '+'x'.repeat(2*1024*1024))],
        Array(3).fill(encode.encode('data: '+'x'.repeat(800*1024)+'\n')),
        Array(33).fill(encode.encode(':'+ 'x'.repeat(1024*1024-2)+'\n'))
    ]) {
        let index=0, cancelled=false;
        const source=new ReadableStream({
            pull(c) { if (index===chunks.length) c.close(); else c.enqueue(chunks[index++]); },
            cancel() { cancelled=true; }
        }, { highWaterMark:0 });
        await assert.rejects(readSse(source,undefined,()=>false),/サイズ上限/);
        assert(cancelled && !source.locked);
    }
    const oversized=event(gemini(Array.from({length:64*1024},()=>({text:'a'})),{finishReason:'STOP'}));
    await assert.rejects(collectResponse('gemini',new Response(oversized).body,undefined,()=>{}),/サイズ上限/);
});

test('OpenRouter handles DeepSeek reasoning_content, multiple candidate finishes and usage-only frames', async () => {
    const stream = event({ ...router({ reasoning_content: 'chain ' }), model: 'deepseek/deepseek-r1' })
        + event(router({ reasoning_content: 'of thought', content: 'Answer' }, 'stop'))
        + event(router({ content: 'Alternate' }, 'length', 1))
        + event({ choices: [], usage: { total_tokens: 60 } }) + done;
    const result = await collectResponse('openrouter', byteStream(stream), undefined, () => {});
    assert.equal(result.choices[0].message.reasoning_content, 'chain of thought');
    assert.equal(result.model, 'deepseek/deepseek-r1');
    assert.equal(result.choices[0].message.content, 'Answer');
    assert.equal(result.choices[1].finish_reason, 'length');
    assert.equal(result.usage.total_tokens, 60);
});

test('truncated SSE, provider errors and incomplete tool arguments fail closed', async () => {
    const fixtures = [
        ['gemini', event(gemini([{ text: '途中' }])), /切断/],
        ['gemini', event(gemini([{ functionCall: { name: 'lookup', willContinue: true } }], { finishReason: 'STOP' })), /ツール呼び出し/],
        ['gemini', 'data: {"candidates":', /切断/],
        ['gemini', 'data: invalid\n\n', /解析/],
        ['openrouter', event(router({ content: '途中' }, 'stop')), /切断/],
        ['openrouter', event(router({ content: '途中' })) + event({ error: { message: 'upstream reset' } }), /upstream reset/],
        ['openrouter', event(router({}, 'error')) + done, /エラー/],
        ['openrouter', event(router({ tool_calls: [{ index: 0, id: 'call', function: { name: 'tool', arguments: '{"' } }] }, 'tool_calls')) + done, /JSON/]
    ];
    for (const [provider, body, error] of fixtures) {
        await assert.rejects(collectResponse(provider, byteStream(body), undefined, () => {}), error);
    }
});

test('aborting a pending SSE read cancels the body and releases its reader', async () => {
    const controller = new AbortController();
    let canceled = false;
    const body = new ReadableStream({ cancel() { canceled = true; } });
    const reading = collectResponse('openrouter', body, controller.signal, () => assert.fail('unexpected data'));
    controller.abort();
    await assert.rejects(reading, { name: 'AbortError' });
    assert.equal(canceled, true);
    assert.equal(body.locked, false);
});

test('only supported text output routes stream', () => {
    assert.equal(canStream('gemini', 'gemini-3-flash-preview'), true);
    assert.equal(canStream('openrouter', 'deepseek/deepseek-r1'), true);
    assert.equal(canStream('gemini', 'gemini-2.5-flash-image-preview'), false);
    assert.equal(canStream('gemini', 'gemini-2.5-flash', { responseModalities: ['AUDIO'] }), false);
    assert.equal(canStream('openrouter', 'google/veo-3'), false);
    assert.equal(canStream('zai', 'glm-4.6'), false);
    assert.equal(canStream('bedrock', 'anthropic.claude'), false);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),S=require('../settings-v136');
for(const value of ['', 'abc', '日本語と絵文字🌏', 'a'.repeat(10000)])test('I05 SHA-256 matches native crypto ('+value.length+' chars)',()=>{
    assert.equal(S.hashV136(value),crypto.createHash('sha256').update(value).digest('hex'));
});
const model=(content,signature)=>({role:'model',content,continuation:{provider:'bedrock',parts:[{text:content}],bedrock:[{reasoningContent:{reasoningText:{text:'reason',signature}}}]}});
test('I05 optional persisted nulls and local display baselines do not change logical context',()=>{
    const a=[{role:'user',content:'one'},model('answer','sig')],b=structuredClone(a);
    b[0].continuation={displayContent:'one'};b[0].tool_calls=null;b[0].imageIds=[];b[0].attachments=[];
    b[1].continuation.openai=null;b[1].continuation.turns=[];b[1].timestamp=123;
    assert.deepEqual(S.historyContextV136(a),S.historyContextV136(b));
});
test('I05 every prefix deletion changes dependent context while unaffected turn context remains stable',()=>{
    const original=[{role:'user',content:'one'},model('answer','sig'),{role:'user',content:'two'},model('later','later')];
    const full=S.historyContextV136(original),removed=S.historyContextV136(original.slice(1));
    assert.notEqual(full.prefix,removed.prefix);assert.equal(full.turn,removed.turn);
});
test('I05 candidate baselines share the same preceding input and keep unique subsequent contexts',()=>{
    const a={...model('A','a'),isCascaded:true,isSelected:true,siblingGroupId:'g'},b={...model('B','b'),isCascaded:true,isSelected:false,siblingGroupId:'g'};
    const messages=[{role:'user',content:'one'},a,b,{role:'user',content:'two'},model('later','later')];
    S.rememberHistoryContextsV136(messages);assert.equal(a.continuation.historyPrefixV136,b.continuation.historyPrefixV136);
    const first=S.historyContextV136(messages);a.isSelected=false;b.isSelected=true;assert.notEqual(S.historyContextV136(messages).prefix,first.prefix);
});
test('I05 changing system prompt changes conversation context without editing provider signatures',()=>{
    const messages=[{role:'user',content:'one'},model('answer','opaque')],before=JSON.stringify(messages);
    assert.notEqual(S.historyContextV136(messages,'first').prefix,S.historyContextV136(messages,'second').prefix);assert.equal(JSON.stringify(messages),before);
});

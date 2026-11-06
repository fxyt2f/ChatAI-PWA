const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../settings-v136');
for(const [provider,model,supported] of [
    ['zai','glm-4.6','unsupported'],['zai','glm-4.6v','supported'],['zai','fake-glm-4.6v','unknown'],
    ['gemini','gemini-2.5-pro','supported'],['gemini','models/gemini-3.8-flash','supported'],['gemini','gemini-3.8-flash-tts','unknown'],
    ['bedrock','us.anthropic.claude-opus-4-6-v1','supported'],['bedrock','amazon.nova-micro-v1:0','unknown'],
    ['openrouter','unknown/model','unknown']
])test('N06 '+provider+' / '+model,()=>assert.equal(S.imageInputCapability(provider,model),supported));
test('N06 official modality metadata overrides defaults and never infers from provider',()=>{
    assert.equal(S.imageInputCapability('openrouter','custom/model',{inputModalities:['text','image']}),'supported');
    assert.equal(S.imageInputCapability('gemini','gemini-2.5-pro',{inputModalities:['text']}),'unsupported');
    assert.equal(S.imageInputCapability('openrouter','custom/model',{inputModalities:[] }),'unsupported');
});

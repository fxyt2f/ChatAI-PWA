window.runSettingsAdjustmentsV136=async({app,db,st,ui,test,assert,eq})=>{
    const $=id=>document.getElementById(id),view=window.settingsUiV136,initial=structuredClone(st.globalSettingsV136);
    const wait=async fn=>{const end=Date.now()+3000;while(!await fn()){if(Date.now()>end)throw Error('settings adjustment save timeout');await new Promise(r=>setTimeout(r,10));}};
    const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const change=(id,value,type='change')=>{const node=$(id);if(node.type==='checkbox')node.checked=value;else node.value=value;node.dispatchEvent(new Event(type,{bubbles:true}));};
    try {
        await test('settings requested copy, developer order and danger disclosure',async()=>{
            const settings=$('settings-screen');assert(!settings.textContent.includes('※'));
            assert(settings.textContent.includes('コンテキスト圧縮(要約)機能'));assert(settings.textContent.includes('コンテキストを圧縮して応答品質の低下を防ぎます。'));
            for(const text of ['思考翻訳モデル: reasoning/thinking の翻訳に使用します。','校正処理にもAPIコストが発生します。','校正モデル: 校正・文章整形・推敲系処理に使用します。','要約モデル: 履歴要約に使用します。'])assert(!settings.textContent.includes(text));
            eq($('developer-settings').nextElementSibling,$('app-info-settings'));
            assert($('developer-settings').compareDocumentPosition($('app-info-settings'))&Node.DOCUMENT_POSITION_FOLLOWING);
            assert(!$('data-danger-settings').querySelector('details').open);
        });
        await test('proofreading off keeps model and prompt editable and persisted without executing proofreading',async()=>{
            await ui.showScreen('settings',true);view.selectCategory('general',false);
            change('enable-proofreading',false);await wait(()=>st.settings.enableProofreading===false);
            const ref={apiConfigId:'gem',modelName:'gemini-2.5-pro'};
            assert($('proofreading-model-name').getClientRects().length);assert(!$('proofreading-model-name').disabled);
            change('proofreading-model-name',app.encodeModelRefValue(ref));await view.saveQueue;
            change('proofreading-system-instruction','校正の事前設定','input');
            await wait(async()=> (await db.getSetting('globalSettingsV136')).value.proofreadingSystemInstruction==='校正の事前設定');
            eq(st.globalSettingsV136.proofreadingModelRef,ref);
            const call=app.callApiWithRetry,proofread=app.proofreadTextWithInfo;let calls=0;
            app.callApiWithRetry=async()=>({content:'raw',continuation:{parts:[{text:'raw'}]}});
            app.proofreadTextWithInfo=async text=>{calls++;eq(app.getProofreadingModelRefForExecution(),ref);eq(st.settings.proofreadingSystemInstruction,'校正の事前設定');return {content:text}};
            try{
                await app._internalHandleSend([{role:'user',parts:[{text:'test'}]}],{},null);eq(calls,0);
                change('enable-proofreading',true);await wait(()=>st.settings.enableProofreading===true);
                await app._internalHandleSend([{role:'user',parts:[{text:'test'}]}],{},null);eq(calls,1);
            }finally{app.callApiWithRetry=call;app.proofreadTextWithInfo=proofread;}
        });
        await test('unset automatic proofreading and thought translation leave the main response intact',async()=>{
            await app.saveGlobalSettingsV136({enableProofreading:true, enableThoughtTranslation:true, proofreadingModelRef:null, thoughtTranslationModelRef:null});
            const call=app.callApiWithRetry,proofread=app.proofreadTextWithInfo,translate=window.testApi.translateText;
            app.callApiWithRetry=async()=>({content:'raw',thoughtSummary:'original thoughts',continuation:{parts:[{text:'raw'}]}});
            app.proofreadTextWithInfo=async()=>{throw new Error('Unexpected proofreading');};
            window.testApi.translateText=async()=>{throw new Error('Unexpected translation');};
            try{
                const result=await app._internalHandleSend([{role:'user',parts:[{text:'test'}]}],{},null);
                eq(result.at(-1).content,'raw');eq(result.at(-1).thoughtSummary,'original thoughts');
            }finally{app.callApiWithRetry=call;app.proofreadTextWithInfo=proofread;window.testApi.translateText=translate;}
        });
        await test('prompt auto sizing, manual resize and caret survive immediate saving',async()=>{
            view.selectCategory('general',false);const control=$('proofreading-system-instruction');control.scrollIntoView({block:'center'});control.focus();
            change(control.id,'','input');await frames();assert(control.getBoundingClientRect().height>=100);
            const text=Array.from({length:70},(_,i)=>`行${i} プロンプト本文の編集内容を保持します。`).join('\n');
            control.value=text;control.setSelectionRange(15,15);control.dispatchEvent(new Event('input',{bubbles:true}));await frames();
            eq(control.getBoundingClientRect().height,500);assert(control.scrollHeight>control.clientHeight);eq(control.selectionStart,15);assert(document.activeElement===control);
            control.style.height='260px';await frames();change(control.id,'手動リサイズを保持','input');await frames();eq(control.getBoundingClientRect().height,260);
            await wait(async()=> (await db.getSetting('globalSettingsV136')).value.proofreadingSystemInstruction==='手動リサイズを保持');
            control.blur();await frames();assert(control.getBoundingClientRect().right<=$('settings-detail').getBoundingClientRect().right+1);
        });
        await test('danger operations require explicit expansion and retain confirmation',async()=>{
            view.selectCategory('other',false);const details=$('data-danger-settings').querySelector('details'),summary=details.querySelector('summary');details.open=false;
            eq($('clear-data-btn').getClientRects().length,0);
            const confirm=ui.showCustomConfirm,clear=db.clearAllData;let confirmations=0,clears=0;
            ui.showCustomConfirm=async()=>{confirmations++;return false};db.clearAllData=async()=>{clears++};
            try{
                summary.click();assert(details.open);assert($('clear-data-btn').getClientRects().length);$('clear-data-btn').click();await wait(()=>confirmations===1);eq(clears,0);
                summary.click();assert(!details.open);eq(clears,0);eq(confirmations,1);
                summary.click();view.enter();assert(!details.open);
            }finally{ui.showCustomConfirm=confirm;db.clearAllData=clear;}
        });
        await test('settings native selects share arrow, padding and theme states',async()=>{
            view.selectCategory('general',false);const thinking=$('settings-thinking-button'),model=$('model-name');
            eq(thinking.tagName,'SELECT');const a=getComputedStyle(thinking),b=getComputedStyle(model);
            eq(a.backgroundImage,b.backgroundImage);eq(a.paddingRight,b.paddingRight);assert(parseFloat(a.paddingRight)>=38);
            eq(a.borderRadius,b.borderRadius);assert(thinking.getBoundingClientRect().height>=44);
            eq([...thinking.options].map(o=>o.value),app.getModelThinkingCapability().levels.slice().sort((a,b)=>['minimal','low','medium','high','xhigh','max'].indexOf(a)-['minimal','low','medium','high','xhigh','max'].indexOf(b)));
        });
        await test('settings selected category follows the same chat selection theme rule',async()=>{
            const own=st.activeProfile.settings.useCustomTheme;const oldTheme=structuredClone(st.activeProfile.settings.theme||{});
            const probe=document.createElement('div');probe.className='chat-sidebar-item';probe.setAttribute('aria-current','page');document.body.append(probe);
            try{
                await app.setProfileOverride('theme',true);const colors=[];
                for(const darkMode of [false,true]){
                    await app.saveAppearanceValues('theme',{darkMode,themeColorMode:'individual',otherButtonColor:'#684ca3'});view.selectCategory('general',false);await frames();
                    const selected=document.querySelector('.settings-category-nav [aria-current]');await wait(()=>getComputedStyle(selected).backgroundColor===getComputedStyle(probe).backgroundColor);colors.push(getComputedStyle(selected).backgroundColor);
                }
                assert(colors[0]!==colors[1]);
            }finally{probe.remove();await app.saveAppearanceValues('theme',oldTheme);await app.setProfileOverride('theme',own);}
        });
    }finally{await app.saveGlobalSettingsV136(initial);ui.applySettingsToUI();}
};

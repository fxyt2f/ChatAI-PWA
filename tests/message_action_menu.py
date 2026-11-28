"""Answer menu regressions on the real chat page, with isolated IndexedDB."""


def run(client, base_url):
    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    client.call('Network.setBypassServiceWorker', {'bypass': True})
    try:
        client.call('Page.navigate', {'url': base_url})
        result = client.call('Runtime.evaluate', {
            'awaitPromise': True, 'returnByValue': True, 'expression': r"""
            (async () => {
                const wait = async (predicate, label) => {
                    const deadline = Date.now() + 12000;
                    while (Date.now() < deadline) {
                        if (predicate()) return;
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    throw new Error(label);
                };
                const check = (condition, label) => {
                    if (!condition) throw new Error(label);
                };
                await wait(() => window.appLogic?._setupEventListenersCallCount &&
                    state.activeProfileId && !document.querySelector('#progressDialog[open]'), 'App startup');
                document.querySelector('#releaseNotesDialog[open] .dialog-ok-btn')?.click();
                const makeMessage = (role, content, extra = {}) => ({ role, content, timestamp: 10, ...extra });
                const cascade = { isCascaded: true, siblingGroupId: 'answer-pair' };
                await dbUtils.saveChat(null, { id: 813421, createdAt: 10, messages: [
                    makeMessage('user', 'First question'),
                    makeMessage('model', 'Answer A', {
                        ...cascade, isSelected: true, groundingMetadata: { webSearchQueries: ['Answer A source'] }
                    }),
                    makeMessage('model', 'Answer B', { ...cascade, isSelected: false }),
                    makeMessage('user', 'Second question'),
                    makeMessage('model', 'Answer C'),
                ] });
                await dbUtils.saveChat(null, { id: 813422, createdAt: 20, messages: [
                    makeMessage('user', 'Other question'), makeMessage('model', 'Other answer'),
                ] });
                await appLogic.loadChat(813421, { scrollAfterLoad: false });
                const row = index => document.querySelector(`.message.model[data-index="${index}"]`);
                const trigger = index => row(index).querySelector('.tm-message-menu-btn');
                const menu = () => document.getElementById('message-action-menu');
                const open = index => {
                    trigger(index).click();
                    check(menu() && trigger(index).getAttribute('aria-expanded') === 'true', `Menu for answer ${index}`);
                    return [...menu().querySelectorAll('[role="menuitem"]')];
                };
                const calls = [];
                const regenerateAnswer = appLogic.regenerateAnswerV137;
                const retry = appLogic.retryFromMessage;
                appLogic.regenerateAnswerV137 = (index, target) => calls.push({ index, target });
                appLogic.retryFromMessage = index => calls.push({ index });
                try {
                    for (const content of ['Edited answer A', 'Edited answer A again']) {
                        const previous = state.currentMessages[1];
                        row(1).querySelector('.js-edit-btn').click();
                        await wait(() => row(1).querySelector('.edit-textarea'), 'Inline editor opens');
                        row(1).querySelector('.edit-textarea').value = content;
                        await row(1).querySelector('.save-edit-btn').onclick();
                        const current = state.currentMessages[1];
                        check(current !== previous && current.content === content &&
                            row(1).querySelector('.message-content').textContent.trim() === content,
                            'Edited message replaces its previous data and updates the DOM');
                        open(1)[0].click();
                        const call = calls.pop();
                        check(call?.index === 1 && call.target === current, 'Regenerate just the edited answer');
                    }
                    open(1)[1].click();
                    check(calls.pop()?.index === 0, 'Retry from the edited answer’s user message');
                    open(4)[1].click();
                    check(calls.pop()?.index === 3, 'Retry from the later answer’s user message');
                    open(1)[2].click();
                    check(document.querySelector('#message-sources-dialog[open]').textContent.includes('Answer A source'),
                        'Show the edited answer’s sources');
                    uiUtils.closeMessageSources();

                    const current = state.currentMessages[1];
                    const replacedAction = open(1)[0];
                    state.currentMessages[1] = { ...current };
                    replacedAction.click();
                    trigger(1).click();
                    check(!menu() && !calls.length, 'An unrelated replacement at the same index invalidates the old controls');
                    state.currentMessages[1] = current;

                    const staleTrigger = trigger(1);
                    const staleAction = open(1)[0];
                    await row(1).querySelector('.cascade-next-btn').onclick();
                    check(state.currentMessages[2].isSelected && !row(1), 'Cascade switches to answer B');
                    staleAction.click();
                    staleTrigger.click();
                    check(!menu() && !calls.length, 'Old cascade controls are inert');
                    open(2)[0].click();
                    check(calls.pop()?.target === state.currentMessages[2], 'Current cascade action targets answer B');

                    await row(2).querySelector('.cascade-prev-btn').onclick();
                    const oldChatTrigger = trigger(1);
                    const oldChatAction = open(1)[0];
                    await appLogic.loadChat(813422, { scrollAfterLoad: false });
                    oldChatAction.click();
                    oldChatTrigger.click();
                    check(!menu() && !calls.length, 'Old chat controls are inert');
                    open(1)[0].click();
                    check(state.currentChatId === 813422 && calls.pop()?.target === state.currentMessages[1],
                        'Current chat action targets the displayed answer');
                } finally {
                    appLogic.regenerateAnswerV137 = regenerateAnswer;
                    appLogic.retryFromMessage = retry;
                }
                return 'ALL PASSED (answer menu after repeated edits, action targets, cascade and chat switches)';
            })()
            """,
        })
        if 'exceptionDetails' in result:
            details = result['exceptionDetails']
            raise AssertionError(details.get('exception', {}).get('description', details))
        return result['result']['value']
    finally:
        client.call('Network.setBypassServiceWorker', {'bypass': False})

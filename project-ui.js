window.ProjectUI = (() => {
    const byId = id => document.getElementById('project-' + id);
    const db = () => window.dbUtils;
    const ui = () => window.uiUtilsV136;
    const app = () => window.appLogic;
    const icon = name => {
        const span = document.createElement('span');
        span.className = 'material-symbols-outlined';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = name;
        return span;
    };
    let installed = false, view, dialog, menu, sidebar, expanded, currentChat, handoff;
    const drafts = new Map();
    const returns = new Map();
    const chatEntries = new Map();
    const tabs = new Map();
    let dataGeneration = 0, draftLabelGeneration = 0;
    const expansionKey = 'chatai-expanded-projects';

    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text) element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    function button(text, callback, className = 'document-library-action') {
        const element = node('button', text, className);
        element.type = 'button';
        element.addEventListener('click', callback);
        return element;
    }

    function persistExpansion() {
        try { localStorage.setItem(expansionKey, JSON.stringify([...expanded])); }
        catch { /* keep the current tab's expansion */ }
    }

    function revealCurrentChat(memberships) {
        if (!installed) return;
        const chatId = window.state.currentChatId;
        const projectId = memberships.get(chatId);
        if (currentChat?.chatId === chatId && currentChat?.projectId === projectId) return;
        currentChat = { chatId, projectId };
        if (!projectId || expanded.has(projectId)) return;
        expanded.add(projectId);
        persistExpansion();
        if (sidebar?.visible) drawSidebar();
    }

    function chatModels(chats) {
        const models = chats.map(chat => ui().createHistoryDisplayModel(chat, '', 'updatedAt'));
        return [
            ...ui().sortPinnedHistoryDisplayModels(models.filter(model => model.isPinned), 'updatedAt'),
            ...ui().sortHistoryDisplayModels(models.filter(model => !model.isPinned), 'updatedAt')
        ];
    }

    function renderSidebar(projects, memberships, chats, visible) {
        // Applying profile settings can load the wide sidebar before startup binds its events.
        install();
        const byProject = new Map();
        for (const chat of chats) {
            const id = memberships.get(chat.id);
            if (!id) continue;
            if (!byProject.has(id)) byProject.set(id, []);
            byProject.get(id).push(chat);
        }
        const rows = projects.map(project => {
            const members = byProject.get(project.id) ?? [];
            return { project, members, activity: members.length
                ? members.reduce((latest, chat) => Math.max(latest, Number(chat.updatedAt) || 0), 0)
                : project.updatedAt };
        });
        rows.sort((a, b) => b.activity - a.activity || a.project.name.localeCompare(b.project.name, 'ja') ||
            a.project.id.localeCompare(b.project.id));
        revealCurrentChat(memberships);
        sidebar = { rows, visible };
        byId('sidebar').hidden = !visible;
        const historyButton = byId('all-history');
        historyButton.hidden = Boolean(document.getElementById('chat-sidebar-search-input').value.trim());
        historyButton.textContent = visible ? '全履歴を表示' : '最近のチャットに戻る';
        if (visible) drawSidebar();
    }

    function drawSidebar() {
        closeMenu();
        const list = byId('sidebar-list');
        const active = document.activeElement;
        const focusId = active.closest('[data-project-id]')?.dataset.projectId;
        const focusClass = active.dataset.projectFocus;
        list.replaceChildren();
        for (const { project, members } of sidebar.rows) {
            const group = node('section', '', 'project-folder');
            group.dataset.projectId = project.id;
            const row = node('div', '', 'chat-sidebar-item project-folder-row');
            const isExpanded = expanded.has(project.id);
            const toggle = button('', () => {
                if (expanded.has(project.id)) expanded.delete(project.id);
                else expanded.add(project.id);
                persistExpansion();
                drawSidebar();
            }, 'chat-sidebar-icon-button project-expand');
            toggle.dataset.projectFocus = 'expand';
            toggle.append(icon(isExpanded ? 'expand_more' : 'chevron_right'));
            toggle.setAttribute('aria-label', `「${project.name}」のチャット${isExpanded ? 'を折りたたむ' : 'を展開'}`);
            toggle.setAttribute('aria-expanded', String(isExpanded));
            toggle.setAttribute('aria-controls', 'project-members-' + project.id);
            const openButton = button('', () => open(project.id), 'chat-sidebar-item-open project-folder-open');
            openButton.dataset.projectFocus = 'open';
            openButton.append(icon('folder_open'), node('span', project.name, 'chat-sidebar-item-title'));
            openButton.title = project.name;
            if (view?.id === project.id) openButton.setAttribute('aria-current', 'page');
            const options = button('', () => openMenu(options, project.id), 'chat-sidebar-item-menu project-folder-options');
            options.dataset.projectFocus = 'menu';
            options.append(icon('more_vert'));
            options.setAttribute('aria-label', `「${project.name}」のプロジェクト操作`);
            options.setAttribute('aria-haspopup', 'menu');
            options.setAttribute('aria-controls', 'project-menu');
            options.setAttribute('aria-expanded', 'false');
            row.append(toggle, openButton, options);
            const children = node('div', '', 'project-folder-chats');
            children.id = 'project-members-' + project.id;
            children.hidden = !isExpanded;
            if (isExpanded) {
                const models = chatModels(members);
                const recent = models.slice(0, 10);
                const selected = models.find(model => model.isCurrent);
                if (selected && !recent.includes(selected)) recent[recent.length - 1] = selected;
                children.setAttribute('role', 'list');
                children.append(...recent.map(model => ui().createChatSidebarItem(model)));
                if (!recent.length) children.append(node('p', 'チャットはありません', 'project-empty'));
                if (models.length > recent.length) children.append(button('すべて表示', () => open(project.id), 'chat-sidebar-nav-button'));
            }
            group.append(row, children);
            list.append(group);
            if (focusId === project.id && focusClass) row.querySelector(`[data-project-focus="${focusClass}"]`)?.focus({ preventScroll: true });
        }
    }

    function closeMenu(restoreFocus = false) {
        if (!menu) return;
        const { anchor } = menu;
        menu = null;
        byId('menu').hidden = true;
        anchor.setAttribute('aria-expanded', 'false');
        anchor.closest('.chat-sidebar-item')?.classList.remove('menu-active');
        if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    }

    function openMenu(anchor, id, actions = ['edit', 'delete'], documentId) {
        if (menu?.anchor === anchor) return closeMenu(true);
        closeMenu();
        ui().closeHistoryItemMenu();
        const element = byId('menu');
        menu = { anchor, id, documentId };
        for (const item of element.children) item.hidden = !actions.includes(item.dataset.projectAction);
        element.setAttribute('aria-label', actions.includes('edit') ? 'プロジェクトの操作' : '共有ファイルの操作');
        anchor.setAttribute('aria-expanded', 'true');
        anchor.closest('.chat-sidebar-item')?.classList.add('menu-active');
        element.hidden = false;
        ui().positionRowMenu(element, anchor);
        element.querySelector(':scope > :not([hidden])')?.focus({ preventScroll: true });
    }

    function markOpenFolder() {
        for (const button of byId('sidebar-list').querySelectorAll('.project-folder-open')) {
            if (button.closest('[data-project-id]').dataset.projectId === view?.id) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        }
    }

    function open(id, { fromHistory = false } = {}) {
        if (!installed || window.state.currentScreen !== 'chat' || !DocumentLibrary.isId(id)) return;
        if (view?.id === id) {
            if (!document.getElementById('chat-sidebar-backdrop').hidden) ui().closeChatSidebar();
            byId('title').focus({ preventScroll: true });
            return;
        }
        const previous = view;
        const returnState = history.state;
        if (!previous && !fromHistory && returnState?.projectChatToken && returnState.projectChatId === window.state.currentChatId) {
            chatEntries.set(returnState.projectChatToken, app().captureChatViewForProject());
        }
        const chat = document.getElementById('chat-workspace');
        const scroller = chat.querySelector('.main-content');
        const fromOverlay = !document.getElementById('chat-sidebar-backdrop').hidden;
        const returnFocus = previous?.returnFocus ?? (fromOverlay ? document.getElementById('goto-history-btn') : document.activeElement);
        app().chatNavigationV136 = {};
        app().resetSwipeState();
        window.settingsUiV136?.closePopover(false);
        close({ fromHistory: true });
        window.DocumentLibraryUI.close({ fromHistory: true });
        ui().closeHistoryItemMenu();
        if (fromOverlay) ui().closeChatSidebar();
        view = { id, returnFocus, scroller, scrollTop: previous?.scrollTop ?? scroller.scrollTop,
            messages: window.state.currentMessages, version: 0, notice: '' };
        if (!fromHistory) {
            const method = returnState?.projectId ? 'replaceState' : 'pushState';
            history[method]({ screen: 'chat', projectId: id }, '', '#chat');
        }
        byId('workspace').hidden = false;
        byId('content').scrollTop = 0;
        activateTab(tabs.get(id) || 'chats');
        attachDraft(view);
        byId('title').textContent = 'プロジェクト';
        byId('description').hidden = true;
        byId('notice').textContent = '読み込み中…';
        byId('chats').replaceChildren();
        byId('documents').replaceChildren();
        setViewReady(false);
        ui().syncChatWorkspaceInteractivity();
        ui().syncChatSidebarCurrentSelection();
        markOpenFolder();
        byId('title').focus({ preventScroll: true });
        void refresh(view);
    }

    function close({ fromHistory = false, restoreFocus = false } = {}) {
        closeMenu();
        if (dialog) byId('dialog').close();
        if (!view) return;
        const previous = view;
        view = null;
        ui().closeHistoryItemMenu();
        byId('workspace').hidden = true;
        if (!fromHistory && history.state?.projectId) history.replaceState({ screen: 'chat' }, '', '#chat');
        ui().syncChatWorkspaceInteractivity();
        ui().syncChatSidebarCurrentSelection();
        markOpenFolder();
        if (previous.messages === window.state.currentMessages) {
            previous.scroller.scrollTop = previous.scrollTop;
            if (restoreFocus) {
                const target = previous.returnFocus?.getClientRects().length && !previous.returnFocus.closest('[inert]')
                    ? previous.returnFocus : document.getElementById('goto-history-btn');
                target.focus({ preventScroll: true });
            }
        }
    }

    async function handleHistory(entry) {
        if (entry?.projectReturn && !handoff) {
            const origin = returns.get(entry.projectReturn);
            if (origin && window.state.currentMessages !== origin.values.currentMessages) {
                const chatId = window.state.currentChatId;
                if (origin.chatIdAfterOpen === chatId && origin.chatTokenAfterOpen) {
                    chatEntries.set(origin.chatTokenAfterOpen, app().captureChatViewForProject());
                }
                await restoreChatSnapshot(origin);
                if (history.state?.projectReturn !== entry.projectReturn) return;
            }
        }
        if (entry?.projectId && !entry.documentLibrary) {
            if (dialog) byId('dialog').close();
            open(entry.projectId, { fromHistory: true });
        } else {
            close({ fromHistory: true, restoreFocus: !entry?.documentLibrary && !entry?.projectChatId });
            if (entry?.projectChatId && !entry.documentLibrary && window.state.currentChatId !== entry.projectChatId) {
                const snapshot = chatEntries.get(entry.projectChatToken);
                if (snapshot && await restoreChatSnapshot(snapshot)) return;
                if (history.state?.projectChatToken !== entry.projectChatToken) return;
                await window.chatHistoryActions.open(entry.projectChatId, { keepProjectHistory: true });
            }
        }
    }

    async function restoreChatSnapshot(snapshot) {
        const entry = history.state;
        const navigation = app().chatNavigationV136;
        const generation = dataGeneration;
        const id = snapshot.values.currentChatId;
        if (id != null) {
            const current = await db().getChat(id);
            const owner = db().chatSaveOwners?.get(snapshot.values.currentMessages);
            if (!current || (current.recordGenerationId ?? null) !== (owner?.recordGenerationId ?? snapshot.recordGenerationId ?? null)) return false;
        }
        const current = history.state;
        if (generation !== dataGeneration || navigation !== app().chatNavigationV136 ||
            current?.projectReturn !== entry?.projectReturn || current?.projectChatToken !== entry?.projectChatToken ||
            current?.screen !== entry?.screen) return false;
        app().restoreChatViewForProject(snapshot);
        return true;
    }

    function setViewReady(ready) {
        for (const id of ['options', 'add-chat', 'file-add']) byId(id).disabled = !ready;
        if (view) view.ready = ready;
        renderComposer();
    }

    function setNotice(owner, message) {
        if (view !== owner) return;
        owner.notice = message;
        byId('notice').textContent = message;
    }

    function activateTab(tab) {
        if (!view) return;
        tabs.set(view.id, tab);
        byId('tabs').parentElement.dataset.tab = tab;
        for (const name of ['chats', 'files']) {
            const selected = tab === name;
            byId('tab-' + name).setAttribute('aria-selected', String(selected));
            byId('tab-' + name).tabIndex = selected ? 0 : -1;
        }
    }

    function attachDraft(owner) {
        const key = app().getNewInputDraftContextKey(owner.id);
        let draft = drafts.get(key);
        if (!draft) {
            const local = app().loadInputDraftLocal(key);
            draft = { key, text: local?.text ?? '', attachments: [], changed: false, execution: null };
            drafts.set(key, draft);
            void app().loadInputDraftDropbox(key).then(remote => {
                if (drafts.get(key) !== draft || draft.changed || draft.busy) return;
                const latest = app().chooseLatestInputDraftRecord(local, remote);
                draft.text = latest?.deleted ? '' : latest?.text ?? '';
                if (view?.draft === draft) {
                    byId('input').value = draft.text;
                    renderComposer();
                }
            });
        }
        owner.draft = draft;
        byId('input').value = draft.text;
        renderComposer();
    }

    function renderComposer() {
        if (!view?.draft) return;
        const draft = view.draft;
        const input = byId('input');
        input.disabled = !view.ready || !!draft.busy;
        const model = byId('model');
        model.disabled = !view.ready || !!draft.busy || !!draft.selectingModel;
        const execution = draftExecution(draft);
        const ref = execution.modelRef;
        model.textContent = ref?.modelName ?? 'モデルを選択';
        model.title = model.textContent;
        model.setAttribute('aria-label', `モデルを選択（${model.textContent}）`);
        byId('send').disabled = !view.ready || !!draft.busy || !!draft.processing || !!draft.selectingModel ||
            !(draft.text.trim() || draft.attachments.length);
        byId('attach').disabled = !view.ready || !!draft.busy || !!draft.processing;
        const list = byId('attachments');
        list.hidden = !draft.attachments.length;
        list.replaceChildren(...draft.attachments.map(attachment => {
            const label = node('span', attachment.name);
            label.title = attachment.name;
            const remove = button('×', () => {
                draft.attachments = draft.attachments.filter(item => item !== attachment);
                renderComposer();
                byId('attach').focus({ preventScroll: true });
            }, 'chat-sidebar-icon-button');
            remove.disabled = !!draft.busy || !!draft.processing;
            remove.setAttribute('aria-label', `${attachment.name} を削除`);
            const item = node('li');
            item.append(icon('attach_file'), label, remove);
            return item;
        }));
        const status = byId('composer-status');
        status.textContent = draft.busy ? 'チャットを保存中…' : draft.processing ? '添付ファイルを準備中…' : draft.notice || '';
        status.hidden = !status.textContent;
        status.dataset.error = String(Boolean(draft.notice && !draft.busy && !draft.processing));
    }

    function draftExecution(draft) {
        if (draft.execution) return draft.execution;
        return app().getCurrentChatModelRef() ? window.state.currentExecutionSettings : app().newChatExecutionDefaults();
    }

    function persistDraft(draft) {
        if (!draft.changed) return;
        app().persistInputDraft(draft.key, draft.text);
        void app().flushInputDraftDropboxSave();
    }

    function prepareForUpdate() {
        for (const draft of drafts.values()) {
            if (draft.busy || draft.processing || draft.attachments.length) return false;
            if (draft.changed && draft.text && app().loadInputDraftLocal(draft.key)?.text !== draft.text) return false;
        }
        return true;
    }

    async function addDraftAttachments(draft, files) {
        if (!files.length || draft.processing || draft.busy) return;
        draft.processing = true;
        draft.notice = '';
        if (view?.draft === draft) renderComposer();
        try {
            draft.notice = await app().addComposerFiles(files, draft.attachments, {
                current: () => drafts.get(draft.key) === draft,
                onAdd: () => { if (view?.draft === draft) renderComposer(); }
            });
        } finally {
            draft.processing = false;
            if (view?.draft === draft) renderComposer();
        }
    }

    function chooseDraftModel(owner) {
        const draft = owner.draft;
        window.settingsUiV136?.openModels(byId('model'), '', {
            getRef: () => draftExecution(draft).modelRef,
            select: async ref => {
                draft.selectingModel = true;
                draft.notice = '';
                renderComposer();
                try {
                    const execution = await app().prepareChatExecutionSelection(draftExecution(draft), { modelRef: ref });
                    if (view === owner && owner.draft === draft) draft.execution = execution;
                } catch (error) {
                    draft.notice = error.message || String(error);
                    throw error;
                } finally {
                    draft.selectingModel = false;
                    if (view?.draft === draft) renderComposer();
                }
            }
        });
    }

    function rememberOrigin(owner, snapshot) {
        const entry = history.state;
        if (entry?.projectId !== owner.id) return null;
        const token = entry.projectReturn ?? crypto.randomUUID();
        returns.set(token, snapshot);
        history.replaceState({ ...entry, projectReturn: token }, '', '#chat');
        return token;
    }

    function pushChatEntry(chatId, returnToken) {
        const token = crypto.randomUUID();
        history.pushState({ screen: 'chat', projectChatId: chatId, projectChatToken: token }, '', '#chat');
        const origin = returns.get(returnToken);
        if (origin) {
            origin.chatIdAfterOpen = chatId;
            origin.chatTokenAfterOpen = token;
        }
    }

    async function openChat(owner, chatId) {
        if (handoff || view !== owner) return;
        if (app().attachmentOperation?.finished) await app().attachmentOperation.finished;
        if (view !== owner || handoff) return;
        const snapshot = app().captureChatViewForProject();
        const token = rememberOrigin(owner, snapshot);
        const result = await window.chatHistoryActions.open(chatId, { keepProjectHistory: true });
        if (result?.ok && token && history.state?.projectReturn === token) {
            pushChatEntry(result.chatId, token);
        }
    }

    async function sendDraft() {
        const owner = view;
        if (!owner || handoff || byId('send').disabled) return;
        const { draft } = owner;
        draft.busy = true;
        draft.notice = '';
        renderComposer();
        const attempt = handoff = { owner };
        let snapshot;
        try {
            const messages = window.state.currentMessages;
            await window.state.executionSettingsReady;
            if (app().attachmentOperation?.finished) await app().attachmentOperation.finished;
            if (view !== owner || owner.draft !== draft || messages !== window.state.currentMessages) return;
            if (app().chatParameterOperation || window.state.isEditingSystemPrompt || window.state.isEditingChatTitle ||
                window.state.editingMessageIndex !== null || window.state.chatDataChangesV136.has(undefined)) {
                draft.notice = '現在の会話の編集またはデータ更新が終わってから送信してください。';
                return;
            }
            const execution = draftExecution(draft);
            if (!execution.modelRef) {
                draft.notice = '送信するモデルを選択してください。';
                return;
            }
            snapshot = app().captureChatViewForProject();
            const token = rememberOrigin(owner, snapshot);
            app().startNewChat({ projectId: owner.id, homeDraft: {
                text: draft.text, attachments: draft.attachments, execution,
                parameters: app().profileChatParameters(window.state.settings)
            } });
            attempt.messages = window.state.currentMessages;
            await app().handleSend({
                onInitialError: message => { draft.notice = message; },
                onInitialSave: session => {
                    if (handoff !== attempt) return;
                    attempt.committed = true;
                    draft.text = '';
                    draft.changed = false;
                    draft.attachments = [];
                    draft.execution = null;
                    draft.busy = false;
                    handoff = null;
                    if (view === owner && window.state.currentMessages === session.messages) {
                        close({ fromHistory: true });
                        if (token && history.state?.projectReturn === token)
                            pushChatEntry(session.chatId, token);
                    } else if (window.state.currentMessages === session.messages) {
                        app().restoreChatViewForProject(snapshot);
                        return;
                    }
                    app().scrollToBottom();
                }
            });
        } catch (error) {
            if (attempt.committed) await ui().showCustomAlert(error.message || String(error));
            else draft.notice = error.message || String(error);
        } finally {
            if (handoff === attempt) {
                handoff = null;
                if (snapshot && attempt.messages === window.state.currentMessages) app().restoreChatViewForProject(snapshot);
                draft.busy = false;
                if (view?.draft === draft) renderComposer();
            }
        }
    }

    async function refresh(owner) {
        const version = ++owner.version;
        try {
            const [project, chats, documents] = await db().getProjectWorkspaceSnapshot(owner.id);
            if (view !== owner || owner.version !== version) return;
            if (!project) return close({ restoreFocus: true });
            byId('title').textContent = project.name;
            const description = byId('description');
            description.textContent = project.description ?? '';
            description.hidden = !description.textContent.trim();
            byId('notice').textContent = owner.notice;
            setViewReady(true);
            drawChats(owner, chats.filter(Boolean));
            drawDocuments(owner, documents.filter(Boolean));
        } catch (error) {
            if (owner.version === version) setNotice(owner, `プロジェクトを読み込めませんでした。 ${error.message || error}`);
        }
    }

    function emptyList(list, text) {
        list.replaceChildren(node(list.tagName === 'UL' ? 'li' : 'p', text, 'project-empty'));
    }

    function drawChats(owner, records) {
        const list = byId('chats');
        const models = chatModels(records);
        const byChat = new Map(records.map(record => [record.id, record]));
        const signature = JSON.stringify(models.map(({ id, title, isPinned, updatedAt }) => [id, title, isPinned, updatedAt, byChat.get(id)?.recordGenerationId]));
        if (owner.chatSignature === signature) return;
        owner.chatSignature = signature;
        if (!models.length) return emptyList(list, 'チャットはありません。');
        list.replaceChildren(...models.map(model => {
            const item = ui().createChatSidebarItem(model);
            const openButton = item.querySelector('[data-sidebar-action="open"]');
            openButton.addEventListener('click', () => openChat(owner, model.id));
            if (!model.isPinned) openButton.querySelector('.chat-sidebar-title-line').prepend(icon('chat_bubble_outline'));
            const stamp = model.updatedAt && new Date(model.updatedAt);
            if (stamp && Number.isFinite(stamp.getTime())) {
                const time = node('time', new Intl.DateTimeFormat('ja', { year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit' }).format(stamp), 'project-chat-date');
                time.dateTime = stamp.toISOString();
                openButton.append(time);
            }
            const options = item.querySelector('[data-sidebar-action="menu"]');
            options.addEventListener('click', () => {
                ui().closeHistoryItemMenu();
                ui().showSidebarMenu(options, byChat.get(model.id), 'project');
            });
            return item;
        }));
    }

    function drawDocuments(owner, entries) {
        const list = byId('documents');
        entries.sort(window.DocumentLibraryUI.byName);
        const signature = JSON.stringify(entries.map(({ id, fileName, versionId }) => [id, fileName, versionId]));
        if (owner.documentSignature === signature) return;
        owner.documentSignature = signature;
        if (!entries.length) return emptyList(list, '共有ファイルはありません。');
        list.replaceChildren(...entries.map(entry => {
            const item = node('li', '', 'project-document-row');
            const preview = button('', () => window.DocumentLibraryUI.openProjectPreview(entry, owner.id), 'project-file-open');
            const name = node('span', entry.fileName, 'project-file-name');
            name.title = entry.fileName;
            const details = node('span', '', 'project-file-details');
            details.append(name, node('span', `${entry.format.toUpperCase()} · ${window.DocumentLibraryUI.fileSize(entry.size)} · 版 ${entry.version}`,
                'chat-sidebar-item-snippet'));
            preview.append(icon(entry.format === 'pdf' ? 'picture_as_pdf' : 'description'), details);
            const options = button('', () => openMenu(options, owner.id, ['unlink-file'], entry.id), 'chat-sidebar-icon-button');
            options.append(icon('more_horiz'));
            options.setAttribute('aria-label', `「${entry.fileName}」の操作`);
            options.setAttribute('aria-haspopup', 'menu');
            options.setAttribute('aria-expanded', 'false');
            options.setAttribute('aria-controls', 'project-menu');
            item.append(preview, options);
            return item;
        }));
    }

    function finishDialog(context) {
        if (dialog !== context) return;
        dialog = null;
        context.resolve({ ok: context.completed === true });
    }

    function showDialog(title, submitLabel, setup) {
        const element = byId('dialog');
        if (element.open) return Promise.resolve({ ok: false });
        const fields = byId('dialog-fields');
        const submit = byId('dialog-submit');
        fields.replaceChildren();
        byId('dialog-notice').textContent = '';
        byId('dialog-title').textContent = title;
        submit.textContent = submitLabel;
        submit.disabled = false;
        return new Promise(resolve => {
            const context = dialog = { resolve, generation: dataGeneration, busy: false };
            const focus = setup(context, fields);
            ui().prepareChatDialog(element);
            element.showModal();
            focus?.focus({ preventScroll: true });
        });
    }

    function ownsDialog(context) {
        return dialog === context && byId('dialog').open && context.generation === dataGeneration;
    }

    function field(fields, title, input) {
        const label = node('label', '', 'project-field');
        label.append(node('span', title), input);
        fields.append(label);
        return input;
    }

    async function editProject(project = null) {
        let created;
        const result = await showDialog(project ? 'プロジェクトを編集' : '新規プロジェクト', project ? '保存' : '作成', (context, fields) => {
            const name = field(fields, '名前', node('input'));
            name.required = true;
            name.value = project?.name ?? '';
            const description = field(fields, '説明（任意）', node('textarea'));
            description.rows = 3;
            description.value = project?.description ?? '';
            context.save = async () => {
                const values = { name: name.value, description: description.value };
                if (project) await db().updateProject(project.id, values);
                else created = await db().createProject(values);
            };
            return name;
        });
        if (result.ok && created) open(created.id);
    }

    async function removeProject(project) {
        const generation = dataGeneration;
        const owner = view;
        const confirmed = await ui().showCustomConfirm(
            `「${project.name}」のプロジェクト本体を削除しますか？\n\n所属チャットは削除されず、未所属に戻ります。共有ファイルとの関連付けは解除され、ライブラリの原本と旧版は残ります。`,
            { confirmLabel: 'プロジェクトを削除' });
        if (!confirmed || generation !== dataGeneration) return;
        try {
            await db().deleteProject(project.id);
            if (expanded.delete(project.id)) persistExpansion();
            if (view === owner && owner?.id === project.id) close({ restoreFocus: true });
        } catch (error) {
            await ui().showCustomAlert(`プロジェクトを削除できませんでした。\n${error.message || error}`);
        }
    }

    function projectLabel(project) {
        return project.description?.trim() ? `${project.name}（${project.description.trim()}）` : project.name;
    }

    function projectLabels(projects) {
        const labels = projects.map(projectLabel);
        return new Map(projects.map((project, i) => [project.id,
            labels.indexOf(labels[i]) === labels.lastIndexOf(labels[i]) ? labels[i] : `${labels[i]} · ${project.id.slice(0, 8)}`]));
    }

    function moveChat(record) {
        return showDialog('チャットの所属を変更', '適用', (context, fields) => {
            const select = field(fields, '移動先', node('select'));
            select.disabled = true;
            byId('dialog-submit').disabled = true;
            void Promise.all([db().listProjects(), db().getChatProject(record.id)]).then(([projects, current]) => {
                if (!ownsDialog(context)) return;
                const labels = projectLabels(projects);
                const option = (id, title) => new Option(title + ((current?.id ?? '') === id ? '（現在）' : ''), id);
                select.replaceChildren(option('', 'プロジェクトに所属しない'), ...projects.map(project => option(project.id, labels.get(project.id))));
                select.value = current?.id ?? '';
                select.disabled = false;
                byId('dialog-submit').disabled = false;
                context.save = () => db().setChatProject(record.id, select.value || null, {
                    expectedRecord: record, expectedProjectId: current?.id ?? null
                });
                select.focus({ preventScroll: true });
            }).catch(error => dialogError(context, error));
            return null;
        });
    }

    function dialogError(context, error) {
        if (ownsDialog(context)) byId('dialog-notice').textContent = error.message || String(error);
    }

    function chooseExisting(owner, kind) {
        const choosingChats = kind === 'chat';
        return showDialog(choosingChats ? '既存チャットを追加' : 'ファイルライブラリから追加', '追加', (context, fields) => {
            const search = field(fields, choosingChats ? 'チャット名で絞り込み' : 'ファイル名で絞り込み', node('input'));
            search.type = 'search';
            const list = node('div', '読み込み中…', 'project-picker-list');
            fields.append(list);
            const submit = byId('dialog-submit');
            submit.disabled = true;
            const load = choosingChats ? db().getProjectSidebarSnapshot() : Promise.all([
                db().listLibraryDocuments(), db().listProjectDocuments(owner.id)
            ]);
            void load.then(([records, projectsOrShared, memberships]) => {
                if (!ownsDialog(context) || view !== owner) return;
                const current = new Map(memberships?.map(link => [link.chatId, link.projectId]));
                const labels = choosingChats ? projectLabels(projectsOrShared) : null;
                const shared = new Set(choosingChats ? [] : projectsOrShared.map(entry => entry.id));
                const selected = new Set();
                const entries = choosingChats ? chatModels(records.filter(record => current.get(record.id) !== owner.id)) :
                    records.filter(record => !shared.has(record.id)).sort(window.DocumentLibraryUI.byName);
                const byRecord = new Map(records.map(record => [record.id, record]));
                const draw = () => {
                    const query = ui().normalizeHistoryText(search.value).toLocaleLowerCase('ja');
                    const matches = entries.filter(entry => (entry.title ?? entry.fileName).toLocaleLowerCase('ja').includes(query));
                    list.replaceChildren(...matches.map(entry => {
                        const label = node('label');
                        const input = node('input');
                        input.type = choosingChats ? 'radio' : 'checkbox';
                        input.name = 'project-choice';
                        input.checked = selected.has(entry.id);
                        input.addEventListener('change', () => {
                            if (choosingChats) selected.clear();
                            if (input.checked) selected.add(entry.id);
                            else selected.delete(entry.id);
                            submit.disabled = !selected.size;
                        });
                        const origin = labels?.get(current.get(entry.id));
                        label.append(input, node('span', (entry.title ?? entry.fileName) + (origin ? `（${origin} から移動）` : '')));
                        return label;
                    }));
                    if (!matches.length) list.textContent = query ? '該当する項目がありません。' : '追加できる項目がありません。';
                };
                search.addEventListener('input', draw);
                draw();
                context.save = async () => {
                    for (const id of [...selected]) {
                        if (!ownsDialog(context) || view !== owner) return;
                        if (choosingChats) await db().setChatProject(id, owner.id, {
                            expectedRecord: byRecord.get(id), expectedProjectId: current.get(id) ?? null
                        });
                        else await db().addProjectDocument(owner.id, id);
                        selected.delete(id);
                        const index = entries.findIndex(entry => entry.id === id);
                        if (index >= 0) entries.splice(index, 1);
                        draw();
                    }
                };
            }).catch(error => dialogError(context, error));
            return search;
        });
    }

    async function upload(owner, files) {
        const generation = dataGeneration;
        const errors = [];
        for (const file of files) {
            if (view !== owner || generation !== dataGeneration) break;
            let entry;
            try {
                entry = await window.DocumentLibraryUI.registerFile(file);
                if (generation !== dataGeneration) throw new Error('データが更新されました。');
                await db().addProjectDocument(owner.id, entry.id);
            } catch (error) {
                errors.push(`${file.name} — ${entry ? 'ライブラリに登録しました。共有に追加できませんでした。ライブラリから再選択できます。 ' : ''}${error.message || error}`);
            }
        }
        if (view === owner) {
            setNotice(owner, errors.join('\n'));
            void refresh(owner);
        } else if (errors.length) await ui().showCustomAlert(errors.join('\n'));
    }

    function dataChanged(detail) {
        if (detail.type === 'restore' || detail.replaced) {
            dataGeneration++;
            returns.clear();
            chatEntries.clear();
            if (dialog) byId('dialog').close();
            closeMenu();
        }
        if (view) void refresh(view);
        syncDraftLabel();
        window.DocumentLibraryUI?.refreshProjectPicker();
    }

    function syncDraftLabel() {
        const label = byId('draft-label');
        const messages = window.state.currentMessages;
        const id = window.state.currentChatId == null && db().projectDrafts?.get(messages);
        const generation = ++draftLabelGeneration;
        label.hidden = true;
        if (!id) return;
        void db().getProject(id).then(project => {
            if (generation !== draftLabelGeneration || messages !== window.state.currentMessages || window.state.currentChatId != null) return;
            label.textContent = project ? `プロジェクト「${project.name}」の新規チャット` : '所属予定のプロジェクトは削除されました';
            label.title = label.textContent;
            label.hidden = false;
        }).catch(() => {});
    }

    function install() {
        if (installed) return;
        installed = true;
        try { expanded = new Set(JSON.parse(localStorage.getItem(expansionKey) || '[]').filter(DocumentLibrary.isId)); }
        catch { expanded = new Set(); }
        byId('create').addEventListener('click', () => editProject());
        byId('back').addEventListener('click', () => {
            if (handoff) return;
            if (history.state?.projectId === view?.id) history.back();
            else close({ restoreFocus: true });
        });
        byId('options').addEventListener('click', () => { if (view) openMenu(byId('options'), view.id); });
        byId('file-add').addEventListener('click', () => { if (view) openMenu(byId('file-add'), view.id, ['add-file', 'upload']); });
        byId('menu').addEventListener('click', async event => {
            const action = event.target.closest('[data-project-action]')?.dataset.projectAction;
            if (!action || !menu) return;
            const { id, documentId } = menu;
            const owner = view;
            const generation = dataGeneration;
            closeMenu(true);
            try {
                if (action === 'add-file') { if (owner?.id === id) await chooseExisting(owner, 'document'); return; }
                if (action === 'upload') { if (owner?.id === id) chooseUpload(owner); return; }
                if (action === 'unlink-file') {
                    if (owner?.id === id) {
                        try {
                            await db().removeProjectDocument(id, documentId);
                            setNotice(owner, '');
                        } catch (error) { setNotice(owner, `共有を解除できませんでした。 ${error.message || error}`); }
                    }
                    return;
                }
                const project = await db().getProject(id);
                if (generation !== dataGeneration || view !== owner) return;
                if (!project) throw new Error('プロジェクトが見つかりません。');
                if (action === 'edit') await editProject(project);
                else await removeProject(project);
            } catch (error) { await ui().showCustomAlert(error.message || String(error)); }
        });
        document.addEventListener('pointerdown', event => {
            if (menu && !menu.anchor.contains(event.target) && !byId('menu').contains(event.target)) closeMenu();
        }, true);
        document.addEventListener('focusin', event => {
            if (menu && event.target !== menu.anchor && !byId('menu').contains(event.target)) closeMenu();
        });
        document.addEventListener('keydown', event => {
            if (!menu) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu(true);
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...byId('menu').querySelectorAll(':scope > :not([hidden])')];
                const current = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
                    (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next].focus({ preventScroll: true });
            }
        });
        window.addEventListener('resize', () => closeMenu());
        const viewport = window.visualViewport;
        const updateViewport = () => {
            const workspace = byId('workspace');
            if (viewport.scale > 1.01 || viewport.height >= window.innerHeight) workspace.style.removeProperty('--project-viewport-height');
            else workspace.style.setProperty('--project-viewport-height', `${viewport.height}px`);
        };
        viewport?.addEventListener('resize', updateViewport, { passive: true });
        document.addEventListener('scroll', event => {
            if (menu && (event.target === byId('content') || event.target.id === 'chat-sidebar-scroll')) closeMenu();
        }, true);
        byId('dialog-cancel').addEventListener('click', () => byId('dialog').close());
        byId('dialog').addEventListener('close', () => { if (!byId('dialog').open && dialog) finishDialog(dialog); });
        byId('form').addEventListener('submit', async event => {
            event.preventDefault();
            const context = dialog;
            if (!context || !context.save || context.busy || !ownsDialog(context)) return;
            context.busy = true;
            const submit = byId('dialog-submit');
            submit.disabled = true;
            byId('dialog-notice').textContent = '';
            try {
                await context.save();
                if (!ownsDialog(context)) return;
                context.completed = true;
                byId('dialog').close();
            } catch (error) { dialogError(context, error); }
            finally {
                context.busy = false;
                if (ownsDialog(context)) submit.disabled = false;
            }
        });
        byId('add-chat').addEventListener('click', () => { if (view) void chooseExisting(view, 'chat'); });
        for (const name of ['chats', 'files']) byId('tab-' + name).addEventListener('click', () => activateTab(name));
        byId('tabs').addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const name = event.key === 'Home' ? 'chats' : event.key === 'End' ? 'files' :
                event.target.id === 'project-tab-chats' ? 'files' : 'chats';
            activateTab(name);
            byId('tab-' + name).focus();
        });
        byId('model').addEventListener('click', () => { if (view) chooseDraftModel(view); });
        byId('input').addEventListener('input', event => {
            if (!view?.draft) return;
            const { draft } = view;
            draft.text = event.target.value;
            draft.changed = true;
            draft.notice = '';
            app().persistInputDraft(draft.key, draft.text);
            renderComposer();
        });
        byId('input').addEventListener('focusout', () => { if (view?.draft) persistDraft(view.draft); });
        byId('input').addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
            if (!event.ctrlKey && (!window.state.settings.enterToSend || event.shiftKey || event.altKey || event.metaKey)) return;
            event.preventDefault();
            if (!byId('send').disabled) byId('composer').requestSubmit();
        });
        byId('attach').addEventListener('click', () => {
            const draft = view?.draft;
            if (!draft) return;
            const input = byId('attachment-input');
            input.value = '';
            input.onchange = () => {
                const files = [...input.files];
                input.value = '';
                void addDraftAttachments(draft, files);
            };
            input.click();
        });
        byId('composer').addEventListener('dragover', event => {
            if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
        });
        byId('composer').addEventListener('drop', event => {
            if (!view?.draft || !event.dataTransfer?.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            void addDraftAttachments(view.draft, [...event.dataTransfer.files]);
        });
        byId('composer').addEventListener('submit', event => {
            event.preventDefault();
            void sendDraft();
        });
        window.addEventListener('execution-settings-changed', () => {
            if (!view) return;
            if (view.draft?.key !== app().getNewInputDraftContextKey(view.id)) attachDraft(view);
            else renderComposer();
        });
        window.addEventListener('pagehide', () => {
            if (view?.draft) persistDraft(view.draft);
        });
    }

    function chooseUpload(owner) {
        const input = byId('files');
        input.onchange = () => {
            const files = [...input.files];
            input.value = '';
            if (view === owner && files.length) void upload(owner, files);
        };
        input.click();
    }

    return { install, open, close, closeMenu, handleHistory, moveChat, renderSidebar, revealCurrentChat, dataChanged, syncDraftLabel,
        prepareForUpdate };
})();

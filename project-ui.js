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
    let dataGeneration = 0;
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
            }, 'chat-sidebar-item-open project-folder-toggle');
            toggle.dataset.projectFocus = 'expand';
            const titleLine = node('span', '', 'chat-sidebar-title-line');
            const folderIcon = icon(isExpanded ? 'folder_open' : 'folder');
            folderIcon.classList.add('project-folder-icon');
            titleLine.append(folderIcon, node('span', project.name, 'chat-sidebar-item-title'));
            toggle.append(titleLine);
            toggle.title = project.name;
            toggle.setAttribute('aria-expanded', String(isExpanded));
            toggle.setAttribute('aria-controls', 'project-members-' + project.id);
            const openButton = button('', () => open(project.id), 'chat-sidebar-item-menu project-folder-compose');
            openButton.dataset.projectFocus = 'open';
            openButton.append(icon('edit_square'));
            openButton.title = `「${project.name}」を開く`;
            openButton.setAttribute('aria-label', openButton.title);
            const options = button('', () => openMenu(options, project.id), 'chat-sidebar-item-menu project-folder-options');
            options.dataset.projectFocus = 'menu';
            options.append(icon('more_vert'));
            options.setAttribute('aria-label', `「${project.name}」のプロジェクト操作`);
            options.title = options.getAttribute('aria-label');
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
        if (anchor.closest('#project-sidebar')) positionSidebarMenu();
        else ui().positionRowMenu(element, anchor);
        element.querySelector(':scope > :not([hidden])')?.focus({ preventScroll: true });
    }

    function positionSidebarMenu() {
        if (menu?.anchor.closest('#project-sidebar') && !ui().positionSidebarRowMenu(byId('menu'), menu.anchor)) closeMenu();
    }

    function moveChatControls(toProject) {
        const chat = document.getElementById('chat-workspace');
        const header = document.querySelector('#chat-workspace > .app-header, #project-workspace > .app-header');
        const composer = ui().getComposerElement();
        for (const id of ['title', 'options']) byId(id).hidden = !toProject;
        for (const id of ['chat-title', 'goto-settings-btn']) document.getElementById(id).hidden = toProject;
        const input = document.getElementById('user-input');
        input.placeholder = toProject ? 'このプロジェクトでメッセージを送信…' : 'メッセージを入力...';
        if (toProject) {
            byId('workspace').prepend(header);
            byId('workspace').append(composer);
        } else {
            document.getElementById('header-trigger-area').after(header);
            chat.append(composer);
        }
        ui().scheduleComposerTextareaResize(true);
    }

    function open(id, { fromHistory = false } = {}) {
        if (!installed || handoff || app().chatParameterOperation || window.state.isEditingSystemPrompt ||
            window.state.isEditingChatTitle || window.state.editingMessageIndex !== null ||
            window.state.currentScreen !== 'chat' || !DocumentLibrary.isId(id)) return;
        if (app().attachmentOperation) {
            const navigation = app().chatNavigationV136 = {};
            void app().attachmentOperation.finished.then(() => {
                if (app().chatNavigationV136 === navigation) open(id, { fromHistory });
            });
            return;
        }
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
        app().flushInputDraft();
        view = { id, returnFocus, scroller, scrollTop: previous?.scrollTop ?? scroller.scrollTop,
            origin: app().captureChatViewForProject(), version: 0, notice: '' };
        if (!fromHistory) {
            const method = returnState?.projectId ? 'replaceState' : 'pushState';
            history[method]({ screen: 'chat', projectId: id }, '', '#chat');
        }
        byId('workspace').hidden = false;
        moveChatControls(true);
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
        byId('title').focus({ preventScroll: true });
        void refresh(view);
    }

    function close({ fromHistory = false, restoreFocus = false, sent = false } = {}) {
        closeMenu();
        if (dialog) byId('dialog').close();
        if (!view) return;
        window.DocumentLibraryUI.closeProjectPicker();
        window.settingsUiV136?.closePopover(false);
        const previous = view;
        if (!sent) saveProfileDraft();
        view = null;
        ui().closeHistoryItemMenu();
        byId('workspace').hidden = true;
        moveChatControls(false);
        if (!sent) app().restoreChatViewForProject(previous.origin);
        if (!fromHistory && history.state?.projectId) history.replaceState({ screen: 'chat' }, '', '#chat');
        ui().syncChatWorkspaceInteractivity();
        ui().syncChatSidebarCurrentSelection();
        if (previous.origin.values.currentMessages === window.state.currentMessages) {
            previous.scroller.scrollTop = previous.scrollTop;
            if (restoreFocus) {
                const target = previous.returnFocus?.getClientRects().length && !previous.returnFocus.closest('[inert]')
                    ? previous.returnFocus : document.getElementById('goto-history-btn');
                target.focus({ preventScroll: true });
            }
        }
    }

    async function handleHistory(entry) {
        if (handoff) {
            // Finish the atomic first save before swapping the shared composer.
            await handoff.finished;
            if (history.state?.projectId !== entry?.projectId ||
                history.state?.projectChatToken !== entry?.projectChatToken) return;
        }
        if (view && entry?.projectId !== view.id) close({ fromHistory: true, restoreFocus: !entry?.documentLibrary && !entry?.projectId });
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
        for (const id of ['options', 'file-add']) byId(id).disabled = !ready;
        if (view) view.ready = ready;
        ui().updateComposerSendButton();
    }

    function setNotice(owner, message) {
        if (view !== owner) return;
        owner.notice = message;
        byId('notice').textContent = message;
    }

    function activateTab(tab) {
        if (!view) return;
        ui().closeHistoryItemMenu();
        closeMenu();
        tabs.set(view.id, tab);
        for (const name of ['chats', 'files']) {
            const selected = tab === name;
            const button = byId('tab-' + name);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
        }
        byId('content').scrollTop = 0;
    }

    function attachDraft(owner) {
        const key = app().getNewInputDraftContextKey(owner.id);
        const saved = drafts.get(key);
        const readSetting = setting => {
            try { return JSON.parse(sessionStorage.getItem(app().getProjectDraftSettingsKey(setting, owner.id))); }
            catch { return null; }
        };
        const execution = saved?.execution ?? readSetting(SettingsV136.DRAFT_KEY) ?? (owner.origin.profileId === window.state.activeProfileId
            ? owner.origin.values.currentExecutionSettings : null);
        owner.draftKey = key;
        app().startNewChat({ projectId: owner.id, homeDraft: {
            text: saved?.text ?? app().loadInputDraftLocal(key)?.text ?? '',
            attachments: saved?.attachments ?? [],
            execution: execution?.modelRef || execution?.modelSelectionRequired
                ? app().clearUnavailableExecutionSelectionV136(execution) : app().newChatExecutionDefaults(),
            parameters: saved?.parameters ?? readSetting(SettingsV136.CHAT_PARAMETER_DRAFT_KEY) ?? app().profileChatParameters(window.state.settings)
        } });
        if (!saved) app().scheduleInputDraftRestore(0, true);
    }

    function saveProfileDraft() {
        if (!view || handoff || window.state.currentChatId != null) return;
        app().flushInputDraft();
        const state = window.state;
        drafts.set(view.draftKey, {
            text: document.getElementById('user-input').value,
            attachments: [...state.pendingAttachments],
            execution: state.currentExecutionSettings,
            parameters: { systemPrompt: state.currentSystemPrompt, generationParameters: app().getChatGenerationParameters() }
        });
    }

    function restoreProfileDraft() {
        if (!view) return false;
        const owner = view;
        // Profile switch clears its operation guard in finally before changing the composer context.
        queueMicrotask(() => { if (view === owner) attachDraft(owner); });
        return true;
    }

    function prepareForUpdate() {
        if (handoff) return false;
        for (const [key, draft] of drafts) {
            if (draft.attachments.length) return false;
            if (draft.text && app().loadInputDraftLocal(key)?.text !== draft.text) return false;
        }
        return !view?.origin.attachments.length;
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

    async function openChat(chatId) {
        const owner = view;
        if (!owner || handoff) return;
        if (app().attachmentOperation?.finished) await app().attachmentOperation.finished;
        if (view !== owner || handoff) return;
        const token = rememberOrigin(owner, owner.origin);
        const result = await window.chatHistoryActions.open(chatId, { keepProjectHistory: true });
        if (result?.ok && token && history.state?.projectReturn === token) {
            pushChatEntry(result.chatId, token);
        }
        return result;
    }

    function beginSend() {
        const owner = view;
        if (!owner?.ready || handoff) return null;
        saveProfileDraft();
        const token = rememberOrigin(owner, owner.origin);
        const attempt = handoff = {};
        attempt.finished = new Promise(resolve => { attempt.finish = resolve; });
        return {
            onInitialSave(session) {
                if (handoff !== attempt) return;
                drafts.delete(owner.draftKey);
                handoff = null;
                attempt.finish();
                if (view !== owner || window.state.currentMessages !== session.messages) return;
                if (history.state?.projectId !== owner.id) {
                    close({ fromHistory: true, sent: true });
                    app().restoreChatViewForProject(owner.origin);
                    return;
                }
                close({ fromHistory: true, sent: true });
                if (token && history.state?.projectReturn === token) pushChatEntry(session.chatId, token);
                app().scrollToBottom();
            },
            onFinished() {
                if (handoff === attempt) handoff = null;
                attempt.finish();
            }
        };
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
            openButton.addEventListener('click', () => openChat(model.id));
            const stamp = model.updatedAt && new Date(model.updatedAt);
            if (stamp && Number.isFinite(stamp.getTime())) {
                const time = node('time', new Intl.DateTimeFormat('ja', { year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit' }).format(stamp), 'chat-sidebar-item-snippet');
                time.dateTime = stamp.toISOString();
                openButton.append(time);
            }
            const options = item.querySelector('[data-sidebar-action="menu"]');
            options.addEventListener('click', () => {
                ui().closeHistoryItemMenu();
                ui().showSidebarMenu(options, byChat.get(model.id), 'project', owner.id);
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
        window.DocumentLibraryUI.renderRows({ kind: 'project' }, list, entries,
            entry => window.DocumentLibraryUI.openProjectPreview(entry, owner.id), 'project-menu',
            (_, anchor, entry) => openMenu(anchor, owner.id, ['unlink-file'], entry.id));
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

    async function editProject(project = null, assignment) {
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
                else created = await db().createProject(values, assignment);
            };
            return name;
        });
        if (result.ok && created && !assignment) open(created.id);
        return result;
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

    async function moveChat(record, currentProjectId, destination) {
        if (destination === 'new') return editProject(null, { record, currentProjectId });
        await db().setChatProject(record.id, destination, { expectedRecord: record, expectedProjectId: currentProjectId });
        return { ok: true };
    }

    function dialogError(context, error) {
        if (ownsDialog(context)) byId('dialog-notice').textContent = error.message || String(error);
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
        window.DocumentLibraryUI?.refreshProjectPicker();
    }

    function install() {
        if (installed) return;
        installed = true;
        try { expanded = new Set(JSON.parse(localStorage.getItem(expansionKey) || '[]').filter(DocumentLibrary.isId)); }
        catch { expanded = new Set(); }
        byId('create').addEventListener('click', () => editProject());
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
                if (action === 'add-file') {
                    if (owner?.id === id) window.DocumentLibraryUI.openProjectPicker(id, () => view === owner && dataGeneration === generation);
                    return;
                }
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
        window.addEventListener('resize', () => {
            if (menu && !menu.anchor.closest('#project-sidebar')) closeMenu();
        });
        document.addEventListener('scroll', event => {
            if (menu && event.target === byId('content') && !menu.anchor.closest('#project-sidebar')) closeMenu();
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
        for (const name of ['chats', 'files']) byId('tab-' + name).addEventListener('click', () => activateTab(name));
        byId('tabs').addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const name = event.key === 'Home' ? 'chats' : event.key === 'End' ? 'files' :
                event.target.id === 'project-tab-chats' ? 'files' : 'chats';
            activateTab(name);
            byId('tab-' + name).focus();
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

    return { install, open, close, closeMenu, positionSidebarMenu, handleHistory, moveChat, projectLabels, renderSidebar, revealCurrentChat, dataChanged,
        prepareForUpdate, saveProfileDraft, restoreProfileDraft, beginSend, openChat, isReady: () => view?.ready === true,
        isSavingFirstMessage: () => Boolean(handoff) };
})();

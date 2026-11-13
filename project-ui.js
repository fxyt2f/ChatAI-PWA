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
    let installed = false, view, dialog, menu, sidebar, expanded, currentChat;
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
        if (!installed) return;
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

    function openMenu(anchor, id) {
        if (menu?.anchor === anchor) return closeMenu(true);
        closeMenu();
        ui().closeHistoryItemMenu();
        const element = byId('menu');
        menu = { anchor, id };
        anchor.setAttribute('aria-expanded', 'true');
        anchor.closest('.chat-sidebar-item')?.classList.add('menu-active');
        element.hidden = false;
        ui().positionRowMenu(element, anchor);
        element.firstElementChild.focus({ preventScroll: true });
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

    function handleHistory(entry) {
        if (entry?.projectId && !entry.documentLibrary) {
            if (dialog) byId('dialog').close();
            open(entry.projectId, { fromHistory: true });
        }
        else close({ fromHistory: true, restoreFocus: !entry?.documentLibrary });
    }

    function setViewReady(ready) {
        for (const id of ['options', 'new-chat', 'add-chat', 'add-document', 'upload-document']) byId(id).disabled = !ready;
    }

    function setNotice(owner, message) {
        if (view !== owner) return;
        owner.notice = message;
        byId('notice').textContent = message;
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
        const signature = JSON.stringify(models.map(({ id, title, isPinned, updatedAt }) => [id, title, isPinned, updatedAt]));
        if (owner.chatSignature === signature) return;
        owner.chatSignature = signature;
        if (!models.length) return emptyList(list, 'チャットはありません。');
        const byChat = new Map(records.map(record => [record.id, record]));
        list.replaceChildren(...models.map(model => {
            const item = ui().createChatSidebarItem(model);
            item.querySelector('[data-sidebar-action="open"]').addEventListener('click', () => window.chatHistoryActions.open(model.id));
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
        if (!entries.length) return emptyList(list, '共有資料はありません。');
        list.replaceChildren(...entries.map(entry => {
            const item = node('li', '', 'project-document-row');
            const preview = button('', () => window.DocumentLibraryUI.openProjectPreview(entry, owner.id), 'chat-sidebar-item-open');
            preview.append(node('span', entry.fileName, 'chat-sidebar-item-title'),
                node('span', `版 ${entry.version}`, 'chat-sidebar-item-snippet'));
            const remove = button('共有を解除', async () => {
                remove.disabled = true;
                try {
                    await db().removeProjectDocument(owner.id, entry.id);
                    setNotice(owner, '');
                    await refresh(owner);
                } catch (error) {
                    setNotice(owner, `共有を解除できませんでした。 ${error.message || error}`);
                } finally { remove.disabled = false; }
            });
            remove.setAttribute('aria-label', `「${entry.fileName}」の共有を解除`);
            item.append(preview, remove);
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
            `「${project.name}」のプロジェクト本体を削除しますか？\n\n所属チャットは削除されず、未所属に戻ります。共有資料との関連付けは解除され、ライブラリの原本と旧版は残ります。`,
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
        return showDialog(choosingChats ? '既存チャットを追加' : 'ライブラリから追加', '追加', (context, fields) => {
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
            if (history.state?.projectId === view?.id) history.back();
            else close({ restoreFocus: true });
        });
        byId('options').addEventListener('click', () => { if (view) openMenu(byId('options'), view.id); });
        byId('menu').addEventListener('click', async event => {
            const action = event.target.closest('[data-project-action]')?.dataset.projectAction;
            if (!action || !menu) return;
            const { id } = menu;
            const owner = view;
            const generation = dataGeneration;
            closeMenu(true);
            try {
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
                const items = [...byId('menu').children];
                const current = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
                    (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next].focus({ preventScroll: true });
            }
        });
        window.addEventListener('resize', () => closeMenu());
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
        byId('new-chat').addEventListener('click', async () => {
            const owner = view;
            if (owner) await app().confirmStartNewChat({ projectId: owner.id, ownsProjectView: () => view === owner });
        });
        byId('add-chat').addEventListener('click', () => { if (view) void chooseExisting(view, 'chat'); });
        byId('add-document').addEventListener('click', () => { if (view) void chooseExisting(view, 'document'); });
        byId('upload-document').addEventListener('click', () => {
            if (!view) return;
            const input = byId('files');
            const owner = view;
            input.onchange = () => {
                const files = [...input.files];
                input.value = '';
                if (view === owner && files.length) void upload(owner, files);
            };
            input.click();
        });
    }

    return { install, open, close, closeMenu, handleHistory, moveChat, renderSidebar, revealCurrentChat, dataChanged, syncDraftLabel };
})();

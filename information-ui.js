/* Editors for the existing chat and profile records. */
(function (root) {
    'use strict';

    const titles = {
        character: 'キャラクターメモリ',
        scenario: 'シナリオ情報',
        profile: 'プロファイルメモリ',
        summary: '会話要約'
    };
    const baseFields = {
        status: '状態', current_location: '現在地', summary: '概要', short_term_goal: '短期目標'
    };
    const styleFields = {
        first_person: '一人称', sentence_ender: '語尾・言い回し', dialect: '方言',
        politeness: '丁寧さ（0〜1）', description: '説明', profile_name: 'プリセット名'
    };
    const sceneFields = {
        scene_id: 'シーンID', location: '場所', time_of_day: '時間帯', mood: '雰囲気', pov: '視点', notes: '補足'
    };
    const memoryPath = ['persistentMemory'];
    const memoryRecord = 'character_memory_';
    const statusRecord = 'character_';
    const narration = '地の文';
    const autosaveDelay = 650;
    const $ = id => document.getElementById(id);
    const isObject = value => value !== null && typeof value === 'object';
    const isRecord = value => isObject(value) && !Array.isArray(value);
    const pairs = value => isRecord(value) ? Object.entries(value) : [];
    const equal = (a, b) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
    const clone = value => structuredClone(value);
    const invalidKey = key => ['__proto__', 'constructor', 'prototype'].includes(key);

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function read(value, path) {
        for (const key of path) value = isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
        return value;
    }

    function write(target, path, value) {
        const last = path.at(-1);
        for (const key of path.slice(0, -1)) {
            if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, {
                value: {}, enumerable: true, configurable: true, writable: true
            });
            target = target[key];
            if (!isObject(target)) throw new Error('保存済みデータの構造が変更されています。');
        }
        if (value === undefined) delete target[last];
        else Object.defineProperty(target, last, { value, enumerable: true, configurable: true, writable: true });
    }

    function characterSources(memory) {
        const sources = new Map();
        const add = (name, kind, path) => {
            const exact = sources.get(name) || { name, paths: {} };
            exact.paths[kind] = [...memoryPath, ...path];
            sources.set(name, exact);
        };
        for (const [key, value] of pairs(memory)) {
            if (key.startsWith(memoryRecord) && key.length > memoryRecord.length) add(key.slice(memoryRecord.length), 'memory', [key]);
            else if (key.startsWith(statusRecord) && key.length > statusRecord.length && isRecord(value))
                add(key.slice(statusRecord.length), 'status', [key]);
        }
        for (const [name] of pairs(memory.inventories)) add(name, 'inventory', ['inventories', name]);
        for (const [name] of pairs(memory.style_profiles))
            if (normalizeCharacterName(name) !== narration) add(name, 'style', ['style_profiles', name]);

        // Exact names are grouped first. Only combine spelling variants when
        // each store has at most one candidate for the normalized name.
        const byName = new Map();
        for (const source of sources.values()) {
            const normalized = normalizeCharacterName(source.name) || source.name;
            const group = byName.get(normalized) || [];
            group.push(source);
            byName.set(normalized, group);
        }
        const characters = [];
        for (const [normalized, group] of byName) {
            const entries = group.flatMap(entry => Object.entries(entry.paths));
            if (new Set(entries.map(([kind]) => kind)).size === entries.length) {
                characters.push({ id: JSON.stringify([normalized]), name: normalized, paths: Object.fromEntries(entries) });
            } else {
                for (const entry of group) {
                    characters.push({ ...entry, label: '「' + entry.name + '」', id: JSON.stringify([normalized, entry.name]) });
                }
            }
        }
        return characters;
    }

    class InformationUI extends CategoryPane {
        constructor(options) {
            super({ ...options, name: 'information', title: '情報管理', titles });
            this.contexts = new WeakMap();
            this.pendingChats = new Map();
            this.sizing = new TextareaSizing();
            this.memoryContent = $('memory-management-content');
            this.memoryHome = this.memoryContent.parentElement;
            this.memoryNext = this.memoryContent.nextElementSibling;
            this.sizing.observe($('new-memory-input'));
            this.backButton.addEventListener('click', () => this.back());
            this.detail.addEventListener('focusout', event => {
                if (event.target.matches('[data-information-edit]')) void this.flushPending();
                if (this.refreshPending) requestAnimationFrame(() => this.refresh());
            });
            $('information-memory-enabled').addEventListener('change', async event => {
                const control = event.currentTarget;
                const enabled = control.checked;
                control.disabled = true;
                const owner = this.state.currentMessages;
                const success = await this.app.toggleChatMemory(enabled);
                if (this.state.currentMessages !== owner) return;
                this.refresh();
                if (!success) $('information-memory-status').textContent = '記憶の利用設定を保存できませんでした。';
            });
            chatListChangeController.subscribe(event => {
                if (event.type === 'restore' || (event.type === 'save' && event.chatId === this.state.currentChatId)) this.refresh();
            });
            window.addEventListener('execution-settings-changed', event => {
                if (event.detail?.type === 'profile') this.refresh();
            });
        }

        get context() {
            const owner = this.state.currentMessages;
            if (!this.contexts.has(owner)) {
                const identity = this.chatIdentity(owner);
                const pending = identity && this.pendingChats.get(identity.id);
                const context = pending && pending.record === identity.record ? pending.context
                    : { drafts: new Map(), closed: new Map(), character: null };
                this.contexts.set(owner, context);
            }
            return this.contexts.get(owner);
        }

        chatIdentity(owner) {
            const saved = dbUtils.chatSaveOwners?.get(owner);
            const record = saved?.recordGenerationId ?? saved?.createdAt;
            return saved?.id != null && record != null ? { id: saved.id, record } : null;
        }

        retainPending(owner, context) {
            const identity = this.chatIdentity(owner);
            if (!identity) return;
            const previous = this.pendingChats.get(identity.id);
            if (previous && previous.record !== identity.record && owner !== this.state.currentMessages) return;
            if ([...context.drafts.values()].some(draft => draft.changes.size || draft.invalid.size)) {
                this.pendingChats.set(identity.id, { record: identity.record, context });
            } else if (previous?.context === context) this.pendingChats.delete(identity.id);
        }

        get selectedCategory() { return this.category; }

        get draft() {
            const { drafts } = this.context;
            if (!drafts.has(this.selectedCategory)) drafts.set(this.selectedCategory, {
                changes: new Map(), invalid: new Map(), message: '', error: ''
            });
            return drafts.get(this.selectedCategory);
        }

        get source() {
            return {
                persistentMemory: this.state.currentPersistentMemory || {},
                summarizedContext: this.state.currentSummarizedContext
            };
        }

        display() { this.refresh(true); }
        selectCategory(category, push = true) {
            if (this.state.currentScreen === this.name) void this.flushPending();
            super.selectCategory(category, push);
            this.refresh();
        }
        afterLayout() {
            this.refresh();
            this.sizing.syncPromptSizes();
        }

        leave() {
            super.leave();
            void this.flushPending();
            this.refreshPending = false;
            this.rendered = null;
            this.memoryHome.insertBefore(this.memoryContent, this.memoryNext);
        }

        refresh(force = false) {
            const owner = this.state.currentMessages;
            const context = this.contexts.get(owner);
            if (context && !context.timer && !context.saving && this.app.canEditChatInformation()) {
                this.scheduleAutosave(owner, context);
            }
            if (this.state.currentScreen !== this.name || !this.selectedCategory) return;
            if (this.selectedCategory === 'profile') {
                this.refreshProfileControls();
                return;
            }
            this.updateEditor();
            const model = this.source;
            const sameView = this.rendered?.owner === owner && this.rendered?.category === this.selectedCategory;
            if (!force && sameView && context?.saving) return;
            if (!force && sameView && equal(this.rendered.model, model)) return;
            if (!force && sameView && this.detail.contains(document.activeElement)
                && document.activeElement.matches('textarea, input, select')) {
                this.refreshPending = true;
                return;
            }
            this.refreshPending = false;
            this.rendered = { owner, category: this.selectedCategory, model: clone(model) };
            this.renderEditor();
            if (!context && this.app.canEditChatInformation()) this.scheduleAutosave(owner, this.context);
        }

        async refreshProfile(profileId) {
            if (this.state.currentScreen !== this.name || this.selectedCategory !== 'profile' || profileId !== this.state.activeProfileId) return;
            try { await this.app.loadMemoryManagement(profileId); }
            catch {
                if (this.state.currentScreen === this.name && this.selectedCategory === 'profile' && profileId === this.state.activeProfileId)
                    $('memory-list-container').textContent = '記憶を読み込めませんでした。';
            }
        }

        refreshProfileControls() {
            const { activeProfileId, activeProfile } = this.state;
            $('information-profile-name').textContent = activeProfile?.name || 'プロファイルを読み込み中';
            const enabled = $('information-memory-enabled');
            enabled.checked = this.state.isMemoryEnabledForChat;
            enabled.disabled = !this.app.canEditChatInformation();
            if (!this.state.settings.enableMemory)
                $('information-memory-status').textContent = '全体の記憶機能は設定画面で無効になっています。';
            else if (enabled.disabled)
                $('information-memory-status').textContent = '応答生成・会話更新中は閲覧できます。';
            else $('information-memory-status').textContent = '';
            const attached = this.memoryContent.parentElement === $('information-memory-slot');
            if (!attached || this.memoryProfile !== activeProfileId) {
                this.memoryProfile = activeProfileId;
                $('information-memory-slot').append(this.memoryContent);
                $('memory-list-container').textContent = activeProfileId ? '読み込み中…' : '';
                void this.refreshProfile(activeProfileId);
                this.sizing.syncPromptSizes();
            }
        }

        workingModel() {
            const data = clone(this.rendered.model);
            for (const { path, value } of this.draft.changes.values()) {
                try { write(data, path, clone(value)); }
                catch {
                    // A concurrent structural change is reported when saving.
                }
            }
            return data;
        }

        stage(path, value) {
            const owner = this.state.currentMessages;
            const { context, draft } = this;
            const id = JSON.stringify(path);
            const existing = draft.changes.get(id);
            const original = existing ? existing.before : read(this.rendered.model, path);
            if (equal(value, original) && !context.inFlight?.has(id)) draft.changes.delete(id);
            else draft.changes.set(id, { path, value, before: clone(original) });
            draft.message = '';
            draft.error = '';
            this.retainPending(owner, context);
            this.scheduleAutosave(owner, context);
            this.updateEditor();
        }

        canEdit() { return this.app.canEditChatInformation({ allowOwnSave: Boolean(this.context.saving) }); }

        updateEditor() {
            const panel = document.querySelector('[data-information-panel="' + this.selectedCategory + '"]');
            if (!panel || this.selectedCategory === 'profile' || this.rendered?.owner !== this.state.currentMessages ||
                this.rendered.category !== this.selectedCategory) return;
            const { invalid, message, error } = this.draft;
            const blocked = !this.canEdit();
            for (const button of panel.querySelectorAll('[data-information-edit]')) button.disabled = blocked;
            for (const button of panel.querySelectorAll('[data-information-structure]')) button.disabled = blocked || invalid.size > 0;
            const status = panel.querySelector('.information-editor-status');
            const saveError = error || [...this.context.drafts.values()].find(draft => draft.error)?.error;
            status.textContent = saveError || message || (invalid.size ? '入力値を確認してください。'
                : blocked ? '応答生成・会話更新中は閲覧できます。' : '');
            status.toggleAttribute('data-save-error', Boolean(saveError));
            status.hidden = !status.textContent;
        }

        saveableDrafts(context) {
            return [...context.drafts.values()].filter(draft => draft.changes.size && !draft.invalid.size && !draft.error);
        }

        scheduleAutosave(owner, context) {
            clearTimeout(context.timer);
            context.timer = null;
            if (!this.saveableDrafts(context).length) return;
            context.timer = setTimeout(() => {
                context.timer = null;
                void this.flushPending(owner);
            }, autosaveDelay);
        }

        flushPending(owner = this.state.currentMessages) {
            const context = this.contexts.get(owner);
            if (!context || owner !== this.state.currentMessages) return;
            clearTimeout(context.timer);
            context.timer = null;
            context.flushRequested = true;
            if (context.saving) return context.saving;
            const drafts = this.saveableDrafts(context);
            if (!drafts.length || !this.app.canEditChatInformation()) return;
            context.flushRequested = false;
            const changes = drafts.flatMap(draft => [...draft.changes].map(([id, change]) => ({ draft, id, change })));
            context.inFlight = new Set(changes.map(({ id }) => id));
            context.saving = this.persist(owner, context, changes);
            return context.saving;
        }

        async persist(owner, context, changes) {
            try {
                await this.app.saveChatInformation(owner, chat => {
                    for (const { change: { path, before } } of changes) {
                        if (!equal(read(chat, path), before)) {
                            throw new Error('編集した項目が別の操作で更新されました。未保存の編集を保持しています。');
                        }
                    }
                    const update = {};
                    for (const { change: { path, value } } of changes) {
                        const key = path[0];
                        if (path.length > 1 && !Object.hasOwn(update, key)) update[key] = clone(chat[key]) || {};
                        write(update, path, clone(value));
                    }
                    return update;
                });
                for (const { draft, id, change: { path, value } } of changes) {
                    const latest = draft.changes.get(id);
                    if (latest && equal(latest.value, value)) draft.changes.delete(id);
                    else if (latest) latest.before = clone(value);
                    if (this.rendered?.owner === owner) {
                        try { write(this.rendered.model, path, clone(value)); }
                        catch { this.refreshPending = true; }
                    }
                }
            } catch (error) {
                const message = '自動保存に失敗しました。編集内容は保持されています。' + (error?.message ? ' ' + error.message : '');
                for (const { draft, id, change } of changes) {
                    const latest = draft.changes.get(id);
                    if (latest && equal(latest.value, latest.before)) draft.changes.delete(id);
                    if (latest === change) draft.error = message;
                }
                if (owner === this.state.currentMessages && (this.state.currentScreen !== this.name ||
                    !this.selectedCategory || this.selectedCategory === 'profile')) {
                    void this.ui.showCustomAlert(message);
                }
            } finally {
                context.saving = null;
                context.inFlight = null;
                this.retainPending(owner, context);
                if (context.flushRequested) await this.flushPending(owner);
                this.refresh();
            }
        }

        button(text, callback, action) {
            const button = element('button', null, text);
            button.type = 'button';
            if (action) button.dataset[action] = '';
            button.addEventListener('click', callback);
            return button;
        }

        actions(parent, ...children) {
            const row = element('div', 'information-actions');
            row.append(...children);
            parent.append(row);
        }

        group(parent, title, key, open = true) {
            const section = element(key ? 'details' : 'section', key ? 'information-record' : 'settings-group');
            if (!key) {
                if (title) section.append(element('h2', null, title));
                parent.append(section);
                return section;
            }
            const context = this.context;
            section.open = context.closed.get(key) ?? open;
            section.append(element('summary', null, title));
            section.addEventListener('toggle', () => {
                if (!section.isConnected) return;
                context.closed.set(key, section.open);
                if (section.open) this.sizing.syncPromptSizes();
            });
            const content = element('div', 'settings-group');
            section.append(content);
            parent.append(section);
            return content;
        }

        field(parent, label, path, relative, options = {}) {
            const stored = read(this.working, [...path, ...relative]);
            const value = stored === undefined ? options.default ?? '' : stored;
            const mode = value === null && options.nullable ? 'nullable' :
                typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' :
                    typeof value === 'string' ? 'text' : 'json';
            const group = element('label', 'settings-field');
            group.append(element('span', null, label));
            const multiline = options.long || options.compact || mode === 'json';
            const control = element(mode === 'boolean' ? 'select' : multiline ? 'textarea' : 'input');
            const compact = options.compact && mode === 'text';
            if (compact) {
                control.classList.add('information-compact-textarea');
                control.rows = 1;
            }
            control.dataset.informationEdit = '';
            const id = JSON.stringify([...path, ...relative]);
            if (mode === 'boolean') {
                control.add(new Option('はい', 'true'));
                control.add(new Option('いいえ', 'false'));
            } else if (mode === 'number') control.inputMode = 'decimal';
            const formatted = mode === 'json' ? JSON.stringify(value, null, 2) :
                mode === 'nullable' || (stored === undefined && mode === 'number') ? '' : String(value);
            control.value = this.draft.invalid.get(id) ?? (mode === 'text' && options.normalize ? options.normalize(formatted) : formatted);
            control.setAttribute('aria-invalid', String(this.draft.invalid.has(id)));
            const view = this.rendered;
            const updateValue = event => {
                if (event.isComposing || this.rendered !== view || !control.isConnected || !this.canEdit()) return;
                const raw = control.value;
                let input = mode === 'text' && options.normalize ? options.normalize(raw) : raw;
                try {
                    if (options.nonempty && !raw.trim()) throw new Error();
                    if (mode === 'number') {
                        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) throw new Error();
                        input = Number(raw);
                        if (!Number.isFinite(input) || (options.integer && !Number.isSafeInteger(input))
                            || (options.min !== undefined && input < options.min)
                            || (options.max !== undefined && input > options.max)) throw new Error();
                    } else if (mode === 'boolean') input = raw === 'true';
                    else if (mode === 'nullable') input = raw === '' ? null : raw;
                    else if (mode === 'json') {
                        input = JSON.parse(raw);
                        if (input === null ? value !== null : value === null || typeof value !== typeof input
                            || Array.isArray(input) !== Array.isArray(value)) throw new Error();
                    }
                    this.draft.invalid.delete(id);
                    control.setAttribute('aria-invalid', 'false');
                    this.editValue(path, relative, input);
                } catch {
                    this.draft.invalid.set(id, raw);
                    this.retainPending(this.state.currentMessages, this.context);
                    control.setAttribute('aria-invalid', 'true');
                    this.updateEditor();
                }
            };
            control.addEventListener('input', updateValue);
            control.addEventListener('compositionend', updateValue);
            group.append(control);
            parent.append(group);
            if (control instanceof HTMLTextAreaElement) {
                this.sizing.observe(control, { compact });
                if (mode === 'text' && options.normalize) {
                    control.addEventListener('blur', () => {
                        const normalized = options.normalize(control.value);
                        if (normalized === control.value) return;
                        control.value = normalized;
                        this.sizing.sizePrompt(control);
                    });
                }
            }
            return control;
        }

        editValue(path, relative, input) {
            if (!relative.length) {
                this.stage(path, input);
                write(this.working, path, input);
                return;
            }
            const record = clone(read(this.working, path)) ?? {};
            write(record, relative, input);
            this.stage(path, record);
            write(this.working, path, record);
        }

        async promptName(label, value = '') {
            const owner = this.state.currentMessages, category = this.selectedCategory;
            const response = await this.ui.showCustomPrompt(label, value);
            if (!this.ownsEditor(owner, category)) return null;
            const name = response?.trim();
            if (!name) return null;
            if (invalidKey(name)) {
                this.report('この名前は使用できません。');
                return null;
            }
            return name;
        }

        ownsEditor(owner, category) {
            return this.state.currentScreen === this.name && this.state.currentMessages === owner && this.selectedCategory === category
                && this.canEdit();
        }

        report(message) {
            this.draft.message = message;
            this.updateEditor();
        }

        changeStructure(path, relative, value, focusText) {
            try {
                this.editValue(path, relative, value);
                this.renderEditor(focusText);
            } catch (error) {
                this.report(error.message || '項目を変更できませんでした。');
            }
        }

        deleteButton(label, message, apply) {
            const button = this.button(label, async () => {
                const owner = this.state.currentMessages, category = this.selectedCategory, view = this.rendered;
                if (!await this.ui.showCustomConfirm(message) || !this.ownsEditor(owner, category) || this.rendered !== view) return;
                apply();
            }, 'informationStructure');
            button.classList.add('dialog-delete-btn');
            return button;
        }

        renderEditor(focusText) {
            const panel = document.querySelector('[data-information-panel="' + this.selectedCategory + '"]');
            const scroll = this.detail.scrollTop;
            this.working = this.workingModel();
            const fields = element('div', 'information-editor');
            const render = { character: this.characters, scenario: this.scenario, summary: this.summary };
            const status = element('p', 'information-editor-status');
            status.setAttribute('role', 'status');
            status.hidden = true;
            panel.replaceChildren(status, fields);
            render[this.selectedCategory].call(this, fields);
            this.sizing.prune();
            this.sizing.syncPromptSizes();
            this.detail.scrollTop = scroll;
            this.updateEditor();
            if (focusText) {
                const candidates = [...panel.querySelectorAll('button, summary')];
                (candidates.find(button => button.textContent === focusText && !button.disabled) ||
                    panel.querySelector('select, button:not(:disabled), summary'))?.focus({ preventScroll: true });
            }
        }

        dictionary(parent, path, title, numeric, initial) {
            const key = JSON.stringify(path);
            const group = this.group(parent, title, key);
            const record = read(this.working, path);
            if (record !== undefined && !isRecord(record)) {
                this.field(group, '保存値', path, [], { long: true });
                return;
            }
            for (const [name] of pairs(record)) {
                const row = element('div', 'information-fields');
                this.field(row, name, path, [name], numeric);
                const rename = this.button('名前を変更', async () => {
                    const view = this.rendered;
                    const next = await this.promptName('新しい名前', name);
                    if (!next || next === name || view !== this.rendered) return;
                    const value = read(this.working, path);
                    if (Object.hasOwn(value, next)) return this.report('同じ名前の項目があります。');
                    const updated = Object.fromEntries(Object.entries(value).map(([entry, count]) =>
                        [entry === name ? next : entry, count]));
                    this.changeStructure(path, [], updated, '名前を変更');
                }, 'informationStructure');
                row.append(rename, this.deleteButton('削除', name + 'を削除しますか？', () =>
                    this.changeStructure(path, [name], undefined, '追加')));
                group.append(row);
            }
            this.actions(group, this.button('追加', async () => {
                const view = this.rendered;
                const name = await this.promptName('項目の名前');
                if (!name || view !== this.rendered) return;
                if (Object.hasOwn(read(this.working, path) || {}, name)) return this.report('同じ名前の項目があります。');
                this.changeStructure(path, [name], initial, '追加');
            }, 'informationStructure'));
        }

        style(parent, path, title) {
            const group = this.group(parent, title, JSON.stringify(path));
            const value = read(this.working, path);
            if (value !== undefined && !isRecord(value)) {
                this.field(group, '保存値', path, [], { long: true });
            } else {
                for (const [key, label] of Object.entries(styleFields)) {
                    this.field(group, label, path, [key], key === 'politeness'
                        ? { default: 0.5, min: 0, max: 1 }
                        : { nullable: key === 'first_person', long: key === 'description' });
                }
                for (const [key, item] of pairs(value))
                    if (!Object.hasOwn(styleFields, key)) this.field(group, key, path, [key], { long: typeof item !== 'boolean' && typeof item !== 'number' });
            }
            if (value !== undefined) this.actions(group, this.deleteButton('口調設定を削除', title + 'を削除しますか？', () =>
                this.changeStructure(path, [], undefined, title)));
        }

        characters(parent) {
            const { persistentMemory: memory } = this.working;
            const characters = characterSources(memory);
            const context = this.context;
            const active = characters.find(record => record.id === context.character) || characters[0];
            const head = this.group(parent);
            const row = element('div', 'information-fields');
            head.append(row);
            if (active) {
                const label = element('label', 'settings-field', 'キャラクター');
                const selector = element('select');
                characters.forEach(record => selector.add(new Option(record.label || record.name, record.id)));
                selector.value = active.id;
                selector.addEventListener('change', () => {
                    void this.flushPending();
                    context.character = selector.value;
                    this.renderEditor();
                    this.detail.scrollTop = 0;
                    parent.querySelector('select')?.focus({ preventScroll: true });
                });
                label.append(selector);
                row.append(label);
            } else head.append(element('p', null, 'キャラクター情報はありません。'));
            const add = this.button('キャラクターを追加', async () => {
                const view = this.rendered;
                const name = normalizeCharacterName(await this.promptName('キャラクター名'));
                if (!name || view !== this.rendered) return;
                if (characters.some(record => normalizeCharacterName(record.name) === name))
                    return this.report('同じ名前のキャラクターがあります。');
                context.character = JSON.stringify([name]);
                this.changeStructure([...memoryPath, memoryRecord + name], [], {}, 'キャラクターを追加');
            }, 'informationStructure');
            row.append(add);
            if (!active) return;

            const paths = active.paths;
            const path = paths.memory || [...memoryPath, memoryRecord + active.name];
            const data = read(this.working, path);
            const basic = this.group(parent, '基本情報');
            if (data !== undefined && !isRecord(data)) this.field(basic, '保存値', path, [], { long: true });
            else {
                for (const [key, label] of Object.entries(baseFields)) {
                    const compact = key === 'status' || key === 'current_location';
                    this.field(basic, label, path, [key], { compact, long: !compact });
                }
                for (const [key] of pairs(data))
                    if (key !== 'relationships' && !Object.hasOwn(baseFields, key)) this.field(basic, key, path, [key], { long: true });
                this.relationships(parent, path, data?.relationships);
            }
            this.dictionary(parent, paths.status || [...memoryPath, statusRecord + active.name], 'ステータス', { default: 0 }, 0);
            this.dictionary(parent, paths.inventory || [...memoryPath, 'inventories', active.name], '所持品', { default: 1, min: Number.MIN_VALUE }, 1);
            this.style(parent, paths.style || [...memoryPath, 'style_profiles', active.name], '口調設定');
            if (paths.memory) {
                const danger = this.group(parent);
                danger.classList.add('information-danger');
                danger.append(element('p', null, '基本情報と人間関係を削除します。ステータス・所持品・口調設定は各セクションで編集できます。'));
                this.actions(danger, this.deleteButton('キャラクターメモリを削除',
                    active.name + 'の基本情報と人間関係を削除しますか？', () =>
                        this.changeStructure(path, [], undefined, 'キャラクターを追加')));
            }
        }

        relationships(parent, path, records) {
            const section = this.group(parent, '他キャラクターとの関係', JSON.stringify([...path, 'relationships']));
            if (records !== undefined && !isRecord(records)) {
                this.field(section, '保存値', path, ['relationships'], { long: true });
                return;
            }
            for (const [name, record] of pairs(records)) {
                const relative = ['relationships', name];
                const item = this.group(section, name, JSON.stringify([...path, ...relative]), false);
                if (!isRecord(record)) this.field(item, '保存値', path, relative, { long: true });
                else {
                    this.field(item, '親密度', path, [...relative, 'affinity'], { default: 0 });
                    this.field(item, '関係性の文脈', path, [...relative, 'context'], { long: true, normalize: normalizeRelationshipContext });
                    for (const [key] of pairs(record)) if (!['affinity', 'context'].includes(key))
                        this.field(item, key, path, [...relative, key], { long: true });
                }
                this.actions(item, this.deleteButton('関係を削除', name + 'との関係を削除しますか？', () =>
                    this.changeStructure(path, relative, undefined, '関係を追加')));
            }
            this.actions(section, this.button('関係を追加', async () => {
                const view = this.rendered;
                const name = normalizeCharacterName(await this.promptName('相手キャラクター名'));
                if (!name || view !== this.rendered) return;
                if (pairs(read(this.working, [...path, 'relationships'])).some(([key]) => normalizeCharacterName(key) === name))
                    return this.report('同じ相手との関係があります。');
                this.context.closed.set(JSON.stringify([...path, 'relationships', name]), true);
                this.changeStructure(path, ['relationships', name], { affinity: 0, context: '' }, '関係を追加');
            }, 'informationStructure'));
        }

        scenario(parent) {
            const { persistentMemory: memory } = this.working;
            const scenes = [...memoryPath, 'scene_stack'];
            const stack = memory.scene_stack;
            const sceneGroup = this.group(parent, 'シーン', 'scene');
            if (stack !== undefined && !Array.isArray(stack)) {
                this.field(sceneGroup, '保存値', scenes, [], { long: true });
            } else {
                if (!stack?.length) sceneGroup.append(element('p', null, 'シーンはありません。'));
                (stack || []).forEach((scene, index) => {
                    const current = index === stack.length - 1;
                    const title = (current ? '現在のシーン' : '過去のシーン ' + (index + 1))
                        + (typeof scene?.location === 'string' ? ' · ' + scene.location : '');
                    const item = this.group(sceneGroup, title, 'scene/' + index, current);
                    if (!isRecord(scene)) this.field(item, '保存値', scenes, [index], { long: true });
                    else for (const key of new Set([...Object.keys(sceneFields), ...Object.keys(scene)])) {
                        this.field(item, sceneFields[key] ?? key, scenes, [index, key], { long: key === 'notes' });
                    }
                    this.actions(item, this.deleteButton('シーンを削除', title + 'を履歴から削除しますか？', () => {
                        const next = read(this.working, scenes).filter((_, i) => index !== i);
                        // An absent stack lets the existing tool initialize a new current scene.
                        this.changeStructure(scenes, [], next.length ? next : undefined, 'シーンを追加');
                    }));
                });
                this.actions(sceneGroup, this.button('シーンを追加', () => {
                    const stack = read(this.working, scenes) || [];
                    this.context.closed.set('scene/' + stack.length, true);
                    this.changeStructure(scenes, [], [...stack, {
                        scene_id: stack.length ? crypto.randomUUID() : 'initial', location: ''
                    }], 'シーンを追加');
                }, 'informationStructure'));
            }

            this.field(this.group(parent, '物語内の日付', 'date'), '経過日数', [...memoryPath, 'game_day'], [],
                { default: 1, min: 1, integer: true });

            const reserved = new Set(['scene_stack', 'game_day', 'style_profiles', 'inventories']);
            for (const { paths } of characterSources(memory)) {
                for (const path of Object.values(paths)) if (path.length === 2) reserved.add(path[1]);
            }
            const entries = pairs(memory).filter(([key]) => !reserved.has(key) ||
                (key === 'style_profiles' || key === 'inventories') && !isRecord(memory[key]));
            this.scenarioRecords(parent, 'フラグ・カウンター', 'flags', entries.filter(([, value]) => ['number', 'boolean'].includes(typeof value)),
                [['フラグを追加', false], ['カウンターを追加', 0]]);
            this.scenarioRecords(parent, '設定・記録', 'records', entries.filter(([, value]) => !['number', 'boolean'].includes(typeof value)),
                [['記録を追加', '']]);
            const styles = pairs(memory.style_profiles).filter(([name]) => normalizeCharacterName(name) === narration);
            if (memory.style_profiles === undefined || isRecord(memory.style_profiles)) {
                for (const name of styles.length ? styles.map(([name]) => name) : [narration])
                    this.style(parent, [...memoryPath, 'style_profiles', name], '文章スタイル（' + name + '）');
            }
        }

        scenarioRecords(parent, title, id, entries, addTypes) {
            const group = this.group(parent, title, id);
            if (!entries.length) group.append(element('p', null, '保存された項目はありません。'));
            for (const [key] of entries) {
                const path = [...memoryPath, key];
                this.field(group, key, path, [], { long: id === 'records' });
                this.actions(group, this.deleteButton('削除', '「' + key + '」を削除しますか？', () =>
                    this.changeStructure(path, [], undefined, addTypes[0][0])));
            }
            this.actions(group, ...addTypes.map(([label, initial]) => this.button(label, async () => {
                const view = this.rendered;
                const name = await this.promptName('保存キー');
                if (!name || view !== this.rendered) return;
                if (Object.hasOwn(this.working.persistentMemory, name) ||
                    ['inventories', 'style_profiles', 'game_day', 'scene_stack'].includes(name) || name.startsWith(statusRecord))
                    return this.report('既存のキーか予約された名前です。');
                this.changeStructure([...memoryPath, name], [], initial, label);
            }, 'informationStructure')));
        }

        summary(parent) {
            const group = this.group(parent, '保存済みの要約');
            const summary = this.working.summarizedContext;
            if (!summary || typeof summary.summaryText !== 'string') {
                group.append(element('p', null, 'このチャットには保存済みの要約がありません。'));
                return;
            }
            this.field(group, '要約本文', ['summarizedContext'], ['summaryText'], { long: true, nonempty: true });
        }
    }

    if (root.appLogic && root.state && $('information-screen')) {
        root.informationUi = new InformationUI({ app: root.appLogic, state: root.state, ui: root.uiUtilsV136 });
    }
})(window);

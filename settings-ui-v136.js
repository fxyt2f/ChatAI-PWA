/* Shared desktop/mobile settings and chat execution controls. Storage lives in settings-v136.js. */
(function (root) {
    'use strict';
    const titles = { general: '一般設定', profile: 'プロファイル設定', integrations: '外部連携', other: 'その他設定' };
    const themeFields = {
        'dark-mode-toggle': 'darkMode', 'theme-color-mode-select': 'themeColorMode', 'accent-color-input': 'accentColor',
        'header-color-input': 'headerColor', 'header-text-color-mode-select': 'headerTextColorMode',
        'header-text-color-input': 'headerTextColor', 'new-chat-button-color-input': 'newChatButtonColor',
        'send-button-color-input': 'sendButtonColor', 'other-button-color-input': 'otherButtonColor', 'user-message-color-input': 'userMessageColor'
    };
    const appearanceFields = { 'overlay-opacity-slider': 'overlayOpacity', 'message-opacity-slider': 'messageOpacity' };
    const resetFields = { 'reset-accent-color-btn': 'accentColor', 'reset-header-color-btn': 'headerColor',
        'reset-header-text-color-btn': 'headerTextColor', 'reset-new-chat-button-color-btn': 'newChatButtonColor',
        'reset-send-button-color-btn': 'sendButtonColor', 'reset-other-button-color-btn': 'otherButtonColor', 'reset-user-message-color-btn': 'userMessageColor' };
    const $ = id => document.getElementById(id);
    const levelName = value => value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
    const levelOrder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const make = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text) node.textContent = text; return node; };
    class SettingsUI {
        constructor({ app, state, ui }) {
            this.app = app; this.state = state; this.ui = ui; this.category = null; this.scroll = {};
            this.editedGlobalInputs = new Set();
            this.editedProfileInputs = new Map();
            this.media = matchMedia('(min-width: 800px)'); this.saveQueue = Promise.resolve(); this.urls = new Map(); this.previewVersions = new Map();
            this.init();
        }
        init() {
            if (!$('settings-detail')) return;
            // One set of controls is used at every viewport size. Only presentation changes.
            document.querySelectorAll('[data-settings-category]').forEach(button => button.addEventListener('click', () => this.selectCategory(button.dataset.settingsCategory)));
            this.media.addEventListener('change', () => {
                if (!this.media.matches && this.category && this.state.currentScreen === 'settings' && !this.mobileDetailPushed) {
                    history.replaceState({ screen: 'settings', settingsCategory: null }, '', '#settings');
                    history.pushState({ screen: 'settings', settingsCategory: this.category }, '', `#settings/${this.category}`);
                    this.mobileDetailPushed = true;
                }
                this.layout();
            });
            for (const kind of ['theme', 'appearance']) {
                const global = $(`global-${kind}-editor`), profile = $(`profile-${kind}-editor`);
                for (const child of global.children) if (!/^H[1-6]$/.test(child.tagName)) profile.append(child.cloneNode(true));
                profile.querySelectorAll('[id]').forEach(node => { node.dataset.sourceId = node.id; node.id = `profile-${node.id}`; });
                profile.querySelectorAll('[for]').forEach(node => node.htmlFor = `profile-${node.htmlFor}`);
                profile.querySelectorAll('[aria-controls]').forEach(node => node.setAttribute('aria-controls', `profile-${node.getAttribute('aria-controls')}`));
                $(`profile-${kind}-override`).addEventListener('change', event => {
                    const value = event.target.checked;
                    const profileId = this.state.activeProfileId;
                    this.save(event.target, () => this.app.setProfileOverride(kind, value, profileId), { profileId });
                });
            }
            this.prepareSettingsLayout();
            this.bindPromptSizing();
            this.bindAppearanceEditors();
            $('chat-model-button').addEventListener('click', event => this.openExecution(event.currentTarget));
            $('settings-thinking-button').addEventListener('change', event => {
                const control = event.currentTarget, value = control.value;
                if (control.disabled) return;
                const chatId = this.state.currentChatId, generation = this.state.executionInitGeneration;
                this.save(control, async () => {
                    if (chatId !== this.state.currentChatId || generation !== this.state.executionInitGeneration) return;
                    await this.app.setCurrentChatThinkingEffort(value);
                });
            });
            document.addEventListener('pointerdown', event => {
                this.setInputMode('pointer');
                if (this.popover && !this.popover.contains(event.target) && !this.anchor?.contains(event.target)) this.closePopover(false);
            });
            document.addEventListener('keydown', event => {
                this.setInputMode('keyboard');
                if (!this.popover) return;
                if (event.key === 'Escape') { event.preventDefault(); this.closePopover(true); }
                if (event.key === 'Tab') this.closePopover(false);
            });
            const position = () => this.positionPopover();
            window.addEventListener('resize', position);
            window.addEventListener('chat-workspace-layout', () => {
                if (this.anchor?.closest('#chat-workspace')?.inert) this.closePopover(false);
                else this.positionPopover();
            });
            document.addEventListener('scroll', position, true);
            window.visualViewport?.addEventListener('resize', position);
            window.visualViewport?.addEventListener('scroll', position);
            $('settings-screen').addEventListener('input', event => {
                if (Object.values(this.app.globalSettingControlsV136 || {}).includes(event.target)
                    && !['checkbox', 'radio'].includes(event.target.type)) this.editedGlobalInputs.add(event.target);
                if (Object.values(this.app.profileSettingControlsV136 || {}).includes(event.target)
                    && !['checkbox', 'radio'].includes(event.target.type)) this.editedProfileInputs.set(event.target, this.state.activeProfileId);
            }, true);
            $('settings-screen').addEventListener('focusout', event => {
                const profileId = this.editedProfileInputs.get(event.target);
                if (this.editedProfileInputs.delete(event.target) && profileId === this.state.activeProfileId)
                    this.app.reloadProfileSettingsV136(profileId).catch(() => {});
                if (!this.editedGlobalInputs.delete(event.target)) return;
                this.app.reloadGlobalSettingsV136().catch(() => {}).then(() => this.syncGlobalForms());
            });
            window.addEventListener('execution-settings-changed', event => {
                if (event.detail?.type === 'chat' || event.detail?.type === 'capabilities') {
                    this.renderExecution();
                    if (this.popover?.refreshThinking) this.popover.refreshThinking();
                    else if (this.popover) this.closePopover(this.popover.contains(document.activeElement));
                } else {
                    if (event.detail?.type === 'global') this.syncGlobalForms();
                    this.syncAppearanceEditors();
                }
            });
            this.layout(); this.renderExecution();
        }
        prepareSettingsLayout() {
            const root = $('settings-detail');
            // Keep the controls, IDs and listeners; group presentation only.
            root.querySelectorAll('.settings-group p:not([id])').forEach(node => {
                if (node.style.height && !node.hasAttribute('role') && !node.hasAttribute('aria-live') && !node.textContent.trim() && !node.children.length) node.remove();
            });
            root.querySelectorAll('.settings-group p, .settings-group label, .settings-group button').forEach(node => {
                for (const property of ['margin', 'margin-top', 'margin-bottom', 'font-size', 'line-height', 'text-align']) node.style.removeProperty(property);
            });
            root.querySelectorAll('.settings-group div[style]').forEach(node => {
                if (node.style.borderTop) {
                    node.classList.add('settings-field-stack'); node.style.removeProperty('border-top');
                }
                for (const property of ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'padding-top']) node.style.removeProperty(property);
            });
            root.querySelectorAll('.settings-group label').forEach(label => {
                if (label.parentElement.classList.contains('settings-field') || label.classList.contains('color-setting-label')) return;
                const toggle = label.classList.contains('checkbox-label');
                const control = label.htmlFor ? root.querySelector(`#${CSS.escape(label.htmlFor)}`) : label.nextElementSibling;
                if (!toggle && (!control || control.parentElement !== label.parentElement || !control.matches('input,select,textarea,.image-upload-controls'))) return;
                const field = make('div', toggle ? 'settings-field settings-toggle' : 'settings-field');
                label.before(field); field.append(label);
                if (!toggle) field.append(control);
                while (field.nextElementSibling?.matches('p')) field.append(field.nextElementSibling);
                if (field.nextElementSibling?.id === 'settings-thinking-button') {
                    field.append(field.nextElementSibling);
                    while (field.nextElementSibling?.matches('p')) field.append(field.nextElementSibling);
                }
                if (!toggle && control.matches('input[type=number]') && field.nextElementSibling?.tagName === 'SPAN' && field.nextElementSibling.textContent.trim() === '秒') {
                    const unit = field.nextElementSibling, row = make('div', 'settings-input-with-unit');
                    control.before(row); row.append(control, unit);
                    while (field.nextElementSibling?.matches('p')) field.append(field.nextElementSibling);
                }
            });
            root.querySelectorAll('.settings-group div').forEach(node => {
                if (node.matches('.settings-field,.settings-group,.param-grid,.chat-display-settings-row,.chat-display-setting')) return;
                if ([...node.children].some(child => child.classList.contains('settings-field'))) node.classList.add('settings-field-stack');
            });
        }
        enter() {
            this.closePopover(false); this.mobileDetailPushed = false; this.category = this.media.matches ? 'general' : null;
            const danger = $('data-danger-settings').querySelector('details'); if (danger) danger.open = false;
            this.layout(); this.syncGlobalForms(); this.app.reloadGlobalSettingsV136().catch(() => {});
        }
        bindPromptSizing() {
            this.promptSizes = new Map();
            const observer = new ResizeObserver(entries => {
                for (const { target } of entries) {
                    const size = this.promptSizes.get(target), height = target.getBoundingClientRect().height;
                    if (!size || height < 100 || Math.abs(height - size.applied) < 1) continue;
                    size.manual = Math.min(500, Math.max(100, height)); size.applied = height;
                }
            });
            $('settings-detail').querySelectorAll('textarea').forEach(control => {
                this.promptSizes.set(control, { applied: 100, manual: null });
                control.addEventListener('input', () => this.sizePrompt(control)); observer.observe(control);
            });
        }
        sizePrompt(control) {
            if (!control.getClientRects().length || !this.promptSizes) return;
            const size = this.promptSizes.get(control); if (!size) return;
            let height = size.manual;
            const scrollTop = control.scrollTop;
            if (height === null) {
                control.style.height = '100px';
                const style = getComputedStyle(control);
                height = Math.min(500, Math.max(100, control.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)));
            }
            size.applied = height; control.style.height = `${height}px`;
            control.scrollTop = scrollTop;
        }
        syncPromptSizes() { this.promptSizes?.forEach((_, control) => this.sizePrompt(control)); }
        syncGlobalForms() {
            const global = this.state.globalSettingsV136;
            if (!global) return;
            const refs = { thoughtTranslationModel: 'thoughtTranslationModelRef', proofreadingModelName: 'proofreadingModelRef', summaryModelName: 'summaryModelRef',
                sdQcModel: 'sdQcModelRef', sdPromptImproveModel: 'sdPromptImproveModelRef' };
            for (const [key, control] of Object.entries(this.app.globalSettingControlsV136 || {})) {
                if (control === document.activeElement && this.editedGlobalInputs.has(control)) continue;
                let value = key === 'includeThoughts' ? global.showThoughtProcess : global[key] ?? SettingsV136.chatTitleDefaults[key];
                if (key === 'chatTitleModelRef') {
                    const ref = value;
                    value = this.app.encodeModelRefValue(ref || {});
                    if (value && !Array.from(control.options).some(option => option.value === value)) {
                        control.add(new Option(this.app.getModelRefDisplayLabel(ref), value));
                    }
                }
                if (refs[key]) {
                    const ref = this.app.getGlobalAuxiliaryModelRefV136(refs[key], key);
                    value = key === 'sdQcModel' || key === 'sdPromptImproveModel' ? ref?.modelName || value : this.app.encodeModelRefValue(ref || {});
                    if (value && !Array.from(control.options).some(option => option.value === value)) {
                        const option = make('option', '', this.app.getModelRefDisplayLabel(ref || {}) || value);
                        option.value = value; control.append(option);
                    }
                }
                if (control.type === 'checkbox') control.checked = value === true;
                else if (control.value !== String(value ?? '')) control.value = value ?? '';
            }
            for (const [id, visible] of [
                ['auto-retry-options', global.enableAutoRetry],
                ['api-timeout-options', global.enableApiTimeout]
            ]) $(id)?.classList.toggle('hidden', visible !== true);
            $('proofreading-options').classList.remove('hidden'); this.syncPromptSizes();
        }
        selectCategory(category, push = true) {
            if (this.category) this.scroll[this.category] = $('settings-detail').scrollTop;
            this.category = Object.hasOwn(titles, category) ? category : null;
            this.layout(); $('settings-detail').scrollTop = this.scroll[this.category] || 0;
            requestAnimationFrame(() => this.syncPromptSizes());
            if (push && this.state.currentScreen === 'settings') {
                const entry = { screen: 'settings', settingsCategory: this.category };
                if (this.media.matches) history.replaceState(entry, '', `#settings/${this.category}`);
                else {
                    if (this.category && !this.mobileDetailPushed) {
                        history.replaceState({ screen: 'settings', settingsCategory: null }, '', '#settings');
                        history.pushState(entry, '', `#settings/${this.category}`);
                        this.mobileDetailPushed = true;
                    } else history.replaceState(entry, '', this.category ? `#settings/${this.category}` : '#settings');
                }
            }
        }
        restore(entry) {
            this.mobileDetailPushed = !!entry?.settingsCategory;
            this.selectCategory(entry?.settingsCategory || (this.media.matches ? 'general' : null), false);
        }
        back() {
            if (!this.media.matches && this.category) {
                if (history.state?.settingsCategory) history.back();
                else this.selectCategory(null, false);
            } else this.ui.showScreen('chat');
        }
        layout() {
            const selected = this.category || (this.media.matches ? 'general' : null);
            $('settings-screen').classList.toggle('settings-show-top', !selected);
            document.querySelectorAll('[data-settings-panel]').forEach(panel => panel.hidden = panel.dataset.settingsPanel !== selected);
            document.querySelectorAll('[data-settings-category]').forEach(button => {
                if (button.dataset.settingsCategory === selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
            });
            $('settings-title').textContent = !this.media.matches && selected ? titles[selected] : '設定';
            $('back-to-chat-from-settings').setAttribute('aria-label', !this.media.matches && selected ? '設定トップへ戻る' : 'チャットへ戻る');
        }
        error(anchor, error) {
            if (!anchor) return;
            let output = anchor.parentElement.querySelector(':scope > .inline-setting-error');
            if (!output) { output = make('p', 'inline-setting-error'); output.setAttribute('role', 'alert'); anchor.parentElement.append(output); }
            output.textContent = error?.message || String(error || '');
            anchor.setAttribute('aria-invalid', error ? 'true' : 'false');
        }
        save(anchor, operation, profileScoped = false) {
            const pinned = typeof profileScoped === 'object';
            const profileId = pinned ? profileScoped.profileId : this.state.activeProfileId;
            this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
                if (profileScoped && !pinned && profileId !== this.state.activeProfileId) return;
                const current = () => !pinned || profileId == null || profileId === this.state.activeProfileId;
                try { await operation(); if (current()) this.error(anchor, ''); }
                catch (error) { if (current()) this.error(anchor, error); }
                this.syncAppearanceEditors(); this.renderExecution();
            });
            return this.saveQueue;
        }
        bindAppearanceEditors() {
            document.querySelectorAll('[data-appearance-editor]').forEach(editor => {
                if (editor.dataset.bound) return; editor.dataset.bound = 'true';
                const own = editor.dataset.appearanceEditor === 'profile', kind = editor.dataset.kind;
                const scope = { global: !own };
                editor.querySelectorAll('input,select,button').forEach(control => {
                    const id = control.dataset.sourceId || control.id;
                    const key = (kind === 'theme' ? themeFields : appearanceFields)[id];
                    if (key) control.addEventListener(control.type === 'color' || control.type === 'range' ? 'input' : 'change', () => {
                        const value = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) / 100 : control.value;
                        const target = this.app.captureAppearanceTargetV136(kind, scope);
                        this.save(control, () => this.app.saveAppearanceValues(kind, { [key]: value }, target), { profileId: target.profileId });
                    });
                    if (resetFields[id]) control.addEventListener('click', () => {
                        const key = resetFields[id], defaults = this.app.normalizeGlobalThemeSettings({});
                        const updates = { [key]: defaults[key] };
                        if (key === 'headerTextColor') updates.headerTextColorMode = defaults.headerTextColorMode;
                        const target = this.app.captureAppearanceTargetV136('theme', scope);
                        this.save(control, () => this.app.saveAppearanceValues('theme', updates, target), { profileId: target.profileId });
                    });
                    if (id === 'upload-background-btn') control.addEventListener('click', () => editor.querySelector('input[type=file]').click());
                    if (id === 'background-image-input') control.addEventListener('change', () => {
                        const file = control.files[0]; control.value = '';
                        if (!file) return;
                        if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return this.error(control, new Error('5MB以下の画像を選択してください。'));
                        const target = this.app.captureAppearanceTargetV136('appearance', scope);
                        this.save(control, () => this.app.saveBackgroundBlobV136(file, target), { profileId: target.profileId });
                    });
                    if (id === 'delete-background-btn') control.addEventListener('click', () => {
                        const target = this.app.captureAppearanceTargetV136('appearance', scope);
                        this.save(control, () => this.app.saveBackgroundBlobV136(null, target), { profileId: target.profileId });
                    });
                });
            });
        }
        syncAppearanceEditors() {
            if (!this.state.globalSettingsV136) return;
            const profile = this.app.getProfileAppearanceSettings();
            for (const kind of ['theme', 'appearance']) {
                const own = profile[kind === 'theme' ? 'useCustomTheme' : 'useCustomAppearance'] === true;
                $(`profile-${kind}-override`).checked = own; $(`profile-${kind}-editor`).hidden = !own;
            }
            document.querySelectorAll('[data-appearance-editor]').forEach(editor => {
                const own = editor.dataset.appearanceEditor === 'profile', kind = editor.dataset.kind;
                const values = own ? profile[kind] || {} : this.state.globalSettingsV136[kind] || {};
                editor.querySelectorAll('input,select').forEach(control => {
                    const id = control.dataset.sourceId || control.id, key = (kind === 'theme' ? themeFields : appearanceFields)[id];
                    if (!key || control === document.activeElement) return;
                    const value = values[key];
                    if (control.type === 'checkbox') control.checked = value === true;
                    else if (control.type === 'range') control.value = Math.round((value ?? 1) * 100);
                    else control.value = control.type === 'color' ? (value || (values.darkMode ? '#007aff' : '#1976d2')) : value || '';
                });
                if (kind === 'theme') {
                    editor.querySelectorAll('input,select,button').forEach(control => {
                        const id = control.dataset.sourceId || control.id;
                        control.disabled = id === 'header-text-color-input' && values.headerTextColorMode !== 'custom';
                    });
                } else {
                    for (const [id, key] of Object.entries(appearanceFields)) {
                        const output = editor.querySelector(own ? `[data-source-id="${id.replace('-slider', '-value')}"]` : `#${id.replace('-slider', '-value')}`);
                        if (output) output.textContent = `${Math.round((values[key] ?? 1) * 100)}%`;
                    }
                    this.updatePreview(editor, values.backgroundAssetId);
                }
            });
        }
        async updatePreview(editor, id) {
            const image = editor.querySelector('img'), button = editor.querySelector('button.settings-delete-button');
            if (editor.dataset.previewAsset === (id || 'none')) {
                const cached = this.urls.get(editor);
                if (cached) image.src = cached;
                image.classList.toggle('hidden', !cached); button.classList.toggle('hidden', !id);
                return;
            }
            editor.dataset.previewAsset = id || 'none';
            const version = (this.previewVersions.get(editor) || 0) + 1; this.previewVersions.set(editor, version);
            const old = this.urls.get(editor); if (old) URL.revokeObjectURL(old); this.urls.delete(editor);
            image.classList.add('hidden'); button.classList.toggle('hidden', !id); if (!id) return;
            try {
                const asset = await new Promise((resolve, reject) => {
                    const req = this.state.db.transaction('image_store').objectStore('image_store').get(id);
                    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
                });
                if (version !== this.previewVersions.get(editor)) return;
                if (!asset?.blob) throw new Error('背景画像が見つかりません。');
                const url = URL.createObjectURL(asset.blob); this.urls.set(editor, url); image.src = url; image.classList.remove('hidden');
            } catch (error) { this.error(image, error); }
        }
        refresh() { this.syncAppearanceEditors(); this.renderExecution(); this.syncPromptSizes(); }
        renderExecution() {
            const ref = this.app.getCurrentChatModelRef(), config = this.app.getApiConfigById(ref?.apiConfigId);
            const pending = !ref && (this.state.executionInitializingV136 || !this.state.db);
            const validation = ref ? this.app.validateModelRefForUsage(ref) : { valid: false };
            const invalidLabel = ref && !validation.valid ? (config?.enabled === false ? '（無効）' : '（要確認）') : '';
            $('chat-model-label').textContent = pending ? 'モデルを準備中…' : ref ? `${ref.modelName}${invalidLabel}` : 'モデルを選択';
            $('chat-model-button').title = ref ? `${config?.name || '削除済みAPI'} / ${ref.modelName}${invalidLabel}` : $('chat-model-label').textContent;
            $('chat-model-button').setAttribute('aria-invalid', String(!validation.valid && !pending));
            $('chat-model-button').classList.toggle('invalid-model', !validation.valid && !pending);
            $('chat-model-button').disabled = this.state.isSending || pending;
            $('model-name').disabled = this.state.isSending || pending;
            const c = this.app.getModelThinkingCapability(ref), effort = this.app.getCurrentChatThinkingEffort() || c.defaultEffort;
            const canThink = validation.valid && c.levels.length > 0;
            $('chat-thinking-label').hidden = !canThink; $('chat-thinking-label').textContent = canThink ? levelName(effort) : '';
            $('chat-model-button').setAttribute('aria-label', `${canThink ? 'モデルとThinkingを選択' : 'モデルを選択'}: ${$('chat-model-button').title}${canThink ? ` / Thinking: ${levelName(effort)}` : ''}`);
            const select = $('settings-thinking-button'); select.hidden = !canThink; select.disabled = this.state.isSending || pending;
            const field = select.closest('.settings-field'); if (field) field.hidden = !canThink;
            const levels = c.levels.slice().sort((a,b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
            if (Array.from(select.options).map(option => option.value).join(',') !== levels.join(',')) {
                select.replaceChildren(...levels.map(value => { const option = make('option', '', levelName(value)); option.value = value; return option; }));
            }
            select.value = effort || ''; select.title = `Thinkingレベル: ${levelName(effort)}`;
            if (this.state.isSending) this.closePopover(false);
        }
        openExecution(anchor) {
            if (this.state.isSending || anchor.disabled) return;
            const ref = this.app.getCurrentChatModelRef();
            if (ref && this.app.validateModelRefForUsage(ref).valid && this.app.getModelThinkingCapability(ref).levels.length) this.openThinking(anchor);
            else this.openModels(anchor);
        }
        setInputMode(mode) {
            // Chrome may retain :focus-visible after keyboard -> touch on the same trigger.
            for (const node of [$('chat-model-button'), $('settings-thinking-button'), this.popover]) {
                if (node) node.dataset.inputMode = mode;
            }
        }
        newPopover(anchor, label) {
            if (anchor.closest('#chat-workspace')?.inert) return null;
            if (this.anchor === anchor && this.popover) { this.closePopover(true); return null; }
            this.closePopover(false); this.anchor = anchor;
            const panel = make('div', 'execution-popover'); panel.id = 'execution-popover';
            panel.dataset.inputMode = anchor.dataset.inputMode || 'keyboard';
            panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', label);
            document.body.append(panel); this.popover = panel;
            anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-controls', panel.id);
            return panel;
        }
        openModels(anchor) {
            if (this.state.isSending) return;
            const panel = this.newPopover(anchor, 'チャットモデルを選択'); if (!panel) return;
            panel.append(make('h2', 'popover-title', 'モデル'));
            const search = make('input', 'model-picker-search'); search.type = 'search'; search.placeholder = 'モデルを検索'; search.setAttribute('aria-label', 'モデルを検索'); panel.append(search);
            const list = make('div', 'model-picker-list'); panel.append(list);
            const choices = this.app.buildModelRefOptions({ includeDisabled: false });
            const render = () => {
                list.replaceChildren(); let group = null;
                const current = this.app.getCurrentChatModelRef();
                choices.filter(c => c.label.toLowerCase().includes(search.value.toLowerCase())).forEach(choice => {
                    if (group !== choice.apiConfigId) { list.append(make('h3', 'model-picker-group', choice.apiConfigName)); group = choice.apiConfigId; }
                    const button = make('button', 'model-picker-choice', choice.modelName); button.type = 'button';
                    const selected = current?.apiConfigId === choice.apiConfigId && current?.modelName === choice.modelName;
                    button.setAttribute('aria-pressed', String(selected));
                    button.addEventListener('click', () => {
                        const chatId = this.state.currentChatId, generation = this.state.executionInitGeneration;
                        this.save($('chat-model-button'), async () => {
                            if (chatId !== this.state.currentChatId || generation !== this.state.executionInitGeneration) return;
                            await this.app.setCurrentChatModelRef({ apiConfigId: choice.apiConfigId, modelName: choice.modelName });
                            this.closePopover(true);
                        });
                    }); list.append(button);
                });
                if (!list.querySelector('button')) list.append(make('p', 'settings-description', '選択できるモデルがありません。一般設定でAPI設定を追加してください。'));
            };
            search.addEventListener('input', render); render();
            panel.addEventListener('keydown', event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const buttons = [...list.querySelectorAll('button')]; if (!buttons.length) return;
                event.preventDefault(); const index = buttons.indexOf(document.activeElement);
                buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length].focus();
            });
            this.positionPopover(); (list.querySelector('[aria-pressed=true]') || list.querySelector('button') || search).focus();
        }
        openThinking(anchor) {
            if (this.state.isSending) return;
            const capability = this.app.getModelThinkingCapability(); if (!capability.levels.length) return;
            // Provider metadata may list strongest first. Only presentation order changes.
            const levels = [...capability.levels].sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
            const panel = this.newPopover(anchor, 'Thinkingレベル'); if (!panel) return;
            panel.classList.add('thinking-popover');
            const row = make('div', 'thinking-popover-row'); panel.append(row);
            let current = this.app.getCurrentChatThinkingEffort() || capability.defaultEffort;
            const chatId = this.state.currentChatId, generation = this.state.executionInitGeneration;
            const ref = this.app.getCurrentChatModelRef();
            const contextMatches = () => {
                const next = this.app.getCurrentChatModelRef(), c = this.app.getModelThinkingCapability();
                return chatId === this.state.currentChatId && generation === this.state.executionInitGeneration
                    && ref?.apiConfigId === next?.apiConfigId && ref?.modelName === next?.modelName
                    && JSON.stringify(c.levels) === JSON.stringify(capability.levels) && c.defaultEffort === capability.defaultEffort;
            };
            const heading = make('button', 'thinking-heading thinking-model-switch'); heading.type = 'button';
            heading.setAttribute('aria-label', 'モデルを選択'); heading.setAttribute('aria-haspopup', 'dialog');
            heading.addEventListener('click', () => { this.closePopover(false); this.openModels(anchor); }); row.append(heading);
            const name = make('span', 'thinking-level-name', levelName(current)); name.setAttribute('aria-live', 'polite'); heading.append(name);
            const context = make('span', 'thinking-model-name', this.app.getCurrentChatModelRef()?.modelName || ''); context.title = context.textContent; heading.append(context);
            const dots = make('div', 'thinking-dots'); dots.setAttribute('role', 'radiogroup'); dots.setAttribute('aria-label', 'Thinkingレベル');
            // Keep 40px hit areas; extend the visible markers toward the rounded track ends.
            const progress = levels.length > 1 ? levels.indexOf(current) / (levels.length - 1) : .5;
            dots.style.setProperty('--thinking-progress', `calc(12px + (100% - 24px) * ${progress})`);
            let pending = 0;
            const update = level => {
                if (this.popover !== panel) return;
                const focusedRadio = dots.contains(document.activeElement);
                current = level; name.textContent = levelName(level);
                const progress = levels.length > 1 ? levels.indexOf(level) / (levels.length - 1) : .5;
                dots.style.setProperty('--thinking-progress', `calc(12px + (100% - 24px) * ${progress})`);
                for (const button of dots.children) {
                    const selected = button.dataset.level === level;
                    button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1;
                    if (selected && focusedRadio) button.focus({ preventScroll: true });
                }
            };
            panel.refreshThinking = () => {
                if (!contextMatches()) { this.closePopover(false); return; }
                if (!pending) update(this.app.getCurrentChatThinkingEffort() || capability.defaultEffort);
            };
            const choose = level => {
                if (this.state.isSending || !contextMatches()) return;
                pending++; update(level);
                this.save(anchor, async () => {
                    try { if (contextMatches()) await this.app.setCurrentChatThinkingEffort(level); }
                    finally { pending--; if (!pending && contextMatches()) update(this.app.getCurrentChatThinkingEffort() || capability.defaultEffort); }
                });
            };
            levels.forEach((level, index) => {
                const button = make('button', 'thinking-dot'); button.type = 'button'; button.setAttribute('role', 'radio');
                button.setAttribute('aria-label', levelName(level)); button.setAttribute('aria-checked', String(level === current));
                button.tabIndex = level === current ? 0 : -1; button.title = levelName(level);
                button.dataset.level = level;
                const position = levels.length > 1 ? index / (levels.length - 1) : .5;
                button.style.setProperty('--thinking-dot-shift', `${(position * 2 - 1) * 8}px`);
                const mark = make('span', 'thinking-mark'); mark.setAttribute('aria-hidden', 'true'); button.append(mark);
                button.addEventListener('click', () => choose(level)); dots.append(button);
            });
            dots.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); const index = levels.indexOf(current);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? levels.length - 1 : (index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + levels.length) % levels.length;
                choose(levels[next]);
            });
            const reset = make('button', 'thinking-reset'); reset.type = 'button'; reset.title = '既定レベルに戻す'; reset.setAttribute('aria-label', 'Thinkingレベルを既定に戻す');
            reset.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9a8 8 0 1 1 .5 7M4 4v5h5"/></svg>';
            reset.addEventListener('click', () => choose(capability.defaultEffort)); row.append(reset); panel.append(dots);
            this.positionPopover(); dots.querySelector('[aria-checked=true]')?.focus();
        }
        positionPopover() {
            if (!this.popover || !this.anchor?.isConnected) return;
            const vp = window.visualViewport, left = vp?.offsetLeft || 0, top = vp?.offsetTop || 0;
            const width = vp?.width || innerWidth, height = vp?.height || innerHeight;
            const controls = this.anchor.closest('.chat-model-controls');
            const rect = (controls || this.anchor).getBoundingClientRect();
            // Follow the control row, allowing the panel to cover the textarea like Codex.
            const edge = rect;
            const size = Math.min(this.popover.classList.contains('thinking-popover') ? 280 : 340, width - 16);
            this.popover.style.width = `${size}px`;
            this.popover.style.maxHeight = `${Math.max(0, height - 16)}px`;
            const measured = this.popover.getBoundingClientRect().height;
            const above = Math.max(0, edge.top - top - 18), below = Math.max(0, top + height - edge.bottom - 18);
            const useAbove = above >= measured || above >= below;
            this.popover.style.maxHeight = `${useAbove ? above : below}px`;
            const panelHeight = this.popover.getBoundingClientRect().height;
            this.popover.dataset.placement = useAbove ? 'above' : 'below';
            this.popover.style.left = `${Math.max(left + 8, Math.min(controls ? rect.right - size : rect.left, left + width - size - 8))}px`;
            this.popover.style.top = `${Math.max(top + 8, Math.min(useAbove ? edge.top - panelHeight - 10 : edge.bottom + 10, top + height - panelHeight - 8))}px`;
        }
        closePopover(restoreFocus) {
            if (!this.popover) return;
            const anchor = this.anchor; anchor?.setAttribute('aria-expanded', 'false'); this.popover.remove(); this.popover = null; this.anchor = null;
            if (restoreFocus && anchor?.isConnected && !anchor.disabled) anchor.focus({ preventScroll: true });
        }
    }
    root.SettingsUIV136 = { create: options => new SettingsUI(options) };
    if (root.appLogic && root.state) root.settingsUiV136 = root.SettingsUIV136.create({ app: root.appLogic, state: root.state, ui: root.uiUtilsV136 });
})(window);

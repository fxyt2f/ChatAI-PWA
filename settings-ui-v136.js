/* Shared desktop/mobile settings and chat execution controls. Storage lives in settings-v136.js. */
(function (root) {
    'use strict';
    const legacySettingsCategories = {
        general: 'api-model',
        'ai-tools': 'tools-integrations',
        integrations: 'data-sync',
        other: 'chat-operation'
    };
    const themeFields = {
        'dark-mode-toggle': 'darkMode', 'theme-color-mode-select': 'themeColorMode', 'accent-color-input': 'accentColor',
        'header-color-input': 'headerColor', 'header-text-color-mode-select': 'headerTextColorMode',
        'header-text-color-input': 'headerTextColor',
        'send-button-color-input': 'sendButtonColor', 'other-button-color-input': 'otherButtonColor', 'user-message-color-input': 'userMessageColor'
    };
    const appearanceFields = { 'overlay-opacity-slider': 'overlayOpacity', 'message-opacity-slider': 'messageOpacity' };
    const resetFields = { 'reset-accent-color-btn': 'accentColor', 'reset-header-color-btn': 'headerColor',
        'reset-header-text-color-btn': 'headerTextColor',
        'reset-send-button-color-btn': 'sendButtonColor', 'reset-other-button-color-btn': 'otherButtonColor', 'reset-user-message-color-btn': 'userMessageColor' };
    const $ = id => document.getElementById(id);
    const modelDefault = SettingsV136.MODEL_DEFAULT_EFFORT;
    const levelName = (value, capability) => value === modelDefault ? 'モデル既定'
        : value === 'none' ? 'オフ'
        : value === 'xhigh' && capability?.source === 'inferred' ? 'Extra High'
        : value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
    function displayedThinkingEffort(app, capability) {
        const selected = app.getCurrentChatThinkingEffort();
        if (capability.rejectedLevels?.includes(selected)) return selected;
        if (capability.initialEffort && (selected == null || (selected === modelDefault && !capability.modelDefault))) {
            return capability.initialEffort;
        }
        return capability.modelDefault ? SettingsV136.normalizeEffort(selected, capability)
            : selected || capability.defaultEffort;
    }
    const levelOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const make = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text) node.textContent = text; return node; };
    const colorPresets = [
        ['赤', '#dc3545'], ['オレンジ', '#ed7925'], ['黄', '#f4c430'], ['緑', '#36944f'],
        ['青緑', '#008b80'], ['水色', '#31b6e6'], ['青', '#1976d2'], ['濃い青', '#2745aa'],
        ['紫', '#8756c7'], ['ピンク', '#e75e9e'], ['茶', '#865743'], ['グレー', '#808080'],
        ['白', '#ffffff'], ['黒', '#000000']
    ];
    const clampColor = value => Math.min(1, Math.max(0, value));
    function normalizeHex(value) {
        const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
        if (!match) return null;
        const code = match[1].toLowerCase();
        return '#' + (code.length === 3 ? [...code].map(digit => digit.repeat(2)).join('') : code);
    }
    function hsvFromHex(hex, previousHue = 0) {
        const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
        const v = Math.max(r, g, b), delta = v - Math.min(r, g, b);
        const sector = v === r ? (g - b) / delta : v === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        return { h: delta ? (sector * 60 + 360) % 360 : previousHue, s: v ? delta / v : 0, v };
    }
    function hexFromHsv({ h, s, v }) {
        const channel = offset => {
            const k = (offset + h / 60) % 6;
            const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
            return Math.round(value * 255).toString(16).padStart(2, '0');
        };
        return '#' + [5, 3, 1].map(channel).join('');
    }
    class SettingsColorPicker {
        constructor(ui) {
            this.ui = ui;
            this.dialog = $('settings-color-dialog');
            this.title = $('settings-color-title');
            this.hex = $('settings-color-hex');
            this.plane = this.dialog.querySelector('.settings-color-plane');
            this.hue = this.dialog.querySelector('.settings-hue');
            this.presets = this.dialog.querySelector('.settings-color-presets');
            const resize = () => {
                if (!this.active || !window.visualViewport) return;
                const { height, offsetTop } = window.visualViewport;
                this.dialog.style.setProperty('--color-viewport-height', `${height}px`);
                this.dialog.style.setProperty('--color-viewport-center', `${offsetTop + height / 2}px`);
            };
            window.visualViewport?.addEventListener('resize', resize);
            window.visualViewport?.addEventListener('scroll', resize);
            this.resize = resize;
            for (const [name, hex] of colorPresets) {
                const button = make('button', 'settings-color-preset');
                const swatch = make('span', 'settings-color-swatch');
                swatch.style.setProperty('--swatch', hex);
                button.append(swatch);
                button.type = 'button';
                button.dataset.color = hex;
                button.setAttribute('aria-label', `${name} ${hex}`);
                button.addEventListener('click', () => this.selectHex(hex));
                this.presets.append(button);
            }
            this.hex.addEventListener('input', () => {
                const hex = normalizeHex(this.hex.value);
                this.validateHex(Boolean(hex));
                if (hex) this.selectHex(hex, false);
            });
            this.hue.addEventListener('input', () => this.selectHsv({ ...this.hsv, h: Number(this.hue.value) }));
            this.dialog.querySelector('.settings-color-reset').addEventListener('click', () => this.selectHex(this.defaultColor, true, true));
            const pointer = event => {
                const rect = this.plane.getBoundingClientRect();
                this.selectHsv({ ...this.hsv, s: clampColor((event.clientX - rect.left) / rect.width),
                    v: clampColor(1 - (event.clientY - rect.top) / rect.height) });
            };
            this.plane.addEventListener('pointerdown', event => {
                if (this.gesture || event.button !== 0) return;
                this.gesture = { id: event.pointerId, hsv: this.hsv, color: this.color, reset: this.reset };
                this.plane.setPointerCapture(event.pointerId);
                pointer(event);
            });
            this.plane.addEventListener('pointermove', event => {
                if (this.gesture?.id === event.pointerId) pointer(event);
            });
            this.plane.addEventListener('pointerup', event => {
                if (this.gesture?.id !== event.pointerId) return;
                pointer(event);
                this.gesture = null;
            });
            for (const type of ['pointercancel', 'lostpointercapture']) this.plane.addEventListener(type, event => {
                if (this.gesture?.id !== event.pointerId) return;
                const { hsv, color, reset } = this.gesture;
                this.gesture = null;
                this.render(color, hsv, true, reset);
            });
            this.plane.addEventListener('keydown', event => {
                const axis = { ArrowLeft: ['s', -1], ArrowRight: ['s', 1], ArrowDown: ['v', -1], ArrowUp: ['v', 1] }[event.key];
                if (!axis) return;
                event.preventDefault();
                const [key, sign] = axis;
                this.selectHsv({ ...this.hsv, [key]: clampColor(this.hsv[key] + sign * (event.shiftKey ? .1 : .01)) });
            });
        }
        validateHex(valid) {
            this.hex.setCustomValidity(valid ? '' : 'HEXカラーコードを入力してください。');
            this.hex.setAttribute('aria-invalid', String(!valid));
        }
        selectHex(hex, write = true, reset = false) {
            this.render(hex, hsvFromHex(hex, this.hsv?.h), write, reset);
        }
        selectHsv(hsv) { this.render(hexFromHsv(hsv), hsv, true, false); }
        render(color, hsv, write, reset) {
            this.color = color;
            this.hsv = hsv;
            this.reset = reset;
            if (write) this.hex.value = color;
            this.validateHex(true);
            this.hue.value = Math.min(359, Math.round(hsv.h));
            const format = value => Math.round(value * 100);
            this.dialog.style.setProperty('--hue', hsv.h);
            this.dialog.style.setProperty('--swatch', color);
            this.plane.style.setProperty('--saturation', `${hsv.s * 100}%`);
            this.plane.style.setProperty('--value', `${(1 - hsv.v) * 100}%`);
            this.plane.setAttribute('aria-label', `彩度 ${format(hsv.s)}%、明度 ${format(hsv.v)}%`);
            for (const button of this.presets.children) button.setAttribute('aria-pressed', String(button.dataset.color === color));
        }
        async open(title, color, defaults) {
            if (this.active) return null;
            this.active = true;
            this.resize();
            this.hsv = null;
            this.gesture = null;
            this.title.textContent = title;
            this.defaultColor = defaults;
            this.selectHex(color);
            try {
                const result = await this.ui.showCustomDialog(this.dialog, this.title);
                return result === 'ok' && normalizeHex(this.hex.value) ? { color: this.color, reset: this.reset } : null;
            } finally {
                this.gesture = null;
                this.active = false;
            }
        }
    }
    class TextareaSizing {
        constructor() {
            this.promptSizes = new Map();
            const observer = new ResizeObserver(entries => {
                for (const { target } of entries) {
                    const size = this.promptSizes.get(target);
                    const { width, height } = target.getBoundingClientRect();
                    if (!size || !width || height < size.minimum) continue;
                    if (size.fitWidth && width !== size.width) {
                        this.sizePrompt(target);
                    } else if (Math.abs(height - size.applied) >= 1) {
                        size.manual = Math.min(500, Math.max(size.minimum, height));
                        size.applied = height;
                    }
                }
            });
            this.observer = observer;
        }
        observe(control, { compact = false } = {}) {
            const minimum = compact ? parseFloat(getComputedStyle(control).minHeight) || 100 : 100;
            this.promptSizes.set(control, { minimum, applied: minimum, manual: null, fitWidth: compact, width: 0 });
            control.addEventListener('input', () => this.sizePrompt(control));
            control.addEventListener('compositionend', () => this.sizePrompt(control));
            this.observer.observe(control);
            this.sizePrompt(control);
        }
        prune() {
            for (const control of this.promptSizes.keys()) {
                if (control.isConnected) continue;
                this.observer.unobserve(control);
                this.promptSizes.delete(control);
            }
        }
        sizePrompt(control) {
            if (!control.getClientRects().length || !this.promptSizes) return;
            const size = this.promptSizes.get(control); if (!size) return;
            let height = size.manual;
            const scrollTop = control.scrollTop;
            if (height === null) {
                control.style.height = size.minimum + 'px';
                const style = getComputedStyle(control);
                height = Math.min(500, Math.max(size.minimum, control.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)));
            }
            if (size.fitWidth) size.width = control.getBoundingClientRect().width;
            size.applied = height; control.style.height = `${height}px`;
            control.scrollTop = scrollTop;
        }
        syncPromptSizes() { this.promptSizes?.forEach((_, control) => this.sizePrompt(control)); }
    }
    class CategoryPane {
        constructor({ app, state, ui, name, title, titles }) {
            Object.assign(this, { app, state, ui, name, title, titles });
            this.category = null;
            this.scroll = {};
            this.sidebarCollapsed = false;
            this.media = matchMedia('(min-width: 800px)');
            this.categoryKey = `${name}Category`;
            this.screen = $(`${name}-screen`);
            this.detail = $(`${name}-detail`);
            this.navigation = $(`${name}-category-nav`);
            this.heading = $(`${name}-title`);
            this.menu = $(`${name}-menu-btn`);
            this.backButton = $(`back-to-chat-from-${name}`);
            this.buttonAttr = `data-${name}-category`;
            this.panelAttr = `data-${name}-panel`;
            this.buttons = this.screen.querySelectorAll(`[${this.buttonAttr}]`);
            this.panels = this.screen.querySelectorAll(`[${this.panelAttr}]`);
            this.buttons.forEach(button => button.addEventListener('click', () => this.selectCategory(button.getAttribute(this.buttonAttr))));
            this.menu.addEventListener('click', () => {
                if (!this.media.matches) return this.back();
                this.sidebarCollapsed = !this.sidebarCollapsed;
                this.layout();
            });
            this.media.addEventListener('change', () => {
                if (!this.media.matches && this.category && this.state.currentScreen === this.name && !this.mobileDetailPushed) {
                    history.replaceState({ screen: this.name, [this.categoryKey]: null }, '', this.hash(null));
                    history.pushState({ screen: this.name, [this.categoryKey]: this.category, settingsDetailPushed: true }, '', this.hash());
                    this.mobileDetailPushed = true;
                }
                this.layout();
                requestAnimationFrame(() => this.afterLayout());
            });
        }
        defaultCategory() { return this.media.matches ? Object.keys(this.titles)[0] : null; }
        enter(category = this.defaultCategory()) {
            this.mobileDetailPushed = false;
            this.sidebarCollapsed = false;
            this.category = category;
            this.layout();
            this.detail.scrollTop = this.scroll[this.category] || 0;
        }
        leave() { if (this.category) this.scroll[this.category] = this.detail.scrollTop; }
        afterLayout() {}
        exitToChat() { this.ui.showScreen('chat'); }
        resolveCategory(category) { return Object.hasOwn(this.titles, category) ? category : null; }
        selectCategory(category, push = true) {
            this.app.resetSwipeState?.();
            if (this.category) this.scroll[this.category] = this.detail.scrollTop;
            this.category = this.resolveCategory(category);
            this.layout(); this.detail.scrollTop = this.scroll[this.category] || 0;
            requestAnimationFrame(() => this.afterLayout());
            if (push && this.state.currentScreen === this.name) {
                const entry = { screen: this.name, [this.categoryKey]: this.category, settingsDetailPushed: this.mobileDetailPushed };
                if (this.media.matches) history.replaceState(entry, '', this.hash());
                else {
                    if (this.category && !this.mobileDetailPushed) {
                        history.replaceState({ screen: this.name, [this.categoryKey]: null }, '', this.hash(null));
                        history.pushState({ ...entry, settingsDetailPushed: true }, '', this.hash());
                        this.mobileDetailPushed = true;
                    } else history.replaceState(entry, '', this.hash());
                }
            }
        }
        hash(category = this.category) {
            return category ? `#${this.name}/${category}` : `#${this.name}`;
        }
        getHashEntry() {
            const [screen, category, extra] = location.hash.slice(1).split('/');
            if (screen !== this.name || extra !== undefined) return null;
            if (category === undefined) return { screen: this.name };
            const resolved = this.resolveCategory(category);
            return resolved ? { screen: this.name, [this.categoryKey]: resolved } : null;
        }
        restore(entry) {
            this.mobileDetailPushed = entry?.settingsDetailPushed === true;
            const category = entry?.[this.categoryKey];
            if (category === null) this.sidebarCollapsed = false;
            this.selectCategory(category === undefined ? this.defaultCategory() : category, false);
        }
        back() {
            if (!this.media.matches && this.category) {
                if (this.mobileDetailPushed) history.back();
                else this.selectCategory(null);
            } else this.exitToChat();
        }
        layout(selected = this.category, sidebarCollapsed = this.sidebarCollapsed) {
            const { screen, menu } = this;
            const focused = document.activeElement;
            const previousCategory = this.navigation.querySelector('[aria-current="page"]');
            const wide = this.media.matches;
            const expanded = wide ? !sidebarCollapsed : !selected;
            screen.classList.toggle('settings-show-top', !selected);
            screen.classList.toggle('settings-sidebar-collapsed', sidebarCollapsed);
            this.panels.forEach(panel => panel.hidden = panel.getAttribute(this.panelAttr) !== selected);
            this.buttons.forEach(button => {
                if (button.getAttribute(this.buttonAttr) === selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
            });
            this.heading.textContent = this.titles[selected] || this.title;
            menu.querySelector('.material-symbols-outlined').textContent = wide ? 'menu' : 'chevron_left';
            menu.setAttribute('aria-expanded', String(expanded));
            const label = !wide ? 'カテゴリ一覧へ戻る' : expanded ? 'カテゴリを閉じる' : 'カテゴリを開く';
            menu.setAttribute('aria-label', this.title + label);
            menu.title = this.title + label;

            if (!screen.inert && screen.contains(focused) && !focused.getClientRects().length) {
                const destination = !wide && !selected ? previousCategory || this.backButton : menu;
                destination.focus({ preventScroll: true });
            }
        }
    }
    class SettingsUI extends CategoryPane {
        constructor({ app, state, ui }) {
            const titles = Object.fromEntries([...$('settings-detail').querySelectorAll('[data-settings-panel]')]
                .map(panel => [panel.dataset.settingsPanel, panel.getAttribute('aria-label')]));
            super({ app, state, ui, name: 'settings', title: '設定', titles });
            this.editedGlobalInputs = new Set();
            this.editedProfileInputs = new Map();
            this.modelSelects = new Map();
            this.choiceSelects = new Map();
            this.saveQueue = Promise.resolve(); this.urls = new Map(); this.previewVersions = new Map();
            this.init();
        }
        resolveCategory(category) {
            return super.resolveCategory(Object.hasOwn(legacySettingsCategories, category) ? legacySettingsCategories[category] : category);
        }
        selectCategory(category, push = true) {
            if (this.detail.contains(this.anchor) && this.resolveCategory(category) !== this.category) this.closePopover(false);
            if (this.category === 'api-model' && this.resolveCategory(category) !== 'api-model') this.setApiReorderMode(false);
            super.selectCategory(category, push);
        }
        leave() {
            this.setApiReorderMode(false);
            super.leave();
        }
        setApiReorderMode(active) {
            const button = $('api-reorder-btn');
            $('api-settings-group').classList.toggle('api-reordering', active);
            $('add-api-config-btn').hidden = active;
            button.setAttribute('aria-pressed', String(active));
            button.textContent = active ? '完了' : '並べ替え';
        }
        init() {
            this.media.addEventListener('change', () => {
                if ((this.popover?.refreshModels || this.popover?.refreshProfiles) &&
                    !this.popover.hasAttribute('data-settings-picker') &&
                    !this.popover.profileSwitchPending && (this.popover instanceof HTMLDialogElement) === this.media.matches) {
                    const anchor = this.anchor, query = this.popover.querySelector('.model-picker-search').value;
                    const profiles = Boolean(this.popover.refreshProfiles);
                    this.closePopover(false);
                    if (profiles) this.openProfiles(anchor, query);
                    else this.openModels(anchor, query);
                }
            });
            for (const kind of ['theme', 'appearance']) {
                const profile = $(`profile-${kind}-editor`);
                for (const section of kind === 'theme' ? ['theme', 'color'] : ['appearance']) {
                    const group = $(`global-${section}-editor`).cloneNode(true);
                    group.removeAttribute('data-appearance-editor');
                    group.removeAttribute('data-kind');
                    group.querySelector('.settings-scope')?.remove();
                    profile.append(group);
                }
                if (kind === 'theme') profile.querySelector('h2').textContent = 'テーマ';
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
            this.colorPicker = new SettingsColorPicker(this.ui);
            this.prepareSettingsRows();
            this.prepareColorRows();
            $('api-reorder-btn').addEventListener('click', event => {
                this.setApiReorderMode(event.currentTarget.getAttribute('aria-pressed') !== 'true');
            });
            const apiDialog = $('api-config-dialog');
            const provider = $('api-config-provider');
            const providerField = make('div', 'settings-field');
            const providerLabel = apiDialog.querySelector('label[for="api-config-provider"]');
            providerLabel.before(providerField);
            providerField.append(providerLabel, provider);
            this.prepareSelectRow(providerField, providerLabel, provider);
            apiDialog.addEventListener('close', () => {
                if (apiDialog.contains(this.anchor)) this.closePopover(false);
            });
            this.bindPromptSizing();
            this.bindAppearanceEditors();
            this.bindAuxiliaryModelSettings();
            this.bindMemoryExtractionSettings();
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
                if (this.popover && !this.popover.profileSwitchPending &&
                    !this.popover.contains(event.target) && !this.anchor?.contains(event.target)) this.closePopover(false);
            });
            document.addEventListener('keydown', event => {
                this.setInputMode('keyboard');
                if (!this.popover || this.popover instanceof HTMLDialogElement) return;
                if (event.isComposing || this.popover.profileSearchComposing) return;
                if (event.key === 'Escape') { event.preventDefault(); this.closePopover(true); }
                if (event.key === 'Tab' && this.popover.classList.contains('settings-choice-popover')) this.closePopover(true);
                else if (event.key === 'Tab' && !this.popover.refreshProfiles) this.closePopover(false);
            });
            const position = () => this.positionPopover();
            window.addEventListener('resize', position);
            window.addEventListener('chat-workspace-layout', () => {
                if (this.anchor?.closest('#chat-workspace')?.inert) this.closePopover(false);
                else this.positionPopover();
            });
            document.addEventListener('scroll', event => {
                if (!this.popover?.layoutProfiles || !this.popover.contains(event.target)) position();
            }, true);
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
                const type = event.detail?.type;
                if (type === 'capabilities') {
                    const ref = this.app.getCurrentChatModelRef();
                    if (event.detail.apiConfigId !== ref?.apiConfigId ||
                        (event.detail.modelName && event.detail.modelName !== ref?.modelName)) return;
                }
                if (type === 'chat' || type === 'capabilities') {
                    this.renderExecution();
                    if (this.popover?.refreshThinking) this.popover.refreshThinking();
                    else if (type === 'chat' && this.popover && !this.popover.refreshProfiles) this.closePopover(this.popover.contains(document.activeElement));
                } else {
                    if (type === 'global') this.syncGlobalForms();
                    if (type === 'profile') this.popover?.refreshProfiles?.();
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
                const next = label.nextElementSibling;
                const control = next?.matches('.image-upload-controls') || !label.htmlFor
                    ? next : root.querySelector(`#${CSS.escape(label.htmlFor)}`);
                if (!toggle && (!control || control.parentElement !== label.parentElement || !control.matches('input,select,textarea,.image-upload-controls'))) return;
                const field = make('div', toggle ? 'settings-field settings-toggle' : 'settings-field');
                label.before(field); field.append(label);
                if (!toggle) field.append(control);
                while (field.nextElementSibling?.matches('p:not(.settings-footer,.settings-scope)')) field.append(field.nextElementSibling);
                if (field.nextElementSibling?.id === 'settings-thinking-button') {
                    field.append(field.nextElementSibling);
                    while (field.nextElementSibling?.matches('p:not(.settings-footer,.settings-scope)')) field.append(field.nextElementSibling);
                }
                if (!toggle && control.matches('input[type=number]') && field.nextElementSibling?.tagName === 'SPAN' && field.nextElementSibling.textContent.trim() === '秒') {
                    const unit = field.nextElementSibling, row = make('div', 'settings-input-with-unit');
                    control.before(row); row.append(control, unit);
                    while (field.nextElementSibling?.matches('p:not(.settings-footer,.settings-scope)')) field.append(field.nextElementSibling);
                }
            });
            root.querySelectorAll('.settings-group div').forEach(node => {
                if (node.matches('.settings-field,.settings-group,.param-grid,.chat-display-settings-row,.chat-display-setting')) return;
                if ([...node.children].some(child => child.classList.contains('settings-field'))) node.classList.add('settings-field-stack');
            });
        }
        prepareSettingsRows() {
            const detail = this.detail;
            const modelIds = new Set(['model-name', ...Object.values(SettingsV136.auxiliaryModelSelectIds)]);
            for (const field of detail.querySelectorAll('.settings-field')) {
                const label = field.querySelector(':scope > label');
                const checkbox = label?.querySelector('input[type=checkbox]');
                const control = checkbox || field.querySelector(
                    ':scope > :is(input,select,textarea), :scope > .settings-input-with-unit > input, :scope > .image-upload-controls > button:first-of-type');
                if (!label || !control) continue;
                const notes = [...field.querySelectorAll(':scope > p:not([role],.model-route-note)')];
                const descriptions = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
                notes.forEach((note, index) => {
                    note.classList.add('settings-supporting-text');
                    if (!control.id) return;
                    note.id ||= `${control.id}-support-${index + 1}`;
                    descriptions.add(note.id);
                });
                if (descriptions.size) control.setAttribute('aria-describedby', [...descriptions].join(' '));
                if (checkbox) {
                    checkbox.setAttribute('role', 'switch');
                    label.classList.add('settings-switch');
                    const name = make('span', 'settings-row-label');
                    name.id = `${checkbox.id}-row-label`;
                    const copy = make('span', 'settings-row-copy');
                    name.append(...[...label.childNodes].filter(node => node !== checkbox));
                    copy.append(name, ...this.inlineSupportingText(notes));
                    label.prepend(copy);
                    checkbox.setAttribute('aria-labelledby', name.id);
                    continue;
                }
                if (control.matches('.image-upload-controls > button')) {
                    const controls = control.parentElement;
                    control.className = 'settings-row-action settings-background-trigger';
                    const copy = make('span', 'settings-row-copy');
                    copy.append(make('span', 'settings-row-label', label.textContent.trim()), ...this.inlineSupportingText(notes));
                    const value = make('span', 'settings-background-value');
                    value.append(controls.querySelector('img'), controls.querySelector('.settings-background-empty'));
                    control.replaceChildren(copy, value);
                    label.hidden = true;
                    field.prepend(control);
                    field.after(controls.querySelector('.settings-delete-button'));
                } else if (control.matches('select')) this.prepareSelectRow(field, label, control, modelIds.has(control.id));
                else if (control.matches('textarea')) this.preparePromptRow(field, label, control);
                else {
                    field.classList.add('settings-inline-row');
                    const copy = make('div', 'settings-row-copy');
                    label.before(copy);
                    copy.append(label, ...notes);
                }
            }
            for (const control of detail.querySelectorAll('input[data-example]')) {
                const unset = control.placeholder;
                control.addEventListener('focus', () => { control.placeholder = control.dataset.example; });
                control.addEventListener('blur', () => { control.placeholder = unset; });
            }
            for (const group of detail.querySelectorAll(':is(.settings-category-panel,.profile-appearance-editor) > .settings-group')) {
                const island = make('div', 'settings-island');
                const footers = [...group.querySelectorAll(':scope > :is(.settings-scope,.settings-footer)')];
                const content = [...group.children].filter(child => !child.matches('h2,h3,h4,.sync-header,.settings-section-header,.settings-scope,.settings-footer'));
                group.append(island);
                island.append(...content);
                group.append(...footers);
            }
        }
        inlineSupportingText(notes) {
            return notes.map(note => {
                const inline = make('span', 'settings-supporting-text');
                if (note.id) inline.id = note.id;
                inline.append(...note.childNodes);
                note.remove();
                return inline;
            });
        }
        prepareSelectRow(field, label, select, model = false) {
            const title = label.textContent.trim().replace(/[:：]$/, '');
            const button = make('button', 'settings-row-action');
            button.type = 'button';
            if (!model) button.dataset.settingsChoice = select.id;
            button.setAttribute('aria-haspopup', 'dialog');
            button.setAttribute('aria-expanded', 'false');
            const value = make('span', 'settings-row-value');
            const copy = make('span', 'settings-row-copy');
            copy.append(make('span', 'settings-row-label', title),
                ...this.inlineSupportingText([...field.querySelectorAll(':scope > .settings-supporting-text')]));
            button.append(copy, value);
            label.hidden = true;
            select.classList.add('settings-backed-select');
            field.prepend(button);
            if (model) select.hidden = true;
            (model ? this.modelSelects : this.choiceSelects).set(button, { select, title, value });
            button.addEventListener('click', () => model ? this.openModels(button) : this.openChoices(button));
            select.addEventListener('change', () => this.syncSelectRow(button));
            // Model option builders replace options and then assign their selected value.
            new MutationObserver(() => {
                this.syncSelectRow(button);
                if (this.anchor === button) {
                    this.popover?.refreshModels?.();
                    this.popover?.refreshChoices?.();
                }
            }).observe(select, { childList: true, attributes: true, subtree: true, attributeFilter: ['disabled','selected','label','hidden'] });
            this.syncSelectRow(button);
        }
        syncChoiceRows() {
            for (const button of this.choiceSelects.keys()) this.syncSelectRow(button);
            this.popover?.refreshChoices?.();
        }
        focusChoiceSelect(select) {
            this.syncChoiceRows();
            const trigger = [...this.choiceSelects].find(([, choice]) => choice.select === select)?.[0];
            (trigger || select).focus({ preventScroll: true });
        }
        syncSelectRow(button) {
            const model = this.modelSelects.get(button);
            const { select, title, value } = model || this.choiceSelects.get(button);
            const selected = select.selectedOptions[0];
            const fullName = model && !select.value ? '未設定' : selected?.label || '未設定';
            const modelName = model && this.app.decodeModelRefValue(select.value)?.modelName;
            const unavailable = selected?.disabled || selected?.dataset.unavailable === 'true';
            value.textContent = (unavailable ? fullName : modelName || fullName) || '未設定';
            button.title = fullName || '未設定';
            button.disabled = select.disabled;
            button.setAttribute('aria-label', `${title} ${fullName || '未設定'}`);
            const description = [select.getAttribute('aria-describedby'), select.parentElement.querySelector('.model-route-note')?.id]
                .filter(Boolean).join(' ');
            if (description) button.setAttribute('aria-describedby', description);
        }
        preparePromptRow(field, label, textarea) {
            const button = make('button', 'settings-row-action', label.textContent.trim().replace(/[:：]$/, ''));
            button.type = 'button';
            const editor = make('div', 'settings-prompt-editor');
            editor.id = `${textarea.id}-editor`;
            editor.hidden = true;
            button.setAttribute('aria-controls', editor.id);
            button.setAttribute('aria-expanded', 'false');
            label.classList.add('settings-visually-hidden');
            editor.append(...field.children);
            editor.append(...field.parentElement.querySelectorAll(`[data-settings-editor="${CSS.escape(textarea.id)}"]`));
            field.append(button, editor);
            button.addEventListener('click', () => {
                editor.hidden = !editor.hidden;
                button.setAttribute('aria-expanded', String(!editor.hidden));
                if (!editor.hidden) {
                    this.syncPromptSizes();
                    textarea.focus({ preventScroll: true });
                    textarea.scrollIntoView({ block: 'nearest' });
                }
            });
        }
        enter(category) {
            this.closePopover(false);
            super.enter(category);
            const danger = $('data-danger-settings').querySelector('details'); if (danger) danger.open = false;
            this.syncGlobalForms(); this.app.reloadGlobalSettingsV136().catch(() => {});
        }
        bindPromptSizing() {
            this.textareaSizing = new TextareaSizing();
            this.detail.querySelectorAll('textarea').forEach(control => this.textareaSizing.observe(control, { compact: true }));
            this.textareaSizing.observe($('api-config-additional-models'), { compact: true });
        }
        syncPromptSizes() { this.textareaSizing?.syncPromptSizes(); }
        afterLayout() { this.syncPromptSizes(); this.syncChoiceRows(); this.positionPopover(); }
        syncGlobalForms() {
            const global = this.state.globalSettingsV136;
            if (!global) return;
            this.app.updateAuxiliaryModelOptions();
            this.syncMemoryExtractionPrompt();
            for (const [key, control] of Object.entries(this.app.globalSettingControlsV136 || {})) {
                if (control === document.activeElement && this.editedGlobalInputs.has(control)) continue;
                const value = key === 'includeThoughts' ? global.showThoughtProcess : global[key] ?? SettingsV136.chatTitleDefaults[key];
                if (control.type === 'checkbox') control.checked = value === true;
                else if (control.value !== String(value ?? '')) control.value = value ?? '';
            }
            for (const [id, visible] of [
                ['auto-retry-options', global.enableAutoRetry],
                ['api-timeout-options', global.enableApiTimeout]
            ]) $(id)?.classList.toggle('hidden', visible !== true);
            $('proofreading-options').classList.remove('hidden'); this.syncPromptSizes();
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
                        const value = key === 'darkMode' ? control.value === 'dark' : control.type === 'range' ? Number(control.value) / 100 : control.value;
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
        prepareColorRows() {
            for (const row of this.detail.querySelectorAll('.color-setting-row')) {
                const label = row.querySelector('label');
                const controls = row.querySelector('.color-setting-controls');
                const input = controls.querySelector('input[type=color]');
                const reset = controls.querySelector('button');
                const key = themeFields[input.dataset.sourceId || input.id];
                const editor = row.closest('[data-appearance-editor]');
                const button = make('button', 'settings-row-action settings-color-trigger', label.textContent.trim());
                const swatch = make('span', 'settings-color-swatch');
                swatch.setAttribute('aria-hidden', 'true');
                button.type = 'button';
                button.setAttribute('aria-haspopup', 'dialog');
                button.setAttribute('aria-controls', 'settings-color-dialog');
                button.dataset.colorInput = input.id;
                row.classList.add('settings-field');
                row.prepend(button);
                button.append(swatch);
                label.hidden = controls.hidden = true;
                button.addEventListener('click', async () => {
                    if (input.disabled) return;
                    const own = editor.dataset.appearanceEditor === 'profile';
                    const profileId = this.state.activeProfileId;
                    const initial = input.value;
                    const theme = own ? this.app.getProfileAppearanceSettings().theme : this.state.globalSettingsV136.theme;
                    const defaults = this.app.normalizeGlobalThemeSettings({});
                    const defaultColor = defaults[key] || (theme?.darkMode ? '#007aff' : '#1976d2');
                    const result = await this.colorPicker.open(label.textContent.trim(), initial, defaultColor);
                    if (!result || input.disabled || !button.getClientRects().length || (own && profileId !== this.state.activeProfileId)) return;
                    if (result.reset) reset.click();
                    else if (input.value !== result.color) {
                        input.value = result.color;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
            }
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
                    if (!key || (key !== 'darkMode' && control === document.activeElement)) return;
                    const value = values[key];
                    if (key === 'darkMode') control.value = value === true ? 'dark' : 'light';
                    else if (control.type === 'range') control.value = Math.round((value ?? 1) * 100);
                    else control.value = control.type === 'color' ? (value || (values.darkMode ? '#007aff' : '#1976d2')) : value || '';
                });
                if (kind === 'theme') {
                    const accentMode = values.themeColorMode !== 'individual';
                    const accent = editor.querySelector('[id$="accent-color-settings"]');
                    const individual = editor.querySelector('[id$="individual-color-settings"]');
                    if (accent) accent.hidden = !accentMode;
                    if (individual) individual.hidden = accentMode;
                    editor.querySelectorAll('input,select,button').forEach(control => {
                        const id = control.dataset.sourceId || control.id;
                        control.disabled = Boolean(control.closest('.theme-setting-subsection[hidden]'))
                            || id === 'header-text-color-input' && values.headerTextColorMode !== 'custom';
                    });
                    editor.querySelectorAll('.settings-color-trigger').forEach(button => {
                        const input = $(button.dataset.colorInput);
                        button.disabled = input.disabled;
                        button.lastElementChild.style.setProperty('--swatch', input.value);
                        button.setAttribute('aria-label', `${button.firstChild.textContent} ${input.value}`);
                    });
                    accent?.classList.remove('is-disabled');
                    individual?.classList.remove('is-disabled');
                } else {
                    for (const [id, key] of Object.entries(appearanceFields)) {
                        const output = editor.querySelector(own ? `[data-source-id="${id.replace('-slider', '-value')}"]` : `#${id.replace('-slider', '-value')}`);
                        if (output) output.textContent = `${Math.round((values[key] ?? 1) * 100)}%`;
                    }
                    this.updatePreview(editor, values.backgroundAssetId);
                }
            });
            this.syncChoiceRows();
        }
        async updatePreview(editor, id) {
            const image = editor.querySelector('img'), button = editor.querySelector('button.settings-delete-button');
            editor.querySelector('.settings-background-empty').textContent = id ? '設定済み' : '未設定';
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
        bindAuxiliaryModelSettings() {
            const { auxiliaryModelSelectIds, auxiliaryLegacyModelKeys } = SettingsV136;
            for (const [key, id] of Object.entries(auxiliaryModelSelectIds)) {
                const select = $(id);
                select.addEventListener('change', () => {
                    const ref = this.app.decodeModelRefValue(select.value);
                    this.save(select, async () => {
                        try {
                            if (ref) this.app.assertModelRefForExecution(ref, key);
                            const updates = { [key]: ref };
                            const legacyKey = auxiliaryLegacyModelKeys[key];
                            if (legacyKey) updates[legacyKey] = ref?.modelName || '';
                            await this.app.saveGlobalSettingsV136(updates);
                        } catch (error) {
                            this.app.updateAuxiliaryModelOptions();
                            throw error;
                        }
                    });
                });
            }
        }
        bindMemoryExtractionSettings() {
            const prompt = $('memory-extraction-prompt');
            const savePrompt = () => {
                const value = prompt.value;
                this.save(prompt, () => this.app.saveGlobalSettingsV136({ memoryExtractionPrompt: value }));
            };
            prompt.addEventListener('input', () => {
                this.editedGlobalInputs.add(prompt);
                savePrompt();
            });
            $('reset-memory-extraction-prompt').addEventListener('click', () => {
                prompt.value = SettingsV136.DEFAULT_MEMORY_EXTRACTION_PROMPT;
                savePrompt();
            });
        }
        syncMemoryExtractionPrompt() {
            const prompt = $('memory-extraction-prompt');
            const value = this.app.getMemoryExtractionPromptV136();
            if (prompt.value !== value && (prompt !== document.activeElement || !this.editedGlobalInputs.has(prompt))) prompt.value = value;
        }
        refresh() { this.syncAppearanceEditors(); this.syncMemoryExtractionPrompt(); this.renderExecution(); this.syncPromptSizes(); this.popover?.refreshModels?.(); }
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
            const c = this.app.getModelThinkingCapability(ref), effort = displayedThinkingEffort(this.app, c);
            const canThink = validation.valid && (c.levels.length > 0 || c.modelDefault);
            $('chat-thinking-label').hidden = !canThink; $('chat-thinking-label').textContent = canThink ? levelName(effort, c) : '';
            $('chat-model-button').setAttribute('aria-label', `${canThink ? 'モデルとThinkingを選択' : 'モデルを選択'}: ${$('chat-model-button').title}${canThink ? ` / Thinking: ${levelName(effort, c)}` : ''}`);
            const select = $('settings-thinking-button'); select.hidden = !canThink; select.disabled = this.state.isSending || pending;
            const field = select.closest('.settings-field'); if (field) field.hidden = !canThink;
            const levels = c.levels.slice().sort((a,b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
            if (c.modelDefault) levels.unshift(modelDefault);
            if (c.rejectedLevels?.includes(effort)) levels.unshift(effort);
            const options = levels.map(value => ({ value, label: levelName(value, c), disabled: c.rejectedLevels?.includes(value) === true }));
            if (select.options.length !== options.length || options.some(({value, label, disabled}, index) =>
                select.options[index].value !== value || select.options[index].textContent !== label || select.options[index].disabled !== disabled)) {
                select.replaceChildren(...options.map(({value, label, disabled}) => {
                    const option = make('option', '', label);
                    option.value = value; option.disabled = disabled;
                    return option;
                }));
            }
            select.value = effort || ''; select.title = `Thinkingレベル: ${levelName(effort, c)}`;
            this.syncChoiceRows();
            const pickerSelect = this.modelSelects.get(this.anchor)?.select;
            if (this.state.isSending && !this.choiceSelects.has(this.anchor) && (!pickerSelect || pickerSelect.id === 'model-name')) this.closePopover(false);
        }
        openExecution(anchor) {
            if (this.state.isSending || anchor.disabled) return;
            const ref = this.app.getCurrentChatModelRef();
            const capability = this.app.getModelThinkingCapability(ref);
            if (ref && this.app.validateModelRefForUsage(ref).valid && (capability.levels.length || capability.modelDefault)) this.openThinking(anchor);
            else this.openModels(anchor);
        }
        setInputMode(mode) {
            this.inputMode = mode;
            // Chrome may retain :focus-visible after keyboard -> touch on the same trigger.
            for (const node of [$('chat-model-button'), $('settings-thinking-button'), $('profile-card-header'), $('profile-card-header-settings'), this.popover]) {
                if (node) node.dataset.inputMode = mode;
            }
        }
        newPopover(anchor, label, modal = false) {
            if (anchor.closest('#chat-workspace')?.inert) return null;
            if (this.anchor === anchor && this.popover) { this.closePopover(true); return null; }
            this.app.resetSwipeState?.();
            this.closePopover(false); this.anchor = anchor;
            const panel = make(modal ? 'dialog' : 'div', 'execution-popover'); panel.id = 'execution-popover';
            panel.toggleAttribute('data-settings-picker', Boolean(anchor.closest('#settings-screen')));
            panel.dataset.inputMode = anchor.dataset.inputMode || this.inputMode || 'keyboard';
            panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', label);
            document.body.append(panel); this.popover = panel;
            anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-controls', panel.id);
            return panel;
        }
        createSearchPicker(panel, titleText, searchLabel, query) {
            panel.classList.add('selection-picker');
            const title = make('h2', 'popover-title', titleText);
            let close;
            if (panel instanceof HTMLDialogElement) {
                panel.classList.add('custom-dialog', 'execution-model-dialog');
                const header = make('div', 'execution-model-dialog-header');
                title.id = 'execution-picker-title';
                panel.setAttribute('aria-labelledby', title.id);
                close = make('button', 'api-config-icon-button', '×'); close.type = 'button';
                close.setAttribute('aria-label', '閉じる');
                close.addEventListener('click', () => this.closePopover(true));
                header.append(title, close); panel.append(header);
                panel.addEventListener('close', () => {
                    if (this.popover === panel) this.closePopover(true);
                });
            } else panel.append(title);
            const search = make('input', 'model-picker-search');
            search.type = 'search';
            search.placeholder = searchLabel;
            search.setAttribute('aria-label', searchLabel);
            panel.append(search);
            search.value = query;
            const list = make('div', 'model-picker-list'); panel.append(list);
            return { close, search, list };
        }
        openModels(anchor, query = '', forceModal = false) {
            const setting = this.modelSelects.get(anchor);
            const select = setting?.select;
            const isAuxiliary = select && select.id !== 'model-name';
            if (anchor.disabled || this.state.isSending && !isAuxiliary) return;
            const title = setting?.title || 'モデル';
            const modal = forceModal || !this.media.matches && !anchor.closest('#settings-screen');
            const panel = this.newPopover(anchor, setting ? title : 'チャットモデルを選択', modal); if (!panel) return;
            const { close, search, list } = this.createSearchPicker(panel, title, 'モデルを検索', query);
            const render = () => {
                const focused = list.contains(document.activeElement) ? document.activeElement.dataset.modelRefValue : null;
                list.replaceChildren(); let group = null;
                const current = this.app.getCurrentChatModelRef();
                const filter = search.value.toLowerCase();
                const choices = this.app.buildModelRefOptions();
                const allowed = select ? new Set([...select.options].filter(option => !option.disabled).map(option => option.value)) : null;
                const showChoice = choice => {
                    if (group !== choice.apiConfigId) { list.append(make('h3', 'model-picker-group', choice.apiConfigName)); group = choice.apiConfigId; }
                    const button = make('button', 'model-picker-choice settings-choice-option');
                    button.type = 'button';
                    button.append(make('span', 'settings-choice-label', choice.modelName));
                    button.dataset.modelRefValue = choice.value;
                    const selected = select ? select.value === choice.value
                        : current?.apiConfigId === choice.apiConfigId && current?.modelName === choice.modelName;
                    button.setAttribute('aria-pressed', String(selected));
                    button.addEventListener('click', () => {
                        if (select) {
                            if (this.popover !== panel || select.disabled || this.state.isSending && !isAuxiliary) return;
                            const option = [...select.options].find(option => option.value === choice.value);
                            if (!option || option.disabled) return;
                            if (select.value !== choice.value) {
                                select.value = choice.value;
                                select.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            this.closePopover(true);
                            return;
                        }
                        const chatId = this.state.currentChatId, generation = this.state.executionInitGeneration;
                        this.save(modal ? list : anchor, async () => {
                            if (this.popover !== panel || chatId !== this.state.currentChatId || generation !== this.state.executionInitGeneration) return;
                            await this.app.setCurrentChatModelRef({ apiConfigId: choice.apiConfigId, modelName: choice.modelName });
                            if (this.popover === panel) this.closePopover(true);
                        });
                    }); list.append(button);
                    if (choice.value === focused) button.focus({ preventScroll: true });
                };
                if (isAuxiliary && '未設定'.includes(filter)) showChoice({ value: '', modelName: '未設定', apiConfigId: null });
                choices.filter(choice => (!allowed || allowed.has(choice.value)) && choice.label.toLowerCase().includes(filter)).forEach(showChoice);
                if (!list.querySelector('button')) list.append(make('p', 'settings-description', '選択できるモデルがありません。API・モデルでAPI設定を追加してください。'));
            };
            panel.refreshModels = render;
            search.addEventListener('compositionstart', () => { panel.searchComposing = true; });
            search.addEventListener('compositionend', () => { panel.searchComposing = false; this.positionPopover(); });
            search.addEventListener('input', () => { render(); this.positionPopover(); }); render();
            this.bindChoiceKeys(panel, list, search);
            if (modal) panel.showModal();
            this.positionPopover();
            (list.querySelector('[aria-pressed=true]') || list.querySelector('button') || close || search).focus();
        }
        bindChoiceKeys(panel, list, search) {
            panel.addEventListener('keydown', event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                if (event.target === search && ['Home', 'End'].includes(event.key)) return;
                const buttons = [...list.querySelectorAll('button:not(:disabled)')]; if (!buttons.length) return;
                event.preventDefault(); const index = buttons.indexOf(document.activeElement);
                buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length].focus();
            });
        }
        openChoices(anchor) {
            this.syncSelectRow(anchor);
            if (anchor.disabled) return;
            const { select, title } = this.choiceSelects.get(anchor);
            const host = anchor.closest('dialog[open]');
            const modal = Boolean(host && !('showPopover' in HTMLElement.prototype));
            const panel = this.newPopover(anchor, title, modal);
            if (!panel) return;
            panel.classList.add('settings-choice-popover', 'selection-picker');
            const list = make('div', 'settings-choice-list');
            panel.append(list);
            panel.refreshChoices = () => {
                if (select.disabled || !anchor.getClientRects().length) return this.closePopover(false);
                const focus = list.contains(document.activeElement) ? document.activeElement.dataset.optionIndex : null;
                const choices = [...select.options].filter(option => !option.hidden && !option.closest('optgroup[hidden]'));
                const signature = JSON.stringify(choices.map(option => [option.index, option.label,
                    option.disabled || Boolean(option.closest('optgroup[disabled]')), option.selected]));
                if (list.dataset.options === signature) return;
                list.dataset.options = signature;
                list.replaceChildren(...choices.map(option => {
                    const button = make('button', 'settings-choice-option');
                    button.append(make('span', 'settings-choice-label', option.label));
                    button.type = 'button';
                    button.dataset.optionIndex = String(option.index);
                    button.disabled = option.disabled || Boolean(option.closest('optgroup[disabled]'));
                    button.setAttribute('aria-pressed', String(option.selected));
                    button.addEventListener('click', () => {
                        if (select.disabled || !option.isConnected || option.disabled || option.closest('optgroup[disabled]')) return;
                        const index = option.index;
                        this.closePopover(true);
                        if (select.selectedIndex === index) return;
                        select.selectedIndex = index;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                    return button;
                }));
                if (focus !== null) (list.querySelector(`[data-option-index="${focus}"]:not(:disabled)`)
                    || list.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
            };
            this.bindChoiceKeys(panel, list);
            if (modal) {
                panel.showModal();
            } else if (host) {
                host.append(panel);
                panel.setAttribute('popover', 'manual');
                panel.showPopover();
            }
            panel.refreshChoices();
            this.positionPopover();
            (list.querySelector('[aria-pressed=true]:not(:disabled)') || list.querySelector('button:not(:disabled)'))
                ?.focus({ preventScroll: true });
        }
        openProfiles(anchor, query = '', forceModal = false) {
            if (this.state.isSending) return;
            const modal = forceModal || !this.media.matches && !anchor.closest('#settings-screen');
            const panel = this.newPopover(anchor, 'プロファイル', modal);
            if (!panel) return;
            panel.classList.add('profile-picker-panel');
            const { close, search, list } = this.createSearchPicker(panel, 'プロファイル', 'プロファイルを検索', query);
            list.classList.add('profile-picker-list');
            list.setAttribute('role', 'group');
            list.setAttribute('aria-label', 'プロファイル一覧');
            list.tabIndex = -1;
            const status = make('p', 'settings-inline-status profile-picker-status');
            status.setAttribute('role', 'status');
            panel.append(status);

            const rowHeight = 44, overscan = 4;
            list.style.setProperty('--profile-picker-row-height', `${rowHeight}px`);
            let results = [], first = -1, end = -1;
            const spacer = height => {
                const node = make('div');
                node.style.height = `${height}px`;
                node.setAttribute('aria-hidden', 'true');
                return node;
            };
            const render = (force = false) => {
                const visibleStart = Math.floor(list.scrollTop / rowHeight);
                const visibleEnd = Math.ceil((list.scrollTop + list.clientHeight) / rowHeight);
                const start = Math.max(0, visibleStart - overscan);
                const finish = Math.min(results.length, visibleEnd + overscan);
                if (!force && start === first && finish === end) return;
                first = start; end = finish;
                const focused = list.contains(document.activeElement) ? document.activeElement.dataset.profileId : null;
                const visible = results.slice(start, finish);
                const tabTarget = visible.find(profile => String(profile.id) === focused)
                    || visible.find(profile => profile.id === this.state.activeProfileId) || results[visibleStart];
                const rows = visible.map(profile => {
                    const row = make('button', 'model-picker-choice profile-picker-choice settings-choice-option');
                    row.type = 'button';
                    row.dataset.profileId = String(profile.id);
                    row.title = profile.name;
                    row.tabIndex = profile === tabTarget ? 0 : -1;
                    row.setAttribute('aria-pressed', String(profile.id === this.state.activeProfileId));
                    row.setAttribute('aria-disabled', String(Boolean(panel.profileSwitchPending)));
                    const icon = make('span', 'profile-picker-icon');
                    this.ui.renderProfileIcon(icon, profile);
                    row.append(icon, make('span', 'profile-picker-name', profile.name));
                    return row;
                });
                list.replaceChildren(spacer(start * rowHeight), ...rows, spacer((results.length - finish) * rowHeight));
                this.ui.retainProfileIconUrls(visible.map(profile => profile.id));
                if (focused) (rows.find(row => row.dataset.profileId === focused) || list).focus({ preventScroll: true });
            };
            const filter = (resetScroll = false) => {
                const term = search.value.trim().toLowerCase();
                results = this.state.profiles.filter(profile => String(profile.name ?? '').toLowerCase().includes(term));
                list.hidden = !results.length;
                if (resetScroll) list.scrollTop = 0;
                else list.scrollTop = Math.min(list.scrollTop, Math.max(0, results.length * rowHeight - list.clientHeight));
                if (!panel.profileSwitchPending) status.textContent = results.length ? '' : '該当するプロファイルがありません';
                render(true);
                this.positionPopover();
            };
            const focusRow = index => {
                if (index < 0 || index >= results.length) return;
                const top = index * rowHeight;
                if (top < list.scrollTop) list.scrollTop = top;
                if (top + rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + rowHeight - list.clientHeight;
                render();
                list.querySelector(`[data-profile-id="${results[index].id}"]`)?.focus({ preventScroll: true });
            };
            panel.refreshProfiles = filter;
            panel.layoutProfiles = render;
            list.addEventListener('scroll', () => render());
            list.addEventListener('focusin', event => {
                const row = event.target.closest('.profile-picker-choice');
                if (!row) return;
                list.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
                row.tabIndex = 0;
            });
            list.addEventListener('click', async event => {
                const row = event.target.closest('.profile-picker-choice');
                if (!row || panel.profileSwitchPending) return;
                const id = Number(row.dataset.profileId);
                if (id === this.state.activeProfileId) { this.closePopover(true); return; }
                panel.profileSwitchPending = true;
                list.setAttribute('aria-busy', 'true');
                status.textContent = 'プロファイルを切り替え中…';
                render(true);
                this.positionPopover();
                let switched = false;
                try { switched = await this.app.switchProfile(id); }
                catch (error) { console.error('プロファイル切り替えエラー:', error); }
                finally {
                    if (this.popover === panel) {
                        panel.profileSwitchPending = false;
                        list.setAttribute('aria-busy', 'false');
                        if (switched) this.closePopover(true);
                        else {
                            status.textContent = 'プロファイルを切り替えられませんでした。';
                            render(true);
                            this.positionPopover();
                        }
                    }
                }
            });
            list.addEventListener('contextmenu', event => {
                const name = event.target.closest('.profile-picker-choice')?.querySelector('.profile-picker-name');
                if (!name || name.scrollWidth <= name.clientWidth || panel.profileSwitchPending) return;
                event.preventDefault();
                status.textContent = name.textContent;
                this.positionPopover();
            });
            search.addEventListener('compositionstart', () => { panel.profileSearchComposing = true; });
            search.addEventListener('compositionend', () => { panel.profileSearchComposing = false; filter(true); });
            search.addEventListener('input', event => {
                if (!panel.profileSearchComposing && !event.isComposing) filter(true);
            });
            panel.addEventListener('keydown', event => {
                if (panel.profileSearchComposing || event.isComposing || !results.length) return;
                const fromSearch = event.target === search;
                if (!(fromSearch ? ['ArrowDown', 'ArrowUp'] : ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']).includes(event.key)) return;
                if (!fromSearch && !list.contains(event.target)) return;
                const index = results.findIndex(profile => String(profile.id) === event.target.dataset.profileId);
                const page = Math.max(1, Math.floor(list.clientHeight / rowHeight));
                const delta = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 :
                    index < 0 ? (event.key === 'ArrowUp' ? results.length - 1 : 0) : index + delta[event.key];
                event.preventDefault();
                focusRow(Math.max(0, Math.min(results.length - 1, next)));
            });
            if (!modal) panel.addEventListener('focusout', event => {
                // A trusted focus change can run microtasks before the next element becomes active.
                if (panel.contains(event.relatedTarget) || event.relatedTarget === anchor) return;
                queueMicrotask(() => {
                    if (this.popover === panel && !panel.profileSwitchPending &&
                        !panel.contains(document.activeElement) && document.activeElement !== anchor) this.closePopover(false);
                });
            });

            filter();
            if (modal) panel.showModal();
            this.positionPopover();
            const selected = results.findIndex(profile => profile.id === this.state.activeProfileId);
            if (selected >= 0) focusRow(selected);
            if (this.media.matches || selected < 0) (close || search).focus({ preventScroll: true });
        }
        openThinking(anchor) {
            if (this.state.isSending) return;
            const capability = this.app.getModelThinkingCapability(); if (!capability.levels.length && !capability.modelDefault) return;
            // Provider metadata may list strongest first. Only presentation order changes.
            const levels = [...capability.levels].sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
            const panel = this.newPopover(anchor, 'Thinkingレベル'); if (!panel) return;
            panel.classList.add('thinking-popover');
            const row = make('div', 'thinking-popover-row'); panel.append(row);
            let current = displayedThinkingEffort(this.app, capability);
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
            const name = make('span', 'thinking-level-name', levelName(current, capability)); name.setAttribute('aria-live', 'polite'); heading.append(name);
            const context = make('span', 'thinking-model-name', this.app.getCurrentChatModelRef()?.modelName || ''); context.title = context.textContent; heading.append(context);
            const dots = make('div', 'thinking-dots'); dots.setAttribute('role', 'radiogroup'); dots.setAttribute('aria-label', 'Thinkingレベル');
            // Keep 40px hit areas; extend the visible markers toward the rounded track ends.
            const setProgress = level => {
                const index = levels.indexOf(level);
                const progress = levels.length > 1 ? index / (levels.length - 1) : .5;
                dots.style.setProperty('--thinking-progress', index < 0 ? '0px' : `calc(12px + (100% - 24px) * ${progress})`);
            };
            setProgress(current);
            let pending = 0, drag = null, suppressClick = false;
            const canChoose = () => !this.state.isSending && !this.state.currentExecutionApiConfig && contextMatches();
            const update = (level, preview = false) => {
                if (this.popover !== panel) return;
                if (!preview) {
                    current = level;
                    if (drag?.level) return;
                }
                const focusedRadio = !preview && dots.contains(document.activeElement);
                const c = this.app.getModelThinkingCapability();
                name.textContent = levelName(level, c);
                setProgress(level);
                for (const button of dots.children) {
                    const selected = button.dataset.level === level;
                    button.title = levelName(button.dataset.level, c);
                    button.setAttribute('aria-label', button.title);
                    button.setAttribute('aria-checked', String(selected));
                    button.tabIndex = selected || (!levels.includes(level) && button === dots.firstElementChild) ? 0 : -1;
                    if (selected && focusedRadio) button.focus({ preventScroll: true });
                }
            };
            panel.refreshThinking = () => {
                if (!contextMatches()) { this.closePopover(false); return; }
                if (!pending) update(displayedThinkingEffort(this.app, this.app.getModelThinkingCapability()));
            };
            const cancelDrag = () => {
                const previewing = Boolean(drag?.level);
                drag = null;
                if (previewing) update(current);
            };
            const choose = (level, dragGeneration = null) => {
                if (this.popover !== panel || !canChoose()) return;
                cancelDrag();
                pending++; update(level);
                this.save(anchor, async () => {
                    try {
                        if (canChoose() && (dragGeneration === null || dragGeneration === (this.state.executionSelectionGenerationV136 ?? 0)))
                            await this.app.setCurrentChatThinkingEffort(level);
                    }
                    finally { pending--; if (!pending && contextMatches()) update(displayedThinkingEffort(this.app, this.app.getModelThinkingCapability())); }
                });
            };
            levels.forEach((level, index) => {
                const button = make('button', 'thinking-dot'); button.type = 'button'; button.setAttribute('role', 'radio');
                button.title = levelName(level, capability);
                button.setAttribute('aria-label', button.title); button.setAttribute('aria-checked', String(level === current));
                button.tabIndex = level === current || (!levels.includes(current) && index === 0) ? 0 : -1;
                button.dataset.level = level;
                const position = levels.length > 1 ? index / (levels.length - 1) : .5;
                button.style.setProperty('--thinking-dot-shift', `${(position * 2 - 1) * 8}px`);
                const mark = make('span', 'thinking-mark'); mark.setAttribute('aria-hidden', 'true'); button.append(mark);
                button.addEventListener('click', () => choose(level)); dots.append(button);
            });
            const levelAt = x => {
                const { left, width } = dots.getBoundingClientRect();
                const position = Math.max(0, Math.min(1, (x - left - 12) / Math.max(1, width - 24)));
                return levels[Math.round(position * (levels.length - 1))];
            };
            const canDrag = () => this.popover === panel && canChoose() &&
                drag.generation === (this.state.executionSelectionGenerationV136 ?? 0);
            dots.addEventListener('pointerdown', event => {
                if (!event.isPrimary) { cancelDrag(); return; }
                if (event.button !== 0) return;
                suppressClick = false;
                if (levels.length < 2 || !canChoose()) return;
                drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
                    generation: this.state.executionSelectionGenerationV136 ?? 0, level: null };
            });
            dots.addEventListener('pointermove', event => {
                if (drag?.id !== event.pointerId) return;
                if (!canDrag()) { cancelDrag(); return; }
                if (!drag.level) {
                    const dx = Math.abs(event.clientX - drag.x), dy = Math.abs(event.clientY - drag.y);
                    if (Math.max(dx, dy) < 8) return;
                    suppressClick = true;
                    if (dx <= dy * 1.5) { cancelDrag(); return; }
                    dots.setPointerCapture(event.pointerId);
                }
                const level = levelAt(event.clientX);
                if (level !== drag.level) { drag.level = level; update(level, true); }
            });
            dots.addEventListener('pointerup', event => {
                if (drag?.id !== event.pointerId) return;
                if (!drag.level || !canDrag()) { cancelDrag(); return; }
                const level = levelAt(event.clientX), selection = drag.generation;
                drag = null;
                if (level === current) update(current);
                else choose(level, selection);
            });
            dots.addEventListener('pointerleave', () => { if (!drag?.level) cancelDrag(); });
            dots.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) cancelDrag(); });
            dots.addEventListener('lostpointercapture', event => {
                if (event.target === dots && drag?.id === event.pointerId) cancelDrag();
            });
            dots.addEventListener('click', event => {
                if (!suppressClick || event.detail === 0) return;
                suppressClick = false;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            dots.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); const index = levels.indexOf(current);
                const backward = ['ArrowLeft', 'ArrowUp'].includes(event.key);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? levels.length - 1
                    : index < 0 ? (backward ? levels.length - 1 : 0)
                    : (index + (backward ? -1 : 1) + levels.length) % levels.length;
                choose(levels[next]);
            });
            const reset = make('button', 'thinking-reset'); reset.type = 'button'; reset.title = '既定レベルに戻す'; reset.setAttribute('aria-label', 'Thinkingレベルを既定に戻す');
            reset.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9a8 8 0 1 1 .5 7M4 4v5h5"/></svg>';
            if (capability.defaultEffort === modelDefault) reset.title = 'モデル既定に戻す';
            reset.addEventListener('click', () => choose(capability.defaultEffort)); row.append(reset);
            if (levels.length) panel.append(dots);
            this.positionPopover(); (dots.querySelector('[tabindex="0"]') || reset).focus();
        }
        positionPopover() {
            if (!this.popover || !this.anchor?.isConnected) return;
            const vp = window.visualViewport, left = vp?.offsetLeft || 0, top = vp?.offsetTop || 0;
            const width = vp?.width || innerWidth, height = vp?.height || innerHeight;
            if (this.popover instanceof HTMLDialogElement) {
                const root = this.popover.layoutProfiles ? getComputedStyle(document.documentElement) : null;
                const safeTop = parseFloat(root?.getPropertyValue('--safe-top')) || 0;
                const safeBottom = parseFloat(root?.getPropertyValue('--safe-bottom')) || 0;
                this.popover.style.width = `${Math.min(420, width - 24)}px`;
                this.popover.style.maxHeight = `${Math.max(0, Math.min(620, height - 24 - safeTop - safeBottom))}px`;
                this.popover.style.left = `${left + width / 2}px`;
                this.popover.style.top = `${top + (height + safeTop - safeBottom) / 2}px`;
                this.popover.layoutProfiles?.();
                return;
            }
            const compact = this.popover.classList.contains('settings-choice-popover');
            const settingsPicker = this.popover.hasAttribute('data-settings-picker');
            const rowWidth = settingsPicker ? this.anchor.getBoundingClientRect().width : width;
            const size = Math.min(compact ? 264 : this.popover.classList.contains('thinking-popover') ? 280 : 340, width - 16, rowWidth);
            this.popover.style.width = `${size}px`;
            if (this.popover.layoutProfiles && this.anchor.id === 'profile-card-header') {
                const button = this.anchor.getBoundingClientRect();
                const topLimit = top + 8;
                const bottom = Math.min(button.top - 6, top + height - 8);
                this.popover.style.maxHeight = `${Math.max(0, bottom - topLimit)}px`;
                this.popover.dataset.placement = 'above';
                this.popover.style.left = `${Math.max(left + 8, Math.min(button.left, left + width - size - 8))}px`;
                this.popover.style.top = `${Math.max(topLimit, bottom - this.popover.getBoundingClientRect().height)}px`;
                this.popover.layoutProfiles();
                return;
            }
            const controls = this.anchor.closest('.chat-model-controls');
            const rect = (controls || this.anchor).getBoundingClientRect();
            this.popover.style.maxHeight = `${Math.max(0, height - 16)}px`;
            const measured = this.popover.getBoundingClientRect().height;
            const above = Math.max(0, rect.top - top - 18), below = Math.max(0, top + height - rect.bottom - 18);
            const alignRight = compact || settingsPicker;
            const useAbove = alignRight ? below < measured && above > below : above >= measured || above >= below;
            this.popover.style.maxHeight = `${useAbove ? above : below}px`;
            const panelHeight = this.popover.getBoundingClientRect().height;
            this.popover.dataset.placement = useAbove ? 'above' : 'below';
            this.popover.style.left = `${Math.max(left + 8, Math.min(controls || alignRight ? rect.right - size : rect.left, left + width - size - 8))}px`;
            this.popover.style.top = `${Math.max(top + 8, Math.min(useAbove ? rect.top - panelHeight - 10 : rect.bottom + 10, top + height - panelHeight - 8))}px`;
            this.popover.layoutProfiles?.();
            if (settingsPicker && (this.popover.refreshProfiles || this.popover.refreshModels)) {
                this.ensurePickerRoom(this.popover);
            }
        }
        ensurePickerRoom(panel) {
            const list = panel.querySelector('.model-picker-list');
            const lacksRoom = () => {
                const row = list.querySelector('button');
                return row && list.clientHeight + 0.5 < row.getBoundingClientRect().height;
            };
            if (panel.roomCheckQueued || !lacksRoom()) return;
            panel.roomCheckQueued = true;
            queueMicrotask(() => {
                panel.roomCheckQueued = false;
                if (this.popover !== panel || panel.profileSwitchPending || panel.profileSearchComposing ||
                    panel.searchComposing || !lacksRoom()) return;
                const anchor = this.anchor;
                const search = panel.querySelector('.model-picker-search');
                const focused = document.activeElement;
                const wasSearching = focused === search;
                const { value, selectionStart, selectionEnd, selectionDirection } = search;
                const choice = focused.dataset.profileId ?? focused.dataset.modelRefValue;
                this.closePopover(false);
                if (panel.refreshProfiles) this.openProfiles(anchor, value, true);
                else this.openModels(anchor, value, true);
                // Keep the dialog for this opening, even when the keyboard or viewport resizes again.
                if (wasSearching) {
                    const nextSearch = this.popover?.querySelector('.model-picker-search');
                    nextSearch?.focus({ preventScroll: true });
                    nextSearch?.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
                } else if (choice != null) {
                    const nextRow = [...(this.popover?.querySelectorAll('.model-picker-choice') || [])]
                        .find(row => (row.dataset.profileId ?? row.dataset.modelRefValue) === choice);
                    nextRow?.focus();
                }
            });
        }
        closePopover(restoreFocus) {
            if (!this.popover) return;
            const anchor = this.anchor, panel = this.popover;
            this.popover = null; this.anchor = null;
            anchor?.setAttribute('aria-expanded', 'false'); anchor?.removeAttribute('aria-controls');
            if (panel instanceof HTMLDialogElement && panel.open) panel.close();
            panel.remove();
            if (panel.refreshProfiles) this.ui.retainProfileIconUrls();
            if (restoreFocus && anchor?.isConnected && !anchor.disabled) anchor.focus({ preventScroll: true });
        }
    }
    root.CategoryPane = CategoryPane;
    root.TextareaSizing = TextareaSizing;
    root.SettingsUIV136 = { create: options => new SettingsUI(options) };
    if (root.appLogic && root.state) root.settingsUiV136 = root.SettingsUIV136.create({ app: root.appLogic, state: root.state, ui: root.uiUtilsV136 });
})(window);

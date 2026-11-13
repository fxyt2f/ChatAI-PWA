/* Deterministic visual fixtures and layout assertions. No external services. */
window.prepareSettingsLayoutReviewV136 = async (category, dark, expanded = true) => {
    await window.prepareSettingsScreenshotV136(category, dark);
    const app = window.appLogic, state = window.state, ui = window.uiUtilsV136;
    await app.saveGlobalSettingsV136({ enableProofreading: expanded, enableThoughtTranslation: expanded,
        enableAutoRetry: expanded, useFixedRetryDelay: expanded, enableApiTimeout: expanded,
        sdEnableQualityChecker: expanded, sdApiUrl: 'http://example.invalid:7860',
        googleSearchApiKey: '', googleSearchEngineId: 'visual-review-example' });
    await app.setProfileOverride('theme', expanded);
    await app.setProfileOverride('appearance', expanded);
    const theme = { darkMode: dark, themeColorMode: 'individual', accentColor: '#1976d2',
        headerColor: '#1976d2', headerTextColorMode: 'auto',
        sendButtonColor: '#1976d2', otherButtonColor: '#1976d2', userMessageColor: '#1976d2' };
    await app.saveAppearanceValues('theme', theme, { global: true });
    if (expanded) await app.saveAppearanceValues('theme', theme, { global: false });
    state.settings.enableMemory = expanded;
    state.settings.geminiEnableFunctionCalling = expanded;
    state.settings.geminiEnableGrounding = false;
    ui.applySettingsToUI();
    const connected = document.getElementById('dropbox-connected-state');
    const disconnected = document.getElementById('dropbox-auth-state');
    connected.classList.toggle('hidden', !expanded);
    disconnected?.classList.toggle('hidden', expanded);
    document.getElementById('dropbox-user-name').textContent = 'テスト用アカウント';
    document.getElementById('last-sync-time-display').textContent = '最終同期: テストデータ';
    document.getElementById('settings-detail').scrollTop = 0;
    document.activeElement?.blur();
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.body.classList.contains('dark-mode') !== dark) throw new Error('Visual fixture theme mismatch');
    const panel = document.querySelector(`[data-settings-panel="${category}"]`);
    return [...panel.children].filter(node => node.matches('.settings-group') && node.getClientRects().length)
        .map((node, index) => {
            node.dataset.layoutReviewGroup = String(index);
            return { index, title: node.querySelector('h2,h3,h4')?.textContent.trim() || node.id,
                height: node.getBoundingClientRect().height };
        });
};

window.measureSettingsLayoutV136 = category => {
    const panel = document.querySelector(`[data-settings-panel="${category}"]`);
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const nodes = [...panel.querySelectorAll('.settings-group,h2,h3,h4,label,p,input,select,textarea,.color-setting-row')].filter(visible);
    return nodes.map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { id: node.id, tag: node.tagName, classes: node.className,
            text: node.matches('input,select,textarea') ? '' : node.textContent.trim().slice(0, 100),
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            margin: style.margin, padding: style.padding, gap: style.gap,
            lineHeight: style.lineHeight, fontSize: style.fontSize, fontWeight: style.fontWeight,
            borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth,
            overflow: node.scrollWidth > node.clientWidth + 1 };
    });
};

window.assertSettingsLayoutV136 = category => {
    const panel = document.querySelector(`[data-settings-panel="${category}"]`), detail = document.getElementById('settings-detail');
    const failures = [];
    let assertions = 0;
    const check = (value, message) => { assertions++; if (!value) failures.push(message); };
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const groups = [...panel.children].filter(node => node.matches('.settings-group') && visible(node));
    const x = panel.getBoundingClientRect().left, width = panel.getBoundingClientRect().width;
    check(detail.scrollWidth <= detail.clientWidth + 1, 'settings pane has horizontal overflow');
    groups.forEach((group, index) => {
        const rect = group.getBoundingClientRect(), style = getComputedStyle(group);
        check(Math.abs(rect.left - x) < 1 && Math.abs(rect.width - width) < 1, 'section edges differ: ' + index);
        check(parseFloat(style.borderBottomWidth) === 0, 'unexpected bottom divider: ' + index);
        check(parseFloat(style.borderTopWidth) === (index ? 1 : 0), 'section divider count: ' + index);
        check(parseFloat(style.marginTop) === (index ? 16 : 0) && parseFloat(style.paddingTop) === (index ? 16 : 0), 'section divider spacing: ' + index);
        check(style.rowGap === '12px', 'section item spacing: ' + index);
        for (const child of [...group.children].filter(visible)) {
            const itemStyle = getComputedStyle(child);
            check(parseFloat(itemStyle.marginTop) === 0 && parseFloat(itemStyle.marginBottom) === 0, 'legacy margin duplicates gap: ' + (child.id || child.className || child.tagName));
        }
        const heading = group.querySelector(':scope > h2,:scope > h3,:scope > h4,:scope > .sync-header > h3');
        if (heading) {
            const h = getComputedStyle(heading);
            check(h.fontSize === '18px' && h.fontWeight === '600', 'section heading hierarchy: ' + index);
            check(parseFloat(h.borderBottomWidth) === 0, 'legacy heading divider: ' + index);
        }
    });
    for (const control of panel.querySelectorAll('input:not([type=checkbox]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]),select')) {
        if (visible(control)) check(control.getBoundingClientRect().height >= 39, 'control too short: ' + control.id);
    }
    for (const textarea of panel.querySelectorAll('textarea')) if (visible(textarea)) {
        check(textarea.getBoundingClientRect().height >= 100 && textarea.getBoundingClientRect().height <= 500, 'textarea outside prompt range: ' + textarea.id);
        check(parseFloat(getComputedStyle(textarea).lineHeight) >= 23, 'textarea leading too tight: ' + textarea.id);
    }
    for (const field of panel.querySelectorAll('.settings-field')) if (visible(field)) {
        check(getComputedStyle(field).rowGap === '4px', 'label/control/help spacing: ' + field.textContent.trim().slice(0, 40));
    }
    for (const label of panel.querySelectorAll('label.checkbox-label')) if (visible(label)) {
        check(label.getBoundingClientRect().height >= 39, 'toggle target too short: ' + label.textContent.trim());
    }
    for (const button of panel.querySelectorAll('.profile-actions button')) if (visible(button)) {
        check(button.getBoundingClientRect().height <= 46, 'profile action text wraps unnecessarily: ' + button.id);
    }
    check(![...panel.querySelectorAll('p')].some(p => visible(p) && !p.id && !p.textContent.trim() && !p.children.length), 'empty spacing paragraph');
    return { category, assertions, failures };
};

window.assertSettingsLayoutIdentityV136 = () => {
    const root = document.getElementById('settings-detail');
    const controls = [...root.querySelectorAll('input,select,textarea,button')];
    const markup = root.innerHTML;
    window.settingsUiV136.prepareSettingsLayout();
    const current = [...root.querySelectorAll('input,select,textarea,button')];
    const failures = [];
    if (controls.length !== current.length || controls.some((node, index) => node !== current[index])) failures.push('layout normalization replaced or reordered controls');
    if (markup !== root.innerHTML) failures.push('layout normalization is not idempotent');
    return { assertions: 2, failures };
};

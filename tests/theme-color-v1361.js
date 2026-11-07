/* Runtime HTML theme color, deliberately independent of manifest/header colors. */
window.runThemeColorV1361 = async () => {
    const app = window.appLogic, ui = window.uiUtilsV136, st = window.state;
    const meta = document.querySelector('meta[name="theme-color"]');
    const screen = document.getElementById('chat-screen');
    const records = []; let assertions = 0;
    const check = (ok, message) => { assertions++; if (!ok) throw new Error(message); };
    const hex = rgb => ui.colorToHex(rgb).toUpperCase();
    const palette = () => Object.fromEntries(['--app-header-bg', '--app-header-fg', '--app-header-hover-bg',
        '--app-header-hover-fg', '--new-chat-button-bg', '--send-button-bg', '--bg-button', '--bg-user-message',
        '--user-message-bg', '--user-message-fg']
        .map(name => [name, getComputedStyle(document.body).getPropertyValue(name).trim()]));
    const verify = (expected, label) => {
        check(meta.content === expected, `${label}: meta ${meta.content}, expected ${expected}`);
        check(hex(getComputedStyle(screen).backgroundColor) === expected, label + ': matches actual chat background');
        records.push({ label, meta: meta.content, background: getComputedStyle(screen).backgroundColor });
    };

    const html = new DOMParser().parseFromString(await (await fetch('../index.html')).text(), 'text/html');
    check(html.querySelector('meta[name="theme-color"]').content === '#F5F5F5', 'initial HTML uses light chat background');
    check(document.querySelectorAll('meta[name="theme-color"]').length === 1, 'single runtime theme-color meta');
    const manifest = await (await fetch('../manifest.json')).json();
    check(manifest.theme_color === '#1e1e1e', 'diagnostic manifest theme_color stays fixed dark');

    await app.setProfileOverride('theme', false);
    for (const darkMode of [false, true, false]) {
        const expected = darkMode ? '#1E1E1E' : '#F5F5F5';
        await app.saveAppearanceValues('theme', { darkMode }, { global: true });
        verify(expected, `saved ${darkMode ? 'dark' : 'light'} mode`);
        const colors = palette();
        ui.updatePageThemeColor();
        check(JSON.stringify(palette()) === JSON.stringify(colors), 'page theme update preserves all UI color variables');

        for (const themeColorMode of ['accent', 'individual']) {
            await app.saveAppearanceValues('theme', { themeColorMode, accentColor: '#aa3388', headerColor: '#228844',
                newChatButtonColor: '#3344aa', sendButtonColor: '#bb7722', otherButtonColor: '#556677', userMessageColor: '#663399' }, { global: true });
            const configured = palette();
            ui.applyHeaderColor(); ui.applyThemeColorSettings();
            verify(expected, `${darkMode ? 'dark' : 'light'} ${themeColorMode} header/accent change`);
            check(configured['--app-header-bg'] === ui.getEffectiveHeaderColor(), 'header still follows its own settings');
            check(configured['--new-chat-button-bg'] === ui.getEffectiveNewChatButtonColor(), 'new-chat button still follows its settings');
            check(configured['--send-button-bg'] === ui.getEffectiveSendButtonColor(), 'send button still follows its settings');
            check(configured['--bg-button'] === ui.getEffectiveOtherButtonColor(), 'other buttons still follow their settings');
            check(configured['--user-message-bg'] === ui.getEffectiveUserMessageColor(), 'messages still follow their settings');
            check(JSON.stringify(palette()) === JSON.stringify(configured), 'reapplying colors keeps configured UI colors');
        }

        // Follow the initial settings-load route against persisted settings.
        st.settings.darkMode = !darkMode; document.body.classList.toggle('dark-mode', !darkMode); meta.content = '#000000';
        await app.loadSettingsV136(); app.applyActiveProfile(); ui.applySettingsToUI();
        verify(expected, `settings reload ${darkMode ? 'dark' : 'light'} mode`);
        check(document.body.classList.contains('dark-mode') === darkMode, 'settings reload restores current mode');
    }

    // Verify the source is the rendered CSS background, not duplicated JS constants.
    screen.style.backgroundColor = '#d1d2d3'; ui.applyDarkMode();
    verify('#D1D2D3', 'computed CSS background override');
    screen.style.removeProperty('background-color'); ui.applyDarkMode(); verify('#F5F5F5', 'CSS override removed');
    return { assertions, records, manifestThemeColor: manifest.theme_color };
};

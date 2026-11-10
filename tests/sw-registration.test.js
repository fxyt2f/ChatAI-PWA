const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const region = source.slice(source.indexOf('// --- Service Worker関連 ---'), source.indexOf('const htmlUtils'));
const register = new vm.Script(`${region}\nregisterServiceWorker;`);

function fixture(readyState, registrationError) {
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), { readyState, visibilityState: 'visible' });
    const requests = [], intervals = [], errors = [], alerts = [];
    let updates = 0;
    const registration = Object.assign(new EventTarget(), {
        scope: 'https://example.test/ChatAI-PWA/',
        async update() { updates++; }
    });
    const serviceWorker = Object.assign(new EventTarget(), {
        ready: Promise.resolve(registration),
        async register(path) {
            requests.push(path);
            if (registrationError) throw registrationError;
            return registration;
        }
    });
    const start = register.runInNewContext({
        window, document, navigator: { serviceWorker },
        uiUtils: { showCustomAlert: message => alerts.push(message) },
        setInterval: (callback, delay) => intervals.push({ callback, delay }),
        console: { log() {}, error: (...args) => errors.push(args) }
    });

    return {
        start, requests, intervals, errors,
        load() {
            document.readyState = 'complete';
            window.dispatchEvent(new Event('load'));
        },
        async verifyWatchers() {
            assert.equal(intervals.length, 1);
            assert.equal(intervals[0].delay, 60 * 60 * 1000);
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            await intervals[0].callback();
            assert.equal(updates, 3);

            const message = { status: 'cacheClearFailed', error: 'fixture error' };
            serviceWorker.dispatchEvent(new MessageEvent('message', { data: message }));
            assert.deepEqual(alerts, [message.error]);
        }
    };
}

test('registers immediately when load has already completed', async () => {
    const page = fixture('complete');
    page.start();
    assert.deepEqual(page.requests, ['./sw.js']);

    page.start();
    page.load();
    await setImmediate();
    assert.deepEqual(page.requests, ['./sw.js']);
    await page.verifyWatchers();
});

for (const readyState of ['loading', 'interactive']) {
    test(`waits for load from ${readyState} and only registers once`, async () => {
        const page = fixture(readyState);
        page.start();
        page.start();
        assert.deepEqual(page.requests, []);
        assert.deepEqual(page.intervals, []);

        page.load();
        page.load();
        await setImmediate();
        assert.deepEqual(page.requests, ['./sw.js']);
        await page.verifyWatchers();
    });
}

for (const readyState of ['complete', 'loading']) {
    test(`handles a rejected registration from ${readyState}`, async () => {
        const error = new Error('registration rejected');
        const page = fixture(readyState, error);
        page.start();
        if (readyState === 'loading') page.load();
        await setImmediate();

        assert.deepEqual(page.requests, ['./sw.js']);
        assert.deepEqual(page.errors, [['ServiceWorker処理中にエラー: ', error]]);
        assert.deepEqual(page.intervals, []);
    });
}

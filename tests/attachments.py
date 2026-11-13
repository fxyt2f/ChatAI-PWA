"""Direct attachments on the real chat page, with Chrome's file chooser and layout APIs."""
import base64
import json
from pathlib import Path
import shutil
import tempfile
import time


def run(client, url, screenshots=None):
    root = Path(__file__).resolve().parents[1]
    clip = '#attach-file-btn'
    preview = '#composer-attachment-list'
    input_box = '#user-input'
    socket_timeout = client.sock.gettimeout()
    diagnostics = client.capture_diagnostics
    client.sock.settimeout(25)

    def ev(expression):
        result = client.call('Runtime.evaluate', {
            'expression': expression, 'awaitPromise': True, 'returnByValue': True,
        })
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def wait(expression, description):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if ev(f'Promise.resolve({expression}).then(Boolean)'):
                return
            time.sleep(0.05)
        details = ev("""({chatId: window.state?.currentChatId, initializing: window.state?.executionInitializingV136,
            dialogs: Array.from(document.querySelectorAll('dialog[open]'), dialog => [dialog.id, dialog.textContent.trim()])})""")
        raise AssertionError(f'{description}: {details}')

    def click(selector):
        ev(f'document.querySelector({json.dumps(selector)}).click()')

    def metrics(width, height, touch):
        client.call('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': touch,
        })
        client.call('Emulation.setTouchEmulationEnabled', {'enabled': touch})
        wait(f'innerWidth === {width} && innerHeight === {height}', f'{width}x{height} viewport')

    def screenshot(name):
        if screenshots is None:
            return
        screenshots.mkdir(parents=True, exist_ok=True)
        data = client.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})['data']
        (screenshots / (name + '.png')).write_bytes(base64.b64decode(data))

    def choose():
        client.capture_diagnostics = True
        offset = len(client.diagnostic_events)
        try:
            point = ev(f"""(() => {{
                const r = document.querySelector('{clip}').getBoundingClientRect();
                return {{x: r.x + r.width / 2, y: r.y + r.height / 2}};
            }})()""")
            for kind in ('mousePressed', 'mouseReleased'):
                client.call('Input.dispatchMouseEvent', {'type': kind, 'button': 'left', 'clickCount': 1, **point})
            ev('true')
            event = next((e['params'] for e in client.diagnostic_events[offset:] if e['method'] == 'Page.fileChooserOpened'), None)
            assert event and event['mode'] == 'selectMultiple', 'Clip opens a native multiple-file chooser'
            assert ev("!document.querySelector('dialog[open], #fileUploadDialog')"), 'No attachment dialog'
            return event['backendNodeId']
        finally:
            client.capture_diagnostics = diagnostics

    def select(*files):
        client.call('DOM.setFileInputFiles', {'backendNodeId': choose(), 'files': [str(file) for file in files]})
        wait('!appLogic.attachmentOperation', 'Selected files finished preparing')

    def names():
        return ev('state.pendingAttachments.map(file => file.name)')

    def assert_names(*expected):
        assert names() == list(expected), (names(), expected)

    def no_preview():
        assert ev(f"""document.querySelector('{preview}').hidden && !document.querySelector('{preview}').children.length
            && !document.querySelector('{clip}').classList.contains('has-attachments')""")

    def setup():
        ev("""(async () => {
            const ref = {apiConfigId: 'attachments-gemini', modelName: 'gemini-2.5-flash'};
            await dbUtils.saveSetting('apiConfigs', [{id: ref.apiConfigId, name: 'Attachments test',
                provider: 'gemini', apiKey: 'fixture', baseUrl: 'https://attachment-test.invalid/models',
                modelCandidates: [ref.modelName]}]);
            await appLogic.refreshExecutionApiConfigsV136();
            await appLogic.setCurrentChatModelRef(ref);
            state.settings.enableAutoRetry = false;
            state.settings.enableProofreading = false;
            state.settings.enableChatTitleGeneration = false;
            const original = window.fetch;
            window.attachmentRequests = [];
            window.fetch = (url, options) => {
                if (!String(url).startsWith('https://attachment-test.invalid/')) return original(url, options);
                attachmentRequests.push(JSON.parse(options.body));
                return Promise.resolve(Response.json({
                    candidates: [{content: {parts: [{text: '添付ファイルを確認しました'}]}, finishReason: 'STOP'}]
                }));
            };
            window.attachmentFixture = {
                drop(transfer, type = 'drop') {
                    return !document.querySelector('#chat-screen').dispatchEvent(new DragEvent(type, {
                        bubbles: true, cancelable: true, dataTransfer: transfer
                    }));
                },
                files(...files) {
                    const transfer = new DataTransfer();
                    for (const file of files) transfer.items.add(file);
                    return transfer;
                },
                input(value) {
                    const box = document.querySelector('#user-input');
                    box.value = value;
                    box.dispatchEvent(new Event('input', {bubbles: true}));
                },
                gate() {
                    let release;
                    const promise = new Promise(resolve => { release = resolve; });
                    return {promise, release};
                }
            };
        })()""")

    client.call('Page.enable')
    client.call('Network.enable')
    client.call('Network.setBlockedURLs', {'urls': ['https://*']})
    client.call('Page.setInterceptFileChooserDialog', {'enabled': True})
    script = client.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        if (location.search === '?attachmentFixture=1') {
            const worker = navigator.serviceWorker;
            const listen = worker.addEventListener.bind(worker);
            worker.addEventListener = (type, ...args) => {
                if (type !== 'controllerchange') listen(type, ...args);
            };
        }
    """})['identifier']
    try:
        client.call('Page.navigate', {'url': url + '?attachmentFixture=1'})
        wait("window.appLogic?._setupEventListenersCallCount && !document.querySelector('#progressDialog[open]')",
             'Real app startup completed')
        ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        if ev("Boolean(document.querySelector('#releaseNotesDialog[open]'))"):
            click('#releaseNotesDialog .dialog-ok-btn')
            wait("!document.querySelector('#releaseNotesDialog[open]')", 'Release notes closed')
        setup()
        no_preview()

        with tempfile.TemporaryDirectory(prefix='chatai-attachments-') as temp:
            image = Path(temp) / '画像A.png'
            image_c = Path(temp) / ('長いファイル名をすべて表示する' * 5 + '画像C.png')
            shutil.copyfile(root / 'icon-192x192.png', image)
            shutil.copyfile(image, image_c)

            select(image)
            assert_names(image.name)
            wait(f"document.querySelector('{preview} img').naturalWidth > 0", 'Image preview decodes')
            assert ev(f"document.querySelector('{clip}').classList.contains('has-attachments')")

            assert ev("""(() => {
                const {drop, files} = attachmentFixture;
                const screen = document.querySelector('#chat-screen');
                const plain = new DataTransfer();
                plain.setData('text/plain', 'text drag');
                if (drop(plain, 'dragover') || drop(plain) || screen.classList.contains('drag-over')) return false;
                const pdf = files(new File(['%PDF-1.4'], 'B.pdf', {type: 'application/octet-stream'}));
                if (!drop(pdf, 'dragover') || !screen.classList.contains('drag-over')) return false;
                screen.dispatchEvent(new DragEvent('dragleave', {bubbles: true}));
                if (screen.classList.contains('drag-over')) return false;
                drop(pdf, 'dragover');
                document.body.dispatchEvent(new DragEvent('dragend', {bubbles: true}));
                if (screen.classList.contains('drag-over')) return false;
                drop(pdf, 'dragover');
                return drop(pdf) && !screen.classList.contains('drag-over');
            })()"""), 'Only file drags are intercepted and the highlight clears on leave, end and drop'
            wait('!appLogic.attachmentOperation', 'Dropped PDF finished')
            assert_names(image.name, 'B.pdf')
            assert ev(f"""state.pendingAttachments[1].mimeType === 'application/pdf'
                && document.querySelector('{preview} .composer-attachment-icon').dataset.fileKind === 'pdf'""")
            select(image_c)
            assert_names(image.name, 'B.pdf', image_c.name)

            chooser = choose()
            client.call('DOM.setFileInputFiles', {'backendNodeId': chooser, 'files': []})
            ev("document.querySelector('#file-input').dispatchEvent(new Event('cancel', {bubbles:true}))")
            assert_names(image.name, 'B.pdf', image_c.name)
            select(image)
            assert_names(image.name, 'B.pdf', image_c.name)
            assert ev("document.querySelector('#composer-attachment-status').textContent.includes('重複')")
            assert ev("!attachmentRequests.length && !state.currentMessages.length"), 'Choosing files never sends'

            ev("attachmentFixture.input('本文はそのまま')")
            click(f'{preview} li:nth-child(2) button')
            assert_names(image.name, image_c.name)
            assert ev(f"document.querySelector('{input_box}').value === '本文はそのまま'")
            click(f'{preview} li:nth-child(2) summary')
            assert ev(f"""document.querySelector('{preview} li:nth-child(2) details').open
                && document.querySelector('{preview} li:nth-child(2) summary').textContent === {json.dumps(image_c.name)}""")
            click(f'{preview} li:nth-child(2) summary')

            ev("""appLogic.handleFileSelection(Array.from({length: 14}, (_, index) =>
                new File(['fixture'], '一覧のファイル-' + index + '.txt')))""")
            for width in (320, 375, 430, 768, 1280):
                touch = width <= 768
                metrics(width, 800, touch)
                for dark in (False, True):
                    ev(f"appLogic.saveAppearanceValues('theme', {{darkMode: {str(dark).lower()}}}, {{global: true}})")
                    wait(f"""document.body.classList.contains('dark-mode') === {str(dark).lower()} &&
                        !document.body.getAnimations({{subtree: true}}).some(animation =>
                            animation instanceof CSSTransition && ['color', 'background-color'].includes(animation.transitionProperty))""",
                         'Theme applied')
                    wait("""(() => {
                        const list = document.querySelector('#composer-attachment-list');
                        const r = list.getBoundingClientRect();
                        const composer = list.closest('footer');
                        const c = composer.getBoundingClientRect();
                        const input = document.querySelector('#user-input').getBoundingClientRect();
                        const send = document.querySelector('#send-button').getBoundingClientRect();
                        const remove = list.querySelector('button').getBoundingClientRect();
                        const main = document.querySelector('#chat-screen .main-content');
                        const height = parseInt(getComputedStyle(document.body).getPropertyValue('--composer-height'));
                        return r.left >= c.left && r.right <= c.right && c.left >= 0 && c.right <= innerWidth &&
                            c.bottom <= visualViewport.height && r.bottom <= input.top && input.bottom <= send.top &&
                            list.scrollHeight > list.clientHeight && list.clientHeight <= 136 &&
                            list.scrollWidth <= list.clientWidth && remove.width >= (matchMedia('(any-pointer: coarse)').matches ? 44 : 36)
                            && remove.width === remove.height && height === Math.ceil(c.height)
                            && parseFloat(getComputedStyle(main).paddingBottom) >= height;
                    })()""", f'Composer layout at {width}px, dark={dark}')
                    screenshot(f'{width}-{"dark" if dark else "light"}')
            assert ev(f"""(() => {{
                const list = document.querySelector('{preview}');
                list.scrollTop = list.scrollHeight;
                const scrolled = list.scrollTop > 0;
                list.scrollTop = 0;
                return scrolled;
            }})()"""), 'Long preview list scrolls internally'

            metrics(320, 350, True)
            wait(f"document.querySelector('{preview}').clientHeight <= 84", 'Preview height follows compact viewport')
            screenshot('320-compact')
            metrics(320, 800, True)
            assert ev(f"""(() => {{
                const viewport = visualViewport;
                Object.defineProperty(viewport, 'height', {{configurable: true, value: 350}});
                try {{
                    uiUtilsV136.updateChatWorkspaceLayout();
                    const send = document.querySelector('#send-button').getBoundingClientRect();
                    const list = document.querySelector('{preview}');
                    return send.bottom <= 350 && list.clientHeight <= 84 && list.scrollHeight > list.clientHeight;
                }} finally {{
                    delete viewport.height;
                    uiUtilsV136.updateChatWorkspaceLayout();
                }}
            }})()"""), 'Visual viewport shrink keeps the send button and preview reachable'
            metrics(1280, 900, False)

            ev("appLogic.clearComposerAttachments()")
            select(image)
            assert ev("""(async () => {
                const {gate, files, drop} = attachmentFixture;
                const first = gate();
                const original = appLogic.fileToBase64;
                appLogic.fileToBase64 = async file => {
                    if (file.name === 'broken.txt') throw new Error('controlled failure');
                    if (file.name === 'B.pdf') await first.promise;
                    return original.call(appLogic, file);
                };
                try {
                    const pdf = new File(['%PDF-1.4'], 'B.pdf');
                    drop(files(pdf));
                    const work = appLogic.attachmentOperation.finished;
                    drop(files(pdf, new File(['x'], 'broken.txt'), new File(['c'], 'C.txt')));
                    document.querySelector('#user-input').dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true
                    }));
                    document.querySelector('#send-button').click();
                    await appLogic.handleSend();
                    if (!document.querySelector('#send-button').disabled || attachmentRequests.length) return false;
                    first.release();
                    await work;
                    return !document.querySelector('#send-button').disabled &&
                        /重複.*変換失敗/.test(document.querySelector('#composer-attachment-status').textContent) &&
                        document.querySelector('#user-input').value === '本文はそのまま';
                } finally { first.release(); appLogic.fileToBase64 = original; }
            })()"""), 'Queued additions are serialized, duplicates/failure isolated, and send stays blocked'
            assert_names(image.name, 'B.pdf', 'C.txt')

            click('#send-button')
            wait("!state.isSending && !state.sendPreparationV136 && attachmentRequests.length === 1",
                 'Text and attachments sent through the real send handler')
            no_preview()
            sent_id = ev('state.currentChatId')
            assert sent_id
            assert ev("""(async () => {
                const stored = (await dbUtils.getChat(state.currentChatId)).messages[0];
                const parts = attachmentRequests[0].contents.find(entry => entry.role === 'user').parts;
                return stored.content === '本文はそのまま' &&
                    stored.attachments.map(file => file.mimeType).join() === 'image/png,application/pdf,text/plain' &&
                    parts.filter(part => part.inlineData).every((part, index) => part.inlineData.data === stored.attachments[index].base64Data) &&
                    parts.filter(part => part.inlineData).length === 3 &&
                    parts.some(part => part.text === stored.content + '\\n\\n[添付ファイル: ' +
                        stored.attachments.map(file => file.name).join(', ') + ']');
            })()"""), 'API payload and IndexedDB retain existing content and attachment format'
            click('.message.user .attachment-details summary')
            click('.message.user img.attachment-thumbnail')
            wait("!document.querySelector('#image-modal-overlay').classList.contains('hidden') && document.querySelector('#image-modal-img').naturalWidth > 0",
                 'Sent image still opens the image viewer')
            click('#image-modal-close')

            ev("appLogic.startNewChat(); state.executionSettingsReady")
            ev("appLogic.setCurrentChatModelRef({apiConfigId:'attachments-gemini', modelName:'gemini-2.5-flash'})")
            ev("appLogic.handleFileSelection([new File(['only'], 'only.txt')])")
            assert ev(f"document.querySelector('{input_box}').value === '' && !document.querySelector('#send-button').disabled")
            click('#send-button')
            wait("!state.isSending && !state.sendPreparationV136 && attachmentRequests.length === 2",
                 'Attachment-only send succeeds')
            assert ev("state.currentMessages[0].content === '' && state.currentMessages[0].attachments.length === 1")
            no_preview()

            ev("""(async () => {
                const chunk = new Uint8Array(10 * 1024 * 1024);
                for (let i = 0; i < 5; i++) await appLogic.handleFileSelection([new File([chunk], i + '.bin')]);
                await appLogic.handleFileSelection([
                    new File([chunk, 'x'], 'oversized.bin'),
                    new File(['x'], 'over-total.bin')
                ]);
            })()""")
            assert_names('0.bin', '1.bin', '2.bin', '3.bin', '4.bin')
            assert ev("""state.pendingAttachments.reduce((n, file) => n + file.file.size, 0) === 50 * 1024 * 1024 &&
                /10MiB超過.*合計50MiB超過/.test(document.querySelector('#composer-attachment-status').textContent)""")
            ev("appLogic.clearComposerAttachments()")

            ev("""(() => {
                const original = appLogic.fileToBase64, gate = attachmentFixture.gate();
                appLogic.fileToBase64 = async file => { await gate.promise; return original.call(appLogic, file); };
                attachmentFixture.late = appLogic.handleFileSelection([new File(['late'], 'late.txt')]);
                attachmentFixture.release = () => { appLogic.fileToBase64 = original; gate.release(); };
            })()""")
            ev(f"void (attachmentFixture.load = appLogic.loadChat({sent_id}))")
            wait("document.querySelector('#confirmDialog[open]') && document.querySelector('#confirmDialog').textContent.includes('添付')",
                 'Chat switch asks before discarding in-flight attachments')
            click('#confirmDialog .dialog-cancel-btn')
            assert ev("(async () => (await attachmentFixture.load).reason === 'attachments' && Boolean(appLogic.attachmentOperation))()")
            ev(f"void (attachmentFixture.load = appLogic.loadChat({sent_id}))")
            wait("document.querySelector('#confirmDialog[open]')", 'Chat switch confirms again')
            click('#confirmDialog .dialog-ok-btn')
            assert ev('(async () => (await attachmentFixture.load).ok)()'), 'Chat switch completed'
            ev('attachmentFixture.release(); attachmentFixture.late')
            assert_names()
            no_preview()

            select(image)
            ev("attachmentFixture.input('未送信の本文')")
            click('#goto-history-btn')
            click('#new-chat-btn')
            wait("document.querySelector('#confirmDialog[open]') && document.querySelector('#confirmDialog').textContent.includes('添付')",
                 'New chat asks before discarding pending attachments')
            ev("""void (attachmentFixture.dialogClosed = new Promise(resolve =>
                document.querySelector('#confirmDialog').addEventListener('close', resolve, {once: true})))""")
            click('#confirmDialog .dialog-cancel-btn')
            ev('attachmentFixture.dialogClosed.then(() => true)')
            assert_names(image.name)
            assert ev(f"state.currentChatId === {sent_id} && document.querySelector('{input_box}').value === '未送信の本文'")
            click('#goto-history-btn')
            click('#new-chat-btn')
            wait("document.querySelector('#confirmDialog[open]')", 'New chat confirms again')
            click('#confirmDialog .dialog-ok-btn')
            wait("state.currentChatId === null && !state.executionInitializingV136", 'New chat started')
            no_preview()

            chooser = choose()
            ev("appLogic.startNewChat(); state.executionSettingsReady")
            client.call('DOM.setFileInputFiles', {'backendNodeId': chooser, 'files': [str(image)]})
            assert_names()
            no_preview()
            select(image, image_c)
            assert_names(image.name, image_c.name)
            click(f'{preview} li:first-child button')
            assert_names(image_c.name)
            click(f'{preview} li button')
            no_preview()
            assert ev("document.querySelector('#send-button').disabled"), 'Removing the only file disables an empty send'
    finally:
        client.capture_diagnostics = diagnostics
        client.sock.settimeout(socket_timeout)
        client.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script})
        client.call('Page.setInterceptFileChooserDialog', {'enabled': False})
        client.call('Network.setBlockedURLs', {'urls': []})
        metrics(1280, 900, False)

    return 'ALL PASSED (direct attachments, queue and send safety, 10 layout/theme combinations and compact viewport)'
